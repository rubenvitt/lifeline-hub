import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { renderMitProviders } from '../test/utils';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenLeer,
  SeitenSackgasse,
  SeitenSkeleton,
  SeitenStandVeraltet,
  ursacheText,
} from './SeitenZustand';

describe('SeitenSkeleton', () => {
  it('meldet sich als beschäftigt und rendert Skelettbalken statt eines Lade-Textes', () => {
    const { container } = renderMitProviders(<SeitenSkeleton />);

    const skelett = container.querySelector('[aria-busy="true"]');
    expect(skelett).not.toBeNull();
    // Kein „Laden…"-Textduplikat: die Ansage steckt im aria-label, nicht als
    // zweiter sichtbarer Text daneben.
    expect(screen.queryByText(/laden/i)).not.toBeInTheDocument();
    expect(skelett).toHaveAttribute('aria-label', expect.stringMatching(/wird geladen/i));
  });

  it('trägt die Skelett-Klassen der Gestaltungssprache (Höhe kommt aus `sprache.css`)', () => {
    // jsdom rechnet kein Layout — die Balkenhöhe ist im Test nicht messbar. Geprüft
    // wird deshalb der Vertrag zur Stylesheet-Seite: ohne diese Klassen (und ohne den
    // `sprache.css`-Import der Komponente) sind die Balken 0 px hoch und die Seite bleibt
    // beim Laden leer.
    const { container } = renderMitProviders(<SeitenSkeleton />);

    expect(container.querySelector('.lfh-skelett')).not.toBeNull();
    expect(container.querySelectorAll('.lfh-skelett__balken').length).toBeGreaterThan(0);
  });

  it('rendert so viele Balken wie angefordert', () => {
    const { container } = renderMitProviders(<SeitenSkeleton zeilen={5} />);

    expect(container.querySelectorAll('.lfh-skelett__balken')).toHaveLength(5);
  });
});

describe('SeitenFehler', () => {
  it('rendert den Text als Meldung mit role="alert"', () => {
    renderMitProviders(<SeitenFehler text="Einsatz nicht gefunden oder kein Zugriff" />);

    const meldung = screen.getByRole('alert');
    expect(meldung).toHaveTextContent('Einsatz nicht gefunden oder kein Zugriff');
  });

  it('zeigt ohne `onWiederholen` keinen Knopf', () => {
    renderMitProviders(<SeitenFehler text="Kaputt" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('feuert `onWiederholen` beim Klick auf „Erneut abrufen"', async () => {
    const wiederholen = vi.fn();
    renderMitProviders(<SeitenFehler text="Kaputt" onWiederholen={wiederholen} />);

    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));

    expect(wiederholen).toHaveBeenCalledTimes(1);
  });

  it('zeigt die Meldung einer `ApiError` als Detailzeile unter dem Text', () => {
    renderMitProviders(
      <SeitenFehler
        text="Schaden konnte nicht geladen werden"
        ursache={new ApiError(404, 'Schaden 7 gehört zu einem anderen Einsatz')}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Schaden 7 gehört zu einem anderen Einsatz',
    );
  });

  it('zeigt ohne `ursache` nur den Text', () => {
    renderMitProviders(<SeitenFehler text="Schaden konnte nicht geladen werden" />);

    // Partner zur Zeile darüber: derselbe Knoten, andere Eingabe. Ohne dieses Paar
    // belegte die Zusicherung oben nur, dass irgendein Text irgendwo steht.
    expect(screen.getByRole('alert')).toHaveTextContent('Schaden konnte nicht geladen werden');
    expect(screen.queryByText(/gehört zu einem anderen Einsatz/)).not.toBeInTheDocument();
  });
});

describe('SeitenLeer', () => {
  it('nennt die Tatsache im Titel', () => {
    renderMitProviders(<SeitenLeer titel="Noch keine Abschnitte" />);

    expect(screen.getByText('Noch keine Abschnitte')).toBeInTheDocument();
  });

  it('zeigt den Hinweis unter dem Titel, wenn einer gesetzt ist', () => {
    renderMitProviders(
      <SeitenLeer
        titel="Noch keine Einträge"
        hinweis="Erfassen Sie den ersten oben in der Eingabezeile."
      />,
    );

    expect(
      screen.getByText('Erfassen Sie den ersten oben in der Eingabezeile.'),
    ).toBeInTheDocument();
  });

  it('bleibt ohne Aktion knopflos', () => {
    renderMitProviders(<SeitenLeer titel="Alles verortet" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('trägt mit Aktion genau einen Knopf', () => {
    // Die Zusicherung „genau ein Primärbutton" (AK3) trägt nur, weil die Box selbst
    // keinen Knopf beisteuert. Mit antds `<Empty>` als Rumpf wäre die Zahl nicht mehr
    // eindeutig dem Slot zuzuordnen — deshalb ist das hier eine Aussage über den
    // Bauplan, nicht bloß über diesen Aufruf.
    renderMitProviders(
      <SeitenLeer
        titel="Noch keine Personen"
        aktion={{ label: 'Person aufnehmen', onClick: vi.fn() }}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('feuert `onClick` der Aktion', async () => {
    const anlegen = vi.fn();
    renderMitProviders(
      <SeitenLeer
        titel="Noch keine Unfallhilfsstellen erfasst"
        aktion={{ label: 'Erste UHS anlegen', onClick: anlegen }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Erste UHS anlegen' }));

    expect(anlegen).toHaveBeenCalledTimes(1);
  });

  it('navigiert auf `pfad`, wo die Aktion eine Route hat', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/"
          element={
            <SeitenLeer
              titel="Noch keine Personen"
              aktion={{ label: 'Person aufnehmen', pfad: '/ziel' }}
            />
          }
        />
        <Route path="/ziel" element={<p>Aufnahmemaske</p>} />
      </Routes>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Person aufnehmen' }));

    expect(screen.getByText('Aufnahmemaske')).toBeInTheDocument();
  });

  it('rendert kein antd-`Empty`', () => {
    // Kein Selbstzweck: AK3 verlangt 0 `<Empty>`-Knoten im Frontend, und dieses
    // Primitiv ist die Stelle, an der ein `Empty` am naheliegendsten wäre. Fällt die
    // Zusicherung, ist das Gate repoweit rot — hier ist es billig zu bemerken.
    const { container } = renderMitProviders(<SeitenLeer titel="Noch keine Fahrzeuge" />);

    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

describe('SeitenSackgasse', () => {
  it('nennt Titel und Hinweis in der Großform', () => {
    renderMitProviders(
      <SeitenSackgasse
        titel="Einsatz konnte nicht geladen werden"
        hinweis="Er existiert nicht, ist nicht freigegeben oder die Verbindung ist gestört."
      />,
    );

    expect(screen.getByText('Einsatz konnte nicht geladen werden')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Er existiert nicht, ist nicht freigegeben oder die Verbindung ist gestört.',
      ),
    ).toBeInTheDocument();
  });

  it('bietet Wiederholung und Rückweg als zwei getrennte Knöpfe', async () => {
    const wiederholen = vi.fn();
    renderMitProviders(
      <Routes>
        <Route
          path="/"
          element={
            <SeitenSackgasse
              titel="Einsatz konnte nicht geladen werden"
              onWiederholen={wiederholen}
              rueckweg={{ pfad: '/einsaetze', label: 'Zur Einsatzliste' }}
            />
          }
        />
        <Route path="/einsaetze" element={<p>Einsatzliste</p>} />
      </Routes>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(wiederholen).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Zur Einsatzliste' }));
    expect(screen.getByText('Einsatzliste')).toBeInTheDocument();
  });

  it('zeigt die Meldung einer `ApiError` als Untertitel, wo kein Hinweis gesetzt ist', () => {
    renderMitProviders(
      <SeitenSackgasse
        titel="Einsatz konnte nicht geladen werden"
        ursache={new ApiError(403, 'Kein Zugriff auf diesen Einsatz')}
      />,
    );

    expect(screen.getByText('Kein Zugriff auf diesen Einsatz')).toBeInTheDocument();
  });
});

describe('SeitenStandVeraltet', () => {
  it('sagt, dass der gezeigte Stand alt ist, und bietet den erneuten Abruf', async () => {
    const wiederholen = vi.fn();
    renderMitProviders(<SeitenStandVeraltet onWiederholen={wiederholen} />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/nicht aktualisiert/i);

    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(wiederholen).toHaveBeenCalledTimes(1);
  });

  it('trägt keinen Zeitstempel', () => {
    // Ein „Stand von HH:MM" koppelte das Primitiv an `AnzeigeKonventionenContext` und trüge
    // die aus LFH-318 bekannte Zeitzonen-Falle in ein GETEILTES Primitiv — die Kopplung
    // schlüge auf jeden Konsumenten zugleich durch. Handlungsleitend ist ohnehin der Knopf,
    // nicht die Zahl.
    //
    // Hier steht bewusst KEINE Anzahl der Konsumenten: sie wächst mit dem B3-Rollout
    // (gemessen auf diesem Branch: `UnfallhilfsstellenPage`, `Sidebar` und
    // `BereitstellungsraeumePage` sind währenddessen dazugekommen). Eine Zahl an dieser
    // Stelle ist keine Tatsache, sondern eine Wartungslast — sie veraltet still, und genau
    // das ist ihr vorheriger Stand („vier") schon einmal getan.
    renderMitProviders(<SeitenStandVeraltet onWiederholen={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('nichtGefundenInhalt', () => {
  it('nennt den 403-Fall beim Namen, wo ein Aufrufer einen kennt', () => {
    const query = { isError: true, error: new ApiError(403, 'verboten') };

    expect(
      nichtGefundenInhalt(query, {
        kein403: 'Benutzerliste nur für Admins',
        allgemein: 'Benutzerliste nicht verfügbar',
      }),
    ).toBe('Benutzerliste nur für Admins');
  });

  it('fällt bei jedem anderen Fehler auf die allgemeine Meldung zurück', () => {
    const query = { isError: true, error: new ApiError(500, 'kaputt') };

    expect(
      nichtGefundenInhalt(query, {
        kein403: 'Benutzerliste nur für Admins',
        allgemein: 'Benutzerliste nicht verfügbar',
      }),
    ).toBe('Benutzerliste nicht verfügbar');
  });

  it('meldet auch einen 403 allgemein, wo der Aufrufer keinen 403-Text gibt', () => {
    // Gemessen am Backend: von den sechs Katalog-GETs der Kräfte-Module trägt nur
    // `benutzer.rs:64` ein `_admin: AdminUser`. Wer dem Fahrzeug-Pool ein „nur für
    // Admins" anhängt, erfindet einen Fehlerfall, den das Backend nicht kennt.
    const query = { isError: true, error: new ApiError(403, 'verboten') };

    expect(nichtGefundenInhalt(query, { allgemein: 'Statuskatalog nicht verfügbar' })).toBe(
      'Statuskatalog nicht verfügbar',
    );
  });

  it('gibt ohne Fehler `undefined` zurück — antds eigener Leertext bleibt stehen', () => {
    expect(
      nichtGefundenInhalt({ isError: false, error: null }, { allgemein: 'egal' }),
    ).toBeUndefined();
  });
});

describe('ursacheText', () => {
  it('gibt die Meldung einer `ApiError` zurück', () => {
    expect(ursacheText(new ApiError(422, 'Ausmaß unbekannt'))).toBe('Ausmaß unbekannt');
  });

  it('gibt bei allem anderen `undefined` zurück', () => {
    // Bestandsverhalten der fünf abgelösten Kopien, nicht eine Verbesserung nebenbei:
    // ein gewöhnlicher `Error` trägt oft eine technische Meldung („Failed to fetch"),
    // die vor einer Einsatzkraft nichts zu suchen hat.
    expect(ursacheText(new Error('Failed to fetch'))).toBeUndefined();
    expect(ursacheText('kaputt')).toBeUndefined();
    expect(ursacheText(null)).toBeUndefined();
    expect(ursacheText(undefined)).toBeUndefined();
  });
});
