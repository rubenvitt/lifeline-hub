import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import SchichtplanSchleuse from './SchichtplanSchleuse';
import type { RasterZeile } from './raster';

/**
 * Die Hülle der Zeilenschleuse (LLH-1604, Spec `kraefte-schichtplan`, „Zeilen ohne Sprung“):
 * hält Menge und Folge der Zeilen, solange Fokus, Zeiger oder `halten` gelten, und nennt das
 * Wartende im Sammelbanner. Die Bedingungen selbst prüft `useZuflussSchleuse.test.tsx`.
 */

const z = (schluessel: string, titel: string): RasterZeile => ({ schluessel, titel, gruppe: null });
const RTW = z('einheit:1', 'RTW 1');
const STREIFE = z('einheit:2', 'Streife 2');
const KTW = z('einheit:9', 'KTW 9');

/** Kleinster Inhalt: je Zeile ein Knopf, wie die Blöcke im Raster. */
function Inhalt({ zeilen }: { zeilen: readonly RasterZeile[] }) {
  return (
    <ul aria-label="Zeilen">
      {zeilen.map((r) => (
        <li key={r.schluessel} data-entfallen={r.entfallen || undefined}>
          <button type="button" data-lfh="schichtplan-block">
            {r.titel}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Huelle({
  zeilen,
  halten = false,
  bereit = true,
}: {
  zeilen: RasterZeile[];
  halten?: boolean;
  bereit?: boolean;
}) {
  return (
    <SchichtplanSchleuse zeilen={zeilen} halten={halten} bereit={bereit}>
      {(gezeigt) => <Inhalt zeilen={gezeigt} />}
    </SchichtplanSchleuse>
  );
}

function titel() {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.textContent)
    .join(',');
}

describe('SchichtplanSchleuse (LLH-1604)', () => {
  it('ohne Fokus und Zeiger fließen neue Posten direkt, ohne Banner', () => {
    const { rerender } = renderMitProviders(<Huelle zeilen={[RTW, STREIFE]} />);
    rerender(<Huelle zeilen={[KTW, RTW, STREIFE]} />);
    expect(titel()).toBe('KTW 9,RTW 1,Streife 2');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mit Fokus wartet ein neuer Posten, „anzeigen“ übernimmt ihn und fokussiert den obersten Block', () => {
    const { rerender } = renderMitProviders(<Huelle zeilen={[RTW, STREIFE]} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Streife 2' }));
    rerender(<Huelle zeilen={[KTW, RTW, STREIFE]} />);
    expect(titel()).toBe('RTW 1,Streife 2');
    expect(screen.getByRole('status')).toHaveTextContent('1 neuer Posten');

    fireEvent.click(screen.getByRole('button', { name: 'anzeigen' }));
    expect(titel()).toBe('KTW 9,RTW 1,Streife 2');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KTW 9' })).toHaveFocus();
  });

  it('ein Mauszeiger über dem Schichtplan hält auch eine Umsortierung', () => {
    const { rerender } = renderMitProviders(<Huelle zeilen={[RTW, STREIFE]} />);
    fireEvent.pointerMove(screen.getByRole('list', { name: 'Zeilen' }), { pointerType: 'mouse' });
    rerender(<Huelle zeilen={[STREIFE, RTW]} />);
    expect(titel()).toBe('RTW 1,Streife 2');
    expect(screen.getByRole('status')).toHaveTextContent('Reihenfolge geändert');

    fireEvent.pointerLeave(document.querySelector('[data-lfh="schichtplan-schleuse"]')!, {
      pointerType: 'mouse',
    });
    expect(titel()).toBe('Streife 2,RTW 1');
  });

  it('ein entfallener Posten bleibt als leere Zeile stehen', () => {
    const { rerender } = renderMitProviders(<Huelle zeilen={[RTW, STREIFE]} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Streife 2' }));
    rerender(<Huelle zeilen={[STREIFE]} />);
    expect(titel()).toBe('RTW 1,Streife 2');
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('data-entfallen', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('1 Posten entfallen');
  });

  it('`halten` hält ohne Fokus und Zeiger, und nach dem Wegfall bis zur nächsten Bewegung', () => {
    const { rerender } = renderMitProviders(<Huelle zeilen={[RTW, STREIFE]} />);
    rerender(<Huelle zeilen={[RTW, STREIFE]} halten />);
    rerender(<Huelle zeilen={[KTW, RTW, STREIFE]} halten />);
    expect(titel()).toBe('RTW 1,Streife 2');
    expect(screen.getByRole('status')).toHaveTextContent('1 neuer Posten');

    // Ein Dialog schließt: der Zeiger ruht womöglich über dem Raster, ohne dass ein Ereignis es
    // sagt. Erst die nächste Bewegung entscheidet.
    rerender(<Huelle zeilen={[KTW, RTW, STREIFE]} />);
    expect(titel()).toBe('RTW 1,Streife 2');
    fireEvent.pointerMove(document.body, { pointerType: 'mouse' });
    expect(titel()).toBe('KTW 9,RTW 1,Streife 2');
  });

  it('nach `halten` hält eine Bewegung über dem Schichtplan weiter', () => {
    const { rerender } = renderMitProviders(<Huelle zeilen={[RTW, STREIFE]} />);
    rerender(<Huelle zeilen={[RTW, STREIFE]} halten />);
    rerender(<Huelle zeilen={[KTW, RTW, STREIFE]} halten />);
    rerender(<Huelle zeilen={[KTW, RTW, STREIFE]} />);
    fireEvent.pointerMove(screen.getByRole('list', { name: 'Zeilen' }), { pointerType: 'mouse' });
    expect(titel()).toBe('RTW 1,Streife 2');
  });

  it('solange die Quellen der Zeilen laden, friert nichts ein', () => {
    const PAUSE: RasterZeile = { schluessel: 'pause', titel: 'Pause', gruppe: null };
    const { rerender } = renderMitProviders(<Huelle zeilen={[PAUSE]} bereit={false} />);
    fireEvent.pointerMove(screen.getByRole('list', { name: 'Zeilen' }), { pointerType: 'mouse' });
    rerender(<Huelle zeilen={[RTW, STREIFE, PAUSE]} />);
    expect(titel()).toBe('RTW 1,Streife 2,Pause');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
