import { http, HttpResponse, type RequestHandler } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { ReactElement } from 'react';
import { server } from '../test/server';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { entwuerfeLaden, entwuerfeLeerenFuerTests } from '../etb/entwuerfe/entwurfStore';
import { queueLeerenFuerTests } from '../offline/queue';
import EtbPage from './EtbPage';

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
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'THW', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};
const eintrag = {
  id: 1, lfd_nr: 1, typ: 'meldung', inhalt: 'Erste Meldung', von: null, an: null,
  meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Admin',
  ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
  erfasst_lokal_at: null, berichtigt_eintrag_id: null,
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
    http.get('/api/etb-bausteine', () => HttpResponse.json([])),
    // Schnellerfassung lädt via useFunkrufnamen disponierte Fahrzeuge/Einheiten
    // (Absender/Empfänger-Vorschläge). Leere Listen genügen für diesen Test.
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    // Auftrags-Ziele für das ETB→Auftrag-Formular (LFH-112).
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
  );
}

function setup(route = '/einsaetze/7/etb') {
  setupMSW();
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
  it('zeigt Einsatz-Bezeichnung und ETB-Einträge', async () => {
    setup();
    // Bezeichnung erscheint als Überschrift (zusätzlich in der Breadcrumb-Zeile) → gezielt die Überschrift prüfen.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hochwasser Nord' })).toBeInTheDocument(),
    );
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('startet mit ausgeschaltetem „Werte behalten"', async () => {
    // Der Zustand liegt in EtbPage (nicht in EtbEntwurfsTabs, s. Kommentar dort), also
    // hält NUR dieser Test die Vorgabe. Die Tabs-Tests reichen ihn als Prop herein und
    // wären auch bei umgelegtem Vorgabewert grün.
    setup();
    expect(await screen.findByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it('hebt per ?eintrag=<id> den geladenen Eintrag hervor und räumt den Param (LFH-25)', async () => {
    const { container } = setup('/einsaetze/7/etb?eintrag=1');
    await screen.findByText('Erste Meldung');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="1"]')).toHaveClass('zeile-hervorgehoben'),
    );
    // Adressier-Param wird nach dem Anwenden geräumt (apply-then-clean).
    await waitFor(() => expect(screen.getByTestId('ort-suche')).toHaveTextContent(''));
  });

  it('lädt ältere Seiten nach, bis der ?eintrag=<id> gefunden ist (laden-bis-gefunden)', async () => {
    const seite1 = Array.from({ length: 100 }, (_, i) => ({
      ...eintrag, id: 101 + i, lfd_nr: 200 - i, inhalt: `Eintrag ${101 + i}`,
    }));
    const ziel = { ...eintrag, id: 5, lfd_nr: 1, inhalt: 'Ziel-Eintrag' };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/etb', ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json(url.searchParams.has('before_lfd_nr') ? [ziel] : seite1);
      }),
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
      expect(container.querySelector('[data-row-key="5"]')).toHaveClass('zeile-hervorgehoben'),
    );
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
    // Einen Funktions-Empfänger ergänzen (Pflicht: >=1 Empfänger).
    await user.type(screen.getByPlaceholderText(/S3, Fachberater/), 'S3');
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
        return HttpResponse.json({ ...eintrag, id: 2, lfd_nr: 2, inhalt: 'Neuer Eintrag X' }, { status: 201 });
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
    await waitFor(() =>
      expect(document.querySelector('.etb-erfassung-sticky')).toBeTruthy(),
    );
    // Der ?neu=1-Handler muss den Param aus der URL entfernen.
    await waitFor(() =>
      expect(screen.getByTestId('ort-suche').textContent).not.toContain('neu'),
    );
  });
});

/**
 * Der Zustandsraum des Tagebuchs ist vierteilig: laden / Fehler / leer-ohne-Filter /
 * leer-mit-Filter (LFH-331 · B3, Spec §5 Bündel 7).
 *
 * Die Zusicherungen „Leertitel NICHT im DOM" unten sind Regressionsklammern; ihre
 * Beweiskraft liegt im Primitivtest (`etb/EtbTabelle.test.tsx`), wo die Tabelle in allen
 * drei Fällen montiert bleibt. Hier steht die Partnerhälfte mit byte-gleichem Literal
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
    await screen.findByRole('heading', { name: 'Hochwasser Nord' });
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
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('ETB-Einträge konnten nicht geladen werden')).toBeInTheDocument();
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
      http.get('/api/einsaetze/7', () => HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' })),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
    ]);
    expect(await screen.findByText(LEER_TITEL)).toBeInTheDocument();
    // Die Erfassungsleiste wird für Lesende gar nicht gerendert — ein Fokussprung dorthin
    // zeigte auf einen Knoten, den es nicht gibt.
    expect(document.querySelector('.etb-erfassung-sticky')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ersten Eintrag erfassen' })).not.toBeInTheDocument();
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
      key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true,
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
      key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true,
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
      key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true,
    });
    fireEvent(schnellerfassung, ereignis);

    expect(ereignis.defaultPrevented).toBe(false);
    expect(suche).toHaveValue('zzz');
  });
});
