/**
 * Weather line for the morning rundown.
 *
 * It is decoration on a message that matters, so the behaviour worth pinning is
 * that it never gets in the way: a failed fetch keeps the last line rather than
 * blanking it, and the rundown is never blocked waiting for a forecast.
 */
import { describe, it, expect, vi } from 'vitest';

import { WeatherCache, forecastLine, describeCode } from './weather.js';

function response(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

function daily(over: Record<string, unknown> = {}) {
  return {
    daily: {
      temperature_2m_min: [17],
      temperature_2m_max: [28],
      weather_code: [61],
      precipitation_probability_max: [70],
      ...over,
    },
  };
}

describe('forecastLine', () => {
  it('shows a range and the condition', () => {
    expect(
      forecastLine({ min: 17.4, max: 28.1, code: 0, precipitationChance: 0 }),
    ).toBe('🌤 17…28°, ясно');
  });

  it('collapses a flat range to one number', () => {
    expect(
      forecastLine({ min: 20, max: 20, code: 3, precipitationChance: 0 }),
    ).toBe('🌤 20°, облачно');
  });

  // Only worth saying when it would change what you take with you.
  it('mentions rain only when it is likely', () => {
    const likely = forecastLine({ min: 10, max: 15, code: 61, precipitationChance: 70 });
    const unlikely = forecastLine({ min: 10, max: 15, code: 61, precipitationChance: 10 });
    expect(likely).toContain('осадки 70%');
    expect(unlikely).not.toContain('осадки');
  });

  it('names the common conditions', () => {
    expect(describeCode(0)).toBe('ясно');
    expect(describeCode(95)).toBe('гроза');
    expect(describeCode(71)).toBe('снег');
  });

  it('falls back for an unknown code', () => {
    expect(describeCode(999)).toBe('без осадков');
  });
});

describe('WeatherCache', () => {
  function make(fetchImpl: ReturnType<typeof vi.fn>, now = () => 1000) {
    return new WeatherCache({
      latitude: 50.45,
      longitude: 30.52,
      timeZone: 'Europe/Kyiv',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
  }

  it('has nothing before the first fetch', () => {
    expect(make(vi.fn()).line).toBeNull();
  });

  it('renders after fetching', async () => {
    const w = make(vi.fn().mockResolvedValue(response(daily())));
    await w.refreshIfStale();
    expect(w.line).toContain('17…28°');
    expect(w.line).toContain('дождь');
  });

  it('does not refetch inside the TTL', async () => {
    const f = vi.fn().mockResolvedValue(response(daily()));
    const w = make(f);
    await w.refreshIfStale();
    await w.refreshIfStale();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has passed', async () => {
    const f = vi.fn().mockResolvedValue(response(daily()));
    let clock = 1000;
    const w = make(f, () => clock);
    await w.refreshIfStale();
    clock += 2 * 60 * 60_000;
    await w.refreshIfStale();
    expect(f).toHaveBeenCalledTimes(2);
  });

  // Weather is decoration; a network blip must not blank the rundown's line.
  it('keeps the previous line when a refresh fails', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(daily()));
    let clock = 1000;
    const w = make(f, () => clock);
    await w.refreshIfStale();
    const before = w.line;

    f.mockRejectedValue(new Error('network down'));
    clock += 2 * 60 * 60_000;
    await w.refreshIfStale();

    expect(w.line).toBe(before);
  });

  it('stays null rather than throwing when the first fetch fails', async () => {
    const w = make(vi.fn().mockRejectedValue(new Error('nope')));
    await expect(w.refreshIfStale()).resolves.toBeUndefined();
    expect(w.line).toBeNull();
  });

  it('ignores an incomplete forecast', async () => {
    const w = make(
      vi.fn().mockResolvedValue(response({ daily: { temperature_2m_min: [1] } })),
    );
    await w.refreshIfStale();
    expect(w.line).toBeNull();
  });

  it('collapses concurrent refreshes into one request', async () => {
    const f = vi.fn().mockResolvedValue(response(daily()));
    const w = make(f);
    await Promise.all([w.refreshIfStale(), w.refreshIfStale(), w.refreshIfStale()]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
