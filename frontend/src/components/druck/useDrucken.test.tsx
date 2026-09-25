import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import DruckKnopf from './DruckKnopf';

/**
 * Drucken erst mit geladenem Kopf (LFH-22, design.md D2). Ohne Sperre druckte der erste
 * Aufruf ohne Organisationsnamen — ein Blatt, das niemandem zuzuordnen ist.
 */

let drucke: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
});

afterEach(() => {
  drucke.mockRestore();
});

const ORG = { id: 1, name: 'DRK Kreisverband Musterstadt', tz_organisation: null };

/** Eine Organisationsantwort, die erst auf Zuruf kommt. */
function verzoegerteOrganisation() {
  let freigeben!: () => void;
  const tor = new Promise<void>((fertig) => {
    freigeben = fertig;
  });
  server.use(
    http.get('/api/organisation', async () => {
      await tor;
      return HttpResponse.json(ORG);
    }),
  );
  return () => freigeben();
}

describe('useDrucken / DruckKnopf', () => {
  it('ruft window.print nicht vor den Organisationsdaten, danach genau einmal', async () => {
    const freigeben = verzoegerteOrganisation();
    renderMitProviders(<DruckKnopf />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    // Die Abfrage läuft noch: kein Druckdialog.
    await new Promise((fertig) => setTimeout(fertig, 50));
    expect(drucke).not.toHaveBeenCalled();

    freigeben();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    // Kein zweiter Aufruf durch ein späteres Rendern.
    await new Promise((fertig) => setTimeout(fertig, 50));
    expect(drucke).toHaveBeenCalledTimes(1);
  });

  it('druckt sofort, wenn die Organisation schon geladen ist — je Klick genau einmal', async () => {
    server.use(http.get('/api/organisation', () => HttpResponse.json(ORG)));
    renderMitProviders(<DruckKnopf />);
    const knopf = screen.getByRole('button', { name: 'Drucken / als PDF' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    await userEvent.click(knopf);
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(2));
  });

  it('führt einen Vorbereitungsschritt VOR dem Druck aus (Meldebild klappt auf)', async () => {
    server.use(http.get('/api/organisation', () => HttpResponse.json(ORG)));
    const reihenfolge: string[] = [];
    drucke.mockImplementation(() => reihenfolge.push('print'));
    renderMitProviders(<DruckKnopf vorbereiten={() => reihenfolge.push('vorbereiten')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    await waitFor(() => expect(reihenfolge).toEqual(['vorbereiten', 'print']));
  });

  it('sperrt den Knopf bei Fehler, bietet Wiederholen an und druckt nicht nachträglich', async () => {
    server.use(
      http.get('/api/organisation', () =>
        HttpResponse.json({ error: 'Interner Serverfehler' }, { status: 500 }),
      ),
    );
    renderMitProviders(<DruckKnopf />);
    const wiederholen = await screen.findByRole('button', { name: /Organisation erneut laden/ });
    expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeDisabled();
    expect(screen.getByText(/Organisation nicht geladen/)).toBeInTheDocument();

    server.use(http.get('/api/organisation', () => HttpResponse.json(ORG)));
    await userEvent.click(wiederholen);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled(),
    );
    expect(drucke).not.toHaveBeenCalled();
  });

  it('bleibt gesperrt, solange der Aufrufer sperrt (ETB: noch nicht vollständig geladen)', async () => {
    server.use(http.get('/api/organisation', () => HttpResponse.json(ORG)));
    renderMitProviders(<DruckKnopf gesperrt />);
    await new Promise((fertig) => setTimeout(fertig, 20));
    expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeDisabled();
  });
});
