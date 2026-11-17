<template>
  <div ref="root" class="usage-chart" :style="{ height: `${height}px` }">
    <svg
      v-if="width > 0"
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="ariaLabel"
      @pointermove="onPointerMove"
      @pointerleave="hovered = null"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- Gridlines and the percent axis. -->
      <g class="usage-chart-grid">
        <g v-for="tick in yTicks" :key="tick.value">
          <line :x1="plot.left" :x2="plot.right" :y1="tick.y" :y2="tick.y" />
          <text :x="plot.left - 8" :y="tick.y" text-anchor="end" dominant-baseline="middle">{{ tick.label }}</text>
        </g>
        <text v-for="tick in xTicks" :key="tick.at" :x="tick.x" :y="height - 4" text-anchor="middle">
          {{ tick.label }}
        </text>
      </g>

      <path
        v-for="(segment, index) in segments"
        :key="`area-${index}`"
        :d="segment.area"
        :fill="`url(#${gradientId})`"
      />
      <path v-for="(segment, index) in segments" :key="`line-${index}`" :d="segment.line" class="usage-chart-line" />

      <g v-if="hovered" class="usage-chart-hover">
        <line :x1="hovered.x" :x2="hovered.x" :y1="plot.top" :y2="plot.bottom" />
        <circle :cx="hovered.x" :cy="hovered.y" r="4" />
      </g>
    </svg>

    <div v-if="samples.length === 0" class="usage-chart-empty small text-faint">
      <slot name="empty">No sample yet.</slot>
    </div>

    <div v-if="hovered" class="usage-chart-tooltip" :style="tooltipStyle">
      <div class="tiny text-faint">{{ hoveredTime }}</div>
      <div class="usage-chart-tooltip-value">
        <span class="usage-chart-key"></span>
        {{ tooltip.value }}
      </div>
      <div v-if="tooltip.detail" class="tiny text-dim">{{ tooltip.detail }}</div>
    </div>
  </div>
</template>

<script>
/**
 * A percentage over the last 24 hours (System › Monitoring): one line,
 * 0 to 100%, with a crosshair and a tooltip on hover. Samples further apart
 * than `gapMs` are not joined (SolarOps was not running in between).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_HOURS = 6;
const PADDING = { top: 10, right: 8, bottom: 24, left: 40 };

let chartSequence = 0;

export default {
  name: 'UsageChart',
  props: {
    /** [{ at: ms timestamp, value: percent }], oldest first. */
    samples: {
      type: Array,
      required: true,
    },
    /** Tooltip text of a sample: { value, detail }. */
    describe: {
      type: Function,
      required: true,
    },
    /** What the chart shows, for screen readers. */
    label: {
      type: String,
      required: true,
    },
    /** The right edge of the chart (ms timestamp). */
    now: {
      type: Number,
      required: true,
    },
    gapMs: {
      type: Number,
      default: 3 * 60 * 1000,
    },
    height: {
      type: Number,
      default: 220,
    },
  },
  data() {
    chartSequence += 1;

    return {
      width: 0,
      hovered: null,
      gradientId: `usage-chart-fill-${chartSequence}`,
    };
  },
  computed: {
    start() {
      return this.now - DAY_MS;
    },
    plot() {
      return {
        left: PADDING.left,
        right: this.width - PADDING.right,
        top: PADDING.top,
        bottom: this.height - PADDING.bottom,
      };
    },
    yTicks() {
      return [0, 25, 50, 75, 100].map((value) => ({ value, y: this.yOf(value), label: `${value}%` }));
    },
    /** Every 6 hours, on the hour (local time). */
    xTicks() {
      const first = new Date(this.start);
      first.setMinutes(0, 0, 0);
      first.setHours(Math.ceil((first.getHours() + 1) / TICK_HOURS) * TICK_HOURS);

      const ticks = [];

      for (let at = first.getTime(); at <= this.now; at += TICK_HOURS * 60 * 60 * 1000) {
        const x = this.xOf(at);

        // Keep the labels inside the plot.
        if (x > this.plot.left + 16 && x < this.plot.right - 16) {
          const time = new Date(at);
          ticks.push({ at, x, label: `${String(time.getHours()).padStart(2, '0')}:00` });
        }
      }

      return ticks;
    },
    /** The line and its area, one pair per run of samples without a gap. */
    segments() {
      const visible = this.samples.filter((sample) => sample.at >= this.start);
      const runs = [];
      let run = [];

      for (const sample of visible) {
        const last = run[run.length - 1];

        if (last && sample.at - last.at > this.gapMs) {
          runs.push(run);
          run = [];
        }

        run.push(sample);
      }

      if (run.length > 0) {
        runs.push(run);
      }

      return runs.map((points) => {
        const coordinates = points.map(
          (sample) => `${this.xOf(sample.at).toFixed(1)},${this.yOf(sample.value).toFixed(1)}`,
        );
        const line = `M${coordinates.join('L')}`;
        const baseline = this.plot.bottom.toFixed(1);
        const firstX = this.xOf(points[0].at).toFixed(1);
        const lastX = this.xOf(points[points.length - 1].at).toFixed(1);

        return { line, area: `${line}L${lastX},${baseline}L${firstX},${baseline}Z` };
      });
    },
    tooltip() {
      return this.describe(this.hovered.sample);
    },
    hoveredTime() {
      return new Date(this.hovered.sample.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    /** Beside the crosshair, on the side with room. */
    tooltipStyle() {
      const style = { top: `${PADDING.top}px` };

      if (this.hovered.x > this.width / 2) {
        style.right = `${this.width - this.hovered.x + 12}px`;
      } else {
        style.left = `${this.hovered.x + 12}px`;
      }

      return style;
    },
    ariaLabel() {
      const last = this.samples[this.samples.length - 1];

      if (!last) {
        return `${this.label}: no sample yet.`;
      }

      return `${this.label} over the last 24 hours, ${this.samples.length} samples, now ${Math.round(last.value)}%.`;
    },
  },
  mounted() {
    this.resizeObserver = new ResizeObserver(() => {
      this.width = this.$refs.root.clientWidth;
    });
    this.resizeObserver.observe(this.$refs.root);
    this.width = this.$refs.root.clientWidth;
  },
  beforeUnmount() {
    this.resizeObserver.disconnect();
  },
  methods: {
    xOf(at) {
      return this.plot.left + ((at - this.start) / DAY_MS) * (this.plot.right - this.plot.left);
    },
    yOf(value) {
      const clamped = Math.min(Math.max(value, 0), 100);

      return this.plot.top + (1 - clamped / 100) * (this.plot.bottom - this.plot.top);
    },
    /** The crosshair snaps to the nearest sample. */
    onPointerMove(event) {
      if (this.samples.length === 0) {
        return;
      }

      const box = event.currentTarget.getBoundingClientRect();
      const at =
        this.start + ((event.clientX - box.left - this.plot.left) / (this.plot.right - this.plot.left)) * DAY_MS;
      let nearest = this.samples[0];

      for (const sample of this.samples) {
        if (Math.abs(sample.at - at) < Math.abs(nearest.at - at)) {
          nearest = sample;
        }
      }

      this.hovered = { sample: nearest, x: this.xOf(nearest.at), y: this.yOf(nearest.value) };
    },
  },
};
</script>

<style>
.usage-chart {
  position: relative;
  width: 100%;
  min-width: 0;
}

.usage-chart svg {
  display: block;
  overflow: visible;
}

.usage-chart-grid line {
  stroke: rgba(255, 255, 255, 0.06);
  stroke-width: 1;
}

.usage-chart-grid text {
  fill: var(--text-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.usage-chart-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.usage-chart-hover line {
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 1;
}

.usage-chart-hover circle {
  fill: var(--accent);
  stroke: #16161c;
  stroke-width: 2;
}

.usage-chart-empty {
  position: absolute;
  inset: 0 0 24px 40px;
  display: grid;
  place-items: center;
  text-align: center;
}

.usage-chart-tooltip {
  position: absolute;
  z-index: 2;
  min-width: 120px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.usage-chart-tooltip-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* A short line key: the series' mark. */
.usage-chart-key {
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}
</style>
