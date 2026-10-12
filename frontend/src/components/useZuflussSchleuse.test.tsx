import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { flachZufluss, useZuflussSchleuse, useZuflussSteuerung } from './useZuflussSchleuse';

interface Zeile {
  id: number;
  name: string;
}

const schluessel = (z: Zeile) => z.id;

/** Kleinster Abnehmer: eine flache Liste mit Schleuse, wie `ListeDetail` sie trägt. */
function Liste({ zeilen, mitMenue = false }: { zeilen: Zeile[]; mitMenue?: boolean }) {
  const wurzel = useRef<HTMLUListElement>(null);
  const steuerung = useZuflussSteuerung<Zeile>();
  const bereich = useZuflussSchleuse(steuerung, {
    zeilen,
    schluessel,
    aktiv: true,
    mitGerippe: false,
    wurzel,
  });
  const gefroren = steuerung.stand.art === 'gefroren' ? steuerung.stand.folge : null;
  const { gezeigt, banner } = useMemo(() => {
    if (!gefroren) return { gezeigt: zeilen, banner: null };
    const flach = flachZufluss(gefroren, zeilen, schluessel);
    return { gezeigt: flach.zeilen, banner: flach.banner };
  }, [gefroren, zeilen]);
  return (
    <>
      {banner != null && (
        <button type="button" onClick={steuerung.nachBenutzeraktion}>
          {banner}
        </button>
      )}
      <ul ref={wurzel} aria-label="Liste" {...bereich}>
        {gezeigt.map((z) => (
          <li key={z.id}>
            <button type="button">{z.name}</button>
          </li>
        ))}
      </ul>
      {mitMenue &&
        createPortal(
          <div className="ant-dropdown">
            <button type="button">Menüeintrag</button>
          </div>,
          document.body,
        )}
    </>
  );
}

const A = { id: 1, name: 'Alpha' };
const B = { id: 2, name: 'Bravo' };
const C = { id: 3, name: 'Charlie' };

function namen() {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.textContent)
    .join(',');
}

describe('useZuflussSchleuse', () => {
  it('Fokus in der Liste hält die Folge, der Banner nennt den Neuen', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Alpha' }));
    rerender(<Liste zeilen={[C, A, B]} />);
    expect(namen()).toBe('Alpha,Bravo');
    expect(screen.getByRole('button', { name: '1 neuer Eintrag — anzeigen' })).toBeInTheDocument();
  });

  it('Der Banner fügt ein und friert die neue Folge ein', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Alpha' }));
    rerender(<Liste zeilen={[C, A, B]} />);
    fireEvent.click(screen.getByRole('button', { name: /neuer Eintrag/ }));
    expect(namen()).toBe('Charlie,Alpha,Bravo');
    expect(screen.queryByRole('button', { name: /neuer Eintrag/ })).toBeNull();
  });

  it('Eine Mausbewegung hält, Verlassen gibt frei', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} />);
    const liste = screen.getByRole('list', { name: 'Liste' });
    fireEvent.pointerMove(liste, { pointerType: 'mouse' });
    rerender(<Liste zeilen={[C, A, B]} />);
    expect(namen()).toBe('Alpha,Bravo');
    fireEvent.pointerLeave(liste, { pointerType: 'mouse' });
    expect(namen()).toBe('Charlie,Alpha,Bravo');
  });

  it('Touch hält nicht', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} />);
    fireEvent.pointerMove(screen.getByRole('list', { name: 'Liste' }), { pointerType: 'touch' });
    rerender(<Liste zeilen={[C, A, B]} />);
    expect(namen()).toBe('Charlie,Alpha,Bravo');
  });

  it('Entfallenes verschwindet sofort, auch bei gehaltener Folge', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Alpha' }));
    rerender(<Liste zeilen={[B]} />);
    expect(namen()).toBe('Bravo');
  });

  it('Fokus, der in ein Portal-Menü wandert, hält weiter', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} mitMenue />);
    const alpha = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.focus(alpha);
    fireEvent.blur(alpha, { relatedTarget: screen.getByRole('button', { name: 'Menüeintrag' }) });
    rerender(<Liste zeilen={[C, A, B]} mitMenue />);
    expect(namen()).toBe('Alpha,Bravo');
  });

  it('Fokus, der die Liste verlässt, gibt frei', () => {
    const { rerender } = render(<Liste zeilen={[A, B]} />);
    const alpha = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.focus(alpha);
    fireEvent.blur(alpha, { relatedTarget: document.body });
    rerender(<Liste zeilen={[C, A, B]} />);
    expect(namen()).toBe('Charlie,Alpha,Bravo');
  });
});
