import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { offeneRueckfrage } from '../test/rueckfrage';
import type { KarteServerConfig } from '../api/karte';
import type { KartenflaecheProps } from './lagekarte/Kartenflaeche';
import LagekartePage, { kopfMeta, quellenMeldung } from './LagekartePage';
import { einsatzFixture } from '../test/fixtures';

// URL.createObjectURL / revokeObjectURL fehlen in jsdom → Stubs direkt auf URL setzen (spyOn geht
// nicht, die Methoden existieren nicht).
(URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock-bild');
(URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

// Kartenflaeche mocken: kein WebGL. Der Stub exponiert Buttons, die die Callbacks mit festen Werten
// feuern; der Prop-Typ kommt vom echten Interface, ein Umbenennen bricht den Mock beim Kompilieren.
// Der imperative Handle trägt „Letzten Punkt zurück" und die erste Esc-Stufe, die über die
// Karten-Ref laufen.
const kartenHandle = vi.hoisted(() => ({
  punktZurueck: vi.fn(() => true),
  zeichnungVerwerfen: vi.fn(),
}));

vi.mock('./lagekarte/Kartenflaeche', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function KartenStub(props: Partial<KartenflaecheProps>, ref) {
      useImperativeHandle(ref, () => kartenHandle as never, []);
      return (
        <div data-testid="kartenflaeche-stub">
          {/* Stand der laufenden Figur, wie die echte Karte ihn bei jedem Klick meldet. */}
          <button
            onClick={() =>
              props.onZeichnenStandAenderung?.({ punkte: 3, bereit: true, kannZurueck: true })
            }
          >
            stand-3
          </button>
          <button
            onClick={() =>
              props.onZeichnenStandAenderung?.({ punkte: 0, bereit: false, kannZurueck: false })
            }
          >
            stand-0
          </button>
          <div data-testid="attribution">{props.attribution ?? ''}</div>
          <div data-testid="bilder-count">{(props.bilder ?? []).length}</div>
          <div data-testid="startansicht">
            {props.startAnsicht === undefined ? 'offen' : JSON.stringify(props.startAnsicht)}
          </div>
          {/* bbox-Pfad: ob die Seite einen Ausschnitt hören will, und ein Auslöser, der einen
              Ausschnitt meldet wie die echte Karte nach `moveend`. */}
          {/* Anflugziel: der Koordinatensprung der Sprungpalette kommt als ?zentrum= an und
              muss hier als Ziel ankommen. */}
          <div data-testid="flyto">{JSON.stringify(props.flyToZiel ?? null)}</div>
          <div data-testid="bbox-callback">{props.onBboxAenderung ? 'an' : 'aus'}</div>
          {/* Die echte Karte meldet Zoom und bbox im selben Zug (`Kartenflaeche.tsx`,
              `verarbeite`) — sonst bliebe eine zoom-gebundene Ebene (Energie) ohne gemeldeten
              Zoom fälschlich aus. */}
          <button
            onClick={() => {
              props.onZoomAenderung?.(10);
              props.onBboxAenderung?.('7.01,51.51,7.12,51.58');
            }}
          >
            bbox-melden
          </button>
          <button onClick={() => props.onKarteKlick?.({ lng: 8.6, lat: 50.1 })}>karte-klick</button>
          {/* Messen: welche Form die Karte bekommt, und ein Auslöser, der eine abgeschlossene
              Strecke von ~111 m meldet wie terra-draw beim Doppelklick. */}
          <div data-testid="messen">{props.messen ?? 'aus'}</div>
          {props.messen && (
            <button
              onClick={() =>
                props.onMessung?.(
                  {
                    type: 'LineString',
                    coordinates: [
                      [9, 52],
                      [9, 52.001],
                    ],
                  },
                  true,
                )
              }
            >
              mess-fertig
            </button>
          )}
          {(props.markers ?? []).map((m) => (
            <button key={m.schluessel} onClick={() => props.onMarkerKlick?.(m.schluessel)}>
              marker-{m.schluessel}
            </button>
          ))}
          {/* Polygon-Zeichnen: nur im aktiven Zeichenmodus feuerbar (spiegelt den echten Flow). */}
          {props.zeichnen && (
            <button
              onClick={() =>
                props.onFlaecheGezeichnet?.({
                  type: 'Polygon',
                  coordinates: [
                    [
                      [8.6, 50.1],
                      [8.7, 50.1],
                      [8.7, 50.2],
                      [8.6, 50.1],
                    ],
                  ],
                })
              }
            >
              flaeche-fertig
            </button>
          )}
          {/* Klick auf eine gerenderte Abschnittsfläche → onFlaecheKlick. */}
          {(props.flaechen ?? []).map((f) => (
            <button key={f.id} onClick={() => props.onFlaecheKlick?.(f.id)}>
              flaeche-{f.id}
            </button>
          ))}
          {/* Zone zeichnen: feuert je nach Modus eine Linien- oder Polygon-Geometrie. */}
          {props.zoneZeichnen && (
            <button
              onClick={() =>
                props.onZoneGezeichnet?.(
                  props.zoneZeichnen === 'linie'
                    ? {
                        type: 'LineString',
                        coordinates: [
                          [8.6, 50.1],
                          [8.7, 50.2],
                        ],
                      }
                    : {
                        type: 'Polygon',
                        coordinates: [
                          [
                            [8.6, 50.1],
                            [8.7, 50.1],
                            [8.7, 50.2],
                            [8.6, 50.1],
                          ],
                        ],
                      },
                )
              }
            >
              zone-fertig
            </button>
          )}
          {/* Klick auf eine gerenderte Zone → onZoneKlick. */}
          {(props.zonen ?? []).map((z) => (
            <button key={z.id} onClick={() => props.onZoneKlick?.(z.id)}>
              zone-{z.id}
            </button>
          ))}
        </div>
      );
    }),
  };
});

const eventSourceUrls: string[] = [];
class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    eventSourceUrls.push(url);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}
beforeEach(() => {
  eventSourceUrls.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const EINSATZ = einsatzFixture({
  bezeichnung: 'Test',
  einsatzort: 'ELW',
  einsatzort_lat: 50.0,
  einsatzort_lon: 8.5,
});

const UHS_NICHT_VERORTET = {
  id: 5,
  einsatz_id: 1,
  abschnitt_id: null,
  typ: 'behandlungsplatz',
  bezeichnung: 'BHP 50',
  standort: null,
  notiz: null,
  status: 'aktiv',
  lat: null,
  lon: null,
  erfasst_at: '',
  erfasst_von: 1,
  geaendert_at: '',
  geaendert_von: 1,
  storniert_at: null,
};

const SCHADEN_VERORTET = {
  id: 9,
  einsatz_id: 1,
  registrier_nr: 3,
  status: 'offen',
  typ: 'sachschaden',
  ausmass: 'gross',
  ort: 'Hauptstr.',
  lat: 51.0,
  lon: 7.0,
  beschreibung: '',
  geschaedigt_person_id: null,
  geschaedigt_personal_id: null,
  geschaedigt_organisation_id: null,
  geschaedigt_kontakt: null,
  uebergeben_an: null,
  uebergeben_at: null,
  abschluss_grund: null,
  abschluss_at: null,
  erfasst_at: '',
  erfasst_von: 1,
  geaendert_at: '',
  geaendert_von: 1,
  storniert_at: null,
  storniert_von: null,
  geschaedigt_registrier_nr: null,
  geschaedigt_storniert_at: null,
  geschaedigt_personal_name: null,
  geschaedigt_organisation_name: null,
};

const LAGEMELDUNG_VERORTET = {
  id: 4,
  einsatz_id: 1,
  meldung_id: 12,
  text: 'Brücke gesperrt',
  lat: 50.3,
  lon: 8.7,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  meldung_lfd_nr: 5,
  meldung_absender: 'Florian Nord 1',
};

// --- Taktische Mock-Objekte --- Nur die Felder, die der Code liest. Bewusst nicht als voller Typ
// annotiert: HttpResponse.json prüft nicht gegen den Interface-Typ.

const EINHEIT_NICHT_VERORTET = {
  id: 2,
  name: 'Zug 1',
  typ_label: 'Zug',
  lat: null as number | null,
  lon: null as number | null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  // Pflichtfeld — das Paneel „Ausgewählt" liest es.
  status: { quelle: 'ohne', verteilung: [] },
};

const EINHEIT_VERORTET = {
  id: 1,
  name: 'Gruppe A',
  typ_label: 'Gruppe',
  lat: 50.1,
  lon: 8.6,
  tz_fachaufgabe: null,
  tz_organisation: null,
  // Pflichtfeld — das Paneel „Ausgewählt" liest es.
  status: { quelle: 'ohne', verteilung: [] },
};

const ABSCHNITT_OHNE_FLAECHE = {
  id: 3,
  name: 'EA Nord',
  flaeche_geojson: null as string | null,
  tz_fachaufgabe: null,
  tz_organisation: null,
};

const FUEHRUNGSKRAFT_VERORTET = {
  id: 7,
  einsatz_id: 1,
  name: 'Zugführer',
  lat: 50.2,
  lon: 8.5,
  tz_fachaufgabe: null,
  tz_organisation: null,
  ist_einheitsfuehrer: true,
  ist_abschnittsleiter: false,
};

// Betroffene Person mit Fundort. Name und Vorname sind absichtlich gesetzt: die Lagekarte darf sie
// nie zeigen, und nur ein gesetzter Name kann das belegen.
const PERSON_VERORTET = {
  id: 11,
  einsatz_id: 1,
  registrier_nr: 42,
  status: 'betroffen',
  name: 'Kowalski',
  vorname: 'Anna',
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  aktuelle_sichtung: 'sk2',
  antreff_lat: 50.05,
  antreff_lon: 8.55,
  erfasst_at: '',
  erfasst_von: 1,
  geaendert_at: '',
  geaendert_von: 1,
  storniert_at: null,
};

const ORG_DRK = { id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' };

// Einsatz-Einstellungen: die Seite liest davon nichts, die Query läuft aber (Render-Kontext). Ohne
// Handler stünde `einstellungenQuery` in jedem Test auf `isError`.
const EINSTELLUNGEN = {
  einsatz_id: 1,
  standard_modul: null,
  basemap_modus: null,
  karten_zoom_start: null,
  fachebenen_sichtbar: null,
  zeitzone: null,
  zeitformat: null,
  einheiten: null,
  koordinatenformat: null,
  org_defaults: { org_id: 1 },
};

function basisHandler(
  extra: ReturnType<typeof http.get>[] = [],
  config: KarteServerConfig = {
    online_styles: [],
    offline_verfuegbar: false,
    offline_tiles_url: null,
    offline_attribution: null,
    // Pflichtfeld im generierten Schema — leere Liste = keine Region bereit.
    offline_regionen: [],
    karten_bau_verfuegbar: false,
  },
) {
  // extra zuerst: MSW nimmt den ersten Treffer → Tests überschreiben einzelne GET-Defaults gezielt.
  server.use(
    ...extra,
    http.get('/api/einsaetze/1', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([UHS_NICHT_VERORTET])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([SCHADEN_VERORTET])),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/freie-zeichen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/karte/fuehrungskraefte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/lage/meldungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/meldungen/rueckmeldungen', () =>
      HttpResponse.json({ frist_min: 60, einheiten: [], abschnitte: [] }),
    ),
    http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([])),
    // Ebene „Betroffene": ohne Anmeldung (`/auth/me` → 401) ist das Modul im Client frei, die Query
    // läuft in jedem Test — ohne diese zwei Handler stünde „Betroffene" überall im Ausfallbanner.
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/betreuung', () => HttpResponse.json({ bezirke: [], stellen: [] })),
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'Org', tz_organisation: null }),
    ),
    http.get('/api/karte/config', () => HttpResponse.json(config)),
    http.get('/api/einsaetze/1/einstellungen', () => HttpResponse.json(EINSTELLUNGEN)),
    http.get('/api/einsaetze/1/lage-snapshots', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/karte/hintergrundbilder', () => HttpResponse.json([])),
    // Standardansicht mit basemap_modus=null → useKartenAnsicht hydratisiert auf den
    // config-Verfügbarkeits-Default.
    http.get('/api/einsaetze/1/karten-ansichten', () =>
      HttpResponse.json([
        {
          id: 1,
          einsatz_id: 1,
          name: 'Standard',
          reihenfolge: 0,
          ist_standard: true,
          erstellt_at: '',
          geaendert_at: '',
        },
      ]),
    ),
  );
}

function renderSeite(route = '/einsaetze/1/lagekarte') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lagekarte" element={<LagekartePage />} />
    </Routes>,
    { route },
  );
}

// URL-Sonde: spiegelt den Query-String in ein data-testid, damit Tests die
// apply-then-clean-Bereinigung an der URL beobachten.
function LocationSonde() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderSeiteMitSonde(route: string) {
  return renderMitProviders(
    <>
      <Routes>
        <Route path="/einsaetze/:id/lagekarte" element={<LagekartePage />} />
      </Routes>
      <LocationSonde />
    </>,
    { route },
  );
}

/**
 * Das Warn-Overlay der Lagekarte: fehlt eine Domänen-Quelle, fehlen ihre Objekte, und eine Karte
 * ohne Objekt sieht aus wie eine Lage ohne Objekt. Deshalb nennt es die Quelle namentlich.
 *
 * Das Paar „ist da" / „ist nicht da" belegt zugleich, dass die Handler für gefahrengebiete,
 * einstellungen und lage-snapshots nötig sind: ohne sie stünden drei Quellen in jedem Test auf
 * Fehler (`onUnhandledRequest: 'error'` + `retry: false`), und der Negativfall wäre unerreichbar.
 */
describe('quellenMeldung', () => {
  it('zählt bis drei Namen auf', () => {
    expect(quellenMeldung(['Zonen'])).toBe('Lagebild unvollständig: Zonen');
    expect(quellenMeldung(['Zonen', 'Personal', 'Fahrzeuge'])).toBe(
      'Lagebild unvollständig: Zonen, Personal, Fahrzeuge',
    );
  });

  it('kürzt darüber hinaus — die vierte Quelle wird zur Zahl', () => {
    // Die Einzahl steht ausgeschrieben da: „und 1 weitere" ist kein deutscher Satz, und dieser
    // Grenzfall wird über die Seite nie erreicht.
    expect(quellenMeldung(['A', 'B', 'C', 'D'])).toBe(
      'Lagebild unvollständig: A, B, C und eine weitere',
    );
    expect(quellenMeldung(['A', 'B', 'C', 'D', 'E'])).toBe(
      'Lagebild unvollständig: A, B, C und 2 weitere',
    );
  });
});

describe('LagekartePage · Warn-Overlay bei fehlender Quelle (AK6)', () => {
  it('zeigt bei vollständig geladenem Lagebild KEIN Warn-Overlay', async () => {
    basisHandler();
    renderSeite();
    expect(await screen.findByRole('button', { name: /^Nicht verortet/ })).toBeInTheDocument();
    expect(screen.queryByTestId('lagebild-unvollstaendig')).not.toBeInTheDocument();
  });

  it('nennt die gescheiterte Quelle namentlich und trägt KEINEN Schließen-Knopf', async () => {
    basisHandler([http.get('/api/einsaetze/1/uhs', () => new HttpResponse(null, { status: 500 }))]);
    renderSeite();
    const overlay = await screen.findByTestId('lagebild-unvollstaendig');
    expect(overlay).toHaveTextContent('Lagebild unvollständig: Unfallhilfsstellen');
    // Positiver Partner zur Negativen im Historien-Test unten; sonst wäre der Live-Satz ungepinnt.
    // Der Titel kann die Wendung nicht erzeugen („Lagebild unvollständig: <Quellen>").
    expect(overlay).toHaveTextContent('unvollständig, nicht leer');
    // Das Overlay ist nicht wegklickbar. Geprüft wird die Abwesenheit jedes Knopfes — „bleibt nach
    // einem Klick stehen" wäre nicht widerlegbar.
    expect(within(overlay).queryByRole('button')).not.toBeInTheDocument();
  });

  it('kürzt bei Totalausfall auf drei Namen plus Restzähler', async () => {
    // Backend weg: alle elf Lagebild-Quellen scheitern. Eine vollständige Aufzählung wäre im Fükw
    // unlesbar; die Zahl trägt „alles", die Namen den Einstieg.
    basisHandler(
      [
        '/api/einsaetze/1',
        '/api/einsaetze/1/uhs',
        '/api/einsaetze/1/schaeden',
        '/api/einsaetze/1/einheiten',
        '/api/einsaetze/1/fahrzeuge',
        '/api/einsaetze/1/abschnitte',
        '/api/einsaetze/1/zonen',
        '/api/einsaetze/1/freie-zeichen',
        '/api/einsaetze/1/gefahrengebiete',
        '/api/einsaetze/1/lage/meldungen',
        '/api/einsaetze/1/karte/fuehrungskraefte',
      ].map((pfad) => http.get(pfad, () => new HttpResponse(null, { status: 500 }))),
    );
    renderSeite();
    const overlay = await screen.findByTestId('lagebild-unvollstaendig');
    expect(overlay).toHaveTextContent(
      'Lagebild unvollständig: Einsatzdaten, Unfallhilfsstellen, Schäden und 8 weitere',
    );
  });

  it('sagt im Historien-Modus, dass die Karte LEER ist — nicht bloß unvollständig', async () => {
    // Scheitert das Snapshot-Dokument, sind alle Rohlisten undefined: die Karte ist nicht
    // lückenhaft, sondern leer, und „unvollständig, nicht leer" wäre falsch. Im Historien-Modus
    // gibt es keinen Ersatzstand.
    basisHandler([
      http.get('/api/einsaetze/1/lage-snapshots/3', () => new HttpResponse(null, { status: 500 })),
    ]);
    renderSeite('/einsaetze/1/lagekarte?snapshot=3');
    const overlay = await screen.findByTestId('lagebild-unvollstaendig');
    expect(overlay).toHaveTextContent('Gesicherter Stand');
    expect(overlay).toHaveTextContent('die Karte ist leer, nicht aktuell');
    expect(overlay).not.toHaveTextContent('unvollständig, nicht leer');
  });
});

/**
 * Die zwei Sektionen mit eigener Query. Sie stehen nicht im Overlay (das spricht für das Lagebild):
 * eine leere Bilderliste sähe aus wie „kein Lageplan hinterlegt", und `AnsichtSwitcher` rendert bei
 * leerer Liste nichts.
 */
describe('LagekartePage · Fehler-Slots der Sidebar', () => {
  it('verdrahtet den Slot an „Nicht verortet" mit denselben Lagebild-Quellen wie das Overlay', async () => {
    // Derselbe 500er wie im Overlay-Test: `Sidebar.test.tsx` reicht den Slot als Prop herein und
    // sieht nicht, ob die Seite ihn füllt.
    basisHandler([http.get('/api/einsaetze/1/uhs', () => new HttpResponse(null, { status: 500 }))]);
    renderSeite();
    expect(
      await screen.findByText('Objektlisten konnten nicht geladen werden'),
    ).toBeInTheDocument();
    // Die unterscheidende Zusicherung: ohne Verdrahtung wäre `nichtVerortet` leer und die Sektion
    // behauptete „Alles verortet" über ungeladene Daten.
    expect(screen.queryByText('Alles verortet')).not.toBeInTheDocument();
    // Sektionslokal, nicht seitenweit: der Sektionskopf steht weiter da.
    expect(screen.getByRole('button', { name: /^Nicht verortet/ })).toBeInTheDocument();
  });

  it('meldet die gescheiterte Bilder-Query in ihrer Sektion', async () => {
    basisHandler([
      http.get(
        '/api/einsaetze/1/karte/hintergrundbilder',
        () => new HttpResponse(null, { status: 500 }),
      ),
    ]);
    renderSeite();
    expect(
      await screen.findByText('Bild-Hintergründe konnten nicht geladen werden'),
    ).toBeInTheDocument();
    // Kein Lagebild-Fehler → kein Overlay. Der Slot ersetzt es nicht, er ergänzt es.
    expect(screen.queryByTestId('lagebild-unvollstaendig')).not.toBeInTheDocument();
  });

  it('meldet die gescheiterte Ansichts-Query in ihrer Sektion', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/karten-ansichten', () => new HttpResponse(null, { status: 500 })),
    ]);
    renderSeite();
    expect(
      await screen.findByText('Kartenansichten konnten nicht geladen werden'),
    ).toBeInTheDocument();
  });

  it('ohne Fehler trägt die Sidebar keinen der drei Slots', async () => {
    basisHandler();
    renderSeite();
    expect(await screen.findByRole('button', { name: /^Nicht verortet/ })).toBeInTheDocument();
    expect(screen.queryByText('Objektlisten konnten nicht geladen werden')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Bild-Hintergründe konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Kartenansichten konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });
});

describe('LagekartePage', () => {
  it('zeigt die Nicht-verortet-Liste mit Anzahl im Paneelkopf', async () => {
    basisHandler();
    renderSeite();
    // Die Anzahl steht als Mono-Meta im Klappkopf und ist Teil seines zugänglichen Namens — gezielt
    // diesen Knopf treffen.
    expect(await screen.findByRole('button', { name: 'Nicht verortet 1' })).toBeInTheDocument();
    expect(await screen.findByText(/BHP 50/)).toBeInTheDocument();
  });

  it('startet auf dem Einsatzort statt auf der Deutschland-Übersicht', async () => {
    basisHandler();
    renderSeite();
    // EINSATZ trägt einsatzort 50.0/8.5; der verortete Schaden liegt woanders und darf den
    // Ausschnitt nicht bestimmen.
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('startansicht').textContent ?? 'null')).toEqual({
        art: 'punkt',
        lng: 8.5,
        lat: 50.0,
        zoom: 14,
      }),
    );
  });

  /*
   * Das Gate wartet auch auf die Ansichten-Query: kam sie langsamer, entschiede die Karte ohne
   * Ansicht, und die Startansicht wird genau einmal verbraucht (`Kartenflaeche`).
   */
  it('wartet mit der Startansicht auf eine langsame Ansichten-Abfrage', async () => {
    let freigeben: () => void = () => {};
    const freigabe = new Promise<void>((r) => (freigeben = r));
    basisHandler([
      http.get('/api/einsaetze/1/karten-ansichten', async () => {
        await freigabe;
        return HttpResponse.json([
          {
            id: 1,
            einsatz_id: 1,
            name: 'Standard',
            reihenfolge: 0,
            ist_standard: true,
            zentrum_lat: 49.4,
            zentrum_lon: 8.7,
            zoom: 12,
            erstellt_at: '',
            geaendert_at: '',
          },
        ]);
      }),
    ]);
    renderSeite();
    // Die Marker-Quellen sind da (die Liste steht) — die Ansichten noch nicht.
    expect(await screen.findByRole('button', { name: 'Nicht verortet 1' })).toBeInTheDocument();
    expect(screen.getByTestId('startansicht')).toHaveTextContent('offen');
    freigeben();
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('startansicht').textContent ?? 'null')).toEqual({
        art: 'punkt',
        lng: 8.7,
        lat: 49.4,
        zoom: 12,
      }),
    );
  });

  it('öffnet selbst KEINE SSE-Verbindung (der Live-Stream ist ins EinsatzLayout gehoben)', async () => {
    // Das EinsatzLayout besitzt die eine Verbindung pro Einsatz (HTTP/1.1-Limit von 6); die Seite
    // darf keine eigene öffnen.
    basisHandler();
    renderSeite();
    expect(await screen.findByRole('button', { name: /^Nicht verortet/ })).toBeInTheDocument();
    expect(eventSourceUrls).toHaveLength(0);
  });

  it('platziert ein Objekt: Objekt wählen → Karten-Klick → PATCH mit lat/lon', async () => {
    let patchBody: unknown = null;
    basisHandler([
      http.patch('/api/einsaetze/1/uhs/5', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...UHS_NICHT_VERORTET, lat: 50.1, lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Platzieren' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => expect(patchBody).toEqual({ lat: 50.1, lon: 8.6 }));
  });

  it('verschiebt den Einsatzort: Verschieben → Karten-Klick → Kopf-PATCH mit neuer Koordinate', async () => {
    let patchBody: Record<string, unknown> | null = null;
    basisHandler([
      http.patch('/api/einsaetze/1', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...EINSATZ, einsatzort_lat: 50.1, einsatzort_lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    // Einsatzort ist verortet → Knopf „Verschieben".
    await user.click(await screen.findByRole('button', { name: 'Verschieben' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(patchBody!.einsatzort_lat).toBe(50.1);
      expect(patchBody!.einsatzort_lon).toBe(8.6);
      expect(patchBody!.bezeichnung).toBe('Test'); // andere Kopffelder bleiben erhalten (Vollersatz)
    });
    // Die Einsatznummer ist nicht änderbar — schon der Schlüssel (auch mit `null`) wäre beim Server
    // 400.
    expect(patchBody).not.toHaveProperty('einsatznummer_intern');
  });

  it('Marker-Klick öffnet den Inspector mit Modul-Link', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-schaden-9'));
    const link = await screen.findByRole('link', { name: /Im Fachmodul öffnen/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden/9');
  });

  it('rendert freie taktische Zeichen als Marker (Datenpfad: Query → alleVerortet → sichtbar) (LFH-170)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/freie-zeichen', () =>
        HttpResponse.json([
          {
            id: 42,
            einsatz_id: 1,
            lat: 50.1,
            lon: 8.6,
            grundzeichen: 'stelle',
            organisation: null,
            fachaufgabe: null,
            symbol: null,
            einheit: null,
            funktion: null,
            farbe: null,
            label: 'Sammelplatz',
            erstellt_von: 1,
            erstellt_at: '',
            geaendert_at: '',
          },
        ]),
      ),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-freies_zeichen-42')).toBeInTheDocument();
  });

  it('Marker-Klick auf ein freies Zeichen öffnet den FreiesZeichenInspector (kein Fach-Modul-Link) (LFH-170)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/freie-zeichen', () =>
        HttpResponse.json([
          {
            id: 42,
            einsatz_id: 1,
            lat: 50.1,
            lon: 8.6,
            grundzeichen: 'stelle',
            organisation: null,
            fachaufgabe: null,
            symbol: null,
            einheit: null,
            funktion: null,
            farbe: null,
            label: 'Sammelplatz',
            erstellt_von: 1,
            erstellt_at: '',
            geaendert_at: '',
          },
        ]),
      ),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-freies_zeichen-42'));
    // FreiesZeichenInspector: Picker mit vorbelegtem Grundzeichen; KEIN „Im Fach-Modul öffnen".
    expect(await screen.findByText('Stelle, Einrichtung')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Im Fachmodul öffnen/ })).not.toBeInTheDocument();
  });

  it('Marker-Klick während Platzieren öffnet keinen Inspector und lässt den Platzier-Modus intakt (LFH-208)', async () => {
    // Ein Marker-Klick während aktiver Platzierung darf kein Auswahl-Panel öffnen; der
    // Platzier-Modus bleibt intakt.
    let patchBody: unknown = null;
    basisHandler([
      http.patch('/api/einsaetze/1/uhs/5', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...UHS_NICHT_VERORTET, lat: 50.1, lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Platzieren' }));
    await user.click(await screen.findByText('marker-schaden-9'));
    expect(screen.queryByRole('link', { name: /Im Fachmodul öffnen/ })).not.toBeInTheDocument();
    // Platzier-Modus intakt: der nächste Karten-Klick verortet weiterhin.
    await user.click(screen.getByText('karte-klick'));
    await waitFor(() => expect(patchBody).toEqual({ lat: 50.1, lon: 8.6 }));
  });

  it('rendert verortete Lagemeldungen als Marker; Klick öffnet Inspector mit Backlink zur Quell-Meldung', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/lage/meldungen', () => HttpResponse.json([LAGEMELDUNG_VERORTET])),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-lagemeldung-4'));
    // Kurzinfo der Meldung im Inspector + Rückverweis auf die Meldungen-Ansicht.
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Brücke gesperrt')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Zur Quell-Meldung/ });
    // Deeplink auf die Quell-Meldung: meldung_id, nicht LageMeldung-id.
    expect(link).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=12');
    // Lagemeldungs-Marker sind kartenseitig read-only (Verorten nur beim Übergeben).
    expect(screen.queryByRole('button', { name: /Verortung löschen/ })).not.toBeInTheDocument();
  });

  it('Basemap-Umschalter: von Online auf Blind wechseln, Marker bleiben sichtbar', async () => {
    basisHandler([], {
      online_styles: [
        { name: 'Online', url: 'https://x/style.json', typ: 'vektor', attribution: '© X' },
      ],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    const user = userEvent.setup();
    renderSeite();
    // Default ist 'online' (online_style_url gesetzt). Die Kartengrundlage ist eine Segmentleiste
    // über der Karte; je Online-Stil ein Segment, benannt nach dem Stil.
    expect(await screen.findByText('marker-schaden-9')).toBeInTheDocument();
    const grundlage = screen.getByRole('radiogroup', { name: 'Kartengrundlage' });
    expect(within(grundlage).getByRole('radio', { name: 'Online' })).toBeChecked();
    expect(within(grundlage).getByRole('radio', { name: 'Blind' })).not.toBeChecked();
    await user.click(within(grundlage).getByRole('radio', { name: 'Blind' }));
    expect(within(grundlage).getByRole('radio', { name: 'Blind' })).toBeChecked();
    expect(within(grundlage).getByRole('radio', { name: 'Online' })).not.toBeChecked();
    // Marker bleiben im Blind-Modus sichtbar (Spec-Garantie):
    expect(screen.getByText('marker-schaden-9')).toBeInTheDocument();
  });

  it('Schmutzig-Erkennung: Basemap-Wechsel blendet „In dieser Ansicht speichern" ein (LFH-319)', async () => {
    basisHandler([], {
      online_styles: [
        { name: 'Online', url: 'https://x/style.json', typ: 'vektor', attribution: '© X' },
      ],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    const user = userEvent.setup();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    // Frisch hydratisiert = deckungsgleich mit der Ansicht → noch kein Speichern-Button.
    expect(screen.queryByRole('button', { name: 'In dieser Ansicht speichern' })).toBeNull();
    // Basemap auf Blind wechseln → der Zustand weicht von der gespeicherten Ansicht ab.
    await user.click(screen.getByRole('radio', { name: 'Blind' }));
    expect(
      await screen.findByRole('button', { name: 'In dieser Ansicht speichern' }),
    ).toBeInTheDocument();
  });

  it('Basemap-Umschalter: ohne Config sind Online/Offline gesperrt, Blind aktiv', async () => {
    // Default-Config: leer → nur Blind verfügbar. Gesperrt statt ausgeblendet: dass es keine
    // Online-/Offline-Karte gibt, ist eine Aussage über die Installation — der Grund steht am
    // Segment.
    basisHandler();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    const online = screen.getByRole('radio', { name: 'Online' });
    expect(online).toBeDisabled();
    expect(online).toHaveAttribute('title', 'Online-Karte nicht konfiguriert');
    expect(screen.getByRole('radio', { name: 'Offline' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Blind' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Blind' })).toBeChecked();
  });

  it('Basemap-Umschalter: Blind-Modus zeigt erklärenden Hinweistext', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    // Der Hinweis steht im Paneel „Kartengrundlage" der Leiste — zu Beginn zugeklappt.
    await user.click(await screen.findByRole('button', { name: 'Kartengrundlage' }));
    expect(await screen.findByText(/Keine Basemap konfiguriert/i)).toBeInTheDocument();
  });

  it('Basemap-Umschalter: bei verfügbarer Config sind passende Buttons aktiv und kein Blind-Hinweis', async () => {
    basisHandler([], {
      online_styles: [
        { name: 'Online', url: 'https://x/style.json', typ: 'vektor', attribution: '© X' },
      ],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    const user = userEvent.setup();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect(screen.getByRole('radio', { name: 'Online' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Offline' })).toBeEnabled();
    // Default-Modus ist 'online' → kein Blind-Hinweis, auch bei aufgeklapptem Paneel.
    await user.click(screen.getByRole('button', { name: 'Kartengrundlage' }));
    expect(screen.queryByText(/Keine Basemap konfiguriert/i)).not.toBeInTheDocument();
  });

  it('Basemap-Umschalter: nur Offline konfiguriert → Online disabled, Offline aktiv', async () => {
    basisHandler([], {
      online_styles: [],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect(screen.getByRole('radio', { name: 'Online' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Offline' })).toBeEnabled();
    // defaultModus springt auf 'offline'
    expect(screen.getByRole('radio', { name: 'Offline' })).toBeChecked();
  });

  // --- Taktische Gliederung ---

  it('zeigt die taktischen Layer-Toggles und ein nicht-verortetes taktisches Objekt in der Liste', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([EINHEIT_NICHT_VERORTET])),
      http.get('/api/organisation', () => HttpResponse.json(ORG_DRK)),
    ]);
    renderSeite();
    // Layer-Switch-Labels vorhanden (taktische Ebenen).
    expect(await screen.findByText('Einheiten')).toBeInTheDocument();
    expect(screen.getByText('Fahrzeuge')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Abschnitte')).toBeInTheDocument();
    // Nicht-verortete Einheit erscheint mit korrektem Label in der Nicht-verortet-Liste.
    expect(await screen.findByText('Einheit: Zug 1')).toBeInTheDocument();
  });

  it('LFH-616: Messen über den Kartenknopf — Wert im Fuß, Escape beendet', async () => {
    basisHandler([]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Messen' }));
    expect(screen.getByTestId('messen')).toHaveTextContent('strecke');
    expect(screen.getByRole('button', { name: 'Messen' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByText('mess-fertig'));
    expect(document.querySelector('[data-lfh="messwert"]')).toHaveTextContent('111 m');

    // Formwechsel geht an die Karte, der Modus bleibt.
    await user.click(screen.getByRole('radio', { name: 'Fläche' }));
    expect(screen.getByTestId('messen')).toHaveTextContent('flaeche');

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('messen')).toHaveTextContent('aus');
    expect(document.querySelector('[data-lfh="mess-steuerung"]')).toBeNull();
  });

  it('platziert eine Einheit: wählen → Karten-Klick → PATCH /position mit lat/lon', async () => {
    let body: unknown = null;
    basisHandler([
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([EINHEIT_NICHT_VERORTET])),
      http.patch('/api/einsaetze/1/einheiten/2/position', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...EINHEIT_NICHT_VERORTET, lat: 50.1, lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    // Mehrere „Platzieren"-Knöpfe (UHS BHP 50 + Einheit Zug 1) → über das List-Item der Einheit
    // eindeutig treffen.
    const item = (await screen.findByText('Einheit: Zug 1')).closest(
      '.listen-eintrag',
    ) as HTMLElement;
    await user.click(within(item).getByRole('button', { name: 'Platzieren' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => expect(body).toMatchObject({ lat: 50.1, lon: 8.6 }));
  });

  it('zeichnet eine Abschnittsfläche: Fläche zeichnen → fertig → PATCH /flaeche mit Polygon-GeoJSON', async () => {
    let body: { flaeche_geojson?: string } | null = null;
    basisHandler([
      http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([ABSCHNITT_OHNE_FLAECHE])),
      http.patch('/api/einsaetze/1/abschnitte/3/flaeche', async ({ request }) => {
        body = (await request.json()) as { flaeche_geojson?: string };
        return HttpResponse.json({
          ...ABSCHNITT_OHNE_FLAECHE,
          flaeche_geojson: body.flaeche_geojson,
        });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Fläche zeichnen' }));
    // Der Stub blendet "flaeche-fertig" nur im aktiven Zeichenmodus ein.
    await user.click(await screen.findByText('flaeche-fertig'));
    await waitFor(() => expect(body).not.toBeNull());
    expect(typeof body!.flaeche_geojson).toBe('string');
    const poly = JSON.parse(body!.flaeche_geojson as string);
    expect(poly.type).toBe('Polygon');
    expect(Array.isArray(poly.coordinates)).toBe(true);
  });

  it('rendert verortetes Personal als taktische Zeichen (alle über karte/fuehrungskraefte, LFH-276)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/karte/fuehrungskraefte', () =>
        HttpResponse.json([FUEHRUNGSKRAFT_VERORTET]),
      ),
    ]);
    renderSeite();
    // Verortetes Personal erzeugt marker-fuehrung-<id> (Marker-Typ bleibt 'fuehrung').
    expect(await screen.findByText('marker-fuehrung-7')).toBeInTheDocument();
    // Personal kommt ausschließlich über karte/fuehrungskraefte — es gibt keinen eigenen
    // 'personal'-Markertyp.
    expect(screen.queryByText(/^marker-personal-/)).not.toBeInTheDocument();
  });

  it('Marker-Klick auf eine verortete Einheit öffnet den Inspector mit Fach-Modul-Link', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([EINHEIT_VERORTET])),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-einheit-1'));
    const link = await screen.findByRole('link', { name: /Im Fachmodul öffnen/ });
    // Deeplink mit Listen-Selektion der Einheit.
    expect(link).toHaveAttribute('href', '/einsaetze/1/einheiten?einheit=1');
  });

  it('Online-Sub-Switcher: zwischen zwei Views wechseln aktualisiert die Attribution', async () => {
    basisHandler([], {
      online_styles: [
        { name: 'Liberty', url: 'https://x/liberty', typ: 'vektor', attribution: '© Liberty' },
        { name: 'TopPlus', url: 'https://x/{z}/{y}/{x}.png', typ: 'raster', attribution: '© BKG' },
      ],
      offline_verfuegbar: false,
      offline_tiles_url: null,
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    const user = userEvent.setup();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    // Default-View ist der erste (Liberty) → dessen Attribution liegt an.
    expect(screen.getByTestId('attribution')).toHaveTextContent('© Liberty');
    // Jeder Online-Stil ist ein eigenes Segment der Kartengrundlage.
    const grundlage = screen.getByRole('radiogroup', { name: 'Kartengrundlage' });
    expect(within(grundlage).getByRole('radio', { name: 'Liberty' })).toBeChecked();
    await user.click(within(grundlage).getByRole('radio', { name: 'TopPlus' }));
    await waitFor(() => expect(screen.getByTestId('attribution')).toHaveTextContent('© BKG'));
    expect(within(grundlage).getByRole('radio', { name: 'TopPlus' })).toBeChecked();
  });

  // --- Gefahren- & Absperrzonen ---

  it('zeichnet eine Polygon-Zone: Typ Gefahrengebiet → zeichnen → bestätigen → POST mit geometrie_typ Polygon', async () => {
    // onZoneGezeichnet persistiert nicht direkt — erst „Speichern" in der Bestätigungs-Phase löst
    // den POST aus.
    let body: { typ?: string; geometrie_typ?: string; geometrie?: string } | null = null;
    basisHandler([
      http.post('/api/einsaetze/1/zonen', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          id: 5,
          einsatz_id: 1,
          typ: body!.typ,
          geometrie_typ: body!.geometrie_typ,
          geometrie: body!.geometrie,
          label: null,
          farbe: null,
          notiz: null,
          erstellt_von: 1,
          erstellt_at: '',
          geaendert_at: '',
        });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.typ).toBe('gefahrengebiet');
    expect(body!.geometrie_typ).toBe('Polygon');
    expect(JSON.parse(body!.geometrie as string).type).toBe('Polygon');
  });

  it('zeichnet eine Linien-Zone: Absperrgrenze → zeichnen → bestätigen → POST mit geometrie_typ LineString', async () => {
    let body: { typ?: string; geometrie_typ?: string } | null = null;
    basisHandler([
      http.post('/api/einsaetze/1/zonen', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          id: 6,
          einsatz_id: 1,
          typ: 'absperrgrenze',
          geometrie_typ: 'LineString',
          geometrie: '{}',
          label: null,
          farbe: null,
          notiz: null,
          erstellt_von: 1,
          erstellt_at: '',
          geaendert_at: '',
        });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Absperrgrenze zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.typ).toBe('absperrgrenze');
    expect(body!.geometrie_typ).toBe('LineString');
  });

  it('öffnet den Inspector per Klick und ändert das Label (PATCH)', async () => {
    let patch: { label?: string } | null = null;
    const ZONE_FREI = {
      id: 7,
      einsatz_id: 1,
      typ: 'freie_skizze',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'Skizze',
      farbe: '#00ff00',
      notiz: null,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_FREI])),
      http.patch('/api/einsaetze/1/zonen/7', async ({ request }) => {
        patch = (await request.json()) as typeof patch;
        return HttpResponse.json({ ...ZONE_FREI, label: patch!.label });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('zone-7'));
    const labelInput = await screen.findByLabelText('Label');
    await user.clear(labelInput);
    await user.type(labelInput, 'Neu');
    await user.tab(); // onBlur löst PATCH aus
    await waitFor(() => expect(patch).not.toBeNull());
    expect(patch!.label).toBe('Neu');
  });

  it('Reverse-Deeplink ?gefahrengebiet= selektiert die zugehörige Zone (LFH-155)', async () => {
    const ZONE_GG = {
      id: 7,
      einsatz_id: 1,
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'GG-Zone',
      farbe: null,
      notiz: null,
      gefahrengebiet_id: 10,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    const GEBIET = {
      id: 10,
      einsatz_id: 1,
      label: 'Nord',
      zonen_ids: [7],
      hoechste_warnstufe: 'keine',
    };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_GG])),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([GEBIET])),
    ]);
    renderSeite('/einsaetze/1/lagekarte?gefahrengebiet=10');
    // Der ZonenInspector der zugehörigen Zone öffnet sich (Gefahrengebiet-Gruppen-Select).
    expect(await screen.findByLabelText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
  });

  it('Deeplink ?evakuierungsbezirk= wählt eine Fläche des Bezirks, beschriftet und räumt (LFH-673)', async () => {
    const ZONE_EB = {
      id: 8,
      einsatz_id: 1,
      typ: 'evakuierungsbezirk',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: null,
      farbe: null,
      notiz: null,
      gefahrengebiet_id: null,
      evakuierungsbezirk_id: 5,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    const UFER = {
      id: 5,
      einsatz_id: 1,
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'geschaetzt',
      raeumung: 'laeuft',
      flaechen: 1,
      angelegt_at: '',
    };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_EB])),
      http.get('/api/einsaetze/1/betreuung', () =>
        HttpResponse.json({ bezirke: [UFER], stellen: [] }),
      ),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?evakuierungsbezirk=5');
    expect(await screen.findByLabelText('Gehört zu Evakuierungsbezirk')).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: 'Betreuung zu Uferstraße 12–40' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('evakuierungsbezirk'),
    );
  });

  it('Deeplink ?evakuierungsbezirk=: Fläche in einer anderen Ansicht → erst Ansicht wechseln, dann wählen (LFH-673)', async () => {
    const ZONE_NORD = {
      id: 8,
      einsatz_id: 1,
      typ: 'evakuierungsbezirk',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: null,
      farbe: null,
      notiz: null,
      gefahrengebiet_id: null,
      evakuierungsbezirk_id: 5,
      ansicht_id: 2,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_NORD])),
      http.get('/api/einsaetze/1/karten-ansichten', () =>
        HttpResponse.json([
          {
            id: 1,
            einsatz_id: 1,
            name: 'Standard',
            reihenfolge: 0,
            ist_standard: true,
            erstellt_at: '',
            geaendert_at: '',
          },
          {
            id: 2,
            einsatz_id: 1,
            name: 'Nord',
            reihenfolge: 1,
            ist_standard: false,
            erstellt_at: '',
            geaendert_at: '',
          },
        ]),
      ),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?evakuierungsbezirk=5');
    expect(await screen.findByLabelText('Gehört zu Evakuierungsbezirk')).toBeInTheDocument();
    await waitFor(() => {
      const ort = screen.getByTestId('location-search').textContent ?? '';
      expect(ort).toContain('ansicht=2');
      expect(ort).not.toContain('evakuierungsbezirk');
    });
  });

  it('Deeplink ?evakuierungsbezirk=: unbrauchbar oder ohne Fläche wird geräumt (LFH-673)', async () => {
    basisHandler();
    const { unmount } = renderSeiteMitSonde('/einsaetze/1/lagekarte?evakuierungsbezirk=abc');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('evakuierungsbezirk'),
    );
    unmount();
    renderSeiteMitSonde('/einsaetze/1/lagekarte?evakuierungsbezirk=77');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('evakuierungsbezirk'),
    );
    expect(screen.queryByLabelText('Gehört zu Evakuierungsbezirk')).not.toBeInTheDocument();
  });

  it('Deeplink ?platzieren=betreuungsstelle: ohne Modul Betreuung kein Platziermodus (LFH-673)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/modul-overrides', () =>
        HttpResponse.json({
          betreuung: { einsatz_id: 1, modul_key: 'betreuung', sichtbar: false },
        }),
      ),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?platzieren=betreuungsstelle:4');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('platzieren'),
    );
    expect(screen.queryByText(/Klick auf die Karte setzt die Koordinate/)).not.toBeInTheDocument();
  });

  it('Reverse-Deeplink ?gefahrengebiet=: räumt den Param aus der URL (apply-then-clean) und die Selektion bleibt bestehen (LFH-155)', async () => {
    const ZONE_GG = {
      id: 7,
      einsatz_id: 1,
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'GG-Zone',
      farbe: null,
      notiz: null,
      gefahrengebiet_id: 10,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    const GEBIET = {
      id: 10,
      einsatz_id: 1,
      label: 'Nord',
      zonen_ids: [7],
      hoechste_warnstufe: 'keine',
    };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_GG])),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([GEBIET])),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?gefahrengebiet=10');
    // Zone selektiert → Inspector offen (Sonde startet mit ?gefahrengebiet=10).
    expect(await screen.findByLabelText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
    // apply-then-clean: der Param ist nach dem Anwenden aus der URL geräumt.
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('gefahrengebiet'),
    );
    // Idempotenz (StrictMode-fest): der erneute Effekt-Lauf mit geräumtem Param selektiert nicht
    // erneut — die Selektion bleibt.
    expect(screen.getByLabelText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
  });

  /**
   * Platzier-Auftrag von außen. Der Effekt räumt den Parameter (apply-then-clean), aber
   * `darfSchreiben` kennt kein „noch unbekannt" — für einen noch nicht geladenen Einsatz liefert
   * `darfImEinsatzSchreiben` `false`. Ohne Lade-Riegel löschte der erste Commit den Auftrag, und
   * der Deeplink wäre wirkungslos.
   *
   * Genau das ist der Fall eines Deeplinks — F5, neuer Tab, geteilter Link. Der In-App-Weg über die
   * Schadensdetailseite verdeckt ihn, weil `darfSchreiben` dort schon im ersten Render steht.
   */
  it('Deeplink ?platzieren= räumt den Param und startet den Platzier-Modus (LFH-340)', async () => {
    basisHandler();
    renderSeiteMitSonde('/einsaetze/1/lagekarte?platzieren=schaden:10');

    // Der Modus ist an der Anweisungskarte der Sidebar ablesbar — sie steht nur, solange
    // `platzierungZiel` gesetzt ist.
    expect(await screen.findByText(/Klick auf die Karte setzt die Koordinate/)).toBeInTheDocument();
    // apply-then-clean: erst nach dem Anwenden ist der Param weg.
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('platzieren'),
    );
  });

  /**
   * Koordinatensprung: die Sprungpalette schickt `?zentrum=<lat>,<lon>`. Die Karte fliegt die
   * Stelle an und räumt den Parameter — sonst zöge ein Neuladen die Karte wieder dorthin. Auch ein
   * Beobachter darf das: Anfliegen ist Lesen.
   */
  it('Deeplink ?zentrum= fliegt die Stelle an und räumt den Param (LFH-619)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...EINSATZ, meine_rolle: 'beobachter' }),
      ),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?zentrum=52.52,13.405');

    await waitFor(() =>
      expect(screen.getByTestId('flyto')).toHaveTextContent('{"lng":13.405,"lat":52.52}'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('zentrum'),
    );
  });

  it('Deeplink ?zentrum=: ein unbrauchbarer Wert fliegt nichts an und wird trotzdem geräumt', async () => {
    basisHandler();
    renderSeiteMitSonde('/einsaetze/1/lagekarte?zentrum=52.52');

    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('zentrum'),
    );
    expect(screen.getByTestId('flyto')).toHaveTextContent('null');
  });

  it('Deeplink ?platzieren=: ein Beobachter kommt nicht in den Platzier-Modus', async () => {
    // Der Modus endet in einem PATCH; ohne Schreibrecht wäre der Klick eine Einladung in einen 403.
    // Der Param wird trotzdem geräumt, damit ein Neuladen ihn nicht wieder aufgreift.
    basisHandler([
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...EINSATZ, meine_rolle: 'beobachter' }),
      ),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?platzieren=schaden:10');

    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('platzieren'),
    );
    expect(screen.queryByText(/Klick auf die Karte setzt die Koordinate/)).not.toBeInTheDocument();
  });

  it('Deeplink ?platzieren=betreuungsstelle: startet den Platzier-Modus und räumt (LFH-673)', async () => {
    basisHandler();
    renderSeiteMitSonde('/einsaetze/1/lagekarte?platzieren=betreuungsstelle:4');
    expect(await screen.findByText(/Klick auf die Karte setzt die Koordinate/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('platzieren'),
    );
  });

  it('Deeplink ?platzieren=betreuungsstelle: ein Beobachter kommt nicht in den Modus (LFH-673)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...EINSATZ, meine_rolle: 'beobachter' }),
      ),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?platzieren=betreuungsstelle:4');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('platzieren'),
    );
    expect(screen.queryByText(/Klick auf die Karte setzt die Koordinate/)).not.toBeInTheDocument();
  });

  it('hebt eine Zone auf (DELETE)', async () => {
    let geloescht = false;
    const ZONE_FREI = {
      id: 7,
      einsatz_id: 1,
      typ: 'freie_skizze',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'Skizze',
      farbe: '#00ff00',
      notiz: null,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_FREI])),
      http.delete('/api/einsaetze/1/zonen/7', () => {
        geloescht = true;
        return new HttpResponse(null, { status: 204 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('zone-7'));
    await user.click(await screen.findByRole('button', { name: 'Zone aufheben' }));
    // Rückfrage vor dem harten Löschen: ohne Bestätigung geht kein DELETE raus.
    const rueckfrage = await offeneRueckfrage();
    expect(geloescht).toBe(false);
    await user.click(within(rueckfrage).getByRole('button', { name: 'Aufheben' }));
    await waitFor(() => expect(geloescht).toBe(true));
  });

  // --- Bild-Hintergründe ---

  it('Smoke: Bild in der Liste → Blob-URL wird geladen → BildOverlay landet an Kartenflaeche', async () => {
    const BILD = {
      id: 3,
      einsatz_id: 1,
      name: 'lageplan.png',
      mime: 'image/png',
      groesse: 12345,
      ecken_json: JSON.stringify([
        [9.0, 50.0],
        [9.1, 50.0],
        [9.1, 49.9],
        [9.0, 49.9],
      ]),
      opazitaet: 80,
      sichtbar: true,
      reihenfolge: 1,
      hochgeladen_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    basisHandler([
      http.get('/api/einsaetze/1/karte/hintergrundbilder', () => HttpResponse.json([BILD])),
      // Kein `new Blob(...)` als Body: jsdoms Blob hat kein `stream()`, undicis `extractBody` ruft
      // es aber beim Bau der Response. Der Handler stürbe still im MSW-Lookup, und der Test
      // scheiterte an einer leeren Anzeige, als wäre die Komponente kaputt. Den MIME-Typ trägt der
      // Header.
      http.get(
        '/api/einsaetze/1/karte/hintergrundbilder/3/download',
        () =>
          new HttpResponse(new TextEncoder().encode('pixeldata'), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
      ),
    ]);
    renderSeite();
    // Blob-URL geladen → bilder-count an Kartenflaeche steigt auf 1.
    await waitFor(() => {
      expect(screen.getByTestId('bilder-count')).toHaveTextContent('1');
    });
  });

  it('Refetch mit weiterhin vorhandenem Bild: bestehende Blob-URL wird NICHT revoked, nur neue geladen; entferntes Bild wird revoked', async () => {
    // Der Cleanup des Blob-URL-Effekts läuft vor jedem Re-Run (jedem Refetch der Bilderliste). Ein
    // pauschales revoke machte aktive Bilder unbrauchbar. Belegt: ein Refetch, in dem A bleibt,
    // revoked A nicht — einer, in dem A fehlt, schon.
    const erstelle = vi.mocked(URL.createObjectURL as (b: Blob) => string);
    const revoke = vi.mocked(URL.revokeObjectURL as (u: string) => void);
    erstelle.mockReset();
    revoke.mockReset();
    // Distinkte URLs je Aufruf (A=erster, B=zweiter); der globale Stub liefert sonst für alle
    // denselben String.
    let n = 0;
    erstelle.mockImplementation(() => `blob:url-${++n}`);

    const bild = (id: number, name: string) => ({
      id,
      einsatz_id: 1,
      name,
      mime: 'image/png',
      groesse: 12345,
      ecken_json: JSON.stringify([
        [9.0, 50.0],
        [9.1, 50.0],
        [9.1, 49.9],
        [9.0, 49.9],
      ]),
      opazitaet: 80,
      sichtbar: true,
      reihenfolge: 1,
      hochgeladen_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    });
    const A = bild(3, 'a.png');
    const B = bild(4, 'b.png');

    let bilderListe = [A];
    basisHandler([
      http.get('/api/einsaetze/1/karte/hintergrundbilder', () => HttpResponse.json(bilderListe)),
      // Beide Downloads liefern Pixeldaten, die id steckt im Pfad. Kein `new Blob(...)` als Body
      // (siehe Smoke-Test).
      http.get(
        '/api/einsaetze/1/karte/hintergrundbilder/:bildId/download',
        () =>
          new HttpResponse(new TextEncoder().encode('pixeldata'), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
      ),
    ]);
    const { client, unmount } = renderSeite();

    // revoke läuft über Array.forEach(URL.revokeObjectURL) → der Mock zeichnet (index, array) mit
    // auf. Daher gegen das erste Argument prüfen.
    const wurdeRevoked = (url: string) => revoke.mock.calls.some((c) => c[0] === url);

    // 1) A geladen → genau ein createObjectURL-Aufruf (A's URL).
    await waitFor(() => expect(screen.getByTestId('bilder-count')).toHaveTextContent('1'));
    expect(erstelle).toHaveBeenCalledTimes(1);
    const urlVonA = 'blob:url-1';

    // 2) Refetch mit erweiterter Liste [A, B] (neue Array-Ref → Effekt läuft erneut, samt Cleanup).
    bilderListe = [A, B];
    await client.invalidateQueries({ queryKey: ['einsatz-kartenbilder', 1] });

    // B wird geladen → zwei Overlays.
    await waitFor(() => expect(screen.getByTestId('bilder-count')).toHaveTextContent('2'));
    // Diskriminierend: A's aktive URL darf beim Refetch nicht freigegeben worden sein.
    expect(revoke).not.toHaveBeenCalled();
    // A wurde nicht erneut geladen (Guard greift): genau A + B.
    expect(erstelle).toHaveBeenCalledTimes(2);

    // 3) Refetch mit entferntem A (nur noch B) → A's URL wird inkrementell revoked.
    bilderListe = [B];
    await client.invalidateQueries({ queryKey: ['einsatz-kartenbilder', 1] });
    await waitFor(() => expect(screen.getByTestId('bilder-count')).toHaveTextContent('1'));
    await waitFor(() => expect(wurdeRevoked(urlVonA)).toBe(true));
    // Kein weiterer Load durch das Entfernen.
    expect(erstelle).toHaveBeenCalledTimes(2);

    // 4) Unmount → der eigene Unmount-Effekt gibt die dann aktive URL (B = 'blob:url-2') frei.
    expect(wurdeRevoked('blob:url-2')).toBe(false);
    unmount();
    expect(wurdeRevoked('blob:url-2')).toBe(true);
  });
});

// --- Zwei-Phasen-Zeichnen (Overlay + Speicher-Bestätigung) ---

/** msw-POST-Handler für /zonen, der Aufrufe zählt und den letzten Body aufzeichnet. */
function erstelleZonenPostSpy() {
  let anzahl = 0;
  let letzterBody: { typ?: string; geometrie_typ?: string; geometrie?: string } | null = null;
  const handler = http.post('/api/einsaetze/1/zonen', async ({ request }) => {
    anzahl += 1;
    letzterBody = (await request.json()) as typeof letzterBody;
    return HttpResponse.json({
      id: 5,
      einsatz_id: 1,
      typ: letzterBody!.typ,
      geometrie_typ: letzterBody!.geometrie_typ,
      geometrie: letzterBody!.geometrie,
      label: null,
      farbe: null,
      notiz: null,
      erstellt_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    });
  });
  return { handler, count: () => anzahl, lastBody: () => letzterBody! };
}

describe('LagekartePage · bbox-Pfad für bbox-abhängige Ebenen (LFH-81)', () => {
  it('KRITIS aus, Energie an → der Ausschnitt wird gemeldet und die Ebene damit abgefragt', async () => {
    const angefragt: (string | null)[] = [];
    basisHandler([
      http.get('/api/karte/fachebenen/energie', ({ request }) => {
        angefragt.push(new URL(request.url).searchParams.get('bbox'));
        return HttpResponse.json({
          quelle: 'energie',
          status: 'ok',
          attribution: '© OpenStreetMap-Beitragende (ODbL)',
          features: { type: 'FeatureCollection', features: [] },
        });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    // Ohne sichtbare bbox-Ebene hört die Seite keinen Ausschnitt — die Karte spart sich die
    // Meldung.
    expect(await screen.findByTestId('bbox-callback')).toHaveTextContent('aus');

    // Das Fachebenen-Paneel startet eingeklappt — erst aufklappen, dann liegt der Schalter im Baum.
    await user.click(await screen.findByRole('button', { name: 'Fachebenen (extern)' }));
    await user.click(await screen.findByRole('switch', { name: 'Energieanlagen' }));

    // Die tragende Aussage: der Ausschnitt hängt nicht an KRITIS allein.
    await waitFor(() => expect(screen.getByTestId('bbox-callback')).toHaveTextContent('an'));
    await user.click(await screen.findByRole('button', { name: 'bbox-melden' }));
    // Gerastert wie bei KRITIS (0,05°-Gitter nach außen) — derselbe Schlüssel für benachbarte
    // Ausschnitte.
    await waitFor(() => expect(angefragt).toContain('7,51.5,7.15,51.6'));
  });
});

describe('LFH-145: Zeichnen-Abschluss + Bestätigung', () => {
  it('Zone zeichnen → Overlay „zeichnen" sichtbar', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    expect(await screen.findByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('nach Abschluss (Stub) → Phase „bestaetigen", noch NICHT persistiert', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument();
    expect(spy.count()).toBe(0);
  });

  it('Speichern → POST /zonen mit der Geometrie', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(spy.count()).toBe(1));
    expect(spy.lastBody().typ).toBe('gefahrengebiet');
  });

  it('Verwerfen → kein POST, Overlay weg', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(spy.count()).toBe(0);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument(),
    );
  });

  it('Abbrechen in Phase zeichnen → kein POST, Overlay weg', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    expect(spy.count()).toBe(0);
    await waitFor(() =>
      expect(screen.queryByText('Gefahrengebiet · Fläche')).not.toBeInTheDocument(),
    );
  });

  it('neuer Zeichenstart während offener Bestätigung räumt die alte Bestätigung weg (kein hängendes Overlay)', async () => {
    // Gefahrengebiet fertigzeichnen (→ Bestätigung), dann ohne Speichern/Verwerfen einen anderen
    // Zonentyp starten: die alte Bestätigung darf nicht hängen bleiben.
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Absperrgrenze zeichnen' }));
    // Zurück in Phase „zeichnen" für den neuen Entwurf, keine hängende Bestätigung.
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(await screen.findByText('Absperrgrenze · Linie')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(spy.count()).toBe(0);
  });
});

/** Schlanker Seitenkopf, die Karte führt, die rechte Leiste trägt Ebenen + Auswahl. */
describe('kopfMeta', () => {
  it('nennt verortete und — wenn es sie gibt — nicht verortete Objekte', () => {
    expect(kopfMeta(12, 0, false)).toBe('12 verortet');
    expect(kopfMeta(12, 3, false)).toBe('12 verortet · 3 nicht verortet');
  });

  it('behauptet im Fehlerfall keine Zahl', () => {
    expect(kopfMeta(0, 0, true)).toBe('— verortet');
  });
});

describe('LagekartePage · Neuentwurf S5', () => {
  it('trägt Titel und Mono-Meta im Seitenkopf', async () => {
    basisHandler();
    renderSeite();
    expect(await screen.findByRole('heading', { level: 1, name: 'Lagekarte' })).toBeInTheDocument();
    // Schaden 9 ist verortet, UHS 5 (BHP 50) nicht.
    const meta = document.querySelector('[data-lfh="seitenkopf-meta"]') as HTMLElement;
    await waitFor(() => expect(meta).toHaveTextContent('verortet · 1 nicht verortet'));
  });

  it('Marker-Klick füllt das Paneel „Ausgewählt" der Leiste, nicht eine Karte über der Karte', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-schaden-9'));
    const paneel = screen.getByRole('region', { name: 'Ausgewählt' });
    expect(
      await within(paneel).findByRole('link', { name: /Im Fachmodul öffnen/ }),
    ).toHaveAttribute('href', '/einsaetze/1/schaeden/9');
    // Schließen führt zurück zum Hinweis.
    await user.click(within(paneel).getByRole('button', { name: 'Schließen' }));
    expect(paneel).toHaveTextContent(/Nichts gewählt/);
  });

  it('der Zeichnen-Knopf über der Karte öffnet die Zeichenwerkzeuge der Leiste', async () => {
    localStorage.setItem('lfh:lagekarte:paneele', JSON.stringify({ zeichnen: false }));
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect(
      screen.queryByRole('button', { name: 'Gefahrengebiet zeichnen' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zeichenwerkzeuge' }));
    expect(
      await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }),
    ).toBeInTheDocument();
  });

  // Bei 390 px halbierte die offene Leiste die Karte, und der Fuß deckte den Rest — es blieb keine
  // Karte zum Tippen. Unter `lg` gibt die Werkzeugwahl die Karte deshalb frei. Als Paar: ab `lg`
  // steht die Leiste daneben und bleibt.
  it.each([
    { breite: 390, leisteBleibt: false },
    { breite: 1024, leisteBleibt: true },
  ])(
    'Werkzeugwahl bei $breite px: Leiste bleibt = $leisteBleibt',
    async ({ breite, leisteBleibt }) => {
      setzeViewportBreite(breite);
      basisHandler();
      const user = userEvent.setup();
      renderSeite();
      await screen.findByText('marker-schaden-9');
      await user.click(screen.getByRole('button', { name: 'Zeichenwerkzeuge' }));
      await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
      // Der Zeichenmodus läuft in beiden Fällen.
      expect(await screen.findByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
      if (leisteBleibt) {
        expect(screen.getByRole('button', { name: 'Gefahrengebiet zeichnen' })).toBeInTheDocument();
      } else {
        expect(
          screen.queryByRole('button', { name: 'Gefahrengebiet zeichnen' }),
        ).not.toBeInTheDocument();
        // Und sie lässt sich zurückholen — eigene Wahl, kein Sperrzustand.
        await user.click(screen.getByRole('button', { name: 'Leiste einblenden' }));
        expect(
          await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }),
        ).toBeInTheDocument();
      }
    },
  );

  it('hängt die Maßstabsleiste als Band in den Kartenfuß, nicht frei über die Karte', async () => {
    basisHandler();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    const band = document.querySelector('[data-lfh="massstab"]') as HTMLElement;
    // Geschwister im Fluss des Fußes — die Positionierung gehört dem Rahmen.
    expect(band.parentElement?.dataset.lfh).toBe('karten-fuss');
    expect(band.style.position).toBe('');
  });
});

/**
 * Ebene „Betroffene". Die Zugriffsgrenze sitzt an der Datenquelle, nicht am Schalter: eine geteilte
 * Ansicht mit eingeschalteter Ebene darf für jemanden ohne das Modul „Personen" nichts zeigen.
 * Deshalb Paare mit/ohne Zugriff bei derselben Ansicht.
 */
describe('LagekartePage · Ebene „Betroffene" (LFH-648)', () => {
  it('Bestandsansicht ohne Schalterwert: keine Personen-Marker, obwohl eine Person verortet ist', async () => {
    // Die Vorgabe „aus" (LAYER_DEFAULT.person = false) schließt Personen aus.
    basisHandler([
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([PERSON_VERORTET])),
    ]);
    renderSeite();
    // Warten, bis die übrigen Marker stehen — sonst wäre die Negativaussage trivial.
    expect(await screen.findByText('marker-schaden-9')).toBeInTheDocument();
    expect(screen.queryByText(/^marker-person-/)).not.toBeInTheDocument();
  });

  /** Dieselbe geteilte Ansicht in jedem Fall: „Betroffene" ist eingeschaltet. */
  const ANSICHT_BETROFFENE_AN = http.get('/api/einsaetze/1/karten-ansichten', () =>
    HttpResponse.json([
      {
        id: 1,
        einsatz_id: 1,
        name: 'Standard',
        reihenfolge: 0,
        ist_standard: true,
        layer_sichtbar: { person: true },
        erstellt_at: '',
        geaendert_at: '',
      },
    ]),
  );

  it('mit Zugriff: die eingeschaltete Ebene zeichnet die Person — ohne Namen', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([PERSON_VERORTET])),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-person-11')).toBeInTheDocument();
    expect(screen.queryByText(/Kowalski|Anna/)).not.toBeInTheDocument();
  });

  // Objektsuche: die Leiste bekommt `suchbareMarker`, nicht `alleVerortet` — das Paar belegt die
  // Verdrahtung samt Modulsperre an der Seite.
  it('mit Zugriff und eingeschalteter Ebene: die Objektsuche führt die Person (LFH-716)', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([PERSON_VERORTET])),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-person-11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^R-042 · / })).toBeInTheDocument();
  });

  it('403 trotz eingeschalteter Ebene: die Objektsuche führt keine Person (LFH-716)', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 403 })),
    ]);
    renderSeite();
    expect(await screen.findByText('Keine Berechtigung')).toBeInTheDocument();
    // Gegenprobe, dass die Suche gefüllt ist — sonst wäre die Abwesenheit trivial.
    expect(screen.getByText(/^Schaden \(\d+\)$/)).toBeInTheDocument();
    expect(screen.queryByText(/^R-042/)).not.toBeInTheDocument();
  });

  it('403 trotz eingeschalteter Ebene: kein Personen-Marker und KEIN Ausfallhinweis', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 403 })),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-schaden-9')).toBeInTheDocument();
    // Die Zeile kippt erst nach der Antwort auf „gesperrt" — sonst wäre die Negativaussage vor dem
    // 403 trivial.
    expect(await screen.findByText('Keine Berechtigung')).toBeInTheDocument();
    expect(screen.queryByText(/^marker-person-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('lagebild-unvollstaendig')).not.toBeInTheDocument();
  });

  it('Modul ausgeblendet trotz eingeschalteter Ebene: kein Marker, keine Zeile, kein Request', async () => {
    let anfragen = 0;
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/modul-overrides', () =>
        HttpResponse.json({ personen: { sichtbar: false, benoetigte_rolle: null } }),
      ),
      http.get('/api/einsaetze/1/personen', () => {
        anfragen += 1;
        return HttpResponse.json([PERSON_VERORTET]);
      }),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-schaden-9')).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Schäden' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Betroffene/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^marker-person-/)).not.toBeInTheDocument();
    expect(anfragen).toBe(0);
  });

  it('Benutzer ohne Zugriff speichert die geteilte Ansicht: „Betroffene" bleibt eingeschaltet', async () => {
    // Das Flag gehört der geteilten Ansicht. Würde es für Benutzer ohne Recht auf `false`
    // „bereinigt", überschriebe das Speichern die Wahl der Führungskraft.
    let body: Record<string, unknown> | null = null;
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 403 })),
      http.patch('/api/einsaetze/1/karten-ansichten/1', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1, einsatz_id: 1, name: 'Standard', ist_standard: true });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    // Vorbedingung: der Zugriff ist wirklich gesperrt, nicht bloß noch nicht geladen.
    expect(await screen.findByText('Keine Berechtigung')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Schäden' }));
    await user.click(await screen.findByRole('button', { name: /In dieser Ansicht speichern/ }));
    await waitFor(() => expect(body).not.toBeNull());
    const layer = body!.layer_sichtbar as Record<string, boolean>;
    expect(layer.schaden).toBe(false);
    expect(layer.person).toBe(true);
  });

  it('Ausfall der Personenliste (500): Hinweis nennt „Betroffene", Kopfzahl und Objektlisten bleiben', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 500 })),
    ]);
    renderSeite();
    const overlay = await screen.findByTestId('lagebild-unvollstaendig');
    expect(overlay).toHaveTextContent('Lagebild unvollständig: Betroffene');
    // Personen stehen weder in der Kopfzahl noch in „Nicht verortet" — ihr Ausfall darf dort keine
    // Zahl zu „—" machen.
    expect(screen.getByText('1 verortet · 1 nicht verortet')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Schäden' })).toHaveTextContent('Schäden1');
    expect(screen.getByRole('switch', { name: 'Betroffene' })).toHaveTextContent('Betroffene—');
    // Die Objektsuche führt Betroffene bei eingeschalteter Ebene — ohne ihre Liste ist sie
    // unvollständig und darf keine Zahl behaupten.
    expect(screen.getByText('Schaden (—)')).toBeInTheDocument();
  });

  it('ohne eingeschaltete Ebene macht ein Ausfall der Personenliste die Suche nicht unvollständig', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/personen', () => new HttpResponse(null, { status: 500 })),
    ]);
    renderSeite();
    expect(await screen.findByText('Schaden (1)')).toBeInTheDocument();
  });

  it('die Kopfzahl „verortet" zählt Betroffene nicht mit', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([PERSON_VERORTET])),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-person-11')).toBeInTheDocument();
    // Ein Schaden ist verortet, die UHS nicht — die Person darf die „1" nicht zur „2" machen.
    expect(screen.getByText('1 verortet · 1 nicht verortet')).toBeInTheDocument();
  });

  it('ein Klick auf den Personen-Marker füllt „Ausgewählt" mit Registriernummer und Sichtung', async () => {
    basisHandler([
      ANSICHT_BETROFFENE_AN,
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([PERSON_VERORTET])),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-person-11'));
    // Im Paneel „Ausgewählt" — dieselbe Beschriftung steht auch in der Objektsuche.
    const paneel = screen.getByRole('region', { name: 'Ausgewählt' });
    expect(await within(paneel).findByText('R-042 · SK II')).toBeInTheDocument();
    expect(screen.queryByText(/Kowalski|Anna/)).not.toBeInTheDocument();
    // Item-Route, nicht die Einsatzdaten des `default`-Zweigs.
    const link = await screen.findByRole('link', { name: /Im Fachmodul öffnen/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/11');
  });
});

/**
 * Korrigierbares Zeichnen (LFH-712). Der Stub meldet den Zeichenstand wie die echte Karte; „Letzten
 * Punkt zurück" und die erste Esc-Stufe laufen über den Karten-Handle.
 */
describe('LFH-712: Letzten Punkt zurück und zweistufiges Esc', () => {
  const quittungen = () =>
    Array.from(document.querySelectorAll('.ant-message')).filter((m) =>
      (m.textContent ?? '').includes('Zeichnung verworfen'),
    ).length;

  beforeEach(() => {
    kartenHandle.punktZurueck.mockClear();
    kartenHandle.zeichnungVerwerfen.mockClear();
  });

  it('Knopf und Zähler folgen dem gemeldeten Stand; der Klick geht an die Karte', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    const zurueck = await screen.findByRole('button', { name: 'Letzten Punkt zurück' });
    expect(zurueck).toBeDisabled();
    expect(screen.getByText('0 Punkte')).toBeInTheDocument();

    await user.click(screen.getByText('stand-3'));
    expect(zurueck).toBeEnabled();
    expect(screen.getByText('3 Punkte')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeEnabled();

    await user.click(zurueck);
    expect(kartenHandle.punktZurueck).toHaveBeenCalledTimes(1);
  });

  it('erstes Esc verwirft die Figur mit Quittung, der Modus bleibt; zweites Esc beendet', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('stand-3'));
    // Fokus auf einem Knopf der Steuerung, nicht auf der Karte: die Taste wirkt trotzdem.
    screen.getByRole('button', { name: 'Letzten Punkt zurück' }).focus();

    await user.keyboard('{Escape}');
    expect(kartenHandle.zeichnungVerwerfen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(quittungen()).toBe(1));
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();

    // Die Karte meldet den geleerten Stand zurück (wie `verwerfen()` im Adapter).
    await user.click(screen.getByText('stand-0'));
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Gefahrengebiet · Fläche')).not.toBeInTheDocument(),
    );
    // Die zweite Stufe verwirft nichts mehr — also auch keine zweite Quittung.
    expect(kartenHandle.zeichnungVerwerfen).toHaveBeenCalledTimes(1);
    expect(quittungen()).toBe(1);
    expect(spy.count()).toBe(0);
  });

  it('Esc in der Bestätigungsphase führt zurück ins Zeichnen, ohne zu speichern', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    await waitFor(() => expect(quittungen()).toBe(1));
    expect(spy.count()).toBe(0);
  });

  it('Esc bei offenem Menü schließt nur das Menü, die Figur bleibt (Review)', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('stand-3'));
    // Ein offenes antd-Menü schließt über einen eigenen window-keydown ohne preventDefault —
    // nachgestellt als sichtbares Dropdown im Portal.
    const menue = document.createElement('div');
    menue.className = 'ant-dropdown';
    document.body.appendChild(menue);
    screen.getByRole('button', { name: 'Letzten Punkt zurück' }).focus();
    await user.keyboard('{Escape}');
    menue.remove();
    expect(kartenHandle.zeichnungVerwerfen).not.toHaveBeenCalled();
    expect(screen.getByText('3 Punkte')).toBeInTheDocument();
  });

  it('eine gehaltene Esc-Taste läuft nicht durch beide Stufen', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('stand-3'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape', repeat: true });
    expect(kartenHandle.zeichnungVerwerfen).toHaveBeenCalledTimes(1);
    // Die Wiederholung beendet den Modus nicht.
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
  });

  it('Esc in einem Eingabefeld lässt die Figur stehen', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('stand-3'));
    const feld = document.createElement('input');
    document.body.appendChild(feld);
    feld.focus();
    await user.keyboard('{Escape}');
    feld.remove();
    expect(kartenHandle.zeichnungVerwerfen).not.toHaveBeenCalled();
    expect(screen.getByText('3 Punkte')).toBeInTheDocument();
  });

  it('Esc ohne Figur in einer Serie mit Gespeichertem beendet, die Zone bleibt gespeichert', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('1 gespeichert')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Gefahrengebiet · Fläche')).not.toBeInTheDocument(),
    );
    expect(spy.count()).toBe(1);
    expect(quittungen()).toBe(0);
  });
});

describe('LFH-712: Eigenposition', () => {
  const ursprung = {
    sicher: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
    geo: Object.getOwnPropertyDescriptor(navigator, 'geolocation'),
  };
  afterEach(() => {
    if (ursprung.sicher) Object.defineProperty(window, 'isSecureContext', ursprung.sicher);
    else delete (window as { isSecureContext?: boolean }).isSecureContext;
    if (ursprung.geo) Object.defineProperty(navigator, 'geolocation', ursprung.geo);
    else delete (navigator as { geolocation?: unknown }).geolocation;
  });

  it('erster Standort fliegt an, ein weiterer verschiebt die Karte nicht', async () => {
    let melde: ((p: GeolocationPosition) => void) | null = null;
    const watchPosition = vi.fn((ok: (p: GeolocationPosition) => void) => {
      melde = ok;
      return 1;
    });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition, clearWatch: vi.fn() },
    });
    const position = (lat: number, lon: number) =>
      ({ coords: { latitude: lat, longitude: lon, accuracy: 20 }, timestamp: 0 }) as never;

    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    const knopf = await screen.findByRole('button', { name: 'Eigenposition' });
    await user.click(knopf);
    expect(knopf).toHaveAttribute('aria-pressed', 'true');
    expect(watchPosition).toHaveBeenCalled();

    act(() => melde?.(position(52.1, 9.3)));
    await waitFor(() =>
      expect(screen.getByTestId('flyto')).toHaveTextContent('{"lng":9.3,"lat":52.1}'),
    );
    act(() => melde?.(position(52.2, 9.4)));
    expect(screen.getByTestId('flyto')).toHaveTextContent('{"lng":9.3,"lat":52.1}');
  });

  it('ohne sicheren Kontext gesperrt, der Grund steht am Knopf', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    basisHandler();
    renderSeite();
    const knopf = await screen.findByRole('button', { name: 'Eigenposition' });
    expect(knopf).toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById(knopf.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      /https/,
    );
  });
});
