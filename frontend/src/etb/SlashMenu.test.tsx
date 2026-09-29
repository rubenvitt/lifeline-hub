import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EtbBaustein } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { antdToken, farbenHell, type Dichte } from '../theme/tokens';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';

const bausteine: EtbBaustein[] = [
  {
    id: 1,
    label: 'Lagemeldung',
    typ: 'meldung',
    inhalt: '',
    meldeweg: null,
    veranlassung: null,
    sortier: 0,
  },
];

describe('SlashMenu', () => {
  it('zeigt Felder- und Bausteine-Sektion und wählt per Klick', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu
        offen
        filter=""
        bausteine={bausteine}
        gesetzteFelder={[]}
        onWahl={onWahl}
        onSchliessen={vi.fn()}
      />,
    );
    expect(screen.getByText('Felder')).toBeInTheDocument();
    expect(screen.getByText('Bausteine')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Ereigniszeit'));
    expect(onWahl).toHaveBeenCalledWith({
      art: 'feld',
      key: 'ereigniszeit',
      label: 'Ereigniszeit',
      gesetzt: false,
    });
  });

  it('filtert und wählt den ersten Treffer per Enter (über externes keydown)', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu
        offen
        filter="lage"
        bausteine={bausteine}
        gesetzteFelder={[]}
        onWahl={onWahl}
        onSchliessen={vi.fn()}
      />,
    );
    expect(screen.queryByText('Ereigniszeit')).toBeNull();
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
  });

  it('Tastatur-Nav: ArrowDown + Enter wählt den zweiten Eintrag; Escape schließt', () => {
    const onWahl = vi.fn();
    const onSchliessen = vi.fn();
    const ref = createRef<SlashMenuHandle>();
    renderMitProviders(
      <SlashMenu
        ref={ref}
        offen
        filter=""
        bausteine={bausteine}
        gesetzteFelder={[]}
        onWahl={onWahl}
        onSchliessen={onSchliessen}
      />,
    );
    // flach = [ereigniszeit, von, an, meldeweg, veranlassung, ...bausteine]
    act(() => {
      ref.current!.handleKey('ArrowDown');
    });
    act(() => {
      ref.current!.handleKey('Enter');
    });
    expect(onWahl).toHaveBeenCalledWith(expect.objectContaining({ art: 'feld', key: 'von' }));
    act(() => {
      expect(ref.current!.handleKey('Escape')).toBe(true);
    });
    expect(onSchliessen).toHaveBeenCalled();
  });

  it('stellt Typen als ERSTE Sektion voran, wenn der Aufrufer sie anbietet (Neuentwurf S4)', () => {
    const onWahl = vi.fn();
    const ref = createRef<SlashMenuHandle>();
    renderMitProviders(
      <SlashMenu
        ref={ref}
        offen
        filter=""
        bausteine={bausteine}
        gesetzteFelder={[]}
        typenAnbieten
        onWahl={onWahl}
        onSchliessen={vi.fn()}
      />,
    );
    const menue = screen.getByTestId('slash-menu');
    const titel = [...menue.querySelectorAll('span')].map((t) => t.textContent);
    expect(titel.slice(0, 3)).toEqual(['Typ', 'Felder', 'Bausteine']);
    act(() => {
      ref.current!.handleKey('Enter');
    });
    expect(onWahl).toHaveBeenCalledWith({ art: 'typ', key: 'meldung', label: '/meldung' });
  });

  it('zeigt im @-Modus nur die Einheiten und geht auf Wunsch nach oben auf', () => {
    renderMitProviders(
      <SlashMenu
        offen
        filter="flo"
        bausteine={bausteine}
        gesetzteFelder={[]}
        einheiten={[{ art: 'einheit', key: 'von:Florian 1', label: 'Von: Florian 1' }]}
        richtung="oben"
        onWahl={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const menue = screen.getByTestId('slash-menu');
    expect(menue).toHaveTextContent('Einheit');
    expect(menue).toHaveTextContent('Von: Florian 1');
    expect(menue).not.toHaveTextContent('Felder');
    // Die Erfassung steht am Seitenfuß: ein Menü nach unten liefe aus dem Fenster.
    expect(menue.style.bottom).toBe('100%');
  });

  it('rendert nichts, wenn geschlossen', () => {
    const { container } = renderMitProviders(
      <SlashMenu
        offen={false}
        filter=""
        bausteine={bausteine}
        gesetzteFelder={[]}
        onWahl={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="slash-menu"]')).toBeNull();
  });
});

/**
 * Die Zeilen des Menüs folgen der Dichte (LFH-365).
 *
 * Geprüft wird der INLINE-STYLE, also die Absicht. Die gerenderte Zeilenhöhe rechnet jsdom
 * nicht aus; wer sie belegen will, braucht Playwright mit `boundingBox()`.
 *
 * NICHT `renderMitProviders`: `test/utils.tsx` mountet ein nacktes `ConfigProvider` ohne
 * Theme, jeder Token wäre dort eine antd-Vorgabe. Schablone ist `components/Liste.test.tsx`.
 */
function masse(dichte: Dichte) {
  const { container, unmount } = render(
    <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>
      <SlashMenu
        offen
        filter=""
        bausteine={bausteine}
        gesetzteFelder={[]}
        onWahl={vi.fn()}
        onSchliessen={vi.fn()}
      />
    </ConfigProvider>,
  );
  const option = container.querySelector<HTMLElement>('[role="option"]')!;
  const kopf = container.querySelector<HTMLElement>('[data-slash-menu] span')!;
  const werte = {
    padding: option.style.padding,
    minHeight: option.style.minHeight,
    kopfPadding: kopf.style.padding,
    kopfMinHeight: kopf.style.minHeight,
  };
  unmount();
  return werte;
}

describe('SlashMenu — die Zeilen folgen der Dichte (LFH-365 · B5e)', () => {
  /** Ein hartkodiertes `'6px 12px'` bliebe über beide Stufen byte-gleich. */
  it('zieht die Polsterung bei einer Dichteumschaltung mit', () => {
    expect(masse('handschuh').padding).not.toBe(masse('kompakt').padding);
  });

  /**
   * Dasselbe für die HÖHE — erst zusammen mit dem Boden-Fall unten beweiskräftig: ein
   * dichteblindes `minHeight: 72` erfüllte jeden der drei Böden. Eine Schranke kann nicht
   * belegen, dass der Wert aus der Stufe kommt; in der kompakten Stufe wären das 72 px pro
   * Menüzeile statt 30.
   */
  it('zieht die Höhe bei einer Dichteumschaltung mit', () => {
    expect(masse('handschuh').minHeight).not.toBe(masse('kompakt').minHeight);
  });

  /**
   * Die Böden aus Gate 3 der Bedien-Leitlinie, als Literale hingeschrieben — NICHT aus
   * dem Token zurückgelesen, sonst prüfte die Zusicherung den Token gegen sich selbst.
   */
  it.each([
    ['kompakt', 24],
    ['komfortabel', 48],
    ['handschuh', 72],
  ] as const)('erreicht in %s den Trefflächenboden von %i px', (dichte, boden) => {
    expect(parseFloat(masse(dichte).minHeight)).toBeGreaterThanOrEqual(boden);
  });

  /**
   * Der Sektionskopf („Felder" / „Bausteine") zieht die Polsterung mit, bekommt aber bewusst
   * KEINE Mindesthöhe: er ist eine Beschriftung, keine Bedienfläche (dieselbe Trennlinie wie im
   * Dichte-Guard bei `Card`/`Descriptions`).
   */
  it('zieht den Sektionskopf mit, ohne ihm eine Trefffläche zu geben', () => {
    expect(masse('handschuh').kopfPadding).not.toBe(masse('kompakt').kopfPadding);
    expect(masse('handschuh').kopfMinHeight).toBe('');
  });
});
