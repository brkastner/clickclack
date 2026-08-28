<script lang="ts">
  let { stream }: { stream?: MediaStream } = $props();
  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    if (!canvas || !stream) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    const levels = new Uint8Array(analyser.frequencyBinCount);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    let stopped = false;

    const draw = () => {
      if (stopped || !canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      const drawing = canvas.getContext("2d");
      if (!drawing) return;
      drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawing.clearRect(0, 0, width, height);
      analyser.getByteFrequencyData(levels);
      const bars = 18;
      const gap = 2;
      const barWidth = (width - gap * (bars - 1)) / bars;
      const color = getComputedStyle(canvas).getPropertyValue("--voice-pulse-color").trim();
      drawing.fillStyle = color || "#ff7a90";
      for (let index = 0; index < bars; index += 1) {
        const sample = reducedMotion ? 0.18 : levels[Math.min(levels.length - 1, index + 1)] / 255;
        const barHeight = Math.max(3, sample * height * 0.95);
        const x = index * (barWidth + gap);
        drawing.beginPath();
        drawing.roundRect(x, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
        drawing.fill();
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    void context.resume().catch(() => undefined);
    draw();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  });
</script>

<canvas bind:this={canvas} class="voice-pulse" aria-hidden="true"></canvas>

<style>
  .voice-pulse {
    --voice-pulse-color: var(--accent, #ff7a90);
    display: block;
    width: 92px;
    height: 24px;
    opacity: 0.9;
  }
</style>
