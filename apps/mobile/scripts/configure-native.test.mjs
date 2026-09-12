import assert from "node:assert/strict";
import test from "node:test";
import {
  androidManifestHasDeepLink,
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
