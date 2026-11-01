import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import BrDetailPage from './BrDetailPage';
import { AuthProvider } from '../../auth/AuthContext';
import { setzeViewportBreite } from '../../test/viewport';
import type {
  BrDetail,
  BrEinheitKurz,
  BrVerlaufEintrag,
  EinsatzAnzeige,
  Einheit,
  EinsatzFahrzeug,
} from '../../api/types';
import { einsatzFixture, freigabenFixture } from '../../test/fixtures';
import { einsatzKeys } from '../../api/queryKeys';
import { setzeOnline } from '../../test/utils';
import { mitProzessZone } from '../../test/prozessZone';
import { oeffne, optionenVon, waehle } from '../../test/auswahlListe';
import {
  queueLeerenFuerTests,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from '../../offline/queue';

// `BrSwitcher` feuert eine eigene `listeBr`-Query ohne MSW-Handler (`onUnhandledFrame: 'error'`);
// diese Datei testet die Seiten-Komposition, nicht den Switcher.
vi.mock('./BrSwitcher', () => ({ default: () => <div>SWITCHER</div> }));

// Sektion „Material“ (LLH-1225 D13): mit offener Freigabe fragt die Seite die Materialliste und
// für die Namen im Angebot die UHS ab. Leer ist ein echter Serverzustand; Tests mit Material
// überschreiben per `server.use()`.
beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  );
});

function einsatz(over: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return einsatzFixture({ bezeichnung: 'Test-Einsatz', meine_rolle: 'fuehrungspersonal', ...over });
}

type EinheitEingabe = Omit<BrEinheitKurz, 'fahrzeuge' | 'unangemeldet'> &
  Partial<Pick<BrEinheitKurz, 'fahrzeuge' | 'unangemeldet'>>;

/** Ohne Angabe folgt `belegung` den Listen, wie der Server zählt (LLH-1095): Einheiten, dazu
 *  die einheitenlosen Fahrzeuge und die der Einheiten, die längste Wartezeit ab dem frühesten
 *  „seit“. */
function brDetail(
  over: Omit<Partial<BrDetail>, 'einheiten'> & { einheiten?: EinheitEingabe[] } = {},
): BrDetail {
  const einheiten = (over.einheiten ?? []).map((e) => ({
    fahrzeuge: [],
    unangemeldet: false,
    ...e,
  }));
  const fahrzeuge = over.fahrzeuge ?? [];
  const seit = [...einheiten, ...fahrzeuge]
    .map((k) => k.seit_at)
    .filter((t): t is string => t != null)
    .sort();
  const belegung = over.belegung ?? {
    einheiten: einheiten.length,
    fahrzeuge: einheiten.reduce((n, e) => n + e.fahrzeuge.length, fahrzeuge.length),
    laengste_seit_at: seit[0] ?? null,
  };
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    bezeichnung: 'BR Alpha',
    standort: null,
    notiz: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    ...over,
    einheiten,
    fahrzeuge,
    belegung,
  };
}

function fahrzeug(over: Partial<EinsatzFahrzeug> = {}): EinsatzFahrzeug {
  return {
    id: 20,
    einsatz_id: 1,
    fahrzeug_id: null,
    einheit_id: null,
    ist_adhoc: true,
    ist_demo: false,
    funkrufname: 'Florian 1',
    kennzeichen: null,
    fahrzeugtyp: null,
    opta: null,
    traegerorganisation: null,
    status_id: null,
    status_label: null,
    status_kategorie: null,
    status_farbe: null,
    bemerkung: null,
    disponiert_at: 'x',
    disponiert_von: null,
    lat: null,
    lon: null,
    tz_fachaufgabe: null,
    tz_organisation: null,
    aktueller_br_id: null,
    soll_besatzung: null,
    ...over,
  };
}

function einheit(over: Partial<Einheit> = {}): Einheit {
  return {
    id: 30,
    einsatz_id: 1,
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    typ_id: null,
    typ_label: null,
    name: 'Einheit Beta',
    fuehrer_id: null,
    fuehrer_name: null,
    bemerkung: null,
    sortier: 0,
    soll: null,
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    personal_mitglieder: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    lat: null,
    lon: null,
    tz_fachaufgabe: null,
    tz_organisation: null,
    aktueller_br_id: null,
    sprechgruppen: [],
    status: { quelle: 'ohne', verteilung: [] },
    unangemeldet: false,
    verbindungen: [],
    ...over,
  };
}

function renderBrDetail(brId = 1): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[`/einsaetze/1/bereitstellungsraeume/${brId}`]}>
            <Routes>
              <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<BrDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return qc;
}

/** Text einer Kennzahl des Belegungsbands, gefunden über ihre Augenbraue. */
function kennzahl(titel: string): HTMLElement {
  const zellen = screen
    .getByTestId('br-summe')
    .querySelectorAll<HTMLElement>('[data-lfh="kennzahl"]');
  const zelle = [...zellen].find(
    (z) => z.querySelector('.lfh-kennzahl__titel')?.textContent === titel,
  );
  if (!zelle) throw new Error(`Kennzahl „${titel}“ fehlt`);
  return zelle;
}

/**
 * Das zuletzt geöffnete antd-Menü (`frontend/AGENTS.md`, „Datensatz-Aktionen werden gebündelt“):
 * jedes Portal kommt beim ersten Öffnen ans Ende von `body`.
 */
async function openMenue(name: string, bereich: HTMLElement = document.body) {
  await userEvent.click(
    within(bereich).getByRole('button', { name: new RegExp(`^Weitere Aktionen zu ${name}`) }),
  );
  return waitFor(() => {
    const offen = document.querySelectorAll<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(offen.length).toBeGreaterThan(0);
    return offen[offen.length - 1];
  });
}

/** „Austragen“ steht im Aktionsmenü der Zeile, nicht als roter Knopf (LLH-1085). */
async function austragen(name: string, bereich: HTMLElement = document.body) {
  const menue = await openMenue(name, bereich);
  await userEvent.click(within(menue).getByRole('menuitem', { name: 'Austragen' }));
}

function renderBrBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route
                path="/einsaetze/:id/bereitstellungsraeume/liste"
                element={<div>BR-LISTE</div>}
              />
              <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<BrDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('BrDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger BR-ID auf die Liste um', async () => {
    renderBrBei('/einsaetze/1/bereitstellungsraeume/abc');
    expect(await screen.findByText('BR-LISTE')).toBeInTheDocument();
  });
});

describe('BrDetailPage – bereitgestellte Einheiten + Austritt (LFH-14)', () => {
  it('zeigt bereitgestellte Einheiten und trägt per Austritt aus', async () => {
    const br = brDetail({ einheiten: [{ id: 10, name: 'Einheit Alpha' }] });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    let capturedBody: unknown = null;
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: 1,
          einsatz_id: 1,
          br_id: 1,
          objekt_typ: 'einheit',
          objekt_id: 10,
          art: 'austritt',
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );

    renderBrDetail();

    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();

    await austragen('Einheit Alpha');

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({ art: 'austritt', objekt_typ: 'einheit', objekt_id: 10 });
    // Die Quittung nennt Handlung und Objekt (LFH-948); die Bezeichnung geht nicht zum Server.
    expect(
      await screen.findByText('Einheit „Einheit Alpha“ aus dem BR ausgetragen'),
    ).toBeInTheDocument();
    expect(capturedBody).not.toHaveProperty('bezeichnung');
  });
});

describe('BrDetailPage – Sidebar zuweisen (LFH-14)', () => {
  it('weist eine einheitenlose Kraft zu', async () => {
    // BR hat noch keine Mitglieder; einheitenloses Fahrzeug in Sidebar sichtbar
    const br = brDetail({ einheiten: [], fahrzeuge: [] });
    const frei = fahrzeug({ id: 20, funkrufname: 'Florian 1', einheit_id: null });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([frei])),
    );

    let capturedBody: unknown = null;
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: 2,
          einsatz_id: 1,
          br_id: 1,
          objekt_typ: 'fahrzeug',
          objekt_id: 20,
          art: 'eintritt',
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );

    renderBrDetail();

    expect(await screen.findByText('Florian 1')).toBeInTheDocument();

    // LFH-968: der zugängliche Name trägt die Zeilenkennung, der Knopf ist kein Primärknopf.
    const btn = screen.getByRole('button', { name: 'Florian 1 zuweisen' });
    expect(btn).not.toHaveClass('ant-btn-primary');
    await userEvent.click(btn);

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({ art: 'eintritt', objekt_typ: 'fahrzeug', objekt_id: 20 });
    expect(await screen.findByText('Fahrzeug „Florian 1“ dem BR zugewiesen')).toBeInTheDocument();
    expect(capturedBody).not.toHaveProperty('bezeichnung');
  });
});

describe('BrDetailPage – Sidebar filtert auf aktueller_br_id == null (LFH-14)', () => {
  it('blendet Kräfte aus, die bereits in einem anderen BR sind', async () => {
    const br = brDetail({ id: 1, einheiten: [], fahrzeuge: [] });
    // Eine Einheit in keinem BR (frei), eine in einem ANDEREN BR (br 99).
    const frei = einheit({ id: 30, name: 'Einheit Frei', aktueller_br_id: null });
    const anderswo = einheit({ id: 31, name: 'Einheit Anderswo', aktueller_br_id: 99 });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([frei, anderswo])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    // Freie Einheit erscheint in der Sidebar …
    expect(await screen.findByText('Einheit Frei')).toBeInTheDocument();
    // … die in einem anderen BR darf NICHT erscheinen.
    expect(screen.queryByText('Einheit Anderswo')).not.toBeInTheDocument();
  });
});

describe('BrDetailPage — Sidebar-Suche (LFH-347 · M58b)', () => {
  it('filtert die freien Kräfte über das Suchfeld', async () => {
    const a = einheit({ id: 30, name: 'Zug Nord', aktueller_br_id: null });
    const b = einheit({ id: 31, name: 'Trupp Süd', aktueller_br_id: null });
    const br = brDetail({ einheiten: [], fahrzeuge: [] });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([a, b])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    await screen.findByText('Zug Nord');
    await userEvent.type(screen.getByLabelText('Kräfte suchen'), 'süd');
    expect(screen.queryByText('Zug Nord')).not.toBeInTheDocument();
    expect(screen.getByText('Trupp Süd')).toBeInTheDocument();
  });
});

describe('BrDetailPage – Schreibschutz (LFH-14)', () => {
  it('zeigt bei BR-Status geplant keine Abrufen-/Austragen-/zuweisen-Buttons', async () => {
    // geplant → schreibgeschützt; bereitgestellte Einheit + freie Kraft in Sidebar.
    const br = brDetail({ status: 'geplant', einheiten: [{ id: 10, name: 'Einheit Alpha' }] });
    const frei = einheit({ id: 30, name: 'Einheit Frei', aktueller_br_id: null });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([frei])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    // Kräfte sind sichtbar …
    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();
    expect(screen.getByText('Einheit Frei')).toBeInTheDocument();
    // … aber keine Schreibaktionen (abrufen, austragen, zuweisen).
    expect(screen.queryByRole('button', { name: /abrufen$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Weitere Aktionen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zuweisen$/ })).not.toBeInTheDocument();
  });

  it('zeigt für Beobachter keine Abrufen-/Austragen-/zuweisen-Buttons (BR aktiv)', async () => {
    const br = brDetail({ status: 'aktiv', einheiten: [{ id: 10, name: 'Einheit Alpha' }] });
    const frei = einheit({ id: 30, name: 'Einheit Frei', aktueller_br_id: null });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ meine_rolle: 'beobachter' }))),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([frei])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abrufen$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Weitere Aktionen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zuweisen$/ })).not.toBeInTheDocument();
  });
});

describe('BrDetailPage — Typ, Stärke, Summenzeile (LFH-347 · M58a)', () => {
  it('zeigt je bereitgestellter Einheit Typ und Stärke sowie die Summenzeile', async () => {
    const zug = einheit({
      id: 10,
      name: 'Zug 1',
      typ_label: 'Zug',
      ist: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    });
    const trupp = einheit({
      id: 11,
      name: 'Trupp 2',
      typ_label: 'Trupp',
      ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 },
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 },
    });
    const br = brDetail({
      einheiten: [
        { id: 10, name: 'Zug 1' },
        { id: 11, name: 'Trupp 2' },
      ],
      fahrzeuge: [{ id: 5, funkrufname: 'Florian 1' }],
    });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([zug, trupp])),
      http.get('/api/einsaetze/1/fahrzeuge', () =>
        HttpResponse.json([
          fahrzeug({ id: 5, funkrufname: 'Florian 1', fahrzeugtyp: 'LF 20', aktueller_br_id: 1 }),
        ]),
      ),
    );

    renderBrDetail();

    await screen.findByTestId('br-summe');
    expect(kennzahl('Bereitgestellt')).toHaveTextContent('1/4/20//25');
    expect(kennzahl('Fahrzeug')).toHaveTextContent(/^Fahrzeug1$/);
    expect(screen.getByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('LF 20')).toBeInTheDocument();
  });
});

describe('BrDetailPage — Stärke zählt nur Anwesende (LLH-1289)', () => {
  it('zählt eine Gruppe in einem anderen Raum weder im Band noch in der Zeile ihres Zugs', async () => {
    // „1. Zug“ (Zugtrupp 1/1/2) steht mit „Gruppe 1“ (0/1/8) hier, „Gruppe 2“ (0/1/8) anderswo.
    const zug = einheit({
      id: 10,
      name: '1. Zug',
      typ_label: 'Zug',
      ist: { fuehrer: 1, unterfuehrer: 1, mannschaft: 2 },
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    });
    const gruppe1 = einheit({
      id: 11,
      name: 'Gruppe 1',
      ueber_einheit_id: 10,
      ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
    });
    const gruppe2 = einheit({
      id: 12,
      name: 'Gruppe 2',
      ueber_einheit_id: 10,
      aktueller_br_id: 2,
      ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
    });
    const br = brDetail({
      einheiten: [
        { id: 10, name: '1. Zug' },
        { id: 11, name: 'Gruppe 1' },
      ],
      fahrzeuge: [],
    });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([zug, gruppe1, gruppe2])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    await screen.findByTestId('br-summe');
    await waitFor(() => expect(kennzahl('Bereitgestellt')).toHaveTextContent('1/2/10//13'));
    expect(screen.queryByText('1/3/18//22')).not.toBeInTheDocument();
    // Zeile des Zugs: er samt Gruppe 1; Gruppe 1 trägt ihre eigene Zeile.
    const belegung = screen.getByTestId('br-belegung');
    expect(within(belegung).getByText('1/2/10//13')).toBeInTheDocument();
    expect(within(belegung).getByText('0/1/8//9')).toBeInTheDocument();
  });
});

describe('BrDetailPage — unvollständige Stärke bei fehlenden Einheiten (Final-Review Befund A)', () => {
  it('zeigt „—" statt einer zu kleinen Zahl, wenn eine bereitgestellte Einheit in der Einheitenliste fehlt', async () => {
    // Die Einheiten-Query liefert nur eine der zwei Einheiten (Teilausfall) — die Summenzeile darf
    // keine vollständig aussehende, zu kleine Zahl zeigen.
    const zug = einheit({
      id: 10,
      name: 'Zug 1',
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    });
    const br = brDetail({
      einheiten: [
        { id: 10, name: 'Zug 1' },
        { id: 11, name: 'Trupp 2' },
      ],
      fahrzeuge: [],
    });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([zug])), // Trupp 2 fehlt
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    const summe = await screen.findByTestId('br-summe');
    expect(summe).toHaveTextContent(/Bereitgestellt\s*—/);
    expect(summe).not.toHaveTextContent('//');
    expect(
      screen.getByText('(Stärke unvollständig — Einheitenliste nicht geladen)'),
    ).toBeInTheDocument();
    // Namen bleiben aus `br.einheiten` sichtbar, auch wenn die Detaildaten fehlen.
    expect(screen.getByText('Trupp 2')).toBeInTheDocument();
  });

  it('zeigt denselben unvollständigen Zustand, wenn die Einheiten-Query scheitert', async () => {
    const br = brDetail({ einheiten: [{ id: 10, name: 'Zug 1' }], fahrzeuge: [] });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    renderBrDetail();

    expect(await screen.findByText('Zug 1')).toBeInTheDocument();
    const summe = screen.getByTestId('br-summe');
    expect(summe).toHaveTextContent(/Bereitgestellt\s*—/);
    expect(
      screen.getByText('(Stärke unvollständig — Einheitenliste nicht geladen)'),
    ).toBeInTheDocument();
  });
});

// Unter `md` nimmt die „Kräfte ohne BR"-Spalte volle Breite und stapelt. Geprüft wird der Style der
// Karte selbst: nur er zeigt, dass die feste Breite weg ist, nicht bloß, dass der Rahmen umbricht.
describe('BrDetailPage — Kräfte-Spalte bricht unter md um (LFH-341)', () => {
  it('nimmt der Kräfte-Spalte unter md die feste Breite', async () => {
    const br = brDetail({ einheiten: [], fahrzeuge: [] });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    setzeViewportBreite(600); // < md (768)
    renderBrDetail();

    const spalte = await screen.findByTestId('kraefte-ohne-br');
    expect(spalte.style.width).not.toBe('240px');
    // Auch der Container selbst: sonst quetschte er die 100%-Karte weiter in eine Spalte.
    expect(screen.getByTestId('br-detail-rahmen').style.flexDirection).toBe('column');
  });

  it('behält die Spalte ab md bei 240 px', async () => {
    const br = brDetail({ einheiten: [], fahrzeuge: [] });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );

    setzeViewportBreite(1024);
    renderBrDetail();

    const spalte = await screen.findByTestId('kraefte-ohne-br');
    expect(spalte.style.width).toBe('240px');
    expect(screen.getByTestId('br-detail-rahmen').style.flexDirection).toBe('row');
  });
});

describe('BrDetailPage — Fahrzeuge der Einheiten zählen mit (LLH-1095)', () => {
  // Zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne Einheit: die Kennzahl liest den
  // Serverwert (3), „noch n belegt“ zählt wie die Sperre des Servers nur Einheiten und
  // einheitenlose Fahrzeuge (3, nicht 5).
  const br = brDetail({
    status: 'aktiv',
    einheiten: [
      { id: 10, name: '1. Zug', fahrzeuge: [{ id: 21, funkrufname: 'Florian 1/44-1' }] },
      { id: 11, name: '2. Zug', fahrzeuge: [{ id: 22, funkrufname: 'Florian 1/44-2' }] },
    ],
    fahrzeuge: [{ id: 23, funkrufname: 'Florian 1/83-1' }],
    belegung: { einheiten: 2, fahrzeuge: 3 },
  });

  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );
  });

  it('Fahrzeuge 3', async () => {
    renderBrDetail();
    await screen.findByTestId('br-summe');
    expect(kennzahl('Fahrzeuge')).toHaveTextContent(/^Fahrzeuge3$/);
  });

  it('noch 3 belegt, nicht 5', async () => {
    renderBrDetail();
    expect(await screen.findByText('noch 3 belegt')).toBeInTheDocument();
  });
});

describe('BrDetailPage — Rückfragen nennen die Handlung (LFH-960)', () => {
  function seiteMit(br: BrDetail, aufrufe: string[]) {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/status', async ({ request }) => {
        aufrufe.push(`status ${((await request.json()) as { status: string }).status}`);
        return HttpResponse.json({ ...br, status: 'aufgeloest' });
      }),
      http.delete('/api/einsaetze/1/bereitstellungsraeume/1', () => {
        aufrufe.push('storno');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderBrDetail();
  }

  it('aktiv: „BR auflösen“ bestätigt rot und löst erst dann auf', async () => {
    const aufrufe: string[] = [];
    seiteMit(brDetail({ status: 'aktiv' }), aufrufe);

    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    const ok = await screen.findByRole('button', { name: 'BR auflösen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(aufrufe).toEqual([]);
    await userEvent.click(ok);
    await waitFor(() => expect(aufrufe).toEqual(['status aufgeloest']));
  });

  it('aktiv und belegt: „Auflösen“ gesperrt, der Grund steht sichtbar daneben (LFH-1078)', async () => {
    const aufrufe: string[] = [];
    seiteMit(
      brDetail({
        status: 'aktiv',
        einheiten: [{ id: 5, name: 'Florian 1' }],
        fahrzeuge: [{ id: 20, funkrufname: 'Florian 1/44' }],
      }),
      aufrufe,
    );

    const knopf = await screen.findByRole('button', { name: 'Auflösen' });
    expect(knopf).toBeDisabled();
    expect(screen.getByText('noch 2 belegt')).toBeInTheDocument();
    expect(screen.queryByText(/Nur möglich/)).not.toBeInTheDocument();
  });

  it('aktiv und leer: kein Satz in der Rückfrage, nur die Handlung', async () => {
    seiteMit(brDetail({ status: 'aktiv' }), []);
    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    await screen.findByRole('button', { name: 'BR auflösen' });
    expect(screen.queryByText(/Nur möglich/)).not.toBeInTheDocument();
    expect(screen.queryByText(/belegt/)).not.toBeInTheDocument();
  });

  it('geplant: „BR stornieren“ bestätigt rot und storniert erst dann', async () => {
    const aufrufe: string[] = [];
    seiteMit(brDetail({ status: 'geplant' }), aufrufe);

    expect(await screen.findByRole('button', { name: 'In Betrieb nehmen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stornieren' }));
    const ok = await screen.findByRole('button', { name: 'BR stornieren' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(aufrufe).toEqual([]);
    await userEvent.click(ok);
    await waitFor(() => expect(aufrufe).toEqual(['storno']));
  });
});

describe('BrDetailPage — Belegung springt nicht unter dem Zeiger (LFH-1113)', () => {
  const alpha = { id: 10, name: 'Einheit Alpha' };
  const aachen = { id: 11, name: 'Einheit Aachen' };

  /** Der BR liefert, was `stand.br` gerade trägt — eine Live-Invalidierung holt den neuen Stand. */
  function stelleBereit(stand: { br: BrDetail }, einheiten: Einheit[] = []) {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(stand.br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );
  }

  /** Die Live-Invalidierung `bereitstellungsraum`, wie sie der Ereignisstrom auslöst. */
  async function liveInvalidierung(qc: QueryClient) {
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(1, 1) }));
  }

  it('fremde Anmeldung bei gehaltenem Zeiger: keine eingeschobene Zeile, sie erscheint nach dem Banner', async () => {
    const stand = { br: brDetail({ einheiten: [alpha] }) };
    stelleBereit(stand);
    const qc = renderBrDetail();
    expect(await screen.findByText('Einheit Alpha')).toBeInTheDocument();

    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'mouse' });
    // „Aachen“ steht in der festen Folge VOR „Alpha“ — eingeschoben, rutschte „Alpha“ weg.
    stand.br = brDetail({ einheiten: [alpha, aachen] });
    await liveInvalidierung(qc);

    const banner = await screen.findByRole('button', { name: '1 neu anzeigen' });
    expect(screen.queryByText('Einheit Aachen')).not.toBeInTheDocument();
    expect(screen.getByText('1 neue Einheit')).toBeInTheDocument();

    await userEvent.click(banner);
    const neu = await screen.findByText('Einheit Aachen');
    expect(
      neu.compareDocumentPosition(screen.getByText('Einheit Alpha')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1 neu anzeigen' })).not.toBeInTheDocument();
  });

  it('Fokus in der Liste hält ebenso; nach dem Verlassen erscheint der Zuwachs', async () => {
    const stand = { br: brDetail({ einheiten: [alpha] }) };
    stelleBereit(stand);
    const qc = renderBrDetail();
    const abrufen = await screen.findByRole('button', { name: 'Einheit Alpha abrufen' });

    act(() => abrufen.focus());
    stand.br = brDetail({ einheiten: [alpha, aachen] });
    await liveInvalidierung(qc);
    const banner = await screen.findByRole('button', { name: '1 neu anzeigen' });
    expect(screen.queryByText('Einheit Aachen')).not.toBeInTheDocument();

    // Der Sprung zum Nachbarknopf derselben Fläche ist kein Verlassen.
    act(() => banner.focus());
    expect(screen.queryByText('Einheit Aachen')).not.toBeInTheDocument();

    act(() => banner.blur());
    expect(await screen.findByText('Einheit Aachen')).toBeInTheDocument();
  });

  it('ohne Zeiger und Fokus erscheint eine fremde Anmeldung sofort, in fester Reihenfolge', async () => {
    // Der Server liefert ohne Ordnung; die Liste ordnet nach dem Namen.
    const stand = { br: brDetail({ einheiten: [alpha, aachen] }) };
    stelleBereit(stand);
    renderBrDetail();
    const neu = await screen.findByText('Einheit Aachen');
    expect(
      neu.compareDocumentPosition(screen.getByText('Einheit Alpha')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /neu anzeigen/ })).not.toBeInTheDocument();
  });

  it('Touch hält nicht: ein Tipp betritt und verlässt die Liste', async () => {
    const stand = { br: brDetail({ einheiten: [alpha] }) };
    stelleBereit(stand);
    const qc = renderBrDetail();
    await screen.findByText('Einheit Alpha');

    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'touch' });
    stand.br = brDetail({ einheiten: [alpha, aachen] });
    await liveInvalidierung(qc);
    expect(await screen.findByText('Einheit Aachen')).toBeInTheDocument();
  });

  it('eigene Anmeldung erscheint sofort, auch bei gehaltenem Zeiger', async () => {
    const beta = einheit({ id: 30, name: 'Einheit Beta' });
    const stand = { br: brDetail({ einheiten: [alpha] }) };
    stelleBereit(stand, [beta]);
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', () => {
        stand.br = brDetail({ einheiten: [alpha, { id: 30, name: 'Einheit Beta' }] });
        return HttpResponse.json({
          id: 3,
          einsatz_id: 1,
          br_id: 1,
          objekt_typ: 'einheit',
          objekt_id: 30,
          art: 'eintritt',
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );
    renderBrDetail();
    await screen.findByText('Einheit Alpha');
    const liste = screen.getByTestId('br-belegung');

    fireEvent.pointerMove(liste, { pointerType: 'mouse' });
    // `fireEvent` statt `userEvent`: der Zeiger bleibt dabei in der Liste.
    fireEvent.click(await screen.findByRole('button', { name: 'Einheit Beta zuweisen' }));

    expect(await within(liste).findByText('Einheit Beta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /neu anzeigen/ })).not.toBeInTheDocument();
  });

  it('fremde Abmeldung fällt auch bei gehaltenem Zeiger sofort weg', async () => {
    const stand = { br: brDetail({ einheiten: [alpha, aachen] }) };
    stelleBereit(stand);
    const qc = renderBrDetail();
    await screen.findByText('Einheit Aachen');

    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'mouse' });
    stand.br = brDetail({ einheiten: [alpha] });
    await liveInvalidierung(qc);
    await waitFor(() => expect(screen.queryByText('Einheit Aachen')).not.toBeInTheDocument());
    expect(screen.getByText('Einheit Alpha')).toBeInTheDocument();
  });

  it('Fahrzeuge: das Banner nennt das neue Fahrzeug', async () => {
    const stand = { br: brDetail({ fahrzeuge: [{ id: 20, funkrufname: 'Florian 2' }] }) };
    stelleBereit(stand);
    const qc = renderBrDetail();
    await screen.findByText('Florian 2');

    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'mouse' });
    stand.br = brDetail({
      fahrzeuge: [
        { id: 20, funkrufname: 'Florian 2' },
        { id: 21, funkrufname: 'Florian 1' },
      ],
    });
    await liveInvalidierung(qc);
    expect(await screen.findByText('1 neues Fahrzeug')).toBeInTheDocument();
    expect(screen.queryByText('Florian 1')).not.toBeInTheDocument();
  });
});

describe('BrDetailPage — Ablehnung am Ort (LFH-1077)', () => {
  const alpha = { id: 10, name: 'Einheit Alpha' };
  const bravo = { id: 11, name: 'Einheit Bravo' };

  function seite(
    br: BrDetail,
    belegung: Parameters<typeof http.post>[1],
    {
      einheiten = [] as Einheit[],
      fahrzeuge = [] as EinsatzFahrzeug[],
    }: { einheiten?: Einheit[]; fahrzeuge?: EinsatzFahrzeug[] } = {},
  ) {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', belegung),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={['/einsaetze/1/bereitstellungsraeume/1']}>
              <Routes>
                <Route
                  path="/einsaetze/:id/bereitstellungsraeume/:brId"
                  element={<BrDetailPage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    return qc;
  }

  const zeile = (name: string) => screen.getByText(name).closest<HTMLElement>('.listen-eintrag')!;
  const seitenZeile = (name: string) =>
    screen.getByText(name).closest<HTMLElement>('[data-lfh="br-kraft-zeile"]')!;
  const hinweis = () => document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
  const abgelehnt = (text: string) => () => HttpResponse.json({ error: text }, { status: 409 });

  it('Austragen: der Grund steht an genau dieser Zeile, kein Toast', async () => {
    seite(brDetail({ einheiten: [alpha, bravo] }), abgelehnt('Einheit ist im Einsatz gebunden'));
    await screen.findByText('Einheit Alpha');
    await austragen('Einheit Alpha', zeile('Einheit Alpha'));

    expect(await within(zeile('Einheit Alpha')).findByRole('alert')).toHaveTextContent(
      'Einheit ist im Einsatz gebunden',
    );
    expect(within(zeile('Einheit Bravo')).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Austragen: das nächste Austragen an der Zeile räumt den Grund', async () => {
    let erster = true;
    seite(brDetail({ einheiten: [alpha] }), async () => {
      if (erster) {
        erster = false;
        return HttpResponse.json({ error: 'Einheit ist im Einsatz gebunden' }, { status: 409 });
      }
      await delay('infinite');
      return HttpResponse.json({});
    });
    await screen.findByText('Einheit Alpha');
    await austragen('Einheit Alpha');
    await within(zeile('Einheit Alpha')).findByRole('alert');

    // `openMenue` sucht per Regex: das Ladesymbol des ersten Laufs klingt in jsdom nicht ab.
    await austragen('Einheit Alpha');
    await waitFor(() => expect(within(zeile('Einheit Alpha')).queryByRole('alert')).toBeNull());
  });

  it('Austragen: zwei Zeilen nebenläufig, die späte Ablehnung der ersten steht an ihr', async () => {
    let lehneAb: () => void = () => {};
    const ersteAblehnung = new Promise<void>((r) => (lehneAb = r));
    seite(brDetail({ einheiten: [alpha, bravo] }), async ({ request }) => {
      const body = (await request.json()) as { objekt_id: number };
      if (body.objekt_id === 10) {
        await ersteAblehnung;
        return HttpResponse.json({ error: 'Einheit ist im Einsatz gebunden' }, { status: 409 });
      }
      await delay('infinite');
      return HttpResponse.json({});
    });
    await screen.findByText('Einheit Alpha');
    await austragen('Einheit Alpha', zeile('Einheit Alpha'));
    await austragen('Einheit Bravo', zeile('Einheit Bravo'));
    await act(async () => lehneAb());

    expect(await within(zeile('Einheit Alpha')).findByRole('alert')).toHaveTextContent(
      'Einheit ist im Einsatz gebunden',
    );
    expect(within(zeile('Einheit Bravo')).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Austragen: nur die laufende Zeile dreht', async () => {
    seite(brDetail({ einheiten: [alpha, bravo] }), async () => {
      await delay('infinite');
      return HttpResponse.json({});
    });
    await screen.findByText('Einheit Alpha');
    await austragen('Einheit Alpha', zeile('Einheit Alpha'));

    await waitFor(() =>
      expect(
        within(zeile('Einheit Alpha')).getByRole('button', { name: /^Weitere Aktionen/ }),
      ).toHaveClass('ant-btn-loading'),
    );
    expect(
      within(zeile('Einheit Bravo')).getByRole('button', { name: /^Weitere Aktionen/ }),
    ).not.toHaveClass('ant-btn-loading');
  });

  it('Zuweisen aus der Seitenleiste: der Grund steht an der Zeile der Kraft', async () => {
    seite(brDetail(), abgelehnt('Fahrzeug steht bereits in einem BR'), {
      fahrzeuge: [fahrzeug({ id: 20, funkrufname: 'Florian 1' })],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Florian 1 zuweisen' }));

    expect(await within(seitenZeile('Florian 1')).findByRole('alert')).toHaveTextContent(
      'Fahrzeug steht bereits in einem BR',
    );
    expect(hinweis()).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Zuweisen: blendet die Suche die Zeile aus, steht der Grund mit Namen über der Liste', async () => {
    seite(brDetail(), abgelehnt('Fahrzeug steht bereits in einem BR'), {
      fahrzeuge: [
        fahrzeug({ id: 20, funkrufname: 'Florian 1' }),
        fahrzeug({ id: 21, funkrufname: 'Rotkreuz 2' }),
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Florian 1 zuweisen' }));
    await within(seitenZeile('Florian 1')).findByRole('alert');

    await userEvent.type(screen.getByRole('textbox', { name: 'Kräfte suchen' }), 'Rotkreuz');
    await waitFor(() => expect(screen.queryByText('Florian 1')).toBeNull());
    const block = document.querySelector<HTMLElement>('[data-lfh="br-verdeckte-fehler"]');
    expect(block).not.toBeNull();
    expect(within(block!).getByRole('alert')).toHaveTextContent(
      'Florian 1 · Fahrzeug steht bereits in einem BR',
    );
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);

    await userEvent.clear(screen.getByRole('textbox', { name: 'Kräfte suchen' }));
    expect(within(seitenZeile('Florian 1')).getByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="br-verdeckte-fehler"]')).toBeNull();
  });

  it('Zuweisen: ist die Zeile danach weg, steht der Grund im Seitenhinweis', async () => {
    const frei = fahrzeug({ id: 20, funkrufname: 'Florian 1' });
    const qc = seite(brDetail(), abgelehnt('Fahrzeug steht bereits in einem BR'), {
      fahrzeuge: [frei],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Florian 1 zuweisen' }));
    await within(seitenZeile('Florian 1')).findByRole('alert');

    // Der Stand holt die Seite ein: das Fahrzeug steht jetzt in einem anderen BR.
    server.use(
      http.get('/api/einsaetze/1/fahrzeuge', () =>
        HttpResponse.json([{ ...frei, aktueller_br_id: 99 }]),
      ),
    );
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(1) }));

    await waitFor(() => expect(screen.queryByText('Florian 1')).toBeNull());
    const grund = await within(hinweis()!).findByRole('alert');
    expect(grund).toHaveTextContent('Fahrzeug „Florian 1“ nicht zugewiesen');
    expect(grund).toHaveTextContent('Fahrzeug steht bereits in einem BR');
  });

  it('Wechsel zu einem anderen Raum: die Gründe des vorigen bleiben nicht stehen', async () => {
    /** Die Route hat keinen `key`: dieselbe Seite zeigt nach dem Wechsel den nächsten Raum. */
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/bereitstellungsraeume/2')}>
          Zum zweiten Raum
        </button>
      );
    }
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/:brId', ({ params }) =>
        HttpResponse.json(brDetail({ id: Number(params.brId), einheiten: [alpha] })),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', abgelehnt('gebunden')),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={['/einsaetze/1/bereitstellungsraeume/1']}>
              <Wechsel />
              <Routes>
                <Route
                  path="/einsaetze/:id/bereitstellungsraeume/:brId"
                  element={<BrDetailPage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    await screen.findByText('Einheit Alpha');
    await austragen('Einheit Alpha');
    await within(zeile('Einheit Alpha')).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Zum zweiten Raum' }));
    await waitFor(() => expect(within(zeile('Einheit Alpha')).queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Status: der Grund steht im Seitenhinweis, kein Toast', async () => {
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/status', () =>
        HttpResponse.json({ error: 'BR ist noch belegt' }, { status: 409 }),
      ),
    );
    seite(brDetail({ status: 'aktiv' }), abgelehnt('x'));
    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'BR auflösen' }));

    const grund = await within(hinweis()!).findByRole('alert');
    expect(grund).toHaveTextContent('BR ist noch belegt');
    expect(grund).toHaveTextContent('Status nicht geändert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Storno: der Grund steht im Seitenhinweis, „In Betrieb nehmen“ räumt ihn', async () => {
    server.use(
      http.delete('/api/einsaetze/1/bereitstellungsraeume/1', () =>
        HttpResponse.json({ error: 'BR hat Belegungen' }, { status: 409 }),
      ),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/status', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    seite(brDetail({ status: 'geplant' }), abgelehnt('x'));
    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'BR stornieren' }));

    const grund = await within(hinweis()!).findByRole('alert');
    expect(grund).toHaveTextContent('BR hat Belegungen');
    expect(grund).toHaveTextContent('Nicht storniert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'In Betrieb nehmen' }));
    await waitFor(() => expect(hinweis()).toBeNull());
  });

  it('Storno mit Material im Raum: der Grund (422) steht im Seitenhinweis (LLH-1249)', async () => {
    const grundText = 'Storno nicht möglich — noch 2 Material-Posten im BR; erst lösen';
    server.use(
      http.delete('/api/einsaetze/1/bereitstellungsraeume/1', () =>
        HttpResponse.json({ error: grundText }, { status: 422 }),
      ),
    );
    seite(brDetail({ status: 'geplant' }), abgelehnt('x'));
    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'BR stornieren' }));

    const grund = await within(hinweis()!).findByRole('alert');
    expect(grund).toHaveTextContent(grundText);
    expect(grund).toHaveTextContent('Nicht storniert');
  });
});

describe('BrDetailPage — Raumdaten bearbeiten (LFH-1147)', () => {
  /** Der Raum liegt beim „Server“: PATCH ändert ihn, jedes GET liefert den aktuellen Stand. */
  function seite(
    start: BrDetail,
    {
      patch,
      rolle = 'fuehrungspersonal',
    }: {
      patch?: (body: Record<string, unknown>) => Response | Promise<Response>;
      rolle?: EinsatzAnzeige['meine_rolle'];
    } = {},
  ) {
    const stand = { br: start, gets: 0, bodies: [] as Record<string, unknown>[] };
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ meine_rolle: rolle }))),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => {
        stand.gets += 1;
        return HttpResponse.json(stand.br);
      }),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.patch('/api/einsaetze/1/bereitstellungsraeume/1', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        stand.bodies.push(body);
        if (patch) return patch(body);
        stand.br = { ...stand.br, ...body };
        return HttpResponse.json(stand.br);
      }),
    );
    const qc = renderBrDetail();
    return { stand, qc };
  }
  /**
   * Der Dialog über seinen Titel, nicht über `getByRole('dialog', { name })`: antd vergibt im
   * Testmodus jedem Knoten die id „test-id“, und `aria-labelledby` zeigte auf das erste Auswahlfeld
   * der Seite (seit LLH-1225 „Material zuordnen“ in der Sektion „Material“).
   */
  const dialog = () =>
    screen
      .getAllByRole('dialog')
      .find(
        (d) =>
          d.querySelector('.ant-modal-title')?.textContent === 'Bereitstellungsraum bearbeiten',
      )!;
  const feld = (name: string) => within(dialog()).getByLabelText(name);
  // jsdom kennt kein `transitionend`: antd beginnt das Ausblenden (`ant-zoom-leave`) und bleibt
  // dort stehen (Muster `stammdaten/verwaltungstabellen.test.tsx`).
  const zu = () => {
    const modale = [...document.querySelectorAll('.ant-modal')];
    return modale.length > 0 && modale.every((m) => m.classList.contains('ant-zoom-leave'));
  };
  const raumdaten = () =>
    document.querySelector<HTMLElement>('dl[data-lfh="datenraster"][aria-label="Raumdaten"]')!;

  it('öffnet vorbelegt, schickt nur die geänderten Felder und zeigt danach den neuen Stand', async () => {
    const { stand } = seite(
      brDetail({ status: 'aktiv', standort: 'Marktplatz', notiz: 'Zufahrt Nord' }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(feld('Bezeichnung')).toHaveValue('BR Alpha');
    expect(feld('Standort (optional)')).toHaveValue('Marktplatz');
    expect(feld('Notiz (optional)')).toHaveValue('Zufahrt Nord');

    await userEvent.clear(feld('Standort (optional)'));
    await userEvent.type(feld('Standort (optional)'), ' Festplatz ');
    await userEvent.clear(feld('Notiz (optional)'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(stand.bodies).toEqual([{ standort: 'Festplatz', notiz: null }]));
    expect(await screen.findByText('Bereitstellungsraum gespeichert')).toBeInTheDocument();
    await waitFor(() => expect(zu()).toBe(true));
    // Neu geladen, nicht nur geschlossen: die Raumdaten zeigen den Stand des Servers.
    expect(await within(raumdaten()).findByText('Festplatz')).toBeInTheDocument();
    expect(within(raumdaten()).queryByText('Zufahrt Nord')).toBeNull();
  });

  it('eine Live-Aktualisierung während des Schreibens überschreibt die Eingabe nicht', async () => {
    const { stand, qc } = seite(brDetail({ standort: 'Marktplatz' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(feld('Notiz (optional)'), 'Tor 3');

    // Ein anderer Arbeitsplatz setzt den Standort; die Seite lädt den Raum neu (wie per SSE).
    const vorher = stand.gets;
    stand.br = { ...stand.br, standort: 'Anderswo' };
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(1, 1) }));
    await waitFor(() => expect(stand.gets).toBeGreaterThan(vorher));
    await waitFor(() => expect(within(raumdaten()).getByText('Anderswo')).toBeInTheDocument());

    expect(feld('Notiz (optional)')).toHaveValue('Tor 3');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Speichern' }));
    // Der unberührte Standort geht nicht mit: „Anderswo“ bleibt stehen.
    await waitFor(() => expect(stand.bodies).toEqual([{ notiz: 'Tor 3' }]));
  });

  it('Abbrechen verwirft die Eingabe, erneutes Öffnen zeigt den Stand des Servers', async () => {
    seite(brDetail({ notiz: 'Zufahrt Nord' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(feld('Notiz (optional)'), ' geändert');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(zu()).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await waitFor(() => expect(feld('Notiz (optional)')).toHaveValue('Zufahrt Nord'));
  });

  it('ohne Änderung geht nichts an den Server, der Dialog schließt', async () => {
    const { stand } = seite(brDetail({ status: 'geplant' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(zu()).toBe(true));
    expect(stand.bodies).toEqual([]);
  });

  it('leere Bezeichnung: Hinweis am Feld, kein PATCH', async () => {
    const { stand } = seite(brDetail());

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.clear(feld('Bezeichnung'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog()).findByText('Bezeichnung erforderlich')).toBeInTheDocument();
    expect(stand.bodies).toEqual([]);
  });

  it('Ablehnung: der Grund steht im Dialog, der bleibt offen, kein Toast', async () => {
    seite(brDetail(), {
      patch: () =>
        HttpResponse.json({ error: 'Stornierter BR kann nicht geändert werden' }, { status: 409 }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(feld('Notiz (optional)'), 'neu');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Speichern' }));

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Stornierter BR kann nicht geändert werden',
    );
    expect(feld('Notiz (optional)')).toHaveValue('neu');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('steht an den Raumdaten, nicht im Seitenkopf: geplant trägt der Kopf zwei Aktionen', async () => {
    seite(brDetail({ status: 'geplant' }));
    const knopf = await screen.findByRole('button', { name: 'Bearbeiten' });
    const kopf = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    expect(kopf).not.toContainElement(knopf);
    // Zwei Datensatz-Aktionen am Raum; „Eintreffen buchen“ (LLH-1075) erfasst an der Belegung und
    // steht hier gesperrt, es zählt nicht zum Bündeln (`frontend/AGENTS.md`, „Aktionen“).
    expect(
      within(kopf)
        .getAllByRole('button')
        .filter((b) => !b.hasAttribute('disabled'))
        .map((b) => b.textContent),
    ).toEqual(['In Betrieb nehmen', 'Stornieren']);
  });

  it('Wechsel zu einem anderen Raum: der Dialog geht nicht für den nächsten Raum auf', async () => {
    // Die Route hat keinen `key` (Zurück im Browser, Umschalter): dieselbe Seite zeigt den nächsten.
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/bereitstellungsraeume/2')}>
          Zum zweiten Raum
        </button>
      );
    }
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/:brId', ({ params }) =>
        HttpResponse.json(
          brDetail({ id: Number(params.brId), bezeichnung: `BR ${String(params.brId)}` }),
        ),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={['/einsaetze/1/bereitstellungsraeume/1']}>
              <Wechsel />
              <Routes>
                <Route
                  path="/einsaetze/:id/bereitstellungsraeume/:brId"
                  element={<BrDetailPage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(feld('Bezeichnung')).toHaveValue('BR 1');

    // `fireEvent`: die Maske des Dialogs fängt den Zeiger, die Navigation kommt von außen.
    fireEvent.click(screen.getByRole('button', { name: 'Zum zweiten Raum' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Bereitstellungsräume' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getAllByText('BR 2').length).toBeGreaterThan(0));
    const offen = [...document.querySelectorAll('.ant-modal')].filter(
      (m) => !m.classList.contains('ant-zoom-leave'),
    );
    expect(offen).toHaveLength(0);
  });

  it('kein „Bearbeiten“ nach dem Auflösen', async () => {
    seite(brDetail({ status: 'aufgeloest' }));
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('kein „Bearbeiten“ nach dem Stornieren (LLH-1304)', async () => {
    seite(brDetail({ status: 'geplant', storniert_at: '2026-10-15 08:00:00' }));
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('kein „Bearbeiten“ für Beobachter', async () => {
    seite(brDetail({ status: 'aktiv' }), { rolle: 'beobachter' });
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});

/**
 * Sektion „Material“ unter der Belegung (LLH-1225 Teil II, design.md D13): der Baustein für Material
 * am Ort mit Ort Bereitstellungsraum. Die Posten kommen aus der Materialliste (`br_id`), abgefragt
 * nur mit Freigabe Material; am BR-Gerät nur lesend (LLH-1252). Bedienbar auch im Zustand `geplant`.
 */
describe('BrDetailPage — Material am Ort (LLH-1225 D13)', () => {
  const posten = (p: Record<string, unknown>) => ({
    einsatz_id: 1,
    material_id: null,
    ist_adhoc: true,
    kategorie: null,
    art: 'geraet',
    menge: 1,
    ausgegeben: 0,
    status: 'einsatzbereit',
    einheit_id: null,
    einsatz_fahrzeug_id: null,
    uhs_id: null,
    br_id: null,
    beendet_at: null,
    disponiert_at: '2026-05-26 09:10:00',
    ...p,
  });
  const MATERIAL = [
    posten({ id: 60, bezeichnung: 'Lichtmast', br_id: 1, status: 'defekt' }),
    posten({ id: 61, bezeichnung: 'Stromerzeuger' }),
    posten({ id: 62, bezeichnung: 'Trage', br_id: 2 }),
  ];

  const GERAET_BR_ME = {
    id: 9,
    anzeigename: 'BR Alpha · Tablet',
    benutzername: 'geraet-4',
    system_rolle: 'keiner',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-10-04',
    totp_aktiviert: false,
    passwort_gesetzt: false,
    geraet: {
      kopplung_id: 4,
      einsatz_id: 1,
      ansicht: 'bereitstellungsraum',
      br_id: 1,
      stelle: 'BR Alpha',
      bezeichnung: 'Tablet',
      laeuft_ab_at: '2026-10-05 12:00:00',
    },
  };

  function seite(
    br: BrDetail,
    {
      freigaben,
      rolle = 'fuehrungspersonal',
      material = MATERIAL,
    }: {
      freigaben?: Record<string, { zugriff: boolean }>;
      rolle?: string;
      material?: ReturnType<typeof posten>[];
    } = {},
  ) {
    const abrufe: string[] = [];
    const gesendet: { url: string; body: unknown }[] = [];
    server.use(
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json(einsatz({ meine_rolle: rolle as EinsatzAnzeige['meine_rolle'] })),
      ),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([
          { ...br, id: 1 },
          { ...br, id: 2, bezeichnung: 'BR Bravo' },
        ]),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/material', () => {
        abrufe.push('material');
        return HttpResponse.json(material);
      }),
      http.patch('/api/einsaetze/1/material/:emId', async ({ request }) => {
        gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({});
      }),
    );
    if (freigaben) {
      server.use(
        http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
          HttpResponse.json(freigabenFixture(freigaben)),
        ),
      );
    }
    renderBrDetail();
    return { abrufe, gesendet };
  }

  const sektion = () => screen.getByTestId('br-material');
  const zeile = (text: string) =>
    within(sektion()).getByText(text).closest('[data-lfh="material-am-ort-zeile"]') as HTMLElement;

  it('steht unter der Belegung mit Kopfzahl und den Posten dieses Raums', async () => {
    seite(brDetail());
    expect(await screen.findByText('Lichtmast')).toBeInTheDocument();
    expect(sektion()).toHaveTextContent('1 Posten · 1 Ausfall');
    expect(within(sektion()).queryByText('Trage')).toBeNull();
    const belegung = screen.getByTestId('br-belegung');
    expect(
      belegung.compareDocumentPosition(sektion()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(belegung.contains(sektion())).toBe(false);
  });

  it('leerer Raum: nur „Kein Material“, keine Kopfzahl „0 Posten“ (LLH-1255)', async () => {
    seite(brDetail(), { material: [posten({ id: 61, bezeichnung: 'Stromerzeuger' })] });
    expect(
      await within(await screen.findByTestId('br-material')).findByText('Kein Material'),
    ).toBeInTheDocument();
    expect(sektion()).not.toHaveTextContent('0 Posten');
  });

  it('im geplanten Raum: Lösen und Zuordnen schicken den PATCH an die Disposition', async () => {
    const { gesendet } = seite(brDetail({ status: 'geplant' }));
    await userEvent.click(
      within(await waitFor(() => zeile('Lichtmast'))).getByRole('button', {
        name: 'Lichtmast lösen',
      }),
    );
    await userEvent.click(within(sektion()).getByRole('combobox', { name: 'Material zuordnen' }));
    await userEvent.click(await screen.findByText('Stromerzeuger · 1'));
    await waitFor(() =>
      expect(gesendet).toEqual([
        { url: '/api/einsaetze/1/material/60', body: { br_id: null } },
        { url: '/api/einsaetze/1/material/61', body: { br_id: 1 } },
      ]),
    );
  });

  it('aufgelöster Raum: Zuordnen gesperrt mit Grund, Lösen geht', async () => {
    seite(brDetail({ status: 'aufgeloest' }));
    await screen.findByText('Lichtmast');
    const feld = within(sektion()).getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('BR aufgelöst');
    expect(
      within(zeile('Lichtmast')).getByRole('button', { name: 'Lichtmast lösen' }),
    ).toBeEnabled();
  });

  it('stornierter Raum: Zuordnen und Ausgeben gesperrt mit Grund, Lösen geht', async () => {
    const decken = posten({
      id: 63,
      bezeichnung: 'Wolldecke',
      art: 'verbrauchsgut',
      menge: 20,
      br_id: 1,
    });
    seite(brDetail({ storniert_at: '2026-10-15 08:00:00' }), {
      material: [...MATERIAL, decken],
    });
    await screen.findByText('Wolldecke');
    const feld = within(sektion()).getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('BR storniert');
    expect(within(zeile('Wolldecke')).queryByRole('button', { name: /ausgeben$/ })).toBeNull();
    expect(
      within(zeile('Lichtmast')).getByRole('button', { name: 'Lichtmast lösen' }),
    ).toBeEnabled();
  });

  it('ohne Schreibrecht: die Posten stehen, Bedienung fehlt', async () => {
    seite(brDetail(), { rolle: 'beobachter' });
    await screen.findByText('Lichtmast');
    expect(within(sektion()).queryByRole('button', { name: /lösen$/ })).toBeNull();
    expect(within(sektion()).queryByRole('combobox')).toBeNull();
  });

  it('ohne Freigabe Material: keine Sektion und kein Abruf der Materialliste', async () => {
    const { abrufe } = seite(brDetail(), { freigaben: { material: { zugriff: false } } });
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    // Die Freigaben sind da (das Belegen hängt nicht an ihnen), die Sektion bleibt weg.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('br-material')).toBeNull();
    expect(abrufe).toEqual([]);
  });

  it('am BR-Gerät: die Posten des eigenen Raums nur lesend (LLH-1252)', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(GERAET_BR_ME)));
    const { abrufe } = seite(brDetail());
    expect(
      await within(await screen.findByTestId('br-material')).findByText('Lichtmast'),
    ).toBeInTheDocument();
    expect(sektion()).toHaveTextContent('1 Posten · 1 Ausfall');
    expect(zeile('Lichtmast')).toHaveTextContent('defekt');
    expect(within(sektion()).queryByText('Trage')).toBeNull();
    expect(within(sektion()).queryByText('Stromerzeuger')).toBeNull();
    // Nur lesen (Entscheidung 22.10.2026): kein Zuordnen, Lösen, Erfassen und keine Statuswahl.
    expect(within(sektion()).queryByRole('combobox')).toBeNull();
    expect(within(sektion()).queryByRole('button')).toBeNull();
    expect(abrufe).toContain('material');
  });

  it('am BR-Gerät ohne Freigabe Material: keine Sektion und kein Abruf', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(GERAET_BR_ME)));
    const { abrufe } = seite(brDetail(), { freigaben: { material: { zugriff: false } } });
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('br-material')).toBeNull();
    expect(abrufe).toEqual([]);
  });
});

/** 14:30 Berliner Sommerzeit (12:30 UTC) am 15.10.2026. */
const JETZT = new Date('2026-10-15T14:30:00+02:00');

/**
 * Nur `Date` und das Intervall der Uhr sind gefälscht: MSW, react-query und antd laufen auf echten
 * Timern (`setTimeout`), die Wartezeit rückt mit `vi.advanceTimersByTime` vor.
 *
 * Die Zone ist festgenagelt (LLH-1397): ohne Anzeigezone formatiert die Seite „seit …“ in der
 * Browserzone, die Erwartungen („seit 1342“ aus `11:42` UTC) sind Berliner Wanduhr. Ohne
 * `mitProzessZone` hinge das Ergebnis an der Zone des Rechners (`TZ=UTC` im Container).
 */
function mitUhr() {
  mitProzessZone('Europe/Berlin');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(JETZT);
    return () => vi.useRealTimers();
  });
}

/** Zeile einer Kraft der Belegung (Liste „Bereitgestellte …“). */
const belegungsZeile = (name: string) =>
  within(screen.getByTestId('br-belegung'))
    .getByText(name)
    .closest<HTMLElement>('.listen-eintrag')!;

/** Belegung aus der Fixture der Spec: zwei Einheiten (0/1/5//6) mit je einem Fahrzeug, ein
 *  Fahrzeug ohne Einheit. */
const ZUG = einheit({
  id: 10,
  name: '1. Zug',
  typ_label: 'Zug',
  ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
});
const TRUPP = einheit({
  id: 11,
  name: 'Trupp 2',
  typ_label: 'Trupp',
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 2 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 2 },
});
const BELEGT = brDetail({
  einheiten: [
    {
      id: 10,
      name: '1. Zug',
      seit_at: '2026-10-15 11:42:00',
      fahrzeuge: [{ id: 21, funkrufname: 'Florian 1/44-1' }],
    },
    {
      id: 11,
      name: 'Trupp 2',
      seit_at: '2026-10-15 12:05:00',
      fahrzeuge: [{ id: 22, funkrufname: 'Florian 1/44-2' }],
    },
  ],
  fahrzeuge: [{ id: 23, funkrufname: 'Florian 1/83-1', seit_at: '2026-10-15 12:10:00' }],
});

function stelleBelegtBereit(br: BrDetail = BELEGT, zaehler?: { detail: number }) {
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
    http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => {
      if (zaehler) zaehler.detail += 1;
      return HttpResponse.json(br);
    }),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([ZUG, TRUPP])),
    http.get('/api/einsaetze/1/fahrzeuge', () =>
      HttpResponse.json([
        fahrzeug({
          id: 23,
          funkrufname: 'Florian 1/83-1',
          fahrzeugtyp: 'GW-San',
          aktueller_br_id: 1,
        }),
      ]),
    ),
  );
}

describe('BrDetailPage — Kennzahlenband der Belegung (LLH-1095 D9)', () => {
  mitUhr();

  it('zeigt Stärke, Fahrzeuge, Einheiten und längste Wartezeit', async () => {
    stelleBelegtBereit();
    renderBrDetail();
    await screen.findByTestId('br-summe');
    expect(kennzahl('Bereitgestellt')).toHaveTextContent('0/1/5//6');
    expect(kennzahl('Fahrzeuge')).toHaveTextContent(/^Fahrzeuge3$/);
    expect(kennzahl('Einheiten')).toHaveTextContent(/^Einheiten2$/);
    expect(kennzahl('Längste Wartezeit')).toHaveTextContent('48 min');
    expect(kennzahl('Längste Wartezeit')).toHaveTextContent('seit 1342');
  });

  it('Fahrzeuge und Einheiten kommen vom Server, nicht aus der Länge der Listen', async () => {
    stelleBelegtBereit({
      ...BELEGT,
      belegung: { einheiten: 4, fahrzeuge: 7, laengste_seit_at: null },
    });
    renderBrDetail();
    await screen.findByTestId('br-summe');
    expect(kennzahl('Fahrzeuge')).toHaveTextContent(/^Fahrzeuge7$/);
    expect(kennzahl('Einheiten')).toHaveTextContent(/^Einheiten4$/);
  });

  it('ohne frühestes „seit“ zeigt „Längste Wartezeit“ „—“ ohne Notiz', async () => {
    stelleBelegtBereit({ ...BELEGT, belegung: { ...BELEGT.belegung, laengste_seit_at: null } });
    renderBrDetail();
    await screen.findByTestId('br-summe');
    expect(kennzahl('Längste Wartezeit')).toHaveTextContent(/^Längste Wartezeit—$/);
  });

  it('das Band hält seine Notizhöhe fest: eine kommende oder gehende Notiz schiebt nichts', async () => {
    stelleBelegtBereit();
    renderBrDetail();
    const band = await screen.findByRole('group', { name: 'Bereitgestellte Kräfte' });
    expect(band).toHaveClass('lfh-kennzahlenband--notizfest');
    expect(band).toHaveClass('lfh-kennzahlenband--notizzeilen');
  });
});

describe('BrDetailPage — Zeile je Kraft mit Wartezeit (LLH-1095 D10)', () => {
  mitUhr();

  it('„seit 1342 · 48 min“, nach 60 s „49 min“ ohne neuen Abruf', async () => {
    const zaehler = { detail: 0 };
    stelleBelegtBereit(BELEGT, zaehler);
    renderBrDetail();
    await screen.findByText('1. Zug');
    expect(belegungsZeile('1. Zug')).toHaveTextContent('seit 1342 · 48 min');
    const abrufe = zaehler.detail;

    act(() => vi.advanceTimersByTime(60_000));
    expect(belegungsZeile('1. Zug')).toHaveTextContent('seit 1342 · 49 min');
    expect(kennzahl('Längste Wartezeit')).toHaveTextContent('49 min');
    expect(zaehler.detail).toBe(abrufe);
  });

  it('Einheit mit Typ, Stärke und den Funkrufnamen ihrer Fahrzeuge', async () => {
    stelleBelegtBereit();
    renderBrDetail();
    await screen.findByText('1. Zug');
    const zeile = belegungsZeile('1. Zug');
    expect(zeile).toHaveTextContent('Zug');
    expect(zeile).toHaveTextContent('0/1/3//4');
    expect(zeile).toHaveTextContent('Florian 1/44-1');
    expect(zeile).not.toHaveTextContent('Florian 1/44-2');
  });

  it('Fahrzeug ohne Einheit mit Typ und „seit …“', async () => {
    stelleBelegtBereit();
    renderBrDetail();
    await screen.findByText('Florian 1/83-1');
    const zeile = belegungsZeile('Florian 1/83-1');
    expect(zeile).toHaveTextContent('GW-San');
    expect(zeile).toHaveTextContent('seit 1410 · 20 min');
  });

  it('ohne „seit“ keine Zeitangabe, ohne Fahrzeug keine Funkrufnamen', async () => {
    stelleBelegtBereit(brDetail({ einheiten: [{ id: 10, name: '1. Zug' }] }));
    renderBrDetail();
    await screen.findByText('1. Zug');
    const zeile = belegungsZeile('1. Zug');
    expect(zeile).not.toHaveTextContent('seit');
    expect(zeile.querySelector('[data-lfh="br-einheit-fahrzeuge"]')).toBeNull();
  });

  it('Folge: am längsten wartend zuerst, eine neue Kraft kommt ans Ende', async () => {
    const stand = { br: BELEGT };
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(stand.br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([ZUG, TRUPP])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );
    const qc = renderBrDetail();
    await screen.findByText('Trupp 2');
    // „Aachen“ stünde nach Name vorn; sie ist eben eingetreten und kommt ans Ende.
    stand.br = brDetail({
      einheiten: [...BELEGT.einheiten, { id: 12, name: 'Aachen', seit_at: '2026-10-15 12:29:00' }],
    });
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(1, 1) }));
    await screen.findByText('Aachen');
    const namen = within(screen.getByTestId('br-belegung'))
      .getAllByText(/^(1\. Zug|Trupp 2|Aachen)$/)
      .map((el) => el.textContent);
    expect(namen).toEqual(['1. Zug', 'Trupp 2', 'Aachen']);
  });
});

describe('BrDetailPage — Verlauf (LLH-1095 D12)', () => {
  const VERLAUF: BrVerlaufEintrag[] = [
    {
      id: 7,
      zeitpunkt_at: '2026-10-15 12:10:00',
      art: 'wechsel_hinaus',
      objekt_typ: 'einheit',
      objekt_id: 11,
      objekt_name: 'Trupp 2',
      ziel: 'BR Schule',
    },
    {
      id: 5,
      zeitpunkt_at: '2026-10-15 12:00:00',
      art: 'austritt',
      objekt_typ: 'fahrzeug',
      objekt_id: 24,
      objekt_name: 'Florian 1/19-1',
      notiz: 'Fahrzeug entlassen',
    },
    {
      id: 3,
      zeitpunkt_at: '2026-10-15 11:42:00',
      art: 'eintritt',
      objekt_typ: 'einheit',
      objekt_id: 10,
      objekt_name: '1. Zug',
    },
  ];

  function stelleVerlaufBereit(
    antwort: () => Response,
    { einsatzDaten = einsatz(), zaehler = { verlauf: 0 } } = {},
  ) {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzDaten)),
      http.get('/api/einsaetze/1/bereitstellungsraeume/:brId', ({ params }) =>
        HttpResponse.json({ ...BELEGT, id: Number(params.brId) }),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([ZUG, TRUPP])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/bereitstellungsraeume/:brId/verlauf', () => {
        zaehler.verlauf += 1;
        return antwort();
      }),
    );
    return zaehler;
  }

  const kopf = () =>
    screen.getByRole('button', { name: 'Verlauf des Bereitstellungsraums BR Alpha' });

  it('lädt erst beim Aufklappen, genau einmal, und zeigt Zeit, Art, Objekt und Notiz', async () => {
    const zaehler = stelleVerlaufBereit(() => HttpResponse.json(VERLAUF));
    renderBrDetail();
    await screen.findByText('1. Zug');
    expect(kopf()).toHaveAttribute('aria-expanded', 'false');
    // Sichtbar steht nur „Verlauf“, der Rest des Namens ist für Vorleser.
    expect(kopf()).toHaveTextContent(/^Verlauf des Bereitstellungsraums BR Alpha$/);
    expect(zaehler.verlauf).toBe(0);

    await userEvent.click(kopf());
    expect(kopf()).toHaveAttribute('aria-expanded', 'true');
    const reihe = await screen.findByRole('list', { name: 'Verlauf' });
    const zeilen = within(reihe).getAllByRole('listitem');
    expect(zeilen.map((z) => z.textContent)).toEqual([
      expect.stringMatching(/Wechsel nach BR Schule.*Trupp 2/),
      expect.stringMatching(/Austritt.*Florian 1\/19-1.*Fahrzeug entlassen/),
      expect.stringMatching(/Eintritt.*1\. Zug/),
    ]);
    expect(zaehler.verlauf).toBe(1);
  });

  it('ein Ladefehler nennt den Fehler, nicht „Noch keine Belegung“', async () => {
    stelleVerlaufBereit(() => new HttpResponse(null, { status: 500 }));
    renderBrDetail();
    await screen.findByText('1. Zug');
    await userEvent.click(kopf());
    expect(await screen.findByText(/Verlauf konnte nicht geladen werden/)).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Belegung')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('leere Reihe: „Noch keine Belegung“', async () => {
    stelleVerlaufBereit(() => HttpResponse.json([]));
    renderBrDetail();
    await screen.findByText('1. Zug');
    await userEvent.click(kopf());
    expect(await screen.findByText('Noch keine Belegung')).toBeInTheDocument();
  });

  it('ein Live-Ereignis bringt bei offenem Verlauf die neue Zeile ohne Neuladen', async () => {
    const stand = { reihe: VERLAUF.slice(1) };
    stelleVerlaufBereit(() => HttpResponse.json(stand.reihe));
    const qc = renderBrDetail();
    await screen.findByText('1. Zug');
    await userEvent.click(kopf());
    const reihe = await screen.findByRole('list', { name: 'Verlauf' });
    expect(within(reihe).getAllByRole('listitem')).toHaveLength(2);

    stand.reihe = VERLAUF;
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.brVerlauf(1, 1) }));
    expect(await within(reihe).findByText('Wechsel nach BR Schule')).toBeInTheDocument();
  });

  it('der Wechsel in einen anderen Raum klappt den Verlauf zu', async () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/bereitstellungsraeume/2')}>
          Zum zweiten Raum
        </button>
      );
    }
    const zaehler = stelleVerlaufBereit(() => HttpResponse.json(VERLAUF));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={['/einsaetze/1/bereitstellungsraeume/1']}>
              <Wechsel />
              <Routes>
                <Route
                  path="/einsaetze/:id/bereitstellungsraeume/:brId"
                  element={<BrDetailPage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    await screen.findByText('1. Zug');
    await userEvent.click(kopf());
    await screen.findByRole('list', { name: 'Verlauf' });

    await userEvent.click(screen.getByRole('button', { name: 'Zum zweiten Raum' }));
    await waitFor(() => expect(kopf()).toHaveAttribute('aria-expanded', 'false'));
    expect(zaehler.verlauf).toBe(1);
  });

  it('steht auch ohne Schreibrecht zur Verfügung', async () => {
    stelleVerlaufBereit(() => HttpResponse.json(VERLAUF), {
      einsatzDaten: einsatz({ meine_rolle: 'beobachter' }),
    });
    renderBrDetail();
    await screen.findByText('1. Zug');
    await userEvent.click(kopf());
    expect(await screen.findByRole('list', { name: 'Verlauf' })).toBeInTheDocument();
  });

  it('steht als letzter Abschnitt unter der Belegung', async () => {
    stelleVerlaufBereit(() => HttpResponse.json(VERLAUF));
    renderBrDetail();
    await screen.findByText('1. Zug');
    expect(
      screen.getByTestId('br-belegung').compareDocumentPosition(kopf()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('BrDetailPage — Druck mit Wartezeiten (LLH-1095 D14)', () => {
  mitUhr();

  it('druckt einen gehaltenen Zugang mit „seit … · n min“ und die längste Wartezeit zum Druckzeitpunkt, ohne Verlauf', async () => {
    const stand = { br: BELEGT };
    const zaehler = { verlauf: 0 };
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(stand.br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([ZUG, TRUPP])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1/verlauf', () => {
        zaehler.verlauf += 1;
        return HttpResponse.json([]);
      }),
    );
    const qc = renderBrDetail();
    await screen.findByText('1. Zug');

    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'mouse' });
    stand.br = brDetail({
      einheiten: [...BELEGT.einheiten, { id: 12, name: 'Aachen', seit_at: '2026-10-15 12:20:00' }],
      fahrzeuge: BELEGT.fahrzeuge,
    });
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(1, 1) }));
    await screen.findByRole('button', { name: '1 neu anzeigen' });
    expect(screen.queryByText('Aachen')).not.toBeInTheDocument();

    // Der Druck rechnet zum Druckzeitpunkt, nicht mit dem Stand der Minutenuhr: die Systemzeit
    // rückt 1 min 50 s vor, ohne dass das Intervall der Uhr läuft.
    vi.setSystemTime(new Date(JETZT.getTime() + 110_000));
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(belegungsZeile('Aachen')).toHaveTextContent('seit 1420 · 11 min');
    expect(kennzahl('Längste Wartezeit')).toHaveTextContent('49 min');
    expect(
      screen.getByRole('button', { name: 'Verlauf des Bereitstellungsraums BR Alpha' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(zaehler.verlauf).toBe(0);
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
  });
});

describe('BrDetailPage — „Eintreffen buchen“ im Kopf (LLH-1075, design.md D14)', () => {
  const GERAET_ME = {
    id: 9,
    anzeigename: 'BR Alpha · Tablet',
    benutzername: 'geraet-4',
    system_rolle: 'keiner',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-10-04',
    totp_aktiviert: false,
    passwort_gesetzt: false,
    geraet: {
      kopplung_id: 4,
      einsatz_id: 1,
      ansicht: 'bereitstellungsraum',
      stelle_id: 1,
      stelle: 'BR Alpha',
      bezeichnung: 'Tablet',
      laeuft_ab_at: '2026-10-05 12:00:00',
    },
  };

  function seite(br: BrDetail, rolle: EinsatzAnzeige['meine_rolle'] = 'fuehrungspersonal') {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ meine_rolle: rolle }))),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([einheit({ id: 30, name: 'Zug Nord' })]),
      ),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/einheiten/zeitachse', () => HttpResponse.json([])),
    );
    renderBrDetail();
  }

  it('aktiv: Primärknopf öffnet den Dialog', async () => {
    seite(brDetail({ status: 'aktiv' }));
    const knopf = await screen.findByRole('button', { name: 'Eintreffen buchen' });
    expect(knopf).toHaveClass('ant-btn-primary');
    expect(knopf).toBeEnabled();
    await userEvent.click(knopf);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Eintreffen Zug Nord' })).toBeInTheDocument();
  });

  it.each(['geplant', 'aufgeloest'] as const)(
    '%s: gesperrt mit Kurzgrund „BR nicht in Betrieb“',
    async (status) => {
      seite(brDetail({ status }));
      const knopf = await screen.findByRole('button', { name: 'Eintreffen buchen' });
      expect(knopf).toBeDisabled();
      expect(knopf).toHaveAccessibleDescription('BR nicht in Betrieb');
      expect(knopf).not.toHaveClass('ant-btn-primary');
    },
  );

  it('Beobachter: kein Knopf', async () => {
    seite(brDetail({ status: 'aktiv' }), 'beobachter');
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eintreffen buchen' })).toBeNull();
  });

  it('am BR-Gerät: Knopf da (Fähigkeit `br-eintreffen`)', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(GERAET_ME)));
    seite(brDetail({ status: 'aktiv' }));
    expect(await screen.findByRole('button', { name: 'Eintreffen buchen' })).toBeEnabled();
  });
});

describe('BrDetailPage — Herkunft an der Belegungszeile (LLH-1075, design.md D14)', () => {
  it('offen „nicht übernommen“, nach der Übernahme neutral „unangemeldet“, angemeldet nichts', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () =>
        HttpResponse.json(
          brDetail({
            einheiten: [
              {
                id: 10,
                name: 'Florian Nachbar 3',
                unangemeldet: true,
                nicht_uebernommen_seit: '2026-10-16T12:00:00Z',
              },
              { id: 11, name: 'Florian Nachbar 4', unangemeldet: true },
              { id: 12, name: 'Zug Nord' },
            ],
          }),
        ),
      ),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    );
    renderBrDetail();
    const zeile = async (name: string) =>
      (await screen.findByText(name)).closest(
        '[data-lfh="liste-eintrag"], li, .ant-space',
      ) as HTMLElement;
    const offen = await zeile('Florian Nachbar 3');
    expect(within(offen).getByText('nicht übernommen')).toBeInTheDocument();
    expect(within(offen).queryByText('unangemeldet')).toBeNull();
    const uebernommen = await zeile('Florian Nachbar 4');
    expect(within(uebernommen).getByText('unangemeldet').closest('.ant-tag')).not.toHaveAttribute(
      'data-rolle',
    );
    expect(within(uebernommen).queryByText('nicht übernommen')).toBeNull();
    const angemeldet = await zeile('Zug Nord');
    expect(within(angemeldet).queryByText('unangemeldet')).toBeNull();
    expect(within(angemeldet).queryByText('nicht übernommen')).toBeNull();
  });
});

describe('BrDetailPage — Eintreffen ohne Netz (LLH-1075 Teil III)', () => {
  const GERAET_ME = {
    id: 9,
    anzeigename: 'BR Alpha · Tablet',
    benutzername: 'geraet-4',
    system_rolle: 'keiner',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-10-04',
    totp_aktiviert: false,
    passwort_gesetzt: false,
    geraet: {
      kopplung_id: 4,
      einsatz_id: 1,
      ansicht: 'bereitstellungsraum',
      stelle_id: 1,
      stelle: 'BR Alpha',
      bezeichnung: 'Tablet',
      laeuft_ab_at: '2026-10-05 12:00:00',
    },
  };
  let gesendet: number;

  beforeEach(async () => {
    gesendet = 0;
    await queueLeerenFuerTests();
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(GERAET_ME)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () =>
        HttpResponse.json(brDetail({ status: 'aktiv' })),
      ),
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([einheit({ id: 30, name: 'Zug Nord' })]),
      ),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/einheiten/zeitachse', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/eintreffen', () => {
        gesendet += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
  });
  afterEach(() => {
    setzeOnline(true);
  });

  it('am Gerät: ein Tipp merkt vor, der Raum zeigt „Vorgemerkt“, der Treffer ist gesperrt', async () => {
    renderBrDetail();
    const knopf = await screen.findByRole('button', { name: 'Eintreffen buchen' });
    act(() => setzeOnline(false));
    await userEvent.click(knopf);
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen Zug Nord' }));

    expect(await screen.findByText('Offline vorgemerkt: Eintreffen Zug Nord')).toBeInTheDocument();
    expect(gesendet).toBe(0);
    const [zeile] = await schreibaktionenLaden(9, 1);
    expect(zeile.aktion).toMatchObject({
      art: 'eintreffen',
      br_id: 1,
      bezeichnung: 'BR Alpha',
      name: 'Zug Nord',
      daten: {
        kraft: { objekt_typ: 'einheit', objekt_id: 30 },
        client_id: expect.any(String),
        zeitpunkt_at: expect.any(String),
      },
    });

    const vorgemerkt = await screen.findByTestId('br-vorgemerkt');
    expect(within(vorgemerkt).getByText('Zug Nord')).toBeInTheDocument();
    expect(within(vorgemerkt).getByText(/^vorgemerkt \d{4}/)).toBeInTheDocument();
    // Kennzahlen bleiben die des Servers (Spec `bereitstellungsraum-belegung`).
    expect(kennzahl('Einheiten')).toHaveTextContent('0');

    await userEvent.click(screen.getByRole('button', { name: 'Eintreffen buchen' }));
    const treffer = await screen.findByRole('button', { name: 'Eintreffen Zug Nord' });
    expect(treffer).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByText(/vorgemerkt \d{4}/)).toBeInTheDocument();
  });

  it('zeigt nur die Vormerkungen dieses Raums, eine unangemeldete mit Marke', async () => {
    const eintreffen = (br_id: number, name: string) => ({
      art: 'eintreffen' as const,
      br_id,
      bezeichnung: br_id === 1 ? 'BR Alpha' : 'BR Beta',
      name,
      daten: {
        unangemeldet: { fahrzeuge: [{ funkrufname: name }] },
        client_id: `c-${name}`,
        zeitpunkt_at: '2026-10-16 12:12:00',
      },
    });
    await schreibaktionEinreihen(9, 1, eintreffen(1, 'FL-MUS 1-44-1'));
    await schreibaktionEinreihen(9, 1, eintreffen(2, 'FL-MUS 2-44-1'));
    renderBrDetail();
    const vorgemerkt = await screen.findByTestId('br-vorgemerkt');
    expect(within(vorgemerkt).getByText('FL-MUS 1-44-1')).toBeInTheDocument();
    expect(within(vorgemerkt).getByText('unangemeldet')).toBeInTheDocument();
    expect(within(vorgemerkt).queryByText('FL-MUS 2-44-1')).toBeNull();
  });

  it('ohne Vormerkung keine Sektion', async () => {
    renderBrDetail();
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('br-vorgemerkt')).toBeNull();
  });
});

describe('BrDetailPage — Abrufen (LLH-1085 Teil II, Spec „Abruf in der Oberfläche“)', () => {
  const GERAET_ME = {
    id: 9,
    anzeigename: 'BR Alpha · Tablet',
    benutzername: 'geraet-4',
    system_rolle: 'keiner',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-10-04',
    totp_aktiviert: false,
    passwort_gesetzt: false,
    geraet: {
      kopplung_id: 4,
      einsatz_id: 1,
      ansicht: 'bereitstellungsraum',
      stelle_id: 1,
      stelle: 'BR Alpha',
      bezeichnung: 'Tablet',
      laeuft_ab_at: '2026-10-05 12:00:00',
    },
  };
  const DEICH = { id: 5, name: 'EA Deich' };
  const ABRUF = {
    seit_at: '2026-10-15 12:32:00',
    ziel_abschnitt_id: 5,
    ziel_anzeige: 'EA Deich',
    auftrag_id: 70,
    auftrag_nr: 7,
  };
  const ABRUF_ERGEBNIS = {
    abruf: {
      id: 9,
      einsatz_id: 1,
      br_id: 1,
      objekt_typ: 'einheit',
      objekt_id: 10,
      art: 'abruf',
      zeitpunkt_at: '2026-10-15 12:32:00',
      erfasst_von: 1,
      ziel_abschnitt_id: 5,
      ziel_anzeige: 'EA Deich',
      auftrag_id: 70,
    },
    mitgenommen: [],
    auftrag_id: 70,
    auftrag_nr: 7,
  };

  interface Aufrufe {
    abruf: unknown[];
    aufheben: unknown[];
    belegung: unknown[];
    qc: QueryClient;
  }

  /** Der Raum liefert, was `stand.br` gerade trägt; eine Live-Invalidierung holt den neuen Stand. */
  function seite(
    stand: { br: BrDetail },
    {
      einheiten = [] as Einheit[],
      freigaben = freigabenFixture(),
      abruf = () => HttpResponse.json(ABRUF_ERGEBNIS, { status: 201 }),
    }: {
      einheiten?: Einheit[];
      freigaben?: ReturnType<typeof freigabenFixture>;
      abruf?: () => Response;
    } = {},
  ): Aufrufe {
    const aufrufe = { abruf: [], aufheben: [], belegung: [] } as Omit<Aufrufe, 'qc'>;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(stand.br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
      http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([DEICH])),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/abruf', async ({ request }) => {
        aufrufe.abruf.push(await request.json());
        return abruf();
      }),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/abruf/aufheben', async ({ request }) => {
        aufrufe.aufheben.push(await request.json());
        return HttpResponse.json({});
      }),
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/belegung', async ({ request }) => {
        aufrufe.belegung.push(await request.json());
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    return { ...aufrufe, qc: renderBrDetail() };
  }

  const abgerufen = () => screen.getByTestId('br-abgerufen');
  const dialog = () => screen.getByRole('dialog');

  it('eine abgerufene Kraft steht oben unter „Abgerufen“ mit Zeit, Ziel und Auftrag, nicht unter den bereitgestellten', async () => {
    seite({
      br: brDetail({
        einheiten: [
          { id: 10, name: 'HLF 20', abruf: ABRUF, seit_at: '2026-10-15 11:42:00' },
          { id: 11, name: 'Zug Nord', seit_at: '2026-10-15 11:40:00' },
        ],
      }),
    });
    expect(
      await within(await screen.findByTestId('br-abgerufen')).findByText('HLF 20'),
    ).toBeInTheDocument();
    const zeile = within(abgerufen()).getByText('HLF 20').closest<HTMLElement>('.listen-eintrag')!;
    const angabe = zeile.querySelector<HTMLElement>('[data-lfh="br-abruf"]')!;
    expect(within(angabe).getByText('abgerufen')).toBeInTheDocument();
    expect(angabe).toHaveTextContent(/abgerufen\s*\d{4,6} → EA Deich · Auftrag Nr\. 7/);
    // Getrennt, aber weiter im Raum: die Kennzahl zählt beide Einheiten (Server).
    expect(within(abgerufen()).queryByText('Zug Nord')).toBeNull();
    expect(screen.getAllByText('HLF 20')).toHaveLength(1);
    expect(kennzahl('Einheiten')).toHaveTextContent('2');
    // „Abgerufen“ steht über den bereitgestellten Einheiten.
    expect(
      abgerufen().compareDocumentPosition(screen.getByText('Bereitgestellte Einheiten')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('eine mitgenommene Untereinheit nennt ihre Einheit', async () => {
    seite({
      br: brDetail({
        einheiten: [
          { id: 10, name: '1. Zug', abruf: ABRUF },
          {
            id: 12,
            name: 'Gruppe 1',
            abruf: { seit_at: ABRUF.seit_at, ziel_anzeige: 'EA Deich', mit_objekt_id: 10 },
          },
        ],
      }),
    });
    const zeile = (
      await within(await screen.findByTestId('br-abgerufen')).findByText('Gruppe 1')
    ).closest<HTMLElement>('.listen-eintrag')!;
    expect(zeile.querySelector('[data-lfh="br-abruf"]')).toHaveTextContent(
      /→ EA Deich · mit 1\. Zug/,
    );
  });

  it('bereitgestellt: „Abrufen“ als Hauptaktion, Nebenwege im Menü, kein roter Knopf in der Belegung', async () => {
    seite({ br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }) });
    const knopf = await screen.findByRole('button', { name: 'HLF 20 abrufen' });
    expect(knopf).toHaveTextContent('Abrufen');
    expect(screen.getByTestId('br-belegung').querySelectorAll('.ant-btn-dangerous')).toHaveLength(
      0,
    );
    const menue = await openMenue('HLF 20');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual([
      'Abrufen und austragen',
      // Ohne zweiten Raum in Betrieb (Standard-Handler: keine Räume) gesperrt mit Grund (LLH-1315).
      'In anderen BR verlegen (kein anderer Raum in Betrieb)',
      'Austragen',
    ]);
  });

  it('Abrufen: Ziel-Abschnitt mit dem Abschnitt des Raums vorbelegt, mit Auftrag', async () => {
    const aufrufe = seite({
      br: brDetail({ abschnitt_id: 5, einheiten: [{ id: 10, name: 'HLF 20' }] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'HLF 20 abrufen' }));
    expect(await within(dialog()).findByText('HLF 20 abrufen')).toBeInTheDocument();
    expect(await within(dialog()).findByTitle('EA Deich')).toBeInTheDocument();
    await userEvent.type(within(dialog()).getByLabelText('Auftrag'), 'Sandsackverbau');
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Abrufen/ }));

    await waitFor(() => expect(aufrufe.abruf).toHaveLength(1));
    expect(aufrufe.abruf[0]).toEqual({
      objekt_typ: 'einheit',
      objekt_id: 10,
      abschnitt_id: 5,
      auftrag_text: 'Sandsackverbau',
    });
    expect(
      await screen.findByText('HLF 20 abgerufen → EA Deich · Auftrag Nr. 7'),
    ).toBeInTheDocument();
  });

  it('Abrufen ohne Angaben: weder Abschnitt noch Auftrag gehen hinaus', async () => {
    const aufrufe = seite({ br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }) });
    await userEvent.click(await screen.findByRole('button', { name: 'HLF 20 abrufen' }));
    await userEvent.click(await within(dialog()).findByRole('button', { name: /^Abrufen/ }));
    await waitFor(() => expect(aufrufe.abruf).toHaveLength(1));
    expect(aufrufe.abruf[0]).toEqual({ objekt_typ: 'einheit', objekt_id: 10 });
  });

  it('eine Einheit nimmt ihren Verband mit: der Dialog nennt ihn am Knopf', async () => {
    seite(
      {
        br: brDetail({
          einheiten: [
            { id: 10, name: '1. Zug' },
            { id: 12, name: 'Gruppe 1' },
            { id: 13, name: 'Gruppe 2', abruf: ABRUF },
          ],
        }),
      },
      {
        einheiten: [
          einheit({ id: 10, name: '1. Zug' }),
          einheit({ id: 12, name: 'Gruppe 1', ueber_einheit_id: 10 }),
          einheit({ id: 13, name: 'Gruppe 2', ueber_einheit_id: 10 }),
        ],
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: '1. Zug abrufen' }));
    expect(await within(dialog()).findByText('mit Gruppe 1')).toBeInTheDocument();
  });

  it('„Abrufen und austragen“: ein Schritt mit `ausgerueckt`', async () => {
    const aufrufe = seite({ br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }) });
    await screen.findByText('HLF 20');
    const menue = await openMenue('HLF 20');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Abrufen und austragen' }));
    expect(await within(dialog()).findByText('HLF 20 abrufen und austragen')).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Abrufen und austragen/ }));
    await waitFor(() => expect(aufrufe.abruf).toHaveLength(1));
    expect(aufrufe.abruf[0]).toMatchObject({ objekt_id: 10, ausgerueckt: true });
    expect(
      await screen.findByText('HLF 20 abgerufen und ausgetragen → EA Deich · Auftrag Nr. 7'),
    ).toBeInTheDocument();
  });

  it('ein Fahrzeug ohne Einheit hat keine Unterstellung: kein Ziel-Abschnitt', async () => {
    const aufrufe = seite({
      br: brDetail({ abschnitt_id: 5, fahrzeuge: [{ id: 20, funkrufname: 'Florian 1' }] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Florian 1 abrufen' }));
    await within(dialog()).findByText('Florian 1 abrufen');
    expect(within(dialog()).queryByText('Ziel-Abschnitt')).toBeNull();
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Abrufen/ }));
    await waitFor(() => expect(aufrufe.abruf).toHaveLength(1));
    expect(aufrufe.abruf[0]).toEqual({ objekt_typ: 'fahrzeug', objekt_id: 20 });
  });

  it('ohne Freigabe Aufträge: Auftrag gesperrt mit Grund, der Text geht nicht hinaus', async () => {
    const aufrufe = seite(
      { br: brDetail({ abschnitt_id: 5, einheiten: [{ id: 10, name: 'HLF 20' }] }) },
      { freigaben: freigabenFixture({ auftraege: { zugriff: false } }) },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'HLF 20 abrufen' }));
    expect(await within(dialog()).findByText('Modul Aufträge gesperrt')).toBeInTheDocument();
    expect(within(dialog()).getByLabelText('Auftrag')).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Abrufen/ }));
    await waitFor(() => expect(aufrufe.abruf).toHaveLength(1));
    expect(aufrufe.abruf[0]).toEqual({ objekt_typ: 'einheit', objekt_id: 10, abschnitt_id: 5 });
  });

  it('ohne Freigabe Einheiten: Ziel-Abschnitt gesperrt mit Grund, kein Abschnitt geht hinaus', async () => {
    const aufrufe = seite(
      { br: brDetail({ abschnitt_id: 5, einheiten: [{ id: 10, name: 'HLF 20' }] }) },
      { freigaben: freigabenFixture({ einheiten: { zugriff: false } }) },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'HLF 20 abrufen' }));
    expect(await within(dialog()).findByText('Modul Einheiten gesperrt')).toBeInTheDocument();
    // Das gesperrte Feld zeigt keinen vorbelegten Abschnitt, der doch nicht hinausginge.
    expect(within(dialog()).queryByTitle('EA Deich')).toBeNull();
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Abrufen/ }));
    await waitFor(() => expect(aufrufe.abruf).toHaveLength(1));
    expect(aufrufe.abruf[0]).toEqual({ objekt_typ: 'einheit', objekt_id: 10 });
  });

  it('eine Ablehnung des Servers steht im Dialog, der bleibt offen, kein Toast', async () => {
    seite(
      { br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }) },
      { abruf: () => HttpResponse.json({ error: 'Kraft ist schon abgerufen' }, { status: 422 }) },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'HLF 20 abrufen' }));
    await userEvent.click(await within(dialog()).findByRole('button', { name: /^Abrufen/ }));
    expect(await within(dialog()).findByText('Nicht abgerufen')).toBeInTheDocument();
    expect(within(dialog()).getByText('Kraft ist schon abgerufen')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('abgerufen: „Ausrücken buchen“ bucht den Austritt, „Abruf zurücknehmen“ hebt ihn auf', async () => {
    const aufrufe = seite({
      br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20', abruf: ABRUF }] }),
    });
    const ausruecken = await screen.findByRole('button', { name: 'Ausrücken buchen für HLF 20' });
    expect(ausruecken).toHaveTextContent('Ausrücken buchen');
    await userEvent.click(ausruecken);
    await waitFor(() => expect(aufrufe.belegung).toHaveLength(1));
    expect(aufrufe.belegung[0]).toMatchObject({
      objekt_typ: 'einheit',
      objekt_id: 10,
      art: 'austritt',
    });
    expect(await screen.findByText('Einheit „HLF 20“ ausgerückt')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Abruf zurücknehmen für HLF 20' }));
    await waitFor(() => expect(aufrufe.aufheben).toHaveLength(1));
    expect(aufrufe.aufheben[0]).toEqual({ objekt_typ: 'einheit', objekt_id: 10 });
    expect(await screen.findByText('Abruf von HLF 20 zurückgenommen')).toBeInTheDocument();
  });

  it('am BR-Gerät: Ausrücken ja, Abrufen und Zurücknehmen nie, Austragen im Menü', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(GERAET_ME)));
    seite({
      br: brDetail({
        einheiten: [
          { id: 10, name: 'HLF 20', abruf: ABRUF },
          { id: 11, name: 'Zug Nord' },
        ],
      }),
    });
    expect(
      await screen.findByRole('button', { name: 'Ausrücken buchen für HLF 20' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Abruf zurücknehmen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /abrufen$/ })).toBeNull();
    const menue = await openMenue('Zug Nord');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Austragen']);
  });

  it('aktiver Raum ohne Abgerufene: „Abgerufen“ steht leer; im geplanten Raum fehlt es', async () => {
    seite({ br: brDetail({ einheiten: [{ id: 11, name: 'Zug Nord' }] }) });
    expect(
      await within(await screen.findByTestId('br-abgerufen')).findByText('Keine Kraft abgerufen'),
    ).toBeInTheDocument();
  });

  it('geplanter Raum: kein Abschnitt „Abgerufen“', async () => {
    seite({ br: brDetail({ status: 'geplant', einheiten: [{ id: 11, name: 'Zug Nord' }] }) });
    expect(await screen.findByText('Zug Nord')).toBeInTheDocument();
    expect(screen.queryByTestId('br-abgerufen')).toBeNull();
  });

  it('fremder Abruf bei gehaltenem Zeiger: die Zeile wartet hinter dem Banner, die Einheit verlässt die Bereitgestellten', async () => {
    // Steht schon eine Kraft unter „Abgerufen“, hält die Schleuse wie in den übrigen Listen; die
    // erste Zeile einer leeren Liste erscheint wie dort sofort (`teileZuflussNach`).
    const stand = {
      br: brDetail({
        einheiten: [
          { id: 11, name: 'Zug Nord' },
          { id: 12, name: 'Zug Süd', abruf: { ...ABRUF, seit_at: '2026-10-15 12:00:00' } },
        ],
      }),
    };
    const { qc } = seite(stand);
    await screen.findByText('Zug Nord');
    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'mouse' });
    stand.br = brDetail({
      einheiten: [
        { id: 11, name: 'Zug Nord', abruf: ABRUF },
        { id: 12, name: 'Zug Süd', abruf: { ...ABRUF, seit_at: '2026-10-15 12:00:00' } },
      ],
    });
    await act(() => qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(1, 1) }));

    const banner = await screen.findByRole('button', { name: '1 neu anzeigen' });
    expect(screen.getByText('1 neu abgerufen')).toBeInTheDocument();
    expect(screen.queryByText('Zug Nord')).toBeNull();
    await userEvent.click(banner);
    expect(await within(abgerufen()).findByText('Zug Nord')).toBeInTheDocument();
  });

  it('eigener Abruf erscheint sofort unter „Abgerufen“, auch bei gehaltenem Zeiger', async () => {
    const stand = { br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }) };
    const aufrufe = seite(stand);
    server.use(
      http.post('/api/einsaetze/1/bereitstellungsraeume/1/abruf', async ({ request }) => {
        aufrufe.abruf.push(await request.json());
        stand.br = brDetail({ einheiten: [{ id: 10, name: 'HLF 20', abruf: ABRUF }] });
        return HttpResponse.json(ABRUF_ERGEBNIS, { status: 201 });
      }),
    );
    await screen.findByText('HLF 20');
    fireEvent.pointerMove(screen.getByTestId('br-belegung'), { pointerType: 'mouse' });
    fireEvent.click(screen.getByRole('button', { name: 'HLF 20 abrufen' }));
    fireEvent.click(await within(dialog()).findByRole('button', { name: /^Abrufen/ }));

    expect(await within(abgerufen()).findByText('HLF 20')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /neu anzeigen/ })).toBeNull();
  });
});

/**
 * „In anderen BR verlegen …“ (LLH-1315, Spec `bereitstellungsraum-belegung`, „Verlegen in einen
 * anderen Raum“): ein Wechsel, gebucht am Zielraum. Nur die Führung verlegt; am Gerät fehlt der
 * Eintrag (`frontend/src/geraet/AGENTS.md`, „Bereitstellungsraum“).
 */
describe('BrDetailPage — Verlegen in einen anderen Raum (LLH-1315)', () => {
  /** Ein Eintrag der Raumliste; die Seite liest daraus nur Kennung, Bezeichnung und Zustand. */
  function raum(over: Partial<BrDetail>) {
    return { ...brDetail(over), abrufe: [], einheit_ids: [] };
  }
  const NORD = raum({ id: 2, bezeichnung: 'BR Nord' });

  function seite(
    br: BrDetail,
    {
      raeume = [raum({ id: 1, bezeichnung: 'BR Alpha' }), NORD],
      wechsel = () => HttpResponse.json({}, { status: 201 }),
    }: { raeume?: unknown[]; wechsel?: () => Response } = {},
  ) {
    const gebucht: { br: string; daten: unknown }[] = [];
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json(raeume)),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.post(
        '/api/einsaetze/1/bereitstellungsraeume/:brId/belegung',
        async ({ request, params }) => {
          gebucht.push({ br: String(params.brId), daten: await request.json() });
          return wechsel();
        },
      ),
    );
    const qc = renderBrDetail();
    return Object.assign(gebucht, { qc });
  }

  const dialog = () => screen.getByRole('dialog');

  async function verlegenWaehlen(name: string) {
    const menue = await openMenue(name);
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: 'In anderen BR verlegen …' }),
    );
    return within(dialog()).findByText(`${name} verlegen`);
  }

  it('bucht einen Wechsel am gewählten Raum und quittiert mit Ziel', async () => {
    const gebucht = seite(brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }));
    await screen.findByText('HLF 20');
    await verlegenWaehlen('HLF 20');
    await waehle('Ziel-Raum', 'BR Nord');
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Verlegen/ }));

    await waitFor(() => expect(gebucht).toHaveLength(1));
    expect(gebucht[0]).toEqual({
      br: '2',
      daten: { objekt_typ: 'einheit', objekt_id: 10, art: 'wechsel' },
    });
    expect(await screen.findByText('Einheit „HLF 20“ nach BR Nord verlegt')).toBeInTheDocument();
  });

  it('ein einheitenloses Fahrzeug wird als Fahrzeug verlegt', async () => {
    const gebucht = seite(brDetail({ fahrzeuge: [{ id: 20, funkrufname: 'Florian 1' }] }));
    await screen.findByText('Florian 1');
    await verlegenWaehlen('Florian 1');
    await waehle('Ziel-Raum', 'BR Nord');
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Verlegen/ }));
    await waitFor(() => expect(gebucht).toHaveLength(1));
    expect(gebucht[0].daten).toEqual({ objekt_typ: 'fahrzeug', objekt_id: 20, art: 'wechsel' });
    expect(
      await screen.findByText('Fahrzeug „Florian 1“ nach BR Nord verlegt'),
    ).toBeInTheDocument();
  });

  it('zur Wahl stehen nur andere Räume in Betrieb', async () => {
    seite(brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }), {
      raeume: [
        raum({ id: 1, bezeichnung: 'BR Alpha' }),
        NORD,
        raum({ id: 3, bezeichnung: 'BR Süd', status: 'geplant' }),
        raum({ id: 4, bezeichnung: 'BR Ost', storniert_at: '2026-10-15 10:00:00' }),
        raum({ id: 5, bezeichnung: 'BR West', status: 'aufgeloest' }),
        raum({ id: 6, bezeichnung: 'BR Hafen' }),
      ],
    });
    await screen.findByText('HLF 20');
    await verlegenWaehlen('HLF 20');
    await oeffne('Ziel-Raum');
    expect(optionenVon('Ziel-Raum')).toEqual(['BR Hafen', 'BR Nord']);
  });

  it('ohne zweiten Raum in Betrieb steht der Eintrag gesperrt mit Grund', async () => {
    seite(brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }), {
      raeume: [
        raum({ id: 1, bezeichnung: 'BR Alpha' }),
        raum({ id: 3, bezeichnung: 'BR Süd', status: 'geplant' }),
      ],
    });
    await screen.findByText('HLF 20');
    const menue = await openMenue('HLF 20');
    const eintrag = within(menue).getByRole('menuitem', {
      name: 'In anderen BR verlegen (kein anderer Raum in Betrieb)',
    });
    expect(eintrag).toHaveAttribute('aria-disabled', 'true');
  });

  it('eine Ablehnung des Servers steht im Dialog, der bleibt offen, kein Toast', async () => {
    seite(brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }), {
      wechsel: () =>
        HttpResponse.json({ error: 'Bereitstellungsraum ist nicht aktiv' }, { status: 422 }),
    });
    await screen.findByText('HLF 20');
    await verlegenWaehlen('HLF 20');
    await waehle('Ziel-Raum', 'BR Nord');
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Verlegen/ }));
    expect(await within(dialog()).findByText('Nicht verlegt')).toBeInTheDocument();
    expect(within(dialog()).getByText('Bereitstellungsraum ist nicht aktiv')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('geht der gewählte Raum während der Wahl außer Betrieb, geht nichts hinaus und das Feld nennt es', async () => {
    const gebucht = seite(brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }));
    await screen.findByText('HLF 20');
    await verlegenWaehlen('HLF 20');
    await waehle('Ziel-Raum', 'BR Nord');
    server.use(
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([
          raum({ id: 1, bezeichnung: 'BR Alpha' }),
          { ...NORD, status: 'aufgeloest' },
        ]),
      ),
    );
    await act(() => gebucht.qc.invalidateQueries({ queryKey: einsatzKeys.br(1) }));
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Verlegen/ }));
    expect(await within(dialog()).findByText('Raum nicht mehr in Betrieb')).toBeInTheDocument();
    expect(gebucht).toHaveLength(0);
  });

  it('verlegt jemand anderes die Kraft während der Wahl, sperrt der Dialog und bucht nichts', async () => {
    const stand = { br: brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }) };
    const gebucht = seite(stand.br);
    server.use(
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(stand.br)),
    );
    await screen.findByText('HLF 20');
    await verlegenWaehlen('HLF 20');
    await waehle('Ziel-Raum', 'BR Nord');
    stand.br = brDetail({ einheiten: [] });
    await act(() => gebucht.qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(1, 1) }));
    expect(
      await within(dialog()).findByText('steht nicht mehr bereit in diesem Raum'),
    ).toBeInTheDocument();
    const knopf = within(dialog()).getByRole('button', { name: /^Verlegen/ });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    expect(gebucht).toHaveLength(0);
  });

  it('ohne Ziel-Raum geht nichts hinaus', async () => {
    const gebucht = seite(brDetail({ einheiten: [{ id: 10, name: 'HLF 20' }] }));
    await screen.findByText('HLF 20');
    await verlegenWaehlen('HLF 20');
    await userEvent.click(within(dialog()).getByRole('button', { name: /^Verlegen/ }));
    expect(await within(dialog()).findByText('Ziel-Raum wählen')).toBeInTheDocument();
    expect(gebucht).toHaveLength(0);
  });
});

/**
 * „Auf Karte verorten“ (LLH-1107, Muster Betreuungsstelle LFH-673): der Knopf an den Raumdaten
 * schickt die Lagekarte in den Platziermodus für diesen Raum. Wer den Raum nicht bearbeiten darf,
 * bekommt ihn nicht; ohne Freigabe der Lagekarte steht er gesperrt mit Grund.
 */
describe('BrDetailPage — Auf Karte verorten (LLH-1107)', () => {
  function KartenSonde() {
    const ort = useLocation();
    return <div data-testid="karte">{`${ort.pathname}${ort.search}`}</div>;
  }

  function seite(
    br: BrDetail,
    {
      rolle = 'fuehrungspersonal',
      freigaben,
    }: {
      rolle?: EinsatzAnzeige['meine_rolle'];
      freigaben?: Record<string, { zugriff: boolean }>;
    } = {},
  ) {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ meine_rolle: rolle }))),
      http.get('/api/einsaetze/1/bereitstellungsraeume/1', () => HttpResponse.json(br)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture(freigaben)),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={['/einsaetze/1/bereitstellungsraeume/1']}>
              <Routes>
                <Route
                  path="/einsaetze/:id/bereitstellungsraeume/:brId"
                  element={<BrDetailPage />}
                />
                <Route path="/einsaetze/:id/lagekarte" element={<KartenSonde />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
  }

  it('unverortet: „Auf Karte verorten“ öffnet die Lagekarte im Platziermodus für diesen Raum', async () => {
    seite(brDetail({ status: 'geplant' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Auf Karte verorten' }));
    expect(await screen.findByTestId('karte')).toHaveTextContent(
      // Mit Herkunft: die Karte bietet danach „Zurück zu …“ an (LLH-1125).
      '/einsaetze/1/lagekarte?platzieren=bereitstellungsraum%3A1&zurueck=1',
    );
  });

  it('verortet: derselbe Weg heißt „Auf Karte versetzen“', async () => {
    seite(brDetail({ lat: 51.93, lon: 8.87 }));
    expect(await screen.findByRole('button', { name: 'Auf Karte versetzen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auf Karte verorten' })).not.toBeInTheDocument();
  });

  it('ohne Freigabe der Lagekarte: gesperrt, der Grund steht im Text', async () => {
    seite(brDetail(), { freigaben: { lagekarte: { zugriff: false } } });
    const knopf = await screen.findByRole('button', {
      name: 'Auf Karte verorten (Keine Berechtigung)',
    });
    expect(knopf).toBeDisabled();
  });

  it('nicht für Beobachter', async () => {
    seite(brDetail(), { rolle: 'beobachter' });
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Auf Karte/ })).not.toBeInTheDocument();
  });

  it('nicht nach dem Auflösen', async () => {
    seite(brDetail({ status: 'aufgeloest' }));
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Auf Karte/ })).not.toBeInTheDocument();
  });

  it('nicht nach dem Stornieren (LLH-1304)', async () => {
    seite(brDetail({ storniert_at: '2026-10-15 08:00:00', lat: 51.93, lon: 8.87 }));
    expect(await screen.findByText('Bereitgestellte Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Auf Karte/ })).not.toBeInTheDocument();
  });
});
