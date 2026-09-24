import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EinsatzPersonal } from '../api/types';
import PersonalVorschau from './PersonalVorschau';

const person = (o: Partial<EinsatzPersonal> = {}): EinsatzPersonal =>
  ({
    id: 11,
    einsatz_id: 5,
    name: 'Erika Mustermann',
    ist_adhoc: false,
    disponiert_at: '2026-09-24 08:00:00',
    funktion: 'Gruppenführerin',
    traegerorganisation: 'DRK',
    staerke_position: 'unterfuehrer',
    bemerkung: 'Atemschutz-tauglich',
    status_label: 'im Einsatz',
    status_kategorie: 'gebunden',
    status_farbe: null,
    ...o,
  }) as EinsatzPersonal;

function liefere(liste: EinsatzPersonal[]) {
  server.use(http.get('/api/einsaetze/5/personal', () => HttpResponse.json(liste)));
}

describe('PersonalVorschau (LFH-664)', () => {
  it('zeigt Name, Status mit Wort, Funktion, Träger, Stärkeposition und Bemerkung', async () => {
    liefere([person({ id: 10, name: 'Max Nachbar' }), person()]);
    renderMitProviders(<PersonalVorschau einsatzId={5} id={11} />);

    expect(await screen.findByText('Erika Mustermann')).toBeInTheDocument();
    expect(screen.getByText('im Einsatz')).toBeInTheDocument();
    expect(screen.getByText('Gruppenführerin')).toBeInTheDocument();
    expect(screen.getByText('DRK')).toBeInTheDocument();
    expect(screen.getByText('Unterführer')).toBeInTheDocument();
    expect(screen.getByText('Atemschutz-tauglich')).toBeInTheDocument();
    expect(screen.queryByText('Max Nachbar')).not.toBeInTheDocument();
  });

  it('sagt „kein Status", wenn die Kraft keinen Status trägt', async () => {
    liefere([person({ status_label: null, status_kategorie: null })]);
    renderMitProviders(<PersonalVorschau einsatzId={5} id={11} />);
    expect(await screen.findByText('kein Status')).toBeInTheDocument();
  });

  it('sagt, dass die Einsatzkraft nicht mehr vorhanden ist', async () => {
    liefere([person({ id: 10 })]);
    renderMitProviders(<PersonalVorschau einsatzId={5} id={11} />);
    expect(
      await screen.findByText('Die Einsatzkraft ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
  });

  it('liest nur: keine Statuswahl, kein Knopf, kein Auswahlfeld', async () => {
    liefere([person()]);
    renderMitProviders(<PersonalVorschau einsatzId={5} id={11} />);
    await screen.findByText('Erika Mustermann');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
