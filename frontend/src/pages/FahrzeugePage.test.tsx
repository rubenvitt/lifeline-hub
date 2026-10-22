import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { einsatzKeys } from '../api/queryKeys';
import FahrzeugePage from './FahrzeugePage';
import type { EinsatzAnzeige } from '../api/types';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { listeVon, oeffne, waehle } from '../test/auswahlListe';

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; dass die Systemrolle
// fürs Schreiben nicht zählt, deckt schreibrecht.test.ts ab.
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
  entlasseneDaten: unknown[] = [],
  einheitenDaten: unknown[] = [],
  optionen: {
    benutzer?: ReturnType<typeof benutzerFixture>;
    weitereRouten?: ReactNode;
    material?: unknown[];
  } = {},
) {
  const efListe = Array.isArray(efObj) ? efObj : [efObj];
  server.use(
    // Mit Freigabe des Moduls Einheiten lädt die Liste die Einheiten stets (LLH-1073, design.md D5).
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheitenDaten)),
    http.get('/api/einsaetze/7/abschnitte', () => HttpResponse.json([])),
    meHandler(optionen.benutzer ?? nutzer),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    // Aktive und entlassene Fahrzeuge teilen den Pfad (LLH-1079 Teil II, `?entlassene=1`).
    http.get('/api/einsaetze/7/fahrzeuge', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('entlassene') ? entlasseneDaten : efListe,
      ),
    ),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personal)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])), // Pool (nur_im_dienst)
    // Beladung im Aufklapper (LLH-1225 D11): Materialliste und die Namen der Orte im Angebot.
    http.get('/api/einsaetze/7/material', () => HttpResponse.json(optionen.material ?? [])),
    http.get('/api/einsaetze/7/uhs', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      {optionen.weitereRouten}
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

/**
 * Wählt einen Eintrag im Zeilenmenü „⋯“ (LLH-1073, Entscheidung 14.10.2026: „Entlassen“ steht dort
 * als erster Eintrag). Das geöffnete Menü-Portal wird über die sichtbare Dropdown-Hülle gegriffen.
 */
async function waehleImZeilenmenue(funkrufname: string, eintrag: string) {
  await userEvent.click(screen.getByRole('button', { name: `Weitere Aktionen zu ${funkrufname}` }));
  const menue = document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  )!;
  await userEvent.click(within(menue).getByRole('menuitem', { name: eintrag }));
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

  it('Einsatzleitung im aktiven Einsatz sieht Disponieren-/Entlassen-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: 'Fahrzeuge disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toBeInTheDocument();
    // Die Aktionsspalte trägt nur den Menüauslöser; „Entlassen“ steht darin (LLH-1073).
    expect(screen.queryByRole('button', { name: 'Florian 1 entlassen' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Weitere Aktionen zu Florian 1' }),
    ).toBeInTheDocument();
  });

  /**
   * Entlassen ist umkehrbar (LLH-1079 Teil II, design.md D8): ein Klick ohne Rückfrage, danach ein
   * Rückgängig-Toast, der dasselbe Fahrzeug erneut disponiert. Seit LLH-1073 steht es als erster
   * Eintrag im Zeilenmenü, nicht rot (umkehrbar).
   */
  it('Entlassen fragt nicht nach und bietet Rückgängig an', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge/10/entlassen', () => {
        aufrufe.push('entlassen');
        return HttpResponse.json({ ...ef, beendet_als: 'entlassen' });
      }),
      http.post('/api/einsaetze/7/fahrzeuge/10/reaktivieren', () => {
        aufrufe.push('reaktivieren');
        return HttpResponse.json(ef);
      }),
    );
    render(einsatz());
    await screen.findByText('Florian 1');
    await waehleImZeilenmenue('Florian 1', 'Entlassen');
    await waitFor(() => expect(aufrufe).toEqual(['entlassen']));
    expect(document.querySelector('.ant-popconfirm:not(.ant-popover-hidden)')).toBeNull();
    expect(await screen.findByText('Florian 1 entlassen')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(aufrufe).toEqual(['entlassen', 'reaktivieren']));
  });

  /** Rückgängig aus dem Toast hat keine Zeile mehr: der Grund steht im Seitenhinweis. */
  it('scheitert Rückgängig, steht der Grund im Seitenhinweis', async () => {
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge/10/entlassen', () =>
        HttpResponse.json({ ...ef, beendet_als: 'entlassen' }),
      ),
      http.post('/api/einsaetze/7/fahrzeuge/10/reaktivieren', () =>
        HttpResponse.json({ error: 'Fahrzeug ist außer Dienst' }, { status: 422 }),
      ),
    );
    render(einsatz());
    await screen.findByText('Florian 1');
    await waehleImZeilenmenue('Florian 1', 'Entlassen');
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    const hinweis = await screen.findByText('Fahrzeug ist außer Dienst');
    expect(hinweis.closest('[data-lfh="entlassen-block"]')).toBeNull();
    expect(hinweis.closest('.ant-alert')).not.toBeNull();
  });

  /**
   * Stornieren ist unumkehrbar: Zeilenmenü, `<Modal>` mit einem Satz zur Folge, der Knopf nennt
   * die Handlung (Spec `kraefte-entlassung`). Die Ablehnung des Servers steht an der Zeile.
   */
  it('Stornieren fragt im Dialog nach, die Ablehnung steht an der Zeile', async () => {
    let gesendet = 0;
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge/10/stornieren', () => {
        gesendet += 1;
        return HttpResponse.json(
          {
            error:
              'Das Fahrzeug ist einer Einheit zugeordnet; erst lösen oder das Fahrzeug entlassen',
          },
          { status: 422 },
        );
      }),
    );
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen zu Florian 1' }));
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Stornieren' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Florian 1 stornieren?');
    expect(dialog.querySelector('.ant-modal-body')).toHaveTextContent(
      /^Das Fahrzeug erscheint danach in keiner Liste und keinem Nachweis\.$/,
    );
    expect(gesendet).toBe(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(await within(zeile).findByRole('alert')).toHaveTextContent('erst lösen');
    expect(gesendet).toBe(1);
  });

  /** Spec „Block Entlassen“: eingeklappt unter der Liste, mit „Erneut disponieren“. */
  it('zeigt Entlassene eingeklappt unter der Liste und disponiert sie erneut', async () => {
    let reaktiviert: number | null = null;
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge/:ef/reaktivieren', ({ params }) => {
        reaktiviert = Number(params.ef);
        return HttpResponse.json(ef);
      }),
    );
    const entlassen = (id: number, funkrufname: string) => ({
      ...ef,
      id,
      funkrufname,
      beendet_at: '2026-05-26 12:00:00',
      beendet_als: 'entlassen',
    });
    render(einsatz(), [], ef, [entlassen(20, 'Florian 8'), entlassen(21, 'Florian 9')]);
    const kopf = await screen.findByRole('button', { name: /Entlassen \(2\)/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Florian 8')).toBeNull();
    await userEvent.click(kopf);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Erneut disponieren: Florian 8' }),
    );
    await waitFor(() => expect(reaktiviert).toBe(20));
  });

  it('Beobachter sieht reine Anzeige (Status-Badge statt Select)', async () => {
    render(einsatz({ meine_rolle: 'beobachter' }));
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Fahrzeug' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fahrzeuge disponieren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Florian 1 entlassen' })).not.toBeInTheDocument();
    // Ein FMS-Format überall: „S3 · disponiert“ aus dem Katalog-Anker (LFH-973).
    expect(screen.getByText('S3 · disponiert')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist read-only und zeigt Hinweis', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00' }));
    await screen.findByText('Florian 1');
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Florian 1 entlassen' })).not.toBeInTheDocument();
  });

  /** Das Besatzungs-Urteil der Tabellenzeile (die Spalte „Besatzung"), nicht das im Aufklappteil. */
  function urteilDerZeile(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('[data-lfh="besatzung-urteil"]');
    if (!el) throw new Error('kein Besatzungs-Urteil gerendert');
    return el;
  }

  it('zeigt Unterbesetzung rot, mit beschriftetem Ist und Soll (LFH-962)', async () => {
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    // Besatzungs-Spalte dauerhaft sichtbar. Ist 1/0/0//1 < Soll 0/1/8//9 → unterbesetzt.
    expect(screen.getByRole('columnheader', { name: 'Besatzung' })).toBeInTheDocument();
    const urteil = urteilDerZeile(container);
    expect(urteil).toHaveAttribute('data-urteil', 'unterbesetzt');
    expect(within(urteil).getByText('unterbesetzt')).toBeInTheDocument();
    expect(urteil).toHaveTextContent('Ist 1/0/0//1 · Soll 0/1/8//9');
  });

  it('zeigt eine nicht zugeordnete Besatzung neutral als „nicht erfasst", nie rot (LFH-962)', async () => {
    const { container } = render(einsatz(), []);
    await screen.findByText('Florian 1');
    const urteil = urteilDerZeile(container);
    expect(urteil).toHaveAttribute('data-urteil', 'nicht_erfasst');
    expect(within(urteil).getByText('Besatzung nicht erfasst')).toBeInTheDocument();
    // Kein Ist-Wert, der wie eine Unterschreitung aussähe; das Soll bleibt als Auskunft.
    expect(urteil).not.toHaveTextContent('Ist');
    expect(urteil).toHaveTextContent('Soll 0/1/8//9');
    expect(urteil.querySelector('.ant-tag')?.className).not.toMatch(/ant-tag-(blue|green|red)\b/);
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
    expect(urteilDerZeile(container)).toHaveTextContent('Ist 1/0/1//2 · Soll 0/1/8//9');
  });

  it('zeigt erfülltes Soll als „Soll erfüllt"', async () => {
    const sollKlein = { ...ef, soll_besatzung: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 } };
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew], sollKlein);
    await screen.findByText('Florian 1');
    const urteil = urteilDerZeile(container);
    expect(urteil).toHaveAttribute('data-urteil', 'erfuellt');
    expect(within(urteil).getByText('Soll erfüllt')).toBeInTheDocument();
  });

  it('wertet Überbesetzung als erfüllt', async () => {
    const sollKlein = { ...ef, soll_besatzung: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 } };
    const crew = [
      person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' }),
      person({ id: 101, name: 'Bert', fahrzeug_id: 10, staerke_position: 'mannschaft' }),
    ];
    const { container } = render(einsatz(), crew, sollKlein);
    await screen.findByText('Florian 1');
    // Ist 1/0/1//2 ≥ Soll 1/0/0//1 in jeder Position (Mannschaft über Soll) → erfüllt.
    expect(urteilDerZeile(container)).toHaveAttribute('data-urteil', 'erfuellt');
  });

  it('zeigt fehlendes Soll neutral ohne Soll-Kontext', async () => {
    const ohneSoll = { ...ef, soll_besatzung: null };
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew], ohneSoll);
    await screen.findByText('Florian 1');
    // Kein hinterlegtes Soll → kein „erfüllt"-Urteil möglich → neutral (LFH-891: Blau bedient).
    const urteil = urteilDerZeile(container);
    expect(urteil).toHaveAttribute('data-urteil', 'kein_soll');
    expect(urteil).toHaveTextContent('Ist 1/0/0//1');
    expect(urteil).not.toHaveTextContent('Soll 0');
    expect(urteil.querySelector('.ant-tag')?.className).not.toMatch(/ant-tag-(blue|green|red)\b/);
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
    render(einsatz(), [crew, frei]);
    await screen.findByText('Florian 1');

    // Besatzung ist standardmäßig eingeklappt → über den beschrifteten Auslöser aufklappen.
    const ausloeser = screen.getByRole('button', { name: 'Besatzung zu Florian 1' });
    expect(ausloeser).toHaveAttribute('aria-expanded', 'false');
    expect(ausloeser).toHaveTextContent('Besatzung');
    await userEvent.click(ausloeser);
    expect(ausloeser).toHaveAttribute('aria-expanded', 'true');

    // Besatzungsmitglied (fahrzeug_id === 10) wird angezeigt, mit „Vom Fahrzeug lösen“
    // (LLH-1073, design.md D13: der Knopf nennt die Handlung).
    expect(await screen.findByText('Anna Crew')).toBeInTheDocument();
    // Die Stärke-Position steht als Wort, nicht als Wire-Wert (LFH-946).
    expect(screen.getByText('Mannschaft')).toBeInTheDocument();
    const loesen = screen.getByRole('button', { name: 'Anna Crew vom Fahrzeug lösen' });
    expect(loesen).toHaveTextContent('Vom Fahrzeug lösen');
    expect(loesen).toHaveClass('ant-btn-dangerous');
    // Frei-Pool-Picker vorhanden (nur freie Kräfte).
    expect(screen.getByText('Kraft zur Besatzung …')).toBeInTheDocument();
  });

  it('nennt je Person Position und Funktion; „Vom Fahrzeug lösen“ fragt nicht nach (LLH-1073)', async () => {
    const geloest: string[] = [];
    server.use(
      http.delete('/api/einsaetze/7/fahrzeuge/10/besatzung/:epId', ({ params }) => {
        geloest.push(String(params.epId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const crew = [
      person({
        id: 100,
        name: 'Anna Crew',
        fahrzeug_id: 10,
        staerke_position: 'unterfuehrer',
        einsatzfunktion: 'Gruppenführerin',
        funktion: 'Notfallsanitäterin',
      }),
      person({
        id: 102,
        name: 'Carl Ohne',
        fahrzeug_id: 10,
        staerke_position: null,
        funktion: 'Maschinist',
      }),
    ];
    const { container } = render(einsatz(), crew);
    await screen.findByText('Florian 1');
    await klappeZeileAuf(container);
    const block = container.querySelector<HTMLElement>('[data-lfh="besatzung-block"]')!;
    // Einsatzfunktion vor Qualifikation (`funktionText`, LLH-1067).
    expect(await within(block).findByText('Unterführer · Gruppenführerin')).toBeInTheDocument();
    expect(within(block).getByText('Maschinist')).toBeInTheDocument();
    await userEvent.click(
      within(block).getByRole('button', { name: 'Anna Crew vom Fahrzeug lösen' }),
    );
    await waitFor(() => expect(geloest).toEqual(['100']));
    expect(document.querySelector('.ant-popconfirm:not(.ant-popover-hidden)')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('markiert eine Besatzung aus anderer Einheit als das Fahrzeug', async () => {
    // Fahrzeug ef.einheit_id = null, Person in Einheit 3 → Diskrepanz-Tag nach Aufklappen.
    const crew = person({ id: 100, name: 'Cara Diskrepanz', fahrzeug_id: 10, einheit_id: 3 });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    await klappeZeileAuf(container);
    expect(await screen.findByText(/Cara Diskrepanz/)).toBeInTheDocument();
    expect(screen.getByText('andere Einheit')).toBeInTheDocument();
  });

  it('erreicht die Besatzung auch im Kartenzweig unter md (LFH-697)', async () => {
    setzeViewportBreite(390);
    const crew = person({ id: 100, name: 'Anna Crew', fahrzeug_id: 10 });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    expect(container.querySelector('.ant-table'), 'unter md steht keine Tabelle').toBeNull();

    const ausloeser = screen.getByRole('button', { name: 'Besatzung zu Florian 1' });
    await userEvent.click(ausloeser);
    // Der Bereich ist als Region nach seinem Auslöser benannt und trägt den Besatzungsblock.
    const bereich = screen.getByRole('region', { name: 'Besatzung zu Florian 1' });
    expect(within(bereich).getByText(/Anna Crew/)).toBeInTheDocument();
    expect(within(bereich).getByText('Kraft zur Besatzung …')).toBeInTheDocument();
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
    // ein Zähler daneben steht. Im Streifen gesucht: die Verdichtungszeile darüber schreibt
    // dieselben Wörter in derselben Folge (LFH-973).
    const streifen = within(
      container.querySelector<HTMLElement>('[data-lfh="datensicht-gruppenzaehler"]')!,
    );
    expect(streifen.getByText('1 verfügbar')).toBeInTheDocument();
    expect(streifen.getByText('1 gebunden')).toBeInTheDocument();
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
    const streifen = within(
      container.querySelector<HTMLElement>('[data-lfh="datensicht-gruppenzaehler"]')!,
    );
    expect(streifen.getByText('2 verfügbar')).toBeInTheDocument();
    expect(streifen.queryByText(/^\d+ gebunden$/)).toBeNull();
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
     * Der Zähler ist hier empfindlicher, weil die Seite `typ`, `abschnitt`, `seit`, `kennzeichen`
     * und `traeger` per `abBreite: 'xxl'` führt (LFH-1149, LLH-1079, LLH-1073): nach dem
     * Einschalten der Bemerkung muss er bei 1024 px von sechs auf genau diese fünf fallen.
     */
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Spalten · 6 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Bemerkung' }));

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      within(zeile).getByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spalten · 5 ausgeblendet/ })).toBeInTheDocument();
  });

  it('der Spaltenschalter zählt Handauswahl UND Breitenausblendung in EINEM Zähler', async () => {
    /**
     * Gate 2 verlangt den Zähler ausgeblendeter Spalten, nicht `aus.length`: ab 1600 px ist nur
     * `bemerkung` abgewählt (1), bei 1024 px fallen `typ`, `abschnitt`, `seit`, `kennzeichen` und
     * `traeger` über `abBreite: 'xxl'` zusätzlich weg (6, LFH-1149, LLH-1079, LLH-1073). Ein Zähler, der nur die
     * Handauswahl kennt, meldete beide Male „1".
     */
    setzeViewportBreite(1600);
    const { unmount } = render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Kennzeichen' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Typ' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Abschnitt' })).toBeInTheDocument();
    unmount();

    setzeViewportBreite(1024);
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: /Spalten · 6 ausgeblendet/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Abschnitt' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Seit' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Typ' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Kennzeichen' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Träger' })).toBeNull();
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

    /**
     * Genau eine Primäraktion (Kriterium 4): „Entlassen“ ist umkehrbar und fragt nicht nach
     * (LLH-1079, design.md D8); Stornieren steht im Menü daneben.
     */
    it('die Karte trägt genau eine Primäraktion, und die entlässt ohne Rückfrage', async () => {
      let entlassen = 0;
      server.use(
        http.post('/api/einsaetze/7/fahrzeuge/10/entlassen', () => {
          entlassen += 1;
          return HttpResponse.json({ ...ef, beendet_als: 'entlassen' });
        }),
      );
      setzeViewportBreite(390);
      const { container } = render(einsatz());
      await screen.findByText('Florian 1');
      const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
      expect(
        within(karte).getByRole('button', { name: 'Weitere Aktionen zu Florian 1' }),
      ).toBeInTheDocument();
      fireEvent.click(within(karte).getByRole('button', { name: 'Florian 1 entlassen' }));
      await waitFor(() => expect(entlassen).toBe(1));
      expect(document.querySelector('.ant-popconfirm:not(.ant-popover-hidden)')).toBeNull();
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
 * LLH-1073 Teil I (design.md D4/D5): Einheit (inline änderbar über das Modul Einheiten),
 * Abschnitt (der eigene der Einheit, sonst der geerbte) und Seit (Zeitpunkt des Status, Mono).
 */
describe('FahrzeugePage · Einheit, Abschnitt und Seit (LLH-1073)', () => {
  const EINHEITEN = [
    { id: 1, name: 'Zug 1', abschnitt_id: 10, abschnitt_name: 'EA Nord', ueber_einheit_id: null },
    { id: 2, name: 'Gruppe 1', abschnitt_id: null, abschnitt_name: null, ueber_einheit_id: 1 },
    {
      id: 3,
      name: 'Rettungsstaffel',
      abschnitt_id: 20,
      abschnitt_name: 'EA Süd',
      ueber_einheit_id: null,
    },
  ];
  const mitSeit = { ...ef, status_seit: '2026-05-26 09:10:00' };
  const kopf = () =>
    screen
      .getAllByRole('columnheader')
      .map((k) => k.textContent?.trim() ?? '')
      .filter((t) => t.length > 0);
  const FELD = 'Einheit zu Florian 1';

  it('Spalten in der Folge Funkrufname · Typ · Einheit · Abschnitt · Status · Seit · Besatzung', async () => {
    setzeViewportBreite(1600);
    render(einsatz(), [], { ...mitSeit, einheit_id: 1 }, [], EINHEITEN);
    await screen.findByText('Florian 1');
    expect(kopf()).toEqual([
      'Funkrufname',
      'Typ',
      'Einheit',
      'Abschnitt',
      'Status',
      'Seit',
      'Besatzung',
      'Kennzeichen',
      'Träger',
      'Aktionen',
    ]);
  });

  it('unter xxl weichen Abschnitt und Seit; die Einheit bleibt (Entscheidung 14.10.2026)', async () => {
    render(einsatz(), [], { ...mitSeit, einheit_id: 1 }, [], EINHEITEN);
    await screen.findByText('Florian 1');
    expect(kopf()).toEqual(['Funkrufname', 'Einheit', 'Status', 'Besatzung', 'Aktionen']);
  });

  it('der Abschnitt ist der geerbte, Seit steht in Mono', async () => {
    setzeViewportBreite(1600);
    const { container } = render(einsatz(), [], { ...mitSeit, einheit_id: 2 }, [], EINHEITEN);
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      await within(zeile).findByRole('button', { name: `${FELD} bearbeiten` }),
    ).toHaveTextContent('Gruppe 1');
    expect(within(zeile).getByText('EA Nord')).toBeInTheDocument();
    const seit = within(zeile).getByText(/1110/).closest('td')!;
    expect(seit).toHaveClass('lfh-zahl-spalte');
  });

  it('ohne Status-Zeitpunkt steht „—“ in Seit', async () => {
    setzeViewportBreite(1600);
    const { container } = render(einsatz(), [], { ...ef, status_seit: null }, [], EINHEITEN);
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect([...zeile.querySelectorAll('td.lfh-zahl-spalte')].map((z) => z.textContent)).toEqual([
      '—',
    ]);
  });

  it('Einheit wählen ordnet über das Modul Einheiten zu, der Abschnitt folgt', async () => {
    setzeViewportBreite(1600);
    const anfragen: string[] = [];
    let stand: Record<string, unknown> = { ...mitSeit, einheit_id: null };
    const { container } = render(einsatz(), [], stand, [], EINHEITEN);
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.has('entlassene') ? [] : [stand]),
      ),
      http.put('/api/einsaetze/7/einheiten/:eid/fahrzeug/:efId', ({ params }) => {
        anfragen.push(`PUT ${params.eid}/${params.efId}`);
        stand = { ...stand, einheit_id: Number(params.eid) };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await userEvent.click(within(zeile).getByRole('button', { name: `${FELD} eintragen` }));
    await waehle(FELD, 'Zug 1 › Gruppe 1');
    await userEvent.click(screen.getByRole('button', { name: `${FELD} speichern` }));
    await waitFor(() => expect(anfragen).toEqual(['PUT 2/10']));
    expect(
      await within(zeile).findByRole('button', { name: `${FELD} bearbeiten` }),
    ).toHaveTextContent('Gruppe 1');
    expect(within(zeile).getByText('EA Nord')).toBeInTheDocument();
  });

  it('die Auswahl gruppiert nach Abschnitt', async () => {
    const { container } = render(einsatz(), [], mitSeit, [], EINHEITEN);
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await userEvent.click(within(zeile).getByRole('button', { name: `${FELD} eintragen` }));
    await oeffne(FELD);
    expect(
      [...listeVon(FELD)!.querySelectorAll('.ant-select-item-group')].map((g) => g.textContent),
    ).toEqual(['EA Nord', 'EA Süd']);
  });

  it('Leeren gibt das Fahrzeug über die bisherige Einheit frei', async () => {
    const anfragen: string[] = [];
    const { container } = render(einsatz(), [], { ...mitSeit, einheit_id: 3 }, [], EINHEITEN);
    server.use(
      http.delete('/api/einsaetze/7/einheiten/:eid/fahrzeug/:efId', ({ params }) => {
        anfragen.push(`DELETE ${params.eid}/${params.efId}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await userEvent.click(await within(zeile).findByRole('button', { name: `${FELD} bearbeiten` }));
    const feld = screen.getByRole('combobox', { name: FELD }).closest('.ant-select')!;
    await userEvent.click(feld.querySelector<HTMLElement>('.ant-select-clear')!);
    await userEvent.click(screen.getByRole('button', { name: `${FELD} speichern` }));
    await waitFor(() => expect(anfragen).toEqual(['DELETE 3/10']));
  });

  it('eine Ablehnung steht an der Einheit', async () => {
    const { container } = render(einsatz(), [], mitSeit, [], EINHEITEN);
    server.use(
      http.put('/api/einsaetze/7/einheiten/:eid/fahrzeug/:efId', () =>
        HttpResponse.json({ error: 'Einheit ist aufgelöst' }, { status: 409 }),
      ),
    );
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await userEvent.click(within(zeile).getByRole('button', { name: `${FELD} eintragen` }));
    await waehle(FELD, 'Zug 1');
    await userEvent.click(screen.getByRole('button', { name: `${FELD} speichern` }));
    expect(await within(zeile).findByText(/Einheit ist aufgelöst/)).toBeInTheDocument();
  });

  it('Beobachter sieht die Einheit als Text', async () => {
    const { container } = render(
      einsatz({ meine_rolle: 'beobachter' }),
      [],
      { ...mitSeit, einheit_id: 1 },
      [],
      EINHEITEN,
    );
    await screen.findByText('Florian 1');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(await within(zeile).findByText('Zug 1')).toBeInTheDocument();
    expect(within(zeile).queryByRole('button', { name: new RegExp(FELD) })).toBeNull();
  });

  it('ohne Freigabe des Moduls Einheiten fehlen Einheit und Abschnitt, ohne Abruf', async () => {
    setzeViewportBreite(1600);
    const abrufe: string[] = [];
    const zaehle = ({ request }: { request: Request }) => {
      if (new URL(request.url).pathname === '/api/einsaetze/7/einheiten') abrufe.push(request.url);
    };
    server.events.on('request:start', zaehle);
    // Vor `render`: dessen Handler kennen die Freigaben nicht und überdecken sie deshalb nicht.
    server.use(
      http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ einheiten: { zugriff: false } })),
      ),
    );
    try {
      render(einsatz(), [], { ...mitSeit, einheit_id: 1 }, [], EINHEITEN);
      await screen.findByText('Florian 1');
      await waitFor(() => expect(kopf()).toContain('Seit'));
      expect(kopf()).not.toContain('Einheit');
      expect(kopf()).not.toContain('Abschnitt');
      expect(abrufe).toEqual([]);
    } finally {
      server.events.removeListener('request:start', zaehle);
    }
  });

  it('die Karte zeigt Einheit und Seit', async () => {
    setzeViewportBreite(390);
    const { container } = render(einsatz(), [], { ...mitSeit, einheit_id: 1 }, [], EINHEITEN);
    await screen.findByText('Florian 1');
    const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
    expect(await within(karte).findByText('Zug 1')).toBeInTheDocument();
    expect(within(karte).getByText('Einheit')).toBeInTheDocument();
    expect(within(karte).getByText('Seit')).toBeInTheDocument();
    expect(within(karte).getByText(/1110/)).toBeInTheDocument();
  });
});

/**
 * LLH-1073 Teil I, design.md D6 mit der Entscheidung vom 14.10.2026: in der Tabelle steht
 * „Entlassen“ als erster Menüeintrag (die Aktionsspalte trägt nur den Auslöser), dann „Angaben
 * ändern …“ (beim Stamm-Fahrzeug gesperrt mit Grund), „Im Stamm ändern ↗“ nur für die Verwaltung
 * der Einsatz-Org, hinter dem Trenner rot „Stornieren“. Auf der Karte bleibt „Entlassen“ die
 * Primäraktion.
 */
describe('FahrzeugePage · Zeilenmenü (LLH-1073)', () => {
  const adhoc = {
    ...ef,
    fahrzeug_id: null,
    ist_adhoc: true,
    funkrufname: 'Florian Nachbarstadt 44/1',
  };
  async function oeffneMenue(name: string, bereich: HTMLElement = document.body) {
    await userEvent.click(
      within(bereich).getByRole('button', { name: `Weitere Aktionen zu ${name}` }),
    );
    return document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
  }
  const eintraege = (menue: HTMLElement) =>
    [
      ...menue.querySelectorAll<HTMLElement>('[role="menuitem"], .ant-dropdown-menu-item-divider'),
    ].map((e) =>
      e.classList.contains('ant-dropdown-menu-item-divider')
        ? '—'
        : `${e.textContent}${e.getAttribute('aria-disabled') === 'true' ? ' (gesperrt)' : ''}${
            e.classList.contains('ant-dropdown-menu-item-danger') ? ' (rot)' : ''
          }`,
    );

  it('Ad-hoc-Fahrzeug: „Entlassen“ zuerst, „Angaben ändern …“, Trenner, rot „Stornieren“', async () => {
    render(einsatz(), [], adhoc);
    await screen.findByText('Florian Nachbarstadt 44/1');
    // Die Aktionsspalte trägt nur den Auslöser (Entscheidung 14.10.2026).
    expect(
      screen.queryByRole('button', { name: 'Florian Nachbarstadt 44/1 entlassen' }),
    ).toBeNull();
    const menue = await oeffneMenue('Florian Nachbarstadt 44/1');
    expect(eintraege(menue)).toEqual([
      'Entlassen',
      'Angaben ändern …',
      'Als eigene Einheit führen …',
      '—',
      'Stornieren (rot)',
    ]);
  });

  it('Stamm-Fahrzeug: „Angaben ändern · aus dem Stamm“ steht gesperrt, ohne Sprung', async () => {
    render(einsatz(), [], ef);
    await screen.findByText('Florian 1');
    const menue = await oeffneMenue('Florian 1');
    expect(eintraege(menue)).toEqual([
      'Entlassen',
      'Angaben ändern · aus dem Stamm (gesperrt)',
      'Als eigene Einheit führen …',
      '—',
      'Stornieren (rot)',
    ]);
  });

  it('Verwaltung der Einsatz-Org springt über „Im Stamm ändern ↗“ zum Stammfahrzeug', async () => {
    render(einsatz(), [], ef, [], [], {
      benutzer: benutzerFixture({ org_rolle: 'fuehrungskraft', org_id: 1 }),
      weitereRouten: (
        <Route
          path="/admin/stammdaten/fahrzeuge/:fahrzeugId"
          element={<output data-testid="stamm">Stammfahrzeug</output>}
        />
      ),
    });
    await screen.findByText('Florian 1');
    const menue = await oeffneMenue('Florian 1');
    expect(eintraege(menue)).toEqual([
      'Entlassen',
      'Angaben ändern · aus dem Stamm (gesperrt)',
      'Im Stamm ändern ↗',
      'Als eigene Einheit führen …',
      '—',
      'Stornieren (rot)',
    ]);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Im Stamm ändern ↗' }));
    expect(await screen.findByTestId('stamm')).toBeInTheDocument();
  });

  it('ein Admin einer fremden Org sieht den Sprung nicht', async () => {
    render(einsatz(), [], ef, [], [], {
      benutzer: benutzerFixture({ system_rolle: 'admin', org_id: 2 }),
    });
    await screen.findByText('Florian 1');
    const menue = await oeffneMenue('Florian 1');
    expect(within(menue).queryByRole('menuitem', { name: 'Im Stamm ändern ↗' })).toBeNull();
  });

  it('die Karte führt „Entlassen“ als Primäraktion, das Menü den Rest', async () => {
    setzeViewportBreite(390);
    const { container } = render(einsatz(), [], adhoc);
    await screen.findByText('Florian Nachbarstadt 44/1');
    const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
    const menue = await oeffneMenue('Florian Nachbarstadt 44/1', karte);
    expect(eintraege(menue)).toEqual([
      'Angaben ändern …',
      'Als eigene Einheit führen …',
      '—',
      'Stornieren (rot)',
    ]);
  });

  it('ohne Schreibrecht kein Auslöser', async () => {
    render(einsatz({ meine_rolle: 'beobachter' }), [], adhoc);
    await screen.findByText('Florian Nachbarstadt 44/1');
    expect(
      screen.queryByRole('button', { name: 'Weitere Aktionen zu Florian Nachbarstadt 44/1' }),
    ).toBeNull();
  });
});

/**
 * LLH-1073 Teil I, design.md D7: Dialog „Angaben ändern“ eines Ad-hoc-Fahrzeugs — drei Felder
 * sichtbar, Kennzeichen und OPTA im Klappteil (im Baum, Kopf nennt die Werte), gesendet nur das
 * Geänderte, ohne Änderung keine Anfrage, die Ablehnung im Dialog.
 */
describe('FahrzeugePage · Angaben ändern (LLH-1073)', () => {
  const adhoc = {
    ...ef,
    fahrzeug_id: null,
    ist_adhoc: true,
    funkrufname: 'Florian Nachbarstdt 44/1',
    fahrzeugtyp: null,
    kennzeichen: 'NB-FW 441',
    traegerorganisation: 'FF Nachbarstadt',
    opta: null,
  };
  function sichtbareFelder(dialog: HTMLElement) {
    return [...dialog.querySelectorAll<HTMLElement>('.ant-form-item-label label')]
      .filter((l) => {
        const klappinhalt = l.closest('.ant-collapse-panel');
        return klappinhalt == null || klappinhalt.classList.contains('ant-collapse-panel-active');
      })
      .map((l) => l.textContent);
  }
  async function oeffneAngaben(zeilenDaten: Record<string, unknown> = adhoc) {
    const patches: unknown[] = [];
    let stand = { ...zeilenDaten };
    render(einsatz(), [], stand);
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.has('entlassene') ? [] : [stand]),
      ),
      http.patch('/api/einsaetze/7/fahrzeuge/10', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        stand = { ...stand, ...body };
        return HttpResponse.json(stand);
      }),
    );
    const name = String(zeilenDaten.funkrufname);
    await screen.findByText(name);
    await userEvent.click(screen.getByRole('button', { name: `Weitere Aktionen zu ${name}` }));
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Angaben ändern …' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`Angaben zu ${name} ändern`);
    return { dialog, patches };
  }

  it('vorbelegt, drei Felder sichtbar; Kennzeichen und OPTA eingeklappt im Baum, der Kopf nennt sie', async () => {
    const { dialog } = await oeffneAngaben();
    expect(sichtbareFelder(dialog)).toEqual(['Funkrufname', 'Fahrzeugtyp', 'Trägerorganisation']);
    expect(within(dialog).getByLabelText('Funkrufname')).toHaveValue('Florian Nachbarstdt 44/1');
    expect(within(dialog).getByLabelText('Trägerorganisation')).toHaveValue('FF Nachbarstadt');
    // `forceRender`: eingeklappt und trotzdem da.
    expect(within(dialog).getByLabelText('Kennzeichen')).toHaveValue('NB-FW 441');
    expect(within(dialog).getByLabelText('OPTA')).toBeInTheDocument();
    expect(dialog.querySelector('[data-lfh="weitere-angaben-werte"]')).toHaveTextContent(
      'Kennzeichen NB-FW 441',
    );
  });

  it('sendet nur das Geänderte, geleert als null, und die Zeile zeigt den neuen Namen', async () => {
    const { dialog, patches } = await oeffneAngaben();
    const name = within(dialog).getByLabelText('Funkrufname');
    await userEvent.clear(name);
    await userEvent.type(name, 'Florian Nachbarstadt 44/1');
    await userEvent.type(within(dialog).getByLabelText('Fahrzeugtyp'), 'HLF 20');
    await userEvent.clear(within(dialog).getByLabelText('Trägerorganisation'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(patches).toEqual([
        {
          funkrufname: 'Florian Nachbarstadt 44/1',
          fahrzeugtyp: 'HLF 20',
          traegerorganisation: null,
        },
      ]),
    );
    expect(await screen.findByText('Florian Nachbarstadt 44/1')).toBeInTheDocument();
  });

  it('ohne Änderung schließt der Dialog ohne Anfrage', async () => {
    const { dialog, patches } = await oeffneAngaben();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    expect(patches).toEqual([]);
  });

  it('ein leerer Funkrufname sendet nicht', async () => {
    const { dialog, patches } = await oeffneAngaben();
    await userEvent.clear(within(dialog).getByLabelText('Funkrufname'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Funkrufname').closest('.ant-form-item')).toHaveClass(
        'ant-form-item-has-error',
      ),
    );
    expect(patches).toEqual([]);
  });

  it('ein Altwert über der Grenze im Klappteil öffnet ihn und sperrt das Senden', async () => {
    const { dialog, patches } = await oeffneAngaben({ ...adhoc, opta: 'O'.repeat(201) });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(sichtbareFelder(dialog)).toContain('OPTA'));
    expect(
      await within(dialog).findByText('OPTA darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it('eine Ablehnung steht im Dialog', async () => {
    const { dialog } = await oeffneAngaben();
    server.use(
      http.patch('/api/einsaetze/7/fahrzeuge/10', () =>
        HttpResponse.json({ error: 'Fahrzeug ist entlassen' }, { status: 409 }),
      ),
    );
    await userEvent.type(within(dialog).getByLabelText('Fahrzeugtyp'), 'HLF 20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText(/Fahrzeug ist entlassen/)).toBeInTheDocument();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
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

    expect(await screen.findByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
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
    zeige(http.get('/api/fahrzeuge', () => new HttpResponse(null, { status: 500 })));
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    await oeffneStammAuswahl();
    expect(
      await screen.findByText('Fahrzeugliste konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Fahrzeuge')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Keine freien Fahrzeuge"', async () => {
    zeige();
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    await oeffneStammAuswahl();
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

  it('ohne Freigabe des Moduls Einheiten ungegliedert, mit Grund (LLH-1073, design.md D5)', async () => {
    server.use(
      http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ einheiten: { zugriff: false } })),
      ),
    );
    renderTableau();
    const tableau = await screen.findByRole('region', { name: 'FMS-Tableau' });
    expect(await within(tableau).findByText(/Einheiten nicht abrufbar/)).toBeInTheDocument();
    expect(within(tableau).getByRole('heading', { name: 'Alle Fahrzeuge' })).toBeInTheDocument();
    expect(within(tableau).queryByRole('heading', { name: 'EA Nord' })).toBeNull();
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

/** Öffnet den Disponier-Dialog über den Kopfknopf und darin die Fahrzeugauswahl. */
async function oeffneStammAuswahl() {
  await userEvent.click(screen.getByRole('button', { name: 'Fahrzeuge disponieren' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Fahrzeuge' }));
}

/** Klappt die Zeile von „Florian 1" auf — dort hängt der Besatzungsblock. */
async function klappeZeileAuf(container: HTMLElement) {
  await userEvent.click(within(container).getByRole('button', { name: 'Besatzung zu Florian 1' }));
}

/**
 * LFH-733 (Spec `demo-daten`): Demo-Stammdaten bleiben in der Auswahl, stehen aber gesammelt in
 * der Gruppe „Demo-Daten“ hinter allen echten Fahrzeugen; disponierte Demo-Fahrzeuge tragen die
 * Marke „Demo“ in der Tabelle.
 */
describe('FahrzeugePage · Demo-Marke', () => {
  const stamm = (id: number, funkrufname: string, ist_demo: boolean) => ({
    id,
    funkrufname,
    fahrzeugtyp: 'LF 20',
    traegerorganisation: null,
    kennzeichen: null,
    opta: null,
    standort: null,
    fms_issi: null,
    sondersignal: false,
    tragenkapazitaet: null,
    staerke: null,
    bemerkung: null,
    dienststatus: 'in_dienst',
    angelegt_at: '2026-05-26 09:00:00',
    ist_demo,
  });

  function zeige(efs: Record<string, unknown>[], pool: ReturnType<typeof stamm>[]) {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(efs)),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
      http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
      http.get('/api/fahrzeuge', () => HttpResponse.json(pool)),
    );
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>,
      { route: '/einsaetze/7/fahrzeuge' },
    );
  }

  it('Auswahl: echte Fahrzeuge vorn, die Gruppe „Demo-Daten“ dahinter, Demo wählbar', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge/sammel', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json([{ ...ef, id: 30, fahrzeug_id: 2, ist_demo: true }], {
          status: 201,
        });
      }),
    );
    zeige([], [stamm(2, 'Florian Demo', true), stamm(1, 'Florian Echt', false)]);
    await screen.findByText('Noch keine Fahrzeuge disponiert');
    await oeffneStammAuswahl();
    await screen.findByText('Florian Echt (LF 20)');
    const eintraege = [
      ...document.querySelectorAll<HTMLElement>('.ant-select-dropdown .ant-select-item'),
    ].map((e) => e.textContent);
    expect(eintraege).toEqual(['Florian Echt (LF 20)', 'Demo-Daten', 'Florian Demo (LF 20)Demo']);

    await userEvent.click(screen.getByText('Florian Demo (LF 20)'));
    // Die Auswahl allein disponiert nicht (LFH-983), erst der Knopf im Dialog.
    expect(gesendet).toEqual([]);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Disponieren' }),
    );
    await waitFor(() => expect(gesendet).toEqual([{ fahrzeug_ids: [2], einheit_id: null }]));
  });

  it('Tabelle: nur die Demo-Disposition trägt „Demo“', async () => {
    zeige(
      [
        { ...ef, id: 10, fahrzeug_id: 1, funkrufname: 'Florian Echt', ist_demo: false },
        { ...ef, id: 11, fahrzeug_id: 2, funkrufname: 'Florian Demo', ist_demo: true },
      ],
      [],
    );
    const demoZeile = (await screen.findByText('Florian Demo')).closest('tr')!;
    const echteZeile = screen.getByText('Florian Echt').closest('tr')!;
    expect(within(demoZeile).getByText('Demo')).toBeInTheDocument();
    expect(within(echteZeile).queryByText('Demo')).not.toBeInTheDocument();
  });
});

/** LFH-983: Der Kopf öffnet nur; disponiert wird im Dialog mit Absende-Knopf im Formular. */
describe('FahrzeugePage · Disponieren im Dialog (LFH-983)', () => {
  it('der Kopf trägt Ansicht und Knöpfe, kein Auswahlfeld; der Dialog prüft die Pflicht', async () => {
    const { container } = render(einsatz());
    await screen.findByText('Florian 1');
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    expect(within(kopf).queryByRole('combobox')).toBeNull();
    expect(within(kopf).getByRole('radiogroup', { name: 'Ansicht' })).toBeInTheDocument();
    expect(within(kopf).getByRole('button', { name: 'Fahrzeuge disponieren' })).toBeInTheDocument();

    await userEvent.click(within(kopf).getByRole('button', { name: 'Fahrzeuge disponieren' }));
    const dialog = await screen.findByRole('dialog');
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    await userEvent.click(knopf);
    expect(await within(dialog).findByText('Mindestens ein Fahrzeug wählen')).toBeInTheDocument();
  });
});

describe('FahrzeugePage · Als eigene Einheit führen (LLH-1073 Teil II, design.md D9)', () => {
  const adhoc = {
    ...ef,
    fahrzeug_id: null,
    ist_adhoc: true,
    funkrufname: 'Florian Nachbarstadt 44/1',
  };
  const menueTexte = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: `Weitere Aktionen zu ${name}` }));
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
    return within(menue)
      .getAllByRole('menuitem')
      .map((e) => e.textContent);
  };

  it('fehlt im Menü eines Fahrzeugs mit Einheit', async () => {
    render(einsatz(), [], { ...adhoc, einheit_id: 1 }, [], [{ id: 1, name: 'Zug 1' }]);
    await screen.findByText('Florian Nachbarstadt 44/1');
    expect(await menueTexte('Florian Nachbarstadt 44/1')).not.toContain(
      'Als eigene Einheit führen …',
    );
  });

  it('fehlt ohne Freigabe des Moduls Einheiten', async () => {
    server.use(
      http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ einheiten: { zugriff: false } })),
      ),
    );
    render(einsatz(), [], adhoc);
    await screen.findByText('Florian Nachbarstadt 44/1');
    expect(await menueTexte('Florian Nachbarstadt 44/1')).toEqual([
      'Entlassen',
      'Angaben ändern …',
      'Stornieren',
    ]);
  });

  it('öffnet den Dialog vorbelegt mit dem Funkrufnamen', async () => {
    server.use(http.get('/api/einheit-typen', () => HttpResponse.json([])));
    render(einsatz(), [], adhoc);
    await screen.findByText('Florian Nachbarstadt 44/1');
    await waehleImZeilenmenue('Florian Nachbarstadt 44/1', 'Als eigene Einheit führen …');
    // Im Seitentest tragen alle Modals dieselbe Test-ID am Titel, der Name hilft nicht.
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Florian Nachbarstadt 44/1 als eigene Einheit führen'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Florian Nachbarstadt 44/1',
    );
  });
});

describe('FahrzeugePage · Personal der Einheit übernehmen (LLH-1073 Teil II, design.md D12)', () => {
  const mitEinheit = { ...ef, einheit_id: 1 };
  const EINHEIT = [{ id: 1, name: 'Rettungsstaffel', fuehrer_id: null }];
  const KNOPF = 'Personal der Einheit übernehmen';
  async function aufklappen() {
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Besatzung zu Florian 1' }));
  }

  it('fehlt ohne Einheit des Fahrzeugs', async () => {
    render(einsatz(), [person({ einheit_id: 1 })]);
    await aufklappen();
    await screen.findByText('Kraft zur Besatzung …');
    expect(screen.queryByRole('button', { name: KNOPF })).toBeNull();
  });

  it('steht ohne freie Kräfte der Einheit gesperrt, mit dem Grund daneben', async () => {
    render(
      einsatz(),
      [person({ einheit_id: 1, fahrzeug_id: 99 }), person({ id: 101, einheit_id: 2 })],
      mitEinheit,
      [],
      EINHEIT,
    );
    await aufklappen();
    expect(await screen.findByRole('button', { name: KNOPF })).toBeDisabled();
    expect(screen.getByText('keine freien Kräfte der Einheit')).toBeInTheDocument();
  });

  it('übernimmt die vorgewählten Kräfte, danach zeigt die Besatzung Ist und Soll', async () => {
    let personal: ReturnType<typeof person>[] = [
      person({ id: 100, name: 'Ulla', einheit_id: 1, staerke_position: 'unterfuehrer' }),
      person({ id: 101, name: 'Ali', einheit_id: 1, staerke_position: null }),
    ];
    const bodies: unknown[] = [];
    render(einsatz(), personal, mitEinheit, [], EINHEIT);
    server.use(
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personal)),
      http.post('/api/einsaetze/7/fahrzeuge/10/besatzung', async ({ request }) => {
        const body = (await request.json()) as { ep_ids: number[] };
        bodies.push(body);
        personal = personal.map((p) =>
          body.ep_ids.includes(p.id) ? person({ ...p, fahrzeug_id: 10 }) : p,
        );
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await aufklappen();
    const urteil = () =>
      document.querySelector('[data-lfh="besatzung-block"] [data-lfh="besatzung-urteil"]');
    expect(urteil()).toHaveAttribute('data-urteil', 'nicht_erfasst');
    await userEvent.click(await screen.findByRole('button', { name: KNOPF }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Personal der Einheit auf Florian 1')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(bodies).toEqual([{ ep_ids: [100, 101] }]));
    await waitFor(() => expect(urteil()).not.toHaveAttribute('data-urteil', 'nicht_erfasst'));
    expect(urteil()).toHaveTextContent('Ist');
    expect(urteil()).toHaveTextContent('Soll');
  });
});

describe('FahrzeugePage · Beladung im Aufklapper (LLH-1225 Teil II, design.md D11)', () => {
  const posten = (p: Record<string, unknown>) => ({
    einsatz_id: 7,
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
    posten({ id: 50, bezeichnung: 'Stromerzeuger', einsatz_fahrzeug_id: 10, status: 'defekt' }),
    posten({ id: 51, bezeichnung: 'Trage' }),
  ];
  async function aufklappen() {
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Besatzung zu Florian 1' }));
  }
  const block = () =>
    document.querySelector<HTMLElement>('[data-lfh="beladung-block"]') as HTMLElement;

  it('zeigt die Beladung unter der Besatzung mit Kopfzahl, Menge und Status', async () => {
    render(einsatz(), [], ef, [], [], { material: MATERIAL });
    await aufklappen();
    await waitFor(() => expect(block()).not.toBeNull());
    expect(within(block()).getByText('Beladung')).toBeInTheDocument();
    expect(block()).toHaveTextContent('1 Posten · 1 Ausfall');
    expect(within(block()).getByText('Stromerzeuger')).toBeInTheDocument();
    expect(within(block()).queryByText('Trage')).toBeNull();
    // Unter der Besatzung: der Besatzungsblock steht vorher im Dokument.
    const besatzung = document.querySelector('[data-lfh="besatzung-block"]')!;
    expect(
      besatzung.compareDocumentPosition(block()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('„Vom Fahrzeug lösen“ und „Material zuordnen …“ schicken den PATCH an die Disposition', async () => {
    const gesendet: { url: string; body: unknown }[] = [];
    render(einsatz(), [], ef, [], [], { material: MATERIAL });
    server.use(
      http.patch('/api/einsaetze/7/material/:emId', async ({ request }) => {
        gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({});
      }),
    );
    await aufklappen();
    await userEvent.click(
      await within(await waitFor(block)).findByRole('button', {
        name: 'Stromerzeuger vom Fahrzeug lösen',
      }),
    );
    await userEvent.click(within(block()).getByRole('combobox', { name: 'Material zuordnen' }));
    await userEvent.click(await screen.findByText('Trage · 1'));
    await waitFor(() =>
      expect(gesendet).toEqual([
        { url: '/api/einsaetze/7/material/50', body: { einsatz_fahrzeug_id: null } },
        { url: '/api/einsaetze/7/material/51', body: { einsatz_fahrzeug_id: 10 } },
      ]),
    );
  });

  it('ohne Freigabe Material: kein Block „Beladung“, und die Materialliste wird nicht abgefragt', async () => {
    server.use(
      http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ material: { zugriff: false } })),
      ),
    );
    const { client } = render(einsatz(), [], ef, [], [], { material: MATERIAL });
    await aufklappen();
    await screen.findByText('Kraft zur Besatzung …');
    // Erst wenn die Freigaben geladen sind, sagt das Fehlen des Blocks etwas über das Gate.
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.modulFreigaben(7))?.status).toBe('success'),
    );
    expect(block()).toBeNull();
    // Nie abgefragt: weder Daten noch ein Abruf unter dem Schlüssel der Materialliste.
    expect(client.getQueryState(einsatzKeys.material(7))?.dataUpdatedAt ?? 0).toBe(0);
    expect(client.getQueryState(einsatzKeys.material(7))?.fetchStatus ?? 'idle').toBe('idle');
  });

  it('erreicht die Beladung auch im Kartenzweig unter md', async () => {
    setzeViewportBreite(390);
    render(einsatz(), [], ef, [], [], { material: MATERIAL });
    await aufklappen();
    // Unter md ist der Bereich als Region nach seinem Auslöser benannt (LFH-697).
    const bereich = screen.getByRole('region', { name: 'Besatzung zu Florian 1' });
    expect(await within(bereich).findByText('Stromerzeuger')).toBeInTheDocument();
  });
});
