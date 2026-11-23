import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  antworteIosHuelle,
  beendeHuelle,
  type IosNachricht,
  meldeIosStandort,
  starteIosHuelle,
} from '../test/huelle';

/**
 * Standort über die Brücke der iOS-Hülle (LLH-2071, Entwurf
 * `docs/superpowers/specs/2026-11-23-ktrtv1lt-standort-app-huellen-design.md`): das Init-Skript
 * ersetzt `navigator.geolocation` und fragt die Hülle mit `location_current`, `location_watch` und
 * `location_clear`.
 */
function brueckeMit() {
  const nachrichten: IosNachricht[] = [];
  const postMessage = vi.fn((n: IosNachricht) => {
    nachrichten.push(n);
  });
  return { bruecke: { postMessage }, nachrichten };
}

const POSITION = {
  latitude: 52.1,
  longitude: 9.9,
  accuracy: 12,
  altitude: null,
  altitude_accuracy: null,
  heading: null,
  speed: null,
  timestamp: 1_700_000_000_000,
};

function geo(): Geolocation {
  return navigator.geolocation;
}

/** `getCurrentPosition` als Promise: erfüllt mit der Position, lehnt mit dem Fehler ab. */
function aktuell(optionen?: PositionOptions) {
  return new Promise<GeolocationPosition>((erfuellen, ablehnen) =>
    geo().getCurrentPosition(erfuellen, ablehnen, optionen),
  );
}

describe('Standort über die iOS-Hülle (LLH-2071)', () => {
  afterEach(() => {
    beendeHuelle();
    vi.useRealTimers();
  });

  it('getCurrentPosition fragt die Hülle und liefert eine GeolocationPosition', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const ergebnis = aktuell({ enableHighAccuracy: true, timeout: 15_000 });
    expect(nachrichten).toEqual([
      { cmd: 'location_current', id: 1, high_accuracy: true, timeout: 15_000 },
    ]);
    antworteIosHuelle(1, null, POSITION);
    const position = await ergebnis;
    expect(position.coords.latitude).toBe(52.1);
    expect(position.coords.longitude).toBe(9.9);
    expect(position.coords.accuracy).toBe(12);
    expect(position.coords.altitude).toBeNull();
    expect(position.coords.speed).toBeNull();
    expect(position.timestamp).toBe(1_700_000_000_000);
  });

  it('denied wird Code 1, unavailable Code 2, timeout Code 3', async () => {
    const { bruecke } = brueckeMit();
    starteIosHuelle({ bruecke });
    const codes: number[] = [];
    for (const [id, fehler] of [
      [1, 'denied'],
      [2, 'unavailable'],
      [3, 'timeout'],
    ] as const) {
      const ergebnis = aktuell().catch((e: GeolocationPositionError) => e);
      antworteIosHuelle(id, fehler);
      const e = (await ergebnis) as GeolocationPositionError;
      codes.push(e.code);
      expect(e.PERMISSION_DENIED).toBe(1);
      expect(e.POSITION_UNAVAILABLE).toBe(2);
      expect(e.TIMEOUT).toBe(3);
      expect(typeof e.message).toBe('string');
    }
    expect(codes).toEqual([1, 2, 3]);
  });

  it('ohne timeout schickt der Polyfill null und ohne enableHighAccuracy false', () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    geo().getCurrentPosition(() => {});
    geo().getCurrentPosition(() => {}, null, { timeout: Infinity });
    expect(nachrichten).toEqual([
      { cmd: 'location_current', id: 1, high_accuracy: false, timeout: null },
      { cmd: 'location_current', id: 2, high_accuracy: false, timeout: null },
    ]);
  });

  it('maximumAge liefert die letzte Position sofort ohne neue Nachricht', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_010_000);
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const erste = aktuell();
    antworteIosHuelle(1, null, POSITION);
    await erste;
    // 10 s alt: zu alt für 5 s, jung genug für 60 s.
    void aktuell({ maximumAge: 5_000 });
    expect(nachrichten).toHaveLength(2);
    const zweite = await aktuell({ maximumAge: 60_000 });
    expect(nachrichten).toHaveLength(2);
    expect(zweite.coords.latitude).toBe(52.1);
  });

  it('watchPosition liefert fortlaufend und clearWatch beendet nur diese Beobachtung', () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const a: number[] = [];
    const b: number[] = [];
    const ka = geo().watchPosition((p) => a.push(p.coords.latitude), null, { timeout: 15_000 });
    const kb = geo().watchPosition((p) => b.push(p.coords.latitude));
    expect(ka).not.toBe(kb);
    expect(nachrichten).toEqual([
      { cmd: 'location_watch', id: 1, high_accuracy: false, timeout: 15_000 },
      { cmd: 'location_watch', id: 2, high_accuracy: false, timeout: null },
    ]);
    meldeIosStandort(1, null, POSITION);
    meldeIosStandort(2, null, { ...POSITION, latitude: 53 });
    geo().clearWatch(ka);
    expect(nachrichten[2]).toEqual({ cmd: 'location_clear', watch: 1 });
    meldeIosStandort(1, null, { ...POSITION, latitude: 54 });
    meldeIosStandort(2, null, { ...POSITION, latitude: 55 });
    expect(a).toEqual([52.1]);
    expect(b).toEqual([53, 55]);
  });

  it('eine Beobachtung meldet Fehler und läuft nach timeout weiter', () => {
    const { bruecke } = brueckeMit();
    starteIosHuelle({ bruecke });
    const positionen: number[] = [];
    const fehler: number[] = [];
    geo().watchPosition(
      (p) => positionen.push(p.coords.latitude),
      (e) => fehler.push(e.code),
    );
    meldeIosStandort(1, 'timeout');
    meldeIosStandort(1, null, POSITION);
    meldeIosStandort(1, 'denied');
    expect(fehler).toEqual([3, 1]);
    expect(positionen).toEqual([52.1]);
  });

  it('clearWatch mit unbekannter Kennung tut nichts', () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    geo().clearWatch(99);
    expect(nachrichten).toEqual([]);
  });

  it('ohne Message-Handler bleibt navigator.geolocation unangetastet', () => {
    const vorher = navigator.geolocation;
    starteIosHuelle();
    expect(navigator.geolocation).toBe(vorher);
  });
});
