import { describe, expect, it } from 'vitest';
import { DEMO_ZUSATZ, dispositionsOptionen } from './demoMarke';

type Zeile = { id: number; name: string; demo: boolean };

const label = (z: Zeile) => z.name;

/**
 * LFH-733, design.md D5: Demo-Stammdaten bleiben in der Auswahl, tragen „Demo“ im Wortlaut und
 * stehen hinter allen Einträgen ohne Marke. In beiden Gruppen bleibt die Reihenfolge des
 * Servers.
 */
describe('dispositionsOptionen', () => {
  it('hängt „ · Demo“ nur an markierte Einträge', () => {
    expect(DEMO_ZUSATZ).toBe(' · Demo');
    expect(
      dispositionsOptionen(
        [
          { id: 1, name: 'Musterstadt 83-1 (RTW)', demo: true },
          { id: 2, name: 'Florian 1 (LF 20)', demo: false },
        ],
        label,
      ),
    ).toEqual([
      { value: 2, label: 'Florian 1 (LF 20)' },
      { value: 1, label: 'Musterstadt 83-1 (RTW) · Demo' },
    ]);
  });

  it('sortiert stabil: ohne Marke zuerst, Serverreihenfolge in beiden Gruppen', () => {
    const zeilen: Zeile[] = [
      { id: 1, name: 'A', demo: true },
      { id: 2, name: 'B', demo: false },
      { id: 3, name: 'C', demo: true },
      { id: 4, name: 'D', demo: false },
      { id: 5, name: 'E', demo: false },
    ];
    expect(dispositionsOptionen(zeilen, label).map((o) => o.value)).toEqual([2, 4, 5, 1, 3]);
  });

  it('lässt eine Liste ohne Marke in Wortlaut und Reihenfolge unverändert', () => {
    const zeilen: Zeile[] = [
      { id: 9, name: 'Zeta', demo: false },
      { id: 3, name: 'Alpha', demo: false },
    ];
    expect(dispositionsOptionen(zeilen, label)).toEqual([
      { value: 9, label: 'Zeta' },
      { value: 3, label: 'Alpha' },
    ]);
  });

  it('liest ein fehlendes Feld wie „ohne Marke“ (Antwort aus einem älteren Cache)', () => {
    const alt = [{ id: 1, name: 'Florian 1' }] as unknown as Zeile[];
    expect(dispositionsOptionen(alt, label)).toEqual([{ value: 1, label: 'Florian 1' }]);
  });
});
