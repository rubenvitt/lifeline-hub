import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useNavigate } from 'react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import LageberichtePage from './LageberichtePage';
import LageberichtDetailPage from './LageberichtDetailPage';
import type { EinsatzAnzeige, LageberichtAnzeige } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { alsOrtszeit } from '../etb/filterZeit';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';

const admin = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};

const einsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-06-02 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-02 09:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Orga',
};

const bericht: LageberichtAnzeige = {
  id: 11, einsatz_id: 7, vorlage: 'freitext', titel: 'Lage 10:00', zeitstand: '2026-06-02 10:00:00',
  status: 'entwurf', abschnitte: [{ schluessel: 'text', text: 'Inhalt' }], version: 1,
  vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'A', erstellt_at: '2026-06-02 10:00:00',
  aktualisiert_at: '2026-06-02 10:00:00', freigegeben_von_id: null, freigegeben_von_name: null,
  freigegeben_at: null, etb_eintrag_id: null,
};

/**
 * FORTSCHREIBUNGSKETTE, additiv neben `bericht` angelegt (LFH-330 · B2, Bündel III):
 * `bericht` wird von `setupDetail` über `lagebericht7Abschnitte` weiterverwendet, ein Umbau
 * dort träfe die zehn Detailseiten-Tests dieser Datei mit.
 *
 * Zwei Fassungen mit identischem Titel — die Fortschreibung legt eine neue Zeile mit
 * `version + 1` an, der Vorgänger bleibt freigegeben liegen.
 *
 * ABSICHTLICH AUFSTEIGEND, also GEGEN die Serverordnung (`zeitstand DESC, id DESC`): in
 * Serverordnung wäre jede Sortierbehauptung unfälschbar grün und `standardSortierung`
 * ungeprüft.
 */
const KETTE: LageberichtAnzeige[] = [
  {
    ...bericht, id: 14, titel: 'Vortrag Nachmittag', vorlage: 'lagebericht', version: 1,
    status: 'freigegeben', zeitstand: '2026-06-02 09:00:00',
  },
  { ...bericht, id: 11, version: 1, status: 'freigegeben', zeitstand: '2026-06-02 10:00:00' },
  { ...bericht, id: 13, version: 2, status: 'entwurf', zeitstand: '2026-06-02 12:00:00', vorgaenger_id: 11 },
];

function setup(berichte: LageberichtAnzeige[] = [bericht]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/lageberichte' },
  );
}

const lagebericht7Abschnitte: LageberichtAnzeige = {
  ...bericht, id: 12, vorlage: 'lagebericht', titel: 'Lagevortrag',
  abschnitte: [
    { schluessel: 'auftrag', text: '' },
    { schluessel: 'gefahren_schadenlage', text: '' },
    { schluessel: 'eigene_lage', text: '' },
    { schluessel: 'lageentwicklung', text: '' },
    { schluessel: 'fuehrungsprobleme', text: '' },
    { schluessel: 'antraege_vorschlaege', text: '' },
    { schluessel: 'zusammenfassung', text: '' },
  ],
};

function setupDetail(lb: LageberichtAnzeige) {
  let stand = lb;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get(`/api/einsaetze/7/lageberichte/${lb.id}`, () => HttpResponse.json(stand)),
    /*
     * Erfolgreicher PATCH als Grundrauschen: mehrere dieser Tests tippen und verlassen ein
     * Feld, was den Blur-Autosave auslöst. Ohne Handler scheitert der Request, und seit
     * LFH-494 steht der Grund dann als sichtbares „Nicht gespeichert" in der Seite statt in
     * einem Toast — Rauschen, das eine spätere Fehlersuche kostet. Wer einen FEHLSCHLAG
     * braucht, nimmt `setupLebend` bzw. einen eigenen Handler.
     *
     * Der Handler SPIEGELT den Body und gibt nicht `lb` zurück — das ist gemessen nötig:
     * nach erfolgreichem Autosave fällt der Merker, und der auf die Invalidierung folgende
     * Refetch schreibt den Serverstand zurück ins Formular. Ein Handler, der den alten
     * Stand liefert, modellierte einen Server, der nichts speichert, und löschte das eben
     * Getippte wieder aus dem Feld (zwei Bestandstests dieser Datei wurden davon rot).
     */
    http.patch(`/api/einsaetze/7/lageberichte/${lb.id}`, async ({ request }) => {
      const body = (await request.json()) as Partial<LageberichtAnzeige>;
      stand = { ...stand, ...body };
      return HttpResponse.json(stand);
    }),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: `/einsaetze/7/lageberichte/${lb.id}` },
  );
}

describe('LageberichtDetailPage', () => {
  it('Entwurf-Editor zeigt ein Feld je Abschnitt der Vorlage', async () => {
    setupDetail(lagebericht7Abschnitte);
    expect(await screen.findByLabelText('Auftrag')).toBeInTheDocument();
    expect(screen.getByLabelText('Zusammenfassung')).toBeInTheDocument();
    expect(screen.getByLabelText('Gefahren-/Schadenlage')).toBeInTheDocument();
  });

  it('Entwurf-Editor stellt die Abschnitts-Felder mit autoSize statt fixer Mini-Höhe dar', async () => {
    setupDetail(lagebericht7Abschnitte);
    const feld = (await screen.findByLabelText('Auftrag')) as HTMLTextAreaElement;
    // autoSize lässt das Feld mit dem Inhalt mitwachsen (kein fixer rows={4}-Kasten)
    // und schaltet den browser-nativen Resize-Griff ab — kein zufälliger Mini-Griff (AK#2).
    // autoSize löst in rc-textarea eine Resize-Messung aus, die overflowY:hidden setzt
    // (nach Flush der Effects via findBy); ein fixer rows-Kasten hat kein Inline-Style.
    expect(feld.style.overflowY).toBe('hidden');
    expect(feld).not.toHaveAttribute('rows', '4');
  });

  it('Freigeben speichert den getippten Inhalt zuvor — ein eben befüllter Entwurf wird nicht als „leer" abgelehnt', async () => {
    // Backend-Semantik nachgebildet: POST /freigeben nimmt KEINEN Body und validiert
    // den PERSISTIERTEN Stand. Wer tippt und direkt freigibt (ohne „Entwurf speichern"),
    // bekam bisher „Der Bericht ist leer", obwohl Text im Feld steht.
    let persistierte = lagebericht7Abschnitte.abschnitte.map((a) => ({ ...a }));
    let status = 'entwurf';
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () =>
        HttpResponse.json({ ...lagebericht7Abschnitte, abschnitte: persistierte, status }),
      ),
      http.patch('/api/einsaetze/7/lageberichte/12', async ({ request }) => {
        const body = (await request.json()) as { abschnitte?: typeof persistierte };
        if (body.abschnitte) persistierte = body.abschnitte;
        return HttpResponse.json({ ...lagebericht7Abschnitte, abschnitte: persistierte, status });
      }),
      http.post('/api/einsaetze/7/lageberichte/12/freigeben', () => {
        if (persistierte.every((a) => a.text.trim() === '')) {
          return HttpResponse.json(
            { error: 'Der Bericht ist leer und kann nicht freigegeben werden' },
            { status: 422 },
          );
        }
        status = 'freigegeben';
        return HttpResponse.json({
          ...lagebericht7Abschnitte,
          abschnitte: persistierte,
          status,
          etb_eintrag_id: 99,
        });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/lageberichte/12' },
    );

    const auftrag = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftrag, 'Hochwasser steigt');
    // Bewusst OHNE vorher „Entwurf speichern" zu klicken.
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Freigeben/i }));

    // Erfolg: der getippte Inhalt wird persistiert und der Bericht freigegeben.
    expect(await screen.findByText('Bericht freigegeben')).toBeInTheDocument();
  });

  it('freigegebener Bericht ist read-only mit ETB-Link und Fortschreiben', async () => {
    setupDetail({
      ...lagebericht7Abschnitte, status: 'freigegeben', etb_eintrag_id: 99,
      freigegeben_von_name: 'A', freigegeben_at: '2026-06-02 11:00:00',
    });
    expect(await screen.findByRole('button', { name: /Fortschreiben/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Auftrag')).not.toBeInTheDocument();
  });

  it('rendert einen markierten Druckbereich', async () => {
    const { container } = setupDetail(lagebericht7Abschnitte);
    await screen.findAllByText('Lagevortrag');
    expect(container.querySelector('.lagebericht-print-root')).not.toBeNull();
  });

  it('Freigeben öffnet einen Bestätigungsdialog', async () => {
    setupDetail({ ...lagebericht7Abschnitte, abschnitte: [
      { schluessel: 'auftrag', text: 'X' }, { schluessel: 'gefahren_schadenlage', text: '' },
      { schluessel: 'eigene_lage', text: '' }, { schluessel: 'lageentwicklung', text: '' },
      { schluessel: 'fuehrungsprobleme', text: '' }, { schluessel: 'antraege_vorschlaege', text: '' },
      { schluessel: 'zusammenfassung', text: '' }] });
    await screen.findByRole('button', { name: /Freigeben/i });
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    expect(await screen.findByText(/endgültig|unveränderlich|ETB/i)).toBeInTheDocument();
  });

  it('Entwurf-Editor zeigt die Vorschau auf Wunsch neben dem Text (Umschalter, Vorgabe AUS)', async () => {
    setupDetail(lagebericht7Abschnitte);
    const auftragFeld = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftragFeld, '## Schwerpunkt\n- Punkt A');
    // Vorgabe: KEINE Vorschau neben dem Text (H62 — der Split kostete die halbe
    // Schreibbreite und war für 2108 px Scrollstrecke mitverantwortlich).
    expect(screen.queryByRole('heading', { name: 'Schwerpunkt', level: 2 })).toBeNull();
    // Der Umschalter ist eine Einstellung in eigener Zeile, keine Aktion in der Knopfreihe.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vorschau neben dem Text' }));
    expect(await screen.findByRole('heading', { name: 'Schwerpunkt', level: 2 })).toBeInTheDocument();
    // Listeneintrag muss als listitem erscheinen
    expect(screen.getByText('Punkt A')).toBeInTheDocument();
    // "## Schwerpunkt" darf NICHT als sichtbarer Text (außerhalb der Textarea) erscheinen
    const rohTexte = screen.queryAllByText(/## Schwerpunkt/);
    for (const el of rohTexte) {
      expect(el.tagName.toLowerCase()).toBe('textarea');
    }
  });

  it('Entwurf-Editor spiegelt Markdown im eingeklappten Modus über den Vorschau-Knopf des Abschnitts', async () => {
    setupDetail(lagebericht7Abschnitte);
    const auftragFeld = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftragFeld, '## Schwerpunkt');
    const abschnitt = auftragFeld.closest('.ant-collapse-item') as HTMLElement;
    await userEvent.click(within(abschnitt).getByRole('button', { name: /Vorschau/ }));
    expect(await screen.findByRole('heading', { name: 'Schwerpunkt', level: 2 })).toBeInTheDocument();
  });

  it('Abschnittsnavigation listet alle acht Abschnitte, markiert leere und hält EINEN offen (H62)', async () => {
    const acht: LageberichtAnzeige = {
      ...lagebericht7Abschnitte, id: 15, vorlage: 'lagebeurteilung',
      abschnitte: [
        { schluessel: 'auftrag', text: 'Hochwasser' },
        { schluessel: 'anlass', text: '' },
        { schluessel: 'beurteilung_schadenlage', text: '' },
        { schluessel: 'beurteilung_eigene_lage', text: '' },
        { schluessel: 'gemeinsame_elemente', text: '' },
        { schluessel: 'entschlussvorschlaege', text: '' },
        { schluessel: 'abwaegen', text: '' },
        { schluessel: 'vorschlag_beste', text: '' },
      ],
    };
    setupDetail(acht);
    await screen.findByLabelText('Auftrag');
    const koepfe = await screen.findAllByRole('tab');
    expect(koepfe).toHaveLength(8);
    // Leer-Marke im Klartext (zweiter Kanal), befüllter Abschnitt ohne Marke.
    expect(screen.getByRole('tab', { name: /^expanded Auftrag$|^collapsed Auftrag$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Anlass des Lagevortrags \(leer\)$/ })).toBeInTheDocument();
    expect(koepfe.filter((k) => k.getAttribute('aria-expanded') === 'true')).toHaveLength(1);
    // Die Marke folgt dem Tippen: leeren Abschnitt befüllen → „(leer)" verschwindet.
    await userEvent.click(screen.getByRole('tab', { name: /Anlass des Lagevortrags \(leer\)$/ }));
    await userEvent.type(screen.getByLabelText('Anlass des Lagevortrags'), 'Pegel steigt');
    expect(screen.queryByRole('tab', { name: /Anlass des Lagevortrags \(leer\)$/ })).toBeNull();
    // Alle acht Editoren stehen im DOM — ein Speichern schickt keinen Abschnitt leer.
    // `[id]`: rc-textarea hängt für `autoSize` ein neuntes, unbeschriftetes Messfeld ein.
    expect(document.querySelectorAll('textarea[id]')).toHaveLength(8);
  });

  it('freigegebener Bericht rendert Markdown-Abschnittstext formatiert (Überschrift + Liste)', async () => {
    // Einen Abschnitt mit Markdown, einen ohne Text (Fallback "—")
    setupDetail({
      ...lagebericht7Abschnitte,
      status: 'freigegeben',
      abschnitte: [
        { schluessel: 'auftrag', text: '## Schwerpunkt\n- Punkt A' },
        { schluessel: 'gefahren_schadenlage', text: '' },
        { schluessel: 'eigene_lage', text: '' },
        { schluessel: 'lageentwicklung', text: '' },
        { schluessel: 'fuehrungsprobleme', text: '' },
        { schluessel: 'antraege_vorschlaege', text: '' },
        { schluessel: 'zusammenfassung', text: '' },
      ],
    });
    // Markdown-Überschrift (h2) muss als Heading gerendert sein, nicht als Rohtext "## Schwerpunkt"
    expect(await screen.findByRole('heading', { name: 'Schwerpunkt', level: 2 })).toBeInTheDocument();
    // Listeneintrag muss als listitem erscheinen, nicht als Rohtext "- Punkt A"
    expect(screen.getByText('Punkt A')).toBeInTheDocument();
    // Leerer Abschnitt zeigt den Fallback "—"
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Kein Rohtext mit Markdown-Zeichen
    expect(screen.queryByText(/## Schwerpunkt/)).toBeNull();
    expect(screen.queryByText(/- Punkt A/)).toBeNull();
  });
});

/**
 * Verlustschutz am Lageberichtsentwurf (LFH-348 · C13, Befund H63).
 *
 * Der reale Fremdschreib-Pfad: dieser Bericht ändert sich serverseitig (zweiter Tab, anderes
 * Stabsmitglied) → `LiveEvent::Lagebericht` → Invalidierung → neue Objektidentität → der
 * Sync-Effekt schrieb den Serverstand kommentarlos über ungespeicherte Eingaben. Ein
 * Refetch mit UNVERÄNDERTEM Stand tut das nicht (Structural Sharing) — deshalb schiebt jeder
 * Test hier einen geänderten Stand nach, nicht bloß eine Invalidierung.
 */
describe('LageberichtDetailPage — Verlustschutz (LFH-348 · C13, Befund H63)', () => {
  /** Serverstand nachschiebbar: der Handler liest aus einer Variablen. */
  function setupLebend(start: LageberichtAnzeige) {
    let stand = start;
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get(`/api/einsaetze/7/lageberichte/${start.id}`, () => HttpResponse.json(stand)),
      http.patch(`/api/einsaetze/7/lageberichte/${start.id}`, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(stand);
      }),
    );
    const r = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </AuthProvider>,
      { route: `/einsaetze/7/lageberichte/${start.id}` },
    );
    return {
      patches,
      /** Fremde Änderung: neuer Serverstand + Invalidierung wie über den Live-Stream. */
      fremdeAenderung: async (neu: LageberichtAnzeige) => {
        stand = neu;
        await act(async () => {
          await r.client.invalidateQueries({ queryKey: einsatzKeys.lagebericht(7, start.id) });
        });
      },
    };
  }

  it('überschreibt getippten Text NICHT, wenn der Bericht serverseitig geändert wurde', async () => {
    const { fremdeAenderung } = setupLebend(lagebericht7Abschnitte);
    const auftrag = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftrag, 'Meine Fassung');
    await fremdeAenderung({
      ...lagebericht7Abschnitte, titel: 'Fremde Fassung', aktualisiert_at: '2026-06-02 12:00:00',
    });
    // ZUERST warten, bis der neue Stand nachweislich ANGEKOMMEN ist: die Überschrift kommt
    // aus der Query, nicht aus dem Formular — der unabhängige Zeuge. Ohne ihn bestünde die
    // Zusicherung darunter beim ersten Versuch auch ohne jeden Riegel (C7, gemessen).
    await screen.findByRole('heading', { name: 'Fremde Fassung' });
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Meine Fassung');
  });

  it('übernimmt eine fremde Änderung in ein unberührtes Formular (Gegenaussage)', async () => {
    const { fremdeAenderung } = setupLebend(lagebericht7Abschnitte);
    await screen.findByLabelText('Auftrag');
    await fremdeAenderung({
      ...lagebericht7Abschnitte, titel: 'Neu vom Server', aktualisiert_at: '2026-06-02 12:00:00',
      abschnitte: [{ schluessel: 'auftrag', text: 'Fremder Text' }, ...lagebericht7Abschnitte.abschnitte.slice(1)],
    });
    await screen.findByRole('heading', { name: 'Neu vom Server' });
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Fremder Text');
  });

  it('lädt beim Wechsel der Bericht-ID neu, auch wenn im alten Bericht etwas offen war', async () => {
    const zweiter: LageberichtAnzeige = {
      ...lagebericht7Abschnitte, id: 13, titel: 'Zweiter Bericht',
      abschnitte: [{ schluessel: 'auftrag', text: 'Text 13' }, ...lagebericht7Abschnitte.abschnitte.slice(1)],
    };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () => HttpResponse.json(lagebericht7Abschnitte)),
      http.get('/api/einsaetze/7/lageberichte/13', () => HttpResponse.json(zweiter)),
      http.patch('/api/einsaetze/7/lageberichte/12', () => HttpResponse.json(lagebericht7Abschnitte)),
    );
    function Weiter() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate('/einsaetze/7/lageberichte/13')}>weiter</button>;
    }
    renderMitProviders(
      <AuthProvider>
        <Weiter />
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/lageberichte/12' },
    );
    await userEvent.type(await screen.findByLabelText('Auftrag'), 'offen');
    await userEvent.click(screen.getByRole('button', { name: 'weiter' }));
    await screen.findByRole('heading', { name: 'Zweiter Bericht' });
    // Dieselbe Komponente, andere ID: ohne Remount hielte der Riegel des alten Berichts
    // den neuen Serverstand fern, und das Feld zeigte „offen" statt „Text 13".
    expect(await screen.findByLabelText('Auftrag')).toHaveValue('Text 13');
  });

  it('speichert beim Verlassen eines Feldes von selbst und zeigt den Zeitstempel', async () => {
    const { patches } = setupLebend(lagebericht7Abschnitte);
    await userEvent.type(await screen.findByLabelText('Auftrag'), 'x');
    expect(patches).toHaveLength(0);
    await userEvent.tab();
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].abschnitte).toEqual(expect.arrayContaining([{ schluessel: 'auftrag', text: 'x' }]));
    expect(await screen.findByText(/zuletzt gespeichert \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('warnt beim Reload, solange eine Fassung ungespeichert ist — und sonst nicht', async () => {
    setupLebend(lagebericht7Abschnitte);
    const auftrag = await screen.findByLabelText('Auftrag');
    let ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);

    await userEvent.type(auftrag, 'noch nicht gespeichert');
    ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });

  it('macht den Zeitstand im Entwurf editierbar und schickt ihn als UTC-Wirestring (N23)', async () => {
    const { patches } = setupLebend(lagebericht7Abschnitte);
    const feld = await screen.findByLabelText('Zeitstand');
    // Der Wert kommt über den Sync-Effekt NACH dem ersten Render — deshalb `waitFor`.
    await waitFor(() =>
      expect(feld).toHaveValue(alsOrtszeit('2026-06-02 10:00:00')!.format('DD.MM.YYYY HH:mm')),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ zeitstand: '2026-06-02 10:00:00' });
  });
});

/**
 * ── SPEICHERFEHLER IN DER SEITE (LFH-494, Nachzug C13/N2) ──────────────────────
 *
 * Fortschreibung von C10/H14 auf die Entwurfsseiten. Der Grund eines gescheiterten
 * Autosave stand ausschliesslich in einem `message.error` und war nach rund drei Sekunden
 * weg; sichtbar blieb „ungespeicherte Änderungen" — das WAS ohne das WARUM.
 *
 * Beide Aussagen gehören als Paar hierher, und die zweite ist die schärfere: ein Alert, der
 * NIE geht, ist so falsch wie einer, der zu früh geht. `.ant-message`-Abgrenzung wie in den
 * C10-Tests — antds Toast rendert INNERHALB des RTL-Containers, ein blosses `findByText`
 * bliebe mit zurückgedrehtem Umbau grün.
 *
 * Ausgelöst wird über `onBlur`, nicht über die 30-s-Frist: die Frist steht im Hook-Test
 * (`entwurf/useEntwurfVerlustschutz.test.tsx`), und Fake-Timer vertragen sich nicht mit
 * `userEvent.type`.
 */
describe('LageberichtDetailPage — Speicherfehler in der Seite (LFH-494)', () => {
  function setupMitPatch(start: LageberichtAnzeige) {
    const zustand = { scheitert: true };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get(`/api/einsaetze/7/lageberichte/${start.id}`, () => HttpResponse.json(start)),
      http.patch(`/api/einsaetze/7/lageberichte/${start.id}`, () =>
        (zustand.scheitert
          ? HttpResponse.json({ error: 'Zeitstand liegt in der Zukunft' }, { status: 422 })
          : HttpResponse.json(start))),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </AuthProvider>,
      { route: `/einsaetze/7/lageberichte/${start.id}` },
    );
    return zustand;
  }

  it('lässt den Grund eines gescheiterten Autosave in der Seite stehen, nicht nur im Toast', async () => {
    setupMitPatch(lagebericht7Abschnitte);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, 'x');
    await userEvent.tab();

    const treffer = await screen.findByText('Zeitstand liegt in der Zukunft');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument();
    // Der Merker bleibt — der Grund ergänzt ihn, er ersetzt ihn nicht.
    expect(screen.getByText('ungespeicherte Änderungen')).toBeInTheDocument();
  });

  it('räumt den Grund beim nächsten gelungenen Speichern (Gegenaussage)', async () => {
    const zustand = setupMitPatch(lagebericht7Abschnitte);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, 'x');
    await userEvent.tab();
    expect(await screen.findByText('Zeitstand liegt in der Zukunft')).toBeInTheDocument();

    zustand.scheitert = false;
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() =>
      expect(screen.queryByText('Zeitstand liegt in der Zukunft')).not.toBeInTheDocument());
  });
});

describe('LageberichtePage', () => {
  it('zeigt den Grund eines gescheiterten Anlegens im Dialog, nicht nur im Toast (LFH-494)', async () => {
    // Die Erfassungs-Hülle lässt die Werte bei Ablehnung stehen (B4/LFH-332) — bis dahin
    // aber ohne Grund: der Dialog sah nach dem Verschwinden des Toasts unverändert aus.
    // Dieser Pfad läuft weiter über `mutation.error` und räumt beim nächsten Absenden;
    // anders als beim Autosave drückt hier ein Mensch den Knopf, es gibt keinen Auto-Retry.
    server.use(
      http.post('/api/einsaetze/7/lageberichte', () =>
        HttpResponse.json({ error: 'Titel bereits vergeben' }, { status: 409 })),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
    await screen.findByLabelText('Titel');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    const treffer = await screen.findByText('Titel bereits vergeben');
    expect(treffer.closest('.ant-message')).toBeNull();
    // Der Dialog steht weiter offen und hat die Werte behalten.
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeInTheDocument();
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value)
      .toMatch(/^Lageüberblick \d{4}$/);
  });

  it('ersetzt den Grund beim nächsten Absenden, statt ihn zu stapeln (Gegenaussage)', async () => {
    /*
     * Die zutreffende Hälfte des AK für DIESEN Pfad: hier räumt react-query beim Übergang
     * nach `pending`, weil ein Mensch den Knopf drückt. Der Autosave der Entwurfsseiten
     * räumt dagegen erst bei Erfolg — dort wiederholt eine Frist von selbst.
     *
     * Gemessen wird mit einem ZWEITEN Fehlschlag und anderem Wortlaut, nicht mit einem
     * Erfolg: antds Modal räumt sein DOM erst nach der Schliess-Transition (`afterClose`),
     * und die läuft in jsdom nie — der alte Knoten stünde nach dem Schliessen weiterhin im
     * Dokument, und die Abwesenheits-Zusicherung wäre unfälschbar rot. Mit offenem Dialog
     * misst der Fall genau das, was er behauptet: der Grund wird ERSETZT.
     */
    let zweiter = false;
    server.use(
      http.post('/api/einsaetze/7/lageberichte', () => HttpResponse.json(
        { error: zweiter ? 'Vorlage unbekannt' : 'Titel bereits vergeben' },
        { status: 409 },
      )),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
    await screen.findByLabelText('Titel');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Titel bereits vergeben')).toBeInTheDocument();

    zweiter = true;
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Vorlage unbekannt')).toBeInTheDocument();
    expect(screen.queryByText('Titel bereits vergeben')).not.toBeInTheDocument();
  });

  it('trägt beim erneuten Öffnen keinen Grund aus dem vorigen Versuch', async () => {
    // Derselbe Store-überlebt-das-Schliessen-Fall wie beim Titelvorschlag: ohne `reset()`
    // stünde der Fehler des letzten Anlegeversuchs über einem frischen, leeren Formular.
    server.use(
      http.post('/api/einsaetze/7/lageberichte', () =>
        HttpResponse.json({ error: 'Titel bereits vergeben' }, { status: 409 })),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
    await screen.findByLabelText('Titel');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Titel bereits vergeben')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: /Neuer Bericht/i }));
    await screen.findByLabelText('Titel');
    expect(screen.queryByText('Titel bereits vergeben')).not.toBeInTheDocument();
  });

  it('zeigt die Berichte des Einsatzes', async () => {
    setup();
    expect(await screen.findByText('Lage 10:00')).toBeInTheDocument();
  });

  it('zeigt für Schreibberechtigte den Anlegen-Button', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Neuer Bericht/i })).toBeInTheDocument();
  });

  it('zeigt leeren Zustand ohne Berichte', async () => {
    setup([]);
    expect(await screen.findByText(/Noch keine Lageberichte/i)).toBeInTheDocument();
  });

  it('zeigt leeren Zustand ohne eigenen Leer-Knoten', async () => {
    // WÄCHTER, kein Treiber: auch mit der alten Tabelle grün. Der Riss entsteht erst,
    // wenn `leerText` WEGGELASSEN wird — dann greift der Fallback in `Liste.tsx` und
    // rendert einen `.ant-empty`-Knoten (LFH-331/B3 verlangt null solcher Knoten).
    const { container } = setup([]);
    await screen.findByText(/Noch keine Lageberichte/i);
    expect(container.querySelector('.ant-empty')).toBeNull();
  });

  it('zeigt je Fortschreibungskette EINE Karte mit dem jüngsten Stand und den Vorgängern als Links (N23)', async () => {
    setup(KETTE);
    const sicht = await screen.findByRole('region', { name: 'Lageberichte' });

    // EINE Karte für die Kette 11 → 13: der Kopf ist v2 (Entwurf), v1 steht als Vorgänger-Link.
    const links = await screen.findAllByRole('link', { name: 'Lage 10:00' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/einsaetze/7/lageberichte/13']);
    // Kein zweiter Anker im Titel-Link: der Link entsteht in `karte.titel.ziel`.
    links.forEach((l) => expect(l.querySelector('a')).toBeNull());
    expect(screen.getByRole('link', { name: 'v1' })).toHaveAttribute('href', '/einsaetze/7/lageberichte/11');
    expect(sicht).toHaveTextContent('v2');
    expect(sicht).toHaveTextContent(/Vorgänger:\s*v1/);
    // Die Vorlage steht je KETTE einmal, nicht je Fassung.
    expect(screen.getAllByText('Freier Bericht')).toHaveLength(1);

    // Gruppenköpfe mit Zähler über KÖPFE, Entwürfe zuerst (`gruppen.reihenfolge`).
    // Trennzeichen und Zählerform gehören dem Primitiv → `[·(]` auf der Region.
    expect(sicht).toHaveTextContent(/Entwürfe\s*[·(]\s*1/);
    expect(sicht).toHaveTextContent(/Freigegeben\s*[·(]\s*1/);
    const text = sicht.textContent ?? '';
    expect(text.indexOf('Entwürfe')).toBeLessThan(text.indexOf('Freigegeben'));

    // Gruppenachse führend; der freigegebene Kopf 14 steht in seiner Gruppe.
    expect(
      within(sicht).getAllByRole('link').map((l) => l.getAttribute('href')),
    ).toEqual([
      '/einsaetze/7/lageberichte/13',
      '/einsaetze/7/lageberichte/11',
      '/einsaetze/7/lageberichte/14',
    ]);
  });

  it('öffnet das Anlege-Modal mit Fokus im Titel und vorbelegtem Titel aus der Uhrzeit (N23)', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
    const titel = await screen.findByLabelText('Titel');
    await waitFor(() => expect(titel).toHaveFocus());
    expect((titel as HTMLInputElement).value).toMatch(/^Lageüberblick \d{4}$/);
    // Erfassungs-Norm B4: der Absende-Knopf liegt IM Formular — Enter sendet; und kein
    // antd-Footer, in dem ein Knopf ausserhalb des `<form>` stünde.
    const knopf = screen.getByRole('button', { name: 'Anlegen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    // Drittes, optionales Feld: der Zeitstand (Backend konnte es schon, die UI bot es nie an).
    expect(screen.getByLabelText('Zeitstand')).toBeInTheDocument();
  });

  it('trägt beim zweiten Öffnen einen frischen Titelvorschlag, nicht den Speicher des ersten', async () => {
    // Der Speicher von rc-field-form überlebt `destroyOnHidden` und gewinnt gegen
    // `initialValues` (gemessen, Review LFH-348). Wer den Vorschlag über `initialValues`
    // setzt, sieht beim zweiten Öffnen den Stand des ersten — hier durch einen eigenen
    // Wortlaut sichtbar gemacht, weil zwei Uhrzeiten im selben Test gleich sein können.
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
    const erstes = await screen.findByLabelText('Titel');
    await userEvent.clear(erstes);
    await userEvent.type(erstes, 'Handgeschrieben');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: /Neuer Bericht/i }));
    const zweites = await screen.findByLabelText('Titel');
    await waitFor(() => expect((zweites as HTMLInputElement).value).toMatch(/^Lageüberblick \d{4}$/));
  });

  it('schickt Vorlage und Titel; ein leerer Zeitstand wird nicht mitgeschickt', async () => {
    const posts: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/7/lageberichte', async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(bericht, { status: 201 });
      }),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
    const titel = await screen.findByLabelText('Titel');
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Lage 1200{Enter}');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ vorlage: 'lagebericht', titel: 'Lage 1200' });
  });

  it('bleibt in jeder Breite eine Kartensicht (form="karte", kein Breakpoint-Rückfall)', async () => {
    setzeViewportBreite(390);
    const schmal = setup(KETTE);
    await screen.findAllByRole('link', { name: 'Lage 10:00' });
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    schmal.unmount();

    setzeViewportBreite(1366);
    const breit = setup(KETTE);
    await screen.findAllByRole('link', { name: 'Lage 10:00' });
    expect(breit.container.querySelector('.ant-table')).toBeNull();
  });

  it('filtert die Kartenliste über die Suche (Titel UND Vorlage)', async () => {
    setup(KETTE);
    await screen.findAllByRole('link', { name: 'Lage 10:00' });

    // „zur Information" steht NUR im Vorlagen-Label, in keinem Titel — ein nur auf den
    // Titel gelegter `suchText` wäre hier rot.
    await userEvent.type(screen.getByPlaceholderText('Titel oder Vorlage'), 'zur Information');

    expect(screen.queryAllByRole('link', { name: 'Lage 10:00' })).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Vortrag Nachmittag' })).toBeInTheDocument();
  });

  it('trägt Überschrift und Kennzahlenzeile', async () => {
    setup(KETTE);
    expect(await screen.findByRole('heading', { name: 'Lageberichte', level: 3 })).toBeInTheDocument();
    expect(await screen.findByText(/3 Berichte in 2 Ketten · 1 im Entwurf/)).toBeInTheDocument();
  });
});

/**
 * ── ZEITSTAND DER FASSUNGSZEILE (LFH-350 · H60) ─────────────────────────────────
 *
 * Die Spalte „Fassung" gab `zeitstand` bis dahin roh aus — ein UTC-Wirestring ohne
 * Zonenkennung, also um den Zonenversatz falsch. `sortWert` bleibt bewusst der Wirestring
 * (lexikografisch korrekt sortierbar), nur die ANZEIGE läuft über `ZeitAnzeige`.
 *
 * Die Zone wird AUSDRÜCKLICH gestellt und der Cache dafür VORBELEGT — beides ist gemessen
 * nötig: (1) ohne Provider fällt `useAnzeigeKonventionen` auf `DEFAULT_KONVENTIONEN` und
 * damit auf die LOKALE Zone der ausführenden Maschine zurück; (2) nur den Provider
 * einzuhängen genügt nicht, weil die Einstellungs-Abfrage ERST NACH dem ersten Render
 * auflöst — die Behauptung hat dann längst getroffen, und auf einem Berliner Rechner wäre
 * der Test auch mit `zeitzone: 'UTC'` grün geblieben (Gegenprobe gefahren). `setQueryData`
 * stellt die Zone vor dem ersten Render; der MSW-Handler bedient nur den Refetch.
 */
function setupMitZone(berichte: LageberichtAnzeige[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
    http.get('/api/einsaetze/7/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 7, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  // Bewusst NICHT `neuerQueryClient()`: dessen `gcTime: 0` räumt einen per `setQueryData`
  // gesetzten, noch unbeobachteten Eintrag beim ersten `await` weg (CLAUDE.md,
  // Query-Key-Registry). Hier hinge die Zone dann still wieder am MSW-Refetch.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(einsatzKeys.einstellungen(7), {
    einsatz_id: 7, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 },
  });
  return renderMitProviders(
    <AuthProvider>
      <EinsatzAnzeigeProvider einsatzId={7}>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
        </Routes>
      </EinsatzAnzeigeProvider>
    </AuthProvider>,
    { route: '/einsaetze/7/lageberichte', client },
  );
}

describe('LageberichtePage — Fassungszeile (LFH-350 · H60)', () => {
  it('zeigt den Zeitstand als taktische DTG in der Anzeigezone, nicht roh', async () => {
    setupMitZone([{ ...bericht, id: 21, version: 1, zeitstand: '2026-07-25 12:00:00' }]);
    // 12:00 UTC → 14:00 Sommerzeit in Berlin.
    expect(await screen.findByText('v1 · 251400JUL2026 · A')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});
