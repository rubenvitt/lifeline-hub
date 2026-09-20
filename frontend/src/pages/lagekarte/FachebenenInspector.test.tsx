import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FachebenenInspector from './FachebenenInspector';

describe('FachebenenInspector', () => {
  it('Warnung (DWD): Headline, Schwere-Label, Beschreibung, Handlungsempfehlung', () => {
    render(
      <FachebenenInspector
        quelle="dwd"
        properties={{
          HEADLINE: 'Amtliche Warnung vor Dauerregen',
          EVENT: 'DAUERREGEN',
          SEVERITY: 'Moderate',
          URGENCY: 'Immediate',
          DESCRIPTION: 'Es tritt Dauerregen auf.',
          INSTRUCTION: 'Meiden Sie überflutete Bereiche.',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('🌧️ Dauerregen')).toBeInTheDocument(); // Icon + Ereignis im Titel
    expect(screen.getByText('Amtliche Warnung vor Dauerregen')).toBeInTheDocument(); // volle Headline im Body
    expect(screen.getByText('Mäßig')).toBeInTheDocument();
    expect(screen.getByText('Sofort')).toBeInTheDocument();
    expect(screen.getByText('Es tritt Dauerregen auf.')).toBeInTheDocument();
    expect(screen.getByText('Meiden Sie überflutete Bereiche.')).toBeInTheDocument();
  });

  it('Hochwasser: Meldeklasse im Wortlaut, Pegelname und Pegelnummer (LFH-77)', () => {
    render(
      <FachebenenInspector
        quelle="hochwasser"
        properties={{ titel: 'Wittenberge / Elbe', pgnr: 'BB_503050', klasse: 'gross' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Wittenberge / Elbe')).toBeInTheDocument();
    // Das WORT ist der zweite Kanal (WCAG 1.4.1): auf der Karte trennt nur Farbe und
    // Punktgröße die Klassen, hier muss dastehen, welche es ist.
    expect(screen.getByText('großes Hochwasser')).toBeInTheDocument();
    expect(screen.getByText('BB_503050')).toBeInTheDocument();
  });

  it('Hochwasser: ein Pegel ohne Meldeklassen sagt das, statt einen Rohwert zu zeigen', () => {
    render(
      <FachebenenInspector
        quelle="hochwasser"
        properties={{ titel: 'Irgendwo / Bach', pgnr: 'XX_1', klasse: 'unklassifiziert' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('ohne Meldeklassen')).toBeInTheDocument();
    expect(screen.queryByText('unklassifiziert')).not.toBeInTheDocument();
  });

  it('Pegel: Wasserstand mit Einheit, Zustand-Tag (high→Hoch), Gewässer', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{
          titel: 'KÖLN',
          gewaesser: 'RHEIN',
          wert: 320,
          einheit: 'cm',
          zustand: 'high',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText(/320 cm/)).toBeInTheDocument();
    expect(screen.getByText('Hoch')).toBeInTheDocument();
    expect(screen.getByText('RHEIN')).toBeInTheDocument();
  });

  it('Pegel: Zustand "unknown" zeigt KEIN Tag (statt Rohwert)', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{ titel: 'X', wert: 100, einheit: 'cm', zustand: 'unknown' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByText('unknown')).toBeNull();
    expect(screen.getByText(/100 cm/)).toBeInTheDocument();
  });

  it('KRITIS: Kategorie-Label, Adresse, klickbares Telefon', () => {
    render(
      <FachebenenInspector
        quelle="kritis"
        properties={{
          titel: 'Uniklinik',
          kategorie: 'krankenhaus',
          adresse: 'Hauptstr. 1, 50667 Köln',
          telefon: '0221-1',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Uniklinik')).toBeInTheDocument();
    expect(screen.getByText('Krankenhaus')).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 1, 50667 Köln')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '0221-1' })).toHaveAttribute('href', 'tel:0221-1');
  });

  it('KRITIS: http(s)-Website wird Link, javascript:-URI nur Klartext (kein href)', () => {
    const { rerender } = render(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'A', website: 'https://example.org' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: 'https://example.org' })).toHaveAttribute(
      'href',
      'https://example.org',
    );

    rerender(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'A', website: 'javascript:alert(1)' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('Schließen-Button ruft Callback', async () => {
    const onSchliessen = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');
    render(
      <FachebenenInspector
        quelle="kritis"
        properties={{ titel: 'X' }}
        onSchliessen={onSchliessen}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onSchliessen).toHaveBeenCalledOnce();
  });
});

describe('FachebenenInspector — Fläche (LFH-146)', () => {
  const box = [
    [
      [8, 50],
      [8.1, 50],
      [8.1, 50.1],
      [8, 50.1],
      [8, 50],
    ],
  ];

  it('Warnung mit Polygon-Geometrie zeigt Fläche und Umfang', () => {
    render(
      <FachebenenInspector
        quelle="nina"
        properties={{ HEADLINE: 'X' }}
        geometrie={{ type: 'Polygon', coordinates: box }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Fläche')).toBeInTheDocument();
    expect(screen.getByText('Umfang')).toBeInTheDocument();
    expect(screen.getByText(/\d.*(m²|ha|km²)/)).toBeInTheDocument();
  });

  it('MultiPolygon-Geometrie zeigt (summierte) Fläche', () => {
    render(
      <FachebenenInspector
        quelle="dwd"
        properties={{ EVENT: 'STURM' }}
        geometrie={{ type: 'MultiPolygon', coordinates: [box, box] }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Fläche')).toBeInTheDocument();
  });

  it('Autobahn/Webcam: Standbild mit sprechendem Alt-Text, Livebild-Link, Betreiber', () => {
    render(
      <FachebenenInspector
        quelle="autobahn"
        properties={{
          titel: 'A1 | ID005 AK Köln-Nord',
          kategorie: 'webcam',
          strasse: 'A1',
          richtung: 'Blickrichtung Dortmund',
          betreiber: 'NRW',
          bild: 'https://www.verkehr.nrw/webcams/1.jpg',
          link: 'https://www.blitzvideoserver.de/player.html',
        }}
        onSchliessen={() => {}}
      />,
    );
    // Das Standbild ist der Zweck dieser Kategorie — es muss als Bild ankommen, nicht als URL-Text.
    const bild = screen.getByRole('img', { name: 'Webcam-Standbild: A1 | ID005 AK Köln-Nord' });
    expect(bild).toHaveAttribute('src', 'https://www.verkehr.nrw/webcams/1.jpg');
    expect(screen.getByText('Webcam')).toBeInTheDocument();
    expect(screen.getByText('Blickrichtung Dortmund')).toBeInTheDocument();
    expect(screen.getByText('NRW')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Livebild/ })).toHaveAttribute(
      'href',
      'https://www.blitzvideoserver.de/player.html',
    );
  });

  it('Autobahn: eine nicht-http(s)-Bild-/Link-URL wird weder als Bild noch als Link gerendert', () => {
    // Die Werte stammen aus einer fremden Quelle; ein javascript:-URI in src/href wäre XSS.
    render(
      <FachebenenInspector
        quelle="autobahn"
        properties={{
          titel: 'A1 | X',
          kategorie: 'webcam',
          bild: 'javascript:alert(1)',
          link: 'javascript:alert(2)',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByRole('img', { name: /Webcam-Standbild/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Livebild/ })).not.toBeInTheDocument();
  });

  it('Autobahn/Webcam: ein nicht ladendes Standbild wird erklärt statt als kaputtes Bild gezeigt', () => {
    render(
      <FachebenenInspector
        quelle="autobahn"
        properties={{ titel: 'A1 | X', kategorie: 'webcam', bild: 'https://example.invalid/x.jpg' }}
        onSchliessen={() => {}}
      />,
    );
    const bild = screen.getByRole('img', { name: /Webcam-Standbild/ });
    fireEvent.error(bild);
    // Beide Hälften: das tote Bild ist WEG und an seiner Stelle steht der Grund.
    expect(screen.queryByRole('img', { name: /Webcam-Standbild/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Internetverbindung am Gerät/)).toBeInTheDocument();
  });

  it('Autobahn/Baustelle: Zeilen der Quelle bleiben getrennt, kein Webcam-Zubehör', () => {
    render(
      <FachebenenInspector
        quelle="autobahn"
        properties={{
          titel: 'A1 | Saarbrücken-Von-der-Heydt - Riegelsberg',
          kategorie: 'baustelle',
          strasse: 'A1',
          beschreibung: 'Länge: 1.36 km\nMaximale Durchfahrtsbreite: 3.25 m',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Baustelle')).toBeInTheDocument();
    // `pre-line` hält die Gliederung der Quelle; ohne sie stünde alles in einem Zug.
    const text = screen.getByText(/Maximale Durchfahrtsbreite/);
    expect(text).toHaveStyle({ whiteSpace: 'pre-line' });
    expect(screen.queryByRole('img', { name: /Webcam-Standbild/ })).not.toBeInTheDocument();
  });

  it('Punkt-/keine Geometrie zeigt keine Fläche', () => {
    render(
      <FachebenenInspector
        quelle="pegelonline"
        properties={{ titel: 'X', wert: 100, einheit: 'cm' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
  });
});
