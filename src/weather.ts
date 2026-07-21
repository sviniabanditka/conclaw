/**
 * One line of weather for the morning rundown.
 *
 * Uses open-meteo, which needs no key and no OAuth, so nothing here touches the
 * credential path — a plain public request from the host.
 *
 * Cached rather than fetched per render: the rundown is re-rendered every minute
 * by the schedule sync, and a forecast does not change on that timescale.
 */
import { logger } from './logger.js';

/** WMO weather codes, collapsed to what a person actually wants to know. */
const CONDITIONS: [number[], string][] = [
  [[0], 'ясно'],
  [[1, 2], 'малооблачно'],
  [[3], 'облачно'],
  [[45, 48], 'туман'],
  [[51, 53, 55, 56, 57], 'морось'],
  [[61, 63, 65, 66, 67], 'дождь'],
  [[71, 73, 75, 77], 'снег'],
  [[80, 81, 82], 'ливни'],
  [[85, 86], 'снегопад'],
  [[95, 96, 99], 'гроза'],
];

export function describeCode(code: number): string {
  for (const [codes, label] of CONDITIONS) {
    if (codes.includes(code)) return label;
  }
  return 'без осадков';
}

export interface Forecast {
  min: number;
  max: number;
  code: number;
  precipitationChance: number;
}

export function forecastLine(f: Forecast): string {
  const temps =
    Math.round(f.min) === Math.round(f.max)
      ? `${Math.round(f.max)}°`
      : `${Math.round(f.min)}…${Math.round(f.max)}°`;
  const parts = [`🌤 ${temps}, ${describeCode(f.code)}`];
  // Only worth a mention when it is likely enough to change what you take out.
  if (f.precipitationChance >= 40) {
    parts.push(`осадки ${f.precipitationChance}%`);
  }
  return parts.join(', ');
}

export interface WeatherCacheDeps {
  latitude: number;
  longitude: number;
  timeZone: string;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_TTL_MS = 60 * 60_000;

export class WeatherCache {
  private deps: WeatherCacheDeps;
  private ttlMs: number;
  private fetchedAt = 0;
  private cached: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(deps: WeatherCacheDeps) {
    this.deps = deps;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Latest line, or null if never fetched successfully. Never blocks. */
  get line(): string | null {
    return this.cached;
  }

  /**
   * Refresh if stale. Safe to call on every sync tick: it no-ops inside the TTL
   * and collapses concurrent calls.
   */
  async refreshIfStale(): Promise<void> {
    const now = (this.deps.now ?? (() => Date.now()))();
    if (this.cached !== null && now - this.fetchedAt < this.ttlMs) return;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetch(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(now: number): Promise<void> {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${this.deps.latitude}&longitude=${this.deps.longitude}` +
      '&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code' +
      `&timezone=${encodeURIComponent(this.deps.timeZone)}&forecast_days=1`;

    try {
      const doFetch = this.deps.fetchImpl ?? fetch;
      const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        daily?: {
          temperature_2m_min?: number[];
          temperature_2m_max?: number[];
          weather_code?: number[];
          precipitation_probability_max?: (number | null)[];
        };
      };
      const d = body.daily;
      const min = d?.temperature_2m_min?.[0];
      const max = d?.temperature_2m_max?.[0];
      const code = d?.weather_code?.[0];
      if (min === undefined || max === undefined || code === undefined) {
        throw new Error('incomplete forecast');
      }
      this.cached = forecastLine({
        min,
        max,
        code,
        precipitationChance: d?.precipitation_probability_max?.[0] ?? 0,
      });
      this.fetchedAt = now;
    } catch (err) {
      // Keep whatever we had. A yesterday-shaped forecast beats dropping the
      // line from the rundown entirely, and weather is never worth failing on.
      logger.debug({ err }, 'Weather refresh failed');
    }
  }
}
