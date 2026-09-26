/**
 * Compatibility contract adopted from sid-station-pro.
 *
 * The workstation keeps its existing SID worklet protocol and telemetry, but
 * uses these shared normalization rules at the public boundary so trace data,
 * clocks, seeks, and playback speed behave consistently with SidStationPro.
 */
import { SidEvent } from '../types';

export const MIN_SPEED = 0.125;
export const MAX_SPEED = 16;
export const MAX_SEEK_CYCLES = 10_000_000;

const bounded = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const normalizeClock = (value: unknown, fallback: number): number =>
  Math.round(bounded(value, 1, 5_000_000, fallback));

export const normalizeCycle = (value: unknown): number =>
  Math.floor(bounded(value, 0, MAX_SEEK_CYCLES, 0));

export const normalizeSidReg = (value: unknown): number => {
  let reg = Number(value);
  if (!Number.isFinite(reg)) return 0;
  reg = Math.trunc(reg);
  if (reg >= 0xd400 && reg <= 0xd41f) reg &= 0x1f;
  return reg & 0x1f;
};

export const normalizeSidVal = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? (Math.trunc(n) & 0xff) : 0;
};

export const normalizeSpeed = (value: unknown): number =>
  bounded(value, MIN_SPEED, MAX_SPEED, 1);

export const stableSortEvents = (events: SidEvent[]): SidEvent[] =>
  (Array.isArray(events) ? events : [])
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const cycleA = normalizeCycle(a.event.cycles);
      const cycleB = normalizeCycle(b.event.cycles);
      return cycleA === cycleB ? a.index - b.index : cycleA - cycleB;
    })
    .map(({ event }) => ({
      cycles: normalizeCycle(event.cycles),
      reg: normalizeSidReg(event.reg),
      val: normalizeSidVal(event.val)
    }));
