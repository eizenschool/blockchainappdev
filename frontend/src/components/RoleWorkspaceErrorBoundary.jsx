import { Component } from "react";

export default class RoleWorkspaceErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="panel workspace-error" role="alert">
        <p className="eyebrow">Workspace recovery</p>
        <h2>This workspace could not be displayed</h2>
        <p>Your wallet and blockchain data were not changed. Try the workspace again or reload the application.</p>
        <div>
          <button className="button button-primary" type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="button button-secondary" type="button" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </div>
      </section>
    );
  }
}
