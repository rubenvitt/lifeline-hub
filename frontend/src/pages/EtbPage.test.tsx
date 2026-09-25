import { http, HttpResponse, type RequestHandler } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { act, type ReactElement } from 'react';
import { server } from '../test/server';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { neuerQueryClient, renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import { sendeBreitenAenderung, setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import { entwuerfeLaden, entwuerfeLeerenFuerTests } from '../etb/entwuerfe/entwurfStore';
import { queueEinreihen, queueLeerenFuerTests } from '../offline/queue';
import EtbPage from './EtbPage';
import type { EtbEintragAnzeige } from '../api/types';

function renderMitProviders(
  ui: ReactElement,
  options?: Parameters<typeof renderMitBasisProviders>[1],
) {
  const ergebnis = renderMitBasisProviders(
    <CommandPaletteProvider>{ui}</CommandPaletteProvider>,
    options,
  );
  const basisRerender = ergebnis.rerender;
  return {
    ...ergebnis,
    rerender: (naechstesUi: ReactElement) =>
      basisRerender(<CommandPaletteProvider>{naechstesUi}</CommandPaletteProvider>),
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  await queueLeerenFuerTests();
  localStorage.clear();
});

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: 'THW',
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};
const eintrag = {
  id: 1,
  lfd_nr: 1,
  typ: 'meldung',
  inhalt: 'Erste Meldung',
  von: null,
  an: null,
  meldeweg: null,
  veranlassung: null,
  erfasser_id: 1,
  erfasser_name: 'Admin',
  ereigniszeit: '2026-05-23 10:00:00',
  received_at: '2026-05-23 10:00:01',
  erfasst_lokal_at: null,
  berichtigt_eintrag_id: null,
  folgeauftraege: [],
  anhaenge: [],
};

/**
 * Wählt eine Zeilenaktion der ETB-Tabelle (LFH-365 · B5e).
 *
 * Die drei Aktionen liegen seit dem Bündel in einem Menü statt in einer Knopfreihe: erst
 * den Auslöser, dann den Eintrag — und die Rolle wechselt dabei von `button` zu
 * `menuitem`, gleicher Wortlaut rettet einen alten Griff also nicht.
 *
 * Der Eintrag wird über das GEÖFFNETE Menü geholt, nicht per freiem `findByRole`: antd
 * lässt die Portale geschlossener Dropdowns im Baum stehen (`Datensicht.test.tsx:926-931`).
 */
async function waehleZeilenaktion(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: /^Aktionen zu Eintrag/ }));
  const menue = document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
  if (!menue) throw new Error('Das Zeilen-Aktionsmenü ließ sich nicht öffnen');
  await user.click(within(menue).getByRole('menuitem', { name }));
}

/**
 * Serverzählung (LFH-612) für den Kopf und die Bilanz. Die Zahl ist bewusst vom geladenen
 * Fenster UNABHÄNGIG — genau das ist die Zusicherung: der Kopf zeigt, was der Server zählt,
 * nicht was die Seite geladen hat.
 */
function zaehlung(jeTyp: Partial<Record<EtbEintragAnzeige['typ'], number>>) {
  const je_typ = {
    meldung: 0,
    anordnung: 0,
    lage: 0,
    entscheidung: 0,
    system: 0,
    berichtigung: 0,
    ...jeTyp,
  };
  const gesamt = Object.values(je_typ).reduce((a, b) => a + b, 0);
  return http.get('/api/einsaetze/7/etb/zaehler', () => HttpResponse.json({ gesamt, je_typ }));
}

/** Zeigt den aktuellen Search-String im DOM — ermöglicht Param-Bereinigung zu prüfen. */
function OrtSpy() {
  const ort = useLocation();
  return <div data-testid="ort-suche">{ort.search}</div>;
}

function setupMSW() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/etb', () => HttpResponse.json([eintrag])),
    zaehlung({ meldung: 1 }),
    http.get('/api/etb-bausteine', () => HttpResponse.json([])),
    // Schnellerfassung lädt via useFunkrufnamen disponierte Fahrzeuge/Einheiten
    // (Absender/Empfänger-Vorschläge). Leere Listen genügen für diesen Test.
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    // Auftrags-Ziele für das ETB→Auftrag-Formular (LFH-112).
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
  );
}

function setup(route = '/einsaetze/7/etb', zusatz: RequestHandler[] = []) {
  setupMSW();
  // NACH den Vorgaben: `server.use` stellt voran, der zuletzt gesetzte Handler gewinnt.
  server.use(...zusatz);
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>
      <OrtSpy />
    </AuthProvider>,
    { route },
  );
}

describe('EtbPage', () => {
  it('LFH-611: zeigt die Lesemarke im Rahmen der Zeitachse, über ihr', async () => {
    setupMSW();
    server.use(
      http.get('/api/einsaetze/7/etb/lesemarke', () =>
        HttpResponse.json({ neue_anzahl: 4, hoechste_lfd_nr: 1 }),
      ),
    );
    setup();
    const text = await screen.findByText('4 Einträge, die Sie noch nicht gesichtet haben');
    const rahmen = document.querySelector('[data-lfh="etb-zeitachse-rahmen"]')!;
    const banner = text.closest('[data-lfh="sammelbanner"]')!;
    expect(rahmen.contains(banner)).toBe(true);
    const zeitachse = screen.getByRole('region', { name: 'Einsatztagebuch' });
    // Im Fluss VOR der Zeitachse, nicht als Überlagerung in ihr.
    expect(zeitachse.contains(banner)).toBe(false);
    expect(
      banner.compareDocumentPosition(zeitachse) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each(['2099-09-09 15:17:43', null])(
    'LFH-463: lädt beim Öffnen den inzwischen geänderten Termin frisch (%s)',
    async (termin) => {
      setupMSW();
      server.use(
        http.get('/api/einsaetze/7', () =>
          HttpResponse.json({
            ...einsatz,
            naechste_lagebesprechung_at: '2099-09-09 13:17:43',
          }),
        ),
      );
      renderMitProviders(
        <AuthProvider>
          <Routes>
            <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
          </Routes>
        </AuthProvider>,
        { route: '/einsaetze/7/etb' },
      );
      await screen.findByText('Erste Meldung');
      let freigeben!: () => void;
      const antwort = new Promise<void>((resolve) => {
        freigeben = resolve;
      });
      let abrufe = 0;
      server.use(
        http.get('/api/einsaetze/7', async () => {
          abrufe++;
          await antwort;
          return HttpResponse.json({ ...einsatz, naechste_lagebesprechung_at: termin });
        }),
      );
      let gesendet: Record<string, unknown> | undefined;
      server.use(
        http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
          gesendet = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: 1 });
        }),
      );
      const user = userEvent.setup();
      try {
        await waehleZeilenaktion(user, 'Wiedervorlage');
        expect(
          screen.queryByRole('button', { name: 'Nächste Lagebesprechung' }),
        ).not.toBeInTheDocument();
        await waitFor(() => expect(abrufe).toBe(1));
      } finally {
        freigeben();
      }
      if (termin) {
        await user.click(await screen.findByRole('button', { name: 'Nächste Lagebesprechung' }));
        await user.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: 'Anlegen' }),
        );
        await waitFor(() => expect(gesendet?.faellig_at).toBe(termin));
      } else {
        await waitFor(() => expect(screen.getByRole('button', { name: '+30 min' })).toBeEnabled());
        expect(
          screen.queryByRole('button', { name: 'Nächste Lagebesprechung' }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it('LFH-463: reicht den Einsatztermin an die Wiedervorlage weiter', async () => {
    setupMSW();
    server.use(
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({
          ...einsatz,
          naechste_lagebesprechung_at: '2099-09-09 13:17:43',
        }),
      ),
    );
    let gesendet: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/etb' },
    );
    const user = userEvent.setup();
    await waehleZeilenaktion(user, 'Wiedervorlage');
    await user.click(await screen.findByRole('button', { name: 'Nächste Lagebesprechung' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet?.faellig_at).toBe('2099-09-09 13:17:43'));
  });

  it.each([null, 'Alte Leitung'])(
    'LFH-461 Review: erster Entwurf wartet auf laufenden Detail-Refetch (Cache: %s)',
    async (meine_fuehrungsstelle) => {
      setupMSW();
      const client = neuerQueryClient();
      client.setQueryData(einsatzKeys.einsatz(7), { ...einsatz, meine_fuehrungsstelle });
      let freigeben!: () => void;
      const antwort = new Promise<void>((resolve) => {
        freigeben = resolve;
      });
      server.use(
        http.get('/api/einsaetze/7', async () => {
          await antwort;
          return HttpResponse.json({ ...einsatz, meine_fuehrungsstelle: 'Neue Leitung' });
        }),
      );
      // Entspricht der nach dem Stellen-Speichern gestarteten Invalidierung.
      await client.invalidateQueries({ queryKey: einsatzKeys.einsatz(7) });
      renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>,
        { client, route: '/einsaetze/7/etb' },
      );
      try {
        await screen.findByText('Erste Meldung');
        expect.soft(screen.queryByPlaceholderText(/Inhalt/)).not.toBeInTheDocument();
        expect.soft(screen.queryByRole('button', { name: /add|hinzu/i })).not.toBeInTheDocument();
      } finally {
        freigeben();
      }
      expect(await screen.findByText('An: Neue Leitung')).toBeInTheDocument();
      await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Meine Eingabe');
      await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu An' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: /Entfernen/ }));
      await client.invalidateQueries({ queryKey: einsatzKeys.einsatz(7) });
      expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Meine Eingabe');
      expect(screen.queryByText(/^An:/)).not.toBeInTheDocument();
    },
  );

  it('zeigt Seitentitel, Einsatz im Ortspfad, Einträge und die Serverzahl im Kopf', async () => {
    setup();
    // Seit dem Neuentwurf (S4) trägt der Seitenkopf den MODULtitel; der Einsatz steht im
    // Ortspfad davor (und im Rahmen der App, der hier nicht mitgerendert wird).
    expect(await screen.findByRole('heading', { name: 'Einsatztagebuch' })).toBeInTheDocument();
    expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument();
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
    // Kein Filter: der Kopf nennt die Gesamtzahl der Serverzählung (LFH-612).
    const kopf = document.querySelector('[data-lfh="seitenkopf"]')!;
    await waitFor(() => expect(kopf).toHaveTextContent('1 Eintrag'));
    expect(kopf).not.toHaveTextContent('geladen');
  });

  it('startet mit ausgeschaltetem „Werte behalten"', async () => {
    // Der Zustand liegt in EtbPage (nicht in EtbEntwurfsTabs, s. Kommentar dort), also
    // hält NUR dieser Test die Vorgabe. Die Tabs-Tests reichen ihn als Prop herein und
    // wären auch bei umgelegtem Vorgabewert grün.
    setup();
    expect(await screen.findByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it.each([390, 1024, 1366])(
    'hebt per ?eintrag=<id> bei %i px hervor, rollt hin und räumt den Param (LFH-25)',
    async (breite) => {
      setzeViewportBreite(breite);
      const gerollt: unknown[] = [];
      const vorher = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
        if (this.getAttribute('data-zeile') === 'eintrag-1') gerollt.push(arg);
      };
      try {
        const { container } = setup('/einsaetze/7/etb?eintrag=1');
        await screen.findByText('Erste Meldung');
        await waitFor(() =>
          // Seit dem Neuentwurf gibt es auf KEINER Breite mehr einen `data-row-key`: die
          // Zeitachse trägt die Kartenmarke, an der `scrolleZurZeile` springt.
          expect(container.querySelector('[data-zeile="eintrag-1"]')).toHaveClass(
            'zeile-hervorgehoben',
          ),
        );
        expect(container.querySelector('[data-row-key]')).toBeNull();
        // Der Sprung selbst: ohne ihn stünde die markierte Zeile irgendwo außer Sicht.
        await waitFor(() => expect(gerollt).toContainEqual({ block: 'center' }));
      } finally {
        Element.prototype.scrollIntoView = vorher;
      }
      // Adressier-Param wird nach dem Anwenden geräumt (apply-then-clean).
      await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''));
    },
  );

  it('lädt ältere Seiten nach, bis der ?eintrag=<id> gefunden ist (laden-bis-gefunden)', async () => {
    setzeViewportBreite(1366);
    const seite1 = Array.from({ length: 100 }, (_, i) => ({
      ...eintrag,
      id: 101 + i,
      lfd_nr: 200 - i,
      inhalt: `Eintrag ${101 + i}`,
    }));
    const ziel = { ...eintrag, id: 5, lfd_nr: 1, inhalt: 'Ziel-Eintrag' };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/etb', ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json(url.searchParams.has('before_lfd_nr') ? [ziel] : seite1);
      }),
      zaehlung({ meldung: 412 }),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
        <OrtSpy />
      </AuthProvider>,
      { route: '/einsaetze/7/etb?eintrag=5' },
    );
    // Der Ziel-Eintrag liegt erst auf Seite 2 → muss automatisch nachgeladen werden.
    expect(await screen.findByText('Ziel-Eintrag')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('[data-zeile="eintrag-5"]')).toHaveClass(
        'zeile-hervorgehoben',
      ),
    );
    // Der Kopf nennt die Serverzahl, nicht die 101 geladenen Einträge (LFH-612).
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="seitenkopf"]')).toHaveTextContent('412 Einträge'),
    );
    expect(document.querySelector('[data-lfh="seitenkopf"]')).not.toHaveTextContent('101');
  });

  it('räumt ?eintrag= ohne Highlight, wenn der Eintrag nicht existiert (Pagination erschöpft, kein Endlos-Fetch)', async () => {
    let folgeSeiten = 0;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/etb', ({ request }) => {
        if (new URL(request.url).searchParams.has('before_lfd_nr')) folgeSeiten += 1;
        return HttpResponse.json([eintrag]); // 1 < SEITENGROESSE → keine weitere Seite
      }),
      zaehlung({ meldung: 1 }),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
        <OrtSpy />
      </AuthProvider>,
      { route: '/einsaetze/7/etb?eintrag=999' },
    );
    await screen.findByText('Erste Meldung');
    // Param geräumt, kein Highlight — und keine Folge-Seite nachgeladen (Abbruchbedingung greift).
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''));
    expect(container.querySelector('.zeile-hervorgehoben')).toBeNull();
    // Kein endloses Nachladen: keine before_lfd_nr-Folgeseite, weil hasNextPage=false.
    expect(folgeSeiten).toBe(0);
  });

  it('erteilt aus einem ETB-Eintrag einen Auftrag (Text vorbefüllt, POST an /etb/:id/auftrag)', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/etb/1/auftrag', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 42 }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();

    await waehleZeilenaktion(user, 'Auftrag erteilen');
    // Auftragstext ist aus dem Eintragstext vorbefüllt.
    expect(await screen.findByDisplayValue('Erste Meldung')).toBeInTheDocument();
    // Einen Funktions-Empfänger ergänzen (Pflicht: >=1 Empfänger). Seit
    // LFH-343 · C8 tragen strukturierte Ziele und freie Funktionstexte EIN Feld.
    await user.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    /*
     * Der Modal-Submit ist jetzt der EINZIGE Knopf dieses Namens. Vorher gab es zwei
     * gleichnamige (Zeilen-Auslöser + Submit) und dieser Griff nahm den letzten; seit
     * LFH-365 heißt der Zeilen-Auslöser „Aktionen zu Eintrag <lfd_nr>" und die
     * Mehrdeutigkeit ist weg. Der Menü-Eintrag trägt die Rolle `menuitem`, kollidiert
     * also auch dann nicht, wenn antd sein Portal geschlossen im Baum stehen lässt.
     */
    await user.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.auftrag_text).toBe('Erste Meldung');
    expect(body!.empfaenger).toEqual([{ empfaenger_typ: 'funktion', funktion_text: 'S3' }]);
  });

  it('erfasst einen neuen Eintrag über den Entwurf-Tab (POST an /etb)', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/etb', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { ...eintrag, id: 2, lfd_nr: 2, inhalt: 'Neuer Eintrag X' },
          { status: 201 },
        );
      }),
    );
    setup();
    const user = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Neuer Eintrag X{Enter}');
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.inhalt).toBe('Neuer Eintrag X');
  });

  it('entfernt den Entwurf auch bei Offline-Enqueue (Netzwerkfehler → eingereiht statt abgelehnt)', async () => {
    // erfasseEtb wirft bei Netzwerkfehler einen TypeError → useEtbErfassung reiht offline ein
    // und RESOLVED (kein throw). Der Entwurf muss trotzdem entfernt werden (Spec: weg, sobald
    // erfassen ohne Exception zurückkehrt — Server-Erfolg ODER offline eingereiht).
    server.use(http.post('/api/einsaetze/7/etb', () => HttpResponse.error()));
    setup();
    const user = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Offline-Eintrag{Enter}');
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(0));
  });

  it('legt aus einem ETB-Eintrag eine Wiedervorlage mit ETB-Bezug an', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 99 }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();

    await waehleZeilenaktion(user, 'Wiedervorlage');
    // Titel ist aus dem Eintragstext vorbefüllt.
    expect(await screen.findByDisplayValue(/Wiedervorlage: Erste Meldung/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.bezug_typ).toBe('etb');
    expect(body!.bezug_id).toBe(1);
    expect(body!.titel).toMatch(/Erste Meldung/);
  });

  it('verarbeitet ?neu=1 und entfernt den Param', async () => {
    setup('/einsaetze/7/etb?neu=1');
    // Erfassungszeile ist bei Schreibrecht (aktiv + einsatzleitung) vorhanden.
    await waitFor(() => expect(document.querySelector('.etb-erfassung-sticky')).toBeTruthy());
    // Der ?neu=1-Handler muss den Param aus der URL entfernen.
    await waitFor(() => expect(screen.getByTestId('ort-suche').textContent).not.toContain('neu'));
  });
});

/**
 * Der Zustandsraum des Tagebuchs ist vierteilig: laden / Fehler / leer-ohne-Filter /
 * leer-mit-Filter (LFH-331 · B3, Spec §5 Bündel 7).
 *
 * Die Zusicherungen „Leertitel NICHT im DOM" unten sind Regressionsklammern; ihre
 * Beweiskraft liegt im Zeitachsen-Test (`etb/EtbZeitachse.test.tsx`), wo die Zeitachse in
 * allen drei Fällen montiert bleibt. Hier steht die Partnerhälfte mit byte-gleichem Literal
 * (Spec §3/F2).
 */
describe('EtbPage – Datenzustände (LFH-331 · B3)', () => {
  const LEER_TITEL = 'Noch keine Einträge.';

  /** Wie `setup`, aber mit Handlern, die die Grundausstattung überschreiben (MSW: zuletzt gewinnt). */
  function setupMit(zusatz: RequestHandler[], route = '/einsaetze/7/etb') {
    setupMSW();
    server.use(...zusatz);
    return renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
        <OrtSpy />
      </AuthProvider>,
      { route },
    );
  }

  it('zeigt beim Laden des Einsatzes Skelettbalken statt eines Kreisels', async () => {
    const { container } = setup();
    expect(container.querySelector('.lfh-skelett')).not.toBeNull();
    expect(screen.getByLabelText(/wird geladen/i)).toBeInTheDocument();
    // Auflaufen lassen, damit kein Zustandswechsel nach Testende passiert.
    await screen.findByRole('heading', { name: 'Einsatztagebuch' });
  });

  it('bietet beim gescheiterten Einsatz-Abruf einen erneuten Abruf an', async () => {
    setupMit([
      http.get('/api/einsaetze/7', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('zeigt bei gescheitertem ETB-Abruf den Fehler und behauptet keine leere Menge', async () => {
    setupMit([
      http.get('/api/einsaetze/7/etb', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    expect(
      await screen.findByText('ETB-Einträge konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText(LEER_TITEL)).not.toBeInTheDocument();
  });

  it('nennt die leere Menge beim Namen und führt zur Erfassung (Schreibrecht)', async () => {
    setupMit([http.get('/api/einsaetze/7/etb', () => HttpResponse.json([]))]);
    expect(await screen.findByText(LEER_TITEL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ersten Eintrag erfassen' })).toBeInTheDocument();
  });

  it('zeigt Lesenden denselben Leertitel, aber keine Erfassungsaktion', async () => {
    setupMit([
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...admin, system_rolle: 'keiner', anzeigename: 'Beobachter' }),
      ),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' }),
      ),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
    ]);
    expect(await screen.findByText(LEER_TITEL)).toBeInTheDocument();
    // Die Erfassungsleiste wird für Lesende gar nicht gerendert — ein Fokussprung dorthin
    // zeigte auf einen Knoten, den es nicht gibt.
    expect(document.querySelector('.etb-erfassung-sticky')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Ersten Eintrag erfassen' }),
    ).not.toBeInTheDocument();
  });

  it('unterscheidet leer-mit-Filter und setzt beim Zurücksetzen auch das Eingabefeld zurück', async () => {
    setupMit([
      http.get('/api/einsaetze/7/etb', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.has('q') ? [] : [eintrag]),
      ),
    ]);
    const user = userEvent.setup();
    await screen.findByText('Erste Meldung');

    await user.type(screen.getByPlaceholderText('Volltextsuche'), 'zzz');
    expect(await screen.findByText('Kein Eintrag passt zum Filter')).toBeInTheDocument();
    expect(screen.queryByText(LEER_TITEL)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));

    // DIE unterscheidende Zusicherung: ein Reset, der nur den Seitenzustand räumt, ließe
    // die sichtbare Eingabe stehen — und der nächste Tastendruck mischte sie wieder ein.
    expect(screen.getByPlaceholderText('Volltextsuche')).toHaveValue('');
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
  });

  it('Strg/⌘ + Backspace in der Filterleiste leert sichtbaren und internen Filterzustand', async () => {
    setupMit([
      http.get('/api/einsaetze/7/etb', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.has('q') ? [] : [eintrag]),
      ),
    ]);
    await screen.findByText('Erste Meldung');
    const suche = screen.getByPlaceholderText('Volltextsuche');
    await userEvent.type(suche, 'zzz');
    expect(await screen.findByText('Kein Eintrag passt zum Filter')).toBeInTheDocument();

    const ereignis = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(suche, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByPlaceholderText('Volltextsuche')).toHaveValue(''));
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();

    // Der Reset remountet die unkontrollierte Filterleiste. Die Registry darf die damit
    // veraltete aktive Ebene nicht für ein Folgeereignis außerhalb der Root wiederverwenden.
    const neueSuche = screen.getByPlaceholderText('Volltextsuche');
    expect(neueSuche).not.toBe(suche);
    const ausserhalb = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(document.body, ausserhalb);

    expect(ausserhalb.defaultPrevented).toBe(false);
    expect(screen.getByPlaceholderText('Volltextsuche')).toBe(neueSuche);
  });

  it('übernimmt native Wortlöschung nicht aus der Schnellerfassung', async () => {
    setupMit([
      http.get('/api/einsaetze/7/etb', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.has('q') ? [] : [eintrag]),
      ),
    ]);
    await screen.findByText('Erste Meldung');
    const suche = screen.getByPlaceholderText('Volltextsuche');
    await userEvent.type(suche, 'zzz');
    expect(await screen.findByText('Kein Eintrag passt zum Filter')).toBeInTheDocument();

    const schnellerfassung = screen.getByPlaceholderText(/Inhalt/);
    schnellerfassung.focus();
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(schnellerfassung, ereignis);

    expect(ereignis.defaultPrevented).toBe(false);
    expect(suche).toHaveValue('zzz');
  });

  /**
   * Der Filter steht in der URL (LFH-342 · C7, Befund M80). Vorher lag er allein im
   * Seitenzustand: ein Reload warf ihn weg, teilen ließ er sich nicht.
   */
  describe('Filter in der URL', () => {
    it('liest einen Filter beim Kaltstart aus der URL — Abruf UND sichtbare Leiste', async () => {
      const abrufe: string[] = [];
      setupMit(
        [
          http.get('/api/einsaetze/7/etb', ({ request }) => {
            const p = new URL(request.url).searchParams;
            abrufe.push(p.toString());
            return HttpResponse.json(p.get('q') === 'brand' ? [eintrag] : []);
          }),
        ],
        '/einsaetze/7/etb?q=brand&typ=meldung',
      );
      await screen.findByText('Erste Meldung');
      // Der Abruf trägt den Filter — ohne das wäre die Leiste bloß Zierde.
      expect(abrufe.some((a) => a.includes('q=brand') && a.includes('typ=meldung'))).toBe(true);
      // Und die Leiste zeigt ihn. Beide Hälften: ein Filter, der nur im Query-Key
      // steht, ist von außen nicht als gesetzt erkennbar.
      expect(screen.getByPlaceholderText('Volltextsuche')).toHaveValue('brand');
      // Der Typ steht seit dem Neuentwurf in der Segmentleiste des Seitenkopfs — das
      // gewählte Segment wird aus der URL GELESEN.
      const segmente = screen.getByRole('radiogroup', { name: 'Einträge nach Typ filtern' });
      expect(within(segmente).getByRole('radio', { name: 'Meldung' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(within(segmente).getByRole('radio', { name: 'Alle' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('schreibt einen getippten Suchbegriff in die URL', async () => {
      setupMit([
        http.get('/api/einsaetze/7/etb', ({ request }) =>
          HttpResponse.json(new URL(request.url).searchParams.has('q') ? [] : [eintrag]),
        ),
      ]);
      await screen.findByText('Erste Meldung');
      await userEvent.type(screen.getByPlaceholderText('Volltextsuche'), 'zzz');
      await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent('q=zzz'));
    });

    it('räumt beim Zurücksetzen die URL, nicht nur den Seitenzustand', async () => {
      setupMit(
        [
          http.get('/api/einsaetze/7/etb', ({ request }) =>
            HttpResponse.json(new URL(request.url).searchParams.has('q') ? [] : [eintrag]),
          ),
        ],
        '/einsaetze/7/etb?q=zzz',
      );
      await userEvent.click(await screen.findByRole('button', { name: 'Filter zurücksetzen' }));
      await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''));
      // Die Leiste wird dabei neu aufgesetzt — die Gegenaussage zum Batching-Fall:
      // ein Remount in DERSELBEN Runde schriebe den alten Begriff zurück ins Feld.
      expect(screen.getByPlaceholderText('Volltextsuche')).toHaveValue('');
    });

    it('lässt die Sprungmarke ?eintrag= unberührt neben dem Filter stehen', async () => {
      const abrufe: string[] = [];
      setupMit(
        [
          http.get('/api/einsaetze/7/etb', ({ request }) => {
            abrufe.push(new URL(request.url).searchParams.toString());
            return HttpResponse.json([eintrag]);
          }),
        ],
        '/einsaetze/7/etb?typ=meldung&eintrag=1',
      );
      await screen.findByText('Erste Meldung');
      // `eintrag` wird nach dem Sprung geräumt, der Filter NICHT mitgerissen.
      await waitFor(() =>
        expect(screen.getByTestId('ort-suche')).not.toHaveTextContent('eintrag='),
      );
      expect(screen.getByTestId('ort-suche')).toHaveTextContent('typ=meldung');
      // Und `eintrag` ist nie in den Abruf geraten — es ist eine Sprungmarke,
      // kein Filter.
      expect(abrufe.every((a) => !a.includes('eintrag='))).toBe(true);
    });
  });
});

describe('EtbPage – Zeitachse (Neuentwurf S4)', () => {
  it('schreibt den Typ aus der Segmentleiste in die URL, „Alle" nimmt ihn heraus', async () => {
    setup();
    await screen.findByText('Erste Meldung');
    const segmente = screen.getByRole('radiogroup', { name: 'Einträge nach Typ filtern' });
    await userEvent.click(within(segmente).getByRole('radio', { name: 'Anordnung' }));
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent('typ=anordnung'));
    expect(within(segmente).getByRole('radio', { name: 'Anordnung' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(segmente).getByRole('radio', { name: 'Alle' }));
    await waitFor(() => expect(screen.getByTestId('ort-suche')).not.toHaveTextContent('typ='));
  });

  it('LFH-616: filtert nach der Einheit aus der URL und schreibt eine Wahl zurück', async () => {
    const abrufe: string[] = [];
    setupMSW();
    server.use(
      http.get('/api/einsaetze/7/einheiten', () =>
        HttpResponse.json([
          { id: 5, name: '1. Zug' },
          { id: 6, name: '2. Zug' },
        ]),
      ),
      http.get('/api/einsaetze/7/etb', ({ request }) => {
        abrufe.push(new URL(request.url).search);
        return HttpResponse.json([eintrag]);
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
        <OrtSpy />
      </AuthProvider>,
      { route: '/einsaetze/7/etb?einheit_id=5' },
    );
    await screen.findByText('Erste Meldung');
    // Der Deeplink der Lagekarte kommt am Server an …
    expect(abrufe.some((a) => a.includes('einheit_id=5'))).toBe(true);
    // … und die Wahl ist sichtbar benannt, nicht als rohe Zahl.
    const wahl = screen.getByRole('combobox', { name: 'Nach Einheit filtern' });
    const feld = wahl.closest('.ant-select') as HTMLElement;
    await waitFor(() => expect(within(feld).getByText('1. Zug')).toBeInTheDocument());

    await userEvent.click(wahl);
    const option = await screen.findByTitle('2. Zug');
    await userEvent.click(option);
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent('einheit_id=6'));
  });

  it('ein Nachläufer der Suchfrist verliert den eben gewählten Typ nicht', async () => {
    /*
     * Die Wettlauf-Stelle über die Komponentengrenze: Suche entprellt (300 ms) in der
     * Leiste, Typ sofort im Seitenkopf. Meldete die Leiste ihre ganze Kopie, schriebe der
     * Nachläufer die URL ohne Typ zurück.
     */
    setupMSW();
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
        <OrtSpy />
      </AuthProvider>,
      { route: '/einsaetze/7/etb' },
    );
    await screen.findByText('Erste Meldung');
    const suche = screen.getByPlaceholderText('Volltextsuche');
    fireEvent.change(suche, { target: { value: 'pegel' } });
    // Innerhalb der Frist das Segment wählen …
    fireEvent.click(screen.getByRole('radio', { name: 'Lage' }));
    // … und nach Ablauf stehen BEIDE in der URL.
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent('q=pegel'));
    expect(screen.getByTestId('ort-suche')).toHaveTextContent('typ=lage');
    // Der Segmentklick hat die Leiste NICHT neu aufgesetzt: das Feld ist dasselbe.
    expect(screen.getByPlaceholderText('Volltextsuche')).toBe(suche);
  });

  it('zeigt jeden Eintrag als Zeitachseneintrag mit Typkante, Typwort und Nr.', async () => {
    const { container } = setup();
    await screen.findByText('Erste Meldung');
    const zeile = container.querySelector('[data-zeile="eintrag-1"]')!;
    expect(zeile).toHaveAttribute('data-lfh-eintrag', 'zeitachse');
    expect(zeile).toHaveAttribute('data-typ', 'meldung');
    expect(within(zeile as HTMLElement).getByText('Nr. 1')).toBeInTheDocument();
    expect(zeile.querySelector('[data-lfh="typwort"]')).toHaveTextContent('Meldung');
    expect(zeile.querySelector('[data-lfh="typkante"]')).not.toBeNull();
  });

  it('stellt die Erfassung an den Seitenfuß, nach der Zeitachse', async () => {
    setup();
    await screen.findByText('Erste Meldung');
    const leiste = document.querySelector('.etb-erfassung-sticky')!;
    const zeitachse = document.querySelector('[data-lfh="etb-zeitachse"]')!;
    // DOCUMENT_POSITION_FOLLOWING: die Leiste steht im Baum HINTER der Zeitachse.
    expect(
      zeitachse.compareDocumentPosition(leiste) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Die Hülle der Schnellerfassung trägt den Typ als Befehl im Präfix (nach dem Laden
    // der Entwürfe).
    await waitFor(() =>
      expect(leiste.querySelector('[data-lfh="schnellerfassung-praefix"]')).toHaveTextContent(
        '/meldung',
      ),
    );
  });

  it('rollt nach einem angenommenen eigenen Eintrag den Kopf der Zeitachse ins Bild — nicht nach einer Ablehnung', async () => {
    const aufrufe: unknown[] = [];
    const vorher = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      if (this.getAttribute('data-lfh') === 'etb-zeitachse-rahmen') aufrufe.push(arg);
    };
    let status = 422;
    server.use(
      http.post('/api/einsaetze/7/etb', () =>
        status === 201
          ? HttpResponse.json({ ...eintrag, id: 2, lfd_nr: 2, inhalt: 'Neu' }, { status: 201 })
          : HttpResponse.json({ error: 'abgelehnt' }, { status }),
      ),
    );
    try {
      setup();
      const user = userEvent.setup();
      const feld = await screen.findByPlaceholderText(/Inhalt/);
      await user.type(feld, 'Wird abgelehnt{Enter}');
      await waitFor(() => expect(feld).toHaveValue('Wird abgelehnt'));
      expect(aufrufe).toEqual([]);
      status = 201;
      await user.type(feld, '{Enter}');
      await waitFor(() => expect(aufrufe).toEqual([{ block: 'nearest' }]));
    } finally {
      Element.prototype.scrollIntoView = vorher;
    }
  });

  /**
   * LFH-373 (Review): die Erfassung hängt auf JEDER Breite an derselben Stelle im Baum — als
   * `fuss` der Seitenwurzel. Hing sie ab `xl` in der Zeitachsenspalte und darunter im Fuß, riss
   * ein Wechsel über `xl` (Tablet drehen, Fenster ziehen) sie aus und hängte sie neu ein; der Text
   * einer laufenden Berichtigung lebt nur im Zustand und war ohne Rückfrage weg.
   */
  it('behält die Erfassung beim Wechsel über xl — derselbe Knoten, derselbe Text', async () => {
    setzeViewportBreite(1366);
    setup();
    await screen.findByText('Erste Meldung');
    // Die Entwurfs-Reiter laden aus IndexedDB — das Feld erscheint nach der Zeitachse.
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Angefangener Eintrag');
    act(() => {
      sendeBreitenAenderung(800);
    });
    expect(screen.getByPlaceholderText(/Inhalt/)).toBe(feld);
    expect(feld).toHaveValue('Angefangener Eintrag');
  });

  /**
   * LFH-373 (gemessen, `e2e/leisten-flaeche.spec.ts` „Laden ohne Sprung"): unter `xl` steht die
   * Bilanz UNTER der Zeitachse. Stand sie schon da, während die Liste noch lud, schoben die
   * eintreffenden Zeilen sie um mehr als ihre Höhe nach unten (CLS 0,22 bei 390 px). Sie
   * erscheint deshalb erst, wenn die Liste steht — ab `xl` steht sie daneben und darf sofort.
   */
  it('zeigt die Bilanz unter xl erst, wenn die Liste steht', async () => {
    setzeViewportBreite(800);
    let freigeben: () => void = () => {};
    const liste = new Promise<void>((r) => {
      freigeben = r;
    });
    setup('/einsaetze/7/etb', [
      http.get('/api/einsaetze/7/etb', async () => {
        await liste;
        return HttpResponse.json([eintrag]);
      }),
    ]);
    await screen.findByPlaceholderText(/Inhalt/);
    expect(screen.queryByRole('complementary', { name: 'Bilanz des Tagebuchs' })).toBeNull();
    freigeben();
    await screen.findByText('Erste Meldung');
    expect(screen.getByRole('complementary', { name: 'Bilanz des Tagebuchs' })).toBeInTheDocument();
  });

  /**
   * Die Sperre gilt dem ERSTEN Laden, nicht jedem (LFH-373, Review): der Filter steckt im
   * Query-Schlüssel, jeder neue Filter ist also wieder `isLoading`. Hinge die Bilanz daran,
   * verschwände sie unter `xl` bei jedem Typklick und jedem Suchwort — und beim Wiederverbinden
   * nach einem Offline-Start genau in dem Moment, in dem der Puffer gesendet wird.
   */
  it('behält die Bilanz unter xl beim Filterwechsel, während die neue Liste lädt', async () => {
    setzeViewportBreite(800);
    let freigeben: () => void = () => {};
    const zweite = new Promise<void>((r) => {
      freigeben = r;
    });
    setup('/einsaetze/7/etb', [
      http.get('/api/einsaetze/7/etb', async ({ request }) => {
        if (new URL(request.url).searchParams.get('typ')) await zweite;
        return HttpResponse.json([eintrag]);
      }),
    ]);
    await screen.findByText('Erste Meldung');
    const segmente = screen.getByRole('radiogroup', { name: 'Einträge nach Typ filtern' });
    await userEvent.click(within(segmente).getByRole('radio', { name: 'Anordnung' }));
    // Die neue Liste hängt noch — die Bilanz bleibt trotzdem stehen.
    expect(screen.getByRole('complementary', { name: 'Bilanz des Tagebuchs' })).toBeInTheDocument();
    freigeben();
  });

  it('zeigt die Bilanz ab xl sofort, auch während die Liste lädt', async () => {
    setzeViewportBreite(1366);
    let freigeben: () => void = () => {};
    const liste = new Promise<void>((r) => {
      freigeben = r;
    });
    setup('/einsaetze/7/etb', [
      http.get('/api/einsaetze/7/etb', async () => {
        await liste;
        return HttpResponse.json([eintrag]);
      }),
    ]);
    expect(
      await screen.findByRole('complementary', { name: 'Bilanz des Tagebuchs' }),
    ).toBeInTheDocument();
    freigeben();
    await screen.findByText('Erste Meldung');
  });

  it('zeigt die Bilanz aus der Serverzählung und den Puffer „übertragen"', async () => {
    setzeViewportBreite(1366);
    setup('/einsaetze/7/etb', [
      zaehlung({ meldung: 218, anordnung: 96, entscheidung: 31, lage: 62, berichtigung: 5 }),
    ]);
    await screen.findByText('Erste Meldung');
    const leiste = screen.getByRole('complementary', { name: 'Bilanz des Tagebuchs' });
    // Geladen ist EIN Eintrag; die Bilanz zählt trotzdem das ganze Tagebuch.
    await waitFor(() =>
      expect(leiste.querySelector('[data-typ="meldung"]')).toHaveTextContent('218'),
    );
    expect(within(leiste).getByRole('heading', { name: 'Bilanz' })).toBeInTheDocument();
    expect(
      within(leiste).getByRole('img', { name: 'Meldungen: 218 von 412 Einträgen' }),
    ).toBeInTheDocument();
    expect(within(leiste).getByText('Alle Einträge übertragen')).toBeInTheDocument();
  });

  it('zählt unter einem Filter die Treffer und nennt die Bilanz so', async () => {
    setzeViewportBreite(1366);
    let zaehlQuery = '';
    setup('/einsaetze/7/etb?q=Deich', [
      http.get('/api/einsaetze/7/etb/zaehler', ({ request }) => {
        zaehlQuery = new URL(request.url).search;
        return HttpResponse.json({
          gesamt: 7,
          je_typ: {
            meldung: 7,
            anordnung: 0,
            lage: 0,
            entscheidung: 0,
            system: 0,
            berichtigung: 0,
          },
        });
      }),
    ]);
    await screen.findByText('Erste Meldung');
    const kopf = document.querySelector('[data-lfh="seitenkopf"]')!;
    await waitFor(() => expect(kopf).toHaveTextContent('7 Treffer'));
    // Dieselben Filtermerkmale wie die Liste gehen an die Zählung.
    expect(new URLSearchParams(zaehlQuery).get('q')).toBe('Deich');
    const leiste = screen.getByRole('complementary', { name: 'Bilanz des Tagebuchs' });
    expect(within(leiste).getByRole('heading', { name: 'Bilanz im Filter' })).toBeInTheDocument();
  });

  it('behauptet ohne Zählung keine Gesamtzahl, die Liste bleibt bedienbar', async () => {
    setzeViewportBreite(1366);
    setup('/einsaetze/7/etb', [
      http.get('/api/einsaetze/7/etb/zaehler', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    await screen.findByText('Erste Meldung');
    const leiste = screen.getByRole('complementary', { name: 'Bilanz des Tagebuchs' });
    expect(await within(leiste).findByText('Zählung nicht verfügbar.')).toBeInTheDocument();
    const kopf = document.querySelector('[data-lfh="seitenkopf"]')!;
    expect(kopf).not.toHaveTextContent(/\d+ (Einträge|Eintrag|Treffer)/);
    // `findBy`: die Erfassung steht erst, wenn die Entwürfe aus der IndexedDB geladen sind —
    // unter Last kam die Zählung früher an, und ein `getBy` fand das Feld noch nicht.
    expect(await screen.findByPlaceholderText(/Inhalt/)).toBeEnabled();
  });

  it('meldet einen offline gepufferten Eintrag im Puffer als ausstehend', async () => {
    server.use(http.post('/api/einsaetze/7/etb', () => HttpResponse.error()));
    setup();
    const user = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Offline-Eintrag{Enter}');
    const leiste = screen.getByRole('complementary', { name: 'Bilanz des Tagebuchs' });
    await waitFor(() =>
      expect(leiste.querySelector('[data-lfh="puffer"]')).toHaveAttribute(
        'data-zustand',
        'ausstehend',
      ),
    );
    // Und der gepufferte Eintrag steht als eigene Zeile in der Zeitachse.
    expect(await screen.findAllByText('Offline-Eintrag')).not.toHaveLength(0);
  });
});

describe('EtbPage – Anhänge an der Erfassung (LFH-117, Review C1)', () => {
  function dateiEingabe(): HTMLInputElement {
    const el = document.querySelector<HTMLInputElement>('input[data-lfh="etb-anhang-eingabe"]');
    if (!el) throw new Error('Dateieingabe fehlt');
    return el;
  }

  it('eine abgebrochene Berichtigung lässt die gewählten Dateien der Entwürfe stehen', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Erste Meldung');
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Zwei Fotos vom Deich');
    await user.upload(dateiEingabe(), new File(['x'], 'foto-a.jpg', { type: 'image/jpeg' }));
    expect(screen.getByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent('foto-a.jpg');
    await waitFor(async () =>
      expect((await entwuerfeLaden(7))[0]?.inhalt).toBe('Zwei Fotos vom Deich'),
    );

    await waehleZeilenaktion(user, 'Berichtigen');
    await screen.findByText(/Berichtigung zu Nr\./);
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByText(/Berichtigung zu Nr\./)).toBeNull());

    expect(await screen.findByPlaceholderText(/Inhalt/)).toHaveValue('Zwei Fotos vom Deich');
    expect(await screen.findByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent(
      'foto-a.jpg',
    );
  });

  it('hält auch einen Entwurf, der nur Dateien trägt, über die Berichtigung', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Erste Meldung');
    await screen.findByPlaceholderText(/Inhalt/);
    await user.upload(dateiEingabe(), new File(['x'], 'foto-b.jpg', { type: 'image/jpeg' }));
    // Ein Entwurf ohne Text läge sonst nur im Speicher: nach dem Abbrechen käme ein neuer mit
    // neuer id, und die Dateien hingen an keinem Reiter mehr.
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(1));

    await waehleZeilenaktion(user, 'Berichtigen');
    await screen.findByText(/Berichtigung zu Nr\./);
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByText(/Berichtigung zu Nr\./)).toBeNull());

    expect(await screen.findByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent(
      'foto-b.jpg',
    );
  });

  /**
   * Review C1 (WICHTIG 1): ein Eintrag der Offline-Queue, dessen client_id schon für einen
   * ANDEREN Eintrag steht, landet mit dem Wortlaut des Servers unter „abgelehnt". „Erneut
   * senden" nimmt einen neuen Schlüssel — mit dem alten liefe er in denselben 409.
   */
  it('ein client_id-Konflikt der Queue steht unter „abgelehnt"; „Erneut senden" nimmt einen neuen Schlüssel', async () => {
    const konflikt =
      'client_id bereits für einen anderen Eintrag verwendet: dieser Wortlaut ist nicht erfasst.';
    await queueEinreihen(admin.id, 7, {
      typ: 'meldung',
      inhalt: 'Wortlaut aus Tab 2',
      client_id: 'entwurf-x',
    });
    const gesendet: string[] = [];
    setup('/einsaetze/7/etb', [
      http.post('/api/einsaetze/7/etb', async ({ request }) => {
        const body = (await request.json()) as { client_id?: string };
        gesendet.push(body.client_id ?? '');
        return body.client_id === 'entwurf-x'
          ? HttpResponse.json({ error: konflikt }, { status: 409 })
          : HttpResponse.json(
              { ...eintrag, id: 9, lfd_nr: 9, inhalt: 'Wortlaut aus Tab 2' },
              { status: 201 },
            );
      }),
    ]);
    const user = userEvent.setup();
    expect(
      (await screen.findAllByText(/client_id bereits für einen anderen Eintrag/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Wortlaut aus Tab 2').length).toBeGreaterThan(0);

    await user.click(await screen.findByRole('button', { name: 'Erneut senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(2));
    expect(gesendet[0]).toBe('entwurf-x');
    expect(gesendet[1]).not.toBe('entwurf-x');
    expect(gesendet[1]).toBeTruthy();
  });

  it('sperrt „Berichtigen", solange ein Entwurf sendet — mit Grund', async () => {
    setup('/einsaetze/7/etb', [
      http.post('/api/einsaetze/7/etb/anhaenge', () => new Promise<Response>(() => {})),
    ]);
    const user = userEvent.setup();
    await screen.findByText('Erste Meldung');
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.upload(dateiEingabe(), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await user.type(feld, 'Foto{Enter}');
    await screen.findByText('Lädt hoch (1/1) …');

    await user.click(await screen.findByRole('button', { name: /^Aktionen zu Eintrag/ }));
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    if (!menue) throw new Error('Menü nicht offen');
    const punkt = within(menue).getByRole('menuitem', { name: /Berichtigen/ });
    expect(punkt).toHaveAttribute('aria-disabled', 'true');
    expect(punkt).toHaveTextContent('erst nach dem Senden');
    await user.click(punkt);
    // Die Entwurfs-Reiter stehen weiter — keine Berichtigung hat sie ersetzt.
    expect(screen.queryByText(/Berichtigung zu Nr\./)).toBeNull();
    expect(screen.getByText('Lädt hoch (1/1) …')).toBeInTheDocument();
  });
});

/**
 * ── EINSTIEG IN DEN DRUCK (LFH-22, design.md D5) ─────────────────────────────────
 *
 * „Drucken / als PDF" im Kopf ÖFFNET die Druckansicht und sendet nichts ab — deshalb gehört
 * es in den Kopf-Slot (LFH-346 · C11) und ist ein Link mit Knopfgestalt (Strg+Klick öffnet
 * einen neuen Tab). Er nimmt den AKTIVEN Filter mit, sonst druckte die Person eine andere
 * Auswahl als die, die sie gerade sieht.
 */
describe('EtbPage — Einstieg in den Druck (LFH-22)', () => {
  it('verlinkt im Kopf auf die Druckansicht mit dem aktiven Filter', async () => {
    setup('/einsaetze/7/etb?typ=meldung&q=Damm&einheit_id=5');
    const kopf = await waitFor(() => {
      const k = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
      expect(k).not.toBeNull();
      return k!;
    });
    const link = await within(kopf).findByRole('link', { name: 'Drucken / als PDF' });
    const ziel = new URL(link.getAttribute('href')!, 'http://x');
    expect(ziel.pathname).toBe('/einsaetze/7/etb/druck');
    expect(Object.fromEntries(ziel.searchParams)).toEqual({
      typ: 'meldung',
      q: 'Damm',
      einheit_id: '5',
    });
  });

  it('ist sekundär: im Kopf steht höchstens eine Primäraktion, und das ist nicht der Druck', async () => {
    setup();
    const kopf = await waitFor(() => {
      const k = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
      expect(k).not.toBeNull();
      return k!;
    });
    const link = await within(kopf).findByRole('link', { name: 'Drucken / als PDF' });
    expect(link).not.toHaveClass('ant-btn-primary');
    expect(kopf.querySelectorAll('.ant-btn-primary').length).toBeLessThanOrEqual(1);
  });
});
