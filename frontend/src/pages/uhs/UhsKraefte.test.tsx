import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { UhsDetail, UhsKraft } from '../../api/types';
import UhsKraefte from './UhsKraefte';

/**
 * Kräfte der UHS (LFH-1045, Spec `uhs-staerke`): Stärke und Qualifikationen aus den zugeordneten
 * Kräften, Abziehen ohne Rückfrage, „Einheit zuordnen“ nur für die Einsatzleitung.
 */

const anna: UhsKraft = {
  id: 11,
  name: 'Anna Arzt',
  funktion: 'Notarzt',
  staerke_position: 'fuehrer',
  einheit_id: 3,
  einheit: 'SEG 1',
  ist_adhoc: false,
};
const bernd: UhsKraft = {
  id: 12,
  name: 'Bernd Berg',
  funktion: 'Sanitäter',
  staerke_position: 'mannschaft',
  ist_adhoc: true,
};
const frei: UhsKraft = {
  id: 13,
  name: 'Clara Frei',
  einheit_id: 3,
  einheit: 'SEG 1',
  ist_adhoc: false,
};

function uhs(over: Partial<UhsDetail> = {}): UhsDetail {
  return {
    id: 2,
    einsatz_id: 1,
    abschnitt_id: null,
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
    standort: null,
    notiz: null,
    lat: null,
    lon: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    staerke: { fuehrer: 1, unterfuehrer: 0, mannschaft: 1 },
    kraefte: [anna, bernd],
    plaetze: [],
    belegungen: [],
    material: [],
    ...over,
  };
}

function mitFreien(liste: UhsKraft[] = [frei]) {
  server.use(http.get('/api/einsaetze/1/uhs/2/kraefte/verfuegbar', () => HttpResponse.json(liste)));
}

describe('UhsKraefte', () => {
  it('zeigt Stärke, Qualifikationen und die Kräfte', async () => {
    mitFreien();
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen />,
    );
    expect(screen.getByTestId('uhs-staerke')).toHaveTextContent('1/0/1//2');
    expect(screen.getByText('Notarzt 1')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter 1')).toBeInTheDocument();
    const zeile = screen.getByRole('row', { name: /Anna Arzt/ });
    expect(within(zeile).getByText('SEG 1')).toBeInTheDocument();
    // Freigegeben, sobald die Kräfte ohne UHS eine Einheit tragen.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Einheit zuordnen' })).toBeEnabled(),
    );
  });

  it('Abziehen löst die Kraft ohne Rückfrage', async () => {
    mitFreien();
    let geloest: string | null = null;
    server.use(
      http.delete('/api/einsaetze/1/uhs/2/kraefte/:kid', ({ params }) => {
        geloest = String(params.kid);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen={false} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bernd Berg abziehen' }));
    await waitFor(() => expect(geloest).toBe('12'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('der Laptop ordnet keine Einheit zu; ohne freie Kraft ist „Kraft zuordnen“ gesperrt', async () => {
    mitFreien([]);
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen={false} />,
    );
    expect(await screen.findByText('Keine Kraft ohne UHS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kraft zuordnen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Einheit zuordnen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kraft erfassen' })).toBeEnabled();
  });

  it('an einer aufgelösten UHS gibt es keine Bedienung', () => {
    renderMitProviders(
      <UhsKraefte
        einsatzId={1}
        uhs={uhs({
          status: 'aufgeloest',
          kraefte: [],
          staerke: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
        })}
        schreibgeschuetzt={false}
        einheitZuordnen
      />,
    );
    expect(screen.getByTestId('uhs-staerke')).toHaveTextContent('0/0/0//0');
    expect(screen.queryByRole('button', { name: 'Kraft zuordnen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /abziehen/ })).toBeNull();
  });
});
