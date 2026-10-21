import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listePersonen } from '../api/einsatzPerson';
import { listeSchadenMarker } from '../api/einsatzSchaden';
import { ladeGefahrengebiete, ladeMatrix } from '../api/gefahren';
import { listePegel } from '../api/pegel';
import { einsatzKeys } from '../api/queryKeys';
import type {
  EinsatzAnzeige,
  GefahrBewertung,
  PegelAnzeige,
  Person,
  Schaden,
  WetterAnzeige,
} from '../api/types';
import { ladeWetter } from '../api/wetter';
import { baueLagebild, kennzahlReihe, type Rohdaten } from '../pages/lage-dashboard/lagebild';
import { ausKennzahl, sichtungText, warnstufeAngabe } from '../lagebesprechung/vorbereitung';
import { freigabenFixture } from '../test/fixtures';
import { SCHADENLAGE_QUELLE } from './schadenlageUebernahme';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn() }));
vi.mock('../api/einsatzPerson', () => ({ listePersonen: vi.fn() }));
vi.mock('../api/einsatzSchaden', () => ({ listeSchadenMarker: vi.fn() }));
vi.mock('../api/gefahren', async (original) => ({
  ...(await original<typeof import('../api/gefahren')>()),
  ladeGefahrengebiete: vi.fn(),
  ladeMatrix: vi.fn(),
}));
vi.mock('../api/pegel', async () => {
  const { einsatzKeys } = await import('../api/queryKeys');
  const listePegel = vi.fn();
  return {
    listePegel,
    pegelAbfrage: (id: number) => ({
      queryKey: einsatzKeys.pegel(id),
      queryFn: () => listePegel(id),
    }),
  };
});
vi.mock('../api/wetter', async () => {
  const { einsatzKeys } = await import('../api/queryKeys');
  const ladeWetter = vi.fn();
  return {
    ladeWetter,
    wetterAbfrage: (id: number) => ({
      queryKey: einsatzKeys.wetter(id),
      queryFn: () => ladeWetter(id),
    }),
  };
});

/** 2026-10-04 10:00 UTC = 12:00 in Berlin. */
const JETZT = Date.UTC(2026, 9, 4, 10, 0, 0);

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser',
  begonnen_at: '2026-10-04 05:00:00',
  abgeschlossen_at: null,
  status: 'aktiv',
  // Hochwasserlage per Entscheidung (LLH-1117): der Teil „Pegel“ steht nur damit.
  lagekennzahlen: ['pegel'],
} as unknown as EinsatzAnzeige;
const OHNE_PEGEL = { ...EINSATZ, lagekennzahlen: [] } as unknown as EinsatzAnzeige;

/** Freitext mit Namen Dritter: darf nie im Lagevortrag landen. */
const FREITEXT = ['Erika Muster', 'Familie Müller', 'Hauptstraße 5', 'Herr Schmidt'];

const person = (p: Partial<Person>) =>
  ({
    status: 'erfasst',
    aktuelle_sichtung: null,
    name: 'Erika Muster',
    bemerkung: 'Familie Müller',
    ...p,
  }) as unknown as Person;

const PERSONEN = [
  person({ aktuelle_sichtung: 'sk1' }),
  person({ aktuelle_sichtung: 'sk2' }),
  person({ status: 'vermisst', erfasst_at: '2026-10-04 04:00:00' }),
];
const SCHAEDEN = [
  { id: 1, status: 'offen', beschreibung: 'Keller bei Familie Müller', ort: 'Hauptstraße 5' },
  { id: 2, status: 'offen', kontakt: 'Herr Schmidt' },
  { id: 3, status: 'abgeschlossen' },
] as unknown as Schaden[];
const GEFAHREN = [
  { id: 1, label: 'Zone A', hoechste_warnstufe: 'hoch', beurteilt_at: '2026-10-04 08:00:00' },
  { id: 2, label: 'Zone B', hoechste_warnstufe: 'niedrig' },
  { id: 3, label: null, hoechste_warnstufe: 'keine', beurteilt_at: '2026-10-04 08:00:00' },
] as unknown as Rohdaten['gefahren'];

const bewertung = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1,
  gefahrengebiet_id: 1,
  gefahrentyp: 'brand',
  schutzobjekt: 'menschen',
  warnstufe: 'keine',
  beschreibung: null,
  gemeldet_von: null,
  aktualisiert_von: 1,
  aktualisiert_von_name: 'Erika Muster',
  erstellt_at: '',
  geaendert_at: '',
  ...over,
});

/** Matrizen je Gebiet: Zone A mit Erläuterungen, Zone B nur eine Stufe, Gebiet 3 leer. */
const MATRIZEN: Record<number, GefahrBewertung[]> = {
  1: [
    bewertung({
      id: 11,
      gefahrentyp: 'elektrizitaet',
      warnstufe: 'hoch',
      beschreibung: 'Stromführende Kellerverteilungen\nunter *Wasser*',
      gemeldet_von: 'Herr Schmidt',
    }),
    bewertung({ id: 12, gefahrentyp: 'absturz', beschreibung: 'Hangkante geprüft' }),
    bewertung({ id: 13, gefahrentyp: 'einsturz' }),
  ],
  2: [bewertung({ id: 21, gefahrengebiet_id: 2, gefahrentyp: 'ertrinken', warnstufe: 'niedrig' })],
  3: [],
};

const PEGEL = [
  {
    id: 1,
    station_uuid: 'a',
    name: 'HANN. MÜNDEN',
    gewaesser: 'WESER',
    reihenfolge: 0,
    messung: {
      wasserstand_cm: 684,
      zeitpunkt: '2026-10-04T11:45:00+02:00',
      trend_cm_pro_h: 9.2,
    },
    prognose: { hoechststand_cm: 710, zeitpunkt: '2026-10-04 16:00:00' },
  },
  {
    id: 2,
    station_uuid: 'b',
    name: 'HAMELN',
    gewaesser: 'WESER',
    reihenfolge: 1,
    messung: null,
  },
] as unknown as PegelAnzeige[];

const WETTER = {
  ort: { name: 'Stadt Hameln' },
  warnungen: {
    zustand: 'ok',
    abgerufen_at: '2026-10-04T09:55:00Z',
    daten: [
      {
        stufe: 'schwer',
        ereignis: 'ORKANARTIGE BÖEN',
        ueberschrift: 'Amtliche UNWETTERWARNUNG vor ORKANARTIGEN BÖEN',
        beginn: '2026-10-04T08:00:00Z',
        ende: '2026-10-04T14:00:00Z',
        beschreibung: 'Beschreibung des DWD',
      },
      {
        stufe: 'gering',
        ereignis: 'FROST',
        ueberschrift: 'Amtliche WARNUNG vor FROST',
        beginn: '2026-10-04T20:00:00Z',
        ende: null,
      },
      // Abgelaufen: fällt wie im Paneel heraus.
      {
        stufe: 'maessig',
        ereignis: 'DAUERREGEN',
        ueberschrift: 'x',
        beginn: '2026-10-04T02:00:00Z',
        ende: '2026-10-04T09:00:00Z',
      },
    ],
  },
  vorhersage: { zustand: 'ok', abgerufen_at: '2026-10-04T09:30:00Z', daten: [] },
  aktuell: {
    zustand: 'ok',
    abgerufen_at: '2026-10-04T09:55:00Z',
    daten: {
      gemessen_at: '2026-10-04T09:50:00Z',
      station: { name: 'BREMEN', entfernung_m: 4200 },
      ergaenzt: [],
      temperatur_c: 12.3,
      wind_kmh: 11,
      boeen_kmh: 19,
      windrichtung_grad: 180,
      symbol: 'regen',
    },
  },
} as unknown as WetterAnzeige;

const dtg = (iso: string) => `DTG(${iso})`;

function erzeuge(freigaben = freigabenFixture(), qc = new QueryClient()) {
  return SCHADENLAGE_QUELLE.erzeuge({ qc, einsatzId: 1, freigaben, dtg });
}

/** Was Vorbereitung und Dashboard aus denselben Rohdaten zeigen. */
function lagebildAus(personen: Person[], schaeden: Schaden[], gefahren: Rohdaten['gefahren']) {
  return baueLagebild(
    {
      einsatz: EINSATZ,
      personen,
      uhs: [],
      schaeden,
      gefahren,
      lageberichte: [],
      einheiten: [],
      personal: [],
      fahrzeuge: [],
      material: [],
      abschnitte: [],
      pegel: [],
      evakuierung: { zustand: 'laden' },
    },
    JETZT,
    undefined,
    kennzahlReihe([]),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
  vi.mocked(ladeEinsatz).mockReset().mockResolvedValue(EINSATZ);
  vi.mocked(listePersonen).mockReset().mockResolvedValue(PERSONEN);
  vi.mocked(listeSchadenMarker).mockReset().mockResolvedValue(SCHAEDEN);
  vi.mocked(ladeGefahrengebiete).mockReset().mockResolvedValue(GEFAHREN);
  vi.mocked(ladeMatrix)
    .mockReset()
    .mockImplementation(async (_e, gid) => MATRIZEN[gid] ?? []);
  vi.mocked(listePegel).mockReset().mockResolvedValue(PEGEL);
  vi.mocked(ladeWetter).mockReset().mockResolvedValue(WETTER);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Gefahren-/Schadenlage (LFH-872)', () => {
  it('beginnt mit dem Stand', async () => {
    expect((await erzeuge()).startsWith('**Stand:** DTG(')).toBe(true);
  });

  it('nennt Betroffene, Vermisste, Sichtung, Schäden und Warnstufe wie die Vorbereitung', async () => {
    const text = await erzeuge();
    const lb = lagebildAus(PERSONEN, SCHAEDEN, GEFAHREN);
    const zeile = (titel: string, a: { wert: string; notiz: string | null }) =>
      `- ${titel}: ${a.wert}${a.notiz ? ` (${a.notiz})` : ''}`;
    expect(text).toContain(
      '**Betroffene**\n' +
        `${zeile('Betroffene', ausKennzahl(lb, 'Betroffene'))}\n` +
        `${zeile('Vermisste', ausKennzahl(lb, 'Vermisste'))}\n` +
        `- Sichtung: ${sichtungText(lb.sk)}\n`,
    );
    expect(text).toContain(
      '**Schäden und Gefahren**\n' +
        `${zeile('Schäden offen', ausKennzahl(lb, 'Schäden offen'))}\n` +
        `${zeile('Höchste Warnstufe', warnstufeAngabe(lb))}\n`,
    );
    // Gegenprobe der Konstruktion: die Werte selbst.
    expect(text).toContain('- Betroffene: 3 (');
    expect(text).toContain('- Vermisste: 1');
    expect(text).toContain('- Schäden offen: 2 (von 3 gemeldet)');
    expect(text).toContain('(2 Gebiete mit Warnstufe)');
  });

  it('trennt geltende und angekündigte Warnungen, abgelaufene fehlen', async () => {
    const text = await erzeuge();
    expect(text).toContain(
      '**Wetter**\n' +
        '- Warnungen für Stadt Hameln (Stand DTG(2026-10-04T09:55:00Z))\n' +
        '  - gilt jetzt: Unwetterwarnung · Orkanartige Böen · seit DTG(2026-10-04T08:00:00Z) · bis DTG(2026-10-04T14:00:00Z)\n' +
        '  - angekündigt: Wetterwarnung · Frost · ab DTG(2026-10-04T20:00:00Z) · bis auf Weiteres\n',
    );
    expect(text).not.toContain('Dauerregen');
    expect(text).not.toContain('Beschreibung des DWD');
  });

  it('nennt die aktuellen Bedingungen mit Station und Messzeit', async () => {
    const text = await erzeuge();
    expect(text).toContain(
      '- Aktuell: 12,3 °C · Regen · Wind aus S 11 km/h · Böen 19 km/h ' +
        '(Station Bremen, 4,2 km · Messung DTG(2026-10-04T09:50:00Z))\n',
    );
  });

  it('sagt „keine gültigen“, wenn keine Warnung gilt', async () => {
    vi.mocked(ladeWetter).mockResolvedValue({
      ...WETTER,
      warnungen: { ...WETTER.warnungen, daten: [] },
    });
    expect(await erzeuge()).toContain(
      '- Warnungen: keine gültigen für Stadt Hameln (Stand DTG(2026-10-04T09:55:00Z))\n',
    );
  });

  it('sagt „kein Einsatzort“ ohne Ort, die übrigen Teile tragen ihre Werte', async () => {
    vi.mocked(ladeWetter).mockResolvedValue({
      ort: null,
      warnungen: { zustand: 'kein_ort' },
      vorhersage: { zustand: 'kein_ort' },
      aktuell: { zustand: 'kein_ort' },
    } as unknown as WetterAnzeige);
    const text = await erzeuge();
    expect(text).toContain('**Wetter**\n- kein Einsatzort\n');
    expect(text).toContain('- Schäden offen: 2 (von 3 gemeldet)');
    expect(text).toContain('**Pegel**\n- HANN. MÜNDEN');
  });

  it('nennt eine ausgefallene Wetterquelle „— (Ausfall)“', async () => {
    vi.mocked(ladeWetter).mockResolvedValue({
      ort: { name: 'Stadt Hameln' },
      warnungen: { zustand: 'ausfall' },
      vorhersage: { zustand: 'ausfall' },
      aktuell: { zustand: 'ausfall' },
    } as unknown as WetterAnzeige);
    const text = await erzeuge();
    expect(text).toContain('- Warnungen: — (Ausfall)\n- Aktuell: — (Ausfall)\n');
  });

  it('nennt je maßgeblichem Pegel Gewässer, Stand, Trend und Messzeit in Reihenfolge', async () => {
    const text = await erzeuge();
    expect(text).toContain(
      '**Pegel**\n' +
        '- HANN. MÜNDEN · WESER: 6,84 m · steigend +9 cm/h · Messung DTG(2026-10-04T11:45:00+02:00) · Prognose 7,10 m bis DTG(2026-10-04 16:00:00)\n' +
        '- HAMELN · WESER: — · Stand unbekannt\n',
    );
  });

  it('steht das Wetter vor dem Pegel', async () => {
    const text = await erzeuge();
    expect(text.indexOf('**Wetter**')).toBeGreaterThan(-1);
    expect(text.indexOf('**Wetter**')).toBeLessThan(text.indexOf('**Pegel**'));
  });

  it('ohne festgelegten Pegel entfällt der Teil „Pegel“ ganz (LLH-1117)', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(OHNE_PEGEL);
    vi.mocked(listePegel).mockResolvedValue([]);
    const text = await erzeuge();
    expect(text).not.toContain('Pegel');
    // Die übrigen Teile tragen ihre Werte, der Text endet nach dem Wetter.
    expect(text).toContain('- Schäden offen: 2 (von 3 gemeldet)');
    expect(text).toMatch(/\*\*Wetter\*\*\n[^*]*$/);
  });

  it('entscheidet der Einsatz, nicht die Liste: ohne Entscheidung kein Teil, auch mit Liste', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(OHNE_PEGEL);
    expect(await erzeuge()).not.toContain('**Pegel**');
  });

  it('mit Entscheidung, aber gerade geleerter Liste: „keine maßgeblichen Pegel festgelegt“', async () => {
    vi.mocked(listePegel).mockResolvedValue([]);
    expect(await erzeuge()).toContain('**Pegel**\n- keine maßgeblichen Pegel festgelegt');
  });

  it('ohne ladbaren Einsatz bleibt der Teil „Pegel“ mit Grund stehen', async () => {
    vi.mocked(ladeEinsatz).mockRejectedValue(new Error('500'));
    expect(await erzeuge()).toContain('**Pegel**\n- — (nicht geladen)');
  });

  it('Personen gesperrt: „— (nicht freigegeben)“ ohne Anfrage, der Rest bleibt', async () => {
    const text = await erzeuge(freigabenFixture({ personen: { zugriff: false } }));
    expect(listePersonen).not.toHaveBeenCalled();
    expect(text).toContain(
      '**Betroffene**\n' +
        '- Betroffene: — (nicht freigegeben)\n' +
        '- Vermisste: — (nicht freigegeben)\n' +
        '- Sichtung: — (nicht freigegeben)\n',
    );
    expect(text).toContain('- Schäden offen: 2 (von 3 gemeldet)');
  });

  it('Wetter gesperrt: Wetter „— (nicht freigegeben)“, Pegel trotzdem da', async () => {
    const text = await erzeuge(freigabenFixture({ 'wetter-pegel': { zugriff: false } }));
    expect(ladeWetter).not.toHaveBeenCalled();
    expect(text).toContain('**Wetter**\n- — (nicht freigegeben)\n');
    expect(text).toContain('**Pegel**\n- HANN. MÜNDEN');
  });

  it('eine gescheiterte Liste steht als „— (nicht geladen)“, nie als 0', async () => {
    vi.mocked(listeSchadenMarker).mockRejectedValue(new Error('500'));
    const text = await erzeuge();
    expect(text).toContain('- Schäden offen: — (nicht geladen)');
  });

  it('übernimmt keine Personen- oder Schadensfelder', async () => {
    const text = await erzeuge();
    // „Herr Schmidt“ steht auch als „gemeldet von“ an einer Bewertung: Dritte bleiben draußen.
    for (const f of FREITEXT) expect(text).not.toContain(f);
    expect(text).not.toContain('gemeldet von');
    // Ebenso der Name der letzten Änderung.
    expect(text).not.toContain('Erika');
  });

  it('der Stand ist der älteste Abruf der gelesenen Quellen, nicht der Klick', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const alt = JETZT - 10 * 60_000;
    qc.setQueryData(einsatzKeys.personen(1), PERSONEN, { updatedAt: alt });
    const text = await erzeuge(freigabenFixture(), qc);
    expect(text.split('\n')[0]).toBe(`**Stand:** DTG(${new Date(alt).toISOString()})`);
  });

  describe('Gefahrengebiete mit Erläuterungen (LLH-1110)', () => {
    it('nennt je Gebiet die gesetzten Gefahren mit Stufe und Erläuterung, alphabetisch', async () => {
      const text = await erzeuge();
      expect(text).toContain(
        '**Gefahrengebiete**\n' +
          '- Zone A\n' +
          '  - Absturz × Menschen: keine · Hangkante geprüft\n' +
          '  - Elektrizität × Menschen: hoch · Stromführende Kellerverteilungen unter \\*Wasser\\*\n' +
          '- Zone B (nicht beurteilt)\n' +
          '  - Ertrinken × Menschen: niedrig\n' +
          '- Gefahrengebiet #3: keine Gefahr über „keine“\n',
      );
      // „keine“ ohne Erläuterung sagt nichts.
      expect(text).not.toContain('Einsturz');
    });

    it('steht nach „Schäden und Gefahren“ und vor dem Wetter', async () => {
      const text = await erzeuge();
      expect(text.indexOf('**Schäden und Gefahren**')).toBeLessThan(
        text.indexOf('**Gefahrengebiete**'),
      );
      expect(text.indexOf('**Gefahrengebiete**')).toBeLessThan(text.indexOf('**Wetter**'));
    });

    it('Gefahren gesperrt: „— (nicht freigegeben)“ ohne Abruf von Gebieten und Matrizen', async () => {
      const text = await erzeuge(freigabenFixture({ gefahrenzonen: { zugriff: false } }));
      expect(ladeGefahrengebiete).not.toHaveBeenCalled();
      expect(ladeMatrix).not.toHaveBeenCalled();
      expect(text).toContain('**Gefahrengebiete**\n- — (nicht freigegeben)\n');
    });

    it('eine gescheiterte Matrix steht mit Grund am Gebiet, die übrigen tragen ihre Werte', async () => {
      vi.mocked(ladeMatrix).mockImplementation(async (_e, gid) => {
        if (gid === 2) throw new Error('500');
        return MATRIZEN[gid] ?? [];
      });
      const text = await erzeuge();
      expect(text).toContain('- Zone B (nicht beurteilt): — (nicht geladen)\n');
      expect(text).toContain('  - Elektrizität × Menschen: hoch');
    });

    it('eine gescheiterte Gebietsliste fragt keine Matrix und nennt den Grund', async () => {
      vi.mocked(ladeGefahrengebiete).mockRejectedValue(new Error('500'));
      const text = await erzeuge();
      expect(ladeMatrix).not.toHaveBeenCalled();
      expect(text).toContain('**Gefahrengebiete**\n- — (nicht geladen)\n');
    });

    it('ohne Gebiete: „keine Gefahrengebiete“', async () => {
      vi.mocked(ladeGefahrengebiete).mockResolvedValue([]);
      expect(await erzeuge()).toContain('**Gefahrengebiete**\n- keine Gefahrengebiete\n');
    });

    it('der Stand berücksichtigt auch den Abruf der Matrizen', async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      const alt = JETZT - 20 * 60_000;
      qc.setQueryData(einsatzKeys.gefahrenmatrix(1, 2), MATRIZEN[2], { updatedAt: alt });
      const text = await erzeuge(freigabenFixture(), qc);
      expect(text.split('\n')[0]).toBe(`**Stand:** DTG(${new Date(alt).toISOString()})`);
    });
  });

  describe('verfuegbar', () => {
    it('ist frei, sobald eine Quelle frei ist', () => {
      expect(
        SCHADENLAGE_QUELLE.verfuegbar(
          freigabenFixture({ personen: { zugriff: false }, schaeden: { zugriff: false } }),
        ),
      ).toEqual({ frei: true });
    });

    it('nennt die fehlenden Freigaben, wenn keine Quelle frei ist', () => {
      const v = SCHADENLAGE_QUELLE.verfuegbar(
        freigabenFixture({
          personen: { zugriff: false },
          schaeden: { zugriff: false },
          gefahrenzonen: { zugriff: false },
          'wetter-pegel': { zugriff: false },
        }),
      );
      expect(v.frei).toBe(false);
    });
  });
});
