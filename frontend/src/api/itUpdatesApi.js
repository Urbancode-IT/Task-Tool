import apiClient from './client';

const BASE_PATH = '/api/it-updates';

const withTeamParam = (data = {}, params = {}) => {
  const team = params?.team ?? data?.team;
  return team ? { ...params, team } : params;
};

const itUpdatesApi = {
  // type: 'internal' | 'external' (optional) to scope to a project sector.
  getProjects: (status, type) => {
    const params = {};
    if (status) params.status = status;
    if (type) params.type = type;
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

  // ── Project documents (Project Documentation / BRD / Credentials) ──
  listProjectDocuments: (projectId) =>
    apiClient.get(`${BASE_PATH}/projects/${projectId}/documents`),
  getProjectDocument: (projectId, docType) =>
    apiClient.get(`${BASE_PATH}/projects/${projectId}/documents/${docType}`),
  uploadProjectDocument: (projectId, docType, data) =>
    apiClient.put(`${BASE_PATH}/projects/${projectId}/documents/${docType}`, data),
  deleteProjectDocument: (projectId, docType) =>
    apiClient.delete(`${BASE_PATH}/projects/${projectId}/documents/${docType}`),

  // ── Project notes/comments (with @mention → email) ──
  getProjectComments: (projectId) =>
    apiClient.get(`${BASE_PATH}/projects/${projectId}/comments`),
  addProjectComment: (projectId, data) =>
    apiClient.post(`${BASE_PATH}/projects/${projectId}/comments`, data),
  updateProjectComment: (projectId, commentId, data) =>
    apiClient.put(`${BASE_PATH}/projects/${projectId}/comments/${commentId}`, data),
  deleteProjectComment: (projectId, commentId, userId) =>
    apiClient.delete(`${BASE_PATH}/projects/${projectId}/comments/${commentId}`, {
      params: { user_id: userId },
    }),
  likeProjectComment: (projectId, commentId, userId) =>
    apiClient.post(`${BASE_PATH}/projects/${projectId}/comments/${commentId}/like`, {
      user_id: userId,
    }),

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

  // Users holding the Director role (for director-to-director task assignment).
  getDirectors: () => {
    return apiClient.get(`${BASE_PATH}/directors`);
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
    // Cache-bust so an edited/deleted report is never served stale from a
    // browser/proxy cache when the EOD tab is re-opened.
    return apiClient.get(`${BASE_PATH}/eod-reports`, {
      params: { ...params, _ts: Date.now() },
      headers: { 'Cache-Control': 'no-cache' },
    });
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
