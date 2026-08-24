import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { RechteHinweis, SeitenHinweise, SpeicherFehler, fehlerText } from './SpeicherHinweis';

describe('fehlerText', () => {
  it('nimmt die Servermeldung eines ApiError', () => {
    expect(fehlerText(new ApiError(422, 'Startwert zu groß'))).toBe('Startwert zu groß');
  });

  it('faellt bei fremden Fehlern auf den Standardsatz zurueck', () => {
    expect(fehlerText(new TypeError('boom'))).toBe('Speichern fehlgeschlagen');
  });

  // Die Gegenaussage: ohne sie waere ein Primitiv, das IMMER einen Text liefert, ebenfalls gruen —
  // und der Alert stuende dann dauerhaft auf jeder Seite.
  it('meldet OHNE Fehler nichts', () => {
    expect(fehlerText(null)).toBeNull();
    expect(fehlerText(undefined)).toBeNull();
  });
});

describe('SpeicherFehler', () => {
  it('rendert die Servermeldung als Alert', () => {
    render(<SpeicherFehler fehler={new ApiError(422, 'Startwert zu groß')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Startwert zu groß');
  });

  it('rendert ohne Fehler GAR NICHTS', () => {
    const { container } = render(<SpeicherFehler fehler={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nimmt einen eigenen Titel, wenn die Seite einen braucht', () => {
    render(<SpeicherFehler fehler={new ApiError(409, 'Konflikt')} titel="Nicht übernommen" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nicht übernommen');
  });
});

describe('RechteHinweis', () => {
  it('erklaert die fehlende Berechtigung', () => {
    render(<RechteHinweis sichtbar text="Nur die Einsatzleitung darf das ändern" />);
    expect(screen.getByText('Nur die Einsatzleitung darf das ändern')).toBeInTheDocument();
  });

  it('schweigt bei vorhandener Berechtigung', () => {
    const { container } = render(<RechteHinweis sichtbar={false} text="egal" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SeitenHinweise', () => {
  it('traegt beide Hinweise nebeneinander', () => {
    render(
      <SeitenHinweise
        fehler={new ApiError(422, 'Startwert zu groß')}
        rechteFehlt
        rechteText="Nur Admins"
      />,
    );
    expect(screen.getByText('Nur Admins')).toBeInTheDocument();
    expect(screen.getByText('Startwert zu groß')).toBeInTheDocument();
  });

  // Die Hülle der Seite rendert ihr `<div>` ohnehin (ein JSX-Element ist immer truthy) —
  // geprüft ist hier, dass INNEN nichts steht, also auch kein leerer Alert-Rahmen.
  it('rendert im Leerfall gar nichts', () => {
    const { container } = render(<SeitenHinweise fehler={null} rechteText="egal" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('traegt den Fehler auch ohne Rechte-Text', () => {
    render(<SeitenHinweise fehler={new ApiError(500, 'Serverfehler')} />);
    expect(screen.getByText('Serverfehler')).toBeInTheDocument();
  });
});
