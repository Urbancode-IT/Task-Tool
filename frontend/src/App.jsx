import React, { useState, useEffect } from 'react';
import MainLayout from './components/MainLayout';
import EodLockScreen from './components/EodLockScreen';
import MasterLogin from './features/Master/MasterLogin';
import MasterConsole from './features/Master/MasterConsole';
import authApi from './api/authApi';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useBranding } from './branding/BrandingContext';
import './App.css';

const LoginPage = ({ onLogin }) => {
  // Logo and wordmark follow the published company profile.
  const branding = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await authApi.login({ email: email.trim(), password });
      onLogin(data.user);
    } catch (err) {
      setError(
        err?.response?.data?.message || 'Invalid credentials. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-grid-overlay" />
      <div className="auth-card">
        <div className="auth-logo-wrapper">
          <img src={branding.logo} alt={branding.company_name} className="auth-logo-img" />
          <span className="auth-logo-text">{branding.company_name}</span>
        </div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">{branding.tagline || 'Sign in to your workspace to continue'}</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Email or username</span>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              required
              autoComplete="username"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex="-1"
              >
                {showPassword ? <MdVisibilityOff size={20} /> : <MdVisibility size={20} />}
              </button>
            </div>
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        </form>
        <p className="auth-hint">
          Use your assigned username or email and password.<br />
          Only authorised team members can sign in.
        </p>
      </div>
    </div>
  );
};

// The master console lives at its own path. The app ships no router, so the path is
// read once at module scope — the two shells never coexist in one page load.
// Requires the host to serve index.html for /master (see README notes).
const IS_MASTER_PATH =
  typeof window !== 'undefined' &&
  ['/master', '/master/'].includes(window.location.pathname);

/**
 * Master console: its own login and its own shell. Kept separate from App so a
 * master session cannot fall through into the workspace layout, and so the two
 * login pages never share state.
 */
function MasterApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  // Restore an existing master session; an app-scoped cookie is ignored here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authApi.restoreSession();
        if (!cancelled) setUser(data?.user?.scope === 'master' ? data.user : null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:session-expired', onExpired);
    return () => window.removeEventListener('auth:session-expired', onExpired);
  }, []);

  const logout = () => {
    setUser(null);
    // A master session is never cached, so there is nothing else to clear.
  };

  if (checking) return <div className="master-boot" />;
  if (!user) return <MasterLogin onLogin={setUser} />;
  return <MasterConsole currentUser={user} onLogout={logout} />;
}

function App() {
  // Speed up first paint: if we already have a cached user from a previous session,
  // render immediately and verify the session in the background.
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    try {
      const cached = JSON.parse(raw);
      // A master session is never cached, but never trust it here either.
      return cached?.scope === 'master' ? null : cached;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authApi.restoreSession();
        if (!cancelled) {
          // Only an app-scoped session signs in here. A master cookie leaves this shell
          // logged out, so /master stays the only way into the console.
          if (data?.user && data.user.scope !== 'master') {
            setUser(data.user);
            localStorage.setItem('user', JSON.stringify(data.user));
          } else {
            setUser(null);
            localStorage.removeItem('user');
            localStorage.removeItem('username');
            localStorage.removeItem('profile_image');
          }
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          localStorage.removeItem('user');
          localStorage.removeItem('username');
          localStorage.removeItem('profile_image');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null);
    };
    window.addEventListener('auth:session-expired', onSessionExpired);
    return () => window.removeEventListener('auth:session-expired', onSessionExpired);
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  // sessionStorage, not localStorage: the choice belongs to this tab and should not
  // leak into a fresh window or outlive the browser session.
  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const locked = Boolean(user.eod_locked);

  return (
    <>
      <div className={locked ? 'app-locked-blur' : undefined} aria-hidden={locked || undefined}>
        <MainLayout currentUser={user} onLogout={handleLogout} />
      </div>
      {locked && <EodLockScreen lockDate={user.eod_lock_date} onLogout={handleLogout} />}
    </>
  );
}

export default function Root() {
  return IS_MASTER_PATH ? <MasterApp /> : <App />;
}
