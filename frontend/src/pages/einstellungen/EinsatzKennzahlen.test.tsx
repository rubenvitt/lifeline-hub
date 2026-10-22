import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import EinsatzKennzahlen from './EinsatzKennzahlen';

/**
 * Sektion „Kennzahlen" (LLH-1371): die Wahl von „Nachforderungen offen" auf Platz 3 des
 * Kennzahlenbands. Speichert sofort wie die Pegel-Sektion.
 */

interface Aufbau {
  rolle?: string;
  status?: string;
  lagekennzahlen?: string[];
  putStatus?: number;
}

function stelleBereit(a: Aufbau = {}) {
  const aufrufe: unknown[] = [];
  let lagekennzahlen = a.lagekennzahlen ?? [];
  let einsatzAbrufe = 0;
  server.use(
    http.get('/api/einsaetze/1', () => {
      einsatzAbrufe++;
      return HttpResponse.json({
        id: 1,
        bezeichnung: 'Hochwasser Weser',
        status: a.status ?? 'aktiv',
        meine_rolle: a.rolle ?? 'einsatzleitung',
        lagekennzahlen,
      });
    }),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.put('/api/einsaetze/1/lagekennzahl-wahl', async ({ request }) => {
      const body = (await request.json()) as { gewaehlt: string[] };
      aufrufe.push(body);
      if (a.putStatus) return HttpResponse.json({ error: 'nein' }, { status: a.putStatus });
      lagekennzahlen = [...lagekennzahlen.filter((k) => k !== 'nachforderungen'), ...body.gewaehlt];
      return HttpResponse.json({ gewaehlt: body.gewaehlt });
    }),
  );
  return { aufrufe, einsatzAbrufe: () => einsatzAbrufe };
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/kennzahlen" element={<EinsatzKennzahlen />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/kennzahlen' },
  );
}

const schalter = () => screen.findByRole('switch', { name: 'Nachforderungen offen auf Platz 3' });

describe('EinsatzKennzahlen (LLH-1371)', () => {
  it('ohne Wahl ist der Schalter aus; Einschalten speichert sofort und lädt den Einsatz neu', async () => {
    const { aufrufe, einsatzAbrufe } = stelleBereit();
    rendern();
    const s = await schalter();
    expect(s).not.toBeChecked();
    const abrufeVorher = einsatzAbrufe();
    await userEvent.click(s);
    await waitFor(() => expect(aufrufe).toEqual([{ gewaehlt: ['nachforderungen'] }]));
    // Der Einsatz trägt die Lagekennzahl: neu abrufen, sonst zeigte das Dashboard den alten
    // Zuschnitt bis zum nächsten Abruf (oder die eigene Wahl als Banner).
    await waitFor(() => expect(einsatzAbrufe()).toBeGreaterThan(abrufeVorher));
    await waitFor(() => expect(s).toBeChecked());
  });

  it('gewählt ist der Schalter an; Ausschalten schickt die leere Wahl', async () => {
    const { aufrufe } = stelleBereit({ lagekennzahlen: ['nachforderungen'] });
    rendern();
    const s = await schalter();
    await waitFor(() => expect(s).toBeChecked());
    await userEvent.click(s);
    await waitFor(() => expect(aufrufe).toEqual([{ gewaehlt: [] }]));
    await waitFor(() => expect(s).not.toBeChecked());
  });

  it('bei angeordneter Evakuierung nennt die Sektion den Vorrang von „Evakuiert"', async () => {
    stelleBereit({ lagekennzahlen: ['evakuiert', 'nachforderungen'] });
    rendern();
    await schalter();
    expect(
      await screen.findByText(
        'Platz 3 zeigt „Evakuiert“, solange eine Evakuierung angeordnet ist.',
      ),
    ).toBeInTheDocument();
  });

  it('ohne Evakuierung kein Vorrang-Satz', async () => {
    stelleBereit({ lagekennzahlen: ['nachforderungen'] });
    rendern();
    await schalter();
    expect(screen.queryByText(/solange eine Evakuierung angeordnet ist/)).toBeNull();
  });

  it('ohne Schreibrecht: Schalter gesperrt, Grund genannt', async () => {
    stelleBereit({ rolle: 'beobachter', lagekennzahlen: ['nachforderungen'] });
    rendern();
    const s = await schalter();
    await waitFor(() => expect(s).toBeChecked());
    expect(s).toBeDisabled();
    expect(await screen.findByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz: Schalter gesperrt', async () => {
    stelleBereit({ status: 'abgeschlossen' });
    rendern();
    expect(await schalter()).toBeDisabled();
  });

  it('ein abgelehnter Schreibversuch steht als Fehler da, der Schalter bleibt aus', async () => {
    stelleBereit({ putStatus: 422 });
    rendern();
    const s = await schalter();
    await userEvent.click(s);
    expect(await screen.findByText('nein')).toBeInTheDocument();
    expect(s).not.toBeChecked();
  });
});
