import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { mitProzessZone } from '../test/prozessZone';
import {
  alsBackendZeit,
  alsZeitpunkt,
  ausWanduhr,
  browserZone,
  effektiveZone,
  heuteInZone,
  istZukunftstag,
  zuWanduhr,
} from './zeitEingabe';

dayjs.extend(utc);

const BERLIN = 'Europe/Berlin';
const W = 'YYYY-MM-DD HH:mm:ss';

/** Hin und zurück, wie es Dialog und Picker durchlaufen. */
function rund(wire: string, zone: string | null): string {
  return alsBackendZeit(ausWanduhr(zuWanduhr(alsZeitpunkt(wire)!, zone), zone));
}

describe('zeitEingabe — Browser UTC, Anzeigezone Europe/Berlin (LFH-692)', () => {
  mitProzessZone('UTC');

  it('die Prozesszone steht wirklich auf UTC (sonst wäre der Block blind)', () => {
    expect(browserZone()).toBe('UTC');
    // dayjs liefert unter UTC `-0`; `Object.is` unterschiede das von `0`.
    expect(dayjs('2026-07-14 12:00:00').utcOffset() === 0).toBe(true);
  });

  it('hinein: der Picker zeigt die Berliner Wanduhr, nicht die UTC-Uhrzeit', () => {
    const wanduhr = zuWanduhr(alsZeitpunkt('2026-07-14 10:00:00')!, BERLIN);
    expect(wanduhr.format(W)).toBe('2026-07-14 12:00:00');
  });

  it('heraus: eine im Picker gewählte 13:00 gilt in Berlin und wird 11:00 UTC', () => {
    const wanduhr = dayjs('2026-07-14 13:00:00'); // so baut antd den Wert: browserlokal
    expect(alsBackendZeit(ausWanduhr(wanduhr, BERLIN))).toBe('2026-07-14 11:00:00');
  });

  it('Rundweg ohne Änderung verschiebt nichts — Sommer, Winter, beide Umstellungen', () => {
    for (const wire of [
      '2026-07-14 10:00:00',
      '2026-01-14 10:00:00',
      '2026-03-29 00:30:00', // 01:30 MEZ, vor der Umstellung
      '2026-03-29 01:30:00', // 03:30 MESZ, nach der Umstellung
      '2026-10-24 23:30:00', // 01:30 MESZ
      '2026-10-25 02:30:00', // 03:30 MEZ
    ]) {
      expect(rund(wire, BERLIN)).toBe(wire);
    }
  });

  it('Umstellung im Oktober: 25.10.2026 01:30 Berlin ist 24.10. 23:30 UTC', () => {
    expect(alsBackendZeit(ausWanduhr(dayjs('2026-10-25 01:30:00'), BERLIN))).toBe(
      '2026-10-24 23:30:00',
    );
  });

  it('Umstellung im März: 29.03.2026 03:30 Berlin ist 01:30 UTC', () => {
    expect(alsBackendZeit(ausWanduhr(dayjs('2026-03-29 03:30:00'), BERLIN))).toBe(
      '2026-03-29 01:30:00',
    );
  });

  it('doppelte Stunde (25.10. 02:30 Berlin): ergibt einen der beiden echten Zeitpunkte', () => {
    const wire = alsBackendZeit(ausWanduhr(dayjs('2026-10-25 02:30:00'), BERLIN));
    expect(['2026-10-25 00:30:00', '2026-10-25 01:30:00']).toContain(wire);
  });

  it('heute und Zukunftstag nach dem Kalender der Anzeigezone', () => {
    const jetzt = dayjs.utc('2026-07-14 23:30:00'); // in Berlin schon der 15.07. 01:30
    expect(heuteInZone(BERLIN, jetzt)).toBe('2026-07-15');
    expect(istZukunftstag(dayjs('2026-07-15 08:00:00'), BERLIN, jetzt)).toBe(false);
    expect(istZukunftstag(dayjs('2026-07-16 00:00:00'), BERLIN, jetzt)).toBe(true);
  });
});

describe('zeitEingabe — Gegenprobe: Browser Europe/Berlin, Anzeigezone UTC', () => {
  mitProzessZone(BERLIN);

  it('hinein und heraus spiegeln sich', () => {
    expect(zuWanduhr(alsZeitpunkt('2026-07-14 10:00:00')!, 'UTC').format(W)).toBe(
      '2026-07-14 10:00:00',
    );
    expect(alsBackendZeit(ausWanduhr(dayjs('2026-07-14 13:00:00'), 'UTC'))).toBe(
      '2026-07-14 13:00:00',
    );
    expect(rund('2026-03-29 01:30:00', 'UTC')).toBe('2026-03-29 01:30:00');
  });

  it('nicht darstellbare Wanduhr (Lücke der Browserzone): gültiger Wert, nicht früher', () => {
    // 29.03.2026 02:30 gibt es in Berlin nicht; als Anzeigezone UTC ist es 02:30 UTC.
    const wanduhr = zuWanduhr(alsZeitpunkt('2026-03-29 02:30:00')!, 'UTC');
    expect(wanduhr.isValid()).toBe(true);
    expect(wanduhr.format(W) >= '2026-03-29 02:30:00').toBe(true);
  });
});

describe('zeitEingabe — Zone und Grenzfälle', () => {
  // Unter Berlin (≠ UTC): sonst wäre „Browser-Wanduhr“ von einem UTC-Modus-Dayjs nicht zu trennen.
  mitProzessZone(BERLIN);

  it('effektiveZone: gültige IANA-Zone bleibt, leer und ungültig → null', () => {
    expect(effektiveZone(BERLIN)).toBe(BERLIN);
    expect(effektiveZone(null)).toBeNull();
    expect(effektiveZone('')).toBeNull();
    expect(effektiveZone('Mars/Olympus')).toBeNull();
  });

  it('ungültige Zone: Wandlung fällt auf die Browserzone zurück statt zu werfen', () => {
    const d = alsZeitpunkt('2026-07-14 10:00:00')!;
    expect(() => zuWanduhr(d, 'Mars/Olympus')).not.toThrow();
    expect(zuWanduhr(d, 'Mars/Olympus').valueOf()).toBe(d.valueOf());
    // Die WANDUHR des Browsers (12:00 Berlin), nicht die UTC-Uhrzeit des Eingangs.
    expect(zuWanduhr(d, 'Mars/Olympus').format(W)).toBe('2026-07-14 12:00:00');
    expect(ausWanduhr(dayjs('2026-07-14 13:00:00'), 'Mars/Olympus').valueOf()).toBe(
      dayjs('2026-07-14 13:00:00').valueOf(),
    );
  });

  it('alsZeitpunkt liest UTC ohne Zonenkennung und verwirft Unbrauchbares ganz', () => {
    expect(alsZeitpunkt('2026-07-14 10:00:00')!.toISOString()).toBe('2026-07-14T10:00:00.000Z');
    expect(alsZeitpunkt(undefined)).toBeUndefined();
    expect(alsZeitpunkt(null)).toBeUndefined();
    expect(alsZeitpunkt('kein Datum')).toBeUndefined();
  });
});
