import { describe, expect, it } from 'vitest';
import { bezirkMenue } from './BezirkTabelle';

// „Auf Karte zeigen“ nur mit einem Ziel auf der Karte: Fläche oder Sammelstellen-Marker (LLH-1393).
const OHNE = {
  flaechen: 0,
  sammelstelle_lat: null,
  sammelstelle_lon: null,
  raeumung: 'laeuft',
  storniert_at: null,
} as const;
const MIT_PUNKT = { ...OHNE, sammelstelle_lat: 52.1, sammelstelle_lon: 9.36 };
const zeigt = (b: Parameters<typeof bezirkMenue>[0]) =>
  bezirkMenue(b, false, false).some((e) => e.key === 'karte');

describe('bezirkMenue: Auf Karte zeigen', () => {
  it('mit Fläche', () => expect(zeigt({ ...OHNE, flaechen: 1 })).toBe(true));
  it('ohne Fläche mit verorteter Sammelstelle', () => expect(zeigt(MIT_PUNKT)).toBe(true));
  it('ohne Fläche und ohne Punkt nicht', () => expect(zeigt(OHNE)).toBe(false));
  it('aufgehoben: die Karte zeigt die Sammelstelle nicht, also kein Sprung', () =>
    expect(zeigt({ ...MIT_PUNKT, raeumung: 'aufgehoben' })).toBe(false));
  it('storniert: kein Sprung zur Sammelstelle', () =>
    expect(zeigt({ ...MIT_PUNKT, storniert_at: '2026-11-02T10:00:00Z' })).toBe(false));
});
