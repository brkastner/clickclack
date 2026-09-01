import React, {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ImageViewerItem } from "../../lib/uploads";

type ImageViewerProps = {
  items: ImageViewerItem[];
  initialIndex: number;
  onClose: () => void;
};

type ErrorBoundaryProps = {
  children: ReactNode;
  onClose: () => void;
};

type ErrorBoundaryState = {
  failed: boolean;
};

class ImageViewerErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Image viewer failed to render", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="modal-scrim image-viewer-scrim" role="presentation">
        <div className="image-viewer image-viewer--error" role="alertdialog" aria-modal="true">
          <header>
            <strong>Image unavailable</strong>
            <button type="button" aria-label="Close image viewer" onClick={this.props.onClose}>
              ×
            </button>
          </header>
        </div>
      </div>
    );
  }
}

function findFocusFallback(opener: HTMLElement | null): HTMLElement | null {
  const threadScope = opener?.closest(".thread");
  const timelineScope = opener?.closest(".timeline");
  return (
    threadScope?.querySelector<HTMLElement>('[aria-label="Reply body"]:not(:disabled)') ??
    threadScope?.querySelector<HTMLElement>('[aria-label="Close thread"]') ??
    timelineScope?.querySelector<HTMLElement>('[aria-label="Message body"]:not(:disabled)') ??
    timelineScope?.querySelector<HTMLElement>('[aria-label="Search messages"]') ??
    document.querySelector<HTMLElement>('[aria-label="Reply body"]:not(:disabled)') ??
    document.querySelector<HTMLElement>('[aria-label="Message body"]:not(:disabled)') ??
    document.querySelector<HTMLElement>('[aria-label="Close thread"]') ??
    document.querySelector<HTMLElement>('[aria-label="Search messages"]')
  );
}

function ImageViewer({ items, initialIndex, onClose }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const scrimRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const current = items[currentIndex] ?? items[0];
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  useEffect(() => setCurrentIndex(initialIndex), [initialIndex, items]);

  const showPrevious = useCallback(() => {
    setCurrentIndex((index) => Math.max(0, index - 1));
  }, []);

  const showNext = useCallback(() => {
    setCurrentIndex((index) => Math.min(items.length - 1, index + 1));
  }, [items.length]);

  useEffect(() => {
    const inertSiblings = new Set<HTMLElement>();
    const islandHost = scrimRef.current?.parentElement;
    const parent = islandHost?.parentElement;
    if (parent) {
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || sibling === islandHost || sibling.inert) continue;
        sibling.inert = true;
        inertSiblings.add(sibling);
      }
    }
    closeButtonRef.current?.focus({ preventScroll: true });
    const opener = openerRef.current;
    const focusFallback = findFocusFallback(opener);

    return () => {
      for (const sibling of inertSiblings) sibling.inert = false;
      if (opener?.isConnected && opener !== document.body) {
        opener.focus({ preventScroll: true });
        if (document.activeElement === opener) return;
      }
      if (focusFallback?.isConnected) focusFallback.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        showPrevious();
        return;
      }
      if (event.key === "ArrowRight" && currentIndex < items.length - 1) {
        event.preventDefault();
        showNext();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const dialog = dialogRef.current;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.inert && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [currentIndex, items.length, onClose, showNext, showPrevious]);

  if (!current) return null;

  return (
    <div ref={scrimRef} className="modal-scrim image-viewer-scrim" role="presentation">
      <button
        className="modal-backdrop"
        type="button"
        tabIndex={-1}
        aria-label="Close image viewer"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="image-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Image viewer: ${current.title}`}
        tabIndex={-1}
      >
        <header>
          <strong>{current.title}</strong>
          <div>
            {items.length > 1 && (
              <div
                className="image-viewer__pagination"
                aria-label={`Image ${currentIndex + 1} of ${items.length}`}
              >
                <button
                  type="button"
                  className="image-viewer__page-button"
                  aria-label="Previous image"
                  disabled={!hasPrevious}
                  onClick={showPrevious}
                >
                  ‹
                </button>
                <span className="image-viewer__count" aria-live="polite">
                  {currentIndex + 1} / {items.length}
                </span>
                <button
                  type="button"
                  className="image-viewer__page-button"
                  aria-label="Next image"
                  disabled={!hasNext}
                  onClick={showNext}
                >
                  ›
                </button>
              </div>
            )}
            <a href={current.url} target="_blank" rel="noreferrer">
              Open original
            </a>
            <button
              ref={closeButtonRef}
              className="image-viewer__close"
              type="button"
              aria-label="Close image viewer"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="image-viewer-stage">
          <img src={current.url} alt={current.title} />
        </div>
      </div>
    </div>
  );
}

export type ImageViewerIsland = {
  render: (props: ImageViewerProps) => void;
  unmount: () => void;
};

export function mountImageViewerIsland(
  element: HTMLElement,
  initialProps: ImageViewerProps,
): ImageViewerIsland {
  const root: Root = createRoot(element);
  const render = (props: ImageViewerProps) => {
    root.render(
      <ImageViewerErrorBoundary onClose={props.onClose}>
        <ImageViewer {...props} />
      </ImageViewerErrorBoundary>,
    );
  };
  render(initialProps);
  return { render, unmount: () => root.unmount() };
}
