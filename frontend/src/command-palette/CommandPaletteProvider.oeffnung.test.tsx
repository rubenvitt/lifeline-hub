// frontend/src/command-palette/CommandPaletteProvider.oeffnung.test.tsx
//
// Die Öffnungswege der Palette (LFH-645) über den ECHTEN Provider — dort hängen die zwei
// Stellen, die die präsentationale Palette nicht sieht: der neue Tab (`window.open` in
// `gehZu`) und der globale Tastendispatcher, der Esc und Strg/⌘+↵ sonst selbst deutete.
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider, useTastaturEbene } from './CommandPaletteProvider';
import { koordinatenBefehl } from './koordinatenSprung';
import type { Befehl, Oeffnung, TastaturAktionen } from './typen';

vi.mock('./useBefehle', () => ({
  useBefehle: (aktionen: TastaturAktionen = {}): Befehl[] => [
    ...Object.entries(aktionen).map(([id, ausfuehren]) => ({
      id: `tastatur:${id}`,
      gruppe: 'aktionen' as const,
      label: id === 'speichern' ? 'Speichern' : id,
      ausfuehren: ausfuehren!,
    })),
    {
      id: 'datensatz:personen:11',
      gruppe: 'datensaetze',
      label: 'Florian Mustermann',
      ziel: '/einsaetze/5/personen/11',
      vorschau: { art: 'person', einsatzId: 5, id: 11 },
      ausfuehren: vi.fn(),
    },
  ],
}));
// Kein Netz: die Datensatzsuche liefert nichts, die Vorschau ist eine Attrappe.
vi.mock('./useDatensaetze', () => ({ useDatensatzTreffer: () => [] }));
vi.mock('./Vorschau', () => ({ Vorschau: () => <div>Vorschau-Inhalt</div> }));
// Der Koordinatensprung ist der ECHTE `koordinatenBefehl` am ECHTEN `navigate` des Hosts —
// nur die Rechte- und Formatabfragen davor sind weggelassen. So läuft Strg/⌘+↵ genau den Weg,
// den die Palette im Betrieb nimmt: Zeile → `ausfuehren('neuerTab')` → `gehZu` → `window.open`.
vi.mock('./useKoordinatenSprung', () => ({
  useKoordinatenSprung:
    ({ navigate }: { navigate: (pfad: string, o?: Oeffnung) => void }) =>
    (rest: string) =>
      rest === '52.5, 13.4'
        ? koordinatenBefehl({
            einsatzId: 5,
            punkt: { lat: 52.5, lon: 13.4 },
            format: 'wgs84',
            navigate,
          })
        : null,
}));

afterEach(() => vi.restoreAllMocks());

function Ort() {
  return <div data-testid="ort">{useLocation().pathname}</div>;
}

function Ebene({ aktionen }: { aktionen: TastaturAktionen }) {
  const wurzel = useRef<HTMLDivElement>(null);
  useTastaturEbene({ name: 'formular', wurzel, aktionen, aktiv: true });
  return (
    <div ref={wurzel}>
      <button type="button">formular fokussieren</button>
    </div>
  );
}

function app(children: React.ReactNode = null) {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Ort />
      {children}
    </CommandPaletteProvider>,
    { route: '/einsaetze/5/etb' },
  );
}

describe('CommandPaletteProvider · Öffnungswege (LFH-645)', () => {
  it('Strg+↵ öffnet das Ziel per window.open im neuen Tab — die Route bleibt stehen', async () => {
    const u = userEvent.setup();
    const oeffne = vi.spyOn(window, 'open').mockReturnValue(null);
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), '52.5, 13.4');
    expect(screen.getByRole('option', { name: /Auf Lagekarte zeigen/ })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', ctrlKey: true });

    expect(oeffne).toHaveBeenCalledTimes(1);
    const [url, ziel, merkmale] = oeffne.mock.calls[0];
    expect(String(url)).toMatch(/^\/einsaetze\/5\/lagekarte\?/);
    expect(ziel).toBe('_blank');
    expect(merkmale).toBe('noopener');
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/etb');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('↵ auf derselben Zeile navigiert im aktuellen Tab und öffnet kein Fenster', async () => {
    const u = userEvent.setup();
    const oeffne = vi.spyOn(window, 'open').mockReturnValue(null);
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), '52.5, 13.4');
    await u.keyboard('{Enter}');
    expect(oeffne).not.toHaveBeenCalled();
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/lagekarte');
  });

  it('Esc aus der Vorschau lässt die Palette offen, ein zweites Esc schliesst sie', async () => {
    const u = userEvent.setup();
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('region', { name: /^Vorschau/ })).toBeInTheDocument();

    await u.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: /^Vorschau/ })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Esc mit Fokus auf „Zurück" geht eine Ebene zurück, statt die Palette zu schliessen', async () => {
    const u = userEvent.setup();
    app();
    await u.keyboard('{Control>}k{/Control}');
    await u.keyboard('{ArrowRight}');
    await u.tab();
    expect(screen.getByRole('button', { name: /Zurück/ })).toHaveFocus();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: /^Vorschau/ })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  // Der Riegel ist der `offen`-Zweig des globalen Dispatchers, NICHT die Palette: gemessen
  // bleibt dieser Test grün, wenn die Palette Strg+↵ gar nicht abfängt. Er pinnt das
  // Verhalten aus der Spec, damit ein Umbau des Dispatchers es nicht still kippt.
  it('Strg+↵ auf einer Zeile ohne Ziel löst NICHT das Speichern der Seite darunter aus', async () => {
    const u = userEvent.setup();
    const speichern = vi.fn();
    const oeffne = vi.spyOn(window, 'open').mockReturnValue(null);
    app(<Ebene aktionen={{ speichern }} />);
    screen.getByRole('button', { name: 'formular fokussieren' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    // Startansicht: `aktionen` steht zuoberst — markiert ist „Speichern", eine Zeile ohne Ziel.
    expect(screen.getByRole('option', { name: 'Speichern' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await u.keyboard('{Control>}{Enter}{/Control}');

    expect(speichern).not.toHaveBeenCalled();
    expect(oeffne).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
