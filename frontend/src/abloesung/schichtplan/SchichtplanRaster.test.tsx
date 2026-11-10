import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import SchichtplanRaster, { type SchichtplanRasterProps } from './SchichtplanRaster';
import type { RasterBlock, RasterZeile } from './raster';

/**
 * Das Raster und die Zeilenschleuse (LLH-1604): eine entfallene Zeile steht gedämpft mit
 * „(entfallen)“ und nimmt nichts an; ein Zug meldet sich beim Aufrufer, damit die Schleuse hält,
 * auch wenn der Zeiger das Raster verlässt. Den Zug selbst prüft die e2e (jsdom misst keine Pixel).
 */

const T0 = Date.UTC(2026, 10, 9, 8, 0);
const STUNDE = 3_600_000;

const ZEILEN: RasterZeile[] = [
  { schluessel: 'einheit:1', titel: 'RTW 1', gruppe: null, entfallen: true },
  { schluessel: 'einheit:2', titel: 'Streife 2', gruppe: null },
  { schluessel: 'pause', titel: 'Pause', gruppe: null, ueberlappungErlaubt: true },
];

function zeige(props: Partial<SchichtplanRasterProps> = {}) {
  const onAnlegen = vi.fn();
  const onZug = vi.fn();
  const ui = (p: Partial<SchichtplanRasterProps>) => (
    <SchichtplanRaster
      zeilen={ZEILEN}
      bloecke={[]}
      spanne={{ von: T0, bis: T0 + 8 * STUNDE }}
      darfSchreiben
      zone="Europe/Berlin"
      formatMarke={() => ''}
      formatZeit={() => ''}
      onAnlegen={onAnlegen}
      onAendern={vi.fn()}
      onOeffnen={vi.fn()}
      onZug={onZug}
      beschriftung="Schichtplan"
      {...p}
    />
  );
  const r = renderMitProviders(ui(props));
  return {
    onAnlegen,
    onZug,
    neu: (p: Partial<SchichtplanRasterProps>) => r.rerender(ui({ ...props, ...p })),
  };
}

const zeile = (schluessel: string) =>
  document.querySelector(`[data-lfh="schichtplan-zeile"][data-raster-zeile="${schluessel}"]`)!;
const spur = (schluessel: string) =>
  zeile(schluessel).querySelector('[data-lfh="schichtplan-spur"]')!;

describe('SchichtplanRaster, Zeilenschleuse (LLH-1604)', () => {
  it('eine entfallene Zeile steht mit „(entfallen)“ und ohne Zeichenzeiger', () => {
    zeige();
    expect(zeile('einheit:1')).toHaveAttribute('data-entfallen', 'true');
    expect(zeile('einheit:1')).toHaveTextContent('RTW 1 (entfallen)');
    expect(spur('einheit:1')).not.toHaveStyle({ cursor: 'crosshair' });
    expect(zeile('einheit:2')).not.toHaveAttribute('data-entfallen');
    expect(screen.getByText('Streife 2')).toBeInTheDocument();
  });

  it('in einer entfallenen Zeile beginnt kein Zug', () => {
    const { onZug } = zeige();
    fireEvent.pointerDown(spur('einheit:1'), { pointerType: 'mouse', button: 0, pointerId: 1 });
    expect(onZug).not.toHaveBeenCalledWith(true);
  });

  it('ein Zug meldet Beginn und Ende', () => {
    const { onZug } = zeige();
    fireEvent.pointerDown(spur('einheit:2'), { pointerType: 'mouse', button: 0, pointerId: 1 });
    expect(onZug).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(document, { pointerType: 'mouse', pointerId: 1 });
    expect(onZug).toHaveBeenLastCalledWith(false);
  });
});

const BLOCK: RasterBlock = {
  id: 7,
  zeile: 'einheit:2',
  von: T0 + STUNDE,
  bis: T0 + 3 * STUNDE,
  text: 'Anna, Ben',
  ampel: 'besetzt',
  ampelWort: 'besetzt',
};

const EINTRAEGE = [
  { key: 'bearbeiten', label: 'Bearbeiten' },
  { key: 'loeschen', label: 'Block löschen …', gefahr: true as const },
];

const blockKnopf = () => document.querySelector<HTMLElement>('[data-lfh="schichtplan-block"]')!;
const offenesMenue = () =>
  document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label^="Aktionen zu"]',
  );

describe('SchichtplanRaster, Kontextmenü eines Blocks (LLH-1600)', () => {
  function mitMenue(extra: Partial<SchichtplanRasterProps> = {}) {
    const onWahl = vi.fn();
    const onOeffnen = vi.fn();
    const onMenue = vi.fn();
    const props: Partial<SchichtplanRasterProps> = {
      bloecke: [BLOCK],
      formatZeit: (ms) => `${new Date(ms).getUTCHours()}:00`,
      onOeffnen,
      onMenue,
      blockMenue: { eintraege: () => EINTRAEGE, onWahl },
      ...extra,
    };
    const r = zeige(props);
    return { ...r, onWahl, onOeffnen, onMenue };
  }

  it('Rechtsklick öffnet das Menü am Block; die Wahl löst nur sie aus, nicht den Blockdialog', async () => {
    const { onWahl, onOeffnen } = mitMenue();
    expect(fireEvent.contextMenu(blockKnopf(), { clientX: 300, clientY: 80, button: 2 })).toBe(
      false,
    );
    const menue = await waitFor(() => offenesMenue()!);
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Streife 2 9:00–11:00');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Bearbeiten', 'Block löschen …']);
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Block löschen …' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(onWahl).toHaveBeenCalledWith(7, 'loeschen');
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('die Kontextmenü-Taste öffnet das Menü am fokussierten Block', async () => {
    mitMenue();
    blockKnopf().focus();
    fireEvent.keyDown(blockKnopf(), { key: 'ContextMenu' });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
  });

  it('ohne Menü (kein Schreibrecht) bleibt das Browsermenü', () => {
    mitMenue({ blockMenue: undefined, darfSchreiben: false });
    expect(fireEvent.contextMenu(blockKnopf(), { button: 2 })).toBe(true);
    expect(offenesMenue()).toBeNull();
  });

  it('ohne Einträge bleibt das Browsermenü', () => {
    mitMenue({ blockMenue: { eintraege: () => [], onWahl: vi.fn() } });
    expect(fireEvent.contextMenu(blockKnopf(), { button: 2 })).toBe(true);
    expect(offenesMenue()).toBeNull();
  });

  it('das offene Menü meldet sich (die Schleuse hält) und schließt, wenn der Block verschwindet', async () => {
    const { onMenue, neu } = mitMenue();
    fireEvent.contextMenu(blockKnopf(), { button: 2 });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    expect(onMenue).toHaveBeenLastCalledWith(true);
    neu({ bloecke: [] });
    await waitFor(() => expect(offenesMenue()).toBeNull());
    expect(onMenue).toHaveBeenLastCalledWith(false);
  });

  it('ein Druck, der noch kein Zug ist, endet mit dem Menü (Strg-Klick am Mac)', async () => {
    const { onZug } = mitMenue();
    fireEvent.pointerDown(blockKnopf(), {
      pointerType: 'mouse',
      button: 0,
      ctrlKey: true,
      pointerId: 1,
    });
    expect(onZug).toHaveBeenLastCalledWith(true);
    fireEvent.contextMenu(blockKnopf(), { button: 0, ctrlKey: true });
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    expect(onZug).toHaveBeenLastCalledWith(false);
  });
});
