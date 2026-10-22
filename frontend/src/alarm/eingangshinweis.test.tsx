import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BenachrichtigungAnzeige,
  BenachrichtigungBezugTyp,
  BenachrichtigungEreignis,
  MeldungStatus,
} from '../api/types';
import AlarmZentrale from '../einsatz/AlarmZentrale';
import { BENACHRICHTIGUNG_WINDOW_EVENT } from '../live/benachrichtigungListener';
import { server } from '../test/server';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import { spieleAlarmTon } from './alarmTon';
import { schliesseAlleDesktopAlarme } from './desktopAlarm';
import { EINGANG_TON_ABSTAND_MS, setzeEingangTonZurueck } from './useEingangshinweis';

/**
 * Eingangshinweis (LLH-1062, Spec `benachrichtigungen`, „Eingangshinweis“): neue Meldungen und
 * Übernahmen in die Lage gebündelt an einem eigenen Platz, Ton gedrosselt, Sichten räumt.
 */

vi.mock('./webPush', async (original) => ({
  ...(await original<typeof import('./webPush')>()),
  schliessePushMeldungen: vi.fn(async () => undefined),
}));

vi.mock('./alarmTon', async (original) => ({
  ...(await original<typeof import('./alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

const ton = vi.mocked(spieleAlarmTon);

type MeldungDaten = { absender: string; inhalt: string; status?: MeldungStatus };

/** Eine Benachrichtigung der Art `meldung`, wie der Server sie liest. */
function eingang(
  id: number,
  meldung: number,
  bezug_typ: BenachrichtigungBezugTyp = 'meldung',
): BenachrichtigungAnzeige {
  return {
    id,
    einsatz_id: 1,
    art: 'meldung',
    stufe: 'hinweis',
    bezug_typ,
    bezug_id: meldung,
    erstellt_at: '2026-10-21 12:05:00',
    titel: bezug_typ === 'lage_uebernahme' ? 'In die Lage übernommen' : 'Neue Meldung',
    detail: `Meldung #${meldung}`,
    pfad:
      bezug_typ === 'lage_uebernahme'
        ? '/einsaetze/1/lagemeldungen'
        : `/einsaetze/1/meldungen?meldung=${meldung}`,
  };
}

function ereignis(b: BenachrichtigungAnzeige, quittiert = false): BenachrichtigungEreignis {
  return {
    einsatz_id: b.einsatz_id,
    benachrichtigung_id: b.id,
    art: b.art,
    stufe: b.stufe,
    bezug_typ: b.bezug_typ,
    bezug_id: b.bezug_id,
    quittiert,
  };
}

function live(b: BenachrichtigungAnzeige, quittiert = false) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail: ereignis(b, quittiert) }),
    );
  });
}

/** Der Server kennt diese Benachrichtigungen und Meldungen; Quittungen und Sichtungen zählen mit. */
function serverMit(liste: BenachrichtigungAnzeige[], meldungen: Record<number, MeldungDaten>) {
  const quittiert: number[] = [];
  const gesichtet: number[] = [];
  server.use(
    http.get('/api/einsaetze/:einsatzId/meldungen/:id', ({ params }) => {
      const m = meldungen[Number(params.id)];
      return m
        ? HttpResponse.json({ id: Number(params.id), status: 'neu', ...m })
        : HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 });
    }),
    http.post('/api/einsaetze/:einsatzId/meldungen/:id/status', async ({ params, request }) => {
      const body = (await request.json()) as { status: string };
      expect(body.status).toBe('gesichtet');
      gesichtet.push(Number(params.id));
      return HttpResponse.json({ id: Number(params.id), status: 'gesichtet' });
    }),
    http.get('/api/benachrichtigungen/:id', ({ params }) => {
      const b = liste.find((x) => x.id === Number(params.id));
      return b ? HttpResponse.json(b) : HttpResponse.json({ error: 'weg' }, { status: 404 });
    }),
    http.get('/api/benachrichtigungen', () => HttpResponse.json([])),
    http.post('/api/benachrichtigungen/:id/quittieren', ({ params }) => {
      quittiert.push(Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { quittiert, gesichtet };
}

function Rahmen({ darfSichten }: { darfSichten: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const einsatzId = Number(useParams().id);
  return (
    <>
      <button type="button" onClick={() => navigate('/einsaetze/1/lagekarte')}>
        Zur Karte
      </button>
      <input aria-label="Wortlaut" />
      <AlarmZentrale einsatzId={einsatzId} darfSichten={darfSichten} />
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}

function renderZentrale({ start = '/einsaetze/1/lagekarte', darfSichten = true } = {}) {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route path="/einsaetze/:id/*" element={<Rahmen darfSichten={darfSichten} />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

/** Der Eingangshinweis: die eine Notification mit dem Titel. */
function hinweis(titel: string | RegExp): HTMLElement {
  const el = screen.getByText(titel).closest<HTMLElement>('.ant-notification-notice');
  if (!el) throw new Error(`kein Hinweis „${String(titel)}“`);
  return el;
}

async function warteBisWeg(titel: string | RegExp) {
  await waitFor(() => {
    for (const el of screen.queryAllByText(titel)) {
      const n = el.closest<HTMLElement>('.ant-notification-notice');
      if (n) {
        fireEvent.transitionEnd(n);
        fireEvent.animationEnd(n);
      }
    }
    expect(screen.queryByText(titel)).not.toBeInTheDocument();
  });
}

let jetzt = Date.UTC(2026, 9, 21, 12, 0);

beforeEach(() => {
  setzeViewportBreite(1366);
  ton.mockClear();
  setzeEingangTonZurueck();
  jetzt = Date.UTC(2026, 9, 21, 12, 0);
  vi.spyOn(Date, 'now').mockImplementation(() => jetzt);
});

afterEach(() => {
  vi.mocked(Date.now).mockRestore();
  schliesseAlleDesktopAlarme();
  setzeViewportBreite(VIEWPORT_STANDARD);
});

describe('Eingangshinweis (LLH-1062)', () => {
  it('neue Lagemeldung vom Gerät: Hinweis mit Absender und Wortlaut, dezenter Ton', async () => {
    const b = eingang(1001, 51);
    serverMit([b], { 51: { absender: 'UHS Nord', inhalt: 'Decken knapp, 20 Stück benötigt' } });
    renderZentrale();
    live(b);

    const titel = await screen.findByText('Neue Meldung · UHS Nord');
    const n = hinweis('Neue Meldung · UHS Nord');
    expect(titel.closest('.ant-notification-notice-info')).not.toBeNull();
    expect(within(n).getByText('Decken knapp, 20 Stück benötigt')).toBeInTheDocument();
    expect(within(n).getByRole('button', { name: 'Sichten: UHS Nord' })).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('10 Meldungen in einer Minute: ein Hinweis „10 neue Meldungen“, ein Ton', async () => {
    const liste = Array.from({ length: 10 }, (_, i) => eingang(1100 + i, 60 + i));
    const meldungen = Object.fromEntries(
      liste.map((b, i) => [b.bezug_id, { absender: `Florian ${i + 1}`, inhalt: `Lage ${i + 1}` }]),
    );
    serverMit(liste, meldungen);
    renderZentrale();
    for (const b of liste) {
      live(b);
      jetzt += 6_000;
    }

    expect(await screen.findByText('10 neue Meldungen')).toBeInTheDocument();
    const n = hinweis('10 neue Meldungen');
    // Die jüngsten zwei stehen mit Absender, der Rest als Zahl.
    expect(within(n).getByText('Florian 10')).toBeInTheDocument();
    expect(within(n).getByText('Florian 9')).toBeInTheDocument();
    expect(within(n).getByText('+ 8 weitere')).toBeInTheDocument();
    expect(within(n).getByRole('button', { name: 'Zu Meldungen' })).toBeInTheDocument();
    // Ein Platz, kein Sammeltoast des Budgets.
    expect(document.querySelectorAll('.ant-notification-notice')).toHaveLength(1);
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');

    // Nach zwei Minuten darf der nächste Eingang wieder tönen.
    jetzt += EINGANG_TON_ABSTAND_MS;
    const elfte = eingang(1110, 70);
    liste.push(elfte);
    meldungen[70] = { absender: 'Florian 11', inhalt: 'Lage 11' };
    live(elfte);
    expect(await screen.findByText('11 neue Meldungen')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledTimes(2);
  });

  it('„Sichten“ setzt die Meldung auf Gesichtet und räumt ihren Eintrag', async () => {
    const eins = eingang(1201, 81);
    const zwei = eingang(1202, 82);
    const s = serverMit([eins, zwei], {
      81: { absender: 'EA Nord', inhalt: 'Lage ruhig' },
      82: { absender: 'EA Süd', inhalt: 'Pegel steigt' },
    });
    renderZentrale();
    live(eins);
    live(zwei);
    const n = await waitFor(() => hinweis('2 neue Meldungen'));

    await userEvent.click(within(n).getByRole('button', { name: 'Sichten: EA Süd' }));
    await waitFor(() => expect(s.gesichtet).toEqual([82]));
    expect(await screen.findByText('Neue Meldung · EA Nord')).toBeInTheDocument();
    // Das Quittier-Ereignis des Servers (gesichtet von jemand anderem) räumt den Rest.
    live(eins, true);
    await warteBisWeg('Neue Meldung · EA Nord');
    expect(s.quittiert).toEqual([]);
  });

  it('scheitert „Sichten“, steht der Grund in der Zeile, der Eintrag bleibt', async () => {
    const b = eingang(1250, 85);
    serverMit([b], { 85: { absender: 'EA West', inhalt: 'Lage ruhig' } });
    server.use(
      http.post('/api/einsaetze/:einsatzId/meldungen/:id/status', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderZentrale();
    live(b);
    const n = await waitFor(() => hinweis('Neue Meldung · EA West'));
    await userEvent.click(within(n).getByRole('button', { name: 'Sichten: EA West' }));
    expect(await within(hinweis('Neue Meldung · EA West')).findByRole('alert')).toHaveTextContent(
      'Sichten fehlgeschlagen',
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('ohne Schreibrecht kein „Sichten“', async () => {
    const b = eingang(1301, 91);
    serverMit([b], { 91: { absender: 'EA Nord', inhalt: 'Lage ruhig' } });
    renderZentrale({ darfSichten: false });
    live(b);
    const n = await waitFor(() => hinweis('Neue Meldung · EA Nord'));
    expect(within(n).queryByRole('button', { name: /Sichten/ })).not.toBeInTheDocument();
  });

  it('eine schon gesichtete Meldung bietet kein „Sichten“ an', async () => {
    const b = eingang(1302, 92);
    serverMit([b], { 92: { absender: 'EA Süd', inhalt: 'Lage ruhig', status: 'gesichtet' } });
    renderZentrale();
    live(b);
    const n = await waitFor(() => hinweis('Neue Meldung · EA Süd'));
    expect(within(n).queryByRole('button', { name: /Sichten/ })).not.toBeInTheDocument();
  });

  it('✕ quittiert alle Einträge für den Nutzer', async () => {
    const eins = eingang(1401, 101);
    const zwei = eingang(1402, 102, 'lage_uebernahme');
    const s = serverMit([eins, zwei], {
      101: { absender: 'EA Nord', inhalt: 'Lage ruhig' },
      102: { absender: 'EA Süd', inhalt: 'Deich hält' },
    });
    renderZentrale();
    live(eins);
    live(zwei);
    const n = await waitFor(() => hinweis('2 neue Meldungen'));
    expect(within(n).getByText(/in die Lage übernommen/)).toBeInTheDocument();
    await userEvent.click(within(n).getByRole('button', { name: /close|schließen/i }));
    await waitFor(() => expect([...s.quittiert].sort()).toEqual([1401, 1402]));
  });

  it('Übernahme in die Lage allein: „Öffnen“ springt zu den Lagemeldungen und quittiert', async () => {
    const b = eingang(1501, 111, 'lage_uebernahme');
    const s = serverMit([b], { 111: { absender: 'EA Nord', inhalt: 'Deich hält' } });
    renderZentrale();
    live(b);
    const n = await waitFor(() => hinweis('In die Lage übernommen · EA Nord'));
    expect(within(n).queryByRole('button', { name: /Sichten/ })).not.toBeInTheDocument();
    await userEvent.click(within(n).getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/lagemeldungen');
    await waitFor(() => expect(s.quittiert).toEqual([1501]));
  });

  it('während einer Eingabe wartet der Hinweis, bis der Fokus das Feld verlässt', async () => {
    const b = eingang(1601, 121);
    serverMit([b], { 121: { absender: 'UHS Süd', inhalt: 'Trage fehlt' } });
    renderZentrale();
    const feld = screen.getByLabelText('Wortlaut');
    act(() => feld.focus());
    live(b);
    // Der Inhalt ist geholt (Abruf durch), der Hinweis steht trotzdem nicht.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText('Neue Meldung · UHS Süd')).not.toBeInTheDocument();
    expect(ton).not.toHaveBeenCalled();

    act(() => feld.blur());
    expect(await screen.findByText('Neue Meldung · UHS Süd')).toBeInTheDocument();
    expect(ton).toHaveBeenCalledExactlyOnceWith('dezent');
  });

  it('auf der Meldungsseite kein Hinweis; beim Verlassen steht er da, ohne Ton', async () => {
    const b = eingang(1701, 131);
    serverMit([b], { 131: { absender: 'BR Nord', inhalt: 'Zwei Fahrzeuge eingetroffen' } });
    renderZentrale({ start: '/einsaetze/1/meldungen' });
    live(b);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText('Neue Meldung · BR Nord')).not.toBeInTheDocument();
    expect(ton).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Zur Karte' }));
    expect(await screen.findByText('Neue Meldung · BR Nord')).toBeInTheDocument();
    expect(ton).not.toHaveBeenCalled();
  });

  it('der Eingang verbraucht das Toast-Budget nicht', async () => {
    const auftraege: BenachrichtigungAnzeige[] = [1, 2, 3].map((n) => ({
      id: 1800 + n,
      einsatz_id: 1,
      art: 'auftrag_erteilt',
      stufe: 'hinweis',
      bezug_typ: 'auftrag',
      bezug_id: n,
      erstellt_at: '2026-10-21 12:00:00',
      titel: `Neuer Auftrag ${n}`,
      pfad: `/einsaetze/1/auftraege?auftrag=${n}`,
    }));
    const b = eingang(1810, 141);
    serverMit([...auftraege, b], { 141: { absender: 'UHS Ost', inhalt: 'Ruhig' } });
    renderZentrale();
    for (const a of auftraege) live(a);
    for (const n of [1, 2, 3]) await screen.findByText(`Neuer Auftrag ${n}`);
    live(b);
    expect(await screen.findByText('Neue Meldung · UHS Ost')).toBeInTheDocument();
    // Alle drei Aufträge stehen weiter einzeln, kein Sammeltoast.
    for (const n of [1, 2, 3]) expect(screen.getByText(`Neuer Auftrag ${n}`)).toBeInTheDocument();
    expect(screen.queryByText(/weitere Hinweise/)).not.toBeInTheDocument();
  });
});
