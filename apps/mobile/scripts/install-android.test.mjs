import assert from "node:assert/strict";
import test from "node:test";
import {
  adbTarget,
  chooseJDK,
  connectedDevices,
  jdkMajor,
  parseEnvFile,
  resolveSettings,
  tailnetDefaults,
} from "./install-android.mjs";

test("tailnet status supplies this machine's app origin and the named phone", () => {
  const settings = tailnetDefaults({
    Self: { DNSName: "athena.example-tailnet.ts.net." },
    Peer: {
      abc: {
        HostName: "pixel-10-pro",
        DNSName: "pixel-10-pro.example-tailnet.ts.net.",
      },
      def: {
        HostName: "another-device",
        DNSName: "another-device.example-tailnet.ts.net.",
      },
    },
  });
  assert.deepEqual(settings, {
    serverURL: "https://athena.example-tailnet.ts.net:8080",
    device: "pixel-10-pro.example-tailnet.ts.net",
  });
});

test("tailnet discovery falls back without inventing a peer", () => {
  assert.deepEqual(tailnetDefaults({}), {
    serverURL: "https://app.clickclack.chat",
    device: "pixel-10-pro",
  });
});

test("environment settings override local and discovered settings", () => {
  assert.deepEqual(
    resolveSettings(
      { CLICKCLACK_SERVER_URL: "https://env", CLICKCLACK_ANDROID_DEVICE: "env-phone" },
      { CLICKCLACK_SERVER_URL: "https://file", CLICKCLACK_ANDROID_DEVICE: "file-phone" },
      { serverURL: "https://found", device: "found-phone" },
    ),
    { serverURL: "https://env", device: "env-phone" },
  );
  assert.deepEqual(
    resolveSettings(
      {},
      { CLICKCLACK_SERVER_URL: "https://file", CLICKCLACK_ANDROID_DEVICE: "file-phone" },
      { serverURL: "https://found", device: "found-phone" },
    ),
    { serverURL: "https://file", device: "file-phone" },
  );
});

test("local settings accept comments, whitespace, and quoted values", () => {
  assert.deepEqual(
    parseEnvFile(`
# local only
CLICKCLACK_SERVER_URL = "https://host:8080"
CLICKCLACK_ANDROID_DEVICE='phone.ts.net'
BROKEN
`),
    {
      CLICKCLACK_SERVER_URL: "https://host:8080",
      CLICKCLACK_ANDROID_DEVICE: "phone.ts.net",
    },
  );
});

test("adb targets use the stable port unless one is explicit", () => {
  assert.equal(adbTarget("pixel-10-pro.example.ts.net"), "pixel-10-pro.example.ts.net:5555");
  assert.equal(adbTarget("pixel-10-pro.example.ts.net:37105"), "pixel-10-pro.example.ts.net:37105");
  assert.equal(adbTarget("fd00::1"), "[fd00::1]:5555");
  assert.equal(adbTarget("[fd00::1]:37105"), "[fd00::1]:37105");
  assert.equal(adbTarget(""), "");
});

test("only usable adb devices are returned", () => {
  assert.deepEqual(
    connectedDevices(`List of devices attached
phone:5555\tdevice
other:5555\toffline
usb-1 unauthorized
emulator-5554 device
`),
    ["phone:5555", "emulator-5554"],
  );
});

test("the newest Gradle-compatible JDK is chosen", () => {
  assert.equal(jdkMajor("java-21-openjdk"), 21);
  assert.equal(jdkMajor("java-1.17.0-openjdk"), 17);
  assert.equal(
    chooseJDK("/usr/lib/jvm/java-26-openjdk", [
      "/usr/lib/jvm/java-17-openjdk",
      "/usr/lib/jvm/java-21-openjdk",
      "/usr/lib/jvm/java-26-openjdk",
    ]),
    "/usr/lib/jvm/java-21-openjdk",
  );
  assert.equal(
    chooseJDK("/usr/lib/jvm/java-21-openjdk", ["/usr/lib/jvm/java-17-openjdk"]),
    "/usr/lib/jvm/java-21-openjdk",
  );
});
