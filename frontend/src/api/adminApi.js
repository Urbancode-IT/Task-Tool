import apiClient from './client';

const ADMIN_PATH = '/api/admin';

const adminApi = {
  getPermissions: () => apiClient.get(`${ADMIN_PATH}/permissions`),
  getRoles: () => apiClient.get(`${ADMIN_PATH}/roles`),
  getRolePermissions: (roleId) => apiClient.get(`${ADMIN_PATH}/roles/${roleId}/permissions`),
  setRolePermissions: (roleId, permissionIds) =>
    apiClient.put(`${ADMIN_PATH}/roles/${roleId}/permissions`, { permission_ids: permissionIds }),
  getDepartments: () => apiClient.get(`${ADMIN_PATH}/departments`),
  getPendingSummary: () => apiClient.get(`${ADMIN_PATH}/tasks/pending-summary`),
  getTasks: (params = {}) => apiClient.get(`${ADMIN_PATH}/tasks`, { params }),
  getUsers: () => apiClient.get(`${ADMIN_PATH}/users`),
  createUser: (body) => apiClient.post(`${ADMIN_PATH}/users`, body),
  updateUser: (userId, body) => apiClient.put(`${ADMIN_PATH}/users/${userId}`, body),
  deleteUser: (userId) => apiClient.delete(`${ADMIN_PATH}/users/${userId}`),
  setUserRoles: (userId, roleIds) =>
    apiClient.put(`${ADMIN_PATH}/users/${userId}/roles`, { role_ids: roleIds }),
  getAuditLog: (params = {}) => apiClient.get(`${ADMIN_PATH}/audit-log`, { params }),
  createAuditEntry: (data) => apiClient.post(`${ADMIN_PATH}/audit-log`, data),
};

export default adminApi;
