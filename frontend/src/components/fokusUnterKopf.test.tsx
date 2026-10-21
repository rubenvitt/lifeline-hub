import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import type { TableRef } from 'antd';
import { kopfUeberdeckung, useFokusUnterKopf } from './fokusUnterKopf';

describe('kopfUeberdeckung (LLH-1102)', () => {
  it('unter der Kopfzeile → um die Überdeckung zurück, sonst 0', () => {
    const kopf = { top: 145, bottom: 221 };
    // Ganz darunter (gemessen 1024 × 768 Handschuh, Gefahrenmatrix): 76 px zurück.
    expect(kopfUeberdeckung({ top: 145, bottom: 217 }, kopf)).toBe(-76);
    // Halb darunter: so weit, dass das Ziel an der Kopfzeile beginnt.
    expect(kopfUeberdeckung({ top: 200, bottom: 272 }, kopf)).toBe(-21);
    // Frei darunter oder darüber: nichts.
    expect(kopfUeberdeckung({ top: 221, bottom: 293 }, kopf)).toBe(0);
    expect(kopfUeberdeckung({ top: 40, bottom: 112 }, kopf)).toBe(0);
  });
});

/** Nachbau der antd-Struktur mit stehender Kopfzeile; jsdom rechnet kein Layout. */
function Tabelle() {
  const wurzel = useRef<HTMLDivElement>(null);
  const tabelle = useRef<TableRef>(null);
  // Der Haken liest nur `nativeElement`.
  (tabelle as { current: unknown }).current = {
    get nativeElement() {
      return wurzel.current;
    },
  };
  useFokusUnterKopf(tabelle);
  return (
    <div ref={wurzel} className="ant-table-wrapper">
      <div className="ant-table-header ant-table-sticky-holder">
        <button>Kopf</button>
      </div>
      <table>
        <tbody className="ant-table-tbody">
          <tr>
            <td>
              <button>Zeile</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function aufbauen() {
  const { container } = render(<Tabelle />);
  const kopf = container.querySelector<HTMLElement>('.ant-table-sticky-holder')!;
  vi.spyOn(kopf, 'getBoundingClientRect').mockReturnValue({ top: 53, bottom: 88 } as DOMRect);
  const [kopfKnopf, zeilenKnopf] = container.querySelectorAll<HTMLElement>('button');
  return { kopfKnopf, zeilenKnopf };
}

describe('useFokusUnterKopf (LLH-1358)', () => {
  it('rollt nach einem Fokus im Tabellenkörper um die Überdeckung zurück', () => {
    const rollen = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const { zeilenKnopf } = aufbauen();
    // Gemessen 1024 × 600 kompakt, Benutzerliste: Mittelpunkt unter der Kopfzeile.
    vi.spyOn(zeilenKnopf, 'getBoundingClientRect').mockReturnValue({
      top: 66,
      bottom: 96,
    } as DOMRect);
    zeilenKnopf.focus();
    expect(rollen).toHaveBeenCalledWith({ top: -22, behavior: 'instant' });
    rollen.mockRestore();
  });

  it('rollt nicht, wenn das Ziel frei unter der Kopfzeile steht', () => {
    const rollen = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const { zeilenKnopf } = aufbauen();
    vi.spyOn(zeilenKnopf, 'getBoundingClientRect').mockReturnValue({
      top: 88,
      bottom: 118,
    } as DOMRect);
    zeilenKnopf.focus();
    expect(rollen).not.toHaveBeenCalled();
    rollen.mockRestore();
  });

  it('lässt Ziele außerhalb des Tabellenkörpers (Kopfzeile, Filter) in Ruhe', () => {
    const rollen = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const { kopfKnopf } = aufbauen();
    vi.spyOn(kopfKnopf, 'getBoundingClientRect').mockReturnValue({
      top: 55,
      bottom: 85,
    } as DOMRect);
    kopfKnopf.focus();
    expect(rollen).not.toHaveBeenCalled();
    rollen.mockRestore();
  });
});
