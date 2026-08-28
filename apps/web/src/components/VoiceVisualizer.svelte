<script lang="ts">
  import {
    fillSpectrumBars,
    spectrumBarGeometry,
    type SpectrumBarGeometry,
  } from "../lib/voice-visualizer";

  type Props = {
    stream: MediaStream;
    barCount?: number;
    gap?: number;
    maxHeight?: number;
    className?: string;
    color?: string;
  };

  let {
    stream,
    barCount = 24,
    gap = 2,
    maxHeight = 24,
    className = "",
    color,
  }: Props = $props();

  let canvas: HTMLCanvasElement | null = null;

  $effect(() => {
    const activeStream = stream;
    const count = Math.max(1, Math.floor(barCount));
    const requestedGap = Math.max(0, gap);
    const requestedMaxHeight = Math.max(1, maxHeight);
    const requestedColor = color?.trim();
    if (!canvas) return;

    const drawingContext = canvas.getContext("2d");
    if (!drawingContext) return;

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let frequencyData: Uint8Array | null = null;
    let sampledLevels: Float32Array | null = new Float32Array(count);
    let displayedLevels: Float32Array | null = new Float32Array(count);
    let geometry: SpectrumBarGeometry = spectrumBarGeometry(0, count, requestedGap);
    let cssWidth = 0;
    let cssHeight = requestedMaxHeight;
    let animationFrame = 0;
    let disposed = false;
    let reducedMotion = false;
    let fillColor = requestedColor || getComputedStyle(canvas).color;

    sampledLevels.fill(0.04);
    displayedLevels.fill(0.04);

    const draw = () => {
      if (!canvas || !sampledLevels || !displayedLevels) return;
      drawingContext.clearRect(0, 0, cssWidth, cssHeight);
      drawingContext.fillStyle = fillColor;
      for (let index = 0; index < displayedLevels.length; index += 1) {
        const barHeight = Math.max(1, displayedLevels[index] * cssHeight);
        const x = index * (geometry.barWidth + geometry.gap);
        drawingContext.fillRect(x, cssHeight - barHeight, geometry.barWidth, barHeight);
      }
    };

    const resize = () => {
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, bounds.width);
      cssHeight = Math.max(1, Math.min(requestedMaxHeight, bounds.height || requestedMaxHeight));
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      const backingWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const backingHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      geometry = spectrumBarGeometry(cssWidth, count, requestedGap);
      fillColor = requestedColor || getComputedStyle(canvas).color;
      draw();
    };

    const render = () => {
      animationFrame = 0;
      if (
        disposed ||
        reducedMotion ||
        !analyser ||
        !frequencyData ||
        !sampledLevels ||
        !displayedLevels
      ) {
        return;
      }

      analyser.getByteFrequencyData(frequencyData);
      fillSpectrumBars(frequencyData, sampledLevels);
      for (let index = 0; index < displayedLevels.length; index += 1) {
        const target = sampledLevels[index];
        const current = displayedLevels[index];
        const smoothing = target > current ? 0.38 : 0.14;
        displayedLevels[index] = current + (target - current) * smoothing;
      }
      draw();
      animationFrame = window.requestAnimationFrame(render);
    };

    const startRendering = () => {
      if (!disposed && !reducedMotion && analyser && animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(render);
      }
    };

    const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => {
      reducedMotion = motionPreference?.matches ?? false;
      if (reducedMotion) {
        if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        sampledLevels?.fill(0.08);
        displayedLevels?.fill(0.08);
        draw();
      } else {
        startRendering();
      }
    };
    motionPreference?.addEventListener("change", syncMotionPreference);

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener("resize", resize);

    const themeObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (!canvas) return;
            fillColor = requestedColor || getComputedStyle(canvas).color;
            draw();
          });
    themeObserver?.observe(document.documentElement, { attributes: true });

    resize();
    syncMotionPreference();

    type AudioContextWindow = Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const AudioContextConstructor =
      window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
    if (AudioContextConstructor) {
      try {
        audioContext = new AudioContextConstructor();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.76;
        source = audioContext.createMediaStreamSource(activeStream);
        source.connect(analyser);
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        if (audioContext.state === "suspended") {
          void audioContext.resume().catch(() => undefined);
        }
        startRendering();
      } catch {
        source?.disconnect();
        analyser?.disconnect();
        void audioContext?.close().catch(() => undefined);
        source = null;
        analyser = null;
        audioContext = null;
      }
    }

    return () => {
      disposed = true;
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      motionPreference?.removeEventListener("change", syncMotionPreference);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      themeObserver?.disconnect();
      source?.disconnect();
      analyser?.disconnect();
      void audioContext?.close().catch(() => undefined);
      source = null;
      analyser = null;
      audioContext = null;
      frequencyData = null;
      sampledLevels = null;
      displayedLevels = null;
    };
  });
</script>

<canvas
  bind:this={canvas}
  class={`voice-visualizer ${className}`.trim()}
  style:height={`${Math.max(1, maxHeight)}px`}
  style:color={color}
  aria-hidden="true"
></canvas>

<style>
  .voice-visualizer {
    display: block;
    width: 100%;
    max-width: 100%;
    color: inherit;
    pointer-events: none;
  }
</style>
