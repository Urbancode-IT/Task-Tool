import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'https://status-tracking.onrender.com';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
);

let refreshPromise = null;

const requestRefreshToken = () => {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post('/auth/refresh', null, { skipAuthRefresh: true })
      .then((response) => {
        refreshPromise = null;
        return response.data;
      })
      .catch((error) => {
        refreshPromise = null;
        throw error;
      });
  }
  return refreshPromise;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;

    if (config?.skipAuthRefresh) return Promise.reject(error);
    if (config?.url?.includes('/login')) return Promise.reject(error);

    if (response?.status === 401 && !config?._retry) {
      config._retry = true;
      try {
        await requestRefreshToken();
        return apiClient(config);
      } catch (refreshError) {
        // This app renders the login screen at `/` (no `/login` route on Netlify).
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          localStorage.removeItem('user');
          localStorage.removeItem('username');
          localStorage.removeItem('profile_image');
          window.location.href = '/';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
