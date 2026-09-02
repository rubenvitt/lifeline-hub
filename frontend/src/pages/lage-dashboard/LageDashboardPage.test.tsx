import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import { setzeLiveStatusFuerTest } from '../../live/liveStatusStore';
import LageDashboardPage from './LageDashboardPage';
import type { Auftrag, Meldung } from '../../api/types';
import { uhrzeit } from './lagebild';
import { formatUhrzeitMitTag } from '../../anzeige/format';
import { EinsatzAnzeigeProvider } from '../../anzeige/AnzeigeKonventionenContext';

class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());
afterEach(() => setzeLiveStatusFuerTest('idle'));

const einsatz = {
  id: 1,
  bezeichnung: 'Hochwasser Musterstadt',
  stichwort: 'TH Hochwasser',
  status: 'aktiv',
  begonnen_at: '2026-06-08 06:12:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  einsatzart: 'realeinsatz',
  einsatznummer_intern: null,
  angelegt_at: '2026-06-08 06:12:00',
  leitstellen_nr: null,
  einsatzort: null,
  einsatzort_lat: null,
  einsatzort_lon: null,
  meldende_stelle: null,
  sachverhalt: null,
  anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
  org_id: 1,
  org_name: 'THW Musterstadt',
};

const person = (sichtung: string | null, status = 'betroffen') => ({
  id: Math.floor(Math.random() * 1e9),
  einsatz_id: 1,
  registrier_nr: 1,
  status,
  name: null,
  vorname: null,
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-06-08 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-06-08 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: sichtung,
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
});

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: Math.floor(Math.random() * 1e9),
  einsatz_id: 1,
  auftrag_text: 'Deich sichern',
  absicht: null,
  lage: null,
  ort: null,
  zeit: null,
  mittel: null,
  verbindung: null,
  sicherheit: null,
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: '2026-06-11 09:00:00',
  in_arbeit_at: null,
  vollzugsmeldung: null,
  abgenommen_at: null,
  abgenommen_von_id: null,
  etb_anordnung_id: 5,
  quell_etb_eintrag_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00',
  vollzug_status: 'offen',
  vollzogen_at: null,
  vollzogen_von_id: null,
  empfaenger_anzahl: 1,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  empfaenger: [],
  ...over,
});

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: Math.floor(Math.random() * 1e9),
  einsatz_id: 1,
  lfd_nr: 1,
  absender: 'Trupp 1',
  empfaenger: null,
  meldeweg: 'funk',
  inhalt: 'Deich instabil',
  meldungsart: 'lagemeldung',
  prioritaet: 'normal',
  richtung: 'intern',
  status: 'neu',
  bearbeiter_id: null,
  bearbeiter_name: null,
  lagerelevant: false,
  ereigniszeit: '2026-06-11 09:00:00',
  eingang_at: '2026-06-11 09:00:00',
  etb_meldung_id: null,
  auftrag_id: null,
  erfasst_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00',
  lage_meldung_id: null,
  ist_offen: true,
  erledigt_at: null,
  bestaetigung_pflicht: false,
  bestaetigung_frist_at: null,
  eskaliert: false,
  bestaetigt_at: null,
  bestaetigt_von_id: null,
  bestaetigt_von_name: null,
  ist_bestaetigt: false,
  ist_ueberfaellig: false,
  ...over,
});

interface Daten {
  personen?: unknown[];
  uhs?: unknown[];
  schaeden?: unknown[];
  tiere?: unknown[];
  gefahren?: unknown[];
  zonen?: unknown[];
  lageberichte?: unknown[];
  einheiten?: unknown[];
  personal?: unknown[];
  fahrzeuge?: unknown[];
  material?: unknown[];
  abschnitte?: unknown[];
  auftraege?: unknown[];
  meldungen?: unknown[];
  gefahrenStatus?: number;
  personenStatus?: number;
  /** Der Einsatz-Abruf bleibt hängen — der einzige Zustand, in dem `baueLagebild`
   *  noch gar nichts liefert und die Kennzahlenleiste ihre Plätze selbst stellen muss. */
  einsatzLaedt?: boolean;
}

function mockEndpunkte(d: Daten) {
  const json = (arr?: unknown[]) => HttpResponse.json(arr ?? []);
  server.use(
    http.get('/api/einsaetze/1', async () => {
      if (d.einsatzLaedt) await delay('infinite');
      return HttpResponse.json(einsatz);
    }),
    http.get('/api/einsaetze/1/personen', () =>
      d.personenStatus ? new HttpResponse(null, { status: d.personenStatus }) : json(d.personen),
    ),
    http.get('/api/einsaetze/1/uhs', () => json(d.uhs)),
    http.get('/api/einsaetze/1/schaeden', () => json(d.schaeden)),
    http.get('/api/einsaetze/1/tiere', () => json(d.tiere)),
    http.get('/api/einsaetze/1/gefahrengebiete', () =>
      d.gefahrenStatus ? new HttpResponse(null, { status: d.gefahrenStatus }) : json(d.gefahren),
    ),
    http.get('/api/einsaetze/1/zonen', () => json(d.zonen)),
    http.get('/api/einsaetze/1/lageberichte', () => json(d.lageberichte)),
    http.get('/api/einsaetze/1/einheiten', () => json(d.einheiten)),
    http.get('/api/einsaetze/1/personal', () => json(d.personal)),
    http.get('/api/einsaetze/1/fahrzeuge', () => json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', () => json(d.material)),
    http.get('/api/einsaetze/1/abschnitte', () => json(d.abschnitte)),
    http.get('/api/einsaetze/1/auftraege', () => json(d.auftraege)),
    http.get('/api/einsaetze/1/meldungen', () => json(d.meldungen)),
  );
}

function render() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      <Route path="/einsaetze/:id/personen" element={<div>PERSONEN-MODUL</div>} />
    </Routes>,
    { route: '/einsaetze/1/lage-dashboard' },
  );
}

/** Die Kennzahl-Kachel zu einem Etikett — die Leiste rendert Knöpfe, keine
 *  antd-`Statistic` mehr (LFH-352 · A0). */
function kennzahl(etikett: string): HTMLElement {
  const el = screen.getByText(etikett).closest('button');
  if (!el) throw new Error(`Kennzahl „${etikett}" nicht gefunden`);
  return el;
}

/**
 * Das Wartesignal auf „Daten sind da" (LFH-331 · B3).
 *
 * Seit die Leiste ihre sechs Plätze schon WÄHREND des Einsatz-Abrufs stellt, ist
 * ein `findByText(<Etikett>)` kein Gate mehr — es erfüllt sich sofort am
 * Platzhalter, und die Zusicherung danach liefe gegen den Ladezustand statt gegen
 * die Daten (gemessen: sieben Bestandstests fielen genau daran). Angesetzt wird
 * deshalb auf dem KNOPF, den erst das Lagebild baut; der Platzhalter ist keiner.
 */
function kennzahlGeladen(etikett: string): Promise<HTMLElement> {
  return waitFor(() => kennzahl(etikett));
}

describe('LageDashboardPage — Referenzseite der Gestaltungssprache', () => {
  it('zeigt Einsatz und Leitzahlen im Instrumentenband', async () => {
    mockEndpunkte({
      personen: [person('sk1'), person('sk1'), person('sk3'), person(null, 'vermisst')],
    });
    render();
    // Die Bezeichnung steht bewusst zweimal: im Breadcrumb (Navigation) und im
    // Instrumentenband (Lagebezug). Geprüft wird das Band.
    const band = (await screen.findAllByText('Hochwasser Musterstadt')).find((e) =>
      e.classList.contains('lfh-band__titel'),
    );
    expect(band).toBeDefined();
    // Signatur 4: das Band trägt DTG und Gesamtstärke, immer an derselben Stelle.
    expect(screen.getByText('DTG')).toBeInTheDocument();
    expect(screen.getByText('Gesamtstärke')).toBeInTheDocument();
    expect(kennzahl('Patienten SK I–IV')).toHaveTextContent('3');
    expect(kennzahl('Vermisst')).toHaveTextContent('1');
  });

  it('Kennzahlen tragen Wortlaut, nicht nur Zähler', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    // „keine" statt „0" — eine nackte Null sagt nicht, ob gemessen oder leer.
    expect(await kennzahlGeladen('Höchste Warnstufe')).toBeInTheDocument();
    expect(kennzahl('Höchste Warnstufe')).toHaveTextContent('keine');
    expect(kennzahl('Vermisst')).toHaveTextContent('keine offenen Fälle');
  });

  it('Leerzustand führt zu einer Aktion, statt nur leer zu sein', async () => {
    mockEndpunkte({});
    render();
    expect(await screen.findByText('Keine offenen Aufträge.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auftrag erteilen' })).toBeInTheDocument();
    expect(screen.getByText('Noch keine Personen erfasst.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Person aufnehmen' })).toBeInTheDocument();
  });

  it('Deep-Link: Klick auf die Patienten-Kennzahl navigiert ins Personen-Modul', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await kennzahlGeladen('Patienten SK I–IV');
    await userEvent.click(kennzahl('Patienten SK I–IV'));
    expect(await screen.findByText('PERSONEN-MODUL')).toBeInTheDocument();
  });

  it('Aufträge: zählt offene/in-Arbeit und zeigt die Überfällig-Plakette', async () => {
    mockEndpunkte({
      auftraege: [
        auftrag({ bearbeitungsstatus: 'offen' }),
        auftrag({ bearbeitungsstatus: 'in_arbeit', ist_ueberfaellig: true }),
        auftrag({ bearbeitungsstatus: 'vollzogen' }),
        auftrag({ bearbeitungsstatus: 'abgenommen' }),
      ],
    });
    render();
    expect(await screen.findByText('1 überfällig')).toBeInTheDocument();
    // offen = bearbeitungsstatus ∉ {vollzogen, abgenommen} → 2
    expect(screen.getByText('offen oder in Arbeit').parentElement).toHaveTextContent('2');
  });

  it('Meldungen: zählt offene/neue und zeigt die Überfällig-Plakette', async () => {
    mockEndpunkte({
      meldungen: [
        meldung({ status: 'neu', ist_offen: true }),
        meldung({ status: 'gesichtet', ist_offen: true, ist_ueberfaellig: true }),
        meldung({ status: 'in_bearbeitung', ist_offen: true }),
        meldung({ status: 'erledigt', ist_offen: false }),
      ],
    });
    render();
    expect(await screen.findByText('1 überfällig')).toBeInTheDocument();
    const offen = screen.getByText('Offen').closest('div');
    expect(offen).toHaveTextContent('3');
    const neu = screen.getByText('Neu').closest('div');
    expect(neu).toHaveTextContent('1');
  });

  // AK2 (LFH-336): Der Zähler bleibt, aber er sagt nicht, WAS los ist. Geprüft
  // wird der Inhalt der Zeile UND ihr Sprungziel — eine Zeile ohne Ziel wäre
  // wieder nur Text auf einer Kachel.
  it('Meldungen: die Kurzliste nennt lfd. Nummer, Zeit, Absender und Inhalt', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      meldungen: [
        meldung({ id: 77, lfd_nr: 12, absender: 'ELW 1', inhalt: 'Strom ausgefallen', ereigniszeit: '2026-06-11 14:05:00' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    const zeile = await screen.findByRole('link', { name: /Strom ausgefallen/ });
    expect(zeile).toHaveTextContent('12');
    // `uhrzeit()` rechnet den UTC-Wirestring in die Anzeigezone um (siehe
    // `lagebild.ts`) — die Erwartung darf deshalb nicht von der Maschinen-TZ
    // abhängen und wird über dieselbe Funktion berechnet wie die Seite selbst.
    expect(zeile).toHaveTextContent(uhrzeit('2026-06-11 14:05:00'));
    expect(zeile).toHaveTextContent('ELW 1');
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=77');
  });

  it('Aufträge: die Kurzliste nennt Auftragstext und Frist und springt auf den Auftrag', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 88, lfd_nr: 4, auftrag_text: 'Pumpe an Deich 3 setzen', frist_at: '2026-06-11 16:30:00' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    const zeile = await screen.findByRole('link', { name: /Pumpe an Deich 3 setzen/ });
    // `formatUhrzeitMitTag()` rechnet den UTC-Wirestring in die Anzeigezone um und
    // stellt den Tag voran, wenn die Frist nicht auf den heutigen Tag fällt —
    // dieselbe Funktion wie in `lagebild.ts`, damit die Erwartung nicht von
    // Maschinen-TZ oder Testlaufdatum abhängt.
    expect(zeile).toHaveTextContent(formatUhrzeitMitTag('2026-06-11 16:30:00'));
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=88');
  });

  it('Kurzlisten-Zeilen verschiedener Dringlichkeit unterscheiden sich ohne Farbe (LFH-395)', async () => {
    // WCAG 1.4.1: bis LFH-395 hing die Stufe ALLEIN an der Farbe des Markers —
    // Form, Symbol und Text waren über alle drei Stufen gleich. Der zweite Kanal
    // ist jetzt doppelt: die FORM des Markers (`form` aus `StatusDarstellung`,
    // bis dahin ein deklarierter, aber konsumentenloser Slot) und das Stufenwort
    // im zugänglichen Namen der Zeile. Beides wird geprüft — die Klasse allein
    // wäre kein Beleg, sie ist der Träger der Farbe (AK1).
    mockEndpunkte({
      personen: [person('sk3')],
      meldungen: [
        meldung({ id: 1, lfd_nr: 1, inhalt: 'Deich bricht', ist_ueberfaellig: true }),
        meldung({ id: 2, lfd_nr: 2, inhalt: 'Keller unter Wasser', status: 'neu' }),
        meldung({ id: 3, lfd_nr: 3, inhalt: 'Sandsaecke geliefert', status: 'in_bearbeitung' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');

    const dringend = await screen.findByRole('link', { name: /Deich bricht/ });
    const erhoeht = screen.getByRole('link', { name: /Keller unter Wasser/ });
    const normal = screen.getByRole('link', { name: /Sandsaecke geliefert/ });

    // Kanal „Text": ohne das Stufenwort bliebe die Zeile für Vorlesende
    // stufenlos, egal wie deutlich der Marker aussieht (AK3).
    expect(dringend).toHaveAccessibleName(/dringend/);
    expect(erhoeht).toHaveAccessibleName(/erhöht/);
    expect(normal).toHaveAccessibleName(/normal/);

    // Kanal „Form": drei Stufen, drei verschiedene Formen. Dass die Formachse
    // ohne Farbe auskommt und die Farbachse ohne Geometrie, belegt die
    // CSS-Prüfung in „Der Dringlichkeitsmarker (LFH-395)".
    const form = (zeile: HTMLElement) =>
      [...zeile.querySelector('.lfh-zeichen')!.classList].find((k) =>
        /^lfh-zeichen--(dreieck|kreis|balken)$/.test(k),
      );
    const formen = [form(dringend), form(erhoeht), form(normal)];
    expect(formen, 'jede Stufe braucht eine Form').not.toContain(undefined);
    expect(new Set(formen).size, 'drei Stufen, drei Formen').toBe(3);
  });

  it('das Zeichen im Kachelkopf bleibt stumme Deko — es trägt keine Stufe', async () => {
    // Gegenaussage zum Test darüber: der Marker im Kachelkopf ist Gestaltung,
    // kein Status. Bekäme er im selben Zug eine Stimme, stünde in jeder Kachel
    // ein bedeutungsloses Vorleseziel — derselbe Fehler, den CLAUDE.md an
    // `AmpelZelle` beschreibt, nur andersherum.
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    const kopf = screen.getByRole('heading', { name: 'Meldungen (eingehend)' }).parentElement!;
    const deko = kopf.querySelector('.lfh-zeichen')!;
    expect(deko).toHaveAttribute('aria-hidden', 'true');
    expect(deko).not.toHaveAttribute('aria-label');
    expect(within(kopf).queryByRole('img')).toBeNull();
  });

  // Die zweite Hälfte von AK2: ohne sie wäre „mindestens eine Zeile" auch dann
  // erfüllt, wenn der Leerzustand genauso aussieht.
  it('ohne Aufträge zeigt die Kachel den Leerzustand und KEINE Zeile', async () => {
    // Befund M8 (Abschluss-Review): der zugängliche Name einer Zeile ist ihr
    // Inhalt (lfd. Nr. + Auftragstext + Frist) — eine Regex auf /Auftrag/ träfe
    // z. B. `auftrag_text: 'Deich sichern'` nie und wäre auch dann grün gewesen,
    // wenn Zeilen gerendert würden. Geprüft wird deshalb, dass innerhalb DIESER
    // Kachel (gescopt über den Leertext) gar kein Link steht.
    mockEndpunkte({ personen: [person('sk3')], auftraege: [] });
    render();
    await kennzahlGeladen('Vermisst');
    const leerText = await screen.findByText('Keine offenen Aufträge.');
    const kachel = leerText.closest<HTMLElement>('section.lfh-kachel');
    if (kachel == null) throw new Error('Aufträge-Kachel nicht gefunden');
    expect(within(kachel).queryAllByRole('link')).toHaveLength(0);
  });

  // DER FALL, DER OHNE DIESEN TEST DURCHRUTSCHT. `leer` hing am ROHEN Response,
  // die Zeilen am gefilterten. Drei vollzogene Aufträge hießen also: nicht leer,
  // aber auch keine Zeile — die Kachel zeigte einen leeren Kasten. Ein Test mit
  // `auftraege: []` erfüllt sich am trivialen Fall und sieht das nicht.
  it('sind alle Aufträge vollzogen, zeigt die Kachel den Leerzustand statt eines leeren Kastens', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 1, lfd_nr: 1, bearbeitungsstatus: 'vollzogen' }),
        auftrag({ id: 2, lfd_nr: 2, bearbeitungsstatus: 'abgenommen' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText('Keine offenen Aufträge.')).toBeInTheDocument();
  });

  // I1 (LFH-336-Review): Zählung (`ist_ueberfaellig`) und Zeilenfilter
  // (`bearbeitungsstatus`) laufen im Backend über unabhängige Kriterien
  // (src/auftrag/repo.rs:73-76) — ein VOLLZOGENER Auftrag mit unquittiertem
  // Empfänger und abgelaufener Frist ist trotzdem überfällig. Ohne diesen Test
  // verschwindet die Alarm-Plakette lautlos im selben Moment, in dem der
  // Leertext einblendet.
  it('sind alle Aufträge vollzogen und einer davon überfällig, bleibt die Überfällig-Plakette sichtbar', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 1, lfd_nr: 1, bearbeitungsstatus: 'vollzogen', ist_ueberfaellig: true }),
        auftrag({ id: 2, lfd_nr: 2, bearbeitungsstatus: 'abgenommen' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.queryByText('Keine offenen Aufträge.')).not.toBeInTheDocument();
    expect(await screen.findByText('1 überfällig')).toBeInTheDocument();
  });

  it('sind alle Meldungen erledigt, zeigt die Kachel den Leerzustand', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      meldungen: [meldung({ id: 1, lfd_nr: 1, ist_offen: false, status: 'erledigt' })],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText('Keine offenen Meldungen.')).toBeInTheDocument();
  });

  // I1, Meldungen-Spiegel: `ist_ueberfaellig` (bestaetigung_pflicht AND
  // quittiert_at IS NULL AND frist <= jetzt, src/meldung/repo.rs:42-43) ist von
  // `ist_offen`/`status` unabhängig — eine erledigte Meldung kann trotzdem
  // überfällig sein.
  it('sind alle Meldungen erledigt und eine davon überfällig, bleibt die Überfällig-Plakette sichtbar', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      meldungen: [
        meldung({ id: 1, lfd_nr: 1, ist_offen: false, status: 'erledigt', ist_ueberfaellig: true }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.queryByText('Keine offenen Meldungen.')).not.toBeInTheDocument();
    expect(await screen.findByText('1 überfällig')).toBeInTheDocument();
  });

  it('die Kurzliste der Aufträge zeigt die fristnächsten zuerst', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 1, lfd_nr: 1, auftrag_text: 'Spaet', frist_at: '2026-06-11 20:00:00' }),
        auftrag({ id: 2, lfd_nr: 2, auftrag_text: 'Frueh', frist_at: '2026-06-11 10:00:00' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    const zeilen = await screen.findAllByRole('link', { name: /Frueh|Spaet/ });
    expect(zeilen[0]).toHaveTextContent('Frueh');
  });

  it('der Lagebericht zeigt einen Auszug der Lage, nicht nur Titel und Status', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      lageberichte: [
        {
          id: 3, einsatz_id: 1, titel: 'Lage 14:00', status: 'freigegeben',
          zeitstand: '2026-06-11 14:00:00', ersteller_id: 1, ersteller_name: 'Muster',
          erstellt_at: '2026-06-11 14:00:00', aktualisiert_at: '2026-06-11 14:00:00',
          version: 1, vorlage: 'lagebericht',
          abschnitte: [{ schluessel: 'gefahren_schadenlage', text: 'Pegel bei 6,20 m, weiter steigend.' }],
        },
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText(/Pegel bei 6,20 m/)).toBeInTheDocument();
  });

  it('FEHLER SIEHT NICHT AUS WIE LEER: der Gefahren-Ausfall zeigt „?", nicht „0"', async () => {
    // Der Sweep-Befund, um den es geht: eine tote Abfrage rendert heute denselben
    // Leerzustand wie „nichts vorhanden". Wer daraus eine Lage funkt, funkt falsch.
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    await kennzahlGeladen('Höchste Warnstufe');
    const warnstufe = kennzahl('Höchste Warnstufe');
    expect(warnstufe).toHaveTextContent('?');
    expect(warnstufe).toHaveTextContent('Stand unbekannt');
    // …und ausdrücklich NICHT der Normalfall-Wortlaut.
    expect(warnstufe).not.toHaveTextContent('keine');
  });

  it('ein Teilfehler macht die übrigen Kennzahlen nicht unkenntlich', async () => {
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    await kennzahlGeladen('Patienten SK I–IV');
    // Die Personen-Abfrage lief durch — ihre Zahl bleibt lesbar.
    expect(kennzahl('Patienten SK I–IV')).toHaveTextContent('1');
    expect(kennzahl('Patienten SK I–IV')).not.toHaveTextContent('Stand unbekannt');
  });

  it('die Zustandsliste der Kennzahlen deckt jede Kennzahl ab', async () => {
    // Seite und `baueLagebild` führen zwei parallele Listen (Kennzahl ↔ Zustand).
    // Läuft eine der beiden aus dem Takt, zeigt eine Kennzahl den Zustand einer
    // anderen — ohne Fehler, ohne roten Test. Deshalb dieser Vergleich.
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await kennzahlGeladen('Patienten SK I–IV');
    const etiketten = [
      'Kräfte F/UF/M//Σ',
      'Patienten SK I–IV',
      'Vermisst',
      'Höchste Warnstufe',
      'Schäden offen',
      'UHS aktiv',
    ];
    for (const e of etiketten) expect(kennzahl(e)).toBeInTheDocument();
  });

  it('die Leiste trägt genau 6 Kennzahlen in fester Reihenfolge', async () => {
    // Der Nachbartest darüber prüft VORHANDENSEIN (auch bei Teilfehlern). Dieser
    // prüft ANZAHL und ORDNUNG — zwei verschiedene Befunde, die nicht zu einem
    // verschmolzen werden dürfen.
    //
    // Warum die Anzahl gepinnt ist: „überfällige Aufträge" wären der Kandidat für
    // eine siebte Kennzahl. Sie bleiben die Alarm-Plakette der Aufträge-Kachel.
    // Sieben Kennzahlen ergäben am Handschirm bei 2 Spalten 4 statt 3 Zeilen.
    //
    // Warum die Reihenfolge gepinnt ist: Prüfliste Kriterium 9 verlangt, dass
    // dieselbe Größe in jedem Zustand an derselben Stelle steht. Nach
    // Dringlichkeit umsortieren ist deshalb ausdrücklich verboten — wer eine Lage
    // funkt, sucht die Zahl an ihrem Platz, nicht in einer Rangliste.
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await kennzahlGeladen('Patienten SK I–IV');

    const knoepfe = Array.from(document.querySelectorAll('.lfh-kennzahlen .lfh-kz'));
    expect(knoepfe).toHaveLength(6);
    const etiketten = knoepfe.map((k) => k.querySelector('.lfh-etikett')?.textContent);
    expect(etiketten).toEqual([
      'Kräfte F/UF/M//Σ',
      'Patienten SK I–IV',
      'Vermisst',
      'Höchste Warnstufe',
      'Schäden offen',
      'UHS aktiv',
    ]);
  });

  it('die Stufenkante hängt an der Kennzahl, die sie meint', async () => {
    // Die Kante ist der zweite Kanal nach WCAG 1.4.1 (`sprache.css`, Block
    // `.lfh-kz--alarm`/`--achtung`). Geprüft werden KLASSENNAMEN, nicht Geometrie:
    // Vitest fährt mit `css: false`, und jsdom rechnet kein Layout — die Regel
    // hätte hier keine Wirkung. Dass sie WIRKT, belegt `e2e/lage-dashboard-schmal.spec.ts`.
    //
    // NICHT geprüft (und bewusst so): die Bedingung `z === 'daten'` in
    // `LageDashboardPage.tsx`, die im Fehlerzustand jede Stufenfarbe unterdrückt.
    // Sie ist über die Endpunkte nicht auslösbar — jede Kennzahl zieht Wert UND
    // Stufe aus derselben Abfrage, und fällt die aus, ist die Stufe ohnehin
    // `normal`. Ein Test darauf wäre grün durch Konstruktion. Der Schutz bleibt
    // trotzdem richtig, sobald eine Kennzahl einmal aus zwei Quellen speist.
    mockEndpunkte({
      personen: [person(null, 'vermisst')],
      gefahren: [{ hoechste_warnstufe: 'mittel' }],
    });
    render();
    await kennzahlGeladen('Vermisst');

    expect(kennzahl('Vermisst').className).toContain('lfh-kz--alarm');
    expect(kennzahl('Höchste Warnstufe').className).toContain('lfh-kz--achtung');
    // Kräfte tragen keine Bewertung — eine Stärke ist keine Gefahrenmeldung.
    expect(kennzahl('Kräfte F/UF/M//Σ').className).not.toContain('lfh-kz--');
  });

  it('Warnstufe „niedrig" hebt nicht ab und trägt den Wortlaut als zweiten Kanal', async () => {
    // Entscheidung des Pakets, hier festgenagelt: `niedrig` bleibt Rolle `normal`.
    // Das Alarmbudget (EEMUA 191 / ISA-18.2, ≤ 3 Eskalationsstufen) trägt die
    // Entscheidung fachlich — eine niedrige Warnstufe ist definitionsgemäß kein
    // Alarmbeitrag —, und der zweite Kanal nach WCAG 1.4.1 ist bei dieser Kennzahl
    // der ausgeschriebene Wortlaut, nicht die Kante.
    //
    // Der Pin auf die Karte ist der eigentliche Ertrag: `statusFarben.ts` ist der
    // app-weite Vertrag mit vielen Konsumenten. Ein stilles Umhängen von `niedrig`
    // auf `achtung` bräche heute NICHTS — es färbte nur jede Anzeige der Warnstufe
    // in der ganzen Anwendung um. Ab hier färbt es diesen Test rot.
    expect(warnstufeKennzahl.niedrig.rolle).toBe('normal');
    expect(warnstufeKennzahl.niedrig.label).toBe('niedrig');

    mockEndpunkte({ gefahren: [{ hoechste_warnstufe: 'niedrig' }] });
    render();
    await kennzahlGeladen('Höchste Warnstufe');
    const knopf = kennzahl('Höchste Warnstufe');
    expect(knopf).toHaveTextContent('niedrig');
    expect(knopf.className).not.toContain('lfh-kz--');
  });

  /**
   * R1 (LFH-331 · B3). Solange der Einsatz-Abruf läuft, stand die Leiste leer und
   * sechs Kennzahlen sprangen danach herein — die Weiche je Kennzahl („····" / „?")
   * konnte nicht greifen, weil es die Knöpfe noch gar nicht gab.
   *
   * Die sechs Etiketten sind hier als LITERALE aufgeschrieben, genau wie im
   * Ordnungstest darüber. Das ist der Sinn: die Liste in der Seite und die in
   * `lagebild.ts` hängen jetzt beide an derselben handgeschriebenen Reihe — läuft
   * eine der beiden aus dem Takt, wird eine der beiden Prüfungen rot.
   *
   * NICHT geprüft, weil jsdom kein Layout rechnet: dass die Plätze auch WIRKLICH
   * dieselbe Höhe reservieren (Prüfliste Kriterium 12, CLS ≤ 0,1). Belegt wird hier
   * die Anzahl, die Ordnung und der Wortlaut — die Höhe misst `e2e/gate1-ueberlauf.spec.ts`.
   */
  it('die Kennzahlenleiste stellt schon während des Einsatz-Abrufs sechs Plätze', async () => {
    mockEndpunkte({ einsatzLaedt: true });
    render();
    const plaetze = Array.from(document.querySelectorAll('.lfh-kennzahlen .lfh-kz'));
    expect(plaetze).toHaveLength(6);
    expect(plaetze.map((k) => k.querySelector('.lfh-etikett')?.textContent)).toEqual([
      'Kräfte F/UF/M//Σ',
      'Patienten SK I–IV',
      'Vermisst',
      'Höchste Warnstufe',
      'Schäden offen',
      'UHS aktiv',
    ]);
    // Kein Platz behauptet einen Stand, solange keiner abgerufen ist.
    for (const p of plaetze) expect(p.textContent).toContain('wird abgerufen');
  });

  /**
   * R2 — der Einsatzname im Band zeigte während des Abrufs einen Gedankenstrich, also
   * dasselbe Zeichen, das anderswo „kein Wert" bedeutet. Beide Hälften sind POSITIV
   * formuliert: „wird abgerufen" steht im Ladezustand siebenmal auf der Seite (Band
   * plus sechs Plätze), ein Griff über den sichtbaren Text wäre mehrdeutig, und eine
   * Negativ-Zusicherung auf „—" beliebig erfüllbar.
   */
  it('das Band nennt während des Abrufs den Ladezustand', async () => {
    mockEndpunkte({ einsatzLaedt: true });
    render();
    expect(document.querySelector('.lfh-band .lfh-band__titel')?.textContent).toBe('wird abgerufen');
  });

  /**
   * I2 (LFH-336-Review). `zustand` hing an `zustandVon(auftraegeQuery)` — also
   * NUR an der Aufträge-Abfrage —, während `leer` an `lagebild` hing, das erst
   * nach dem Einsatz-Abruf existiert. Löst die Aufträge-Query auf, während
   * `/api/einsaetze/1` noch hängt (kein Kunstprodukt: `api/queryClient.ts:10-12`
   * wiederholt Netzfehler zweimal mit bis zu 30 s Backoff), galt `zustand ===
   * 'daten'` UND `leer === true` gleichzeitig — die Kachel behauptete „Keine
   * offenen Aufträge.“, obwohl welche vorliegen.
   *
   * Gewartet wird auf den QueryClient-Status der Aufträge-Abfrage selbst (nicht
   * auf einen sichtbaren Text) — genau das ist der Zustand, den `kennzahlGeladen`
   * hier nicht liefern kann: die Kennzahlenleiste hängt am Lagebild und damit am
   * (hier absichtlich hängenden) Einsatz-Abruf.
   */
  it('während der Einsatz-Abruf hängt, bleibt die Aufträge-Kachel im Ladezustand statt „Keine offenen Aufträge." zu zeigen', async () => {
    mockEndpunkte({
      einsatzLaedt: true,
      auftraege: [auftrag({ id: 1, lfd_nr: 1 })],
    });
    const { client } = render();
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.auftraege(1))?.status).toBe('success'),
    );
    expect(screen.queryByText('Keine offenen Aufträge.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aufträge / Befehle wird geladen')).toBeInTheDocument();
  });

  // I2, Meldungen-Spiegel derselben Falle.
  it('während der Einsatz-Abruf hängt, bleibt die Meldungen-Kachel im Ladezustand statt „Keine offenen Meldungen." zu zeigen', async () => {
    mockEndpunkte({
      einsatzLaedt: true,
      meldungen: [meldung({ id: 1, lfd_nr: 1 })],
    });
    const { client } = render();
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.meldungen(1))?.status).toBe('success'),
    );
    expect(screen.queryByText('Keine offenen Meldungen.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Meldungen (eingehend) wird geladen')).toBeInTheDocument();
  });

  // I2, Lagebericht: derselbe Fehler bestand hier schon vor LFH-336; er wird im
  // selben Zug behoben, weil die Datei ohnehin angefasst wird.
  it('während der Einsatz-Abruf hängt, bleibt die Lagebericht-Kachel im Ladezustand statt „Noch kein Lagebericht erstellt." zu zeigen', async () => {
    mockEndpunkte({
      einsatzLaedt: true,
      lageberichte: [
        {
          id: 3,
          einsatz_id: 1,
          titel: 'Lage 14:00',
          status: 'freigegeben',
          zeitstand: '2026-06-11 14:00:00',
          ersteller_id: 1,
          ersteller_name: 'Muster',
          erstellt_at: '2026-06-11 14:00:00',
          aktualisiert_at: '2026-06-11 14:00:00',
          version: 1,
          vorlage: 'lagebericht',
          abschnitte: [],
        },
      ],
    });
    const { client } = render();
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.lageberichte(1))?.status).toBe('success'),
    );
    expect(screen.queryByText('Noch kein Lagebericht erstellt.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aktueller Lagebericht wird geladen')).toBeInTheDocument();
  });

  it('das Band nennt nach dem Abruf den Einsatz', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Patienten SK I–IV');
    expect(document.querySelector('.lfh-band .lfh-band__titel')?.textContent).toBe(
      'Hochwasser Musterstadt',
    );
  });

  // AK1 (LFH-336): der frühere `<Tag color="blue">Live</Tag>` war statisch; sein
  // Nachfolger im Band hing an QUERY-Fehlern und meldete bei totem SSE weiter
  // „Live verbunden". Beide Zweige gehören geprüft — nur der Abriss-Zweig allein
  // wäre auch dann grün, wenn das Band NIE „Live" sagt.
  it('das Band meldet die Live-Verbindung, solange sie steht', async () => {
    setzeLiveStatusFuerTest('open');
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.getByText('Live verbunden')).toBeInTheDocument();
  });

  it('bei abgerissener Live-Verbindung meldet das Band NICHT „Live"', async () => {
    setzeLiveStatusFuerTest('lost');
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.queryByText('Live verbunden')).not.toBeInTheDocument();
    expect(screen.getByText('Verbindung unterbrochen')).toBeInTheDocument();
  });

  it('während des Wiederverbindens meldet das Band den Zwischenstand', async () => {
    setzeLiveStatusFuerTest('connecting');
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.getByText('Verbindung wird aufgebaut')).toBeInTheDocument();
  });

  /**
   * R3 — das AK4-Partnerpaar. Die Seite trug beide Zustände seit LFH-352 im Code,
   * aber keinen Beleg: dass eine Umsetzung steht, hieß nie, dass sie belegt ist.
   *
   * Nur die Personen-Abfrage fällt aus. Damit ist genau EINE Kachel im Fehlerzustand,
   * und „Daten nicht abrufbar" bleibt eindeutig greifbar — bei einem Sammelausfall
   * stünde der Satz sechsmal da und der Griff wäre mehrdeutig.
   */
  it('bei gescheitertem Personen-Abruf zeigt die Kachel den Fehler und NICHT den Leertext', async () => {
    mockEndpunkte({ personenStatus: 500 });
    render();
    expect(await screen.findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Personen erfasst.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Person aufnehmen' })).not.toBeInTheDocument();
  });

  it('bei leerem Personenbestand zeigt die Kachel den Leertext und KEINEN Fehler', async () => {
    mockEndpunkte({});
    render();
    expect(await screen.findByText('Noch keine Personen erfasst.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Person aufnehmen' })).toBeInTheDocument();
    expect(screen.queryByText('Daten nicht abrufbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});

/**
 * Quellpins auf `theme/sprache.css`.
 *
 * Gelesen wird über `node:fs`, NICHT über einen Import und NICHT über
 * `import.meta.glob(…?raw)`: Vitest fährt mit `css: false`, und beides lieferte
 * dann den Leerstring — der Pin wäre inhaltsleer grün. Dieselbe Mechanik nutzt
 * `components/EinsatzSeite.test.tsx`; sie ist bewusst kopiert und nicht geteilt,
 * damit nicht zwei Testdateien an einer Hilfsfunktion hängen.
 */
describe('Die Kennzahlenleiste in sprache.css', () => {
  const hier = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(hier, '..', '..', 'theme', 'sprache.css'), 'utf-8');

  /** Der Rumpf der ersten Regel für `wahl` ab Position `ab`. */
  function regel(wahl: string, ab = 0): string {
    const start = css.indexOf(wahl, ab);
    expect(start, `Selektor ${wahl} steht nicht in sprache.css`).toBeGreaterThanOrEqual(0);
    const auf = css.indexOf('{', start);
    const zu = css.indexOf('}', auf);
    return css.slice(auf + 1, zu);
  }

  it('keine harte min-height mehr in sprache.css — die Hoehen lesen die Staffel', () => {
    /**
     * LFH-370 · B5j. Vorher trugen drei Blöcke Pixelwerte, und nur EINER band:
     *  - `.lfh-kz` 62 px — gemessen wirkungslos (Inhalt ergibt 81,9 / 99,9 / 119,9 px),
     *  - `.lfh-knopf` 32 px — band, gemessen 32/32/32 über alle drei Stufen,
     *  - `.lfh-kachel__mehr` gar nichts, bei 19,6 px gerendert.
     *
     * Die tragende Zusicherung ist NICHT „keine Pixel", sondern „genau
     * `--lfh-zeilenhoehe`": ein Wechsel auf irgendeine andere Custom Property wäre
     * ebenfalls pixelfrei und läse trotzdem die falsche Stufe.
     */
    for (const wahl of ['.lfh-kz {', '.lfh-knopf {', '.lfh-kachel__mehr {']) {
      expect(regel(wahl), `${wahl} liest die Dichte-Staffel`).toMatch(
        /min-height:\s*var\(--lfh-zeilenhoehe\)/,
      );
    }
    // Und keine harte Mindesthöhe mehr in der ganzen Datei — sonst wandert der
    // nächste Pixelwert einfach in einen vierten Block.
    expect(css, 'sprache.css trägt keine harte min-height mehr').not.toMatch(/min-height:\s*\d/);
  });

  it('der Blank-Reset steht VOR der Kachel-Ausgangsregel — sonst sind deren Schriftangaben tot', () => {
    /**
     * Gemessener Kaskadenfehler: `.lfh-knopf-blank { font: inherit }` stand NACH
     * `.lfh-kachel__mehr` bei gleicher Spezifität. `font` ist eine Kurzform und setzt
     * font-size UND font-weight mit zurück — der einzige Navigationsausgang jeder Kachel
     * rendete deshalb mit 13,5 / 15 px bei Gewicht 400 statt der dort verlangten 11,5 / 600,
     * also größer und dünner als der Kacheltitel über ihm.
     *
     * Ein Test auf „font-size steht im Block" fiele darauf herein — er stand ja da. Nur die
     * REIHENFOLGE ist die Aussage.
     */
    expect(css.indexOf('.lfh-knopf-blank {')).toBeLessThan(css.indexOf('.lfh-kachel__mehr {'));
  });

  it('die Spaltenstaffel der Kennzahlenleiste steht in sprache.css: 6 → 3 → 2', () => {
    // DIE SCHWELLEN SIND CONTAINER-BREITEN, nicht Viewport-Breiten — `.lfh-flaeche`
    // trägt `container-type: inline-size`. Im Browser nachgemessen (LFH-329 · B1):
    // Viewport 1366 → Container 1036 · 1024 → 694 · 390 → 366.
    //
    // Dieser Pin ist der einzige Schutz der 1100er-Schwelle: keine der drei
    // e2e-Prüfbreiten läge nach einer Senkung auf 1000 in einem anderen Band, die
    // Senkung liefe also durch. Gemessen brauchen sechs Spalten mindestens
    // ~1036 px Container (Container 950 → 14 px Etikettenüberlauf, 1036 → 0 px);
    // 1100 ist die nächste Schwelle darüber, die Luft lässt. Wer sie senkt, misst
    // vorher neu und schreibt die Messung in den Kommentar über dem Block.
    expect(regel('.lfh-kennzahlen {')).toMatch(
      /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/,
    );

    const tablet = css.indexOf('@container lfh (max-width: 1100px)');
    expect(tablet, 'Schwelle 1100px fehlt').toBeGreaterThanOrEqual(0);
    expect(regel('.lfh-kennzahlen {', tablet)).toMatch(
      /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    );

    const hand = css.indexOf('@container lfh (max-width: 700px)');
    expect(hand, 'Schwelle 700px fehlt').toBeGreaterThanOrEqual(0);
    expect(regel('.lfh-kennzahlen {', hand)).toMatch(
      /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it('die Stufenregeln der Kennzahl ändern Farbe und Kantenbreite, nicht Schriftgröße oder -schnitt', () => {
    // Die verworfene Alternative, hier festgenagelt: eine stufenabhängige
    // SCHRIFTGRÖSSE ließe die Kennzahlenzeile bei jedem Statuswechsel in der Höhe
    // springen — Festlegung 6 der Bedien-Leitlinie deckelt CLS bei 0,1 (WCAG 3.2.5).
    // Der stufenabhängige SCHNITT ist an dieser Stelle nachweislich leer: in
    // Chromium gemessen liegt die Vorschubbreite der Kennzahl bei 400/500 auf
    // 96,33 px und bei 600/700/800 auf 96,00 px — über 600 hinaus liefert
    // `schriften.css` keinen Schnitt, und der Browser setzt keinen künstlichen
    // Fettdruck. Die Zahl steht bereits auf 600.
    //
    // Was stattdessen trägt: die abgestufte Kante. Sie kostet null Layout
    // (`inset`-Schatten) und unterscheidet die beiden bewerteten Stufen auch ohne
    // Farbe voneinander — vorher taten das nur die Farbwerte.
    const alarm = regel('.lfh-kz--alarm {');
    const achtung = regel('.lfh-kz--achtung {');
    for (const [name, block] of [
      ['alarm', alarm],
      ['achtung', achtung],
      ['alarm/Zahl', regel('.lfh-kz--alarm .lfh-zahl--gross {')],
      ['achtung/Zahl', regel('.lfh-kz--achtung .lfh-zahl--gross {')],
    ] as const) {
      expect(block, `${name}: Schriftgröße gehört nicht in eine Stufenregel`).not.toMatch(
        /font-size/,
      );
      expect(block, `${name}: Schriftschnitt gehört nicht in eine Stufenregel`).not.toMatch(
        /font-weight/,
      );
    }

    const kante = (block: string) => Number(block.match(/inset (\d+)px/)![1]);
    expect(kante(alarm), 'Alarmkante muss breiter sein als die Achtungkante').toBeGreaterThan(
      kante(achtung),
    );

    // Und die Grundgröße der Kennzahl ist unbedingt — genau ein `font-size`.
    expect(regel('.lfh-zahl--gross {').match(/font-size/g)).toHaveLength(1);
  });

  it('die erste Zeile verliert ihre Trennlinie in BEIDEN Bauformen — aber NICHT jede Zeile', () => {
    // Der `<li>`-Wrapper macht `<a class="lfh-zeile">` zum EINZIGEN Kind seines
    // `<li>` und damit selbst zu dessen `:first-child`. Ein UNSKOPIERTES
    // `.lfh-zeile:first-child` träfe dadurch JEDE Zeile, nicht nur die erste der
    // Liste — genau der Rückfall, den die Erweiterung vermeiden soll. Beide Arme
    // müssen deshalb an `.lfh-zeilen >` verankert sein.
    expect(css).toContain('.lfh-zeilen > .lfh-zeile:first-child');
    expect(css).toContain('.lfh-zeilen > li:first-child > .lfh-zeile');
    expect(
      css,
      'ein unskopiertes .lfh-zeile:first-child träfe jede Zeile im <li>-Wrapper',
    ).not.toMatch(/^\.lfh-zeile:first-child/m);
  });
});

describe('Der Dringlichkeitsmarker (LFH-395)', () => {
  const hier = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(hier, '..', '..', 'theme', 'sprache.css'), 'utf-8');
  const quelle = readFileSync(join(hier, 'LageDashboardPage.tsx'), 'utf8');

  /** Der Rumpf der ersten Regel für `wahl`. */
  function regel(wahl: string): string {
    const start = css.indexOf(wahl);
    expect(start, `Selektor ${wahl} steht nicht in sprache.css`).toBeGreaterThanOrEqual(0);
    const auf = css.indexOf('{', start);
    return css.slice(auf + 1, css.indexOf('}', auf));
  }

  it('Form und Farbe liegen auf getrennten Achsen — die Form braucht die Farbe nicht', () => {
    // Das ist die Bedingung, unter der die Form überhaupt ein ZWEITER Kanal ist:
    // eine Formregel, die ihre Statusfarbe selbst mitbrächte, wäre nur eine
    // zweite Schreibweise der ersten. Die Farbe erreicht die Form über
    // `currentColor` — dieselbe Bauform wie in `Tastenkuerzel` (CLAUDE.md).
    const formen = {
      dreieck: regel('.lfh-zeichen--dreieck {'),
      kreis: regel('.lfh-zeichen--kreis {'),
      balken: regel('.lfh-zeichen--balken {'),
    };
    for (const [name, block] of Object.entries(formen)) {
      expect(block, `${name}: eine Formregel trägt keine Statusfarbe`).not.toMatch(
        /var\(--lfh-(alarm|achtung|normal)\)/,
      );
    }
    // Drei Namen sind noch keine drei Formen.
    const rumpf = Object.values(formen).map((b) => b.replace(/\s+/g, ' ').trim());
    expect(new Set(rumpf).size, 'drei Formnamen, drei Geometrien').toBe(3);

    for (const stufe of ['alarm', 'achtung', 'normal'] as const) {
      const block = regel(`.lfh-zeichen--${stufe} {`);
      expect(block, `${stufe}: die Farbe kommt aus der Rolle`).toMatch(
        new RegExp(`color:\\s*var\\(--lfh-${stufe}\\)`),
      );
      expect(block, `${stufe}: Geometrie gehört nicht in eine Farbregel`).not.toMatch(
        /width|height|border-radius|border-left|border-right|border-bottom/,
      );
    }
  });

  it('jeder Marker der Seite trägt eine Formklasse', () => {
    // Seit LFH-395 trägt `.lfh-zeichen` selbst keine Geometrie mehr — die kommt
    // aus der Formklasse. Ein Marker ohne sie wäre 0 × 0 px und damit spurlos
    // weg: kein Fehler, kein roter Test, nur ein verschwundenes Zeichen.
    const zeilen = quelle.split('\n').filter((z) => z.includes('lfh-zeichen'));
    expect(zeilen.length, 'die Marker der Seite werden nicht mehr gefunden').toBeGreaterThan(0);
    for (const z of zeilen) {
      expect(z.trim(), 'Marker ohne Formklasse').toMatch(/lfh-zeichen--(dreieck|kreis|balken|\$\{)/);
    }
  });
});

describe('Deeplinks des Dashboards (LFH-336 · AK3)', () => {
  const quelle = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'LageDashboardPage.tsx'),
    'utf8',
  );

  it('baut keinen Einsatz-Pfad als Template-Literal — die Builder sind die Quelle', () => {
    // Ein Inline-Pfad umgeht `routing/deeplinks.ts` und damit LFH-25. Er bricht
    // nichts sichtbar: die Seite navigiert weiter, nur an der Registry vorbei.
    expect(quelle).not.toMatch(/`\/einsaetze\/\$\{/);
  });

  it('nutzt den Modul-Builder', () => {
    expect(quelle).toContain('einsatzModulPfad');
  });
});

/**
 * ── STAND DER LAGEBERICHT-KACHEL (LFH-350 · H60) ────────────────────────────────
 *
 * `lagebild.bericht.stand` ist `bericht.zeitstand` — ein UTC-Wirestring ohne
 * Zonenkennung. Die Kachel gab ihn roh aus, also um den Zonenversatz falsch.
 *
 * Formatiert wird in der SEITE, nicht in `lagebild.ts`: die Zone hängt am
 * `EinsatzAnzeigeProvider`, und `baueLagebild` bleibt eine reine Funktion.
 *
 * Die Zone wird AUSDRÜCKLICH gestellt und der Cache dafür VORBELEGT — beides ist gemessen
 * nötig: (1) ohne Provider fällt `useAnzeigeKonventionen` auf `DEFAULT_KONVENTIONEN` und
 * damit auf die LOKALE Zone der ausführenden Maschine zurück; (2) nur den Provider
 * einzuhängen genügt nicht, weil die Einstellungs-Abfrage ERST NACH dem ersten Render
 * auflöst — die Behauptung hat dann längst getroffen, und auf einem Berliner Rechner wäre
 * der Test auch mit `zeitzone: 'UTC'` grün geblieben (Gegenprobe gefahren). `setQueryData`
 * stellt die Zone vor dem ersten Render; der MSW-Handler bedient nur den Refetch.
 */
function renderMitZone() {
  server.use(
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  // Bewusst NICHT `neuerQueryClient()`: dessen `gcTime: 0` räumt einen per `setQueryData`
  // gesetzten, noch unbeobachteten Eintrag beim ersten `await` weg (CLAUDE.md,
  // Query-Key-Registry). Hier hinge die Zone dann still wieder am MSW-Refetch.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 },
  });
  return renderMitProviders(
    <EinsatzAnzeigeProvider einsatzId={1}>
      <Routes>
        <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      </Routes>
    </EinsatzAnzeigeProvider>,
    { route: '/einsaetze/1/lage-dashboard', client },
  );
}

describe('LageDashboardPage — Stand des Lageberichts (LFH-350 · H60)', () => {
  it('zeigt den Stand als taktische DTG in der Anzeigezone, nicht roh', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      lageberichte: [
        {
          id: 3, einsatz_id: 1, titel: 'Lage 14:00', status: 'freigegeben',
          zeitstand: '2026-07-25 12:00:00', ersteller_id: 1, ersteller_name: 'Muster',
          erstellt_at: '2026-07-25 12:00:00', aktualisiert_at: '2026-07-25 12:00:00',
          version: 1, vorlage: 'lagebericht',
          abschnitte: [{ schluessel: 'gefahren_schadenlage', text: 'Pegel steigend.' }],
        },
      ],
    });
    renderMitZone();
    await kennzahlGeladen('Vermisst');
    // 12:00 UTC → 14:00 Sommerzeit in Berlin.
    expect(await screen.findByText('251400JUL2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});
