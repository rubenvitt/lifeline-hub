import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import { renderMitProviders as renderBasis } from '../test/utils';
import { sendeBreitenAenderung, setzeViewportBreite } from '../test/viewport';
import Datensicht, {
  hatWaehlbareSpalten,
  spaltenFuer,
  type DatensichtSpalte,
  type Kartenplan,
} from './Datensicht';

/**
 * Was die Werkzeugzeile der {@link Datensicht} an die Kommandopalette meldet (LFH-391 · B4).
 *
 * EIGENE DATEI: `vi.mock` hoistet dateiweit, und `src/test/setup.ts` fährt MSW mit
 * `onUnhandledRequest: 'error'` — das echte `useBefehle` fordert `/api/einsaetze` an. Ein
 * dateiweiter Mock in `Datensicht.test.tsx` wäre dort ein Nebeneffekt ohne Anlass.
 *
 * Die Attrappe beschriftet mit der Id selbst, gegriffen wird auf `#cmd-tastatur:<id>`: der
 * Wortlaut kommt aus `TASTATUR_AKTIONEN` und ist in `befehle.test.ts` gepinnt.
 */
vi.mock('../command-palette/useBefehle', () => ({
  useBefehle: (aktionen: TastaturAktionen = {}) =>
    Object.entries(aktionen).map(([id, ausfuehren]) => ({
      id: `tastatur:${id}`,
      gruppe: 'aktionen',
      label: id,
      ausfuehren,
    })),
}));

interface Fahrzeug {
  id: number;
  funkrufname: string;
  fahrzeugtyp: string | null;
}

const DATEN: Fahrzeug[] = [
  { id: 1, funkrufname: 'Florian 1', fahrzeugtyp: 'LF' },
  { id: 2, funkrufname: 'Rotkreuz 2', fahrzeugtyp: 'RTW' },
];

const ZWEI_SPALTEN = spaltenFuer<Fahrzeug>()([
  {
    key: 'funkrufname',
    title: 'Funkrufname',
    dataIndex: 'funkrufname',
    suchText: (f) => f.funkrufname,
  },
  { key: 'typ', title: 'Typ', dataIndex: 'fahrzeugtyp' },
]);

const EINE_SPALTE = spaltenFuer<Fahrzeug>()([
  {
    key: 'funkrufname',
    title: 'Funkrufname',
    dataIndex: 'funkrufname',
    suchText: (f) => f.funkrufname,
  },
]);

type SpaltenKey = 'funkrufname' | 'typ';

function rendere(
  spalten: readonly DatensichtSpalte<Fahrzeug, SpaltenKey>[],
  form: 'tabelle' | 'karte' | 'auto',
): ReactElement {
  const karte: Kartenplan<Fahrzeug, SpaltenKey> = {
    art: 'plan',
    titel: { spalte: 'funkrufname' },
  };
  return (
    <CommandPaletteProvider>
      <Datensicht
        bezeichnung="Fahrzeuge"
        spalten={spalten}
        daten={DATEN}
        zeilenSchluessel="id"
        karte={karte}
        form={form}
        suche={{ platzhalter: 'Funkrufname' }}
      />
    </CommandPaletteProvider>
  );
}

/**
 * Öffnet die Palette aus der Werkzeugzeile heraus und wartet, bis sie steht.
 *
 * Der Fokus muss VOR `Strg+K` im Suchfeld liegen: nur dann enthält die Ebenenkette die
 * Werkzeug-Ebene. Gewartet wird auf `filter-zuruecksetzen`, das die Werkzeugzeile IMMER
 * registriert — die Positivhälfte zu jeder „… ist NICHT gemeldet"-Aussage unten.
 */
async function oeffnePalette(u: ReturnType<typeof userEvent.setup>) {
  // Geklickt statt `.focus()`: der Fokuseintritt löst ein `setState` aus, das direkt gerufen
  // außerhalb von `act` liefe.
  await u.click(screen.getByRole('searchbox', { name: 'Suche in Fahrzeuge' }));
  await u.keyboard('{Control>}k{/Control}');
  await waitFor(() =>
    expect(document.getElementById('cmd-tastatur:filter-zuruecksetzen')).not.toBeNull(),
  );
}

describe('hatWaehlbareSpalten()', () => {
  it('zählt weder die erste Spalte noch eine immerSichtbare', () => {
    expect(hatWaehlbareSpalten(EINE_SPALTE)).toBe(false);
    expect(hatWaehlbareSpalten(ZWEI_SPALTEN)).toBe(true);
    expect(
      hatWaehlbareSpalten([
        { key: 'funkrufname', title: 'Funkrufname' },
        { key: 'typ', title: 'Typ', immerSichtbar: true },
      ]),
    ).toBe(false);
    expect(hatWaehlbareSpalten([])).toBe(false);
  });
});

describe('Datensicht · Tastaturaktionen der Werkzeugzeile', () => {
  it('meldet im Tabellenzweig „spalten", und der Palettenbefehl öffnet die Spaltenwahl', async () => {
    const u = userEvent.setup();
    renderBasis(rendere(ZWEI_SPALTEN, 'tabelle'));
    await oeffnePalette(u);

    const option = document.getElementById('cmd-tastatur:spalten');
    expect(option).not.toBeNull();

    await u.click(option!);

    /*
     * GESCOPT auf das SICHTBARE Overlay: antd lässt die Portale geschlossener Dropdowns im Baum
     * stehen. Die tragende Gegenaussage sind die beiden Fälle unten, in denen die Palette den Befehl
     * gar nicht erst anbietet („vorher nicht da" wäre wertlos, rc-dropdown mountet lazy).
     *
     * Zugesichert wird „das Menü ist OFFEN", nicht „der Fokus steht darin": wie sich die
     * Fokusrückgabe des Modals gegen das `autoFocus` des Dropdowns verhält, rechnet jsdom nicht.
     */
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    expect(within(menue).getByRole('checkbox', { name: 'Typ' })).toBeInTheDocument();
  });

  it('meldet „spalten" NICHT im Kartenzweig und nicht bei einer einzigen Spalte', async () => {
    const u = userEvent.setup();
    const { unmount } = renderBasis(rendere(ZWEI_SPALTEN, 'karte'));
    await oeffnePalette(u);
    // Im Kartenzweig gibt es keinen Schalter, ein Befehl darauf zeigte ins Leere. Schalter und
    // Registrierung lesen dieselbe Wahrheit (`hatWaehlbareSpalten` bzw. `alsTabelle`).
    expect(document.getElementById('cmd-tastatur:spalten')).toBeNull();
    unmount();

    renderBasis(rendere(EINE_SPALTE, 'tabelle'));
    await oeffnePalette(u);
    expect(document.getElementById('cmd-tastatur:spalten')).toBeNull();
  });
});

/** Das SICHTBARE Spalten-Overlay, oder `null` — antd lässt geschlossene Portale im Baum stehen. */
function offenesSpaltenMenue(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
}

describe('Datensicht · Spaltenmenü über einen Zweigwechsel', () => {
  /**
   * Regression der kontrollierten Offen-Achse (LFH-391 · B4).
   *
   * Verschwindet der `SpaltenSchalter`, feuert antd KEIN `onOpenChange(false)`, und der
   * kontrollierte Zustand überlebt die Komponente. Ohne Rücksetzer klappte das Overlay beim
   * Zurückkehren unaufgefordert auf.
   *
   * Beide Bedingungen werden geprüft: die Breite (`abBreite('md')` bei `form='auto'`) und
   * `hatWaehlbareSpalten` (Wechsel der Spaltengarnitur).
   */
  it.each([
    { breit: 1024, schmal: 390 },
    { breit: 768, schmal: 767 },
  ] as const)(
    'bleibt beim Wechsel über md geschlossen ($breit → $schmal px)',
    async ({ breit, schmal }) => {
      const u = userEvent.setup();
      setzeViewportBreite(breit);
      renderBasis(rendere(ZWEI_SPALTEN, 'auto'));

      await u.click(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' }));
      await waitFor(() => expect(offenesSpaltenMenue()).not.toBeNull());

      // Fensterwechsel ZUR LAUFZEIT: der Stub feuert das `change`-Ereignis, das antds Beobachter als
      // einziges liest.
      await act(async () => {
        expect(sendeBreitenAenderung(schmal)).toBeGreaterThan(0);
      });
      expect(screen.queryByRole('button', { name: /^Spalten/ })).toBeNull();

      await act(async () => {
        sendeBreitenAenderung(breit);
      });
      expect(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' })).toBeInTheDocument();
      expect(offenesSpaltenMenue()).toBeNull();
    },
  );

  it('bleibt zu, wenn die Spaltengarnitur zwischendurch nichts Wählbares hat', async () => {
    const u = userEvent.setup();
    const { rerender } = renderBasis(rendere(ZWEI_SPALTEN, 'tabelle'));

    await u.click(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' }));
    await waitFor(() => expect(offenesSpaltenMenue()).not.toBeNull());

    // Eine einzige Spalte ist nie wählbar (sie trägt die Kennung); der Schalter gibt `null`
    // zurück, ohne dass antd das Schließen meldet.
    rerender(rendere(EINE_SPALTE, 'tabelle'));
    expect(screen.queryByRole('button', { name: /^Spalten/ })).toBeNull();

    rerender(rendere(ZWEI_SPALTEN, 'tabelle'));
    expect(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' })).toBeInTheDocument();
    expect(offenesSpaltenMenue()).toBeNull();
  });
});
