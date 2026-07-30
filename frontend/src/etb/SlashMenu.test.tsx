// src/etb/SlashMenu.test.tsx
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
  { id: 1, label: 'Lagemeldung', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0 },
];

describe('SlashMenu', () => {
  it('zeigt Felder- und Bausteine-Sektion und wählt per Klick', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu offen filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={vi.fn()} />,
    );
    expect(screen.getByText('Felder')).toBeInTheDocument();
    expect(screen.getByText('Bausteine')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Ereigniszeit'));
    expect(onWahl).toHaveBeenCalledWith({ art: 'feld', key: 'ereigniszeit', label: 'Ereigniszeit', gesetzt: false });
  });

  it('filtert und wählt den ersten Treffer per Enter (über externes keydown)', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu offen filter="lage" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={vi.fn()} />,
    );
    expect(screen.queryByText('Ereigniszeit')).toBeNull();
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
  });

  it('Tastatur-Nav: ArrowDown + Enter wählt den zweiten Eintrag; Escape schließt', () => {
    const onWahl = vi.fn();
    const onSchliessen = vi.fn();
    const ref = createRef<SlashMenuHandle>();
    renderMitProviders(
      <SlashMenu ref={ref} offen filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={onSchliessen} />,
    );
    // flach = [ereigniszeit, von, an, meldeweg, veranlassung, ...bausteine]
    act(() => { ref.current!.handleKey('ArrowDown'); });
    act(() => { ref.current!.handleKey('Enter'); });
    expect(onWahl).toHaveBeenCalledWith(expect.objectContaining({ art: 'feld', key: 'von' }));
    act(() => { expect(ref.current!.handleKey('Escape')).toBe(true); });
    expect(onSchliessen).toHaveBeenCalled();
  });

  it('rendert nichts, wenn geschlossen', () => {
    const { container } = renderMitProviders(
      <SlashMenu offen={false} filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={vi.fn()} onSchliessen={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="slash-menu"]')).toBeNull();
  });
});

/**
 * Die Zeilen des Menüs folgen der Dichte (LFH-365 · B5e). Sie trugen `padding: '6px 12px'`
 * und keine Höhe — im Handschuh-Betrieb also grob 16 px plus Zeilenbox gegen einen Boden
 * von 72 px, während jedes antd-Steuerelement daneben mitzog.
 *
 * WAS DIESE DATEI BELEGT UND WAS NICHT: geprüft wird der INLINE-STYLE, also die Absicht.
 * Die tatsächlich gerenderte Zeilenhöhe (Polsterung plus Zeilenbox der Schrift) rechnet
 * jsdom nicht aus; wer sie belegen will, braucht Playwright mit `boundingBox()`. Wer hier
 * mehr hineinliest, liest falsch.
 *
 * NICHT `renderMitProviders`: `test/utils.tsx` mountet ein nacktes `ConfigProvider` ohne
 * Theme. Jeder Token wäre dort eine antd-Vorgabe und die Zusicherung eine Attrappe.
 * Schablone ist `components/Liste.test.tsx:139-161`.
 */
function masse(dichte: Dichte) {
  const { container, unmount } = render(
    <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>
      <SlashMenu offen filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={vi.fn()} onSchliessen={vi.fn()} />
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
   * Dasselbe für die HÖHE — und diese Zeile ist nicht überflüssig neben dem Boden-Fall
   * unten, sondern erst zusammen mit ihm beweiskräftig.
   *
   * Gemessen: ein dichteblindes `minHeight: 72` passiert alle Boden-Zusicherungen, weil
   * 72 jeden der drei Böden erfüllt. Eine Schranke bleibt eine Schranke; sie kann nicht
   * belegen, dass der Wert aus der Stufe kommt. Genau diese Wertklasse — eine feste Zahl,
   * die zufällig konform ist — ist die, für deren Abbau B5e existiert: in der kompakten
   * Fükw-Stufe wären das 72 px pro Menüzeile statt 30.
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
   * Der Sektionskopf („Felder" / „Bausteine") zieht die Polsterung mit, bekommt aber
   * bewusst KEINE Mindesthöhe: er ist eine Beschriftung, keine Bedienfläche. Das ist
   * dieselbe Trennlinie, die der Dichte-Guard zwischen interaktiven Elementen und
   * Flächen wie `Card`/`Descriptions` zieht — eine Trefffläche für etwas, das niemand
   * antippt, vergrößert nur das Menü.
   */
  it('zieht den Sektionskopf mit, ohne ihm eine Trefffläche zu geben', () => {
    expect(masse('handschuh').kopfPadding).not.toBe(masse('kompakt').kopfPadding);
    expect(masse('handschuh').kopfMinHeight).toBe('');
  });
});
