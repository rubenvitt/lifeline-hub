import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import TierePage from './TierePage';
import type { Tier } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-29 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-29 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-29 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const tierBasis: Tier = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'aktiv', spezies: 'hund',
  rasse_beschreibung: 'Schäferhund', rufname: 'Rex', geschlecht: 'maennlich',
  alter_geschaetzt: 3, farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
  halter_person_id: null, halter_kontakt: null, antreff_ort: 'Weide', notiz: null,
  abschluss_grund: null, abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00', erfasst_von: 1, geaendert_at: '2026-05-29 09:00:00',
  geaendert_von: 1, storniert_at: null, halter_registrier_nr: null, halter_storniert_at: null,
};
const tierVermisst: Tier = { ...tierBasis, id: 11, registrier_nr: 2, status: 'vermisst', spezies: 'katze', rufname: 'Mimi' };

/**
 * Zeilenfolge der T-Nummern in Dokumentordnung. Die FOLGE ist die belastbare Behauptung —
 * ein gerenderter Zeitstring hinge an der Zeitzone des Testrechners, weil
 * `renderMitProviders` keinen `EinsatzAnzeigeProvider` einhängt.
 */
function regFolge(): string[] {
  return screen.getAllByText(/^T-\d{3}$/).map((e) => e.textContent ?? '');
}

function render(einsatzObj: typeof einsatzAktiv, tiere: Tier[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json(tiere)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/tiere" element={<TierePage />} />
        <Route path="/einsaetze/:id/tiere/:tierId" element={<div>DETAIL-SEITE</div>} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/tiere' },
  );
}

describe('TierePage', () => {
  it('zeigt aktive Tiere mit T-Nummer und Status', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    expect(await screen.findByText('T-001')).toBeInTheDocument();
    expect(screen.getByText('Rex')).toBeInTheDocument();
    // vermisste Katze ist in der Default-Sicht „Aktiv" nicht sichtbar:
    expect(screen.queryByText('T-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    await screen.findByText('T-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('T-002')).toBeInTheDocument();
    expect(screen.getByText('Mimi')).toBeInTheDocument();
  });

  it('nimmt den Suchbegriff nicht in den nächsten Reiter mit', async () => {
    /**
     * VIER Reiter auf EINER `Datensicht` — bei konstantem `key` reicht React beim
     * Reiterwechsel dieselbe Instanz weiter, und `suchbegriff` lebt IN der Sicht: der Begriff
     * aus „Vermisst" filtert danach die Menge von „Alle".
     *
     * Drei Schritte, weil der letzte allein nichts belegte: eine Behauptung über das leere
     * Feld bliebe auch grün, wenn die Suche gar nicht filterte (etwa ohne `suchText` an der
     * Rufnamen-Spalte). Schritt 1 zeigt erst, dass der Begriff beißt; Schritt 3 nennt den
     * Schaden beim Namen — eine fremde Menge auf einen fremden Begriff gefiltert.
     *
     * FIXTUREN BEWUSST QUER: `suchText` greift auf Reg.-Nr., Rufname, Rasse UND Halter zu.
     * Träfe der Begriff die Zielzeile über irgendeines dieser Felder, stünde sie nach dem
     * Wechsel sichtbar da, WEIL sie passt — und nicht, weil das Feld geleert wurde. „Mimi"
     * trifft deshalb genau eine der drei Zeilen, und alle drei tragen eine eigene Rasse.
     */
    const mimi: Tier = { ...tierBasis, id: 70, registrier_nr: 4, status: 'vermisst',
      spezies: 'katze', rufname: 'Mimi', rasse_beschreibung: 'Perser' };
    const bello: Tier = { ...tierBasis, id: 71, registrier_nr: 5, status: 'vermisst',
      rufname: 'Bello', rasse_beschreibung: 'Dackel' };
    const rex: Tier = { ...tierBasis, id: 72, registrier_nr: 6, status: 'aktiv',
      rufname: 'Rex', rasse_beschreibung: 'Schäferhund' };
    render(einsatzAktiv, [mimi, bello, rex]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('Bello')).toBeInTheDocument();

    // 1. Die Suche wirkt überhaupt: die nicht passende Zeile fällt heraus.
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Suche in Tiere im Einsatz' }),
      'Mimi',
    );
    await vi.waitFor(() => expect(screen.queryByText('Bello')).not.toBeInTheDocument());
    expect(screen.getByText('Mimi')).toBeInTheDocument();

    // 2. + 3. Reiterwechsel: die fremde Zeile steht ungefiltert da, das Feld ist leer.
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    expect(await screen.findByText('Rex')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Suche in Tiere im Einsatz' })).toHaveValue('');
  });

  it('filtert nach Spezies', async () => {
    render(einsatzAktiv, [tierBasis, { ...tierBasis, id: 12, registrier_nr: 3, spezies: 'katze', rufname: 'Felix' }]);
    await screen.findByText('Rex');
    // Namensfilter, nicht „die einzige Combobox der Seite": die Werkzeugzeile von
    // `Datensicht` kann ein zweites Combobox-artiges Element mitbringen (Spaltenschalter,
    // Spaltenfilter). Ohne den Namen bräche diese Zeile aus einem Grund, der mit Tieren
    // nichts zu tun hat.
    await userEvent.click(screen.getByRole('combobox', { name: 'Spezies' }));
    // Tabellenzelle und Dropdown-Option tragen beide "Katze" → auf die Option im Dropdown zielen.
    const katzeOption = (await screen.findAllByText('Katze')).find((el) => el.closest('.ant-select-item-option'));
    expect(katzeOption).toBeTruthy();
    await userEvent.click(katzeOption!);
    expect(await screen.findByText('Felix')).toBeInTheDocument();
    expect(screen.queryByText('Rex')).not.toBeInTheDocument();
  });

  it('Einsatzleitung sieht Anlege-Buttons', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Tiere' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [tierBasis]);
    await screen.findByText('T-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Schnellerfassung schickt status=aktiv + spezies', async () => {
    let body: { spezies?: string; status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { spezies?: string; status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('aktiv'));
    expect(body.spezies).toBe('hund'); // initialValues
  });

  it('Vermisst-Meldung schickt status=vermisst', async () => {
    let body: { status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99, status: 'vermisst' }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('vermisst'));
  });

  it('navigiert beim Klick auf eine Zeile zur Detail-Vollseite', async () => {
    render(einsatzAktiv, [tierBasis]);
    await userEvent.click((await screen.findAllByText('Rex'))[0]);
    // Drawer entfernt (LFH-147) → Zeilen-Klick navigiert auf /tiere/:tierId.
    expect(await screen.findByText('DETAIL-SEITE')).toBeInTheDocument();
  });

  it('sortiert die Liste selbst, statt die Lieferreihenfolge zu übernehmen', async () => {
    // AUFSTEIGEND geliefert, obwohl das Backend `ORDER BY t.registrier_nr DESC` fährt
    // (`src/tier/repo.rs`): nur so beweist die absteigende Zeilenfolge, dass die Umkehrung
    // im Client passiert. In Backend-Reihenfolge geliefert könnte dieser Test nicht
    // fehlschlagen.
    const drei = [
      tierBasis,
      { ...tierBasis, id: 21, registrier_nr: 2, rufname: 'Bello' },
      { ...tierBasis, id: 22, registrier_nr: 3, rufname: 'Cleo' },
    ];
    render(einsatzAktiv, drei);
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    expect(regFolge()).toEqual(['T-003', 'T-002', 'T-001']);
  });

  it('zeigt „seit" aus dem Erfassungszeitpunkt und sortiert danach', async () => {
    /**
     * Für Tiere gibt es KEINE Dringlichkeitssortierung: `TierAnzeige` trägt weder
     * Sichtungskategorie noch Sichtungszeitpunkt (verifiziert am generierten Typ, die
     * Rust-Doku nennt das Modul „bewusst schlank"). „seit" kommt deshalb aus `erfasst_at`;
     * `geaendert_at` wäre falsch, weil es bei jeder Notiz weiterläuft.
     *
     * Der Klick auf den Spaltenkopf ist die tragende Hälfte. Gemessen: eine Prüfung, die nur
     * Kopf und Zellmuster sieht, blieb grün, als der `sortWert` der Spalte entfiel UND als
     * der Kopf umbenannt wurde — sie belegte also weder Sortierbarkeit noch Beschriftung.
     *
     * Die Zeitstempel liegen ABSICHTLICH quer zur Registriernummer, sonst wäre die
     * Zeitsortierung von der Nummernsortierung nicht zu unterscheiden. Und sie sind
     * verschieden: alle Bestandsfixtures teilen `erfasst_at`, eine Behauptung darüber wäre
     * dort eine Attrappe.
     */
    const drei = [
      { ...tierBasis, id: 30, registrier_nr: 1, rufname: 'Alt', erfasst_at: '2026-05-29 07:00:00' },
      { ...tierBasis, id: 31, registrier_nr: 2, rufname: 'Neu', erfasst_at: '2026-05-29 12:00:00' },
      { ...tierBasis, id: 32, registrier_nr: 3, rufname: 'Mitte', erfasst_at: '2026-05-29 09:00:00' },
    ];
    render(einsatzAktiv, drei);
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    // Muster statt Fixwert: ohne `EinsatzAnzeigeProvider` rendert die Zeit in der Zeitzone
    // des Testrechners.
    const dtg = screen
      .getAllByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/)
      .map((e) => e.textContent);
    expect(dtg).toHaveLength(3);
    // DREI VERSCHIEDENE Werte. Gemessen als Lücke: die Fixtures teilen `geaendert_at`, also
    // blieb ein `render` auf dem falschen Feld grün, solange nur das Format geprüft wurde.
    expect(new Set(dtg).size).toBe(3);
    // Vorgabe ist die Nummer, absteigend …
    expect(regFolge()).toEqual(['T-003', 'T-002', 'T-001']);
    // … und ein Klick auf den seit-Kopf ordnet nach Zeit, ältestes zuerst.
    await userEvent.click(screen.getByRole('columnheader', { name: 'seit' }));
    expect(regFolge()).toEqual(['T-001', 'T-003', 'T-002']);
  });

  it('trägt „seit" auch in den Kartenzweig bei 390 px', async () => {
    /**
     * Ohne diesen Fall belegte das Bündel die Zeitachse NUR für die Tabelle. Unter `md`
     * rendert `Datensicht` genau einen anderen Zweig, und dort kommt die Zeit aus dem
     * `sekundaer`-Tupel des Kartenplans — ein dort fehlender Slot wäre in jeder
     * Tabellenprüfung unsichtbar.
     *
     * Die Breite VOR dem Rendern setzen: antds Beobachter ruft seinen Zuhörer beim
     * Abonnieren synchron auf und liest dabei nur den Trefferstand.
     */
    setzeViewportBreite(390);
    const schmal = render(einsatzAktiv, [tierBasis]);
    await screen.findByRole('region', { name: 'Tiere im Einsatz' });
    // Genau EIN Zweig im Baum — sonst wäre die Aussage darüber, welcher gilt, wertlos.
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    // Etikett UND Wert: das Etikett ist der zweite Kanal der Karte.
    expect(screen.getByText('seit')).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/),
    ).toBeInTheDocument();
    // Das Tastaturziel der Zeile ist der Titel-Link, nicht die Kartenfläche.
    expect(screen.getByRole('link', { name: 'T-001' })).toHaveAttribute(
      'href',
      '/einsaetze/1/tiere/10',
    );
  });

  it('zeigt die Halter-R-Nr und „storniert" aus den Join-Feldern', async () => {
    const mitHalter: Tier = { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7, halter_storniert_at: '2026-05-29 11:00:00' };
    render(einsatzAktiv, [mitHalter]);
    expect(await screen.findByText(/Halter \(storniert\): R-007/)).toBeInTheDocument();
  });
});
