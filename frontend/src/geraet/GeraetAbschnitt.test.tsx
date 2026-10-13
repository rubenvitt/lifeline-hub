import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import type {
  Auftrag,
  AuftragEmpfaenger,
  BefehlAnzeige,
  BefehlKopf,
  Einheit,
  Einsatzabschnitt,
  GeraetAnzeige,
  LageZone,
} from '../api/types';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { ordneEinheiten } from './GeraetAbschnittPage';
import { istEigenerEmpfaenger } from './GeraetAuftraegePage';
import { abschnittsZonen, flaechenRahmen } from './GeraetAbschnittKarte';
import { navigationZeigt } from './GeraeteLayout';

/**
 * Die Abschnittsansicht in der Gerätehülle (LFH-1043, Spec `funktionsansichten`): Startseite,
 * Navigation, Aufträge mit Quittung nur für die eigenen Empfänger, Meldung mit Abschnitt als
 * Absender. Den Zuschnitt auf den Teilbaum leistet der Server (`tests/geraet_kopplung.rs`); hier
 * liefert er ihn schon fertig.
 */

function geraet(ueber: Partial<GeraetAnzeige> = {}): GeraetAnzeige {
  return {
    kopplung_id: 4,
    einsatz_id: 7,
    ansicht: 'einsatzabschnitt',
    uhs_id: null,
    stelle_id: 20,
    stelle: 'EA Nord',
    bezeichnung: 'Tablet A',
    laeuft_ab_at: '2099-01-01 18:00:00',
    ...ueber,
  } as GeraetAnzeige;
}

function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return { id, einsatz_id: 7, name: `Abschnitt ${id}`, sortier: id, sprechgruppen: [], ...p };
}

function einheit(id: number, p: Partial<Einheit> = {}): Einheit {
  return {
    id,
    einsatz_id: 7,
    name: `Einheit ${id}`,
    sortier: id,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 6 },
    status: { quelle: 'ohne', verteilung: [] },
    ...p,
  } as Einheit;
}

function empfaenger(id: number, p: Partial<AuftragEmpfaenger>): AuftragEmpfaenger {
  return {
    id,
    auftrag_id: 31,
    empfaenger_typ: 'abschnitt',
    snap_anzeige: `Empfänger ${id}`,
    quittiert_at: null,
    ...p,
  } as AuftragEmpfaenger;
}

const auftrag: Auftrag = {
  id: 31,
  einsatz_id: 7,
  lfd_nr: 9,
  auftrag_text: 'Deich Nord sichern',
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: '2026-10-04 08:00:00',
  in_arbeit_at: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-10-04 08:00:00',
  vollzug_status: 'offen',
  empfaenger_anzahl: 2,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  empfaenger: [
    empfaenger(1, { abschnitt_id: 21, snap_anzeige: 'UA Nord-Ost' }),
    empfaenger(2, { abschnitt_id: 30, snap_anzeige: 'EA Süd' }),
  ],
} as Auftrag;

const NORD = abschnitt(20, {
  name: 'EA Nord',
  kurzbezeichnung: 'EAN',
} as Partial<Einsatzabschnitt>);
const NORD_OST = abschnitt(21, { name: 'UA Nord-Ost', ueber_abschnitt_id: 20 });

function stelleBereit(g: GeraetAnzeige = geraet()) {
  const quittiert: string[] = [];
  const gesendet: unknown[] = [];
  server.use(
    meHandler({ ...benutzerFixture({ id: 60, anzeigename: 'EA Nord · Tablet A' }), geraet: g }),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(einsatzFixture({ id: 7, meine_rolle: 'fuehrungspersonal' })),
    ),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([NORD, NORD_OST])),
    http.get('/api/einsaetze/7/einheiten', () =>
      HttpResponse.json([
        einheit(5, { name: '2. Zug', abschnitt_id: 21, abschnitt_name: 'UA Nord-Ost' }),
        einheit(4, { name: '1. Zug', abschnitt_id: 20, abschnitt_name: 'EA Nord' }),
      ]),
    ),
    http.get('/api/einsaetze/7/auftraege', () => HttpResponse.json([auftrag])),
    http.post('/api/einsaetze/7/auftraege/:aid/empfaenger/:eid/quittieren', ({ params }) => {
      quittiert.push(`${params.aid}/${params.eid}`);
      return HttpResponse.json(auftrag);
    }),
    http.get('/api/einsaetze/7/befehle', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([])),
    http.post('/api/einsaetze/7/meldungen', async ({ request }) => {
      gesendet.push(await request.json());
      return HttpResponse.json({ id: 41, lfd_nr: 5 }, { status: 201 });
    }),
  );
  return { quittiert, gesendet };
}

function renderApp(route: string) {
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <ThemeModeProvider>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
  return router;
}

const pfad = (router: ReturnType<typeof renderApp>) => router.state.location.pathname;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Abschnittsgerät — Startseite und Navigation', () => {
  it('beginnt mit dem eigenen Abschnitt und seinen Einheiten, der eigene zuerst', async () => {
    stelleBereit();
    const router = renderApp('/geraet');
    expect(await screen.findByRole('heading', { level: 1, name: 'EA Nord' })).toBeVisible();
    expect(pfad(router)).toBe('/geraet/7/abschnitt');
    const liste = await screen.findByRole('list', { name: 'Einheiten' });
    const zeilen = within(liste).getAllByRole('listitem');
    expect(zeilen.map((z) => within(z).getByRole('strong').textContent)).toEqual([
      '1. Zug',
      '2. Zug',
    ]);
    expect(within(zeilen[1]).getByText(/UA Nord-Ost/)).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Abschnitt', 'Aufträge', 'Melden', 'Karte']);
  });

  it('fremde Seiten führen auf den Abschnitt, und ein UHS-Tablet kommt nicht auf ihn', async () => {
    stelleBereit();
    const router = renderApp('/geraet/7/patienten');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/abschnitt'));

    stelleBereit(geraet({ ansicht: 'uhs-tablet', uhs_id: 2, stelle_id: 2, stelle: 'UHS Nord' }));
    server.use(
      http.get('/api/einsaetze/7/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/uhs/2', () => HttpResponse.json({ id: 2, plaetze: [] })),
    );
    const zweiter = renderApp('/geraet/7/auftraege');
    await waitFor(() => expect(pfad(zweiter)).toBe('/geraet/7/patienten'));
  });

  it('ein gesperrtes Modul fehlt in der Navigation', async () => {
    stelleBereit();
    const freigaben = freigabenFixture();
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json({
          ...freigaben,
          auftraege: { ...freigaben.auftraege, zugriff: false },
          lagekarte: { ...freigaben.lagekarte, sichtbar: false },
        }),
      ),
    );
    renderApp('/geraet/7/abschnitt');
    const nav = await screen.findByRole('navigation', { name: 'Gerätenavigation' });
    await waitFor(() =>
      expect(
        within(nav)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(['Abschnitt', 'Melden']),
    );
  });
});

describe('Abschnittsgerät — Aufträge und Melden', () => {
  it('quittiert nur die eigene Empfängerzeile', async () => {
    const { quittiert } = stelleBereit();
    renderApp('/geraet/7/auftraege');
    expect(await screen.findByText('Deich Nord sichern')).toBeVisible();
    // Der fremde Abschnitt steht als offen da, aber ohne Knopf.
    expect(screen.getByText('EA Süd')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }),
      ).toBeVisible(),
    );
    expect(screen.queryByRole('button', { name: 'Empfang für EA Süd quittieren' })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }));
    await user.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    await waitFor(() => expect(quittiert).toEqual(['31/1']));
  });

  it('meldet mit Abschnitt und Gerät als Absender', async () => {
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/melden');
    expect(await screen.findByRole('heading', { level: 1, name: 'Melden' })).toBeVisible();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Inhalt'), 'Deich hält');
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      absender: 'EA Nord · Tablet A',
      empfaenger: 'Einsatzleitung',
      inhalt: 'Deich hält',
    });
    // Kein Absenderbezug vom Gerät: den setzt der Server auf den gebundenen Abschnitt.
    expect(gesendet[0]).not.toHaveProperty('abschnitt_id');
    expect(gesendet[0]).not.toHaveProperty('einheit_id');
  });
});

/** Ein geltender Befehl an UA Nord-Ost (eigen) und EA Süd (fremd). */
function befehlKopf(quittiertOst: string | null = null): BefehlKopf {
  return {
    id: 51,
    einsatz_id: 7,
    vorlage: 'befehl_lad',
    titel: 'Deichverteidigung Nord',
    zeitstand: '2026-10-04 09:00:00',
    status: 'freigegeben',
    version: 2,
    vorgaenger_id: 50,
    ersteller_id: 1,
    ersteller_name: 'Einsatzleiter',
    erstellt_at: '2026-10-04 08:50:00',
    freigegeben_von_id: 1,
    freigegeben_von_name: 'Einsatzleiter',
    freigegeben_at: '2026-10-04 09:05:00',
    etb_eintrag_id: 17,
    is_quittierbar: true,
    verteiler: [
      {
        id: 81,
        empfaenger_typ: 'abschnitt',
        abschnitt_id: 21,
        snap_anzeige: 'UA Nord-Ost',
        quittiert_at: quittiertOst,
      },
      { id: 82, empfaenger_typ: 'abschnitt', abschnitt_id: 30, snap_anzeige: 'EA Süd' },
    ],
  } as BefehlKopf;
}

function befehlAnzeige(quittiertOst: string | null = null): BefehlAnzeige {
  return {
    ...befehlKopf(quittiertOst),
    aktualisiert_at: '2026-10-04 09:05:00',
    abschnitte: [
      { schluessel: 'lage', text: 'Pegel steigt' },
      { schluessel: 'auftrag', text: 'Deich halten' },
      { schluessel: 'durchfuehrung', text: 'Sandsäcke' },
    ],
  } as BefehlAnzeige;
}

/** Befehle am Gerät: Liste, Quittung und Rücknahme mitschreiben. */
function befehleBereit() {
  const aufrufe: string[] = [];
  let quittiert: string | null = null;
  server.use(
    http.get('/api/einsaetze/7/befehle', () => HttpResponse.json([befehlKopf(quittiert)])),
    http.get('/api/einsaetze/7/befehle/51', () => {
      aufrufe.push('detail');
      return HttpResponse.json(befehlAnzeige(quittiert));
    }),
    http.post('/api/einsaetze/7/befehle/:bid/verteiler/:vid/quittieren', ({ params }) => {
      aufrufe.push(`quittieren ${params.bid}/${params.vid}`);
      quittiert = '2026-10-04 09:30:00';
      return HttpResponse.json(befehlAnzeige(quittiert));
    }),
    http.post('/api/einsaetze/7/befehle/:bid/verteiler/:vid/zuruecknehmen', ({ params }) => {
      aufrufe.push(`zuruecknehmen ${params.bid}/${params.vid}`);
      quittiert = null;
      return HttpResponse.json(befehlAnzeige(null));
    }),
  );
  return aufrufe;
}

describe('Abschnittsgerät — Einsatzbefehle (LLH-1190)', () => {
  it('ohne Befehl an den Bereich fehlt der Block', async () => {
    stelleBereit();
    renderApp('/geraet/7/auftraege');
    expect(await screen.findByText('Deich Nord sichern')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Einsatzbefehle' })).toBeNull();
  });

  it('quittiert nur den eigenen Eintrag, ohne Rückfrage, und „Rückgängig“ nimmt zurück', async () => {
    stelleBereit();
    const aufrufe = befehleBereit();
    renderApp('/geraet/7/auftraege');
    const block = (await screen.findByRole('heading', { level: 2, name: 'Einsatzbefehle' }))
      .parentElement!;
    const karte = within(block).getByText('Deichverteidigung Nord').closest('article')!;
    expect(within(karte).getByText('v2')).toBeVisible();
    // Der fremde Empfänger steht offen da, aber ohne Knopf.
    expect(within(karte).getByText('EA Süd')).toBeVisible();
    const knopf = await within(karte).findByRole('button', {
      name: 'Empfang für UA Nord-Ost quittieren',
    });
    expect(
      within(karte).queryByRole('button', { name: 'Empfang für EA Süd quittieren' }),
    ).toBeNull();

    const user = userEvent.setup();
    await user.click(knopf);
    await waitFor(() => expect(aufrufe).toContain('quittieren 51/81'));
    await user.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(aufrufe).toContain('zuruecknehmen 51/81'));
    expect(
      await within(karte).findByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }),
    ).toBeVisible();
  });

  it('lädt den Befehlstext erst beim Aufklappen', async () => {
    stelleBereit();
    const aufrufe = befehleBereit();
    renderApp('/geraet/7/auftraege');
    const knopf = await screen.findByRole('button', { name: 'Befehlstext' });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    expect(aufrufe).not.toContain('detail');
    const user = userEvent.setup();
    await user.click(knopf);
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Deich halten')).toBeVisible();
  });

  it('eine abgelehnte Quittung steht an der Karte', async () => {
    stelleBereit();
    befehleBereit();
    server.use(
      http.post('/api/einsaetze/7/befehle/:bid/verteiler/:vid/quittieren', () =>
        HttpResponse.json({ error: 'Eine neuere Fassung ist freigegeben' }, { status: 422 }),
      ),
    );
    renderApp('/geraet/7/auftraege');
    const karte = (await screen.findByText('Deichverteidigung Nord')).closest('article')!;
    const user = userEvent.setup();
    await user.click(
      await within(karte).findByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }),
    );
    expect(await within(karte).findByText('Eine neuere Fassung ist freigegeben')).toBeVisible();
  });
});

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): am Gerät wie
 * am Board — Quittung und Statuswechsel an der Karte, Vollzug melden im Dialog; kein Toast.
 */
describe('Abschnittsgerät — Speicherfehler am Ort (LFH-1077)', () => {
  const zweiter = {
    ...auftrag,
    id: 32,
    lfd_nr: 10,
    auftrag_text: 'Pegel Nord messen',
    empfaenger: [empfaenger(3, { auftrag_id: 32, abschnitt_id: 21, snap_anzeige: 'UA Nord' })],
    empfaenger_anzahl: 1,
  } as Auftrag;
  const karte = (id: number) =>
    document.querySelector<HTMLElement>(`[data-auftrag-id="${id}"]`) as HTMLElement;

  function mitZweiAuftraegen() {
    stelleBereit();
    server.use(http.get('/api/einsaetze/7/auftraege', () => HttpResponse.json([auftrag, zweiter])));
  }

  it('Quittieren: der Grund steht an der Karte, die andere bleibt leer', async () => {
    mitZweiAuftraegen();
    server.use(
      http.post('/api/einsaetze/7/auftraege/31/empfaenger/1/quittieren', () =>
        HttpResponse.json({ error: 'Bereits quittiert' }, { status: 409 }),
      ),
    );
    renderApp('/geraet/7/auftraege');
    await screen.findByText('Pegel Nord messen');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Empfang für UA Nord-Ost quittieren' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));

    expect(await within(karte(31)).findByText('Bereits quittiert')).toHaveAttribute('data-fehler');
    expect(karte(32).querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('In Bearbeitung: der Grund steht an der Karte', async () => {
    mitZweiAuftraegen();
    server.use(
      http.post('/api/einsaetze/7/auftraege/31/vollzug', () =>
        HttpResponse.json({ error: 'Auftrag ist bereits vollzogen' }, { status: 422 }),
      ),
    );
    renderApp('/geraet/7/auftraege');
    await screen.findByText('Pegel Nord messen');
    const user = userEvent.setup();
    await user.click(within(karte(31)).getByRole('button', { name: 'Bearbeitung beginnen' }));

    expect(await within(karte(31)).findByText('Auftrag ist bereits vollzogen')).toHaveAttribute(
      'data-fehler',
    );
    expect(karte(32).querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('In Bearbeitung: die nächste Aktion an der Karte räumt ihren Grund', async () => {
    mitZweiAuftraegen();
    let versuch = 0;
    server.use(
      http.post('/api/einsaetze/7/auftraege/31/vollzug', () => {
        versuch += 1;
        // Der zweite Versuch bleibt offen: geräumt wird beim Absenden, nicht erst beim Erfolg.
        return versuch === 1
          ? HttpResponse.json({ error: 'Auftrag ist bereits vollzogen' }, { status: 422 })
          : new Promise<Response>(() => {});
      }),
    );
    renderApp('/geraet/7/auftraege');
    await screen.findByText('Pegel Nord messen');
    const user = userEvent.setup();
    await user.click(within(karte(31)).getByRole('button', { name: 'Bearbeitung beginnen' }));
    await within(karte(31)).findByText('Auftrag ist bereits vollzogen');

    await user.click(within(karte(31)).getByRole('button', { name: 'Bearbeitung beginnen' }));
    await waitFor(() => expect(versuch).toBe(2));
    await waitFor(() => expect(karte(31).querySelector('[data-fehler]')).toBeNull());
  });

  it('Vollzug melden: der Erfolg schließt nur den Dialog seines Auftrags', async () => {
    mitZweiAuftraegen();
    let gibFrei: () => void = () => {};
    const freigabe = new Promise<void>((r) => (gibFrei = r));
    server.use(
      http.post('/api/einsaetze/7/auftraege/31/vollzug', async () => {
        await freigabe;
        return HttpResponse.json({ ...auftrag, bearbeitungsstatus: 'vollzogen' });
      }),
    );
    renderApp('/geraet/7/auftraege');
    await screen.findByText('Pegel Nord messen');
    const user = userEvent.setup();
    await user.click(within(karte(31)).getByRole('button', { name: 'Vollzug melden' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung'),
      'Deich gehalten',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
    // Der Dialog wechselt den Auftrag, bevor die erste Meldung angekommen ist.
    await user.click(within(karte(32)).getByRole('button', { name: 'Vollzug melden' }));
    gibFrei();
    await screen.findByText('Vollzug gemeldet');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('.ant-zoom-leave')).toBeNull();
  });

  it('Vollzug melden: der Grund steht im Dialog, der Text bleibt', async () => {
    mitZweiAuftraegen();
    server.use(
      http.post('/api/einsaetze/7/auftraege/31/vollzug', () =>
        HttpResponse.json({ error: 'Auftrag ist bereits abgenommen' }, { status: 422 }),
      ),
    );
    renderApp('/geraet/7/auftraege');
    await screen.findByText('Pegel Nord messen');
    const user = userEvent.setup();
    await user.click(within(karte(31)).getByRole('button', { name: 'Vollzug melden' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung');
    await user.type(feld, 'Deich gehalten');
    await user.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Auftrag ist bereits abgenommen',
    );
    expect(feld).toHaveValue('Deich gehalten');
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});

describe('Bausteine', () => {
  it('ordneEinheiten: der eigene Abschnitt zuerst, dann nach Abschnitt, Sortierung und Name', () => {
    const liste = ordneEinheiten(
      [
        einheit(1, { name: 'B', abschnitt_id: 21, abschnitt_name: 'UA Ost', sortier: 1 }),
        einheit(2, { name: 'A', abschnitt_id: 21, abschnitt_name: 'UA Ost', sortier: 1 }),
        einheit(3, { name: 'Z', abschnitt_id: 20, abschnitt_name: 'EA Nord', sortier: 9 }),
        einheit(4, { name: 'C', abschnitt_id: 22, abschnitt_name: 'UA Mitte', sortier: 0 }),
      ],
      20,
    );
    expect(liste.map((e) => e.name)).toEqual(['Z', 'C', 'A', 'B']);
  });

  it('istEigenerEmpfaenger: Abschnitt des Teilbaums oder eigene Einheit', () => {
    const a = new Set([20, 21]);
    const e = new Set([4]);
    expect(istEigenerEmpfaenger({ abschnitt_id: 21, einheit_id: null }, a, e)).toBe(true);
    expect(istEigenerEmpfaenger({ abschnitt_id: null, einheit_id: 4 }, a, e)).toBe(true);
    expect(istEigenerEmpfaenger({ abschnitt_id: 30, einheit_id: null }, a, e)).toBe(false);
    expect(istEigenerEmpfaenger({ abschnitt_id: null, einheit_id: 9 }, a, e)).toBe(false);
    expect(istEigenerEmpfaenger({ abschnitt_id: null, einheit_id: null }, a, e)).toBe(false);
  });

  it('navigationZeigt: unbekannt offen, gesperrt oder ausgeblendet zu, fehlendes Modul zu', () => {
    const f = freigabenFixture();
    expect(navigationZeigt('auftraege', undefined)).toBe(true);
    expect(navigationZeigt('auftraege', f)).toBe(true);
    expect(
      navigationZeigt('auftraege', { ...f, auftraege: { ...f.auftraege, zugriff: false } }),
    ).toBe(false);
    expect(
      navigationZeigt('auftraege', { ...f, auftraege: { ...f.auftraege, sichtbar: false } }),
    ).toBe(false);
    const ohne = { ...f };
    delete ohne.auftraege;
    expect(navigationZeigt('auftraege', ohne)).toBe(false);
  });

  it('flaechenRahmen: Rahmen um den äußeren Ring, ohne Stützpunkte keiner', () => {
    expect(
      flaechenRahmen({
        type: 'Polygon',
        coordinates: [
          [
            [9.1, 52.0],
            [9.3, 52.0],
            [9.3, 52.2],
            [9.1, 52.0],
          ],
        ],
      }),
    ).toEqual({ art: 'rahmen', west: 9.1, sued: 52.0, ost: 9.3, nord: 52.2 });
    expect(flaechenRahmen({ type: 'Polygon', coordinates: [] })).toBeNull();
  });

  it('abschnittsZonen: Gefahrengebiet gestrichelt, kaputte Geometrie fällt weg', () => {
    const zone = (id: number, p: Partial<LageZone>): LageZone =>
      ({ id, einsatz_id: 7, label: null, farbe: null, ...p }) as LageZone;
    const figuren = abschnittsZonen(
      [
        zone(1, {
          typ: 'gefahrengebiet',
          label: 'Gasaustritt',
          geometrie: JSON.stringify({
            type: 'Polygon',
            coordinates: [
              [
                [9, 52],
                [9.1, 52],
                [9.1, 52.1],
                [9, 52],
              ],
            ],
          }),
        }),
        zone(2, {
          typ: 'absperrgrenze',
          geometrie: JSON.stringify({
            type: 'LineString',
            coordinates: [
              [9, 52],
              [9.1, 52],
            ],
          }),
        }),
        zone(3, { typ: 'sperrgebiet', geometrie: 'kaputt' }),
      ],
      undefined,
    );
    expect(figuren.map((z) => [z.id, z.label, z.gestrichelt])).toEqual([
      [1, 'Gasaustritt', true],
      [2, '', false],
    ]);
  });
});
