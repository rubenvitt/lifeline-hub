import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import { optionenVon, oeffne, waehle } from '../test/auswahlListe';
import PostenZuordnenModal, {
  type PostenZuordnenModalProps,
  type ZuordnenPosten,
} from './PostenZuordnenModal';

const FELDBETTEN = { id: 4, art: 'Feldbetten', bezeichnung: '20 Feldbetten Notunterkunft' };
const ohneFehler = { error: null, isPending: false, reset: () => {} };

const posten = (over: Partial<ZuordnenPosten> & Pick<ZuordnenPosten, 'id'>): ZuordnenPosten => ({
  bezeichnung: 'Feldbetten',
  art: 'verbrauchsgut',
  menge: 20,
  ausgegeben: 0,
  einheit_id: null,
  einsatz_fahrzeug_id: null,
  uhs_id: null,
  br_id: null,
  beendet_at: null,
  nachforderung_id: null,
  ...over,
});

function zeige(p: Partial<PostenZuordnenModalProps> = {}) {
  server.use(
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 3, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null }]),
    ),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  );
  const alle: PostenZuordnenModalProps = {
    einsatzId: 1,
    nachforderung: FELDBETTEN,
    ergaenzen: false,
    material: [
      posten({ id: 7 }),
      posten({ id: 8, bezeichnung: 'Wolldecken', menge: 50, einheit_id: 3 }),
      posten({ id: 9, nachforderung_id: 2 }),
      posten({ id: 10, beendet_at: '2026-10-22 10:00:00' }),
    ],
    laeuft: false,
    speicherung: ohneFehler,
    onZuordnen: vi.fn().mockResolvedValue(undefined),
    onSchliessen: vi.fn(),
    ...p,
  };
  return { ...alle, ...renderMitProviders(<PostenZuordnenModal {...alle} />) };
}

describe('PostenZuordnenModal (LLH-1259 D5)', () => {
  it('bietet nur aktive Posten ohne Bezug an, passende zuerst, mit Menge und Ort', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Erfassten Posten „Feldbetten“ zuordnen');
    expect(within(dialog).getByText('20 Feldbetten Notunterkunft')).toBeInTheDocument();
    await oeffne('Posten');
    await waitFor(() =>
      expect(optionenVon('Posten')).toEqual([
        'Feldbetten · 20 · ohne Ort',
        'Wolldecken · 50 · Staffel A',
      ]),
    );
  });

  it('sendet den gewählten Posten', async () => {
    const { onZuordnen } = zeige();
    await screen.findByRole('dialog');
    await waehle('Posten', 'Feldbetten · 20 · ohne Ort');
    await userEvent.click(screen.getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() => expect(onZuordnen).toHaveBeenCalledWith(7));
  });

  it('ohne Wahl wird nichts gesendet', async () => {
    const { onZuordnen } = zeige();
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Zuordnen' }));
    expect(await screen.findByText('Posten wählen')).toBeInTheDocument();
    expect(onZuordnen).not.toHaveBeenCalled();
  });

  it('ohne freien Posten sagt der Dialog das und sperrt „Zuordnen“', async () => {
    zeige({ material: [posten({ id: 9, nachforderung_id: 2 })] });
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Kein Posten ohne Nachforderung im Einsatz'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Zuordnen' })).toBeDisabled();
  });

  it('solange die Materialliste lädt, sagt der Dialog das statt „kein Posten“', async () => {
    zeige({ material: undefined });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Posten werden geladen …')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Zuordnen' })).toBeDisabled();
  });

  it('mit schon übernommenem Posten: als weiteren Posten zuordnen', async () => {
    zeige({ ergaenzen: true });
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Als weiteren Posten zuordnen' }),
    ).toBeInTheDocument();
  });
});
