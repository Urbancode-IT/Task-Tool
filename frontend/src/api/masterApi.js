import apiClient from './client';

const MASTER_PATH = '/api/master';

const masterApi = {
  /** Separate from authApi.login: only master.access accounts are accepted here. */
  login: (credentials) => apiClient.post('/auth/master-login', credentials),

  getOverview: () => apiClient.get(`${MASTER_PATH}/overview`),
  getUsers: () => apiClient.get(`${MASTER_PATH}/users`),
  getRoles: () => apiClient.get(`${MASTER_PATH}/roles`),
  getPermissions: () => apiClient.get(`${MASTER_PATH}/permissions`),
  getEodLocks: () => apiClient.get(`${MASTER_PATH}/eod-locks`),
  unlockEod: (userId) => apiClient.post(`${MASTER_PATH}/eod-locks/${userId}/unlock`),
  getAudit: (params = {}) => apiClient.get(`${MASTER_PATH}/audit`, { params }),
};

export default masterApi;
