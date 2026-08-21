import { Component, type ErrorInfo, type ReactNode } from 'react';
import { scheduleReload } from '../lib/crashRecovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Wraps the whole router so a render exception anywhere in ThemeRenderer/ZonePlayer (e.g. an
// unexpected shape in API-supplied theme data) no longer unmounts straight to a white screen
// with nothing watching it. The fallback is deliberately blank, not an error message — this is a
// public-facing display, not an admin surface — and self-heals via scheduleReload rather than
// waiting for a human.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    scheduleReload('render error', { error, componentStack: info.componentStack });
  }

  override render() {
    if (this.state.hasError) {
      return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;
    }
    return this.props.children;
  }
}
