import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import { AuthProvider } from '../../auth/AuthContext';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../../offline/queue';
import AufnahmePage from './AufnahmePage';

/**
 * Die Vollseiten-Aufnahme (LFH-340 · C5).
 *
 * Sie zeigt dieselbe Feldgruppe wie das Schnellerfassungs-Modal — was diese Datei prüft, ist
 * deshalb nicht die Maske (das tut `personen/AufnahmeFelder.test.tsx`), sondern was nur hier
 * gilt: die Route existiert, sie erfasst in Serie ohne den Ort zu verlassen, und die
 * Quittung bleibt stehen.
 *
 * LFH-458: Der UHS-Auftrag geht im Anlege-Request mit. Alle Schreibrequests
 * werden über MSW gezählt, einschließlich versehentlicher Folge-Requests.
 */
const schreibrequests: string[] = [];
function merkeRequest({ request }: { request: Request }) {
  if (request.method === 'POST') schreibrequests.push(new URL(request.url).pathname);
}

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(async () => {
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  sessionStorage.clear();
  schreibrequests.length = 0;
  server.events.on('request:start', merkeRequest);
  await queueLeerenFuerTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  server.events.removeListener('request:start', merkeRequest);
});

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

  it('erfasst Person und UHS-Eintritt mit genau einem Schreibrequest', async () => {
    let daten: Record<string, unknown> = {};
    const { client } = render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        daten = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...angelegt, aktuelle_uhs_id: 7, aktueller_platz_id: null }, { status: 201 });
      }),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    // Der Test-Provider entsorgt unbeobachtete Queries sonst sofort (gcTime: 0).
    client.setQueryDefaults(einsatzKeys.uhs(1), { gcTime: Infinity });
    client.setQueryDefaults(einsatzKeys.uhsDetail(1, 7), { gcTime: Infinity });
    client.setQueryData(einsatzKeys.uhs(1), []);
    client.setQueryData(einsatzKeys.uhsDetail(1, 7), {});
    await screen.findByRole('radiogroup');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    expect(await screen.findByText('Erfasst als R-047 · SK II · im Wartebereich')).toBeInTheDocument();
    expect(client.getQueryState(einsatzKeys.uhs(1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(einsatzKeys.uhsDetail(1, 7))?.isInvalidated).toBe(true);
    expect(daten).toMatchObject({ uhs_id: 7, client_id: expect.any(String) });
    expect(schreibrequests).toEqual(['/api/einsaetze/1/personen']);
  });

  it.each(['', '?uhs=kaputt'])('sendet ohne gültigen UHS-Auftrag kein uhs_id (%s)', async (query) => {
    let daten: Record<string, unknown> = {};
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', async ({ request }) => {
        daten = await request.json() as Record<string, unknown>;
        return HttpResponse.json(angelegt, { status: 201 });
      }),
    ], `/einsaetze/1/personen/aufnahme${query}`);
    await screen.findByRole('radiogroup');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await screen.findByText('PERSONENLISTE');
    expect(daten).not.toHaveProperty('uhs_id');
    expect(schreibrequests).toEqual(['/api/einsaetze/1/personen']);
  });

  it.each(['Erfassen', 'Speichern und nächste'])('merkt die UHS offline ohne Handarbeitsvorbehalt vor: %s', async (aktion) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(einsatzAktiv, [], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');
    await userEvent.click(screen.getByRole('button', { name: aktion }));
    if (aktion === 'Erfassen') {
      await waitFor(() => expect(aktuellerPfad()).toBe('/einsaetze/1/unfallhilfsstellen/7'));
    } else {
      expect(await screen.findByText('Offline vorgemerkt — Registriernummer folgt nach der Übertragung.')).toBeInTheDocument();
    }
    const queue = await schreibaktionenLaden(1, 1);
    expect(queue).toHaveLength(1);
    expect(queue[0].aktion).toMatchObject({ art: 'person', daten: { uhs_id: 7, client_id: expect.any(String) } });
    expect(screen.queryByText(/von Hand|Zuordnung.*fehlgeschlagen/)).not.toBeInTheDocument();
    expect(schreibrequests).toEqual([]);
  });

  it('bleibt bei einem abgelehnten UHS-Eintritt ohne Erfolgsquittung im Formular', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json({ error: 'UHS ist nicht aktiv' }, { status: 422 })),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('UHS ist nicht aktiv')).toBeInTheDocument();
    expect(aktuellerPfad()).toBe('/einsaetze/1/personen/aufnahme?uhs=7');
    expect(screen.queryByText(/Erfasst als/)).not.toBeInTheDocument();
    expect(await schreibaktionenLaden(1, 1)).toHaveLength(0);
    expect(schreibrequests).toEqual(['/api/einsaetze/1/personen']);
  });

  it('liest den Wartebereich aus der Antwort, auch beim Replay nach einem Austritt', async () => {
    render(einsatzAktiv, [
      http.post('/api/einsaetze/1/personen', () => HttpResponse.json({ ...angelegt, aktuelle_uhs_id: null, aktueller_platz_id: null }, { status: 201 })),
    ], '/einsaetze/1/personen/aufnahme?uhs=7');
    await screen.findByRole('radiogroup');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    expect(await screen.findByText('Erfasst als R-047 · SK II')).toBeInTheDocument();
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
