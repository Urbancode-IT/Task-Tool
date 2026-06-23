import apiClient from './client';

const BASE_PATH = '/api/it-updates';

const withTeamParam = (data = {}, params = {}) => {
  const team = params?.team ?? data?.team;
  return team ? { ...params, team } : params;
};

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
    return apiClient.put(`${BASE_PATH}/tasks/${taskId}`, taskData, {
      params: withTeamParam(taskData, params),
    });
  },

  deleteTask: (taskId, params = {}) => {
    return apiClient.delete(`${BASE_PATH}/tasks/${taskId}`, { params });
  },

  getTaskComments: (taskId, params = {}) => {
    return apiClient.get(`${BASE_PATH}/tasks/${taskId}/comments`, { params });
  },

  addTaskComment: (taskId, commentData) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/comments`, commentData);
  },

  updateTaskComment: (taskId, commentId, commentData) => {
    return apiClient.put(`${BASE_PATH}/tasks/${taskId}/comments/${commentId}`, commentData);
  },

  deleteTaskComment: (taskId, commentId, userId) => {
    return apiClient.delete(`${BASE_PATH}/tasks/${taskId}/comments/${commentId}`, {
      params: { user_id: userId },
    });
  },

  likeTaskComment: (taskId, commentId, userId) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/comments/${commentId}/like`, {
      user_id: userId,
    });
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

  // EOD report itself: like / edit / delete
  likeEodReport: (reportId, userId) =>
    apiClient.post(`${BASE_PATH}/eod-reports/${reportId}/like`, { user_id: userId }),
  updateEodReport: (reportId, data) =>
    apiClient.put(`${BASE_PATH}/eod-reports/${reportId}`, data),
  deleteEodReport: (reportId, userId) =>
    apiClient.delete(`${BASE_PATH}/eod-reports/${reportId}`, { params: { user_id: userId } }),

  // ── EOD report comments (mention / comment / like / reply) ──
  getEodReportComments: (reportId) =>
    apiClient.get(`${BASE_PATH}/eod-reports/${reportId}/comments`),
  addEodReportComment: (reportId, data) =>
    apiClient.post(`${BASE_PATH}/eod-reports/${reportId}/comments`, data),
  updateEodReportComment: (reportId, commentId, data) =>
    apiClient.put(`${BASE_PATH}/eod-reports/${reportId}/comments/${commentId}`, data),
  deleteEodReportComment: (reportId, commentId, userId) =>
    apiClient.delete(`${BASE_PATH}/eod-reports/${reportId}/comments/${commentId}`, {
      params: { user_id: userId },
    }),
  likeEodReportComment: (reportId, commentId, userId) =>
    apiClient.post(`${BASE_PATH}/eod-reports/${reportId}/comments/${commentId}/like`, {
      user_id: userId,
    }),

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

  requirementTimer: (taskId, reqId, action, params = {}) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/requirements/${reqId}/timer`, {
      action,
      ...params,
    });
  },

  // Manually log a work session (From/To clock times) when the timer was not used.
  requirementManualTime: (taskId, reqId, data) => {
    return apiClient.post(`${BASE_PATH}/tasks/${taskId}/requirements/${reqId}/manual-time`, data);
  },

  // ── Member dashboard (worked hours, projects, leave) ──
  getMemberDashboard: (userId, params = {}) => {
    return apiClient.get(`${BASE_PATH}/members/${userId}/dashboard`, { params: { team: 'it', ...params } });
  },

  getLeaves: (params = {}) => {
    return apiClient.get(`${BASE_PATH}/leaves`, { params });
  },

  setLeave: (data) => {
    return apiClient.post(`${BASE_PATH}/leaves`, data);
  },

  clearLeave: (date, params = {}) => {
    return apiClient.delete(`${BASE_PATH}/leaves/${date}`, { params });
  },
};

export default itUpdatesApi;
