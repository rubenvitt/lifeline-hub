import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { QualiSollEintrag, SchichtplanBlock } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { oeffne, waehle } from '../../test/auswahlListe';
import SchichtplanBlockDialog, { type BlockSpeichern } from './SchichtplanBlockDialog';
import type { RasterZeile } from './raster';

/**
 * Blockdialog des Schichtplans, Qualifikationssoll und Kopie (LLH-1584). Das Soll steht
 * eingeklappt, sein Wert im Kopf; beim Ändern geht nur hinaus, was sich geändert hat, beim
 * Anlegen gilt leer die Vorgabe des Postens. „Als nächsten Block kopieren“ kopiert nur den
 * gespeicherten Stand.
 */

const qualifikationen = [
  { id: 1, label: 'Sanitäter', sortier: 10 },
  { id: 2, label: 'Rettungssanitäter', sortier: 20, schliesst_ein_id: 1 },
];

const ZEILEN: RasterZeile[] = [
  { schluessel: 'einheit:11', titel: 'RTW 1', gruppe: null },
  { schluessel: 'einheit:12', titel: 'Streife 2', gruppe: null },
  { schluessel: 'pause', titel: 'Pause', gruppe: null, ueberlappungErlaubt: true },
];

const block = (b: Partial<SchichtplanBlock> = {}): SchichtplanBlock => ({
  id: 7,
  von: '2026-11-07 10:00:00',
  bis: '2026-11-07 14:00:00',
  posten: { art: 'einheit', einheit_id: 11, bezeichnung: 'RTW 1', aufgeloest: false },
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 0,
  personen: [],
  personen_anzahl: 0,
  soll_anzahl: 2,
  quali_soll: [{ qualifikation_id: 2, anzahl: 1, label: 'Rettungssanitäter' }],
  version: 3,
  ...b,
});

const vorgabe = new Map<string, readonly QualiSollEintrag[] | null>([
  ['einheit:11', [{ qualifikation_id: 2, anzahl: 1, label: 'Rettungssanitäter' }]],
  ['einheit:12', [{ qualifikation_id: 1, anzahl: 2, label: 'Sanitäter' }]],
]);

function zeige(
  b: SchichtplanBlock | null,
  extra: Partial<Parameters<typeof SchichtplanBlockDialog>[0]> = {},
) {
  server.use(http.get('/api/qualifikationen', () => HttpResponse.json(qualifikationen)));
  const onSpeichern = vi.fn<(s: BlockSpeichern) => Promise<unknown>>(() => Promise.resolve());
  const onKopieren = vi.fn();
  renderMitProviders(
    <SchichtplanBlockDialog
      block={b}
      zeilen={ZEILEN}
      personen={[]}
      sollVorgabe={new Map()}
      qualiVorgabe={vorgabe}
      qualiNamen={new Map(qualifikationen.map((q) => [q.id, q.label]))}
      darfSchreiben
      laeuft={false}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      onSpeichern={onSpeichern}
      onKopieren={onKopieren}
      onSchliessen={() => {}}
      {...extra}
    />,
  );
  return { onSpeichern, onKopieren, dialog: screen.getByRole('dialog') };
}

describe('SchichtplanBlockDialog · Qualifikationssoll (LLH-1584)', () => {
  it('nennt das Soll eingeklappt im Kopf und schickt nur das geänderte Feld', async () => {
    const { onSpeichern, dialog } = zeige(block());
    const kopf = within(dialog).getByRole('button', {
      name: /Qualifikationssoll · mind\. 1 Rettungssanitäter/,
    });
    await userEvent.click(kopf);
    const anzahl = within(dialog).getByRole('spinbutton', { name: 'Anzahl 1' });
    await userEvent.clear(anzahl);
    await userEvent.type(anzahl, '2');
    expect(
      within(dialog).getByRole('button', {
        name: /Qualifikationssoll · mind\. 2 Rettungssanitäter/,
      }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(1));
    expect(onSpeichern.mock.calls[0][0]).toEqual({
      art: 'aendern',
      blockId: 7,
      body: { version: 3, quali_soll: [{ qualifikation_id: 2, anzahl: 2 }] },
    });
  });

  it('ohne Änderung am Qualifikationssoll bleibt es draußen; alle Zeilen entfernt heißt keins', async () => {
    const { onSpeichern, dialog } = zeige(block());
    const soll = within(dialog).getByRole('spinbutton', { name: 'Soll' });
    await userEvent.clear(soll);
    await userEvent.type(soll, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(1));
    expect(onSpeichern.mock.calls[0][0]).toEqual({
      art: 'aendern',
      blockId: 7,
      body: { version: 3, soll_anzahl: 3 },
    });
  });

  it('entfernt jemand die letzte Zeile, geht `null` hinaus (kein Soll)', async () => {
    const { onSpeichern, dialog } = zeige(block());
    await userEvent.click(within(dialog).getByRole('button', { name: /^Qualifikationssoll/ }));
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Qualifikation 1 entfernen' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(1));
    expect(onSpeichern.mock.calls[0][0]).toMatchObject({
      body: { version: 3, quali_soll: null },
    });
  });

  it('beim Anlegen nennt der Kopf die Vorgabe des gewählten Postens; leer geht nichts hinaus', async () => {
    const { onSpeichern, dialog } = zeige(null, {
      vorbelegt: {
        zeile: 'einheit:12',
        von: Date.UTC(2026, 10, 7, 9),
        bis: Date.UTC(2026, 10, 7, 11),
      },
    });
    expect(
      within(dialog).getByRole('button', {
        name: /Qualifikationssoll · mind\. 2 Sanitäter \(Vorgabe\)/,
      }),
    ).toBeInTheDocument();
    await oeffne('Posten');
    await waehle('Posten', 'RTW 1');
    expect(
      within(dialog).getByRole('button', {
        name: /Qualifikationssoll · mind\. 1 Rettungssanitäter \(Vorgabe\)/,
      }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block anlegen' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(1));
    const s = onSpeichern.mock.calls[0][0];
    expect(s.art).toBe('anlegen');
    expect('quali_soll' in s.body).toBe(false);
  });

  it('an der Pause gibt es kein Qualifikationssoll', () => {
    const { dialog } = zeige(
      block({
        posten: { art: 'pause', aufgeloest: false },
        soll_anzahl: null,
        quali_soll: null,
      }),
    );
    expect(within(dialog).queryByRole('button', { name: /Qualifikationssoll/ })).toBeNull();
  });
});

describe('SchichtplanBlockDialog · Als nächsten Block kopieren (LLH-1584)', () => {
  it('kopiert den gespeicherten Block; mit ungespeicherter Änderung ist der Knopf gesperrt', async () => {
    const { onKopieren, dialog } = zeige(block());
    const knopf = within(dialog).getByRole('button', { name: 'Als nächsten Block kopieren' });
    expect(knopf).toBeEnabled();
    const soll = within(dialog).getByRole('spinbutton', { name: 'Soll' });
    await userEvent.clear(soll);
    await userEvent.type(soll, '4');
    await waitFor(() => expect(knopf).toBeDisabled());
    await userEvent.clear(soll);
    await userEvent.type(soll, '2');
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    expect(onKopieren).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('beim Anlegen gibt es keinen Knopf', () => {
    zeige(null);
    expect(screen.queryByRole('button', { name: 'Als nächsten Block kopieren' })).toBeNull();
  });
});
