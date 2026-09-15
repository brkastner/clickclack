#!/usr/bin/env node
/**
 * Brand the generated native projects and register what they must claim.
 *
 * `cap add` writes the stock Capacitor templates: they register the app id as
 * the custom URL scheme on Android, register nothing at all on iOS, claim no
 * share intents, and ship Capacitor's own launcher art. This installs the
 * ClickClack schemes, the share-sheet filters, the tracked brand resources, and
 * the launcher label over them. Running it after `cap add` or `cap sync` is
 * idempotent, so the native projects stay disposable and reproducible.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ID,
  APP_NAME,
  APP_URL_SCHEME,
  APP_URL_SCHEMES,
  AUTH_URL_SCHEME,
  normalizeServerURL,
  serverURLFromEnv,
} from "../src/contract.ts";

const IOS_URL_NAME = `${APP_ID}.deeplink`;

/**
 * Set a string resource, adding it when the template has no such entry. Both
 * the URL scheme and the launcher label are ordinary strings.xml entries, so
 * they share this.
 */
export function withAndroidString(stringsXML, name, value) {
  const entry = new RegExp(`(<string\\s+name="${name}">)([^<]*)(</string>)`);
  if (entry.test(stringsXML)) {
    return stringsXML.replace(entry, `$1${value}$3`);
  }
  const closing = stringsXML.lastIndexOf("</resources>");
  if (closing === -1) throw new Error("strings.xml has no <resources> element");
  const line = `    <string name="${name}">${value}</string>\n`;
  return `${stringsXML.slice(0, closing)}${line}${stringsXML.slice(closing)}`;
}

/** Point Capacitor's `custom_url_scheme` string at the ClickClack scheme. */
export function withAndroidCustomURLScheme(stringsXML, scheme = APP_URL_SCHEME) {
  return withAndroidString(stringsXML, "custom_url_scheme", scheme);
}

/**
 * Brand the launcher label. `cap add` writes the name from capacitor.config,
 * but `cap sync` does not revisit strings.xml, so a name change after the
 * project exists would otherwise only reach a freshly recreated one.
 */
export function withAndroidAppName(stringsXML, name = APP_NAME) {
  return withAndroidString(
    withAndroidString(stringsXML, "app_name", name),
    "title_activity_main",
    name,
  );
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

/**
 * Insert one intent filter as the last child of MainActivity. Callers decide
 * whether the filter is already there; this only places it.
 */
function withActivityIntentFilter(manifestXML, lines) {
  const activity = manifestXML.indexOf(".MainActivity");
  if (activity === -1) throw new Error("AndroidManifest.xml has no MainActivity");
  const closing = manifestXML.indexOf("</activity>", activity);
  if (closing === -1) throw new Error("AndroidManifest.xml MainActivity is not closed");
  const filter = [
    "",
    "",
    "            <intent-filter>",
    ...lines.map((line) => `                ${line}`),
    "            </intent-filter>",
    "",
    "        ",
  ].join("\n");
  // The closing tag sits on its own indented line; drop that trailing
  // whitespace so the filter lands between exactly one blank line on each side.
  const head = manifestXML.slice(0, closing).replace(/\s*$/, "");
  return `${head}${filter}${manifestXML.slice(closing)}`;
}

export function withAndroidDeepLinkIntentFilter(manifestXML, scheme = APP_URL_SCHEME) {
  if (androidManifestHasDeepLink(manifestXML, scheme)) return manifestXML;
  return withActivityIntentFilter(manifestXML, [
    '<action android:name="android.intent.action.VIEW" />',
    '<category android:name="android.intent.category.DEFAULT" />',
    '<category android:name="android.intent.category.BROWSABLE" />',
    `<data android:scheme="${scheme}" />`,
  ]);
}

/**
 * The MIME types the app claims from the system share sheet. Images are the
 * only binary type: the composer's own upload path is what finally accepts
 * them, and it accepts images, so claiming every MIME type would put the app in
 * share sheets for files it would then refuse.
 */
export const SHARE_INTENTS = [
  { action: "SEND", mimeType: "text/plain" },
  { action: "SEND", mimeType: "image/*" },
  { action: "SEND_MULTIPLE", mimeType: "image/*" },
];

function shareFilterLines({ action, mimeType }) {
  return [
    `<action android:name="android.intent.action.${action}" />`,
    '<category android:name="android.intent.category.DEFAULT" />',
    `<data android:mimeType="${mimeType}" />`,
  ];
}

export function androidManifestHasShareIntent(manifestXML, intent) {
  const [action, , data] = shareFilterLines(intent);
  // Both lines must appear in the same filter for the claim to exist, and a
  // filter is the only place these two ever appear together.
  for (const block of manifestXML.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? []) {
    if (block.includes(action.trim()) && block.includes(data.trim())) return true;
  }
  return false;
}

/**
 * Claim the system share sheet. Each MIME type needs its own filter: Android
 * intersects the actions, categories, and data of a single filter, so folding
 * them together would also claim combinations the app does not handle.
 */
export function withAndroidShareIntentFilters(manifestXML, intents = SHARE_INTENTS) {
  return intents.reduce(
    (xml, intent) =>
      androidManifestHasShareIntent(xml, intent)
        ? xml
        : withActivityIntentFilter(xml, shareFilterLines(intent)),
    manifestXML,
  );
}

/**
 * Register the sign-in callback scheme on Android. The template's filter carries
 * a single `@string/custom_url_scheme`, so the callback needs a filter of its
 * own; without it a grant redirect has nothing to open and sign-in dead-ends.
 */
export function withAndroidAuthIntentFilter(manifestXML, scheme = AUTH_URL_SCHEME) {
  return withAndroidDeepLinkIntentFilter(manifestXML, scheme);
}

/** Add CFBundleURLTypes to the iOS Info.plist, which the template omits. */
export function withIOSURLSchemes(plistXML, schemes = APP_URL_SCHEMES) {
  return schemes.reduce((xml, scheme) => withIOSURLScheme(xml, scheme), plistXML);
}

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

/** Where the generated project keeps its Java, derived from the app id. */
export function androidSourceDir(appID = APP_ID) {
  return `android/app/src/main/java/${appID.split(".").join("/")}`;
}

/** Where the generated project keeps the activity, derived from the app id. */
export function androidActivityPath(appID = APP_ID) {
  return `${androidSourceDir(appID)}/MainActivity.java`;
}

/**
 * Render a tracked Java source for this app. The activity also carries the
 * server origin: Capacitor compares only scheme and host when deciding what
 * stays in the web view, so the generated activity is replaced with one that
 * also compares the port. Sources with no `__ALLOWED_ORIGIN__` placeholder, the
 * share plugin among them, simply do not use it.
 */
export function renderAndroidSource(template, origin, appID = APP_ID) {
  const rendered = template
    .replaceAll("__PACKAGE__", appID)
    .replaceAll("__ALLOWED_ORIGIN__", origin);
  if (rendered.includes("__PACKAGE__") || rendered.includes("__ALLOWED_ORIGIN__")) {
    throw new Error("Java template still has unsubstituted placeholders");
  }
  if (!/^package [\w.]+;$/m.test(rendered)) {
    throw new Error("Java template lost its package declaration");
  }
  return rendered;
}

export function renderAndroidActivity(template, origin, appID = APP_ID) {
  return renderAndroidSource(template, origin, appID);
}

/**
 * The Java this app ships beyond Capacitor's template. MainActivity replaces
 * the generated one; the plugin is a new file beside it.
 */
export const ANDROID_SOURCES = ["MainActivity.java", "ShareTargetPlugin.java"];

/**
 * Copy the tracked branded resources over the stock Capacitor art. The files
 * live under native/android/res in the same layout the project expects, so this
 * is a plain recursive copy rather than a manifest of special cases. Rendering
 * them needs ImageMagick; installing them deliberately does not, so `pnpm sync`
 * works on a machine that has never run the generator.
 */
export function copyResources(source, destination) {
  const copied = [];
  if (!fs.existsSync(source)) return copied;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyResources(from, to));
      continue;
    }
    if (!entry.isFile()) continue;
    fs.mkdirSync(destination, { recursive: true });
    if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) continue;
    fs.copyFileSync(from, to);
    copied.push(to);
  }
  return copied;
}

function patch(file, transform, label) {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`${label}: already registers ${APP_URL_SCHEMES.join(", ")}`);
    return true;
  }
  fs.writeFileSync(file, after);
  console.log(`${label}: registered ${APP_URL_SCHEMES.join(", ")}`);
  return true;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const android = patch(
    path.join(root, "android/app/src/main/res/values/strings.xml"),
    (xml) => withAndroidAppName(withAndroidCustomURLScheme(xml)),
    "android strings.xml",
  );
  if (android) {
    const res = path.join(root, "android/app/src/main/res");
    const branded = copyResources(path.join(root, "native/android/res"), res);
    if (branded.length === 0) {
      console.log("android res: brand art already installed");
    } else {
      console.log(`android res: installed ${branded.length} branded file(s)`);
    }
    const sourceDir = path.join(root, androidSourceDir());
    const origin = normalizeServerURL(serverURLFromEnv(process.env));
    if (fs.existsSync(sourceDir)) {
      for (const name of ANDROID_SOURCES) {
        const template = path.join(root, "native/android", name);
        if (!fs.existsSync(template)) continue;
        const target = path.join(sourceDir, name);
        const rendered = renderAndroidSource(fs.readFileSync(template, "utf8"), origin);
        if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === rendered) {
          console.log(`android ${name}: already installed`);
        } else {
          fs.writeFileSync(target, rendered);
          console.log(`android ${name}: installed`);
        }
      }
    }
    patch(
      path.join(root, "android/app/src/main/AndroidManifest.xml"),
      (xml) =>
        withAndroidShareIntentFilters(
          withAndroidAuthIntentFilter(withAndroidDeepLinkIntentFilter(xml)),
        ),
      "android AndroidManifest.xml",
    );
  }
  const ios = patch(
    path.join(root, "ios/App/App/Info.plist"),
    (xml) => withIOSURLSchemes(xml),
    "ios Info.plist",
  );
  if (!android && !ios) {
    console.log("No native projects found. Run `pnpm add:ios` or `pnpm add:android` first.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
