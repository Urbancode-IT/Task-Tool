/**
 * Chat HTTP routes and the live (Socket.IO) channel.
 *
 * Messages are always written through the REST routes; after each write the server
 * pushes the change to every member over their socket, so clients never need to poll.
 * Each signed-in user's sockets join the room `user:<id>`, and a change is sent to the
 * rooms of the conversation's members.
 *
 * Live events (server → browser):
 *   chat:message         { message }                       a new message
 *   chat:message:update  { message }                       edited, deleted or reacted to
 *   chat:read            { conversation_id, user_id, message_id }
 *   chat:typing          { conversation_id, user_id, username, typing }
 *   chat:conversation    { conversation_id }               created / renamed / members changed
 *   chat:removed         { conversation_id }               you were removed from a group
 * Browser → server: chat:typing { conversation_id, typing }.
 */
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { Server } from 'socket.io';
import { JWT_SECRET } from './middlewares/authMiddleware.js';
import * as db from './db/index.js';
import { openContentFile } from './driveContent.js';
import {
  ChatError,
  CHAT_LIMITS,
  CHAT_REACTIONS,
  mediaKind,
  chatAddMembers,
  chatCreateGroup,
  chatDeleteMessage,
  chatDirectory,
  chatEditMessage,
  chatGetAttachment,
  chatIsMember,
  chatListConversations,
  chatListMessages,
  chatMarkAllDelivered,
  chatMarkDelivered,
  chatMarkRead,
  chatMemberIds,
  chatOpenDirect,
  chatRemoveMember,
  chatRenameGroup,
  chatSendMessage,
  chatSetRole,
  chatToggleReaction,
  chatUnreadTotals,
} from './db/chat.js';

let io = null;

const userId = (req) => {
  const n = parseInt(String(req.user?.id ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};
const isSiteAdmin = (req) => (req.user?.permissions || []).includes('admin.access');

function sendChatError(res, err, fallback) {
  if (err instanceof ChatError) return res.status(err.status).json({ message: err.message });
  console.error('chat:', err?.message || err);
  return res.status(500).json({ message: fallback });
}

// Wraps a handler: requires a signed-in user and turns ChatErrors into responses.
const handle = (fallback, fn) => async (req, res) => {
  const me = userId(req);
  if (me == null) return res.status(401).json({ message: 'Sign in to use chat.' });
  if (!db.useDb()) return res.status(503).json({ message: 'Chat needs the database.' });
  try {
    await fn(req, res, me);
  } catch (err) {
    sendChatError(res, err, fallback);
  }
};

async function emitToConversation(conversationId, event, payload) {
  if (!io) return;
  try {
    const ids = await chatMemberIds(conversationId);
    if (ids.length) io.to(ids.map((id) => `user:${id}`)).emit(event, payload);
  } catch (err) {
    console.warn('chat emit:', err.message);
  }
}

const emitToUsers = (ids, event, payload) => {
  if (io && ids.length) io.to(ids.map((id) => `user:${id}`)).emit(event, payload);
};

// Up to 5 files of 10 MB each, held in memory, then stored in Google Drive (or in the
// database when Drive is not connected).
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_LIMITS.attachmentBytes, files: CHAT_LIMITS.attachmentsPerMessage },
}).array('files', CHAT_LIMITS.attachmentsPerMessage);

function receiveChatFiles(req, res, next) {
  chatUpload(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Each file must be 10 MB or smaller.'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Attach at most ${CHAT_LIMITS.attachmentsPerMessage} files at a time.`
          : 'Could not read the attached files.';
    res.status(400).json({ message });
  });
}

const parseIds = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Mount the chat REST routes under `${basePath}/chat` (basePath already requires sign-in). */
export function registerChatRoutes(app, basePath) {
  const P = `${basePath}/chat`;

  app.get(`${P}/config`, (req, res) => res.json({ reactions: CHAT_REACTIONS, limits: CHAT_LIMITS, can_create_groups: isSiteAdmin(req) }));

  app.get(`${P}/users`, handle('Failed to load people', async (req, res) => res.json(await chatDirectory())));

  app.get(`${P}/conversations`, handle('Failed to load chats', async (req, res, me) => res.json(await chatListConversations(me))));

  app.get(`${P}/unread`, handle('Failed to load unread count', async (req, res, me) => res.json(await chatUnreadTotals(me))));

  app.post(
    `${P}/direct`,
    handle('Failed to open the chat', async (req, res, me) => {
      const { conversation, created } = await chatOpenDirect(me, req.body?.user_id);
      if (created) emitToConversation(conversation.id, 'chat:conversation', { conversation_id: conversation.id });
      res.json(conversation);
    })
  );

  // Groups are created by Seyal admins only; everyone else uses direct messages.
  app.post(
    `${P}/groups`,
    handle('Failed to create the group', async (req, res, me) => {
      if (!isSiteAdmin(req)) return res.status(403).json({ message: 'Only admins can create groups.' });
      const conversation = await chatCreateGroup(me, { name: req.body?.name, member_ids: req.body?.member_ids });
      emitToConversation(conversation.id, 'chat:conversation', { conversation_id: conversation.id });
      res.status(201).json(conversation);
    })
  );

  app.patch(
    `${P}/groups/:id`,
    handle('Failed to rename the group', async (req, res, me) => {
      const cid = await chatRenameGroup(me, req.params.id, req.body?.name, isSiteAdmin(req));
      emitToConversation(cid, 'chat:conversation', { conversation_id: cid });
      res.json({ ok: true });
    })
  );

  app.post(
    `${P}/groups/:id/members`,
    handle('Failed to add members', async (req, res, me) => {
      const { conversationId } = await chatAddMembers(me, req.params.id, req.body?.user_ids, isSiteAdmin(req));
      emitToConversation(conversationId, 'chat:conversation', { conversation_id: conversationId });
      res.json({ ok: true });
    })
  );

  app.patch(
    `${P}/groups/:id/members/:userId`,
    handle('Failed to change the role', async (req, res, me) => {
      const cid = await chatSetRole(me, req.params.id, req.params.userId, req.body?.role, isSiteAdmin(req));
      emitToConversation(cid, 'chat:conversation', { conversation_id: cid });
      res.json({ ok: true });
    })
  );

  app.delete(
    `${P}/groups/:id/members/:userId`,
    handle('Failed to remove the member', async (req, res, me) => {
      const { conversationId, removed } = await chatRemoveMember(me, req.params.id, req.params.userId, isSiteAdmin(req));
      emitToUsers([removed], 'chat:removed', { conversation_id: conversationId });
      emitToConversation(conversationId, 'chat:conversation', { conversation_id: conversationId });
      res.json({ ok: true });
    })
  );

  app.get(
    `${P}/conversations/:id/messages`,
    handle('Failed to load messages', async (req, res, me) =>
      res.json(await chatListMessages(me, req.params.id, { before: req.query?.before }))
    )
  );

  app.post(
    `${P}/conversations/:id/messages`,
    receiveChatFiles,
    handle('Failed to send the message', async (req, res, me) => {
      const message = await chatSendMessage(me, req.params.id, {
        body: req.body?.body,
        reply_to_id: req.body?.reply_to_id,
        mention_ids: parseIds(req.body?.mention_ids),
        files: req.files || [],
      });
      emitToConversation(message.conversation_id, 'chat:message', { message });
      res.status(201).json(message);
    })
  );

  app.patch(
    `${P}/messages/:id`,
    handle('Failed to edit the message', async (req, res, me) => {
      const message = await chatEditMessage(me, req.params.id, {
        body: req.body?.body,
        mention_ids: parseIds(req.body?.mention_ids),
      });
      emitToConversation(message.conversation_id, 'chat:message:update', { message });
      res.json(message);
    })
  );

  app.delete(
    `${P}/messages/:id`,
    handle('Failed to delete the message', async (req, res, me) => {
      const message = await chatDeleteMessage(me, req.params.id, isSiteAdmin(req));
      emitToConversation(message.conversation_id, 'chat:message:update', { message });
      res.json(message);
    })
  );

  app.post(
    `${P}/messages/:id/reactions`,
    handle('Failed to react', async (req, res, me) => {
      const message = await chatToggleReaction(me, req.params.id, req.body?.emoji);
      emitToConversation(message.conversation_id, 'chat:message:update', { message });
      res.json(message);
    })
  );

  app.post(
    `${P}/conversations/:id/read`,
    handle('Failed to mark as read', async (req, res, me) => {
      const cid = parseInt(String(req.params.id), 10);
      const messageId = await chatMarkRead(me, cid, req.body?.message_id);
      emitToConversation(cid, 'chat:read', { conversation_id: cid, user_id: me, message_id: messageId });
      res.json({ message_id: messageId });
    })
  );

  // Files are served only to members. Common image, video and audio types are shown
  // inline; any other type is forced to download, so an uploaded HTML/SVG file can
  // never run here.
  app.get(
    `${P}/attachments/:id`,
    handle('Failed to load the file', async (req, res, me) => {
      const f = await chatGetAttachment(me, req.params.id);
      const inline = mediaKind(f.mime_type) != null && req.query?.download !== '1';
      // Byte ranges let a video or audio file stored in the database be seeked.
      const range = !f.drive_file_id && f.data ? /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '')) : null;
      if (range && inline) {
        const total = f.data.length;
        const start = range[1] === '' ? Math.max(0, total - Number(range[2] || 0)) : Number(range[1]);
        const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), total - 1) : total - 1;
        if (start >= total || start > end) {
          res.setHeader('Content-Range', `bytes */${total}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Type', f.mime_type);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(end - start + 1));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.end(f.data.subarray(start, end + 1));
      }
      // Files in Drive are fetched by the server and streamed through, so the member
      // check above still decides who can see them; Drive never shares them itself.
      let drive = null;
      if (f.drive_file_id) {
        try {
          drive = await openContentFile(f.drive_file_id);
        } catch {
          return res.status(502).json({ message: 'Could not fetch the file from Google Drive.' });
        }
      }
      res.setHeader('Content-Type', inline ? f.mime_type : 'application/octet-stream');
      res.setHeader('Content-Length', String(drive ? f.size_bytes : f.data.length));
      if (!drive) res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`
      );
      if (!drive) return res.end(f.data);
      drive.stream.on('error', (err) => {
        console.warn('chat: Drive stream failed:', err?.message || err);
        res.destroy(err);
      });
      drive.stream.pipe(res);
    })
  );
}

function cookieValue(header, name) {
  const part = String(header || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

/**
 * Attach the live channel to the HTTP server. A socket is accepted only with a valid
 * session cookie (the same access_token the REST API uses).
 */
export function attachChatSocket(httpServer, allowedOrigins = []) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers?.cookie, 'access_token');
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, JWT_SECRET);
      const id = parseInt(String(payload?.id ?? ''), 10);
      if (!Number.isFinite(id)) return next(new Error('unauthorized'));
      socket.data.userId = id;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const me = socket.data.userId;
    socket.join(`user:${me}`);
    let myName = null;
    try {
      myName = (await db.dbGetUsersByIds([me]))[0]?.username || null;
    } catch {
      /* the name is only a nicety for "is typing" */
    }

    // Delivery ticks. Coming online delivers everything already sent to this user;
    // after that, the app confirms each message it receives live ("chat:delivered").
    const announceDelivered = (conversationId, messageId) =>
      emitToConversation(conversationId, 'chat:delivered', {
        conversation_id: conversationId,
        user_id: me,
        message_id: messageId,
      });
    if (db.useDb()) {
      chatMarkAllDelivered(me)
        .then((moved) => moved.forEach((d) => announceDelivered(d.conversation_id, d.message_id)))
        .catch(() => {
          /* ticks are best-effort */
        });
    }
    socket.on('chat:delivered', async (data) => {
      const cid = parseInt(String(data?.conversation_id ?? ''), 10);
      const mid = parseInt(String(data?.message_id ?? ''), 10);
      if (!Number.isFinite(cid) || !Number.isFinite(mid) || !db.useDb()) return;
      try {
        const stored = await chatMarkDelivered(me, cid, mid);
        if (stored != null) announceDelivered(cid, stored);
      } catch {
        /* ticks are best-effort */
      }
    });

    socket.on('chat:typing', async (data) => {
      const cid = parseInt(String(data?.conversation_id ?? ''), 10);
      if (!Number.isFinite(cid) || !db.useDb()) return;
      try {
        if (!(await chatIsMember(cid, me))) return;
        const ids = (await chatMemberIds(cid)).filter((id) => id !== me);
        emitToUsers(ids, 'chat:typing', {
          conversation_id: cid,
          user_id: me,
          username: myName,
          typing: Boolean(data?.typing),
        });
      } catch {
        /* typing is best-effort */
      }
    });
  });

  return io;
}
