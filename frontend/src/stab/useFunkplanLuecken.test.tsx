import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import { abschnitt, LEER_SKIZZE } from '../test/fernmeldenetz';
import type { Einsatzabschnitt, ModulFreigaben } from '../api/types';
import { useFunkplanLuecken } from './useFunkplanLuecken';

function Probe() {
  const z = useFunkplanLuecken(7);
  return <p>{`${z.zustand}:${z.anzahl ?? '—'}`}</p>;
}

/** Zählt die Abrufe der Quellen, die dem Fernmeldewesen selbst gehören. */
function setup(freigaben: ModulFreigaben, abschnitte: Einsatzabschnitt[] = []) {
  const abrufe = { fernmeldewesen: 0 };
  server.use(
    http.get('/api/einsaetze/7/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json(abschnitte)),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/sprechgruppen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/stab/kommunikationsplan', () => {
      abrufe.fernmeldewesen += 1;
      return HttpResponse.json([]);
    }),
    http.get('/api/einsaetze/7/stab/fernmeldeskizze', () => {
      abrufe.fernmeldewesen += 1;
      return HttpResponse.json(LEER_SKIZZE);
    }),
    http.get('/api/einsaetze/7/stab', () => HttpResponse.json({ besetzung: [] })),
  );
  renderMitProviders(<Probe />);
  return abrufe;
}

/**
 * Die Lückenzahl für das Werkzeug „Funkplan“ der Stab-Seite (LLH-1124, design.md D5): dieselben
 * Quellen wie Funkplan und Skizzen-Anlage, dieselbe Rechnung wie der Kopf des Lücken-Paneels.
 */
describe('useFunkplanLuecken', () => {
  it('zählt wie das Lücken-Paneel: ohne Leitstelle eine Lücke, jeder Abschnitt ohne Sprechgruppe eine weitere', async () => {
    setup(freigabenFixture(), [abschnitt(1, { sprechgruppen: [] })]);
    expect(await screen.findByText('daten:2')).toBeInTheDocument();
  });

  it('Fernmeldewesen gesperrt: keine Zahl und kein Abruf seiner Quellen', async () => {
    const abrufe = setup(freigabenFixture({ fernmeldewesen: { zugriff: false } }));
    expect(await screen.findByText('gesperrt:—')).toBeInTheDocument();
    expect(abrufe.fernmeldewesen).toBe(0);
  });

  it('eine gesperrte Liste ergibt keine Teilsumme', async () => {
    setup(freigabenFixture({ einheiten: { zugriff: false } }));
    expect(await screen.findByText('gesperrt:—')).toBeInTheDocument();
  });
});
