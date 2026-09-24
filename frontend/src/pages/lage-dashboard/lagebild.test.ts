import { describe, expect, it } from 'vitest';
import type {
  Auftrag,
  EinsatzAnzeige,
  Gefahrengebiet,
  Meldung,
  PegelAnzeige,
  Person,
} from '../../api/types';
import {
  VERMISST_LANG_MS,
  langeVermisst,
  vermisstNotiz,
  baueLagebild,
  einsatzdauer,
  evakuierungDatenzustand,
  evakuierungStand,
  kennzahlReihe,
  reihenWechsel,
  lagebildZeit,
  standText,
  warnstufeTon,
  wireAlsEpoche,
  type Rohdaten,
} from './lagebild';

/** Feste Zone, damit die Erwartungen nicht von der Maschine abhängen. */
const BERLIN = { zeitzone: 'Europe/Berlin' };

/** 2026-06-11 12:00:00 UTC als Epoche — der „Jetzt"-Punkt der Tests. */
const JETZT = Date.UTC(2026, 5, 11, 12, 0, 0);

const roh = (over: Partial<Rohdaten> = {}): Rohdaten => ({
  einsatz: {
    id: 1,
    bezeichnung: 'Hochwasser',
    begonnen_at: '2026-06-11 05:19:00',
    abgeschlossen_at: null,
    status: 'aktiv',
    lagekennzahlen: [],
  } as unknown as EinsatzAnzeige,
  personen: [],
  uhs: [],
  schaeden: [],
  gefahren: [],
  lageberichte: [],
  einheiten: [],
  personal: [],
  fahrzeuge: [],
  material: [],
  abschnitte: [],
  auftraege: [],
  meldungen: [],
  pegel: [],
  evakuierung: { zustand: 'daten', kennzahl: null },
  ...over,
});

/** Schmales geschütztes Leerzeichen (Tausendertrenner) — als Literal, nicht zurückgelesen. */
const T = '\u202f';

describe('einsatzdauer', () => {
  it('rechnet Stunden und Minuten seit Beginn', () => {
    expect(einsatzdauer('2026-06-11 05:19:00', JETZT)).toBe('6:41');
  });

  it('läuft über 24 Stunden hinaus weiter, statt auf null zu springen', () => {
    expect(einsatzdauer('2026-06-10 09:55:00', JETZT)).toBe('26:05');
  });

  it('endet am Abschluss, nicht an der Uhr', () => {
    expect(einsatzdauer('2026-06-11 05:00:00', JETZT, '2026-06-11 07:30:00')).toBe('2:30');
  });

  it('liefert für einen Beginn in der Zukunft oder Unlesbares keine negative Dauer', () => {
    expect(einsatzdauer('2026-06-11 13:00:00', JETZT)).toBe('—:——');
    expect(einsatzdauer('kaputt', JETZT)).toBe('—:——');
  });

  it('liest den Wirestring als UTC', () => {
    expect(wireAlsEpoche('2026-06-11 12:00:00')).toBe(JETZT);
  });
});

describe('standText', () => {
  it('nennt Sekunden, dann Minuten, dann die Uhrzeit in der Anzeigezone', () => {
    expect(standText(JETZT - 40_000, JETZT)).toBe('Stand vor 40 s');
    expect(standText(JETZT - 5 * 60_000, JETZT)).toBe('Stand vor 5 min');
    // 10:00 UTC → 12:00 Sommerzeit in Berlin.
    expect(standText(JETZT - 2 * 3_600_000, JETZT, BERLIN)).toBe('Stand 12:00');
  });

  it('ohne Abruf behauptet sie keinen Stand', () => {
    expect(standText(0, JETZT)).toBe('Stand wird abgerufen');
  });
});

describe('lagebildZeit', () => {
  it('formatiert „TT.MM. HH:MM" in der Anzeigezone', () => {
    expect(lagebildZeit(JETZT, BERLIN)).toBe('11.06. 14:00');
  });
});

describe('warnstufeTon', () => {
  it('liest die Kennzahl-Lesart: keine/niedrig neutral, mittel achtung, hoch/akut alarm', () => {
    expect(
      ['keine', 'niedrig', 'mittel', 'hoch', 'akut'].map((w) => warnstufeTon(w as never)),
    ).toEqual(['neutral', 'neutral', 'achtung', 'alarm', 'alarm']);
  });
});

/**
 * Die lagebezogene Kennzahlreihe (LFH-640). Alle Erwartungen sind HANDGESCHRIEBENE Literale —
 * aus der Platzbeschreibung gelesen prüfte der Pin die Beschreibung gegen sich selbst.
 * Spec: `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`.
 */
describe('kennzahlReihe (LFH-640)', () => {
  const KERN = { 1: 'Betroffene', 3: 'Kräfte', 4: 'Vermisste', 5: 'Einsatzdauer' } as const;

  it('ohne Auslöser: beide Lageplätze tragen ihre Füllkennzahl', () => {
    expect(kennzahlReihe([])).toEqual([
      'Verbleib offen',
      'Betroffene',
      'Schäden offen',
      'Kräfte',
      'Vermisste',
      'Einsatzdauer',
    ]);
  });

  it('Pegel festgelegt: der Pegel steht auf Platz 1, Platz 3 bleibt „Schäden offen"', () => {
    expect(kennzahlReihe(['pegel'])).toEqual([
      'Pegel',
      'Betroffene',
      'Schäden offen',
      'Kräfte',
      'Vermisste',
      'Einsatzdauer',
    ]);
  });

  it('Evakuierung angeordnet: „Evakuiert" steht auf Platz 3, Platz 1 trägt seine Füllung (LFH-607)', () => {
    expect(kennzahlReihe(['evakuiert'])).toEqual([
      'Verbleib offen',
      'Betroffene',
      'Evakuiert',
      'Kräfte',
      'Vermisste',
      'Einsatzdauer',
    ]);
  });

  it('Hochwasser mit Pegel und Evakuierung ergibt die Reihe aus Entwurf S3 — in jeder Reihenfolge', () => {
    const s3 = ['Pegel', 'Betroffene', 'Evakuiert', 'Kräfte', 'Vermisste', 'Einsatzdauer'];
    expect(kennzahlReihe(['pegel', 'evakuiert'])).toEqual(s3);
    expect(kennzahlReihe(['evakuiert', 'pegel'])).toEqual(s3);
  });

  it('für jede Eingabe: sechs Plätze, der Kern auf den Indizes 1, 3, 4 und 5', () => {
    for (const aktiv of [[], ['pegel'], ['evakuiert'], ['pegel', 'evakuiert']] as const) {
      const reihe = kennzahlReihe(aktiv);
      expect(reihe).toHaveLength(6);
      for (const [i, etikett] of Object.entries(KERN)) expect(reihe[Number(i)]).toBe(etikett);
    }
  });

  it('Heimatplatz: ein hinzukommender Auslöser ändert genau EINEN Platz', () => {
    const vorher = kennzahlReihe([]);
    const nachher = kennzahlReihe(['pegel']);
    const geaendert = vorher.flatMap((e, i) => (e === nachher[i] ? [] : [i]));
    expect(geaendert).toEqual([0]);
  });

  it('Heimatplatz: „evakuiert" ändert in JEDER Ausgangslage genau Platz 3 (Kriterium 9)', () => {
    for (const ohne of [[], ['pegel']] as const) {
      const vorher = kennzahlReihe(ohne);
      const nachher = kennzahlReihe([...ohne, 'evakuiert']);
      const geaendert = vorher.flatMap((e, i) => (e === nachher[i] ? [] : [i]));
      expect(geaendert, `ausgehend von [${ohne.join(', ')}]`).toEqual([2]);
    }
  });

  it('die Reihenfolge der Auslöser am Einsatz ändert nichts', () => {
    expect(kennzahlReihe(['pegel', 'pegel'])).toEqual(kennzahlReihe(['pegel']));
  });
});

describe('reihenWechsel', () => {
  it('nennt je geändertem Platz „neu statt alt"', () => {
    expect(reihenWechsel(kennzahlReihe([]), kennzahlReihe(['pegel']))).toBe(
      'Pegel statt Verbleib offen',
    );
    expect(reihenWechsel(kennzahlReihe(['pegel']), kennzahlReihe([]))).toBe(
      'Verbleib offen statt Pegel',
    );
    expect(reihenWechsel(kennzahlReihe(['pegel']), kennzahlReihe(['pegel', 'evakuiert']))).toBe(
      'Evakuiert statt Schäden offen',
    );
  });

  it('gleiche Reihe → kein Wechsel', () => {
    expect(reihenWechsel(kennzahlReihe(['pegel']), kennzahlReihe(['pegel']))).toBeNull();
  });
});

describe('baueLagebild', () => {
  it('baut die Kennzahlen in der Reihe des Einsatzes', () => {
    const ohne = baueLagebild(roh(), JETZT, BERLIN);
    expect(ohne.kennzahlen.map((k) => k.etikett)).toEqual([
      'Verbleib offen',
      'Betroffene',
      'Schäden offen',
      'Kräfte',
      'Vermisste',
      'Einsatzdauer',
    ]);
    const mit = baueLagebild(
      roh({ einsatz: { ...roh().einsatz, lagekennzahlen: ['pegel'] } }),
      JETZT,
      BERLIN,
    );
    expect(mit.kennzahlen.map((k) => k.etikett)).toEqual([
      'Pegel',
      'Betroffene',
      'Schäden offen',
      'Kräfte',
      'Vermisste',
      'Einsatzdauer',
    ]);
  });

  it('eine übergebene Reihe schlägt die des Einsatzes (gehaltener Zuschnitt der Seite)', () => {
    const bild = baueLagebild(roh(), JETZT, BERLIN, kennzahlReihe(['pegel']));
    expect(bild.kennzahlen[0].etikett).toBe('Pegel');
  });

  it('Verbleib offen: Angetroffene ohne Verbleib, Notiz transportiert, Achtung bei > 0', () => {
    const p = (extra: Partial<Person>) =>
      ({
        status: 'betroffen',
        aktuelle_verbleib_art: null,
        aktuelle_uhs_id: null,
        ...extra,
      }) as Person;
    const bild = baueLagebild(
      roh({
        personen: [
          p({}),
          p({}),
          p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib_status: 'abtransportiert' }),
          p({ status: 'vermisst' }),
        ],
      }),
      JETZT,
      BERLIN,
    );
    expect(bild.kennzahlen[0]).toMatchObject({
      etikett: 'Verbleib offen',
      wert: '2',
      notiz: '1 transportiert',
      ton: 'achtung',
      route: 'personen',
    });
    const leer = baueLagebild(roh(), JETZT, BERLIN).kennzahlen[0];
    expect(leer).toMatchObject({ wert: '0', ton: 'neutral' });
  });

  it('Einsatzdauer: Wert, Einheit und Beginn in der Anzeigezone', () => {
    const dauer = baueLagebild(roh(), JETZT, BERLIN).kennzahlen[5];
    expect(dauer.etikett).toBe('Einsatzdauer');
    expect(dauer.wert).toBe('6:41');
    expect(dauer.einheit).toBe('h');
    // 05:19 UTC → 07:19 Berlin; derselbe Tag wie „jetzt" braucht keinen Tag.
    expect(dauer.notiz).toMatch(/^seit (\d{2}\. )?07:19$/);
  });

  it('Betroffene zählen alle, die Notiz nur Patienten (SK I–IV)', () => {
    const p = (s: Person['aktuelle_sichtung'], status: Person['status'] = 'betroffen') =>
      ({ aktuelle_sichtung: s, status }) as Person;
    const bild = baueLagebild(
      roh({ personen: [p('sk1'), p('sk4'), p('unverletzt'), p(null, 'vermisst')] }),
      JETZT,
    );
    const nach = (e: string) => bild.kennzahlen.find((k) => k.etikett === e);
    expect(nach('Betroffene')).toMatchObject({ wert: '4', notiz: '2 Patienten', ton: 'neutral' });
    expect(nach('Vermisste')).toMatchObject({ wert: '1', ton: 'alarm' });
  });

  it('die Warnstufe kommt aus der Gebiets-Übersicht — für den Kopf-Hinweis, nicht fürs Band', () => {
    const bild = baueLagebild(
      roh({ gefahren: [{ hoechste_warnstufe: 'mittel' } as Gefahrengebiet] }),
      JETZT,
    );
    expect(bild.hoechsteWarnstufe).toBe('mittel');
    expect(bild.kennzahlen.map((k) => k.wert)).not.toContain('mittel');
  });

  it('Pegel: Leitpegel mit Messung auf Platz 1, Ziel ist die Einstellungssektion', () => {
    const p = {
      id: 1,
      station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
      name: 'HANN. MÜNDEN',
      gewaesser: 'WESER',
      reihenfolge: 0,
      // 11:05 UTC in Berliner Sommerzeit geschrieben; JETZT ist 12:00 UTC → 55 min alt.
      messung: { wasserstand_cm: 684, zeitpunkt: '2026-06-11T13:05:00+02:00', trend_cm_pro_h: 9 },
    } as PegelAnzeige;
    const k = baueLagebild(
      roh({ pegel: [p], einsatz: { ...roh().einsatz, lagekennzahlen: ['pegel'] } }),
      JETZT,
      BERLIN,
    ).kennzahlen[0];
    expect(k).toMatchObject({ etikett: 'Pegel', wert: '6,84', einheit: 'm', ton: 'neutral' });
    expect(k.notiz).toBe('WESER · steigend +9 cm/h · Stand 13:05');
    expect(k.zielPfad).toBe('/einsaetze/1/einstellungen/pegel');
  });

  it('Pegel: das Ziel kommt als Eingabe — Modulseite, wenn sie frei ist (LFH-633)', () => {
    // Die Seite entscheidet über `istKeyFreigegeben`; ohne Angabe bleibt es die Pflege.
    const mitPegel = { ...roh().einsatz, lagekennzahlen: ['pegel'] } as EinsatzAnzeige;
    const mitModul = baueLagebild(
      roh({ einsatz: mitPegel, pegelZiel: '/einsaetze/1/wetter-pegel' }),
      JETZT,
      BERLIN,
    );
    expect(mitModul.kennzahlen[0].zielPfad).toBe('/einsaetze/1/wetter-pegel');
    const ohneModul = baueLagebild(roh({ einsatz: mitPegel }), JETZT, BERLIN);
    expect(ohneModul.kennzahlen[0].zielPfad).toBe('/einsaetze/1/einstellungen/pegel');
  });

  it('Pegel: ohne festgelegten Pegel gibt es keinen Pegel-Platz (LFH-640 statt LFH-606)', () => {
    const etiketten = baueLagebild(roh(), JETZT, BERLIN).kennzahlen.map((k) => k.etikett);
    expect(etiketten).not.toContain('Pegel');
  });

  it('Führungsstand: Überfälligkeit ist vom Bearbeitungsstatus unabhängig', () => {
    const a = (bearbeitungsstatus: Auftrag['bearbeitungsstatus'], ist_ueberfaellig = false) =>
      ({ bearbeitungsstatus, ist_ueberfaellig }) as Auftrag;
    const m = (status: Meldung['status'], ist_offen: boolean, ist_ueberfaellig = false) =>
      ({ status, ist_offen, ist_ueberfaellig }) as Meldung;
    const { fuehrung } = baueLagebild(
      roh({
        auftraege: [a('offen'), a('vollzogen', true), a('abgenommen')],
        meldungen: [m('neu', true), m('erledigt', false, true)],
      }),
      JETZT,
    );
    expect(fuehrung).toMatchObject({
      auftraegeOffen: 1,
      auftraegeUeberfaellig: 1,
      meldungenOffen: 1,
      meldungenNeu: 1,
      meldungenUeberfaellig: 1,
      bericht: null,
    });
  });
});

describe('Vermisste seit über 4 h (LFH-613)', () => {
  // Per Etikett, nicht per Index: das Band hat seine Reihenfolge schon einmal geändert
  // (LFH-606 setzte den Pegel auf Platz 1), ein Index träfe dann still eine andere Kennzahl.
  const vermisste = (bild: ReturnType<typeof baueLagebild>) =>
    bild.kennzahlen.find((k) => k.etikett === 'Vermisste')!;

  // JETZT = 2026-06-11 12:00:00 UTC.
  const v = (vermisst_seit?: string, status: Person['status'] = 'vermisst') =>
    ({ status, vermisst_seit, aktuelle_sichtung: null }) as Person;

  it('pinnt die Schwelle als Literal (Neuentwurf S3)', () => {
    expect(VERMISST_LANG_MS).toBe(14_400_000);
  });

  it('Spec-Szenario: drei Vermisste, zwei seit über 4 h → „2 seit über 4 h"', () => {
    const personen = [v('2026-06-11 06:00:00'), v('2026-06-11 07:59:59'), v('2026-06-11 10:00:00')];
    expect(langeVermisst(personen, JETZT)).toBe(2);
    const bild = baueLagebild(roh({ personen }), JETZT);
    expect(vermisste(bild)).toMatchObject({ wert: '3', notiz: '2 seit über 4 h', ton: 'alarm' });
  });

  it('zählt genau 4 h NICHT, eine Sekunde darüber schon', () => {
    expect(langeVermisst([v('2026-06-11 08:00:00')], JETZT)).toBe(0);
    expect(langeVermisst([v('2026-06-11 07:59:59')], JETZT)).toBe(1);
  });

  it('zählt nur vermisste Personen mit lesbarem Zeitpunkt', () => {
    expect(
      langeVermisst([v('2026-06-11 01:00:00', 'betroffen'), v(undefined), v('kaputt')], JETZT),
    ).toBe(0);
  });

  it('schreibt die Notiz mit der Zeit fort — dieselben Daten, später gefragt', () => {
    const personen = [v('2026-06-11 09:00:00')];
    expect(vermisste(baueLagebild(roh({ personen }), JETZT)).notiz).toBe('als vermisst erfasst');
    expect(vermisste(baueLagebild(roh({ personen }), JETZT + 60 * 60_000 + 1000)).notiz).toBe(
      '1 seit über 4 h',
    );
  });

  it('vermisstNotiz: ohne Vermisste der Leerwortlaut', () => {
    expect(vermisstNotiz(0, 0)).toBe('keine offenen Fälle');
    expect(vermisstNotiz(2, 0)).toBe('als vermisst erfasst');
  });
});

describe('Kennzahl „Evakuiert" (LFH-607)', () => {
  const mitEvakuierung = { ...roh().einsatz, lagekennzahlen: ['evakuiert'] } as EinsatzAnzeige;
  const ZIEL = '/einsaetze/1/betreuung';
  // `null` = die Seite gibt kein Ziel (ein explizites `undefined` löste den Vorgabewert aus).
  const zelle = (evakuierung: Rohdaten['evakuierung'], ziel: string | null = ZIEL) =>
    baueLagebild(
      roh({ einsatz: mitEvakuierung, evakuierung, evakuierungZiel: ziel ?? undefined }),
      JETZT,
      BERLIN,
    ).kennzahlen[2];

  it('zwei gemeldete Bezirke: N als Wert, „von M geplant" als Notiz, Ziel Betreuung, kein Ton', () => {
    const k = zelle({
      zustand: 'daten',
      kennzahl: { evakuiert: 1320, geplant: 1850, bezirke: 2, ohneMeldung: 0, geschaetzt: false },
    });
    expect(k).toMatchObject({
      etikett: 'Evakuiert',
      wert: `1${T}320`,
      notiz: `von 1${T}850 geplant`,
      ton: 'neutral',
      zielPfad: ZIEL,
    });
    expect(k.ohneZiel).toBeFalsy();
  });

  it('ohne bestätigtes Modulrecht kein Ziel — auch nicht beim Laden (Sprung ins Leere)', () => {
    // Die Seite gibt das Ziel erst, wenn die Freigaben feststehen (wie `pegelZiel`).
    expect(zelle({ zustand: 'laden' }, null).ohneZiel).toBe(true);
    expect(zelle({ zustand: 'fehler' }, null).ohneZiel).toBe(true);
    expect(zelle({ zustand: 'laden' }, ZIEL)).toMatchObject({ zielPfad: ZIEL });
  });

  it('ein Bezirk ohne Meldung steht in der Notiz, geschätzt trägt ≈', () => {
    expect(
      zelle({
        zustand: 'daten',
        kennzahl: { evakuiert: 600, geplant: 1850, bezirke: 2, ohneMeldung: 1, geschaetzt: true },
      }),
    ).toMatchObject({ wert: '≈ 600', notiz: `von 1${T}850 geplant · 1 ohne Meldung` });
  });

  it('noch keine Meldung: Wert „—", nie 0', () => {
    const k = zelle({
      zustand: 'daten',
      kennzahl: { evakuiert: null, geplant: 640, bezirke: 1, ohneMeldung: 1, geschaetzt: false },
    });
    expect(k.wert).toBe('—');
    expect(k.notiz).toBe('von 640 geplant · 1 ohne Meldung');
  });

  it('Auslöser und Quelle laufen auseinander: „—" mit „keine geplante Evakuierung"', () => {
    expect(zelle({ zustand: 'daten', kennzahl: null })).toMatchObject({
      wert: '—',
      notiz: 'keine geplante Evakuierung',
    });
  });

  it('kein Zugriff auf Betreuung: das Etikett bleibt, ohne Zahl, ohne Ziel, Grund benannt', () => {
    const k = zelle({ zustand: 'kein-zugriff' }, null);
    expect(k).toMatchObject({
      etikett: 'Evakuiert',
      wert: '—',
      notiz: 'Modul Betreuung nicht freigegeben',
      ton: 'neutral',
      ohneZiel: true,
    });
  });

  it('evakuierungStand: „aus" (Hook bereit, Modul nicht frei) heißt „kein Zugriff"', () => {
    expect(evakuierungStand({ zustand: 'aus' })).toEqual({ zustand: 'kein-zugriff' });
    expect(evakuierungStand({ zustand: 'laden' })).toEqual({ zustand: 'laden' });
    expect(evakuierungStand({ zustand: 'fehler', fehler: new Error('x') })).toEqual({
      zustand: 'fehler',
    });
    expect(evakuierungStand({ zustand: 'daten', kennzahl: null })).toEqual({
      zustand: 'daten',
      kennzahl: null,
    });
  });

  it('evakuierungDatenzustand: laden und fehler reichen durch, alles andere sind Daten', () => {
    expect(evakuierungDatenzustand({ zustand: 'laden' })).toBe('laden');
    expect(evakuierungDatenzustand({ zustand: 'fehler' })).toBe('fehler');
    expect(evakuierungDatenzustand({ zustand: 'kein-zugriff' })).toBe('daten');
    expect(evakuierungDatenzustand({ zustand: 'daten', kennzahl: null })).toBe('daten');
  });
});
