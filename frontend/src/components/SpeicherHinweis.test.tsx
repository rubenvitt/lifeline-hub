import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, AusgangUnbekannt, NetzFehler } from '../api/client';
import {
  RechteHinweis,
  SeitenHinweise,
  SpeicherFehler,
  ZeilenFehler,
  fehlerText,
} from './SpeicherHinweis';

describe('fehlerText', () => {
  it('nimmt die Servermeldung eines ApiError', () => {
    expect(fehlerText(new ApiError(422, 'Startwert zu groß'))).toBe('Startwert zu groß');
  });

  it('faellt bei fremden Fehlern auf den Standardsatz zurueck', () => {
    expect(fehlerText(new TypeError('boom'))).toBe('Speichern fehlgeschlagen');
  });

  // LFH-1077: Wer vom Toast auf den Ort umstellt, darf den Unterschied „nicht abgeschickt“ /
  // „unklar, ob angekommen“ nicht an den Rückfalltext verlieren.
  it('nennt bei Netzfehler und unklarem Ausgang deren eigenen Wortlaut, nicht den Rückfall', () => {
    expect(fehlerText(new NetzFehler(), 'Download fehlgeschlagen')).toBe(new NetzFehler().message);
    expect(fehlerText(new AusgangUnbekannt())).toBe(new AusgangUnbekannt().message);
    expect(new AusgangUnbekannt().message).toMatch(/unklar/);
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
  // LFH-1078: eine Zeile „Nur Ansicht · Grund“, kein Kasten mit Satz.
  it('zeigt „Nur Ansicht“ und den Grund in einer Statuszeile, ohne Alert', () => {
    render(<RechteHinweis sichtbar text="Einsatz abgeschlossen" />);
    const zeile = screen.getByRole('status');
    // Mit Trenner: Screenreader lesen „Nur Ansicht Einsatz abgeschlossen“, nicht zusammengezogen.
    expect(zeile).toHaveTextContent('Nur Ansicht Einsatz abgeschlossen');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.ant-alert')).toBeNull();
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

describe('fehlerFallback (LFH-690)', () => {
  it('ersetzt den Standardsatz für einen Fehler, der kein ApiError ist', () => {
    render(
      <SeitenHinweise
        fehler={new TypeError('Failed to fetch')}
        fehlerTitel="Import fehlgeschlagen"
        fehlerFallback="Der Server war nicht erreichbar."
      />,
    );
    expect(screen.getByText('Import fehlgeschlagen')).toBeInTheDocument();
    expect(screen.getByText('Der Server war nicht erreichbar.')).toBeInTheDocument();
    expect(screen.queryByText('Speichern fehlgeschlagen')).toBeNull();
  });

  it('lässt die Servermeldung eines ApiError unberührt', () => {
    render(
      <SpeicherFehler fehler={new ApiError(409, 'Schon importiert')} fallback="Nicht erreichbar" />,
    );
    expect(screen.getByText('Schon importiert')).toBeInTheDocument();
    expect(screen.queryByText('Nicht erreichbar')).toBeNull();
  });

  it('ohne Angabe bleibt der Standardsatz (Bestandsaufrufer)', () => {
    render(<SpeicherFehler fehler={new TypeError('x')} />);
    expect(screen.getByText('Speichern fehlgeschlagen')).toBeInTheDocument();
  });
});

describe('ZeilenFehler (LFH-1077)', () => {
  it('nennt den Grund an der Zeile, markiert mit data-fehler', () => {
    render(<ZeilenFehler fehler={new ApiError(409, 'Download läuft schon')} />);
    const hinweis = screen.getByRole('alert');
    expect(hinweis).toHaveTextContent('Download läuft schon');
    expect(hinweis).toHaveAttribute('data-fehler');
  });

  it('nennt bei unklarem Ausgang, dass erst die Liste zu prüfen ist', () => {
    render(<ZeilenFehler fehler={new AusgangUnbekannt()} fallback="Löschen fehlgeschlagen" />);
    expect(screen.getByRole('alert')).toHaveTextContent(new AusgangUnbekannt().message);
  });

  it('rendert ohne Fehler GAR NICHTS', () => {
    const { container } = render(<ZeilenFehler fehler={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
