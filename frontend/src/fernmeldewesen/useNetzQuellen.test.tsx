import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { ModulFreigaben } from '../api/types';
import { useModulFreigabe } from '../einsatz/useModulFreigabe';
import { useNetzQuellen } from './useNetzQuellen';

function Probe() {
  const freigabe = useModulFreigabe(7, 'fernmeldewesen');
  const q = useNetzQuellen(7, freigabe, false);
  return (
    <ul>
      <li>stellen: {q.stellen.zustand}</li>
      <li>skizze: {q.skizze.zustand}</li>
      <li>mitglieder: {q.mitglieder.zustand}</li>
    </ul>
  );
}

/** Zählt die Abrufe der Mitglieder (i6k6mzed, D7). */
function setup(freigaben: ModulFreigaben) {
  const abrufe = { mitglieder: 0 };
  server.use(
    http.get('/api/einsaetze/7/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/sprechgruppen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/stab/kommunikationsplan', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/stab/fernmeldeskizze', () =>
      HttpResponse.json({
        lage: [],
        komponenten: [],
        verbindungen: [],
        bereiche: [],
        schriftfeld: {
          herausgeber: null,
          vs_vermerk: 'keiner',
          gueltig_ab: null,
          gez_name: null,
          gez_at: null,
        },
        stand: null,
      }),
    ),
    http.get('/api/einsaetze/7/mitglieder', () => {
      abrufe.mitglieder += 1;
      return HttpResponse.json([]);
    }),
  );
  renderMitProviders(<Probe />);
  return abrufe;
}

/**
 * Die Quellen des Fernmeldenetzes hängen an der Freigabe des Fernmeldewesens (LLH-1180). Die
 * Mitglieder fragt die Skizze ohne eigenes Modulrecht ab (i6k6mzed, D7).
 */
describe('useNetzQuellen', () => {
  it('Fernmeldewesen frei: Stellen, Skizze und Mitglieder laden', async () => {
    const abrufe = setup(freigabenFixture());
    expect(await screen.findByText('stellen: daten')).toBeInTheDocument();
    expect(await screen.findByText('skizze: daten')).toBeInTheDocument();
    expect(await screen.findByText('mitglieder: daten')).toBeInTheDocument();
    expect(abrufe.mitglieder).toBeGreaterThan(0);
  });

  it('Fernmeldewesen gesperrt: keine Quelle des Moduls lädt', async () => {
    const abrufe = setup(freigabenFixture({ fernmeldewesen: { zugriff: false } }));
    expect(await screen.findByText('stellen: gesperrt')).toBeInTheDocument();
    expect(screen.getByText('skizze: gesperrt')).toBeInTheDocument();
    expect(screen.getByText('mitglieder: gesperrt')).toBeInTheDocument();
    expect(abrufe.mitglieder).toBe(0);
  });

  it('frei: die Mitglieder laden genau einmal', async () => {
    const abrufe = setup(freigabenFixture());
    expect(await screen.findByText('mitglieder: daten')).toBeInTheDocument();
    expect(abrufe.mitglieder).toBe(1);
  });
});
