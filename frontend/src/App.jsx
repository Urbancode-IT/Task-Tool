import React, { useState, useEffect } from 'react';
import MainLayout from './components/MainLayout';
import authApi from './api/authApi';
import logoSrc from './assets/logo.png';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import './App.css';

const LoginPage = ({ onLogin }) => {
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
          <img src={logoSrc} alt="IT Updates" className="auth-logo-img" />
          <span className="auth-logo-text">IT Updates</span>
        </div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to your workspace to continue</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Email or username</span>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. atchaya@itupdates.local"
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

function App() {
  // Speed up first paint: if we already have a cached user from a previous session,
  // render immediately and verify the session in the background.
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    if (!raw) return undefined; // no cache -> keep current "checking session" bootstrap
    try {
      return JSON.parse(raw);
    } catch {
      return null; // cache corrupted -> treat as logged out
    }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await authApi.me();
        if (!cancelled) {
          if (data?.user) {
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

  if (user === undefined) {
    return (
      <div className="auth-root auth-bootstrap" role="status" aria-live="polite">
        <div className="auth-grid-overlay" />
        <div className="auth-bootstrap-inner">
          <span className="auth-bootstrap-spinner" aria-hidden />
          <span className="auth-bootstrap-text">Checking your session…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <MainLayout currentUser={user} onLogout={handleLogout} />;
}

export default App;
