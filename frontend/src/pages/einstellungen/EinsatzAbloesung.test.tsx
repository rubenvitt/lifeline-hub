import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { freigabenFixture } from '../../test/fixtures';
import { renderMitProviders } from '../../test/utils';
import type { ModulFreigaben } from '../../api/types';
import EinsatzAbloesung from './EinsatzAbloesung';

/** Sektion „Ablösung“ der Einsatz-Einstellungen (LLH-1122): Vorgabe des Einsatzes. */

const einsatz = (meine_rolle = 'einsatzleitung') => ({
  id: 1,
  bezeichnung: 'Hochwasser Weser',
  status: 'aktiv',
  meine_rolle,
  org_id: 1,
});

const HOCHWASSER = {
  bezeichnung: '12-h-Schicht Hochwasser',
  typ: 'wechselzeiten',
  wechselzeiten: ['06:00', '18:00'],
  mindestdauer_minuten: 240,
  vorwarnung_minuten: 45,
  planungsvorlauf_minuten: 120,
  geaendert_at: '2026-10-16 08:00:00',
};

const MODELLE = [
  {
    id: 3,
    bezeichnung: 'Sanitätsdienst',
    typ: 'rhythmus',
    rhythmus_minuten: 360,
    vorwarnung_minuten: 30,
    planungsvorlauf_minuten: 120,
    ist_vorgabe: true,
    ist_demo: false,
  },
  {
    id: 4,
    bezeichnung: '12-h-Schicht Hochwasser',
    typ: 'wechselzeiten',
    wechselzeiten: ['06:00', '18:00'],
    mindestdauer_minuten: 240,
    vorwarnung_minuten: 30,
    planungsvorlauf_minuten: 120,
    ist_vorgabe: false,
    ist_demo: true,
  },
];

interface Aufbau {
  rolle?: string;
  vorgabe?: unknown | null;
  freigaben?: ModulFreigaben;
  putStatus?: number;
}

function stelleBereit(a: Aufbau = {}) {
  const puts: unknown[] = [];
  let lesend = 0;
  let stand: unknown = a.vorgabe === undefined ? HOCHWASSER : a.vorgabe;
  const antwort = () => ({
    ...(stand ? { schichtmodell: stand } : {}),
    vorwarnung_minuten: (stand as { vorwarnung_minuten?: number } | null)?.vorwarnung_minuten ?? 30,
    laufende_schichten: 2,
  });
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz(a.rolle))),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/1/modul-freigaben', () =>
      HttpResponse.json(a.freigaben ?? freigabenFixture()),
    ),
    http.get('/api/schichtmodelle', () => HttpResponse.json(MODELLE)),
    http.get('/api/einsaetze/1/abloesungen/schichtmodell', () => {
      lesend += 1;
      return HttpResponse.json(antwort());
    }),
    http.put('/api/einsaetze/1/abloesungen/schichtmodell', async ({ request }) => {
      const body = (await request.json()) as {
        schichtmodell_id?: number;
        schichtmodell?: Record<string, unknown> | null;
      };
      puts.push(body);
      if (a.putStatus) return HttpResponse.json({ error: 'abgelehnt' }, { status: a.putStatus });
      if (body.schichtmodell_id != null) {
        stand = { ...MODELLE.find((m) => m.id === body.schichtmodell_id), geaendert_at: 'x' };
      } else if (body.schichtmodell === null) {
        stand = null;
      } else {
        stand = {
          vorwarnung_minuten: 30,
          planungsvorlauf_minuten: 120,
          ...body.schichtmodell,
          geaendert_at: 'x',
        };
      }
      return HttpResponse.json(antwort());
    }),
  );
  return { puts, lesend: () => lesend };
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/abloesung" element={<EinsatzAbloesung />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/abloesung' },
  );
}

const paneel = () => screen.findByRole('region', { name: 'Schichtmodell des Einsatzes' });

describe('EinsatzAbloesung (LLH-1122)', () => {
  it('zeigt die Vorgabe: Bezeichnung, Regel, Vorwarnung, Planungsvorlauf, laufende Schichten', async () => {
    stelleBereit();
    rendern();
    const p = await paneel();
    await within(p).findByText('Wechsel 0600/1800 · Mindestdauer 4 h');
    const raster = p.querySelector('dl')!;
    expect(raster).toHaveTextContent('12-h-Schicht Hochwasser');
    expect(raster).toHaveTextContent('Wechsel 0600/1800 · Mindestdauer 4 h');
    expect(raster).toHaveTextContent('45 min');
    expect(raster).toHaveTextContent('2 h');
    expect(raster).toHaveTextContent('2');
  });

  it('ohne Vorgabe: „Keine Vorgabe“ mit der wirksamen Vorwarnung, kein Entfernen', async () => {
    stelleBereit({ vorgabe: null });
    rendern();
    const p = await paneel();
    await within(p).findByText('Keine Vorgabe · Vorwarnung 30 min');
    expect(within(p).queryByRole('button', { name: 'Vorgabe entfernen' })).toBeNull();
    expect(within(p).getByRole('button', { name: 'Eigene Werte setzen' })).toBeEnabled();
  });

  it('übernimmt ein Modell der Organisation als Kopie (schichtmodell_id)', async () => {
    const { puts } = stelleBereit({ vorgabe: null });
    rendern();
    const p = await paneel();
    await userEvent.click(
      within(p).getByRole('combobox', { name: 'Schichtmodell der Organisation' }),
    );
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Sanitätsdienst · Vorgabe der Organisation"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    await userEvent.click(option);
    await userEvent.click(within(p).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(puts).toEqual([{ schichtmodell_id: 3 }]));
    expect(await within(p).findByText('Rhythmus 6 h')).toBeInTheDocument();
  });

  it('entfernt die Vorgabe ohne Rückfrage; Rückgängig setzt die alten Werte wieder', async () => {
    const { puts } = stelleBereit();
    rendern();
    const p = await paneel();
    await within(p).findByText('Wechsel 0600/1800 · Mindestdauer 4 h');
    await userEvent.click(within(p).getByRole('button', { name: 'Vorgabe entfernen' }));
    await waitFor(() => expect(puts).toEqual([{ schichtmodell: null }]));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    await waitFor(() =>
      expect(puts[1]).toEqual({
        schichtmodell: {
          bezeichnung: '12-h-Schicht Hochwasser',
          typ: 'wechselzeiten',
          wechselzeiten: ['06:00', '18:00'],
          mindestdauer_minuten: 240,
          vorwarnung_minuten: 45,
          planungsvorlauf_minuten: 120,
        },
      }),
    );
  });

  it('eigene Werte: der Dialog ist mit der Vorgabe vorbelegt und schickt den ganzen Satz', async () => {
    const { puts } = stelleBereit();
    rendern();
    const p = await paneel();
    await userEvent.click(await within(p).findByRole('button', { name: 'Werte ändern' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Wechselzeiten' })).toHaveValue('0600/1800');
    expect(within(dialog).getByRole('textbox', { name: 'Mindestdauer' })).toHaveValue('4 h');
    // Weicht die Vorwarnung von der Vorgabe ab, steht der Klappteil offen und nennt sie.
    expect(within(dialog).getByRole('textbox', { name: 'Vorwarnung' })).toHaveValue('45 min');
    expect(dialog).toHaveTextContent('Vorwarnung 45 min · Planungsvorlauf 2 h (Vorgabe)');
    const zeiten = within(dialog).getByRole('textbox', { name: 'Wechselzeiten' });
    await userEvent.clear(zeiten);
    await userEvent.type(zeiten, '0700 1900');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(puts).toEqual([
        {
          schichtmodell: {
            bezeichnung: '12-h-Schicht Hochwasser',
            typ: 'wechselzeiten',
            wechselzeiten: ['07:00', '19:00'],
            mindestdauer_minuten: 240,
            vorwarnung_minuten: 45,
          },
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('eine Ablehnung steht im Dialog, der Dialog bleibt offen', async () => {
    stelleBereit({ putStatus: 422 });
    rendern();
    const p = await paneel();
    await userEvent.click(await within(p).findByRole('button', { name: 'Werte ändern' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('abgelehnt')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ohne Schreibrecht: Grund sichtbar, keine Wege zum Ändern', async () => {
    stelleBereit({ rolle: 'beobachter' });
    rendern();
    const p = await paneel();
    await within(p).findByText('Wechsel 0600/1800 · Mindestdauer 4 h');
    expect(screen.getByText(/nur Einsatzleitung und Führungspersonal/)).toBeInTheDocument();
    expect(within(p).queryByRole('button', { name: 'Werte ändern' })).toBeNull();
    expect(within(p).queryByRole('button', { name: 'Übernehmen' })).toBeNull();
    expect(within(p).queryByRole('button', { name: 'Vorgabe entfernen' })).toBeNull();
  });

  it('ohne Freigabe des Moduls Ablösung: Zustand statt Anfrage', async () => {
    const { lesend } = stelleBereit({
      freigaben: freigabenFixture({ abloesung: { zugriff: false } }),
    });
    rendern();
    expect(await screen.findByText('Modul „Ablösung“ nicht freigegeben')).toBeInTheDocument();
    expect(lesend()).toBe(0);
  });
});
