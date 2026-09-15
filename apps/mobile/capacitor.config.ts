import type { CapacitorConfig } from "@capacitor/cli";
import {
  APP_ID,
  APP_NAME,
  BRAND_BACKGROUND,
  mobileServerConfig,
  serverURLFromEnv,
} from "./src/contract.ts";

const server = mobileServerConfig(serverURLFromEnv(process.env));

const config: CapacitorConfig = {
  appId: APP_ID,
  appName: APP_NAME,
  // The CLI requires bundled assets; server.url is what actually loads, so this
  // holds only the "no server configured" fallback page.
  webDir: "public",
  server,
  android: {
    allowMixedContent: false,
    backgroundColor: BRAND_BACKGROUND,
  },
  ios: {
    backgroundColor: BRAND_BACKGROUND,
    // "always" keeps the scroll view from double-counting the status bar inset,
    // which otherwise leaves a gap above the channel header.
    contentInset: "always",
    // Long-press must open ClickClack's own action sheet, not WebKit's link preview.
    allowsLinkPreview: false,
  },
  plugins: {
    Keyboard: {
      // Resize the web view itself so the composer rides above the keyboard
      // instead of being covered by it.
      resize: "native",
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      backgroundColor: BRAND_BACKGROUND,
      // The web app is remote, so never make splash dismissal depend on web-side
      // code: an older self-hosted server would leave the shell stuck on it.
      launchAutoHide: true,
      launchShowDuration: 1200,
      showSpinner: false,
    },
    StatusBar: {
      // Content sits below the status bar; the web app only recolors it.
      overlaysWebView: false,
    },
  },
};

export default config;
