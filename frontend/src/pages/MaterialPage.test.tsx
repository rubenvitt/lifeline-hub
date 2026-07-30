import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import MaterialPage from './MaterialPage';
import { einsatzKeys } from '../api/queryKeys';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};

const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};

const em = {
  id: 10, einsatz_id: 1, material_id: 5, einheit_id: null, ist_adhoc: false,
  bezeichnung: 'Wolldecke', kategorie: 'Betreuung', bestandsnummer: null, traegerorganisation: null,
  menge: 50, status: 'einsatzbereit', bemerkung: null,
  disponiert_at: '2026-05-27 09:00:00', disponiert_von: 1,
};

function render(einsatzObj: typeof einsatzAktiv, materialListe: typeof em[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(materialListe)),
    http.get('/api/material', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/material' },
  );
}

describe('MaterialPage', () => {
  it('zeigt disponiertes Material mit Menge und Status', async () => {
    render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument(); // Mengen-Input (min 1)
  });

  it('Einsatzleitung sieht Disponier- und Ad-hoc-Aktionen', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Material' });
    expect(screen.getByRole('button', { name: 'Disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Material' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist reine Anzeige', async () => {
    const abgeschlossen = { ...einsatzAktiv, status: 'abgeschlossen' as const };
    render(abgeschlossen, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Disponieren' })).not.toBeInTheDocument();
    /**
     * Status-Badge statt Auswahlfeld. Diese Abfrage HÄLT nur, weil das Gruppenetikett EIN
     * Textknoten ist (`einsatzbereit · 1`) und RTL exakt gegen den normalisierten
     * Textinhalt matcht — `'einsatzbereit'` trifft `'einsatzbereit · 1'` also nicht. Wäre
     * der Kopf aus zwei Knoten gebaut, würfe derselbe Test mit einer
     * Mehrfachtreffer-Verletzung. Steht hier, weil der Bruch sonst wie Zufall aussähe.
     */
    expect(screen.getByText('einsatzbereit')).toBeInTheDocument();
    expect(screen.getByText('einsatzbereit · 1')).toBeInTheDocument();
  });

  // ── Datensicht (LFH-330 · B2) ───────────────────────────────────────────────────

  /**
   * `EinsatzMaterialAnzeige` hat KEIN `status_kategorie` (15 Felder, am generierten Typ
   * geprüft) — dieselbe Grenze, die `filtereKraefte` schon zieht. Material gruppiert
   * deshalb auf seiner EIGENEN Fünf-Werte-Achse, nicht auf verfügbar/gebunden/nicht
   * verfügbar. Erfunden wird hier kein Feld.
   */
  const emDefekt = { ...em, id: 11, bezeichnung: 'Aluleiter', kategorie: 'Technik', status: 'defekt' };

  it('gruppiert nach dem eigenen Materialstatus, mit Zähler im Etikett', async () => {
    // Serverordnung [11, 10]; Namensordnung ebenfalls [11 Aluleiter, 10 Wolldecke];
    // gerendert [10, 11], weil die Statusachse führt (einsatzbereit vor defekt). Die
    // gerenderte Folge ist damit WEDER Server- noch Namensordnung.
    const { container } = render(einsatzAktiv, [emDefekt, em]);
    await screen.findByText('Wolldecke');
    expect(screen.getByText('einsatzbereit · 1')).toBeInTheDocument();
    expect(screen.getByText('defekt · 1')).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('tr.ant-table-row')].map((r) => r.getAttribute('data-row-key')),
    ).toEqual(['10', '11']);
  });

  it('der Spaltenschalter lügt nicht: ohne ausgeblendete Spalte trägt er keinen Zähler', async () => {
    /**
     * ABWEICHUNG von Plan §0.2 (c), gemessen: dort sollte der Schalter erst ab einer
     * Spaltenschwelle erscheinen und auf dieser Seite (6 Spalten) fehlen. Das gelieferte
     * Primitiv kennt keine Schwelle — es zeigt ihn, sobald überhaupt eine Spalte abwählbar
     * ist. Geprüft wird deshalb, was zählt: der Zähler erfindet nichts. Hier ist keine
     * Spalte per Voreinstellung abgewählt und keine per Breite verborgen → nur „Spalten".
     */
    render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: /Spalten/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ausgeblendet/ })).toBeNull();
  });

  it('unter md stehen Karten mit Status als beschriftetem Feld, keine Tabelle', async () => {
    setzeViewportBreite(390);
    const { container } = render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
    const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
    expect(karte).not.toBeNull();
    /**
     * KEIN `karte.status`-Slot: `STATUS_META` sind rohe antd-Preset-Farbnamen und liegen
     * ausdrücklich außerhalb des Statusfarb-Vertrags (A2 nennt MaterialPage namentlich als
     * draußen). Sie in eine `StatusDarstellung` zu zwingen wäre der Bestands-Sweep, den A2
     * verbietet. Der Status steht deshalb als beschriftetes Sekundärfeld.
     */
    const felder = [...karte.querySelectorAll('[data-lfh="datensicht-feld"]')].map((f) => f.textContent);
    expect(felder.some((t) => t?.startsWith('Status'))).toBe(true);
    expect(karte.textContent).toContain('einsatzbereit');
  });

  it('Gegenprobe: ab md steht die Tabelle', async () => {
    const { container } = render(einsatzAktiv, [em]);
    await screen.findByText('Wolldecke');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });

  it('keine Klein-Variante mehr am Status-Auswahlfeld und am Entfernen-Knopf', async () => {
    /**
     * Zwei ohnehin angefasste `size="small"` fallen weg (Verbot aus CLAUDE.md; der Abbau
     * des restlichen Bestands ist LFH-333/B5). `MengeZelle` bleibt bewusst unangetastet —
     * sie ist nicht Teil dieses Umbaus.
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
 * Datenzustände der Materialseite (LFH-331 · B3).
 *
 * **Diese Seite hat KEINEN Katalog-Query.** Der Materialstatus ist das lokale Enum
 * `MaterialStatus` mit fünf Werten (`STATUS_META`) — er kommt nicht über die Leitung und
 * kann deshalb nicht ausfallen. Ein Banner „Statuskatalog konnte nicht geladen werden"
 * wäre hier ein erfundener Fehlerfall und steht bewusst nicht in dieser Datei.
 *
 * Ausfallen können genau drei Dinge: der **Einsatz** selbst (Seitenrahmen), die
 * **Dispositionsliste** und der **Stamm-Pool**.
 */
describe('MaterialPage · Datenzustände', () => {
  const gruenerBoden = () => [
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/material', () => HttpResponse.json([])),
  ];

  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Abweichung VORN: der erste passende Handler gewinnt.
    server.use(...abweichungen, ...gruenerBoden());
    return renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
        </Routes>
      </AuthProvider>,
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
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`.
   *
   * Der Ablauf ist BEWUSST der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Vor dem Umbau verdrängte der Fehler die Zeilen — die Einsatzkraft verlor
   * Daten, die sie eben noch gelesen hatte, und das ist das Gegenteil dessen, wofür
   * `SeitenStandVeraltet` gebaut wurde.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = zeige(http.get('/api/einsaetze/1/material', () => HttpResponse.json([em])));
    await screen.findByText('Wolldecke');

    server.use(http.get('/api/einsaetze/1/material', () => new HttpResponse(null, { status: 500 })));
    await client.refetchQueries({ queryKey: einsatzKeys.material(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('Wolldecke')).toBeInTheDocument();
    expect(screen.queryByText('Disponiertes Material konnte nicht geladen werden')).not.toBeInTheDocument();
  });

  it('gescheiterter Stamm-Pool: das Auswahlfeld nennt den Ausfall statt „Kein Material im Dienst"', async () => {
    const { container } = zeige(http.get('/api/material', () => new HttpResponse(null, { status: 500 })));
    await screen.findByText('Noch kein Material disponiert');
    await oeffneMaterialAuswahl(container, 'Stamm-Material wählen …');
    expect(await screen.findByText('Materialliste konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Kein Material im Dienst')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Kein Material im Dienst"', async () => {
    const { container } = zeige();
    await screen.findByText('Noch kein Material disponiert');
    await oeffneMaterialAuswahl(container, 'Stamm-Material wählen …');
    expect(await screen.findByText('Kein Material im Dienst')).toBeInTheDocument();
    expect(screen.queryByText('Materialliste konnte nicht geladen werden')).not.toBeInTheDocument();
  });
});

/**
 * Ad-hoc-Schnellerfassung (LFH-332 · B4).
 *
 * Der Dialog liegt auf `ErfassungsModal`. Was die Hülle selbst zusichert (Fokus, Enter,
 * Leeren auf beiden Wegen, Ablehnung), steht in `components/Erfassung.test.tsx` und wird
 * hier NICHT nachgespielt. Geprüft wird ausschließlich, was diese Seite entscheidet: das
 * Feldbudget mit dem eingeklappten Rest und der Serienlauf mit seinen Übernahmefeldern.
 */
describe('MaterialPage · Ad-hoc-Schnellerfassung', () => {
  /**
   * Zählt die BEDIENBAREN Felder des Dialogs: Textfelder plus Zahlenfelder
   * (`InputNumber` trägt `role="spinbutton"`). Die Rollen-Abfrage blendet aus, was im
   * Barrierefreiheitsbaum nicht steht — und genau das ist der eingeklappte Bereich:
   * `forceRender` lässt sein Feld im Baum, `CSSMotion` legt bei unsichtbarem Bereich ein
   * `display: none` DIREKT ans Element (kein Klassenname). Deshalb hält diese Zählung
   * auch in jsdom, wo antds Stylesheet nicht wirkt.
   */
  function sichtbareFelder(dialog: HTMLElement): number {
    // Absichtlich breiter als die heute vorhandenen zwei Rollen: ein später ergänztes
    // Auswahl- oder Schaltfeld soll die Vier-Feld-Grenze REISSEN, statt an einer zu engen
    // Zählung vorbeizurutschen.
    const rollen = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'radio', 'switch'] as const;
    const felder = new Set<Element>();
    for (const rolle of rollen) {
      for (const el of within(dialog).queryAllByRole(rolle)) {
        // Nur was in einem `Form.Item` steckt, ist ein FELD. Das Kästchen „Werte behalten"
        // der Hülle sitzt in der Fusszeile und zählt nicht mit — es erfasst nichts, es
        // steuert den Serienlauf.
        const item = el.closest('.ant-form-item');
        if (item) felder.add(item);
      }
    }
    return felder.size;
  }

  async function oeffneAdhoc() {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Material' });
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Material' }));
    return await screen.findByRole('dialog');
  }

  it('zeigt eingeklappt höchstens vier Felder — das fünfte liegt unter „Weitere Angaben"', async () => {
    const dialog = await oeffneAdhoc();

    // GENAU vier, nicht „höchstens vier": eine Obergrenze wäre auch bei drei grün und
    // deckte eine Zählung, die still ein Feld verliert.
    expect(sichtbareFelder(dialog)).toBe(4);
    // Die Bestandsnummer ist IM Baum (forceRender → sie geht beim Absenden mit), aber
    // nicht sichtbar. Nur diese Paarung belegt beides; `queryByLabelText` allein fände sie
    // auch im eingeklappten Zustand und bewiese gar nichts.
    expect(within(dialog).getByLabelText('Bestandsnummer')).not.toBeVisible();
  });

  it('Aufklappen erhöht die Zahl der sichtbaren Felder', async () => {
    const dialog = await oeffneAdhoc();
    const vorher = sichtbareFelder(dialog);

    // Der Zugangsname trägt das Zustandssymbol mit („collapsed Weitere Angaben"), deshalb
    // Teiltreffer statt genauem Namen.
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));

    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(vorher + 1));
    expect(within(dialog).getByRole('button', { name: /Weitere Angaben/ }))
      .toHaveAttribute('aria-expanded', 'true');
    /**
     * KEIN `toBeVisible()` auf dem aufgeklappten Feld — gemessen, nicht vergessen: die
     * Aufklapp-Animation beginnt mit `opacity: 0` und endet in jsdom nie (kein
     * `transitionend`), jest-dom hielte das Feld also dauerhaft für unsichtbar. Der
     * Barrierefreiheitsbaum kennt keine Deckkraft — die Rollen-Zählung oben ist deshalb das
     * belastbare Mass. Im eingeklappten Zustand hält `not.toBeVisible()` dagegen sehr wohl:
     * dort liegt ein `display: none` direkt am Element (Test darüber).
     */
  });

  /**
   * MUTATIONSPROBE zu `forceRender` (gemessen, Prop entfernt, Suite gefahren): rot wurde
   * NUR der Test darüber — ohne die Prop existiert das Feld vor dem ersten Aufklappen gar
   * nicht. DIESER Test blieb grün, weil antd den einmal aufgeklappten Bereich nicht wieder
   * abbaut. Er pinnt deshalb den Leitungsvertrag (der Wert kommt hinten an), nicht die Prop
   * — der Prop-Wächter ist die Existenzprüfung im eingeklappten Zustand.
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
    // WIEDER ZUKLAPPEN und dann erst absenden — der Bediener lässt den Bereich selten offen.
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

    // Der Schalter steht per Vorgabe AUS (30.07.2026) — ohne ihn gäbe es keine Übernahme.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Spende-Decken');
    await userEvent.type(within(dialog).getByLabelText('Kategorie'), 'Betreuung');
    await userEvent.type(within(dialog).getByLabelText('Trägerorganisation'), 'THW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ adhoc: { bezeichnung: 'Spende-Decken' }, menge: 1 });

    // Offen geblieben — der Zähler ist der Beleg, dass gespeichert wurde und nicht bloß
    // nichts passiert ist.
    expect(await screen.findByText('Erfasst: 1')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await waitFor(() => expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(within(dialog).getByLabelText('Kategorie')).toHaveValue('Betreuung');
    expect(within(dialog).getByLabelText('Trägerorganisation')).toHaveValue('THW');
    // Die Menge steht wieder auf ihrem Startwert, obwohl sie kein Übernahmefeld ist:
    // `initialValues` wirkt bei jedem Zurücksetzen erneut.
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
     * GEMESSEN: `queryByRole('dialog')).toBeNull()` wäre hier NIE grün. jsdom feuert kein
     * `transitionend`, und antds Modal räumt seinen Knoten erst am Ende der
     * Zoom-Animation ab — der Dialog bleibt also im Baum stehen, eingefroren in
     * `ant-zoom-leave-active`. Beobachtbar ist damit der Verlassen-Zustand, und der
     * belegt, was zu belegen ist: `onFertig` hat den Dialog geschlossen (der Serienlauf
     * tut das nicht, siehe Test darüber).
     */
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));
  });
});

/**
 * Öffnet ein antd-Auswahlfeld über seinen Platzhaltertext. Nicht per Klick auf den
 * Platzhalter selbst: dessen Knoten trägt `pointer-events: none` (gemessen).
 */
async function oeffneMaterialAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')]
    .find((s) => s.textContent?.includes(platzhalter));
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}
