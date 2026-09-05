<script lang="ts">
  import { botAvatarCandidates, botAvatarFiles } from "../../lib/bot-avatar-packs";
  import { resolvedColorMode } from "../../lib/appearance";
  import { avatarImageSource, avatarURLForColorMode } from "../../lib/chat/avatars";
  import ReactIslandHost from "../ReactIslandHost.svelte";
  import type { Channel } from "../../lib/types";
  import { mountPinnedPanelIsland, type PinnedPanelProps } from "./PinnedPanelIsland";

  type Props = PinnedPanelProps & {
    channel?: Channel;
  };

  let {
    messages,
    loading = false,
    error = "",
    topics = [],
    mentionPeople = [],
    mentionAttentionUserID,
    maxPins = 100,
    onClose,
    onOpenThread,
    onOpenImage,
    onOpenArtifact,
    onUnpin,
    onSelectTopic,
  }: Props = $props();

  const avatarCandidates = $derived(Object.fromEntries(messages.map(({ author_id, author }) => [
    author_id,
    author?.kind === "bot" && !author.deleted_at && $botAvatarFiles.length
      ? botAvatarCandidates(author_id, true, $botAvatarFiles,
          avatarURLForColorMode(author.avatar_url, author.avatar_url_light, $resolvedColorMode)).map(avatarImageSource)
      : [],
  ])));

  const islandProps: PinnedPanelProps = $derived({
    messages,
    avatarCandidates,
    loading,
    error,
    topics,
    mentionPeople,
    mentionAttentionUserID,
    maxPins,
    onClose,
    onOpenThread,
    onOpenImage,
    onOpenArtifact,
    onUnpin,
    onSelectTopic,
  });
</script>

<ReactIslandHost
  mount={mountPinnedPanelIsland}
  props={islandProps}
  class="pinned-panel-island"
/>
