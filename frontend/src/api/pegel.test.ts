import { describe, expect, it } from 'vitest';
import type { PegelAnzeige } from './types';
import { PEGEL_ABRUF_MS, PEGEL_NACHFRAGE_MS, fehlendeSignatur, naechsterPegelAbruf } from './pegel';

const eintrag = (uuid: string, mitMessung: boolean): PegelAnzeige => ({
  id: 1,
  station_uuid: uuid,
  name: uuid,
  reihenfolge: 0,
  ...(mitMessung ? { messung: { wasserstand_cm: 1, zeitpunkt: '2026-09-22T14:05:00+02:00' } } : {}),
});

describe('fehlendeSignatur', () => {
  it('nennt die uuids ohne Messung sortiert, ohne Lücke null', () => {
    expect(fehlendeSignatur([eintrag('b', false), eintrag('a', false), eintrag('c', true)])).toBe(
      'a,b',
    );
    expect(fehlendeSignatur([eintrag('a', true)])).toBeNull();
    expect(fehlendeSignatur(undefined)).toBeNull();
  });
});

/**
 * Die Nachfrage-Regel (Prüfliste O2): einmal kurz je Lücke, danach der Takt. Die Folge unten
 * spielt nach, was TanStack tut — `refetchInterval` wird bei jedem Render und jeder
 * Zustandsänderung neu ausgewertet, nicht nur nach einem Abruf.
 */
describe('naechsterPegelAbruf', () => {
  it('ohne Lücke gilt der 5-min-Takt', () => {
    expect(naechsterPegelAbruf([eintrag('a', true)], 100, null)).toEqual({
      ms: PEGEL_ABRUF_MS,
      vermerk: null,
    });
  });

  it('eine neue Lücke fragt kurz nach — und bleibt dabei, solange der Datenstand gleich ist', () => {
    const daten = [eintrag('a', true), eintrag('b', false)];
    const erst = naechsterPegelAbruf(daten, 100, null);
    expect(erst.ms).toBe(PEGEL_NACHFRAGE_MS);
    // Erneut ausgewertet (Render, isFetching-Wechsel) OHNE neuen Datenstand: weiter kurz.
    // Ein Vermerk „schon erledigt“ an dieser Stelle setzte das Intervall zurück, bevor es feuert.
    const nochmal = naechsterPegelAbruf(daten, 100, erst.vermerk);
    expect(nochmal.ms).toBe(PEGEL_NACHFRAGE_MS);
    expect(nochmal.vermerk).toEqual(erst.vermerk);
  });

  it('kam die Nachfrage und fehlt die Messung weiter, gilt wieder der Takt — keine Schleife', () => {
    const daten = [eintrag('b', false)];
    const erst = naechsterPegelAbruf(daten, 100, null);
    const danach = naechsterPegelAbruf(daten, 10_100, erst.vermerk);
    expect(danach.ms).toBe(PEGEL_ABRUF_MS);
    const spaeter = naechsterPegelAbruf(daten, 310_100, danach.vermerk);
    expect(spaeter.ms).toBe(PEGEL_ABRUF_MS);
  });

  it('eine andere Lücke (neue Station festgelegt) bekommt ihre eigene Nachfrage', () => {
    const erst = naechsterPegelAbruf([eintrag('b', false)], 100, null);
    const danach = naechsterPegelAbruf([eintrag('b', false)], 10_100, erst.vermerk);
    const neu = naechsterPegelAbruf(
      [eintrag('b', false), eintrag('c', false)],
      20_000,
      danach.vermerk,
    );
    expect(neu.ms).toBe(PEGEL_NACHFRAGE_MS);
  });

  it('ist die Messung da, fällt der Vermerk weg', () => {
    const erst = naechsterPegelAbruf([eintrag('b', false)], 100, null);
    expect(naechsterPegelAbruf([eintrag('b', true)], 10_100, erst.vermerk)).toEqual({
      ms: PEGEL_ABRUF_MS,
      vermerk: null,
    });
  });
});
