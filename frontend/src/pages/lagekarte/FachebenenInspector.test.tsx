import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FachebenenInspector from './FachebenenInspector';
import { FACHEBENEN } from './fachebenen';
import { taktischeDtgVoll } from '../../anzeige/format';

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

  it('ODL: Messwert, Messende, Stufe im Wortlaut und der Hinweis auf die Projekt-Einteilung (LFH-78)', () => {
    render(
      <FachebenenInspector
        quelle="odl"
        properties={{
          titel: 'Chemnitz',
          kennung: 'DEZ3068',
          wert: 0.7,
          einheit: 'µSv/h',
          messende: '2026-09-21T09:00:00Z',
          betrieb: 'in Betrieb',
          stufe: 'stark_erhoeht',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Chemnitz')).toBeInTheDocument();
    // Deutsches Zahlformat mit drei Nachkommastellen — so zeigt auch das BfS die Werte.
    expect(screen.getByText('0,700 µSv/h')).toBeInTheDocument();
    // Taktische DTG in der Anzeigezone: 09:00 UTC = 11:00 MESZ.
    expect(screen.getByText('211100SEP2026')).toBeInTheDocument();
    expect(screen.getByText('stark erhöht')).toBeInTheDocument();
    expect(screen.getByText('in Betrieb')).toBeInTheDocument();
    // Ortsnamen sind nicht eindeutig — die Kennung ist der Schlüssel für den Abgleich mit ODL-Info.
    expect(screen.getByText('DEZ3068')).toBeInTheDocument();
    // Spec „Die Einteilung gibt sich als Projekt-Einteilung zu erkennen" — ohne `bewertung`
    // gilt der Bänder-Maßstab, und der Satz sagt, warum (LFH-598).
    expect(screen.getByText(/noch kein Grundpegel vor/)).toBeInTheDocument();
    expect(screen.getByText(/natürlichen Bereich \(0,05–0,2\s+µSv\/h\)/)).toBeInTheDocument();
    expect(screen.getByText(/kein amtlicher Schwellenwert/)).toBeInTheDocument();
    expect(screen.queryByText('Grundpegel')).not.toBeInTheDocument();
    expect(screen.queryByText('Faktor')).not.toBeInTheDocument();
  });

  it('ODL: mit Grundpegel nennt der Inspector Grundpegel, Stand, Faktor und die Faktor-Schwellen (LFH-598)', () => {
    render(
      <FachebenenInspector
        quelle="odl"
        properties={{
          titel: 'Flensburg',
          kennung: 'DEZ0001',
          wert: 0.19,
          einheit: 'µSv/h',
          stufe: 'stark_erhoeht',
          bewertung: 'standort',
          grundpegel: 0.06,
          faktor: 3.17,
          grundpegel_stand: '2026-09-21T12:00:00Z',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('stark erhöht')).toBeInTheDocument();
    expect(screen.getByText('Grundpegel')).toBeInTheDocument();
    // Stand als taktische DTG in der Anzeigezone: 12:00 UTC = 14:00 MESZ.
    expect(screen.getByText('0,060 µSv/h (Stand 211400SEP2026)')).toBeInTheDocument();
    expect(screen.getByText('3,17 ×')).toBeInTheDocument();
    // Die Schwellen als LITERALE — sie stehen im Backend (`FAKTOR_ERHOEHT`/`FAKTOR_STARK`)
    // und in der Spec; zurückgelesen aus einer Konstante prüfte der Test sich selbst.
    // „über", nicht „ab": genau 1,5 × ist noch `normal`, genau 3 × noch `erhoeht` (Spec).
    expect(screen.getByText(/über 1,5 × erhöht, über 3 × stark erhöht/)).toBeInTheDocument();
    expect(screen.getByText(/kein amtlicher Schwellenwert/i)).toBeInTheDocument();
    // Der Bänder-Maßstab gilt für diese Sonde NICHT und wird deshalb nicht genannt.
    expect(screen.queryByText(/natürlichen Bereich/)).not.toBeInTheDocument();
    expect(screen.queryByText(/noch kein Grundpegel/)).not.toBeInTheDocument();
  });

  it('ODL: unter fremder Einheit behauptet der Inspector keinen fehlenden Grundpegel (LFH-598)', () => {
    render(
      <FachebenenInspector
        quelle="odl"
        properties={{
          titel: 'X',
          wert: 115,
          einheit: 'nSv/h',
          stufe: 'keine_messung',
          bewertung: 'absolut',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('115,000 nSv/h')).toBeInTheDocument();
    expect(screen.queryByText(/noch kein Grundpegel/)).not.toBeInTheDocument();
  });

  it('ODL: ein unbekanntes Grundlagen-Wort zeigt keinen Grundpegel (LFH-598)', () => {
    render(
      <FachebenenInspector
        quelle="odl"
        properties={{
          titel: 'X',
          wert: 0.19,
          stufe: 'erhoeht',
          bewertung: 'relativ',
          grundpegel: 0.06,
          faktor: 3.17,
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.queryByText('Grundpegel')).not.toBeInTheDocument();
    expect(screen.getByText(/natürlichen Bereich/)).toBeInTheDocument();
  });

  it('ODL: eine defekte Sonde sagt „kein Messwert", statt eine Zahl zu erfinden', () => {
    render(
      <FachebenenInspector
        quelle="odl"
        properties={{ titel: 'Bechhofen', betrieb: 'defekt', stufe: 'keine_messung' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('kein Messwert')).toBeInTheDocument();
    expect(screen.getByText('defekt')).toBeInTheDocument();
    expect(screen.getByText('keine Messung')).toBeInTheDocument();
    // Gezielt auf einen FORMATIERTEN Messwert: ein bloßes /µSv\/h/ träfe auch den Hinweissatz
    // mit dem natürlichen Bereich „0,05–0,2 µSv/h".
    expect(screen.queryByText(/^\d+,\d{3} µSv\/h$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Messende')).not.toBeInTheDocument();
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

  it('Luftqualität: Stufe als Wort, Leitschadstoff, Messwerte mit Einheit, Zeitpunkt (LFH-79)', () => {
    render(
      <FachebenenInspector
        quelle="luftqualitaet"
        properties={{
          titel: 'Potsdam-Zentrum',
          code: 'DEBB021',
          ort: 'Potsdam',
          stationstyp: 'Verkehr',
          umgebung: 'städtisches Gebiet',
          klasse: 'schlecht',
          leitschadstoff: 'NO₂',
          unvollstaendig: false,
          wert_no2: 145,
          einheit_no2: 'µg/m³',
          wert_pm10: 12,
          einheit_pm10: 'µg/m³',
          zeitpunkt: '2026-09-21T09:00:00+01:00',
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Potsdam-Zentrum')).toBeInTheDocument();
    // Das WORT trägt die Stufe (WCAG 1.4.1) — auf der Karte nur Farbe und Größe.
    expect(screen.getByText('schlecht')).toBeInTheDocument();
    // Der Leitschadstoff gehört ins Label-Paar „Leitschadstoff: NO₂" — ein bloßes
    // `getAllByText('NO₂')` fände auch die Messwertzeile und bliebe ohne die Angabe grün.
    const leitLabel = screen.getByText('Leitschadstoff');
    expect(leitLabel.closest('tr')?.textContent).toContain('NO₂');
    expect(screen.getByText('145 µg/m³')).toBeInTheDocument();
    expect(screen.getByText('12 µg/m³')).toBeInTheDocument();
    expect(screen.getByText(taktischeDtgVoll('2026-09-21T09:00:00+01:00'))).toBeInTheDocument();
    expect(screen.getByText('DEBB021')).toBeInTheDocument();
    expect(screen.getByText(/Verkehr/)).toBeInTheDocument();
    // Ohne Kennzeichnung der Quelle steht kein Unvollständigkeits-Hinweis da.
    expect(screen.queryByText(/unvollständige Datenbasis/i)).not.toBeInTheDocument();
  });

  it('Luftqualität: der Leitschadstoff steht auch ohne eigenen Messwert da', () => {
    // Trennscharf: Leitschadstoff O₃, aber kein `wert_o3` — die O₃-Angabe kann nur aus der
    // Leitschadstoff-Zeile stammen.
    render(
      <FachebenenInspector
        quelle="luftqualitaet"
        properties={{ titel: 'Station', klasse: 'gut', leitschadstoff: 'O₃', wert_no2: 10 }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('O₃')).toBeInTheDocument();
  });

  it('Luftqualität: der Kartenakzent trägt die Stufe der Station, nicht die Ebenenfarbe', () => {
    // Sonst öffnete eine „sehr schlecht"-Station eine Karte mit dem Akzent der Ebene
    // neben einem Alarm-Tag — eine Farbe mit zwei Bedeutungen (Prüfliste Kriterium 7).
    const akzent = (klasse: string) => {
      const { container, unmount } = render(
        <FachebenenInspector
          quelle="luftqualitaet"
          properties={{ titel: 'S', klasse }}
          onSchliessen={() => {}}
        />,
      );
      const rand = (container.querySelector('[data-lfh="auswahl-kachel"]') as HTMLElement).style
        .borderColor;
      unmount();
      return rand;
    };
    const ebene = (() => {
      const probe = document.createElement('div');
      probe.style.color = FACHEBENEN.luftqualitaet.farbe;
      return probe.style.color;
    })();
    expect(akzent('sehr_schlecht')).not.toBe(akzent('sehr_gut'));
    expect(akzent('sehr_schlecht')).not.toBe(ebene);
    expect(akzent('sehr_gut')).not.toBe(ebene);
  });

  it('Luftqualität: nennt eine unvollständige Datenbasis als Wort', () => {
    render(
      <FachebenenInspector
        quelle="luftqualitaet"
        properties={{ titel: 'Oldenburg', klasse: 'gut', unvollstaendig: true }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText(/unvollständige Datenbasis/i)).toBeInTheDocument();
  });

  it('Luftqualität: ein unbekanntes Stufenwort erscheint als „keine Daten", nie roh', () => {
    render(
      <FachebenenInspector
        quelle="luftqualitaet"
        properties={{ titel: 'Irgendwo', klasse: 'katastrophal' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('keine Daten')).toBeInTheDocument();
    expect(screen.queryByText('katastrophal')).not.toBeInTheDocument();
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
    const livebild = screen.getByRole('link', { name: /Livebild/ });
    expect(livebild).toHaveAttribute('href', 'https://www.blitzvideoserver.de/player.html');
    // Eigenständige Aktion ⇒ Bedienziel. Geprüft wird die STRUKTUR, aus der die Höhe folgt:
    // ein antd-Knopf erbt `controlHeight` vom `ConfigProvider` (30/48/72), ein nackter `<a>`
    // bliebe auf Zeilenhöhe. Ein Pixelmaß taugt hier nicht — jsdom rechnet kein Layout, und
    // `test/utils.tsx` rendert ein ConfigProvider OHNE Theme (CLAUDE.md, Erfassungs-Norm).
    expect(livebild).toHaveClass('ant-btn');
  });

  it('Autobahn/Webcam: ein zweites Feature bekommt sein Standbild, auch nach einem Fehler', () => {
    // Der Inspector tauscht beim Klick auf ein anderes Feature nur die Props — die
    // Komponenteninstanz bleibt stehen. Ein Fehler-`boolean` überlebte den Wechsel und
    // verschluckte das nächste Standbild, ohne es je zu laden.
    const props = (bild: string) => ({
      quelle: 'autobahn' as const,
      properties: { titel: 'A1 | X', kategorie: 'webcam', bild },
      onSchliessen: () => {},
    });
    const { rerender } = render(<FachebenenInspector {...props('https://a.example/1.jpg')} />);
    fireEvent.error(screen.getByRole('img', { name: /Webcam-Standbild/ }));
    expect(screen.queryByRole('img', { name: /Webcam-Standbild/ })).not.toBeInTheDocument();

    rerender(<FachebenenInspector {...props('https://b.example/2.jpg')} />);
    expect(screen.getByRole('img', { name: /Webcam-Standbild/ })).toHaveAttribute(
      'src',
      'https://b.example/2.jpg',
    );

    // Und zurück auf A: auch der Rückweg beginnt mit einem frischen Versuch. Ein Merker, der
    // nur die zuletzt gescheiterte URL vergleicht, bliebe hier auf „nicht abrufbar" stehen,
    // obwohl die Verbindung inzwischen wieder da sein kann.
    rerender(<FachebenenInspector {...props('https://a.example/1.jpg')} />);
    expect(screen.getByRole('img', { name: /Webcam-Standbild/ })).toHaveAttribute(
      'src',
      'https://a.example/1.jpg',
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

describe('FachebenenInspector — Energieanlagen (LFH-81)', () => {
  // Wire-Vertrag: flache Properties, `null` für Unbekanntes.
  const scholven = {
    titel: 'Kraftwerk Scholven',
    anlagenart: 'kohle',
    leistung_mw: 690,
    betreiber: 'Uniper',
    betriebsstatus: 'In Betrieb',
    herkunft: 'osm',
    mastr_nummer: null,
    mastr_id: null,
    mastr_einheiten: null,
  };

  it('Energie-Punkt zeigt den Energie-Inhalt, nicht den KRITIS-Rückfall', () => {
    render(<FachebenenInspector quelle="energie" properties={scholven} onSchliessen={() => {}} />);
    expect(screen.getByText('Kraftwerk Scholven')).toBeInTheDocument();
    // Die Zeilen, die KRITIS nicht kennt — im Rückfall stünde hier nur der Betreiber.
    expect(screen.getByText('Anlagenart')).toBeInTheDocument();
    expect(screen.getByText('Kohle')).toBeInTheDocument();
    expect(screen.getByText('Leistung')).toBeInTheDocument();
    expect(screen.getByText('690 MW')).toBeInTheDocument();
    expect(screen.getByText('Uniper')).toBeInTheDocument();
    expect(screen.getByText('In Betrieb')).toBeInTheDocument();
    expect(screen.getByText('OpenStreetMap')).toBeInTheDocument();
    // Reine OSM-Herkunft: keine MaStR-Zeile, kein Link.
    expect(screen.queryByText('MaStR-Nummer')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    // Die Anlagenart steht als Wort, nie als Rohwert.
    expect(screen.queryByText('kohle')).not.toBeInTheDocument();
  });

  it('Leistung „unbekannt" — bei null und bei fehlendem Feld gleich', () => {
    // Die Quelle schickt `null`; MapLibre liefert null-Properties beim Klick als FEHLEND.
    const { rerender } = render(
      <FachebenenInspector
        quelle="energie"
        properties={{ ...scholven, anlagenart: 'gas', leistung_mw: null }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
    expect(screen.queryByText(/MW/)).not.toBeInTheDocument();

    const ohneLeistung: Record<string, unknown> = { ...scholven, anlagenart: 'gas' };
    delete ohneLeistung.leistung_mw;
    delete ohneLeistung.betreiber;
    delete ohneLeistung.betriebsstatus;
    rerender(
      <FachebenenInspector quelle="energie" properties={ohneLeistung} onSchliessen={() => {}} />,
    );
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
    // Fehlender Betreiber/Status: die Zeile entfällt, statt „null" zu zeigen.
    expect(screen.queryByText('Betreiber')).not.toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('eine Zeichenkette ist kein Messwert — Leistung bleibt „unbekannt"', () => {
    render(
      <FachebenenInspector
        quelle="energie"
        properties={{ ...scholven, leistung_mw: 'ca. 690' }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
  });

  it('MaStR-Herkunft: Nummer als Link auf das Register, Einheitenzahl ab zwei', () => {
    render(
      <FachebenenInspector
        quelle="energie"
        properties={{
          ...scholven,
          titel: 'Pumpspeicherwerk Herdecke',
          anlagenart: 'speicher',
          leistung_mw: 153.5,
          herkunft: 'osm+mastr',
          mastr_nummer: 'SEE912345678901',
          mastr_id: 4711,
          mastr_einheiten: 3,
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Speicher')).toBeInTheDocument();
    expect(screen.getByText('153,5 MW')).toBeInTheDocument();
    expect(screen.getByText('OpenStreetMap + Marktstammdatenregister')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'SEE912345678901' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/4711',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('MaStR-Einheiten')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('reine MaStR-Herkunft mit einer Einheit: Nummer, aber keine Einheitenzahl', () => {
    render(
      <FachebenenInspector
        quelle="energie"
        properties={{
          ...scholven,
          titel: 'Solarpark Nord',
          anlagenart: 'solar',
          leistung_mw: 12,
          herkunft: 'mastr',
          mastr_nummer: 'SEE900000000001',
          mastr_id: 12,
          mastr_einheiten: 1,
        }}
        onSchliessen={() => {}}
      />,
    );
    expect(screen.getByText('Marktstammdatenregister')).toBeInTheDocument();
    expect(screen.getByText('Solar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SEE900000000001' })).toBeInTheDocument();
    expect(screen.queryByText('MaStR-Einheiten')).not.toBeInTheDocument();
  });

  it('eine nicht-ganzzahlige MaStR-ID wird kein Link — die Nummer bleibt Klartext', () => {
    render(
      <FachebenenInspector
        quelle="energie"
        properties={{
          ...scholven,
          herkunft: 'mastr',
          mastr_nummer: 'SEE900000000002',
          mastr_id: '../../evil',
        }}
        onSchliessen={() => {}}
      />,
    );
    // Nur der Lizenzlink bleibt — die Nummer selbst ist kein Link.
    expect(screen.queryByRole('link', { name: 'SEE900000000002' })).toBeNull();
    expect(screen.getByText('SEE900000000002')).toBeInTheDocument();
  });

  it('MaStR-Herkunft nennt die Datenlizenz als Link (design.md, Entscheidung 5)', () => {
    for (const herkunft of ['mastr', 'osm+mastr']) {
      const { unmount } = render(
        <FachebenenInspector
          quelle="energie"
          properties={{ ...scholven, herkunft, mastr_nummer: 'SEE1', mastr_id: 1 }}
          onSchliessen={() => {}}
        />,
      );
      const link = screen.getByRole('link', {
        name: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
      });
      expect(link).toHaveAttribute('href', 'https://www.govdata.de/dl-de/by-2-0');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
      unmount();
    }
  });

  it('reine OSM-Herkunft trägt keinen Lizenzlink', () => {
    render(<FachebenenInspector quelle="energie" properties={scholven} onSchliessen={() => {}} />);
    expect(screen.queryByText('Datenlizenz Deutschland – Namensnennung – Version 2.0')).toBeNull();
  });

  it('bildet alle elf Anlagenarten auf ein deutsches Wort ab', () => {
    const erwartet: Record<string, string> = {
      kohle: 'Kohle',
      gas: 'Gas',
      oel: 'Öl',
      kern: 'Kernenergie',
      abfall: 'Abfall',
      wasser: 'Wasser',
      wind: 'Wind',
      solar: 'Solar',
      biomasse: 'Biomasse',
      speicher: 'Speicher',
      sonstige: 'Sonstige',
    };
    for (const [wire, wort] of Object.entries(erwartet)) {
      const { unmount } = render(
        <FachebenenInspector
          quelle="energie"
          properties={{ ...scholven, anlagenart: wire }}
          onSchliessen={() => {}}
        />,
      );
      expect(screen.getByText(wort)).toBeInTheDocument();
      unmount();
    }
  });
});
