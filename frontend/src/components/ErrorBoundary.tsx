import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

/**
 * ErrorBoundary — catches render errors in its subtree and shows the message
 * in-place rather than blanking the whole page. Useful for isolating view
 * crashes during development.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary: ${this.props.label ?? "unknown"}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="error-boundary">
          <strong>{this.props.label ?? "View"} crashed</strong>
          <pre>{error.message}</pre>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
