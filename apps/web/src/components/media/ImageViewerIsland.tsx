import React, { useCallback, useEffect, useRef, useState } from "react";
import { createReactIsland, type ReactIsland } from "../../lib/react-island";
import { writeClipboardText } from "../../lib/clipboard";
import type { ImageViewerItem } from "../../lib/uploads";
import { copyAttachmentLink, copyViewerImage } from "../../lib/image-viewer-clipboard";

export type ImageViewerProps = {
  items: ImageViewerItem[];
  initialIndex: number;
  onClose: () => void;
};

type ContextMenuPosition = {
  x: number;
  y: number;
};

function ImageViewerFallback({ onClose }: ImageViewerProps) {
  return (
    <div className="modal-scrim image-viewer-scrim" role="presentation">
      <div className="image-viewer image-viewer--error" role="alertdialog" aria-modal="true">
        <header>
          <strong>Image unavailable</strong>
          <button type="button" aria-label="Close image viewer" onClick={onClose}>
            ×
          </button>
        </header>
      </div>
    </div>
  );
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
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [contextMenuStatus, setContextMenuStatus] = useState("");
  const [copying, setCopying] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const current = items[currentIndex] ?? items[0];
  const currentURL = current?.url ?? "";
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  useEffect(() => setCurrentIndex(initialIndex), [initialIndex, items]);

  const dismissContextMenu = useCallback(() => {
    setContextMenu(null);
    setContextMenuStatus("");
  }, []);

  const closeContextMenu = useCallback(() => {
    dismissContextMenu();
    window.requestAnimationFrame(() => imageRef.current?.focus({ preventScroll: true }));
  }, [dismissContextMenu]);

  const showContextMenu = useCallback((x: number, y: number) => {
    const menuWidth = 210;
    const menuHeight = 108;
    const margin = 8;
    setContextMenu({
      x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin)),
    });
    setContextMenuStatus("");
  }, []);

  const openContextMenu = useCallback(
    (event: React.MouseEvent<HTMLImageElement>) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY);
    },
    [showContextMenu],
  );

  const openContextMenuFromKeyboard = useCallback(
    (event: React.KeyboardEvent<HTMLImageElement>) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      showContextMenu(bounds.left + Math.min(bounds.width / 2, 80), bounds.top + 24);
    },
    [showContextMenu],
  );

  const handleContextMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not([aria-disabled="true"])',
      ),
    );
    if (buttons.length === 0) return;
    const currentButton =
      document.activeElement instanceof HTMLButtonElement
        ? buttons.indexOf(document.activeElement)
        : -1;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    buttons[(currentButton + direction + buttons.length) % buttons.length]?.focus();
  }, []);

  const preventContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

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
    if (!contextMenu) return;
    const focusFrame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    });
    const dismiss = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) dismissContextMenu();
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismissContextMenu);
    window.addEventListener("resize", dismissContextMenu);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismissContextMenu);
      window.removeEventListener("resize", dismissContextMenu);
    };
  }, [contextMenu, dismissContextMenu]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (contextMenu) closeContextMenu();
        else onClose();
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
  }, [closeContextMenu, contextMenu, currentIndex, items.length, onClose, showNext, showPrevious]);

  useEffect(() => dismissContextMenu(), [currentIndex, dismissContextMenu]);

  const copyCurrentImage = useCallback(async () => {
    if (copying) return;
    setCopying(true);
    setContextMenuStatus("");
    try {
      await copyViewerImage(currentURL);
      setContextMenuStatus("Image copied");
    } catch (error) {
      console.error("Could not copy image", error);
      setContextMenuStatus("Could not copy image");
    } finally {
      setCopying(false);
    }
  }, [copying, currentURL]);

  const copyCurrentAttachmentLink = useCallback(async () => {
    if (copying) return;
    setCopying(true);
    setContextMenuStatus("");
    try {
      await copyAttachmentLink(currentURL, writeClipboardText);
      setContextMenuStatus("Attachment link copied");
    } catch (error) {
      console.error("Could not copy attachment link", error);
      setContextMenuStatus("Could not copy attachment link");
    } finally {
      setCopying(false);
    }
  }, [copying, currentURL]);

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
          <img
            ref={imageRef}
            src={current.url}
            alt={current.title}
            tabIndex={0}
            aria-haspopup="menu"
            aria-keyshortcuts="Shift+F10"
            onContextMenu={openContextMenu}
            onKeyDown={openContextMenuFromKeyboard}
          />
          {contextMenu && (
            <div
              ref={contextMenuRef}
              className="image-viewer__context-menu"
              role="menu"
              aria-label="Image options"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              aria-busy={copying}
              onContextMenu={preventContextMenu}
              onKeyDown={handleContextMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                aria-disabled={copying}
                onClick={copyCurrentImage}
              >
                Copy image
              </button>
              <button
                type="button"
                role="menuitem"
                aria-disabled={copying}
                onClick={copyCurrentAttachmentLink}
              >
                Copy attachment link
              </button>
              {contextMenuStatus && <p role="status">{contextMenuStatus}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type ImageViewerIsland = ReactIsland<ImageViewerProps>;

export const mountImageViewerIsland = createReactIsland<ImageViewerProps>({
  name: "Image viewer",
  component: ImageViewer,
  fallback: ImageViewerFallback,
});
