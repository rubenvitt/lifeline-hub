import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { merkeServerzeit, serverJetzt, serveruhrVergessenFuerTests } from './serveruhr';

const SERVER = Date.parse('2026-10-01T10:00:00Z');
const MINUTE = 60_000;

/** Antwort, deren `Date` die Serverzeit `serverMs` nennt (Sekunden abgeschnitten wie bei hyper). */
function antwort(serverMs: number, weitere: Record<string, string> = {}): Response {
  return new Response(null, {
    headers: { Date: new Date(serverMs).toUTCString(), ...weitere },
  });
}

/** Abstand von `serverJetzt()` zur Serverzeit `SERVER` in ms. */
function abweichung(): number {
  return serverJetzt().valueOf() - SERVER;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  serveruhrVergessenFuerTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Versatz zur Serveruhr (LFH-705)', () => {
  it('rechnet eine 5 min vorgehende Geräteuhr auf die Serverzeit zurück', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
  });

  it('rechnet auch eine nachgehende Geräteuhr vor', () => {
    vi.setSystemTime(SERVER - 3 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
  });

  it('nimmt die Mitte der Sekunde, weil Date abgeschnitten ist', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(antwort(SERVER + 900)); // Date nennt 10:00:00, nicht 10:00:00.900
    expect(abweichung()).toBe(500);
  });

  it('ohne Messung gilt die Geräteuhr', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    expect(abweichung()).toBe(5 * MINUTE);
  });

  it('korrigiert unterhalb der Rauschgrenze von 5 s nicht', () => {
    vi.setSystemTime(SERVER + 3_000);
    merkeServerzeit(antwort(SERVER));
    expect(abweichung()).toBe(3_000);
  });

  it('korrigiert ab der Rauschgrenze', () => {
    vi.setSystemTime(SERVER + 6_000);
    merkeServerzeit(antwort(SERVER));
    expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
  });

  it('die jüngste Messung ersetzt die ältere', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    // Die Geräteuhr wird gestellt und geht jetzt 2 min nach.
    vi.setSystemTime(SERVER - 2 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
  });

  it('nimmt den Empfangszeitpunkt der Antwort, nicht den Aufrufzeitpunkt', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE + 10_000);
    merkeServerzeit(antwort(SERVER), SERVER + 5 * MINUTE);
    // Seit dem Empfang sind 10 s vergangen, auch auf der Serveruhr.
    expect(serverJetzt().valueOf() - (SERVER + 10_000)).toBe(500);
  });

  it('übersteht ein Neuladen über localStorage', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    serveruhrVergessenFuerTests({ speicherBehalten: true });
    expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
  });

  it('vergisst den Versatz nach 24 h', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    serveruhrVergessenFuerTests({ speicherBehalten: true });
    vi.setSystemTime(SERVER + 5 * MINUTE + 24 * 60 * MINUTE + 1);
    expect(serverJetzt().valueOf()).toBe(Date.now());
  });

  it('ein Messwert aus der Zukunft der Geräteuhr gilt nicht', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(antwort(SERVER));
    serveruhrVergessenFuerTests({ speicherBehalten: true });
    // Die Uhr wurde zurückgestellt: das Alter der Messung ist negativ und nicht bestimmbar.
    vi.setSystemTime(SERVER);
    expect(serverJetzt().valueOf()).toBe(Date.now());
  });

  it('verwirft einen unlesbaren gespeicherten Wert', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    localStorage.setItem('lifeline-serveruhr', '{kaputt');
    expect(abweichung()).toBe(5 * MINUTE);
    localStorage.setItem('lifeline-serveruhr', JSON.stringify({ versatzMs: 'x', gemessenAt: 1 }));
    expect(abweichung()).toBe(5 * MINUTE);
  });

  it('ein werfender localStorage bricht nichts', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(() => merkeServerzeit(antwort(SERVER))).not.toThrow();
      // Die Messung im Speicher gilt trotzdem.
      expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('misst nicht ohne oder mit unlesbarem Date', () => {
    vi.setSystemTime(SERVER + 5 * MINUTE);
    merkeServerzeit(new Response(null));
    merkeServerzeit(new Response(null, { headers: { Date: 'gestern' } }));
    expect(abweichung()).toBe(5 * MINUTE);
  });
});

describe('Antworten aus dem Browser-Cache (LFH-705, D2)', () => {
  const NICHT_GEMESSEN: Record<string, Record<string, string>> = {
    'max-age > 0': { 'Cache-Control': 'private, max-age=300' },
    's-maxage > 0': { 'Cache-Control': 'public, s-maxage=60' },
    immutable: { 'Cache-Control': 'public, immutable' },
    Expires: { Expires: 'Thu, 01 Oct 2026 11:00:00 GMT' },
    'Last-Modified (heuristische Frische)': { 'Last-Modified': 'Wed, 30 Sep 2026 10:00:00 GMT' },
  };
  for (const [fall, kopf] of Object.entries(NICHT_GEMESSEN)) {
    it(`misst nicht bei ${fall}`, () => {
      vi.setSystemTime(SERVER + 5 * MINUTE);
      merkeServerzeit(antwort(SERVER, kopf));
      expect(abweichung()).toBe(5 * MINUTE);
    });
  }

  const GEMESSEN: Record<string, Record<string, string>> = {
    'ohne Cache-Header': {},
    'no-cache mit Last-Modified': {
      'Cache-Control': 'no-cache',
      'Last-Modified': 'Wed, 30 Sep 2026 10:00:00 GMT',
    },
    'no-store': { 'Cache-Control': 'no-store' },
    'max-age=0 mit Expires': {
      'Cache-Control': 'max-age=0',
      Expires: 'Thu, 01 Oct 2026 11:00:00 GMT',
    },
    'nur ETag': { ETag: '"abc"' },
  };
  for (const [fall, kopf] of Object.entries(GEMESSEN)) {
    it(`misst ${fall}`, () => {
      vi.setSystemTime(SERVER + 5 * MINUTE);
      merkeServerzeit(antwort(SERVER, kopf));
      expect(Math.abs(abweichung())).toBeLessThanOrEqual(1_000);
    });
  }
});
