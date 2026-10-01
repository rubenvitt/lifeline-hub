import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import MaterialPage from './MaterialPage';
import { einsatzKeys } from '../api/queryKeys';
import { adminFixture, einsatzFixture } from '../test/fixtures';

const admin = adminFixture();

const einsatzAktiv = einsatzFixture();

const em = {
  id: 10,
  einsatz_id: 1,
  material_id: 5,
  einheit_id: null,
  ist_adhoc: false,
  bezeichnung: 'Wolldecke',
  kategorie: 'Betreuung',
  bestandsnummer: null,
  traegerorganisation: null,
  menge: 50,
  status: 'einsatzbereit',
  bemerkung: null,
  disponiert_at: '2026-05-27 09:00:00',
  disponiert_von: 1,
};

function render(einsatzObj: typeof einsatzAktiv, materialListe: (typeof em)[]) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(materialListe)),
    http.get('/api/material', () => HttpResponse.json([])),
    // Die Verdichtungszeile über der Tabelle lädt selbst. Ohne diese Handler fiele ihre Query in
    // jedem Test auf `isError` (`onUnhandledRequest: 'error'`), und die Zeile verschwände lautlos.
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
    </Routes>,
    { route: '/einsaetze/1/material' },
  );
}

/**
 * Öffnet das Statusmenü einer Zeile und liefert das geöffnete Menü-Portal. antd lässt die Portale
 * geschlossener Dropdowns im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden`
 * — deshalb zusätzlich über `pointerEvents` filtern.
 */
async function oeffneStatusmenue(wurzel: HTMLElement, bezeichnung: string): Promise<HTMLElement> {
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
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    expect(within(zeile).queryByRole('combobox')).toBeNull();
    const menue = await oeffneStatusmenue(zeile, 'Wolldecke');
    // Alle fünf Zustände senkrecht im Menü.
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

  it('das Mengenfeld folgt der Dichtestufe statt einer festen Kleingröße', async () => {
    // Das Mengenfeld trägt keine Klein-Angabe; die Zeile in `dichte.guard.test.ts` ist mit dem Fix
    // gefallen.
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const feld = container.querySelector('[data-row-key="10"] .ant-input-number');
    expect(feld!.className).not.toMatch(/ant-input-number-sm\b/);
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

  it('zeigt disponiertes Material mit Menge und Status', async () => {
    render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument(); // Mengen-Input (min 1)
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

    const menue = await oeffneStatusmenue(zeile, 'Wolldecke');
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
    expect(screen.getByRole('button', { name: 'Disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Material' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist reine Anzeige', async () => {
    const abgeschlossen = { ...einsatzAktiv, status: 'abgeschlossen' as const };
    render(abgeschlossen, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Disponieren' })).not.toBeInTheDocument();
    /**
     * Diese Abfrage hält nur, weil das Gruppenetikett ein Textknoten ist (`einsatzbereit · 1`) und
     * RTL exakt gegen den normalisierten Text matcht — `'einsatzbereit'` trifft `'einsatzbereit ·
     * 1'` nicht. Wäre der Kopf aus zwei Knoten gebaut, würfe der Test mit Mehrfachtreffern.
     */
    expect(screen.getByText('einsatzbereit')).toBeInTheDocument();
    expect(screen.getByText('einsatzbereit · 1')).toBeInTheDocument();
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

  it('gruppiert nach dem eigenen Materialstatus, mit Zähler im Etikett', async () => {
    // Serverordnung [11, 10]; Namensordnung ebenfalls [11 Aluleiter, 10 Wolldecke]; gerendert [10,
    // 11], weil die Statusachse führt (einsatzbereit vor defekt). Die gerenderte Folge ist weder
    // Server- noch Namensordnung.
    const { container } = render(einsatzAktiv, [emDefekt, em]);
    await screen.findByText('Wolldecke');
    expect(screen.getByText('einsatzbereit · 1')).toBeInTheDocument();
    expect(screen.getByText('defekt · 1')).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('tr.ant-table-row')].map((r) =>
        r.getAttribute('data-row-key'),
      ),
    ).toEqual(['10', '11']);
  });

  it('der Spaltenschalter lügt nicht: ohne ausgeblendete Spalte trägt er keinen Zähler', async () => {
    /**
     * Das Primitiv zeigt den Spaltenschalter, sobald eine Spalte abwählbar ist. Geprüft wird, dass
     * der Zähler nichts erfindet: keine Spalte ist abgewählt oder per Breite verborgen → nur
     * „Spalten".
     */
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: /Spalten/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ausgeblendet/ })).toBeNull();
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

  it('keine Klein-Variante mehr am Status-Auswahlfeld und am Entfernen-Knopf', async () => {
    /**
     * Keine punktuellen Klein-Angaben an den Zeilen-Bedienelementen (Dichte-Regel); den Bestand
     * hält die Schuldmenge in `components/dichte.guard.test.ts`.
     */
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(zeile.querySelector('.ant-select-sm')).toBeNull();
    const entfernen = within(zeile).getByRole('button', { name: 'Entfernen' });
    expect(entfernen).not.toHaveClass('ant-btn-sm');
    // Rot bedient nichts: der Entfernen-Knopf trägt keinen Gefahren-Anstrich.
    expect(entfernen).not.toHaveClass('ant-btn-dangerous');
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
    // Die Verdichtungszeile über der Tabelle lädt selbst. Ohne diese Handler fiele ihre Query in
    // jedem Test auf `isError`, und die Zeile verschwände lautlos.
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
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

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie nicht.
    expect(screen.getByText('Wolldecke')).toBeInTheDocument();
    expect(
      screen.queryByText('Disponiertes Material konnte nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Stamm-Pool: das Auswahlfeld nennt den Ausfall statt „Kein Material im Dienst"', async () => {
    const { container } = zeige(
      http.get('/api/material', () => new HttpResponse(null, { status: 500 })),
    );
    await screen.findByText('Noch kein Material disponiert');
    await oeffneMaterialAuswahl(container, 'Stamm-Material wählen …');
    expect(
      await screen.findByText('Materialliste konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Kein Material im Dienst')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Kein Material im Dienst"', async () => {
    const { container } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    await oeffneMaterialAuswahl(container, 'Stamm-Material wählen …');
    expect(await screen.findByText('Kein Material im Dienst')).toBeInTheDocument();
    expect(screen.queryByText('Materialliste konnte nicht geladen werden')).not.toBeInTheDocument();
  });

  // LFH-733, design.md D5: nach der Wahl trägt auch das geschlossene Feld „Demo“.
  it('ein gewähltes Demo-Material zeigt „Demo“ im geschlossenen Feld', async () => {
    const { container } = zeige(
      http.get('/api/material', () =>
        HttpResponse.json([
          { id: 41, bezeichnung: 'Wolldecke', kategorie: 'Betreuung', demo: true },
          { id: 42, bezeichnung: 'Feldbett', kategorie: null, demo: false },
        ]),
      ),
    );
    await screen.findByText('Noch kein Material disponiert');
    await oeffneMaterialAuswahl(container, 'Stamm-Material wählen …');
    await screen.findByText('Feldbett');
    expect(sichtbareOptionen()).toEqual(['Feldbett', 'Wolldecke (Betreuung) · Demo']);
    await userEvent.click(screen.getByText('Wolldecke (Betreuung) · Demo'));
    // Das Feld selbst liegt im Container, die Optionsliste im Portal außerhalb.
    await waitFor(() =>
      expect(
        [...container.querySelectorAll<HTMLElement>('.ant-select')].map((f) => f.textContent),
      ).toContain('Wolldecke (Betreuung) · Demo'),
    );
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

  async function oeffneAdhoc() {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: /^Material/ });
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Material' }));
    return await screen.findByRole('dialog');
  }

  it('zeigt eingeklappt höchstens vier Felder — das fünfte liegt unter „Weitere Angaben"', async () => {
    const dialog = await oeffneAdhoc();

    // Genau vier, nicht „höchstens vier": eine Obergrenze wäre auch bei drei grün.
    expect(sichtbareFelder(dialog)).toBe(4);
    // Die Bestandsnummer ist im Baum (forceRender → sie geht beim Absenden mit), aber nicht
    // sichtbar. `queryByLabelText` allein fände sie auch eingeklappt und bewiese nichts.
    expect(within(dialog).getByLabelText('Bestandsnummer')).not.toBeVisible();
  });

  it('Aufklappen erhöht die Zahl der sichtbaren Felder', async () => {
    const dialog = await oeffneAdhoc();
    const vorher = sichtbareFelder(dialog);

    // Teiltreffer statt genauem Namen: ältere antd-Fassungen trugen das Zustandssymbol im Namen
    // („collapsed Weitere Angaben").
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));

    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(vorher + 1));
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
    const dialog = await oeffneAdhoc();
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
    const dialog = await oeffneAdhoc();
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

  it('der Primär-Knopf heißt „Disponieren" und schließt den Dialog', async () => {
    const dialog = await oeffneAdhoc();
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

/** Die Optionen eines geöffneten Auswahlfelds in Anzeigereihenfolge (LFH-733). */
function sichtbareOptionen(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.ant-select-item-option-content')].map(
    (o) => o.textContent ?? '',
  );
}

/**
 * Öffnet ein antd-Auswahlfeld über seinen Platzhaltertext. Nicht per Klick auf den Platzhalter:
 * dessen Knoten trägt `pointer-events: none`.
 */
async function oeffneMaterialAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
    s.textContent?.includes(platzhalter),
  );
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}
