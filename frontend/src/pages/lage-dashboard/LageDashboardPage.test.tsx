import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import { setzeLiveStatusFuerTest } from '../../live/liveStatusStore';
import LageDashboardPage from './LageDashboardPage';
import type { Auftrag, EtbEintragAnzeige, GefahrBewertung, Meldung } from '../../api/types';
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

const etb = (lfd: number, over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige => ({
  id: 1000 + lfd,
  lfd_nr: lfd,
  typ: 'meldung',
  inhalt: `Eintrag ${lfd}`,
  ereigniszeit: '2026-06-11 09:00:00',
  received_at: '2026-06-11 09:00:00',
  erfasser_id: 1,
  erfasser_name: 'Vitt',
  ...over,
});

const bewertung = (
  gebiet: number,
  gefahrentyp: GefahrBewertung['gefahrentyp'],
  warnstufe: GefahrBewertung['warnstufe'],
  schutzobjekt: GefahrBewertung['schutzobjekt'] = 'menschen',
): GefahrBewertung => ({
  id: Math.floor(Math.random() * 1e9),
  gefahrengebiet_id: gebiet,
  gefahrentyp,
  schutzobjekt,
  warnstufe,
  aktualisiert_von: 1,
  erstellt_at: '2026-06-11 09:00:00',
  geaendert_at: '2026-06-11 09:00:00',
});

const gebiet = (id: number, hoechste_warnstufe: GefahrBewertung['warnstufe'] = 'keine') => ({
  id,
  einsatz_id: 1,
  hoechste_warnstufe,
  label: `Gebiet ${id}`,
  zonen_ids: [],
});

const lagebericht = {
  id: 3,
  einsatz_id: 1,
  titel: 'Lage 14:00',
  status: 'freigegeben',
  zeitstand: '2026-07-25 12:00:00',
  ersteller_id: 1,
  ersteller_name: 'Muster',
  erstellt_at: '2026-07-25 12:00:00',
  aktualisiert_at: '2026-07-25 12:00:00',
  version: 1,
  vorlage: 'lagebericht',
  abschnitte: [{ schluessel: 'gefahren_schadenlage', text: 'Pegel steigend.' }],
};

interface Daten {
  personen?: unknown[];
  uhs?: unknown[];
  schaeden?: unknown[];
  gefahren?: unknown[];
  /** Matrix je Gefahrengebiet-ID. */
  matrix?: Record<number, GefahrBewertung[]>;
  matrixStatus?: number;
  lageberichte?: unknown[];
  einheiten?: unknown[];
  personal?: unknown[];
  fahrzeuge?: unknown[];
  material?: unknown[];
  abschnitte?: unknown[];
  auftraege?: unknown[];
  meldungen?: unknown[];
  etb?: EtbEintragAnzeige[];
  gefahrenStatus?: number;
  personenStatus?: number;
  etbStatus?: number;
  /** Maßgebliche Pegel (LFH-606) und ein erzwungener Fehlerstatus ihres Abrufs. */
  pegel?: unknown[];
  pegelStatus?: number;
  /** Der Einsatz-Abruf bleibt hängen — der einzige Zustand, in dem `baueLagebild`
   *  noch gar nichts liefert und das Kennzahlenband seine Plätze selbst stellen muss. */
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
    http.get('/api/einsaetze/1/gefahrengebiete', () =>
      d.gefahrenStatus ? new HttpResponse(null, { status: d.gefahrenStatus }) : json(d.gefahren),
    ),
    http.get('/api/einsaetze/1/gefahrengebiete/:gid/matrix', ({ params }) =>
      d.matrixStatus
        ? new HttpResponse(null, { status: d.matrixStatus })
        : json(d.matrix?.[Number(params.gid)]),
    ),
    http.get('/api/einsaetze/1/lageberichte', () => json(d.lageberichte)),
    http.get('/api/einsaetze/1/einheiten', () => json(d.einheiten)),
    http.get('/api/einsaetze/1/personal', () => json(d.personal)),
    http.get('/api/einsaetze/1/fahrzeuge', () => json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', () => json(d.material)),
    http.get('/api/einsaetze/1/abschnitte', () => json(d.abschnitte)),
    http.get('/api/einsaetze/1/auftraege', () => json(d.auftraege)),
    http.get('/api/einsaetze/1/meldungen', () => json(d.meldungen)),
    http.get('/api/einsaetze/1/etb', () =>
      d.etbStatus ? new HttpResponse(null, { status: d.etbStatus }) : json(d.etb),
    ),
    http.get('/api/einsaetze/1/pegel', () =>
      d.pegelStatus ? new HttpResponse(null, { status: d.pegelStatus }) : json(d.pegel),
    ),
  );
}

function render() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      <Route path="/einsaetze/:id/personen" element={<div>PERSONEN-MODUL</div>} />
      <Route path="/einsaetze/:id/personen/aufnahme" element={<div>AUFNAHME</div>} />
      <Route path="/einsaetze/:id/gefahren" element={<div>GEFAHREN-MODUL</div>} />
      <Route path="/einsaetze/:id/etb" element={<div>ETB-MODUL</div>} />
    </Routes>,
    { route: '/einsaetze/1/lage-dashboard' },
  );
}

/** Das gepinnte Kennzahl-Set — handgeschrieben, NICHT aus `KENNZAHL_ETIKETTEN` gelesen:
 *  sonst prüfte der Pin die Konstante gegen sich selbst. */
const KENNZAHL_SET = [
  'Pegel',
  'Betroffene',
  'Kräfte',
  'Vermisste',
  'Schäden offen',
  'Einsatzdauer',
];

/** Die Zellen eines Kennzahlenbands (über seinen zugänglichen Gruppennamen). */
function zellen(band = 'Lage in Zahlen'): HTMLElement[] {
  const gruppe = screen.getByRole('group', { name: band });
  return Array.from(gruppe.querySelectorAll<HTMLElement>('[data-lfh="kennzahl"]'));
}

/** Die Kennzahl-Zelle zu einem Etikett. */
function kennzahl(etikett: string, band?: string): HTMLElement {
  const el = zellen(band).find((z) => z.querySelector('.lfh-augenbraue')?.textContent === etikett);
  if (!el) throw new Error(`Kennzahl „${etikett}" nicht gefunden`);
  return el;
}

/**
 * Wartesignal „Daten sind da" (LFH-331 · B3): die Plätze stehen schon WÄHREND des
 * Einsatz-Abrufs, ein Griff aufs Etikett erfüllte sich also sofort am Platzhalter.
 * Angesetzt wird deshalb am LINK, den erst das Lagebild baut — ein Platzhalter ist keiner.
 */
function kennzahlGeladen(etikett: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = kennzahl(etikett);
    expect(el.tagName).toBe('A');
    return el;
  });
}

/** Das Paneel zu einem Titel (die Augenbraue ist seine Überschrift). */
function paneel(titel: string): HTMLElement {
  return screen.getByRole('region', { name: titel });
}

/** Die Innenkante der Kennzahl (zweiter Kanal zur Tonfarbe). */
function kante(el: HTMLElement): number {
  const m = el.style.boxShadow.match(/inset (\d+)px/);
  return m ? Number(m[1]) : 0;
}

describe('LageDashboardPage — Kennzahlenband', () => {
  it('trägt genau 6 Kennzahlen in fester Reihenfolge', async () => {
    // Der Reihenfolge-Pin bleibt (Prüfliste Kriterium 9: dieselbe Größe an derselben Stelle,
    // nie nach Dringlichkeit umsortiert) — neu belegt mit dem Set des Neuentwurfs S3.
    // Pegel auf Platz 1 statt „Höchste Warnstufe" (LFH-606); Evakuiert fehlt bewusst
    // (keine Datenquelle, LFH-607).
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await kennzahlGeladen('Betroffene');
    const etiketten = zellen().map((z) => z.querySelector('.lfh-augenbraue')?.textContent);
    expect(etiketten).toEqual(KENNZAHL_SET);
  });

  it('stellt schon während des Einsatz-Abrufs sechs Plätze — ohne Ziel und ohne Stand', async () => {
    // Prüfliste Kriterium 12 (CLS): ohne die Plätze sprängen sechs Zellen später herein.
    mockEndpunkte({ einsatzLaedt: true });
    render();
    const plaetze = zellen();
    expect(plaetze.map((z) => z.querySelector('.lfh-augenbraue')?.textContent)).toEqual(
      KENNZAHL_SET,
    );
    for (const p of plaetze) {
      expect(p.textContent).toContain('wird abgerufen');
      // Kein Link: es gibt noch nichts, wohin der Platz führen könnte.
      expect(p.tagName).not.toBe('A');
    }
  });

  it('zeigt Betroffene mit Patienten-Notiz und Vermisste mit Alarmkante', async () => {
    mockEndpunkte({
      personen: [person('sk1'), person('sk1'), person('sk3'), person(null, 'vermisst')],
    });
    render();
    await kennzahlGeladen('Betroffene');
    expect(kennzahl('Betroffene')).toHaveTextContent('4');
    expect(kennzahl('Betroffene')).toHaveTextContent('3 Patienten');
    expect(kennzahl('Vermisste')).toHaveTextContent('1');
    expect(kante(kennzahl('Vermisste'))).toBe(6);
    // Betroffene sind eine Menge, keine Gefahrenmeldung — ohne Kante.
    expect(kante(kennzahl('Betroffene'))).toBe(0);
  });

  it('ohne Vermisste gibt es keine Kante und den Wortlaut statt einer nackten Null', async () => {
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisste');
    expect(kante(kennzahl('Vermisste'))).toBe(0);
    expect(kennzahl('Vermisste')).toHaveTextContent('keine offenen Fälle');
  });

  it('Kräfte zeigen die Gesamtstärke und behalten F/UF/M//Σ in der Notiz', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Kräfte');
    expect(kennzahl('Kräfte')).toHaveTextContent('0 Einheiten · 0/0/0//0');
  });

  it('die Einsatzdauer läuft seit Beginn und nennt die Beginnzeit', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Einsatzdauer');
    const dauer = kennzahl('Einsatzdauer');
    expect(dauer.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toMatch(/^\d+:\d{2}$/);
    expect(dauer).toHaveTextContent('h');
    expect(dauer).toHaveTextContent(/seit /);
  });

  it('FEHLER SIEHT NICHT AUS WIE LEER: der Pegel-Abruf-Ausfall zeigt „?", nicht „kein Pegel"', async () => {
    mockEndpunkte({ personen: [person('sk1')], pegelStatus: 500 });
    render();
    await kennzahlGeladen('Pegel');
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z).toHaveTextContent('?');
      return z;
    });
    expect(zelle).toHaveTextContent('Stand unbekannt');
    expect(zelle).not.toHaveTextContent('kein Pegel festgelegt');
    // Ein Teilfehler macht die übrigen Kennzahlen nicht unkenntlich.
    expect(kennzahl('Betroffene')).toHaveTextContent('1');
    expect(kennzahl('Betroffene')).not.toHaveTextContent('Stand unbekannt');
  });

  it('Warnstufe „niedrig" bleibt still; „hoch" steht als Hinweis im Seitenkopf', async () => {
    // Entscheidung des Vertrags, hier festgenagelt: `niedrig` ist kein Alarmbeitrag
    // (EEMUA 191 / ISA-18.2). Ein stilles Umhängen auf `achtung` färbte app-weit um.
    expect(warnstufeKennzahl.niedrig.rolle).toBe('normal');

    mockEndpunkte({ gefahren: [gebiet(1, 'niedrig')] });
    const erster = render();
    // Wartesignal „Gebiete geladen": der Leerzustand der Matrix entsteht erst danach.
    expect(
      await within(paneel('Gefahrenmatrix')).findByText('Noch keine Gefahr bewertet.'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="warnstufe-hinweis"]')).toBeNull();
    erster.unmount();

    // Seit LFH-606 ist der Kopf-Hinweis der Ort der Warnstufe auf dieser Seite — das Band
    // trägt sie nicht mehr.
    mockEndpunkte({ gefahren: [gebiet(1, 'hoch')] });
    render();
    const hinweis = await waitFor(() => {
      const h = document.querySelector('[data-lfh="warnstufe-hinweis"]');
      expect(h).not.toBeNull();
      return h;
    });
    expect(hinweis?.textContent).toBe('Warnstufe hoch');
    expect(zellen().map((z) => z.textContent)).not.toContainEqual(
      expect.stringContaining('Höchste Warnstufe'),
    );
  });

  it('Pegel mit Messung: Meter, Einheit, Gewässer · Trend · Stand, Link zur Auswahl', async () => {
    mockEndpunkte({
      pegel: [
        {
          id: 1,
          station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
          name: 'HANN. MÜNDEN',
          gewaesser: 'WESER',
          reihenfolge: 0,
          // Frisch zur echten Uhr: die Seite rechnet das Alter gegen `Date.now()`.
          messung: {
            wasserstand_cm: 684,
            zeitpunkt: new Date(Date.now() - 10 * 60_000).toISOString(),
            trend_cm_pro_h: 9.2,
          },
        },
        {
          id: 2,
          station_uuid: '5f9c1b54-3c41-4d93-bb48-2b7c7c3f5a61',
          name: 'WAHNHAUSEN',
          gewaesser: 'FULDA',
          reihenfolge: 1,
        },
      ],
    });
    render();
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('6,84');
      return z;
    });
    expect(zelle).toHaveTextContent('m');
    const notiz = zelle.querySelector('[data-lfh="kennzahl-notiz"]')?.textContent ?? '';
    expect(notiz).toMatch(
      /^WESER · steigend \+9 cm\/h · Stand (\d{2}\. )?\d{2}:\d{2} · \+1 weitere$/,
    );
    expect(notiz).not.toContain('veraltet');
    expect(zelle.getAttribute('data-ton')).toBe('neutral');
    expect(zelle).toHaveAttribute('href', '/einsaetze/1/einstellungen/pegel');
  });

  it('Pegel veraltet: das Wort in der Notiz und die Achtungskante', async () => {
    mockEndpunkte({
      pegel: [
        {
          id: 1,
          station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
          name: 'HANN. MÜNDEN',
          gewaesser: 'WESER',
          reihenfolge: 0,
          messung: {
            wasserstand_cm: 684,
            zeitpunkt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          },
        },
      ],
    });
    render();
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z).toHaveTextContent('veraltet');
      return z;
    });
    expect(zelle).toHaveTextContent('Trend unbekannt');
    expect(zelle.getAttribute('data-ton')).toBe('achtung');
    expect(kante(zelle)).toBe(3);
  });

  it('Pegel-Ausfall: festgelegt, aber keine Messung → „—" und „Stand unbekannt"', async () => {
    mockEndpunkte({
      pegel: [
        {
          id: 1,
          station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
          name: 'HANN. MÜNDEN',
          gewaesser: 'WESER',
          reihenfolge: 0,
        },
      ],
    });
    render();
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z).toHaveTextContent('Stand unbekannt');
      return z;
    });
    expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('—');
    expect(zelle).toHaveTextContent('WESER');
    // Ein Ausfall ist kein Abruf-Fehler: kein „?".
    expect(zelle).not.toHaveTextContent('?');
  });

  it('kein Pegel festgelegt: der Platz bleibt belegt und führt zur Auswahl', async () => {
    mockEndpunkte({});
    render();
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z).toHaveTextContent('kein Pegel festgelegt');
      return z;
    });
    expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('—');
    expect(zelle).toHaveAttribute('href', '/einsaetze/1/einstellungen/pegel');
  });

  it('Deep-Link: Klick auf „Betroffene" führt ins Personen-Modul', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await userEvent.click(await kennzahlGeladen('Betroffene'));
    expect(await screen.findByText('PERSONEN-MODUL')).toBeInTheDocument();
  });
});

describe('LageDashboardPage — Seitenkopf', () => {
  it('trägt „Lagebild TT.MM. HH:MM" als Titel und den Datenstand als Meta', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Betroffene');
    expect(
      screen.getByRole('heading', { name: /^Lagebild \d{2}\.\d{2}\. \d{2}:\d{2}$/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="datenstand"]')?.textContent).toMatch(
        /^Stand vor \d+ s$/,
      ),
    );
  });
});

describe('LageDashboardPage — Gefahrenmatrix', () => {
  it('verdichtet je Gefahrentyp über ALLE Gebiete auf die höchste Stufe, in Katalogreihenfolge', async () => {
    mockEndpunkte({
      gefahren: [gebiet(1, 'mittel'), gebiet(2, 'akut')],
      matrix: {
        1: [bewertung(1, 'brand', 'mittel'), bewertung(1, 'ertrinken', 'niedrig')],
        2: [
          bewertung(2, 'brand', 'akut', 'sachwerte'),
          bewertung(2, 'atemgifte', 'keine'),
          bewertung(2, 'ertrinken', 'hoch'),
        ],
      },
    });
    render();
    const box = paneel('Gefahrenmatrix');
    await waitFor(() => expect(box.querySelectorAll('[data-lfh="gefahrenzeile"]')).toHaveLength(3));
    const zeilen = Array.from(box.querySelectorAll<HTMLElement>('[data-lfh="gefahrenzeile"]'));
    // Katalog: Atemgifte vor Brand vor Ertrinken.
    expect(zeilen.map((z) => [z.firstChild?.textContent, z.dataset.stufe])).toEqual([
      ['Atemgifte', 'keine'],
      ['Brand', 'akut'],
      ['Ertrinken', 'hoch'],
    ]);
    // Segmente bis zur Stufe gefüllt: keine 0, akut 4, hoch 3.
    const voll = (z: HTMLElement) => z.querySelectorAll('[data-voll="ja"]').length;
    expect(zeilen.map(voll)).toEqual([0, 4, 3]);
    // Das Stufenwort ist der zweite Kanal — es steht in jeder Zeile.
    expect(zeilen[1]).toHaveTextContent('akut');
    expect(within(box).getByText('2 Gebiete')).toBeInTheDocument();

    // Legende bündig unter den Segmenten: dieselbe Zeilenklasse UND dasselbe Vier-Stufen-
    // Raster wie die Balken (die Geometrie steht in `gefahrenmatrix.css`, geprüft in
    // `matrixGeometrie.test.ts`; jsdom rechnet weder Layout noch Container-Abfragen).
    const legende = box.querySelector<HTMLElement>('[data-lfh="gefahrenlegende"]')!;
    const balken = zeilen[1].querySelector<HTMLElement>('[data-lfh="gefahrenbalken"]')!;
    expect(zeilen[1]).toHaveClass('lfh-matrixzeile');
    expect(legende).toHaveClass('lfh-matrixzeile');
    expect(legende.style.gap).toBe(zeilen[1].style.gap);
    expect(legende.closest('.lfh-gefahrenmatrix')).toBe(zeilen[1].closest('.lfh-gefahrenmatrix'));
    const legendenRaster = legende.querySelector<HTMLElement>('.lfh-stufenraster')!;
    expect(balken).toHaveClass('lfh-stufenraster');
    // Kein Inline-Raster: es schlüge die Container-Abfrage der Klasse.
    expect(balken.style.gridTemplateColumns).toBe('');
    expect(legendenRaster.style.gridTemplateColumns).toBe('');
    expect(Array.from(legendenRaster.children).map((c) => c.textContent)).toEqual([
      'niedrig',
      'mittel',
      'hoch',
      'akut',
    ]);
    expect(balken.children).toHaveLength(4);
  });

  it('trennt „keine" (bewertet) von „unbewertet" (Lücke)', async () => {
    mockEndpunkte({
      gefahren: [gebiet(1)],
      matrix: { 1: [bewertung(1, 'brand', 'keine')] },
    });
    render();
    const box = paneel('Gefahrenmatrix');
    await waitFor(() =>
      expect(within(box).getByText('12 Gefahrentypen unbewertet')).toBeInTheDocument(),
    );
    expect(box.querySelectorAll('[data-lfh="gefahrenzeile"]')).toHaveLength(1);
  });

  it('ohne Gefahrengebiete zeigt es den Leerzustand mit Weg zur Gefahrenseite', async () => {
    mockEndpunkte({});
    render();
    const box = paneel('Gefahrenmatrix');
    expect(
      await within(box).findByText('Noch keine Gefahrengebiete angelegt.'),
    ).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Gefahren bewerten' }));
    expect(await screen.findByText('GEFAHREN-MODUL')).toBeInTheDocument();
  });

  it('Gebiete ohne jede Bewertung sind leer, nicht „keine Gefahr"', async () => {
    mockEndpunkte({ gefahren: [gebiet(1)], matrix: { 1: [] } });
    render();
    const box = paneel('Gefahrenmatrix');
    expect(await within(box).findByText('Noch keine Gefahr bewertet.')).toBeInTheDocument();
  });

  it('ein gescheiterter Matrix-Abruf ist ein Fehler, kein Leerzustand', async () => {
    mockEndpunkte({ gefahren: [gebiet(1, 'hoch')], matrixStatus: 500 });
    render();
    const box = paneel('Gefahrenmatrix');
    expect(await within(box).findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(box).queryByText(/Noch keine/)).toBeNull();
  });
});

describe('LageDashboardPage — Sichtung', () => {
  it('zeigt SK I–IV immer, tot nur wenn vorhanden, mit Anteil an allen Gesichteten', async () => {
    mockEndpunkte({
      personen: [person('sk1'), person('sk3'), person('sk3'), person('sk3'), person(null)],
    });
    render();
    const box = paneel('Sichtung');
    await waitFor(() => expect(box.querySelectorAll('li[data-sichtung]')).toHaveLength(4));
    const zeilen = Array.from(box.querySelectorAll<HTMLElement>('li[data-sichtung]'));
    expect(zeilen.map((z) => z.dataset.sichtung)).toEqual(['sk1', 'sk2', 'sk3', 'sk4']);
    const wert = (z: HTMLElement) => z.querySelector('[data-lfh="sichtung-wert"]')?.textContent;
    expect(zeilen.map(wert)).toEqual(['1', '0', '3', '0']);
    // Nenner sind die 4 Gesichteten, nicht die 5 Erfassten.
    const breite = (z: HTMLElement) =>
      z.querySelector<HTMLElement>('[data-lfh="sichtung-anteil"]')?.style.width;
    expect(zeilen.map(breite)).toEqual(['25%', '0%', '75%', '0%']);
    // Die BBK-Farbe steht im Farbfeld, das Kürzel ist der zweite Kanal.
    expect(zeilen[0].querySelector('[data-lfh="sichtungsfeld"]')).not.toBeNull();
    expect(zeilen[0]).toHaveTextContent('SK I');
    expect(within(box).getByText('Ohne Sichtung')).toBeInTheDocument();
    // „Transportiert / offen" ist nicht sauber ableitbar (LFH-613) und fehlt.
    expect(within(box).queryByText(/Transportiert/)).toBeNull();
  });

  it('nimmt Tote dazu, sobald es welche gibt', async () => {
    mockEndpunkte({ personen: [person('sk2'), person('tot')] });
    render();
    const box = paneel('Sichtung');
    await waitFor(() => expect(box.querySelectorAll('li[data-sichtung]')).toHaveLength(5));
    expect(box.querySelector('li[data-sichtung="tot"]')).toHaveTextContent('tot');
  });

  it('bei gescheitertem Personen-Abruf zeigt es den Fehler und NICHT den Leertext', async () => {
    mockEndpunkte({ personenStatus: 500 });
    render();
    const box = paneel('Sichtung');
    expect(await within(box).findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(within(box).queryByText('Noch keine Personen erfasst.')).not.toBeInTheDocument();
  });

  it('bei leerem Personenbestand zeigt es den Leertext mit Aufnahme und KEINEN Fehler', async () => {
    mockEndpunkte({});
    render();
    const box = paneel('Sichtung');
    expect(await within(box).findByText('Noch keine Personen erfasst.')).toBeInTheDocument();
    expect(within(box).queryByText('Daten nicht abrufbar')).not.toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Person aufnehmen' }));
    expect(await screen.findByText('AUFNAHME')).toBeInTheDocument();
  });
});

describe('LageDashboardPage — Meldungsstrom', () => {
  it('zeigt die jüngsten sieben Einträge aller Typen, jüngster zuerst, mit Quelle', async () => {
    mockEndpunkte({
      etb: [
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => etb(n)),
        etb(9, { typ: 'anordnung', von: 'Deichwache Nord', meldeweg: 'funk' }),
      ],
    });
    render();
    const box = paneel('Meldungsstrom');
    await waitFor(() => expect(box.querySelectorAll('li[data-lfd-nr]')).toHaveLength(7));
    const nummern = Array.from(box.querySelectorAll<HTMLElement>('li[data-lfd-nr]')).map((z) =>
      Number(z.dataset.lfdNr),
    );
    expect(nummern).toEqual([9, 8, 7, 6, 5, 4, 3]);
    const oben = box.querySelector('li[data-lfd-nr="9"]') as HTMLElement;
    expect(oben).toHaveTextContent('Anordnung');
    expect(oben).toHaveTextContent('Deichwache Nord · Funk');
    // Ohne `von` steht der Erfasser als einzige belegte Herkunft da.
    expect(box.querySelector('li[data-lfd-nr="8"]')).toHaveTextContent('Vitt');
  });

  it('schiebt neue Einträge NICHT ein, sondern kündigt sie im Sammelbanner an', async () => {
    const daten: Daten = { etb: [etb(1), etb(2)] };
    mockEndpunkte(daten);
    const { client } = render();
    const box = paneel('Meldungsstrom');
    await waitFor(() => expect(box.querySelectorAll('li[data-lfd-nr]')).toHaveLength(2));

    daten.etb = [etb(1), etb(2), etb(3, { inhalt: 'Deichbruch km 4' })];
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.etb(1) }));

    expect(await within(box).findByText('1 neuer Eintrag')).toBeInTheDocument();
    expect(within(box).queryByText('Deichbruch km 4')).toBeNull();
    expect(box.querySelectorAll('li[data-lfd-nr]')).toHaveLength(2);

    await userEvent.click(within(box).getByRole('button', { name: 'anzeigen' }));
    expect(within(box).getByText('Deichbruch km 4')).toBeInTheDocument();
    expect(within(box).queryByText('1 neuer Eintrag')).toBeNull();
  });

  /*
   * Review 22.09.2026: `angezeigtBis` hing an der Seiteninstanz, nicht am Einsatz. Beim
   * Wechsel auf einen anderen Einsatz in DERSELBEN Instanz (gleiche Route, andere `:id`)
   * galt die Marke des alten weiter — der neue zeigte nur seine Einträge bis zur alten
   * Nummer und meldete den Rest als „neu".
   */
  it('setzt die Wassermarke beim Einsatzwechsel in derselben Instanz zurück', async () => {
    mockEndpunkte({ etb: [1, 2, 3, 4, 5].map((n) => etb(n)) });
    server.use(
      http.get('/api/einsaetze/2', () => HttpResponse.json({ ...einsatz, id: 2 })),
      http.get('/api/einsaetze/2/etb', () =>
        HttpResponse.json([1, 2, 3, 4, 5, 6, 7].map((n) => etb(n, { id: 2000 + n }))),
      ),
      http.get('/api/einsaetze/2/gefahrengebiete/:gid/matrix', () => HttpResponse.json([])),
      http.get('/api/einsaetze/2/:modul', () => HttpResponse.json([])),
    );
    function Wechsel() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/einsaetze/2/lage-dashboard')}>wechseln</button>;
    }
    renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/lage-dashboard' },
    );
    const box = () => paneel('Meldungsstrom');
    await waitFor(() => expect(box().querySelectorAll('li[data-lfd-nr]')).toHaveLength(5));

    await userEvent.click(screen.getByRole('button', { name: 'wechseln' }));
    await waitFor(() => expect(box().querySelector('li[data-lfd-nr="7"]')).not.toBeNull());
    expect(within(box()).queryByText(/neuer? Einträge?/)).toBeNull();
  });

  it('ein leerer Strom füllt sich direkt — über einer leeren Fläche springt nichts', async () => {
    const daten: Daten = { etb: [] };
    mockEndpunkte(daten);
    const { client } = render();
    const box = paneel('Meldungsstrom');
    expect(
      await within(box).findByText('Noch keine Einträge im Einsatztagebuch.'),
    ).toBeInTheDocument();

    daten.etb = [etb(1, { inhalt: 'Erste Lage' })];
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.etb(1) }));
    expect(await within(box).findByText('Erste Lage')).toBeInTheDocument();
    expect(within(box).queryByRole('status')).toBeNull();
  });

  it('meldet „live" nur bei offener Leitung', async () => {
    setzeLiveStatusFuerTest('open');
    mockEndpunkte({ etb: [etb(1)] });
    const erster = render();
    const live = () => paneel('Meldungsstrom').querySelector('[data-lfh="strom-live"]');
    await waitFor(() => expect(live()?.textContent).toBe('live'));
    erster.unmount();

    // Der Abriss-Zweig allein wäre auch grün, wenn das Paneel NIE „live" sagte.
    setzeLiveStatusFuerTest('lost');
    render();
    await waitFor(() => expect(live()?.textContent).toBe('Verbindung unterbrochen'));
  });

  it('ein gescheiterter ETB-Abruf ist ein Fehler, kein leerer Strom', async () => {
    mockEndpunkte({ etbStatus: 500 });
    render();
    const box = paneel('Meldungsstrom');
    expect(await within(box).findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(box).queryByText('Noch keine Einträge im Einsatztagebuch.')).toBeNull();
  });

  it('„ETB" im Kopf führt ins Einsatztagebuch', async () => {
    mockEndpunkte({ etb: [etb(1)] });
    render();
    await userEvent.click(within(paneel('Meldungsstrom')).getByRole('button', { name: 'ETB' }));
    expect(await screen.findByText('ETB-MODUL')).toBeInTheDocument();
  });
});

describe('LageDashboardPage — Führungsstand', () => {
  const FUEHRUNG = 'Führungsstand';

  it('zählt offene Aufträge und hält Überfällige als Alarm fest — auch vollzogene', async () => {
    // `ist_ueberfaellig` ist vom Bearbeitungsstatus unabhängig (src/auftrag/repo.rs): ein
    // vollzogener Auftrag mit abgelaufener Frist bleibt ein Alarmbeitrag.
    mockEndpunkte({
      auftraege: [
        auftrag({ bearbeitungsstatus: 'offen' }),
        auftrag({ bearbeitungsstatus: 'in_arbeit' }),
        auftrag({ bearbeitungsstatus: 'vollzogen', ist_ueberfaellig: true }),
        auftrag({ bearbeitungsstatus: 'abgenommen' }),
      ],
    });
    render();
    await kennzahlGeladen('Betroffene');
    const zelle = await waitFor(() => {
      const z = kennzahl('Aufträge offen', FUEHRUNG);
      expect(z).toHaveTextContent('1 überfällig');
      return z;
    });
    expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('2');
    expect(kante(zelle)).toBe(6);
  });

  it('zählt offene und neue Meldungen, überfällige mit Alarmkante', async () => {
    mockEndpunkte({
      meldungen: [
        meldung({ status: 'neu', ist_offen: true }),
        meldung({ status: 'gesichtet', ist_offen: true, ist_ueberfaellig: true }),
        meldung({ status: 'erledigt', ist_offen: false }),
      ],
    });
    render();
    await kennzahlGeladen('Betroffene');
    const zelle = await waitFor(() => {
      const z = kennzahl('Meldungen offen', FUEHRUNG);
      expect(z).toHaveTextContent('1 neu · 1 überfällig');
      return z;
    });
    expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('2');
    expect(kante(zelle)).toBe(6);
  });

  it('während der Einsatz-Abruf hängt, behauptet der Führungsstand keinen Stand', async () => {
    // I2 (LFH-336-Review), übertragen: die Aufträge-Abfrage löst auf, der Einsatz hängt.
    // Ohne Lagebild darf keine Zelle „0" melden.
    mockEndpunkte({ einsatzLaedt: true, auftraege: [auftrag({ id: 1 })] });
    const { client } = render();
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.auftraege(1))?.status).toBe('success'),
    );
    for (const z of zellen(FUEHRUNG)) expect(z).toHaveTextContent('wird abgerufen');
  });

  it('ohne Lagebericht sagt die Zelle das, statt eine Zeit zu erfinden', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() =>
      expect(kennzahl('Lagebericht', FUEHRUNG)).toHaveTextContent('noch nicht erstellt'),
    );
  });
});

describe('Deeplinks des Dashboards (LFH-336 · AK3)', () => {
  const hier = dirname(fileURLToPath(import.meta.url));
  // `PaneelZustand.tsx` lag bis 22.09.2026 hier; seit dem Umzug nach
  // `components/instrument/` wird es dort mitgeprüft — es baut ohnehin keine Pfade.
  const quellen = [
    join(hier, 'LageDashboardPage.tsx'),
    join(hier, 'LagePaneele.tsx'),
    join(hier, '../../components/instrument/PaneelZustand.tsx'),
  ].map((d) => readFileSync(d, 'utf8'));

  it('baut keinen Einsatz-Pfad als Template-Literal — die Builder sind die Quelle', () => {
    for (const q of quellen) expect(q).not.toMatch(/`\/einsaetze\/\$\{/);
  });

  it('nutzt die Builder aus routing/deeplinks', () => {
    expect(quellen[0]).toContain("from '../../routing/deeplinks'");
    expect(quellen[0]).toContain('einsatzModulPfad');
    expect(quellen[0]).toContain('etbPfad');
  });
});

/**
 * ── STAND DES LAGEBERICHTS (LFH-350 · H60) ──────────────────────────────────────
 *
 * `bericht.stand` ist `zeitstand` — ein UTC-Wirestring ohne Zonenkennung. Roh ausgegeben
 * stand er um den Zonenversatz falsch. Formatiert wird in der SEITE (Zone am Provider).
 *
 * Die Zone wird AUSDRÜCKLICH gestellt und der Cache dafür VORBELEGT — beides gemessen
 * nötig: ohne Provider fällt `useAnzeigeKonventionen` auf die LOKALE Zone der Maschine
 * zurück, und die Einstellungs-Abfrage löst erst NACH dem ersten Render auf.
 */
function renderMitZone() {
  server.use(
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  // Bewusst NICHT `neuerQueryClient()`: dessen `gcTime: 0` räumt einen per `setQueryData`
  // gesetzten, noch unbeobachteten Eintrag beim ersten `await` weg (CLAUDE.md).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
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
  it('zeigt den Stand in der Anzeigezone, nicht roh', async () => {
    mockEndpunkte({ personen: [person('sk3')], lageberichte: [lagebericht] });
    renderMitZone();
    await kennzahlGeladen('Betroffene');
    // 12:00 UTC → 14:00 Sommerzeit in Berlin; ein anderer Tag trägt den Tag voran.
    const zelle = await waitFor(() => {
      const z = kennzahl('Lagebericht', 'Führungsstand');
      expect(z.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('25. 14:00');
      return z;
    });
    expect(zelle).toHaveTextContent('Freigegeben · Lage 14:00');
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});
