import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
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

describe('UhsKraefte · Speicherfehler am Ort (LFH-1077)', () => {
  const toasts = () => document.querySelectorAll('.ant-message-notice').length;
  /** Der zuletzt geöffnete Dialog: rc-dialog friert schließende Dialoge in jsdom ein. */
  const dialog = async () => {
    await screen.findAllByRole('dialog');
    return screen.getAllByRole('dialog').pop()!;
  };

  it('Kraft erfassen: der Grund steht im Dialog, das nächste Absenden räumt ihn, Abbrechen und Öffnen zeigen ihn nicht', async () => {
    mitFreien();
    let versuche = 0;
    let frei: () => void = () => {};
    const zweiter = new Promise<void>((r) => (frei = r));
    server.use(
      http.post('/api/einsaetze/1/uhs/2/kraefte', async () => {
        versuche += 1;
        if (versuche > 1) await zweiter;
        return HttpResponse.json({ error: 'Name bereits an der UHS' }, { status: 409 });
      }),
    );
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen={false} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Kraft erfassen' }));
    const d = await dialog();
    await userEvent.type(within(d).getByRole('textbox', { name: 'Name' }), 'Dora Dienst');
    await userEvent.click(within(d).getByRole('button', { name: 'Erfassen' }));

    const grund = await within(d).findByRole('alert');
    expect(grund).toHaveTextContent('Name bereits an der UHS');
    expect(within(d).getByRole('textbox', { name: 'Name' })).toHaveValue('Dora Dienst');
    expect(toasts()).toBe(0);

    await userEvent.click(within(d).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(within(d).queryByRole('alert')).toBeNull());
    // Solange die Antwort aussteht, bleibt der Dialog: Abbrechen ist gesperrt.
    expect(within(d).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await act(async () => frei());
    await within(d).findByRole('alert');

    await userEvent.click(within(d).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kraft erfassen' }));
    expect(within(await dialog()).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Kraft zuordnen: der Grund steht im Dialog, kein Toast', async () => {
    mitFreien();
    server.use(
      http.put('/api/einsaetze/1/uhs/2/kraefte/:kid', () =>
        HttpResponse.json({ error: 'Kraft ist an einer anderen UHS' }, { status: 409 }),
      ),
    );
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen={false} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kraft zuordnen' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Kraft zuordnen' }));
    const d = await dialog();
    await userEvent.click(within(d).getByRole('combobox', { name: 'Kraft' }));
    await userEvent.click(await screen.findByText(/Clara Frei/));
    await userEvent.click(within(d).getByRole('button', { name: 'Zuordnen' }));

    const grund = await within(d).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht zugeordnet');
    expect(grund).toHaveTextContent('Kraft ist an einer anderen UHS');
    expect(toasts()).toBe(0);
  });

  it('Einheit zuordnen: der Grund steht im Dialog, kein Toast', async () => {
    mitFreien();
    server.use(
      http.put('/api/einsaetze/1/uhs/2/kraefte/einheit/:eid', () =>
        HttpResponse.json({ error: 'Einheit ist aufgelöst' }, { status: 409 }),
      ),
    );
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Einheit zuordnen' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zuordnen' }));
    const d = await dialog();
    await userEvent.click(within(d).getByRole('combobox', { name: 'Einheit' }));
    await userEvent.click(await screen.findByText(/SEG 1 \(1 Kraft\)/));
    await userEvent.click(within(d).getByRole('button', { name: 'Zuordnen' }));

    expect(await within(d).findByRole('alert')).toHaveTextContent('Einheit ist aufgelöst');
    expect(toasts()).toBe(0);
  });

  it('Abziehen: zwei Zeilen nebenläufig, die späte Ablehnung der ersten steht an ihr', async () => {
    mitFreien();
    let lehneAb: () => void = () => {};
    const ersteAblehnung = new Promise<void>((r) => (lehneAb = r));
    server.use(
      http.delete('/api/einsaetze/1/uhs/2/kraefte/:kid', async ({ params }) => {
        if (params.kid === '11') {
          await ersteAblehnung;
          return HttpResponse.json({ error: 'Kraft führt die UHS' }, { status: 409 });
        }
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen={false} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anna Arzt abziehen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bernd Berg abziehen' }));
    await act(async () => lehneAb());

    const anna = screen.getByRole('row', { name: /Anna Arzt/ });
    expect(await within(anna).findByRole('alert')).toHaveTextContent('Kraft führt die UHS');
    expect(within(screen.getByRole('row', { name: /Bernd Berg/ })).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Abziehen: das nächste Abziehen an der Zeile räumt den Grund', async () => {
    mitFreien();
    let erster = true;
    server.use(
      http.delete('/api/einsaetze/1/uhs/2/kraefte/:kid', async () => {
        if (erster) {
          erster = false;
          return HttpResponse.json({ error: 'Kraft führt die UHS' }, { status: 409 });
        }
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMitProviders(
      <UhsKraefte einsatzId={1} uhs={uhs()} schreibgeschuetzt={false} einheitZuordnen={false} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anna Arzt abziehen' }));
    const anna = () => screen.getByRole('row', { name: /Anna Arzt/ });
    await within(anna()).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /Anna Arzt abziehen/ }));
    await waitFor(() => expect(within(anna()).queryByRole('alert')).toBeNull());
  });
});
