import { createContext, useContext } from 'react';

/** Shared chat state; provided by ChatProvider inside MainLayout. */
export const ChatContext = createContext(null);

export const useChat = () => useContext(ChatContext);

/** Display name of a conversation for the given user: the group name, or the other person. */
export function conversationTitle(conv, meId) {
  if (!conv) return '';
  if (conv.kind === 'group') return conv.name || 'Group';
  const other = conv.members.find((m) => String(m.id) !== String(meId));
  return other?.username || 'Direct message';
}

/** The other person in a direct chat (null for groups). */
export function directPartner(conv, meId) {
  if (!conv || conv.kind !== 'direct') return null;
  return conv.members.find((m) => String(m.id) !== String(meId)) || null;
}
