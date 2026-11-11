/**
 * The orbit: the company at the center, every store around it.
 *
 *  Center  — this week's labor so far. The thick arc is hours clocked against
 *            hours scheduled; the thin arc inside it is how much of the week
 *            has gone by, so "hours ahead of time" reads at a glance.
 *  Stores  — one node each, in the store's color: its own hours-vs-schedule
 *            arc, who is on the clock right now, labor so far, and a red
 *            count when something there needs attention. A line to the
 *            center carries a moving pulse while people are on the clock.
 *
 * Tap a store to focus the whole command center on it; tap the center for
 * all stores. Every number comes from the same queries as the panels around
 * it — the picture never has its own math.
 */
import { fmtHours, fmtMoney } from "@/lib/format";
import { useEffect, useRef, useState } from "react";
import { CountMoney } from "./hud";

export type OrbitStore = {
  name: string;
  short: string;
  color: string;
  clockHours: number;
  scheduled: number;
  labor: number;
  onClock: number;
  alerts: number;
  /** People on this store's team for the week. 0 = a store still being set up. */
  people: number;
};

const SIZE = 640;
const C = SIZE / 2;
/** Narrower than this on screen, the orbit switches to its compact drawing. */
const COMPACT_BELOW = 440;

/**
 * The drawing's proportions. The picture is one square that scales with its
 * panel, so on a phone (or in a narrow column) everything would shrink to
 * unreadable. The compact drawing spends the same square differently: bigger
 * stores, bigger type, and no outer dial. More than six stores make each
 * node a little smaller so they never touch.
 */
function geometry(count: number, compact: boolean) {
  const crowd = count <= 6 ? 1 : Math.max(0.58, 6.4 / count);
  return {
    orbitR: compact ? 222 : 214,
    nodeR: Math.round((compact ? 58 : 43) * crowd),
    coreR: compact ? 118 : 114,
    crowd,
  };
}

const arc = (r: number) => 2 * Math.PI * r;
const share = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;

export function OrbitCore({
  stores,
  focus,
  onFocus,
  label,
  labor,
  hours,
  scheduled,
  elapsed,
}: {
  stores: OrbitStore[];
  /** "all" or a store name. */
  focus: string;
  onFocus: (store: string) => void;
  /** What the center is showing, e.g. "LABOR · THIS WEEK". */
  label: string;
  labor: number;
  hours: number;
  scheduled: number;
  /** Share of the pay week that has passed (0–1), or null for a closed week. */
  elapsed: number | null;
}) {
  // The drawing follows the width it is given, not the window's.
  const wrap = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setCompact(el.clientWidth > 0 && el.clientWidth < COMPACT_BELOW);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, stores.length);
  const { orbitR: ORBIT_R, nodeR: NODE_R, coreR: CORE_R, crowd } = geometry(n, compact);
  const corePct = share(hours, scheduled);
  const coreLen = arc(CORE_R);
  const timeLen = arc(CORE_R - 13);
  const focused = focus !== "all";
  // Type sizes in the drawing's own units (they scale with it).
  const nameSize = (compact ? 22 : 15.5) * crowd;
  const liveSize = (compact ? 16.5 : 12.5) * crowd;
  const moneySize = (compact ? 19 : 14.5) * Math.max(crowd, 0.8);
  // The center figure shrinks to stay inside the ring when the number is long.
  const valueChars = fmtMoney(labor).replace(/\.\d+$/, "").length;
  const valueSize = Math.min(compact ? 47 : 37, ((CORE_R - 20) * 2 - 14) / (0.56 * valueChars));
  /** A long store label shrinks to stay inside its node. */
  const fitName = (label: string) =>
    Math.min(nameSize, ((NODE_R - 7) * 2) / (0.62 * Math.max(1, label.length)));

  return (
    <div ref={wrap}>
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="orbit"
      data-focused={focused}
      data-compact={compact}
      role="group"
      aria-label="Stores around the company. Pick a store to focus on it."
    >
      <defs>
        <linearGradient id="cc-core-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-red-bright)" />
          <stop offset="100%" stopColor="var(--brand-orange)" />
        </linearGradient>
        <radialGradient id="cc-sweep-grad" cx="50%" cy="50%" r="50%">
          <stop offset="30%" stopColor="var(--hud-accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--hud-accent)" stopOpacity="0.22" />
        </radialGradient>
      </defs>

      {/* Outer dial: a ring of ticks that turns slowly (roomy drawing only) */}
      {compact ? null : <circle className="ring" cx={C} cy={C} r={298} />}
      {compact ? null : (
      <g className="spin-slow" aria-hidden="true">
        {Array.from({ length: 72 }, (_, i) => {
          const major = i % 6 === 0;
          const a = (i * 5 * Math.PI) / 180;
          const r1 = major ? 282 : 288;
          return (
            <line
              key={i}
              className={major ? "tick tick-major" : "tick"}
              x1={C + r1 * Math.cos(a)}
              y1={C + r1 * Math.sin(a)}
              x2={C + 297 * Math.cos(a)}
              y2={C + 297 * Math.sin(a)}
            />
          );
        })}
      </g>
      )}

      {/* A slow sweep, like a scope */}
      <path
        className="sweep"
        aria-hidden="true"
        d={`M ${C} ${C} L ${C} ${C - ORBIT_R - 60} A ${ORBIT_R + 60} ${ORBIT_R + 60} 0 0 1 ${
          C + (ORBIT_R + 60) * Math.sin(Math.PI / 8)
        } ${C - (ORBIT_R + 60) * Math.cos(Math.PI / 8)} Z`}
      />

      {/* The stores' orbit and an inner counter-turning ring */}
      <circle className="ring ring-strong" cx={C} cy={C} r={ORBIT_R} strokeDasharray="2 9" />
      <g className="spin-rev" aria-hidden="true">
        <circle
          className="ring ring-strong"
          cx={C}
          cy={C}
          r={CORE_R + 36}
          strokeDasharray={`${arc(CORE_R + 36) / 6 - 26} 26`}
        />
      </g>

      {/* Spokes: a pulse travels in while people are on the clock */}
      {stores.map((s, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x1 = C + (ORBIT_R - NODE_R) * Math.cos(a);
        const y1 = C + (ORBIT_R - NODE_R) * Math.sin(a);
        const x2 = C + (CORE_R + 14) * Math.cos(a);
        const y2 = C + (CORE_R + 14) * Math.sin(a);
        return (
          <g key={s.name} style={{ ["--node" as string]: s.color }} aria-hidden="true">
            <line className="spoke" x1={x1} y1={y1} x2={x2} y2={y2} />
            {s.onClock > 0 ? (
              <line className="spoke-flow" x1={x2} y1={y2} x2={x1} y2={y1} />
            ) : null}
          </g>
        );
      })}

      {/* The core */}
      <circle className="core-disc" cx={C} cy={C} r={CORE_R - 20} />
      <circle className="core-track" cx={C} cy={C} r={CORE_R} strokeWidth={11} />
      <circle
        className="core-arc"
        cx={C}
        cy={C}
        r={CORE_R}
        strokeWidth={11}
        strokeDasharray={coreLen}
        strokeDashoffset={coreLen * (1 - corePct)}
        transform={`rotate(-90 ${C} ${C})`}
      />
      {elapsed !== null ? (
        <circle
          className="time-arc"
          cx={C}
          cy={C}
          r={CORE_R - 13}
          strokeWidth={2}
          strokeDasharray={timeLen}
          strokeDashoffset={timeLen * (1 - Math.max(0, Math.min(1, elapsed)))}
          transform={`rotate(-90 ${C} ${C})`}
        />
      ) : null}
      <text className="t-label" x={C} y={C - (compact ? 40 : 36)} textAnchor="middle">
        {label}
      </text>
      <text
        className="t-value"
        x={C}
        y={C + (compact ? 13 : 10)}
        textAnchor="middle"
        style={{ fontSize: valueSize }}
      >
        <CountMoney value={labor} />
      </text>
      <text className="t-sub" x={C} y={C + (compact ? 44 : 38)} textAnchor="middle">
        {fmtHours(hours)} / {fmtHours(scheduled)} h
      </text>
      {/* Anything pressable sits at the origin of its own group, and the group
          is what gets placed. The site's press feedback is a CSS transform,
          and a CSS transform REPLACES an SVG transform attribute — a button
          placed with its own attribute would jump to the corner while it is
          held, and the click would land on nothing. */}
      <g transform={`translate(${C} ${C})`}>
        <circle
          className="core-hit"
          r={CORE_R - 6}
          role="button"
          tabIndex={0}
          aria-label="Show all stores"
          aria-pressed={!focused}
          onClick={() => onFocus("all")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFocus("all");
            }
          }}
        />
      </g>

      {/* The stores */}
      {stores.map((s, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x = C + ORBIT_R * Math.cos(a);
        const y = C + ORBIT_R * Math.sin(a);
        const len = arc(NODE_R);
        const pct = share(s.clockHours, s.scheduled);
        const isFocus = focus === s.name;
        const over = s.scheduled > 0 && s.clockHours > s.scheduled;
        return (
          <g key={s.name} transform={`translate(${x} ${y})`}>
          <g
            className="node"
            data-focus={isFocus}
            style={{ ["--node" as string]: s.color }}
            role="button"
            tabIndex={0}
            aria-pressed={isFocus}
            aria-label={`${s.name}: ${
              s.people === 0
                ? "no team yet"
                : `${fmtHours(s.clockHours)} of ${fmtHours(s.scheduled)} hours, ${s.onClock} on the clock`
            }${s.alerts ? `, ${s.alerts} needing attention` : ""}. ${
              isFocus ? "Focused." : "Focus on this store."
            }`}
            onClick={() => onFocus(isFocus ? "all" : s.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFocus(isFocus ? "all" : s.name);
              }
            }}
          >
            <circle className="node-disc" r={NODE_R + 7} />
            <circle className="node-track" r={NODE_R} strokeWidth={5} />
            <circle
              className="node-arc"
              r={NODE_R}
              strokeWidth={5}
              strokeDasharray={len}
              strokeDashoffset={len * (1 - pct)}
              transform="rotate(-90)"
              style={over ? { stroke: "var(--warning)" } : undefined}
            />
            <text
              className="node-name"
              y={-NODE_R * 0.07}
              textAnchor="middle"
              style={{ fontSize: fitName(s.short) }}
            >
              {s.short}
            </text>
            {s.people === 0 ? (
              <text className="node-live" y={NODE_R * 0.4} textAnchor="middle" style={{ fontSize: liveSize }}>
                no team
              </text>
            ) : (
              <text
                className="node-live"
                data-on={s.onClock > 0}
                y={NODE_R * 0.4}
                textAnchor="middle"
                style={{ fontSize: liveSize }}
              >
                <tspan className="dot">●</tspan> {s.onClock} on
              </text>
            )}
            <text
              className="node-money"
              y={NODE_R + 9 + moneySize}
              textAnchor="middle"
              style={{ fontSize: moneySize }}
            >
              {s.people === 0 ? "set up" : <CountMoney value={s.labor} />}
            </text>
            {s.alerts > 0 ? (
              <g transform={`translate(${NODE_R - 4} ${-NODE_R + 2})`} aria-hidden="true">
                <circle className="node-alert" r={compact ? 15 : 12} />
                <text className="node-alert-text" y={compact ? 5 : 4} textAnchor="middle">
                  {s.alerts > 9 ? "9+" : s.alerts}
                </text>
              </g>
            ) : null}
          </g>
          </g>
        );
      })}
    </svg>
    </div>
  );
}
