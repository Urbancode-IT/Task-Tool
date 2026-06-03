import apiClient from './client';

const authApi = {
  login: (credentials) => apiClient.post('/auth/login', credentials),
  /** Single session check; backend refreshes access token when needed (no extra client round-trip). */
  me: () => apiClient.get('/auth/me', { skipAuthRefresh: true }),
  restoreSession: () => apiClient.get('/auth/me', { skipAuthRefresh: true }),
  /** Self-service: update the signed-in user's profile picture (data URL or null to clear). */
  updateAvatar: (image) => apiClient.put('/auth/me/avatar', { profile_image: image }),
};

export default authApi;
