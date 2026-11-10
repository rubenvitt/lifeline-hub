import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { EinsatzSpiegelAnzeige, SpiegelAntragAnzeige } from '../../api/types';
import { einsatzFixture } from '../../test/fixtures';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SpiegelBand from './SpiegelBand';

const spiegel = (teil: Partial<EinsatzSpiegelAnzeige> = {}): EinsatzSpiegelAnzeige => ({
  gegenstelle: 'ELW 1 DRK Nord',
  // Frisch: ein Abgleich gerade eben, in der Zeit des Tests.
  letzter_abgleich_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  beendet: false,
  antraege_ausstehend: 1,
  antraege_abgelehnt: 1,
  ...teil,
});

const antraege: SpiegelAntragAnzeige[] = [
  {
    id: 3,
    art: 'etb',
    zustand: 'ausstehend',
    erfasst_at: '2026-11-10 08:00:00',
    ziel: {} as never,
    daten: { typ: 'meldung', inhalt: 'Pegel steigt' } as never,
  },
  {
    id: 4,
    art: 'meldung',
    zustand: 'abgelehnt',
    grund: 'Einsatz ist abgeschlossen',
    erfasst_at: '2026-11-10 08:05:00',
    ziel: {} as never,
    daten: { absender: 'Hub', inhalt: 'Bitte Lagebild' } as never,
  },
];

function mitServer(liste = antraege) {
  const verworfen: number[] = [];
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture({ spiegel: spiegel() }))),
    http.get('/api/einsaetze/1/antraege', () => HttpResponse.json(liste)),
    http.delete('/api/einsaetze/1/antraege/:aid', ({ params }) => {
      verworfen.push(Number(params.aid));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return verworfen;
}

describe('SpiegelBand (LLH-1492, design.md D13)', () => {
  it('steht ohne Spiegel nicht da', () => {
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture()} />);
    expect(document.querySelector('[data-lfh="spiegel-band"]')).toBeNull();
  });

  it('nennt Gegenstelle, Stand und Zähler der Anträge', async () => {
    mitServer();
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    const band = screen.getByRole('status');
    expect(band).toHaveTextContent('Spiegel von ELW 1 DRK Nord');
    expect(band).toHaveTextContent(/Abgleich \d/);
    expect(band).toHaveTextContent('1 Antrag ausstehend');
    expect(band).toHaveTextContent('1 abgelehnt');
  });

  it('sagt „Abgleich beendet“ nach dem Widerruf', () => {
    mitServer([]);
    renderMitProviders(
      <SpiegelBand
        einsatz={einsatzFixture({
          spiegel: spiegel({ beendet: true, antraege_ausstehend: 0, antraege_abgelehnt: 0 }),
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Abgleich beendet');
  });

  it('klappt die Anträge auf: abgelehnte mit Grund, „Verwerfen“ löscht', async () => {
    const verworfen = mitServer();
    const user = userEvent.setup();
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    await user.click(screen.getByRole('button', { name: /Anträge/ }));
    const zeilen = await screen.findAllByRole('listitem');
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toHaveTextContent('ETB-Eintrag');
    expect(zeilen[0]).toHaveTextContent('Pegel steigt');
    expect(zeilen[0]).toHaveTextContent('ausstehend');
    expect(within(zeilen[0]).queryByRole('button')).toBeNull();
    expect(zeilen[1]).toHaveTextContent('abgelehnt: Einsatz ist abgeschlossen');
    expect(within(zeilen[1]).getByRole('button', { name: 'Neu erfassen' })).toBeInTheDocument();
    await user.click(within(zeilen[1]).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(verworfen).toEqual([4]));
  });
});
