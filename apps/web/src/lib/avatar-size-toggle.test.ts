import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("places the avatar size toggle beside the theme toggle", () => {
  for (const component of [
    "../components/topbar/Topbar.svelte",
    "../components/topbar/DesktopTitlebar.svelte",
  ]) {
    const source = readSource(component);
    assert.match(source, /import AvatarSizeToggle from "\.\/AvatarSizeToggle\.svelte"/u);
    assert.match(source, /<ThemeToggle \/>\s*<AvatarSizeToggle \/>/u);
  }
});

test("persists double avatars and applies them before paint", () => {
  const preference = readSource("./avatar-size.ts");
  const appTemplate = readSource("../app.html");

  assert.match(preference, /clickclack:avatar-size:v1/u);
  assert.match(preference, /setAttribute\("data-avatar-size", size\)/u);
  assert.match(appTemplate, /data-avatar-size/u);
});

test("double mode doubles timeline avatar dimensions", () => {
  const styles = readSource("../styles/messages.css");
  const desktopRule =
    styles.match(
      /:root\[data-avatar-size="double"\] \.message-group > \.avatar\s*\{([\s\S]*?)\}/u,
    )?.[1] ?? "";
  const avatarRules = [
    ...styles.matchAll(
      /:root\[data-avatar-size="double"\] \.message-group > \.avatar\s*\{([\s\S]*?)\}/gu,
    ),
  ];
  const mobileRule = avatarRules.find((rule) => /width:\s*92px/u.test(rule[1] ?? ""))?.[1] ?? "";

  assert.match(desktopRule, /width:\s*156px/u);
  assert.match(desktopRule, /height:\s*156px/u);
  assert.match(mobileRule, /width:\s*92px/u);
  assert.match(mobileRule, /height:\s*92px/u);
});

test("message alignment restores the user's saved preference", () => {
  const app = readSource("../ChatApp.svelte");

  assert.match(
    app,
    /userAlign = window\.localStorage\.getItem\(USER_ALIGN_STORAGE_KEY\) === "right" \? "right" : "left"/u,
  );
  assert.doesNotMatch(app, /localStorage\.setItem\(USER_ALIGN_STORAGE_KEY, "right"\)/u);
});

test("double mode scales sidebar shelf and DM avatars to 150 percent", () => {
  const styles = readSource("../styles/sidebar.css");

  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.sidebar-person > \.avatar\s*\{[\s\S]*?width:\s*135px;[\s\S]*?height:\s*135px;/u,
  );
  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.dm-avatar\s*\{[\s\S]*?width:\s*39px;[\s\S]*?height:\s*39px;/u,
  );
  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.user-card \.dm-avatar\s*\{[\s\S]*?width:\s*48px;[\s\S]*?height:\s*48px;/u,
  );
});

test("left-anchors persona identity headers without changing nested channels", () => {
  const styles = readSource("../styles/sidebar.css");

  assert.match(
    styles,
    /\.sidebar-profile-groups \.profile-subgroup-header \.profile-source-link\s*\{[\s\S]*?justify-content:\s*flex-start;[\s\S]*?padding-right:\s*32px;[\s\S]*?text-align:\s*left;/u,
  );
});

test("persona headers use each avatar as the full clipped hero background", () => {
  const styles = readSource("../styles/sidebar.css");
  const channelList = readSource("../components/navigation/ChannelList.svelte");

  assert.match(channelList, /class="persona-band"[\s\S]*?src=\{group\.profile\.avatar_url\}/u);
  assert.match(channelList, /class="persona-band"[\s\S]*?size=\{320\}/u);
  assert.match(channelList, /class="persona-band-scrim"/u);
  assert.match(channelList, /class="persona-name"/u);
  assert.doesNotMatch(channelList, /class="channel-profile-avatar"/u);

  assert.match(
    styles,
    /\.sidebar-profile-groups \.persona-band img\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*50% 20%;/u,
  );
  assert.doesNotMatch(styles, /profile-cover\.webp/u);
  assert.doesNotMatch(styles, /\.sidebar-profile-groups \.channel-profile-avatar/u);
});

test("persona hero crop controls preview and persist per-bot positions", () => {
  const avatar = readSource("../components/avatar/Avatar.svelte");
  const channelList = readSource("../components/navigation/ChannelList.svelte");
  const editor = readSource("../components/profile/ProfileEditor.svelte");
  const appearance = readSource("./appearance.ts");
  const sidebarStyles = readSource("../styles/sidebar.css");
  const threadStyles = readSource("../styles/thread.css");

  assert.match(avatar, /style:object-position=\{imagePosition\}/u);
  assert.match(avatar, /style:transform-origin=\{imageTransformOrigin\}/u);
  assert.match(avatar, /translate3d\(\$\{imageOffsetX\}%, 0, 0\) scale\(\$\{imageScale\}\)/u);
  assert.match(channelList, /\$personaHeroPositions\[group\.profile\.bot_user_id\]/u);
  assert.match(channelList, /imageScale=\{\(\$personaHeroPositions\[group\.profile\.bot_user_id\]\?\.zoom \?\? 118\) \/ 100\}/u);
  assert.match(channelList, /imageOffsetX=\{50 - \(\$personaHeroPositions\[group\.profile\.bot_user_id\]\?\.x \?\? 50\)\}/u);
  assert.match(editor, /onpointerdown=\{startHeroPan\}/u);
  assert.match(editor, /onpointermove=\{moveHeroPan\}/u);
  assert.match(editor, /onkeydown=\{moveHeroWithKeyboard\}/u);
  assert.match(editor, /type="range" min="25" max="250"[\s\S]*?aria-label="Sidebar hero zoom"/u);
  assert.doesNotMatch(editor, /Sidebar hero horizontal position/u);
  assert.doesNotMatch(editor, /Sidebar hero vertical position/u);
  assert.match(editor, /imagePosition=\{`50% \$\{heroPosition\.y\}%`\}/u);
  assert.match(editor, /imageOffsetX=\{50 - heroPosition\.x\}/u);
  assert.match(editor, /function clampHeroX[\s\S]*?Math\.max\(-100, Math\.min\(200,/u);
  assert.match(appearance, /x: Math\.max\(-100, Math\.min\(200,/u);
  assert.match(appearance, /persona_hero_positions: next/u);
  assert.match(sidebarStyles, /\.persona-band img[\s\S]*?mask-image: linear-gradient\(to right,/u);
  assert.match(threadStyles, /\.profile-editor__hero-preview img[\s\S]*?mask-image: linear-gradient\(to right,/u);
  assert.match(editor, /Could not save this crop/u);
  assert.match(editor, /onclick=\{retryPersonaHeroPositions\}/u);
});

test("persona headers support persisted pointer and keyboard reordering", () => {
  const sidebar = readSource("../components/navigation/Sidebar.svelte");
  const channelList = readSource("../components/navigation/ChannelList.svelte");
  const styles = readSource("../styles/sidebar.css");

  assert.match(sidebar, /clickclack:sidebar-persona-order:v1:/u);
  assert.match(sidebar, /profiles=\{orderedProfileShortcuts\}/u);
  assert.match(sidebar, /onReorderProfiles=\{savePersonaOrder\}/u);
  assert.match(channelList, /class="profile-drag-handle"/u);
  assert.match(channelList, /ondragover=\{\(event\) => personaDragOver/u);
  assert.match(channelList, /onkeydown=\{\(event\) => \{[\s\S]*?movePersonaBy/u);
  assert.match(styles, /\.profile-subgroup-header\.persona-drop-before::before/u);
});

test("double mode scales avatar-linked names with their avatars", () => {
  const sidebarStyles = readSource("../styles/sidebar.css");
  const messageStyles = readSource("../styles/messages.css");

  assert.match(sidebarStyles, /\.sidebar-person-name\s*\{[\s\S]*?font-size:\s*14px;/u);
  assert.match(
    sidebarStyles,
    /:root\[data-avatar-size="double"\] \.sidebar-person-name\s*\{[\s\S]*?font-size:\s*21px;/u,
  );
  assert.match(
    sidebarStyles,
    /:root\[data-avatar-size="double"\] \.sidebar-profile-groups \.channel-subgroup-toggle\s*\{[\s\S]*?font-size:\s*36px;/u,
  );
  assert.match(
    sidebarStyles,
    /:root\[data-avatar-size="double"\] \.nav-item\.dm \.nav-label\s*\{[\s\S]*?font-size:\s*22\.5px;/u,
  );
  assert.match(
    messageStyles,
    /:root\[data-avatar-size="double"\] \.message-group \.author-name\s*\{[\s\S]*?font-size:\s*31px;/u,
  );
});

test("sidebar profile cards glow with foam for unread direct messages", () => {
  const sidebar = readSource("../components/navigation/Sidebar.svelte");
  const styles = readSource("../styles/sidebar.css");

  assert.match(sidebar, /const unread = conversation\?\.unread_count \|\| 0/u);
  assert.match(sidebar, /hrefForDirect\(conversation\.id\)/u);
  assert.match(
    sidebar,
    /class:has-unread=\{unread > 0 && conversation\?\.id !== selectedDirectID\}/u,
  );
  assert.match(sidebar, /class="sidebar-person-unread"/u);
  assert.match(
    styles,
    /\.sidebar-person\.has-unread\s*\{[\s\S]*?background:[\s\S]*?var\(--rp-foam\)[\s\S]*?box-shadow:/u,
  );
  assert.match(
    styles,
    /\.sidebar-person\.has-unread \.sidebar-person-name\s*\{[\s\S]*?color:\s*var\(--text-strong\);[\s\S]*?font-weight:\s*700;/u,
  );
});
