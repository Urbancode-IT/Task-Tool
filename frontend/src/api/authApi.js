import apiClient from './client';

const authApi = {
  login: (credentials) => apiClient.post('/auth/login', credentials),
};

export default authApi;
