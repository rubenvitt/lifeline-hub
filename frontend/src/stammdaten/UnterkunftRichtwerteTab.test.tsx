import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { richtwerteAntwort } from '../test/unterkunftRichtwerte';
import { renderMitProviders } from '../test/utils';
import { herkunftHandler } from '../test/stammdatenHerkunft';
import type { BenutzerAnzeige } from '../api/types';
import UnterkunftRichtwerteTab from './UnterkunftRichtwerteTab';

/** Stammdaten → Unterkunft: Richtwerte der Organisation (LLH-1520, design.md D2). */

function stelleBereit(benutzer: BenutzerAnzeige, anfang: Record<string, number> = {}) {
  const puts: unknown[] = [];
  let org: Record<string, number> = { ...anfang };
  server.use(
    meHandler(benutzer),
    http.get('/api/unterkunft-richtwerte', () => HttpResponse.json(richtwerteAntwort(org))),
    http.put('/api/org-unterkunft-richtwerte/:schluessel', async ({ request, params }) => {
      const body = (await request.json()) as { wert: number | null };
      puts.push([params.schluessel, body]);
      const schluessel = String(params.schluessel);
      org = { ...org };
      if (body.wert == null) delete org[schluessel];
      else org[schluessel] = body.wert;
      return HttpResponse.json(richtwerteAntwort(org));
    }),
  );
  return { puts };
}

describe('UnterkunftRichtwerteTab', () => {
  it('der System-Admin setzt einen Wert der Organisation', async () => {
    const { puts } = stelleBereit(adminFixture());
    renderMitProviders(<UnterkunftRichtwerteTab />);
    const feld = await screen.findByRole('spinbutton', { name: 'Schlaffläche je Person (m²)' });
    await waitFor(() => expect(feld).toBeEnabled());
    await userEvent.type(feld, '5');
    await userEvent.tab();
    await waitFor(() => expect(puts).toEqual([['flaeche_je_person_m2', { wert: 5 }]]));
    await waitFor(() =>
      expect(document.querySelector('[data-schluessel="flaeche_je_person_m2"]')).toHaveTextContent(
        'Organisation · 4 m² (Vorgabe)',
      ),
    );
  });

  it('ohne System-Admin: lesen ja, ändern nein', async () => {
    stelleBereit(benutzerFixture());
    renderMitProviders(<UnterkunftRichtwerteTab />);
    const feld = await screen.findByRole('spinbutton', { name: 'Schlaffläche je Person (m²)' });
    expect(feld).toBeDisabled();
  });
});

describe('UnterkunftRichtwerteTab mit Stammdaten vom Hub (kjezbk06 D6)', () => {
  const zeile = (schluessel: string) =>
    document.querySelector<HTMLElement>(`[data-schluessel="${schluessel}"]`)!;

  it('gesetzter Schlüssel vom Hub gesperrt, anderer setzbar', async () => {
    const { puts } = stelleBereit(adminFixture(), {
      flaeche_je_person_m2: 5,
      dusche_je_personen: 15,
    });
    server.use(herkunftHandler({ unterkunft_richtwert: ['flaeche_je_person_m2'] }));
    renderMitProviders(<UnterkunftRichtwerteTab />);

    const hubFeld = await screen.findByRole('spinbutton', { name: 'Schlaffläche je Person (m²)' });
    await waitFor(() =>
      expect(within(zeile('flaeche_je_person_m2')).getByText('vom Hub')).toBeInTheDocument(),
    );
    expect(hubFeld).toBeDisabled();
    expect(zeile('flaeche_je_person_m2')).toHaveTextContent('Wird am Hub gepflegt');
    // Die Ebene bleibt die der Organisation; das Abzeichen steht daneben.
    expect(zeile('flaeche_je_person_m2')).toHaveTextContent('Organisation · 4 m² (Vorgabe)');

    // Hier gesetzt: „nur hier“, setzbar.
    expect(within(zeile('dusche_je_personen')).getByText('nur hier')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Personen je Dusche (Personen)' })).toBeEnabled();

    // Nicht gesetzt: kein Abzeichen, setzbar.
    const frei = screen.getByRole('spinbutton', { name: 'Wasser je Person und Tag (l)' });
    expect(within(zeile('wasser_je_person_l')).queryByText(/vom Hub|nur hier/)).toBeNull();
    expect(frei).toBeEnabled();
    await userEvent.type(frei, '30');
    await userEvent.tab();
    await waitFor(() => expect(puts).toEqual([['wasser_je_person_l', { wert: 30 }]]));
  });
});
