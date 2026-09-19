<script lang="ts">
  import {
    INTERFACE_SCALE_STEP,
    MAX_INTERFACE_SCALE,
    MIN_INTERFACE_SCALE,
    interfaceScale,
    setInterfaceScale,
  } from "../../lib/interface-scale";

  // The slider stays collapsed until asked for, then unfurls to the left of the
  // button so the rest of the toolbar never shifts. The bars opt out of the
  // root zoom (see layout.css), so this control keeps its geometry while the
  // scale it is driving changes underneath it.
  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let slider = $state<HTMLInputElement>();

  const percent = $derived(Math.round($interfaceScale * 100));
  const label = $derived(`Interface scale: ${percent}%`);

  function nudge(steps: number) {
    setInterfaceScale($interfaceScale + steps * INTERFACE_SCALE_STEP);
  }

  /** Wheel over the track adjusts the scale. A range input ignores the wheel
      natively, which on a desktop is the obvious way to reach for it. */
  function onWheel(event: WheelEvent) {
    const delta = event.deltaY || event.deltaX;
    if (!delta) return;
    event.preventDefault();
    nudge(delta < 0 ? 1 : -1);
  }

  function toggle() {
    open = !open;
    if (open) queueMicrotask(() => slider?.focus());
  }

  function close() {
    open = false;
  }

  function onPointerDown(event: PointerEvent) {
    if (!open) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      close();
      event.stopPropagation();
    }
  }

  $effect(() => {
    if (!open) return;
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  });
</script>

<div
  class="ui-scale"
  class:open
  bind:this={root}
  onkeydown={onKeyDown}
  role="presentation"
>
  <div class="ui-scale-panel" aria-hidden={!open} onwheel={open ? onWheel : undefined}>
    <input
      bind:this={slider}
      type="range"
      class="ui-scale-slider"
      min={MIN_INTERFACE_SCALE}
      max={MAX_INTERFACE_SCALE}
      step={INTERFACE_SCALE_STEP}
      value={$interfaceScale}
      tabindex={open ? 0 : -1}
      aria-label="Interface scale"
      aria-valuetext={`${percent}%`}
      oninput={(event) => setInterfaceScale(event.currentTarget.valueAsNumber)}
      ondblclick={() => setInterfaceScale(1)}
    />
    <span class="ui-scale-readout" aria-hidden="true">{percent}%</span>
  </div>
  <button
    type="button"
    class="ui-scale-toggle"
    class:active={open}
    title={label}
    aria-label={label}
    aria-expanded={open}
    onclick={toggle}
  >
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M4 9V5a1 1 0 0 1 1-1h4M20 15v4a1 1 0 0 1-1 1h-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="m4 4 6 6M20 20l-6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  </button>
</div>
