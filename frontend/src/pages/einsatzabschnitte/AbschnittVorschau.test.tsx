import { act, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { server } from '../../test/server';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import type { Einheit, Einsatzabschnitt } from '../../api/types';
import AbschnittVorschau from './AbschnittVorschau';

const abschnitt = (o: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt =>
  ({
    id: 5,
    einsatz_id: 5,
    ueber_abschnitt_id: null,
    name: 'Nord',
    kurzbezeichnung: 'EA N',
    leiter_id: 9,
    leiter_name: 'Carla Christ',
    lagezustand: 'kritisch',
    abschnittsauftrag: 'Deich an der Mühle halten',
    fortschritt: 40,
    bemerkung: 'Zufahrt nur über Norden',
    sprechgruppen: [],
    kommunikationsmittel: null,
    erreichbarkeit: null,
    sortier: 0,
    ...o,
  }) as Einsatzabschnitt;

const einheit = (id: number, abschnittId: number, ist: Einheit['ist']): Einheit =>
  ({
    id,
    einsatz_id: 5,
    name: `Einheit ${id}`,
    abschnitt_id: abschnittId,
    ist,
    ist_kumuliert: ist,
  }) as Einheit;

/** Nord (5) mit Unterabschnitt Süd (6): eigene 1/2/3, inkl. Süd 1/3/4. */
const baum = [abschnitt(), abschnitt({ id: 6, name: 'Süd', ueber_abschnitt_id: 5 })];
const einheiten = [
  einheit(1, 5, { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 }),
  einheit(2, 6, { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 }),
];

function liefere(
  abschnitte: Einsatzabschnitt[],
  einheitenAntwort: () => Response | Promise<Response>,
) {
  let abrufe = 0;
  server.use(
    http.get('/api/einsaetze/5/abschnitte', () => {
      abrufe += 1;
      return HttpResponse.json(abschnitte);
    }),
    http.get('/api/einsaetze/5/einheiten', einheitenAntwort),
  );
  return () => abrufe;
}

const feldwert = (label: string) =>
  screen.getByText(label).closest('[data-lfh="datenfeld"]')!.querySelector('dd')!;

describe('AbschnittVorschau (LFH-664)', () => {
  it('zeigt die Angaben des Abschnitts samt Lagezustand mit Wort', async () => {
    liefere(baum, () => HttpResponse.json(einheiten));
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />);

    expect(await screen.findByText('Carla Christ')).toBeInTheDocument();
    expect(screen.getByText('EA N')).toBeInTheDocument();
    expect(screen.getByText('kritisch')).toBeInTheDocument();
    expect(screen.getByText('Deich an der Mühle halten')).toBeInTheDocument();
    expect(screen.getByText('40 %')).toBeInTheDocument();
    expect(screen.getByText('keine Funk-Angaben')).toBeInTheDocument();
    expect(screen.getByText('Zufahrt nur über Norden')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('rechnet die Stärke wie die Seite: eigene und inkl. Unterabschnitte', async () => {
    liefere(baum, () => HttpResponse.json(einheiten));
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />);

    expect(await screen.findByText('1/2/3//6')).toBeInTheDocument();
    expect(feldwert('Stärke (F/UF/M//Σ)')).toHaveTextContent('1/2/3//6');
    expect(feldwert('Stärke inkl. Unterabschnitte (F/UF/M//Σ)')).toHaveTextContent('1/3/4//8');
  });

  it('nennt eine fehlende Beurteilung und Einschätzung als Wort', async () => {
    liefere([abschnitt({ lagezustand: null, fortschritt: null })], () =>
      HttpResponse.json(einheiten),
    );
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />);

    expect(await screen.findByText('nicht beurteilt')).toBeInTheDocument();
    expect(screen.getByText('nicht eingeschätzt')).toBeInTheDocument();
  });

  it('zeigt den Abschnitt, während die Einheiten noch laden', async () => {
    liefere(baum, async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    });
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />);

    expect(await screen.findByText('Carla Christ')).toBeInTheDocument();
    expect(feldwert('Stärke (F/UF/M//Σ)')).toHaveTextContent('wird geladen …');
  });

  it('verdeckt den Abschnitt nicht, wenn die Einheiten scheitern', async () => {
    liefere(baum, () => new HttpResponse(null, { status: 500 }));
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />);

    expect(await screen.findByText('Carla Christ')).toBeInTheDocument();
    expect(await screen.findAllByText('nicht abrufbar')).toHaveLength(2);
    expect(feldwert('Stärke (F/UF/M//Σ)')).not.toHaveTextContent('—');
  });

  it('sagt, dass ein aufgelöster Abschnitt nicht mehr vorhanden ist', async () => {
    liefere([abschnitt({ id: 6, name: 'Süd' })], () => HttpResponse.json(einheiten));
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />);

    expect(
      await screen.findByText('Der Einsatzabschnitt ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
  });

  it('meldet einen Abschnitt, der bei offener Vorschau aufgelöst wird', async () => {
    liefere([], () => HttpResponse.json(einheiten));
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.abschnitte(5).queryKey, baum);
    client.setQueryData(datensatzAbfrage.einheiten(5).queryKey, einheiten);
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />, { client });
    expect(await screen.findByText('Carla Christ')).toBeInTheDocument();

    // Live-Invalidierung nach dem Auflösen: die Liste kommt ohne den Abschnitt zurück.
    act(() => {
      client.setQueryData(datensatzAbfrage.abschnitte(5).queryKey, [baum[1]]);
    });

    expect(
      await screen.findByText('Der Einsatzabschnitt ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Carla Christ')).not.toBeInTheDocument();
  });

  it('liest den geladenen Abschnittsstand ohne Abruf', async () => {
    const abrufe = liefere([], () => HttpResponse.json(einheiten));
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.abschnitte(5).queryKey, baum);
    client.setQueryData(datensatzAbfrage.einheiten(5).queryKey, einheiten);
    renderMitProviders(<AbschnittVorschau einsatzId={5} id={5} />, { client });

    expect(await screen.findByText('1/3/4//8')).toBeInTheDocument();
    expect(abrufe()).toBe(0);
  });
});
