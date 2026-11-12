import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import { eintraegeVon, erwarteBrowsermenue, oeffneKontextmenue } from '../../test/kontextmenue';
import { tippeZeit } from '../../test/zeitEingabe';
import { waehleMenueEintrag } from '../../test/menue';
import EinsatzGeraete from './EinsatzGeraete';

/** Sektion „Geräte“ (LFH-892, Spec `geraete-kopplung`). */

const einsatz = (meine_rolle = 'einsatzleitung', status = 'aktiv', spiegel: unknown = null) => ({
  id: 1,
  bezeichnung: 'Hochwasser Weser',
  status,
  meine_rolle,
  spiegel,
});

const SPIEGEL = {
  gegenstelle: 'ELW Nord',
  beendet: false,
  antraege_ausstehend: 0,
  antraege_abgelehnt: 0,
};

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
  status?: string;
  spiegel?: unknown;
  kopplungen?: unknown[];
  sperren?: unknown[];
  ansichten?: unknown[];
  anbindungen?: unknown[];
}

/** Die heute koppelbaren Ansichten, wie der Server sie anbietet (LFH-1040). */
const ANSICHTEN = [
  { ansicht: 'uhs-tablet', stellenart: 'uhs', stelle_pflicht: true },
  { ansicht: 'uhs-laptop', stellenart: 'uhs', stelle_pflicht: true },
  { ansicht: 'lagemonitor', stellenart: null, stelle_pflicht: false },
];

function stelleBereit(a: Aufbau = {}) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  const gelesen: string[] = [];
  server.use(
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json(einsatz(a.rolle, a.status ?? 'aktiv', a.spiegel ?? null)),
    ),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/1/geraete', () => {
      gelesen.push('geraete');
      return HttpResponse.json({
        kopplungen: a.kopplungen ?? [kopplung(1, 'aktiv')],
        sperren: a.sperren ?? [],
        ansichten: a.ansichten ?? ANSICHTEN,
      });
    }),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(UHS)),
    http.get('/api/einsaetze/1/anbindungen', () => HttpResponse.json(a.anbindungen ?? [])),
    http.get('/api/einsaetze/1/lagebild-freigaben', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/betreuung', () =>
      HttpResponse.json({
        stellen: [
          { id: 7, bezeichnung: 'Turnhalle Ost', status: 'geschlossen' },
          {
            id: 8,
            bezeichnung: 'Schule',
            status: 'in_betrieb',
            storniert_at: '2026-10-04 10:00:00',
          },
        ],
      }),
    ),
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

function rendern(route = '/einsaetze/1/einstellungen/geraete') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/geraete" element={<EinsatzGeraete />} />
    </Routes>,
    { route },
  );
}

async function zeilenaktion(name: string, eintrag: RegExp) {
  await waehleMenueEintrag(
    screen.getByRole('button', { name: `Aktionen zu Gerät ${name}` }),
    eintrag,
  );
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
  it('nennt Führungspersonal das fehlende Recht und lädt keine Geräte', async () => {
    const { gelesen } = stelleBereit({ rolle: 'fuehrungspersonal' });
    rendern();
    // Nichts geladen, also nichts anzusehen: Leerzustand mit Grund statt „Nur Ansicht“.
    expect(await screen.findByText('Nur die Einsatzleitung koppelt Geräte')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="rechte-hinweis"]')).toBeNull();
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
        kopplung(3, 'abgelaufen'),
      ],
    });
    rendern();
    expect(await screen.findByText('UHS Nord · Tablet 1')).toBeInTheDocument();
    const zustaende = Array.from(document.querySelectorAll('[data-lfh="geraet-zustand"]')).map(
      (z) => z.textContent ?? '',
    );
    expect(zustaende[0]).toMatch(/^UHS-Tablet · gekoppelt · bis /);
    expect(zustaende[1]).toMatch(/^UHS-Tablet · widerrufen · von Erika Leitung um /);
    expect(zustaende[2]).toMatch(/^UHS-Tablet · abgelaufen · bis /);
    // Eine widerrufene oder abgelaufene Kopplung ist zu Ende: kein Aktionsmenü. Der Server lehnt
    // Verlängern und neuen Code für beide ab (LFH-1143).
    expect(
      screen.getByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 1' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 2' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 3' }),
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
    expect(aufrufe[0].body).toEqual({
      ansicht: 'uhs-tablet',
      stelle_id: 2,
      bezeichnung: 'Tablet 5',
    });
    const code = await screen.findByText('ABCD-1234');
    expect(code).toBeInTheDocument();
    const dialog = code.closest<HTMLElement>('[data-lfh="kopplungscode"]')!;
    expect(dialog.querySelector('svg')).not.toBeNull();
    // Die Folge des Schließens in einem Satz: der Code steht nur jetzt da.
    expect(dialog.textContent).toMatch(/Gültig bis .+, einmal einlösbar, nur jetzt sichtbar\./);
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
      stelle_id: null,
      bezeichnung: 'Monitor 1',
    });
  });

  it('bietet nur die Ansichten an, die der Server freigibt', async () => {
    stelleBereit({ kopplungen: [] });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Ansicht' }));
    await waitFor(() =>
      expect(optionenVon('Ansicht').map((k) => k.getAttribute('title'))).toEqual([
        'UHS-Tablet',
        'UHS-Laptop',
        'Lagemonitor',
      ]),
    );
  });

  it('fragt nach der Stelle der Art, die die Ansicht braucht', async () => {
    const { aufrufe } = stelleBereit({
      kopplungen: [],
      ansichten: [
        ...ANSICHTEN,
        { ansicht: 'betreuungsstelle', stellenart: 'betreuungsstelle', stelle_pflicht: true },
      ],
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
    await waehle('Ansicht', 'Betreuungsstelle');
    expect(screen.queryByRole('combobox', { name: 'Unfallhilfsstelle' })).not.toBeInTheDocument();
    // Eine geschlossene Stelle nimmt eine Kopplung, eine stornierte nicht.
    await userEvent.click(screen.getByRole('combobox', { name: 'Betreuungsstelle' }));
    await waitFor(() =>
      expect(optionenVon('Betreuungsstelle').map((k) => k.getAttribute('title'))).toEqual([
        'Turnhalle Ost',
      ]),
    );
    await userEvent.click(optionenVon('Betreuungsstelle')[0]);
    await userEvent.type(screen.getByLabelText('Gerätebezeichnung'), 'Tablet BS');
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({
      ansicht: 'betreuungsstelle',
      stelle_id: 7,
      bezeichnung: 'Tablet BS',
    });
  });

  describe('Verpflegung an einer Verpflegungsstelle, wahlweise (LLH-1048 Teil II)', () => {
    const MIT_VERPFLEGUNG = [
      ...ANSICHTEN,
      { ansicht: 'verpflegung', stellenart: 'verpflegungsstelle', stelle_pflicht: false },
    ];
    function verpflegungBereit() {
      const r = stelleBereit({ kopplungen: [], ansichten: MIT_VERPFLEGUNG });
      server.use(
        http.get('/api/einsaetze/1/verpflegung', () =>
          HttpResponse.json({
            zeitfenster: [],
            empfaenger: { einheiten: [], abschnitte: [] },
            // Stornierte liefert der Server nicht; eine aufgelöste nimmt keine Kopplung.
            stellen: [
              {
                id: 21,
                bezeichnung: 'Feldküche BR Sportplatz',
                art: 'feldkueche',
                status: 'aktiv',
              },
              { id: 23, bezeichnung: 'Zuführung Deich', art: 'zufuehrung', status: 'geplant' },
              { id: 30, bezeichnung: 'Ausgabe Schule', art: 'ausgabestelle', status: 'aufgeloest' },
            ],
          }),
        ),
      );
      return r;
    }

    it('bietet „ohne Stelle (einsatzweit)“ als Vorgabe und die geplanten und aktiven Stellen', async () => {
      verpflegungBereit();
      rendern();
      await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
      await waehle('Ansicht', 'Verpflegung');
      const feld = await screen.findByRole('combobox', { name: 'Verpflegungsstelle' });
      // Kein Pflichtfeld: die Vorgabe steht als eigene Option, kein Löschkreuz (Handschuh).
      expect(feld.closest('.ant-form-item')?.querySelector('.ant-form-item-required')).toBeNull();
      expect(feld.closest('.ant-select')?.querySelector('.ant-select-clear')).toBeNull();
      await waitFor(() =>
        expect(feld.closest('.ant-select')?.textContent).toContain('ohne Stelle (einsatzweit)'),
      );
      await userEvent.click(feld);
      await waitFor(() =>
        expect(optionenVon('Verpflegungsstelle').map((k) => k.getAttribute('title'))).toEqual([
          'ohne Stelle (einsatzweit)',
          'Feldküche BR Sportplatz',
          'Zuführung Deich',
        ]),
      );
    });

    it('ohne Wahl koppelt sie einsatzweit (`stelle_id: null`)', async () => {
      const { aufrufe } = verpflegungBereit();
      rendern();
      await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
      await waehle('Ansicht', 'Verpflegung');
      await screen.findByRole('combobox', { name: 'Verpflegungsstelle' });
      await userEvent.type(screen.getByLabelText('Gerätebezeichnung'), 'Tresen');
      await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
      await waitFor(() => expect(aufrufe).toHaveLength(1));
      expect(aufrufe[0].body).toEqual({
        ansicht: 'verpflegung',
        stelle_id: null,
        bezeichnung: 'Tresen',
      });
    });

    it('mit gewählter Stelle koppelt sie an diese', async () => {
      const { aufrufe } = verpflegungBereit();
      rendern();
      await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
      await waehle('Ansicht', 'Verpflegung');
      await screen.findByRole('combobox', { name: 'Verpflegungsstelle' });
      await waehle('Verpflegungsstelle', 'Feldküche BR Sportplatz');
      await userEvent.type(screen.getByLabelText('Gerätebezeichnung'), 'Tresen');
      await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
      await waitFor(() => expect(aufrufe).toHaveLength(1));
      expect(aufrufe[0].body).toEqual({
        ansicht: 'verpflegung',
        stelle_id: 21,
        bezeichnung: 'Tresen',
      });
    });

    it('ein Wechsel auf den Lagemonitor nimmt die gewählte Stelle nicht mit', async () => {
      const { aufrufe } = verpflegungBereit();
      rendern();
      await userEvent.click(await screen.findByRole('button', { name: 'Gerät koppeln' }));
      await waehle('Ansicht', 'Verpflegung');
      await screen.findByRole('combobox', { name: 'Verpflegungsstelle' });
      await waehle('Verpflegungsstelle', 'Feldküche BR Sportplatz');
      await waehle('Ansicht', 'Lagemonitor');
      await waitFor(() =>
        expect(screen.queryByRole('combobox', { name: 'Verpflegungsstelle' })).toBeNull(),
      );
      await userEvent.type(screen.getByLabelText('Gerätebezeichnung'), 'Wand');
      await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
      await waitFor(() => expect(aufrufe).toHaveLength(1));
      expect(aufrufe[0].body).toEqual({
        ansicht: 'lagemonitor',
        stelle_id: null,
        bezeichnung: 'Wand',
      });
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
    expect(hinweis.textContent).toMatch(/für gekoppelte Geräte gesperrt/);
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

  it('LLH-1077: Verlängern nimmt „1430“ + Enter als neues Ende', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    // 10:00 Ortszeit: das Ende 14:30 liegt heute vor uns.
    vi.setSystemTime(dayjs('2026-10-04 10:00').toDate());
    try {
      let body: Record<string, unknown> | null = null;
      stelleBereit();
      server.use(
        http.post('/api/einsaetze/1/geraete/1/verlaengern', async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(kopplung(1, 'aktiv', { laeuft_ab_at: body.laeuft_ab_at }));
        }),
      );
      rendern();
      await screen.findByText('UHS Nord · Tablet 1');
      await zeilenaktion('UHS Nord · Tablet 1', /Verlängern/);
      const dialog = await screen.findByRole('dialog', { name: /Verlängern/ });
      await tippeZeit(
        userEvent.setup(),
        within(dialog).getByRole('textbox', { name: 'Neues Ende' }),
        '1430',
      );
      await waitFor(() => expect(body).not.toBeNull());
      expect(body!.laeuft_ab_at).toBe(
        dayjs('2026-10-04 14:30').utc().format('YYYY-MM-DD HH:mm:ss'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('koppelt am Spiegel nicht, die Freigabe für Anbindungen bleibt (LLH-1492, LLH-1638)', async () => {
    stelleBereit({
      spiegel: SPIEGEL,
      anbindungen: [
        {
          zugang_id: 'z-1',
          name: 'FüKW 1',
          scopes: ['lage:read'],
          zustand: 'aktiv',
          freigegeben: false,
          anderer_einsatz: false,
        },
      ],
    });
    rendern();
    expect(await screen.findByText('UHS Nord · Tablet 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerät koppeln/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 1' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('switch', { name: 'Anbindung FüKW 1 liest diesen Einsatz' }),
    ).toBeEnabled();
    // Ein Link auf das Lagebild gilt an dieser Instanz; das ETB geht als Antrag (LLH-1496).
    expect(await screen.findByRole('button', { name: /Link ausgeben/ })).toBeEnabled();
  });

  describe('Anbindungen (LLH-1638)', () => {
    const anbindung = (nr: number, extra: Record<string, unknown> = {}) => ({
      zugang_id: `z-${nr}`,
      name: `FüKW ${nr}`,
      scopes: ['lage:read'],
      zustand: 'aktiv',
      freigegeben: false,
      anderer_einsatz: false,
      ...extra,
    });

    it('bleibt ohne freigebbare Anbindung weg', async () => {
      stelleBereit();
      rendern();
      await screen.findByText('UHS Nord · Tablet 1');
      expect(screen.queryByText('Anbindungen')).not.toBeInTheDocument();
    });

    it('nennt einen Ladefehler statt die Sektion still wegzulassen, mit „Erneut abrufen“', async () => {
      stelleBereit();
      let kaputt = true;
      server.use(
        http.get('/api/einsaetze/1/anbindungen', () =>
          kaputt
            ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
            : HttpResponse.json([anbindung(1)]),
        ),
      );
      rendern();
      expect(await screen.findByText('Anbindungen nicht ladbar')).toBeInTheDocument();
      kaputt = false;
      const paneel = screen.getByRole('region', { name: 'Anbindungen' });
      await userEvent.setup().click(within(paneel).getByRole('button', { name: 'Erneut abrufen' }));
      expect(
        await screen.findByRole('switch', { name: 'Anbindung FüKW 1 liest diesen Einsatz' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Anbindungen nicht ladbar')).not.toBeInTheDocument();
    });

    it('sperrt die Schalter am abgeschlossenen Einsatz und zeigt den Stand weiter', async () => {
      stelleBereit({ status: 'abgeschlossen', anbindungen: [anbindung(1)] });
      rendern();
      const schalter = await screen.findByRole('switch', {
        name: 'Anbindung FüKW 1 liest diesen Einsatz',
      });
      expect(schalter).toBeDisabled();
      expect(screen.getByText('nicht freigegeben')).toBeInTheDocument();
    });

    it('sperrt die Schalter ohne Verbindung und nennt den Grund', async () => {
      stelleBereit({ anbindungen: [anbindung(1)] });
      let aufrufe = 0;
      server.use(
        http.put('/api/einsaetze/1/anbindungen/z-1/freigabe', () => {
          aufrufe += 1;
          return HttpResponse.json([anbindung(1, { freigegeben: true })]);
        }),
      );
      rendern();
      const schalter = await screen.findByRole('switch', {
        name: 'Anbindung FüKW 1 liest diesen Einsatz',
      });
      try {
        setzeOnline(false);
        const grund = await screen.findByText('Ohne Verbindung nicht änderbar');
        expect(schalter).toBeDisabled();
        expect(schalter).toHaveAttribute('aria-describedby', grund.id);
        await userEvent.setup().click(schalter);
        expect(aufrufe).toBe(0);
      } finally {
        setzeOnline(true);
      }
      await waitFor(() => expect(schalter).toBeEnabled());
      expect(screen.queryByText('Ohne Verbindung nicht änderbar')).not.toBeInTheDocument();
    });

    it('zeigt Rechte und Zustand je Anbindung', async () => {
      stelleBereit({
        anbindungen: [
          anbindung(1, { zustand: 'wartet' }),
          anbindung(2, { anderer_einsatz: true, zuletzt_genutzt_at: '2026-10-04 12:05:00' }),
        ],
      });
      rendern();
      await screen.findByText('Anbindungen');
      const zustaende = Array.from(
        document.querySelectorAll('[data-lfh="einsatz-anbindung-zustand"]'),
      ).map((e) => e.textContent);
      expect(zustaende[0]).toBe('nicht freigegeben · wartet auf Schlüssel');
      expect(zustaende[1]).toMatch(/^liest einen anderen Einsatz · zuletzt /);
      expect(screen.getAllByText(/Lage lesen/)).toHaveLength(2);
    });

    it('gibt den Einsatz per Schalter frei und beendet die Freigabe wieder', async () => {
      stelleBereit({ anbindungen: [anbindung(1)] });
      const methoden: string[] = [];
      server.use(
        http.put('/api/einsaetze/1/anbindungen/z-1/freigabe', ({ request }) => {
          methoden.push(request.method);
          return HttpResponse.json([anbindung(1, { freigegeben: true })]);
        }),
        http.delete('/api/einsaetze/1/anbindungen/z-1/freigabe', ({ request }) => {
          methoden.push(request.method);
          return HttpResponse.json([anbindung(1)]);
        }),
      );
      rendern();
      await screen.findByText('Anbindungen');
      const schalter = screen.getByRole('switch', {
        name: 'Anbindung FüKW 1 liest diesen Einsatz',
      });
      expect(schalter).not.toBeChecked();
      const user = userEvent.setup();
      await user.click(schalter);
      await waitFor(() => expect(schalter).toBeChecked());
      expect(screen.getByText('liest diesen Einsatz')).toBeInTheDocument();
      await user.click(schalter);
      await waitFor(() => expect(schalter).not.toBeChecked());
      expect(methoden).toEqual(['PUT', 'DELETE']);
    });

    it('sperrt die Schalter ohne Einsatzleitung nicht nur: die Sektion lädt dann gar nicht', async () => {
      stelleBereit({ rolle: 'fuehrungspersonal', anbindungen: [anbindung(1)] });
      rendern();
      expect(await screen.findByText('Nur die Einsatzleitung koppelt Geräte')).toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('nennt einen Fehler beim Umschalten', async () => {
      stelleBereit({ anbindungen: [anbindung(1)] });
      server.use(
        http.put('/api/einsaetze/1/anbindungen/z-1/freigabe', () =>
          HttpResponse.json(
            { error: 'Einsatz ist abgeschlossen und schreibgeschützt' },
            { status: 409 },
          ),
        ),
      );
      rendern();
      await screen.findByText('Anbindungen');
      await userEvent
        .setup()
        .click(screen.getByRole('switch', { name: 'Anbindung FüKW 1 liest diesen Einsatz' }));
      expect(await screen.findByText('Nicht umgeschaltet')).toBeInTheDocument();
    });

    it('lädt nach einem gescheiterten Umschalten neu: die überholte Zeile verschwindet', async () => {
      stelleBereit({ anbindungen: [anbindung(1), anbindung(2)] });
      let widerrufen = false;
      server.use(
        http.get('/api/einsaetze/1/anbindungen', () =>
          HttpResponse.json(widerrufen ? [anbindung(2)] : [anbindung(1), anbindung(2)]),
        ),
        http.put('/api/einsaetze/1/anbindungen/z-1/freigabe', () => {
          // Der Admin hat die Anbindung inzwischen widerrufen.
          widerrufen = true;
          return HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
        }),
      );
      rendern();
      const schalter = await screen.findByRole('switch', {
        name: 'Anbindung FüKW 1 liest diesen Einsatz',
      });
      await userEvent.setup().click(schalter);
      expect(await screen.findByText('Nicht umgeschaltet')).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.queryByRole('switch', { name: 'Anbindung FüKW 1 liest diesen Einsatz' }),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole('switch', { name: 'Anbindung FüKW 2 liest diesen Einsatz' }),
      ).toBeInTheDocument();
    });

    it('behält die Liste, wenn das Neuladen scheitert, und nennt den veralteten Stand', async () => {
      stelleBereit({ anbindungen: [anbindung(1)] });
      let kaputt = false;
      server.use(
        http.get('/api/einsaetze/1/anbindungen', () =>
          kaputt
            ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
            : HttpResponse.json([anbindung(1)]),
        ),
        http.put('/api/einsaetze/1/anbindungen/z-1/freigabe', () => {
          kaputt = true;
          return HttpResponse.json({ error: 'Konflikt' }, { status: 409 });
        }),
      );
      rendern();
      const schalter = await screen.findByRole('switch', {
        name: 'Anbindung FüKW 1 liest diesen Einsatz',
      });
      await userEvent.setup().click(schalter);
      expect(
        await screen.findByText('Stand nicht aktuell: neu laden gescheitert'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('switch', { name: 'Anbindung FüKW 1 liest diesen Einsatz' }),
      ).toBeInTheDocument();
    });
  });
});

describe('Gerät koppeln aus dem Einheiten-Detail (LLH-1579)', () => {
  const MIT_EINHEIT = [
    ...ANSICHTEN,
    { ansicht: 'einheit', stellenart: 'einheit', stelle_pflicht: true },
  ];

  it('öffnet die Kopplung mit Ansicht und Einheit vorbelegt', async () => {
    const { aufrufe } = stelleBereit({ kopplungen: [], ansichten: MIT_EINHEIT });
    server.use(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([
          { id: 11, name: 'Fußtrupp 1', funkrufname: 'Rotkreuz Musterstadt 74/1' },
          { id: 12, name: 'Melder' },
        ]),
      ),
    );
    rendern('/einsaetze/1/einstellungen/geraete?einheit=11');
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByTitle('Fußtrupp 1 (Rotkreuz Musterstadt 74/1)'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Gerätebezeichnung'), 'Handy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Koppeln' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({ ansicht: 'einheit', stelle_id: 11, bezeichnung: 'Handy' });
  });

  it('öffnet „Gerät koppeln“ danach wieder leer', async () => {
    stelleBereit({ kopplungen: [], ansichten: MIT_EINHEIT });
    server.use(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([
          { id: 11, name: 'Fußtrupp 1', funkrufname: 'Rotkreuz Musterstadt 74/1' },
        ]),
      ),
    );
    rendern('/einsaetze/1/einstellungen/geraete?einheit=11');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTitle('Fußtrupp 1 (Rotkreuz Musterstadt 74/1)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    // jsdom beendet die Ausblendung nie (kein `transitionend`), wie in `EinsatzDefaults.test.tsx`.
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    await userEvent.click(screen.getByRole('button', { name: 'Gerät koppeln' }));
    await waitFor(() => expect(dialog).not.toHaveClass('ant-zoom-leave'));
    const neu = screen.getByRole('dialog');
    expect(within(neu).queryAllByTitle('Einheit')).toHaveLength(0);
    expect(within(neu).queryByText('Einheit wählen')).not.toBeInTheDocument();
    expect(within(neu).getByText('Ansicht wählen')).toBeInTheDocument();
  });
});

describe('EinsatzGeraete · Kontextmenü (LLH-1599)', () => {
  const eintragVon = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[data-lfh="geraet-eintrag"]')].find((e) =>
      e.textContent?.includes(name),
    )!;

  it('Rechtsklick auf eine aktive Kopplung zeigt die Einträge des ⋮; beendete ohne eigenes Menü', async () => {
    stelleBereit({ kopplungen: [kopplung(1, 'aktiv'), kopplung(2, 'widerrufen')] });
    rendern();
    await screen.findByText('UHS Nord · Tablet 1');
    const menue = await oeffneKontextmenue(eintragVon('UHS Nord · Tablet 1'));
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Gerät UHS Nord · Tablet 1');
    expect(eintraegeVon(menue)).toEqual([
      'Neuen Code ausstellen',
      'Verlängern …',
      'rot:Widerrufen …',
    ]);
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Widerrufen/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Tablet 1');
    erwarteBrowsermenue(eintragVon('UHS Nord · Tablet 2'));
  });
});
