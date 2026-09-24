import { screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { server } from '../../test/server';
import { datensatzAbfrage } from '../../command-palette/datensatzAbfrage';
import type { GefahrBewertung, Gefahrengebiet } from '../../api/types';
import GefahrengebietVorschau from './GefahrengebietVorschau';

const gebiet = (o: Partial<Gefahrengebiet> = {}): Gefahrengebiet =>
  ({
    id: 3,
    einsatz_id: 5,
    label: 'Chemiepark Süd',
    hoechste_warnstufe: 'hoch',
    zonen_ids: [21, 22],
    ...o,
  }) as Gefahrengebiet;

const matrix: GefahrBewertung[] = [
  {
    id: 1,
    gefahrengebiet_id: 3,
    gefahrentyp: 'brand',
    schutzobjekt: 'menschen',
    warnstufe: 'hoch',
  } as GefahrBewertung,
];

function liefere(
  gebiete: Gefahrengebiet[],
  matrixAntwort: () => Response | Promise<Response> = () => HttpResponse.json(matrix),
) {
  let abrufe = 0;
  server.use(
    http.get('/api/einsaetze/5/gefahrengebiete', () => {
      abrufe += 1;
      return HttpResponse.json(gebiete);
    }),
    http.get('/api/einsaetze/5/gefahrengebiete/3/matrix', matrixAntwort),
  );
  return () => abrufe;
}

describe('GefahrengebietVorschau (LFH-664)', () => {
  it('zeigt höchste Warnstufe mit Wort, Zonenzahl und den Matrixauszug', async () => {
    liefere([gebiet({ id: 4, label: 'Anderes' }), gebiet()]);
    renderMitProviders(<GefahrengebietVorschau einsatzId={5} id={3} />);

    expect(await screen.findByText('hoch')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Brand × Menschen: hoch' })).toHaveTextContent(
      'H',
    );
    // Der Name ist schon Kopf der Palette.
    expect(screen.queryByText('Chemiepark Süd')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  /**
   * „keine" heißt „keine Stufe gesetzt", nicht „unbewertet": das Backend rechnet die höchste
   * Stufe über ein Severity-MAX, in dem `keine` und gar keine Bewertung denselben Rang haben
   * (CLAUDE.md, LFH-357). Ein Wort, das die beiden Fälle trennt, behauptete zu viel.
   */
  it('nennt „keine" als „keine Stufe gesetzt", ohne „unbewertet" zu behaupten', async () => {
    liefere([gebiet({ hoechste_warnstufe: 'keine' })], () => HttpResponse.json([]));
    renderMitProviders(<GefahrengebietVorschau einsatzId={5} id={3} />);

    expect(await screen.findByText('keine Stufe gesetzt')).toBeInTheDocument();
    expect(screen.queryByText(/unbewertet/)).not.toBeInTheDocument();
    expect(await screen.findByText('Keine Gefahren bewertet.')).toBeInTheDocument();
  });

  it('zeigt das Gebiet, während die Matrix noch lädt', async () => {
    liefere([gebiet()], async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    });
    renderMitProviders(<GefahrengebietVorschau einsatzId={5} id={3} />);

    expect(await screen.findByText('hoch')).toBeInTheDocument();
    expect(screen.getByLabelText('Die Gefahrenmatrix wird geladen')).toBeInTheDocument();
  });

  it('verdeckt das Gebiet nicht, wenn die Matrix scheitert', async () => {
    liefere([gebiet()], () => new HttpResponse(null, { status: 500 }));
    renderMitProviders(<GefahrengebietVorschau einsatzId={5} id={3} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Gefahrenmatrix konnte nicht geladen werden',
    );
    expect(screen.getByText('hoch')).toBeInTheDocument();
  });

  it('sagt, dass das Gefahrengebiet nicht mehr vorhanden ist', async () => {
    liefere([gebiet({ id: 4 })]);
    renderMitProviders(<GefahrengebietVorschau einsatzId={5} id={3} />);

    expect(
      await screen.findByText('Das Gefahrengebiet ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
  });

  /** Die Matrix ist die benannte Ausnahme der Spec (die Trefferliste trägt sie nicht). */
  it('liest das geladene Gebiet ohne Abruf der Gebietsliste', async () => {
    const abrufe = liefere([]);
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.gefahrengebiete(5).queryKey, [gebiet()]);
    renderMitProviders(<GefahrengebietVorschau einsatzId={5} id={3} />, { client });

    expect(await screen.findByRole('cell', { name: 'Brand × Menschen: hoch' })).toBeInTheDocument();
    expect(abrufe()).toBe(0);
  });
});
