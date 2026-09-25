import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import { renderMitProviders as renderBasis } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import KatalogTabelle, { type KatalogSpalte, type KatalogTabelleProps } from './KatalogTabelle';

/**
 * Der Spaltenschalter als Opt-in der `KatalogTabelle` (LFH-374).
 *
 * EIGENE DATEI aus demselben Grund wie `Datensicht.tastaturaktionen.test.tsx`: `vi.mock`
 * hoistet dateiweit, und das echte `useBefehle` forderte beim Öffnen der Palette
 * `/api/einsaetze` an — MSW bräche den Lauf mit `onUnhandledRequest: 'error'`. Die Attrappe
 * reicht die REGISTRIERTEN Ids durch; gegriffen wird auf `#cmd-tastatur:<id>`.
 *
 * Die Breite kommt über den matchMedia-Stub durch den ECHTEN `useViewport` — ein Mock des
 * Hooks prüfte die Attrappe statt der Zählwahrheit.
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

interface Quelle {
  id: number;
  name: string;
  typ: string;
  url: string;
  attribution: string;
}

const DATEN: Quelle[] = [
  { id: 1, name: 'Basemap', typ: 'vektor', url: 'https://a.example/{z}', attribution: '© A' },
  { id: 2, name: 'Topo', typ: 'raster', url: 'https://b.example/{z}', attribution: '© B' },
];

const SPALTEN: KatalogSpalte<Quelle>[] = [
  { title: 'Name', dataIndex: 'name', key: 'name' },
  { title: 'Typ', dataIndex: 'typ', key: 'typ' },
  { title: 'URL', dataIndex: 'url', key: 'url', abBreite: 'lg' },
  { title: 'Attribution', dataIndex: 'attribution', key: 'attribution', abBreite: 'lg' },
  { title: 'Aktionen', key: 'aktionen', immerSichtbar: true, render: () => 'Bearbeiten' },
];

function tabelle(props: Partial<KatalogTabelleProps<Quelle>> = {}): ReactElement {
  return (
    <CommandPaletteProvider>
      <KatalogTabelle<Quelle> rowKey="id" dataSource={DATEN} columns={SPALTEN} {...props} />
    </CommandPaletteProvider>
  );
}

const MIT_SCHALTER = { spaltenSchalter: { bezeichnung: 'Online-Quellen' } };

function kopf(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
}

/** Das OFFENE Spaltenmenü — nicht ein geschlossenes oder abgehendes Portal. */
async function offenesMenue(): Promise<HTMLElement> {
  return waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave) [role="menu"]',
    );
    expect(m).not.toBeNull();
    return m!;
  });
}

describe('KatalogTabelle · Spaltenschalter (LFH-374)', () => {
  it('ohne Opt-in gibt es keinen Schalter, und alle Spalten stehen — auch schmal', () => {
    setzeViewportBreite(390);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderBasis(tabelle());
    expect(screen.queryByRole('button', { name: /^Spalten/ })).toBeNull();
    expect(kopf(container)).toEqual(['Name', 'Typ', 'URL', 'Attribution', 'Aktionen']);
    // `abBreite` ohne Zähler wäre eine stille Ausblendung — also wirkungslos, aber laut.
    expect(
      warn.mock.calls.filter(
        (c) => String(c[0]).includes('abBreite') && String(c[0]).includes('spaltenSchalter'),
      ),
    ).toHaveLength(1);
    warn.mockRestore();
  });

  it('mit Opt-in steht der Schalter in der Werkzeugzeile, außerhalb der Tabelle', () => {
    const { container } = renderBasis(tabelle(MIT_SCHALTER));
    const knopf = screen.getByRole('button', { name: 'Spalten — Online-Quellen' });
    expect(knopf.closest('[data-lfh="katalog-werkzeuge"]')).not.toBeNull();
    expect(knopf.closest('.ant-table')).toBeNull();
    expect(kopf(container)).toEqual(['Name', 'Typ', 'URL', 'Attribution', 'Aktionen']);
  });

  it('die Handauswahl blendet aus und zählt', async () => {
    const { container } = renderBasis(tabelle(MIT_SCHALTER));
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    await userEvent.click(within(await offenesMenue()).getByRole('checkbox', { name: 'Typ' }));
    expect(kopf(container)).toEqual(['Name', 'URL', 'Attribution', 'Aktionen']);
    expect(
      screen.getByRole('button', { name: 'Spalten · 1 ausgeblendet — Online-Quellen' }),
    ).toBeInTheDocument();
  });

  it('Breite und Handauswahl laufen in EINEN Zähler, doppelt verborgen zählt einmal', async () => {
    setzeViewportBreite(800);
    const { container } = renderBasis(tabelle(MIT_SCHALTER));
    expect(kopf(container)).toEqual(['Name', 'Typ', 'Aktionen']);
    expect(screen.getByRole('button', { name: /^Spalten · 2 ausgeblendet/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    await userEvent.click(within(await offenesMenue()).getByRole('checkbox', { name: 'Typ' }));
    expect(screen.getByRole('button', { name: /^Spalten · 3 ausgeblendet/ })).toBeInTheDocument();
  });

  it('eine per Breite weggefallene Spalte lässt sich von Hand zurückholen', async () => {
    setzeViewportBreite(800);
    const { container } = renderBasis(tabelle(MIT_SCHALTER));
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    const attribution = within(await offenesMenue()).getByRole('checkbox', {
      name: 'Attribution',
    });
    expect(attribution).not.toBeChecked();
    await userEvent.click(attribution);
    expect(kopf(container)).toContain('Attribution');
    expect(screen.getByRole('button', { name: /^Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
  });

  it('Kennung und immerSichtbar stehen nicht zur Wahl, die Fixierung bleibt an Spalte 0', async () => {
    const { container } = renderBasis(tabelle(MIT_SCHALTER));
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    const menue = await offenesMenue();
    const wahl = within(menue)
      .getAllByRole('checkbox')
      .map((k) => k.closest('li')?.textContent);
    expect(wahl).toEqual(['Typ', 'URL', 'Attribution']);

    await userEvent.click(within(menue).getByRole('checkbox', { name: 'Typ' }));
    const fixiert = container.querySelectorAll('th.ant-table-cell-fix-start');
    expect([...fixiert].map((z) => z.textContent)).toEqual(['Name']);
  });

  it('eine Spalte ohne String-key gilt bei Opt-in als immerSichtbar und meldet sich', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ohneKey: KatalogSpalte<Quelle>[] = [
      ...SPALTEN.slice(0, 2),
      { title: 'Notiz', render: () => '—' },
    ];
    renderBasis(tabelle({ ...MIT_SCHALTER, columns: ohneKey }));
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    const wahl = within(await offenesMenue())
      .getAllByRole('checkbox')
      .map((k) => k.closest('li')?.textContent);
    expect(wahl).toEqual(['Typ']);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes('Notiz') && String(c[0]).includes('key')),
    ).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('KatalogTabelle · Spaltenschalter in der Kommandopalette', () => {
  /** Fokus in die Werkzeugzeile OHNE Klick — ein Klick öffnete das Menü im Portal. */
  async function oeffnePalette(u: ReturnType<typeof userEvent.setup>, auf: HTMLElement) {
    act(() => auf.focus());
    await u.keyboard('{Control>}k{/Control}');
  }

  it('meldet „spalten" mit Opt-in, und der Befehl öffnet das Menü', async () => {
    const u = userEvent.setup();
    renderBasis(tabelle({ ...MIT_SCHALTER, suche: { platzhalter: 'Name' } }));
    await u.click(screen.getByRole('searchbox'));
    await u.keyboard('{Control>}k{/Control}');
    const option = await waitFor(() => {
      const o = document.getElementById('cmd-tastatur:spalten');
      expect(o).not.toBeNull();
      return o!;
    });
    await u.click(option);
    expect(within(await offenesMenue()).getByRole('checkbox', { name: 'Typ' })).toBeInTheDocument();
  });

  it('meldet „spalten" NICHT ohne Opt-in, wohl aber weiter das Zurücksetzen der Suche', async () => {
    const u = userEvent.setup();
    renderBasis(tabelle({ suche: { platzhalter: 'Name' } }));
    await u.click(screen.getByRole('searchbox'));
    await u.keyboard('{Control>}k{/Control}');
    await waitFor(() =>
      expect(document.getElementById('cmd-tastatur:filter-zuruecksetzen')).not.toBeNull(),
    );
    expect(document.getElementById('cmd-tastatur:spalten')).toBeNull();
  });

  it('ohne Suche, aber mit Schalter meldet die Werkzeugzeile nur „spalten"', async () => {
    const u = userEvent.setup();
    renderBasis(tabelle(MIT_SCHALTER));
    await oeffnePalette(u, screen.getByRole('button', { name: /^Spalten/ }));
    await waitFor(() => expect(document.getElementById('cmd-tastatur:spalten')).not.toBeNull());
    expect(document.getElementById('cmd-tastatur:filter-zuruecksetzen')).toBeNull();
  });
});
