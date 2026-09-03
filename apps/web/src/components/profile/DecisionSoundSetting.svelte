<script lang="ts">
  import {
    decisionSounds,
    playDecisionSound,
    readDecisionSound,
    writeDecisionSound,
    type DecisionSound,
  } from "../../lib/decisionSound";
  import type { User } from "../../lib/types";

  type Props = {
    user: User;
    onChanged?: (sound: DecisionSound) => void;
  };

  let { user, onChanged }: Props = $props();

  let selected = $state<DecisionSound>("chime");
  let status = $state("");

  const labels: Record<DecisionSound, string> = {
    chime: "Chime",
    knock: "Knock",
    bell: "Bell",
    off: "Silent",
  };

  $effect(() => {
    selected = readDecisionSound(user.id);
  });

  function choose(sound: DecisionSound) {
    selected = sound;
    if (!writeDecisionSound(user.id, sound)) {
      status = "This browser would not save the preference.";
      return;
    }
    status = "";
    onChanged?.(sound);
    // Preview immediately: picking a sound is the one moment the operator
    // wants to hear it, and it also satisfies the autoplay gesture requirement.
    if (sound !== "off") void playDecisionSound(sound);
  }
</script>

<div class="settings-row2">
  <div class="settings-row2__desc">
    <span class="settings-row2__label">Decision alert</span>
    <p class="settings-row2__hint">
      Plays when a workflow stops and needs your answer. Ordinary messages stay silent.
    </p>
    {#if status}
      <p class="settings-row2__hint settings-row2__hint--error">{status}</p>
    {/if}
  </div>
  <div class="settings-row2__control settings-row2__control--end">
    <div class="segmented" role="group" aria-label="Decision alert sound">
      {#each decisionSounds as sound (sound)}
        <button
          type="button"
          class="segmented__option"
          class:segmented__option--active={selected === sound}
          aria-pressed={selected === sound}
          onclick={() => choose(sound)}
        >
          {labels[sound]}
        </button>
      {/each}
    </div>
  </div>
</div>
