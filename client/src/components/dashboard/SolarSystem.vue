<template>
  <div class="solar">
    <svg class="solar-map" :viewBox="viewBox" role="group" :aria-label="ariaLabel">
      <defs>
        <radialGradient :id="ids.sun" cx="40%" cy="36%" r="70%">
          <stop offset="0%" stop-color="#fff3d1" />
          <stop offset="45%" stop-color="#ffb35c" />
          <stop offset="100%" stop-color="#e5487f" />
        </radialGradient>
        <radialGradient :id="ids.corona" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ff9f5a" stop-opacity="0.5" />
          <stop offset="55%" stop-color="#ff7a59" stop-opacity="0.12" />
          <stop offset="100%" stop-color="#ff7a59" stop-opacity="0" />
        </radialGradient>
        <radialGradient :id="ids.depth" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#06060a" stop-opacity="0.6" />
          <stop offset="70%" stop-color="#06060a" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#06060a" stop-opacity="0" />
        </radialGradient>
        <template v-for="palette in palettes" :key="palette.state">
          <radialGradient :id="`${ids.planet}-${palette.state}`" cx="35%" cy="30%" r="75%">
            <stop offset="0%" :stop-color="palette.light" />
            <stop offset="100%" :stop-color="palette.dark" />
          </radialGradient>
          <radialGradient :id="`${ids.halo}-${palette.state}`" cx="50%" cy="50%" r="50%">
            <stop offset="0%" :stop-color="palette.glow" :stop-opacity="palette.glowOpacity" />
            <stop offset="100%" :stop-color="palette.glow" stop-opacity="0" />
          </radialGradient>
        </template>
      </defs>

      <g aria-hidden="true">
        <circle
          v-for="(star, index) in stars"
          :key="index"
          :cx="star.x"
          :cy="star.y"
          :r="star.r"
          class="solar-star"
          :style="{ animationDelay: `${star.delay}s`, animationDuration: `${star.duration}s` }"
        />
      </g>

      <!--
        The system, centered in the free area (below topInset), seen at an
        angle: orbits are squashed vertically (TILT), planets are not.
      -->
      <g :transform="`translate(${layout.centerX} ${layout.centerY})`">
        <ellipse
          :rx="layout.outerRadius * 1.2"
          :ry="layout.outerRadius * 1.2 * tilt + sunRadius * 2"
          :fill="`url(#${ids.depth})`"
          aria-hidden="true"
        />
        <g :transform="`scale(1 ${tilt})`" aria-hidden="true">
          <circle v-for="orbit in orbits" :key="`orbit-${orbit.index}`" :r="orbit.radius" class="solar-orbit" />
        </g>

        <g class="solar-sun">
          <title>This server</title>
          <circle :r="sunRadius * 2.8" :fill="`url(#${ids.corona})`" class="solar-corona" />
          <circle :r="sunRadius" :fill="`url(#${ids.sun})`" />
        </g>

        <!--
          Each planet turns around the sun (0, 0) at its own speed, inside the
          squashed plane, and counter-rotates (then un-squashes) at the same
          pace: it stays round and its label upright. solar-depth makes it
          bigger in front of the sun, smaller behind.
        -->
        <g :transform="`scale(1 ${tilt})`">
          <g v-for="planet in planets" :key="planet.uid" class="solar-spin" :style="planet.motion">
            <g :transform="`rotate(${planet.angle})`">
              <g :transform="`translate(${planet.radius} 0)`">
                <g class="solar-counter" :style="planet.motion">
                  <g :transform="`rotate(${-planet.angle}) scale(1 ${1 / tilt})`">
                    <g class="solar-depth" :style="planet.depth">
                      <g
                        class="solar-planet"
                        :class="`is-${planet.state}`"
                        role="link"
                        tabindex="0"
                        :aria-label="planet.tooltip"
                        @click="open(planet)"
                        @keydown.enter="open(planet)"
                      >
                        <title>{{ planet.tooltip }}</title>
                        <circle v-if="planet.state === 'unhealthy'" :r="planet.size * 1.8" class="solar-alert" />
                        <circle :r="planet.size * 2.4" :fill="`url(#${ids.halo}-${planet.state})`" />
                        <circle :r="planet.size" :fill="`url(#${ids.planet}-${planet.state})`" class="solar-body" />
                        <ellipse
                          v-if="planet.ring"
                          :rx="planet.size * 1.8"
                          :ry="planet.size * 0.5"
                          transform="rotate(-18)"
                          class="solar-ring"
                        />
                        <text
                          :y="planet.size + layout.labelSize + 3"
                          class="solar-label"
                          :style="{ fontSize: `${layout.labelSize}px` }"
                        >
                          {{ planet.name }}
                        </text>
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>

    <div ref="overlay" class="solar-overlay">
      <div class="solar-legend">
        <span v-for="entry in legend" :key="entry.state" class="solar-legend-item">
          <span class="solar-dot" :class="`is-${entry.state}`"></span>
          {{ entry.label }}
          <span class="text-faint">{{ entry.count }}</span>
        </span>
      </div>

      <div v-if="attention.length > 0" class="solar-attention">
        <RouterLink
          v-for="planet in attention"
          :key="planet.uid"
          :to="`/projects/${planet.uid}`"
          class="solar-attention-item"
        >
          <FeatherIcon name="alert-circle" :size="14" class="text-danger" />
          <strong>{{ planet.name }}</strong>
          <span class="small text-dim truncate">{{ planet.reasons.join(', ') }}</span>
        </RouterLink>
      </div>

      <slot></slot>

      <div class="solar-hint tiny text-faint">
        Ringed planets are on the web. Click a planet to open it, or see
        <RouterLink to="/projects">all projects</RouterLink>.
      </div>
    </div>
  </div>
</template>

<script>
/**
 * The projects as a solar system filling its container (the dashboard
 * page): the sun is the server, each planet a project, colored by health
 * (see services/projectHealth.js):
 *
 *   purple  SolarOps itself       red   needs attention
 *   blue    healthy               gray  disabled
 *
 * Stars cover the whole container; the system is centered in the area
 * below `topInset` (where the page header and numbers are) and sized to
 * fit it, seen at an angle (orbits squashed by TILT, planets bigger in front
 * of the sun). Up to 6 orbits: with more projects, outer orbits (more room)
 * hold more planets. Every planet turns counter-clockwise at its own speed
 * (slower on outer orbits), and all pause while a planet is hovered or
 * focused. Animated with CSS only (static when the user prefers reduced
 * motion).
 */
import { projectHealth } from '../../services/projectHealth.js';

const SUN_RADIUS = 28;
const FIRST_ORBIT = 100;
const ORBIT_GAP = 44;
const MAX_ORBITS = 6;
/** Orbits are seen at an angle: their height is this fraction of their width. */
const TILT = 0.45;
/** Planets are this much bigger in front of the sun, smaller behind it (see solar-depth). */
const DEPTH = 0.14;
/** Radius of the largest planet (SolarOps). */
const LARGEST_PLANET = 12;
/** With few projects, the system is not zoomed in more than this (half width, map units). */
const MIN_HALF_WIDTH = 320;
/** Map units per CSS pixel, at least: the system never gets oversized on huge screens. */
const MIN_UNITS_PER_PIXEL = 0.55;
/** Orbital period on the first orbit, in seconds (outer orbits are slower). */
const BASE_PERIOD = 22;
/** Labels stay between these sizes on screen, in CSS pixels, whatever the zoom. */
const MIN_LABEL_PX = 11;
const MAX_LABEL_PX = 14;
const LABEL_SIZE = 12.5;
/** Space kept between the system and the edges / the legend, in CSS pixels. */
const BOTTOM_GAP_PX = 24;
const SIDE_GAP_PX = 24;
/** Height of the system area at least, in CSS pixels. */
const MIN_AREA_PX = 320;
/** Width left of the legend from which the system can sit beside it, in CSS pixels. */
const MIN_BESIDE_WIDTH_PX = 420;
const GOLDEN_ANGLE = 137.508;

const PALETTES = [
  { state: 'system', light: '#ede9fe', dark: '#7c3aed', glow: '#a78bfa', glowOpacity: 0.55 },
  { state: 'healthy', light: '#bae6fd', dark: '#2563eb', glow: '#60a5fa', glowOpacity: 0.45 },
  { state: 'unhealthy', light: '#fecaca', dark: '#dc2626', glow: '#f87171', glowOpacity: 0.55 },
  { state: 'disabled', light: '#e4e4e7', dark: '#52525b', glow: '#a1a1aa', glowOpacity: 0.15 },
];

const LEGEND = [
  { state: 'system', label: 'SolarOps' },
  { state: 'healthy', label: 'Healthy' },
  { state: 'unhealthy', label: 'Needs attention' },
  { state: 'disabled', label: 'Disabled' },
];

const TYPE_LABELS = {
  app: 'application',
  static: 'static site',
};

let instanceCount = 0;

/**
 * Small deterministic random generator (mulberry32): the stars do not
 * move between refreshes.
 *
 * @param {number} seed
 */
function seededRandom(seed) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stars in relative coordinates (0..1), scaled to the container later. */
const STARS = (() => {
  const random = seededRandom(7);

  return Array.from({ length: 240 }, () => ({
    x: random(),
    y: random(),
    r: Math.round((0.5 + random() * 1.1) * 10) / 10,
    delay: Math.round(random() * 60) / 10,
    duration: Math.round((3 + random() * 4) * 10) / 10,
  }));
})();

/**
 * Label size in map units: LABEL_SIZE, kept between MIN_LABEL_PX and
 * MAX_LABEL_PX once drawn on screen.
 *
 * @param {number} unitsPerPixel
 */
function labelSizeFor(unitsPerPixel) {
  return Math.max(MIN_LABEL_PX * unitsPerPixel, Math.min(LABEL_SIZE, MAX_LABEL_PX * unitsPerPixel));
}

/**
 * Scale fitting the tilted system in an area: map units per CSS pixel, and
 * the label size going with it (labels grow on small screens to stay
 * readable).
 *
 * @param {number} outerRadius radius of the outer orbit, in map units
 * @param {number} areaWidth CSS pixels
 * @param {number} areaHeight CSS pixels
 */
function fitSystem(outerRadius, areaWidth, areaHeight) {
  let unitsPerPixel = MIN_UNITS_PER_PIXEL;

  // The label size depends on the scale and the other way round: a few rounds settle it.
  for (let round = 0; round < 3; round += 1) {
    const labelSize = labelSizeFor(unitsPerPixel);
    // About 7 characters of label on each side of the outer orbit.
    const halfWidth = Math.max(outerRadius + labelSize * 3.6, MIN_HALF_WIDTH);
    // A planet in front of the sun, enlarged, with its label below it.
    const front = (LARGEST_PLANET + labelSize + 6) * (1 + DEPTH);
    const halfHeight = Math.max(outerRadius * TILT + front, SUN_RADIUS * 2.8);

    unitsPerPixel = Math.max((halfWidth * 2) / areaWidth, (halfHeight * 2) / areaHeight, MIN_UNITS_PER_PIXEL);
  }

  return { unitsPerPixel, labelSize: labelSizeFor(unitsPerPixel) };
}

/**
 * Stable number in [0, 1) from a text (FNV-1a hash): each planet keeps its
 * speed from one refresh to the next.
 *
 * @param {string} text
 */
function hashOf(text) {
  let hash = 2166136261;

  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}

/**
 * Orbital period of a planet, in seconds: slower on outer orbits (roughly
 * like Kepler's law), and a little different for each planet (±20%).
 *
 * @param {number} radius
 * @param {string} uid
 */
function periodOf(radius, uid) {
  const base = BASE_PERIOD * (radius / FIRST_ORBIT) ** 1.3;

  return Math.round(base * (0.8 + hashOf(uid) * 0.4) * 10) / 10;
}

/**
 * How many planets each orbit holds: one per orbit up to MAX_ORBITS
 * planets, then proportionally to the orbit circumference.
 *
 * @param {number} count
 * @returns {number[]}
 */
function orbitSizes(count) {
  const orbitCount = Math.min(count, MAX_ORBITS);

  if (count <= MAX_ORBITS) {
    return Array.from({ length: orbitCount }, () => 1);
  }

  const radii = Array.from({ length: orbitCount }, (value, index) => FIRST_ORBIT + index * ORBIT_GAP);
  const total = radii.reduce((sum, radius) => sum + radius, 0);
  const sizes = radii.map((radius) => Math.max(1, Math.floor((count * radius) / total)));
  let remaining = count - sizes.reduce((sum, size) => sum + size, 0);
  let index = orbitCount - 1;

  // The rest goes to the outer orbits first: they have the most room.
  while (remaining > 0) {
    sizes[index] += 1;
    remaining -= 1;
    index -= 1;

    if (index < 0) {
      index = orbitCount - 1;
    }
  }

  return sizes;
}

/**
 * Text of a planet tooltip.
 *
 * @param {object} project
 * @param {{state: string, reasons: string[]}} health
 */
function tooltipOf(project, health) {
  if (health.state === 'system') {
    if (health.reasons.length > 0) {
      return `SolarOps itself — needs attention: ${health.reasons.join(', ')}`;
    }

    return 'SolarOps itself';
  }

  const kind = TYPE_LABELS[project.type] || project.type;

  if (health.state === 'disabled') {
    return `${project.name} (${kind}) — disabled`;
  }

  if (health.state === 'unhealthy') {
    return `${project.name} (${kind}) — needs attention: ${health.reasons.join(', ')}`;
  }

  return `${project.name} (${kind}) — healthy`;
}

/**
 * Planet radius: SolarOps, then applications, then static sites.
 */
function sizeOf(project) {
  if (project.system) {
    return 12;
  }

  if (project.type === 'static') {
    return 8.5;
  }

  return 10;
}

export default {
  name: 'SolarSystem',
  props: {
    /** Every project (SolarOps included), as returned by GET /api/projects. */
    projects: {
      type: Array,
      required: true,
    },
    /** Height kept free at the top (page header and numbers), in CSS pixels. */
    topInset: {
      type: Number,
      default: 0,
    },
  },
  emits: ['minimum-height'],
  data() {
    instanceCount += 1;
    const suffix = `solar-${instanceCount}`;

    // Gradient ids must be unique on the page.
    return {
      ids: {
        sun: `${suffix}-sun`,
        corona: `${suffix}-corona`,
        depth: `${suffix}-depth`,
        planet: `${suffix}-planet`,
        halo: `${suffix}-halo`,
      },
      palettes: PALETTES,
      sunRadius: SUN_RADIUS,
      tilt: TILT,
      // Rendered size of the component and of the legend, followed with a ResizeObserver.
      width: 0,
      height: 0,
      overlayHeight: 0,
      overlayOffset: 0,
      overlayRight: 0,
    };
  },
  computed: {
    /** SolarOps first (innermost orbit), then the projects in order. */
    bodies() {
      const sorted = [...this.projects].sort((first, second) => Number(second.system) - Number(first.system));

      return sorted.map((project) => {
        const health = projectHealth(project);

        return {
          uid: project.uid,
          name: project.name,
          state: health.state,
          reasons: health.reasons,
          size: sizeOf(project),
          ring: Boolean(project.network.enabled && project.network.domain),
          tooltip: tooltipOf(project, health),
        };
      });
    },
    /**
     * Orbits with their planets: starting angle, speed, and the phase of the
     * depth animation (bigger in front of the sun).
     */
    orbits() {
      const sizes = orbitSizes(this.bodies.length);
      const orbits = [];
      let next = 0;

      for (let index = 0; index < sizes.length; index += 1) {
        const bodies = this.bodies.slice(next, next + sizes[index]);
        const radius = FIRST_ORBIT + index * ORBIT_GAP;
        const phase = (index * GOLDEN_ANGLE) % 360;
        next += sizes[index];

        orbits.push({
          index,
          radius,
          planets: bodies.map((body, position) => {
            const angle = Math.round(phase + (360 / bodies.length) * position) % 360;
            const period = periodOf(radius, body.uid);
            // The depth cycle starts where the planet starts on its orbit.
            const depthDelay = Math.round((angle / 360 - 1) * period * 100) / 100;

            return {
              ...body,
              radius,
              angle,
              motion: { animationDuration: `${period}s` },
              depth: { animationDuration: `${period}s`, animationDelay: `${depthDelay}s` },
            };
          }),
        });
      }

      return orbits;
    },
    /** Every planet, placed (see orbits). */
    planets() {
      return this.orbits.flatMap((orbit) => orbit.planets);
    },
    /**
     * Map units per CSS pixel, label size and where the system sits: in the
     * free area below topInset, beside the legend (wide screens, the whole
     * height) or above it (narrow screens).
     */
    layout() {
      const width = this.width || 1200;
      const height = this.height || 760;
      const outerRadius = FIRST_ORBIT + (Math.max(this.orbits.length, 1) - 1) * ORBIT_GAP;
      const top = Math.min(this.topInset, Math.max(height - MIN_AREA_PX, 0));

      const besideLeft = this.overlayRight + SIDE_GAP_PX;
      const besideWidth = width - besideLeft - SIDE_GAP_PX;
      let fit;
      let centerX;
      let centerY;

      // Same rule as minimumHeight: beside the legend when there is room for it.
      if (besideWidth >= MIN_BESIDE_WIDTH_PX) {
        const besideHeight = Math.max(height - top - BOTTOM_GAP_PX, MIN_AREA_PX);

        fit = fitSystem(outerRadius, besideWidth, besideHeight);
        centerX = besideLeft + besideWidth / 2;
        centerY = top + besideHeight / 2;
      } else {
        const legend = this.overlayOffset + this.overlayHeight + BOTTOM_GAP_PX;
        const aboveHeight = Math.max(height - top - legend, MIN_AREA_PX);

        fit = fitSystem(outerRadius, width, aboveHeight);
        centerX = width / 2;
        centerY = top + aboveHeight / 2;
      }

      return {
        unitsPerPixel: fit.unitsPerPixel,
        labelSize: Math.round(fit.labelSize * 10) / 10,
        outerRadius,
        viewWidth: Math.round(width * fit.unitsPerPixel),
        viewHeight: Math.round(height * fit.unitsPerPixel),
        centerX: Math.round(centerX * fit.unitsPerPixel),
        centerY: Math.round(centerY * fit.unitsPerPixel),
      };
    },
    viewBox() {
      return `0 0 ${this.layout.viewWidth} ${this.layout.viewHeight}`;
    },
    /** As many stars as the surface calls for (about one per 6000 px²). */
    stars() {
      const width = this.width || 1200;
      const height = this.height || 760;
      const count = Math.min(STARS.length, Math.max(60, Math.round((width * height) / 6000)));

      return STARS.slice(0, count).map((star) => ({
        ...star,
        x: Math.round(star.x * this.layout.viewWidth),
        y: Math.round(star.y * this.layout.viewHeight),
        r: Math.round(star.r * Math.max(this.layout.unitsPerPixel, 1) * 10) / 10,
      }));
    },
    legend() {
      return LEGEND.map((entry) => ({
        ...entry,
        count: this.bodies.filter((body) => body.state === entry.state).length,
      }));
    },
    /** Planets with something to fix (SolarOps included), listed over the map. */
    attention() {
      return this.bodies.filter((body) => body.reasons.length > 0 && body.state !== 'disabled');
    },
    /**
     * Height needed below topInset: the parent makes the page at least that
     * tall. Beside the legend (wide screens), the system and the legend
     * share the height; above it (narrow screens), they stack. Decided on
     * the width only, so the page height never flips the layout back.
     */
    minimumHeight() {
      const legend = this.overlayOffset + this.overlayHeight + BOTTOM_GAP_PX;
      const besideWidth = this.width - this.overlayRight - SIDE_GAP_PX * 2;

      if (besideWidth >= MIN_BESIDE_WIDTH_PX) {
        return Math.max(MIN_AREA_PX + BOTTOM_GAP_PX, legend);
      }

      return MIN_AREA_PX + legend;
    },
    ariaLabel() {
      const counts = this.legend.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`).join(', ');

      return `Projects as a solar system: ${counts}.`;
    },
  },
  watch: {
    minimumHeight: {
      immediate: true,
      handler(height) {
        this.$emit('minimum-height', height);
      },
    },
  },
  mounted() {
    // Measured right away, then followed (the observer reports on the next frame).
    this.measure();
    this.observer = new ResizeObserver(() => {
      this.measure();
    });
    this.observer.observe(this.$el);
    this.observer.observe(this.$refs.overlay);
  },
  beforeUnmount() {
    this.observer.disconnect();
  },
  methods: {
    measure() {
      const rect = this.$el.getBoundingClientRect();
      const overlay = this.$refs.overlay.getBoundingClientRect();

      this.width = Math.round(rect.width);
      this.height = Math.round(rect.height);
      this.overlayHeight = Math.round(overlay.height);
      // Distance between the legend and the bottom edge (set in CSS), and its right edge.
      this.overlayOffset = Math.max(Math.round(rect.bottom - overlay.bottom), 0);
      this.overlayRight = Math.max(Math.round(overlay.right - rect.left), 0);
    },
    open(planet) {
      this.$router.push(`/projects/${planet.uid}`);
    },
  },
};
</script>

<style>
.solar {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.solar-map {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.solar-star {
  fill: #e4e4e7;
  opacity: 0.35;
  animation: solar-twinkle ease-in-out infinite alternate;
}

.solar-orbit {
  fill: none;
  stroke: rgba(255, 255, 255, 0.11);
  stroke-dasharray: 2 5;
}

.solar-corona {
  animation: solar-breathe 6s ease-in-out infinite;
}

/* Rotations happen around the local origin: the sun for orbits, the planet for the rest. */
.solar-spin,
.solar-counter,
.solar-depth,
.solar-planet,
.solar-alert,
.solar-corona {
  transform-box: view-box;
  transform-origin: 0 0;
}

.solar-spin {
  animation: solar-orbit linear infinite;
}

.solar-counter {
  animation: solar-counter linear infinite;
}

/* Same period as the orbit: bigger and brighter in front of the sun, smaller behind. */
.solar-depth {
  animation: solar-depth linear infinite;
}

/* The map covers the page: only a hovered (or focused) planet stops the orbits. */
.solar-map:has(.solar-planet:hover) .solar-spin,
.solar-map:has(.solar-planet:hover) .solar-counter,
.solar-map:has(.solar-planet:hover) .solar-depth,
.solar-map:focus-within .solar-spin,
.solar-map:focus-within .solar-counter,
.solar-map:focus-within .solar-depth {
  animation-play-state: paused;
}

.solar-planet {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.solar-planet:hover,
.solar-planet:focus-visible {
  transform: scale(1.18);
}

.solar-planet:focus {
  outline: none;
}

.solar-planet:focus-visible .solar-body {
  stroke: var(--accent);
  stroke-width: 2;
}

.solar-ring {
  fill: none;
  stroke-width: 1.4;
  stroke-opacity: 0.75;
}

.solar-planet.is-system .solar-ring {
  stroke: #c4b5fd;
}

.solar-planet.is-healthy .solar-ring {
  stroke: #93c5fd;
}

.solar-planet.is-unhealthy .solar-ring {
  stroke: #fca5a5;
}

.solar-planet.is-disabled .solar-ring {
  stroke: #a1a1aa;
  stroke-opacity: 0.4;
}

.solar-planet.is-disabled .solar-body {
  opacity: 0.55;
}

.solar-alert {
  fill: none;
  stroke: #f87171;
  stroke-width: 1.5;
  animation: solar-alert 1.8s ease-out infinite;
}

.solar-label {
  fill: var(--text-dim);
  text-anchor: middle;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(6, 6, 10, 0.9);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.solar-planet:hover .solar-label,
.solar-planet:focus-visible .solar-label {
  fill: var(--text);
}

.solar-planet.is-disabled .solar-label {
  fill: var(--text-faint);
}

/* Legend and attention list, floating over the bottom left corner. */
.solar-overlay {
  position: absolute;
  left: 40px;
  bottom: 32px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: max-content;
  max-width: calc(100% - 80px);
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(12, 12, 18, 0.55);
  border: 1px solid var(--border);
  backdrop-filter: blur(14px);
}

/* Each line of the legend stays on one line on large screens. */
.solar-legend {
  display: flex;
  flex-wrap: nowrap;
  white-space: nowrap;
  align-items: center;
  gap: 6px 16px;
  font-size: 13px;
}

.solar-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.solar-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.solar-dot.is-system {
  background: radial-gradient(circle at 35% 30%, #ede9fe, #7c3aed);
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.6);
}

.solar-dot.is-healthy {
  background: radial-gradient(circle at 35% 30%, #bae6fd, #2563eb);
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.5);
}

.solar-dot.is-unhealthy {
  background: radial-gradient(circle at 35% 30%, #fecaca, #dc2626);
  box-shadow: 0 0 8px rgba(248, 113, 113, 0.6);
}

.solar-dot.is-disabled {
  background: radial-gradient(circle at 35% 30%, #e4e4e7, #52525b);
  opacity: 0.7;
}

.solar-hint {
  white-space: nowrap;
}

.solar-attention {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.solar-attention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 10px;
  color: var(--text);
  background: var(--danger-soft);
  border: 1px solid rgba(248, 113, 113, 0.2);
}

.solar-attention-item:hover {
  border-color: rgba(248, 113, 113, 0.45);
}

@media (max-width: 960px) {
  .solar-overlay {
    left: 16px;
    right: 16px;
    bottom: 16px;
    width: auto;
    max-width: none;
  }

  .solar-legend {
    flex-wrap: wrap;
  }

  .solar-hint {
    white-space: normal;
  }
}

@keyframes solar-orbit {
  to {
    transform: rotate(-360deg);
  }
}

@keyframes solar-counter {
  to {
    transform: rotate(360deg);
  }
}

@keyframes solar-depth {
  0% {
    transform: scale(1);
    opacity: 0.9;
  }

  8.333% {
    transform: scale(0.93);
    opacity: 0.85;
  }

  16.667% {
    transform: scale(0.879);
    opacity: 0.813;
  }

  25% {
    transform: scale(0.86);
    opacity: 0.8;
  }

  33.333% {
    transform: scale(0.879);
    opacity: 0.813;
  }

  41.667% {
    transform: scale(0.93);
    opacity: 0.85;
  }

  50% {
    transform: scale(1);
    opacity: 0.9;
  }

  58.333% {
    transform: scale(1.07);
    opacity: 0.95;
  }

  66.667% {
    transform: scale(1.121);
    opacity: 0.987;
  }

  75% {
    transform: scale(1.14);
    opacity: 1;
  }

  83.333% {
    transform: scale(1.121);
    opacity: 0.987;
  }

  91.667% {
    transform: scale(1.07);
    opacity: 0.95;
  }

  100% {
    transform: scale(1);
    opacity: 0.9;
  }
}

@keyframes solar-twinkle {
  from {
    opacity: 0.15;
  }

  to {
    opacity: 0.7;
  }
}

@keyframes solar-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }

  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

@keyframes solar-alert {
  from {
    transform: scale(0.9);
    opacity: 0.9;
  }

  to {
    transform: scale(1.9);
    opacity: 0;
  }
}
</style>
