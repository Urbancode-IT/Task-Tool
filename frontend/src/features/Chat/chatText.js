/**
 * Plain-text helpers for chat messages. Messages are stored as plain text; mentions are
 * written "@username" and links are bare URLs. Nothing here produces HTML.
 */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "@name" counts as a mention when followed by the end, whitespace or punctuation.
const mentionRe = (name) => new RegExp(`@${escapeRe(name)}(?=$|[\\s.,!?;:)\\]])`, 'i');

/** Ids of the members whose "@username" appears in the text. */
export function findMentions(text, members = []) {
  const t = String(text || '');
  if (!t.includes('@')) return [];
  return members.filter((m) => m.username && mentionRe(m.username).test(t)).map((m) => m.id);
}

/**
 * Split text into segments for rendering: { type: 'text' | 'mention' | 'link', value, userId? }.
 * Longer usernames are tried first so "@Ann Marie" wins over "@Ann".
 */
export function tokenize(text, members = []) {
  const src = String(text || '');
  const names = members
    .filter((m) => m.username)
    .sort((a, b) => b.username.length - a.username.length);
  const parts = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) parts.push({ type: 'text', value: buf });
    buf = '';
  };
  while (i < src.length) {
    const rest = src.slice(i);
    if (src[i] === '@') {
      const hit = names.find((m) => {
        const re = new RegExp(`^@${escapeRe(m.username)}(?=$|[\\s.,!?;:)\\]])`, 'i');
        return re.test(rest);
      });
      if (hit) {
        flush();
        parts.push({ type: 'mention', value: `@${hit.username}`, userId: hit.id });
        i += hit.username.length + 1;
        continue;
      }
    }
    const link = /^https?:\/\/[^\s<>"]+/i.exec(rest);
    if (link && (i === 0 || /\s|\(/.test(src[i - 1]))) {
      flush();
      const url = link[0].replace(/[.,!?;:)]+$/, '');
      parts.push({ type: 'link', value: url });
      i += url.length;
      continue;
    }
    buf += src[i];
    i += 1;
  }
  flush();
  return parts;
}

/** The "@query" being typed just before the caret, or null. */
export function mentionQueryAt(text, caret) {
  const before = String(text || '').slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  return m ? { query: m[2], start: before.length - m[2].length - 1 } : null;
}

export const formatBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

/** One-line preview of a conversation's last message. */
export function lastMessagePreview(last, meId, members = []) {
  if (!last) return 'No messages yet';
  if (last.deleted) return 'Message deleted';
  const who = last.sender_id === meId ? 'You: ' : '';
  const sender = members.find((m) => m.id === last.sender_id);
  const prefix = who || (members.length > 2 && sender ? `${sender.username}: ` : '');
  if (last.body) return `${prefix}${last.body.replace(/\s+/g, ' ')}`;
  return `${prefix}${last.files > 1 ? `${last.files} files` : 'Sent a file'}`;
}
