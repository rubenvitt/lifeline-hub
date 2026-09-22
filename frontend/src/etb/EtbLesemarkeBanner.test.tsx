import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import type { EtbLesemarke } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EtbLesemarkeBanner from './EtbLesemarkeBanner';

const URL = '/api/einsaetze/7/etb/lesemarke';

function stand(marke: EtbLesemarke) {
  server.use(http.get(URL, () => HttpResponse.json(marke)));
}

describe('EtbLesemarkeBanner', () => {
  it('schweigt ohne Neues', async () => {
    let gefragt = false;
    server.use(
      http.get(URL, () => {
        gefragt = true;
        return HttpResponse.json({ neue_anzahl: 0, hoechste_lfd_nr: 9, gesichtet_lfd_nr: 9 });
      }),
    );
    renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);
    await waitFor(() => expect(gefragt).toBe(true));
    expect(screen.queryByRole('button', { name: 'alle als gesichtet markieren' })).toBeNull();
  });

  it('meldet die Zahl und schickt beim Markieren den ANGESAGTEN Stand zurück', async () => {
    stand({
      neue_anzahl: 3,
      hoechste_lfd_nr: 12,
      gesichtet_lfd_nr: 9,
      gesichtet_at: '2026-09-22 11:04:00',
    });
    let gesendet: unknown = null;
    server.use(
      http.post(URL, async ({ request }) => {
        gesendet = await request.json();
        return HttpResponse.json({
          neue_anzahl: 0,
          hoechste_lfd_nr: 12,
          gesichtet_lfd_nr: 12,
          gesichtet_at: '2026-09-22 12:00:00',
        });
      }),
    );
    renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);

    expect(await screen.findByText(/^3 neue Einträge seit Ihrer letzten Sichtung/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'alle als gesichtet markieren' }));

    // Nicht „alles bis jetzt": zurück geht die Nummer, die das Banner angesagt hat.
    await waitFor(() => expect(gesendet).toEqual({ bis_lfd_nr: 12 }));
    // Die Antwort des Servers ersetzt den Stand — das Banner geht.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'alle als gesichtet markieren' })).toBeNull(),
    );
  });

  it('bleibt stehen und meldet sich, wenn das Markieren scheitert', async () => {
    stand({ neue_anzahl: 2, hoechste_lfd_nr: 5 });
    server.use(http.post(URL, () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })));
    renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'alle als gesichtet markieren' }),
    );
    expect(await screen.findByText('kaputt')).toBeTruthy();
    expect(screen.getByText('2 Einträge, die Sie noch nicht gesichtet haben')).toBeTruthy();
  });

  it('zieht die Zahl nach, wenn das ETB invalidiert wird (Live-Ereignis `etb`)', async () => {
    stand({
      neue_anzahl: 1,
      hoechste_lfd_nr: 5,
      gesichtet_lfd_nr: 4,
      gesichtet_at: '2026-09-22 11:04:00',
    });
    const { client } = renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);
    expect(await screen.findByText(/^1 neuer Eintrag seit/)).toBeTruthy();

    stand({
      neue_anzahl: 2,
      hoechste_lfd_nr: 6,
      gesichtet_lfd_nr: 4,
      gesichtet_at: '2026-09-22 11:04:00',
    });
    // Der Fan-out des Live-Feeds invalidiert den ETB-PREFIX, nicht die Lesemarke selbst.
    await client.invalidateQueries({ queryKey: einsatzKeys.etb(7) });
    expect(await screen.findByText(/^2 neue Einträge seit/)).toBeTruthy();
  });
});
