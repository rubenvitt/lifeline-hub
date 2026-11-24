import { theme as antdTheme } from 'antd';
import { rollenFarbe } from '../../theme/statusFarben';
import { farbenHell } from '../../theme/tokens';
import { delay, http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { meHandler, server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { benutzerFixture, freigabenFixture } from '../../test/fixtures';
import type { ModulFreigabe } from '../../api/types';
import { leseZuletztModule } from '../../einsatz/zuletztModule';
import { GLIEDERUNG_KLASSE } from '../../components/instrument';
import UeberblickPage from './UeberblickPage';
import { einsatzKeys } from '../../api/queryKeys';
import { saveStartlisteAusgeblendet } from './startlisteSpeicher';
import { pruefeKachelGrenzen } from '../../test/kachelWaechter';

/** Quelle und Modul heißen wie ihr Datenschlüssel, der Pfad ist englisch (ADR-0085). */
const API_SEGMENT: Record<string, string> = {
  einheiten: 'units',
  personal: 'personnel',
  fahrzeuge: 'vehicles',
};

dayjs.extend(utc);

/**
 * Feste Uhr statt echter (LFH-772): die Seite rechnet mit `dayjs()` und zeigt Zeiten
 * tagesbewusst („HH:mm" heute, „DD. HH:mm" sonst). Relativ zur echten Uhr lag `vor(20)`
 * zwischen 00:00 und 00:20 am Vortag, und die Erwartung „nur HH:mm" war rot. Mittag UTC hält
 * jede Fixture (−300 … +120 min) in UTC und Europe/Berlin am selben Tag wie „jetzt".
 * Nur `Date` steht still (`toFake`): MSW, react-query und `findBy*` laufen auf echten Timern.
 */
const JETZT = new Date('2026-09-13T12:00:00Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
});
afterEach(() => vi.useRealTimers());

/** Fixtures relativ zu `JETZT` — dieselbe Uhr, mit der die Seite tickt. Wire: UTC ohne Zone. */
const vor = (min: number) => dayjs.utc(JETZT).subtract(min, 'minute').format('YYYY-MM-DD HH:mm:ss');
const nach = (min: number) => dayjs.utc(JETZT).add(min, 'minute').format('YYYY-MM-DD HH:mm:ss');

const einsatz = {
  id: 1,
  bezeichnung: 'Hochwasser Weserlauf',
  status: 'aktiv',
  begonnen_at: vor(300),
  angelegt_at: vor(300),
  einsatzart: 'realeinsatz',
  org_id: 1,
  org_name: 'THW',
  meine_sachgebiete: [],
  meine_rolle: 'fuehrungspersonal',
  naechste_lagebesprechung_at: nach(120),
};

const person = (id: number, erfasst_at: string) => ({
  id,
  einsatz_id: 1,
  registrier_nr: id,
  status: 'betroffen',
  erfasst_at,
  erfasst_von: 1,
  geaendert_at: erfasst_at,
  geaendert_von: 1,
  aktuelle_sichtung: null,
});

const auftrag = (over: Record<string, unknown>) => ({
  id: 1,
  einsatz_id: 1,
  auftrag_text: 'Deich sichern',
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: vor(30),
  erstellt_at: vor(30),
  erstellt_von_id: 1,
  vollzug_status: 'offen',
  empfaenger_anzahl: 1,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  quell_etb_eintrag_id: null,
  empfaenger: [],
  ...over,
});

const volleDaten = {
  personen: [person(1, vor(10)), person(2, vor(200)), person(3, vor(300))],
  personal: [
    {
      id: 1,
      name: 'A',
      einheit_id: 10,
      staerke_position: 'fuehrer',
      status_kategorie: 'verfuegbar',
    },
    {
      id: 2,
      name: 'B',
      einheit_id: 10,
      staerke_position: 'mannschaft',
      status_kategorie: 'gebunden',
    },
  ],
  fahrzeuge: [
    { id: 1, funkrufname: 'Florian 1', einheit_id: 10, status_kategorie: 'nicht_verfuegbar' },
  ],
  material: [],
  einheiten: [
    {
      id: 10,
      name: 'Zug 1',
      abschnitt_id: 5,
      ueber_einheit_id: null,
      soll: null,
      // Abgeleitet aus dem ausgefallenen Fahrzeug unten.
      status: { quelle: 'fahrzeuge', kategorie: 'nicht_verfuegbar', verteilung: [] },
    },
  ],
  abschnitte: [
    {
      id: 5,
      einsatz_id: 1,
      name: 'Abschnitt Nord',
      leiter_name: 'EA-N · Vitt',
      sortier: 1,
      sprechgruppen: [],
      ueber_abschnitt_id: null,
    },
  ],
  gefahren: [{ id: 1, hoechste_warnstufe: 'hoch' }],
  auftraege: [
    auftrag({ id: 21, auftrag_text: 'Pegel melden', frist_at: nach(90) }),
    auftrag({
      id: 22,
      auftrag_text: 'Trupps verlegen',
      frist_at: vor(15),
      ist_ueberfaellig: true,
      empfaenger: [
        {
          id: 1,
          auftrag_id: 22,
          empfaenger_typ: 'abschnitt',
          snap_anzeige: 'EA-Nord',
          abschnitt_id: 5,
        },
      ],
    }),
    auftrag({
      id: 23,
      auftrag_text: 'Folge A',
      bearbeitungsstatus: 'vollzogen',
    }),
    auftrag({
      id: 24,
      auftrag_text: 'Folge B',
      bearbeitungsstatus: 'vollzogen',
    }),
  ],
  erinnerungen: [
    { id: 3, titel: 'Lagebericht an Kreisstab', faellig_at: nach(20), status: 'offen' },
  ],
  etb: [
    {
      id: 411,
      lfd_nr: 411,
      typ: 'entscheidung',
      ereigniszeit: vor(12),
      received_at: vor(12),
      inhalt: 'Turnhalle Ost wird Notunterkunft.',
      erfasser_id: 1,
      erfasser_name: 'Brandt',
      // Die Zahl kommt aus dem ETB-Eintrag, nicht aus der Auftragsliste: die Aufträge 23/24 tragen
      // bewusst keinen `quell_etb_eintrag_id`, sonst stimmten beide Quellen überein.
      folgeauftraege: [
        { id: 23, lfd_nr: 3 },
        { id: 24, lfd_nr: 4 },
      ],
      // Wie vom Server: leer statt fehlend (LFH-689); eine berichtigte füllt es (LLH-1321).
      berichtigt_durch: [] as { id: number; lfd_nr: number }[],
    },
  ],
  /** Maßgebliche Pegel — im Grundbestand keiner festgelegt. */
  pegel: [] as unknown[],
  /**
   * Modulzähler des Servers (LFH-550): die Kennzahl „Offene Aufträge" liest ihn, nicht die Liste.
   * Passend zur Liste darüber — zwei offen (21, 22), davon einer überfällig.
   */
  zaehler: {
    auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 1 },
    meldungen: {
      offen: 4,
      ungesehen: 2,
      bestaetigung_ueberfaellig: 0,
      sofort_offen: 0,
      dringend_offen: 0,
    },
    nachforderungen: { offen: 3, angefordert: 1, zugesagt: 1, unterwegs: 1, ueberfaellig: 0 },
    erinnerungen: { faellig: 0 },
    lagemeldungen: { neu: 0 },
  } as object,
  /** Nachforderungen (LLH-1078): drei offene und eine eingetroffene, passend zum Zähler. */
  nachforderungen: [
    nachforderung({
      id: 31,
      art: 'RTW',
      bezeichnung: 'RTW für Turnhalle',
      angefordert_at: vor(25),
    }),
    nachforderung({
      id: 32,
      art: 'Sandsäcke',
      anzahl: 2000,
      bezeichnung: 'Deich Nord',
      status: 'unterwegs',
      angefordert_at: vor(95),
    }),
    nachforderung({
      id: 33,
      art: 'SEG',
      bezeichnung: 'Betreuung',
      status: 'zugesagt',
      angefordert_at: vor(50),
    }),
    nachforderung({
      id: 34,
      art: 'GW-L',
      bezeichnung: 'schon da',
      status: 'eingetroffen',
      angefordert_at: vor(200),
    }),
  ] as object[],
};

/** Eine Nachforderung im Drahtformat; nur, was das Paneel liest, ist je Fall gesetzt. */
function nachforderung(over: Record<string, unknown>) {
  return {
    einsatz_id: 1,
    anzahl: null,
    adressat_kategorie: 'leitstelle',
    adressat_bezeichnung: null,
    begruendung: null,
    prioritaet: 'normal',
    status: 'angefordert',
    zugesagt_at: null,
    unterwegs_at: null,
    eingetroffen_at: null,
    abgelehnt_at: null,
    abgelehnt_grund: null,
    etb_nachforderung_id: null,
    erstellt_von_id: 1,
    erstellt_at: vor(200),
    erstellt_von_name: null,
    ist_offen: over.status !== 'eingetroffen' && over.status !== 'abgelehnt',
    material_ids: [],
    zusage_rufnamen: [],
    ...over,
  };
}

/** Rückmeldungen und Zähler sind optional: ohne Angabe liefert der Server eine leere Menge. */
type Daten = Omit<typeof volleDaten, 'zaehler' | 'nachforderungen'> & {
  rueckmeldungen?: object;
  zaehler?: object;
  nachforderungen?: object[];
  /** Offene Meldungen (`?phase=offen`) für „Offene Vorgänge“ (LLH-1145). */
  meldungen?: object[];
  /** ETB-Einträge vom Typ „Lage“ für die Startliste (LLH-1815); ohne Angabe keine. */
  lage?: object[];
};
const KEINE_RUECKMELDUNGEN = { frist_min: 60, einheiten: [], abschnitte: [] };

/** Ein Leitpegel mit frischer Messung (relativ zur echten Uhr, wie die Seite rechnet). */
const leitpegel = (messung: Record<string, unknown> | null) => ({
  id: 1,
  station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
  name: 'HANN. MÜNDEN',
  gewaesser: 'WESER',
  reihenfolge: 0,
  ...(messung ? { messung } : {}),
});

function stelleBereit(d: Daten, ueberschreiben: Parameters<typeof server.use> = []) {
  const json = (x: object) => () => HttpResponse.json(x);
  server.use(
    ...ueberschreiben,
    http.get('/api/einsaetze/1', json(einsatz)),
    http.get('/api/einsaetze/1/persons', json(d.personen)),
    http.get('/api/einsaetze/1/personnel', json(d.personal)),
    http.get('/api/einsaetze/1/vehicles', json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', json(d.material)),
    http.get('/api/einsaetze/1/units', json(d.einheiten)),
    http.get('/api/einsaetze/1/sectors', json(d.abschnitte)),
    http.get('/api/einsaetze/1/hazard-areas', json(d.gefahren)),
    http.get('/api/einsaetze/1/tasks', json(d.auftraege)),
    http.get(
      '/api/einsaetze/1/module-counts',
      json(
        d.zaehler ?? {
          auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
          meldungen: {
            offen: 0,
            ungesehen: 0,
            bestaetigung_ueberfaellig: 0,
            sofort_offen: 0,
            dringend_offen: 0,
          },
          nachforderungen: { offen: 0, angefordert: 0, zugesagt: 0, unterwegs: 0, ueberfaellig: 0 },
          erinnerungen: { faellig: 0 },
          lagemeldungen: { neu: 0 },
        },
      ),
    ),
    http.get('/api/einsaetze/1/resource-requests', json(d.nachforderungen ?? [])),
    http.get('/api/einsaetze/1/reports', json(d.meldungen ?? [])),
    http.get('/api/einsaetze/1/reminders', json(d.erinnerungen)),
    http.get('/api/einsaetze/1/reports/check-ins', json(d.rueckmeldungen ?? KEINE_RUECKMELDUNGEN)),
    http.get('/api/einsaetze/1/gauges', json(d.pegel ?? [])),
    // Laufende Schichten; die Modul-Freigaben (Sichtbarkeit der Ablösung) liefert der
    // MSW-Default: alles frei.
    http.get('/api/einsaetze/1/reliefs', json([])),
    // Perioden der Einheiten für „n ohne Schicht ↗“ (LLH-1312): ohne offene Periode keine.
    http.get('/api/einsaetze/1/units/timeline', json([])),
    http.get('/api/einsaetze/1/etb', ({ request }) => {
      const url = new URL(request.url);
      // Die Seite fragt NUR Entscheidungen und (Startliste, LLH-1815) die jüngste Lage ab — ein
      // Abruf ohne Filter wäre ein Fehler.
      const typ = url.searchParams.get('typ');
      if (typ === 'entscheidung') return HttpResponse.json(d.etb);
      if (typ === 'lage' && url.searchParams.get('limit') === '1') {
        return HttpResponse.json(d.lage ?? []);
      }
      return HttpResponse.json({ error: 'ohne Typfilter' }, { status: 400 });
    }),
  );
}

function Ort() {
  const l = useLocation();
  return <div data-testid="ort">{`${l.pathname}${l.search}`}</div>;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/ueberblick" element={<UeberblickPage />} />
      <Route path="*" element={<Ort />} />
    </Routes>,
    { route: '/einsaetze/1/ueberblick' },
  );
}

/**
 * Der Körper erst nach dem Einsatz-Abruf (LFH-629); sein erstes Element ist die Alarmzeile. Ein
 * Band trägt der Überblick seit LLH-1748 nicht mehr.
 */
const koerperDa = () => screen.findByRole('status', { name: 'Was brennt' });
const keinBand = () => screen.queryByRole('group', { name: 'Führungsstand' });
/** `b` steht im Dokument nach `a`. */
const folgt = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const paneel = (name: string | RegExp) => screen.getByRole('region', { name });
/** Die Warnstufe steht im Seitenkopf wie im Lagebild (LLH-1140), nicht mehr im Band. */
const kopfLage = () => document.querySelector<HTMLElement>('[data-lfh="ueberblick-lage-kopf"]');
/** Paneel „Offene Vorgänge“ (LLH-1145) und einer seiner fünf Abschnitte. */
const vorgaenge = () => paneel('Offene Vorgänge');
const abschnitt = (name: string) => within(vorgaenge()).getByRole('region', { name });
const abschnittZahl = (name: string) =>
  abschnitt(name).querySelector('[data-lfh="abschnitt-zahl"]') as HTMLElement;

/** `#rrggbb` → `rgb(r, g, b)`, wie jsdom Inline-Farben zurückgibt. */
function rgbVon(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
describe('UeberblickPage', () => {
  it('Seitenkopf: Ortspfad mit Einsatzname, Titel und genau eine Primäraktion', async () => {
    stelleBereit(volleDaten);
    rendern();
    expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
    expect(await screen.findByText('Hochwasser Weserlauf')).toBeInTheDocument();
    const aktionen = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    const primaer = Array.from(aktionen.querySelectorAll('button')).filter((b) =>
      b.className.includes('btn-primary'),
    );
    expect(primaer.map((b) => b.textContent)).toEqual(['Eintrag']);
  });

  it('„Eintrag" springt in die ETB-Schnellerfassung, „Lagebericht" zu den Lageberichten', async () => {
    stelleBereit(volleDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintrag' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?neu=1');
  });

  it('„Lagebericht" führt zur Lageberichte-Liste', async () => {
    stelleBereit(volleDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Lagebericht' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/lageberichte');
  });

  it('kein Band: Reihe 1 Nächste Marken | Offene Vorgänge, Reihe 2 Einsatzabschnitte | Entscheidungen (LLH-1748)', async () => {
    stelleBereit(volleDaten);
    rendern();
    await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent('4'));
    // Die Zahlen des früheren Bands stehen in den Paneelen (Spec `lage-verdichtung`, „Überblick
    // führt, Lagebild zeigt die Lage“): keine Kennzahl, kein Band.
    expect(keinBand()).toBeNull();
    expect(document.querySelector('[data-lfh="kennzahl"]')).toBeNull();
    expect(abschnittZahl('Aufträge')).toHaveTextContent('2');
    expect(abschnitt('Aufträge')).toHaveTextContent('1 überfällig');
    const marken = paneel('Nächste Marken');
    const abschnitte = await waitFor(() => paneel('Einsatzabschnitte'));
    const entscheidungen = paneel(/Entscheidungen/);
    expect(marken.closest('[data-lfh="ueberblick-paneele"]')).not.toBeNull();
    expect(vorgaenge().closest('[data-lfh="ueberblick-paneele"]')).not.toBeNull();
    expect(abschnitte.closest('[data-lfh="ueberblick-paneele-gliederung"]')).not.toBeNull();
    expect(entscheidungen.closest('[data-lfh="ueberblick-paneele-gliederung"]')).not.toBeNull();
    // Gestapelt (unter `lg`) gilt die Folge des Dokuments: Fristen zuerst.
    expect(folgt(marken, vorgaenge())).toBe(true);
    expect(folgt(vorgaenge(), abschnitte)).toBe(true);
    expect(folgt(abschnitte, entscheidungen)).toBe(true);
    // Die Zahl der Abschnitte steht im Kopf ihres Paneels.
    expect(abschnitte).toHaveTextContent('1 Abschnitt');
    // Betroffene, Kräfte und Einsatzdauer haben ihre Heimat im Lagebild.
    for (const weg of ['Betroffene', 'Kräfte im Einsatz', 'Einsatzdauer']) {
      expect(screen.queryByText(weg)).toBeNull();
    }
  });

  it('Wächter: jede Kachel des Überblicks steht in ihrer eigenen KachelGrenze (LLH-1958)', async () => {
    stelleBereit(volleDaten);
    const { container } = rendern();
    await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent('4'));
    await waitFor(() => paneel('Einsatzabschnitte'));
    // Alarmzeile und vier Paneele; die Startliste prüft ihr eigener Block.
    pruefeKachelGrenzen(container.querySelector('[data-lfh="ueberblick"]')!, 5);
  });

  it('Alarmzeile „Was brennt“ steht vor den Paneelreihen (LLH-1743)', async () => {
    stelleBereit({
      ...volleDaten,
      personen: [...volleDaten.personen, { ...person(9, vor(30)), status: 'vermisst' }],
    });
    rendern();
    const zeile = await screen.findByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(zeile).toHaveTextContent('1 vermisst'));
    // Der überfällige Auftrag aus dem Modulzähler steht ebenfalls darin.
    expect(zeile).toHaveTextContent('1 Auftrag überfällig');
    expect(within(zeile).getByRole('link', { name: '1 vermisst' })).toHaveAttribute(
      'href',
      '/einsaetze/1/personen?filter=vermisst',
    );
    // Zuerst die Zeile, dann die Fristen (LLH-1748).
    expect(folgt(zeile, await waitFor(() => paneel('Nächste Marken')))).toBe(true);
  });

  it('Seitenkopf springt ins Lagebild (LLH-1743)', async () => {
    stelleBereit(volleDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Lagebild' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/lage-dashboard');
  });

  it('Offene Vorgänge · Meldungen: die überfällige Bestätigung steht in der Notiz, die Zahl aus dem Zähler', async () => {
    stelleBereit({
      ...volleDaten,
      zaehler: {
        auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
        meldungen: {
          offen: 3,
          ungesehen: 1,
          bestaetigung_ueberfaellig: 1,
          sofort_offen: 0,
          dringend_offen: 0,
        },
        nachforderungen: { offen: 0, angefordert: 0, zugesagt: 0, unterwegs: 0, ueberfaellig: 0 },
      },
    });
    rendern();
    await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent('3'));
    expect(abschnitt('Meldungen')).toHaveTextContent('1 Bestätigung überfällig');
  });

  it('Warnstufe im Seitenkopf: Wort und Ton, die offenen Gebiete daneben (LLH-1140)', async () => {
    stelleBereit(volleDaten);
    rendern();
    await waitFor(() => expect(kopfLage()).not.toBeNull());
    const hinweis = kopfLage()!.querySelector('[data-lfh="warnstufe-hinweis"]')!;
    expect(hinweis).toHaveTextContent('Warnstufe hoch');
    // „hoch“ ist Alarm (`warnstufeKennzahl`), wie im Lagebild.
    expect(hinweis).toHaveAttribute('data-ton', 'alarm');
    expect(kopfLage()!.querySelector('[data-lfh="warnstufe-offen"]')).toHaveTextContent(
      '1 unbestätigt',
    );
    // Ohne festgelegten Pegel keine Pegel-Angabe.
    expect(kopfLage()).not.toHaveTextContent(/Pegel/);
  });

  it('ohne Gefahrengebiet kein Warnstufen-Hinweis im Kopf', async () => {
    stelleBereit({ ...volleDaten, gefahren: [] });
    rendern();
    await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent('4'));
    expect(document.querySelector('[data-lfh="warnstufe-hinweis"]')).toBeNull();
  });

  it('Pegel im Seitenkopf: „Pegel 6,84 m steigend" (LFH-606)', async () => {
    stelleBereit({
      ...volleDaten,
      pegel: [
        leitpegel({
          wasserstand_cm: 684,
          zeitpunkt: new Date(Date.now() - 10 * 60_000).toISOString(),
          trend_cm_pro_h: 9.2,
        }),
      ],
    });
    rendern();
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="kopf-pegel"]')).toHaveTextContent(
        'Pegel 6,84 m steigend',
      ),
    );
    await waitFor(() => expect(kopfLage()).toHaveTextContent('Warnstufe hoch'));
  });

  it('Pegel-Ausfall und gescheiterter Pegel-Abruf: „Pegel: Stand unbekannt" im Kopf', async () => {
    stelleBereit({ ...volleDaten, pegel: [leitpegel(null)] });
    const erster = rendern();
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="kopf-pegel"]')).toHaveTextContent(
        'Pegel: Stand unbekannt',
      ),
    );
    erster.unmount();

    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/gauges', () => new HttpResponse(null, { status: 500 })),
    ]);
    rendern();
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="kopf-pegel"]')).toHaveTextContent(
        'Pegel: Stand unbekannt',
      ),
    );
    // Der tote Pegel-Abruf macht die Warnstufe nicht unlesbar.
    await waitFor(() => expect(kopfLage()).toHaveTextContent('Warnstufe hoch'));
  });

  it('Abschnittszeile: Leiter, Stärke, Einheiten nach Status ehrlich beschriftet, Auftrag, Deeplink', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/einsatzabschnitte?abschnitt=5');
    expect(zeile).toHaveTextContent('EA-N · Vitt');
    expect(zeile).toHaveTextContent('1 Einheit');
    expect(zeile).toHaveTextContent('1/0/1//2');
    expect(zeile).toHaveTextContent('Trupps verlegen');
    // Einheiten je Status als Verteilung (LLH-1140): das Wort steht an der Zahl, eine Legende
    // braucht es nicht mehr. Der Linkname trägt Wort und Zahl. Gezählt wird die Einheit nach ihrem
    // Status, nicht ihre Mittel (die ergäben 1/1/1).
    expect(zeile).toHaveAccessibleName(/bereit\s*0/);
    expect(zeile).toHaveAccessibleName(/gebunden\s*0/);
    // LLH-1739: „Ausfall“ zählt das Meldebild an den Mitteln; die Statuszelle heißt danach.
    expect(zeile).toHaveAccessibleName(/nicht verfügbar\s*1/);
    const werte = zeile.querySelectorAll('[data-lfh="abschnitt-status-wert"]');
    expect(Array.from(werte).map((z) => z.textContent)).toEqual(['0', '0', '1']);
    const balken = zeile.querySelectorAll<HTMLElement>('[data-lfh="abschnitt-status-anteil"]');
    expect(Array.from(balken).map((z) => z.style.width)).toEqual(['0%', '0%', '100%']);
    // „gebunden“ trägt die Rolle der Kategorie (neutral), nicht mehr fest Blau und nicht Gelb
    // (Spec `statusrollen`, eon26eat D1): dieselbe Rolle wie im Meldebild.
    // Die Test-Provider rendern mit antds Standard-Token; dieselben Token lösen hier die Rolle auf.
    const standard = antdTheme.getDesignToken();
    // jsdom schreibt Farben mit Leerzeichen, antds Token ohne.
    const gebundenFarbe = balken[1].style.background.replace(/ /g, '');
    expect(gebundenFarbe).toBe(rollenFarbe('neutral', standard).replace(/ /g, ''));
    expect(gebundenFarbe).not.toBe(rollenFarbe('bedien', standard));
    expect(within(p).queryByText(/Einheiten nach Status:/)).toBeNull();
    expect(within(p).getByText('1 Abschnitt · 1 Einheit')).toBeInTheDocument();
    // LLH-1825: die Zeilen sind Links, die Schreibweise erklärt sich deshalb einmal über ihnen —
    // nicht im Kopf-Meta, das auf schmalen Flächen abgeschnitten wird (Review B4).
    const legende = within(p).getByRole('button', { name: /^F\/UF\/M\/\/Σ/ });
    expect(legende.closest('[data-lfh="paneel-meta"]')).toBeNull();
    expect(legende.closest('a')).toBeNull();
    expect(legende.closest('[data-lfh="abschnitt-legende"]')).toHaveTextContent('Stärke F/UF/M//Σ');
    // Die Legende fluchtet mit den Zeilen darunter, statt am Paneelrand zu kleben.
    const ersteZeile = p.querySelector<HTMLElement>('[data-lfh="ueberblick-abschnitt"]');
    const kasten = legende.closest<HTMLElement>('[data-lfh="abschnitt-legende"]');
    expect(kasten?.style.paddingInline).not.toBe('');
    expect(kasten?.style.paddingInline).toBe(ersteZeile?.style.paddingInline);
  });

  it('Abschnittszeile: letzte Rückmeldung im Teilbaum mit Zeit und Text (LFH-610)', async () => {
    const zeit = vor(20);
    stelleBereit({
      ...volleDaten,
      rueckmeldungen: {
        frist_min: 60,
        einheiten: [
          {
            bezug_id: 10,
            meldung_id: 7,
            lfd_nr: 7,
            ereigniszeit: zeit,
            inhalt: 'Verbau hält',
            meldeweg: 'funk',
            faellig_at: nach(40),
          },
        ],
        abschnitte: [],
      },
    });
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    const rueck = await waitFor(() => {
      const el = zeile.querySelector<HTMLElement>('[data-lfh="abschnitt-rueckmeldung"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(rueck).toHaveTextContent('Verbau hält');
    const uhr = dayjs.utc(zeit).local().format('HHmm');
    expect(rueck).toHaveTextContent(uhr);
    // Die Zeit trägt im Linknamen ihre Bedeutung, nicht als nackte Uhrzeit.
    expect(zeile).toHaveAccessibleName(new RegExp(`Letzte Rückmeldung:\\s*${uhr}\\s+Verbau hält`));
    expect(rueck).not.toHaveTextContent('noch keine');
  });

  it('Abschnittszeile „planmäßig“ mit überfälliger Rückmeldung: Zustand bleibt, Alarm-Etikett daneben (LLH-1739)', async () => {
    stelleBereit({
      ...volleDaten,
      abschnitte: [
        { ...volleDaten.abschnitte[0], lagezustand: 'planmaessig' } as Daten['abschnitte'][number],
      ],
      rueckmeldungen: {
        frist_min: 60,
        einheiten: [
          {
            bezug_id: 10,
            meldung_id: 7,
            lfd_nr: 7,
            ereigniszeit: vor(107),
            inhalt: 'Lage unverändert',
            meldeweg: 'funk',
            faellig_at: vor(47),
          },
        ],
        abschnitte: [],
      },
    });
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    const etikett = await waitFor(() => {
      // Der Lagezustand ist ebenfalls ein `Status` (LLH-1779): das Etikett nach dem Wort.
      const el = [
        ...zeile.querySelectorAll<HTMLElement>(
          '[data-lfh="abschnitt-zustand"] [data-lfh="status"]',
        ),
      ].find((s) => /^Rückm\./.test(s.textContent ?? ''));
      expect(el).not.toBeNull();
      return el!;
    });
    expect(etikett).toHaveAttribute('data-ton', 'alarm');
    expect(etikett.textContent).toMatch(/^Rückm\. überfällig seit 4[78] min$/);
    // Der gepflegte Zustand bleibt stehen, Kante normal.
    expect(
      zeile.querySelector('[data-lfh="ueberblick-abschnitt-kante"]')!.getAttribute('data-rolle'),
    ).toBe('normal');
    expect(within(zeile).getByText('planmäßig')).toBeInTheDocument();
  });

  it('Abschnittszeile: ohne geladene Rückmeldungen kein Rückmeldungs-Etikett (LLH-1739)', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/reports/check-ins', () =>
        HttpResponse.json({ error: 'kein Zugriff' }, { status: 403 }),
      ),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    await waitFor(() => expect(zeile).toHaveTextContent('1/0/1//2'));
    expect(zeile).not.toHaveTextContent(/Rückm\./);
  });

  it('Abschnittszeile: geladen, aber ohne Rückmeldung sagt es ruhig „noch keine"', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    await waitFor(() => expect(zeile).toHaveTextContent('noch keine Rückmeldung'));
  });

  it('Abschnittszeile: ohne Leserecht auf Meldungen (403) nichts erfunden, Paneel bleibt', async () => {
    let abgerufen = false;
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/reports/check-ins', () => {
        abgerufen = true;
        return HttpResponse.json({ error: 'kein Zugriff' }, { status: 403 });
      }),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    await waitFor(() => expect(abgerufen).toBe(true));
    // Der Rest der Zeile steht, kein „Stand unbekannt" für das ganze Paneel.
    await waitFor(() => expect(zeile).toHaveTextContent('1/0/1//2'));
    expect(within(p).queryByRole('alert')).toBeNull();
    expect(zeile.querySelector('[data-lfh="abschnitt-rueckmeldung"]')).toBeNull();
    expect(zeile).not.toHaveTextContent(/Rückmeldung/);
  });

  it('Abschnittszeile mit Lage (LFH-608): Kante, Stufenwort, Kürzel, fester Auftrag, kein Fortschritt (LFH-1208)', async () => {
    stelleBereit({
      ...volleDaten,
      abschnitte: [
        {
          ...volleDaten.abschnitte[0],
          leiter_name: 'Vitt',
          kurzbezeichnung: 'EA-N',
          lagezustand: 'kritisch',
          abschnittsauftrag: 'Deichsicherung km 3,8 – 5,4',
        } as Daten['abschnitte'][number],
      ],
    });
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    // Die Farbe trägt die Kante, das Wort trägt die Aussage (WCAG 1.4.1).
    const kante = zeile.querySelector<HTMLElement>('[data-lfh="ueberblick-abschnitt-kante"]')!;
    expect(kante).toHaveAttribute('data-rolle', 'alarm');
    expect(zeile).toHaveAccessibleName(/kritisch/);
    expect(zeile).toHaveTextContent('EA-N · Vitt');
    // Der feste Auftrag steht vorn; der offene Einzelauftrag bleibt als kleine Zeile.
    expect(zeile).toHaveTextContent('Deichsicherung km 3,8 – 5,4');
    expect(zeile).toHaveTextContent('1 offen · Trupps verlegen');
    // Den Arbeitsstand trägt die Auftragszählung; einen Fortschritt mit Balken und Zahl gibt es
    // nicht (LFH-1208, LLH-1170).
    expect(zeile.querySelector('[data-lfh="abschnitt-fortschritt"]')).toBeNull();
    expect(zeile).not.toHaveTextContent('%');
    expect(zeile).toHaveTextContent('0/1 Aufträge erledigt');
  });

  it('Abschnittszeile meldet einen schlechter beurteilten Unterabschnitt als eigenes Etikett', async () => {
    stelleBereit({
      ...volleDaten,
      abschnitte: [
        { ...volleDaten.abschnitte[0], lagezustand: 'planmaessig' } as Daten['abschnitte'][number],
        {
          ...volleDaten.abschnitte[0],
          id: 6,
          name: 'Deichspitze',
          ueber_abschnitt_id: 5,
          lagezustand: 'kritisch',
        } as unknown as Daten['abschnitte'][number],
      ],
    });
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    expect(
      zeile.querySelector('[data-lfh="ueberblick-abschnitt-kante"]')!.getAttribute('data-rolle'),
    ).toBe('normal');
    expect(within(zeile).getByText('Unterabschnitt kritisch')).toBeInTheDocument();
  });

  it('Abschnittszeile ohne gepflegte Lage: keine Kantenfarbe, kein Balken, Auftrag wie bisher', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    expect(
      zeile.querySelector('[data-lfh="ueberblick-abschnitt-kante"]')!.getAttribute('data-rolle'),
    ).toBeNull();
    expect(zeile.querySelector('[data-lfh="abschnitt-fortschritt"]')).toBeNull();
    expect(zeile).not.toHaveTextContent('%');
    expect(zeile).not.toHaveTextContent(/planmäßig|angespannt|kritisch/);
    expect(zeile).toHaveTextContent('Trupps verlegen');
    expect(zeile).toHaveTextContent('0/1 Aufträge erledigt');
  });

  /*
   * „Offene Vorgänge“ (LLH-1145, Spec `ueberblick-offene-vorgaenge`): fünf Abschnitte in fester
   * Folge, die Zahl aus dem Modulzähler, je die drei dringendsten Einträge mit Deeplink.
   */
  it('Offene Vorgänge: fünf Abschnitte in fester Folge, je mit „alle ↗“ ins Modul', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => vorgaenge());
    const koepfe = within(p).getAllByRole('heading', { level: 3 });
    expect(koepfe.map((k) => k.textContent)).toEqual([
      'Meldungen',
      'Aufträge',
      'Nachforderungen',
      'Erinnerungen',
      'Ablösungen',
    ]);
    expect(within(p).getByRole('link', { name: 'alle Nachforderungen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    expect(within(p).getByRole('link', { name: 'alle Aufträge' })).toHaveAttribute(
      'href',
      '/einsaetze/1/auftraege',
    );
  });

  it('Offene Vorgänge · Aufträge: Zahl aus dem Zähler, überfällige zuerst mit Kante und Wort', async () => {
    stelleBereit(volleDaten);
    rendern();
    await waitFor(() => vorgaenge());
    const a = abschnitt('Aufträge');
    await within(a).findByText('1 überfällig');
    expect(abschnittZahl('Aufträge')).toHaveTextContent(/^2$/);
    expect(a).toHaveTextContent('0 in Arbeit');
    const zeilen = within(a)
      .getAllByRole('link')
      .filter((l) => l.dataset.lfh === 'vorgang-auftrag');
    expect(zeilen.map((z) => z.getAttribute('href'))).toEqual([
      '/einsaetze/1/auftraege?auftrag=22',
      '/einsaetze/1/auftraege?auftrag=21',
    ]);
    expect(zeilen[0]).toHaveAttribute('data-alarm', 'true');
    expect(zeilen[0]).toHaveTextContent('überfällig');
    expect(zeilen[0]).toHaveTextContent('an EA-Nord · Frist');
    expect(zeilen[1]).not.toHaveAttribute('data-alarm');
    expect(zeilen[1]).toHaveTextContent('offen');
    expect(zeilen[1]).toHaveTextContent('ohne Empfänger · Frist');
    expect(zeilen[1]).not.toHaveTextContent('an ohne');
  });

  // LLH-1078 → LLH-1145: Nachforderungen sind ein Abschnitt; Zahl aus dem Modulzähler.
  it('Offene Vorgänge · Nachforderungen: Zahl aus dem Zähler, Bedarfsfolge, Alter, Deeplink', async () => {
    stelleBereit(volleDaten);
    rendern();
    await waitFor(() => vorgaenge());
    const n = abschnitt('Nachforderungen');
    const zeilen = await within(n).findAllByRole('link', { name: /vor/ });
    expect(abschnittZahl('Nachforderungen')).toHaveTextContent(/^3$/);
    expect(n).toHaveTextContent('1 unterwegs');
    // Keine überfällig → ohne Bedarfszeit die älteste Anforderung zuerst; die eingetroffene fehlt.
    expect(zeilen.map((z) => z.getAttribute('href'))).toEqual([
      '/einsaetze/1/nachforderungen?nachforderung=32',
      '/einsaetze/1/nachforderungen?nachforderung=33',
      '/einsaetze/1/nachforderungen?nachforderung=31',
    ]);
    expect(zeilen[0]).toHaveTextContent('vor 1 h 35 min');
    expect(zeilen[0]).toHaveTextContent('2000× Sandsäcke — Deich Nord');
    expect(zeilen[0]).toHaveTextContent('an Leitstelle');
    expect(zeilen[0]).toHaveTextContent('unterwegs');
  });

  it('Offene Vorgänge · Nachforderungen: überfällig aus dem Zähler, Eintrag im Ton „achtung“, ohne Alarmkante', async () => {
    stelleBereit({
      ...volleDaten,
      zaehler: {
        ...volleDaten.zaehler,
        nachforderungen: { offen: 3, angefordert: 1, zugesagt: 1, unterwegs: 1, ueberfaellig: 1 },
      },
      nachforderungen: [
        ...volleDaten.nachforderungen.filter((x) => (x as { id: number }).id !== 33),
        nachforderung({
          id: 33,
          art: 'SEG',
          bezeichnung: 'Betreuung',
          status: 'zugesagt',
          angefordert_at: vor(50),
          eintreffen_erwartet_at: vor(5),
        }),
      ],
    });
    rendern();
    await waitFor(() => vorgaenge());
    const n = abschnitt('Nachforderungen');
    await within(n).findByText('1 überfällig');
    const zeilen = within(n).getAllByRole('link', { name: /vor/ });
    expect(zeilen[0]).toHaveAttribute('href', '/einsaetze/1/nachforderungen?nachforderung=33');
    expect(zeilen[0]).toHaveTextContent('überfällig');
    expect(zeilen[0]).not.toHaveAttribute('data-alarm');
  });

  it('Offene Vorgänge · Meldungen: Bestätigung überfällig zuerst mit Wort, Lagemeldungen in der Notiz', async () => {
    const meldung = (over: Record<string, unknown>) => ({
      einsatz_id: 1,
      inhalt: 'Meldung',
      status: 'gesichtet',
      ist_offen: true,
      bestaetigung_pflicht: false,
      ist_bestaetigt: false,
      ist_ueberfaellig: false,
      eskaliert: false,
      eingang_at: vor(30),
      erfasst_von_id: 1,
      empfaenger_funktion: null,
      ...over,
    });
    stelleBereit({
      ...volleDaten,
      zaehler: {
        ...volleDaten.zaehler,
        meldungen: {
          offen: 4,
          ungesehen: 2,
          bestaetigung_ueberfaellig: 1,
          sofort_offen: 0,
          dringend_offen: 0,
        },
        lagemeldungen: { neu: 3 },
      },
      meldungen: [
        meldung({ id: 51, inhalt: 'Alt', eingang_at: vor(90) }),
        meldung({ id: 52, inhalt: 'Neu jung', status: 'neu', eingang_at: vor(5) }),
        meldung({
          id: 53,
          inhalt: 'Wasser steigt',
          bestaetigung_pflicht: true,
          ist_ueberfaellig: true,
          eingang_at: vor(2),
        }),
        meldung({ id: 54, inhalt: 'Neu alt', status: 'neu', eingang_at: vor(40) }),
      ],
    });
    rendern();
    await waitFor(() => vorgaenge());
    const m = abschnitt('Meldungen');
    const zeilen = await within(m).findAllByRole('link', { name: /Wasser steigt|Neu/ });
    expect(abschnittZahl('Meldungen')).toHaveTextContent(/^4$/);
    expect(m).toHaveTextContent('2 neu · 1 Bestätigung überfällig · 3 Lagemeldungen neu');
    // Nur drei Einträge: der vierte (älteste gesichtete) steht im Modul.
    const alle = within(m)
      .getAllByRole('link')
      .filter((l) => l.dataset.lfh === 'vorgang-meldung');
    expect(alle.map((z) => z.getAttribute('href'))).toEqual([
      '/einsaetze/1/meldungen?meldung=53',
      '/einsaetze/1/meldungen?meldung=54',
      '/einsaetze/1/meldungen?meldung=52',
    ]);
    expect(zeilen[0]).toHaveAttribute('data-alarm', 'true');
    expect(zeilen[0]).toHaveTextContent('Bestätigung überfällig');
    // Das Statuswort „neu“ ist der Eingang und neutral (`gedaempft`), nicht gelb, wie das Etikett
    // in der Meldungsliste (Spec `statusrollen`, eon26eat D4). Die Test-Provider rendern hell.
    const neu = alle
      .find((l) => l.getAttribute('href') === '/einsaetze/1/meldungen?meldung=54')!
      .querySelector<HTMLElement>('[data-lfh="vorgang-wort"]')!;
    expect(neu).toHaveTextContent('neu');
    expect(neu.style.color).toBe(rgbVon(farbenHell.gedaempft));
    expect(neu.style.color).not.toBe(rgbVon(farbenHell.achtungText));
  });

  it('Offene Vorgänge · Meldungen: eine frische Sofortmeldung steht zuoberst mit „SOFORT“, ohne Alarmkante (LLH-1740)', async () => {
    const meldung = (over: Record<string, unknown>) => ({
      einsatz_id: 1,
      inhalt: 'Meldung',
      status: 'gesichtet',
      ist_offen: true,
      bestaetigung_pflicht: false,
      ist_bestaetigt: false,
      ist_ueberfaellig: false,
      eskaliert: false,
      eingang_at: vor(30),
      erfasst_von_id: 1,
      empfaenger_funktion: null,
      ...over,
    });
    stelleBereit({
      ...volleDaten,
      meldungen: [
        meldung({ id: 61, inhalt: 'Neu alt', status: 'neu', eingang_at: vor(40) }),
        meldung({ id: 62, inhalt: 'Neu mittel', status: 'neu', eingang_at: vor(30) }),
        meldung({ id: 63, inhalt: 'Neu jung', status: 'neu', eingang_at: vor(20) }),
        meldung({
          id: 64,
          inhalt: 'Zwei Personen eingeschlossen',
          status: 'neu',
          prioritaet: 'sofort',
          eingang_at: vor(1),
        }),
        meldung({ id: 65, inhalt: 'Pumpe fällt aus', prioritaet: 'dringend', eingang_at: vor(3) }),
      ],
    });
    rendern();
    await waitFor(() => vorgaenge());
    const m = abschnitt('Meldungen');
    await within(m).findAllByRole('link', { name: /eingeschlossen/ });
    const alle = within(m)
      .getAllByRole('link')
      .filter((l) => l.dataset.lfh === 'vorgang-meldung');
    expect(alle.map((z) => z.getAttribute('href'))).toEqual([
      '/einsaetze/1/meldungen?meldung=64',
      '/einsaetze/1/meldungen?meldung=65',
      '/einsaetze/1/meldungen?meldung=61',
    ]);
    expect(alle[0]).toHaveTextContent('SOFORT');
    expect(alle[0]).not.toHaveAttribute('data-alarm');
    expect(alle[1]).toHaveTextContent('DRINGEND');
  });

  it('Offene Vorgänge · Erinnerungen und Ablösungen: fällige und baldige, Zahl aus ihrer Quelle', async () => {
    const schicht = (id: number, faellig_at: string) => ({
      id,
      einsatz_id: 1,
      einheit_id: 100 + id,
      einheit_name: `Florian ${id}`,
      abschnitt_id: 5,
      abschnitt_name: 'Deichwache Nord',
      beginn_at: vor(300),
      rhythmus_minuten: 360,
      vorwarnung_minuten: 30,
      rhythmus_quelle: 'abschnitt',
      faellig_at,
      status: 'laufend',
      ruecknehmbar: false,
      erbende_einheiten: [],
      abloeser: [],
      angelegt_at: vor(300),
    });
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/reliefs', () =>
        HttpResponse.json([schicht(1, vor(10)), schicht(2, nach(20)), schicht(3, nach(120))]),
      ),
    ]);
    rendern();
    await waitFor(() => vorgaenge());
    const e = abschnitt('Erinnerungen');
    const erinnerung = await within(e).findByRole('link', { name: /Lagebericht an Kreisstab/ });
    // Jede Erinnerung einzeln, wie die übrigen Abschnitte (LLH-1429).
    expect(erinnerung).toHaveAttribute('href', '/einsaetze/1/erinnerungen?erinnerung=3');
    expect(erinnerung).toHaveTextContent('bald');
    expect(abschnittZahl('Erinnerungen')).toHaveTextContent(/^0$/);

    const ab = abschnitt('Ablösungen');
    const zeilen = await within(ab).findAllByRole('link', { name: /Florian/ });
    expect(zeilen.map((z) => z.getAttribute('href'))).toEqual([
      '/einsaetze/1/abloesung?schicht=1',
      '/einsaetze/1/abloesung?schicht=2',
    ]);
    expect(zeilen[0]).toHaveAttribute('data-alarm', 'true');
    expect(zeilen[0]).toHaveTextContent('überfällig');
    expect(zeilen[1]).toHaveTextContent('bald fällig');
    expect(abschnittZahl('Ablösungen')).toHaveTextContent(/^2$/);
    // Ohne Einheit mit offener Periode kein Sprung „ohne Schicht“.
    expect(ab.querySelector('[data-lfh="vorgang-ohne-schicht"]')).toBeNull();
  });

  it('Offene Vorgänge · Ablösungen: „1 ohne Schicht ↗“ springt auf die Ansicht, die Zahl bleibt die der fälligen (LLH-1312)', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/units/timeline', () =>
        HttpResponse.json([
          {
            einheit_id: 10,
            perioden: [{ anker: 'alarmierung', beginn_at: vor(60), eintreffen_at: vor(30) }],
          },
        ]),
      ),
    ]);
    rendern();
    await waitFor(() => vorgaenge());
    const ab = abschnitt('Ablösungen');
    const sprung = await within(ab).findByRole('link', { name: '1 ohne Schicht' });
    expect(sprung).toHaveAttribute('href', '/einsaetze/1/abloesung?ansicht=ohne-schicht');
    expect(abschnittZahl('Ablösungen')).toHaveTextContent(/^0$/);
  });

  it('„n ohne Schicht“ verschwindet, wenn ein Neuabruf scheitert, statt die alte Zahl zu nennen', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/units/timeline', () =>
        HttpResponse.json([
          {
            einheit_id: 10,
            perioden: [{ anker: 'alarmierung', beginn_at: vor(60), eintreffen_at: vor(30) }],
          },
        ]),
      ),
    ]);
    const { client } = rendern();
    await waitFor(() => vorgaenge());
    await within(abschnitt('Ablösungen')).findByRole('link', { name: '1 ohne Schicht' });
    server.use(
      http.get('/api/einsaetze/1/units/timeline', () =>
        HttpResponse.json({ fehler: 'kaputt' }, { status: 500 }),
      ),
    );
    await act(() => client.refetchQueries({ queryKey: einsatzKeys.kraefteZeitachseEinheiten(1) }));
    await waitFor(() =>
      expect(abschnitt('Ablösungen').querySelector('[data-lfh="vorgang-ohne-schicht"]')).toBeNull(),
    );
  });

  describe('Offene Vorgänge · meine Stelle (LLH-1145 D5, pkjvl5iy)', () => {
    /** Der Kopf trägt die eigene Funktion als Code; ein Auftrag geht an genau diese. */
    const fuerStelle = (code: 's2' | 's7') => {
      server.use(meHandler(benutzerFixture({ id: 9 }) as never));
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1', () =>
          HttpResponse.json({
            ...einsatz,
            meine_sachgebiete: code === 's2' ? ['s2'] : [],
            meine_funktion_code: code,
          }),
        ),
        http.get('/api/einsaetze/1/tasks', () =>
          HttpResponse.json([
            ...volleDaten.auftraege,
            auftrag({
              id: 25,
              auftrag_text: 'Lagekarte führen',
              empfaenger: [
                {
                  id: 2,
                  auftrag_id: 25,
                  empfaenger_typ: 'funktion',
                  funktion: code,
                  snap_anzeige: code.toUpperCase(),
                },
              ],
            }),
          ]),
        ),
      ]);
    };
    const fuerS2 = () => fuerStelle('s2');

    it('„meine Stelle“ filtert die Einträge, die Zahl bleibt die des Einsatzes', async () => {
      fuerS2();
      rendern();
      await waitFor(() => vorgaenge());
      await within(abschnitt('Aufträge')).findAllByRole('link', { name: /Trupps verlegen/ });
      const leiste = within(vorgaenge()).getByRole('radiogroup', {
        name: 'Offene Vorgänge zeigen für',
      });
      await userEvent.click(within(leiste).getByRole('radio', { name: 'meine Stelle' }));
      expect(within(leiste).getByRole('radio', { name: 'meine Stelle' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const a = abschnitt('Aufträge');
      const zeilen = within(a)
        .getAllByRole('link')
        .filter((l) => l.dataset.lfh === 'vorgang-auftrag');
      expect(zeilen.map((z) => z.getAttribute('href'))).toEqual([
        '/einsaetze/1/auftraege?auftrag=25',
      ]);
      expect(abschnittZahl('Aufträge')).toHaveTextContent('im Einsatz');
      expect(abschnitt('Nachforderungen')).toHaveTextContent('keine für meine Stelle');
      expect(abschnitt('Ablösungen')).toHaveTextContent('alle Stellen');
    });

    it('die Sicht steht in der URL und wird von dort gelesen', async () => {
      fuerS2();
      renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/ueberblick" element={<UeberblickPage />} />
        </Routes>,
        { route: '/einsaetze/1/ueberblick?vorgaenge=meine' },
      );
      await waitFor(() => vorgaenge());
      expect(screen.getByRole('radio', { name: 'meine Stelle' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await within(abschnitt('Aufträge')).findByRole('link', { name: /Lagekarte führen/ });
      expect(
        within(abschnitt('Aufträge')).queryByRole('link', { name: /Trupps verlegen/ }),
      ).toBeNull();
    });

    it('S7 sieht unter „meine Stelle“ den Auftrag an S7 (LLH-1606)', async () => {
      fuerStelle('s7');
      renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/ueberblick" element={<UeberblickPage />} />
        </Routes>,
        { route: '/einsaetze/1/ueberblick?vorgaenge=meine' },
      );
      await waitFor(() => vorgaenge());
      await within(abschnitt('Aufträge')).findByRole('link', { name: /Lagekarte führen/ });
      expect(
        within(abschnitt('Aufträge')).queryByRole('link', { name: /Trupps verlegen/ }),
      ).toBeNull();
    });
  });

  it('Entscheidungen: Zeitachseneintrag mit Typwort, Folgeaufträge gezählt, ETB-Link mit Filter', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    const eintrag = await within(p).findByText('Turnhalle Ost wird Notunterkunft.');
    const li = eintrag.closest('li')!;
    expect(li).toHaveAttribute('data-typ', 'entscheidung');
    expect(within(li).getByText('Entscheidung')).toBeInTheDocument();
    expect(within(li).getByText('Nr. 411')).toBeInTheDocument();
    expect(within(li).getByText('2 Aufträge')).toBeInTheDocument();
    await userEvent.click(within(p).getByRole('button', { name: 'ETB' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?typ=entscheidung');
  });

  it('Entscheidungen: eine berichtigte trägt die Marke und springt auf die jüngste Berichtigung (LLH-1321)', async () => {
    stelleBereit({
      ...volleDaten,
      etb: [
        {
          ...volleDaten.etb[0],
          berichtigt_durch: [
            { id: 430, lfd_nr: 413 },
            { id: 450, lfd_nr: 415 },
          ],
        },
      ],
    });
    rendern();
    const p = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    const li = (await within(p).findByText('Turnhalle Ost wird Notunterkunft.')).closest('li')!;
    expect(within(li).getByText('berichtigt')).toBeInTheDocument();
    const sprung = within(li).getByRole('link', { name: '→ Nr. 415' });
    expect(sprung).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=450');
    await userEvent.click(sprung);
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?eintrag=450');
  });

  it('Entscheidungen: eine unberichtigte trägt keine Marke (LLH-1321)', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    const li = (await within(p).findByText('Turnhalle Ost wird Notunterkunft.')).closest('li')!;
    expect(within(li).queryByText('berichtigt')).toBeNull();
    expect(within(li).getByText('Brandt')).toBeInTheDocument();
  });

  it('Entscheidungen: ohne Eintrag der letzten Stunde ehrlich als „Letzte Entscheidungen"', async () => {
    stelleBereit({
      ...volleDaten,
      etb: [{ ...volleDaten.etb[0], ereigniszeit: vor(200) }],
    });
    rendern();
    const p = await waitFor(() => paneel('Letzte Entscheidungen'));
    expect(await within(p).findByText('keine in der letzten Stunde')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Entscheidungen der letzten Stunde' })).toBeNull();
  });

  it('Nächste Marken: Fristen aus Aufträgen, Erinnerungen und Lagebesprechung, mit Wort', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    await within(p).findByText('Lagebesprechung');
    const marken = within(p).getAllByRole('link');
    expect(marken.map((m) => m.getAttribute('data-ton'))).toEqual([
      'alarm',
      'achtung',
      'neutral',
      'neutral',
    ]);
    expect(marken[0]).toHaveTextContent('überfällig');
    expect(marken[0]).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=22');
    expect(marken[1]).toHaveTextContent('Lagebericht an Kreisstab');
    expect(marken[1]).toHaveAttribute('href', '/einsaetze/1/erinnerungen?erinnerung=3');
    expect(marken[3]).toHaveAttribute('href', '/einsaetze/1/lagebesprechung');
  });

  it('Nächste Marken: Programmpunkt neutral, führt in die Einsatzdaten (LLH-1570)', async () => {
    stelleBereit(volleDaten);
    server.use(
      http.get('/api/einsaetze/1/agenda-items', () =>
        HttpResponse.json([
          { id: 5, bezeichnung: 'Feuerwerk', zeitpunkt_at: nach(15) },
          { id: 6, bezeichnung: 'Einlass', zeitpunkt_at: vor(30) },
        ]),
      ),
    );
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = (await within(p).findByText('Feuerwerk')).closest('a')!;
    expect(marke).toHaveAttribute('href', '/einsaetze/1/einsatzdaten');
    expect(marke).toHaveAttribute('data-ton', 'neutral');
    expect(within(p).queryByText('Einlass')).toBeNull();
  });

  describe('Nächste Marken: offene Pegel-Prognose (LFH-628), Ziel nach LFH-633', () => {
    // Wire-Zeit UTC ohne Zone, relativ zur echten Uhr (die Seite rechnet mit ihr).
    const wire = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const prognose = (ms: number) => ({
      hoechststand_cm: 710,
      zeitpunkt: wire(ms),
      gesetzt_at: wire(Date.now()),
    });
    const daten = () => ({
      ...volleDaten,
      pegel: [
        { ...leitpegel(null), prognose: prognose(Date.now() + 3 * 3_600_000) },
        {
          ...leitpegel(null),
          id: 2,
          station_uuid: '5f9c1b54-3c41-4d93-bb48-2b7c7c3f5a61',
          name: 'WAHNHAUSEN',
          gewaesser: 'FULDA',
          reihenfolge: 1,
          prognose: prognose(Date.now() - 3_600_000),
        },
      ],
    });
    const marke = async () => {
      const p = await waitFor(() => paneel('Nächste Marken'));
      const m = await within(p).findByRole('link', {
        name: /Erwarteter Höchststand Pegel HANN\. MÜNDEN \(WESER\): 7,10 m/,
      });
      return { p, m };
    };

    it('Modul „Wetter & Pegel" frei → die Marke führt auf die Modulseite; verstrichene fehlt', async () => {
      stelleBereit(daten());
      rendern();
      const { p, m } = await marke();
      expect(m).toHaveAttribute('href', '/einsaetze/1/wetter-pegel');
      expect(m).toHaveAttribute('data-ton', 'neutral');
      expect(within(p).queryByText(/Pegel WAHNHAUSEN/)).toBeNull();
    });

    it('Modul ausgeblendet → die Marke führt in die Pegel-Einstellungen', async () => {
      // Vor der Freigaben-Antwort gilt ohnehin die Pflege; die Aussage trägt erst NACH ihr.
      let freigabenGeliefert = 0;
      stelleBereit(daten(), [
        http.get('/api/einsaetze/1/module-access', () => {
          freigabenGeliefert += 1;
          return HttpResponse.json(freigabenFixture({ 'wetter-pegel': { sichtbar: false } }));
        }),
      ]);
      rendern();
      const { m } = await marke();
      await waitFor(() => expect(freigabenGeliefert).toBeGreaterThan(0));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(m).toHaveAttribute('href', '/einsaetze/1/einstellungen/pegel');
    });
  });

  describe('Nächste Marken: angekündigtes Unwetter (LFH-663)', () => {
    const wetter = () => {
      const jetzt = Date.now();
      const um = (ms: number) => new Date(jetzt + ms).toISOString();
      return {
        ort: { name: 'Hann. Münden' },
        warnungen: {
          zustand: 'ok',
          abgerufen_at: um(-60_000),
          daten: [
            {
              stufe: 'schwer',
              ereignis: 'ORKANBÖEN',
              ueberschrift: 'Amtliche UNWETTERWARNUNG vor ORKANBÖEN',
              beginn: um(2 * 3_600_000),
              ende: um(5 * 3_600_000),
            },
          ],
        },
        vorhersage: { zustand: 'ausfall' },
      };
    };

    it('Modul frei → Marke „Unwetterwarnung: Orkanböen" mit Weg zur Modulseite', async () => {
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1/weather', () => HttpResponse.json(wetter())),
      ]);
      rendern();
      const p = await waitFor(() => paneel('Nächste Marken'));
      const m = await within(p).findByRole('link', { name: /Unwetterwarnung: Orkanböen/ });
      expect(m).toHaveAttribute('href', '/einsaetze/1/wetter-pegel');
      expect(m).toHaveAttribute('data-ton', 'neutral');
    });

    it('Modul ausgeblendet → keine Anfrage an …/weather, keine Unwettermarke', async () => {
      let wetterAbrufe = 0;
      let freigabenGeliefert = 0;
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1/weather', () => {
          wetterAbrufe += 1;
          return HttpResponse.json(wetter());
        }),
        http.get('/api/einsaetze/1/module-access', () => {
          freigabenGeliefert += 1;
          return HttpResponse.json(freigabenFixture({ 'wetter-pegel': { sichtbar: false } }));
        }),
      ]);
      rendern();
      const p = await waitFor(() => paneel('Nächste Marken'));
      await within(p).findByText('Lagebesprechung');
      await waitFor(() => expect(freigabenGeliefert).toBeGreaterThan(0));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(wetterAbrufe).toBe(0);
      expect(within(p).queryByText(/Unwetterwarnung/)).toBeNull();
    });
  });

  it('Nächste Marken: fällige Ablösungen je Abschnitt zusammengefasst, Link zur Ablösung (LFH-635)', async () => {
    const schicht = (id: number) => ({
      id,
      einsatz_id: 1,
      einheit_id: 100 + id,
      einheit_name: `Florian ${id}`,
      abschnitt_id: 5,
      abschnitt_name: 'Deichwache Nord',
      beginn_at: vor(300),
      rhythmus_minuten: 360,
      vorwarnung_minuten: 30,
      rhythmus_quelle: 'abschnitt',
      faellig_at: nach(60),
      status: 'laufend',
      ruecknehmbar: false,
      erbende_einheiten: [],
      abloeser: [],
      angelegt_at: vor(300),
    });
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/reliefs', () => HttpResponse.json([schicht(1), schicht(2)])),
      // Die Auto-Frist derselben Ablösung in den Erinnerungen darf keine zweite Marke werden.
      http.get('/api/einsaetze/1/reminders', () =>
        HttpResponse.json([
          ...volleDaten.erinnerungen,
          {
            id: 9,
            titel: 'Ablösung fällig: Florian 1',
            faellig_at: nach(60),
            status: 'offen',
            bezug_typ: 'abloesung',
            bezug_id: 1,
          },
        ]),
      ),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = await within(p).findByText('Ablösung Deichwache Nord, 2 Einheiten');
    expect(marke.closest('a')).toHaveAttribute('href', '/einsaetze/1/abloesung?ansicht=laufend');
    expect(within(p).queryByText('Ablösung fällig: Florian 1')).toBeNull();
  });

  it('Nächste Marken: ohne sichtbares Modul Ablösung keine Anfrage und keine Marke (LFH-635)', async () => {
    let abgefragt = 0;
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/module-access', () =>
        HttpResponse.json(freigabenFixture({ abloesung: { sichtbar: false } })),
      ),
      http.get('/api/einsaetze/1/reliefs', () => {
        abgefragt += 1;
        return HttpResponse.json([]);
      }),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    await within(p).findByText('Lagebesprechung');
    expect(abgefragt).toBe(0);
  });

  it('Leerzustand: jedes Paneel sagt „nichts da" und bietet, wo sinnvoll, eine Aktion', async () => {
    stelleBereit({
      personen: [],
      personal: [],
      fahrzeuge: [],
      material: [],
      einheiten: [],
      abschnitte: [],
      gefahren: [],
      auftraege: [],
      erinnerungen: [],
      etb: [],
    } as unknown as Daten);
    server.use(
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, naechste_lagebesprechung_at: null }),
      ),
    );
    rendern();
    // „Offene Vorgänge“: jeder der fünf Abschnitte sagt „keine“, keiner fällt weg (LLH-1145).
    await waitFor(() =>
      expect(vorgaenge().querySelectorAll('[data-lfh="abschnitt-keine"]')).toHaveLength(5),
    );
    expect(within(vorgaenge()).getAllByText('keine')).toHaveLength(5);
    expect(
      await screen.findByText('Noch keine Entscheidung im Einsatztagebuch.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Keine anstehenden Fristen.')).toBeInTheDocument();
    expect(
      await screen.findByText('Noch keine Abschnitte und keine Kräfte erfasst.'),
    ).toBeInTheDocument();
    // Ohne Gefahrengebiet kein Warnstufen-Hinweis im Kopf.
    expect(document.querySelector('[data-lfh="warnstufe-hinweis"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Eintrag erfassen' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?neu=1');
  });

  /*
   * Schreibwege mit Rechte-Riegel, als Paar: mit Recht stehen die Leer-Aktionen, ohne Recht fehlen
   * sie und die Primäraktion steht gesperrt mit Grund.
   */
  const leereDaten = {
    personen: [],
    personal: [],
    fahrzeuge: [],
    material: [],
    einheiten: [],
    abschnitte: [],
    gefahren: [],
    auftraege: [],
    erinnerungen: [],
    etb: [],
  } as unknown as Daten;

  it('mit Schreibrecht: Leer-Aktion „Abschnitt anlegen" öffnet die Erfassung (LLH-1815)', async () => {
    stelleBereit(leereDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    expect(screen.getByTestId('ort')).toHaveTextContent(
      /^\/einsaetze\/1\/einsatzabschnitte\?neu=1$/,
    );
  });

  it('mit Schreibrecht: „Eintrag" bedienbar, kein Rechtehinweis', async () => {
    stelleBereit(volleDaten);
    rendern();
    await screen.findByText('Hochwasser Weserlauf');
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeEnabled();
    expect(screen.queryByText('nur Einsatzleitung und Führungspersonal')).toBeNull();
  });

  it('ohne Schreibrecht: „Eintrag" gesperrt mit Grund, Leer-Aktionen zum Schreiben fehlen', async () => {
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' }),
      ),
    ]);
    rendern();
    expect(await screen.findByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeDisabled();
    expect(
      await screen.findByText('Noch keine Entscheidung im Einsatztagebuch.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Noch keine Abschnitte und keine Kräfte erfasst.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eintrag erfassen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abschnitt anlegen' })).toBeNull();
    // Reine Navigation bleibt: sie schreibt nichts (Sprung im Paneelkopf, LLH-1140).
    expect(within(vorgaenge()).getByRole('link', { name: 'alle Aufträge' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz: der Grund nennt den Abschluss, nicht die Rolle', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, status: 'abgeschlossen' }),
      ),
    ]);
    rendern();
    expect(await screen.findByText('Einsatz abgeschlossen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeDisabled();
  });

  it('Fehler ist nicht leer: ausgefallene Aufträge zeigen „Stand unbekannt", der Rest bleibt', async () => {
    // Liste und Zähler fallen aus: das Paneel und die Kennzahl sagen es je für sich.
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/tasks', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
      http.get('/api/einsaetze/1/module-counts', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    await waitFor(() => vorgaenge());
    const p = abschnitt('Aufträge');
    expect(await within(p).findByRole('alert')).toHaveTextContent('Stand unbekannt');
    expect(within(p).getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(within(p).queryByText('keine')).toBeNull();
    expect(abschnittZahl('Aufträge')).toHaveTextContent('—');
    // Die Abschnitte hängen an ihren eigenen Quellen und bleiben lesbar.
    expect(
      await within(paneel('Einsatzabschnitte')).findByRole('link', { name: /Abschnitt Nord/ }),
    ).toBeInTheDocument();
    // Die Alarmzeile sagt nicht „Nichts brennt“, denn der Zähler fehlt.
    const zeile = screen.getByRole('status', { name: 'Was brennt' });
    expect(zeile).toHaveAttribute('data-stand', 'unvollstaendig');
    expect(zeile).not.toHaveTextContent('Nichts brennt');
    // Die Folgeaufträge hängen am ETB-Eintrag, nicht an der Auftragsliste: die Zahl bleibt stehen.
    const entscheidungen = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    expect(await within(entscheidungen).findByText('2 Aufträge')).toBeInTheDocument();
    expect(screen.queryByText(/Folgeaufträge werden nicht gezählt/)).toBeNull();
  });

  it('Abschnitte: fehlen die Aufträge, sagt es der Fuß, die Stärke bleibt (LFH-962)', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/tasks', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    expect(
      await within(p).findByText('Aufträge nicht abrufbar, Auftragstexte fehlen'),
    ).toBeInTheDocument();
    expect(within(p).getByRole('link', { name: /Abschnitt Nord/ })).toHaveTextContent('1/0/1//2');
  });

  it('Ladezustand: die Paneele zeigen „wird abgerufen", keine Null', async () => {
    const haengt = async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    };
    // Die Meldungsliste hält die Reihen nicht auf (anders als die Quellen der Marken, LLH-1748).
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/persons', haengt),
      http.get('/api/einsaetze/1/reports', haengt),
    ]);
    rendern();
    await koerperDa();
    // Die Alarmzeile lädt mit den Personen und behauptet keine Ruhe (Spec `lage-alarmzeile`).
    const zeile = screen.getByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(zeile).toHaveTextContent('1 Auftrag überfällig'));
    expect(zeile).toHaveAttribute('data-stand', 'laedt');
    expect(zeile).not.toHaveTextContent('Nichts brennt');
    // Die Paneelreihen kommen erst mit den Quellen der Gliederung (LLH-1481) und der Marken.
    const p = await waitFor(() => abschnitt('Meldungen'));
    expect(within(p).getByText('wird abgerufen').closest('[aria-busy="true"]')).not.toBeNull();
    // Eine unabhängige Quelle lädt trotzdem durch.
    expect(
      await within(paneel('Einsatzabschnitte')).findByRole('link', { name: /Abschnitt Nord/ }),
    ).toBeInTheDocument();
  });

  /*
   * LFH-629: der Ladezustand eines Paneels hat die Form seines Leerzustands — Satz und, wo „leer"
   * eine Aktion trägt, ihr Platz in Knopfhöhe. Höhen misst jsdom nicht; die Seiten-CLS auf 390 px
   * misst `e2e/lagebild-cls-schmal.spec.ts`. Hier die Struktur. „Einsatzabschnitte“ (leer mit
   * „Abschnitt anlegen“) lädt seit LLH-1481 nicht mehr sichtbar, die Paneelreihen warten auf seine
   * Quellen; der Platz der Leeraktion steht im Baustein-Test (`PaneelZustand`).
   */
  it('Ladezustand ohne Leeraktion hält keinen Knopfplatz (LFH-629)', async () => {
    const haengt = async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    };
    stelleBereit(leereDaten, [http.get('/api/einsaetze/1/resource-requests', haengt)]);
    rendern();
    await koerperDa();
    // Ein Abschnitt der „Offenen Vorgänge" trägt leer keine Aktion, also kein Platz.
    const nachforderungen = await waitFor(() => abschnitt('Nachforderungen'));
    expect(within(nachforderungen).getByText('wird abgerufen')).toBeInTheDocument();
    expect(vorgaenge().querySelectorAll('.ant-skeleton-button')).toHaveLength(0);
    // Die Gliederung ist da: leer mit Ausweg, kein Ladezustand.
    expect(
      within(paneel('Einsatzabschnitte')).getByRole('button', { name: 'Abschnitt anlegen' }),
    ).toBeInTheDocument();
  });

  /*
   * LLH-1481: wie viele Zeilen „Einsatzabschnitte“ bekommt, sagt keine Zahl vorher; mit einer
   * Ladezeile wuchs das Paneel um jede Zeile und schob alles darunter. Die Paneelreihen erscheinen
   * deshalb erst mit allen Quellen der Gliederung, die Alarmzeile steht schon. Ein Fehler hält
   * nichts auf. Die Seiten-CLS misst `e2e/ueberblick-vorgaenge-cls.spec.ts`.
   */
  describe('Paneelreihen warten auf die Quellen der Gliederung (LLH-1481)', () => {
    // Ohne Startliste (LLH-1815): steht sie über den Reihen, wartet der ganze Körper auf Abschnitte,
    // Einheiten und Personal (Fall „langsame Lage-Abfrage“ unten). Hier geht es nur um die Reihen.
    beforeEach(() => {
      localStorage.clear();
      saveStartlisteAusgeblendet(1);
      // Angemeldet, sonst räumt der Start nach der 401 den Gerätespeicher samt Ausblenden (LFH-767).
      server.use(meHandler(benutzerFixture({ id: 9 })));
    });
    afterEach(() => localStorage.clear());

    // Seit LLH-1748 auch die Quellen der Marken: „Nächste Marken“ steht in Reihe 1 zuoberst.
    // Modulschlüssel bleiben deutsch, die Route ist englisch (ADR-0085).
    const route = (modul: string) =>
      (
        ({
          abschnitte: 'sectors',
          auftraege: 'tasks',
          erinnerungen: 'reminders',
          ...API_SEGMENT,
        }) as Record<string, string>
      )[modul] ?? modul;
    for (const quelle of [
      'abschnitte',
      'einheiten',
      'personal',
      'fahrzeuge',
      'material',
      'auftraege',
      'erinnerungen',
    ]) {
      it(`${quelle} lädt: Alarmzeile steht, keine Paneelreihe; mit der Antwort die Zeilen`, async () => {
        let loslassen!: () => void;
        const tor = new Promise<void>((f) => (loslassen = f));
        const daten = volleDaten[quelle as keyof typeof volleDaten];
        stelleBereit(volleDaten, [
          // Die Quelle `abschnitte` liest `/sectors` (LLH-2059, ADR-0085).
          http.get(`/api/einsaetze/1/${route(quelle)}`, async () => {
            await tor;
            return HttpResponse.json(daten as object);
          }),
        ]);
        rendern();
        const zeile = await koerperDa();
        // Unabhängige Quellen laden durch (der Modulzähler), die Paneelreihen bleiben weg.
        await waitFor(() => expect(zeile).toHaveTextContent('1 Auftrag überfällig'));
        expect(screen.queryByRole('region', { name: 'Einsatzabschnitte' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Offene Vorgänge' })).toBeNull();
        expect(document.querySelector('[data-lfh="ueberblick-paneele"]')).toBeNull();
        loslassen();
        const p = await waitFor(() => paneel('Einsatzabschnitte'));
        expect(await within(p).findByRole('link', { name: /Abschnitt Nord/ })).toBeInTheDocument();
        expect(p.querySelector('[aria-busy="true"]')).toBeNull();
      });
    }

    it('scheitert eine Quelle, stehen die Paneele mit „Stand unbekannt“', async () => {
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1/units', () =>
          HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
        ),
      ]);
      rendern();
      const p = await waitFor(() => paneel('Einsatzabschnitte'));
      expect(await within(p).findByRole('alert')).toHaveTextContent('Stand unbekannt');
      expect(vorgaenge()).toBeInTheDocument();
    });

    /*
     * LLH-1955: die Schranke gilt nur beim ersten Aufbau der Seite je Einsatz. Wird mitten in der
     * Sitzung ein Modul freigegeben, lädt seine Quelle zum ersten Mal; die Reihen bleiben dabei
     * dieselben DOM-Knoten, nur das betroffene Paneel zeigt kurz seinen Ladezustand.
     */
    for (const [modul, paneelTitel] of [
      ['fahrzeuge', 'Einsatzabschnitte'],
      ['auftraege', 'Nächste Marken'],
    ] as const) {
      it(`${modul} wird live freigegeben: die Paneelreihen bleiben stehen, solange die Quelle lädt`, async () => {
        let loslassen!: () => void;
        const tor = new Promise<void>((f) => (loslassen = f));
        const abrufe = { n: 0 };
        stelleBereit(volleDaten, [
          http.get('/api/einsaetze/1/module-access', () =>
            HttpResponse.json(freigabenFixture({ [modul]: { zugriff: false } })),
          ),
        ]);
        const { client } = rendern();
        await waitFor(() => paneel(paneelTitel));
        const reihe1 = document.querySelector('[data-lfh="ueberblick-paneele"]')!;
        const reihe2 = document.querySelector('[data-lfh="ueberblick-paneele-gliederung"]')!;
        expect(reihe1).not.toBeNull();
        expect(reihe2).not.toBeNull();

        server.use(
          http.get('/api/einsaetze/1/module-access', () => HttpResponse.json(freigabenFixture())),
          http.get(`/api/einsaetze/1/${route(modul)}`, async () => {
            abrufe.n += 1;
            await tor;
            return HttpResponse.json(volleDaten[modul] as object);
          }),
        );
        await act(() => client.refetchQueries({ queryKey: einsatzKeys.modulFreigaben(1) }));
        await waitFor(() => expect(abrufe.n).toBe(1));
        expect(reihe1.isConnected).toBe(true);
        expect(reihe2.isConnected).toBe(true);

        loslassen();
        await waitFor(() =>
          expect(paneel(paneelTitel).querySelector('[aria-busy="true"]')).toBeNull(),
        );
        expect(reihe1.isConnected).toBe(true);
        expect(reihe2.isConnected).toBe(true);
      });
    }

    /*
     * Erster Aufbau heißt: die Reihen standen schon einmal. Kommen die Freigaben erst nach dem
     * ersten Bild (sonst hält sie der Rahmen bereit), fragen die gebundenen Quellen bis dahin
     * nicht, und die Reihen stehen mit „wird abgerufen“. Laden die Quellen danach, bleiben sie.
     */
    it('Freigaben kommen spät: die schon stehenden Reihen bleiben, während die Quellen laden', async () => {
      let freigabenLos!: () => void;
      const freigabenTor = new Promise<void>((f) => (freigabenLos = f));
      let abschnitteLos!: () => void;
      const abschnitteTor = new Promise<void>((f) => (abschnitteLos = f));
      const abrufe = { n: 0 };
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1/module-access', async () => {
          await freigabenTor;
          return HttpResponse.json(freigabenFixture());
        }),
        http.get('/api/einsaetze/1/sectors', async () => {
          abrufe.n += 1;
          await abschnitteTor;
          return HttpResponse.json(volleDaten.abschnitte);
        }),
      ]);
      rendern();
      await waitFor(() => paneel('Einsatzabschnitte'));
      const reihe1 = document.querySelector('[data-lfh="ueberblick-paneele"]')!;
      const reihe2 = document.querySelector('[data-lfh="ueberblick-paneele-gliederung"]')!;
      expect(abrufe.n).toBe(0);

      freigabenLos();
      await waitFor(() => expect(abrufe.n).toBe(1));
      expect(reihe1.isConnected).toBe(true);
      expect(reihe2.isConnected).toBe(true);

      abschnitteLos();
      const p = await waitFor(() => paneel('Einsatzabschnitte'));
      expect(await within(p).findByRole('link', { name: /Abschnitt Nord/ })).toBeInTheDocument();
      expect(reihe1.isConnected).toBe(true);
      expect(reihe2.isConnected).toBe(true);
    });
  });

  /*
   * LLH-1430: laden die Listen der „Offenen Vorgänge“, hält jeder Abschnitt so viele Zeilen, wie
   * der Modulzähler Einträge erwarten lässt (höchstens drei). Erinnerungen kennen nur die fälligen,
   * Ablösungen keinen Serverzähler; „meine Stelle“ zählt der Zähler nicht. Die Seiten-CLS misst
   * `e2e/ueberblick-vorgaenge-cls.spec.ts`. Aufträge, Erinnerungen und Ablösungen speisen seit
   * LLH-1748 auch die Marken in Reihe 1; ihre Listen halten die Reihen beim ersten Aufbau ganz auf
   * (`markenLaedt`). Sichtbar laden hier deshalb nur Meldungen und Nachforderungen.
   */
  describe('Offene Vorgänge · Ladezustand hält den Platz der erwarteten Einträge (LLH-1430)', () => {
    const haengt = async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    };
    const listenHaengen = () =>
      stelleBereit(
        {
          ...volleDaten,
          zaehler: {
            auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 0 },
            meldungen: {
              offen: 5,
              ungesehen: 0,
              bestaetigung_ueberfaellig: 0,
              sofort_offen: 0,
              dringend_offen: 0,
            },
            nachforderungen: {
              offen: 0,
              angefordert: 0,
              zugesagt: 0,
              unterwegs: 0,
              ueberfaellig: 0,
            },
            erinnerungen: { faellig: 1 },
            lagemeldungen: { neu: 0 },
          },
        },
        [
          http.get('/api/einsaetze/1/reports', haengt),
          http.get('/api/einsaetze/1/resource-requests', haengt),
        ],
      );
    const platzhalter = (name: string) =>
      abschnitt(name).querySelectorAll('[data-lfh="abschnitt-platzhalter"]').length;

    it('„alle“: Zeilen nach dem Zähler, 0 und unbekannt bleiben eine Zeile', async () => {
      listenHaengen();
      rendern();
      await waitFor(() => vorgaenge());
      // Der Zähler steht, die Listen laden noch.
      await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent(/^5$/));
      for (const name of ['Meldungen', 'Nachforderungen']) {
        expect(abschnitt(name).querySelector('[aria-busy="true"]')).not.toBeNull();
      }
      expect(platzhalter('Meldungen')).toBe(3);
      expect(platzhalter('Nachforderungen')).toBe(0);
      expect(within(abschnitt('Nachforderungen')).getByText('wird abgerufen')).toBeInTheDocument();
    });

    it('„meine Stelle“: der Zähler zählt die Stelle nicht, also eine Zeile', async () => {
      listenHaengen();
      renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/ueberblick" element={<UeberblickPage />} />
        </Routes>,
        { route: '/einsaetze/1/ueberblick?vorgaenge=meine' },
      );
      await waitFor(() => vorgaenge());
      await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent(/^5/));
      expect(abschnitt('Meldungen').querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(platzhalter('Meldungen')).toBe(0);
    });
  });

  it('Körper erst mit dem Einsatz: davor weder Alarmzeile noch Paneele noch Rechtehinweis (LFH-629)', async () => {
    let freigeben!: () => void;
    const tor = new Promise<void>((f) => (freigeben = f));
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1', async () => {
        await tor;
        return HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' });
      }),
    ]);
    rendern();
    expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
    // Die übrigen Abfragen sind längst da — gewartet wird allein auf den Einsatz.
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="seiten-inhalt"]')).toBeEmptyDOMElement(),
    );
    expect(screen.queryByRole('status', { name: 'Was brennt' })).toBeNull();
    expect(screen.queryByText('nur Einsatzleitung und Führungspersonal')).toBeNull();
    act(() => freigeben());
    // Mit dem Einsatz kommen Hinweis und Körper im selben Zug.
    expect(await screen.findByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(await koerperDa()).toBeInTheDocument();
  });

  it('Körper erst mit dem Modulzähler: die Platzhalter der Vorgänge kennen ihre Zahl (LLH-1430)', async () => {
    let freigeben!: () => void;
    const tor = new Promise<void>((f) => (freigeben = f));
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1/module-counts', async () => {
        await tor;
        return HttpResponse.json({
          auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
          meldungen: {
            offen: 0,
            ungesehen: 0,
            bestaetigung_ueberfaellig: 0,
            sofort_offen: 0,
            dringend_offen: 0,
          },
        });
      }),
    ]);
    rendern();
    expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
    // Der Einsatz ist da (Ortspfad mit Namen), der Zähler nicht: der Inhalt bleibt leer.
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="seitenkopf"]')).toHaveTextContent(
        einsatz.bezeichnung,
      ),
    );
    expect(document.querySelector('[data-lfh="seiten-inhalt"]')).toBeEmptyDOMElement();
    act(() => freigeben());
    expect(await koerperDa()).toBeInTheDocument();
  });

  it('ein gescheiterter Modulzähler hält den Körper nicht auf', async () => {
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1/module-counts', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    expect(await koerperDa()).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Offene Vorgänge' })).toBeInTheDocument();
  });

  /**
   * LFH-952 (D6): die Abschnittszeile ist ein Raster mit Containerabfrage am Paneel
   * (`components/instrument/gliederungsPaneel.css`, seit LLH-1140 der Baustein
   * `GliederungsPaneel`). jsdom rechnet weder Raster noch Abfrage; hier stehen die Klassen und die
   * DOM-Reihenfolge (der Linkname hängt an ihr), die Lage misst `e2e/rahmen-stehen-bleiben.spec.ts`.
   */
  it('die Abschnittszeile trägt die Rasterbereiche in fester Reihenfolge (LFH-952)', async () => {
    stelleBereit(volleDaten);
    rendern();
    const name = await screen.findByText('Abschnitt Nord', {
      selector: '[data-lfh="ueberblick-abschnitt"] *',
    });
    const zeile = name.closest<HTMLElement>('[data-lfh="ueberblick-abschnitt"]')!;
    expect(zeile).toHaveClass(GLIEDERUNG_KLASSE.zeile);
    expect(zeile.style.display).toBe('grid');
    expect(zeile.closest('ul')).toHaveClass(GLIEDERUNG_KLASSE.liste);
    expect(Array.from(zeile.children).map((k) => k.className)).toEqual([
      GLIEDERUNG_KLASSE.kante,
      GLIEDERUNG_KLASSE.kopf,
      GLIEDERUNG_KLASSE.inhalt,
      GLIEDERUNG_KLASSE.zahl,
    ]);
  });

  /**
   * Der Überblick ist die Startseite, und jedes Ziel darauf ist eine bewusste Modulwahl: sie füllt
   * die Palettengruppe „Zuletzt besucht" (LFH-436). Jeder Test prüft zuerst, dass das Laden allein
   * nichts gemerkt hat — sonst bliebe er auch mit einem Routen-Effekt grün.
   */
  describe('„Zuletzt"-Speicher (LFH-436)', () => {
    const ICH = benutzerFixture({ id: 9, org_rolle: 'fuehrungskraft' });
    const gemerkt = () => leseZuletztModule(ICH.id, 1, JETZT.getTime());

    beforeEach(() => {
      localStorage.clear();
      server.use(meHandler(ICH));
    });

    it('der Sprung „alle Aufträge“ in „Offene Vorgänge“ merkt die Aufträge (LLH-1748)', async () => {
      stelleBereit(volleDaten);
      rendern();
      await waitFor(() => expect(abschnittZahl('Meldungen')).toHaveTextContent('4'));
      expect(gemerkt()).toEqual([]);
      await userEvent.click(within(vorgaenge()).getByRole('link', { name: 'alle Aufträge' }));
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/auftraege');
      expect(gemerkt()).toEqual(['auftraege']);
    });

    it('ein Eintrag der Alarmzeile merkt sein Modul (LLH-1743)', async () => {
      stelleBereit(volleDaten);
      rendern();
      const zeile = await screen.findByRole('status', { name: 'Was brennt' });
      const eintrag = await within(zeile).findByRole('link', { name: '1 Auftrag überfällig' });
      expect(gemerkt()).toEqual([]);
      await userEvent.click(eintrag);
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/auftraege');
      expect(gemerkt()).toEqual(['auftraege']);
    });

    it('eine Abschnittszeile merkt die Einsatzabschnitte', async () => {
      stelleBereit(volleDaten);
      rendern();
      const zeile = await screen.findByText('Abschnitt Nord', {
        selector: '[data-lfh="ueberblick-abschnitt"] *',
      });
      expect(gemerkt()).toEqual([]);
      await userEvent.click(zeile);
      expect(gemerkt()).toEqual(['einsatzabschnitte']);
    });

    it('der Kopfknopf „Eintrag" merkt das ETB', async () => {
      stelleBereit(volleDaten);
      rendern();
      const knopf = await screen.findByRole('button', { name: 'Eintrag' });
      await waitFor(() => expect(knopf).toBeEnabled());
      expect(gemerkt()).toEqual([]);
      await userEvent.click(knopf);
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?neu=1');
      expect(gemerkt()).toEqual(['etb']);
    });

    it('eine Leer-Aktion merkt ihr Modul', async () => {
      stelleBereit(leereDaten);
      rendern();
      const knopf = await screen.findByRole('button', { name: 'Abschnitt anlegen' });
      expect(gemerkt()).toEqual([]);
      await userEvent.click(knopf);
      expect(gemerkt()).toEqual(['einsatzabschnitte']);
    });

    it('die Brotkrume „Einsätze" merkt nichts, sie führt in kein Modul', async () => {
      stelleBereit(volleDaten);
      rendern();
      await userEvent.click(await screen.findByRole('link', { name: 'Einsätze' }));
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze$/);
      expect(localStorage.length).toBe(0);
    });
  });
});

/**
 * Modulgrenze der Quellen (LFH-669, Spec `modul-freigabe`, „Keine Anfrage an ein nicht
 * freigegebenes Modul"): der Überblick fragt die Liste eines fremden Moduls nur bei Freigabe des
 * Servers an. Gesperrt ist kein Ausfall und kein leerer Bestand — die Zahl fehlt mit Grund. Die
 * Tests zählen die Requests mit: „nichts gezeigt" allein belegte nicht, dass nichts geladen wurde.
 */
describe('UeberblickPage Modulgrenze der Quellen (LFH-669)', () => {
  const GEBUNDEN = [
    '/api/einsaetze/1/persons',
    '/api/einsaetze/1/personnel',
    '/api/einsaetze/1/vehicles',
    '/api/einsaetze/1/material',
    '/api/einsaetze/1/units',
    '/api/einsaetze/1/units/timeline',
    '/api/einsaetze/1/sectors',
    '/api/einsaetze/1/hazard-areas',
    '/api/einsaetze/1/tasks',
    '/api/einsaetze/1/resource-requests',
    '/api/einsaetze/1/reports',
    '/api/einsaetze/1/reminders',
    '/api/einsaetze/1/etb',
    '/api/einsaetze/1/reports/check-ins',
  ];

  /**
   * Volle Daten; `freigaben` je Fall (`'fehler'` = 500, `'haengt'` = antwortet nie). Die Zähler
   * antworten nicht selbst (MSW fällt auf den Daten-Handler von `stelleBereit` durch).
   */
  function mitFreigaben(
    freigaben: Record<string, Partial<ModulFreigabe>> | 'fehler' | 'haengt',
    weitere: Parameters<typeof server.use> = [],
  ) {
    const aufrufe: Record<string, number> = {};
    stelleBereit(volleDaten, [
      ...weitere,
      ...GEBUNDEN.map((pfad) =>
        http.get(pfad, () => {
          aufrufe[pfad] = (aufrufe[pfad] ?? 0) + 1;
        }),
      ),
      http.get('/api/einsaetze/1/module-access', async () => {
        if (freigaben === 'fehler') return new HttpResponse(null, { status: 500 });
        if (freigaben === 'haengt') {
          await delay('infinite');
        }
        return HttpResponse.json(freigabenFixture(freigaben === 'haengt' ? {} : freigaben));
      }),
    ]);
    return aufrufe;
  }

  /** Die Abschnittszeile „Abschnitt Nord“: steht sie, liefen die freien Quellen der Gliederung. */
  const nordDa = async () =>
    expect(
      await within(await waitFor(() => paneel('Einsatzabschnitte'))).findByRole('link', {
        name: /Abschnitt Nord/,
      }),
    ).toBeInTheDocument();

  it('Modul Einheiten gesperrt: keine Anfrage an die Zeitachse, kein Sprung „ohne Schicht“ (LLH-1312)', async () => {
    const aufrufe = mitFreigaben({ einheiten: { zugriff: false } });
    rendern();
    await waitFor(() => expect(aufrufe['/api/einsaetze/1/hazard-areas']).toBe(1));
    await waitFor(() => vorgaenge());
    expect(aufrufe['/api/einsaetze/1/units/timeline']).toBeUndefined();
    expect(document.querySelector('[data-lfh="vorgang-ohne-schicht"]')).toBeNull();
  });

  it('gesperrte Module: keine Anfrage, „—" mit Grund statt Zahl, kein Fehlerhinweis', async () => {
    const aufrufe = mitFreigaben({
      personen: { zugriff: false },
      auftraege: { zugriff: false },
      etb: { zugriff: false },
      meldungen: { sichtbar: false, zugriff: false },
      nachforderungen: { zugriff: false },
    });
    rendern();
    // Vorbedingung: die freien Quellen liefen — sonst wäre „keine Anfrage" trivial.
    await nordDa();
    await waitFor(() => expect(aufrufe['/api/einsaetze/1/hazard-areas']).toBe(1));
    expect(aufrufe['/api/einsaetze/1/persons']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/tasks']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/resource-requests']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/etb']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/reports/check-ins']).toBeUndefined();

    // Alarmzeile: gesperrte Quellen fehlen still, kein „Stand unvollständig“ (Spec
    // `lage-alarmzeile`, „Ruhe nur bei vollständigen Quellen“).
    const alarm = screen.getByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(alarm).toHaveAttribute('data-stand', 'vollstaendig'));
    expect(alarm).not.toHaveTextContent('Stand unvollständig');
    expect(alarm).not.toHaveTextContent(/vermisst|Rückmeldung/);

    // Abschnitte des gesperrten Moduls: „—“ mit Grund statt „keine" und statt Ausfall, kein Link.
    // Die Paneelreihen kommen erst mit den Quellen der Gliederung (LLH-1481).
    await waitFor(() => vorgaenge());
    for (const name of ['Meldungen', 'Aufträge', 'Nachforderungen']) {
      const a = abschnitt(name);
      expect(within(a).getByText('nicht freigegeben')).toBeInTheDocument();
      expect(within(a).queryByText('keine')).toBeNull();
      expect(within(a).queryByRole('link')).toBeNull();
      expect(abschnittZahl(name)).toHaveTextContent(/^—$/);
    }
    expect(aufrufe['/api/einsaetze/1/reports']).toBeUndefined();
    const entscheidungen = paneel(/Entscheidungen/);
    expect(within(entscheidungen).getByText('Modul nicht freigegeben.')).toBeInTheDocument();
    expect(within(entscheidungen).queryByText(/Noch keine Entscheidung/)).toBeNull();
    // Kein Sprung ins gesperrte ETB.
    expect(within(entscheidungen).queryByRole('button', { name: 'ETB' })).toBeNull();

    // Abschnittszeile ohne Rückmeldung und ohne Aufträge, aber ohne Ausfall.
    const zeile = await within(paneel('Einsatzabschnitte')).findByRole('link', {
      name: /Abschnitt Nord/,
    });
    await waitFor(() => expect(zeile).toHaveTextContent('1/0/1//2'));
    expect(zeile).not.toHaveTextContent(/Rückmeldung/);
    expect(screen.queryByText(/Aufträge nicht abrufbar/)).toBeNull();

    // Nirgends ein Ausfall.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Stand unbekannt/)).toBeNull();
  });

  it('Meldungen fehlen im Modulzähler (gesperrt): „—“ mit Grund und ohne Link, nie 0', async () => {
    stelleBereit({
      ...volleDaten,
      zaehler: {
        auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 1 },
        nachforderungen: { offen: 3, angefordert: 1, zugesagt: 1, unterwegs: 1, ueberfaellig: 0 },
      },
    });
    rendern();
    await waitFor(() => expect(abschnittZahl('Aufträge')).toHaveTextContent('2'));
    const meldungen = abschnitt('Meldungen');
    expect(abschnittZahl('Meldungen')).toHaveTextContent(/^—$/);
    expect(meldungen).toHaveTextContent('nicht freigegeben');
    expect(within(meldungen).queryByRole('link')).toBeNull();
  });

  it('gesperrtes Modul mit Altstand im Cache: keine Daten aus dem Cache', async () => {
    mitFreigaben({ personen: { zugriff: false } });
    // Eigener Client ohne `gcTime: 0`: der Altstand muss den ersten await überleben. Literaler Key.
    const client = new QueryClient();
    client.setQueryData(['einsatz-personen', 1], volleDaten.personen);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/ueberblick" element={<UeberblickPage />} />
      </Routes>,
      { route: '/einsaetze/1/ueberblick', client },
    );
    await nordDa();
    // Die Alarmzeile liest den Altstand nicht: kein „vermisst“ aus dem Cache.
    const alarm = screen.getByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(alarm).toHaveAttribute('data-stand', 'vollstaendig'));
    expect(alarm).not.toHaveTextContent('vermisst');
  });

  it('solange die Freigaben laden, geht keine modulgebundene Anfrage raus', async () => {
    const aufrufe = mitFreigaben('haengt');
    rendern();
    // Modul-lose Quellen laufen; die gebundenen warten und zeigen „wird abgerufen", keine Null.
    await screen.findByText('Hochwasser Weserlauf');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    for (const pfad of GEBUNDEN) expect(aufrufe[pfad], pfad).toBeUndefined();
    expect(screen.getByRole('status', { name: 'Was brennt' })).not.toHaveTextContent(
      'Nichts brennt',
    );
    expect(within(vorgaenge()).getByText('wird abgerufen')).toBeInTheDocument();
  });

  it('scheitern die Freigaben, steht „Stand unbekannt" — und nichts Gebundenes wird geladen', async () => {
    const aufrufe = mitFreigaben('fehler');
    rendern();
    const p = await waitFor(() => vorgaenge());
    expect(await within(p).findByRole('alert')).toHaveTextContent('Stand unbekannt');
    // Kein still leeres, ruhiges Bild.
    expect(within(p).queryByText('keine')).toBeNull();
    expect(screen.getByRole('status', { name: 'Was brennt' })).toHaveAttribute(
      'data-stand',
      'unvollstaendig',
    );
    for (const pfad of GEBUNDEN) expect(aufrufe[pfad], pfad).toBeUndefined();
  });

  it('„Erneut abrufen" nach gescheiterten Freigaben fragt sie neu an, nicht die gesperrten Listen', async () => {
    let freigabenAbrufe = 0;
    const aufrufe = mitFreigaben({}, [
      http.get('/api/einsaetze/1/module-access', () => {
        freigabenAbrufe += 1;
        return freigabenAbrufe === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(freigabenFixture({ auftraege: { zugriff: false } }));
      }),
    ]);
    rendern();
    const p = await waitFor(() => vorgaenge());
    await userEvent.click(await within(p).findByRole('button', { name: 'Erneut abrufen' }));
    expect(await within(abschnitt('Aufträge')).findByText('nicht freigegeben')).toBeInTheDocument();
    expect(aufrufe['/api/einsaetze/1/tasks']).toBeUndefined();
  });

  it('freies Modul mit echtem Ausfall bleibt ein Ausfall', async () => {
    mitFreigaben({}, [
      http.get('/api/einsaetze/1/persons', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    const alarm = await screen.findByRole('status', { name: 'Was brennt' });
    await waitFor(() =>
      expect(alarm).toHaveTextContent('Stand unvollständig: Betroffene nicht geladen'),
    );
  });

  /** Der Einsatz ohne Lagebesprechung: dann trägt nur noch eine gebundene Quelle Fristen. */
  const ohneLagebesprechung = http.get('/api/einsaetze/1', () =>
    HttpResponse.json({ ...einsatz, naechste_lagebesprechung_at: null }),
  );

  it('Nächste Marken (LFH-887): Aufträge und Erinnerungen gesperrt → der Grund, keine Leeraussage', async () => {
    mitFreigaben({ auftraege: { zugriff: false }, erinnerungen: { zugriff: false } }, [
      ohneLagebesprechung,
    ]);
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    await waitFor(() =>
      expect(p).toHaveTextContent('Nicht freigegeben: Aufträge/Befehle, Erinnerungen.'),
    );
    expect(p).toHaveTextContent('Keine sichtbaren Fristen.');
    expect(within(p).queryByText('Keine anstehenden Fristen.')).toBeNull();
    // Kein Ausfall: der Grund ist kein „Stand unbekannt".
    expect(within(p).queryByRole('alert')).toBeNull();
  });

  it('Nächste Marken (LFH-887): eine gesperrte Fristquelle steht als Hinweis unter den Marken', async () => {
    mitFreigaben({
      erinnerungen: { zugriff: false },
      abloesung: { zugriff: false },
      'wetter-pegel': { zugriff: false },
    });
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    await within(p).findByText('Lagebesprechung');
    // Die freien Quellen tragen weiter bei (Aufträge), die Liste gilt nicht als vollständig.
    expect(within(p).getAllByRole('link')).toHaveLength(3);
    expect(p).toHaveTextContent('Nicht freigegeben: Erinnerungen, Ablösung, Wetter & Pegel.');
  });

  it('Nächste Marken (LFH-887): ein ausgeblendetes Modul ist keine fehlende Freigabe', async () => {
    mitFreigaben({ erinnerungen: { sichtbar: false, zugriff: false } }, [ohneLagebesprechung]);
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    await within(p).findByText('Trupps verlegen');
    expect(p).not.toHaveTextContent(/Nicht freigegeben/);
  });

  it('Kräfte (LFH-887): nur Fahrzeuge und Material gesperrt → Stärke in der Abschnittszeile', async () => {
    const aufrufe = mitFreigaben({ fahrzeuge: { zugriff: false }, material: { zugriff: false } });
    rendern();
    const zeile = await within(await waitFor(() => paneel('Einsatzabschnitte'))).findByRole(
      'link',
      {
        name: /Abschnitt Nord/,
      },
    );
    expect(zeile).toHaveTextContent('1/0/1//2');
    expect(aufrufe['/api/einsaetze/1/vehicles']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/material']).toBeUndefined();
  });

  it('Abschnittspaneel (LFH-887): leer bei gesperrten Fahrzeugen behauptet nicht „keine Kräfte"', async () => {
    mitFreigaben({ fahrzeuge: { zugriff: false } }, [
      http.get('/api/einsaetze/1/sectors', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/units', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/personnel', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    await waitFor(() =>
      expect(p).toHaveTextContent(
        'Noch keine Abschnitte, Einheiten oder Personal erfasst. Nicht freigegeben: Fahrzeuge.',
      ),
    );
    expect(within(p).queryByText('Noch keine Abschnitte und keine Kräfte erfasst.')).toBeNull();
  });

  it('Kräfte (LFH-887): Personal gesperrt → das Abschnittspaneel nennt den Grund', async () => {
    mitFreigaben({ personal: { zugriff: false } });
    rendern();
    // Die Paneelreihen kommen mit den übrigen Quellen der Gliederung (LLH-1481).
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    expect(within(p).getByText('Modul nicht freigegeben.')).toBeInTheDocument();
  });
});

/**
 * Sprungziele in fremde Module (LFH-888, Spec `modul-freigabe`, design.md D4): ein Knopf steht bei
 * gesperrtem Ziel gesperrt mit Grund da, ein Kennzahl- oder Zeilenziel entfällt. Unbekannte
 * Freigaben sperren nichts.
 */
describe('UeberblickPage Sprungziele (LFH-888)', () => {
  function mitFreigaben(freigaben: Record<string, Partial<ModulFreigabe>> | 'haengt') {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/module-access', async () => {
        if (freigaben === 'haengt') await delay('infinite');
        return HttpResponse.json(freigabenFixture(freigaben === 'haengt' ? {} : freigaben));
      }),
    ]);
  }
  /** Die Abschnittszeile „Abschnitt Nord“: steht sie, liefen die freien Quellen der Gliederung. */
  const nordDa = async () =>
    expect(
      await within(await waitFor(() => paneel('Einsatzabschnitte'))).findByRole('link', {
        name: /Abschnitt Nord/,
      }),
    ).toBeInTheDocument();

  it('gesperrtes ETB und Lageberichte: beide Kopfaktionen gesperrt mit „Keine Berechtigung“', async () => {
    mitFreigaben({ etb: { zugriff: false }, lageberichte: { zugriff: false } });
    rendern();
    const eintrag = await screen.findByRole('button', { name: /Eintrag/ });
    const lagebericht = screen.getByRole('button', { name: /Lagebericht/ });
    await waitFor(() => expect(eintrag).toBeDisabled());
    expect(eintrag).toHaveAttribute('title', 'Keine Berechtigung');
    expect(lagebericht).toBeDisabled();
    expect(lagebericht).toHaveAttribute('title', 'Keine Berechtigung');
  });

  it('freie Ziele: beide Kopfaktionen bedienbar, ohne Sperrgrund', async () => {
    mitFreigaben({});
    rendern();
    await koerperDa();
    const lagebericht = screen.getByRole('button', { name: /Lagebericht/ });
    await nordDa();
    expect(lagebericht).toBeEnabled();
    expect(lagebericht).not.toHaveAttribute('title');
    expect(screen.getByRole('button', { name: /Eintrag/ })).toBeEnabled();
  });

  it('Freigaben laden noch: die Kopfaktionen bleiben bedienbar (kein Aufblitzen)', async () => {
    mitFreigaben('haengt');
    rendern();
    await koerperDa();
    expect(screen.getByRole('button', { name: /Lagebericht/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Eintrag/ })).toBeEnabled();
  });

  it('gesperrtes Lagebild: die Kopfaktion „Lagebild“ steht gesperrt mit Grund (LLH-1743)', async () => {
    mitFreigaben({ 'lage-dashboard': { zugriff: false } });
    rendern();
    const knopf = await screen.findByRole('button', { name: 'Lagebild' });
    await waitFor(() => expect(knopf).toBeDisabled());
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
  });

  it('gesperrte Aufträge: der Eintrag der Alarmzeile steht ohne Link (LLH-1743)', async () => {
    mitFreigaben({ auftraege: { zugriff: false } });
    rendern();
    const zeile = await screen.findByRole('status', { name: 'Was brennt' });
    await waitFor(() => expect(zeile).toHaveTextContent('1 Auftrag überfällig'));
    expect(within(zeile).queryByRole('link', { name: /Auftrag/ })).toBeNull();
  });

  it('freie Aufträge: der Eintrag der Alarmzeile verlinkt', async () => {
    mitFreigaben({});
    rendern();
    const zeile = await screen.findByRole('status', { name: 'Was brennt' });
    expect(
      await within(zeile).findByRole('link', { name: '1 Auftrag überfällig' }),
    ).toHaveAttribute('href', '/einsaetze/1/auftraege');
  });

  it('gesperrte Lagebesprechung: die Marke steht ohne Link', async () => {
    mitFreigaben({ lagebesprechung: { zugriff: false } });
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = await within(p).findByText('Lagebesprechung');
    await waitFor(() => expect(marke.closest('a')).toBeNull());
  });

  // LLH-1111: die Marke hängt an der Lagebesprechung.
  it('freie Lagebesprechung: die Marke führt in das Modul', async () => {
    mitFreigaben({});
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = await within(p).findByText('Lagebesprechung');
    await waitFor(() =>
      expect(marke.closest('a')).toHaveAttribute('href', '/einsaetze/1/lagebesprechung'),
    );
  });
});

/**
 * Startliste „Einsatz starten“ (LLH-1815, Spec `ueberblick-startliste`): fünf Punkte unter der
 * Alarmzeile, nur mit Schreibrecht am aktiven Einsatz, weg, sobald nichts mehr offen ist, und je
 * Browser ausblendbar.
 */
describe('UeberblickPage Startliste „Einsatz starten“ (LLH-1815)', () => {
  const leer = {
    personen: [],
    personal: [],
    fahrzeuge: [],
    material: [],
    einheiten: [],
    abschnitte: [],
    gefahren: [],
    auftraege: [],
    erinnerungen: [],
    etb: [],
  } as unknown as Daten;

  /** Ein Einsatz, an dem alle fünf Punkte erledigt sind (volle Daten tragen Abschnitt und Kräfte). */
  const fertigerKopf = {
    ...einsatz,
    einsatzort: 'Deich West',
    einsatzort_lat: 52.1,
    einsatzort_lon: 9.3,
    einsatzleiter: {
      art: 'personal',
      name: 'Anna Schulz',
      personal_id: 3,
      personal_noch_disponiert: true,
      seit: vor(60),
    },
  };
  const eineLage = [{ id: 77, typ: 'lage' }];

  /** Zählt die Abrufe der jüngsten Lagefeststellung mit, ohne die Antwort zu ändern. */
  function lageAbrufe() {
    const zaehler = { n: 0 };
    server.use(
      http.get('/api/einsaetze/1/etb', ({ request }) => {
        if (new URL(request.url).searchParams.get('typ') === 'lage') zaehler.n += 1;
      }),
    );
    return zaehler;
  }

  const startliste = () => screen.queryByRole('region', { name: 'Einsatz starten' });
  const punkt = (schluessel: string) =>
    document.querySelector<HTMLElement>(
      `[data-lfh="startliste-punkt"][data-schluessel="${schluessel}"]`,
    )!;

  beforeEach(() => {
    localStorage.clear();
    // Angemeldet: ohne Person räumt der Start nach der 401 den Gerätespeicher (LFH-767), samt dem
    // Ausblenden der Startliste, mitten im Test.
    server.use(meHandler(benutzerFixture({ id: 9 })));
  });

  it('Wächter: auch die Startliste steht in ihrer eigenen KachelGrenze (LLH-1958)', async () => {
    stelleBereit(leer);
    const { container } = rendern();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    await screen.findByRole('region', { name: 'Einsatzabschnitte' });
    pruefeKachelGrenzen(container.querySelector('[data-lfh="ueberblick"]')!, 6);
  });

  it('leerer Einsatz: fünf offene Punkte unter der Alarmzeile, vor den Paneelreihen, ohne Zahl', async () => {
    stelleBereit(leer);
    rendern();
    const p = await screen.findByRole('region', { name: 'Einsatz starten' });
    const punkte = [...p.querySelectorAll<HTMLElement>('[data-lfh="startliste-punkt"]')];
    expect(punkte.map((x) => [x.dataset.schluessel, x.dataset.zustand])).toEqual([
      ['einsatzort', 'offen'],
      ['einsatzleiter', 'offen'],
      ['einsatzabschnitte', 'offen'],
      ['kraefte', 'offen'],
      ['lage', 'offen'],
    ]);
    // Reihenfolge: Alarmzeile → Startliste → Paneelreihen (seit LLH-1748 ohne Band).
    const alarm = screen.getByRole('status', { name: 'Was brennt' });
    expect(folgt(alarm, p)).toBe(true);
    expect(folgt(p, document.querySelector('[data-lfh="ueberblick-paneele"]')!)).toBe(true);
    expect(keinBand()).toBeNull();
    expect(p.closest('[data-lfh="ueberblick-startliste"]')).not.toBeNull();
    // Haken statt Kennzahl (Spec `lage-verdichtung`).
    expect(p.textContent).not.toMatch(/\d/);
  });

  it('jeder offene Punkt springt in seine Erfassung', async () => {
    stelleBereit(leer);
    rendern();
    const p = await screen.findByRole('region', { name: 'Einsatz starten' });
    const ziele = within(p)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(ziele).toEqual([
      '/einsaetze/1/einsatzdaten?paneel=einsatzort',
      '/einsaetze/1/einsatzdaten?paneel=fuehrungsstelle',
      '/einsaetze/1/einsatzabschnitte?neu=1',
      '/einsaetze/1/einheiten',
      '/einsaetze/1/etb?neu=1',
    ]);
    await userEvent.click(within(p).getByRole('link', { name: /Einsatzleiter/ }));
    expect(screen.getByTestId('ort')).toHaveTextContent(
      '/einsaetze/1/einsatzdaten?paneel=fuehrungsstelle',
    );
  });

  it('erledigte Punkte tragen Haken und Wert, ohne Sprung; der Ort ohne Koordinate „nicht verortet“', async () => {
    stelleBereit({ ...volleDaten }, [
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...fertigerKopf, einsatzort_lat: null, einsatzort_lon: null }),
      ),
    ]);
    rendern();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(punkt('einsatzort')).toHaveAttribute('data-zustand', 'erledigt');
    expect(punkt('einsatzort')).toHaveTextContent('Deich West');
    expect(punkt('einsatzort')).toHaveTextContent('nicht verortet');
    expect(punkt('einsatzleiter')).toHaveTextContent('Anna Schulz');
    expect(punkt('kraefte')).toHaveAttribute('data-zustand', 'erledigt');
    for (const s of ['einsatzort', 'einsatzleiter', 'einsatzabschnitte', 'kraefte']) {
      expect(within(punkt(s)).queryByRole('link'), s).toBeNull();
      expect(punkt(s).tagName).not.toBe('A');
    }
    // Nur die Lage fehlt noch.
    expect(punkt('lage')).toHaveAttribute('data-zustand', 'offen');
    expect(punkt('lage').closest('a')).toHaveAttribute('href', '/einsaetze/1/etb?neu=1');
  });

  it('Startliste ohne Zahl: zwei Einheiten, offener Einsatzort → Kräfte mit Haken, keine Zahl', async () => {
    stelleBereit({
      ...leer,
      einheiten: [volleDaten.einheiten[0], { ...volleDaten.einheiten[0], id: 11, name: 'Zug 2' }],
    } as unknown as Daten);
    rendern();
    const p = await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(punkt('kraefte')).toHaveAttribute('data-zustand', 'erledigt');
    expect(punkt('einsatzort')).toHaveAttribute('data-zustand', 'offen');
    expect(p.textContent).not.toMatch(/\d/);
  });

  it('alles erledigt: kein Paneel und keine Reihe', async () => {
    stelleBereit({ ...volleDaten, lage: eineLage }, [
      http.get('/api/einsaetze/1', () => HttpResponse.json(fertigerKopf)),
    ]);
    rendern();
    await waitFor(() => paneel('Einsatzabschnitte'));
    expect(startliste()).toBeNull();
    expect(document.querySelector('[data-lfh="ueberblick-startliste"]')).toBeNull();
  });

  it('Übung: dieselben fünf Punkte', async () => {
    stelleBereit(leer, [
      http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, einsatzart: 'uebung' })),
    ]);
    rendern();
    const p = await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(p.querySelectorAll('[data-lfh="startliste-punkt"]')).toHaveLength(5);
  });

  for (const [fall, kopf] of [
    ['Beobachter', { ...einsatz, meine_rolle: 'beobachter' }],
    ['abgeschlossener Einsatz', { ...einsatz, status: 'abgeschlossen' }],
    [
      'Spiegel',
      {
        ...einsatz,
        spiegel: {
          gegenstelle: 'ELW 1',
          beendet: false,
          antraege_ausstehend: 0,
          antraege_abgelehnt: 0,
          bruchstelle: 0,
        },
      },
    ],
  ] as const) {
    it(`${fall}: kein Paneel und keine Abfrage der Lagefeststellung`, async () => {
      stelleBereit(leer, [http.get('/api/einsaetze/1', () => HttpResponse.json(kopf))]);
      const abrufe = lageAbrufe();
      rendern();
      await waitFor(() => paneel('Einsatzabschnitte'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(startliste()).toBeNull();
      expect(abrufe.n).toBe(0);
    });
  }

  it('ETB gesperrt: der Punkt steht „—“ mit Grund, ohne Sprung und ohne Abfrage', async () => {
    stelleBereit(leer, [
      http.get('/api/einsaetze/1/module-access', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    ]);
    const abrufe = lageAbrufe();
    rendern();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(punkt('lage')).toHaveAttribute('data-zustand', 'gesperrt');
    expect(punkt('lage')).toHaveTextContent('—');
    expect(punkt('lage')).toHaveTextContent('nicht freigegeben');
    expect(punkt('lage').closest('a')).toBeNull();
    expect(abrufe.n).toBe(0);
  });

  it('ETB gesperrt, alles andere erledigt: kein Paneel', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1', () => HttpResponse.json(fertigerKopf)),
      http.get('/api/einsaetze/1/module-access', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    ]);
    rendern();
    await waitFor(() => paneel('Einsatzabschnitte'));
    expect(startliste()).toBeNull();
  });

  it('Quelle ausgefallen: Einsatzabschnitte „nicht geladen“, das Paneel bleibt', async () => {
    stelleBereit({ ...volleDaten, lage: eineLage }, [
      http.get('/api/einsaetze/1', () => HttpResponse.json(fertigerKopf)),
      http.get('/api/einsaetze/1/sectors', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(punkt('einsatzabschnitte')).toHaveAttribute('data-zustand', 'unbekannt');
    expect(punkt('einsatzabschnitte')).toHaveTextContent('nicht geladen');
    expect(punkt('einsatzabschnitte').closest('a')).toBeNull();
  });

  /*
   * Review LLH-1815 (Befunde 6, 10): ein gescheiterter Neuabruf behält in TanStack v5 seine Daten.
   * Die zuletzt geladenen gelten weiter; „unbekannt“ heißt nur: nie geladen. Sonst holte ein 502
   * die schon verschwundene Reihe zurück, und die Paneelreihen rutschten nach unten.
   */
  it('alles erledigt, dann scheitert ein Neuabruf: die Startliste bleibt weg', async () => {
    // Kräfte nur über eine Einheit: fällt die Einheitenliste aus, trägt das Personal nichts.
    stelleBereit({ ...volleDaten, personal: [], lage: eineLage }, [
      http.get('/api/einsaetze/1', () => HttpResponse.json(fertigerKopf)),
    ]);
    const { client } = rendern();
    await waitFor(() => paneel('Einsatzabschnitte'));
    expect(startliste()).toBeNull();
    const kaputt = () => HttpResponse.json({ error: 'kaputt' }, { status: 502 });
    server.use(
      http.get('/api/einsaetze/1/sectors', kaputt),
      http.get('/api/einsaetze/1/units', kaputt),
      http.get('/api/einsaetze/1/etb', ({ request }) =>
        new URL(request.url).searchParams.get('typ') === 'lage' ? kaputt() : undefined,
      ),
    );
    await act(() => client.refetchQueries());
    expect(client.getQueryState(einsatzKeys.etbListe(1, { typ: 'lage', limit: 1 }))?.status).toBe(
      'error',
    );
    expect(client.getQueryState(einsatzKeys.einheiten(1))?.status).toBe('error');
    expect(startliste()).toBeNull();
    expect(document.querySelector('[data-lfh="ueberblick-startliste"]')).toBeNull();
  });

  // Review LLH-1815 (Befund 7): ein Punkt „nicht geladen“ hat einen sichtbaren Weg zum Neuladen.
  it('Quelle ausgefallen: „Erneut abrufen“ am Punkt lädt die Quelle neu', async () => {
    stelleBereit({ ...volleDaten, lage: eineLage }, [
      http.get('/api/einsaetze/1', () => HttpResponse.json(fertigerKopf)),
      http.get('/api/einsaetze/1/sectors', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    const knopf = within(punkt('einsatzabschnitte')).getByRole('button', {
      name: 'Erneut abrufen: Einsatzabschnitte',
    });
    for (const s of ['einsatzort', 'einsatzleiter', 'kraefte', 'lage']) {
      expect(within(punkt(s)).queryByRole('button'), s).toBeNull();
    }
    server.use(
      http.get('/api/einsaetze/1/sectors', () => HttpResponse.json(volleDaten.abschnitte)),
    );
    await userEvent.click(knopf);
    // Der letzte unbekannte Punkt ist erledigt: die Reihe fällt nach der Handlung weg.
    await waitFor(() => expect(startliste()).toBeNull());
  });

  /*
   * Review LLH-1815 (Befund 8): die gemeinsame Ladeschranke gilt nur beim ersten Aufbau. Bekommt
   * eine lesende Person live Schreibrecht, lädt die Lagefeststellung zum ersten Mal; die
   * Paneelreihen bleiben dabei eingehängt, und die Startliste erscheint erst mit ihren Quellen.
   */
  it('Schreibrecht kommt live dazu: die Paneelreihen bleiben stehen, solange die Lage lädt', async () => {
    let loslassen!: () => void;
    const tor = new Promise<void>((f) => (loslassen = f));
    const lage = { n: 0 };
    stelleBereit(leer, [
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' }),
      ),
    ]);
    const { client } = rendern();
    await waitFor(() => paneel('Einsatzabschnitte'));
    const zweiteReiheVorher = document.querySelector('[data-lfh="ueberblick-paneele-gliederung"]')!;
    expect(zweiteReiheVorher).not.toBeNull();
    const reihenVorher = document.querySelector('[data-lfh="ueberblick-paneele"]')!;
    expect(reihenVorher).not.toBeNull();
    expect(startliste()).toBeNull();

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/1/etb', async ({ request }) => {
        if (new URL(request.url).searchParams.get('typ') !== 'lage') return;
        lage.n += 1;
        await tor;
        return HttpResponse.json([]);
      }),
    );
    await act(() => client.refetchQueries({ queryKey: einsatzKeys.einsatz(1) }));
    await waitFor(() => expect(lage.n).toBe(1));
    expect(zweiteReiheVorher.isConnected).toBe(true);
    expect(reihenVorher.isConnected).toBe(true);
    // Kein „nicht geladen“ dazwischen: die Liste steht erst mit ihren Quellen.
    expect(startliste()).toBeNull();

    loslassen();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(zweiteReiheVorher.isConnected).toBe(true);
    expect(reihenVorher.isConnected).toBe(true);
  });

  /*
   * LLH-1955: als aufgebaut gelten die Paneelreihen erst, wenn sie im Bild standen. Verdeckt die
   * Startliste sie noch, und wird in der Zeit ein Modul freigegeben, wartet der erste Aufbau auch
   * auf dessen Quelle; sonst erschienen die Reihen mit einem wachsenden Paneel.
   */
  it('während die Startliste lädt, wird ein Modul freigegeben: die Reihen warten auch auf seine Quelle', async () => {
    let lageLos!: () => void;
    const lageTor = new Promise<void>((f) => (lageLos = f));
    let auftraegeLos!: () => void;
    const auftraegeTor = new Promise<void>((f) => (auftraegeLos = f));
    const abrufe = { lage: 0, auftraege: 0 };
    stelleBereit(leer, [
      http.get('/api/einsaetze/1/module-access', () =>
        HttpResponse.json(freigabenFixture({ auftraege: { zugriff: false } })),
      ),
      http.get('/api/einsaetze/1/etb', async ({ request }) => {
        if (new URL(request.url).searchParams.get('typ') !== 'lage') return;
        abrufe.lage += 1;
        await lageTor;
        return HttpResponse.json([]);
      }),
    ]);
    const { client } = rendern();
    await screen.findByText('Hochwasser Weserlauf');
    await waitFor(() => expect(abrufe.lage).toBe(1));
    expect(document.querySelector('[data-lfh="ueberblick-paneele"]')).toBeNull();

    server.use(
      http.get('/api/einsaetze/1/module-access', () => HttpResponse.json(freigabenFixture())),
      http.get('/api/einsaetze/1/tasks', async () => {
        abrufe.auftraege += 1;
        await auftraegeTor;
        return HttpResponse.json(leer.auftraege);
      }),
    );
    await act(() => client.refetchQueries({ queryKey: einsatzKeys.modulFreigaben(1) }));
    await waitFor(() => expect(abrufe.auftraege).toBe(1));

    lageLos();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(document.querySelector('[data-lfh="ueberblick-paneele"]')).toBeNull();

    auftraegeLos();
    await waitFor(() => paneel('Nächste Marken'));
    expect(document.querySelector('[data-lfh="ueberblick-paneele"]')).not.toBeNull();
  });

  it('fragt die jüngste Lagefeststellung genau einmal ab: Typ „Lage“, ein Eintrag', async () => {
    const urls: string[] = [];
    stelleBereit(leer);
    server.use(
      http.get('/api/einsaetze/1/etb', ({ request }) => {
        urls.push(new URL(request.url).search);
      }),
    );
    rendern();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(urls.filter((u) => u.includes('typ=lage'))).toEqual(['?typ=lage&limit=1']);
  });

  /*
   * Ladeschranke (Spec „Kein Layoutsprung durch die Startliste“): die Reihe steht über den
   * Paneelreihen, also warten Startliste und Paneelreihen gemeinsam auf ihre Quellen. Die
   * Alarmzeile darüber hat eine feste Höhe und steht sofort.
   */
  it('langsame Lage-Abfrage: Startliste und Paneelreihen erscheinen zusammen', async () => {
    let loslassen!: () => void;
    const tor = new Promise<void>((f) => (loslassen = f));
    stelleBereit(leer, [
      http.get('/api/einsaetze/1/etb', async ({ request }) => {
        if (new URL(request.url).searchParams.get('typ') !== 'lage') return;
        await tor;
        return HttpResponse.json([]);
      }),
    ]);
    rendern();
    await screen.findByText('Hochwasser Weserlauf');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByRole('status', { name: 'Was brennt' })).toBeInTheDocument();
    expect(startliste()).toBeNull();
    expect(document.querySelector('[data-lfh="ueberblick-paneele"]')).toBeNull();
    loslassen();
    await screen.findByRole('region', { name: 'Einsatz starten' });
    expect(document.querySelector('[data-lfh="ueberblick-paneele"]')).not.toBeNull();
    expect(keinBand()).toBeNull();
  });

  it('ausgeblendet ist die Liste weg und bleibt es nach dem Neuladen; die Lage wird nicht mehr gefragt', async () => {
    stelleBereit(leer);
    const erste = rendern();
    const p = await screen.findByRole('region', { name: 'Einsatz starten' });
    await userEvent.click(within(p).getByRole('button', { name: 'Ausblenden' }));
    expect(startliste()).toBeNull();
    expect(document.querySelector('[data-lfh="ueberblick-startliste"]')).toBeNull();
    expect(localStorage.getItem('startliste-ausgeblendet:1')).toBe('1');
    erste.unmount();

    const abrufe = lageAbrufe();
    rendern();
    await waitFor(() => paneel('Einsatzabschnitte'));
    expect(startliste()).toBeNull();
    expect(abrufe.n).toBe(0);
  });

  it('Speicher wirft: ausgeblendet bis zum Neuladen, danach steht die Liste wieder', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('voll', 'QuotaExceededError');
    });
    try {
      stelleBereit(leer);
      const erste = rendern();
      const p = await screen.findByRole('region', { name: 'Einsatz starten' });
      await userEvent.click(within(p).getByRole('button', { name: 'Ausblenden' }));
      expect(startliste()).toBeNull();
      erste.unmount();
      rendern();
      expect(await screen.findByRole('region', { name: 'Einsatz starten' })).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });
});
