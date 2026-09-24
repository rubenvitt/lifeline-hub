import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { Uhs } from '../../api/types';
import UhsVorschau from './UhsVorschau';

const uhs = (o: Partial<Uhs> = {}): Uhs =>
  ({
    id: 4,
    einsatz_id: 5,
    bezeichnung: 'UHS Sporthalle',
    typ: 'behandlungsplatz',
    status: 'aktiv',
    standort: 'Sporthalle Nord, Eingang B',
    notiz: 'Zufahrt über Schulhof',
    lat: 52.5,
    lon: 13.4,
    erfasst_at: '2026-09-24 08:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-09-24 08:00:00',
    geaendert_von: 1,
    ...o,
  }) as Uhs;

function liefere(liste: Uhs[]) {
  server.use(http.get('/api/einsaetze/5/uhs', () => HttpResponse.json(liste)));
}

describe('UhsVorschau (LFH-664)', () => {
  it('zeigt Bezeichnung, Typ, Status mit Wort, Standort, Notiz und Verortung', async () => {
    liefere([uhs({ id: 3, bezeichnung: 'UHS Nachbar' }), uhs()]);
    renderMitProviders(<UhsVorschau einsatzId={5} id={4} />);

    expect(await screen.findByText('UHS Sporthalle')).toBeInTheDocument();
    expect(screen.getByText('Behandlungsplatz')).toBeInTheDocument();
    expect(screen.getByText('aktiv')).toBeInTheDocument();
    expect(screen.getByText('Sporthalle Nord, Eingang B')).toBeInTheDocument();
    expect(screen.getByText('Zufahrt über Schulhof')).toBeInTheDocument();
    // Die Koordinate steht da; ihr Format kommt aus den Anzeige-Konventionen.
    expect(screen.getByText(/52[.,]5/)).toBeInTheDocument();
    expect(screen.queryByText('nicht verortet')).not.toBeInTheDocument();
    expect(screen.queryByText('storniert')).not.toBeInTheDocument();
    expect(screen.queryByText('UHS Nachbar')).not.toBeInTheDocument();
  });

  it('sagt „nicht verortet" als Text, ohne Verweis auf die Karte', async () => {
    liefere([uhs({ lat: null, lon: null })]);
    renderMitProviders(<UhsVorschau einsatzId={5} id={4} />);
    expect(await screen.findByText('nicht verortet')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('kennzeichnet eine stornierte UHS', async () => {
    liefere([uhs({ storniert_at: '2026-09-24 09:00:00' })]);
    renderMitProviders(<UhsVorschau einsatzId={5} id={4} />);
    expect(await screen.findByText('storniert')).toBeInTheDocument();
  });

  it('sagt, dass die Unfallhilfsstelle nicht mehr vorhanden ist', async () => {
    liefere([uhs({ id: 3 })]);
    renderMitProviders(<UhsVorschau einsatzId={5} id={4} />);
    expect(
      await screen.findByText('Die Unfallhilfsstelle ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
  });

  it('liest nur: kein Knopf, kein Auswahlfeld', async () => {
    liefere([uhs()]);
    renderMitProviders(<UhsVorschau einsatzId={5} id={4} />);
    await screen.findByText('UHS Sporthalle');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
