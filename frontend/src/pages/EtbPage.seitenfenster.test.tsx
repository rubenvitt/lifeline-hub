import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import { adminFixture } from '../test/fixtures';
import { entwuerfeLeerenFuerTests } from '../etb/entwuerfe/entwurfStore';
import { queueLeerenFuerTests } from '../offline/queue';
import { SCHLUESSEL_ETB_STANDARD_RUFNAME } from '../etb/standardRufname';
import type { EtbEintragAnzeige } from '../api/types';
import EtbPage from './EtbPage';

// Geprüft wird das Blättern, nicht der Satz: ein Klartext-Ersatz hält tausende gerenderte Zeilen
// in jsdom unter der Testzeit. Das echte `Markdown` deckt `EtbPage.test.tsx` ab.
vi.mock('../components/Markdown', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

/**
 * Das Seitenfenster der ETB-Zeitachse (LFH-947, Spec `etb-zeitachse-fenster`).
 *
 * Der Server ist ein Tagebuch mit {@link GESAMT} Einträgen; Kennung = laufende Nummer. Er
 * beantwortet beide Cursor wie `src/etb/repo.rs::abfrage`. Ziel `?eintrag=50` liegt 12 Seiten
 * tief, mehr als das Fenster hält.
 */
const GESAMT = 1200;

function eintrag(n: number): EtbEintragAnzeige {
  return {
    id: n,
    lfd_nr: n,
    typ: 'meldung',
    inhalt: `Eintrag ${n}`,
    von: 'ELW 1',
    an: 'Leitstelle',
    meldeweg: null,
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Admin',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    berichtigt_durch: [],
    einheiten: [],
    anhaenge: [],
  } as EtbEintragAnzeige;
}

let gesamt = GESAMT;
let abrufe: string[] = [];
/** Ältere Seiten unter dieser Nummer antworten mit 500 (Sprung scheitert am Server). */
let fehlerUnter: number | null = null;
/**
 * Wird beim nächsten Abruf ohne Cursor (der Kopf) aufgerufen, nachdem die Antwort feststeht: ein
 * fremder Eintrag, der während des Abrufs eintrifft (LLH-2036).
 */
let waehrendKopfabruf: (() => void) | null = null;

function tagebuch() {
  return http.get('/api/einsaetze/7/etb', ({ request }) => {
    const p = new URL(request.url).searchParams;
    abrufe.push(p.toString());
    const limit = Number(p.get('limit') ?? 100);
    const vor = p.get('before_lfd_nr');
    const nach = p.get('after_lfd_nr');
    const alle = Array.from({ length: gesamt }, (_, i) => gesamt - i);
    if (nach != null) {
      const ueber = alle.filter((n) => n > Number(nach));
      return HttpResponse.json(ueber.slice(Math.max(0, ueber.length - limit)).map(eintrag));
    }
    if (fehlerUnter != null && vor != null && Number(vor) < fehlerUnter) {
      return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
    }
    const unter = vor != null ? alle.filter((n) => n < Number(vor)) : alle;
    const antwort = unter.slice(0, limit).map(eintrag);
    if (vor == null && waehrendKopfabruf) {
      const hinterher = waehrendKopfabruf;
      waehrendKopfabruf = null;
      hinterher();
    }
    return HttpResponse.json(antwort);
  });
}

function Springer() {
  const navigate = useNavigate();
  const ort = useLocation();
  return (
    <>
      <div data-testid="ort-suche">{ort.search}</div>
      <button type="button" onClick={() => navigate('/einsaetze/7/etb?eintrag=1190')}>
        springe-neu
      </button>
    </>
  );
}

function setup(route: string) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json({
        id: 7,
        bezeichnung: 'Hochwasser Nord',
        stichwort: 'THW',
        status: 'aktiv',
        begonnen_at: '2026-05-23 09:00:00',
        abgeschlossen_at: null,
        abgeschlossen_von: null,
        meine_rolle: 'einsatzleitung',
      }),
    ),
    tagebuch(),
    http.post('/api/einsaetze/7/etb', () => {
      gesamt += 1;
      return HttpResponse.json(eintrag(gesamt), { status: 201 });
    }),
    http.get('/api/einsaetze/7/etb/counters', () =>
      HttpResponse.json({
        gesamt,
        je_typ: {
          meldung: gesamt,
          anordnung: 0,
          lage: 0,
          entscheidung: 0,
          system: 0,
          berichtigung: 0,
        },
      }),
    ),
    http.get('/api/etb-bausteine', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    http.get('/api/benutzer-einstellungen', () =>
      HttpResponse.json({
        eintraege: { [SCHLUESSEL_ETB_STANDARD_RUFNAME]: '{"von":"ELW 1","an":"ELW 1"}' },
      }),
    ),
  );
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>
      <Springer />
    </CommandPaletteProvider>,
    { route },
  );
}

function zeile(container: HTMLElement, n: number) {
  return container.querySelector(`[data-zeile="eintrag-${n}"]`);
}

function nummernImDom(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="etb-ereigniszeile"]')].map(
    (z) => Number(z.dataset.zeile!.replace('eintrag-', '')),
  );
}

async function warteAufHervorhebung(container: HTMLElement, n: number) {
  await waitFor(() => expect(zeile(container, n)).toHaveClass('zeile-hervorgehoben'), {
    timeout: 30000,
  });
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  await queueLeerenFuerTests();
  localStorage.clear();
  gesamt = GESAMT;
  abrufe = [];
  fehlerUnter = null;
  waehrendKopfabruf = null;
});

/** Klickt „Neuere laden“, bis der Knopf fehlt; liefert die Zahl der Klicks. */
async function neuereBisZumKopf(user: ReturnType<typeof userEvent.setup>): Promise<number> {
  await screen.findByRole('button', { name: 'Neuere laden' });
  let runden = 0;
  while (screen.queryByRole('button', { name: 'Neuere laden' })) {
    runden += 1;
    if (runden > 20) throw new Error('„Neuere laden“ endet nicht');
    await user.click(screen.getByRole('button', { name: 'Neuere laden' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Neuere laden' })).not.toHaveClass(
        'ant-btn-loading',
      ),
    ).catch(() => undefined);
  }
  return runden;
}

describe('EtbPage — Seitenfenster (LFH-947)', () => {
  it('nach einem Sprung 12 Seiten tief kostet ein etb-Ereignis höchstens 5 Listenabrufe', async () => {
    const { container, client } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);
    // Das Ziel bleibt im Fenster, und das Fenster hält höchstens 500 Einträge.
    expect(nummernImDom(container).length).toBeLessThanOrEqual(500);

    abrufe = [];
    await act(async () => {
      await client.invalidateQueries({ queryKey: einsatzKeys.etb(7) });
    });
    const listenAbrufe = abrufe.filter((a) => a.includes('limit='));
    expect(listenAbrufe.length).toBeGreaterThan(0);
    expect(listenAbrufe.length).toBeLessThanOrEqual(5);
    expect(zeile(container, 50)).not.toBeNull();
    // Das Neuladen gelingt, statt mit den Optionen einer fremden Abfrage im selben Cache-Fach zu
    // scheitern (LLH-1412): ohne Lagebesprechung trug die Nachtragsabfrage denselben Schlüssel. Der
    // Schlüssel trägt die Vorgabe ohne Systemeinträge (kwc2yszv D6).
    expect(client.getQueryState(einsatzKeys.etbListe(7, { ohne_system: true }))?.status).toBe(
      'success',
    );
  }, 120000);

  it('Kopfzahl bleibt die Serverzählung, nicht das Fenster', async () => {
    const { container } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="seitenkopf"]')).toHaveTextContent('1200 Einträge'),
    );
  }, 120000);

  it('am Kopf steht kein „Neuere laden“', async () => {
    setup('/einsaetze/7/etb');
    await screen.findByText('Eintrag 1200');
    expect(screen.queryByRole('button', { name: 'Neuere laden' })).toBeNull();
  });

  it('„Neuere laden“ führt aus einem tiefen Fenster lückenlos zum neuesten Eintrag', async () => {
    gesamt = 700;
    const user = userEvent.setup();
    const { container } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);

    const knopf = await screen.findByRole('button', { name: 'Neuere laden' });
    expect(knopf).toBeInTheDocument();
    let runden = 0;
    while (screen.queryByRole('button', { name: 'Neuere laden' })) {
      runden += 1;
      if (runden > 20) throw new Error('„Neuere laden“ endet nicht');
      await user.click(screen.getByRole('button', { name: 'Neuere laden' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Neuere laden' })).not.toHaveClass(
          'ant-btn-loading',
        ),
      ).catch(() => undefined);
    }
    await waitFor(() => expect(zeile(container, 700)).not.toBeNull());
    // Lückenlos: die gerenderten Nummern sind eine geschlossene Folge, aufsteigend bis zum
    // neuesten Eintrag ganz unten (Funkprotokoll, LLH-1149).
    const nrn = nummernImDom(container);
    expect(nrn[nrn.length - 1]).toBe(700);
    nrn.forEach((n, i) => expect(n).toBe(700 - (nrn.length - 1 - i)));
    // Die neuere Seite kam über den Cursor nach oben, nicht über einen Neustart am Kopf.
    expect(abrufe.some((a) => a.includes('after_lfd_nr='))).toBe(true);
  }, 120000);

  it('„Neuere laden“ endet mit der neuesten Seite, ohne leeren Extraklick (LLH-2036)', async () => {
    gesamt = 700;
    const user = userEvent.setup();
    const { container } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);

    await neuereBisZumKopf(user);
    await waitFor(() => expect(zeile(container, 700)).not.toBeNull());
    // Die Seitengrenzen des Rückwegs liegen auf denen des Hinwegs (100er-Schritte ab 700). Mit
    // genau einer Seitengröße kam die Seite 700…601 voll, und ein weiterer Klick holte über 700
    // eine leere Seite. Eine `neuer`-Seite fragt deshalb einen Eintrag mehr an.
    const nachOben = abrufe.filter((a) => a.includes('after_lfd_nr='));
    expect(nachOben.length).toBeGreaterThan(0);
    nachOben.forEach((a) => expect(a).toContain('limit=101'));
    expect(abrufe.some((a) => a.includes('after_lfd_nr=700'))).toBe(false);
  }, 120000);

  it('nach dem Rückweg bleibt der Kopf auch beim Live-Neuladen im Fenster (LLH-2036)', async () => {
    gesamt = 700;
    const user = userEvent.setup();
    const { container, client } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);
    // Während man tief liest, kommen 99 Einträge dazu: der Rückweg endet mit der Seite 799…701,
    // die nicht voll ist und damit der Kopf.
    gesamt = 799;
    await neuereBisZumKopf(user);
    await waitFor(() => expect(zeile(container, 799)).not.toBeNull());

    // Zwei fremde Einträge kommen live: trüge die vorderste Seite noch ihren Cursor `neuer: 700`,
    // läse das Neuladen nur die Einträge direkt darüber — sie würde „voll“, der neueste fehlte und
    // „Neuere laden“ stünde wieder da, obwohl das Fenster am Kopf war.
    gesamt = 801;
    await act(async () => {
      await client.invalidateQueries({ queryKey: einsatzKeys.etb(7) });
    });
    await waitFor(() => expect(zeile(container, 801)).not.toBeNull());
    expect(zeile(container, 800)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Neuere laden' })).toBeNull();
  }, 120000);

  it('ein Sprung über ein tiefes Fenster lädt neuere Seiten nach und hebt hervor', async () => {
    const user = userEvent.setup();
    const { container } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''));

    await user.click(screen.getByRole('button', { name: 'springe-neu' }));
    await warteAufHervorhebung(container, 1190);
    expect(abrufe.some((a) => a.includes('after_lfd_nr='))).toBe(true);
  }, 120000);

  it('der eigene neue Eintrag erscheint auch aus einem tiefen Fenster', async () => {
    const user = userEvent.setup();
    const { container } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);

    const feld = await screen.findByPlaceholderText(/Inhalt/);
    // Eine Meldung braucht ein Von (Change `kwc2yszv-etb-neuentwurf`); Enter springt in den Inhalt.
    const von = screen.getByRole('combobox', { name: 'Von' });
    await user.clear(von);
    await user.paste('Florian 3');
    await user.keyboard('{Enter}');
    await user.type(feld, 'Pegel steigt{Enter}');
    await waitFor(() => expect(zeile(container, GESAMT + 1)).not.toBeNull(), { timeout: 30000 });
    expect(screen.queryByRole('button', { name: 'Neuere laden' })).toBeNull();
  }, 120000);

  it('ein fremder Eintrag während des Rücksprungs zum Kopf fehlt danach nicht (LLH-2036)', async () => {
    const user = userEvent.setup();
    const { container, client } = setup('/einsaetze/7/etb?eintrag=50');
    await warteAufHervorhebung(container, 50);

    // Der Kopf ist geholt, da trifft ein fremder Eintrag samt Live-Ereignis ein. Der Kopf ist dann
    // älter als das Ereignis und darf nicht als frisch gelten (`components/listenFenster.ts`,
    // `zumKopf`).
    waehrendKopfabruf = () => {
      gesamt += 1;
      void client.invalidateQueries({ queryKey: einsatzKeys.etb(7) });
    };
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    const von = screen.getByRole('combobox', { name: 'Von' });
    await user.clear(von);
    await user.paste('Florian 3');
    await user.keyboard('{Enter}');
    await user.type(feld, 'Pegel steigt{Enter}');
    await waitFor(() => expect(zeile(container, GESAMT + 1)).not.toBeNull(), { timeout: 30000 });
    await waitFor(() => expect(zeile(container, GESAMT + 2)).not.toBeNull(), { timeout: 30000 });
    expect(screen.queryByRole('button', { name: 'Neuere laden' })).toBeNull();
  }, 120000);

  it('scheitert das Blättern am Server, gibt der Sprung auf, statt endlos abzurufen', async () => {
    fehlerUnter = 900;
    setup('/einsaetze/7/etb?eintrag=50');
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''), {
      timeout: 30000,
    });
    const vorher = abrufe.length;
    await new Promise((r) => setTimeout(r, 500));
    expect(abrufe.length).toBe(vorher);
    expect(abrufe.filter((a) => a.includes('before_lfd_nr=')).length).toBeLessThanOrEqual(5);
  }, 60000);
});
