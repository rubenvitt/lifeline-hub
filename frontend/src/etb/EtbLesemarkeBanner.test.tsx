import { act, screen, waitFor } from '@testing-library/react';
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
        const neu = {
          neue_anzahl: 0,
          hoechste_lfd_nr: 12,
          gesichtet_lfd_nr: 12,
          gesichtet_at: '2026-09-22 12:00:00',
        };
        // Der Server kennt ab jetzt den neuen Stand — auch für das Nachlesen danach.
        stand(neu);
        return HttpResponse.json(neu);
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

  /** Der Grund steht am Banner, kein Toast (LFH-1077, `frontend/AGENTS.md`, Rückwege). */
  describe('Ablehnung am Banner (LFH-1077)', () => {
    /** Erste Antwort lehnt ab, jede weitere bleibt aus, bis `freigeben` sie beantwortet. */
    function ablehnenDannHalten() {
      let aufrufe = 0;
      const warten: (() => void)[] = [];
      server.use(
        http.post(URL, async () => {
          aufrufe += 1;
          if (aufrufe > 1) await new Promise<void>((r) => warten.push(r));
          return HttpResponse.json({ error: 'Marke nicht gesetzt' }, { status: 409 });
        }),
      );
      return { freigeben: () => warten.splice(0).forEach((r) => r()) };
    }

    it('nennt den Grund am Banner und zeigt keinen Toast', async () => {
      stand({ neue_anzahl: 2, hoechste_lfd_nr: 5 });
      ablehnenDannHalten();
      renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'alle als gesichtet markieren' }),
      );

      const fehler = await screen.findByRole('alert');
      expect(fehler).toHaveTextContent('Nicht als gesichtet markiert');
      expect(fehler).toHaveTextContent('Marke nicht gesetzt');
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });

    it('das nächste Markieren räumt den Grund, solange die Antwort aussteht', async () => {
      stand({ neue_anzahl: 2, hoechste_lfd_nr: 5 });
      const { freigeben } = ablehnenDannHalten();
      renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);
      const knopf = await screen.findByRole('button', { name: 'alle als gesichtet markieren' });
      await userEvent.click(knopf);
      await screen.findByRole('alert');

      await userEvent.click(knopf);
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      await act(async () => freigeben());
      expect(await screen.findByRole('alert')).toHaveTextContent('Marke nicht gesetzt');
    });

    it('ein Einsatzwechsel räumt den Grund, ein späteres Scheitern meldet dort nicht', async () => {
      server.use(
        http.get('/api/einsaetze/8/etb/lesemarke', () =>
          HttpResponse.json({ neue_anzahl: 4, hoechste_lfd_nr: 9 }),
        ),
      );
      stand({ neue_anzahl: 2, hoechste_lfd_nr: 5 });
      const { freigeben } = ablehnenDannHalten();
      const { rerender } = renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);
      const knopf = await screen.findByRole('button', { name: 'alle als gesichtet markieren' });
      await userEvent.click(knopf);
      await screen.findByRole('alert');

      rerender(<EtbLesemarkeBanner einsatzId={8} />);
      await screen.findByText('4 Einträge, die Sie noch nicht gesichtet haben');
      expect(screen.queryByRole('alert')).toBeNull();

      // Zurück in Einsatz 7: der alte Grund ist geräumt. Erneut markieren, dann wechseln: die
      // späte Ablehnung bleibt aus 8.
      rerender(<EtbLesemarkeBanner einsatzId={7} />);
      await screen.findByText('2 Einträge, die Sie noch nicht gesichtet haben');
      expect(screen.queryByRole('alert')).toBeNull();
      await userEvent.click(
        await screen.findByRole('button', { name: 'alle als gesichtet markieren' }),
      );
      rerender(<EtbLesemarkeBanner einsatzId={8} />);
      await screen.findByText('4 Einträge, die Sie noch nicht gesichtet haben');
      await act(async () => freigeben());
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('alert')).toBeNull();
    });
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

  it('ein vor dem Klick gestarteter Abruf holt das Banner nicht zurück', async () => {
    const alt = {
      neue_anzahl: 3,
      hoechste_lfd_nr: 12,
      gesichtet_lfd_nr: 9,
      gesichtet_at: '2026-09-22 11:04:00',
    };
    const neu = { ...alt, neue_anzahl: 0, gesichtet_lfd_nr: 12 };
    let serverStand: EtbLesemarke = alt;
    let freigeben: (() => void) | null = null;
    let haengend = false;
    server.use(
      http.get(URL, async () => {
        // Der ERSTE Abruf nach `haengend` liest den alten Stand und bleibt hängen, bis der
        // POST durch ist — genau das Fenster, in dem er den neuen Stand überschriebe.
        if (haengend) {
          haengend = false;
          const gelesen = serverStand;
          await new Promise<void>((r) => (freigeben = r));
          return HttpResponse.json(gelesen);
        }
        return HttpResponse.json(serverStand);
      }),
      http.post(URL, () => {
        serverStand = neu;
        return HttpResponse.json(neu);
      }),
    );
    const { client } = renderMitProviders(<EtbLesemarkeBanner einsatzId={7} />);
    const knopf = await screen.findByRole('button', { name: 'alle als gesichtet markieren' });

    haengend = true;
    void client.invalidateQueries({ queryKey: einsatzKeys.etb(7) });
    await waitFor(() => expect(freigeben).not.toBeNull());
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'alle als gesichtet markieren' })).toBeNull(),
    );

    freigeben!();
    // Dem veralteten Abruf Zeit geben, seinen alten Stand abzuliefern.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'alle als gesichtet markieren' })).toBeNull();
  });
});
