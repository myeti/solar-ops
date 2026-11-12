<template>
  <div class="ambient" aria-hidden="true">
    <div class="ambient-grid"></div>
    <div class="ambient-sun"></div>
    <div class="ambient-planet"></div>
  </div>
</template>

<script>
/**
 * Backdrop of the whole application, pure CSS (no canvas, no JavaScript):
 *   - a faint grid fading out from the top (the "solid system"),
 *   - a warm sun glow and a cool planet glow drifting very slowly behind
 *     the glass panels (the "solar system").
 */
export default {
  name: 'AmbientBackground',
};
</script>

<style>
.ambient {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.ambient-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
  background-size: 56px 56px;
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 10%, transparent 75%);
  mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 10%, transparent 75%);
}

.ambient-sun,
.ambient-planet {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
}

/* Warm light, top right. */
.ambient-sun {
  top: -280px;
  right: -180px;
  width: 680px;
  height: 680px;
  background: radial-gradient(
    circle at 40% 60%,
    rgba(255, 170, 100, 0.5),
    rgba(229, 72, 127, 0.22) 42%,
    transparent 70%
  );
  filter: blur(70px);
  opacity: 0.7;
  animation: ambient-drift 38s ease-in-out infinite alternate;
}

/* Cool body, bottom left. */
.ambient-planet {
  bottom: -340px;
  left: -220px;
  width: 760px;
  height: 760px;
  background: radial-gradient(
    circle at 55% 40%,
    rgba(99, 102, 241, 0.45),
    rgba(56, 189, 248, 0.12) 45%,
    transparent 70%
  );
  filter: blur(90px);
  opacity: 0.55;
  animation: ambient-drift 46s ease-in-out infinite alternate-reverse;
}

@keyframes ambient-drift {
  from {
    transform: translate3d(0, 0, 0) scale(1);
  }

  to {
    transform: translate3d(-40px, 30px, 0) scale(1.06);
  }
}
</style>
