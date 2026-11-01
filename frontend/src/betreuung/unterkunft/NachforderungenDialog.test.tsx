import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, AusgangUnbekannt } from '../../api/client';
import type { NeueNachforderung } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import NachforderungenDialog, { legePostenAn } from './NachforderungenDialog';
import type { Posten } from './posten';

/** „Nachforderungen anlegen“ aus dem Ergebnis des Rechners (LLH-1520, design.md D6). */

const POSTEN: Posten[] = [
  { schluessel: 'feldbetten', art: 'Feldbetten', anzahl: 50, vorgewaehlt: true },
  { schluessel: 'decken', art: 'Decken', anzahl: 100, vorgewaehlt: true },
  {
    schluessel: 'wasser',
    art: 'Wasser',
    anzahl: 1250,
    bezeichnung: 'Liter je Tag',
    vorgewaehlt: false,
  },
];

describe('legePostenAn', () => {
  it('legt je Posten eine Nachforderung mit Bezug zur Stelle an; ein Fehler hält die übrigen nicht auf', async () => {
    const bodies: NeueNachforderung[] = [];
    const anlegen = vi.fn(async (_id: number, body: NeueNachforderung) => {
      bodies.push(body);
      if (body.art === 'Decken') throw new ApiError(422, 'Anzahl zu groß');
      return {};
    });
    const lauf = await legePostenAn(
      1,
      8,
      POSTEN,
      { adressat_kategorie: 'leitstelle', prioritaet: 'dringend' },
      anlegen,
    );
    expect(lauf.angelegt).toEqual(['Feldbetten', 'Wasser']);
    expect(lauf.gescheitert).toEqual([{ art: 'Decken', fehler: 'Anzahl zu groß' }]);
    expect(bodies).toEqual([
      {
        art: 'Feldbetten',
        anzahl: 50,
        bezeichnung: undefined,
        betreuungsstelle_id: 8,
        adressat_kategorie: 'leitstelle',
        prioritaet: 'dringend',
      },
      expect.objectContaining({ art: 'Decken', anzahl: 100 }),
      expect.objectContaining({ art: 'Wasser', anzahl: 1250, bezeichnung: 'Liter je Tag' }),
    ]);
  });

  it('merkt einen unbekannten Ausgang gesondert: die Nachforderung kann schon stehen', async () => {
    const lauf = await legePostenAn(
      1,
      8,
      POSTEN.slice(0, 1),
      { adressat_kategorie: 'leitstelle', prioritaet: 'normal' },
      () => Promise.reject(new AusgangUnbekannt()),
    );
    expect(lauf.angelegt).toEqual([]);
    expect(lauf.gescheitert).toEqual([
      { art: 'Feldbetten', fehler: new AusgangUnbekannt().message, unbekannt: true },
    ]);
  });
});

describe('NachforderungenDialog', () => {
  it('hält nach einem Teilfehler offen: Angelegtes steht als angelegt, Gescheitertes bleibt angehakt mit Grund', async () => {
    const angekommen: NeueNachforderung[] = [];
    server.use(
      http.post('/api/einsaetze/1/nachforderungen', async ({ request }) => {
        const body = (await request.json()) as NeueNachforderung;
        angekommen.push(body);
        if (body.art === 'Decken') {
          return HttpResponse.json({ error: 'Lager leer' }, { status: 422 });
        }
        return HttpResponse.json({ id: angekommen.length, ...body }, { status: 201 });
      }),
    );
    const onFertig = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <NachforderungenDialog
        einsatzId={1}
        stelleId={8}
        stelleName="Turnhalle Ost"
        posten={POSTEN}
        onFertig={onFertig}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    const posten = within(dialog).getByRole('group', { name: 'Posten' });
    expect(within(posten).getByRole('checkbox', { name: /Feldbetten/ })).toBeChecked();
    expect(within(posten).getByRole('checkbox', { name: /Wasser/ })).not.toBeChecked();

    await userEvent.click(
      within(dialog).getByRole('button', { name: '2 Nachforderungen anlegen' }),
    );
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
    expect(angekommen.map((b) => [b.art, b.betreuungsstelle_id])).toEqual([
      ['Feldbetten', 8],
      ['Decken', 8],
    ]);
    expect(onFertig.mock.calls[0]).toEqual([
      { angelegt: ['Feldbetten'], gescheitert: [{ art: 'Decken', fehler: 'Lager leer' }] },
      true,
    ]);
    expect(onSchliessen).not.toHaveBeenCalled();
    // Das Ladesymbol blendet in jsdom nicht aus und bleibt im Namen: Teilstring statt Gleichheit.
    const nochmal = await within(dialog).findByRole('button', { name: /1 Nachforderung anlegen$/ });
    expect(within(posten).getByRole('checkbox', { name: /Feldbetten/ })).toBeDisabled();
    expect(within(posten).getByText('angelegt')).toBeInTheDocument();
    expect(within(posten).getByRole('checkbox', { name: /Decken/ })).toBeChecked();
    expect(within(posten).getByText('Lager leer')).toBeInTheDocument();
    expect(within(dialog).getByText('1 Posten nicht angelegt')).toBeInTheDocument();

    // Zweiter Lauf: nur noch der gescheiterte Posten.
    server.use(
      http.post('/api/einsaetze/1/nachforderungen', async ({ request }) => {
        const body = (await request.json()) as NeueNachforderung;
        angekommen.push(body);
        return HttpResponse.json({ id: 9, ...body }, { status: 201 });
      }),
    );
    await userEvent.click(nochmal);
    await waitFor(() => expect(onSchliessen).toHaveBeenCalledTimes(1));
    expect(angekommen[angekommen.length - 1]?.art).toBe('Decken');
    expect(onFertig).toHaveBeenLastCalledWith({ angelegt: ['Decken'], gescheitert: [] }, false);
  });
});
