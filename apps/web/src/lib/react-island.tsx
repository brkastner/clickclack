import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Shared mount contract for React components hosted inside the Svelte shell.
 *
 * Svelte owns routing, data, realtime, and persistence. An island owns one
 * rectangle of presentation and interaction, receives everything it needs as
 * props, and routes every mutation back out through callbacks. Islands do not
 * fetch, subscribe, or hold authority over anything the shell already owns.
 */
export type ReactIsland<P> = {
  render: (props: P) => void;
  unmount: () => void;
};

export type ReactIslandMount<P> = (element: HTMLElement, initialProps: P) => ReactIsland<P>;

export type ReactIslandDefinition<P> = {
  /** Used in the console message when the island throws. */
  name: string;
  component: (props: P) => ReactNode;
  /**
   * Rendered in place of the island after an unrecoverable render error.
   * Receives the same props, so it can keep affordances the shell depends on
   * reachable — an island that owns a panel must still offer its close control.
   */
  fallback: (props: P) => ReactNode;
};

type BoundaryProps<P> = {
  name: string;
  islandProps: P;
  fallback: (props: P) => ReactNode;
  children: ReactNode;
};

type BoundaryState = { failed: boolean };

class ReactIslandErrorBoundary<P> extends Component<BoundaryProps<P>, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} failed to render`, error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback(this.props.islandProps);
  }
}

/**
 * Builds a mount function for one island. The returned function is what a
 * Svelte host calls; it is deliberately the only export an island needs to
 * expose, so hosts never import React or touch a root directly.
 *
 * A failed island stays failed until it is unmounted. Re-rendering into a
 * boundary that has already caught would replay whatever broke, and the shell
 * has no way to know the underlying cause cleared.
 */
export function createReactIsland<P extends object>({
  name,
  component: Island,
  fallback,
}: ReactIslandDefinition<P>): ReactIslandMount<P> {
  return (element, initialProps) => {
    const root: Root = createRoot(element);
    const render = (props: P) =>
      root.render(
        <ReactIslandErrorBoundary name={name} islandProps={props} fallback={fallback}>
          <Island {...props} />
        </ReactIslandErrorBoundary>,
      );
    render(initialProps);
    return { render, unmount: () => root.unmount() };
  };
}
