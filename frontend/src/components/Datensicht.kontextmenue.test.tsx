/**
 * Kontextmenü der `Datensicht` (LLH-1596, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/om9oxxiq-kontextmenue-baustein/design.md` D7): Rechtsklick, langer Druck und
 * Tastatur öffnen ein Menü aus `karte.aktion` und `karte.weitere`, in Tabelle und Karte.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, { spaltenFuer, type Kartenplan } from './Datensicht';
import { LANGDRUCK_MS } from './useKontextMenue';

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

interface Fahrzeug {
  id: number;
  funkrufname: string;
  fahrzeugtyp: string;
}

const F = (id: number, funkrufname: string): Fahrzeug => ({ id, funkrufname, fahrzeugtyp: 'LF' });
const DREI = [F(1, 'Florian 1'), F(2, 'Rotkreuz 2'), F(3, 'Florian 3')];

const spalten = spaltenFuer<Fahrzeug>()([
  { key: 'funkrufname', title: 'Funkrufname', dataIndex: 'funkrufname', immerSichtbar: true },
  { key: 'typ', title: 'Typ', dataIndex: 'fahrzeugtyp' },
]);
type FahrzeugKey = (typeof spalten)[number]['key'];

function plan(
  onKlick = vi.fn(),
  onWahl = vi.fn(),
  eintraege: (f: Fahrzeug) => { key: string; label: string; gefahr?: true }[] = () => [
    { key: 'bearbeiten', label: 'Bearbeiten' },
    { key: 'stornieren', label: 'Stornieren', gefahr: true },
  ],
  mitPrimaer = true,
): Kartenplan<Fahrzeug, FahrzeugKey> {
  return {
    art: 'plan',
    titel: { spalte: 'funkrufname', ziel: (f) => `/fahrzeuge/${f.id}` },
    sekundaer: ['typ'],
    ...(mitPrimaer ? { aktion: { etikett: 'Melden', onKlick } } : {}),
    weitere: {
      eintraege,
      zugaenglicherName: (f) => `Aktionen zu ${f.funkrufname}`,
      onWahl,
    },
  };
}

function sicht(
  karte: Kartenplan<Fahrzeug, FahrzeugKey>,
  daten: Fahrzeug[] = DREI,
  extra: { onZeileKlick?: (f: Fahrzeug) => void } = {},
) {
  return (
    <Datensicht<Fahrzeug, FahrzeugKey>
      bezeichnung="Fahrzeuge im Einsatz"
      spalten={spalten}
      daten={daten}
      zeilenSchluessel="id"
      karte={karte}
      {...extra}
    />
  );
}

const offenesMenue = () =>
  document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label^="Aktionen zu"]',
  );
const kontextAnker = () => document.querySelector('[data-lfh="kontextmenue-anker"]');
const zelleVon = (text: string) => screen.getByText(text).closest('td')!;
const zeileVon = (name: string) => screen.getByRole('link', { name }).closest('tr')!;

afterEach(() => vi.useRealTimers());

describe('Datensicht · Kontextmenü im Tabellenzweig (4.1)', () => {
  it('Rechtsklick auf eine Zeile zeigt Primäraktion und ⋮-Einträge; die Wahl löst nur sie aus', async () => {
    setzeViewportBreite(1200);
    const onKlick = vi.fn();
    const onWahl = vi.fn();
    const onZeileKlick = vi.fn();
    renderMitProviders(sicht(plan(onKlick, onWahl), DREI, { onZeileKlick }));

    const zelle = within(zeileVon('Rotkreuz 2')).getByText('LF');
    expect(fireEvent.contextMenu(zelle, { clientX: 200, clientY: 120, button: 2 })).toBe(false);
    const menue = await waitFor(() => offenesMenue()!);
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Rotkreuz 2');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Melden', 'Bearbeiten', 'Stornieren']);
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);

    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Stornieren' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(onWahl).toHaveBeenCalledWith('stornieren', DREI[1]);
    expect(onKlick).not.toHaveBeenCalled();
    expect(onZeileKlick).not.toHaveBeenCalled();
  });

  it('die Primäraktion im Menü ruft ihr `onKlick` mit der Zeile', async () => {
    setzeViewportBreite(1200);
    const onKlick = vi.fn();
    renderMitProviders(sicht(plan(onKlick)));
    fireEvent.contextMenu(within(zeileVon('Florian 3')).getByText('LF'), { button: 2 });
    const menue = await waitFor(() => offenesMenue()!);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Melden' }));
    expect(onKlick).toHaveBeenCalledWith(DREI[2]);
  });

  it('Rechtsklick auf den Titel-Link lässt das Browsermenü', () => {
    setzeViewportBreite(1200);
    renderMitProviders(sicht(plan()));
    const link = screen.getByRole('link', { name: 'Rotkreuz 2' });
    expect(fireEvent.contextMenu(link, { button: 2 })).toBe(true);
    expect(kontextAnker()).toBeNull();
  });

  it('eine Zeile ohne Einträge lässt das Browsermenü', () => {
    setzeViewportBreite(1200);
    renderMitProviders(sicht(plan(vi.fn(), vi.fn(), () => [], false)));
    expect(fireEvent.contextMenu(zelleVon('Florian 1'), { button: 2 })).toBe(true);
    expect(kontextAnker()).toBeNull();
  });

  it('Umschalt+F10 auf dem Titel-Link öffnet das Menü, Escape gibt den Fokus zurück', async () => {
    setzeViewportBreite(1200);
    renderMitProviders(sicht(plan()));
    const link = screen.getByRole('link', { name: 'Florian 1' });
    link.focus();
    expect(fireEvent.keyDown(link, { key: 'F10', shiftKey: true })).toBe(false);
    const menue = await waitFor(() => offenesMenue()!);
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Florian 1');
    await waitFor(() => expect(menue.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it('Zeilenklick wirkt weiter (Bestand über `onRow`)', async () => {
    setzeViewportBreite(1200);
    const onZeileKlick = vi.fn();
    renderMitProviders(sicht(plan(), DREI, { onZeileKlick }));
    await userEvent.click(within(zeileVon('Rotkreuz 2')).getByText('LF'));
    expect(onZeileKlick).toHaveBeenCalledWith(DREI[1]);
  });
});

describe('Datensicht · Kontextmenü im Kartenzweig (4.2)', () => {
  const karteVon = (name: string) =>
    screen.getByRole('link', { name }).closest<HTMLElement>('[data-lfh="datensicht-karte"]')!;

  it('Rechtsklick auf eine Karte öffnet ihr Menü', async () => {
    setzeViewportBreite(390);
    renderMitProviders(sicht(plan()));
    const karte = karteVon('Rotkreuz 2');
    expect(fireEvent.contextMenu(karte, { clientX: 20, clientY: 30, button: 2 })).toBe(false);
    const menue = await waitFor(() => offenesMenue()!);
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Rotkreuz 2');
  });

  it('langer Druck öffnet das Menü; die Wahl öffnet nicht den Titel-Link', async () => {
    setzeViewportBreite(390);
    const onWahl = vi.fn();
    renderMitProviders(sicht(plan(vi.fn(), onWahl)));
    const karte = karteVon('Florian 3');
    vi.useFakeTimers();
    fireEvent.pointerDown(karte, {
      isPrimary: true,
      pointerId: 3,
      pointerType: 'touch',
      clientX: 40,
      clientY: 50,
    });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    fireEvent.pointerUp(karte, { pointerId: 3, pointerType: 'touch' });
    vi.useRealTimers();
    const menue = await waitFor(() => offenesMenue()!);
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Florian 3');
    const vorher = window.location.pathname;
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Bearbeiten' }));
    expect(onWahl).toHaveBeenCalledWith('bearbeiten', DREI[2]);
    expect(window.location.pathname).toBe(vorher);
  });
});

describe('Datensicht · offenes Kontextmenü (4.3)', () => {
  const zeilenZahl = (c: HTMLElement) => c.querySelectorAll('tr.ant-table-row').length;

  it('hält Menge und Folge der Zeilen; Neues meldet der Sammelbanner', async () => {
    setzeViewportBreite(1200);
    const karte = plan();
    const { container, rerender } = renderMitProviders(sicht(karte));
    fireEvent.contextMenu(within(zeileVon('Florian 1')).getByText('LF'), { button: 2 });
    const menue = await waitFor(() => offenesMenue()!);
    await waitFor(() => expect(menue.contains(document.activeElement)).toBe(true));
    // Ohne Fokus (Touch): das offene Menü allein hält, nicht erst der Fokus darin.
    act(() => (document.activeElement as HTMLElement).blur());
    rerender(sicht(karte, [...DREI, F(4, 'Florian 4')]));
    expect(zeilenZahl(container)).toBe(3);
    expect(screen.getByRole('button', { name: /1 neuer Eintrag/ })).toBeInTheDocument();
  });

  it('verliert die Zeile alle Einträge, schließt das Menü und hält die Liste nicht weiter', async () => {
    setzeViewportBreite(1200);
    const { container, rerender } = renderMitProviders(sicht(plan()));
    fireEvent.contextMenu(within(zeileVon('Florian 1')).getByText('LF'), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const leer = plan(vi.fn(), vi.fn(), () => [], false);
    rerender(sicht(leer));
    await waitFor(() => expect(kontextAnker()).toBeNull());
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    rerender(sicht(leer, [...DREI, F(4, 'Florian 4')]));
    expect(zeilenZahl(container)).toBe(4);
  });

  it('verschwindet die Zeile, schließt das Menü', async () => {
    setzeViewportBreite(1200);
    const karte = plan();
    const { rerender } = renderMitProviders(sicht(karte));
    fireEvent.contextMenu(within(zeileVon('Rotkreuz 2')).getByText('LF'), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    rerender(sicht(karte, [DREI[0], DREI[2]]));
    await waitFor(() => expect(kontextAnker()).toBeNull());
  });
});
