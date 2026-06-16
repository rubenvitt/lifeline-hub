import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import Grundriss from './Grundriss';
import type { Person, UhsDetail, UhsPlatz } from '../../api/types';

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
  });

  it('zeigt einen unbelegten Platz NICHT als belegt', async () => {
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    expect(await screen.findByText('Bett 1')).toBeInTheDocument();
    expect(screen.queryByText('belegt')).not.toBeInTheDocument();
  });
});
