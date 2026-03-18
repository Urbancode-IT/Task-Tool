import React, { useState } from 'react';
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
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <MainLayout currentUser={user} onLogout={handleLogout} />;
}

export default App;
