const MAX_DELTA_TIME = 0.1; // Cap at 100ms to prevent jumps

export interface GameLoopCallbacks {
  update: (dt: number) => void;
  render: (ctx: CanvasRenderingContext2D) => void;
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): () => void {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  let lastTime = performance.now();
  let animId = 0;

  function frame(time: number) {
    const dt = Math.min((time - lastTime) / 1000, MAX_DELTA_TIME);
    lastTime = time;

    // Re-disable smoothing on resize
    ctx.imageSmoothingEnabled = false;

    callbacks.update(dt);
    callbacks.render(ctx);

    animId = requestAnimationFrame(frame);
  }

  animId = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(animId);
}
