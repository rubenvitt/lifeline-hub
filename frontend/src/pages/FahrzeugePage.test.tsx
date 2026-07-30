import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { einsatzKeys } from '../api/queryKeys';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugePage from './FahrzeugePage';

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-26 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-26 09:00:00',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

const ef = {
  id: 10, einsatz_id: 7, fahrzeug_id: 1, einheit_id: null, ist_adhoc: false, funkrufname: 'Florian 1',
  kennzeichen: 'XX-AB 1', fahrzeugtyp: 'LF 20', opta: null, traegerorganisation: null,
  status_id: 2, status_label: 'disponiert', status_kategorie: 'gebunden', status_farbe: null,
  bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
  soll_besatzung: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
};
const stati = [
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
  { id: 3, label: 'vor_ort', kategorie: 'gebunden', farbe: null, fms_anker: 4, sortier: 40 },
];

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: 100, einsatz_id: 7, personal_id: 5, einheit_id: null, fahrzeug_id: null, ist_adhoc: false,
    name: 'Anna Crew', funktion: null, traegerorganisation: null, staerke_position: 'mannschaft',
    status_id: null, status_label: null, status_kategorie: null, status_farbe: null,
    bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1, ...overrides,
  };
}

function render(
  einsatzObj: ReturnType<typeof einsatz>,
  personal: ReturnType<typeof person>[] = [],
  efObj: Record<string, unknown> | Record<string, unknown>[] = ef,
) {
  const efListe = Array.isArray(efObj) ? efObj : [efObj];
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(efListe)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personal)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/fahrzeuge' },
  );
}

describe('FahrzeugePage', () => {
  it('zeigt disponierte Fahrzeuge', async () => {
    render(einsatz());
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
  });

  it('hebt per ?fahrzeug=<id> die Zeile hervor (LFH-25 Inspector-Deeplink)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
      http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
      http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/fahrzeuge?fahrzeug=10' },
    );
    await screen.findByText('Florian 1');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="10"]')).toHaveClass('zeile-hervorgehoben'),
    );
  });

  it('Einsatzleitung im aktiven Einsatz sieht Disponieren-/Entfernen-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByText('Stamm-Fahrzeug disponieren …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter sieht reine Anzeige (Status-Badge statt Select)', async () => {
    render(einsatz({ meine_rolle: 'beobachter' }));
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Fahrzeug' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.getByText('disponiert')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist read-only und zeigt Hinweis', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00' }));
    await screen.findByText('Florian 1');
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
  });

  it('zeigt Unterbesetzung rot mit Soll-Kontext in Klammern', async () => {
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    // Besatzungs-Spalte dauerhaft sichtbar. Ist 1/0/0//1 < Soll 0/1/8//9 (UF/M fehlen) →
    // unterbesetzt: roter Badge, Soll als Klammer-Kontext (zugleich nicht-farbliches Signal).
    expect(screen.getByRole('columnheader', { name: 'Besatzung' })).toBeInTheDocument();
    expect(container.querySelector('.ant-tag-red')).toHaveTextContent('1/0/0//1 (Soll 0/1/8//9)');
  });

  it('zählt Besatzung ohne Stärke-Position als Mannschaft (BOS-Σ ist Kopfzahl)', async () => {
    // LFH-9: Eine Kraft ist physisch auf dem Fahrzeug und gehört zur Stärke, auch ohne
    // explizite F/UF-Position. Sammeltopf in der BOS-Schreibweise ist die Mannschaft.
    const fuehrer = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const ohnePosition = person({ id: 101, name: 'asdasd', fahrzeug_id: 10, staerke_position: null });
    const { container } = render(einsatz(), [fuehrer, ohnePosition]);
    await screen.findByText('Florian 1');
    // 1 Führer + 1 ohne Position → 1/0/1//2 (nicht 1/0/0//1, die zweite Kraft verschwindet sonst).
    expect(container.querySelector('.ant-tag-red')).toHaveTextContent('1/0/1//2 (Soll 0/1/8//9)');
  });

  it('zeigt erfülltes Soll grün ohne Soll-Ballast', async () => {
    const sollKlein = { ...ef, soll_besatzung: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 } };
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    render(einsatz(), [crew], sollKlein);
    await screen.findByText('Florian 1');
    // Ist 1/0/0//1 ≥ Soll 1/0/0//1 in jeder Position → grün, ohne redundanten Soll-Text.
    // Über den Stärke-Text wählen (der grüne Einsatz-Status „aktiv" wäre sonst ein zweiter ant-tag-green).
    const badge = screen.getByText('1/0/0//1');
    expect(badge).toHaveClass('ant-tag-green');
    expect(badge).not.toHaveTextContent('Soll');
  });

  it('wertet Überbesetzung als erfüllt (grün)', async () => {
    const sollKlein = { ...ef, soll_besatzung: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 } };
    const crew = [
      person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' }),
      person({ id: 101, name: 'Bert', fahrzeug_id: 10, staerke_position: 'mannschaft' }),
    ];
    render(einsatz(), crew, sollKlein);
    await screen.findByText('Florian 1');
    // Ist 1/0/1//2 ≥ Soll 1/0/0//1 in jeder Position (Mannschaft über Soll) → erfüllt.
    expect(screen.getByText('1/0/1//2')).toHaveClass('ant-tag-green');
  });

  it('zeigt fehlendes Soll neutral blau ohne Soll-Kontext', async () => {
    const ohneSoll = { ...ef, soll_besatzung: null };
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew], ohneSoll);
    await screen.findByText('Florian 1');
    // Kein hinterlegtes Soll → kein „erfüllt"-Urteil möglich → neutral blau, nur Ist.
    const badge = container.querySelector('.ant-tag-blue');
    expect(badge).toHaveTextContent('1/0/0//1');
    expect(badge).not.toHaveTextContent('Soll');
  });

  it('zeigt die Besatzung des Fahrzeugs und einen Frei-Pool-Picker nach dem Aufklappen', async () => {
    const crew = person({ id: 100, name: 'Anna Crew', fahrzeug_id: 10, staerke_position: 'mannschaft' });
    const frei = person({ id: 101, name: 'Bert Frei', fahrzeug_id: null, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew, frei]);
    await screen.findByText('Florian 1');

    // Besatzung ist standardmäßig eingeklappt → Zeile per Icon aufklappen.
    const expandIcon = container.querySelector('.ant-table-row-expand-icon-collapsed');
    expect(expandIcon).not.toBeNull();
    fireEvent.click(expandIcon!);

    // Besatzungsmitglied (fahrzeug_id === 10) wird angezeigt, mit Freigeben-Aktion.
    expect(await screen.findByText(/Anna Crew/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeInTheDocument();
    // Frei-Pool-Picker vorhanden (nur freie Kräfte).
    expect(screen.getByText('Kraft zur Besatzung …')).toBeInTheDocument();
  });

  it('markiert eine Besatzung aus anderer Einheit als das Fahrzeug', async () => {
    // Fahrzeug ef.einheit_id = null, Person in Einheit 3 → Diskrepanz-Tag nach Aufklappen.
    const crew = person({ id: 100, name: 'Cara Diskrepanz', fahrzeug_id: 10, einheit_id: 3 });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    fireEvent.click(container.querySelector('.ant-table-row-expand-icon-collapsed')!);
    expect(await screen.findByText(/Cara Diskrepanz/)).toBeInTheDocument();
    expect(screen.getByText('andere Einheit')).toBeInTheDocument();
  });

  // ── Datensicht (LFH-330 · B2) ───────────────────────────────────────────────────

  /**
   * ZWEI Zeilen, deren gruppengeführte Reihenfolge sich beim Statuswechsel UMDREHT.
   *
   * Eine einzeilige Fixture wäre hier wertlos: `expect(reihenfolge).toEqual(vorher)` ist
   * über einem Einelement-Array auch ohne Schleuse, auch mit `zufluss="sofort"` und auch
   * bei kaputter Sortierung grün. Hier gilt:
   *   Serverordnung  [10 Florian 1 (gebunden), 11 Florian 9 (verfügbar)]
   *   gerendert      [11, 10]  (Gruppenachse führt: verfügbar vor gebunden)
   *   nach dem Flip  [10, 11]  (beide verfügbar → nach Funkrufname)
   * Die gerenderte Ausgangsfolge ist damit WEDER die Serverordnung noch die Zielordnung.
   */
  const efGebunden = { ...ef, id: 10, funkrufname: 'Florian 1' };
  const efVerfuegbar = {
    ...ef, id: 11, funkrufname: 'Florian 9', status_id: 3, status_label: 'einsatzbereit',
    status_kategorie: 'verfuegbar',
  };
  const zeilenFolge = (container: HTMLElement) =>
    [...container.querySelectorAll('tr.ant-table-row')].map((r) => r.getAttribute('data-row-key'));

  it('gruppiert nach Statuskategorie, mit Zähler im Etikett', async () => {
    const { container } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    // EIN Textknoten, nicht zwei: sonst würfe dieselbe Abfrage später mit einer
    // Mehrfachtreffer-Verletzung, sobald ein Zähler daneben steht.
    expect(screen.getByText('verfügbar · 1')).toBeInTheDocument();
    expect(screen.getByText('gebunden · 1')).toBeInTheDocument();
    // Und die Gruppenachse führt wirklich: verfügbar (Florian 9) steht VOR gebunden.
    expect(zeilenFolge(container)).toEqual(['11', '10']);
  });

  it('ein Statuswechsel unter dem Cursor verschiebt die Zeile NICHT (Kriterium 12)', async () => {
    const { container, client } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    const vorher = zeilenFolge(container);
    expect(vorher).toEqual(['11', '10']);

    // Fokus in die Statusauswahl DERSELBEN Zeile, die gleich wandern würde.
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const auswahl = within(zeile).getByRole('combobox');
    act(() => auswahl.focus());
    // Die Schleuse hängt an Fokus-CONTAINMENT. Das wird gemessen, nicht angenommen —
    // ein Test, der grün ist, weil nichts umsortiert wurde, sieht sonst identisch aus.
    const sicht = screen.getByRole('region', { name: 'Fahrzeuge im Einsatz' });
    expect(sicht.contains(document.activeElement)).toBe(true);

    act(() => {
      client.setQueryData(einsatzKeys.fahrzeuge(7), [
        { ...efGebunden, status_id: 3, status_label: 'vor_ort', status_kategorie: 'verfuegbar' },
        efVerfuegbar,
      ]);
    });

    // Zellinhalt AKTUALISIERT: die Auswahl der Zeile zeigt den neuen Status. Über
    // `textContent` statt `getByText`, weil antds Auswahlfeld den gewählten Text mehrfach
    // in den Baum legt (Anzeige + Messknoten) und eine Einzeltreffer-Abfrage dort wirft.
    await waitFor(() => expect(zeile.textContent).toContain('vor_ort'));
    // Reihenfolge EINGEFROREN: die Zeile wandert nicht unter dem offenen Auswahlfeld weg.
    expect(zeilenFolge(container)).toEqual(vorher);

    /**
     * DIE GEMESSENE ABWEICHUNG von Plan §0.2 (a), hier als Regressionsanker statt als
     * Prosa: der Zählerstreifen rechnet über die FRISCHEN Zeilenobjekte in der gefrorenen
     * Folge (`gruppiere(sichtbareZeilen, …)` in `Datensicht`), also nicht eingefroren. Und
     * weil der Statuswechsel keinen Schlüssel ändert, ist `zufluessig === 0` und ein
     * Sammelbanner erscheint NIE — es gibt keine zweite Bannerursache „Reihenfolge
     * veraltet". Beides gehört dem Primitiv (Bündel F); geändert wird es nicht hier.
     */
    expect(screen.getByText('verfügbar · 2')).toBeInTheDocument();
    expect(screen.queryByText(/^gebunden · /)).toBeNull();
    expect(screen.queryByRole('button', { name: /neue? Ein(trag|träge)/ })).toBeNull();
  });

  it('Gegenprobe: OHNE Fokus in der Sicht ordnet sich die Liste sofort neu', async () => {
    // Ohne diese Gegenprobe belegt der Test oben nichts über die Fokusbedingung — eine
    // Sicht, die IMMER einfriert, wäre dort ebenfalls grün.
    const { container, client } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    expect(zeilenFolge(container)).toEqual(['11', '10']);

    act(() => {
      client.setQueryData(einsatzKeys.fahrzeuge(7), [
        { ...efGebunden, status_id: 3, status_label: 'vor_ort', status_kategorie: 'verfuegbar' },
        efVerfuegbar,
      ]);
    });

    await waitFor(() => expect(zeilenFolge(container)).toEqual(['10', '11']));
  });

  it('eingeschaltete Bemerkungsspalte trägt bei leerem Wert einen benannten Auslöser', async () => {
    /**
     * Befund M21 (LFH-369 · B5i) an der Fahrzeugseite. Wie bei Personal ist die Spalte per
     * Voreinstellung abgewählt (`FahrzeugePage.tsx:527`); die Vorprüfung auf „kein Auslöser"
     * macht die zweite Hälfte erst aussagekräftig.
     *
     * Der Zähler ist hier die empfindlichere Stelle, weil diese Seite zusätzlich
     * `kennzeichen` per `abBreite: 'lg'` führt: nach dem Einschalten der Bemerkung muss er
     * bei 1024 px auf „nichts ausgeblendet" fallen. Täte er das nicht, wäre die
     * Voreinstellungs-Entscheidung durch diesen Umbau verschoben worden.
     */
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Bemerkung' }));

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(within(zeile).getByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ausgeblendet/ })).toBeNull();
  });

  it('der Spaltenschalter zählt Handauswahl UND Breitenausblendung in EINEM Zähler', async () => {
    /**
     * Gate 2 verlangt den Zähler ausgeblendeter Spalten. Er darf nicht aus `aus.length`
     * kommen: bei 1024 px ist genau `bemerkung` per Voreinstellung abgewählt (1), bei
     * 800 px fällt `kennzeichen` über `abBreite: 'lg'` zusätzlich weg (2). Ein Zähler, der
     * nur die Handauswahl kennt, meldete beide Male „1".
     */
    const { unmount } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
    unmount();

    setzeViewportBreite(800);
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: /Spalten · 2 ausgeblendet/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Kennzeichen' })).toBeNull();
  });

  describe('unter md', () => {
    it('steht keine Tabelle, sondern Karten — und genau EIN Zweig im Baum', async () => {
      setzeViewportBreite(390);
      const { container } = render(einsatz());
      expect(await screen.findByText('Florian 1')).toBeInTheDocument();
      // `findByText('Florian 1')` allein ist in BEIDEN Zweigen grün und als Zweignachweis
      // wertlos — es zählt die Abwesenheit der Tabelle.
      expect(container.querySelector('.ant-table')).toBeNull();
      expect(container.querySelectorAll('[data-lfh="datensicht-karte"]')).toHaveLength(1);
    });

    it('die Karte trägt genau eine Primäraktion, und die fragt nach (Kriterium 4)', async () => {
      setzeViewportBreite(390);
      const { container } = render(einsatz());
      await screen.findByText('Florian 1');
      const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
      const knopf = within(karte).getByRole('button', { name: 'Entfernen' });
      // Rot bedient nichts: die kritische Aktion trägt KEINEN Gefahren-Anstrich, sondern
      // eine Rückfrage als zweiten Handgriff.
      expect(knopf).not.toHaveClass('ant-btn-dangerous');
      fireEvent.click(knopf);
      expect(await screen.findByText('Aus Einsatz entfernen?')).toBeInTheDocument();
    });
  });

  it('Gegenprobe: ab md steht die Tabelle', async () => {
    // Ohne diese Gegenprobe wäre der Schmal-Test auch grün, wenn die Weiche bei JEDER
    // Breite auf Karten fiele.
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });
});

/**
 * Datenzustände der Fahrzeugseite (LFH-331 · B3).
 *
 * Drei Quellen können hier unabhängig voneinander ausfallen, und jede hat eine eigene
 * sichtbare Antwort: die **Dispositionsliste** (tauscht die Datensicht gegen die
 * Fehlermeldung), der **Statuskatalog** (Banner über der Tabelle — ohne ihn ist kein
 * Statuswechsel möglich) und der **Stamm-Pool** (der Ausfall steht im Auswahlfeld statt
 * eines stumm leeren „Keine freien Fahrzeuge").
 *
 * ZWEI REGELN, an denen diese Tests hängen:
 *
 * 1. Je Zusicherung „X nicht im DOM" steht eine Partnerzusicherung „X IST im DOM" mit
 *    BYTE-GLEICHEM Literal daneben. Ohne sie wäre die negative Hälfte nach jeder
 *    Umformulierung des Leertexts trivial grün — und belegte über die Zustandsweiche
 *    nichts.
 * 2. In jedem Fall scheitert GENAU EINE Query. Ein pauschaler 500er stellte mehrere
 *    „Erneut abrufen" nebeneinander und ließe den Griff darauf an der Mehrdeutigkeit
 *    scheitern statt an der Sache.
 */
describe('FahrzeugePage · Datenzustände', () => {
  const gruenerBoden = () => [
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])),
  ];

  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Die Abweichung steht VORN: `server.use` reiht in der übergebenen Reihenfolge ein und
    // der erste Treffer gewinnt. Andersherum hätte der grüne Boden jede Abweichung
    // verschluckt — gemessen, ein Fehlschlag sah dann nach fehlenden Daten aus.
    server.use(...abweichungen, ...gruenerBoden());
    return renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/fahrzeuge' },
    );
  }

  it('gescheiterte Dispositionsliste: Fehler statt Leertext', async () => {
    zeige(http.get('/api/einsaetze/7/fahrzeuge', () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Fahrzeuge disponiert')).not.toBeInTheDocument();
  });

  it('leere Dispositionsliste: Leertext und KEIN Fehler', async () => {
    zeige();
    expect(await screen.findByText('Noch keine Fahrzeuge disponiert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`.
   *
   * Der Ablauf ist BEWUSST der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Vor dem Umbau verdrängte der Fehler die Zeilen — die Einsatzkraft verlor
   * eine Disposition, die sie eben noch gelesen hatte.
   *
   * Assertiert wird der Banner-TEXT, nicht der Knopf „Erneut abrufen": den tragen
   * `SeitenStandVeraltet`, `SeitenFehler` UND das Statuskatalog-Banner. Über den Knopf
   * gemessen wäre die Zusicherung mehrdeutig und im schlimmsten Fall trivial grün.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = zeige(http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])));
    await screen.findByText('Florian 1');

    server.use(http.get('/api/einsaetze/7/fahrzeuge', () => new HttpResponse(null, { status: 500 })));
    await client.refetchQueries({ queryKey: einsatzKeys.fahrzeuge(7) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('Florian 1')).toBeInTheDocument();
    expect(screen.queryByText('Disponierte Fahrzeuge konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  it('gescheiterter Statuskatalog: Banner über der Tabelle', async () => {
    zeige(http.get('/api/fahrzeug-status', () => new HttpResponse(null, { status: 500 })));
    expect(
      await screen.findByText('Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich'),
    ).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Statuskatalog steht kein Banner', async () => {
    zeige();
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    expect(
      screen.queryByText('Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich'),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Stamm-Pool: das Auswahlfeld nennt den Ausfall statt „Keine freien Fahrzeuge"', async () => {
    const { container } = zeige(http.get('/api/fahrzeuge', () => new HttpResponse(null, { status: 500 })));
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    await oeffneAuswahl(container, 'Stamm-Fahrzeug disponieren …');
    expect(await screen.findByText('Fahrzeugliste konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Fahrzeuge')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Keine freien Fahrzeuge"', async () => {
    const { container } = zeige();
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    await oeffneAuswahl(container, 'Stamm-Fahrzeug disponieren …');
    expect(await screen.findByText('Keine freien Fahrzeuge')).toBeInTheDocument();
    expect(screen.queryByText('Fahrzeugliste konnte nicht geladen werden')).not.toBeInTheDocument();
  });

  /**
   * Der Besatzungs-Pool ist derselbe Fehlermodus eine Ebene tiefer: scheitert die
   * Personalliste, filtert `personal.filter(p => p.fahrzeug_id == null)` auf die leere
   * Menge, und das Auswahlfeld behauptet „Keine freien Kräfte" — obwohl niemand weiß,
   * ob es welche gibt.
   */
  it('gescheiterte Personalliste: der Besatzungs-Pool nennt den Ausfall', async () => {
    const { container } = zeige(
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])),
      http.get('/api/einsaetze/7/personal', () => new HttpResponse(null, { status: 500 })),
    );
    await screen.findByText('Florian 1');
    await klappeZeileAuf(container);
    await oeffneAuswahl(container, 'Kraft zur Besatzung …');
    expect(await screen.findByText('Kräfte konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Kräfte')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leere Personalliste behält „Keine freien Kräfte"', async () => {
    const { container } = zeige(http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])));
    await screen.findByText('Florian 1');
    await klappeZeileAuf(container);
    await oeffneAuswahl(container, 'Kraft zur Besatzung …');
    expect(await screen.findByText('Keine freien Kräfte')).toBeInTheDocument();
    expect(screen.queryByText('Kräfte konnten nicht geladen werden')).not.toBeInTheDocument();
  });
});

/**
 * Ad-hoc-Schnellerfassung (LFH-332 · B4).
 *
 * Zwei Zusicherungen, die BEIDE eine Falle haben:
 *
 * 1. **Feldbudget.** Ein reiner Zählvergleich „4 eingeklappt / 5 aufgeklappt" belegt das
 *    `forceRender` NICHT — ohne das Flag rendert der Klapp-Bereich sein Feld gar nicht und
 *    die Zahlen sind dieselben. Ein Nutzlast-Vergleich hilft ebenfalls nicht: antds `Form`
 *    hält mit `preserve` (Default) auch den Wert eines ausgehängten Feldes. Was das Flag
 *    unterscheidbar macht, ist allein die DOM-Anwesenheit im eingeklappten Zustand —
 *    deshalb steht die `OPTA`-Zusicherung zwischen den beiden Zählungen.
 * 2. **Serienmodus.** „Der Dialog ist noch offen" ist für sich trivial grün: bei einem
 *    still gescheiterten POST steht er ebenfalls noch da. Gemessen wird deshalb zuerst der
 *    Zähler der Hülle — er steigt erst, nachdem `mutateAsync` aufgelöst hat.
 *
 * Sichtbarkeit wird über die POSITIVE Klasse `ant-collapse-panel-active` entschieden, nicht über
 * eine Verborgen-Klasse: welchen Namen rc-motion dem geschlossenen Zustand gibt, ist eine
 * Implementierungsfrage der Animation. `toBeVisible()` scheidet aus — antd v6 schreibt
 * `:where()`-Selektoren, und jsdoms berechneter Stil ist dort kein verlässlicher Zeuge.
 * (Gemessen: antd v6 rendert `ant-collapse-panel` + `-active`/`-inactive`, NICHT das aus v5
 * bekannte `ant-collapse-content` — ein Filter darauf ließ alle fünf Felder als sichtbar
 * durchgehen und den Test still danebengreifen.)
 */
describe('FahrzeugePage · Ad-hoc-Schnellerfassung', () => {
  /** Beschriftungen der Felder, die der Bediener gerade wirklich sieht. */
  function sichtbareFelder(dialog: HTMLElement) {
    return [...dialog.querySelectorAll<HTMLElement>('.ant-form-item-label label')]
      .filter((l) => {
        const klappinhalt = l.closest('.ant-collapse-panel');
        return klappinhalt == null || klappinhalt.classList.contains('ant-collapse-panel-active');
      })
      .map((l) => l.textContent);
  }

  async function oeffneAdhoc() {
    render(einsatz());
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' }));
    return screen.getByRole('dialog');
  }

  it('zeigt höchstens vier Felder — das fünfte liegt zugeklappt, aber im Baum', async () => {
    const dialog = await oeffneAdhoc();
    expect(sichtbareFelder(dialog)).toEqual([
      'Funkrufname', 'Fahrzeugtyp', 'Trägerorganisation', 'Kennzeichen',
    ]);
    // Das `forceRender`-Beweisstück: eingeklappt UND trotzdem da, damit ein eingetragener
    // Wert beim Absenden mitgeht und das Feld für Tastatur und Prüfung existiert.
    expect(within(dialog).getByLabelText('OPTA')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    // `waitFor`: rc-motion sieht in jsdom kein `transitionend`, der Klassenwechsel kommt
    // trotzdem — nur nicht zwingend im selben Zug wie der Klick.
    await waitFor(() => expect(sichtbareFelder(dialog)).toHaveLength(5));
    expect(sichtbareFelder(dialog)).toContain('OPTA');
  });

  it('„Speichern und nächste" hält den Dialog offen und behält Träger und Typ', async () => {
    const gesendet: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge', async ({ request }) => {
        const koerper = (await request.json()) as { adhoc: Record<string, unknown> };
        gesendet.push(koerper.adhoc);
        return HttpResponse.json({
          ...ef, id: 20 + gesendet.length, ist_adhoc: true,
          funkrufname: String(koerper.adhoc.funkrufname),
        });
      }),
    );
    const dialog = await oeffneAdhoc();
    // Der Schalter steht per Vorgabe AUS (30.07.2026) — ohne ihn gäbe es keine Übernahme.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.type(within(dialog).getByLabelText('Funkrufname'), 'Florian Nachbarstadt 44/1');
    await userEvent.type(within(dialog).getByLabelText('Fahrzeugtyp'), 'LF 20');
    await userEvent.type(within(dialog).getByLabelText('Trägerorganisation'), 'FF Nachbarstadt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    // Der Zähler steigt erst NACH der aufgelösten Mutation — er ist hier der Beleg, dass
    // wirklich gespeichert wurde, nicht bloß nichts passiert ist.
    expect(await within(dialog).findByText('Erfasst: 1')).toBeInTheDocument();
    expect(gesendet).toEqual([
      { funkrufname: 'Florian Nachbarstadt 44/1', fahrzeugtyp: 'LF 20', traegerorganisation: 'FF Nachbarstadt' },
    ]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Wertübernahme: der Funkrufname ist leer für das nächste Fahrzeug, Träger und Typ des
    // eintreffenden Zuges stehen weiter da.
    expect(within(dialog).getByLabelText('Funkrufname')).toHaveValue('');
    expect(within(dialog).getByLabelText('Fahrzeugtyp')).toHaveValue('LF 20');
    expect(within(dialog).getByLabelText('Trägerorganisation')).toHaveValue('FF Nachbarstadt');
  });

  it('ein Wert aus dem zugeklappten Bereich geht beim Absenden mit', async () => {
    const gesendet: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge', async ({ request }) => {
        const koerper = (await request.json()) as { adhoc: Record<string, unknown> };
        gesendet.push(koerper.adhoc);
        return HttpResponse.json({ ...ef, id: 22, ist_adhoc: true });
      }),
    );
    const dialog = await oeffneAdhoc();
    await userEvent.type(within(dialog).getByLabelText('Funkrufname'), 'Florian 44/2');
    // Aufklappen, eintragen, WIEDER zuklappen — der Weg, auf dem ein ohne `forceRender`
    // ausgehängtes Feld seinen Wert lautlos verlöre.
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    await userEvent.type(await within(dialog).findByLabelText('OPTA'), 'FL RD 44/2');
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ funkrufname: 'Florian 44/2', opta: 'FL RD 44/2' });
  });

  /**
   * Gegenprobe zum Serienmodus: ohne sie wäre „der Dialog bleibt offen" auch dann grün,
   * wenn er NIE zuginge — `onFertig` also gar nicht verdrahtet ist.
   *
   * Gemessen wird der Schließ-VORGANG, nicht das Verschwinden: rc-motion sieht in jsdom nie
   * ein `transitionend`, die Abgang-Animation läuft deshalb nie zu Ende und antd lässt die
   * Hülle samt `role="dialog"` und ihren Feldern im Baum stehen (gemessen, auch nach 800 ms
   * und trotz `destroyOnHidden`). Beweiskräftig ist der Abgangszustand am Dialogknoten.
   */
  it('Gegenprobe: „Disponieren" fährt den Dialog zu', async () => {
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json({ ...ef, id: 21, ist_adhoc: true, funkrufname: 'Florian 44/1' })),
    );
    const dialog = await oeffneAdhoc();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
    await userEvent.type(within(dialog).getByLabelText('Funkrufname'), 'Florian 44/1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
  });
});

/**
 * Öffnet ein antd-Auswahlfeld über seinen Platzhaltertext.
 *
 * NICHT per Klick auf den Platzhalter selbst: der `.ant-select-placeholder`-Knoten trägt
 * `pointer-events: none`, und `userEvent` bricht dort mit „element has pointer-events:
 * none" ab (gemessen). Gegriffen wird deshalb das Feld über seinen Text und darin die
 * Combobox — der Knoten, den auch eine Tastaturbedienung fokussiert.
 */
async function oeffneAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')]
    .find((s) => s.textContent?.includes(platzhalter));
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}

/** Klappt die erste Datenzeile auf — dort hängt der Besatzungsblock. */
async function klappeZeileAuf(container: HTMLElement) {
  const ausloeser = container.querySelector<HTMLElement>('.ant-table-row-expand-icon');
  expect(ausloeser, 'die Fahrzeugzeile muss aufklappbar sein').not.toBeNull();
  await userEvent.click(ausloeser!);
}
