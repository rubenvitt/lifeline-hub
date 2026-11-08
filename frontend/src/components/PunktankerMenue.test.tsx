import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MenuProps } from 'antd';
import { renderMitProviders } from '../../test/utils';
import PunktankerMenue, { punktmenueEintragStil } from './PunktankerMenue';
import { escGehoertOverlay } from './zeichnenEsc';

const offenesMenue = () =>
  document.querySelector<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');

const ITEMS: NonNullable<MenuProps['items']> = [
  { key: 'eins', label: 'Erster' },
  { key: 'zwei', label: 'Zweiter' },
];
const KOPF = '32U 512345 5934567';

/** Wie die Karte: `onSchliessen` nimmt den Anker weg, das Menü verschwindet. */
function MitKarte(props: {
  onWaehlen: (k: string) => void;
  onSchliessen: () => void;
  fokusZiel: HTMLElement;
}) {
  const [anker, setAnker] = useState<{ x: number; y: number } | null>({ x: 40, y: 50 });
  return (
    <PunktankerMenue
      anker={anker}
      ariaLabel="Aktionen an dieser Stelle"
      ankerKennung="test-anker"
      items={ITEMS}
      kopf={KOPF}
      onWaehlen={props.onWaehlen}
      onSchliessen={() => {
        props.onSchliessen();
        setAnker(null);
      }}
      fokusZiel={() => props.fokusZiel}
    />
  );
}

function aufbau() {
  const fokusZiel = document.createElement('button');
  document.body.appendChild(fokusZiel);
  const onWaehlen = vi.fn();
  const onSchliessen = vi.fn();
  const r = renderMitProviders(
    <MitKarte onWaehlen={onWaehlen} onSchliessen={onSchliessen} fokusZiel={fokusZiel} />,
  );
  return { ...r, onWaehlen, onSchliessen, fokusZiel };
}

describe('PunktankerMenue (LFH-776, Schale aus LFH-812)', () => {
  it('trägt den zugänglichen Namen und die Einträge in Reihenfolge, am Anker verankert', async () => {
    aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    expect(menue).toHaveAttribute('aria-label', 'Aktionen an dieser Stelle');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Erster', 'Zweiter']);
    const anker = document.querySelector<HTMLElement>('[data-lfh="test-anker"]');
    expect(anker).not.toBeNull();
    expect(anker!.style.left).toBe('40px');
    expect(anker!.style.top).toBe('50px');
  });

  it('der Kopf steht über dem Menü, ist aber kein wählbarer Eintrag', async () => {
    const { onWaehlen } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const kopf = document.querySelector<HTMLElement>('[data-lfh="test-anker-kopf"]');
    expect(kopf).toHaveTextContent(KOPF);
    expect(kopf!.closest('[role="menuitem"]')).toBeNull();
    expect(offenesMenue()!.contains(kopf)).toBe(false);
    await userEvent.click(kopf!);
    expect(onWaehlen).not.toHaveBeenCalled();
  });

  it('jeder Eintrag trägt den Stilboden der Steuerhöhe', async () => {
    aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    for (const e of within(offenesMenue()!).getAllByRole('menuitem')) {
      expect(e.style.minHeight).not.toBe('');
    }
  });

  it('Klick wählt, schließt und gibt den Fokus zurück', async () => {
    const { onWaehlen, onSchliessen, fokusZiel } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()!).getByText('Zweiter'));
    expect(onWaehlen).toHaveBeenCalledExactlyOnceWith('zwei');
    expect(onSchliessen).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(fokusZiel));
  });

  // Pfeiltasten führt rc-menu nur über sichtbare Einträge (jsdom ohne Layout); der Weg Pfeil →
  // Enter steht im e2e. Hier: Fokus im Menü, Pfeil + Enter wählt den aktiven Eintrag.
  it('der Fokus liegt im Menü, Pfeil und Enter wählen', async () => {
    const { onWaehlen, onSchliessen } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    await waitFor(() => expect(menue.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', keyCode: 13, which: 13 });
    expect(onWaehlen).toHaveBeenCalledOnce();
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('Esc schließt ohne Wahl und gibt den Fokus zurück', async () => {
    const { onWaehlen, onSchliessen, fokusZiel } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onWaehlen).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(fokusZiel));
  });

  it('der Zeichnen-Esc erkennt das offene Menü als Overlay', async () => {
    aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    expect(escGehoertOverlay(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
  });

  it('verschwindet der Anker von außen, geht der Fokus aus dem Menü an die Karte', async () => {
    const karte = document.createElement('button');
    document.body.appendChild(karte);
    const props = {
      ariaLabel: 'Aktionen an dieser Stelle',
      ankerKennung: 'test-anker',
      items: ITEMS,
      onWaehlen: vi.fn(),
      onSchliessen: vi.fn(),
      fokusZiel: () => karte,
    };
    const { rerender } = renderMitProviders(<PunktankerMenue anker={{ x: 1, y: 1 }} {...props} />);
    await waitFor(() => expect(offenesMenue()?.contains(document.activeElement)).toBe(true));
    rerender(<PunktankerMenue anker={null} {...props} />);
    await waitFor(() => expect(document.activeElement).toBe(karte));
    expect(props.onSchliessen).not.toHaveBeenCalled();
  });
});

describe('punktmenueEintragStil', () => {
  const token = (controlHeight: number) => ({ controlHeight, paddingXS: 8, paddingSM: 12 });

  it('hält die Steuerhöhe jeder Dichtestufe als Boden', () => {
    expect(punktmenueEintragStil(token(30)).minHeight).toBeGreaterThanOrEqual(30);
    expect(punktmenueEintragStil(token(48)).minHeight).toBeGreaterThanOrEqual(48);
    expect(punktmenueEintragStil(token(72)).minHeight).toBeGreaterThanOrEqual(72);
  });
});
