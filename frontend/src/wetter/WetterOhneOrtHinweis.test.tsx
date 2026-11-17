import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WetterAnzeige } from '../api/types';
import { WetterOhneOrtHinweis } from './WetterPaneele';

const OHNE_ORT: WetterAnzeige = {
  warnungen: { zustand: 'kein_ort' },
  vorhersage: { zustand: 'kein_ort' },
  aktuell: { zustand: 'kein_ort' },
};

// LLH-1752: der Grund steht einmal auf der Seite — aber nur, solange die Antwort gilt.
describe('WetterOhneOrtHinweis', () => {
  it('ohne Einsatzort: Grund und Weg zu den Einsatzdaten', () => {
    render(<WetterOhneOrtHinweis zustand="daten" wetter={OHNE_ORT} onEinsatzdaten={vi.fn()} />);
    expect(screen.getByText(/^Einsatzort nicht verortet/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Einsatzort in den Einsatzdaten verorten' }),
    ).toBeInTheDocument();
  });

  it('scheitert ein Neuabruf, behauptet er nichts über die alte Antwort', () => {
    // React Query behält die Daten und meldet den Fehler; die Paneele zeigen „Erneut laden“.
    const { container } = render(
      <WetterOhneOrtHinweis zustand="fehler" wetter={OHNE_ORT} onEinsatzdaten={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
