<script lang="ts">
  import { afterNavigate, goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { frontendBaseURL } from "$lib/api";
  import { applyColorMode, initAppearance, loadColorMode } from "$lib/appearance";
  import { deepLinkToRoute } from "$lib/applinks";
  import { dismissTopLayer } from "$lib/dismissal";
  import { clearEmbedHostTheme, installEmbedHostTheme } from "$lib/embed-theme";
  import { initInterfaceScale } from "$lib/interface-scale";
  import { installNativeShell } from "$lib/native";
  import { completeNativeSignIn } from "$lib/native-signin";
  import "../styles/index.css";

  let { children } = $props();
  let uninstallEmbedHostTheme = () => {};

  /**
   * Links the operating system hands the shell. Sign-in callbacks are redeemed
   * here; everything else resolves to an in-app route.
   */
  async function handleNativeDeepLink(url: string) {
    const outcome = await completeNativeSignIn(url);
    if (outcome === "signed-in") {
      // Reload so the app boots with the session the grant just installed.
      window.location.replace("/app");
      return;
    }
    if (outcome === "failed") return;
    const route = deepLinkToRoute(url, [window.location.origin, frontendBaseURL()]);
    if (route) await goto(route, { keepFocus: true, noScroll: true });
  }

  onMount(() => {
    initAppearance();
    initInterfaceScale();
    // The shell is owned here rather than in ChatApp: settings and embed routes
    // do not render chat, and a deep link or status-bar change must still be
    // handled while one of them is on screen.
    const stopNativeShell = installNativeShell({
      dismissTopLayer,
      onDeepLink: (url) => void handleNativeDeepLink(url),
    });
    return () => {
      stopNativeShell();
      uninstallEmbedHostTheme();
      clearEmbedHostTheme();
    };
  });

  afterNavigate(() => {
    // The root layout survives navigation in both directions. Rebind the exact
    // current host, clear its old palette, and restore account or embed mode.
    uninstallEmbedHostTheme();
    clearEmbedHostTheme();
    uninstallEmbedHostTheme = installEmbedHostTheme();
    applyColorMode(loadColorMode());
  });
</script>

{@render children()}
