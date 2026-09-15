import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  androidActivityPath,
  androidManifestHasDeepLink,
  renderAndroidActivity,
  withAndroidAuthIntentFilter,
  withIOSURLSchemes,
  withAndroidCustomURLScheme,
  withAndroidDeepLinkIntentFilter,
  withIOSURLScheme,
} from "./configure-native.mjs";

const STRINGS = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">ClickClack</string>
    <string name="custom_url_scheme">chat.clickclack.mobile</string>
</resources>
`;

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity
            android:launchMode="singleTask"
            android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>ClickClack</string>
</dict>
</plist>
`;

test("android custom_url_scheme is retargeted at the ClickClack scheme", () => {
  const patched = withAndroidCustomURLScheme(STRINGS);
  assert.match(patched, /<string name="custom_url_scheme">clickclack<\/string>/);
  assert.ok(!patched.includes("chat.clickclack.mobile"));
});

test("android patching is idempotent and keeps other strings", () => {
  const once = withAndroidCustomURLScheme(STRINGS);
  assert.equal(withAndroidCustomURLScheme(once), once);
  assert.match(once, /<string name="app_name">ClickClack<\/string>/);
});

test("android strings without the entry gain one", () => {
  const patched = withAndroidCustomURLScheme("<resources>\n</resources>\n");
  assert.match(patched, /<string name="custom_url_scheme">clickclack<\/string>/);
  assert.match(patched, /<\/resources>\s*$/);
});

test("the stock manifest already routes the scheme, so no filter is added", () => {
  const stock = MANIFEST.replace(
    "</activity>",
    '    <intent-filter>\n                <data android:scheme="@string/custom_url_scheme" />\n            </intent-filter>\n        </activity>',
  );
  assert.ok(androidManifestHasDeepLink(stock));
  assert.equal(withAndroidDeepLinkIntentFilter(stock), stock);
});

test("a manifest missing the template filter gains a browsable VIEW filter", () => {
  assert.ok(!androidManifestHasDeepLink(MANIFEST));
  const patched = withAndroidDeepLinkIntentFilter(MANIFEST);
  assert.match(patched, /<data android:scheme="clickclack" \/>/);
  assert.match(patched, /android.intent.category.BROWSABLE/);
  assert.match(patched, /android.intent.category.LAUNCHER/);
  assert.equal(withAndroidDeepLinkIntentFilter(patched), patched);
});

test("android patch helpers reject templates they do not understand", () => {
  assert.throws(() => withAndroidCustomURLScheme("<nope />"), /<resources>/);
  assert.throws(() => withAndroidDeepLinkIntentFilter("<manifest />"), /MainActivity/);
});

test("ios Info.plist gains a CFBundleURLTypes entry for the scheme", () => {
  const patched = withIOSURLScheme(PLIST);
  assert.match(patched, /<key>CFBundleURLTypes<\/key>/);
  assert.match(patched, /<key>CFBundleURLSchemes<\/key>/);
  assert.match(patched, /<string>clickclack<\/string>/);
  assert.match(patched, /<string>chat.clickclack.mobile.deeplink<\/string>/);
  // The existing keys and the plist envelope survive.
  assert.match(patched, /<key>CFBundleDisplayName<\/key>/);
  assert.match(patched, /<\/dict>\n<\/plist>\n$/);
});

test("ios patching is idempotent", () => {
  const once = withIOSURLScheme(PLIST);
  assert.equal(withIOSURLScheme(once), once);
});

test("ios plists with an existing scheme array gain only the new scheme", () => {
  const existing = PLIST.replace(
    "</dict>",
    "\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>other</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n</dict>",
  );
  const patched = withIOSURLScheme(existing);
  assert.match(patched, /<string>clickclack<\/string>/);
  assert.match(patched, /<string>other<\/string>/);
  assert.equal((patched.match(/<key>CFBundleURLTypes<\/key>/g) ?? []).length, 1);
});

test("ios patch helper rejects a plist it does not understand", () => {
  assert.throws(() => withIOSURLScheme("<plist />"), /root <dict>/);
});

test("ios registers both the content and sign-in callback schemes", () => {
  const patched = withIOSURLSchemes(PLIST);
  assert.match(patched, /<string>clickclack<\/string>/);
  assert.match(patched, /<string>chat\.clickclack\.desktop<\/string>/);
  // One CFBundleURLTypes block, with both schemes inside it.
  assert.equal((patched.match(/<key>CFBundleURLTypes<\/key>/g) ?? []).length, 1);
  assert.equal(withIOSURLSchemes(patched), patched);
});

test("android gains a filter for the sign-in callback scheme", () => {
  const patched = withAndroidAuthIntentFilter(MANIFEST);
  assert.match(patched, /<data android:scheme="chat\.clickclack\.desktop" \/>/);
  assert.equal(withAndroidAuthIntentFilter(patched), patched);
});

test("the content and auth filters coexist without duplicating either", () => {
  const patched = withAndroidAuthIntentFilter(withAndroidDeepLinkIntentFilter(MANIFEST));
  assert.match(patched, /<data android:scheme="clickclack" \/>/);
  assert.match(patched, /<data android:scheme="chat\.clickclack\.desktop" \/>/);
  assert.equal((patched.match(/android.intent.action.VIEW/g) ?? []).length, 2);
  assert.equal(withAndroidAuthIntentFilter(withAndroidDeepLinkIntentFilter(patched)), patched);
});

const TEMPLATE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../native/android/MainActivity.java"),
  "utf8",
);

test("the activity path follows the app id", () => {
  assert.equal(
    androidActivityPath("chat.clickclack.mobile"),
    "android/app/src/main/java/chat/clickclack/mobile/MainActivity.java",
  );
});

test("rendering binds the activity to one package and origin", () => {
  const rendered = renderAndroidActivity(TEMPLATE, "https://chat.example.com:8443");
  assert.match(rendered, /^package chat\.clickclack\.mobile;$/m);
  assert.match(rendered, /ALLOWED_ORIGIN = "https:\/\/chat\.example\.com:8443"/);
  assert.ok(!rendered.includes("__PACKAGE__"));
  assert.ok(!rendered.includes("__ALLOWED_ORIGIN__"));
  // Rendering is pure, so reinstalling the same origin is a no-op.
  assert.equal(renderAndroidActivity(TEMPLATE, "https://chat.example.com:8443"), rendered);
});

test("a template that lost its placeholders or package is rejected", () => {
  assert.throws(
    () => renderAndroidActivity("class MainActivity {}", "https://chat.example.com"),
    /package declaration/,
  );
});

test("the shipped activity guards both document-loading callbacks", () => {
  // shouldOverrideUrlLoading is not called for POST requests, and Capacitor's
  // local server only proxies GET, so the URL-override callback alone leaves an
  // off-origin main-frame POST able to become the page. Both callbacks must
  // stay origin-checked, and the request boundary must fail closed rather than
  // deferring to WebView.
  assert.match(TEMPLATE, /public boolean shouldOverrideUrlLoading\(/);
  assert.match(TEMPLATE, /public WebResourceResponse shouldInterceptRequest\(/);
  const intercept = TEMPLATE.slice(TEMPLATE.indexOf("shouldInterceptRequest("));
  const body = intercept.slice(0, intercept.indexOf("return super.shouldInterceptRequest"));
  assert.match(body, /request\.isForMainFrame\(\) && !isAllowedOrigin\(request\.getUrl\(\)\)/);
  assert.match(body, /return refuse\(\);/);
  // Refusing must not replay the request elsewhere: re-sending a submission's
  // body as a browser GET would change what it means.
  assert.ok(!body.includes("openExternally"));
  assert.match(TEMPLATE, /new WebResourceResponse\(\s*"text\/plain",\s*"utf-8",\s*403,/);
});

test("the shipped activity closes the port gap it exists for", () => {
  // Capacitor compares scheme and host only. If a future edit drops the port
  // comparison or stops scoping to the main frame, the guard is back to being
  // the upstream behaviour it was written to tighten.
  assert.match(TEMPLATE, /effectivePort\(url\) == effectivePort\(allowed\)/);
  assert.match(TEMPLATE, /request\.isForMainFrame\(\)/);
  assert.match(TEMPLATE, /equalsIgnoreCase\(allowed\.getScheme\(\)\)/);
  assert.match(TEMPLATE, /equalsIgnoreCase\(allowed\.getHost\(\)\)/);
  // Default ports must resolve so https://host and https://host:443 agree.
  assert.match(TEMPLATE, /"http"\.equalsIgnoreCase\(url\.getScheme\(\)\) \? 80 : 443/);
});
