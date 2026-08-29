import { writeClipboardText } from "../clipboard";

type DecoratedCodeBlock = {
  code: HTMLElement;
  wrapper: HTMLDivElement;
  button: HTMLButtonElement;
  originalParent: ParentNode | null;
  originalNextSibling: ChildNode | null;
  resetTimer?: number;
  onCopy: (event: MouseEvent) => void;
};

const COPY_ICON = `
  <svg class="code-block-copy__icon code-block-copy__icon--copy" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
  <svg class="code-block-copy__icon code-block-copy__icon--check" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export function enhanceCodeBlockCopy(node: HTMLElement, enabled: boolean) {
  const decorated = new Map<HTMLPreElement, DecoratedCodeBlock>();
  let copyEnabled = enabled;
  let destroyed = false;

  const resetButton = (state: DecoratedCodeBlock) => {
    state.button.dataset.state = "idle";
    state.button.ariaLabel = "Copy code block";
    state.button.title = "Copy code block";
    state.resetTimer = undefined;
  };

  const release = (pre: HTMLPreElement) => {
    const state = decorated.get(pre);
    if (!state) return;
    if (state.resetTimer) window.clearTimeout(state.resetTimer);
    state.button.removeEventListener("click", state.onCopy);
    if (state.wrapper.parentNode) {
      state.wrapper.replaceWith(pre);
    } else if (state.originalParent && pre.parentNode !== state.originalParent) {
      state.originalParent.insertBefore(pre, state.originalNextSibling);
    }
    decorated.delete(pre);
  };

  const releaseAll = () => {
    for (const pre of decorated.keys()) release(pre);
  };

  const decorate = () => {
    for (const pre of decorated.keys()) {
      if (!node.contains(pre) || !copyEnabled) release(pre);
    }
    if (!copyEnabled) return;

    for (const pre of node.querySelectorAll<HTMLPreElement>("pre")) {
      if (decorated.has(pre)) continue;
      const code = pre.querySelector<HTMLElement>(":scope > code");
      if (!code) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
      const controlTrack = document.createElement("div");
      controlTrack.className = "code-block-copy-track";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-block-copy";
      button.dataset.state = "idle";
      button.ariaLabel = "Copy code block";
      button.title = "Copy code block";
      button.innerHTML = COPY_ICON;
      const originalParent = pre.parentNode;
      const originalNextSibling = pre.nextSibling;
      originalParent?.insertBefore(wrapper, pre);
      controlTrack.append(button);
      wrapper.append(controlTrack, pre);

      const state: DecoratedCodeBlock = {
        code,
        wrapper,
        button,
        originalParent,
        originalNextSibling,
        onCopy: () => {},
      };
      const onCopy = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.resetTimer) window.clearTimeout(state.resetTimer);
        const copy = writeClipboardText(state.code.textContent ?? "");
        void copy
          .then(() => {
            if (destroyed) return;
            state.button.dataset.state = "copied";
            state.button.ariaLabel = "Code copied";
            state.button.title = "Copied";
          })
          .catch(() => {
            if (destroyed) return;
            state.button.dataset.state = "error";
            state.button.ariaLabel = "Could not copy code block";
            state.button.title = "Copy failed";
          })
          .finally(() => {
            if (destroyed) return;
            state.resetTimer = window.setTimeout(() => resetButton(state), 1_600);
          });
      };
      state.onCopy = onCopy;
      decorated.set(pre, state);
      button.addEventListener("click", onCopy);
    }
  };

  const observer = new MutationObserver(decorate);
  observer.observe(node, { childList: true, subtree: true });
  decorate();

  return {
    update(nextEnabled: boolean) {
      copyEnabled = nextEnabled;
      decorate();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      releaseAll();
    },
  };
}
