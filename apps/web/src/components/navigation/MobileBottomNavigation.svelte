<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import {
    conversationPath,
    mobileChatRouteStorageKey,
    mobileKeyboardOpen,
    mobilePrimaryDestination,
    storedConversationPath,
  } from "$lib/mobile-primary-navigation";
  import { workspaceViewsPath } from "$lib/views";

  const workspaceID = $derived(page.params.workspaceID ?? "");
  const workspacePath = $derived(`/app/${encodeURIComponent(workspaceID)}`);
  const activeDestination = $derived(mobilePrimaryDestination(page.url.pathname, workspaceID));
  const visible = $derived(activeDestination !== null);
  let rememberedChatPath = $state("");
  let keyboardOpen = $state(false);

  const chatHref = $derived(rememberedChatPath || workspacePath);
  const homeHref = $derived(workspaceViewsPath(encodeURIComponent(workspaceID), "home"));
  const galleryHref = $derived(workspaceViewsPath(encodeURIComponent(workspaceID), "vai-gallery"));

  function syncChatRoute() {
    if (!workspaceID) return;
    const current = conversationPath(page.url.pathname, workspaceID);
    const key = mobileChatRouteStorageKey(workspaceID);
    if (current) {
      rememberedChatPath = current;
      try {
        localStorage.setItem(key, current);
      } catch {
        // The current route still works when persistent storage is unavailable.
      }
      return;
    }
    try {
      rememberedChatPath = storedConversationPath(localStorage.getItem(key), workspaceID) ?? "";
    } catch {
      rememberedChatPath = "";
    }
  }

  function editableElementFocused(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    if (active.isContentEditable) return true;
    if (active instanceof HTMLTextAreaElement) return !active.disabled && !active.readOnly;
    if (!(active instanceof HTMLInputElement) || active.disabled || active.readOnly) return false;
    return !["button", "checkbox", "file", "radio", "range", "reset", "submit"].includes(
      active.type,
    );
  }

  function setKeyboardOpen(value: boolean) {
    keyboardOpen = value;
    document.documentElement.toggleAttribute("data-mobile-keyboard-open", value);
  }

  onMount(() => {
    syncChatRoute();
    const viewport = window.visualViewport;
    let layoutViewportHeight = Math.max(window.innerHeight, viewport?.height ?? 0);

    const syncKeyboard = () => {
      const editableFocused = editableElementFocused();
      const visibleViewportHeight = viewport?.height ?? window.innerHeight;
      if (!editableFocused) layoutViewportHeight = Math.max(window.innerHeight, visibleViewportHeight);
      setKeyboardOpen(
        mobileKeyboardOpen(layoutViewportHeight, visibleViewportHeight, editableFocused),
      );
    };
    const syncAfterFocusChange = () => requestAnimationFrame(syncKeyboard);
    const resetAfterOrientationChange = () => {
      window.setTimeout(() => {
        layoutViewportHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
        syncKeyboard();
      }, 300);
    };

    viewport?.addEventListener("resize", syncKeyboard);
    window.addEventListener("resize", syncKeyboard);
    window.addEventListener("orientationchange", resetAfterOrientationChange);
    document.addEventListener("focusin", syncAfterFocusChange);
    document.addEventListener("focusout", syncAfterFocusChange);

    return () => {
      viewport?.removeEventListener("resize", syncKeyboard);
      window.removeEventListener("resize", syncKeyboard);
      window.removeEventListener("orientationchange", resetAfterOrientationChange);
      document.removeEventListener("focusin", syncAfterFocusChange);
      document.removeEventListener("focusout", syncAfterFocusChange);
      document.documentElement.removeAttribute("data-mobile-keyboard-open");
    };
  });
  afterNavigate(syncChatRoute);
</script>

{#if visible && !keyboardOpen}
  <nav class="mobile-primary-navigation" aria-label="Primary navigation">
    <a
      href={homeHref}
      class:active={activeDestination === "home"}
      aria-current={activeDestination === "home" ? "page" : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      </svg>
      <span>Home</span>
    </a>
    <a
      href={galleryHref}
      class:active={activeDestination === "gallery"}
      aria-current={activeDestination === "gallery" ? "page" : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
      </svg>
      <span>Gallery</span>
    </a>
    <a
      href={chatHref}
      class:active={activeDestination === "chat"}
      aria-current={activeDestination === "chat" ? "page" : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </svg>
      <span>Chat</span>
    </a>
  </nav>
{/if}

<style>
  .mobile-primary-navigation {
    display: none;
  }

  @media (max-width: 820px) {
    .mobile-primary-navigation {
      position: fixed;
      z-index: 50;
      right: 0;
      bottom: 0;
      left: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      height: var(--mobile-bottom-nav-height);
      padding: 4px max(8px, var(--safe-area-right)) var(--safe-area-bottom)
        max(8px, var(--safe-area-left));
      border-top: 1px solid var(--line-strong);
      background: color-mix(in srgb, var(--panel) 92%, transparent);
      box-shadow: 0 -10px 28px rgb(0 0 0 / 0.16);
      backdrop-filter: blur(18px) saturate(1.2);
    }

    .mobile-primary-navigation a {
      display: flex;
      min-width: 0;
      min-height: 48px;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 1px;
      border-radius: 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 650;
      line-height: 1;
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
    }

    .mobile-primary-navigation a:active {
      background: var(--hover);
    }

    .mobile-primary-navigation a.active {
      color: var(--accent);
    }

    .mobile-primary-navigation svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .mobile-primary-navigation a.active svg {
      filter: drop-shadow(0 0 7px color-mix(in srgb, var(--accent) 44%, transparent));
    }

    :global(body:not(:has(.shell, .workspace-views))) .mobile-primary-navigation {
      display: none;
    }
  }
</style>
