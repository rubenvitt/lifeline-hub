import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitenPage from './EinheitenPage';

const tmoSprechgruppe = {
  id: 7, einsatz_id: 1, einsatz_lokal: false, bezeichnung: '412_F_DRK',
  betriebsart: 'TMO' as const, hinweis: null, aktiv: true, sortier: 0,
};
const dmoSprechgruppe = {
  id: 8, einsatz_id: 1, einsatz_lokal: false, bezeichnung: 'DMO 31',
  betriebsart: 'DMO' as const, hinweis: null, aktiv: true, sortier: 1,
};

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};
const einheiten = [
  {
    id: 10, einsatz_id: 1, abschnitt_id: null, abschnitt_name: null, ueber_einheit_id: null,
    typ_id: 1, typ_label: 'Zug', name: '1. Zug', fuehrer_id: null, fuehrer_name: null, bemerkung: null, sortier: 0,
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 }, personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
    sprechgruppen: [tmoSprechgruppe],
  },
];

function handlers(rolle = 'einsatzleitung', status = 'aktiv', sprechgruppen: unknown[] = [tmoSprechgruppe, dmoSprechgruppe]) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einheit-typen', () => HttpResponse.json([{ id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 }])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json(sprechgruppen)),
  ];
}

describe('EinheitenPage', () => {
  it('zeigt den Einheiten-Baum mit Name und Soll/Ist', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    // Ist 1/0/2 (Σ3) und Soll 1/3/18 (Σ22) werden angezeigt (BOS-Doppelstrich vor Gesamt).
    expect(screen.getByText(/1\/0\/2\/\/3/)).toBeInTheDocument();
    expect(screen.getByText(/1\/3\/18\/\/22/)).toBeInTheDocument();
  });

  it('selektiert per ?einheit=<id> die Einheit (LFH-25 Inspector-Deeplink)', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten?einheit=10' },
    );
    expect(await screen.findByText('Einheit: 1. Zug')).toBeInTheDocument();
  });

  it('zeigt „Einheit bilden" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    expect(await screen.findByRole('button', { name: 'Einheit bilden' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await screen.findByText('1. Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Einheit bilden' })).not.toBeInTheDocument(),
    );
  });

  it('zeigt SprechgruppenPicker im Einheit-Formular', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    // Klick auf die Einheit im Baum öffnet das Formular
    await userEvent.click(await screen.findByText('1. Zug'));
    // Picker-Label ist sichtbar
    expect(await screen.findByText('Sprechgruppen')).toBeInTheDocument();
    // Die zugeordnete Sprechgruppe erscheint (als Picker-Tag und in der Funk-Zusammenfassung).
    expect((await screen.findAllByText('412_F_DRK')).length).toBeGreaterThanOrEqual(1);
  });

  // LFH-108: Funk-/Kommunikationsdaten auch an der Einheit pflegbar + sichtbar.
  it('zeigt und sendet Kommunikationsmittel + Erreichbarkeit der Einheit', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...einheiten[0], ...patchBody });
      }),
    );
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await userEvent.click(await screen.findByText('1. Zug'));

    await userEvent.type(await screen.findByLabelText('Erreichbarkeit / Nummer'), '0151 23456');
    await userEvent.click(screen.getByLabelText('Kommunikationsmittel'));
    await userEvent.click(await screen.findByText('Digitalfunk'));

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({ kommunikationsmittel: 'digitalfunk', erreichbarkeit: '0151 23456' });
  });

  it('sendet sprechgruppe_ids beim Speichern einer Einheit', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...einheiten[0], ...patchBody });
      }),
    );
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await userEvent.click(await screen.findByText('1. Zug'));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());

    // sprechgruppe_ids wird gesendet (vorbelegt mit tmoSprechgruppe.id=7)
    expect(patchBody).toHaveProperty('sprechgruppe_ids');
    expect((patchBody!['sprechgruppe_ids'] as number[])).toContain(7);
  });
});
