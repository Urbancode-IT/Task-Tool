import apiClient, { API_BASE_URL } from './client';

const P = '/api/it-updates/chat';

/** REST calls for chat. Live updates arrive over the socket (see features/Chat). */
const chatApi = {
  config: () => apiClient.get(`${P}/config`),
  users: () => apiClient.get(`${P}/users`),
  conversations: () => apiClient.get(`${P}/conversations`),
  unread: () => apiClient.get(`${P}/unread`),
  openDirect: (userId) => apiClient.post(`${P}/direct`, { user_id: userId }),
  createGroup: (name, memberIds) => apiClient.post(`${P}/groups`, { name, member_ids: memberIds }),
  renameGroup: (id, name) => apiClient.patch(`${P}/groups/${id}`, { name }),
  addMembers: (id, userIds) => apiClient.post(`${P}/groups/${id}/members`, { user_ids: userIds }),
  setRole: (id, userId, role) => apiClient.patch(`${P}/groups/${id}/members/${userId}`, { role }),
  removeMember: (id, userId) => apiClient.delete(`${P}/groups/${id}/members/${userId}`),
  messages: (id, before) => apiClient.get(`${P}/conversations/${id}/messages`, { params: before ? { before } : {} }),
  send: (id, { body, replyToId, mentionIds, files }) => {
    const form = new FormData();
    form.append('body', body || '');
    if (replyToId) form.append('reply_to_id', String(replyToId));
    form.append('mention_ids', JSON.stringify(mentionIds || []));
    (files || []).forEach((f) => form.append('files', f));
    return apiClient.post(`${P}/conversations/${id}/messages`, form);
  },
  edit: (messageId, body, mentionIds) => apiClient.patch(`${P}/messages/${messageId}`, { body, mention_ids: mentionIds }),
  remove: (messageId) => apiClient.delete(`${P}/messages/${messageId}`),
  react: (messageId, emoji) => apiClient.post(`${P}/messages/${messageId}/reactions`, { emoji }),
  markRead: (id, messageId) => apiClient.post(`${P}/conversations/${id}/read`, { message_id: messageId }),
};

/** URL of an attachment; `download` forces a download instead of showing it inline. */
export const attachmentUrl = (id, download = false) =>
  `${API_BASE_URL}${P}/attachments/${id}${download ? '?download=1' : ''}`;

export const SOCKET_URL = API_BASE_URL;

export default chatApi;
