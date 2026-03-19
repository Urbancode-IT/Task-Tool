import apiClient from './client';

const BASE_PATH = '/api/it-updates';

const itUpdatesApi = {
  getProjects: (status) => {
    const params = status ? { status } : {};
    return apiClient.get(`${BASE_PATH}/projects`, { params });
  },

  createProject: (projectData) => {
    return apiClient.post(`${BASE_PATH}/projects`, projectData);
  },

  updateProject: (projectId, projectData) => {
    return apiClient.put(`${BASE_PATH}/projects/${projectId}`, projectData);
  },

  deleteProject: (projectId) => {
    return apiClient.delete(`${BASE_PATH}/projects/${projectId}`);
  },

  getTasks: (filters = {}) => {
    return apiClient.get(`${BASE_PATH}/tasks`, { params: filters });
  },

  createTask: (taskData, params = {}) => {
    return apiClient.post(`${BASE_PATH}/tasks`, taskData, { params });
  },

  updateTask: (taskId, taskData, params = {}) => {
    return apiClient.put(`${BASE_PATH}/tasks/${taskId}`, taskData, { params });
  },

  deleteTask: (taskId, params = {}) => {
    return apiClient.delete(`${BASE_PATH}/tasks/${taskId}`, { params });
  },

  getTaskComments: (taskId) => {
    return apiClient.get(`${BASE_PATH}/tasks/${taskId}/comments`);
  },

  addTaskComment: (taskId, commentData) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/comments`, commentData);
  },

  getDashboardStats: () => {
    return apiClient.get(`${BASE_PATH}/dashboard/stats`);
  },

  getTeamOverview: (params = {}) => {
    return apiClient.get(`${BASE_PATH}/team-overview`, { params });
  },

  getUsers: () => {
    return apiClient.get(`${BASE_PATH}/users`);
  },

  createUser: (userData) => {
    return apiClient.post(`${BASE_PATH}/users`, userData);
  },

  updateUser: (userId, userData) => {
    return apiClient.put(`${BASE_PATH}/users/${userId}`, userData);
  },

  deleteUser: (userId) => {
    return apiClient.delete(`${BASE_PATH}/users/${userId}`);
  },

  getEodReports: (params = {}) => {
    return apiClient.get(`${BASE_PATH}/eod-reports`, { params });
  },

  createEodReport: (data) => {
    return apiClient.post(`${BASE_PATH}/eod-reports`, data);
  },

  // ── Task Requirements (subtasks) ──
  getRequirements: (taskId, params = {}) => {
    return apiClient.get(`${BASE_PATH}/tasks/${taskId}/requirements`, { params });
  },

  createRequirement: (taskId, data, params = {}) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/requirements`, data, { params });
  },

  updateRequirement: (taskId, reqId, data, params = {}) => {
    return apiClient.put(`${BASE_PATH}/tasks/${taskId}/requirements/${reqId}`, data, { params });
  },

  deleteRequirement: (taskId, reqId, params = {}) => {
    return apiClient.delete(`${BASE_PATH}/tasks/${taskId}/requirements/${reqId}`, { params });
  },
};

export default itUpdatesApi;
