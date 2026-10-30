/**
 * Chat: direct messages between any two users, and groups that admins create.
 *
 * Tables (created on start-up by ensureChatTables):
 *   chat_conversations — one row per DM or group. A DM has a unique direct_key
 *                        ("<low id>:<high id>") so the same pair never gets two.
 *   chat_members       — who is in a conversation, their role ('admin' runs a group)
 *                        and the last message they have read (read receipts, unread).
 *   chat_messages      — text, optional reply, edit / soft-delete markers.
 *   chat_attachments   — files of a message: stored in Google Drive (drive_file_id)
 *                        when Drive is connected, otherwise as bytes (data).
 *   chat_reactions     — one row per (message, user, emoji).
 *   chat_mentions      — who a message @mentions, for highlighting and badges.
 *
 * Every function that takes a userId checks membership itself, so routes cannot
 * forget to; failures throw ChatError with an HTTP status.
 */
import { getPool, avatarUrlFor } from './index.js';
import { isDriveConfigured, uploadChatFile, trashContentFile } from '../driveContent.js';

export class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ChatError';
  }
}

export const CHAT_LIMITS = {
  bodyMax: 4000,
  groupNameMax: 80,
  attachmentsPerMessage: 5,
  attachmentBytes: 10 * 1024 * 1024,
  pageSize: 40,
};

// A fixed set keeps reactions readable and stops arbitrary strings being stored.
export const CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '✅'];

// Images of these types may be shown inline; every other file is served as a download.
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Video and audio the browser can play in the chat (served inline, never as HTML).
export const INLINE_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
export const INLINE_AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a'];

/** How the chat shows a file: 'image', 'video', 'audio', or null for a download. */
export function mediaKind(mime) {
  const type = String(mime || '').toLowerCase();
  if (INLINE_IMAGE_TYPES.includes(type)) return 'image';
  if (INLINE_VIDEO_TYPES.includes(type)) return 'video';
  if (INLINE_AUDIO_TYPES.includes(type)) return 'audio';
  return null;
}

const toInt = (v) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};

function pool() {
  const p = getPool();
  if (!p) throw new ChatError(503, 'Chat needs the database.');
  return p;
}

export async function ensureChatTables() {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      conversation_id SERIAL PRIMARY KEY,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('direct', 'group')),
      name VARCHAR(120),
      direct_key VARCHAR(40) UNIQUE,
      created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_message_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS chat_members (
      conversation_id INT NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_read_message_id BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
    CREATE TABLE IF NOT EXISTS chat_messages (
      message_id BIGSERIAL PRIMARY KEY,
      conversation_id INT NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
      sender_id INT REFERENCES users(user_id) ON DELETE SET NULL,
      body TEXT,
      reply_to_id BIGINT REFERENCES chat_messages(message_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, message_id DESC);
    CREATE TABLE IF NOT EXISTS chat_attachments (
      attachment_id SERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      size_bytes INT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments(message_id);
    CREATE TABLE IF NOT EXISTS chat_reactions (
      message_id BIGINT NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      emoji VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS chat_mentions (
      message_id BIGINT NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      PRIMARY KEY (message_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_mentions_user ON chat_mentions(user_id);
  `);
  // Files moved to Google Drive: a Drive row keeps the file id and no bytes. Older rows
  // (and uploads made while Drive is not connected) keep their bytes in data.
  await p.query(`
    ALTER TABLE chat_attachments ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
    ALTER TABLE chat_attachments ALTER COLUMN data DROP NOT NULL;
  `);
  // Delivery ticks: the newest message that reached each member's device (their app
  // received it live, or they came online afterwards). Read implies delivered.
  await p.query(`
    ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS last_delivered_message_id BIGINT NOT NULL DEFAULT 0;
  `);
}

/**
 * Put each file in Drive before the message is written, so a slow upload never holds
 * a database transaction open. Returns one { driveId } per file; driveId is null when
 * Drive is not connected or the upload failed, and that file is kept in the database
 * instead, so sending never fails because of Drive.
 */
async function storeFilesInDrive(files, conversationId) {
  if (!files.length || !isDriveConfigured()) return files.map(() => ({ driveId: null }));
  const out = [];
  for (const f of files) {
    try {
      const driveId = await uploadChatFile({
        buffer: f.buffer,
        mime: f.mimetype,
        originalName: f.originalname,
        conversationId,
      });
      out.push({ driveId });
    } catch (err) {
      console.warn('chat: Drive upload failed, keeping the file in the database:', err?.message || err);
      out.push({ driveId: null });
    }
  }
  return out;
}

/** Move a message's Drive files to the Drive trash. Best effort; never blocks a delete. */
function trashDriveFiles(ids) {
  for (const id of ids) {
    trashContentFile(id).catch((err) => console.warn('chat: could not trash Drive file', id, err?.message || err));
  }
}

// ── Membership ──────────────────────────────────────────────────────────────

async function membership(p, conversationId, userId) {
  const { rows } = await p.query(
    `SELECT m.role, c.kind FROM chat_members m
       JOIN chat_conversations c ON c.conversation_id = m.conversation_id
      WHERE m.conversation_id = $1 AND m.user_id = $2`,
    [conversationId, userId]
  );
  return rows[0] || null;
}

async function requireMember(p, conversationId, userId) {
  const m = await membership(p, conversationId, userId);
  if (!m) throw new ChatError(404, 'Conversation not found.');
  return m;
}

/** User ids in a conversation (for sending live updates). */
export async function chatMemberIds(conversationId) {
  const { rows } = await pool().query('SELECT user_id FROM chat_members WHERE conversation_id = $1', [conversationId]);
  return rows.map((r) => r.user_id);
}

/** True when the user belongs to the conversation (used by the typing indicator). */
export async function chatIsMember(conversationId, userId) {
  const cid = toInt(conversationId);
  const uid = toInt(userId);
  if (cid == null || uid == null) return false;
  return Boolean(await membership(pool(), cid, uid));
}

// ── People ──────────────────────────────────────────────────────────────────

/** Active users anyone may start a chat with or mention. */
export async function chatDirectory() {
  const { rows } = await pool().query(
    `SELECT user_id, username, email, profile_image FROM users
      WHERE COALESCE(is_active, true) = true ORDER BY LOWER(username)`
  );
  return rows.map((u) => ({
    id: u.user_id,
    username: u.username,
    email: u.email,
    avatar: avatarUrlFor(u.user_id, u.profile_image),
  }));
}

// ── Conversations ──────────────────────────────────────────────────────────

async function membersOf(p, conversationIds) {
  if (!conversationIds.length) return new Map();
  const { rows } = await p.query(
    `SELECT m.conversation_id, m.user_id, m.role, m.last_read_message_id,
            GREATEST(m.last_delivered_message_id, m.last_read_message_id) AS last_delivered_message_id,
            u.username, u.profile_image
       FROM chat_members m JOIN users u ON u.user_id = m.user_id
      WHERE m.conversation_id = ANY($1) ORDER BY LOWER(u.username)`,
    [conversationIds]
  );
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.conversation_id)) map.set(r.conversation_id, []);
    map.get(r.conversation_id).push({
      id: r.user_id,
      username: r.username,
      avatar: avatarUrlFor(r.user_id, r.profile_image),
      role: r.role,
      last_read_message_id: Number(r.last_read_message_id || 0),
      last_delivered_message_id: Number(r.last_delivered_message_id || 0),
    });
  });
  return map;
}

/** The user's conversations, most recent first, with unread and @mention counts. */
export async function chatListConversations(userId) {
  const p = pool();
  const { rows } = await p.query(
    `SELECT c.conversation_id, c.kind, c.name, c.created_by, c.created_at, c.last_message_at,
            m.role, m.last_read_message_id,
            (SELECT COUNT(*) FROM chat_messages x
              WHERE x.conversation_id = c.conversation_id AND x.message_id > m.last_read_message_id
                AND x.deleted_at IS NULL AND x.sender_id IS DISTINCT FROM m.user_id)::int AS unread,
            (SELECT COUNT(*) FROM chat_mentions mm JOIN chat_messages x ON x.message_id = mm.message_id
              WHERE mm.user_id = m.user_id AND x.conversation_id = c.conversation_id
                AND x.message_id > m.last_read_message_id AND x.deleted_at IS NULL)::int AS mentions,
            lm.message_id AS last_id, lm.body AS last_body, lm.sender_id AS last_sender_id,
            lm.deleted_at AS last_deleted_at, lm.created_at AS last_created_at,
            (SELECT COUNT(*) FROM chat_attachments a WHERE a.message_id = lm.message_id)::int AS last_files
       FROM chat_members m
       JOIN chat_conversations c ON c.conversation_id = m.conversation_id
       LEFT JOIN LATERAL (
         SELECT message_id, body, sender_id, deleted_at, created_at FROM chat_messages
          WHERE conversation_id = c.conversation_id ORDER BY message_id DESC LIMIT 1
       ) lm ON true
      WHERE m.user_id = $1
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    [userId]
  );
  const members = await membersOf(p, rows.map((r) => r.conversation_id));
  return rows.map((r) => ({
    id: r.conversation_id,
    kind: r.kind,
    name: r.name,
    created_by: r.created_by,
    created_at: r.created_at,
    my_role: r.role,
    last_read_message_id: Number(r.last_read_message_id || 0),
    unread: r.unread,
    mentions: r.mentions,
    members: members.get(r.conversation_id) || [],
    last_message: r.last_id
      ? {
          id: Number(r.last_id),
          sender_id: r.last_sender_id,
          body: r.last_deleted_at ? null : r.last_body,
          deleted: Boolean(r.last_deleted_at),
          files: r.last_files,
          created_at: r.last_created_at,
        }
      : null,
  }));
}

async function conversationFor(p, conversationId, userId) {
  const list = await chatListConversations(userId);
  return list.find((c) => c.id === conversationId) || null;
}

/** Open (or create) the DM between two users. */
export async function chatOpenDirect(userId, otherUserId) {
  const p = pool();
  const other = toInt(otherUserId);
  if (other == null || other === userId) throw new ChatError(400, 'Pick someone else to chat with.');
  const { rows: ok } = await p.query(
    'SELECT 1 FROM users WHERE user_id = $1 AND COALESCE(is_active, true) = true',
    [other]
  );
  if (!ok.length) throw new ChatError(404, 'That user is not available.');

  const key = `${Math.min(userId, other)}:${Math.max(userId, other)}`;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO chat_conversations (kind, direct_key, created_by) VALUES ('direct', $1, $2)
       ON CONFLICT (direct_key) DO NOTHING RETURNING conversation_id`,
      [key, userId]
    );
    let id = ins.rows[0]?.conversation_id;
    if (id) {
      await client.query(
        `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
        [id, userId, other]
      );
    } else {
      id = (await client.query('SELECT conversation_id FROM chat_conversations WHERE direct_key = $1', [key])).rows[0]
        .conversation_id;
    }
    await client.query('COMMIT');
    return { conversation: await conversationFor(p, id, userId), created: Boolean(ins.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const cleanName = (name) => {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) throw new ChatError(400, 'Give the group a name.');
  if (n.length > CHAT_LIMITS.groupNameMax) throw new ChatError(400, `Keep the group name under ${CHAT_LIMITS.groupNameMax} characters.`);
  return n;
};

async function activeUserIds(p, ids) {
  const want = [...new Set((ids || []).map(toInt).filter((n) => n != null))];
  if (!want.length) return [];
  const { rows } = await p.query(
    'SELECT user_id FROM users WHERE user_id = ANY($1) AND COALESCE(is_active, true) = true',
    [want]
  );
  return rows.map((r) => r.user_id);
}

/** Create a group. The route allows this for Seyal admins only. */
export async function chatCreateGroup(userId, { name, member_ids }) {
  const p = pool();
  const groupName = cleanName(name);
  const others = (await activeUserIds(p, member_ids)).filter((id) => id !== userId);
  if (!others.length) throw new ChatError(400, 'Add at least one member.');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const id = (
      await client.query(
        `INSERT INTO chat_conversations (kind, name, created_by) VALUES ('group', $1, $2) RETURNING conversation_id`,
        [groupName, userId]
      )
    ).rows[0].conversation_id;
    await client.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'admin')`, [id, userId]);
    await client.query(
      `INSERT INTO chat_members (conversation_id, user_id) SELECT $1, unnest($2::int[])`,
      [id, others]
    );
    await client.query('COMMIT');
    return conversationFor(p, id, userId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Group admins manage their group; Seyal admins may manage any group.
async function requireGroupManager(p, conversationId, userId, isSiteAdmin) {
  const m = await membership(p, conversationId, userId);
  const { rows } = await p.query('SELECT kind FROM chat_conversations WHERE conversation_id = $1', [conversationId]);
  if (!rows[0] || (!m && !isSiteAdmin)) throw new ChatError(404, 'Conversation not found.');
  if (rows[0].kind !== 'group') throw new ChatError(400, 'Only groups can be changed.');
  if (!isSiteAdmin && m?.role !== 'admin') throw new ChatError(403, 'Only a group admin can do that.');
}

export async function chatRenameGroup(userId, conversationId, name, isSiteAdmin) {
  const p = pool();
  const cid = toInt(conversationId);
  await requireGroupManager(p, cid, userId, isSiteAdmin);
  await p.query('UPDATE chat_conversations SET name = $1 WHERE conversation_id = $2', [cleanName(name), cid]);
  return cid;
}

export async function chatAddMembers(userId, conversationId, memberIds, isSiteAdmin) {
  const p = pool();
  const cid = toInt(conversationId);
  await requireGroupManager(p, cid, userId, isSiteAdmin);
  const ids = await activeUserIds(p, memberIds);
  if (!ids.length) throw new ChatError(400, 'Pick at least one active user.');
  await p.query(
    `INSERT INTO chat_members (conversation_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
    [cid, ids]
  );
  return { conversationId: cid, added: ids };
}

/** Remove someone (group admin / Seyal admin), or leave (anyone removing themselves). */
export async function chatRemoveMember(userId, conversationId, memberId, isSiteAdmin) {
  const p = pool();
  const cid = toInt(conversationId);
  const target = toInt(memberId);
  if (target !== userId) await requireGroupManager(p, cid, userId, isSiteAdmin);
  else {
    const m = await requireMember(p, cid, userId);
    if (m.kind !== 'group') throw new ChatError(400, 'You cannot leave a direct chat.');
  }
  await p.query('DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2', [cid, target]);
  // A group left without an admin hands the role to its longest-standing member.
  await p.query(
    `UPDATE chat_members SET role = 'admin'
      WHERE conversation_id = $1 AND NOT EXISTS (SELECT 1 FROM chat_members WHERE conversation_id = $1 AND role = 'admin')
        AND user_id = (SELECT user_id FROM chat_members WHERE conversation_id = $1 ORDER BY joined_at LIMIT 1)`,
    [cid]
  );
  return { conversationId: cid, removed: target };
}

/** Make a member a group admin or a regular member again. */
export async function chatSetRole(userId, conversationId, memberId, role, isSiteAdmin) {
  const p = pool();
  const cid = toInt(conversationId);
  await requireGroupManager(p, cid, userId, isSiteAdmin);
  if (!['admin', 'member'].includes(role)) throw new ChatError(400, 'Unknown role.');
  await p.query('UPDATE chat_members SET role = $1 WHERE conversation_id = $2 AND user_id = $3', [role, cid, toInt(memberId)]);
  return cid;
}

// ── Messages ────────────────────────────────────────────────────────────────

async function hydrate(p, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.message_id);
  const [files, reactions, mentions] = await Promise.all([
    p.query(
      `SELECT attachment_id, message_id, file_name, mime_type, size_bytes FROM chat_attachments
        WHERE message_id = ANY($1) ORDER BY attachment_id`,
      [ids]
    ),
    p.query(`SELECT message_id, emoji, user_id FROM chat_reactions WHERE message_id = ANY($1) ORDER BY created_at`, [ids]),
    p.query('SELECT message_id, user_id FROM chat_mentions WHERE message_id = ANY($1)', [ids]),
  ]);
  const by = (list, key = 'message_id') => {
    const m = new Map();
    list.forEach((r) => {
      const k = String(r[key]);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return m;
  };
  const fileMap = by(files.rows);
  const reactMap = by(reactions.rows);
  const mentionMap = by(mentions.rows);

  return rows.map((r) => {
    const id = String(r.message_id);
    const deleted = Boolean(r.deleted_at);
    const grouped = new Map();
    (reactMap.get(id) || []).forEach((x) => {
      if (!grouped.has(x.emoji)) grouped.set(x.emoji, []);
      grouped.get(x.emoji).push(x.user_id);
    });
    return {
      id: Number(r.message_id),
      conversation_id: r.conversation_id,
      sender_id: r.sender_id,
      sender_name: r.sender_name || 'Former user',
      sender_avatar: r.sender_id ? avatarUrlFor(r.sender_id, r.sender_image) : null,
      body: deleted ? null : r.body,
      deleted,
      created_at: r.created_at,
      edited_at: r.edited_at,
      reply_to: r.reply_to_id
        ? {
            id: Number(r.reply_to_id),
            sender_name: r.reply_sender_name || 'Former user',
            body: r.reply_deleted_at ? null : (r.reply_body || '').slice(0, 160),
            deleted: Boolean(r.reply_deleted_at),
          }
        : null,
      attachments: deleted
        ? []
        : (fileMap.get(id) || []).map((f) => ({
            id: f.attachment_id,
            file_name: f.file_name,
            mime_type: f.mime_type,
            size: f.size_bytes,
            inline: INLINE_IMAGE_TYPES.includes(f.mime_type),
            media: mediaKind(f.mime_type),
          })),
      reactions: deleted ? [] : [...grouped.entries()].map(([emoji, user_ids]) => ({ emoji, user_ids })),
      mentions: (mentionMap.get(id) || []).map((x) => x.user_id),
    };
  });
}

const MESSAGE_SELECT = `
  SELECT msg.*, u.username AS sender_name, u.profile_image AS sender_image,
         rm.body AS reply_body, rm.deleted_at AS reply_deleted_at, ru.username AS reply_sender_name
    FROM chat_messages msg
    LEFT JOIN users u ON u.user_id = msg.sender_id
    LEFT JOIN chat_messages rm ON rm.message_id = msg.reply_to_id
    LEFT JOIN users ru ON ru.user_id = rm.sender_id`;

/** A page of messages, oldest first; `before` (a message id) pages further back. */
export async function chatListMessages(userId, conversationId, { before } = {}) {
  const p = pool();
  const cid = toInt(conversationId);
  await requireMember(p, cid, userId);
  const params = [cid, CHAT_LIMITS.pageSize + 1];
  let where = 'msg.conversation_id = $1';
  if (toInt(before) != null) {
    params.push(toInt(before));
    where += ` AND msg.message_id < $${params.length}`;
  }
  const { rows } = await p.query(`${MESSAGE_SELECT} WHERE ${where} ORDER BY msg.message_id DESC LIMIT $2`, params);
  const hasMore = rows.length > CHAT_LIMITS.pageSize;
  const page = rows.slice(0, CHAT_LIMITS.pageSize).reverse();
  return { messages: await hydrate(p, page), has_more: hasMore };
}

async function getMessage(p, messageId) {
  const { rows } = await p.query(`${MESSAGE_SELECT} WHERE msg.message_id = $1`, [messageId]);
  return (await hydrate(p, rows))[0] || null;
}

// Only people in the conversation can be mentioned.
async function validMentions(db, conversationId, ids) {
  const want = [...new Set((ids || []).map(toInt).filter((n) => n != null))];
  if (!want.length) return [];
  const { rows } = await db.query(
    'SELECT user_id FROM chat_members WHERE conversation_id = $1 AND user_id = ANY($2)',
    [conversationId, want]
  );
  return rows.map((r) => r.user_id);
}

/**
 * Post a message. `files` are { originalname, mimetype, size, buffer } (multer).
 * Text, at least one file, or both.
 */
export async function chatSendMessage(userId, conversationId, { body, reply_to_id, mention_ids, files = [] }) {
  const p = pool();
  const cid = toInt(conversationId);
  await requireMember(p, cid, userId);
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (!text && !files.length) throw new ChatError(400, 'Write a message or attach a file.');
  if (text.length > CHAT_LIMITS.bodyMax) throw new ChatError(400, `Keep messages under ${CHAT_LIMITS.bodyMax} characters.`);
  if (files.length > CHAT_LIMITS.attachmentsPerMessage) {
    throw new ChatError(400, `Attach at most ${CHAT_LIMITS.attachmentsPerMessage} files at a time.`);
  }
  if (files.some((f) => f.size > CHAT_LIMITS.attachmentBytes)) throw new ChatError(400, 'Each file must be 10 MB or smaller.');

  let replyTo = toInt(reply_to_id);
  if (replyTo != null) {
    const { rows } = await p.query('SELECT 1 FROM chat_messages WHERE message_id = $1 AND conversation_id = $2', [replyTo, cid]);
    if (!rows.length) replyTo = null;
  }

  const stored = await storeFilesInDrive(files, cid);
  const client = await p.connect();
  let messageId;
  try {
    await client.query('BEGIN');
    messageId = (
      await client.query(
        `INSERT INTO chat_messages (conversation_id, sender_id, body, reply_to_id) VALUES ($1, $2, $3, $4) RETURNING message_id`,
        [cid, userId, text || null, replyTo]
      )
    ).rows[0].message_id;
    for (const [index, f] of files.entries()) {
      const { driveId } = stored[index];
      await client.query(
        `INSERT INTO chat_attachments (message_id, file_name, mime_type, size_bytes, data, drive_file_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          messageId,
          String(f.originalname || 'file').slice(0, 255),
          String(f.mimetype || 'application/octet-stream').slice(0, 120),
          f.size,
          driveId ? null : f.buffer,
          driveId,
        ]
      );
    }
    const mentioned = (await validMentions(client, cid, mention_ids)).filter((id) => id !== userId);
    if (mentioned.length) {
      await client.query(
        'INSERT INTO chat_mentions (message_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
        [messageId, mentioned]
      );
    }
    await client.query('UPDATE chat_conversations SET last_message_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [cid]);
    // Sending a message means the sender has read everything up to it.
    await client.query(
      'UPDATE chat_members SET last_read_message_id = GREATEST(last_read_message_id, $1) WHERE conversation_id = $2 AND user_id = $3',
      [messageId, cid, userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // The message was not saved, so its Drive copies must not linger.
    trashDriveFiles(stored.map((x) => x.driveId).filter(Boolean));
    throw err;
  } finally {
    client.release();
  }
  return getMessage(p, messageId);
}

async function ownMessage(p, messageId, userId, { allowSiteAdmin = false, isSiteAdmin = false } = {}) {
  const mid = toInt(messageId);
  const { rows } = await p.query('SELECT conversation_id, sender_id, deleted_at FROM chat_messages WHERE message_id = $1', [mid]);
  const m = rows[0];
  if (!m) throw new ChatError(404, 'Message not found.');
  await requireMember(p, m.conversation_id, userId).catch((err) => {
    if (!(allowSiteAdmin && isSiteAdmin)) throw err;
  });
  if (m.deleted_at) throw new ChatError(400, 'That message was deleted.');
  if (m.sender_id !== userId && !(allowSiteAdmin && isSiteAdmin)) {
    throw new ChatError(403, 'You can only change your own messages.');
  }
  return { mid, conversationId: m.conversation_id };
}

export async function chatEditMessage(userId, messageId, { body, mention_ids }) {
  const p = pool();
  const { mid, conversationId } = await ownMessage(p, messageId, userId);
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length > CHAT_LIMITS.bodyMax) throw new ChatError(400, `Keep messages under ${CHAT_LIMITS.bodyMax} characters.`);
  const { rows: files } = await p.query('SELECT 1 FROM chat_attachments WHERE message_id = $1 LIMIT 1', [mid]);
  if (!text && !files.length) throw new ChatError(400, 'A message cannot be empty; delete it instead.');
  await p.query('UPDATE chat_messages SET body = $1, edited_at = CURRENT_TIMESTAMP WHERE message_id = $2', [text || null, mid]);
  await p.query('DELETE FROM chat_mentions WHERE message_id = $1', [mid]);
  const mentioned = (await validMentions(p, conversationId, mention_ids)).filter((id) => id !== userId);
  if (mentioned.length) {
    await p.query('INSERT INTO chat_mentions (message_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING', [
      mid,
      mentioned,
    ]);
  }
  return getMessage(p, mid);
}

/** Soft delete: the bubble stays as "message deleted"; text, files and reactions go. */
export async function chatDeleteMessage(userId, messageId, isSiteAdmin) {
  const p = pool();
  const { mid } = await ownMessage(p, messageId, userId, { allowSiteAdmin: true, isSiteAdmin });
  await p.query('UPDATE chat_messages SET body = NULL, deleted_at = CURRENT_TIMESTAMP WHERE message_id = $1', [mid]);
  const { rows: gone } = await p.query(
    'DELETE FROM chat_attachments WHERE message_id = $1 RETURNING drive_file_id',
    [mid]
  );
  trashDriveFiles(gone.map((r) => r.drive_file_id).filter(Boolean));
  await p.query('DELETE FROM chat_reactions WHERE message_id = $1', [mid]);
  await p.query('DELETE FROM chat_mentions WHERE message_id = $1', [mid]);
  return getMessage(p, mid);
}

/** Add the reaction, or remove it if the user already reacted with that emoji. */
export async function chatToggleReaction(userId, messageId, emoji) {
  const p = pool();
  if (!CHAT_REACTIONS.includes(emoji)) throw new ChatError(400, 'Unsupported reaction.');
  const mid = toInt(messageId);
  const { rows } = await p.query('SELECT conversation_id, deleted_at FROM chat_messages WHERE message_id = $1', [mid]);
  if (!rows[0]) throw new ChatError(404, 'Message not found.');
  await requireMember(p, rows[0].conversation_id, userId);
  if (rows[0].deleted_at) throw new ChatError(400, 'That message was deleted.');
  const del = await p.query('DELETE FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [mid, userId, emoji]);
  if (!del.rowCount) {
    await p.query('INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      mid,
      userId,
      emoji,
    ]);
  }
  return getMessage(p, mid);
}

/** Record that the user has read up to messageId. Returns the stored position. */
export async function chatMarkRead(userId, conversationId, messageId) {
  const p = pool();
  const cid = toInt(conversationId);
  await requireMember(p, cid, userId);
  const { rows } = await p.query(
    `UPDATE chat_members SET last_read_message_id = GREATEST(last_read_message_id,
        LEAST($1::bigint, COALESCE((SELECT MAX(message_id) FROM chat_messages WHERE conversation_id = $2), 0)))
      WHERE conversation_id = $2 AND user_id = $3 RETURNING last_read_message_id`,
    [toInt(messageId) ?? 0, cid, userId]
  );
  return Number(rows[0]?.last_read_message_id || 0);
}

/**
 * Record that messages up to messageId reached the user's device. Returns the stored
 * position when it moved forward, or null when nothing changed (no update to send).
 */
export async function chatMarkDelivered(userId, conversationId, messageId) {
  const p = pool();
  const cid = toInt(conversationId);
  const { rows } = await p.query(
    `UPDATE chat_members SET last_delivered_message_id = LEAST($1::bigint,
        COALESCE((SELECT MAX(message_id) FROM chat_messages WHERE conversation_id = $2), 0))
      WHERE conversation_id = $2 AND user_id = $3
        AND last_delivered_message_id < LEAST($1::bigint,
          COALESCE((SELECT MAX(message_id) FROM chat_messages WHERE conversation_id = $2), 0))
      RETURNING last_delivered_message_id`,
    [toInt(messageId) ?? 0, cid, userId]
  );
  return rows[0] ? Number(rows[0].last_delivered_message_id) : null;
}

/**
 * When the user comes online, everything sent to them so far has been delivered.
 * Returns [{ conversation_id, message_id }] for the conversations whose position moved.
 */
export async function chatMarkAllDelivered(userId) {
  const p = pool();
  const { rows } = await p.query(
    `UPDATE chat_members m SET last_delivered_message_id = x.max_id
       FROM (SELECT conversation_id, MAX(message_id) AS max_id FROM chat_messages GROUP BY conversation_id) x
      WHERE m.user_id = $1 AND x.conversation_id = m.conversation_id
        AND m.last_delivered_message_id < x.max_id
      RETURNING m.conversation_id, m.last_delivered_message_id`,
    [userId]
  );
  return rows.map((r) => ({ conversation_id: r.conversation_id, message_id: Number(r.last_delivered_message_id) }));
}

/** A file, for a member of its conversation. */
export async function chatGetAttachment(userId, attachmentId) {
  const p = pool();
  const { rows } = await p.query(
    `SELECT a.file_name, a.mime_type, a.size_bytes, a.data, a.drive_file_id, msg.conversation_id
       FROM chat_attachments a JOIN chat_messages msg ON msg.message_id = a.message_id
      WHERE a.attachment_id = $1`,
    [toInt(attachmentId)]
  );
  const f = rows[0];
  if (!f) throw new ChatError(404, 'File not found.');
  await requireMember(p, f.conversation_id, userId);
  return f;
}

/** Total unread messages and @mentions across all conversations (the header badge). */
export async function chatUnreadTotals(userId) {
  const list = await chatListConversations(userId);
  return list.reduce((t, c) => ({ unread: t.unread + c.unread, mentions: t.mentions + c.mentions }), { unread: 0, mentions: 0 });
}
