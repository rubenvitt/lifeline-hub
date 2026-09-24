import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { server } from '../../test/server';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import type { Schaden } from '../../api/types';
import SchadenVorschau from './SchadenVorschau';

const schaden = (o: Partial<Schaden> = {}): Schaden =>
  ({
    id: 7,
    einsatz_id: 5,
    registrier_nr: 4,
    status: 'uebergeben',
    typ: 'verkehrshindernis',
    ausmass: 'gross',
    ort: 'L 235 km 12,5',
    beschreibung: 'Baum quer über der Fahrbahn',
    uebergeben_an: 'Straßenmeisterei',
    lat: null,
    lon: null,
    geschaedigt_kontakt: 'Herr Mustermann',
    ...o,
  }) as Schaden;

function liefereListe(liste: Schaden[]) {
  let abrufe = 0;
  server.use(
    http.get('/api/einsaetze/5/schaeden', () => {
      abrufe += 1;
      return HttpResponse.json(liste);
    }),
  );
  return () => abrufe;
}

describe('SchadenVorschau (LFH-664)', () => {
  it('zeigt Status mit Wort, Registriernummer und die Schadensdaten', async () => {
    liefereListe([schaden({ id: 3, registrier_nr: 1, ort: 'Anderswo' }), schaden()]);
    renderMitProviders(<SchadenVorschau einsatzId={5} id={7} />);

    expect(await screen.findByText('S-004')).toBeInTheDocument();
    expect(screen.getByText('übergeben')).toBeInTheDocument();
    const raster = screen.getByLabelText('Schadensdaten');
    expect(within(raster).getByText('Verkehrshindernis')).toBeInTheDocument();
    expect(within(raster).getByText('L 235 km 12,5')).toBeInTheDocument();
    expect(within(raster).getByText('Baum quer über der Fahrbahn')).toBeInTheDocument();
    expect(within(raster).getByText('Herr Mustermann')).toBeInTheDocument();
    expect(within(raster).getByText('Straßenmeisterei')).toBeInTheDocument();
    expect(within(raster).getByText('nicht verortet')).toBeInTheDocument();
    expect(screen.queryByText('Anderswo')).not.toBeInTheDocument();
  });

  it('liest nur: kein Verorten-Link, kein Knopf, kein Eingabefeld', async () => {
    liefereListe([schaden()]);
    renderMitProviders(<SchadenVorschau einsatzId={5} id={7} />);

    await screen.findByText('S-004');
    expect(screen.queryByRole('link', { name: /verorten/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('sagt, dass der Schaden nicht mehr vorhanden ist', async () => {
    liefereListe([schaden({ id: 3 })]);
    renderMitProviders(<SchadenVorschau einsatzId={5} id={7} />);

    expect(await screen.findByText('Der Schaden ist nicht mehr vorhanden.')).toBeInTheDocument();
  });

  /**
   * Warmes Fach → kein Abruf. Der Schaden trägt eine Koordinate: auf der Seite hinge daran die
   * Ort-Zeile mit eigenem Serverabruf. Die Vorschau lässt sie weg — ein Abruf dorthin liefe
   * hier ohne Handler in `onUnhandledRequest: 'error'` und färbte den Test rot.
   */
  it('liest den geladenen Stand ohne Abruf, auch mit Koordinate', async () => {
    const abrufe = liefereListe([]);
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.schaeden(5).queryKey, [
      schaden({ lat: 52.52, lon: 13.405 }),
    ]);
    renderMitProviders(<SchadenVorschau einsatzId={5} id={7} />, { client });

    expect(await screen.findByText('S-004')).toBeInTheDocument();
    expect(screen.queryByText('nicht verortet')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ort wird ermittelt/)).not.toBeInTheDocument();
    expect(abrufe()).toBe(0);
  });
});
