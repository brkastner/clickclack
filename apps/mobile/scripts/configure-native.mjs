#!/usr/bin/env node
/**
 * Register the ClickClack deep-link scheme in the generated native projects.
 *
 * `cap add` writes the stock Capacitor templates, which register the app id as
 * the custom URL scheme on Android and register nothing at all on iOS. Both need
 * `clickclack://`, the scheme the desktop client and server-issued notification
 * links already use. Running this after `cap add` or `cap sync` is idempotent,
 * so the native projects stay disposable and reproducible.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, APP_URL_SCHEME } from "../src/contract.ts";

const IOS_URL_NAME = `${APP_ID}.deeplink`;

/** Point Capacitor's `custom_url_scheme` string at the ClickClack scheme. */
export function withAndroidCustomURLScheme(stringsXML, scheme = APP_URL_SCHEME) {
  const entry = /(<string\s+name="custom_url_scheme">)([^<]*)(<\/string>)/;
  if (entry.test(stringsXML)) {
    return stringsXML.replace(entry, `$1${scheme}$3`);
  }
  const closing = stringsXML.lastIndexOf("</resources>");
  if (closing === -1) throw new Error("strings.xml has no <resources> element");
  const line = `    <string name="custom_url_scheme">${scheme}</string>\n`;
  return `${stringsXML.slice(0, closing)}${line}${stringsXML.slice(closing)}`;
}

/**
 * Capacitor 8's Android template registers only MAIN/LAUNCHER, so the manifest
 * normally needs a VIEW/BROWSABLE filter added. Templates that already route the
 * scheme — directly or through `@string/custom_url_scheme` — are left alone so a
 * hand-tuned manifest never grows a duplicate filter.
 */
export function androidManifestHasDeepLink(manifestXML, scheme = APP_URL_SCHEME) {
  return (
    manifestXML.includes('android:scheme="@string/custom_url_scheme"') ||
    manifestXML.includes(`android:scheme="${scheme}"`)
  );
}

export function withAndroidDeepLinkIntentFilter(manifestXML, scheme = APP_URL_SCHEME) {
  if (androidManifestHasDeepLink(manifestXML, scheme)) return manifestXML;
  const activity = manifestXML.indexOf(".MainActivity");
  if (activity === -1) throw new Error("AndroidManifest.xml has no MainActivity");
  const closing = manifestXML.indexOf("</activity>", activity);
  if (closing === -1) throw new Error("AndroidManifest.xml MainActivity is not closed");
  const filter = [
    "",
    "",
    "            <intent-filter>",
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    `                <data android:scheme="${scheme}" />`,
    "            </intent-filter>",
    "",
    "        ",
  ].join("\n");
  // The closing tag sits on its own indented line; drop that trailing
  // whitespace so the filter lands between exactly one blank line on each side.
  const head = manifestXML.slice(0, closing).replace(/\s*$/, "");
  return `${head}${filter}${manifestXML.slice(closing)}`;
}

/** Add CFBundleURLTypes to the iOS Info.plist, which the template omits. */
export function withIOSURLScheme(plistXML, scheme = APP_URL_SCHEME, name = IOS_URL_NAME) {
  if (plistXML.includes(`<string>${scheme}</string>`)) return plistXML;
  const schemesKey = plistXML.indexOf("<key>CFBundleURLSchemes</key>");
  if (schemesKey !== -1) {
    const arrayStart = plistXML.indexOf("<array>", schemesKey);
    if (arrayStart === -1) throw new Error("Info.plist CFBundleURLSchemes has no <array>");
    const insertAt = arrayStart + "<array>".length;
    return `${plistXML.slice(0, insertAt)}\n\t\t\t\t<string>${scheme}</string>${plistXML.slice(insertAt)}`;
  }
  const closing = plistXML.lastIndexOf("</dict>");
  if (closing === -1) throw new Error("Info.plist has no root <dict>");
  const block = [
    "\t<key>CFBundleURLTypes</key>",
    "\t<array>",
    "\t\t<dict>",
    "\t\t\t<key>CFBundleURLName</key>",
    `\t\t\t<string>${name}</string>`,
    "\t\t\t<key>CFBundleTypeRole</key>",
    "\t\t\t<string>Editor</string>",
    "\t\t\t<key>CFBundleURLSchemes</key>",
    "\t\t\t<array>",
    `\t\t\t\t<string>${scheme}</string>`,
    "\t\t\t</array>",
    "\t\t</dict>",
    "\t</array>",
    "",
  ].join("\n");
  return `${plistXML.slice(0, closing)}${block}${plistXML.slice(closing)}`;
}

function patch(file, transform, label) {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`${label}: already registers ${APP_URL_SCHEME}://`);
    return true;
  }
  fs.writeFileSync(file, after);
  console.log(`${label}: registered ${APP_URL_SCHEME}://`);
  return true;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const android = patch(
    path.join(root, "android/app/src/main/res/values/strings.xml"),
    (xml) => withAndroidCustomURLScheme(xml),
    "android strings.xml",
  );
  if (android) {
    patch(
      path.join(root, "android/app/src/main/AndroidManifest.xml"),
      (xml) => withAndroidDeepLinkIntentFilter(xml),
      "android AndroidManifest.xml",
    );
  }
  const ios = patch(
    path.join(root, "ios/App/App/Info.plist"),
    (xml) => withIOSURLScheme(xml),
    "ios Info.plist",
  );
  if (!android && !ios) {
    console.log("No native projects found. Run `pnpm add:ios` or `pnpm add:android` first.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
