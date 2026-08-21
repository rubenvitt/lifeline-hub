import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { AuthProvider } from '../../auth/AuthContext';
import { aenderePersonBelegung } from '../../api/einsatzUhs';
import AufnahmePage from './AufnahmePage';

/**
 * Die Vollseiten-Aufnahme (LFH-340 · C5).
 *
 * Sie zeigt dieselbe Feldgruppe wie das Schnellerfassungs-Modal — was diese Datei prüft, ist
 * deshalb nicht die Maske (das tut `personen/AufnahmeFelder.test.tsx`), sondern was nur hier
 * gilt: die Route existiert, sie erfasst in Serie ohne den Ort zu verlassen, und die
 * Quittung bleibt stehen.
 *
 * **Der UHS-Auftrag (LFH-341 · C6)** hängt am Query-Param `?uhs=<id>` und bucht nach dem
 * Anlegen den Eintritt in den Wartebereich. Die Person-Anlage selbst bleibt über MSW real
 * (wie im restlichen File) — nur `aenderePersonBelegung` wird zum Mock, sonst bräuchte jeder
 * Bestandstest hier einen Belegungs-Endpunkt, den H38 gar nicht anfasst. Gleiche Bauform wie
 * `GrundrissTabs.test.tsx`.
 */
vi.mock('../../api/einsatzUhs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzUhs')>();
  return { ...echt, aenderePersonBelegung: vi.fn() };
});

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  sessionStorage.clear();
  vi.mocked(aenderePersonBelegung).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const angelegt = {
  id: 10, einsatz_id: 1, registrier_nr: 47, status: 'betroffen',
  name: null, vorname: null, geschlecht: null, geburtsdatum: null, alter_geschaetzt: null,
  herkunft_adresse: null, antreff_ort: 'Sammelstelle', melder_kontakt: null, notiz: null,
  aktuelle_sichtung: 'sk2', aktuelle_sichtung_at: '2026-05-27 09:05:00',
  erfasst_at: '2026-05-27 09:05:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:05:00', geaendert_von: 1, storniert_at: null,
};

/** Macht den aktuellen Pfad+Query im DOM sichtbar (Muster aus `UhsDetailPage.test.tsx`s
 *  `LocationProbe`) — die Marker-Route unten matcht JEDE `:uhsId`, „kehrt zur beauftragenden
 *  UHS zurück" bliebe also grün, wenn `onFertig` auf die FALSCHE UHS navigierte. Nur die
 *  Adresse selbst ist die belastbare Zusicherung. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pfad">{loc.pathname}{loc.search}</span>;
}

function aktuellerPfad() {
  return screen.getByTestId('pfad').textContent;
}

function render(
  einsatzObj: typeof einsatzAktiv = einsatzAktiv,
  extra: Parameters<typeof server.use> = [],
  route = '/einsaetze/1/personen/aufnahme',
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
  );
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <AuthProvider>
      <LocationProbe />
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<div>PERSONENLISTE</div>} />
        <Route path="/einsaetze/:id/personen/aufnahme" element={<AufnahmePage />} />
        {/* Rückweg des UHS-Auftrags (LFH-341 · C6) — Marker statt echter UhsDetailPage,
            dieselbe Bauform wie „PERSONENLISTE" oben. */}
        <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<div>UHS-DETAIL</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

/** Erste Auswahlfläche der Sichtung anklicken (Wrapper, nicht das ausgeblendete `input`). */
async function waehleSk(index: number) {
  const flaeche = within(screen.getByRole('radiogroup')).getAllByRole('radio')[index];
  await userEvent.click(flaeche.closest('label')!);
}

describe('AufnahmePage', () => {
  it('trägt den Modulkopf und die Feldgruppe der Aufnahme', async () => {
    render();
    expect(await screen.findByRole('heading', { level: 4, name: /Aufnahme/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    // Der Breadcrumb trägt den Rückweg in die Liste — deshalb gibt es keinen Zurück-Knopf.
    expect(screen.getByRole('link', { name: 'Personen' })).toHaveAttribute(
      'href', '/einsaetze/1/personen',
    );
  });

  it('erfasst in Serie, ohne die Seite zu verlassen', async () => {
    let gesendet: { sichtung?: string } = {};
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        gesendet = (await request.json()) as { sichtung?: string };
        return HttpResponse.json(angelegt, { status: 201 });
      }),
    ]);
    await screen.findByRole('radiogroup');

    await waehleSk(1);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    expect(await screen.findByText('Erfasst als R-047 · SK II')).toBeInTheDocument();
    expect(gesendet.sichtung).toBe('sk2');
    // DER ORT BLEIBT: das ist der Unterschied zum Primär-Knopf, und ohne diese Zeile wäre
    // der Fall auch grün, wenn die Seite in die Liste gesprungen wäre.
    expect(screen.queryByText('PERSONENLISTE')).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('leert die Felder nach dem Serien-Speichern und setzt den Fokus zurück', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(angelegt, { status: 201 })),
    ]);
    await screen.findByRole('radiogroup');

    await waehleSk(1);
    const gewaehlt = within(screen.getByRole('radiogroup')).getAllByRole('radio')[1];
    expect(gewaehlt).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await screen.findByText(/Erfasst als R-047/);

    await waitFor(() =>
      expect(within(screen.getByRole('radiogroup')).getAllByRole('radio')[1]).not.toBeChecked());
    const flaechen = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    await waitFor(() => expect(document.activeElement).toBe(flaechen[0]));
  });

  it('geht nach dem Primär-Knopf zurück in die Liste', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(angelegt, { status: 201 })),
    ]);
    await screen.findByRole('radiogroup');

    await waehleSk(0);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('PERSONENLISTE')).toBeInTheDocument();
  });

  /**
   * Der sitzungsweite Antreffort gilt an BEIDEN Mounts (im Review gefunden, LFH-340 · C5).
   * `uebernahme={['antreff_ort']}` deckt nur innerhalb eines Laufs ab — wer die Route
   * verlässt und zurückkommt, fand das Feld vorher leer, während derselbe Weg über das
   * Modal vorbelegt hätte. Ausgerechnet hier, wo der Serienbetrieb der Normalfall ist.
   *
   * Beide Richtungen, weil eine allein nichts belegt: Schreiben ohne Lesen wäre unsichtbar,
   * Lesen ohne Schreiben käme nie an einen Wert.
   */
  it('merkt den Antreffort für die Sitzung und setzt ihn beim Wiederkommen ein', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(angelegt, { status: 201 })),
    ]);
    await screen.findByRole('radiogroup', { name: 'Sichtungskategorie' });

    await userEvent.type(screen.getByLabelText('Antreffort'), 'Sammelstelle Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await screen.findByText(/Erfasst als R-047/);
    expect(sessionStorage.getItem('lfh:erfassung:1:person:antreff_ort')).toBe('Sammelstelle Süd');

    // Die Seite frisch betreten — wie nach einem Abstecher in die Liste.
    cleanup();
    render(einsatzAktiv);
    await waitFor(() =>
      expect(screen.getByLabelText('Antreffort')).toHaveValue('Sammelstelle Süd'));
  });

  it('zeigt Beobachtern den Hinweis statt der Maske', async () => {
    render(einsatzBeobachter);
    expect(await screen.findByText(/Keine Schreibberechtigung/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});

describe('AufnahmePage — UHS-Auftrag (LFH-341 · C6, Befund H38)', () => {
  it('zeigt im Breadcrumb den Weg zur beauftragenden UHS statt zu Personen', async () => {
    // Brief wörtlich: „Die Seitenbeschreibung UND der Breadcrumb sollen den Auftrag
    // zeigen, sonst weiß niemand, wohin der Patient läuft." Der UHS-NAME wird hier bewusst
    // nicht geprüft (die Seite lädt ihn nicht extra) — die Rückverlinkung selbst ist die
    // Zusicherung.
    render(einsatzAktiv, [], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');

    expect(screen.getByRole('link', { name: 'Unfallhilfsstelle' })).toHaveAttribute(
      'href', '/einsaetze/1/unfallhilfsstellen/7',
    );
    expect(screen.queryByRole('link', { name: 'Personen' })).not.toBeInTheDocument();
  });

  it('bucht nach dem Anlegen den Eintritt in den Wartebereich der beauftragten UHS', async () => {
    const patient = { ...angelegt, id: 42, registrier_nr: 3 };
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(patient, { status: 201 })),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');

    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(aenderePersonBelegung).toHaveBeenCalledWith(1, 42, {
      art: 'eintritt', uhs_id: 7, platz_id: null,
    }));
  });

  it('bucht ohne UHS-Auftrag gar keine Belegung', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(angelegt, { status: 201 })),
    ]);
    await screen.findByRole('radiogroup');

    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    // Der Primär-Knopf navigiert nach dem Speichern zurück in die Liste — die Quittung
    // selbst ist danach nicht mehr im Baum (Muster aus dem Bestandstest oben, „geht nach
    // dem Primär-Knopf zurück in die Liste"). Der belastbare Beleg ist der Mock.
    await screen.findByText('PERSONENLISTE');
    expect(aenderePersonBelegung).not.toHaveBeenCalled();
  });

  it('sagt es, wenn die Zuordnung offline nicht gebucht werden konnte', async () => {
    // Ohne Person-ID gibt es keine Belegung. Eine still ausgefallene Zuordnung
    // waere eine Person, die an der UHS niemand sucht.
    //
    // ÜBER DEN PRIMÄR-KNOPF, nicht „Speichern und nächste": genau hier lag ein gemessener
    // Defekt. `onFertig` navigiert nach dem Primär-Knopf sofort zur UHS — die stehende
    // `<Alert>`-Quittung hängt dabei aus dem Baum, bevor sie ein Frame lang sichtbar war
    // (roter Lauf vor dem Fix: `findByText(/von Hand erfolgen/)` fand nichts, das DOM
    // zeigte bereits das Navigationsziel). Der Fix ist ein zweiter Kanal (`message.warning`,
    // überlebt die Navigation, weil er am `App`-Kontext hängt statt am Baum dieser Seite) —
    // dieser Test bleibt deshalb auf dem Primär-Knopf, sonst prüft er den Fix nicht.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(einsatzAktiv, [], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');

    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    // „muss von Hand erfolgen", NICHT „folgt": die Queue schiebt keine Belegung nach.
    // Ein Test auf /folgt/ waere auch mit dem falschen Versprechen gruen.
    expect(await screen.findByText(/von Hand erfolgen/)).toBeInTheDocument();
    expect(aenderePersonBelegung).not.toHaveBeenCalled();
    // Beleg, dass die Meldung wirklich die Navigation überlebt hat und nicht bloß VOR ihr
    // gefasst wurde: die Seite ist tatsächlich weitergezogen.
    await waitFor(() => expect(aktuellerPfad()).toBe('/einsaetze/1/unfallhilfsstellen/7'));
  });

  it('sagt es, wenn die Zuordnung zur Unfallhilfsstelle fehlschlägt', async () => {
    // Die Person IST angelegt — nur der zweite Schritt (Belegung) scheitert. Das darf die
    // Quittung nicht verschweigen (Auftrag Auflösung 7).
    const patient = { ...angelegt, id: 42, registrier_nr: 3 };
    vi.mocked(aenderePersonBelegung).mockRejectedValueOnce(new Error('Netzwerkfehler'));
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(patient, { status: 201 })),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');

    // „Speichern und nächste" hält die Seite offen — die Aussage dieses Tests ist der
    // Quittungszusatz, nicht der Rückweg (den prüfen die beiden Tests daneben).
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    expect(
      await screen.findByText(/R-003.*Zuordnung zur Unfallhilfsstelle fehlgeschlagen/),
    ).toBeInTheDocument();
    // Der Fehler wird zusätzlich gemeldet — und zwar MIT der Registriernummer. Bis zum
    // Abschluss-Review stand hier nur `fehlerText(e)`, also „Aktion fehlgeschlagen"; auf
    // dem Primär-Knopf ist das der einzige überlebende Text (Test darunter), und er sagt
    // nicht, dass die Person angelegt wurde.
    expect(await screen.findByText(
      'Erfasst als R-003 — die Zuordnung zur Unfallhilfsstelle ist fehlgeschlagen '
      + '(Aktion fehlgeschlagen). Bitte von Hand zuordnen.',
    )).toBeInTheDocument();
  });

  it('sagt auch über den Primär-Knopf hinweg, dass die Person trotz Fehler angelegt ist', async () => {
    // DER GEFÄHRLICHERE ZWEIG, und bis zum Abschluss-Review der ungeprüfte. Der Test
    // darüber nimmt „Speichern und nächste", weil dort die Seite hält — auf dem
    // PRIMÄR-Knopf löst `mutateAsync` erst nach dem `async onSuccess` auf, die Hülle ruft
    // `onFertig()` und navigiert zur UHS. Die stehende `<Alert>`-Quittung hängt dabei mit
    // der Seite aus; sichtbar bliebe allein der Toast. Trüge der nur `fehlerText(e)`, läse
    // der Bediener „Aktion fehlgeschlagen", fände den Patienten nicht im Wartebereich und
    // erfasste ihn erneut — zwei Registriernummern für einen Patienten.
    const patient = { ...angelegt, id: 42, registrier_nr: 3 };
    vi.mocked(aenderePersonBelegung).mockRejectedValueOnce(new Error('Netzwerkfehler'));
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(patient, { status: 201 })),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');

    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    // Erst der Beleg, dass die Seite WIRKLICH weitergezogen ist — sonst prüfte die Zeile
    // darunter womöglich noch die Quittung auf der alten Seite (Bauform aus dem
    // Offline-Test daneben).
    await waitFor(() => expect(aktuellerPfad()).toBe('/einsaetze/1/unfallhilfsstellen/7'));
    // Die Registriernummer überlebt die Navigation, weil `message` am `App`-Kontext hängt.
    expect(await screen.findByText(/Erfasst als R-003 —/)).toBeInTheDocument();
    // Und die Quittung, die es NICHT tut, ist wirklich weg — sonst wäre der zweite Kanal
    // gar nicht nötig gewesen und dieser Test bewiese nichts.
    expect(screen.queryByText(/R-003.*Zuordnung zur Unfallhilfsstelle fehlgeschlagen/)).not.toBeInTheDocument();
  });

  it('kehrt mit „Erfassen" zur beauftragenden UHS zurück, nicht in die Personenliste', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json(angelegt, { status: 201 })),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');

    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('UHS-DETAIL')).toBeInTheDocument();
    // Nicht nur „irgendeine" UHS-Route (die Marker-Route matcht jede `:uhsId`) — genau die
    // beauftragende.
    expect(aktuellerPfad()).toBe('/einsaetze/1/unfallhilfsstellen/7');
  });
});
