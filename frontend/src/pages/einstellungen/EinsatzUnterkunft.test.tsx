import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { benutzerFixture } from '../../test/fixtures';
import { meHandler, server } from '../../test/server';
import { richtwerteAntwort } from '../../test/unterkunftRichtwerte';
import { renderMitProviders } from '../../test/utils';
import { RECHTE_TEXT } from '../EinsatzEinstellungenPage';
import EinsatzUnterkunft from './EinsatzUnterkunft';

/** Sektion „Unterkunft“ der Einsatz-Einstellungen (LLH-1520, design.md D2). */

function stelleBereit(rolle = 'einsatzleitung') {
  const puts: { schluessel: string; body: unknown }[] = [];
  let einsatz: Record<string, number> = {};
  server.use(
    meHandler(benutzerFixture({ id: 1 })),
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({
        id: 1,
        bezeichnung: 'Hochwasser',
        status: 'aktiv',
        meine_rolle: rolle,
        org_id: 1,
      }),
    ),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/1/unterkunft-richtwerte', () =>
      HttpResponse.json(richtwerteAntwort({ flaeche_je_person_m2: 5 }, einsatz)),
    ),
    http.put('/api/einsaetze/1/unterkunft-richtwerte/:schluessel', async ({ request, params }) => {
      const body = (await request.json()) as { wert: number | null };
      const schluessel = String(params.schluessel);
      puts.push({ schluessel, body });
      const rest = Object.fromEntries(Object.entries(einsatz).filter(([k]) => k !== schluessel));
      einsatz = body.wert == null ? rest : { ...rest, [schluessel]: body.wert };
      return HttpResponse.json(richtwerteAntwort({ flaeche_je_person_m2: 5 }, einsatz));
    }),
  );
  return { puts };
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/unterkunft" element={<EinsatzUnterkunft />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/unterkunft' },
  );
}

const zeile = (s: string) => document.querySelector<HTMLElement>(`[data-schluessel="${s}"]`)!;

describe('EinsatzUnterkunft (LLH-1520)', () => {
  it('setzt einen Wert des Einsatzes beim Verlassen des Feldes; die Herkunft wechselt auf Einsatz', async () => {
    const { puts } = stelleBereit();
    rendern();
    const feld = await screen.findByRole('spinbutton', { name: 'Wasser je Person und Tag (l)' });
    expect(zeile('flaeche_je_person_m2')).toHaveTextContent('Organisation · 4 m² (Vorgabe)');
    await userEvent.type(feld, '15');
    await userEvent.tab();
    await waitFor(() =>
      expect(puts).toEqual([{ schluessel: 'wasser_je_person_l', body: { wert: 15 } }]),
    );
    await waitFor(() =>
      expect(zeile('wasser_je_person_l')).toHaveTextContent('Einsatz · 25 l (Vorgabe)'),
    );
  });

  it('ohne Verwaltungsrecht: Felder gesperrt, der Grund steht über der Liste', async () => {
    stelleBereit('helfer');
    rendern();
    const feld = await screen.findByRole('spinbutton', { name: 'Wasser je Person und Tag (l)' });
    expect(feld).toBeDisabled();
    expect(screen.getByText(RECHTE_TEXT)).toBeInTheDocument();
  });
});
