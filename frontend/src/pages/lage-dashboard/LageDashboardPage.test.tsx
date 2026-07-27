import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import LageDashboardPage from './LageDashboardPage';
import type { Auftrag, Meldung } from '../../api/types';

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
}

function mockEndpunkte(d: Daten) {
  const json = (arr?: unknown[]) => HttpResponse.json(arr ?? []);
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/personen', () => json(d.personen)),
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
    expect(await screen.findByText('Höchste Warnstufe')).toBeInTheDocument();
    expect(kennzahl('Höchste Warnstufe')).toHaveTextContent('keine');
    expect(kennzahl('Vermisst')).toHaveTextContent('keine offenen Fälle');
  });

  it('Leerzustand führt zu einer Aktion, statt nur leer zu sein', async () => {
    mockEndpunkte({});
    render();
    expect(await screen.findByText('Keine Aufträge erteilt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auftrag erteilen' })).toBeInTheDocument();
    expect(screen.getByText('Noch keine Personen erfasst.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Person aufnehmen' })).toBeInTheDocument();
  });

  it('Deep-Link: Klick auf die Patienten-Kennzahl navigiert ins Personen-Modul', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await screen.findByText('Patienten SK I–IV');
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

  it('FEHLER SIEHT NICHT AUS WIE LEER: der Gefahren-Ausfall zeigt „?", nicht „0"', async () => {
    // Der Sweep-Befund, um den es geht: eine tote Abfrage rendert heute denselben
    // Leerzustand wie „nichts vorhanden". Wer daraus eine Lage funkt, funkt falsch.
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    await screen.findByText('Höchste Warnstufe');
    const warnstufe = kennzahl('Höchste Warnstufe');
    expect(warnstufe).toHaveTextContent('?');
    expect(warnstufe).toHaveTextContent('Stand unbekannt');
    // …und ausdrücklich NICHT der Normalfall-Wortlaut.
    expect(warnstufe).not.toHaveTextContent('keine');
  });

  it('ein Teilfehler macht die übrigen Kennzahlen nicht unkenntlich', async () => {
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    await screen.findByText('Patienten SK I–IV');
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
    await screen.findByText('Patienten SK I–IV');
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
});
