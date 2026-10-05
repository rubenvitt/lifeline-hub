import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import EinsatzGeraete from './EinsatzGeraete';

/** Sektion „Geräte“ (LFH-892, Spec `geraete-kopplung`). */

const einsatz = (meine_rolle = 'einsatzleitung', status = 'aktiv') => ({
  id: 1,
  bezeichnung: 'Hochwasser Weser',
  status,
  meine_rolle,
});

const kopplung = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  ansicht: 'uhs-tablet',
  uhs_id: 2,
  stelle: 'UHS Nord',
  bezeichnung: `Tablet ${id}`,
  anzeigename: `UHS Nord · Tablet ${id}`,
  status,
  laeuft_ab_at: '2026-10-05 12:00:00',
  erstellt_at: '2026-10-04 12:00:00',
  erstellt_von_name: 'Erika Leitung',
  ...extra,
});

const UHS = [
  { id: 2, bezeichnung: 'UHS Nord', status: 'aktiv', storniert_at: null },
  { id: 3, bezeichnung: 'UHS Alt', status: 'aufgeloest', storniert_at: null },
  { id: 4, bezeichnung: 'UHS Storno', status: 'aktiv', storniert_at: '2026-10-04 10:00:00' },
];

interface Aufbau {
  rolle?: string;
  kopplungen?: unknown[];
  sperren?: unknown[];
}

function stelleBereit(a: Aufbau = {}) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  const gelesen: string[] = [];
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz(a.rolle))),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/1/geraete', () => {
      gelesen.push('geraete');
      return HttpResponse.json({
        kopplungen: a.kopplungen ?? [kopplung(1, 'aktiv')],
        sperren: a.sperren ?? [],
      });
    }),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(UHS)),
    http.post('/api/einsaetze/1/geraete', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'anlegen', body });
      return HttpResponse.json(
        {
          kopplung: kopplung(5, 'wartend', { bezeichnung: body.bezeichnung }),
          code: { code: 'ABCD1234', laeuft_ab_at: '2026-10-04 12:10:00' },
        },
        { status: 201 },
      );
    }),
    http.post('/api/einsaetze/1/geraete/1/widerrufen', () => {
      aufrufe.push({ pfad: 'widerrufen', body: null });
      return HttpResponse.json(
        kopplung(1, 'widerrufen', {
          widerrufen_at: '2026-10-04 13:00:00',
          widerrufen_von_name: 'Erika Leitung',
        }),
      );
    }),
  );
  return { aufrufe, gelesen };
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/geraete" element={<EinsatzGeraete />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/geraete' },
  );
}

async function zeilenaktion(name: string, eintrag: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Gerät ${name}` }));
  const menue = await waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(m).not.toBeNull();
    return m!;
  });
  await userEvent.click(within(menue).getByRole('menuitem', { name: eintrag }));
}

async function waehle(feld: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: feld }));
  const knoten = await waitFor(() => {
    const k = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${option}"]`,
    );
    expect(k).not.toBeNull();
    return k!;
  });
  await userEvent.click(knoten);
}

/** Optionen genau des Auswahlfelds `feld` (das zuvor geschlossene Feld hängt in jsdom noch). */
function optionenVon(feld: string): HTMLElement[] {
  const liste = screen.getByRole('combobox', { name: feld }).getAttribute('aria-controls');
  const dropdown = document.getElementById(liste ?? '')?.closest('.ant-select-dropdown');
  return Array.from(dropdown?.querySelectorAll<HTMLElement>('.ant-select-item-option') ?? []);
}

describe('EinsatzGeraete (LFH-892)', () => {
  it('erklärt Führungspersonal das fehlende Recht und lädt keine Geräte', async () => {
    const { gelesen } = stelleBereit({ rolle: 'fuehrungspersonal' });
    rendern();
    expect(await screen.findByText(/Geräte koppelt nur die Einsatzleitung/)).toBeInTheDocument();
    expect(gelesen).toEqual([]);
  });

  it('zeigt jede Kopplung mit Ansicht und Zustand als Wort', async () => {
    stelleBereit({
      kopplungen: [
        kopplung(1, 'aktiv'),
        kopplung(2, 'widerrufen', {
          widerrufen_at: '2026-10-04 13:00:00',
          widerrufen_von_name: 'Erika Leitung',
        }),
      ],
    });
    rendern();
    expect(await screen.findByText('UHS Nord · Tablet 1')).toBeInTheDocument();
    const zustaende = Array.from(document.querySelectorAll('[data-lfh="geraet-zustand"]')).map(
      (z) => z.textContent ?? '',
    );
    expect(zustaende[0]).toMatch(/^UHS-Tablet · gekoppelt · bis /);
    expect(zustaende[1]).toMatch(/^UHS-Tablet · widerrufen · von Erika Leitung um /);
    // Eine widerrufene Kopplung ist zu Ende: kein Aktionsmenü.
    expect(
      screen.getByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 1' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 2' }),
    ).not.toBeInTheDocument();
  });

  it('koppelt ein Tablet an eine UHS und zeigt den Code einmal als Text und QR', async () => {
    const { aufrufe } = stelleBereit({ kopplungen: [] });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    await waehle('Ansicht', 'UHS-Tablet');
    // Nur UHS, die eine Kopplung nehmen: keine aufgelöste, keine stornierte.
    await userEvent.click(screen.getByRole('combobox', { name: 'Unfallhilfsstelle' }));
    await waitFor(() =>
      expect(optionenVon('Unfallhilfsstelle').map((k) => k.getAttribute('title'))).toEqual([
        'UHS Nord',
      ]),
    );
    await userEvent.click(optionenVon('Unfallhilfsstelle')[0]);
    await userEvent.type(screen.getByLabelText('Gerätebezeichnung'), ' Tablet 5 ');
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));

    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({ ansicht: 'uhs-tablet', uhs_id: 2, bezeichnung: 'Tablet 5' });
    const code = await screen.findByText('ABCD-1234');
    expect(code).toBeInTheDocument();
    const dialog = code.closest<HTMLElement>('[data-lfh="kopplungscode"]')!;
    expect(dialog.querySelector('svg')).not.toBeNull();
  });

  it('fragt bei einem Lagemonitor nach keiner UHS', async () => {
    const { aufrufe } = stelleBereit({ kopplungen: [] });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    await waehle('Ansicht', 'Lagemonitor');
    expect(screen.queryByRole('combobox', { name: 'Unfallhilfsstelle' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Gerätebezeichnung'), 'Monitor 1');
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({
      ansicht: 'lagemonitor',
      uhs_id: null,
      bezeichnung: 'Monitor 1',
    });
  });

  it('warnt, wenn die Modulfreigabe die gewählte Ansicht beschneidet', async () => {
    stelleBereit({
      kopplungen: [],
      sperren: [{ ansicht: 'uhs-tablet', gesperrte_module: ['personen'] }],
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    expect(document.querySelector('[data-lfh="geraet-sperre"]')).toBeNull();
    await waehle('Ansicht', 'UHS-Tablet');
    const hinweis = await waitFor(() => {
      const h = document.querySelector('[data-lfh="geraet-sperre"]');
      expect(h).not.toBeNull();
      return h!;
    });
    expect(hinweis.textContent).toMatch(/für einfache Mitglieder gesperrt/);
  });

  it('widerruft erst nach Rückfrage', async () => {
    const { aufrufe } = stelleBereit();
    rendern();
    await screen.findByText('UHS Nord · Tablet 1');
    await zeilenaktion('UHS Nord · Tablet 1', /Widerrufen/);
    const dialog = await screen.findByRole('dialog', { name: 'UHS Nord · Tablet 1 widerrufen?' });
    expect(aufrufe).toEqual([]);
    expect(within(dialog).getByText(/verliert sofort jeden Zugriff/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(aufrufe.map((x) => x.pfad)).toEqual(['widerrufen']));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 1' }),
      ).not.toBeInTheDocument(),
    );
  });
});
