import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinsatzabschnittePage from './EinsatzabschnittePage';

const tmoSprechgruppe = {
  id: 7, einsatz_id: 1, einsatz_lokal: false, bezeichnung: '412_F_DRK',
  betriebsart: 'TMO' as const, hinweis: null, aktiv: true, sortier: 0,
};
const dmoSprechgruppe = {
  id: 8, einsatz_id: 1, einsatz_lokal: false, bezeichnung: 'DMO 31',
  betriebsart: 'DMO' as const, hinweis: null, aktiv: true, sortier: 1,
};

/** Abschnitt mit gefüllten Funk-Feldern für Vorbelegungs-/Anzeige-Tests. */
const funkAbschnitt = {
  id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord',
  leiter_id: null, leiter_name: null, bemerkung: null,
  flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
  sprechgruppe_tmo: '412_F_DRK', sprechgruppe_dmo: null,
  kommunikationsmittel: 'digitalfunk', erreichbarkeit: '0151 23456', sortier: 0,
  sprechgruppen: [tmoSprechgruppe],
};

function renderPage() {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
    </Routes>,
    { route: '/einsaetze/1/einsatzabschnitte' },
  );
}

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};

function handlers(
  rolle = 'einsatzleitung',
  status = 'aktiv',
  abschnitte: unknown[] = [
    { id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: null, leiter_name: 'Leiter Nord', bemerkung: null, sortier: 0 },
  ],
  sprechgruppen: unknown[] = [tmoSprechgruppe, dmoSprechgruppe],
) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json(abschnitte)),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json(sprechgruppen)),
  ];
}

describe('EinsatzabschnittePage', () => {
  it('zeigt den Abschnitts-Baum mit Leiter', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    expect(await screen.findByText('Nord')).toBeInTheDocument();
    expect(screen.getByText(/Leiter Nord/)).toBeInTheDocument();
  });

  it('selektiert per ?abschnitt=<id> den Abschnitt (LFH-25 Inspector-Deeplink)', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte?abschnitt=5' },
    );
    expect(await screen.findByText('Abschnitt: Nord')).toBeInTheDocument();
  });

  it('zeigt „Abschnitt anlegen" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    expect(await screen.findByRole('button', { name: 'Abschnitt anlegen' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    await screen.findByText('Nord');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Abschnitt anlegen' })).not.toBeInTheDocument(),
    );
  });

  it('zeigt SprechgruppenPicker im Edit-Formular statt Freitext-Inputs', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Alte Freitext-Inputs sind weg
    expect(screen.queryByLabelText('Sprechgruppe TMO')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sprechgruppe DMO')).not.toBeInTheDocument();
    // Erreichbarkeit-Feld ist im Edit-Modus da und vorbelegt
    expect(await screen.findByDisplayValue('0151 23456')).toBeInTheDocument();
    // Picker-Label ist sichtbar
    expect(await screen.findByText('Sprechgruppen')).toBeInTheDocument();
    // Die zugeordnete Sprechgruppe erscheint als ausgewähltes Tag im Multi-Select
    expect(await screen.findByText('412_F_DRK')).toBeInTheDocument();
  });

  it('zeigt eine Funk-Erreichbarkeits-Zusammenfassung im Detail', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [{ ...funkAbschnitt, erreichbarkeit: null }]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    const zusammenfassung = await screen.findByTestId('funk-erreichbarkeit');
    expect(zusammenfassung).toHaveTextContent('412_F_DRK');
    expect(zusammenfassung).toHaveTextContent(/Digitalfunk/i);
  });

  it('sendet sprechgruppe_ids beim Speichern, nicht mehr tmo/dmo-Freitextfelder', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [{ ...funkAbschnitt, kommunikationsmittel: null, erreichbarkeit: null }]),
      http.patch('/api/einsaetze/1/abschnitte/5', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...funkAbschnitt, ...patchBody });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    // Erreichbarkeit mit Whitespace befüllen (→ null), Kommunikationsmittel via Select
    await userEvent.type(await screen.findByLabelText('Erreichbarkeit / Nummer'), '   ');
    await userEvent.click(screen.getByLabelText('Kommunikationsmittel'));
    await userEvent.click(await screen.findByText('Mobil'));

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());

    // Kein sprechgruppe_tmo / _dmo mehr im Payload
    expect(patchBody).not.toHaveProperty('sprechgruppe_tmo');
    expect(patchBody).not.toHaveProperty('sprechgruppe_dmo');
    // sprechgruppe_ids wird gesendet (vorbelegt mit tmoSprechgruppe.id=7)
    expect(patchBody).toHaveProperty('sprechgruppe_ids');
    expect((patchBody!['sprechgruppe_ids'] as number[])).toContain(7);
    // Kommunikationsmittel und getrimmte Erreichbarkeit bleiben
    expect(patchBody).toMatchObject({
      kommunikationsmittel: 'mobil',
      erreichbarkeit: null,
    });
  });

  // LFH-107: „Überblick zuerst" — Detailbereich ist Lese-Ansicht, Bearbeiten ist ein eigener Modus.
  it('zeigt beim Öffnen die Lese-Ansicht (Kerninfos) ohne Formular-Inputs', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    // Kerninfos als Überblick sichtbar
    expect(await screen.findByText('Abschnittsleiter')).toBeInTheDocument();
    expect(await screen.findByTestId('funk-erreichbarkeit')).toBeInTheDocument();
    // Keine Eingabefelder in der Lese-Ansicht
    expect(screen.queryByLabelText('Erreichbarkeit / Nummer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
  });

  it('öffnet die Eingabefelder erst nach Klick auf Bearbeiten', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByLabelText('Erreichbarkeit / Nummer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });

  it('Nur-Lese-Nutzer sehen weder Bearbeiten-Button noch Inputs, aber die Funk-Zusammenfassung', async () => {
    server.use(...handlers('beobachter', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    expect(await screen.findByTestId('funk-erreichbarkeit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Erreichbarkeit / Nummer')).not.toBeInTheDocument();
  });

  it('zeigt die Funk-Daten nicht doppelt (Zusammenfassung nur in der Lese-Ansicht)', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    // Lese-Ansicht: genau eine Funk-Zusammenfassung
    expect(screen.getAllByTestId('funk-erreichbarkeit')).toHaveLength(1);
    // Edit-Modus: keine Zusammenfassung mehr (nur Inputs)
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(screen.queryByTestId('funk-erreichbarkeit')).not.toBeInTheDocument();
  });
});
