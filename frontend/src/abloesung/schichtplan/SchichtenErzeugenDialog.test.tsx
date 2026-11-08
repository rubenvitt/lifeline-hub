import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { SchichtplanErzeugenBody } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import { optionenVon, oeffne, waehle } from '../../test/auswahlListe';
import SchichtenErzeugenDialog, { konfliktZeilen } from './SchichtenErzeugenDialog';
import type { RasterZeile } from './raster';

/**
 * „Schichten erzeugen“ (LLH-1584): Posten ohne Pause, Länge leer = Schichtmodell des Einsatzes
 * (sonst Pflicht), Konflikte als Zeilen im offenen Dialog.
 */

const ZEILEN: RasterZeile[] = [
  { schluessel: 'einheit:11', titel: 'RTW 1', gruppe: 'Nord' },
  { schluessel: 'uhs:3', titel: 'UHS Markt', gruppe: null },
  { schluessel: 'pause', titel: 'Pause', gruppe: null, ueberlappungErlaubt: true },
];

const konflikt = new ApiError(
  422,
  'Erzeugte Schichten überschneiden sich mit bestehenden; nichts angelegt',
  {
    zeilen: [{ art: 'planschicht', id: 4, grund: 'überschneidet sich mit 1000–1400' }],
  },
);

function zeige(schichtmodell: string | null, fehler: unknown = null) {
  const onErzeugen = vi.fn<(b: SchichtplanErzeugenBody) => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  renderMitProviders(
    <SchichtenErzeugenDialog
      zeilen={ZEILEN}
      schichtmodell={schichtmodell}
      darfSchreiben
      laeuft={false}
      speicherung={{ error: fehler, isPending: false, reset: () => {} }}
      onErzeugen={onErzeugen}
      onSchliessen={() => {}}
    />,
  );
  return { onErzeugen, dialog: screen.getByRole('dialog', { name: 'Schichten erzeugen' }) };
}

async function fuelleZeit(dialog: HTMLElement) {
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Beginn' }), '1000');
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Ende' }), '1800');
}

describe('SchichtenErzeugenDialog (LLH-1584)', () => {
  it('bietet jeden Posten außer der Pause an', async () => {
    zeige('4 h');
    await oeffne('Posten');
    expect(optionenVon('Posten')).toEqual(['RTW 1 · Nord', 'UHS Markt']);
  });

  it('ohne Länge gilt das Schichtmodell des Einsatzes; der Platzhalter nennt es', async () => {
    const { onErzeugen, dialog } = zeige('Wechsel 0600/1800');
    expect(within(dialog).getByRole('textbox', { name: 'Länge je Schicht' })).toHaveAttribute(
      'placeholder',
      'Wechsel 0600/1800 (Vorgabe Einsatz)',
    );
    await oeffne('Posten');
    await waehle('Posten', 'UHS Markt');
    await fuelleZeit(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schichten erzeugen' }));
    await waitFor(() => expect(onErzeugen).toHaveBeenCalledTimes(1));
    const body = onErzeugen.mock.calls[0][0];
    expect(body.posten).toEqual({ art: 'uhs', uhs_id: 3 });
    expect('laenge_minuten' in body).toBe(false);
  });

  it('ohne Schichtmodell ist die Länge Pflicht; eine Länge geht in Minuten hinaus', async () => {
    const { onErzeugen, dialog } = zeige(null);
    await oeffne('Posten');
    await waehle('Posten', 'RTW 1 · Nord');
    await fuelleZeit(dialog);
    const knopf = within(dialog).getByRole('button', { name: 'Schichten erzeugen' });
    await userEvent.click(knopf);
    expect(await within(dialog).findByText('Bitte eine Länge angeben')).toBeInTheDocument();
    expect(onErzeugen).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Länge je Schicht' }), '2:30');
    await userEvent.click(knopf);
    await waitFor(() => expect(onErzeugen).toHaveBeenCalledTimes(1));
    expect(onErzeugen.mock.calls[0][0]).toMatchObject({
      posten: { art: 'einheit', einheit_id: 11 },
      laenge_minuten: 150,
    });
  });

  it('nennt jeden Konflikt als Zeile', () => {
    const { dialog } = zeige('4 h', konflikt);
    expect(within(dialog).getByText('überschneidet sich mit 1000–1400')).toBeInTheDocument();
    expect(konfliktZeilen(new Error('x'))).toEqual([]);
  });
});
