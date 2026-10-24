import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished } from 'vitest';
import { Link, Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import MaterialPage from './MaterialPage';
import { einsatzKeys } from '../api/queryKeys';
import { adminFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { listeVon, oeffne, waehle } from '../test/auswahlListe';
import { kopfFilterWaehlen } from '../test/kopfFilter';

const admin = adminFixture();

const einsatzAktiv = einsatzFixture();

const em = {
  id: 10,
  einsatz_id: 1,
  material_id: 5,
  einheit_id: null as number | null,
  uhs_id: null as number | null,
  einsatz_fahrzeug_id: null as number | null,
  br_id: null as number | null,
  ist_adhoc: false,
  bezeichnung: 'Wolldecke',
  kategorie: 'Betreuung',
  bestandsnummer: null as string | null,
  traegerorganisation: null as string | null,
  menge: 50,
  status: 'einsatzbereit',
  art: 'verbrauchsgut',
  ausgegeben: 0,
  bemerkung: null,
  disponiert_at: '2026-05-27 09:00:00',
  disponiert_von: 1,
};

/** Einheiten und UHS für die Spalte „Ort“ (LLH-1093). */
const EINHEITEN = [
  { id: 1, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null },
  { id: 2, name: 'Staffel B', ueber_einheit_id: null, abschnitt_id: null },
];
const UHS = [
  { id: 7, bezeichnung: 'Turnhalle', status: 'aktiv' },
  { id: 9, bezeichnung: 'Zelt Nord', status: 'aufgeloest' },
];

/** Fahrzeuge und Bereitstellungsräume der Ort-Auswahl (LLH-1225). */
const FAHRZEUGE = [{ id: 4, funkrufname: 'Florian 1/83-1', beendet_at: null }];
const BR = [{ id: 6, bezeichnung: 'BR Nord', status: 'geplant', storniert_at: null }];

function render(
  einsatzObj: typeof einsatzAktiv,
  materialListe: (typeof em)[],
  entlasseneDaten: unknown[] = [],
  orte: { einheiten?: unknown[]; fahrzeuge?: unknown[]; br?: unknown[] } = {},
  route = '/einsaetze/1/material',
) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    // Aktives und herausgenommenes Material teilen den Pfad (LLH-1079 Teil II, `?entlassene=1`).
    http.get('/api/einsaetze/1/material', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('entlassene') ? entlasseneDaten : materialListe,
      ),
    ),
    http.get('/api/material', () => HttpResponse.json([])),
    // Die Spalte „Ort“ löst Namen über Einheiten und UHS auf. Ohne diese Handler fiele ihre Query
    // auf `isError` (`onUnhandledRequest: 'error'`), und der Ort hieße nur „zugeordnet“.
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(orte.einheiten ?? EINHEITEN)),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(UHS)),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json(orte.fahrzeuge ?? FAHRZEUGE)),
    http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json(orte.br ?? BR)),
  );
  return renderMitProviders(
    <>
      <Ortsfuehler />
      <Routes>
        <Route
          path="/einsaetze/:id/material"
          element={
            <>
              <MaterialPage />
              <Link to="/einsaetze/2/material">Zu Einsatz 2</Link>
            </>
          }
        />
      </Routes>
    </>,
    { route },
  );
}

/** Die aktuelle Adresse, wie der Router sie hält (LLH-1096). */
const ort = { aktuell: '' };
function Ortsfuehler() {
  const l = useLocation();
  ort.aktuell = `${l.pathname}${l.search}`;
  return null;
}

/**
 * Zählt die GET-Abrufe je Pfad ab jetzt bis zum Ende des Tests (Spec `material-liste`, „Ort eines
 * Postens“: eine gesperrte Ortsart erzeugt keinen Abruf).
 */
function countRequests(): (pfad: string) => number {
  const pfade: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') pfade.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', listener);
  onTestFinished(() => {
    server.events.removeListener('request:start', listener);
  });
  return (pfad) => pfade.filter((p) => p === pfad).length;
}

/**
 * Öffnet das Statusmenü einer Zeile und liefert das geöffnete Menü-Portal. antd lässt die Portale
 * geschlossener Dropdowns im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden`
 * — deshalb zusätzlich über `pointerEvents` filtern.
 */
async function openStatusmenue(wurzel: HTMLElement, bezeichnung: string): Promise<HTMLElement> {
  await userEvent.click(
    within(wurzel).getByRole('button', { name: `Status von ${bezeichnung} ändern` }),
  );
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
    (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
  );
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Statusmenü zu ${bezeichnung} ließ sich nicht öffnen`);
  return menue;
}

describe('MaterialPage', () => {
  it('bedient den Status am Etikett, nicht über ein Auswahlfeld in der Zelle', async () => {
    /** Kein `Select` mit Mindestbreite in der Zeile (die 390-px-Karte scheiterte daran). */
    const trage = { ...em, id: 11, bezeichnung: 'Trage', art: 'geraet', menge: 1 };
    const { container } = render(einsatzAktiv, [em, trage]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="11"]') as HTMLElement;

    expect(within(zeile).queryByRole('combobox')).toBeNull();
    const menue = await openStatusmenue(zeile, 'Trage');
    // Ein Gerät: alle fünf Zustände senkrecht im Menü.
    for (const label of [
      'einsatzbereit',
      'im Einsatz',
      'defekt',
      'verbraucht',
      'Desinfektion nötig',
    ]) {
      expect(within(menue).getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('Status: ein Verbrauchsgut kennt weder „verbraucht“ noch „Desinfektion nötig“ (LLH-1224 D3)', async () => {
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const menue = await openStatusmenue(zeile, 'Wolldecke');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['einsatzbereit', 'im Einsatz', 'defekt']);
  });

  it('Mengenzelle eines Verbrauchsguts: der Wert ohne Feld, daneben „Ausgeben“ mit Zeilenname (LLH-1225 D5)', async () => {
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const knopf = within(zeile).getByRole('button', { name: 'Wolldecke ausgeben' });
    expect(knopf).toHaveTextContent(/^Ausgeben$/);
    // Ohne Klein-Angabe: die Höhe folgt der Dichtestufe (`dichte.guard.test.ts`).
    expect(knopf.className).not.toMatch(/ant-btn-sm\b/);
    expect(within(zeile).queryByRole('spinbutton')).toBeNull();
    expect(within(zeile).queryByRole('button', { name: /Menge zu Wolldecke/ })).toBeNull();
  });

  /**
   * Der Weg zum Meldebild von der Pflegefläche. Geprüft wird das `href`: ein Inline-Pfad neben dem
   * Builder wäre sonst nicht zu unterscheiden.
   */
  it('verlinkt das Meldebild (vormals Kräfteübersicht) über der Tabelle', async () => {
    render(einsatzAktiv, [em]);
    const link = await screen.findByRole('link', { name: 'Meldebild' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/kraefteuebersicht');
  });

  it('zeigt disponiertes Material mit Menge als Wert, nicht als offenes Feld', async () => {
    const { container } = render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    // LLH-1093 D9, LLH-1225 D5: in der Zeile nie ein Mengenfeld; die Menge ändert ein Dialog.
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(within(zeile).getByText('50')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('hebt per ?material=<id> den Posten hervor und räumt den Parameter (LLH-1260)', async () => {
    const decke = { ...em, id: 11, bezeichnung: 'Feldbett', einheit_id: 2 };
    const { container } = render(
      einsatzAktiv,
      [em, decke],
      [],
      {},
      '/einsaetze/1/material?material=11',
    );
    await screen.findByText('Feldbett');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="11"]')).toHaveClass('zeile-hervorgehoben'),
    );
    expect(container.querySelector('[data-row-key="10"]')).not.toHaveClass('zeile-hervorgehoben');
    // Apply-then-clean: ein stehender Parameter pinnte die Markierung bei Zurück und Neuladen.
    await waitFor(() => expect(ort.aktuell).not.toContain('material='));
  });

  it('ein unbekannter Posten in ?material= markiert nichts (LLH-1260)', async () => {
    const { container } = render(einsatzAktiv, [em], [], {}, '/einsaetze/1/material?material=99');
    await screen.findByText('Wolldecke');
    await waitFor(() => expect(ort.aktuell).not.toContain('material='));
    expect(container.querySelector('.zeile-hervorgehoben')).toBeNull();
  });

  it('auch im Kartenzweig trägt der angesprungene Posten die Markierung (LLH-1260)', async () => {
    setzeViewportBreite(390);
    const decke = { ...em, id: 11, bezeichnung: 'Feldbett' };
    const { container } = render(
      einsatzAktiv,
      [em, decke],
      [],
      {},
      '/einsaetze/1/material?material=11',
    );
    await screen.findByText('Feldbett');
    expect(container.querySelector('.ant-table'), 'Gegenprobe: keine Tabelle').toBeNull();
    await waitFor(() =>
      expect(
        container.querySelector('[data-lfh="datensicht-karte"].zeile-hervorgehoben'),
      ).toHaveTextContent('Feldbett'),
    );
  });

  it('setzt den Status zeilengenau optimistisch und rollt eine Serverablehnung zurück', async () => {
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    server.use(
      http.patch('/api/einsaetze/1/material/10', async () => {
        await gate;
        return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 });
      }),
    );
    const zweitesMaterial = { ...em, id: 11, bezeichnung: 'Zeltbahn' };
    const { container, client } = render(einsatzAktiv, [em, zweitesMaterial]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    const menue = await openStatusmenue(zeile, 'Wolldecke');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /defekt/ }));

    await waitFor(() => {
      expect(client.getQueryData<(typeof em)[]>(einsatzKeys.material(1))?.[0].status).toBe(
        'defekt',
      );
    });
    // Der neue Wert steht vor der Server-Antwort in der Ansicht, nicht bloß im Cache.
    expect(zeile.textContent).toContain('defekt');
    expect(within(zeile).getByRole('button', { name: /Status von Wolldecke/ })).toBeDisabled();
    expect(
      within(container.querySelector('[data-row-key="11"]') as HTMLElement).getByRole('button', {
        name: /Status von Zeltbahn/,
      }),
    ).toBeDisabled();

    let refetchFreigeben: (() => void) | undefined;
    const refetchGate = new Promise<void>((resolve) => {
      refetchFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/1/material', async () => {
        await refetchGate;
        return HttpResponse.json([{ ...em, bezeichnung: 'Extern geändert' }, zweitesMaterial]);
      }),
    );
    act(() => {
      client.setQueryData<(typeof em)[]>(einsatzKeys.material(1), (aktuell) =>
        aktuell?.map((eintrag) =>
          eintrag.id === 10 ? { ...eintrag, bezeichnung: 'Extern geändert' } : eintrag,
        ),
      );
    });

    await act(async () => {
      freigeben?.();
    });
    await waitFor(() => {
      const stand = client.getQueryData<(typeof em)[]>(einsatzKeys.material(1));
      expect(stand?.find((eintrag) => eintrag.id === 10)?.status).toBe('einsatzbereit');
      expect(stand?.find((eintrag) => eintrag.id === 10)?.bezeichnung).toBe('Extern geändert');
    });
    await act(async () => {
      refetchFreigeben?.();
    });
  });

  it('Einsatzleitung sieht Disponier- und Ad-hoc-Aktionen', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: /^Material/ });
    expect(screen.getByRole('button', { name: 'Material disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Material' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist reine Anzeige', async () => {
    const abgeschlossen = { ...einsatzAktiv, status: 'abgeschlossen' as const };
    render(abgeschlossen, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Material disponieren' })).not.toBeInTheDocument();
    /**
     * Diese Abfrage hält nur, weil das Gruppenetikett ein Textknoten ist (`1 einsatzbereit`) und
     * RTL exakt gegen den normalisierten Text matcht — `'einsatzbereit'` trifft `'1
     * einsatzbereit'` nicht. Wäre der Kopf aus zwei Knoten gebaut, würfe der Test mit Mehrfachtreffern.
     */
    const werkzeuge = document.querySelector<HTMLElement>('[data-lfh="datensicht-werkzeuge"]')!;
    expect(within(werkzeuge).getByText('1 ohne Ort')).toBeInTheDocument();
    // Lesen bleibt: die Gruppierung lässt sich umschalten; bedienen lässt sich nichts.
    expect(screen.getByRole('radio', { name: 'Nach Status' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wolldecke ausgeben' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ort zu Wolldecke/ })).toBeNull();
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^ohne Ort$/);
  });

  // ── Datensicht ──

  /**
   * `EinsatzMaterialAnzeige` hat kein `status_kategorie` — dieselbe Grenze, die `filtereKraefte`
   * zieht. Material gruppiert auf seiner eigenen Fünf-Werte-Achse; erfunden wird kein Feld.
   */
  const emDefekt = {
    ...em,
    id: 11,
    bezeichnung: 'Aluleiter',
    kategorie: 'Technik',
    status: 'defekt',
  };

  it('gruppiert per Vorgabe nach Ort: Einheiten, Fahrzeuge, UHS, BR, „ohne Ort“ zuletzt (LLH-1225 D4)', async () => {
    const { container } = render(einsatzAktiv, [
      { ...em, id: 20, bezeichnung: 'A ohne' },
      { ...em, id: 21, bezeichnung: 'B BR', br_id: 6 },
      { ...em, id: 22, bezeichnung: 'C UHS', uhs_id: 7 },
      { ...em, id: 23, bezeichnung: 'D Fahrzeug', einsatz_fahrzeug_id: 4 },
      { ...em, id: 24, bezeichnung: 'E Staffel B', einheit_id: 2 },
      { ...em, id: 25, bezeichnung: 'F Staffel A', einheit_id: 1 },
    ]);
    await screen.findByText('A ohne');
    expect(screen.getByRole('radio', { name: 'Nach Ort' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('tr.ant-table-row')].map((r) =>
          r.getAttribute('data-row-key'),
        ),
      ).toEqual(['25', '24', '23', '22', '21', '20']),
    );
    const werkzeuge = container.querySelector<HTMLElement>('[data-lfh="datensicht-werkzeuge"]')!;
    for (const gruppe of ['Staffel A', 'Florian 1/83-1', 'UHS Turnhalle', 'BR Nord', 'ohne Ort']) {
      expect(within(werkzeuge).getByText(`1 ${gruppe}`)).toBeInTheDocument();
    }
  });

  it('Einheiten stehen in der Folge des Kräftebaums: der Rang der Abschnitte, nicht die Anlage (D3/D4)', async () => {
    // Staffel B (Abschnitt B) ist zuerst angelegt; Abschnitt A steht im Baum vor B.
    server.use(
      http.get('/api/einsaetze/1/abschnitte', () =>
        HttpResponse.json([
          { id: 32, name: 'Abschnitt A', ueber_abschnitt_id: null },
          { id: 31, name: 'Abschnitt B', ueber_abschnitt_id: null },
        ]),
      ),
    );
    const { container } = render(
      einsatzAktiv,
      [
        { ...em, id: 20, bezeichnung: 'Decke B', einheit_id: 1 },
        { ...em, id: 21, bezeichnung: 'Decke A', einheit_id: 2 },
      ],
      [],
      {
        einheiten: [
          { id: 1, name: 'Staffel B', ueber_einheit_id: null, abschnitt_id: 31 },
          { id: 2, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: 32 },
        ],
      },
    );
    await screen.findByText('Decke A');
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('tr.ant-table-row')].map((r) =>
          r.getAttribute('data-row-key'),
        ),
      ).toEqual(['21', '20']),
    );
    // Dieselbe Folge in der Gruppe „Einheiten“ der Auswahl.
    await userEvent.click(screen.getByRole('button', { name: 'Ort zu Decke A bearbeiten' }));
    await oeffne('Ort zu Decke A');
    const einheiten = [
      ...listeVon('Ort zu Decke A')!.querySelectorAll('.ant-select-item-option'),
    ].map((o) => o.textContent);
    expect(einheiten.indexOf('Staffel A')).toBeLessThan(einheiten.indexOf('Staffel B'));
  });

  it('„Nach Status“ gruppiert um, die Verdichtung bleibt dieselbe', async () => {
    render(einsatzAktiv, [em, { ...emDefekt, einheit_id: 1 }]);
    await screen.findByText('Wolldecke');
    const verdichtung = (await screen.findByTestId('material-verdichtung')).textContent;
    await userEvent.click(screen.getByRole('radio', { name: 'Nach Status' }));
    const werkzeuge = document.querySelector<HTMLElement>('[data-lfh="datensicht-werkzeuge"]')!;
    expect(within(werkzeuge).getByText('1 defekt')).toBeInTheDocument();
    expect(screen.getByTestId('material-verdichtung').textContent).toBe(verdichtung);
  });

  it('ein Einsatzwechsel nimmt die Wahl der Gruppierung nicht mit', async () => {
    server.use(
      http.get('/api/einsaetze/2', () => HttpResponse.json({ ...einsatzAktiv, id: 2 })),
      http.get('/api/einsaetze/2/material', () => HttpResponse.json([])),
      http.get('/api/einsaetze/2/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/2/uhs', () => HttpResponse.json([])),
      http.get('/api/einsaetze/2/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/2/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    await userEvent.click(screen.getByRole('radio', { name: 'Nach Status' }));
    expect(screen.getByRole('radio', { name: 'Nach Status' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('link', { name: 'Zu Einsatz 2' }));
    await screen.findByText('Noch kein Material disponiert');
    expect(screen.getByRole('radio', { name: 'Nach Ort' })).toHaveAttribute('aria-checked', 'true');
  });

  it('gruppiert nach dem eigenen Materialstatus, mit Zähler im Etikett', async () => {
    // Serverordnung [11, 10]; Namensordnung ebenfalls [11 Aluleiter, 10 Wolldecke]; gerendert [10,
    // 11], weil die Statusachse führt (einsatzbereit vor defekt). Die gerenderte Folge ist weder
    // Server- noch Namensordnung.
    const { container } = render(einsatzAktiv, [emDefekt, em]);
    await screen.findByText('Wolldecke');
    await userEvent.click(screen.getByRole('radio', { name: 'Nach Status' }));
    const werkzeuge = container.querySelector<HTMLElement>('[data-lfh="datensicht-werkzeuge"]')!;
    expect(within(werkzeuge).getByText('1 einsatzbereit')).toBeInTheDocument();
    expect(within(werkzeuge).getByText('1 defekt')).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('tr.ant-table-row')].map((r) =>
        r.getAttribute('data-row-key'),
      ),
    ).toEqual(['10', '11']);
  });

  it('der Spaltenschalter lügt nicht: ohne ausgeblendete Spalte trägt er keinen Zähler', async () => {
    /**
     * Das Primitiv zeigt den Spaltenschalter, sobald eine Spalte abwählbar ist. Geprüft wird, dass
     * der Zähler nichts erfindet: ab `xxl` ist keine Spalte abgewählt oder per Breite verborgen →
     * nur „Spalten".
     */
    setzeViewportBreite(1600);
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: /Spalten/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ausgeblendet/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /^Kategorie/ })).toBeInTheDocument();
    // Steht die Spalte, trägt die Bezeichnungszelle die Kategorie nicht ein zweites Mal.
    expect(screen.getAllByText('Betreuung')).toHaveLength(1);
  });

  it('am Fükw weicht die Kategorie, im Zähler und in der Suche (LLH-1093, Prüfliste)', async () => {
    // Mit der Spalte „Ort“ passte die Tabelle bei 1366 px nicht mehr; die lesende Kategorie weicht
    // unter `xxl`, über den Spaltenschalter zurückzuholen. Ebenso der Träger (LLH-1096).
    setzeViewportBreite(1366);
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: /Spalten · 2 ausgeblendet/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Träger/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /^Kategorie/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Ort' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Aktionen' })).toBeInTheDocument();
  });

  it('solange die Kategorie ausgeblendet ist, steht sie als zweite Zeile unter der Bezeichnung', async () => {
    setzeViewportBreite(1366);
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const bezeichnungsZelle = () =>
      container.querySelector<HTMLElement>('tr.ant-table-row td.ant-table-cell')!;
    expect(bezeichnungsZelle()).toHaveTextContent('WolldeckeBetreuung');
    expect(within(bezeichnungsZelle()).getByText('Betreuung')).toHaveClass(
      'ant-typography-secondary',
    );

    // Von Hand zurückgeholt: die Spalte steht, die zweite Zeile weicht.
    await userEvent.click(screen.getByRole('button', { name: /Spalten · 2 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Kategorie' }));
    expect(await screen.findByRole('columnheader', { name: /^Kategorie/ })).toBeInTheDocument();
    expect(bezeichnungsZelle()).not.toHaveTextContent('Betreuung');
    expect(screen.getAllByText('Betreuung')).toHaveLength(1);
  });

  it('die Karte unter md trägt die Kategorie nicht im Titel (design.md D13)', async () => {
    setzeViewportBreite(390);
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).not.toHaveTextContent(
      'Betreuung',
    );
  });

  it('unter md steht der Status als BEDIENBARES Etikett, nicht als Sekundärfeld', async () => {
    setzeViewportBreite(390);
    const { container } = render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
    const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
    expect(karte).not.toBeNull();
    /**
     * Der Status steht im `karte.status`-Slot mit Auslöser: als beschriftetes Sekundärfeld wäre der
     * Statuswechsel, die häufigste Einzelaktion, am schmalen Schirm unerreichbar.
     *
     * Beide Hälften: das Feld ist weg und der Auslöser ist da. Nur die zweite wäre auch grün, wenn
     * der Status doppelt stünde.
     */
    const felder = [...karte.querySelectorAll('[data-lfh="datensicht-feld"]')].map(
      (f) => f.textContent,
    );
    expect(felder.some((t) => t?.startsWith('Status'))).toBe(false);
    expect(
      within(karte).getByRole('button', { name: 'Status von Wolldecke ändern' }),
    ).toBeInTheDocument();
    expect(karte.textContent).toContain('einsatzbereit');
  });

  it('Gegenprobe: ab md steht die Tabelle', async () => {
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });

  it('leere Bemerkung trägt einen sichtbaren, zeilenbenannten Auslöser statt eines Stift-Icons', async () => {
    /**
     * Leeres Bemerkungsfeld: ohne Platzhalter bliebe von `Typography.Text editable` nur das
     * Stift-Icon mit antds Namen „Bearbeiten" — keine sichtbare Aufforderung, und n gleichnamige
     * Knöpfe in einer Liste. Der Name trägt deshalb die Zeilenkennung, hier die Bezeichnung.
     *
     * Geprüft im Tabellenzweig: unter `md` führt keine der `karte.sekundaer`-Listen die Bemerkung,
     * ein Test dort wäre leer grün.
     */
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      within(zeile).getByRole('button', { name: 'Bemerkung zu Wolldecke hinzufügen' }),
    ).toBeInTheDocument();
  });

  it('keine Klein-Variante mehr am Status-Auswahlfeld und am Herausnehmen-Knopf', async () => {
    /**
     * Keine punktuellen Klein-Angaben an den Zeilen-Bedienelementen (Dichte-Regel); den Bestand
     * hält die Schuldmenge in `components/dichte.guard.test.ts`.
     */
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(zeile.querySelector('.ant-select-sm')).toBeNull();
    const knopf = within(zeile).getByRole('button', { name: 'Wolldecke aus dem Einsatz nehmen' });
    expect(knopf).not.toHaveClass('ant-btn-sm');
    // Umkehrbar und doch folgenreich: `danger` mit Abstand statt Rückfrage (LLH-1079, D8).
    expect(knopf).toHaveClass('ant-btn-dangerous');
  });

  /**
   * Aus dem Einsatz nehmen ist umkehrbar (LLH-1079 Teil II, Wortlaut LLH-1093): ein Klick ohne
   * Rückfrage, danach ein Rückgängig-Toast, der dieselbe Position erneut disponiert.
   */
  it('Aus dem Einsatz nehmen fragt nicht nach und bietet Rückgängig an', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.post('/api/einsaetze/1/material/10/entlassen', () => {
        aufrufe.push('entlassen');
        return HttpResponse.json({ ...em, beendet_als: 'entlassen' });
      }),
      http.post('/api/einsaetze/1/material/10/reaktivieren', () => {
        aufrufe.push('reaktivieren');
        return HttpResponse.json(em);
      }),
    );
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await userEvent.click(
      within(zeile).getByRole('button', { name: 'Wolldecke aus dem Einsatz nehmen' }),
    );
    await waitFor(() => expect(aufrufe).toEqual(['entlassen']));
    expect(document.querySelector('.ant-popconfirm:not(.ant-popover-hidden)')).toBeNull();
    expect(await screen.findByText('Wolldecke aus dem Einsatz genommen')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(aufrufe).toEqual(['entlassen', 'reaktivieren']));
  });

  /** Rückgängig aus dem Toast hat keine Zeile mehr: der Grund steht im Seitenhinweis. */
  it('scheitert Rückgängig, steht der Grund im Seitenhinweis', async () => {
    server.use(
      http.post('/api/einsaetze/1/material/10/entlassen', () =>
        HttpResponse.json({ ...em, beendet_als: 'entlassen' }),
      ),
      http.post('/api/einsaetze/1/material/10/reaktivieren', () =>
        HttpResponse.json({ error: 'Material ist außer Dienst' }, { status: 422 }),
      ),
    );
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await userEvent.click(
      within(zeile).getByRole('button', { name: 'Wolldecke aus dem Einsatz nehmen' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    const hinweis = await screen.findByText('Material ist außer Dienst');
    expect(hinweis.closest('[data-lfh="entlassen-block"]')).toBeNull();
    expect(hinweis.closest('.ant-alert')).not.toBeNull();
  });

  /** Stornieren: Zeilenmenü, `<Modal>` mit einem Satz zur Folge; die Ablehnung an der Zeile. */
  it('Stornieren fragt im Dialog nach, die Ablehnung steht an der Zeile', async () => {
    let gesendet = 0;
    server.use(
      http.post('/api/einsaetze/1/material/10/stornieren', () => {
        gesendet += 1;
        return HttpResponse.json(
          {
            error:
              'Stornieren geht nur in den ersten 15 Minuten nach der Disposition; das Material lässt sich aus dem Einsatz nehmen',
          },
          { status: 422 },
        );
      }),
    );
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen zu Wolldecke' }));
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Stornieren' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke stornieren?');
    expect(dialog.querySelector('.ant-modal-body')).toHaveTextContent(
      /^Das Material erscheint danach in keiner Liste und keinem Nachweis\.$/,
    );
    expect(gesendet).toBe(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(await within(zeile).findByRole('alert')).toHaveTextContent(
      'nur in den ersten 15 Minuten',
    );
    expect(gesendet).toBe(1);
  });

  /** Block „Aus dem Einsatz genommen“: eingeklappt unter der Liste, mit „Erneut disponieren“. */
  it('zeigt herausgenommenes Material eingeklappt und disponiert es erneut', async () => {
    let reaktiviert: number | null = null;
    server.use(
      http.post('/api/einsaetze/1/material/:em/reaktivieren', ({ params }) => {
        reaktiviert = Number(params.em);
        return HttpResponse.json(em);
      }),
    );
    const heraus = { ...em, id: 20, bezeichnung: 'Feldbett', menge: 4 };
    render(
      einsatzAktiv,
      [em],
      [{ ...heraus, beendet_at: '2026-05-27 12:00:00', beendet_als: 'entlassen' }],
    );
    const kopf = await screen.findByRole('button', { name: /Aus dem Einsatz genommen \(1\)/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Feldbett')).toBeNull();
    expect(screen.getByText('1 Posten')).toBeInTheDocument();
    await userEvent.click(kopf);
    expect(await screen.findByText(/· ×4/)).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Erneut disponieren: Feldbett' }),
    );
    await waitFor(() => expect(reaktiviert).toBe(20));
  });
});

/**
 * Datenzustände der Materialseite.
 *
 * **Diese Seite hat keinen Katalog-Query.** Der Materialstatus ist das lokale Enum `MaterialStatus`
 * mit fünf Werten — er kommt nicht über die Leitung und kann nicht ausfallen. Ein Banner
 * „Statuskatalog konnte nicht geladen werden" wäre ein erfundener Fehlerfall.
 *
 * Ausfallen können drei Dinge: der **Einsatz** selbst (Seitenrahmen), die **Dispositionsliste** und
 * der **Stamm-Pool**.
 */
describe('MaterialPage · Datenzustände', () => {
  const gruenerBoden = () => [
    meHandler(admin),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/material', () => HttpResponse.json([])),
    // Die Spalte „Ort“ löst Namen über Einheiten und UHS auf.
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  ];

  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Abweichung VORN: der erste passende Handler gewinnt.
    server.use(...abweichungen, ...gruenerBoden());
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
      </Routes>,
      { route: '/einsaetze/1/material' },
    );
  }

  it('gescheiterter Einsatz: der Seitenrahmen bietet den erneuten Abruf an', async () => {
    zeige(http.get('/api/einsaetze/1', () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('gescheiterte Dispositionsliste: Fehler statt Leertext', async () => {
    zeige(http.get('/api/einsaetze/1/material', () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Material disponiert')).not.toBeInTheDocument();
  });

  it('leere Dispositionsliste: Leertext und KEIN Fehler', async () => {
    zeige();
    expect(await screen.findByText('Noch kein Material disponiert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` mit Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale`. Der Ablauf ist der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung; die Zeilen müssen stehen bleiben.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = zeige(http.get('/api/einsaetze/1/material', () => HttpResponse.json([em])));
    await screen.findByText('Wolldecke');

    server.use(
      http.get('/api/einsaetze/1/material', () => new HttpResponse(null, { status: 500 })),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.material(1) });

    expect(await screen.findByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie nicht.
    expect(screen.getByText('Wolldecke')).toBeInTheDocument();
    expect(
      screen.queryByText('Disponiertes Material konnte nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Stamm-Pool: das Auswahlfeld nennt den Ausfall statt „Kein Material im Dienst"', async () => {
    zeige(http.get('/api/material', () => new HttpResponse(null, { status: 500 })));
    await screen.findByText('Noch kein Material disponiert');
    await openMaterialAuswahl();
    expect(
      await screen.findByText('Materialliste konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Kein Material im Dienst')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Kein Material im Dienst"', async () => {
    zeige();
    await screen.findByText('Noch kein Material disponiert');
    await openMaterialAuswahl();
    expect(await screen.findByText('Kein Material im Dienst')).toBeInTheDocument();
    expect(screen.queryByText('Materialliste konnte nicht geladen werden')).not.toBeInTheDocument();
  });
});

/**
 * Ad-hoc-Schnellerfassung. Was die Hülle zusichert (Fokus, Enter, Leeren auf allen Wegen,
 * Ablehnung), prüft `components/Erfassung.test.tsx`. Hier steht nur, was diese Seite entscheidet:
 * das Feldbudget mit dem eingeklappten Rest und der Serienlauf mit seinen Übernahmefeldern.
 */
describe('MaterialPage · Ad-hoc-Schnellerfassung', () => {
  /**
   * Zählt die bedienbaren Felder des Dialogs: Textfelder plus Zahlenfelder (`InputNumber` trägt
   * `role="spinbutton"`). Die Rollen-Abfrage blendet aus, was nicht im Barrierefreiheitsbaum steht
   * — den eingeklappten Bereich: `forceRender` lässt sein Feld im Baum, `CSSMotion` legt ein
   * `display: none` direkt ans Element. Deshalb hält die Zählung auch in jsdom.
   */
  function sichtbareFelder(dialog: HTMLElement): number {
    // Absichtlich breiter als die heute vorhandenen zwei Rollen: ein später ergänztes Auswahl- oder
    // Schaltfeld soll die Vier-Feld-Grenze reißen.
    const rollen = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'radio', 'switch'] as const;
    const felder = new Set<Element>();
    for (const rolle of rollen) {
      for (const el of within(dialog).queryAllByRole(rolle)) {
        // Nur was in einem `Form.Item` steckt, ist ein Feld. „Werte behalten" steuert den
        // Serienlauf und zählt nicht mit.
        const item = el.closest('.ant-form-item');
        if (item) felder.add(item);
      }
    }
    return felder.size;
  }

  async function openAdhoc() {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: /^Material/ });
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Material' }));
    return await screen.findByRole('dialog');
  }

  it('zeigt eingeklappt höchstens vier Felder — das fünfte liegt unter „Weitere Angaben"', async () => {
    const dialog = await openAdhoc();

    // Genau vier, nicht „höchstens vier": eine Obergrenze wäre auch bei drei grün.
    expect(sichtbareFelder(dialog)).toBe(4);
    // Die Bestandsnummer ist im Baum (forceRender → sie geht beim Absenden mit), aber nicht
    // sichtbar. `queryByLabelText` allein fände sie auch eingeklappt und bewiese nichts.
    expect(within(dialog).getByLabelText('Bestandsnummer')).not.toBeVisible();
  });

  it('Aufklappen erhöht die Zahl der sichtbaren Felder', async () => {
    const dialog = await openAdhoc();
    const vorher = sichtbareFelder(dialog);

    // Teiltreffer statt genauem Namen: ältere antd-Fassungen trugen das Zustandssymbol im Namen
    // („collapsed Weitere Angaben").
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));

    // Trägerorganisation, Bestandsnummer und Ort (LLH-1225 D6/D7).
    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(vorher + 3));
    expect(within(dialog).getByRole('button', { name: /Weitere Angaben/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    /**
     * Kein `toBeVisible()` auf dem aufgeklappten Feld: die Aufklapp-Animation beginnt mit `opacity:
     * 0` und endet in jsdom nie, jest-dom hielte das Feld dauerhaft für unsichtbar. Der
     * Barrierefreiheitsbaum kennt keine Deckkraft — die Rollen-Zählung ist das belastbare Maß.
     * Eingeklappt hält `not.toBeVisible()` dagegen: dort liegt `display: none` direkt am Element.
     */
  });

  /**
   * Pinnt den Leitungsvertrag (der Wert kommt hinten an), nicht die `forceRender`-Prop: antd baut
   * einen einmal aufgeklappten Bereich nicht wieder ab. Der Prop-Wächter ist die Existenzprüfung im
   * eingeklappten Zustand.
   */
  it('ein Wert aus dem eingeklappten Bereich geht beim Absenden mit', async () => {
    const gesendet: unknown[] = [];
    const dialog = await openAdhoc();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );

    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Spende-Decken');
    const kopf = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
    await userEvent.click(kopf);
    await userEvent.type(within(dialog).getByLabelText('Bestandsnummer'), 'THW-4711');
    // Wieder zuklappen und dann erst absenden.
    await userEvent.click(kopf);
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'false'));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ adhoc: { bestandsnummer: 'THW-4711' } });
  });

  it('„Speichern und nächste" hält den Dialog offen und behält Kategorie und Trägerorganisation', async () => {
    const gesendet: unknown[] = [];
    const dialog = await openAdhoc();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );

    // Der Schalter steht per Vorgabe aus — ohne ihn gäbe es keine Übernahme.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Spende-Decken');
    await userEvent.type(within(dialog).getByLabelText('Kategorie'), 'Betreuung');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Trägerorganisation'), 'THW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ adhoc: { bezeichnung: 'Spende-Decken' }, menge: 1 });

    // Offen geblieben — der Zähler belegt, dass gespeichert wurde.
    expect(await screen.findByText('Erfasst: 1')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await waitFor(() => expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(within(dialog).getByLabelText('Kategorie')).toHaveValue('Betreuung');
    expect(within(dialog).getByLabelText('Trägerorganisation')).toHaveValue('THW');
    // Die Menge steht wieder auf ihrem Startwert, obwohl sie kein Übernahmefeld ist:
    // `initialValues` wirkt bei jedem Zurücksetzen.
    expect(within(dialog).getByLabelText('Menge')).toHaveValue('1');
  });

  /** LLH-1225 D6: die Art folgt der Menge, bis die Person wählt; gesendet wird, was steht. */
  it('Art: ohne eigene Wahl folgt sie der Menge; gesendet wird die angezeigte Art', async () => {
    const gesendet: unknown[] = [];
    const dialog = await openAdhoc();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );
    const art = (name: string) => within(dialog).getByRole('radio', { name });
    expect(art('Gerät')).toHaveAttribute('aria-checked', 'true');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Sandsäcke');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '200');
    await waitFor(() => expect(art('Verbrauchsgut')).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      adhoc: { bezeichnung: 'Sandsäcke' },
      menge: 200,
      art: 'verbrauchsgut',
    });
  });

  it('Art: eine eigene Wahl bleibt, auch wenn die Menge danach die Vorgabe wechselte', async () => {
    const gesendet: unknown[] = [];
    const dialog = await openAdhoc();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );
    const art = (name: string) => within(dialog).getByRole('radio', { name });
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Verbandkasten');
    // Bei Menge 1 wäre die Vorgabe „Gerät“; die Person wählt „Verbrauchsgut“.
    await userEvent.click(art('Verbrauchsgut'));
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');
    await userEvent.clear(menge);
    await userEvent.type(menge, '1');
    expect(art('Verbrauchsgut')).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ menge: 1, art: 'verbrauchsgut' });
  });

  it('Art: „Gerät“ setzt die Menge auf 1 und sperrt sie', async () => {
    const gesendet: unknown[] = [];
    const dialog = await openAdhoc();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Stromerzeuger');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Gerät' }));
    await waitFor(() => expect(menge).toHaveValue('1'));
    expect(menge).toBeDisabled();
    expect(within(dialog).getByText('Ein Gerät steht je Stück im Einsatz')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ menge: 1, art: 'geraet' });
  });

  it('Ort unter „Weitere Angaben“ geht als Ort-Feld des POST mit (LLH-1225 D7)', async () => {
    const gesendet: unknown[] = [];
    const dialog = await openAdhoc();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Spende-Decken');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await selectInDialog(dialog, 'Ort', 'UHS Turnhalle');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ uhs_id: 7 });
  });

  it('der Primär-Knopf heißt „Disponieren" und schließt den Dialog', async () => {
    const dialog = await openAdhoc();
    const treffer: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        treffer.push(await request.json());
        return HttpResponse.json({ ...em, id: 99, ist_adhoc: true });
      }),
    );

    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Spende-Decken');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(treffer).toHaveLength(1));

    /**
     * `queryByRole('dialog')).toBeNull()` wäre nie grün: jsdom feuert kein `transitionend`, und
     * antds Modal räumt seinen Knoten erst am Ende der Zoom-Animation ab. Beobachtbar ist der
     * Verlassen-Zustand (`ant-zoom-leave`) — er belegt, dass `onFertig` den Dialog geschlossen hat.
     */
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));
  });
});

/** Öffnet den Disponier-Dialog über den Kopfknopf und darin die Materialauswahl. */
async function openMaterialAuswahl() {
  await userEvent.click(screen.getByRole('button', { name: 'Material disponieren' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Material' }));
}

/**
 * LFH-733 (Spec `demo-daten`): Demo-Material bleibt in der Stamm-Auswahl, steht aber gesammelt in
 * der Gruppe „Demo-Daten“ hinter allem echten Material; disponiertes Demo-Material trägt die
 * Marke „Demo“ in der Tabelle.
 */
describe('MaterialPage · Demo-Marke', () => {
  const stamm = (id: number, bezeichnung: string, ist_demo: boolean) => ({
    id,
    bezeichnung,
    kategorie: 'Betreuung',
    bestandsnummer: null,
    traegerorganisation: null,
    standort: null,
    bemerkung: null,
    dienststatus: 'in_dienst',
    angelegt_at: '2026-05-26 09:00:00',
    ist_demo,
  });

  function zeige(ems: unknown[], pool: ReturnType<typeof stamm>[]) {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/material', () => HttpResponse.json(ems)),
      http.get('/api/material', () => HttpResponse.json(pool)),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    );
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
      </Routes>,
      { route: '/einsaetze/1/material' },
    );
  }

  it('Auswahl: echtes Material vorn, die Gruppe „Demo-Daten“ dahinter, Demo wählbar', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 30, material_id: 2, ist_demo: true });
      }),
    );
    zeige([], [stamm(2, 'Demo-Decke', true), stamm(1, 'Echte Decke', false)]);
    await screen.findByText('Noch kein Material disponiert');
    await openMaterialAuswahl();
    await screen.findByText('Echte Decke (Betreuung)');
    const eintraege = [
      ...document.querySelectorAll<HTMLElement>('.ant-select-dropdown .ant-select-item'),
    ].map((e) => e.textContent);
    expect(eintraege).toEqual([
      'Echte Decke (Betreuung)',
      'Demo-Daten',
      'Demo-Decke (Betreuung)Demo',
    ]);

    await userEvent.click(screen.getByText('Demo-Decke (Betreuung)'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Disponieren' }),
    );
    await waitFor(() => expect(gesendet).toEqual([{ material_id: 2, menge: 1 }]));
  });

  it('Tabelle: nur die Demo-Disposition trägt „Demo“', async () => {
    zeige(
      [
        { ...em, id: 10, material_id: 1, bezeichnung: 'Echte Decke', ist_demo: false },
        { ...em, id: 11, material_id: 2, bezeichnung: 'Demo-Decke', ist_demo: true },
      ],
      [],
    );
    const demoZeile = (await screen.findByText('Demo-Decke')).closest('tr')!;
    const echteZeile = screen.getByText('Echte Decke').closest('tr')!;
    expect(within(demoZeile).getByText('Demo')).toBeInTheDocument();
    expect(within(echteZeile).queryByText('Demo')).not.toBeInTheDocument();
  });
});

/**
 * LFH-983: Der Kopf öffnet nur, disponiert wird im Dialog. Jedes Mengenfeld hat einen Namen, und
 * die englischen Stufentexte von rc-input-number stehen nirgends im DOM.
 */
describe('MaterialPage · Disponieren im Dialog (LFH-983)', () => {
  const pool = [
    {
      id: 5,
      bezeichnung: 'Wolldecke',
      kategorie: 'Betreuung',
      bestandsnummer: null,
      traegerorganisation: null,
      standort: null,
      bemerkung: null,
      dienststatus: 'in_dienst',
      angelegt_at: '2026-05-26 09:00:00',
      ist_demo: false,
      art: 'verbrauchsgut',
    },
    {
      id: 6,
      bezeichnung: 'Trage',
      kategorie: 'Sanität',
      bestandsnummer: 'T-1',
      traegerorganisation: null,
      standort: null,
      bemerkung: null,
      dienststatus: 'in_dienst',
      angelegt_at: '2026-05-26 09:00:00',
      ist_demo: false,
      art: 'geraet',
    },
  ];

  function zeige(ems: (typeof em)[] = []) {
    const gesendet: unknown[] = [];
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/material', () => HttpResponse.json(ems)),
      http.get('/api/material', () => HttpResponse.json(pool)),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(UHS)),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(EINHEITEN)),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, id: 40 });
      }),
    );
    const ergebnis = renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
      </Routes>,
      { route: '/einsaetze/1/material' },
    );
    return { ...ergebnis, gesendet };
  }

  function kopf(container: HTMLElement): HTMLElement {
    const k = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
    if (!k) throw new Error('Seitenkopf-Aktionen fehlen');
    return k;
  }

  it('der Kopf trägt Knöpfe, kein Auswahl- und kein Mengenfeld', async () => {
    const { container } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    expect(within(kopf(container)).queryByRole('combobox')).toBeNull();
    expect(within(kopf(container)).queryByRole('spinbutton')).toBeNull();
    expect(
      within(kopf(container))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Material disponieren', 'Ad-hoc-Material']);
  });

  it('der Dialog hat Material und Menge, den Absende-Knopf im Formular', async () => {
    zeige();
    await screen.findByText('Noch kein Material disponiert');
    await userEvent.click(screen.getByRole('button', { name: 'Material disponieren' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Material' })).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: 'Menge' })).toHaveValue('1');
    // Ein `Select` schluckt Enter (`frontend/AGENTS.md`, Erfassungs-Norm): der Knopf muss im Formular stehen.
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('ohne Material meldet die Prüfung den Grund und sendet nichts', async () => {
    const { gesendet } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    await userEvent.click(screen.getByRole('button', { name: 'Material disponieren' }));
    const dialog = await screen.findByRole('dialog');
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    expect(knopf).toBeEnabled();
    await userEvent.click(knopf);
    expect(await within(dialog).findByText('Material wählen')).toBeInTheDocument();
    expect(gesendet).toEqual([]);
  });

  it('sendet Material und Menge aus dem Dialog', async () => {
    const { gesendet } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    await openMaterialAuswahl();
    await userEvent.click(await screen.findByText('Wolldecke (Betreuung)'));
    const dialog = screen.getByRole('dialog');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(gesendet).toEqual([{ material_id: 5, menge: 3 }]));
  });

  it('ein Gerät steht je Stück im Einsatz: die Menge bleibt 1 und gesperrt (LLH-1224 D2)', async () => {
    const { gesendet } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    await openMaterialAuswahl();
    await userEvent.click(await screen.findByText('Wolldecke (Betreuung)'));
    const dialog = screen.getByRole('dialog');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Material' }));
    await userEvent.click(await screen.findByText('Trage (Sanität)'));
    await waitFor(() => expect(menge).toHaveValue('1'));
    expect(menge).toBeDisabled();
    expect(within(dialog).getByText('Ein Gerät steht je Stück im Einsatz')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(gesendet).toEqual([{ material_id: 6, menge: 1 }]));
  });

  it('der Ort ist das dritte Feld, geht als Ort-Feld mit und bleibt im Serienlauf stehen (LLH-1225 D7)', async () => {
    const { gesendet } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    await openMaterialAuswahl();
    await userEvent.click(await screen.findByText('Wolldecke (Betreuung)'));
    const dialog = screen.getByRole('dialog');
    const felder = [...dialog.querySelectorAll('.ant-form-item-label label')].map(
      (l) => l.textContent,
    );
    expect(felder.slice(0, 3)).toEqual(['Material', 'Menge', 'Ort']);
    await selectInDialog(dialog, 'Ort', 'UHS Turnhalle');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(gesendet).toEqual([{ material_id: 5, menge: 1, uhs_id: 7 }]));
    // Die nächste Position der Anlieferung geht an denselben Ort.
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: 'Ort' }).closest('.ant-select'),
      ).toHaveTextContent('UHS Turnhalle'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Material disponieren' }));
    const neu = await screen.findByRole('dialog');
    expect(
      within(neu).getByRole('combobox', { name: 'Ort' }).closest('.ant-select'),
    ).toHaveTextContent('ohne Ort');
  });

  /**
   * LLH-1256 (Spec `material-modell`, „Gerät mit Bestandsnummer einmal im Einsatz“): die Trage mit
   * Bestandsnummer steht schon aktiv im Einsatz, also ist sie in der Auswahl gesperrt und nennt den
   * Grund; die Wolldecke (Verbrauchsgut) daneben bleibt wählbar, auch wenn sie schon disponiert ist.
   */
  it('ein schon aktives Gerät mit Bestandsnummer ist gesperrt und nennt den Grund', async () => {
    const trage = {
      ...em,
      id: 11,
      material_id: 6,
      bezeichnung: 'Trage',
      kategorie: 'Sanität',
      bestandsnummer: 'T-1',
      menge: 1,
      art: 'geraet',
    };
    zeige([em, trage]);
    await screen.findByText('Trage');
    await openMaterialAuswahl();
    const gesperrt = await screen.findByRole('option', {
      name: 'Trage (Sanität) · schon im Einsatz',
    });
    expect(gesperrt).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Wolldecke (Betreuung)' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('das Mengenfeld im Dialog nennt sich; keine englischen Stufentexte auf der Seite', async () => {
    zeige([em]);
    await screen.findByText('Wolldecke');
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen zu Wolldecke' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Menge ändern …' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('spinbutton', { name: 'Menge' })).toHaveValue('50'),
    );
    expect(document.body.innerHTML).not.toMatch(/Increase Value|Decrease Value/);
  });
});

/**
 * Wählt in einer Auswahl IM Dialog: beide Disponier-Dialoge tragen ein Feld „Ort“, und antd hält
 * den geschlossenen Dialog im Baum.
 */
async function selectInDialog(dialog: HTMLElement, feld: string, option: string) {
  const eingabe = within(dialog).getByRole('combobox', { name: feld });
  await userEvent.click(eingabe);
  const liste = await waitFor(() => {
    const l = document
      .getElementById(eingabe.getAttribute('aria-controls') ?? '')
      ?.closest<HTMLElement>('.ant-select-dropdown');
    expect(l).toBeTruthy();
    return l!;
  });
  const knoten = await waitFor(() => {
    const k = liste.querySelector<HTMLElement>(`.ant-select-item-option[title="${option}"]`);
    expect(k).toBeTruthy();
    return k!;
  });
  await userEvent.click(knoten);
}

/** Öffnet das Zeilenmenü einer Position und liefert das offene Menü. */
async function openZeilenmenue(bezeichnung: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Weitere Aktionen zu ${bezeichnung}` }));
  // Das zuletzt geöffnete: in jsdom endet die Schließanimation eines vorigen Menüs nie.
  const offen = document.querySelectorAll<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
  const menue = offen[offen.length - 1];
  if (!menue) throw new Error(`Zeilenmenü zu ${bezeichnung} ließ sich nicht öffnen`);
  return menue;
}

/** LLH-1093: Materialliste mit Ort, Menge mit Speichern, Verdichtung und Zeilenaktionen. */
describe('MaterialPage · Materialliste (LLH-1093)', () => {
  it('über der Liste steht die Materialverdichtung, keine Stärke; im Kopf „n Posten“', async () => {
    const { container } = render(einsatzAktiv, [
      em,
      { ...em, id: 11, bezeichnung: 'Zeltbahn', status: 'im_einsatz' },
      { ...em, id: 12, bezeichnung: 'Trage', status: 'defekt' },
      { ...em, id: 13, bezeichnung: 'Decke', status: 'desinfektion_noetig' },
    ]);
    const zeile = await screen.findByTestId('material-verdichtung');
    expect(zeile).toHaveTextContent('1 einsatzbereit·1 im Einsatz·2 Ausfall');
    expect(container.textContent).not.toMatch(/Stärke|Fzg \d/);
    expect(screen.getByText('4 Posten')).toBeInTheDocument();
  });

  it('„Ausgeben“: der Dialog nimmt die Menge, die Zeile zeigt den Rest, der Toast nennt sie (LLH-1225 D5)', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, ausgegeben: 20 });
      }),
    );
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    await userEvent.click(screen.getByRole('button', { name: 'Wolldecke ausgeben' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '20');
    expect(within(dialog).getByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 30 von 50 übrig',
    );
    server.use(
      http.get('/api/einsaetze/1/material', () => HttpResponse.json([{ ...em, ausgegeben: 20 }])),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    await waitFor(() => expect(gesendet).toEqual([{ ausgegeben: 20 }]));
    expect(await screen.findByText('Wolldecke: 20 ausgegeben')).toBeInTheDocument();
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await waitFor(() => expect(within(zeile).getByText('30 von 50 übrig')).toBeInTheDocument());
  });

  it('„Ausgabe zurücknehmen …“ sendet den Stand minus n', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, ausgegeben: 15 });
      }),
    );
    render(einsatzAktiv, [{ ...em, ausgegeben: 20 }]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Ausgabe zurücknehmen …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Menge zurücknehmen' }),
      '5',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    await waitFor(() => expect(gesendet).toEqual([{ ausgegeben: 15 }]));
    expect(await screen.findByText('Wolldecke: 5 zurückgenommen')).toBeInTheDocument();
  });

  it('„Menge ändern …“ sendet die neue Gesamtmenge erst mit „Speichern“', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...em, menge: 80 });
      }),
    );
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Menge ändern …' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(feld).toHaveValue('50'));
    await userEvent.clear(feld);
    await userEvent.type(feld, '80');
    expect(gesendet).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(gesendet).toEqual([{ menge: 80 }]));
  });

  it('Ort: ein Posten liegt an genau einem Ort (LLH-1224 D6)', async () => {
    const { container } = render(einsatzAktiv, [
      { ...em, einheit_id: 1 },
      { ...em, id: 11, bezeichnung: 'Zeltbahn', uhs_id: 7 },
    ]);
    await screen.findByText('Wolldecke');
    const ort = (id: number) =>
      within(container.querySelector(`[data-row-key="${id}"]`) as HTMLElement).getByTestId(
        'material-ort',
      );
    await waitFor(() => expect(ort(10)).toHaveTextContent('Staffel A'));
    expect(ort(10)).not.toHaveTextContent('Turnhalle');
    await waitFor(() => expect(ort(11)).toHaveTextContent('UHS Turnhalle'));
    expect(ort(11)).not.toHaveTextContent('Staffel');
  });

  it('Ort: Fahrzeug und Bereitstellungsraum stehen mit Namen, ohne Ort heißt „ohne Ort“', async () => {
    server.use(
      http.get('/api/einsaetze/1/fahrzeuge', () =>
        HttpResponse.json([{ id: 4, funkrufname: 'Florian 1/83-1' }]),
      ),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([{ id: 6, bezeichnung: 'BR Nord' }]),
      ),
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json({
          ...freigabenFixture(),
          einheiten: { sichtbar: true, zugriff: false },
          unfallhilfsstellen: { sichtbar: true, zugriff: false },
        }),
      ),
    );
    const abrufe = countRequests();
    const { container } = render(einsatzAktiv, [
      { ...em, einsatz_fahrzeug_id: 4 },
      { ...em, id: 11, bezeichnung: 'Zeltbahn', br_id: 6 },
      { ...em, id: 12, bezeichnung: 'Kanister' },
    ]);
    await screen.findByText('Wolldecke');
    const ort = (id: number) =>
      within(container.querySelector(`[data-row-key="${id}"]`) as HTMLElement).getByTestId(
        'material-ort',
      );
    await waitFor(() => expect(ort(10)).toHaveTextContent(/^Florian 1\/83-1$/));
    await waitFor(() => expect(ort(11)).toHaveTextContent(/^BR Nord$/));
    expect(ort(12)).toHaveTextContent(/^ohne Ort$/);
    // Gesperrte Ortsarten erzeugen keinen Abruf (D3), die freien je einen.
    expect(abrufe('/api/einsaetze/1/einheiten')).toBe(0);
    expect(abrufe('/api/einsaetze/1/abschnitte')).toBe(0);
    expect(abrufe('/api/einsaetze/1/uhs')).toBe(0);
    expect(abrufe('/api/einsaetze/1/fahrzeuge')).toBeGreaterThan(0);
    expect(abrufe('/api/einsaetze/1/bereitstellungsraeume')).toBeGreaterThan(0);
  });

  it('Ort: ohne Zugriff auf Fahrzeuge und Bereitstellungsräume kein Abruf, auch mit Posten dort', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json({
          ...freigabenFixture(),
          fahrzeuge: { sichtbar: true, zugriff: false },
          bereitstellungsraeume: { sichtbar: true, zugriff: false },
        }),
      ),
    );
    const abrufe = countRequests();
    const { container } = render(einsatzAktiv, [
      { ...em, einsatz_fahrzeug_id: 4 },
      { ...em, id: 11, bezeichnung: 'Zeltbahn', br_id: 6 },
    ]);
    await screen.findByText('Wolldecke');
    const ort = (id: number) =>
      within(container.querySelector(`[data-row-key="${id}"]`) as HTMLElement).getByTestId(
        'material-ort',
      );
    await waitFor(() => expect(abrufe('/api/einsaetze/1/einheiten')).toBeGreaterThan(0));
    expect(abrufe('/api/einsaetze/1/uhs')).toBeGreaterThan(0);
    expect(ort(10)).toHaveTextContent(/zugeordnet/);
    expect(ort(11)).toHaveTextContent(/zugeordnet/);
    expect(abrufe('/api/einsaetze/1/fahrzeuge')).toBe(0);
    expect(abrufe('/api/einsaetze/1/bereitstellungsraeume')).toBe(0);
  });

  it('Ort: Umhängen geht in EINER Anfrage über die Disposition, nie über die Einheiten (LLH-1225 D2)', async () => {
    const aufrufe: unknown[] = [];
    server.use(
      http.put('/api/einsaetze/1/einheiten/:eid/material/10', () => {
        aufrufe.push('PUT Einheit');
        return new HttpResponse(null, { status: 204 });
      }),
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        aufrufe.push(await request.json());
        return HttpResponse.json(em);
      }),
    );
    render(einsatzAktiv, [{ ...em, einheit_id: 1 }]);
    await screen.findByText('Wolldecke');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ort zu Wolldecke bearbeiten' }),
    );
    await waehle('Ort zu Wolldecke', 'UHS Turnhalle');
    await userEvent.click(screen.getByRole('button', { name: 'Ort zu Wolldecke speichern' }));
    await waitFor(() => expect(aufrufe).toEqual([{ uhs_id: 7 }]));
  });

  it('Ort: „ohne Ort“ löst über das Feld des bisherigen Orts', async () => {
    const aufrufe: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        aufrufe.push(await request.json());
        return HttpResponse.json(em);
      }),
    );
    render(einsatzAktiv, [{ ...em, einsatz_fahrzeug_id: 4 }]);
    await screen.findByText('Wolldecke');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ort zu Wolldecke bearbeiten' }),
    );
    await waehle('Ort zu Wolldecke', 'ohne Ort');
    await userEvent.click(screen.getByRole('button', { name: 'Ort zu Wolldecke speichern' }));
    await waitFor(() => expect(aufrufe).toEqual([{ einsatz_fahrzeug_id: null }]));
  });

  it('Ort: ohne Zugriff auf Einheiten steht „zugeordnet“; die Angabe bleibt bedienbar, ohne Einheiten', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json({
          ...freigabenFixture(),
          einheiten: { sichtbar: true, zugriff: false },
        }),
      ),
    );
    const abrufe = countRequests();
    const { container } = render(einsatzAktiv, [{ ...em, einheit_id: 1 }]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const knopf = await within(zeile).findByRole('button', { name: 'Ort zu Wolldecke bearbeiten' });
    await waitFor(() => expect(knopf).toHaveTextContent(/^zugeordnet$/));
    await waitFor(() => expect(abrufe('/api/einsaetze/1/uhs')).toBeGreaterThan(0));
    expect(abrufe('/api/einsaetze/1/einheiten')).toBe(0);
    expect(abrufe('/api/einsaetze/1/abschnitte')).toBe(0);
    await userEvent.click(knopf);
    await oeffne('Ort zu Wolldecke');
    const gruppen = [
      ...listeVon('Ort zu Wolldecke')!.querySelectorAll('.ant-select-item-group'),
    ].map((g) => g.textContent);
    expect(gruppen).not.toContain('Einheiten');
    expect(gruppen).toContain('Unfallhilfsstellen');
  });

  it('Karte (390 px): Ort und Menge als Sekundärfelder, die Kategorie nicht', async () => {
    setzeViewportBreite(390);
    const { container } = render(einsatzAktiv, [{ ...em, einheit_id: 1 }]);
    await screen.findByText('Wolldecke');
    const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
    const felder = [...karte.querySelectorAll('[data-lfh="datensicht-feld"]')].map(
      (f) => f.textContent ?? '',
    );
    expect(felder.some((t) => t.startsWith('Ort'))).toBe(true);
    expect(felder.some((t) => t.startsWith('Menge'))).toBe(true);
    expect(felder.some((t) => t.startsWith('Kategorie'))).toBe(false);
    // „Ausgeben“ kommt mit der Mengenzelle auf die Karte (LLH-1225 D5).
    expect(within(karte).getByRole('button', { name: 'Wolldecke ausgeben' })).toBeEnabled();
  });

  it('Zeilenmenü eines Stamm-Postens: „Angaben ändern · im Stamm pflegen“ gesperrt', async () => {
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    const eintraege = within(menue).getAllByRole('menuitem');
    // Ein Stamm-Verbrauchsgut ohne Ausgabe (LLH-1225 D6); die Art trägt der Stamm.
    expect(eintraege.map((e) => e.textContent)).toEqual([
      'Menge ändern …',
      'Ausgabe zurücknehmen · nichts ausgegeben',
      'Aufteilen …',
      'Angaben ändern · im Stamm pflegen',
      'Stornieren',
    ]);
    expect(eintraege.map((e) => e.getAttribute('aria-disabled') === 'true')).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    // Stornieren rot hinter dem Trenner.
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
    expect(eintraege[4]).toHaveClass('ant-dropdown-menu-item-danger');
  });

  it('Zeilenmenü eines zugeordneten Postens: „Stornieren · zugeordnet“ gesperrt, weiter rot', async () => {
    render(einsatzAktiv, [
      { ...em, einheit_id: 1 },
      { ...em, id: 11, bezeichnung: 'Zeltbahn', uhs_id: 7 },
    ]);
    await screen.findByText('Wolldecke');
    for (const name of ['Wolldecke', 'Zeltbahn']) {
      const menue = await openZeilenmenue(name);
      const stornieren = within(menue).getByRole('menuitem', { name: 'Stornieren · zugeordnet' });
      expect(stornieren).toHaveAttribute('aria-disabled', 'true');
      expect(stornieren).toHaveClass('ant-dropdown-menu-item-danger');
      await userEvent.keyboard('{Escape}');
    }
  });

  it('Zeile eines Geräts: Menge „1“ ohne Bedienung, das Menü ohne Mengeneinträge (LLH-1225 D6)', async () => {
    const { container } = render(einsatzAktiv, [
      { ...em, bezeichnung: 'Trage', art: 'geraet', menge: 1 },
    ]);
    await screen.findByText('Trage');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(within(zeile).getByText('1')).toBeInTheDocument();
    expect(within(zeile).queryByRole('button', { name: 'Trage ausgeben' })).toBeNull();
    const menue = await openZeilenmenue('Trage');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Angaben ändern · im Stamm pflegen', 'Stornieren']);
  });

  it('Ausgabe: der Rest steht an der Menge, ganz ausgegeben heißt der Posten „aufgebraucht“ (D4/D15)', async () => {
    const { container } = render(einsatzAktiv, [
      { ...em, ausgegeben: 20 },
      { ...em, id: 11, bezeichnung: 'Zeltbahn', ausgegeben: 50 },
    ]);
    await screen.findByText('Wolldecke');
    const zeile = (id: number) => container.querySelector(`[data-row-key="${id}"]`) as HTMLElement;
    expect(within(zeile(10)).getByText('30 von 50 übrig')).toBeInTheDocument();
    expect(within(zeile(11)).getByText('0 von 50 übrig')).toBeInTheDocument();
    expect(
      within(zeile(11)).getByRole('button', { name: 'Status von Zeltbahn ändern' }),
    ).toHaveTextContent('aufgebraucht');
    expect(
      within(zeile(10)).getByRole('button', { name: 'Status von Wolldecke ändern' }),
    ).toHaveTextContent('einsatzbereit');
    // „Ausgeben“ nur, solange ein Rest bleibt.
    expect(within(zeile(10)).getByRole('button', { name: 'Wolldecke ausgeben' })).toBeEnabled();
    expect(within(zeile(11)).queryByRole('button', { name: 'Zeltbahn ausgeben' })).toBeNull();
    const menue = await openZeilenmenue('Zeltbahn');
    expect(
      within(menue).getByRole('menuitem', { name: 'Aufteilen · aufgebraucht' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(menue).getByRole('menuitem', { name: 'Ausgabe zurücknehmen …' }),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('Zeilenmenü eines Ad-hoc-Verbrauchsguts mit Menge 1: „Aufteilen · Rest 1“, „Als Gerät führen“', async () => {
    render(einsatzAktiv, [{ ...em, ist_adhoc: true, material_id: null, menge: 1 } as never]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual([
      'Menge ändern …',
      'Ausgabe zurücknehmen · nichts ausgegeben',
      'Aufteilen · Rest 1',
      'Als Gerät führen',
      'Angaben ändern …',
      'Stornieren',
    ]);
    expect(within(menue).getByRole('menuitem', { name: 'Aufteilen · Rest 1' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menue).getByRole('menuitem', { name: 'Als Gerät führen' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('Art wechseln ist gesperrt mit Grund, wo der Server ablehnte (LLH-1225 D6)', async () => {
    const adhoc = { ...em, ist_adhoc: true, material_id: null };
    render(einsatzAktiv, [
      // Menge 2 ist die Grenze: schon eins mehr als ein Gerät trägt.
      { ...adhoc, id: 10, bezeichnung: 'Decken', menge: 2, ausgegeben: 0 },
      { ...adhoc, id: 11, bezeichnung: 'Kanister', menge: 1, ausgegeben: 1 },
      { ...adhoc, id: 12, bezeichnung: 'Pumpe', art: 'geraet', menge: 1, status: 'verbraucht' },
      {
        ...adhoc,
        id: 13,
        bezeichnung: 'Trage',
        art: 'geraet',
        menge: 1,
        status: 'desinfektion_noetig',
      },
    ] as never);
    await screen.findByText('Decken');
    for (const [name, eintrag] of [
      ['Decken', 'Als Gerät führen · Menge über 1'],
      ['Kanister', 'Als Gerät führen · Ausgabe gebucht'],
      ['Pumpe', 'Als Verbrauchsgut führen · Status verbraucht'],
      ['Trage', 'Als Verbrauchsgut führen · Status Desinfektion nötig'],
    ]) {
      const menue = await openZeilenmenue(name);
      expect(within(menue).getByRole('menuitem', { name: eintrag })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await userEvent.keyboard('{Escape}');
    }
  });

  it('„Angaben ändern“ eines Ad-hoc-Postens schickt die geänderte Bezeichnung', async () => {
    const gesendet: unknown[] = [];
    const adhoc = { ...em, ist_adhoc: true, material_id: null, bezeichnung: 'Feldbeten' };
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...adhoc, bezeichnung: 'Feldbetten' });
      }),
    );
    render(einsatzAktiv, [adhoc as never]);
    await screen.findByText('Feldbeten');
    const menue = await openZeilenmenue('Feldbeten');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Angaben ändern …' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Bezeichnung');
    await waitFor(() => expect(feld).toHaveValue('Feldbeten'));
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Feldbetten');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(gesendet).toEqual([{ bezeichnung: 'Feldbetten' }]));
  });

  /**
   * LLH-1225 D6 (ersetzt „Art ändern …“ aus LLH-1224): ein Ad-hoc-Posten mit Menge 1 entsteht als
   * Gerät; „Als Verbrauchsgut führen“ wechselt die Art ohne Rückfrage, danach bietet die Zeile
   * „Ausgeben“ und „Menge ändern …“. Ein Stamm-Posten hat den Eintrag nicht.
   */
  it('„Als Verbrauchsgut führen“ eines Ad-hoc-Geräts schickt nur die Art', async () => {
    const gesendet: unknown[] = [];
    const adhoc = {
      ...em,
      ist_adhoc: true,
      material_id: null,
      bezeichnung: 'Sandsack',
      art: 'geraet',
      menge: 1,
    };
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...adhoc, art: 'verbrauchsgut' });
      }),
    );
    const { container } = render(einsatzAktiv, [adhoc as never]);
    await screen.findByText('Sandsack');
    const menue = await openZeilenmenue('Sandsack');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Als Verbrauchsgut führen', 'Angaben ändern …', 'Stornieren']);
    server.use(
      http.get('/api/einsaetze/1/material', () =>
        HttpResponse.json([{ ...adhoc, art: 'verbrauchsgut' }]),
      ),
    );
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: 'Als Verbrauchsgut führen' }),
    );
    await waitFor(() => expect(gesendet).toEqual([{ art: 'verbrauchsgut' }]));
    // Kein Dialog: der Rückweg ist „Als Gerät führen“.
    expect(screen.queryByRole('dialog')).toBeNull();
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      await within(zeile).findByRole('button', { name: 'Sandsack ausgeben' }),
    ).toBeInTheDocument();
  });

  it('eine Ablehnung des Artwechsels steht an der Zeile', async () => {
    const adhoc = { ...em, ist_adhoc: true, material_id: null, art: 'geraet', menge: 1 };
    server.use(
      http.patch('/api/einsaetze/1/material/10', () =>
        HttpResponse.json({ error: 'Art passt nicht zum Status' }, { status: 422 }),
      ),
    );
    const { container } = render(einsatzAktiv, [adhoc as never]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: 'Als Verbrauchsgut führen' }),
    );
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(await within(zeile).findByRole('alert')).toHaveTextContent('Art passt nicht zum Status');
  });

  it('„Aufteilen“ schickt die abgeteilte Menge an den eigenen Weg', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/material/10/aufteilen', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json([
          { ...em, menge: 30 },
          { ...em, id: 11, menge: 20 },
        ]);
      }),
    );
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Aufteilen …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    expect(within(dialog).getByTestId('aufteilen-danach')).toHaveTextContent('Danach 30 + 20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(gesendet).toEqual([{ menge: 20 }]));
  });

  it('„Aufteilen“ bringt 20 von 50 in einem Schritt an die UHS (t1hvaqzu, design.md D5)', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/material/10/aufteilen', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json([
          { ...em, einheit_id: 1, menge: 30 },
          { ...em, id: 11, menge: 20, uhs_id: 7 },
        ]);
      }),
    );
    render(einsatzAktiv, [{ ...em, einheit_id: 1 }]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Aufteilen …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    // Das Feld „Ort“ des Dialogs; die Seite trägt weitere Felder dieses Namens (Filter der Spalte).
    const ort = within(dialog).getByRole('combobox', { name: 'Ort' });
    await userEvent.click(ort);
    const liste = await waitFor(() => {
      const l = document.getElementById(ort.getAttribute('aria-controls') ?? '');
      expect(l).not.toBeNull();
      return l!.closest<HTMLElement>('.ant-select-dropdown')!;
    });
    await userEvent.click(
      await waitFor(() => {
        const k = liste.querySelector<HTMLElement>(
          '.ant-select-item-option[title="UHS Turnhalle"]',
        );
        expect(k).toBeTruthy();
        return k!;
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    await waitFor(() => expect(gesendet).toEqual([{ menge: 20, uhs_id: 7 }]));
  });

  /**
   * Der Dialog hält seinen Posten (`frontend/AGENTS.md`, „Rückwege und Fehler“): nimmt ein anderer
   * Platz die Zeile live heraus, schließt er nicht, und die Ablehnung des Servers steht an ihm.
   */
  it('„Aufteilen“ bleibt offen, wenn die Zeile live entfällt, und trägt die 409', async () => {
    server.use(
      http.post('/api/einsaetze/1/material/10/aufteilen', () =>
        HttpResponse.json({ error: 'Material ist nicht mehr im Einsatz' }, { status: 409 }),
      ),
    );
    const { client } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const menue = await openZeilenmenue('Wolldecke');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Aufteilen …' }));
    const dialog = await screen.findByRole('dialog');
    server.use(http.get('/api/einsaetze/1/material', () => HttpResponse.json([])));
    act(() => {
      client.setQueryData<(typeof em)[]>(einsatzKeys.material(1), []);
    });
    await waitFor(() => expect(document.querySelector('[data-row-key="10"]')).toBeNull());
    expect(dialog).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge abteilen' }), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufteilen' }));
    expect(await within(dialog).findByText(/nicht mehr im Einsatz/)).toBeInTheDocument();
  });

  it('„Angaben ändern“ bleibt offen, wenn die Zeile live entfällt, und trägt die 409', async () => {
    const adhoc = { ...em, ist_adhoc: true, material_id: null, bezeichnung: 'Feldbeten' };
    server.use(
      http.patch('/api/einsaetze/1/material/10', () =>
        HttpResponse.json({ error: 'Material ist nicht mehr im Einsatz' }, { status: 409 }),
      ),
    );
    const { client } = render(einsatzAktiv, [adhoc as never]);
    await screen.findByText('Feldbeten');
    const menue = await openZeilenmenue('Feldbeten');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Angaben ändern …' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Bezeichnung');
    await waitFor(() => expect(feld).toHaveValue('Feldbeten'));
    server.use(http.get('/api/einsaetze/1/material', () => HttpResponse.json([])));
    act(() => {
      client.setQueryData<(typeof em)[]>(einsatzKeys.material(1), []);
    });
    await waitFor(() => expect(document.querySelector('[data-row-key="10"]')).toBeNull());
    expect(feld).toHaveValue('Feldbeten');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Feldbetten');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText(/nicht mehr im Einsatz/)).toBeInTheDocument();
  });

  it('die Maske „Ad-hoc-Material“ begrenzt die Angaben aus dem Spiegel', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: /^Material/ });
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Material' }));
    const dialog = await screen.findByRole('dialog');
    for (const name of ['Bezeichnung', 'Kategorie', 'Trägerorganisation', 'Bestandsnummer']) {
      expect(within(dialog).getByLabelText(name)).toHaveAttribute('maxlength', '200');
    }
  });
});

describe('MaterialPage · Herkunft aus einer Nachforderung (LLH-1226 D11)', () => {
  const uebernommen = { ...em, id: 21, ist_adhoc: true, material_id: null, nachforderung_id: 4 };
  const nachforderung = {
    id: 4,
    einsatz_id: 1,
    art: 'Tauchpumpe',
    bezeichnung: '3 Tauchpumpen für Keller Hauptstraße',
    status: 'eingetroffen',
    material_ids: [21],
  };

  /** Zählt die Abrufe der Nachforderungsliste. */
  function nachforderungen(antwort: () => Response): () => number {
    let abrufe = 0;
    server.use(
      http.get('/api/einsaetze/1/nachforderungen', () => {
        abrufe += 1;
        return antwort();
      }),
    );
    return () => abrufe;
  }

  it('mit Freigabe: Link „aus Nachforderung: …“ auf die hervorgehobene Nachforderung', async () => {
    nachforderungen(() => HttpResponse.json([nachforderung]));
    render(einsatzAktiv, [uebernommen as unknown as typeof em]);
    const link = await screen.findByRole('link', {
      name: 'aus Nachforderung: Tauchpumpe — 3 Tauchpumpen für Keller Hauptstraße',
    });
    expect(link).toHaveAttribute('href', '/einsaetze/1/nachforderungen?nachforderung=4');
  });

  it('ein langer Bedarf steht in höchstens zwei Zeilen, der Volltext im title (Prüfliste)', async () => {
    nachforderungen(() => HttpResponse.json([nachforderung]));
    render(einsatzAktiv, [uebernommen as unknown as typeof em]);
    const text = 'aus Nachforderung: Tauchpumpe — 3 Tauchpumpen für Keller Hauptstraße';
    const link = await screen.findByRole('link', { name: text });
    expect(link).toHaveAttribute('title', text);
    // Der innerste Span mit dem Text trägt die Auslassung (der äußere ist der Boden des Links).
    const zeilen = Array.from(link.querySelectorAll('span')).filter((e) => e.textContent === text);
    expect(zeilen[zeilen.length - 1]?.getAttribute('style')).toMatch(/line-clamp: 2/);
  });

  it('auch im Kartenmodus (390 px): neutral gesetzt, kein Block in der fetten Titelzeile', async () => {
    setzeViewportBreite(390);
    nachforderungen(() => HttpResponse.json([nachforderung]));
    const { container } = render(einsatzAktiv, [uebernommen as unknown as typeof em]);
    const karte = await waitFor(() => {
      const k = container.querySelector<HTMLElement>('[data-lfh="datensicht-karte"]');
      expect(k).toHaveTextContent(
        'aus Nachforderung: Tauchpumpe — 3 Tauchpumpen für Keller Hauptstraße',
      );
      return k as HTMLElement;
    });
    const herkunft = karte.querySelector<HTMLElement>('[data-lfh="material-herkunft"]');
    // Der Kartentitel ist ein fettes `<strong>` in einem `<span>`: der Verweis ist dort ein Span
    // ohne Block-Elemente und stünde sonst fett wie die Bezeichnung.
    expect(herkunft?.closest('strong')).not.toBeNull();
    expect(herkunft?.tagName).toBe('SPAN');
    expect(herkunft?.querySelector('div')).toBeNull();
    expect(herkunft).toHaveStyle({ fontWeight: 'normal', display: 'block' });
  });

  /**
   * Abwesenheit erst prüfen, wenn sie etwas beweist: die Freigaben sind aufgelöst und ein Tick ist
   * vergangen. Danach hätte ein Abruf, den nur die Freigabe aufhält, begonnen — die Query stünde
   * auf `fetching`, auch bevor MSW den Handler erreicht.
   */
  async function keinAbrufNachFreigaben(client: QueryClient, abrufe: () => number) {
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.modulFreigaben(1))?.status).toBe('success'),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const stand = client.getQueryState(einsatzKeys.nachforderungen(1));
    expect(stand?.fetchStatus ?? 'idle').toBe('idle');
    expect(stand?.dataUpdateCount ?? 0).toBe(0);
    expect(abrufe()).toBe(0);
  }

  it('ohne Freigabe für Nachforderungen: „aus Nachforderung #4“ ohne Link, kein Abruf', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ nachforderungen: { zugriff: false } })),
      ),
    );
    const abrufe = nachforderungen(() => HttpResponse.json([nachforderung]));
    const { client } = render(einsatzAktiv, [uebernommen as unknown as typeof em]);
    expect(await screen.findByText('aus Nachforderung #4')).toBeInTheDocument();
    await keinAbrufNachFreigaben(client, abrufe);
    expect(screen.queryByRole('link', { name: /aus Nachforderung/ })).toBeNull();
  });

  it('Liste abgelehnt (403): still „aus Nachforderung #4“', async () => {
    nachforderungen(() => HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }));
    render(einsatzAktiv, [uebernommen as unknown as typeof em]);
    expect(await screen.findByText('aus Nachforderung #4')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /aus Nachforderung/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ohne verknüpften Posten ruft die Seite keine Nachforderungen ab', async () => {
    const abrufe = nachforderungen(() => HttpResponse.json([nachforderung]));
    const { client } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    await keinAbrufNachFreigaben(client, abrufe);
    expect(screen.queryByText(/aus Nachforderung/)).toBeNull();
  });
});

/**
 * Sortieren und Filtern im Spaltenkopf (LLH-1096, Rollout des Musters aus LLH-1086): Kategorie,
 * Ort, Status und Träger filtern, jede vergleichbare Spalte sortiert, der Stand steht in der
 * Adresse.
 */
describe('MaterialPage · Sortieren und Filtern (LLH-1096)', () => {
  const zweites = {
    ...em,
    id: 11,
    material_id: 6,
    bezeichnung: 'Feldbett',
    menge: 5,
    traegerorganisation: 'ASB',
  };
  const erstes = { ...em, traegerorganisation: 'DRK' };
  const folge = () =>
    [...document.querySelectorAll('tbody tr[data-row-key]')].map((z) =>
      z.getAttribute('data-row-key'),
    );

  it('Sortieren und Filtern ändern die Menge und die Adresse', async () => {
    setzeViewportBreite(1600);
    render(einsatzAktiv, [erstes, zweites]);
    await screen.findByText('Wolldecke');
    expect(folge()).toEqual(['11', '10']);

    await kopfFilterWaehlen('Träger', ['DRK (1)']);
    await waitFor(() => expect(folge()).toEqual(['10']));
    await waitFor(() => expect(ort.aktuell).toBe('/einsaetze/1/material?f.traeger=DRK'));

    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await userEvent.click(screen.getByRole('columnheader', { name: /^Menge/ }));
    await waitFor(() => expect(ort.aktuell).toBe('/einsaetze/1/material?sort=menge%3Aauf'));
    expect(folge()).toEqual(['11', '10']);
    await userEvent.click(screen.getByRole('columnheader', { name: /^Menge/ }));
    await waitFor(() => expect(folge()).toEqual(['10', '11']));
    await waitFor(() => expect(ort.aktuell).toBe('/einsaetze/1/material?sort=menge%3Aab'));
  });

  it('eine Adresse mit Filter zeigt dieselbe Liste', async () => {
    setzeViewportBreite(1600);
    render(einsatzAktiv, [erstes, zweites], [], {}, '/einsaetze/1/material?f.traeger=ASB');
    await screen.findByText('Feldbett');
    expect(screen.queryByText('Wolldecke')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Filter Träger: ASB entfernen' }),
    ).toBeInTheDocument();
  });
});
