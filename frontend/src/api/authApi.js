import apiClient from './client';

const authApi = {
  login: (credentials) => apiClient.post('/auth/login', credentials),
  /** Single session check; backend refreshes access token when needed (no extra client round-trip). */
  me: () => apiClient.get('/auth/me', { skipAuthRefresh: true }),
  restoreSession: () => apiClient.get('/auth/me', { skipAuthRefresh: true }),
};

export default authApi;
