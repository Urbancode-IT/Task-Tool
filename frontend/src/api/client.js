import axios from 'axios';

export const API_BASE_URL =
  // Production (Render): set
  // import.meta.env.VITE_API_URL || 'https://task-tool-u70h.onrender.com'
  // import.meta.env.VITE_API_URL || 'http://localhost:3001';
  import.meta.env.VITE_API_URL || 'https://task-tool-u70h.onrender.com';

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

const NO_REFRESH_PATHS = ['/login', '/auth/master-login', '/auth/me'];

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;

    if (config?.skipAuthRefresh) return Promise.reject(error);
    // A 401 from any of these IS the answer, not an expired token — refreshing and
    // retrying only doubles the request. Listed explicitly because the old
    // `includes('/login')` test missed /auth/master-login: the character before
    // "login" there is a hyphen, not a slash.
    if (NO_REFRESH_PATHS.some((path) => config?.url?.includes(path))) {
      return Promise.reject(error);
    }

    if (response?.status === 401 && !config?._retry) {
      config._retry = true;
      try {
        await requestRefreshToken();
        return apiClient(config);
      } catch (refreshError) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('user');
          localStorage.removeItem('username');
          localStorage.removeItem('profile_image');
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
          // Send an expired master session back to its own login, not the workspace's.
          const home = window.location.pathname.startsWith('/master') ? '/master' : '/';
          if (window.location.pathname !== home) {
            window.location.href = home;
          }
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
