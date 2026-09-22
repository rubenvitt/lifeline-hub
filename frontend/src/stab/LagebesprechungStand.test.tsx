import { act, screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lagebesprechung, Stab } from '../api/types';
import { renderMitProviders } from '../test/utils';
import LagebesprechungStand from './LagebesprechungStand';

/**
 * Hier werden die TIMER gefälscht, weil die 30-s-Uhr das Prüfobjekt ist. `shouldAdvanceTime`
 * wie in `etb/WiedervorlageModal.test.tsx`: die echte Zeit läuft mit. Die Termine liegen
 * deshalb neben der Minutengrenze (Takt-Test: siehe dort), damit ein paar echte Millisekunden
 * die abgerundete Zahl nicht kippen. Kein `findBy*` — alles rendert synchron.
 */
const JETZT = new Date('2026-09-13T10:00:00Z');
const wireAb = (sekunden: number) =>
  dayjs(JETZT).add(sekunden, 'second').utc().format('YYYY-MM-DD HH:mm:ss');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(JETZT);
});
afterEach(() => vi.useRealTimers());

const letzte = (over: Partial<Lagebesprechung> = {}): Lagebesprechung => ({
  id: 9,
  einsatz_id: 1,
  lfd_nr: 3,
  abgehalten_at: '2026-09-13 09:00:00',
  entschluss: 'Lage unverändert',
  etb_eintrag_id: 77,
  erfasst_von_id: 1,
  erfasst_at: '2026-09-13 09:00:01',
  ...over,
});
const stab = (over: Partial<Stab> = {}): Stab => ({
  anzahl_lagebesprechungen: 3,
  besetzung: [],
  ...over,
});

function zeige(daten: Stab) {
  return renderMitProviders(<LagebesprechungStand einsatzId={1} stab={daten} />);
}
/**
 * Feld des `Datenraster`s (Neuentwurf): Begriff (`<dt>`) und Wert (`<dd>`) stehen in EINER
 * Feldhülle `data-lfh="datenfeld"`. Gegriffen wird die Hülle, damit die Aussagen „im Feld X
 * steht Y" dieselben bleiben wie an der früheren `Descriptions`-Zeile.
 */
const zeile = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).closest<HTMLElement>('[data-lfh="datenfeld"]')!;

describe('LagebesprechungStand · Nächste', () => {
  it('zukünftig: „in 23 min", neutral', () => {
    zeige(stab({ naechste_lagebesprechung_at: wireAb(23 * 60 + 30) }));
    // `closest`: ob antds `Tag` den Wortlaut in eine innere Hülle legt, ist nicht Teil der Aussage.
    expect(within(zeile('Nächste')).getByText('in 23 min').closest('[data-rolle]')).toHaveAttribute(
      'data-rolle',
      'neutral',
    );
  });

  it('vergangen: „seit 5 min überfällig", achtung', () => {
    zeige(stab({ naechste_lagebesprechung_at: wireAb(-(5 * 60 + 30)) }));
    expect(
      within(zeile('Nächste')).getByText('seit 5 min überfällig').closest('[data-rolle]'),
    ).toHaveAttribute('data-rolle', 'achtung');
  });

  it('ohne Termin: „kein Termin", neutral', () => {
    zeige(stab());
    expect(
      within(zeile('Nächste')).getByText('kein Termin').closest('[data-rolle]'),
    ).toHaveAttribute('data-rolle', 'neutral');
  });

  it('aktualisiert im 30-s-Takt — nicht früher, ohne Remount und ohne Toast', async () => {
    // Viertel- statt halbe Minute neben der Grenze, gemessen: `advanceTimersByTimeAsync` stellt
    // die Uhr beim Tick auf GENAU +30,000 s — ein Termin bei +23:30 läge dann auf exakt 23:00 und
    // zeigte weiter „in 23 min". Tragend ist das Fenster [+23:00, +23:30): vor dem Tick 23, danach 22.
    zeige(stab({ naechste_lagebesprechung_at: wireAb(23 * 60 + 15) }));
    const tabelle = document.querySelector('[data-lfh="datenraster"]');
    expect(screen.getByText('in 23 min')).toBeInTheDocument();

    // Gegenfall zum Takt: nach 29 s steht noch der alte Wert — ein kürzerer Takt zeigte „in 22 min".
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(screen.getByText('in 23 min')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('in 22 min')).toBeInTheDocument();
    // Kein Blinken: derselbe Knoten, nur der Wortlaut ändert sich.
    expect(tabelle).not.toBeNull();
    expect(document.querySelector('[data-lfh="datenraster"]')).toBe(tabelle);
    // Kein Toast. Dass die Queue zählbar ist, belegt `LagebesprechungModal.test.tsx`.
    expect(document.querySelectorAll('.ant-message')).toHaveLength(0);
  });

  it('räumt die Uhr beim Aushängen weg', () => {
    const { unmount } = zeige(stab({ naechste_lagebesprechung_at: wireAb(23 * 60 + 30) }));
    const vorher = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(vorher);
  });
});

describe('LagebesprechungStand · Letzte und Anzahl', () => {
  it('nennt Nummer, gekürzten Entschluss und verlinkt den ETB-Beleg', () => {
    zeige(stab({ letzte_lagebesprechung: letzte({ entschluss: 'b'.repeat(120) }) }));
    const z = zeile('Letzte');
    expect(within(z).getByText('Nr. 3')).toBeInTheDocument();
    expect(within(z).getByText(`${'b'.repeat(79)}…`)).toBeInTheDocument();
    expect(
      within(z).getByRole('link', { name: 'ETB-Eintrag zu Lagebesprechung Nr. 3' }),
    ).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=77');
  });

  it('ohne letzte Lagebesprechung: „noch keine", kein Link (Gegenfall oben)', () => {
    zeige(stab({ anzahl_lagebesprechungen: 0 }));
    expect(within(zeile('Letzte')).getByText('noch keine')).toBeInTheDocument();
    expect(within(zeile('Letzte')).queryByRole('link')).toBeNull();
  });

  it('zeigt die Anzahl', () => {
    zeige(stab({ anzahl_lagebesprechungen: 7 }));
    expect(within(zeile('Anzahl')).getByText('7')).toBeInTheDocument();
  });
});
