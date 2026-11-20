import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State { error: Error | null }

/** Last line of defence: a render error shows what broke and how to recover, instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Island Planner crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="status error" role="alert">
        <h2>Something went wrong</h2>
        <p data-testid="crash-message">{error.message || String(error)}</p>
        <p>
          This is usually caused by game data or state the app can’t read. Try reloading the page. If it keeps
          happening, use <strong>Data → Import JSON</strong> to load a good copy of your game data, or restore a file
          from <code>data/backups</code> (copy it over <code>data/gamedata.json</code> or <code>data/state.json</code>
          and restart the server).
        </p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>{' '}
        <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
