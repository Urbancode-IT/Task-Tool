import React from 'react';
import './Preloader.css';

/**
 * Full-cover loading overlay (blue/white theme): a spinner ring around the Seyal
 * mark. Renders absolutely inside the nearest positioned parent — give that
 * parent `position: relative`. Pass `fullscreen` to cover the whole viewport.
 */
export default function Preloader({ label = 'Loading…', fullscreen = false }) {
  return (
    <div className={`preloader-overlay${fullscreen ? ' preloader-fullscreen' : ''}`} role="status" aria-live="polite">
      <div className="preloader-ring">
        <img src="/logo-icon.png" alt="" className="preloader-logo" />
      </div>
      <span className="preloader-text">{label}</span>
    </div>
  );
}
