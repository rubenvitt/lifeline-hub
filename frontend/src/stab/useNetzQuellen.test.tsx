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
      <li>besetzung: {q.besetzung.zustand}</li>
    </ul>
  );
}

/** Zählt die Abrufe der Stab-Anzeige; die Besetzung hat ihre eigene Weiche (design.md D8). */
function setup(freigaben: ModulFreigaben) {
  const stabAbrufe = { anzahl: 0 };
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
    http.get('/api/einsaetze/7/stab', () => {
      stabAbrufe.anzahl += 1;
      return HttpResponse.json({ besetzung: [] });
    }),
  );
  renderMitProviders(<Probe />);
  return stabAbrufe;
}

/**
 * Die Quellen des Fernmeldenetzes hängen an der Freigabe des Fernmeldewesens (LLH-1180); nur die
 * Stab-Besetzung fragt zusätzlich den Stab.
 */
describe('useNetzQuellen', () => {
  it('Stab ausgeblendet: Stellen und Skizze laden, die Besetzung ist gesperrt, kein Abruf am Stab', async () => {
    const stabAbrufe = setup(freigabenFixture({ stab: { sichtbar: false, zugriff: false } }));
    expect(await screen.findByText('stellen: daten')).toBeInTheDocument();
    expect(await screen.findByText('skizze: daten')).toBeInTheDocument();
    expect(screen.getByText('besetzung: gesperrt')).toBeInTheDocument();
    expect(stabAbrufe.anzahl).toBe(0);
  });

  it('Fernmeldewesen gesperrt: keine Quelle des Moduls lädt', async () => {
    setup(freigabenFixture({ fernmeldewesen: { zugriff: false } }));
    expect(await screen.findByText('stellen: gesperrt')).toBeInTheDocument();
    expect(screen.getByText('skizze: gesperrt')).toBeInTheDocument();
    expect(screen.getByText('besetzung: gesperrt')).toBeInTheDocument();
  });

  it('beide frei: auch die Besetzung lädt', async () => {
    const stabAbrufe = setup(freigabenFixture());
    expect(await screen.findByText('besetzung: daten')).toBeInTheDocument();
    expect(stabAbrufe.anzahl).toBe(1);
  });
});
