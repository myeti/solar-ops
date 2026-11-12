<template>
  <div class="planet" :class="classes" :style="cssVariables" aria-hidden="true">
    <div v-if="ring" class="planet-ring planet-ring-back"></div>
    <div class="planet-sphere"></div>
    <div v-if="ring" class="planet-ring planet-ring-front"></div>
  </div>
</template>

<script>
/**
 * A small planet used as the avatar of a project. The same seed (the
 * project uid) always gives the same colours.
 *
 * - `ring`:  a thin tilted ring (the project is exposed on a domain),
 * - `orbit`: a presence ring (the project process is running),
 * - `dim`:   desaturated (inactive projects).
 */

/**
 * Deterministic string hash (djb2).
 */
function hashString(value) {
  let hash = 5381;

  for (const character of String(value)) {
    hash = (hash * 33) ^ character.charCodeAt(0);
  }

  return Math.abs(hash);
}

export default {
  name: 'PlanetAvatar',
  props: {
    seed: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      default: 40,
    },
    ring: {
      type: Boolean,
      default: false,
    },
    orbit: {
      type: Boolean,
      default: false,
    },
    dim: {
      type: Boolean,
      default: false,
    },
    /** Force a hue (0-360) instead of deriving it from the seed. */
    hue: {
      type: Number,
      default: null,
    },
  },
  computed: {
    hash() {
      return hashString(this.seed);
    },
    cssVariables() {
      let hue = this.hash % 360;

      if (this.hue !== null) {
        hue = this.hue;
      }

      const tilt = -12 - (this.hash % 20);

      return {
        '--planet-size': `${this.size}px`,
        '--planet-hue': hue,
        '--planet-tilt': `${tilt}deg`,
      };
    },
    classes() {
      return {
        'is-dim': this.dim,
        'is-running': this.orbit,
        'has-ring': this.ring,
      };
    },
  },
};
</script>

<style>
.planet {
  position: relative;
  width: var(--planet-size);
  height: var(--planet-size);
  flex-shrink: 0;
  border-radius: 50%;
}

.planet-sphere {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 25%, hsl(var(--planet-hue) 75% 78% / 0.95) 0%, transparent 38%),
    radial-gradient(
      circle at 50% 50%,
      hsl(var(--planet-hue) 60% 58%) 0%,
      hsl(calc(var(--planet-hue) + 25) 55% 38%) 55%,
      hsl(calc(var(--planet-hue) + 45) 50% 16%) 100%
    );
  box-shadow:
    inset calc(var(--planet-size) * -0.14) calc(var(--planet-size) * -0.12) calc(var(--planet-size) * 0.26)
      rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.planet-ring {
  position: absolute;
  left: -26%;
  top: 34%;
  width: 152%;
  height: 32%;
  border-radius: 50%;
  border: 1px solid hsl(var(--planet-hue) 40% 80% / 0.55);
  transform: rotate(var(--planet-tilt));
}

.planet-ring-back {
  z-index: 0;
}

/* Only the lower half of the ring passes in front of the planet. */
.planet-ring-front {
  z-index: 2;
  clip-path: inset(50% 0 0 0);
}

.planet.has-ring {
  margin-inline: calc(var(--planet-size) * 0.22);
}

/* Running: a presence ring around the planet. */
.planet.is-running::after {
  content: '';
  position: absolute;
  inset: -4px;
  z-index: 3;
  border-radius: 50%;
  border: 1.5px solid var(--success);
  opacity: 0.85;
}

.planet.is-dim {
  filter: grayscale(0.85) brightness(0.65);
}
</style>
