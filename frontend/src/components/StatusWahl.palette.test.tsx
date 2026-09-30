import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import {
  CommandPaletteProvider,
  useCommandPalette,
} from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import { renderMitProviders } from '../test/utils';
import type { StatusDarstellung } from '../theme/statusFarben';
import Datensicht, { spaltenFuer, type Kartenplan } from './Datensicht';
import EinsatzSeite from './EinsatzSeite';
import StatusWahl, { type StatusOption } from './StatusWahl';

/**
 * „Status setzen“ wirkt auf die FOKUSZEILE (LFH-507,
 * `openspec/changes/lfh-507-palette-status-setzen/`).
 *
 * EIGENE DATEI: `vi.mock` hoistet dateiweit, und das echte `useBefehle` fordert `/api/einsaetze`
 * an (MSW mit `onUnhandledRequest: 'error'`). Die Attrappe beschriftet mit der Id, gegriffen wird
 * auf `#cmd-tastatur:<id>`; der Wortlaut ist in `befehle.test.ts` gepinnt.
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
  status: number;
}

const DATEN: Fahrzeug[] = [
  { id: 1, funkrufname: 'Florian 1', status: 2 },
  { id: 2, funkrufname: 'Florian 2', status: 2 },
];

const FREI: StatusDarstellung = { rolle: 'normal', label: '2 – Frei auf Wache' };
const OPTIONEN: StatusOption<number>[] = [
  { wert: 2, label: '2 – Frei auf Wache', darstellung: FREI },
  { wert: 4, label: '4 – Am Einsatzort', darstellung: { rolle: 'achtung', label: '4' } },
];

const SPALTEN = spaltenFuer<Fahrzeug>()([
  {
    key: 'funkrufname',
    title: 'Funkrufname',
    dataIndex: 'funkrufname',
    suchText: (f) => f.funkrufname,
  },
  { key: 'status', title: 'Status' },
]);

type SpaltenKey = 'funkrufname' | 'status';

interface Aufbau {
  form: 'karte' | 'tabelle';
  gewaehlt: (id: number, wert: string | number) => void;
  gesperrt?: ReadonlySet<number>;
  darfSchreiben?: boolean;
  neueZeile?: () => void;
}

/** Öffnet die Palette ohne Fokus in einer Wurzel, wie der „Suchen“-Knopf der Kopfleiste. */
function SuchenKnopf() {
  const { oeffne } = useCommandPalette();
  return (
    <button type="button" onClick={oeffne}>
      Suchen
    </button>
  );
}

function liste({
  form,
  gewaehlt,
  gesperrt = new Set(),
  darfSchreiben = true,
  neueZeile,
}: Aufbau): ReactElement {
  const bedienung = (f: Fahrzeug) => ({
    optionen: OPTIONEN,
    aktuell: f.status,
    kennung: f.funkrufname,
    onWaehlen: (w: string | number) => gewaehlt(f.id, w),
    gesperrt: gesperrt.has(f.id),
  });
  const karte: Kartenplan<Fahrzeug, SpaltenKey> = {
    art: 'plan',
    titel: { spalte: 'funkrufname', ziel: (f) => `/fahrzeuge/${f.id}` },
    status: () => FREI,
    statusBedienung: (f) => (darfSchreiben ? bedienung(f) : null),
  };
  // Der Tabellenzweig: die SEITE rendert das Primitiv in ihrer Statusspalte (wie `FahrzeugePage`).
  const spalten = SPALTEN.map((s) =>
    s.key === 'status'
      ? {
          ...s,
          render: (_: unknown, f: Fahrzeug) => (
            <StatusWahl darstellung={FREI} darfSchreiben={darfSchreiben} {...bedienung(f)} />
          ),
        }
      : s,
  );
  return (
    <CommandPaletteProvider>
      <SuchenKnopf />
      <EinsatzSeite titel="Fahrzeuge" neueZeile={neueZeile}>
        <Datensicht
          bezeichnung="Fahrzeuge"
          spalten={spalten}
          daten={DATEN}
          zeilenSchluessel="id"
          karte={karte}
          form={form}
          suche={{ platzhalter: 'Funkrufname' }}
        />
      </EinsatzSeite>
    </CommandPaletteProvider>
  );
}

const option = (id: string) => document.getElementById(`cmd-tastatur:${id}`);

/**
 * Fokus auf die Kennung der Zeile, dann Strg+K, und warten, bis die Palette steht. Die Werkzeugzeile
 * der Datensicht umschließt die Zeilen NICHT; „Filter zurücksetzen“ fehlt mit Fokus in einer Zeile
 * also zu Recht und taugt hier nicht als Positivhälfte.
 */
async function paletteAusZeile(u: ReturnType<typeof userEvent.setup>, kennung: string) {
  const link = screen.getByRole('link', { name: kennung });
  // `act`: der Fokuseintritt setzt Zustand in der Palette.
  act(() => link.focus());
  await u.keyboard('{Control>}k{/Control}');
  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
}

/**
 * Die SICHTBAREN Menü-Overlays. antd lässt geschlossene Portale im Baum, und ein verlassendes
 * Portal bekommt in jsdom nie `hidden` (Muster aus `StatusWahl.test.tsx`).
 */
function offeneMenues(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
    .filter((d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none')
    .map((d) => d.querySelector<HTMLElement>('[role="menu"]'))
    .filter((m): m is HTMLElement => m != null);
}

describe('StatusWahl · „Status setzen“ in der Palette (LFH-507)', () => {
  describe('Leerfall: ohne Fokuszeile fehlt die Aktion', () => {
    it('fehlt bei Fokus im Suchfeld der Liste', async () => {
      const u = userEvent.setup();
      renderMitProviders(liste({ form: 'karte', gewaehlt: vi.fn() }));

      await u.click(screen.getByRole('searchbox', { name: 'Suche in Fahrzeuge' }));
      await u.keyboard('{Control>}k{/Control}');
      await waitFor(() => expect(option('filter-zuruecksetzen')).not.toBeNull());

      expect(option('status-setzen')).toBeNull();
    });

    it('fehlt, wenn die Palette über „Suchen“ ohne Fokus in einer Wurzel geöffnet wird', async () => {
      const u = userEvent.setup();
      renderMitProviders(liste({ form: 'karte', gewaehlt: vi.fn() }));

      await u.click(screen.getByRole('button', { name: 'Suchen' }));
      // Positivhälfte: der Anzeige-Fallback greift, „Aktionen“ ist nicht leer.
      await waitFor(() => expect(option('filter-zuruecksetzen')).not.toBeNull());

      expect(option('status-setzen')).toBeNull();
    });

    /**
     * Ohne flachere Ebene wäre die Zeile selbst der Anzeige-Fallback. Die Aussage darf nicht an der
     * DOM-Tiefe hängen: hier gibt es NUR Zeilenebenen (Mutationsprobe: ohne `nurMitFokus` rot).
     */
    it('fehlt über „Suchen“ auch dann, wenn nur Zeilen eine Ebene melden', async () => {
      const u = userEvent.setup();
      renderMitProviders(
        <CommandPaletteProvider>
          <SuchenKnopf />
          <div data-row-key="1">
            <StatusWahl
              darstellung={FREI}
              optionen={OPTIONEN}
              kennung="Florian 1"
              onWaehlen={vi.fn()}
              darfSchreiben
            />
          </div>
        </CommandPaletteProvider>,
      );

      await u.click(screen.getByRole('button', { name: 'Suchen' }));
      await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

      expect(option('status-setzen')).toBeNull();
    });
  });

  it('öffnet im Kartenzweig das Menü GENAU der Fokuszeile, ohne einen Status zu setzen', async () => {
    const u = userEvent.setup();
    const gewaehlt = vi.fn();
    renderMitProviders(liste({ form: 'karte', gewaehlt }));

    expect(offeneMenues()).toHaveLength(0);
    await paletteAusZeile(u, 'Florian 2');
    const aktion = option('status-setzen');
    expect(aktion).not.toBeNull();
    await u.click(aktion!);

    const menue = await waitFor(() => {
      const offen = offeneMenues();
      expect(offen).toHaveLength(1);
      return offen[0];
    });
    // Die Aktion öffnet nur, gewählt wird im Menü.
    expect(gewaehlt).not.toHaveBeenCalled();

    // Welche Zeile das Menü trägt, zeigt die Wahl: sie landet bei „Florian 2“, nicht bei „Florian 1“.
    await u.click(within(menue).getByRole('menuitem', { name: '4 – Am Einsatzort' }));
    expect(gewaehlt).toHaveBeenCalledTimes(1);
    expect(gewaehlt).toHaveBeenCalledWith(2, 4);
    await waitFor(() => expect(offeneMenues()).toHaveLength(0));
  });

  it('öffnet im Tabellenzweig das Menü der Fokuszeile (Zeile per data-row-key)', async () => {
    const u = userEvent.setup();
    const gewaehlt = vi.fn();
    renderMitProviders(liste({ form: 'tabelle', gewaehlt }));

    await paletteAusZeile(u, 'Florian 2');
    const aktion = option('status-setzen');
    expect(aktion).not.toBeNull();
    await u.click(aktion!);

    const menue = await waitFor(() => {
      const offen = offeneMenues();
      expect(offen).toHaveLength(1);
      return offen[0];
    });
    expect(gewaehlt).not.toHaveBeenCalled();
    await u.click(within(menue).getByRole('menuitem', { name: '4 – Am Einsatzort' }));
    expect(gewaehlt).toHaveBeenCalledWith(2, 4);
  });

  it('fehlt in einer gesperrten Zeile, steht aber in der Nachbarzeile', async () => {
    const u = userEvent.setup();
    renderMitProviders(liste({ form: 'karte', gewaehlt: vi.fn(), gesperrt: new Set([2]) }));

    await paletteAusZeile(u, 'Florian 2');
    expect(option('status-setzen')).toBeNull();

    await u.keyboard('{Escape}');
    await paletteAusZeile(u, 'Florian 1');
    expect(option('status-setzen')).not.toBeNull();
  });

  it('fehlt ohne Schreibrecht (Lesezweig ohne Auslöser)', async () => {
    const u = userEvent.setup();
    renderMitProviders(liste({ form: 'tabelle', gewaehlt: vi.fn(), darfSchreiben: false }));

    await paletteAusZeile(u, 'Florian 2');
    expect(option('status-setzen')).toBeNull();
  });

  it('steht mit „Neue Zeile“ der Seite zusammen unter „Aktionen“ (Ebenen-Kette)', async () => {
    const u = userEvent.setup();
    renderMitProviders(liste({ form: 'karte', gewaehlt: vi.fn(), neueZeile: vi.fn() }));

    await paletteAusZeile(u, 'Florian 2');
    expect(option('status-setzen')).not.toBeNull();
    expect(option('neue-zeile')).not.toBeNull();
  });
});
