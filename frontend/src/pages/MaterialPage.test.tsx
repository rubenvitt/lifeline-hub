import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import MaterialPage from './MaterialPage';

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
