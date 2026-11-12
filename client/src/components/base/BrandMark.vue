<template>
  <svg
    class="brand-mark"
    :class="{ 'is-static': !animated }"
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    aria-hidden="true"
  >
    <defs>
      <radialGradient :id="ids.sun" cx="40%" cy="36%" r="70%">
        <stop offset="0%" stop-color="#fff3d1" />
        <stop offset="45%" stop-color="#ffb35c" />
        <stop offset="100%" stop-color="#e5487f" />
      </radialGradient>
      <radialGradient :id="ids.glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ff9f5a" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#ff9f5a" stop-opacity="0" />
      </radialGradient>
      <radialGradient :id="ids.outer" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#c7d2fe" />
        <stop offset="100%" stop-color="#4f46e5" />
      </radialGradient>
      <radialGradient :id="ids.inner" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#bae6fd" />
        <stop offset="100%" stop-color="#0ea5e9" />
      </radialGradient>
    </defs>

    <!-- Orbits -->
    <circle class="brand-orbit" cx="32" cy="32" r="27" />
    <circle class="brand-orbit" cx="32" cy="32" r="17" />

    <!-- Sun -->
    <circle cx="32" cy="32" r="15" :fill="`url(#${ids.glow})`" />
    <circle cx="32" cy="32" r="9" :fill="`url(#${ids.sun})`" />

    <!-- Planets (each group turns around the sun) -->
    <g class="brand-planet brand-planet-inner">
      <circle cx="49" cy="32" r="2.6" :fill="`url(#${ids.inner})`" />
    </g>
    <g class="brand-planet brand-planet-outer">
      <circle cx="32" cy="5" r="4" :fill="`url(#${ids.outer})`" />
    </g>
  </svg>
</template>

<script>
/**
 * SolarOps logo: a small solar system, the sun with two planets orbiting
 * it at different speeds. Animated with CSS only (static when the user
 * prefers reduced motion, or with `animated` set to false).
 */
let instanceCount = 0;

export default {
  name: 'BrandMark',
  props: {
    size: {
      type: Number,
      default: 28,
    },
    animated: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    instanceCount += 1;
    const suffix = `brand-${instanceCount}`;

    // Gradient ids must be unique when several logos are on the page.
    return {
      ids: {
        sun: `${suffix}-sun`,
        glow: `${suffix}-glow`,
        outer: `${suffix}-outer`,
        inner: `${suffix}-inner`,
      },
    };
  },
};
</script>

<style>
.brand-mark {
  display: inline-block;
  flex-shrink: 0;
  overflow: visible;
}

.brand-orbit {
  fill: none;
  stroke: rgba(255, 255, 255, 0.16);
  stroke-width: 1.2;
}

.brand-planet {
  transform-box: view-box;
  transform-origin: 50% 50%;
  animation: brand-orbit linear infinite;
}

.brand-planet-inner {
  animation-duration: 7s;
}

.brand-planet-outer {
  animation-duration: 18s;
}

.brand-mark.is-static .brand-planet {
  animation: none;
}

@keyframes brand-orbit {
  to {
    transform: rotate(360deg);
  }
}
</style>
