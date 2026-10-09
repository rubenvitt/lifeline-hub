import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router';
import BrDetailPage from './BrDetailPage';
import { AuthProvider } from '../../auth/AuthContext';
import { setzeViewportBreite } from '../../test/viewport';
import type { BrDetail, EinsatzAnzeige, Einheit, EinsatzFahrzeug } from '../../api/types';
import { einsatzFixture } from '../../test/fixtures';
import { einsatzKeys } from '../../api/queryKeys';

// `BrSwitcher` feuert eine eigene `listeBr`-Query ohne MSW-Handler (`onUnhandledRequest: 'error'`);
// diese Datei testet die Seiten-Komposition, nicht den Switcher.
vi.mock('./BrSwitcher', () => ({ default: () => <div>SWITCHER</div> }));

function einsatz(over: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return einsatzFixture({ bezeichnung: 'Test-Einsatz', meine_rolle: 'fuehrungspersonal', ...over });
}

function brDetail(over: Partial<BrDetail> = {}): BrDetail {
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
    einheiten: [],
    fahrzeuge: [],
    ...over,
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
  it('zeigt bereitgestellte Einheiten und entfernt per Austritt', async () => {
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

    const btn = screen.getByRole('button', { name: 'entfernen' });
    await userEvent.click(btn);

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({ art: 'austritt', objekt_typ: 'einheit', objekt_id: 10 });
    // Die Quittung nennt Handlung und Objekt (LFH-948); die Bezeichnung geht nicht zum Server.
    expect(
      await screen.findByText('Einheit „Einheit Alpha“ aus dem BR entfernt'),
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
  it('zeigt bei BR-Status geplant keine entfernen-/zuweisen-Buttons', async () => {
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
    // … aber keine Schreibaktionen (entfernen/zuweisen).
    expect(screen.queryByRole('button', { name: 'entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zuweisen$/ })).not.toBeInTheDocument();
  });

  it('zeigt für Beobachter keine entfernen-/zuweisen-Buttons (BR aktiv)', async () => {
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
    expect(screen.queryByRole('button', { name: 'entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zuweisen$/ })).not.toBeInTheDocument();
  });
});

describe('BrDetailPage — Typ, Stärke, Summenzeile (LFH-347 · M58a)', () => {
  it('zeigt je bereitgestellter Einheit Typ und Stärke sowie die Summenzeile', async () => {
    const zug = einheit({
      id: 10,
      name: 'Zug 1',
      typ_label: 'Zug',
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    });
    const trupp = einheit({
      id: 11,
      name: 'Trupp 2',
      typ_label: 'Trupp',
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

    const summe = await screen.findByTestId('br-summe');
    expect(summe).toHaveTextContent(/Bereitgestellt\s*1\/4\/20\/\/25/);
    expect(summe).toHaveTextContent(/Fahrzeug\s*1$/);
    expect(screen.getByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('LF 20')).toBeInTheDocument();
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
    const entfernen = await screen.findByRole('button', { name: 'entfernen' });

    act(() => entfernen.focus());
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
