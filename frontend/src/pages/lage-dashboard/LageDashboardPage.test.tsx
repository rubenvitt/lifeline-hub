import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { meHandler, server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import { setzeLiveStatusFuerTest } from '../../live/liveStatusStore';
import LageDashboardPage from './LageDashboardPage';
import type { EtbEintragAnzeige, GefahrBewertung } from '../../api/types';
import { EinsatzAnzeigeProvider } from '../../anzeige/AnzeigeKonventionenContext';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../../test/fixtures';
import { leseZuletztModule } from '../../einsatz/zuletztModule';
import { FakeEventSource } from '../../test/eventSource';

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());
afterEach(() => setzeLiveStatusFuerTest('idle'));

const einsatz = einsatzFixture({
  bezeichnung: 'Hochwasser Musterstadt',
  stichwort: 'TH Hochwasser',
  begonnen_at: '2026-06-08 06:12:00',
  // Ein Hochwasser mit festgelegtem Pegel: Platz 1 trägt den Pegel.
  lagekennzahlen: ['pegel'],
});

const person = (
  sichtung: string | null,
  status = 'betroffen',
  extra: Record<string, unknown> = {},
) => ({
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
  ...extra,
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
  folgeauftraege: [],
  berichtigt_durch: [],
  anhaenge: [],
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
  /** Antwort des Modulzählers (Aufträge, Meldungen; LFH-550). Vorgabe: beide erlaubt, alles 0. */
  zaehler?: Record<string, unknown>;
  etb?: EtbEintragAnzeige[];
  gefahrenStatus?: number;
  personenStatus?: number;
  etbStatus?: number;
  /** Maßgebliche Pegel und ein erzwungener Fehlerstatus ihres Abrufs. */
  pegel?: unknown[];
  pegelStatus?: number;
  /**
   * Abweichende Modul-Freigaben des Servers (entscheiden das Ziel der Pegel-Kennzahl); alles
   * übrige ist frei (`freigabenFixture`).
   */
  freigaben?: Parameters<typeof freigabenFixture>[0];
  /** Zählt die gelieferten Freigaben-Antworten (Test wartet auf die Entscheidung). */
  freigabenGeliefert?: { n: number };
  /**
   * Der Einsatz-Abruf bleibt hängen — der einzige Zustand, in dem `baueLagebild` nichts liefert und
   * das Band seine Plätze selbst stellen muss.
   */
  einsatzLaedt?: boolean;
  /**
   * Aktive Lagekennzahlen am Einsatz, zur Anfragezeit gelesen — ein Test kann sie zwischen zwei
   * Abrufen ändern. Vorgabe: die des Fixtures (`['pegel']`).
   */
  lagekennzahlen?: string[];
  /** Evakuierungsbezirke der Evakuierungs-Übersicht und ein erzwungener Fehlerstatus. */
  bezirke?: unknown[];
  betreuungStatus?: number;
  /** Zählt die Abrufe der Evakuierungs-Übersicht (ohne Modulrecht: keiner). */
  betreuungAbrufe?: { n: number };
  /** Freigaben-Abruf hängt bzw. scheitert (Freigaben unbekannt). */
  freigabenLaedt?: boolean;
  freigabenStatus?: number;
  /**
   * Zählt die Abrufe der modulgebundenen Listen (Schlüssel = letzter Pfadteil, Matrix =
   * `matrix`) — „nichts angezeigt" allein belegte nicht, dass nichts angefragt wurde (LFH-669).
   */
  abrufe?: Record<string, number>;
}

function mockEndpunkte(d: Daten) {
  const zaehle = (name: string) => {
    if (d.abrufe) d.abrufe[name] = (d.abrufe[name] ?? 0) + 1;
  };
  const json = (arr?: unknown[], name?: string) => {
    if (name) zaehle(name);
    return HttpResponse.json(arr ?? []);
  };
  server.use(
    http.get('/api/einsaetze/1', async () => {
      if (d.einsatzLaedt) await delay('infinite');
      return HttpResponse.json({
        ...einsatz,
        lagekennzahlen: d.lagekennzahlen ?? einsatz.lagekennzahlen,
      });
    }),
    http.get('/api/einsaetze/1/personen', () => {
      if (!d.personenStatus) return json(d.personen, 'personen');
      zaehle('personen');
      return new HttpResponse(null, { status: d.personenStatus });
    }),
    http.get('/api/einsaetze/1/uhs', () => json(d.uhs, 'uhs')),
    http.get('/api/einsaetze/1/schaeden', () => json(d.schaeden, 'schaeden')),
    http.get('/api/einsaetze/1/gefahrengebiete', () => {
      if (!d.gefahrenStatus) return json(d.gefahren, 'gefahrengebiete');
      zaehle('gefahrengebiete');
      return new HttpResponse(null, { status: d.gefahrenStatus });
    }),
    http.get('/api/einsaetze/1/gefahrengebiete/:gid/matrix', ({ params }) => {
      if (!d.matrixStatus) return json(d.matrix?.[Number(params.gid)], 'matrix');
      zaehle('matrix');
      return new HttpResponse(null, { status: d.matrixStatus });
    }),
    http.get('/api/einsaetze/1/lageberichte', () => json(d.lageberichte, 'lageberichte')),
    http.get('/api/einsaetze/1/einheiten', () => json(d.einheiten, 'einheiten')),
    http.get('/api/einsaetze/1/personal', () => json(d.personal, 'personal')),
    http.get('/api/einsaetze/1/fahrzeuge', () => json(d.fahrzeuge, 'fahrzeuge')),
    http.get('/api/einsaetze/1/material', () => json(d.material, 'material')),
    http.get('/api/einsaetze/1/abschnitte', () => json(d.abschnitte, 'abschnitte')),
    http.get('/api/einsaetze/1/modul-zaehler', () =>
      HttpResponse.json(
        d.zaehler ?? {
          auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
          meldungen: { offen: 0, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
        },
      ),
    ),
    http.get('/api/einsaetze/1/etb', () =>
      d.etbStatus ? new HttpResponse(null, { status: d.etbStatus }) : json(d.etb, 'etb'),
    ),
    http.get('/api/einsaetze/1/pegel', () =>
      d.pegelStatus ? new HttpResponse(null, { status: d.pegelStatus }) : json(d.pegel),
    ),
    http.get('/api/einsaetze/1/evakuierung', () => {
      if (d.betreuungAbrufe) d.betreuungAbrufe.n += 1;
      return d.betreuungStatus
        ? new HttpResponse(null, { status: d.betreuungStatus })
        : HttpResponse.json({ bezirke: d.bezirke ?? [] });
    }),
    // Ohne diesen Handler scheiterte die Abfrage in jedem Test, und die href-Aussagen belegten nur
    // den Fehlerpfad.
    http.get('/api/einsaetze/1/modul-freigaben', async () => {
      if (d.freigabenLaedt) await delay('infinite');
      if (d.freigabenGeliefert) d.freigabenGeliefert.n += 1;
      if (d.freigabenStatus) return new HttpResponse(null, { status: d.freigabenStatus });
      return HttpResponse.json(freigabenFixture(d.freigaben));
    }),
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

/**
 * Die gepinnten Kennzahlreihen — handgeschrieben, nicht aus `kennzahlReihe` gelesen, sonst prüfte
 * der Pin die Ableitung gegen sich selbst.
 */
/** Ein festgelegter Pegel ohne Messung (Ausfall) — trägt Gewässer und Name, kein Wert. */
const PEGEL_AUSFALL = {
  id: 1,
  station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
  name: 'HANN. MÜNDEN',
  gewaesser: 'WESER',
  reihenfolge: 0,
};

const REIHE_MIT_PEGEL = [
  'Pegel',
  'Betroffene',
  'Schäden offen',
  'Kräfte',
  'Vermisste',
  'Einsatzdauer',
];
const REIHE_OHNE_AUSLOESER = [
  'Verbleib offen',
  'Betroffene',
  'Schäden offen',
  'Kräfte',
  'Vermisste',
  'Einsatzdauer',
];

/** Reihe eines Hochwassers mit Pegel und Evakuierung (Entwurf S3). */
const REIHE_S3 = ['Pegel', 'Betroffene', 'Evakuiert', 'Kräfte', 'Vermisste', 'Einsatzdauer'];

/** Ein aktiver Evakuierungsbezirk der Übersicht, nur mit den gelesenen Feldern. */
const bezirk = (plan: number, stand: number | null) => ({
  id: Math.floor(Math.random() * 1e9),
  einsatz_id: 1,
  bezeichnung: `Bezirk ${plan}`,
  plan_personen: plan,
  plan_erhebung: 'gezaehlt',
  raeumung: 'angeordnet',
  ...(stand == null
    ? {}
    : {
        stand: {
          id: Math.floor(Math.random() * 1e9),
          evakuiert: stand,
          erhebung: 'gezaehlt',
          zeitpunkt_at: '2026-06-11 09:00:00',
        },
      }),
});

/** Schmales geschütztes Leerzeichen (Tausendertrenner) — als Literal. */
const T = '\u202f';

/** Die Etiketten des Bands in Reihenfolge. */
function etiketten(): (string | null | undefined)[] {
  return zellen().map((z) => z.querySelector('.lfh-augenbraue')?.textContent);
}

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
 * Wartesignal „Daten sind da": die Plätze stehen schon während des Einsatz-Abrufs, deshalb am Link
 * ansetzen, den erst das Lagebild baut — und an der Zahl, denn modulgebundene Quellen laden erst
 * nach den Freigaben (LFH-669), das Lagebild steht also vor ihren Daten.
 */
function kennzahlGeladen(etikett: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = kennzahl(etikett);
    expect(el.tagName).toBe('A');
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
    return el;
  });
}

/** Das Paneel zu einem Titel (die Augenbraue ist seine Überschrift). */
function paneel(titel: string): HTMLElement {
  return screen.getByRole('region', { name: titel });
}

/**
 * Die Innenkante der Kennzahl (zweiter Kanal zur Tonfarbe). Mit Ziel liegt sie als Auflage in
 * der Rasterzelle um den eingerückten Link (LFH-630), ohne Ziel an der Kennzahl selbst.
 */
function kante(el: HTMLElement): number {
  const zelle = el.closest<HTMLElement>('[data-lfh="kennzahl-zelle"]');
  const traeger = zelle ? zelle.querySelector<HTMLElement>('[data-lfh="kennzahl-kante"]') : el;
  const m = (traeger?.style.boxShadow ?? '').match(/inset (\d+)px/);
  return m ? Number(m[1]) : 0;
}

describe('LageDashboardPage — Kennzahlenband', () => {
  it('sechs Plätze, Kern fest: mit festgelegtem Pegel steht er auf Platz 1', async () => {
    // Prüfliste Kriterium 9: dieselbe Größe an derselben Stelle, nie nach Dringlichkeit umsortiert.
    // Der Einsatz bestimmt die zwei Lageplätze (1 und 3).
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await kennzahlGeladen('Betroffene');
    expect(etiketten()).toEqual(REIHE_MIT_PEGEL);
  });

  it('ohne Auslöser: kein Pegel-Platz, Platz 1 trägt „Verbleib offen" (LFH-640 statt LFH-606)', async () => {
    mockEndpunkte({ lagekennzahlen: [], personen: [person('sk1')] });
    render();
    await kennzahlGeladen('Betroffene');
    expect(etiketten()).toEqual(REIHE_OHNE_AUSLOESER);
    // Der eine Angetroffene hat keinen Verbleib: offene Arbeit, Achtung.
    const verbleib = kennzahl('Verbleib offen');
    expect(verbleib.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('1');
    expect(verbleib).toHaveTextContent('0 unterwegs');
    expect(verbleib.getAttribute('data-ton')).toBe('achtung');
    expect(verbleib).toHaveAttribute('href', '/einsaetze/1/personen');
  });

  it('stellt schon während des Einsatz-Abrufs sechs Plätze — ohne Beschriftung, Ziel und Stand', async () => {
    // Kriterium 12 (CLS): ohne die Plätze sprängen sechs Zellen später herein. Die Beschriftung
    // fehlt bewusst — welche Kennzahl auf die Lageplätze kommt, sagt erst der Einsatz.
    mockEndpunkte({ einsatzLaedt: true });
    render();
    const plaetze = zellen();
    expect(plaetze).toHaveLength(6);
    for (const p of plaetze) {
      expect(p.querySelector('.lfh-augenbraue')?.textContent).toBe('\u00a0');
      expect(p.textContent).toContain('wird abgerufen');
      // Kein Link: es gibt noch nichts, wohin der Platz führen könnte.
      expect(p.tagName).not.toBe('A');
    }
  });

  it('ein neuer Zuschnitt beim erneuten Abruf wird GEHALTEN und per Sammelbanner angeboten', async () => {
    // Wechsel während der Betrachtung: die Reihe tauscht nicht unter dem Blick, sie wechselt erst
    // auf „übernehmen".
    const daten: Daten = { lagekennzahlen: [] };
    mockEndpunkte(daten);
    const { client } = render();
    await kennzahlGeladen('Verbleib offen');
    expect(screen.queryByText(/Kennzahlreihe geändert/)).toBeNull();

    // Anderswo wird ein Pegel festgelegt; der nächste Einsatz-Abruf bringt den Auslöser.
    daten.lagekennzahlen = ['pegel'];
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    const banner = await screen.findByText('Kennzahlreihe geändert: Pegel statt Verbleib offen');
    expect(etiketten()).toEqual(REIHE_OHNE_AUSLOESER);

    await userEvent.click(
      within(banner.closest('[data-lfh="sammelbanner"]') as HTMLElement).getByRole('button', {
        name: 'übernehmen',
      }),
    );
    await waitFor(() => expect(etiketten()).toEqual(REIHE_MIT_PEGEL));
    expect(screen.queryByText(/Kennzahlreihe geändert/)).toBeNull();
  });

  it('ein erneuter Abruf mit UNVERÄNDERTEM Zuschnitt zeigt kein Banner', async () => {
    mockEndpunkte({});
    const { client } = render();
    await kennzahlGeladen('Pegel');
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    await kennzahlGeladen('Pegel');
    expect(screen.queryByText(/Kennzahlreihe geändert/)).toBeNull();
    expect(etiketten()).toEqual(REIHE_MIT_PEGEL);
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

  it('Spec-Szenario: drei Vermisste, zwei seit über 4 h → Notiz „2 seit über 4 h"', async () => {
    const seit = (msZurueck: number) =>
      new Date(Date.now() - msZurueck).toISOString().slice(0, 19).replace('T', ' ');
    const stunde = 60 * 60_000;
    mockEndpunkte({
      personen: [
        person(null, 'vermisst', { vermisst_seit: seit(6 * stunde) }),
        person(null, 'vermisst', { vermisst_seit: seit(5 * stunde) }),
        person(null, 'vermisst', { vermisst_seit: seit(1 * stunde) }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisste');
    expect(kennzahl('Vermisste')).toHaveTextContent('3');
    expect(kennzahl('Vermisste')).toHaveTextContent('2 seit über 4 h');
  });

  describe('mit fester Uhr', () => {
    afterEach(() => vi.useRealTimers());

    it('die Notiz erscheint nach Ablauf der Schwelle OHNE neue Daten', async () => {
      // Nur Uhr und Intervalle gefälscht: MSW und `waitFor` laufen weiter auf echten Timeouts.
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(new Date('2026-06-08T14:00:00Z'));
      let abrufe = 0;
      mockEndpunkte({});
      server.use(
        http.get('/api/einsaetze/1/personen', () => {
          abrufe++;
          // 3 h 59 min vor „jetzt" — eine Minute unter der Schwelle.
          return HttpResponse.json([
            person(null, 'vermisst', { vermisst_seit: '2026-06-08 10:01:00' }),
          ]);
        }),
      );
      render();
      await kennzahlGeladen('Vermisste');
      expect(kennzahl('Vermisste')).toHaveTextContent('als vermisst erfasst');
      const abrufeVorher = abrufe;

      // Zwei Minuten später: nur der Uhr-Takt der Seite läuft, kein Abruf.
      act(() => {
        vi.advanceTimersByTime(2 * 60_000);
      });
      await waitFor(() => expect(kennzahl('Vermisste')).toHaveTextContent('1 seit über 4 h'));
      expect(abrufe).toBe(abrufeVorher);
    });
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

  it('gesperrtes Meldebild: „Kräfte" zeigt die Stärke ohne Link (LFH-888)', async () => {
    mockEndpunkte({ freigaben: { kraefteuebersicht: { zugriff: false } } });
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() => expect(kennzahl('Kräfte').tagName).not.toBe('A'));
    expect(kennzahl('Kräfte').querySelector('[data-lfh="kennzahl-wert"]')?.textContent).not.toBe(
      '—',
    );
  });

  it('freies Meldebild: „Kräfte" führt in die Kräfteübersicht (LFH-888, Gegenprobe)', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() =>
      expect(kennzahl('Kräfte')).toHaveAttribute('href', '/einsaetze/1/kraefteuebersicht'),
    );
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

  it('FEHLER SIEHT NICHT AUS WIE LEER: der Gefahren-Ausfall zeigt einen Fehler, nicht „keine Gefahr"', async () => {
    // Die Warnstufe steht im Kopf-Hinweis und in der Gefahrenmatrix; beide dürfen einen toten Abruf
    // nicht als „keine Gefahr" ausgeben.
    mockEndpunkte({ personen: [person('sk1')], gefahrenStatus: 500 });
    render();
    await kennzahlGeladen('Betroffene');
    const box = paneel('Gefahrenmatrix');
    expect(await within(box).findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(box).queryByText(/Noch keine/)).toBeNull();
    // Kein Kopf-Hinweis aus einer erfundenen Stufe.
    expect(document.querySelector('[data-lfh="warnstufe-hinweis"]')).toBeNull();
    // Ein Teilfehler macht die übrigen Kennzahlen nicht unkenntlich.
    expect(kennzahl('Betroffene')).toHaveTextContent('1');
    expect(kennzahl('Betroffene')).not.toHaveTextContent('Stand unbekannt');
  });

  it('Warnstufe „niedrig" bleibt still; „hoch" steht als Hinweis im Seitenkopf', async () => {
    // Festgenagelt: `niedrig` ist kein Alarmbeitrag (EEMUA 191 / ISA-18.2).
    expect(warnstufeKennzahl.niedrig.rolle).toBe('normal');

    mockEndpunkte({ gefahren: [gebiet(1, 'niedrig')] });
    const erster = render();
    // Wartesignal „Gebiete geladen": der Leerzustand der Matrix entsteht erst danach.
    expect(
      await within(paneel('Gefahrenmatrix')).findByText('Keine Gefahr über Stufe „keine“.'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="warnstufe-hinweis"]')).toBeNull();
    erster.unmount();

    // Der Kopf-Hinweis ist der Ort der Warnstufe auf dieser Seite, das Band trägt sie nicht.
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
    // Modul „Wetter & Pegel" frei (Freigabe des Servers) → die Kennzahl führt dorthin.
    await waitFor(() => expect(zelle).toHaveAttribute('href', '/einsaetze/1/wetter-pegel'));
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

  it('der Pegel führt auf die Modulseite „Wetter & Pegel“, wenn sie frei ist (LFH-633)', async () => {
    mockEndpunkte({ pegel: [PEGEL_AUSFALL] });
    render();
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z).toHaveTextContent('WESER');
      return z;
    });
    await waitFor(() => expect(zelle).toHaveAttribute('href', '/einsaetze/1/wetter-pegel'));
  });

  it('Modul „Wetter & Pegel" ausgeblendet → die Pegel-Kennzahl führt in die Pflege (LFH-633)', async () => {
    // Vor der Freigaben-Antwort gilt ohnehin die Pflege; die Aussage trägt erst NACH ihr.
    const freigabenGeliefert = { n: 0 };
    mockEndpunkte({
      pegel: [PEGEL_AUSFALL],
      freigabenGeliefert,
      freigaben: { 'wetter-pegel': { sichtbar: false } },
    });
    render();
    const zelle = await waitFor(() => {
      const z = kennzahl('Pegel');
      expect(z).toHaveTextContent('WESER');
      return z;
    });
    await waitFor(() => expect(freigabenGeliefert.n).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(zelle).toHaveAttribute('href', '/einsaetze/1/einstellungen/pegel');
  });

  describe('Evakuiert (LFH-607)', () => {
    it('Hochwasser mit Pegel und Evakuierung: Reihe aus S3, „Evakuiert" auf Platz 3 mit N und M', async () => {
      mockEndpunkte({
        lagekennzahlen: ['pegel', 'evakuiert'],
        bezirke: [bezirk(640, 600), bezirk(1210, 720)],
      });
      render();
      const zelle = await kennzahlGeladen('Evakuiert');
      expect(etiketten()).toEqual(REIHE_S3);
      await waitFor(() =>
        expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe(`1${T}320`),
      );
      // `toHaveTextContent` faltet das schmale Leerzeichen zu einem normalen — deshalb roh.
      expect(zelle.textContent).toContain(`von 1${T}850 geplant`);
      expect(zelle).toHaveAttribute('href', '/einsaetze/1/evakuierung');
      expect(zelle.getAttribute('data-ton')).toBe('neutral');
    });

    it('ohne Standmeldung „—", nie 0', async () => {
      mockEndpunkte({ lagekennzahlen: ['evakuiert'], bezirke: [bezirk(640, null)] });
      render();
      const zelle = await kennzahlGeladen('Evakuiert');
      await waitFor(() => expect(zelle).toHaveTextContent('von 640 geplant · 1 ohne Meldung'));
      expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('—');
    });

    it('FEHLER SIEHT NICHT AUS WIE LEER: ein gescheiterter Evakuierungsabruf zeigt „?", Nachbarn bleiben lesbar', async () => {
      mockEndpunkte({
        lagekennzahlen: ['evakuiert'],
        personen: [person('sk1')],
        betreuungStatus: 500,
      });
      render();
      await kennzahlGeladen('Evakuiert');
      await waitFor(() => expect(kennzahl('Evakuiert')).toHaveTextContent('Stand unbekannt'));
      expect(kennzahl('Evakuiert')).not.toHaveTextContent('keine geplante Evakuierung');
      expect(kennzahl('Betroffene')).toHaveTextContent('1');
      expect(kennzahl('Betroffene')).not.toHaveTextContent('Stand unbekannt');
    });

    it('Modul Evakuierung ausgeblendet: der Platz bleibt „Evakuiert", ohne Zahl, ohne Link, ohne Abruf', async () => {
      const betreuungAbrufe = { n: 0 };
      const freigabenGeliefert = { n: 0 };
      mockEndpunkte({
        lagekennzahlen: ['evakuiert'],
        bezirke: [bezirk(640, 600)],
        betreuungAbrufe,
        freigabenGeliefert,
        freigaben: { evakuierung: { sichtbar: false } },
      });
      render();
      await kennzahlGeladen('Betroffene');
      await waitFor(() => expect(freigabenGeliefert.n).toBeGreaterThan(0));
      await waitFor(() =>
        expect(kennzahl('Evakuiert')).toHaveTextContent('Modul Evakuierung nicht freigegeben'),
      );
      const zelle = kennzahl('Evakuiert');
      expect(etiketten()[2]).toBe('Evakuiert');
      expect(zelle.tagName).not.toBe('A');
      expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('—');
      expect(betreuungAbrufe.n).toBe(0);
    });

    it('solange die Freigaben unbekannt sind: kein Abruf und KEIN Link — ein Sprung ins Leere wäre möglich', async () => {
      const betreuungAbrufe = { n: 0 };
      mockEndpunkte({
        lagekennzahlen: ['evakuiert'],
        bezirke: [bezirk(640, 600)],
        betreuungAbrufe,
        freigabenLaedt: true,
      });
      render();
      // Nicht „Betroffene": ohne Freigaben lädt auch die Personenliste nicht (LFH-669).
      await kennzahlGeladen('Einsatzdauer');
      const zelle = kennzahl('Evakuiert');
      expect(zelle).toHaveTextContent('wird abgerufen');
      expect(zelle.tagName).not.toBe('A');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(betreuungAbrufe.n).toBe(0);
    });

    it('scheitert der Freigaben-Abruf, bleibt das Recht unbekannt: „Stand unbekannt", kein Abruf, kein Link', async () => {
      const betreuungAbrufe = { n: 0 };
      const freigabenGeliefert = { n: 0 };
      mockEndpunkte({
        lagekennzahlen: ['evakuiert'],
        bezirke: [bezirk(640, 600)],
        betreuungAbrufe,
        freigabenGeliefert,
        freigabenStatus: 500,
      });
      render();
      await kennzahlGeladen('Betroffene');
      await waitFor(() => expect(kennzahl('Evakuiert')).toHaveTextContent('Stand unbekannt'));
      expect(kennzahl('Evakuiert').tagName).not.toBe('A');
      expect(betreuungAbrufe.n).toBe(0);
    });

    it('eine fremde Anordnung beim erneuten Abruf wird gehalten: Banner „Evakuiert statt Schäden offen"', async () => {
      const daten: Daten = { lagekennzahlen: ['pegel'], bezirke: [bezirk(640, 600)] };
      mockEndpunkte(daten);
      const { client } = render();
      await kennzahlGeladen('Schäden offen');
      expect(etiketten()).toEqual(REIHE_MIT_PEGEL);

      daten.lagekennzahlen = ['pegel', 'evakuiert'];
      await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
      const banner = await screen.findByText(
        'Kennzahlreihe geändert: Evakuiert statt Schäden offen',
      );
      // Kriterium 9: der Platz tauscht nicht unter dem Blick.
      expect(etiketten()).toEqual(REIHE_MIT_PEGEL);

      await userEvent.click(
        within(banner.closest('[data-lfh="sammelbanner"]') as HTMLElement).getByRole('button', {
          name: 'übernehmen',
        }),
      );
      await waitFor(() => expect(etiketten()).toEqual(REIHE_S3));
    });
  });

  describe('Nachforderungen offen (LLH-1371)', () => {
    const ZAEHLER = {
      auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
      meldungen: { offen: 0, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
      nachforderungen: { offen: 4, angefordert: 1, zugesagt: 1, unterwegs: 2 },
    };

    it('gewählt: Platz 3 zeigt die Zahl des Modulzählers mit „n unterwegs", Ziel Modulseite', async () => {
      mockEndpunkte({ lagekennzahlen: ['nachforderungen'], zaehler: ZAEHLER });
      render();
      const zelle = await kennzahlGeladen('Nachforderungen offen');
      expect(etiketten()).toEqual([
        'Verbleib offen',
        'Betroffene',
        'Nachforderungen offen',
        'Kräfte',
        'Vermisste',
        'Einsatzdauer',
      ]);
      await waitFor(() =>
        expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('4'),
      );
      expect(zelle).toHaveTextContent('2 unterwegs');
      expect(zelle).toHaveAttribute('href', '/einsaetze/1/nachforderungen');
      expect(zelle.getAttribute('data-ton')).toBe('neutral');
    });

    it('nicht gewählt: kein Platz für Nachforderungen, auch wenn welche offen sind', async () => {
      mockEndpunkte({ lagekennzahlen: [], zaehler: ZAEHLER });
      render();
      await kennzahlGeladen('Betroffene');
      expect(etiketten()).toEqual(REIHE_OHNE_AUSLOESER);
    });

    it('Modul nicht frei (Feld fehlt im Zähler): Platz bleibt, „—" mit Grund, ohne Link', async () => {
      mockEndpunkte({
        lagekennzahlen: ['nachforderungen'],
        zaehler: { auftraege: ZAEHLER.auftraege, meldungen: ZAEHLER.meldungen },
      });
      render();
      await kennzahlGeladen('Betroffene');
      await waitFor(() =>
        expect(kennzahl('Nachforderungen offen')).toHaveTextContent('nicht freigegeben'),
      );
      const zelle = kennzahl('Nachforderungen offen');
      expect(etiketten()[2]).toBe('Nachforderungen offen');
      expect(zelle.tagName).not.toBe('A');
      expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('—');
    });

    it('Evakuierung angeordnet: „Evakuiert" geht vor, die Wahl bleibt unsichtbar', async () => {
      mockEndpunkte({
        lagekennzahlen: ['evakuiert', 'nachforderungen'],
        bezirke: [bezirk(640, 600)],
        zaehler: ZAEHLER,
      });
      render();
      await kennzahlGeladen('Evakuiert');
      expect(etiketten()[2]).toBe('Evakuiert');
    });
  });

  it('Deep-Link: Klick auf „Betroffene" führt ins Personen-Modul', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    await userEvent.click(await kennzahlGeladen('Betroffene'));
    expect(await screen.findByText('PERSONEN-MODUL')).toBeInTheDocument();
  });
});

describe('LageDashboardPage — Seitenkopf', () => {
  it('trägt den Menünamen als Titel, die Uhrzeit daneben und den Datenstand als Meta (LFH-965)', async () => {
    mockEndpunkte({});
    render();
    await kennzahlGeladen('Betroffene');
    expect(screen.getByRole('heading', { level: 1, name: 'Lagebild' })).toBeInTheDocument();
    expect(document.querySelector('.lfh-seitenkopf__meta')?.textContent).toMatch(
      /\d{2}\.\d{2}\. \d{2}:\d{2}/,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="datenstand"]')?.textContent).toMatch(
        /^Stand vor \d+ s$/,
      ),
    );
  });
});

describe('LageDashboardPage — Wetterwarnung im Seitenkopf (LLH-1117)', () => {
  const STUNDE = 3_600_000;
  /** Wetter-Antwort mit verwertbarem Warnstand; zählt die Abrufe. */
  function stelleWetter(daten: unknown[], abrufe = { n: 0 }) {
    server.use(
      http.get('/api/einsaetze/1/wetter', () => {
        abrufe.n += 1;
        return HttpResponse.json({
          ort: { name: 'Musterstadt' },
          warnungen: {
            zustand: 'ok',
            abgerufen_at: new Date(Date.now() - 60_000).toISOString(),
            daten,
          },
          vorhersage: { zustand: 'kein_ort' },
          aktuell: { zustand: 'kein_ort' },
        });
      }),
    );
    return abrufe;
  }
  const marke = () => document.querySelector<HTMLElement>('[data-lfh="wetter-kopfmarke"]');

  it('eine angekündigte Unwetterwarnung steht mit Stufe als Wort und Ziel im Kopf, nicht im Band', async () => {
    mockEndpunkte({});
    stelleWetter([
      {
        stufe: 'schwer',
        ereignis: 'STARKREGEN',
        ueberschrift: 'Amtliche UNWETTERWARNUNG vor STARKREGEN',
        beginn: new Date(Date.now() + 3 * STUNDE).toISOString(),
        ende: new Date(Date.now() + 6 * STUNDE).toISOString(),
      },
    ]);
    render();
    const m = await waitFor(() => {
      const el = marke();
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(m.closest('[data-lfh="lagebild-meta"]')).not.toBeNull();
    // Beginn ist jetzt + 3 h: nach 21 Uhr liegt er am Folgetag, dann steht der Tag davor
    // (`standZeit`: `DD. HH:mm`).
    expect(m.textContent).toMatch(/^Unwetterwarnung Starkregen ab (\d\d\. )?\d\d:\d\d ↗$/);
    const link = within(m).getByRole('link', { name: /^Unwetterwarnung Starkregen ab / });
    expect(link).toHaveAttribute('href', '/einsaetze/1/wetter-pegel');
    // Nie im Kennzahlenband (LFH-640) und still: kein Toast, kein Hinweis.
    await kennzahlGeladen('Betroffene');
    expect(zellen().map((z) => z.textContent)).not.toContainEqual(
      expect.stringContaining('Starkregen'),
    );
    expect(document.querySelector('.ant-notification-notice')).toBeNull();
    expect(document.querySelector('.ant-message-notice')).toBeNull();
  });

  it('mehrere Warnungen: die höchste Stufe, die übrigen gezählt', async () => {
    mockEndpunkte({});
    stelleWetter([
      {
        stufe: 'maessig',
        ereignis: 'STURMBÖEN',
        ueberschrift: 'x',
        beginn: new Date(Date.now() - STUNDE).toISOString(),
        ende: new Date(Date.now() + STUNDE).toISOString(),
      },
      {
        stufe: 'extrem',
        ereignis: 'ORKANBÖEN',
        ueberschrift: 'x',
        beginn: new Date(Date.now() - STUNDE).toISOString(),
        ende: null,
      },
    ]);
    render();
    const m = await waitFor(() => {
      const el = marke();
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(m.textContent).toBe('Extremes Unwetter Orkanböen bis auf Weiteres (+ 1 weitere) ↗');
  });

  it('ohne Warnung zeigt der Kopf nichts (Abwesenheit, auch keine 0)', async () => {
    mockEndpunkte({});
    const abrufe = stelleWetter([]);
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() => expect(abrufe.n).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(marke()).toBeNull();
  });

  it('Modul „Wetter & Pegel“ ausgeblendet: keine Marke und kein Abruf', async () => {
    const freigabenGeliefert = { n: 0 };
    mockEndpunkte({ freigabenGeliefert, freigaben: { 'wetter-pegel': { sichtbar: false } } });
    const abrufe = stelleWetter([
      {
        stufe: 'schwer',
        ereignis: 'GEWITTER',
        ueberschrift: 'x',
        beginn: new Date(Date.now() - STUNDE).toISOString(),
        ende: new Date(Date.now() + STUNDE).toISOString(),
      },
    ]);
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() => expect(freigabenGeliefert.n).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(abrufe.n).toBe(0);
    expect(marke()).toBeNull();
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
    await waitFor(() => expect(box.querySelectorAll('[data-lfh="gefahrenzeile"]')).toHaveLength(2));
    const zeilen = Array.from(box.querySelectorAll<HTMLElement>('[data-lfh="gefahrenzeile"]'));
    // Alphabetisch: Brand vor Ertrinken. Atemgifte trägt nur „keine“, die Vorgabe (LLH-1090): keine Zeile.
    expect(zeilen.map((z) => [z.firstChild?.textContent, z.dataset.stufe])).toEqual([
      ['Brand', 'akut'],
      ['Ertrinken', 'hoch'],
    ]);
    // Segmente bis zur Stufe gefüllt: akut 4, hoch 3.
    const voll = (z: HTMLElement) => z.querySelectorAll('[data-voll="ja"]').length;
    expect(zeilen.map(voll)).toEqual([4, 3]);
    // Das Stufenwort ist der zweite Kanal — es steht in jeder Zeile.
    expect(zeilen[0]).toHaveTextContent('akut');
    expect(within(box).getByText('2 Gebiete')).toBeInTheDocument();

    // Legende bündig unter den Segmenten: dieselbe Zeilenklasse UND dasselbe Vier-Stufen-
    // Raster wie die Balken (die Geometrie steht in `gefahrenmatrix.css`, geprüft in
    // `matrixGeometrie.test.ts`; jsdom rechnet weder Layout noch Container-Abfragen).
    const legende = box.querySelector<HTMLElement>('[data-lfh="gefahrenlegende"]')!;
    const balken = zeilen[0].querySelector<HTMLElement>('[data-lfh="gefahrenbalken"]')!;
    expect(zeilen[0]).toHaveClass('lfh-matrixzeile');
    expect(legende).toHaveClass('lfh-matrixzeile');
    expect(legende.style.gap).toBe(zeilen[0].style.gap);
    expect(legende.closest('.lfh-gefahrenmatrix')).toBe(zeilen[0].closest('.lfh-gefahrenmatrix'));
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

  /**
   * LLH-1090: statt „n Gefahrentypen unbewertet“ steht, welches Gebiet niemand beurteilt hat —
   * eine Zelle ohne Bewertung heißt „keine“, die offene Beurteilung trägt das Gebiet.
   */
  it('nennt nicht beurteilte Gebiete im Fuß, beurteilte nicht', async () => {
    mockEndpunkte({
      gefahren: [
        { ...gebiet(1, 'hoch'), label: 'Hangrutsch Kirchberg' },
        { ...gebiet(2), beurteilt_at: '2026-06-11 09:00:00', beurteilt_von: 1 },
      ],
      matrix: { 1: [bewertung(1, 'brand', 'hoch')], 2: [] },
    });
    render();
    const box = paneel('Gefahrenmatrix');
    expect(
      await within(box).findByText('Hangrutsch Kirchberg: nicht beurteilt'),
    ).toBeInTheDocument();
    expect(within(box).queryByText(/Gebiet 2/)).toBeNull();
    expect(within(box).queryByText(/unbewertet/)).toBeNull();
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

  it('Gebiete ohne Stufe über „keine“ sind leer und bleiben „nicht beurteilt“', async () => {
    mockEndpunkte({
      gefahren: [gebiet(1)],
      matrix: { 1: [bewertung(1, 'brand', 'keine')] },
    });
    render();
    const box = paneel('Gefahrenmatrix');
    expect(await within(box).findByText('Keine Gefahr über Stufe „keine“.')).toBeInTheDocument();
    expect(box.querySelectorAll('[data-lfh="gefahrenzeile"]')).toHaveLength(0);
    expect(within(box).getByText('Gebiet 1: nicht beurteilt')).toBeInTheDocument();
  });

  /**
   * LLH-1365: dieselbe Marke wie die Matrix der Gefahrenseite, am Gefahrennamen der Zeile; der
   * Name der Zeile endet auf „· mit Erläuterung“. Welche Zeilen stehen, entscheidet
   * `gesetzteGefahren`: auch eine Erläuterung zu „keine“ ist eine Aussage.
   */
  it('erkennt eine Gefahr mit Erläuterung an Marke und Namen, auch zu „keine“', async () => {
    mockEndpunkte({
      gefahren: [gebiet(1, 'hoch'), gebiet(2, 'mittel')],
      matrix: {
        1: [
          bewertung(1, 'brand', 'hoch'),
          {
            ...bewertung(1, 'elektrizitaet', 'keine'),
            beschreibung: 'Geprüft, kein Strom im Keller.',
          },
        ],
        2: [
          { ...bewertung(2, 'ertrinken', 'mittel'), beschreibung: 'Strömung in der Hauptstraße' },
        ],
      },
    });
    render();
    const box = paneel('Gefahrenmatrix');
    await waitFor(() => expect(box.querySelectorAll('[data-lfh="gefahrenzeile"]')).toHaveLength(3));

    const ertrinken = within(box).getByRole('listitem', {
      name: 'Ertrinken: mittel · mit Erläuterung',
    });
    const marke = ertrinken.querySelector<HTMLElement>('[data-lfh="erlaeuterung-marke"]');
    expect(marke, 'die Zeile trägt die Marke der Matrix').not.toBeNull();
    expect(marke).toHaveAttribute('aria-hidden', 'true');
    expect(marke!.style.borderBlockStart).toMatch(/currentcolor/i);
    // Das Zeichen steht am Gefahrennamen, nicht im Stufenwort.
    expect(ertrinken.firstChild).toContainElement(marke);

    const elektrizitaet = within(box).getByRole('listitem', {
      name: 'Elektrizität: keine · mit Erläuterung',
    });
    expect(elektrizitaet).toHaveAttribute('data-stufe', 'keine');
    expect(elektrizitaet.querySelectorAll('[data-voll="ja"]')).toHaveLength(0);

    // Gegenprobe: ohne Erläuterung weder Marke noch Zusatz.
    const brand = within(box).getByRole('listitem', { name: 'Brand: hoch' });
    expect(brand.querySelector('[data-lfh="erlaeuterung-marke"]')).toBeNull();

    // Die Legende nennt das Zeichen mit seinem Wort.
    const legende = box.querySelector<HTMLElement>('[data-lfh="gefahrenlegende-erlaeuterung"]');
    expect(legende).toHaveTextContent('mit Erläuterung');
    expect(legende!.querySelector('[data-lfh="erlaeuterung-marke"]')).not.toBeNull();
  });

  it('ohne Erläuterung steht keine Marke und kein Legendeneintrag', async () => {
    mockEndpunkte({
      gefahren: [gebiet(1, 'hoch')],
      matrix: { 1: [bewertung(1, 'brand', 'hoch')] },
    });
    render();
    const box = paneel('Gefahrenmatrix');
    expect(await within(box).findByRole('listitem', { name: 'Brand: hoch' })).toBeInTheDocument();
    expect(box.querySelector('[data-lfh="erlaeuterung-marke"]')).toBeNull();
    expect(box.querySelector('[data-lfh="gefahrenlegende-erlaeuterung"]')).toBeNull();
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
    // Ohne jeden Verbleib: niemand unterwegs, alle fünf angetroffen und offen.
    expect(box.querySelector('[data-lfh="transport-bilanz"]')).toHaveTextContent(
      'Unterwegs / offen / abgeschlossen0 / 5 / 0',
    );
  });

  it('Spec-Szenario „Transportiert / offen“: Unterwegs / offen / abgeschlossen 1 / 2 / 3 (LLH-1332)', async () => {
    const fremd = () =>
      person('sk2', 'betroffen', {
        aktuelle_verbleib_art: 'transport',
        aktueller_verbleib: 'Transport → KH Nord',
        versorgung: 'abgeschlossen',
      });
    mockEndpunkte({
      personen: [
        person('sk2', 'betroffen', {
          aktuelle_verbleib_art: 'transport',
          aktueller_verbleib: 'Eigentransport 1/83-1 → KH Nord',
          versorgung: 'unterwegs',
        }),
        fremd(),
        fremd(),
        fremd(),
        person('sk3'),
        person('sk3'),
        // Weder noch: in einer UHS verortet, und vermisst ist nicht angetroffen.
        person('sk3', 'betroffen', { aktuelle_uhs_id: 7 }),
        person(null, 'vermisst'),
      ],
    });
    render();
    const box = paneel('Sichtung');
    await waitFor(() =>
      expect(box.querySelector('[data-lfh="transport-bilanz"]')).toHaveTextContent(
        'Unterwegs / offen / abgeschlossen1 / 2 / 3',
      ),
    );
    // Die Patientenzahl lässt die drei Abgeschlossenen weg und nennt sie (Spec
    // `betroffene-lagedaten`, „Patienten ohne Abgeschlossene“).
    expect(kennzahl('Betroffene')).toHaveTextContent('4 Patienten · 3 abgeschlossen');
  });

  it('„Ohne Sichtung" steht auch bei 0 — die Zeile springt nicht mit dem Wert (LFH-650)', async () => {
    /**
     * Die Zeile „Ohne Sichtung" steht immer, auch mit 0 — sonst schob der erste ungesichtete Zugang
     * das Paneel nach unten.
     */
    mockEndpunkte({ personen: [person('sk1'), person('sk3')] });
    render();
    const box = paneel('Sichtung');
    await waitFor(() =>
      expect(box.querySelector('[data-lfh="ohne-sichtung"]')).toHaveTextContent('Ohne Sichtung0'),
    );
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
    const box = paneel('Jüngste ETB-Einträge');
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
    const box = paneel('Jüngste ETB-Einträge');
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
   * Die Wassermarke gehört zum Einsatz, nicht zur Seiteninstanz: beim Wechsel der `:id` zeigte der
   * neue Einsatz sonst nur Einträge bis zur alten Nummer.
   */
  it('setzt die Wassermarke beim Einsatzwechsel in derselben Instanz zurück', async () => {
    mockEndpunkte({ etb: [1, 2, 3, 4, 5].map((n) => etb(n)) });
    server.use(
      http.get('/api/einsaetze/2', () => HttpResponse.json({ ...einsatz, id: 2 })),
      http.get('/api/einsaetze/2/etb', () =>
        HttpResponse.json([1, 2, 3, 4, 5, 6, 7].map((n) => etb(n, { id: 2000 + n }))),
      ),
      http.get('/api/einsaetze/2/gefahrengebiete/:gid/matrix', () => HttpResponse.json([])),
      // Die Betreuungs-Übersicht ist ein Objekt, keine Liste.
      http.get('/api/einsaetze/2/evakuierung', () => HttpResponse.json({ bezirke: [] })),
      // Vor dem Sammel-Handler: der lieferte sonst `[]` als Freigaben (LFH-669).
      http.get('/api/einsaetze/2/modul-freigaben', () => HttpResponse.json(freigabenFixture())),
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
    const box = () => paneel('Jüngste ETB-Einträge');
    await waitFor(() => expect(box().querySelectorAll('li[data-lfd-nr]')).toHaveLength(5));

    await userEvent.click(screen.getByRole('button', { name: 'wechseln' }));
    await waitFor(() => expect(box().querySelector('li[data-lfd-nr="7"]')).not.toBeNull());
    expect(within(box()).queryByText(/neuer? Einträge?/)).toBeNull();
  });

  it('ein Einsatzwechsel in derselben Instanz übernimmt den neuen Zuschnitt OHNE Banner', async () => {
    // Die gehaltene Reihe gehört zu einem Einsatz — wie die Wassermarke oben.
    mockEndpunkte({ lagekennzahlen: [] });
    let zweiter = ['pegel'];
    server.use(
      http.get('/api/einsaetze/2', () =>
        HttpResponse.json({ ...einsatz, id: 2, lagekennzahlen: zweiter }),
      ),
      http.get('/api/einsaetze/2/gefahrengebiete/:gid/matrix', () => HttpResponse.json([])),
      // Die Betreuungs-Übersicht ist ein Objekt, keine Liste.
      http.get('/api/einsaetze/2/evakuierung', () => HttpResponse.json({ bezirke: [] })),
      // Vor dem Sammel-Handler: der lieferte sonst `[]` als Freigaben (LFH-669).
      http.get('/api/einsaetze/2/modul-freigaben', () => HttpResponse.json(freigabenFixture())),
      http.get('/api/einsaetze/2/:modul', () => HttpResponse.json([])),
    );
    function Wechsel() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/einsaetze/2/lage-dashboard')}>wechseln</button>;
    }
    const { client } = renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/lage-dashboard' },
    );
    await kennzahlGeladen('Verbleib offen');
    await userEvent.click(screen.getByRole('button', { name: 'wechseln' }));
    await waitFor(() => expect(etiketten()).toEqual(REIHE_MIT_PEGEL));
    expect(screen.queryByText(/Kennzahlreihe geändert/)).toBeNull();

    // Und für den neuen Einsatz wird wieder gehalten: sonst tauschte eine fremde Entscheidung nach
    // jedem Wechsel die Reihe unter dem Blick.
    zweiter = [];
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(2) }));
    expect(
      await screen.findByText('Kennzahlreihe geändert: Verbleib offen statt Pegel'),
    ).toBeInTheDocument();
    expect(etiketten()).toEqual(REIHE_MIT_PEGEL);
  });

  it('die EIGENE Entscheidung, deren Abruf beim Aufbau noch läuft, gilt ohne Banner', async () => {
    // Wer in den Einstellungen einen Pegel festlegt und sofort zurückwechselt, findet im Speicher
    // noch den alten Einsatz. Gehalten wird erst nach dem laufenden Abruf.
    mockEndpunkte({ lagekennzahlen: ['pegel'] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(einsatzKeys.einsatz(1), { ...einsatz, lagekennzahlen: [] });
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      </Routes>,
      { route: '/einsaetze/1/lage-dashboard', client },
    );
    await waitFor(() => expect(etiketten()).toEqual(REIHE_MIT_PEGEL));
    expect(screen.queryByText(/Kennzahlreihe geändert/)).toBeNull();
  });

  it('ein leerer Strom füllt sich direkt — über einer leeren Fläche springt nichts', async () => {
    const daten: Daten = { etb: [] };
    mockEndpunkte(daten);
    const { client } = render();
    const box = paneel('Jüngste ETB-Einträge');
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
    const live = () => paneel('Jüngste ETB-Einträge').querySelector('[data-lfh="strom-live"]');
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
    const box = paneel('Jüngste ETB-Einträge');
    expect(await within(box).findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(box).queryByText('Noch keine Einträge im Einsatztagebuch.')).toBeNull();
  });

  it('„ETB" im Kopf führt ins Einsatztagebuch', async () => {
    mockEndpunkte({ etb: [etb(1)] });
    render();
    await userEvent.click(
      within(paneel('Jüngste ETB-Einträge')).getByRole('button', { name: 'ETB' }),
    );
    expect(await screen.findByText('ETB-MODUL')).toBeInTheDocument();
  });
});

describe('LageDashboardPage — Führungsstand', () => {
  const FUEHRUNG = 'Führungsstand';

  // Aufträge und Meldungen kommen aus dem Modulzähler (LFH-550), nicht aus den Listen: dieselbe
  // Zahl wie im Modulpanel. „Überfällig" heißt „davon überfällig".
  it('zeigt offene Aufträge aus dem Modulzähler, überfällige mit Alarmkante', async () => {
    mockEndpunkte({ zaehler: { auftraege: { offen: 2, in_arbeit: 1, ueberfaellig: 1 } } });
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

  it('zeigt offene und neue Meldungen; Bestätigung überfällig trägt die Alarmkante', async () => {
    mockEndpunkte({
      zaehler: { meldungen: { offen: 2, ungesehen: 1, bestaetigung_ueberfaellig: 1 } },
    });
    render();
    await kennzahlGeladen('Betroffene');
    const zelle = await waitFor(() => {
      const z = kennzahl('Meldungen offen', FUEHRUNG);
      expect(z).toHaveTextContent('1 neu · 1 Bestätigung überfällig');
      return z;
    });
    expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('2');
    expect(kante(zelle)).toBe(6);
  });

  it('ein nicht freigegebenes Modul sagt das und zeigt keine 0', async () => {
    mockEndpunkte({ zaehler: { auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 } } });
    render();
    await kennzahlGeladen('Betroffene');
    const zelle = await waitFor(() => {
      const z = kennzahl('Meldungen offen', FUEHRUNG);
      expect(z).toHaveTextContent('nicht freigegeben');
      return z;
    });
    expect(zelle.querySelector('[data-lfh="kennzahl-wert"]')?.textContent).toBe('—');
    expect(zelle.querySelector('a')).toBeNull();
  });

  it('lädt keine Auftrags- oder Meldungsliste', async () => {
    const listen: string[] = [];
    mockEndpunkte({});
    server.use(
      http.get('/api/einsaetze/1/auftraege', () => {
        listen.push('auftraege');
        return HttpResponse.json([]);
      }),
      http.get('/api/einsaetze/1/meldungen', () => {
        listen.push('meldungen');
        return HttpResponse.json([]);
      }),
    );
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() => expect(kennzahl('Aufträge offen', FUEHRUNG)).toHaveTextContent('keiner'));
    expect(listen).toEqual([]);
  });

  it('während der Einsatz-Abruf hängt, behauptet der Führungsstand keinen Stand', async () => {
    // Der Zähler löst auf, der Einsatz hängt: ohne Lagebild darf keine Zelle „0" melden.
    mockEndpunkte({ einsatzLaedt: true });
    const { client } = render();
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.modulZaehler(1))?.status).toBe('success'),
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

/**
 * Modulgrenze des Lagebilds (LFH-669, Spec `modul-freigabe`, „Keine Anfrage an ein nicht
 * freigegebenes Modul"): eine Liste eines fremden Moduls wird nur bei Freigabe des Servers
 * angefragt. Gesperrt ist kein Ausfall und kein leerer Bestand — die Zahl fehlt mit Grund. Die
 * Tests zählen die Requests mit.
 */
describe('LageDashboardPage — Modulgrenze des Lagebilds (LFH-669)', () => {
  const FUEHRUNG = 'Führungsstand';
  const wert = (z: HTMLElement) => z.querySelector('[data-lfh="kennzahl-wert"]')?.textContent;
  const kurzWarten = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

  it('gesperrte Module: keine Anfrage, keine (auch keine gecachten) Daten, KEIN Ausfall', async () => {
    const abrufe: Record<string, number> = {};
    const freigabenGeliefert = { n: 0 };
    mockEndpunkte({
      lagekennzahlen: [],
      abrufe,
      freigabenGeliefert,
      personen: [person('sk1')],
      gefahren: [gebiet(1, 'hoch')],
      freigaben: {
        personen: { zugriff: false },
        schaeden: { zugriff: false },
        einheiten: { zugriff: false },
        gefahrenzonen: { zugriff: false },
        lageberichte: { zugriff: false },
        unfallhilfsstellen: { zugriff: false },
      },
    });
    // Altstand im Cache (etwa aus der Zeit vor der Sperre): er darf nicht als Lage erscheinen.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(einsatzKeys.personen(1), [person('sk1'), person(null, 'vermisst')]);
    client.setQueryData(einsatzKeys.gefahrengebiete(1), [gebiet(1, 'akut')]);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/lage-dashboard" element={<LageDashboardPage />} />
      </Routes>,
      { route: '/einsaetze/1/lage-dashboard', client },
    );
    await waitFor(() => expect(freigabenGeliefert.n).toBeGreaterThan(0));
    await waitFor(() => expect(kennzahl('Betroffene')).toHaveTextContent('nicht freigegeben'));
    await kurzWarten();

    // Vorbedingung: die freien Quellen liefen — sonst wäre „kein Request" trivial.
    expect(abrufe.personal).toBe(1);
    for (const liste of [
      'personen',
      'uhs',
      'schaeden',
      'einheiten',
      'gefahrengebiete',
      'matrix',
      'lageberichte',
    ]) {
      expect(abrufe[liste], liste).toBeUndefined();
    }

    // Kennzahlen: „—" mit Grund, kein Link ins gesperrte Modul, kein „Stand unbekannt".
    for (const etikett of [
      'Verbleib offen',
      'Betroffene',
      'Schäden offen',
      'Kräfte',
      'Vermisste',
    ]) {
      const z = kennzahl(etikett);
      expect(wert(z), etikett).toBe('—');
      expect(z, etikett).toHaveTextContent('nicht freigegeben');
      expect(z, etikett).not.toHaveTextContent('Stand unbekannt');
      expect(z.tagName, etikett).not.toBe('A');
    }
    for (const etikett of ['Lagebericht', 'UHS aktiv']) {
      const z = kennzahl(etikett, FUEHRUNG);
      expect(wert(z), etikett).toBe('—');
      expect(z, etikett).toHaveTextContent('nicht freigegeben');
      expect(z.querySelector('a'), etikett).toBeNull();
    }
    // Was nicht gesperrt ist, bleibt lesbar.
    expect(kennzahl('Einsatzdauer')).toHaveTextContent(/seit /);

    // Paneele: Grund statt Fehler oder Leertext, kein Weg ins gesperrte Modul.
    const sichtung = paneel('Sichtung');
    expect(within(sichtung).getByText('Modul Personen nicht freigegeben.')).toBeInTheDocument();
    expect(within(sichtung).queryByText('Daten nicht abrufbar')).toBeNull();
    expect(within(sichtung).queryByText('Noch keine Personen erfasst.')).toBeNull();
    expect(within(sichtung).queryByRole('button')).toBeNull();
    const matrix = paneel('Gefahrenmatrix');
    expect(within(matrix).getByText('Modul Gefahren nicht freigegeben.')).toBeInTheDocument();
    expect(within(matrix).queryByText('Daten nicht abrufbar')).toBeNull();
    expect(within(matrix).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Keine Warnstufe aus dem Altstand.
    expect(document.querySelector('[data-lfh="warnstufe-hinweis"]')).toBeNull();
  });

  it('solange die Freigaben laden: keine modulgebundene Anfrage, die Zahlen „wird abgerufen"', async () => {
    const abrufe: Record<string, number> = {};
    mockEndpunkte({ abrufe, freigabenLaedt: true });
    render();
    await kennzahlGeladen('Einsatzdauer');
    await kurzWarten();
    expect(abrufe).toEqual({});
    expect(kennzahl('Betroffene')).toHaveTextContent('wird abgerufen');
    expect(kennzahl('Kräfte')).toHaveTextContent('wird abgerufen');
    expect(within(paneel('Sichtung')).getByLabelText('Sichtung wird geladen')).toBeInTheDocument();
  });

  it('scheitert der Freigaben-Abruf: sichtbarer Ausfall statt ruhiger Lage, keine Anfrage, „Erneut abrufen" fragt die Freigaben', async () => {
    const abrufe: Record<string, number> = {};
    const freigabenGeliefert = { n: 0 };
    mockEndpunkte({ abrufe, freigabenGeliefert, freigabenStatus: 500 });
    render();
    await kennzahlGeladen('Einsatzdauer');
    await waitFor(() => expect(kennzahl('Betroffene')).toHaveTextContent('Stand unbekannt'));
    expect(kennzahl('Kräfte')).toHaveTextContent('Stand unbekannt');
    expect(kennzahl('Schäden offen')).toHaveTextContent('Stand unbekannt');
    const sichtung = paneel('Sichtung');
    expect(within(sichtung).getByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(sichtung).queryByText('Noch keine Personen erfasst.')).toBeNull();
    expect(within(paneel('Gefahrenmatrix')).getByText('Daten nicht abrufbar')).toBeInTheDocument();

    const vorher = freigabenGeliefert.n;
    await userEvent.click(within(sichtung).getByRole('button', { name: 'Erneut abrufen' }));
    await waitFor(() => expect(freigabenGeliefert.n).toBe(vorher + 1));
    await kurzWarten();
    expect(abrufe).toEqual({});
  });

  it('ein freies Modul, dessen Liste scheitert, bleibt ein Ausfall wie bisher', async () => {
    const abrufe: Record<string, number> = {};
    mockEndpunkte({ abrufe, personenStatus: 500 });
    render();
    await kennzahlGeladen('Betroffene');
    await waitFor(() => expect(kennzahl('Betroffene')).toHaveTextContent('Stand unbekannt'));
    expect(kennzahl('Betroffene')).not.toHaveTextContent('nicht freigegeben');
    expect(abrufe.personen).toBe(1);
    expect(within(paneel('Sichtung')).getByText('Daten nicht abrufbar')).toBeInTheDocument();
  });

  it('ETB gesperrt: der Meldungsstrom nennt den Grund, ohne Anfrage an …/etb (LFH-669)', async () => {
    const abrufe: Record<string, number> = {};
    const freigabenGeliefert = { n: 0 };
    mockEndpunkte({
      lagekennzahlen: [],
      abrufe,
      freigabenGeliefert,
      etb: [etb(1)],
      freigaben: { etb: { zugriff: false } },
    });
    render();
    await waitFor(() => expect(freigabenGeliefert.n).toBeGreaterThan(0));
    const box = paneel('Jüngste ETB-Einträge');
    expect(await within(box).findByText('Modul ETB nicht freigegeben.')).toBeInTheDocument();
    await kurzWarten();
    // Vorbedingung: die freien Quellen liefen.
    expect(abrufe.personal).toBe(1);
    expect(abrufe.etb).toBeUndefined();
    expect(within(box).queryByText('Daten nicht abrufbar')).toBeNull();
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it('Kräfte hängen nur an Personal und Einheiten (LFH-887): gesperrte Fahrzeuge zeigen die Stärke', async () => {
    const abrufe: Record<string, number> = {};
    const freigabenGeliefert = { n: 0 };
    mockEndpunkte({
      abrufe,
      freigabenGeliefert,
      personal: [
        { id: 1, name: 'A', staerke_position: 'fuehrer', status_kategorie: 'verfuegbar' },
        { id: 2, name: 'B', staerke_position: 'mannschaft', status_kategorie: 'verfuegbar' },
      ],
      freigaben: {
        fahrzeuge: { zugriff: false },
        material: { zugriff: false },
        einsatzabschnitte: { zugriff: false },
      },
    });
    render();
    await waitFor(() => expect(freigabenGeliefert.n).toBeGreaterThan(0));
    const kraefte = await kennzahlGeladen('Kräfte');
    expect(wert(kraefte)).toBe('2');
    expect(kraefte).toHaveTextContent('1/0/1//2');
    expect(kraefte).not.toHaveTextContent('nicht freigegeben');
    expect(abrufe.fahrzeuge).toBeUndefined();
    expect(abrufe.material).toBeUndefined();
  });
});

describe('Deeplinks des Dashboards (LFH-336 · AK3)', () => {
  const hier = dirname(fileURLToPath(import.meta.url));
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
 * Stand des Lageberichts: `bericht.stand` ist ein UTC-Wirestring ohne Zonenkennung und wird in der
 * Seite formatiert. Die Zone wird ausdrücklich gestellt und der Cache vorbelegt: ohne Provider
 * fiele `useAnzeigeKonventionen` auf die Zone der Maschine zurück, und die Einstellungs-Abfrage
 * löst erst nach dem ersten Render auf.
 */
function renderMitZone() {
  server.use(
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  // Nicht `neuerQueryClient()`: dessen `gcTime: 0` räumt einen unbeobachteten
  // `setQueryData`-Eintrag beim ersten `await` weg.
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

  // LFH-532: der Status folgt der Phasenachse (`LAGEBERICHT_STATUS`) — ein Entwurf ist kein
  // Warnzustand, und beschriftet wird mit dem Fachlabel, nie mit dem Wire-Wert.
  it('führt einen Entwurf neutral und mit Fachlabel', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      lageberichte: [{ ...lagebericht, status: 'entwurf' }],
    });
    renderMitZone();
    await kennzahlGeladen('Betroffene');
    const zelle = await waitFor(() => {
      const z = kennzahl('Lagebericht', 'Führungsstand');
      expect(z.querySelector('[data-lfh="kennzahl-notiz"]')?.textContent).toBe(
        'Entwurf · Lage 14:00',
      );
      return z;
    });
    expect(zelle.getAttribute('data-ton')).toBe('neutral');
  });
});

/**
 * Das Lage-Dashboard ist wie der Überblick eine Seite mit Modulzielen: jede Wahl darauf füllt die
 * Palettengruppe „Zuletzt besucht" (LFH-436). Vorbedingung je Test: das Laden allein merkt nichts.
 * Der Schlüssel des Gefahren-Moduls ist `gefahrenzonen`, die Route `gefahren` — der Test belegt
 * damit auch die Auflösung über die Route.
 */
describe('LageDashboardPage — „Zuletzt"-Speicher (LFH-436)', () => {
  const ICH = benutzerFixture({ id: 9, org_rolle: 'fuehrungskraft' });
  const gemerkt = () => leseZuletztModule(ICH.id, 1);

  beforeEach(() => {
    localStorage.clear();
    server.use(meHandler(ICH));
  });

  it('die Kennzahl „Betroffene" merkt Personen', async () => {
    mockEndpunkte({ personen: [person('sk1')] });
    render();
    const link = await kennzahlGeladen('Betroffene');
    expect(gemerkt()).toEqual([]);
    await userEvent.click(link);
    expect(await screen.findByText('PERSONEN-MODUL')).toBeInTheDocument();
    expect(gemerkt()).toEqual(['personen']);
  });

  it('der Paneel-Link „Gefahren" merkt das Gefahren-Modul', async () => {
    mockEndpunkte({});
    render();
    const box = paneel('Gefahrenmatrix');
    await within(box).findByText('Noch keine Gefahrengebiete angelegt.');
    expect(gemerkt()).toEqual([]);
    await userEvent.click(within(box).getByRole('button', { name: 'Gefahren' }));
    expect(await screen.findByText('GEFAHREN-MODUL')).toBeInTheDocument();
    expect(gemerkt()).toEqual(['gefahrenzonen']);
  });

  it('die Leer-Aktion „Person aufnehmen" merkt Personen, auch über die Sub-Route', async () => {
    mockEndpunkte({});
    render();
    const knopf = await screen.findByRole('button', { name: 'Person aufnehmen' });
    expect(gemerkt()).toEqual([]);
    await userEvent.click(knopf);
    expect(await screen.findByText('AUFNAHME')).toBeInTheDocument();
    expect(gemerkt()).toEqual(['personen']);
  });
});
