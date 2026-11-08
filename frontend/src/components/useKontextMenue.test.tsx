import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import {
  DRUCK_ATTRIBUT,
  LANGDRUCK_MS,
  LANGDRUCK_WEG,
  TASTEN_NACHLAUF_MS,
  istKontextTaste,
  useKontextMenue,
  type KontextOeffnung,
} from './useKontextMenue';

type Oeffnen = (schluessel: string, oeffnung: KontextOeffnung) => boolean;

function Probe({
  onOeffnen,
  kannOeffnen,
}: {
  onOeffnen: Oeffnen;
  kannOeffnen?: (schluessel: string) => boolean;
}) {
  const ausloeser = useKontextMenue<string>({
    onOeffnen,
    ...(kannOeffnen ? { kannOeffnen } : {}),
  });
  return (
    <ul>
      <li data-testid="zeile" tabIndex={-1} {...ausloeser('z1')}>
        <a href="/ziel">Titel-Link</a>
        <span data-testid="text">Freitext der Zeile</span>
        <input aria-label="Feld" />
        <textarea aria-label="Notiz" />
        <select aria-label="Wahl">
          <option>a</option>
        </select>
        <div data-testid="editierbar" contentEditable suppressContentEditableWarning>
          frei
        </div>
        {/* Ein Portal in der Zeile (offenes ⋮-Menü): seine Ereignisse steigen im React-Baum auf. */}
        {createPortal(
          <button type="button" data-testid="portal">
            Eintrag im ⋮-Menü
          </button>,
          document.body,
        )}
      </li>
    </ul>
  );
}

function aufbau(ergebnis = true, kannOeffnen?: (schluessel: string) => boolean) {
  const onOeffnen = vi.fn<Oeffnen>(() => ergebnis);
  render(<Probe onOeffnen={onOeffnen} {...(kannOeffnen ? { kannOeffnen } : {})} />);
  return { onOeffnen, zeile: screen.getByTestId('zeile') };
}

/** `fireEvent` liefert `false`, wenn das Ereignis abgebrochen wurde (Browsermenü unterdrückt). */
const rechtsklick = (el: Element, x = 30, y = 40) =>
  fireEvent.contextMenu(el, { clientX: x, clientY: y, button: 2 });

const touch = { isPrimary: true, pointerId: 7, pointerType: 'touch', button: 0 };

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

describe('useKontextMenue — Rechtsklick (LLH-1596, D1/D2)', () => {
  it('öffnet am Zeigerpunkt mit Ursprung „zeiger“ und verhindert das Browsermenü', () => {
    const { onOeffnen, zeile } = aufbau();
    const nichtAbgebrochen = rechtsklick(screen.getByTestId('text'), 30, 40);
    expect(nichtAbgebrochen).toBe(false);
    expect(onOeffnen).toHaveBeenCalledTimes(1);
    expect(onOeffnen).toHaveBeenCalledWith(
      'z1',
      expect.objectContaining({ anker: { x: 30, y: 40 }, ursprung: 'zeiger', element: zeile }),
    );
  });

  it.each([
    ['Link', () => screen.getByRole('link', { name: 'Titel-Link' })],
    ['Eingabefeld', () => screen.getByRole('textbox', { name: 'Feld' })],
    ['Textbereich', () => screen.getByRole('textbox', { name: 'Notiz' })],
    ['Auswahlfeld', () => screen.getByRole('combobox', { name: 'Wahl' })],
    ['editierbarer Bereich', () => screen.getByTestId('editierbar')],
  ])('lässt das Browsermenü auf %s', (_name, ziel) => {
    const { onOeffnen } = aufbau();
    expect(rechtsklick(ziel())).toBe(true);
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('lässt das Browsermenü auf markiertem Text', () => {
    const { onOeffnen } = aufbau();
    const text = screen.getByTestId('text');
    const bereich = document.createRange();
    bereich.selectNodeContents(text);
    window.getSelection()!.addRange(bereich);
    expect(rechtsklick(text)).toBe(true);
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('öffnet trotz Markierung anderswo auf der Seite', () => {
    const anderswo = document.createElement('p');
    anderswo.textContent = 'woanders';
    document.body.appendChild(anderswo);
    const { onOeffnen } = aufbau();
    const bereich = document.createRange();
    bereich.selectNodeContents(anderswo);
    window.getSelection()!.addRange(bereich);
    expect(rechtsklick(screen.getByTestId('text'))).toBe(false);
    expect(onOeffnen).toHaveBeenCalledTimes(1);
    anderswo.remove();
  });

  it('lässt das Browsermenü, wenn der Datensatz keine Einträge meldet', () => {
    const { onOeffnen } = aufbau(false);
    expect(rechtsklick(screen.getByTestId('text'))).toBe(true);
    expect(onOeffnen).toHaveBeenCalledTimes(1);
  });
});

describe('useKontextMenue — langer Druck (D3)', () => {
  it('öffnet nach 550 ms ohne Bewegung an der Druckstelle', () => {
    vi.useFakeTimers();
    const { onOeffnen, zeile } = aufbau();
    fireEvent.pointerDown(screen.getByTestId('text'), { ...touch, clientX: 50, clientY: 60 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS - 1));
    expect(onOeffnen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onOeffnen).toHaveBeenCalledWith(
      'z1',
      expect.objectContaining({ anker: { x: 50, y: 60 }, ursprung: 'zeiger', element: zeile }),
    );
  });

  it.each([
    [
      'Bewegung über 8 px',
      (el: Element) =>
        fireEvent.pointerMove(el, { ...touch, clientX: 50 + LANGDRUCK_WEG + 1, clientY: 60 }),
    ],
    ['Abheben', (el: Element) => fireEvent.pointerUp(el, touch)],
    ['Abbruch', (el: Element) => fireEvent.pointerCancel(el, touch)],
  ])('öffnet nicht nach %s', (_name, stoer) => {
    vi.useFakeTimers();
    const { onOeffnen } = aufbau();
    const text = screen.getByTestId('text');
    fireEvent.pointerDown(text, { ...touch, clientX: 50, clientY: 60 });
    act(() => vi.advanceTimersByTime(200));
    stoer(text);
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('kleine Bewegung bis 8 px bricht nicht ab', () => {
    vi.useFakeTimers();
    const { onOeffnen } = aufbau();
    const text = screen.getByTestId('text');
    fireEvent.pointerDown(text, { ...touch, clientX: 50, clientY: 60 });
    fireEvent.pointerMove(text, { ...touch, clientX: 50 + LANGDRUCK_WEG, clientY: 60 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    expect(onOeffnen).toHaveBeenCalledTimes(1);
  });

  it('die Maus startet keinen Zeitgeber', () => {
    vi.useFakeTimers();
    const { onOeffnen } = aufbau();
    fireEvent.pointerDown(screen.getByTestId('text'), { ...touch, pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS * 2));
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('ein langer Druck auf einen Link öffnet nicht (Linkmenü des Systems)', () => {
    vi.useFakeTimers();
    const { onOeffnen } = aufbau();
    fireEvent.pointerDown(screen.getByRole('link'), { ...touch, clientX: 5, clientY: 5 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('unterdrückt das native Kontextmenü während des Drucks, ohne doppelt zu öffnen', () => {
    vi.useFakeTimers();
    const { onOeffnen } = aufbau();
    const text = screen.getByTestId('text');
    fireEvent.pointerDown(text, { ...touch, clientX: 50, clientY: 60 });
    act(() => vi.advanceTimersByTime(300));
    // Android-Chrome feuert beim Halten selbst ein `contextmenu`.
    expect(rechtsklick(text, 50, 60)).toBe(false);
    expect(onOeffnen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    expect(onOeffnen).toHaveBeenCalledTimes(1);
    expect(rechtsklick(text, 50, 60)).toBe(false);
    expect(onOeffnen).toHaveBeenCalledTimes(1);
  });

  it('sperrt Markieren und Systemblase nur während des Drucks', () => {
    vi.useFakeTimers();
    const { zeile } = aufbau();
    fireEvent.pointerDown(screen.getByTestId('text'), { ...touch, clientX: 50, clientY: 60 });
    expect(zeile).toHaveAttribute(DRUCK_ATTRIBUT);
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    fireEvent.pointerUp(screen.getByTestId('text'), touch);
    expect(zeile).not.toHaveAttribute(DRUCK_ATTRIBUT);
  });

  it('die Regel zum Druck-Attribut steht im globalen Stil', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
    const regel = new RegExp(`\\[${DRUCK_ATTRIBUT}\\][^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(regel).toMatch(/(^|[;\s])user-select:\s*none/);
    expect(regel).toMatch(/-webkit-user-select:\s*none/);
    expect(regel).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it('das Abheben nach dem langen Druck erreicht die Zeile nicht als Klick (Nachklick-Riegel)', () => {
    vi.useFakeTimers();
    const beiKlick = vi.fn();
    const { zeile } = aufbau();
    zeile.addEventListener('click', beiKlick);
    const text = screen.getByTestId('text');
    fireEvent.touchStart(text, { touches: [{ clientX: 50, clientY: 60 }] });
    fireEvent.pointerDown(text, { ...touch, clientX: 50, clientY: 60 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    fireEvent.pointerUp(text, touch);
    fireEvent.touchEnd(text, { touches: [] });
    fireEvent.click(text);
    expect(beiKlick).not.toHaveBeenCalled();
    // Nach dem Nachlauf kommt ein bewusster Tipp wieder an.
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(text);
    expect(beiKlick).toHaveBeenCalledTimes(1);
  });
});

describe('useKontextMenue — Tastatur (D4)', () => {
  it.each([
    ['Kontextmenü-Taste', { key: 'ContextMenu' }],
    ['Umschalt+F10', { key: 'F10', shiftKey: true }],
  ])('%s öffnet am Element mit Ursprung „tastatur“, auch auf dem Titel-Link', (_n, taste) => {
    const { onOeffnen, zeile } = aufbau();
    zeile.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 210, bottom: 60, width: 200, height: 40 }) as DOMRect;
    const link = screen.getByRole('link');
    link.focus();
    expect(fireEvent.keyDown(link, taste)).toBe(false);
    expect(onOeffnen).toHaveBeenCalledWith(
      'z1',
      expect.objectContaining({
        anker: { x: 10, y: 60 },
        ursprung: 'tastatur',
        element: zeile,
        vorherFokus: link,
      }),
    );
  });

  it('im Eingabefeld bleibt die Taste beim Browser', () => {
    const { onOeffnen } = aufbau();
    const feld = screen.getByRole('textbox', { name: 'Feld' });
    expect(fireEvent.keyDown(feld, { key: 'ContextMenu' })).toBe(true);
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('F10 ohne Umschalt öffnet nicht', () => {
    const { onOeffnen, zeile } = aufbau();
    fireEvent.keyDown(zeile, { key: 'F10' });
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('verwirft das nachgeschobene `contextmenu` derselben Taste', () => {
    vi.useFakeTimers();
    const { onOeffnen, zeile } = aufbau();
    fireEvent.keyDown(zeile, { key: 'ContextMenu' });
    expect(fireEvent.contextMenu(zeile, { clientX: 0, clientY: 0, button: 0 })).toBe(false);
    expect(onOeffnen).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(TASTEN_NACHLAUF_MS + 1));
    rechtsklick(screen.getByTestId('text'));
    expect(onOeffnen).toHaveBeenCalledTimes(2);
  });
});

describe('useKontextMenue — Befunde aus dem Review (LLH-1596)', () => {
  it('ein Portal in der Zeile öffnet nichts: Rechtsklick, Taste, langer Druck', () => {
    vi.useFakeTimers();
    const { onOeffnen } = aufbau();
    const portal = screen.getByTestId('portal');
    expect(rechtsklick(portal)).toBe(true);
    expect(fireEvent.keyDown(portal, { key: 'F10', shiftKey: true })).toBe(true);
    fireEvent.pointerDown(portal, { ...touch, clientX: 5, clientY: 5 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    expect(onOeffnen).not.toHaveBeenCalled();
  });

  it('langer Druck auf einen Datensatz ohne Einträge sperrt weder Markieren noch Browsermenü', () => {
    vi.useFakeTimers();
    const { onOeffnen, zeile } = aufbau(false, () => false);
    const text = screen.getByTestId('text');
    fireEvent.pointerDown(text, { ...touch, clientX: 50, clientY: 60 });
    expect(zeile).not.toHaveAttribute(DRUCK_ATTRIBUT);
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS + 10));
    // Android-Chrome schiebt sein natives Menü nach: es bleibt.
    expect(rechtsklick(text)).toBe(true);
    expect(onOeffnen).toHaveBeenCalledTimes(1);
  });

  it('meldet `onOeffnen` beim Zeitgeber „keine Einträge“, endet der Druck', () => {
    vi.useFakeTimers();
    const { zeile } = aufbau(false);
    const text = screen.getByTestId('text');
    fireEvent.pointerDown(text, { ...touch, clientX: 50, clientY: 60 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    expect(zeile).not.toHaveAttribute(DRUCK_ATTRIBUT);
    expect(rechtsklick(text)).toBe(true);
  });

  it('das nachgeschobene `contextmenu` der Taste wird auch am fokussierten Menü verworfen', () => {
    vi.useFakeTimers();
    const { zeile } = aufbau();
    fireEvent.keyDown(zeile, { key: 'ContextMenu' });
    // Der Browser schickt es an das fokussierte Element, das schon im Menü (Portal) steht.
    const imMenue = document.createElement('div');
    document.body.appendChild(imMenue);
    const draussenGesehen = vi.fn();
    window.addEventListener('contextmenu', draussenGesehen, true);
    expect(fireEvent.contextMenu(imMenue, { button: 0 })).toBe(false);
    // rc-trigger hört am `window` (Capture) und schlösse das Menü: es sieht das Ereignis nicht.
    expect(draussenGesehen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TASTEN_NACHLAUF_MS + 1));
    expect(fireEvent.contextMenu(imMenue, { button: 2 })).toBe(true);
    expect(draussenGesehen).toHaveBeenCalledTimes(1);
    window.removeEventListener('contextmenu', draussenGesehen, true);
    imMenue.remove();
  });

  it('Stift ohne Touch-Ereignisse: das Abheben nach dem langen Druck wirkt nicht als Klick', () => {
    vi.useFakeTimers();
    const beiKlick = vi.fn();
    const { zeile } = aufbau();
    zeile.addEventListener('click', beiKlick);
    const text = screen.getByTestId('text');
    const stift = { ...touch, pointerType: 'pen' };
    fireEvent.pointerDown(text, { ...stift, clientX: 50, clientY: 60 });
    act(() => vi.advanceTimersByTime(LANGDRUCK_MS));
    fireEvent.pointerUp(text, stift);
    fireEvent.mouseUp(text);
    fireEvent.click(text);
    expect(beiKlick).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(text);
    expect(beiKlick).toHaveBeenCalledTimes(1);
  });
});

describe('istKontextTaste', () => {
  it('erkennt Kontextmenü-Taste und Umschalt+F10, sonst nichts', () => {
    expect(istKontextTaste({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(istKontextTaste({ key: 'F10', shiftKey: true })).toBe(true);
    expect(istKontextTaste({ key: 'F10', shiftKey: false })).toBe(false);
    expect(istKontextTaste({ key: 'Enter', shiftKey: true })).toBe(false);
  });
});
