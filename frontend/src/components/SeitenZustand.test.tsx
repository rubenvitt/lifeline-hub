import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { MarkenRahmen } from '../test/nichtGefunden';
import { renderMitProviders } from '../test/utils';
import {
  istNichtGefunden,
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenLeer,
  SeitenNichtGefunden,
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
    // jsdom rechnet kein Layout; geprüft wird der Vertrag zur Stylesheet-Seite: ohne diese Klassen
    // (und den `sprache.css`-Import der Komponente) wären die Balken 0 px hoch.
    const { container } = renderMitProviders(<SeitenSkeleton />);

    expect(container.querySelector('.lfh-skelett')).not.toBeNull();
    expect(container.querySelectorAll('.lfh-skelett__balken').length).toBeGreaterThan(0);
  });

  it('rendert so viele Balken wie angefordert', () => {
    const { container } = renderMitProviders(<SeitenSkeleton zeilen={5} />);

    expect(container.querySelectorAll('.lfh-skelett__balken')).toHaveLength(5);
  });

  // LLH-1838 (Spec `seiten-zustaende`, „Modulwechsel zeigt sofort Kopf und Gerippe“): das Gerippe
  // eines Modulwechsels zeigt seine Balken erst nach einer Verzögerung, ein schnelles Modul
  // flackert sonst. Belegt wird es an der Klasse; die Verzögerung selbst trägt die CSS-Regel.
  it('verzögert die Balken nur auf Wunsch und meldet sich trotzdem sofort als beschäftigt', () => {
    const { container, rerender } = renderMitProviders(<SeitenSkeleton />);
    expect(container.querySelector('.lfh-skelett--verzoegert')).toBeNull();

    rerender(<SeitenSkeleton verzoegert />);
    const skelett = container.querySelector('.lfh-skelett--verzoegert');
    expect(skelett).not.toBeNull();
    expect(skelett).toHaveAttribute('aria-busy', 'true');
  });
});

describe('SeitenSkeleton: CSS der Verzögerung', () => {
  it('hält die Balken des verzögerten Gerippes zuerst unsichtbar und blendet sie spät ein', () => {
    const css = readFileSync(resolve(__dirname, '../theme/sprache.css'), 'utf8');
    const regel = css.match(/\.lfh-skelett--verzoegert \.lfh-skelett__balken\s*\{([^}]*)\}/);
    expect(regel, 'Regel für die verzögerten Balken fehlt').not.toBeNull();
    expect(regel![1]).toMatch(/animation:[^;]*lfh-skelett-ein[^;]*120ms/);
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
    // „Genau ein Primärbutton" (AK3) trägt nur, weil die Box selbst keinen Knopf beisteuert — eine
    // Aussage über den Bauplan, nicht bloß über diesen Aufruf.
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

  it('`gesperrt`: Knopf gesperrt, der Grund steht sichtbar darunter, ein Klick tut nichts (LLH-1050)', async () => {
    const anlegen = vi.fn();
    renderMitProviders(
      <SeitenLeer
        titel="Keine Betreuungsstellen"
        aktion={{
          label: 'Betreuungsstelle anlegen',
          onClick: anlegen,
          gesperrt: 'nur Einsatzleitung und Führungspersonal',
        }}
      />,
    );

    const knopf = screen.getByRole('button', { name: 'Betreuungsstelle anlegen' });
    expect(knopf).toBeDisabled();
    // Sichtbar, nicht nur Tooltip (Touch, LFH-1078), und als Beschreibung am Knopf.
    const grund = screen.getByText('nur Einsatzleitung und Führungspersonal');
    expect(grund).toBeVisible();
    expect(knopf).toHaveAccessibleDescription('nur Einsatzleitung und Führungspersonal');
    await userEvent.click(knopf).catch(() => undefined);
    expect(anlegen).not.toHaveBeenCalled();
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

  /** LLH-1819: ohne Neuversuch ist der Rückweg der eine Weg heraus, also primär. */
  it('macht den Rückweg zur Primäraktion, wenn kein Neuversuch angeboten wird', () => {
    renderMitProviders(
      <SeitenSackgasse
        titel="Kein Zugriff auf diesen Einsatz"
        rueckweg={{ pfad: '/einsaetze', label: 'Zur Einsatzliste' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Zur Einsatzliste' })).toHaveClass('ant-btn-primary');
  });

  /** LLH-1819: fehlendes Recht ist keine Störung; die Alarmkante bleibt Abruffehlern vorbehalten. */
  it('trägt neutral keine Alarmkante, sonst schon', () => {
    const { container, rerender } = renderMitProviders(
      <SeitenSackgasse titel="Einsatz konnte nicht geladen werden" />,
    );
    const paneel = () => container.querySelector<HTMLElement>('[data-lfh="paneel"]');
    expect(paneel()?.style.boxShadow).toMatch(/ 3px 0px inset$/);

    rerender(<SeitenSackgasse titel="Kein Zugriff auf diesen Einsatz" neutral />);
    expect(paneel()?.style.boxShadow ?? '').not.toMatch(/ 3px 0px inset$/);
  });
});

/**
 * Ein Objekt, das es nicht (mehr) gibt (LLH-1827, Change `a12ms7g9-seitenzustaende`, D4; Spec
 * `seiten-zustaende`, „Ein Muster für ein Objekt, das es nicht gibt“).
 */
describe('SeitenNichtGefunden', () => {
  const rueckweg = { label: 'Zu den Betroffenen', pfad: '/einsaetze/7/personen' };

  it('nennt die Sache und bietet genau einen Knopf, der zur Liste führt, ohne „Erneut abrufen“', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/"
          element={
            <SeitenNichtGefunden titel="Diese Person gibt es nicht (mehr)" rueckweg={rueckweg} />
          }
        />
        <Route path="/einsaetze/7/personen" element={<p>Betroffenenliste</p>} />
      </Routes>,
    );

    expect(screen.getByText('Diese Person gibt es nicht (mehr)')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
    // Neutral, kein Fehler der Anwendung: kein Alarmbanner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Zu den Betroffenen' }));
    expect(screen.getByText('Betroffenenliste')).toBeInTheDocument();
  });

  it('setzt die Marke „nicht als letzten Ort merken“, solange der Baustein steht', () => {
    const marke = { current: false };
    const revoked: string[] = [];
    function Rahmen({ zeigen }: { zeigen: boolean }) {
      return (
        <MarkenRahmen marke={marke} revoked={revoked}>
          {zeigen && (
            <SeitenNichtGefunden titel="Dieses Tier gibt es nicht (mehr)" rueckweg={rueckweg} />
          )}
        </MarkenRahmen>
      );
    }
    const { rerender } = renderMitProviders(<Rahmen zeigen />, { route: '/einsaetze/7/tiere/9' });
    expect(marke.current).toBe(true);
    // Kam die Meldung erst nach dem Laden, nimmt der Rahmen das Merken dieser Adresse zurück.
    expect(revoked).toEqual(['/einsaetze/7/tiere/9']);

    rerender(<Rahmen zeigen={false} />);
    expect(marke.current).toBe(false);
  });
});

describe('istNichtGefunden', () => {
  it('ist nur bei einer `ApiError` mit Status 404 wahr', () => {
    expect(istNichtGefunden(new ApiError(404, 'Nicht gefunden'))).toBe(true);
  });

  it('ist bei jedem anderen Fehler falsch', () => {
    // 403 bleibt ein Abruffehler mit „Erneut abrufen“ (design.md, Risiken); ein Netzfehler ebenso.
    expect(istNichtGefunden(new ApiError(403, 'Kein Zugriff'))).toBe(false);
    expect(istNichtGefunden(new ApiError(500, 'kaputt'))).toBe(false);
    expect(istNichtGefunden(new ApiError(410, 'weg'))).toBe(false);
    expect(istNichtGefunden(new Error('Failed to fetch'))).toBe(false);
    expect(istNichtGefunden({ status: 404 })).toBe(false);
    expect(istNichtGefunden(null)).toBe(false);
    expect(istNichtGefunden(undefined)).toBe(false);
  });
});

describe('SeitenStandVeraltet', () => {
  it('sagt, dass der gezeigte Stand alt ist, und bietet den erneuten Abruf', async () => {
    const wiederholen = vi.fn();
    renderMitProviders(<SeitenStandVeraltet onWiederholen={wiederholen} />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Aktualisierung fehlgeschlagen · Stand womöglich veraltet');

    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(wiederholen).toHaveBeenCalledTimes(1);
  });

  it('trägt keinen Zeitstempel', () => {
    // Kein „Stand von HH:MM": das koppelte das geteilte Primitiv an `AnzeigeKonventionenContext`
    // samt Zeitzonen-Falle, für jeden Konsumenten zugleich. Handlungsleitend ist der Knopf. Eine
    // Konsumentenzahl steht hier bewusst nicht — sie veraltete still.
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
    // Von den Katalog-GETs der Kräfte-Module verlangt nur `benutzer.rs` einen `AdminUser`; ein
    // „nur für Admins" am Fahrzeug-Pool erfände einen Fehlerfall.
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
    // Ein gewöhnlicher `Error` trägt oft eine technische Meldung („Failed to fetch"), die vor einer
    // Einsatzkraft nichts zu suchen hat.
    expect(ursacheText(new Error('Failed to fetch'))).toBeUndefined();
    expect(ursacheText('kaputt')).toBeUndefined();
    expect(ursacheText(null)).toBeUndefined();
    expect(ursacheText(undefined)).toBeUndefined();
  });
});
