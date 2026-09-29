import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { einsatzKeys } from '../api/queryKeys';
import FahrzeugePage from './FahrzeugePage';
import type { EinsatzAnzeige } from '../api/types';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; admin-global deckt
// schreibrecht.test.ts ab.
const nutzer = benutzerFixture();

function einsatz(overrides: Partial<EinsatzAnzeige> = {}) {
  return einsatzFixture({
    id: 7,
    bezeichnung: 'Hochwasser Nord',
    einsatznummer_intern: '2026-001',
    ...overrides,
  });
}

const ef = {
  id: 10,
  einsatz_id: 7,
  fahrzeug_id: 1,
  einheit_id: null,
  ist_adhoc: false,
  funkrufname: 'Florian 1',
  kennzeichen: 'XX-AB 1',
  fahrzeugtyp: 'LF 20',
  opta: null,
  traegerorganisation: null,
  status_id: 2,
  status_label: 'disponiert',
  status_kategorie: 'gebunden',
  status_farbe: null,
  bemerkung: null,
  disponiert_at: '2026-05-26 09:10:00',
  disponiert_von: 1,
  soll_besatzung: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
};
const stati = [
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
  { id: 3, label: 'vor_ort', kategorie: 'gebunden', farbe: null, fms_anker: 4, sortier: 40 },
];

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    einsatz_id: 7,
    personal_id: 5,
    einheit_id: null,
    fahrzeug_id: null,
    ist_adhoc: false,
    name: 'Anna Crew',
    funktion: null,
    traegerorganisation: null,
    staerke_position: 'mannschaft',
    status_id: null,
    status_label: null,
    status_kategorie: null,
    status_farbe: null,
    bemerkung: null,
    disponiert_at: '2026-05-26 09:10:00',
    disponiert_von: 1,
    ...overrides,
  };
}

function render(
  einsatzObj: ReturnType<typeof einsatz>,
  personal: ReturnType<typeof person>[] = [],
  efObj: Record<string, unknown> | Record<string, unknown>[] = ef,
) {
  const efListe = Array.isArray(efObj) ? efObj : [efObj];
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(efListe)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personal)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
    </Routes>,
    { route: '/einsaetze/7/fahrzeuge' },
  );
}

/**
 * Öffnet das Statusmenü einer Zeile und liefert das geöffnete Menü-Portal. antd lässt die Portale
 * geschlossener Dropdowns im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden`
 * — deshalb zusätzlich über `pointerEvents` filtern und genau einen Treffer verlangen.
 */
async function oeffneStatusmenue(zeile: HTMLElement, funkrufname: string): Promise<HTMLElement> {
  await userEvent.click(
    within(zeile).getByRole('button', { name: `Status von ${funkrufname} ändern` }),
  );
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
    (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
  );
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Statusmenü zu ${funkrufname} ließ sich nicht öffnen`);
  return menue;
}

describe('FahrzeugePage', () => {
  /**
   * Der Weg zum Meldebild von der Pflegefläche. Geprüft wird das `href`: ein Inline-Pfad neben dem
   * Builder wäre sonst nicht zu unterscheiden.
   */
  it('verlinkt das Meldebild (vormals Kräfteübersicht) über der Tabelle', async () => {
    render(einsatz());
    const link = await screen.findByRole('link', { name: 'Meldebild' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/kraefteuebersicht');
  });

  it('zeigt disponierte Fahrzeuge', async () => {
    render(einsatz());
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
  });

  it('bedient den Status am Etikett, nicht über ein Auswahlfeld in der Zelle', async () => {
    /**
     * Kein `Select` mit fester Mindestbreite in der Zeile (die 390-px-Karte scheiterte daran).
     * Beide Hälften: das Auswahlfeld ist weg und der Auslöser trägt die Zeilenkennung — die erste
     * allein wäre auch ohne Bedienweg grün.
     */
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    expect(within(zeile).queryByRole('combobox')).toBeNull();
    expect(
      within(zeile).getByRole('button', { name: 'Status von Florian 1 ändern' }),
    ).toBeInTheDocument();

    // Der ganze Katalog steht im Menü — senkrecht, weil zehn Werte in keine waagerechte Reihe
    // passen.
    const menue = await oeffneStatusmenue(zeile, 'Florian 1');
    for (const s of stati) {
      expect(
        within(menue).getByRole('menuitem', { name: new RegExp(s.label) }),
      ).toBeInTheDocument();
    }
  });

  it('setzt den Status zeilengenau optimistisch und rollt eine Serverablehnung zurück', async () => {
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    server.use(
      http.patch('/api/einsaetze/7/fahrzeuge/10', async () => {
        await gate;
        return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 });
      }),
    );
    const zweitesFahrzeug = { ...ef, id: 11, funkrufname: 'Florian 2' };
    const { container, client } = render(einsatz(), [], [ef, zweitesFahrzeug]);
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    const menue = await oeffneStatusmenue(zeile, 'Florian 1');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /vor_ort/ }));

    await waitFor(() => {
      expect(client.getQueryData<(typeof ef)[]>(einsatzKeys.fahrzeuge(7))?.[0].status_id).toBe(3);
    });
    // Der neue Wert steht vor der Server-Antwort in der Ansicht, nicht bloß im Zwischenspeicher.
    expect(zeile.textContent).toContain('vor_ort');
    // Der Riegel sperrt zeilenübergreifend: solange eine Statusmutation läuft, nimmt keine Zeile
    // eine zweite an.
    expect(within(zeile).getByRole('button', { name: /Status von Florian 1/ })).toBeDisabled();
    expect(
      within(container.querySelector('[data-row-key="11"]') as HTMLElement).getByRole('button', {
        name: /Status von Florian 2/,
      }),
    ).toBeDisabled();

    let refetchFreigeben: (() => void) | undefined;
    const refetchGate = new Promise<void>((resolve) => {
      refetchFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', async () => {
        await refetchGate;
        return HttpResponse.json([{ ...ef, funkrufname: 'Extern geändert' }, zweitesFahrzeug]);
      }),
    );
    act(() => {
      client.setQueryData<(typeof ef)[]>(einsatzKeys.fahrzeuge(7), (aktuell) =>
        aktuell?.map((eintrag) =>
          eintrag.id === 10 ? { ...eintrag, funkrufname: 'Extern geändert' } : eintrag,
        ),
      );
    });

    await act(async () => {
      freigeben?.();
    });
    await waitFor(() => {
      const stand = client.getQueryData<(typeof ef)[]>(einsatzKeys.fahrzeuge(7));
      expect(stand?.find((eintrag) => eintrag.id === 10)?.status_id).toBe(2);
      expect(stand?.find((eintrag) => eintrag.id === 10)?.funkrufname).toBe('Extern geändert');
    });
    await act(async () => {
      refetchFreigeben?.();
    });
  });

  it('hebt per ?fahrzeug=<id> die Zeile hervor (LFH-25 Inspector-Deeplink)', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
      http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
      http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>,
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
    // Besatzungs-Spalte dauerhaft sichtbar. Ist 1/0/0//1 < Soll 0/1/8//9 → unterbesetzt: roter
    // Badge, Soll als Klammer-Kontext (zugleich nicht-farbliches Signal).
    expect(screen.getByRole('columnheader', { name: 'Besatzung' })).toBeInTheDocument();
    expect(container.querySelector('.ant-tag-red')).toHaveTextContent('1/0/0//1 (Soll 0/1/8//9)');
  });

  it('zählt Besatzung ohne Stärke-Position als Mannschaft (BOS-Σ ist Kopfzahl)', async () => {
    // Eine Kraft auf dem Fahrzeug gehört zur Stärke, auch ohne F/UF-Position; Sammeltopf in der
    // BOS-Schreibweise ist die Mannschaft.
    const fuehrer = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const ohnePosition = person({
      id: 101,
      name: 'asdasd',
      fahrzeug_id: 10,
      staerke_position: null,
    });
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
    // Ist ≥ Soll in jeder Position → grün, ohne redundanten Soll-Text. Über den Stärke-Text wählen
    // (der Einsatz-Status wäre ein zweiter grüner Tag); dieselbe Stärke steht auch in der
    // Verdichtungszeile, gemeint ist die Marke der Zeile.
    const badge = screen.getByText('1/0/0//1', { selector: '.ant-tag' });
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
    // Ist 1/0/1//2 ≥ Soll 1/0/0//1 in jeder Position (Mannschaft über Soll) → erfüllt. Der reine
    // Text steht auch in der Verdichtungszeile.
    expect(screen.getByText('1/0/1//2', { selector: '.ant-tag' })).toHaveClass('ant-tag-green');
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
    const crew = person({
      id: 100,
      name: 'Anna Crew',
      fahrzeug_id: 10,
      staerke_position: 'mannschaft',
    });
    const frei = person({
      id: 101,
      name: 'Bert Frei',
      fahrzeug_id: null,
      staerke_position: 'fuehrer',
    });
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

  // ── Datensicht ──

  /**
   * Zwei Zeilen, deren gruppengeführte Reihenfolge sich beim Statuswechsel umdreht. Eine einzeilige
   * Fixture wäre wertlos: `toEqual(vorher)` über einem Einelement-Array ist immer grün.
   *   Serverordnung  [10 Florian 1 (gebunden), 11 Florian 9 (verfügbar)]
   *   gerendert      [11, 10]  (Gruppenachse führt: verfügbar vor gebunden)
   *   nach dem Flip  [10, 11]  (beide verfügbar → nach Funkrufname)
   * Die gerenderte Ausgangsfolge ist weder Server- noch Zielordnung.
   */
  const efGebunden = { ...ef, id: 10, funkrufname: 'Florian 1' };
  const efVerfuegbar = {
    ...ef,
    id: 11,
    funkrufname: 'Florian 9',
    status_id: 3,
    status_label: 'einsatzbereit',
    status_kategorie: 'verfuegbar',
  };
  const zeilenFolge = (container: HTMLElement) =>
    [...container.querySelectorAll('tr.ant-table-row')].map((r) => r.getAttribute('data-row-key'));

  it('gruppiert nach Statuskategorie, mit Zähler im Etikett', async () => {
    const { container } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    // Ein Textknoten, nicht zwei: sonst würfe dieselbe Abfrage später mit Mehrfachtreffern, sobald
    // ein Zähler daneben steht.
    expect(screen.getByText('verfügbar · 1')).toBeInTheDocument();
    expect(screen.getByText('gebunden · 1')).toBeInTheDocument();
    // Und die Gruppenachse führt wirklich: verfügbar (Florian 9) steht vor gebunden.
    expect(zeilenFolge(container)).toEqual(['11', '10']);
  });

  it('ein Statuswechsel unter dem Cursor verschiebt die Zeile NICHT (Kriterium 12)', async () => {
    const { container, client } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    const vorher = zeilenFolge(container);
    expect(vorher).toEqual(['11', '10']);

    // Fokus auf den Statusauslöser derselben Zeile, die gleich wandern würde.
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const auswahl = within(zeile).getByRole('button', { name: /Status von Florian 1/ });
    act(() => auswahl.focus());
    // Die Schleuse hängt an Fokus-Containment. Das wird gemessen — ein Test, der grün ist, weil
    // nichts umsortiert wurde, sähe sonst identisch aus.
    const sicht = screen.getByRole('region', { name: 'Fahrzeuge im Einsatz' });
    expect(sicht.contains(document.activeElement)).toBe(true);

    act(() => {
      client.setQueryData(einsatzKeys.fahrzeuge(7), [
        { ...efGebunden, status_id: 3, status_label: 'vor_ort', status_kategorie: 'verfuegbar' },
        efVerfuegbar,
      ]);
    });

    // Zellinhalt aktualisiert: der Auslöser zeigt den neuen Status. Über `textContent` statt
    // `getByText`, weil derselbe Wortlaut zugleich als Menüeintrag im Portal stehen kann.
    await waitFor(() => expect(zeile.textContent).toContain('vor_ort'));
    // Reihenfolge eingefroren: die Zeile wandert nicht unter dem offenen Auswahlfeld weg.
    expect(zeilenFolge(container)).toEqual(vorher);

    /**
     * Regressionsanker: der Zählerstreifen rechnet über die frischen Zeilenobjekte in der
     * gefrorenen Folge (`gruppiere(sichtbareZeilen, …)` in `Datensicht`), ist also nicht
     * eingefroren. Und weil der Statuswechsel keinen Schlüssel ändert, ist `zufluessig === 0`, ein
     * Sammelbanner erscheint nie. Beides gehört dem Primitiv.
     */
    expect(screen.getByText('verfügbar · 2')).toBeInTheDocument();
    expect(screen.queryByText(/^gebunden · /)).toBeNull();
    expect(screen.queryByRole('button', { name: /neue? Ein(trag|träge)/ })).toBeNull();
  });

  it('ein Fokuswechsel INS Statusmenü taut die Schleuse nicht auf', async () => {
    /**
     * Das Menü liegt in einem Portal an `document.body`, außerhalb der Sicht-Wurzel.
     * `pruefeVerlassen` in `Datensicht` taut auf, sobald der Fokus die Wurzel verlässt — und antds
     * `autoFocus` schiebt ihn beim Öffnen genau dorthin. Ohne den Overlay-Zweig dort wanderte die
     * Zeile weg, während das Menü offen ist.
     *
     * In jsdom verschiebt `autoFocus` den Fokus nicht ins Portal; ein Test, der bloß das Menü
     * öffnet, wäre auch ohne den Zweig grün. Geprüft wird deshalb der Handler direkt: ein
     * `focusout`, dessen `relatedTarget` im Menü liegt.
     */
    const { container, client } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    const vorher = zeilenFolge(container);
    expect(vorher).toEqual(['11', '10']);

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const ausloeser = within(zeile).getByRole('button', { name: /Status von Florian 1/ });
    act(() => ausloeser.focus());
    const menue = await oeffneStatusmenue(zeile, 'Florian 1');

    // Der Fokus verlässt die Sicht-Wurzel Richtung Portal — im Browser tut das antd selbst.
    const sicht = screen.getByRole('region', { name: 'Fahrzeuge im Einsatz' });
    expect(sicht.contains(menue)).toBe(false);
    fireEvent.focusOut(ausloeser, { relatedTarget: menue });

    act(() => {
      client.setQueryData(einsatzKeys.fahrzeuge(7), [
        { ...efGebunden, status_id: 3, status_label: 'vor_ort', status_kategorie: 'verfuegbar' },
        efVerfuegbar,
      ]);
    });

    await waitFor(() => expect(zeile.textContent).toContain('vor_ort'));
    expect(zeilenFolge(container)).toEqual(vorher);
  });

  it('Gegenprobe: ein Fokuswechsel AUS der Sicht heraus taut sie weiterhin auf', async () => {
    // Gegenprobe zum Overlay-Zweig: ein `pruefeVerlassen`, das nie auftaut, wäre oben ebenfalls
    // grün.
    const { container, client } = render(einsatz(), [], [efGebunden, efVerfuegbar]);
    await screen.findByText('Florian 1');
    expect(zeilenFolge(container)).toEqual(['11', '10']);

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const ausloeser = within(zeile).getByRole('button', { name: /Status von Florian 1/ });
    act(() => ausloeser.focus());
    fireEvent.focusOut(ausloeser, { relatedTarget: document.body });

    act(() => {
      client.setQueryData(einsatzKeys.fahrzeuge(7), [
        { ...efGebunden, status_id: 3, status_label: 'vor_ort', status_kategorie: 'verfuegbar' },
        efVerfuegbar,
      ]);
    });

    await waitFor(() => expect(zeilenFolge(container)).toEqual(['10', '11']));
  });

  it('Gegenprobe: OHNE Fokus in der Sicht ordnet sich die Liste sofort neu', async () => {
    // Gegenprobe zur Fokusbedingung: eine Sicht, die immer einfriert, wäre oben ebenfalls grün.
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
     * Leeres Bemerkungsfeld an der Fahrzeugseite. Die Spalte ist per Voreinstellung abgewählt; die
     * Vorprüfung auf „kein Auslöser" macht die zweite Hälfte aussagekräftig.
     *
     * Der Zähler ist hier empfindlicher, weil die Seite `kennzeichen` per `abBreite: 'lg'` führt:
     * nach dem Einschalten der Bemerkung muss er bei 1024 px auf „nichts ausgeblendet" fallen.
     */
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Bemerkung' }));

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      within(zeile).getByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ausgeblendet/ })).toBeNull();
  });

  it('der Spaltenschalter zählt Handauswahl UND Breitenausblendung in EINEM Zähler', async () => {
    /**
     * Gate 2 verlangt den Zähler ausgeblendeter Spalten, nicht `aus.length`: bei 1024 px ist nur
     * `bemerkung` abgewählt (1), bei 800 px fällt `kennzeichen` über `abBreite: 'lg'` zusätzlich
     * weg (2). Ein Zähler, der nur die Handauswahl kennt, meldete beide Male „1".
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
      // `findByText('Florian 1')` ist in beiden Zweigen grün — es zählt die Abwesenheit der
      // Tabelle.
      expect(container.querySelector('.ant-table')).toBeNull();
      expect(container.querySelectorAll('[data-lfh="datensicht-karte"]')).toHaveLength(1);
    });

    it('die Karte trägt genau eine Primäraktion, und die fragt nach (Kriterium 4)', async () => {
      setzeViewportBreite(390);
      const { container } = render(einsatz());
      await screen.findByText('Florian 1');
      const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
      const knopf = within(karte).getByRole('button', { name: 'Entfernen' });
      // Rot bedient nichts: die kritische Aktion trägt keinen Gefahren-Anstrich, sondern eine
      // Rückfrage.
      expect(knopf).not.toHaveClass('ant-btn-dangerous');
      fireEvent.click(knopf);
      expect(await screen.findByText('Aus Einsatz entfernen?')).toBeInTheDocument();
    });
  });

  it('Gegenprobe: ab md steht die Tabelle', async () => {
    // Gegenprobe: sonst wäre der Schmal-Test auch grün, wenn die Weiche bei jeder Breite auf Karten
    // fiele.
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });
});

/**
 * Datenzustände der Fahrzeugseite. Drei Quellen fallen unabhängig aus, jede mit eigener Antwort:
 * die Dispositionsliste (tauscht die Datensicht gegen die Fehlermeldung), der Statuskatalog (Banner
 * über der Tabelle) und der Stamm-Pool (Ausfall im Auswahlfeld statt „Keine freien Fahrzeuge").
 *
 * 1. Je Zusicherung „X nicht im DOM" steht eine Partnerzusicherung „X ist im DOM" mit gleichem
 *    Literal, sonst wäre die negative Hälfte nach jeder Umformulierung trivial grün.
 * 2. In jedem Fall scheitert genau eine Query; mehrere „Erneut abrufen" nebeneinander machten den
 *    Griff mehrdeutig.
 */
describe('FahrzeugePage · Datenzustände', () => {
  const gruenerBoden = () => [
    meHandler(nutzer),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])),
  ];

  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Die Abweichung steht vorn: `server.use` reiht in der übergebenen Reihenfolge ein und der
    // erste Treffer gewinnt. Andersherum schluckte der grüne Boden jede Abweichung.
    server.use(...abweichungen, ...gruenerBoden());
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>,
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
   * Veralteter Stand = `isError` mit Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale`. Der Ablauf ist der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung; die Zeilen müssen stehen bleiben.
   *
   * Assertiert wird der Banner-Text, nicht der Knopf „Erneut abrufen": den tragen
   * `SeitenStandVeraltet`, `SeitenFehler` und das Statuskatalog-Banner.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = zeige(http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])));
    await screen.findByText('Florian 1');

    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () => new HttpResponse(null, { status: 500 })),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.fahrzeuge(7) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie nicht.
    expect(screen.getByText('Florian 1')).toBeInTheDocument();
    expect(
      screen.queryByText('Disponierte Fahrzeuge konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Statuskatalog: Banner über der Tabelle', async () => {
    zeige(http.get('/api/fahrzeug-status', () => new HttpResponse(null, { status: 500 })));
    expect(
      await screen.findByText(
        'Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich',
      ),
    ).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Statuskatalog steht kein Banner', async () => {
    zeige();
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    expect(
      screen.queryByText(
        'Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich',
      ),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Stamm-Pool: das Auswahlfeld nennt den Ausfall statt „Keine freien Fahrzeuge"', async () => {
    const { container } = zeige(
      http.get('/api/fahrzeuge', () => new HttpResponse(null, { status: 500 })),
    );
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    await oeffneAuswahl(container, 'Stamm-Fahrzeug disponieren …');
    expect(
      await screen.findByText('Fahrzeugliste konnte nicht geladen werden'),
    ).toBeInTheDocument();
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
   * Derselbe Fehlermodus eine Ebene tiefer: scheitert die Personalliste, filtert der
   * Besatzungs-Pool auf die leere Menge und behauptete „Keine freien Kräfte".
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
    const { container } = zeige(
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])),
    );
    await screen.findByText('Florian 1');
    await klappeZeileAuf(container);
    await oeffneAuswahl(container, 'Kraft zur Besatzung …');
    expect(await screen.findByText('Keine freien Kräfte')).toBeInTheDocument();
    expect(screen.queryByText('Kräfte konnten nicht geladen werden')).not.toBeInTheDocument();
  });
});

/**
 * Ad-hoc-Schnellerfassung.
 *
 * 1. **Feldbudget.** Ein Zählvergleich „4 eingeklappt / 5 aufgeklappt" belegt das `forceRender`
 *    nicht — ohne das Flag rendert der Klapp-Bereich sein Feld nicht, und die Zahlen sind
 *    dieselben. Ein Nutzlast-Vergleich hilft auch nicht: antds `Form` hält mit `preserve` den Wert
 *    eines ausgehängten Feldes. Unterscheidend ist allein die DOM-Anwesenheit im eingeklappten
 *    Zustand — deshalb die `OPTA`-Zusicherung zwischen den Zählungen.
 * 2. **Serienmodus.** „Der Dialog ist noch offen" wäre auch bei still gescheitertem POST grün.
 *    Gemessen wird zuerst der Zähler der Hülle, der erst nach aufgelöstem `mutateAsync` steigt.
 *
 * Sichtbarkeit über die positive Klasse `ant-collapse-panel-active`: der Name des geschlossenen
 * Zustands ist eine Implementierungsfrage der Animation, und `toBeVisible()` ist bei antds
 * `:where()`-Selektoren in jsdom kein verlässlicher Zeuge. (antd v6 rendert `ant-collapse-panel` +
 * `-active`/`-inactive`, nicht `ant-collapse-content` wie v5.)
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
      'Funkrufname',
      'Fahrzeugtyp',
      'Trägerorganisation',
      'Kennzeichen',
    ]);
    // Das `forceRender`-Beweisstück: eingeklappt und trotzdem da, damit ein eingetragener Wert beim
    // Absenden mitgeht.
    expect(within(dialog).getByLabelText('OPTA')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    // `waitFor`: rc-motion sieht in jsdom kein `transitionend`, der Klassenwechsel kommt trotzdem,
    // nur nicht im selben Zug wie der Klick.
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
          ...ef,
          id: 20 + gesendet.length,
          ist_adhoc: true,
          funkrufname: String(koerper.adhoc.funkrufname),
        });
      }),
    );
    const dialog = await oeffneAdhoc();
    // Der Schalter steht per Vorgabe aus — ohne ihn gäbe es keine Übernahme.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.type(within(dialog).getByLabelText('Funkrufname'), 'Florian Nachbarstadt 44/1');
    await userEvent.type(within(dialog).getByLabelText('Fahrzeugtyp'), 'LF 20');
    await userEvent.type(within(dialog).getByLabelText('Trägerorganisation'), 'FF Nachbarstadt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    // Der Zähler steigt erst nach der aufgelösten Mutation — der Beleg, dass gespeichert wurde.
    expect(await within(dialog).findByText('Erfasst: 1')).toBeInTheDocument();
    expect(gesendet).toEqual([
      {
        funkrufname: 'Florian Nachbarstadt 44/1',
        fahrzeugtyp: 'LF 20',
        traegerorganisation: 'FF Nachbarstadt',
      },
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
    // Aufklappen, eintragen, wieder zuklappen — der Weg, auf dem ein ohne `forceRender`
    // ausgehängtes Feld seinen Wert lautlos verlöre.
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    await userEvent.type(await within(dialog).findByLabelText('OPTA'), 'FL RD 44/2');
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ funkrufname: 'Florian 44/2', opta: 'FL RD 44/2' });
  });

  /**
   * Gegenprobe zum Serienmodus: sonst wäre „der Dialog bleibt offen" auch grün, wenn er nie
   * zuginge.
   *
   * Gemessen wird der Schließvorgang, nicht das Verschwinden: rc-motion sieht in jsdom nie ein
   * `transitionend`, antd lässt die Hülle samt `role="dialog"` im Baum stehen (auch mit
   * `destroyOnHidden`). Beweiskräftig ist der Abgangszustand am Dialogknoten.
   */
  it('Gegenprobe: „Disponieren" fährt den Dialog zu', async () => {
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json({ ...ef, id: 21, ist_adhoc: true, funkrufname: 'Florian 44/1' }),
      ),
    );
    const dialog = await oeffneAdhoc();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
    await userEvent.type(within(dialog).getByLabelText('Funkrufname'), 'Florian 44/1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
  });
});

/**
 * FMS-Tableau (LFH-642): eine Ansicht dieser Seite über `?ansicht=tableau`. Die Ansicht selbst
 * prüft `kraefte/FmsTableau.test.tsx`; hier steht, was nur die Seite weiß — Auftrag aus der URL,
 * Umschalter, Mutationsweg, Einheiten-Ausfall.
 */
describe('FahrzeugePage — FMS-Tableau', () => {
  function Ort() {
    const l = useLocation();
    return <output data-testid="ort">{l.search}</output>;
  }

  function renderTableau(
    einheiten: () => Response | Promise<Response> = () =>
      HttpResponse.json([{ id: 1, name: 'Zug 1', abschnitt_id: 10, abschnitt_name: 'EA Nord' }]),
    route = '/einsaetze/7/fahrzeuge?ansicht=tableau',
  ) {
    const patches: unknown[] = [];
    // Der Serverstand wandert mit dem PATCH — sonst holte der Refetch nach `onSettled` den alten
    // Status zurück.
    let stand: Record<string, unknown> = {
      ...ef,
      einheit_id: 1,
      status_seit: '2026-05-26 09:10:00',
    };
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([stand])),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/einheiten', einheiten),
      http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
      http.get('/api/fahrzeuge', () => HttpResponse.json([])),
      http.patch('/api/einsaetze/7/fahrzeuge/10', async ({ request }) => {
        const body = await request.json();
        patches.push(body);
        stand = {
          ...stand,
          status_id: 3,
          status_label: 'vor_ort',
          status_seit: '2026-05-26 09:30:00',
        };
        return HttpResponse.json(stand);
      }),
    );
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/fahrzeuge"
          element={
            <>
              <FahrzeugePage />
              <Ort />
            </>
          }
        />
      </Routes>,
      { route },
    );
    return { patches };
  }

  it('übernimmt ?ansicht=tableau und räumt den Parameter (apply-then-clean)', async () => {
    renderTableau();
    const tableau = await screen.findByRole('region', { name: 'FMS-Tableau' });
    expect(await within(tableau).findByRole('heading', { name: 'EA Nord' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ort')).toHaveTextContent(''));
    // Der Auftrag ist verbraucht, die Ansicht bleibt Seitenzustand.
    expect(screen.getByRole('region', { name: 'FMS-Tableau' })).toBeInTheDocument();
  });

  it('räumt einen unbekannten Wert ebenfalls und bleibt bei der Liste', async () => {
    renderTableau(undefined, '/einsaetze/7/fahrzeuge?ansicht=kachel');
    await screen.findByText('Florian 1');
    await waitFor(() => expect(screen.getByTestId('ort')).toHaveTextContent(''));
    expect(screen.queryByRole('region', { name: 'FMS-Tableau' })).toBeNull();
  });

  it('schaltet über die Segmentleiste zwischen Liste und Tableau', async () => {
    renderTableau(undefined, '/einsaetze/7/fahrzeuge');
    const ansicht = await screen.findByRole('radiogroup', { name: 'Ansicht' });
    expect(screen.queryByRole('region', { name: 'FMS-Tableau' })).toBeNull();
    await userEvent.click(within(ansicht).getByRole('radio', { name: 'FMS-Tableau' }));
    expect(await screen.findByRole('region', { name: 'FMS-Tableau' })).toBeInTheDocument();
    await userEvent.click(within(ansicht).getByRole('radio', { name: 'Liste' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'FMS-Tableau' })).toBeNull());
  });

  it('eine Ziffer in der Kachel geht über denselben PATCH wie das Menü', async () => {
    const { patches } = renderTableau();
    const tableau = await screen.findByRole('region', { name: 'FMS-Tableau' });
    const knopf = await within(tableau).findByRole('button', {
      name: 'Status von Florian 1 ändern',
    });
    act(() => knopf.focus());
    fireEvent.keyDown(knopf, { key: '4' });
    await waitFor(() => expect(patches).toEqual([{ status_id: 3 }]));
    // Serverstand übernommen: der Chip zeigt S4, „seit" die Zeit aus der Antwort.
    await waitFor(() => expect(within(tableau).getByText('S4')).toBeInTheDocument());
  });

  it('bleibt ohne Einheiten (Modul gesperrt) bedienbar und sagt, warum ungegliedert', async () => {
    renderTableau(() => HttpResponse.json({ error: 'Modul gesperrt' }, { status: 403 }));
    const tableau = await screen.findByRole('region', { name: 'FMS-Tableau' });
    expect(await within(tableau).findByText(/Einheiten nicht abrufbar/)).toBeInTheDocument();
    expect(within(tableau).getByRole('heading', { name: 'Alle Fahrzeuge' })).toBeInTheDocument();
    expect(
      within(tableau).getByRole('button', { name: 'Status von Florian 1 ändern' }),
    ).toBeEnabled();
  });

  it('ein gescheiterter Refetch der Einheiten behauptet nicht „ohne Gliederung"', async () => {
    // Erst gelingt der Abruf, nach dem Statuswechsel (der die Einheiten invalidiert) nicht.
    let abrufe = 0;
    renderTableau(() => {
      abrufe += 1;
      return abrufe === 1
        ? HttpResponse.json([{ id: 1, name: 'Zug 1', abschnitt_id: 10, abschnitt_name: 'EA Nord' }])
        : HttpResponse.json({ error: 'kaputt' }, { status: 500 });
    });
    const tableau = await screen.findByRole('region', { name: 'FMS-Tableau' });
    const knopf = await within(tableau).findByRole('button', {
      name: 'Status von Florian 1 ändern',
    });
    act(() => knopf.focus());
    fireEvent.keyDown(knopf, { key: '4' });
    await waitFor(() => expect(abrufe).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(within(tableau).getByText('S4')).toBeInTheDocument());
    expect(within(tableau).getByRole('heading', { name: 'EA Nord' })).toBeInTheDocument();
    expect(within(tableau).queryByText(/Einheiten nicht abrufbar/)).toBeNull();
  });

  it('zeigt bis zur Antwort der Einheiten keine ungegliederte Fläche', async () => {
    let antworte: () => void = () => {};
    const gate = new Promise<void>((r) => (antworte = r));
    renderTableau(async () => {
      await gate;
      return HttpResponse.json([
        { id: 1, name: 'Zug 1', abschnitt_id: 10, abschnitt_name: 'EA Nord' },
      ]);
    });
    // Die Fahrzeuge sind da (Kopfzeile nennt sie), das Tableau wartet auf die Gliederung.
    await screen.findByText('1 Fahrzeuge');
    expect(screen.queryByRole('heading', { name: 'Alle Fahrzeuge' })).toBeNull();
    antworte();
    expect(await screen.findByRole('heading', { name: 'EA Nord' })).toBeInTheDocument();
  });

  it('ein ?fahrzeug=-Deeplink schaltet auf die Liste — im Tableau gäbe es keine Zeile', async () => {
    renderTableau(undefined, '/einsaetze/7/fahrzeuge?ansicht=tableau&fahrzeug=10');
    await waitFor(() => expect(screen.getByTestId('ort')).toHaveTextContent(''));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'FMS-Tableau' })).toBeNull());
    expect(
      within(screen.getByRole('radiogroup', { name: 'Ansicht' })).getByRole('radio', {
        name: 'Liste',
      }),
    ).toBeChecked();
  });
});

/**
 * Öffnet ein antd-Auswahlfeld über seinen Platzhaltertext. Nicht per Klick auf den Platzhalter:
 * `.ant-select-placeholder` trägt `pointer-events: none`, und `userEvent` bricht dort ab. Gegriffen
 * wird die Combobox im Feld — der Knoten, den auch die Tastatur fokussiert.
 */
async function oeffneAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
    s.textContent?.includes(platzhalter),
  );
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}

/** Klappt die erste Datenzeile auf — dort hängt der Besatzungsblock. */
async function klappeZeileAuf(container: HTMLElement) {
  const ausloeser = container.querySelector<HTMLElement>('.ant-table-row-expand-icon');
  expect(ausloeser, 'die Fahrzeugzeile muss aufklappbar sein').not.toBeNull();
  await userEvent.click(ausloeser!);
}
