import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import Grundriss from './Grundriss';
import type { Person, UhsBelegung, UhsDetail, UhsPlatz } from '../../api/types';

function person(over: Partial<Person>): Person {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 42, status: 'betroffen', name: null, vorname: null,
    geschlecht: null, geburtsdatum: null, alter_geschaetzt: null, herkunft_adresse: null,
    antreff_ort: null, melder_kontakt: null, notiz: null, erfasst_at: 'x', erfasst_von: 1,
    geaendert_at: 'x', geaendert_von: 1, storniert_at: null, aktuelle_sichtung: null,
    aktuelle_sichtung_at: null, aktueller_verbleib: null, aktuelle_uhs_id: null,
    aktueller_platz_id: null, ...over,
  };
}

function platz(over: Partial<UhsPlatz>): UhsPlatz {
  return {
    id: 10, uhs_id: 1, typ: 'bett', bezeichnung: 'Bett 1', pos_x: 10, pos_y: 10,
    verfuegbarkeit: 'frei', reserviert_fuer_person_id: null, storniert_at: null, ...over,
  };
}

function uhsDetail(over: Partial<UhsDetail>): UhsDetail {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz', bezeichnung: 'BHP 50',
    standort: null, notiz: null, lat: null, lon: null, status: 'aktiv',
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
    plaetze: [], belegungen: [], material: [], ...over,
  };
}

function renderGrundriss(uhs: UhsDetail, personen: Person[], schreibgeschuetzt = false) {
  server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
      </AntApp>
    </QueryClientProvider>
  );
}

describe('Grundriss – Belegt-Anzeige (LFH-18)', () => {
  it('zeigt einen Platz als belegt, sobald eine Person darauf zugewiesen ist', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);
    // Person-Tag bestätigt, dass die Belegung geladen ist …
    expect(await screen.findByText(/R-007|R-7|· unbekannt/)).toBeInTheDocument();
    // … und der Platz muss als belegt gekennzeichnet sein (nicht nur als „frei").
    expect(screen.getByText('belegt')).toBeInTheDocument();
    // Orthogonalität (E-3): der Verfügbarkeits-Tag bleibt DANEBEN bestehen —
    // „belegt" ersetzt ihn nicht (es gibt keinen Verfügbarkeitswert „belegt").
    expect(screen.getByText('frei')).toBeInTheDocument();
  });

  it('zeigt einen unbelegten Platz NICHT als belegt', async () => {
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    expect(await screen.findByText('Bett 1')).toBeInTheDocument();
    expect(screen.queryByText('belegt')).not.toBeInTheDocument();
  });
});

describe('Grundriss – Zurückweisen (LFH-17)', () => {
  it('weist eine belegte Person per Button als Austritt zurück', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    let body: { art?: string } | null = null;
    server.use(
      http.post('/api/einsaetze/1/personen/7/uhs-belegung', async ({ request }) => {
        body = (await request.json()) as { art?: string };
        return HttpResponse.json({
          id: 1, einsatz_id: 1, person_id: 7, uhs_id: 1, platz_id: null,
          art: 'austritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
        });
      }),
    );
    renderGrundriss(uhs, [p]);
    const btn = await screen.findByRole('button', { name: 'zurückweisen' });
    await userEvent.click(btn);
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.art).toBe('austritt');
  });

  it('zeigt keinen Zurückweisen-Button für unbelegte Plätze', async () => {
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    await screen.findByText('Bett 1');
    expect(screen.queryByRole('button', { name: 'zurückweisen' })).not.toBeInTheDocument();
  });
});

describe('Grundriss – Plätze nach Typ anlegen (LFH-16)', () => {
  it('legt über Typ + Menge mehrere Plätze an (Bulk, ohne Namensvergabe)', async () => {
    const uhs = uhsDetail({ plaetze: [], status: 'geplant' });
    let body: { typ?: string; menge?: number } | null = null;
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/bulk', async ({ request }) => {
        body = (await request.json()) as { typ?: string; menge?: number };
        return HttpResponse.json([]);
      }),
    );
    renderGrundriss(uhs, []);
    await userEvent.click(screen.getByRole('button', { name: 'Plätze anlegen' }));
    const menge = await screen.findByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ typ: 'bett', menge: 3 });
  });

  it('überträgt den im Select gewählten Typ', async () => {
    const uhs = uhsDetail({ plaetze: [], status: 'geplant' });
    let body: { typ?: string; menge?: number } | null = null;
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/bulk', async ({ request }) => {
        body = (await request.json()) as { typ?: string; menge?: number };
        return HttpResponse.json([]);
      }),
    );
    renderGrundriss(uhs, []);
    await userEvent.click(screen.getByRole('button', { name: 'Plätze anlegen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Platz-Typ' }));
    await userEvent.click(await screen.findByText('Intensivplatz'));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.typ).toBe('intensivplatz');
  });
});

describe('Grundriss – Spalten-Fluss (LFH-58)', () => {
  it('zeigt aus DIESER UHS abtransportierte Personen in der rechten Spalte', async () => {
    const p = person({ id: 9, registrier_nr: 9, aktuelle_uhs_id: null, aktueller_verbleib: 'Transport → KH Mitte' });
    const austritt: UhsBelegung = {
      id: 1, einsatz_id: 1, person_id: 9, uhs_id: 1, platz_id: null,
      art: 'austritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
    };
    const uhs = uhsDetail({ belegungen: [austritt] });
    renderGrundriss(uhs, [p]);
    expect(await screen.findByText('Auf Transport gebracht')).toBeInTheDocument();
    expect(await screen.findByText('Transport → KH Mitte')).toBeInTheDocument();
    // Auto-Austritt leert aktuelle_uhs_id → die Person darf NICHT zusätzlich links
    // unter „Noch nicht aufgenommen" auftauchen (sonst Doppelanzeige).
    expect(screen.getAllByText(/R-009/)).toHaveLength(1);
  });

  it('zeigt noch nicht aufgenommene Personen in der linken Spalte', async () => {
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    renderGrundriss(uhsDetail({}), [p]);
    expect(await screen.findByText('Noch nicht aufgenommen')).toBeInTheDocument();
    expect(await screen.findByText(/R-005|· unbekannt/)).toBeInTheDocument();
  });
});

describe('Grundriss – Platz-Aktion kontextabhängig (LFH-58)', () => {
  it('versteckt „Plätze anlegen" bei aktiver UHS hinter „Plätze bearbeiten"', async () => {
    renderGrundriss(uhsDetail({ status: 'aktiv' }), []);
    // Aktiv: Anlegen ist NICHT sofort sichtbar, nur der sekundäre Bearbeiten-Umschalter.
    const toggle = await screen.findByRole('button', { name: 'Plätze bearbeiten' });
    expect(screen.queryByRole('button', { name: 'Plätze anlegen' })).not.toBeInTheDocument();
    // Nach Klick erscheint die Anlegen-Aktion.
    await userEvent.click(toggle);
    expect(await screen.findByRole('button', { name: 'Plätze anlegen' })).toBeInTheDocument();
  });
});

describe('Grundriss – Read-only (schreibgeschuetzt)', () => {
  it('blendet Schreibaktionen aus, wenn schreibgeschuetzt', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p], true);
    // belegter Platz ist sichtbar …
    expect(await screen.findByText('belegt')).toBeInTheDocument();
    // … aber keine Schreibaktionen.
    expect(screen.queryByRole('button', { name: 'zurückweisen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plätze anlegen' })).not.toBeInTheDocument();
  });
});
