<script lang="ts">
  import ProfileEditor from "../../../src/components/profile/ProfileEditor.svelte";
  let editing = $state(false);
  import PinnedPanel from "../../../src/components/pins/PinnedPanel.svelte";
  import type { Message } from "../../../src/lib/types";
  import Avatar from "../../../src/components/avatar/Avatar.svelte";
  import BotAvatarPacksSection from "../../../src/components/settings/BotAvatarPacksSection.svelte";
  import { resolvedColorMode } from "../../../src/lib/appearance";
  const pinnedMessages: Message[] = [{
    id: "msg_pin", workspace_id: "wsp_test", channel_id: "chn_test", author_id: "usr_bot",
    thread_root_id: "msg_pin", body: "Pinned bot message", body_format: "markdown", created_at: "2026-01-01T00:00:00Z",
    author: { id: "usr_bot", kind: "bot", display_name: "Bot", handle: "bot", avatar_url: "/stored.png", avatar_url_light: "/light.png", created_at: "2026-01-01T00:00:00Z" },
  }];
</script>
<div class="settings-modal__content"><BotAvatarPacksSection /></div>
<button onclick={() => resolvedColorMode.set("light")}>Light mode</button>
<button onclick={() => resolvedColorMode.set("dark")}>Dark mode</button>
<div data-testid="bot"><Avatar id="usr_bot" name="Bot" isBot={true} src="/stored.png" lightSrc="/light.png" loading="eager" /></div>
<div data-testid="profile"><Avatar id="usr_bot" name="Bot" isBot={true} src="/stored.png" lightSrc="/light.png" size={200} loading="eager" /></div>
<div data-testid="background"><Avatar class="persona-band" id="usr_bot" name="Bot" isBot={true} src="/stored.png" lightSrc="/light.png" size={320} loading="eager" /></div>
<div data-testid="human"><Avatar id="usr_human" name="Human" src="/human.png" lightSrc="/human-light.png" loading="eager" /></div>

<div data-testid="pinned"><PinnedPanel messages={pinnedMessages} onClose={() => {}} onOpenThread={() => {}} onOpenImage={() => {}} onOpenArtifact={() => {}} onUnpin={async () => {}} /></div>

<button onclick={() => editing = true}>Edit bot identity</button>
{#if editing}
  <div data-testid="identity-editor">
    <ProfileEditor profile={pinnedMessages[0].author!} canEditIdentity={true}
      onBack={() => editing = false} onSaveBotProfile={async () => {}} />
  </div>
{/if}
