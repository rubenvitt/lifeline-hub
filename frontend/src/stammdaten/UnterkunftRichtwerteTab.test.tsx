import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { richtwerteAntwort } from '../test/unterkunftRichtwerte';
import { renderMitProviders } from '../test/utils';
import type { BenutzerAnzeige } from '../api/types';
import UnterkunftRichtwerteTab from './UnterkunftRichtwerteTab';

/** Stammdaten → Unterkunft: Richtwerte der Organisation (LLH-1520, design.md D2). */

function stelleBereit(benutzer: BenutzerAnzeige) {
  const puts: unknown[] = [];
  let org: Record<string, number> = {};
  server.use(
    meHandler(benutzer),
    http.get('/api/unterkunft-richtwerte', () => HttpResponse.json(richtwerteAntwort(org))),
    http.put('/api/org-unterkunft-richtwerte/:schluessel', async ({ request, params }) => {
      const body = (await request.json()) as { wert: number | null };
      puts.push([params.schluessel, body]);
      org = body.wert == null ? {} : { [String(params.schluessel)]: body.wert };
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
