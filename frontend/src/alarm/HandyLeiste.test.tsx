import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entferneUntereLeiste, meldeUntereLeiste } from '../components/untereLeiste';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import { zoneSetzen, type ZonenEintrag } from './alarmZoneSpeicher';
import { EINGAENGE_OEFFNEN_EVENT } from './eingaenge';
import HandyLeiste, { LEISTE_HOEHE } from './HandyLeiste';

/** Spec `benachrichtigungen`, „Eine Leiste am Handschirm“ (LLH-1738, design.md D5). */

const BESITZER = Symbol('test');

function alarm(schluessel: string, titel = 'Auftrag überfällig'): ZonenEintrag {
  return {
    schluessel,
    stufe: 'alarm',
    titel,
    beschreibung: 'Auftrag #12 an S2',
    name: titel,
    oeffnen: vi.fn(),
    gelesen: vi.fn(),
    ausblenden: vi.fn(),
  };
}

function leiste(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-lfh="handy-leiste"]');
}

function Probe({
  eingaenge,
  ausblenden = vi.fn(),
}: {
  eingaenge: number;
  ausblenden?: () => void;
}) {
  return (
    <>
      <input aria-label="Wortlaut" />
      <HandyLeiste einsatzId={1} eingaenge={eingaenge} eingaengeAusblenden={ausblenden} />
    </>
  );
}

afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

describe('HandyLeiste (LLH-1738)', () => {
  it('ohne Alarm und Eingang steht keine Leiste', () => {
    setzeViewportBreite(390);
    render(<Probe eingaenge={0} />);
    expect(leiste()).toBeNull();
  });

  it('nennt Alarme und Eingänge in einer Zeile; ein Tipp öffnet das Blatt', async () => {
    setzeViewportBreite(390);
    const geoeffnet = vi.fn();
    window.addEventListener(EINGAENGE_OEFFNEN_EVENT, geoeffnet);
    render(<Probe eingaenge={3} />);
    act(() => zoneSetzen(BESITZER, [alarm('b-1')]));
    const l = leiste()!;
    expect(l).toHaveTextContent('1 Alarm · 3 Eingänge');
    expect(LEISTE_HOEHE).toBeLessThanOrEqual(48);
    await userEvent.click(within(l).getByRole('button', { name: /1 Alarm · 3 Eingänge/ }));
    expect(geoeffnet).toHaveBeenCalledOnce();
    expect((geoeffnet.mock.calls[0][0] as CustomEvent).detail).toEqual({ einsatzId: 1 });
    window.removeEventListener(EINGAENGE_OEFFNEN_EVENT, geoeffnet);
  });

  it('Mehrzahl: „2 Alarme“, ein Eingang „1 Eingang“', () => {
    setzeViewportBreite(390);
    render(<Probe eingaenge={1} />);
    act(() => zoneSetzen(BESITZER, [alarm('b-1'), alarm('b-2')]));
    expect(leiste()).toHaveTextContent('2 Alarme · 1 Eingang');
  });

  it('beim Tippen ohne Alarm klappt sie ein und kommt nach dem Feld wieder', () => {
    setzeViewportBreite(390);
    render(<Probe eingaenge={3} />);
    expect(leiste()).not.toBeNull();
    act(() => screen.getByLabelText('Wortlaut').focus());
    expect(leiste()).toBeNull();
    act(() => (document.activeElement as HTMLElement).blur());
    expect(leiste()).not.toBeNull();
  });

  it('beim Tippen mit Alarm bleibt eine Zeile mit dem jüngsten Alarm', () => {
    setzeViewportBreite(390);
    render(<Probe eingaenge={3} />);
    act(() => zoneSetzen(BESITZER, [alarm('b-1'), alarm('b-2', 'Bestätigung ausstehend · RTW 2')]));
    act(() => screen.getByLabelText('Wortlaut').focus());
    const l = leiste()!;
    expect(l).toHaveTextContent('2 Alarme');
    expect(l).toHaveTextContent('Bestätigung ausstehend · RTW 2');
    expect(l).not.toHaveTextContent('Eingänge');
  });

  it('nur Eingänge: ✕ blendet sie aus', async () => {
    setzeViewportBreite(390);
    const ausblenden = vi.fn();
    render(<Probe eingaenge={2} ausblenden={ausblenden} />);
    await userEvent.click(
      within(leiste()!).getByRole('button', { name: 'Ausblenden, ohne zu quittieren' }),
    );
    expect(ausblenden).toHaveBeenCalledOnce();
  });

  it('mit Alarm kein ✕: ein Alarm geht nur über das Blatt', () => {
    setzeViewportBreite(390);
    render(<Probe eingaenge={2} />);
    act(() => zoneSetzen(BESITZER, [alarm('b-1')]));
    expect(within(leiste()!).queryByRole('button', { name: /Ausblenden/ })).toBeNull();
  });

  it('ab md steht keine Leiste', () => {
    setzeViewportBreite(1024);
    render(<Probe eingaenge={3} />);
    act(() => zoneSetzen(BESITZER, [alarm('b-1')]));
    expect(leiste()).toBeNull();
  });

  it('kommt der Eingang erst nach der unteren Leiste, rückt sie trotzdem darüber', () => {
    setzeViewportBreite(390);
    const untere = document.createElement('div');
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 844,
    });
    const kasten = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const k =
          this === untere
            ? { top: 780, bottom: 844, left: 0, right: 390, height: 64 }
            : this.getAttribute('data-lfh') === 'handy-leiste'
              ? { top: 0, bottom: 48, left: 0, right: 390, height: 48 }
              : {};
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...k } as DOMRect;
      });
    try {
      act(() => meldeUntereLeiste(untere));
      const { rerender } = render(<Probe eingaenge={0} />);
      expect(leiste()).toBeNull();
      rerender(<Probe eingaenge={2} />);
      // Über der Oberkante der unteren Leiste (844 − 780).
      expect(Number(leiste()!.dataset.abstandUnten)).toBe(64);
    } finally {
      act(() => entferneUntereLeiste(untere));
      kasten.mockRestore();
      delete (document.documentElement as { clientHeight?: number }).clientHeight;
    }
  });
});
