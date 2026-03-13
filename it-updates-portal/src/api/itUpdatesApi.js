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

  createTask: (taskData) => {
    return apiClient.post(`${BASE_PATH}/tasks`, taskData);
  },

  updateTask: (taskId, taskData) => {
    return apiClient.put(`${BASE_PATH}/tasks/${taskId}`, taskData);
  },

  deleteTask: (taskId) => {
    return apiClient.delete(`${BASE_PATH}/tasks/${taskId}`);
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

  getTeamOverview: () => {
    return apiClient.get(`${BASE_PATH}/team-overview`);
  },

  getEodReports: (params = {}) => {
    return apiClient.get(`${BASE_PATH}/eod-reports`, { params });
  },

  createEodReport: (data) => {
    return apiClient.post(`${BASE_PATH}/eod-reports`, data);
  },

  // ── Task Requirements (subtasks) ──
  getRequirements: (taskId) => {
    return apiClient.get(`${BASE_PATH}/tasks/${taskId}/requirements`);
  },

  createRequirement: (taskId, data) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/requirements`, data);
  },

  updateRequirement: (taskId, reqId, data) => {
    return apiClient.put(`${BASE_PATH}/tasks/${taskId}/requirements/${reqId}`, data);
  },

  deleteRequirement: (taskId, reqId) => {
    return apiClient.delete(`${BASE_PATH}/tasks/${taskId}/requirements/${reqId}`);
  },
};

export default itUpdatesApi;
