import { Component, type ReactNode } from 'react';

// Last line of defense around the whole app (see main.tsx). Without this,
// any uncaught error anywhere in the render tree unmounts everything down
// to a blank <div id="root">, which on an installed, chrome-less PWA looks
// exactly like "it flashes open and then closes." A class component on
// purpose (componentDidCatch has no hook equivalent) and deliberately not
// using i18n/hooks/Tailwind-dependent state here — this is the one screen
// that must still render something even if whatever crashed is a core
// subsystem (i18n init, routing, auth context, etc).
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[app] uncaught render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#1e293b',
          background: '#ffffff',
        }}
      >
        <p style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Something went wrong.</p>
        <p style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Une erreur est survenue.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px',
            borderRadius: '8px',
            background: '#0f2260',
            color: '#ffffff',
            fontWeight: 600,
            border: 'none',
          }}
        >
          Reload / Recharger
        </button>
      </div>
    );
  }
}
