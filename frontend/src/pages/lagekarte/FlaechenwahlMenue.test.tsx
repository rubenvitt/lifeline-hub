import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import FlaechenwahlMenue, { type Flaechenwahl } from './FlaechenwahlMenue';
import { escGehoertOverlay } from './zeichnenEsc';

const wahl: Flaechenwahl = {
  x: 120,
  y: 80,
  eintraege: [
    { schluessel: 'zone:3', text: 'Absperrbereich: Nord' },
    { schluessel: 'abschnitt:9', text: 'Abschnitt: EA 2 Süd' },
  ],
};

const offenesMenue = () =>
  document.querySelector<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');

/** Wie die Karte: `onSchliessen` nimmt die Wahl weg, das Menü verschwindet. */
function MitKarte(props: {
  onWaehlen: (s: string) => void;
  onSchliessen: () => void;
  fokusZiel: HTMLElement;
}) {
  const [offen, setOffen] = useState<Flaechenwahl | null>(wahl);
  return (
    <FlaechenwahlMenue
      wahl={offen}
      onWaehlen={props.onWaehlen}
      onSchliessen={() => {
        props.onSchliessen();
        setOffen(null);
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

describe('FlaechenwahlMenue (LFH-812)', () => {
  it('bietet jede Fläche in der übergebenen Reihenfolge an, benannt', async () => {
    aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    expect(menue).toHaveAttribute('aria-label', 'Fläche wählen');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Absperrbereich: Nord', 'Abschnitt: EA 2 Süd']);
  });

  it('ohne Wahl rendert es nichts', () => {
    renderMitProviders(
      <FlaechenwahlMenue wahl={null} onWaehlen={vi.fn()} onSchliessen={vi.fn()} />,
    );
    expect(offenesMenue()).toBeNull();
  });

  it('Klick auf einen Eintrag wählt ihn, schließt und gibt den Fokus zurück', async () => {
    const { onWaehlen, onSchliessen, fokusZiel } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()!).getByText('Abschnitt: EA 2 Süd'));
    expect(onWaehlen).toHaveBeenCalledExactlyOnceWith('abschnitt:9');
    expect(onSchliessen).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(fokusZiel));
  });

  // Pfeiltasten führt rc-menu nur über sichtbare Einträge; jsdom rechnet kein Layout, deshalb
  // steht der Weg Pfeil → Enter im e2e (`lagekarte-touch.spec.ts`). Hier: Fokus im Menü, Enter wählt.
  it('der Fokus liegt im Menü, Enter wählt den aktiven Eintrag', async () => {
    const { onWaehlen } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    await waitFor(() => expect(menue.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', keyCode: 40, which: 40 });
    expect(document.activeElement).toHaveTextContent('Absperrbereich: Nord');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', keyCode: 13, which: 13 });
    expect(onWaehlen).toHaveBeenCalledExactlyOnceWith('zone:3');
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
    expect(screen.queryByRole('menu', { hidden: true })).not.toBeNull();
  });
});
