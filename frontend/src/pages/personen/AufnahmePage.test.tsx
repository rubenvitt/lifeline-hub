import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { AuthProvider } from '../../auth/AuthContext';
import AufnahmePage from './AufnahmePage';

/**
 * Die Vollseiten-Aufnahme (LFH-340 · C5).
 *
 * Sie zeigt dieselbe Feldgruppe wie das Schnellerfassungs-Modal — was diese Datei prüft, ist
 * deshalb nicht die Maske (das tut `personen/AufnahmeFelder.test.tsx`), sondern was nur hier
 * gilt: die Route existiert, sie erfasst in Serie ohne den Ort zu verlassen, und die
 * Quittung bleibt stehen.
 */
class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  sessionStorage.clear();
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

function render(einsatzObj: typeof einsatzAktiv = einsatzAktiv, extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
  );
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<div>PERSONENLISTE</div>} />
        <Route path="/einsaetze/:id/personen/aufnahme" element={<AufnahmePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/personen/aufnahme' },
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
