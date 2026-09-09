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
  getTaskDeleteLog: (params = {}) => apiClient.get(`${ADMIN_PATH}/task-delete-log`, { params }),
  createAuditEntry: (data) => apiClient.post(`${ADMIN_PATH}/audit-log`, data),
  getLockedUsers: () => apiClient.get(`${ADMIN_PATH}/locked-users`),
  unlockUserEod: (userId) => apiClient.post(`${ADMIN_PATH}/users/${userId}/eod-unlock`),

  // ── Company Profile & Branding ──
  getCompanyProfile: () => apiClient.get(`${ADMIN_PATH}/company`),
  saveCompanyDraft: (profile) => apiClient.post(`${ADMIN_PATH}/company/draft`, profile),
  publishCompanyProfile: (profile) => apiClient.put(`${ADMIN_PATH}/company`, profile),
  uploadCompanyAsset: (type, dataUrl) =>
    apiClient.post(`${ADMIN_PATH}/company/asset`, { type, dataUrl }),
  deleteCompanyAsset: (type) => apiClient.delete(`${ADMIN_PATH}/company/asset/${type}`),
  getCompanyActivity: () => apiClient.get(`${ADMIN_PATH}/company/activity`),

  // ── Invoices ──
  getInvoices: () => apiClient.get(`${ADMIN_PATH}/invoices`),
  getInvoice: (id) => apiClient.get(`${ADMIN_PATH}/invoices/${id}`),
  getNextInvoiceNumber: () => apiClient.get(`${ADMIN_PATH}/invoices/next-number`),
  createInvoice: (body) => apiClient.post(`${ADMIN_PATH}/invoices`, body),
  updateInvoice: (id, body) => apiClient.put(`${ADMIN_PATH}/invoices/${id}`, body),
  deleteInvoice: (id) => apiClient.delete(`${ADMIN_PATH}/invoices/${id}`),
};

export default adminApi;
