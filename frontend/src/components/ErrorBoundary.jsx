import React from 'react';

/**
 * Catches render errors anywhere below it and shows the actual error instead of
 * a blank white page. Without this, a single thrown exception during render
 * unmounts the whole React tree, leaving an empty screen with no on-screen clue.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep the full detail in the console for debugging.
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  handleReload = () => {
    this.setState({ error: null, info: null });
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '40px 16px', fontFamily: "'Segoe UI', Arial, sans-serif", color: '#334155' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#b91c1c' }}>Something went wrong on this screen</h1>
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            The page hit an error while rendering. The details below help locate the cause.
          </p>
          <div style={{ fontSize: 13, fontFamily: 'Consolas, monospace', background: '#0f172a', color: '#f1f5f9', borderRadius: 8, padding: 14, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            <strong>{error.name}: {error.message}</strong>
            {error.stack ? '\n\n' + error.stack : ''}
            {info?.componentStack ? '\n\nComponent stack:' + info.componentStack : ''}
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            style={{ marginTop: 18, padding: '10px 22px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#4f46e5', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
