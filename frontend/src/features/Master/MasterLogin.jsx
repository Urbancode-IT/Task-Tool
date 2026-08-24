import { useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import masterApi from '../../api/masterApi';
import { useBranding } from '../../branding/BrandingContext';

/**
 * Master console sign-in. Reached only at /master and posts to /auth/master-login,
 * which accepts nothing but accounts flagged users.is_master_admin.
 *
 * Uses the same `auth-*` markup and classes as the workspace login in App.jsx, so
 * both pages share one look and follow the published company branding. Only the
 * copy and the endpoint differ.
 */
export default function MasterLogin({ onLogin }) {
  const branding = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await masterApi.login({ email: email.trim(), password });
      onLogin(data.user);
    } catch (err) {
      setError(err?.response?.data?.message || 'Invalid master credentials.');
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
        <h1 className="auth-title">Master console</h1>
        <p className="auth-subtitle">Sign in to the system control console</p>
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
              autoFocus
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
                aria-label={showPassword ? 'Hide password' : 'Show password'}
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
          This page is for the system owner account only.<br />
          Every sign-in here is recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
