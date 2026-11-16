import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFokusInEingabe } from './useFokusInEingabe';

/** LLH-1738, design.md D5: die Leiste am Handschirm klappt bei Fokus in einer Eingabe ein. */

function Probe() {
  const tippt = useFokusInEingabe();
  return (
    <>
      <output data-testid="zustand">{tippt ? 'tippt' : 'ruht'}</output>
      <input aria-label="Text" />
      <textarea aria-label="Wortlaut" />
      <div aria-label="Frei" contentEditable suppressContentEditableWarning tabIndex={0} />
      <button type="button">Knopf</button>
      <input aria-label="Haken" type="checkbox" />
    </>
  );
}

function fokus(name: string) {
  act(() => screen.getByLabelText(name).focus());
}

describe('useFokusInEingabe', () => {
  it('ruht ohne Fokus', () => {
    render(<Probe />);
    expect(screen.getByTestId('zustand')).toHaveTextContent('ruht');
  });

  it.each(['Text', 'Wortlaut'])('tippt bei Fokus in „%s“', (name) => {
    render(<Probe />);
    fokus(name);
    expect(screen.getByTestId('zustand')).toHaveTextContent('tippt');
  });

  it('tippt bei Fokus in einem bearbeitbaren Bereich', () => {
    render(<Probe />);
    // jsdom kennt `isContentEditable` nicht; der Browser setzt es aus dem Attribut.
    const frei = screen.getByLabelText('Frei');
    Object.defineProperty(frei, 'isContentEditable', { value: true });
    act(() => frei.focus());
    expect(screen.getByTestId('zustand')).toHaveTextContent('tippt');
  });

  it('ruht bei Fokus auf Knopf und Haken und nach dem Verlassen des Feldes', () => {
    render(<Probe />);
    fokus('Text');
    act(() => screen.getByRole('button', { name: 'Knopf' }).focus());
    expect(screen.getByTestId('zustand')).toHaveTextContent('ruht');
    fokus('Haken');
    expect(screen.getByTestId('zustand')).toHaveTextContent('ruht');
    fokus('Wortlaut');
    act(() => (document.activeElement as HTMLElement).blur());
    expect(screen.getByTestId('zustand')).toHaveTextContent('ruht');
  });

  it('bleibt beim Wechsel von Feld zu Feld beim Tippen', () => {
    render(<Probe />);
    fokus('Text');
    fokus('Wortlaut');
    expect(screen.getByTestId('zustand')).toHaveTextContent('tippt');
  });
});
