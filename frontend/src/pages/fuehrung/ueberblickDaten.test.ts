import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type {
  Auftrag,
  AuftragEmpfaenger,
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Erinnerung,
  EtbEintragAnzeige,
  Gefahrengebiet,
  LetzteRueckmeldung,
  PegelAnzeige,
  Person,
} from '../../api/types';
import {
  abschnittNamen,
  abschnittZeilen,
  auftraegeKennzahl,
  betroffeneKennzahl,
  empfaengerText,
  entscheidungenAuswahl,
  folgeText,
  kraefteKennzahl,
  markenBewertung,
  naechsteMarken,
  offeneAuftraege,
  warnstufeKennzahlVon,
  warnstufeNotiz,
  zeitpunkt,
} from './ueberblickDaten';

dayjs.extend(utc);

/** Feste Uhr: 14:00 UTC. Wire-Strings sind UTC ohne Zone. */
const JETZT = dayjs.utc('2026-09-21 14:00:00');
const vor = (min: number) => JETZT.subtract(min, 'minute').format('YYYY-MM-DD HH:mm:ss');
const nach = (min: number) => JETZT.add(min, 'minute').format('YYYY-MM-DD HH:mm:ss');

const person = (erfasst_at: string, id = Math.random()) =>
  ({ id, erfasst_at, status: 'betroffen', aktuelle_sichtung: null }) as unknown as Person;

const empfaenger = (over: Partial<AuftragEmpfaenger> = {}): AuftragEmpfaenger => ({
  id: 1,
  auftrag_id: 1,
  empfaenger_typ: 'abschnitt',
  snap_anzeige: 'EA Nord',
  ...over,
});

let naechsteId = 1;
const auftrag = (over: Partial<Auftrag> = {}): Auftrag =>
  ({
    id: naechsteId++,
    einsatz_id: 1,
    auftrag_text: 'Deich sichern',
    bearbeitungsstatus: 'offen',
    ist_ueberfaellig: false,
    frist_at: null,
    erteilt_at: vor(30),
    quell_etb_eintrag_id: null,
    empfaenger: [],
    ...over,
  }) as unknown as Auftrag;

const abschnitt = (id: number, name: string, over: Partial<Einsatzabschnitt> = {}) =>
  ({
    id,
    einsatz_id: 1,
    name,
    sortier: id,
    sprechgruppen: [],
    ueber_abschnitt_id: null,
    leiter_name: null,
    ...over,
  }) as unknown as Einsatzabschnitt;

const einheit = (
  id: number,
  abschnitt_id: number | null,
  ueber_einheit_id: number | null = null,
  kat: 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar' | null = null,
) =>
  ({
    id,
    name: `E${id}`,
    abschnitt_id,
    ueber_einheit_id,
    soll: null,
    status: kat
      ? { quelle: 'gemischt', kategorie: kat, verteilung: [] }
      : { quelle: 'ohne', verteilung: [] },
  }) as unknown as Einheit;

const personal = (
  id: number,
  einheit_id: number | null,
  pos: 'fuehrer' | 'unterfuehrer' | 'mannschaft',
  kat: 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar' | null,
) =>
  ({
    id,
    name: `P${id}`,
    einheit_id,
    staerke_position: pos,
    status_kategorie: kat,
  }) as unknown as EinsatzPersonal;

const fahrzeug = (
  id: number,
  einheit_id: number | null,
  kat: 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar' | null,
) =>
  ({ id, funkrufname: `F${id}`, einheit_id, status_kategorie: kat }) as unknown as EinsatzFahrzeug;

const etb = (id: number, ereigniszeit: string, typ = 'entscheidung') =>
  ({
    id,
    lfd_nr: id,
    typ,
    ereigniszeit,
    inhalt: `E${id}`,
    erfasser_name: 'Vitt',
    folgeauftraege: [],
  }) as unknown as EtbEintragAnzeige;

describe('zeitpunkt', () => {
  it('liest Wire-Zeit als UTC, nicht als Ortszeit', () => {
    expect(zeitpunkt('2026-09-21 14:00:00')!.toISOString()).toBe('2026-09-21T14:00:00.000Z');
    expect(zeitpunkt(null)).toBeNull();
    expect(zeitpunkt('kaputt')).toBeNull();
  });
});

describe('Kennzahlen', () => {
  it('Betroffene zählen alle und die in den letzten 60 min erfassten', () => {
    const k = betroffeneKennzahl(
      [person(vor(5)), person(vor(60)), person(vor(61)), person(vor(600))],
      JETZT,
    );
    expect(k).toEqual({ anzahl: 4, neu: 2 });
  });

  it('Kräfte: Gesamtstärke und BOS-Schreibweise F/UF/M//Σ', () => {
    const k = kraefteKennzahl(
      [
        personal(1, null, 'fuehrer', null),
        personal(2, null, 'unterfuehrer', null),
        personal(3, null, 'mannschaft', null),
        personal(4, null, 'mannschaft', null),
      ],
      [],
      [],
    );
    expect(k).toEqual({ gesamt: 4, text: '1/1/2//4' });
  });

  it('Warnstufe: höchste Stufe als Wort, Ton aus dem Kennzahl-Vertrag', () => {
    const g = (w: string) => ({ hoechste_warnstufe: w }) as unknown as Gefahrengebiet;
    expect(warnstufeKennzahlVon([])).toMatchObject({ wort: 'keine', ton: 'neutral' });
    expect(warnstufeKennzahlVon([g('niedrig'), g('mittel')])).toMatchObject({
      wort: 'mittel',
      ton: 'achtung',
      anzahlAktiv: 2,
    });
    expect(warnstufeKennzahlVon([g('mittel'), g('hoch')])).toMatchObject({
      wort: 'hoch',
      ton: 'alarm',
    });
  });

  it('Warnstufen-Notiz: Gebietszahl, mit Pegel die Pegel-Notiz dahinter (LFH-606)', () => {
    expect(warnstufeNotiz(1, null)).toBe('1 Gefahrengebiet mit Warnstufe');
    expect(warnstufeNotiz(0, null)).toBe('0 Gefahrengebiete mit Warnstufe');
    expect(warnstufeNotiz(2, 'Pegel 6,84 m steigend')).toBe(
      '2 Gefahrengebiete mit Warnstufe · Pegel 6,84 m steigend',
    );
  });

  it('Offene Aufträge: offen + in Arbeit, überfällige nur unter offenen, Ton alarm', () => {
    const k = auftraegeKennzahl([
      auftrag(),
      auftrag({ bearbeitungsstatus: 'in_arbeit', ist_ueberfaellig: true }),
      auftrag({ bearbeitungsstatus: 'vollzogen', ist_ueberfaellig: true }),
      auftrag({ bearbeitungsstatus: 'abgenommen' }),
    ]);
    expect(k).toEqual({ offen: 2, inArbeit: 1, ueberfaellig: 1, ton: 'alarm' });
    expect(auftraegeKennzahl([auftrag()]).ton).toBe('neutral');
  });

  it('Abschnittsnamen in gepflegter Reihenfolge, ab dem fünften gezählt', () => {
    expect(abschnittNamen([abschnitt(2, 'Süd'), abschnitt(1, 'Nord')])).toBe('Nord, Süd');
    const viele = [1, 2, 3, 4, 5, 6].map((i) => abschnitt(i, `A${i}`));
    expect(abschnittNamen(viele)).toBe('A1, A2, A3, A4 +2');
  });
});

describe('offeneAuftraege', () => {
  it('überfällige zuerst, dann nach Frist, fristlose ans Ende, erledigte raus', () => {
    const a = auftrag({ auftrag_text: 'ohne Frist' });
    const b = auftrag({ auftrag_text: 'Frist spät', frist_at: nach(90) });
    const c = auftrag({ auftrag_text: 'Frist früh', frist_at: nach(10) });
    const d = auftrag({ auftrag_text: 'überfällig', frist_at: vor(20), ist_ueberfaellig: true });
    const e = auftrag({ auftrag_text: 'erledigt', bearbeitungsstatus: 'vollzogen' });
    expect(offeneAuftraege([a, b, c, d, e]).map((x) => x.auftrag_text)).toEqual([
      'überfällig',
      'Frist früh',
      'Frist spät',
      'ohne Frist',
    ]);
  });

  it('ist bei gleicher Frist stabil über Erteilung und id', () => {
    const x = auftrag({ frist_at: nach(10), erteilt_at: vor(5) });
    const y = auftrag({ frist_at: nach(10), erteilt_at: vor(50) });
    expect(offeneAuftraege([x, y]).map((a) => a.id)).toEqual([y.id, x.id]);
    expect(offeneAuftraege([y, x]).map((a) => a.id)).toEqual([y.id, x.id]);
  });

  it('Empfängertext aus den Anzeigenamen, sonst null', () => {
    expect(
      empfaengerText(
        auftrag({ empfaenger: [empfaenger(), empfaenger({ id: 2, snap_anzeige: 'S2' })] }),
      ),
    ).toBe('EA Nord, S2');
    expect(empfaengerText(auftrag())).toBeNull();
  });
});

describe('folgeText', () => {
  it('nichts bei null, Einzahl und Mehrzahl', () => {
    expect(folgeText(0)).toBeNull();
    expect(folgeText(1)).toBe('1 Auftrag');
    expect(folgeText(3)).toBe('3 Aufträge');
  });
});

describe('entscheidungenAuswahl', () => {
  it('nimmt die letzte Stunde, jüngste zuerst, nur Typ Entscheidung', () => {
    const r = entscheidungenAuswahl(
      [etb(1, vor(50)), etb(2, vor(10)), etb(3, vor(70)), etb(4, vor(5), 'meldung')],
      JETZT,
    );
    expect(r.modus).toBe('stunde');
    expect(r.eintraege.map((e) => e.id)).toEqual([2, 1]);
  });

  it('fällt auf die letzten fünf zurück, wenn die Stunde leer ist — und sagt es', () => {
    const alt = [1, 2, 3, 4, 5, 6].map((i) => etb(i, vor(100 + i)));
    const r = entscheidungenAuswahl(alt, JETZT);
    expect(r.modus).toBe('zuletzt');
    expect(r.eintraege.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(entscheidungenAuswahl([], JETZT)).toEqual({ eintraege: [], modus: 'zuletzt' });
  });
});

describe('Nächste Marken', () => {
  it('bewertet Zeit: überfällig alarm, unter 30 min achtung, sonst neutral — mit Wort', () => {
    expect(markenBewertung(JETZT.subtract(1, 'minute'), JETZT)).toEqual({
      ton: 'alarm',
      wort: 'überfällig',
    });
    expect(markenBewertung(JETZT, JETZT).ton).toBe('alarm');
    expect(markenBewertung(JETZT.add(29, 'minute'), JETZT)).toEqual({
      ton: 'achtung',
      wort: 'in 29 min',
    });
    expect(markenBewertung(JETZT.add(30, 'minute'), JETZT)).toEqual({
      ton: 'neutral',
      wort: 'in 30 min',
    });
    expect(markenBewertung(JETZT.add(20, 'second'), JETZT).wort).toBe('in < 1 min');
  });

  it('mischt Auftragsfristen, offene Erinnerungen und Lagebesprechung, aufsteigend', () => {
    const erinnerung = (id: number, faellig_at: string, status = 'offen') =>
      ({ id, faellig_at, status, titel: `Erinnerung ${id}` }) as unknown as Erinnerung;
    const r = naechsteMarken(
      [
        auftrag({ id: 101, auftrag_text: 'Frist', frist_at: nach(45) }),
        auftrag({
          id: 102,
          auftrag_text: 'erledigt',
          frist_at: nach(5),
          bearbeitungsstatus: 'vollzogen',
        }),
        auftrag({ id: 103, auftrag_text: 'gerissen', frist_at: vor(10), ist_ueberfaellig: true }),
        auftrag({ id: 104, auftrag_text: 'fristlos' }),
      ],
      [erinnerung(1, nach(15)), erinnerung(2, nach(20), 'erledigt')],
      nach(120),
      JETZT,
    );
    expect(r.weitere).toBe(0);
    expect(r.marken.map((m) => [m.text, m.ton])).toEqual([
      ['gerissen', 'alarm'],
      ['Erinnerung 1', 'achtung'],
      ['Frist', 'neutral'],
      ['Lagebesprechung', 'neutral'],
    ]);
    expect(r.marken[0]).toMatchObject({ art: 'auftrag', id: 103 });
    expect(r.marken[3]).toMatchObject({ art: 'lagebesprechung', id: null });
  });

  it('Pegel-Prognose (LFH-628): offen als Marke, verstrichen gar nicht — nie „überfällig"', () => {
    const pegel = (id: number, zeitpunkt: string | null, gewaesser: string | null = 'WESER') =>
      ({
        id,
        station_uuid: `u-${id}`,
        name: `STATION ${id}`,
        gewaesser,
        reihenfolge: id,
        prognose: zeitpunkt
          ? { hoechststand_cm: 710, zeitpunkt, gesetzt_at: '2026-09-21 12:00:00' }
          : undefined,
      }) as PegelAnzeige;
    const r = naechsteMarken(
      [auftrag({ id: 101, auftrag_text: 'Frist', frist_at: nach(45) })],
      [],
      null,
      JETZT,
      [
        pegel(1, nach(20)),
        pegel(2, vor(5)),
        pegel(3, null),
        pegel(4, nach(90), null),
        pegel(5, nach(100)),
      ],
    );
    expect(r.marken.map((m) => [m.art, m.text, m.ton])).toEqual([
      ['pegelprognose', 'Erwarteter Höchststand Pegel STATION 1 (WESER): 7,10 m', 'achtung'],
      ['auftrag', 'Frist', 'neutral'],
      ['pegelprognose', 'Erwarteter Höchststand Pegel STATION 4: 7,10 m', 'neutral'],
      // Zwei Pegel am selben Gewässer bleiben unterscheidbar.
      ['pegelprognose', 'Erwarteter Höchststand Pegel STATION 5 (WESER): 7,10 m', 'neutral'],
    ]);
    expect(r.marken[0]).toMatchObject({ id: 1, wort: 'in 20 min' });
    expect(r.marken.some((m) => m.ton === 'alarm')).toBe(false);
  });

  it('ohne Pegel-Argument dieselben Marken wie vorher', () => {
    const auftraege = [auftrag({ id: 101, auftrag_text: 'Frist', frist_at: nach(45) })];
    expect(naechsteMarken(auftraege, [], nach(120), JETZT)).toEqual(
      naechsteMarken(auftraege, [], nach(120), JETZT, []),
    );
  });

  it('deckelt auf sechs und zählt den Rest', () => {
    const viele = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => auftrag({ frist_at: nach(i * 10) }));
    const r = naechsteMarken(viele, [], null, JETZT);
    expect(r.marken).toHaveLength(6);
    expect(r.weitere).toBe(2);
  });
});

describe('abschnittZeilen', () => {
  const abschnitte = [
    abschnitt(1, 'Nord', { leiter_name: 'Vitt', sortier: 2 }),
    abschnitt(2, 'Süd', { sortier: 1 }),
    abschnitt(3, 'Nord-Deich', { ueber_abschnitt_id: 1 }),
  ];
  const einheiten = [
    einheit(10, 1, null, 'gebunden'),
    einheit(11, null, 10, 'verfuegbar'),
    einheit(12, 3, null, 'nicht_verfuegbar'),
    einheit(20, 2),
    einheit(30, null),
  ];
  const personalListe = [
    personal(1, 10, 'fuehrer', 'verfuegbar'),
    personal(2, 11, 'mannschaft', 'gebunden'),
    personal(3, 12, 'mannschaft', 'nicht_verfuegbar'),
    personal(4, 20, 'unterfuehrer', null),
    personal(5, 30, 'mannschaft', 'verfuegbar'),
  ];
  const fahrzeuge = [fahrzeug(1, 10, 'gebunden'), fahrzeug(2, 12, 'nicht_verfuegbar')];

  const zeilen = abschnittZeilen({
    abschnitte,
    einheiten,
    personal: personalListe,
    fahrzeuge,
    material: [],
    auftraege: [
      auftrag({
        auftrag_text: 'alt an Nord',
        erteilt_at: vor(90),
        empfaenger: [empfaenger({ abschnitt_id: 1 })],
      }),
      auftrag({
        auftrag_text: 'neu an Nord-Deich',
        erteilt_at: vor(5),
        empfaenger: [empfaenger({ abschnitt_id: 3 })],
      }),
      auftrag({
        auftrag_text: 'erledigt an Nord',
        bearbeitungsstatus: 'vollzogen',
        empfaenger: [empfaenger({ abschnitt_id: 1 })],
      }),
      auftrag({ auftrag_text: 'an Süd', empfaenger: [empfaenger({ abschnitt_id: 2 })] }),
    ],
  });

  it('eine Zeile je oberstem Abschnitt in gepflegter Folge, „Ohne Abschnitt" am Ende', () => {
    expect(zeilen.map((z) => z.name)).toEqual(['Süd', 'Nord', 'Ohne Abschnitt']);
    expect(zeilen.map((z) => z.abschnittId)).toEqual([2, 1, null]);
  });

  it('kumuliert Einheiten, Stärke und Einheitenstatus über Unterabschnitte und Untereinheiten', () => {
    const nord = zeilen.find((z) => z.abschnittId === 1)!;
    expect(nord.leiter).toBe('Vitt');
    expect(nord.einheiten).toBe(3);
    expect(nord.unterabschnitte).toBe(1);
    expect(nord.staerkeText).toBe('1/0/2//3');
    // LFH-609: gezählt werden EINHEITEN nach der Kategorie ihres Status (auch „gemischt"
    // mit gemeinsamer Kategorie), nicht mehr die Mittel — die Fahrzeuge und das Personal
    // oben ergäben 1/2/2.
    expect(nord.einheitenStatus).toEqual({ bereit: 1, gebunden: 1, ausfall: 1, ohne: 0 });
    const sued = zeilen.find((z) => z.abschnittId === 2)!;
    expect(sued.einheitenStatus).toEqual({ bereit: 0, gebunden: 0, ausfall: 0, ohne: 1 });
    const ohne = zeilen.find((z) => z.abschnittId === null)!;
    expect(ohne.einheitenStatus).toEqual({ bereit: 0, gebunden: 0, ausfall: 0, ohne: 1 });
  });

  it('Summe der Zeilen ist die Einsatzsumme', () => {
    expect(zeilen.reduce((s, z) => s + z.einheiten, 0)).toBe(einheiten.length);
    expect(zeilen.reduce((s, z) => s + z.staerke.gesamt, 0)).toBe(personalListe.length);
  });

  it('Aufträge an den Teilbaum, nur offene, jüngste zuerst', () => {
    const nord = zeilen.find((z) => z.abschnittId === 1)!;
    expect(nord.auftraege.map((a) => a.auftrag_text)).toEqual(['neu an Nord-Deich', 'alt an Nord']);
    expect(zeilen.find((z) => z.abschnittId == null)!.auftraege).toEqual([]);
  });

  describe('letzte Rückmeldung (LFH-610)', () => {
    const rueck = (
      bezug_id: number,
      meldung_id: number,
      minutenVor: number,
      inhalt: string,
    ): LetzteRueckmeldung => ({
      bezug_id,
      meldung_id,
      lfd_nr: meldung_id,
      ereigniszeit: vor(minutenVor),
      inhalt,
      meldeweg: 'funk',
      faellig_at: nach(30),
    });
    const mit = (einheitenR: LetzteRueckmeldung[], abschnitteR: LetzteRueckmeldung[]) =>
      abschnittZeilen({
        abschnitte,
        einheiten,
        personal: personalListe,
        fahrzeuge,
        material: [],
        auftraege: [],
        rueckmeldungen: { frist_min: 60, einheiten: einheitenR, abschnitte: abschnitteR },
      });

    it('ohne geladene Rückmeldungen unbekannt — kein erfundenes „keine"', () => {
      for (const z of zeilen) {
        expect(z.rueckmeldungBekannt).toBe(false);
        expect(z.letzteRueckmeldung).toBeNull();
      }
    });

    it('jüngste im Teilbaum: Untereinheit und Unterabschnitt zählen mit', () => {
      const z = mit(
        [
          rueck(10, 1, 50, 'Zug 1 alt'),
          rueck(11, 2, 5, 'Untereinheit jung'),
          rueck(20, 3, 1, 'Süd'),
        ],
        [rueck(3, 4, 20, 'Nord-Deich direkt')],
      );
      const nord = z.find((x) => x.abschnittId === 1)!;
      expect(nord.rueckmeldungBekannt).toBe(true);
      expect(nord.letzteRueckmeldung?.inhalt).toBe('Untereinheit jung');
      expect(z.find((x) => x.abschnittId === 2)!.letzteRueckmeldung?.inhalt).toBe('Süd');
    });

    it('direkt an einen Unterabschnitt gebunden schlägt ältere Einheitsmeldungen', () => {
      const z = mit([rueck(10, 1, 50, 'Zug 1 alt')], [rueck(3, 4, 20, 'Nord-Deich direkt')]);
      expect(z.find((x) => x.abschnittId === 1)!.letzteRueckmeldung?.inhalt).toBe(
        'Nord-Deich direkt',
      );
    });

    it('„Ohne Abschnitt" liest nur die eigenen Einheiten, keine fremden Abschnitte', () => {
      const z = mit([rueck(30, 1, 10, 'ohne Abschnitt')], [rueck(1, 2, 1, 'Nord direkt')]);
      const ohne = z.find((x) => x.abschnittId == null)!;
      expect(ohne.letzteRueckmeldung?.inhalt).toBe('ohne Abschnitt');
      expect(z.find((x) => x.abschnittId === 1)!.letzteRueckmeldung?.inhalt).toBe('Nord direkt');
    });

    it('geladen, aber nichts im Teilbaum: bekannt und `null`', () => {
      const z = mit([rueck(10, 1, 5, 'nur Nord')], []);
      const sued = z.find((x) => x.abschnittId === 2)!;
      expect(sued.rueckmeldungBekannt).toBe(true);
      expect(sued.letzteRueckmeldung).toBeNull();
    });
  });
  it('zählt die Auftragsbilanz über den Teilbaum, jeden Auftrag einmal (LFH-608)', () => {
    const nord = zeilen.find((z) => z.abschnittId === 1)!;
    // drei Aufträge an Nord/Nord-Deich, einer davon vollzogen
    expect(nord.auftragsbilanz).toEqual({ erledigt: 1, gesamt: 3 });
    expect(zeilen.find((z) => z.abschnittId === 2)!.auftragsbilanz).toEqual({
      erledigt: 0,
      gesamt: 1,
    });
    expect(zeilen.find((z) => z.abschnittId == null)!.auftragsbilanz).toEqual({
      erledigt: 0,
      gesamt: 0,
    });
  });
});

describe('abschnittZeilen — Lage je Abschnitt (LFH-608)', () => {
  const roh = (abschnitte: Einsatzabschnitt[], auftraege: Auftrag[] = []) =>
    abschnittZeilen({
      abschnitte,
      einheiten: [],
      personal: [],
      fahrzeuge: [],
      material: [],
      auftraege,
    });

  it('übernimmt Kürzel, Lagezustand, festen Auftrag und Fortschritt des Abschnitts', () => {
    const [nord] = roh([
      abschnitt(1, 'Nord', {
        kurzbezeichnung: 'EA-N',
        lagezustand: 'angespannt',
        abschnittsauftrag: 'Deichsicherung km 3,8 – 5,4',
        fortschritt: 72,
      }),
    ]);
    expect(nord.kurzbezeichnung).toBe('EA-N');
    expect(nord.lagezustand).toBe('angespannt');
    expect(nord.abschnittsauftrag).toBe('Deichsicherung km 3,8 – 5,4');
    expect(nord.fortschritt).toBe(72);
  });

  it('nicht gepflegt bleibt null — kein erfundenes „planmäßig" und keine 0 %', () => {
    const [nord] = roh([abschnitt(1, 'Nord')]);
    expect(nord.kurzbezeichnung).toBeNull();
    expect(nord.lagezustand).toBeNull();
    expect(nord.abschnittsauftrag).toBeNull();
    expect(nord.fortschritt).toBeNull();
    expect(nord.unterLage).toBeNull();
  });

  it('meldet einen SCHLECHTER beurteilten Unterabschnitt, sonst nichts', () => {
    const zeilen = roh([
      abschnitt(1, 'Nord', { lagezustand: 'planmaessig' }),
      abschnitt(2, 'Nord-Deich', { ueber_abschnitt_id: 1, lagezustand: 'angespannt' }),
      abschnitt(3, 'Nord-Deich-Spitze', { ueber_abschnitt_id: 2, lagezustand: 'kritisch' }),
      abschnitt(4, 'Süd', { lagezustand: 'kritisch' }),
      abschnitt(5, 'Süd-West', { ueber_abschnitt_id: 4, lagezustand: 'angespannt' }),
      abschnitt(6, 'Ost'),
      abschnitt(7, 'Ost-UA', { ueber_abschnitt_id: 6, lagezustand: 'planmaessig' }),
    ]);
    const nach = (id: number) => zeilen.find((z) => z.abschnittId === id)!;
    // der schlechteste im ganzen Teilbaum, auch zwei Ebenen tief
    expect(nach(1).unterLage).toBe('kritisch');
    // ein besserer Unterabschnitt ist keine Meldung
    expect(nach(4).unterLage).toBeNull();
    // ohne eigene Beurteilung ist jede Beurteilung darunter eine Aussage
    expect(nach(6).unterLage).toBe('planmaessig');
  });
});
