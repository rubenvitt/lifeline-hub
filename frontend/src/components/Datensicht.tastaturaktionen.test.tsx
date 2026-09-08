// frontend/src/components/Datensicht.tastaturaktionen.test.tsx
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
 * EIGENE DATEI, zwei gemessene Gründe: `vi.mock` hoistet dateiweit, und `src/test/setup.ts`
 * fährt MSW mit `onUnhandledRequest: 'error'` — das echte `useBefehle` fordert beim Öffnen
 * `/api/einsaetze` an und bräche den Lauf. Ein dateiweiter Mock in der 1200 Zeilen langen
 * `Datensicht.test.tsx` wäre für deren übrige Aussagen ein Nebeneffekt ohne Anlass.
 *
 * Die Attrappe reicht die REGISTRIERTEN Ids durch und beschriftet bewusst mit der Id selbst:
 * gegriffen wird hier auf `#cmd-tastatur:<id>`, nicht auf den Wortlaut. Der Wortlaut kommt in
 * der Produktion aus `TASTATUR_AKTIONEN` und ist dort gepinnt (`befehle.test.ts`) — würde er
 * hier behauptet, belegte der Test die Beschriftung dieser Attrappe statt der Produktion.
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
  tabelleAb: 'md' | 'xl' = 'md',
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
        tabelleAb={tabelleAb}
        suche={{ platzhalter: 'Funkrufname' }}
      />
    </CommandPaletteProvider>
  );
}

/**
 * Öffnet die Palette aus der Werkzeugzeile heraus und wartet, bis sie steht.
 *
 * Der Fokus muss VOR `Strg+K` im Suchfeld liegen: nur dann enthält die Ebenenkette die
 * Werkzeug-Ebene, deren Aktionen die Palette anzeigt. Gewartet wird auf
 * `filter-zuruecksetzen` — die Aktion, die die Werkzeugzeile IMMER registriert. Sie ist die
 * Positivhälfte zu jeder „… ist NICHT gemeldet"-Aussage unten: ohne sie wäre ein `null` nur
 * der Beleg, dass die Palette gar nicht offen ist.
 */
async function oeffnePalette(u: ReturnType<typeof userEvent.setup>) {
  // Geklickt statt `.focus()` gerufen: der Fokuseintritt schließt die Zeilenschleuse und
  // löst damit ein `setState` aus — direkt gerufen liefe das ausserhalb von `act`.
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
     * GESCOPT auf das SICHTBARE Overlay: antd lässt die Portale geschlossener Dropdowns im
     * Baum stehen (CLAUDE.md, LFH-366) — ein ungescoptes `getByRole('checkbox')` träfe auch
     * einen stehengebliebenen Knoten. Die Umkehrung („vorher nicht da") ist als Gegenprobe
     * wertlos, weil rc-dropdown lazy mountet und der Knopf hier nie geklickt wurde; die
     * tragende Gegenaussage sind deshalb die beiden Fälle unten, in denen die Palette den
     * Befehl gar nicht erst anbietet.
     *
     * Zugesichert wird „das Menü ist OFFEN", nicht „der Fokus steht darin":
     * `CommandPalette.fuehreAus` ruft `schliesse()` VOR `ausfuehren()`, und wie sich die
     * Fokusrückgabe des Modals gegen das `autoFocus` des Dropdowns verhält, rechnet jsdom
     * nicht — diese Frage trägt der e2e.
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
    // Der Schalter wird im Kartenzweig gar nicht gerendert — ein Befehl darauf zeigte ins
    // Leere. Dieselbe Wahrheit lesen Schalter und Registrierung aus `hatWaehlbareSpalten`
    // bzw. `alsTabelle`, damit die Palette nicht behaupten kann, was die Zeile nicht hält.
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
   * Regression der kontrollierten Offen-Achse aus B4 (LFH-391).
   *
   * Der `SpaltenSchalter` steht nur im Tabellenzweig, und `form='auto'` hängt an
   * `abBreite('md')`. Verschwindet er, feuert antd KEIN `onOpenChange(false)` — der
   * unkontrollierte Zustand starb früher mit der Komponente, der kontrollierte überlebt
   * sie. Ohne Rücksetzer mountet der Schalter beim Zurückziehen mit `open={true}` und das
   * Overlay klappt unaufgefordert über den Inhalt.
   *
   * Beide Bedingungen des Schalters werden geprüft, nicht nur die Breite: er fällt genauso
   * weg, wenn `hatWaehlbareSpalten` falsch wird (Wechsel der Spaltengarnitur).
   */
  it.each([
    { tabelleAb: 'md', breit: 1024, schmal: 390 },
    { tabelleAb: 'xl', breit: 1280, schmal: 1199 },
  ] as const)('bleibt beim Wechsel über $tabelleAb geschlossen', async ({ tabelleAb, breit, schmal }) => {
    const u = userEvent.setup();
    setzeViewportBreite(breit);
    renderBasis(rendere(ZWEI_SPALTEN, 'auto', tabelleAb));

    await u.click(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' }));
    await waitFor(() => expect(offenesSpaltenMenue()).not.toBeNull());

    // Fensterwechsel ZUR LAUFZEIT: der Stub feuert das `change`-Ereignis, das antds
    // Beobachter als einziges liest — eine bloß gesetzte Breite erreicht ihn nicht mehr.
    await act(async () => {
      expect(sendeBreitenAenderung(schmal)).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /^Spalten/ })).toBeNull();

    await act(async () => {
      sendeBreitenAenderung(breit);
    });
    expect(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' })).toBeInTheDocument();
    expect(offenesSpaltenMenue()).toBeNull();
  });

  it('bleibt zu, wenn die Spaltengarnitur zwischendurch nichts Wählbares hat', async () => {
    const u = userEvent.setup();
    const { rerender } = renderBasis(rendere(ZWEI_SPALTEN, 'tabelle'));

    await u.click(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' }));
    await waitFor(() => expect(offenesSpaltenMenue()).not.toBeNull());

    // Eine einzige Spalte ist nie wählbar (die erste trägt die Kennung) — der Schalter
    // gibt `null` zurück, ohne dass antd das Schließen meldet.
    rerender(rendere(EINE_SPALTE, 'tabelle'));
    expect(screen.queryByRole('button', { name: /^Spalten/ })).toBeNull();

    rerender(rendere(ZWEI_SPALTEN, 'tabelle'));
    expect(screen.getByRole('button', { name: 'Spalten — Fahrzeuge' })).toBeInTheDocument();
    expect(offenesSpaltenMenue()).toBeNull();
  });
});
