// Panel-scoped React error boundary.  The root-level boundary in main.tsx
// handles app-wide crashes with a full-screen fallback; this one keeps a
// single agent panel's crash from nuking the whole /agent route, which has
// three independent panels (sidebar / chat / computer).

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error(`[${this.props.label}] panel crash`, {
      msg: error.message,
      stack: error.stack,
      component: info.componentStack,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle size={28} className="text-amber-400" />
        <div className="text-sm font-semibold text-zinc-100">
          {this.props.label} crashed
        </div>
        <div className="max-w-sm text-xs text-zinc-400">{error.message}</div>
        <button
          type="button"
          onClick={this.reset}
          className="mt-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-white/[0.08] cursor-pointer"
        >
          Reload panel
        </button>
      </div>
    );
  }
}
