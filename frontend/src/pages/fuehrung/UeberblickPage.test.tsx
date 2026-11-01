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
    meldungen: { offen: 4, ungesehen: 2, bestaetigung_ueberfaellig: 0 },
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
    http.get('/api/einsaetze/1/personen', json(d.personen)),
    http.get('/api/einsaetze/1/personal', json(d.personal)),
    http.get('/api/einsaetze/1/fahrzeuge', json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', json(d.material)),
    http.get('/api/einsaetze/1/einheiten', json(d.einheiten)),
    http.get('/api/einsaetze/1/abschnitte', json(d.abschnitte)),
    http.get('/api/einsaetze/1/gefahrengebiete', json(d.gefahren)),
    http.get('/api/einsaetze/1/auftraege', json(d.auftraege)),
    http.get(
      '/api/einsaetze/1/modul-zaehler',
      json(
        d.zaehler ?? {
          auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
          meldungen: { offen: 0, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
          nachforderungen: { offen: 0, angefordert: 0, zugesagt: 0, unterwegs: 0, ueberfaellig: 0 },
          erinnerungen: { faellig: 0 },
          lagemeldungen: { neu: 0 },
        },
      ),
    ),
    http.get('/api/einsaetze/1/nachforderungen', json(d.nachforderungen ?? [])),
    http.get('/api/einsaetze/1/meldungen', json(d.meldungen ?? [])),
    http.get('/api/einsaetze/1/erinnerungen', json(d.erinnerungen)),
    http.get(
      '/api/einsaetze/1/meldungen/rueckmeldungen',
      json(d.rueckmeldungen ?? KEINE_RUECKMELDUNGEN),
    ),
    http.get('/api/einsaetze/1/pegel', json(d.pegel ?? [])),
    // Laufende Schichten; die Modul-Freigaben (Sichtbarkeit der Ablösung) liefert der
    // MSW-Default: alles frei.
    http.get('/api/einsaetze/1/abloesungen', json([])),
    // Perioden der Einheiten für „n ohne Schicht ↗“ (LLH-1312): ohne offene Periode keine.
    http.get('/api/einsaetze/1/einheiten/zeitachse', json([])),
    http.get('/api/einsaetze/1/etb', ({ request }) => {
      const url = new URL(request.url);
      // Die Seite fragt NUR Entscheidungen ab — ein Abruf ohne Filter wäre ein Fehler.
      return url.searchParams.get('typ') === 'entscheidung'
        ? HttpResponse.json(d.etb)
        : HttpResponse.json({ error: 'ohne Typfilter' }, { status: 400 });
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

const band = () => screen.getByRole('group', { name: 'Lage in Zahlen' });
/** Das Band erst nach dem Einsatz-Abruf — der Körper wartet auf ihn (LFH-629). */
const bandDa = () => screen.findByRole('group', { name: 'Lage in Zahlen' });
const paneel = (name: string | RegExp) => screen.getByRole('region', { name });
/** Die Warnstufe steht im Seitenkopf wie im Lagebild (LLH-1140), nicht mehr im Band. */
const kopfLage = () => document.querySelector<HTMLElement>('[data-lfh="ueberblick-lage-kopf"]');
/** Paneel „Offene Vorgänge“ (LLH-1145) und einer seiner fünf Abschnitte. */
const vorgaenge = () => paneel('Offene Vorgänge');
const abschnitt = (name: string) => within(vorgaenge()).getByRole('region', { name });
const abschnittZahl = (name: string) =>
  abschnitt(name).querySelector('[data-lfh="abschnitt-zahl"]') as HTMLElement;

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

  it('Kennzahlenband: sechs Plätze mit Notiz, jede ein Link ins Fachmodul (LLH-1140)', async () => {
    stelleBereit(volleDaten);
    rendern();
    await waitFor(() => expect(within(band()).getByText('+1 in 60 min')).toBeInTheDocument());
    await waitFor(() => expect(within(band()).getByText('2 neu')).toBeInTheDocument());
    const links = within(band()).getAllByRole('link');
    // Belegung E1 (LLH-1140): Betroffene, Kräfte, Aufträge, Meldungen, Abschnitte, Dauer — die
    // Warnstufe ist keine Kennzahl mehr.
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/einsaetze/1/personen',
      '/einsaetze/1/kraefteuebersicht',
      '/einsaetze/1/auftraege',
      '/einsaetze/1/meldungen',
      '/einsaetze/1/einsatzabschnitte',
      '/einsaetze/1/einsatzdaten',
    ]);
    const b = within(band());
    expect(links[0]).toHaveTextContent('3');
    expect(b.getByText('F/UF/M//Σ 1/0/1//2')).toBeInTheDocument();
    expect(b.getByText('davon 1 ü.')).toBeInTheDocument();
    // „Meldungen offen“ aus dem Modulzähler (LFH-550), wie im Lagebild.
    expect(links[3]).toHaveTextContent('4');
    expect(b.getByText('Abschnitt Nord')).toBeInTheDocument();
    // Einsatzdauer: fünf Stunden seit Beginn.
    expect(links[5]).toHaveTextContent('5');
    expect(b.queryByText('Warnstufe')).toBeNull();
  });

  it('Meldungen offen: überfällige Bestätigung färbt die Kennzahl alarm', async () => {
    stelleBereit({
      ...volleDaten,
      zaehler: {
        auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
        meldungen: { offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 1 },
        nachforderungen: { offen: 0, angefordert: 0, zugesagt: 0, unterwegs: 0, ueberfaellig: 0 },
      },
    });
    rendern();
    const meldungen = await within(await bandDa()).findByRole('link', { name: /Meldungen offen/ });
    await waitFor(() => expect(meldungen).toHaveAttribute('data-ton', 'alarm'));
    expect(meldungen).toHaveTextContent('1 neu · 1 Bestätigung überfällig');
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
      '1 nicht beurteilt',
    );
    // Ohne festgelegten Pegel keine Pegel-Angabe.
    expect(kopfLage()).not.toHaveTextContent(/Pegel/);
  });

  it('ohne Gefahrengebiet kein Warnstufen-Hinweis im Kopf', async () => {
    stelleBereit({ ...volleDaten, gefahren: [] });
    rendern();
    await waitFor(() => expect(within(band()).getByText('+1 in 60 min')).toBeInTheDocument());
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
      http.get('/api/einsaetze/1/pegel', () => new HttpResponse(null, { status: 500 })),
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
    expect(zeile).toHaveAccessibleName(/Ausfall\s*1/);
    const werte = zeile.querySelectorAll('[data-lfh="abschnitt-status-wert"]');
    expect(Array.from(werte).map((z) => z.textContent)).toEqual(['0', '0', '1']);
    const balken = zeile.querySelectorAll<HTMLElement>('[data-lfh="abschnitt-status-anteil"]');
    expect(Array.from(balken).map((z) => z.style.width)).toEqual(['0%', '0%', '100%']);
    expect(within(p).queryByText(/Einheiten nach Status:/)).toBeNull();
    expect(within(p).getByText('1 Abschnitt · 1 Einheit')).toBeInTheDocument();
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
      http.get('/api/einsaetze/1/meldungen/rueckmeldungen', () => {
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
    expect(within(zeile).getByText('UA kritisch')).toBeInTheDocument();
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
        meldungen: { offen: 4, ungesehen: 2, bestaetigung_ueberfaellig: 1 },
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
      http.get('/api/einsaetze/1/abloesungen', () =>
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
      http.get('/api/einsaetze/1/einheiten/zeitachse', () =>
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

  describe('Offene Vorgänge · meine Stelle (LLH-1145 D5)', () => {
    const fuerS2 = () => {
      server.use(meHandler(benutzerFixture({ id: 9 }) as never));
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1', () =>
          HttpResponse.json({ ...einsatz, meine_sachgebiete: ['s2'] }),
        ),
        http.get('/api/einsaetze/1/auftraege', () =>
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
                  funktion: 's2',
                  snap_anzeige: 'S2',
                },
              ],
            }),
          ]),
        ),
      ]);
    };

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
        http.get('/api/einsaetze/1/modul-freigaben', () => {
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
        http.get('/api/einsaetze/1/wetter', () => HttpResponse.json(wetter())),
      ]);
      rendern();
      const p = await waitFor(() => paneel('Nächste Marken'));
      const m = await within(p).findByRole('link', { name: /Unwetterwarnung: Orkanböen/ });
      expect(m).toHaveAttribute('href', '/einsaetze/1/wetter-pegel');
      expect(m).toHaveAttribute('data-ton', 'neutral');
    });

    it('Modul ausgeblendet → keine Anfrage an …/wetter, keine Unwettermarke', async () => {
      let wetterAbrufe = 0;
      let freigabenGeliefert = 0;
      stelleBereit(volleDaten, [
        http.get('/api/einsaetze/1/wetter', () => {
          wetterAbrufe += 1;
          return HttpResponse.json(wetter());
        }),
        http.get('/api/einsaetze/1/modul-freigaben', () => {
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
      http.get('/api/einsaetze/1/abloesungen', () => HttpResponse.json([schicht(1), schicht(2)])),
      // Die Auto-Frist derselben Ablösung in den Erinnerungen darf keine zweite Marke werden.
      http.get('/api/einsaetze/1/erinnerungen', () =>
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
    expect(marke.closest('a')).toHaveAttribute('href', '/einsaetze/1/abloesung');
    expect(within(p).queryByText('Ablösung fällig: Florian 1')).toBeNull();
  });

  it('Nächste Marken: ohne sichtbares Modul Ablösung keine Anfrage und keine Marke (LFH-635)', async () => {
    let abgefragt = 0;
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ abloesung: { sichtbar: false } })),
      ),
      http.get('/api/einsaetze/1/abloesungen', () => {
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
    expect(within(band()).getByText('noch keine angelegt')).toBeInTheDocument();
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

  it('mit Schreibrecht: Leer-Aktion „Abschnitt anlegen", kein Rechtehinweis', async () => {
    stelleBereit(leereDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/einsatzabschnitte');
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
      http.get('/api/einsaetze/1/auftraege', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
      http.get('/api/einsaetze/1/modul-zaehler', () =>
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
    const auftragsZahl = within(band()).getByRole('link', { name: /Offene Aufträge/ });
    expect(auftragsZahl).toHaveTextContent('?');
    // Die Betroffenenzahl hängt an ihrer eigenen Quelle und bleibt lesbar.
    expect(within(band()).getByRole('link', { name: /Betroffene/ })).toHaveTextContent('3');
    // Die Folgeaufträge hängen am ETB-Eintrag, nicht an der Auftragsliste: die Zahl bleibt stehen.
    const entscheidungen = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    expect(await within(entscheidungen).findByText('2 Aufträge')).toBeInTheDocument();
    expect(screen.queryByText(/Folgeaufträge werden nicht gezählt/)).toBeNull();
  });

  it('Abschnitte: fehlen die Aufträge, sagt es der Fuß, die Stärke bleibt (LFH-962)', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/auftraege', () =>
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

  it('Ladezustand: Kennzahlen und Paneele zeigen „wird abgerufen", keine Null', async () => {
    const haengt = async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    };
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/personen', haengt),
      http.get('/api/einsaetze/1/auftraege', haengt),
    ]);
    rendern();
    const betroffene = await within(await bandDa()).findByRole('link', { name: /Betroffene/ });
    expect(betroffene).toHaveTextContent('wird abgerufen');
    expect(betroffene.querySelector('[aria-busy="true"]')).not.toBeNull();
    const p = abschnitt('Aufträge');
    expect(within(p).getByText('wird abgerufen').closest('[aria-busy="true"]')).not.toBeNull();
    // Eine unabhängige Quelle lädt trotzdem durch.
    await waitFor(() =>
      expect(within(band()).getByRole('link', { name: /Einsatzabschnitte/ })).toHaveTextContent(
        'Abschnitt Nord',
      ),
    );
  });

  /*
   * LFH-629: der Ladezustand eines Paneels hat die Form seines Leerzustands — Satz und, wo „leer"
   * eine Aktion trägt, ihr Platz in Knopfhöhe. Höhen misst jsdom nicht; die Seiten-CLS auf 390 px
   * misst `e2e/lagebild-cls-schmal.spec.ts`. Hier die Struktur, als Paar mit und ohne Aktion.
   */
  it('Ladezustand hält den Platz der Leeraktion, nur wo „leer" eine trägt (LFH-629)', async () => {
    const haengt = async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    };
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1/abschnitte', haengt),
      http.get('/api/einsaetze/1/auftraege', haengt),
    ]);
    rendern();
    await bandDa();
    // „Einsatzabschnitte" trägt leer „Abschnitt anlegen" — im Laden steht ihr Platz, kein Knopf.
    const abschnitte = paneel('Einsatzabschnitte');
    const laden = within(abschnitte).getByText('wird abgerufen').closest('[aria-busy="true"]')!;
    expect(laden.querySelectorAll('.ant-skeleton-button')).toHaveLength(1);
    expect(within(abschnitte).queryByRole('button', { name: /anlegen/ })).toBeNull();
    // Der Aufträge-Abschnitt der „Offenen Vorgänge" trägt leer keine Aktion, also kein Platz.
    const auftraege = abschnitt('Aufträge');
    expect(within(auftraege).getByText('wird abgerufen')).toBeInTheDocument();
    expect(vorgaenge().querySelectorAll('.ant-skeleton-button')).toHaveLength(0);
  });

  /*
   * LLH-1430: laden die Listen der „Offenen Vorgänge“, hält jeder Abschnitt so viele Zeilen, wie
   * der Modulzähler Einträge erwarten lässt (höchstens drei). Erinnerungen kennen nur die fälligen,
   * Ablösungen keinen Serverzähler; „meine Stelle“ zählt der Zähler nicht. Die Seiten-CLS misst
   * `e2e/ueberblick-vorgaenge-cls.spec.ts`.
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
            meldungen: { offen: 5, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
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
          http.get('/api/einsaetze/1/meldungen', haengt),
          http.get('/api/einsaetze/1/auftraege', haengt),
          http.get('/api/einsaetze/1/nachforderungen', haengt),
          http.get('/api/einsaetze/1/erinnerungen', haengt),
          http.get('/api/einsaetze/1/abloesungen', haengt),
        ],
      );
    const platzhalter = (name: string) =>
      abschnitt(name).querySelectorAll('[data-lfh="abschnitt-platzhalter"]').length;

    it('„alle“: Zeilen nach dem Zähler, 0 und unbekannt bleiben eine Zeile', async () => {
      listenHaengen();
      rendern();
      await waitFor(() => vorgaenge());
      // Der Zähler steht, die Listen laden noch.
      await waitFor(() => expect(abschnittZahl('Aufträge')).toHaveTextContent(/^2$/));
      for (const name of [
        'Meldungen',
        'Aufträge',
        'Nachforderungen',
        'Erinnerungen',
        'Ablösungen',
      ]) {
        expect(abschnitt(name).querySelector('[aria-busy="true"]')).not.toBeNull();
      }
      expect(platzhalter('Meldungen')).toBe(3);
      expect(platzhalter('Aufträge')).toBe(2);
      expect(platzhalter('Nachforderungen')).toBe(0);
      expect(platzhalter('Erinnerungen')).toBe(1);
      expect(platzhalter('Ablösungen')).toBe(0);
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
      await waitFor(() => expect(abschnittZahl('Aufträge')).toHaveTextContent(/^2/));
      for (const name of ['Meldungen', 'Aufträge', 'Erinnerungen']) {
        expect(platzhalter(name)).toBe(0);
      }
    });
  });

  it('Körper erst mit dem Einsatz: davor weder Band noch Paneele noch Rechtehinweis (LFH-629)', async () => {
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
    expect(screen.queryByRole('group', { name: 'Lage in Zahlen' })).toBeNull();
    expect(screen.queryByText('nur Einsatzleitung und Führungspersonal')).toBeNull();
    act(() => freigeben());
    // Mit dem Einsatz kommen Hinweis und Körper im selben Zug.
    expect(await screen.findByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(await bandDa()).toBeInTheDocument();
  });

  it('Körper erst mit dem Modulzähler: die Platzhalter der Vorgänge kennen ihre Zahl (LLH-1430)', async () => {
    let freigeben!: () => void;
    const tor = new Promise<void>((f) => (freigeben = f));
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1/modul-zaehler', async () => {
        await tor;
        return HttpResponse.json({
          auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
          meldungen: { offen: 0, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
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
    expect(await bandDa()).toBeInTheDocument();
  });

  it('ein gescheiterter Modulzähler hält den Körper nicht auf', async () => {
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1/modul-zaehler', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    expect(await bandDa()).toBeInTheDocument();
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

    it('die Kennzahl „Betroffene" merkt Personen', async () => {
      stelleBereit(volleDaten);
      rendern();
      await waitFor(() => expect(within(band()).getByText('+1 in 60 min')).toBeInTheDocument());
      expect(gemerkt()).toEqual([]);
      await userEvent.click(within(band()).getAllByRole('link')[0]);
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/personen');
      expect(gemerkt()).toEqual(['personen']);
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
    '/api/einsaetze/1/personen',
    '/api/einsaetze/1/personal',
    '/api/einsaetze/1/fahrzeuge',
    '/api/einsaetze/1/material',
    '/api/einsaetze/1/einheiten',
    '/api/einsaetze/1/einheiten/zeitachse',
    '/api/einsaetze/1/abschnitte',
    '/api/einsaetze/1/gefahrengebiete',
    '/api/einsaetze/1/auftraege',
    '/api/einsaetze/1/nachforderungen',
    '/api/einsaetze/1/meldungen',
    '/api/einsaetze/1/erinnerungen',
    '/api/einsaetze/1/etb',
    '/api/einsaetze/1/meldungen/rueckmeldungen',
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
      http.get('/api/einsaetze/1/modul-freigaben', async () => {
        if (freigaben === 'fehler') return new HttpResponse(null, { status: 500 });
        if (freigaben === 'haengt') {
          await delay('infinite');
        }
        return HttpResponse.json(freigabenFixture(freigaben === 'haengt' ? {} : freigaben));
      }),
    ]);
    return aufrufe;
  }

  /** Die Zelle einer Kennzahl im Band — mit oder ohne Link. */
  const zelle = (titel: string) =>
    within(band()).getByText(titel).closest('[data-lfh="kennzahl"]') as HTMLElement;

  it('Modul Einheiten gesperrt: keine Anfrage an die Zeitachse, kein Sprung „ohne Schicht“ (LLH-1312)', async () => {
    const aufrufe = mitFreigaben({ einheiten: { zugriff: false } });
    rendern();
    await waitFor(() => expect(aufrufe['/api/einsaetze/1/gefahrengebiete']).toBe(1));
    await waitFor(() => vorgaenge());
    expect(aufrufe['/api/einsaetze/1/einheiten/zeitachse']).toBeUndefined();
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
    await waitFor(() => expect(zelle('Einsatzabschnitte')).toHaveTextContent('Abschnitt Nord'));
    await waitFor(() => expect(aufrufe['/api/einsaetze/1/gefahrengebiete']).toBe(1));
    expect(aufrufe['/api/einsaetze/1/personen']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/auftraege']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/nachforderungen']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/etb']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/meldungen/rueckmeldungen']).toBeUndefined();

    // Betroffene: keine erfundene 0, kein „?", kein Link ins gesperrte Modul.
    const betroffene = zelle('Betroffene');
    expect(betroffene).toHaveTextContent('—');
    expect(betroffene).toHaveTextContent('nicht freigegeben');
    expect(betroffene).not.toHaveTextContent('0');
    expect(betroffene.closest('a')).toBeNull();
    expect(betroffene).not.toHaveTextContent('Stand unbekannt');

    // Abschnitte des gesperrten Moduls: „—“ mit Grund statt „keine" und statt Ausfall, kein Link.
    for (const name of ['Meldungen', 'Aufträge', 'Nachforderungen']) {
      const a = abschnitt(name);
      expect(within(a).getByText('nicht freigegeben')).toBeInTheDocument();
      expect(within(a).queryByText('keine')).toBeNull();
      expect(within(a).queryByRole('link')).toBeNull();
      expect(abschnittZahl(name)).toHaveTextContent(/^—$/);
    }
    expect(aufrufe['/api/einsaetze/1/meldungen']).toBeUndefined();
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
    await waitFor(() => expect(zelle('Offene Aufträge')).toHaveTextContent('2'));
    const meldungen = zelle('Meldungen offen');
    expect(meldungen).toHaveTextContent('—');
    expect(meldungen).toHaveTextContent('nicht freigegeben');
    expect(meldungen).not.toHaveTextContent('0');
    expect(meldungen.closest('a')).toBeNull();
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
    await waitFor(() => expect(zelle('Einsatzabschnitte')).toHaveTextContent('Abschnitt Nord'));
    const betroffene = zelle('Betroffene');
    expect(betroffene).toHaveTextContent('nicht freigegeben');
    expect(betroffene).not.toHaveTextContent('3');
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
    expect(zelle('Betroffene')).toHaveTextContent('wird abgerufen');
    expect(within(vorgaenge()).getByText('wird abgerufen')).toBeInTheDocument();
  });

  it('scheitern die Freigaben, steht „Stand unbekannt" — und nichts Gebundenes wird geladen', async () => {
    const aufrufe = mitFreigaben('fehler');
    rendern();
    const p = await waitFor(() => vorgaenge());
    expect(await within(p).findByRole('alert')).toHaveTextContent('Stand unbekannt');
    // Kein still leeres, ruhiges Bild.
    expect(within(p).queryByText('keine')).toBeNull();
    expect(zelle('Betroffene')).toHaveTextContent('Stand unbekannt');
    for (const pfad of GEBUNDEN) expect(aufrufe[pfad], pfad).toBeUndefined();
  });

  it('„Erneut abrufen" nach gescheiterten Freigaben fragt sie neu an, nicht die gesperrten Listen', async () => {
    let freigabenAbrufe = 0;
    const aufrufe = mitFreigaben({}, [
      http.get('/api/einsaetze/1/modul-freigaben', () => {
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
    expect(aufrufe['/api/einsaetze/1/auftraege']).toBeUndefined();
  });

  it('freies Modul mit echtem Ausfall bleibt ein Ausfall', async () => {
    mitFreigaben({}, [
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    await waitFor(() => expect(zelle('Betroffene')).toHaveTextContent('Stand unbekannt'));
    expect(zelle('Betroffene')).not.toHaveTextContent('nicht freigegeben');
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

  it('Kräfte (LFH-887): nur Fahrzeuge und Material gesperrt → Stärke in Kennzahl und Abschnittszeile', async () => {
    const aufrufe = mitFreigaben({ fahrzeuge: { zugriff: false }, material: { zugriff: false } });
    rendern();
    await waitFor(() => expect(zelle('Kräfte im Einsatz')).toHaveTextContent('F/UF/M//Σ 1/0/1//2'));
    expect(zelle('Kräfte im Einsatz')).not.toHaveTextContent('nicht freigegeben');
    expect(zelle('Kräfte im Einsatz').closest('a')).toHaveAttribute(
      'href',
      '/einsaetze/1/kraefteuebersicht',
    );
    const zeile = await within(paneel('Einsatzabschnitte')).findByRole('link', {
      name: /Abschnitt Nord/,
    });
    expect(zeile).toHaveTextContent('1/0/1//2');
    expect(aufrufe['/api/einsaetze/1/fahrzeuge']).toBeUndefined();
    expect(aufrufe['/api/einsaetze/1/material']).toBeUndefined();
  });

  it('Abschnittspaneel (LFH-887): leer bei gesperrten Fahrzeugen behauptet nicht „keine Kräfte"', async () => {
    mitFreigaben({ fahrzeuge: { zugriff: false } }, [
      http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
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

  it('Kräfte (LFH-887): Personal gesperrt → Kennzahl „—" mit Grund wie bisher', async () => {
    mitFreigaben({ personal: { zugriff: false } });
    rendern();
    await waitFor(() => expect(zelle('Kräfte im Einsatz')).toHaveTextContent('nicht freigegeben'));
    expect(zelle('Kräfte im Einsatz')).toHaveTextContent('—');
    expect(
      within(paneel('Einsatzabschnitte')).getByText('Modul nicht freigegeben.'),
    ).toBeInTheDocument();
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
      http.get('/api/einsaetze/1/modul-freigaben', async () => {
        if (freigaben === 'haengt') await delay('infinite');
        return HttpResponse.json(freigabenFixture(freigaben === 'haengt' ? {} : freigaben));
      }),
    ]);
  }
  const zelle = (titel: string) =>
    within(band()).getByText(titel).closest('[data-lfh="kennzahl"]') as HTMLElement;

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
    await bandDa();
    const lagebericht = screen.getByRole('button', { name: /Lagebericht/ });
    await waitFor(() => expect(zelle('Einsatzabschnitte')).toHaveTextContent('Abschnitt Nord'));
    expect(lagebericht).toBeEnabled();
    expect(lagebericht).not.toHaveAttribute('title');
    expect(screen.getByRole('button', { name: /Eintrag/ })).toBeEnabled();
  });

  it('Freigaben laden noch: die Kopfaktionen bleiben bedienbar (kein Aufblitzen)', async () => {
    mitFreigaben('haengt');
    rendern();
    await bandDa();
    expect(screen.getByRole('button', { name: /Lagebericht/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Eintrag/ })).toBeEnabled();
  });

  it('gesperrtes Meldebild: „Kräfte im Einsatz“ zeigt den Wert ohne Link', async () => {
    mitFreigaben({ kraefteuebersicht: { zugriff: false } });
    rendern();
    await bandDa();
    await waitFor(() => expect(zelle('Einsatzabschnitte')).toHaveTextContent('Abschnitt Nord'));
    await waitFor(() =>
      expect(within(band()).getByText('Kräfte im Einsatz').closest('a')).toBeNull(),
    );
    // Gegenprobe: eine freie Nachbarzelle trägt ihren Link — sonst wäre „kein Link" trivial.
    expect(within(band()).getByText('Einsatzabschnitte').closest('a')).not.toBeNull();
    expect(zelle('Kräfte im Einsatz')).not.toHaveTextContent('—');
  });

  it('freies Meldebild: „Kräfte im Einsatz“ verlinkt', async () => {
    mitFreigaben({});
    rendern();
    await bandDa();
    await waitFor(() =>
      expect(within(band()).getByText('Kräfte im Einsatz').closest('a')).toHaveAttribute(
        'href',
        '/einsaetze/1/kraefteuebersicht',
      ),
    );
  });

  it('gesperrte Lagebesprechung: die Marke steht ohne Link', async () => {
    mitFreigaben({ lagebesprechung: { zugriff: false } });
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = await within(p).findByText('Lagebesprechung');
    await waitFor(() => expect(marke.closest('a')).toBeNull());
  });

  // LLH-1111: die Marke hängt an der Lagebesprechung, nicht mehr am Stab.
  it('gesperrter Stab, freie Lagebesprechung: die Marke führt in das Modul', async () => {
    mitFreigaben({ stab: { zugriff: false } });
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = await within(p).findByText('Lagebesprechung');
    await waitFor(() =>
      expect(marke.closest('a')).toHaveAttribute('href', '/einsaetze/1/lagebesprechung'),
    );
  });
});
