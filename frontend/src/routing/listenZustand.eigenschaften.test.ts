import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { listenZustandParams, parseListenZustand, type ListenZustandAdresse } from './deeplinks';

/**
 * Property-Tests des Listenzustands in der Adresse (LLH-2090, `src/AGENTS.md`,
 * „Backend↔Frontend — Property-Tests“): Sortierung, Filter und Suche überstehen den Weg durch die
 * Adresse für JEDE Eingabe, nicht nur für die Beispiele in `listenZustand.test.ts`. Was dabei wegfällt, steht in
 * `erwartet`: leere Filter und eine Suche aus Leerraum mit Absicht, ein Filter aus genau einem
 * leeren Wert (`[""]`) als bekannte Grenze. Er kodiert zu `f.x=` und gilt beim Lesen als leer;
 * fast-check fand ihn am 24.11.2026. Ohne Folgen, solange `bereinigeListenZustand`
 * (`components/listenGedaechtnis.ts`) leere Werte ohnehin verwirft und keine Spalte `value: ''`
 * anbietet. Wer das ändert, kodiert den leeren Wert eindeutig und streicht die Ausnahme. Ein
 * Filter namens `__proto__` fällt mit Absicht weg (fast-check fand, dass er den Prototyp des
 * Filters verbog; Beispieltest in `listenZustand.test.ts`).
 */

const rundlauf = (zustand: ListenZustandAdresse, vorher: URLSearchParams) =>
  parseListenZustand(new URLSearchParams(listenZustandParams(vorher, zustand).toString()));

/** Was nach dem Rundlauf ankommen muss: `zustand` ohne das, was die Kodierung bewusst verwirft. */
const erwartet = (zustand: ListenZustandAdresse): ListenZustandAdresse => ({
  sortierung: zustand.sortierung,
  filter: Object.fromEntries(
    Object.entries(zustand.filter).filter(
      ([spalte, werte]) =>
        spalte !== '__proto__' && werte.length > 0 && !(werte.length === 1 && werte[0] === ''),
    ),
  ),
  suche: zustand.suche.trim() === '' ? '' : zustand.suche,
});

const zustand: fc.Arbitrary<ListenZustandAdresse> = fc.record({
  sortierung: fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.record({
      spalte: fc.string({ minLength: 1, unit: 'binary' }),
      richtung: fc.constantFrom('auf' as const, 'ab' as const),
    }),
  ),
  filter: fc.dictionary(
    fc.string({ minLength: 1, unit: 'binary' }),
    fc.array(fc.string({ unit: 'binary' }), { maxLength: 4 }),
  ),
  suche: fc.string({ unit: 'binary' }),
});

/** Fremde Parameter einer Seite (`?neu=1`, `?einheit=`), die der Listenzustand nicht anfasst. */
const fremde = fc
  .array(fc.tuple(fc.constantFrom('neu', 'einheit', 'tab'), fc.string()), { maxLength: 3 })
  .map((paare) => new URLSearchParams(paare));

describe('Listenzustand in der Adresse, Eigenschaften (LLH-2090)', () => {
  it('jeder Zustand übersteht den Rundlauf durch die Adresse', () => {
    fc.assert(
      fc.property(zustand, fremde, (z, vorher) => {
        expect(rundlauf(z, vorher)).toEqual(erwartet(z));
      }),
    );
  });

  it('fremde Parameter bleiben unverändert stehen', () => {
    fc.assert(
      fc.property(zustand, fremde, (z, vorher) => {
        const nachher = listenZustandParams(vorher, z);
        for (const name of ['neu', 'einheit', 'tab'])
          expect(nachher.getAll(name)).toEqual(vorher.getAll(name));
      }),
    );
  });

  it('zweimal schreiben ergibt dieselbe Adresse wie einmal', () => {
    fc.assert(
      fc.property(zustand, fremde, (z, vorher) => {
        const einmal = listenZustandParams(vorher, z);
        expect(listenZustandParams(einmal, z).toString()).toBe(einmal.toString());
      }),
    );
  });
});
