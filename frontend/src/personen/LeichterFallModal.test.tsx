import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Uhs } from '../api/types';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LeichterFallModal, {
  fundortAusEinheit,
  fundortAusUhs,
  leichterFallZuEingabe,
  type LeichterFallStelle,
} from './LeichterFallModal';

/** Der leichte Fall (LLH-1572, Change `o1igsr0s-leichte-faelle`): Eingabe, Vorbelegung, Griffe. */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests.
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({ etikett }: { etikett: string }) => (
    <div role="group" aria-label={`Karte: ${etikett}`} />
  ),
}));

const BUEHNE = { id: 3, bezeichnung: 'UHS Bühne', lat: 52.1, lon: 9.2 };
const STELLE: LeichterFallStelle = { art: 'uhs', uhs: BUEHNE };

describe('leichterFallZuEingabe', () => {
  it('ist immer betroffen und entlassen, ohne Sichtung, nur gesetzte Werte', () => {
    expect(leichterFallZuEingabe({ anlass: 'allergie' }, null)).toEqual({
      status: 'betroffen',
      entlassen: true,
      anlass: 'allergie',
    });
  });

  it('macht aus „Versorgt von“ die UHS oder die versorgende Einheit', () => {
    expect(leichterFallZuEingabe({ anlass: 'verletzung', versorgt_von: 'uhs:3' }, null)).toEqual(
      expect.objectContaining({ uhs_id: 3 }),
    );
    const mitEinheit = leichterFallZuEingabe(
      {
        anlass: 'verletzung',
        versorgt_von: 'einheit:7',
        massnahmen: ['kuehlung', 'lagerung'],
        name: '  Bauer ',
        alter_geschaetzt: 40,
        antreff_ort: { text: 'Abschnitt Nord', koordinate: null },
      },
      null,
    );
    expect(mitEinheit).toEqual({
      status: 'betroffen',
      entlassen: true,
      anlass: 'verletzung',
      massnahmen: ['kuehlung', 'lagerung'],
      name: 'Bauer',
      alter_geschaetzt: 40,
      antreff_ort: 'Abschnitt Nord',
      versorgende_einheit_id: 7,
    });
    expect(mitEinheit).not.toHaveProperty('uhs_id');
  });

  it('nimmt am Gerät die feste UHS, eine Wahl zählt dort nicht', () => {
    const e = leichterFallZuEingabe({ anlass: 'sonstiges', versorgt_von: 'einheit:7' }, STELLE);
    expect(e.uhs_id).toBe(3);
    expect(e).not.toHaveProperty('versorgende_einheit_id');
  });
});

describe('Fundort aus „Versorgt von“', () => {
  it('nimmt Bezeichnung und Koordinate der UHS', () => {
    expect(fundortAusUhs(BUEHNE)).toEqual({
      text: 'UHS Bühne',
      koordinate: { lat: 52.1, lon: 9.2 },
    });
    expect(fundortAusUhs({ ...BUEHNE, lat: null, lon: null })).toEqual({
      text: 'UHS Bühne',
      koordinate: null,
    });
  });

  it('nimmt den Abschnitt der Einheit, ohne Abschnitt ihren Namen', () => {
    expect(fundortAusEinheit({ name: 'RTW 1', abschnitt_name: 'Abschnitt Nord' }).text).toBe(
      'Abschnitt Nord',
    );
    expect(fundortAusEinheit({ name: 'RTW 1', abschnitt_name: null }).text).toBe('RTW 1');
  });
});

function zeige(opts: { stelle?: LeichterFallStelle | null; uhsListe?: Uhs[] } = {}) {
  const onErfassen: Mock = vi.fn().mockResolvedValue(undefined);
  const onFertig: Mock = vi.fn();
  renderMitProviders(
    <LeichterFallModal
      einsatzId={1}
      offen
      stelle={opts.stelle}
      uhsListe={opts.uhsListe}
      laeuft={false}
      onErfassen={onErfassen}
      onFertig={onFertig}
      onAbbrechen={vi.fn()}
    />,
  );
  return { onErfassen, onFertig };
}

describe('LeichterFallModal', () => {
  beforeEach(() => {
    sessionStorage.clear();
    server.use(
      http.get('/api/einsaetze/1/personen/einheiten', () =>
        HttpResponse.json([
          { id: 7, name: 'RTW 1', abschnitt_id: 2, abschnitt_name: 'Abschnitt Nord' },
        ]),
      ),
    );
  });

  it('am Gerät in drei Griffen: öffnen, Anlass, Entlassen — Fundort ist die eigene UHS', async () => {
    const { onErfassen } = zeige({ stelle: STELLE });
    const fundort = await screen.findByRole('textbox', { name: 'Fundort' });
    await waitFor(() => expect(fundort).toHaveValue('UHS Bühne'));
    expect(screen.queryByText('Versorgt von')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Allergie / Insektenstich' }));
    await userEvent.click(screen.getByRole('button', { name: 'Entlassen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen).toHaveBeenCalledWith({
      status: 'betroffen',
      entlassen: true,
      anlass: 'allergie',
      antreff_ort: 'UHS Bühne',
      antreff_lat: 52.1,
      antreff_lon: 9.2,
      uhs_id: 3,
    });
  });

  it('hält ohne Anlass an und sendet nichts', async () => {
    const { onErfassen } = zeige({ stelle: STELLE });
    await userEvent.click(await screen.findByRole('button', { name: 'Entlassen' }));
    expect(await screen.findByText('Anlass fehlt')).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('nimmt höchstens drei Maßnahmen, in der Folge der Liste', async () => {
    const { onErfassen } = zeige({ stelle: STELLE });
    const gruppe = await screen.findByRole('group', { name: 'Maßnahmen' });
    expect(gruppe).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lagerung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wundversorgung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kühlung' }));
    expect(screen.getByRole('button', { name: 'Betreuung / Gespräch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kühlung' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Hitze / Kälte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Entlassen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0].massnahmen).toEqual([
      'wundversorgung',
      'kuehlung',
      'lagerung',
    ]);
  });

  it('belegt „Versorgt von“ mit der letzten Wahl vor, der Fundort folgt ihr', async () => {
    schreibeErfassungsSitzungswert(1, 'leichter-fall', 'versorgt_von', 'einheit:7');
    const { onErfassen } = zeige();
    const fundort = await screen.findByRole('textbox', { name: 'Fundort' });
    await waitFor(() => expect(fundort).toHaveValue('Abschnitt Nord'));
    await userEvent.click(screen.getByRole('radio', { name: 'Psychisch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Entlassen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toEqual(
      expect.objectContaining({ versorgende_einheit_id: 7, antreff_ort: 'Abschnitt Nord' }),
    );
    expect(liesErfassungsSitzungswert(1, 'leichter-fall', 'versorgt_von')).toBe('einheit:7');
  });
});
