import { describe, expect, it } from 'vitest';
import type {
  Betreuungsstelle,
  Einheit,
  Einsatzabschnitt,
  EinsatzFahrzeug,
  Schaden,
  Uhs,
} from '../../api/types';
import { farbenDunkel } from '../../theme/tokens';
import type { KarteMarker } from './marker';
import type { LayerSichtbar } from './Sidebar';
import {
  EBENEN,
  LEERE_ROHDATEN,
  auswahlRaster,
  auswahlUnterzeile,
  ebenenFarbe,
  ebenenZeilen,
  grundlageAufloesen,
  grundlageOptionen,
  grundlageWert,
  letzteMeldungBlock,
  staerkeText,
  verortetAnzahl,
  type AuswahlRoh,
} from './leistenDaten';

const ALLE_AN: LayerSichtbar = {
  einsatzort: true,
  uhs: true,
  schaden: true,
  einheit: true,
  fahrzeug: true,
  fuehrung: true,
  abschnitt: true,
  zone: true,
  lagemeldung: true,
  freies_zeichen: true,
  person: true,
  betreuungsstelle: true,
};

const marker = (typ: KarteMarker['typ'], id = 1, label = 'X'): KarteMarker => ({
  schluessel: `${typ}-${id}`,
  typ,
  id,
  lat: 50,
  lon: 8,
  label,
  farbe: farbenDunkel.bedien,
});

describe('ebenenZeilen', () => {
  it('führt dieselben zwölf Schalter wie die Ebenen der Karte, jeden genau einmal', () => {
    const keys = EBENEN.map((e) => e.key).sort();
    expect(keys).toEqual((Object.keys(ALLE_AN) as (keyof LayerSichtbar)[]).sort());
  });

  it('zählt je Ebene die verorteten Marker ihres Typs', () => {
    const zeilen = ebenenZeilen(
      [marker('einheit', 1), marker('einheit', 2), marker('uhs', 3), marker('abschnitt', 4)],
      0,
      ALLE_AN,
      false,
    );
    const anzahl = Object.fromEntries(zeilen.map((z) => [z.key, z.anzahl]));
    expect(anzahl.einheit).toBe(2);
    expect(anzahl.uhs).toBe(1);
    expect(anzahl.abschnitt).toBe(1);
    expect(anzahl.fahrzeug).toBe(0);
  });

  it('zählt Zonen aus der ungegatterten Liste — auch bei abgeschalteter Ebene', () => {
    // `zonenFeatures` wäre bei `layer.zone = false` leer; die Zeile zeigte dann „0" für
    // Zonen, die es gibt. Deshalb kommt die Zahl von außen, nicht aus den Markern.
    const zeilen = ebenenZeilen([], 3, { ...ALLE_AN, zone: false }, false);
    const zone = zeilen.find((z) => z.key === 'zone')!;
    expect(zone.anzahl).toBe(3);
    expect(zone.sichtbar).toBe(false);
  });

  it('zeigt im Fehlerfall „—" statt einer Null, die niemand geprüft hat', () => {
    const zeilen = ebenenZeilen([marker('uhs')], 2, ALLE_AN, true);
    expect(zeilen.every((z) => z.anzahl === '—')).toBe(true);
  });

  // Ebene „Betroffene" (LFH-648): die Zeile folgt dem ZUGRIFF, nicht bloß dem Schalter.
  it('„Betroffene" ohne Personenangabe: keine Zeile (Vorgabe „ausgeblendet")', () => {
    const zeilen = ebenenZeilen([], 0, ALLE_AN, false);
    expect(zeilen.map((z) => z.key)).not.toContain('person');
    expect(zeilen).toHaveLength(10);
  });

  it('„Betroffene" frei: Zeile mit der Zahl der übergebenen Personen-Marker, Schaltzustand vom Schalter', () => {
    const zeilen = ebenenZeilen([], 0, { ...ALLE_AN, person: false }, false, {
      zugriff: 'frei',
      anzahl: 3,
    });
    const person = zeilen.find((z) => z.key === 'person')!;
    expect(person).toMatchObject({ name: 'Betroffene', anzahl: 3, sichtbar: false });
    expect(person.sperrgrund).toBeUndefined();
    expect(zeilen).toHaveLength(11);
  });

  it('„Betroffene" gesperrt: Zeile mit Grund und OHNE Zahl — auch bei eingeschaltetem Schalter', () => {
    const zeilen = ebenenZeilen([], 0, ALLE_AN, false, { zugriff: 'gesperrt', anzahl: 5 });
    const person = zeilen.find((z) => z.key === 'person')!;
    expect(person.sperrgrund).toBe('Keine Berechtigung');
    expect(person.anzahl).toBeNull();
    // Nie „an": eine gesperrte Ebene zeichnet nichts, egal was die geteilte Ansicht sagt.
    expect(person.sichtbar).toBe(false);
  });

  it('„Betroffene" im Rückblick: Grund statt einer „0", die niemand gesichert hat', () => {
    const zeilen = ebenenZeilen([], 0, ALLE_AN, false, { zugriff: 'rueckblick', anzahl: 0 });
    const person = zeilen.find((z) => z.key === 'person')!;
    expect(person.sperrgrund).toBe('Nicht in gesicherten Lageständen');
    expect(person.anzahl).toBeNull();
  });

  it('„Betroffene" frei, aber die Personenliste scheiterte: „—" an dieser Zeile, die übrigen zählen', () => {
    const zeilen = ebenenZeilen([marker('uhs')], 0, ALLE_AN, false, {
      zugriff: 'frei',
      anzahl: 0,
      fehler: true,
    });
    expect(zeilen.find((z) => z.key === 'person')!.anzahl).toBe('—');
    expect(zeilen.find((z) => z.key === 'uhs')!.anzahl).toBe(1);
  });

  it('„Betroffene" ausgeblendet: keine Zeile', () => {
    const zeilen = ebenenZeilen([], 0, ALLE_AN, false, { zugriff: 'ausgeblendet', anzahl: 0 });
    expect(zeilen.map((z) => z.key)).not.toContain('person');
  });

  // Ebene „Betreuungsstellen" (LFH-673): dieselbe Zugriffsregel, die Zahl aus den Markern.
  it('„Betreuungsstellen" ohne Angabe: keine Zeile (Vorgabe „ausgeblendet")', () => {
    const zeilen = ebenenZeilen([marker('betreuungsstelle')], 0, ALLE_AN, false);
    expect(zeilen.map((z) => z.key)).not.toContain('betreuungsstelle');
  });

  it('„Betreuungsstellen" frei: Zeile neben der UHS, gezählt aus den verorteten Markern', () => {
    const zeilen = ebenenZeilen(
      [marker('betreuungsstelle', 1), marker('betreuungsstelle', 2)],
      0,
      ALLE_AN,
      false,
      undefined,
      { zugriff: 'frei' },
    );
    const i = zeilen.findIndex((z) => z.key === 'betreuungsstelle');
    expect(zeilen[i]).toMatchObject({ name: 'Betreuungsstellen', anzahl: 2, sichtbar: true });
    expect(zeilen[i - 1].key).toBe('uhs');
  });

  it('„Betreuungsstellen" gesperrt: Grund, keine Zahl, nie „an"', () => {
    const zeilen = ebenenZeilen([], 0, ALLE_AN, false, undefined, { zugriff: 'gesperrt' });
    const z = zeilen.find((x) => x.key === 'betreuungsstelle')!;
    expect(z).toMatchObject({ anzahl: null, sichtbar: false, sperrgrund: 'Keine Berechtigung' });
  });

  it('trägt den Schaltzustand je Ebene', () => {
    const zeilen = ebenenZeilen([], 0, { ...ALLE_AN, schaden: false }, false);
    expect(zeilen.find((z) => z.key === 'schaden')!.sichtbar).toBe(false);
    expect(zeilen.find((z) => z.key === 'uhs')!.sichtbar).toBe(true);
  });
});

describe('ebenenFarbe', () => {
  it('nimmt die Rollen der Karte, wo die Karte eine Rolle zeichnet', () => {
    expect(ebenenFarbe('einsatzort', farbenDunkel)).toBe(farbenDunkel.marke);
    expect(ebenenFarbe('uhs', farbenDunkel)).toBe(farbenDunkel.bedien);
    expect(ebenenFarbe('zone', farbenDunkel)).toBe(farbenDunkel.alarm);
  });

  it('„Betroffene" trägt kein Bedien-Blau: die Marker zeichnen Sichtungsfarben, die Zeile bleibt neutral', () => {
    // Blau bedient (LFH-352) — und das Farbfeld einer Zeile kann fünf Sichtungsfarben nicht
    // erklären; das tut die Sichtungslegende (LFH-648).
    expect(ebenenFarbe('person', farbenDunkel)).not.toBe(farbenDunkel.bedien);
    expect(ebenenFarbe('person', farbenDunkel)).toBe(farbenDunkel.text2);
  });
});

describe('verortetAnzahl', () => {
  it('zählt Objekte, nicht den Einsatzort-Anker', () => {
    expect(verortetAnzahl([marker('einsatzort', 0), marker('uhs'), marker('einheit')])).toBe(2);
  });
});

const EINHEIT = {
  id: 1,
  name: 'Zug 1',
  typ_label: 'Zug',
  ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 9 },
  abschnitt_id: 4,
  abschnitt_name: 'Nord',
  fuehrer_name: 'Meier',
  status: {
    quelle: 'fahrzeuge',
    status: {
      status_id: 4,
      label: '4 – Am Einsatzort',
      kategorie: 'gebunden',
      fms_anker: 4,
      sortier: 40,
    },
    kategorie: 'gebunden',
    seit: '2026-09-21 09:12:00',
    verteilung: [],
  },
} as unknown as Einheit;

const FAHRZEUG = {
  id: 7,
  funkrufname: 'Florian 1',
  fahrzeugtyp: 'HLF 20',
  status_label: 'am Einsatzort',
  status_kategorie: 'gebunden',
  disponiert_at: '2026-09-21 09:12:00',
  einheit_id: 1,
  kennzeichen: null,
} as unknown as EinsatzFahrzeug;

const ROH: AuswahlRoh = {
  ...LEERE_ROHDATEN,
  einheiten: [EINHEIT],
  fahrzeuge: [FAHRZEUG],
  uhs: [{ id: 3, typ: 'bhp', status: 'aktiv', abschnitt_id: 4 } as unknown as Uhs],
  schaeden: [{ id: 9, status: 'offen', ausmass: 'gross' } as unknown as Schaden],
  abschnitte: [{ id: 4, name: 'Nord', leiter_name: 'Schulz' } as unknown as Einsatzabschnitt],
};

const zeit = (s: string | null | undefined) => `Z(${s})`;

const STELLE = {
  id: 7,
  art: 'notunterkunft',
  status: 'in_betrieb',
  abschnitt_id: 4,
  kapazitaet_personen: 150,
  belegung: { id: 1, belegt: 140, zeitpunkt_at: '2026-09-24 10:00:00' },
} as unknown as Betreuungsstelle;

describe('auswahlRaster — Betreuungsstelle (LFH-673)', () => {
  const roh: AuswahlRoh = { ...ROH, betreuungsstellen: [STELLE] };
  it('Status, Belegung „belegt / Kapazität" mit Auslastung, Abschnitt', () => {
    const raster = auswahlRaster(marker('betreuungsstelle', 7), roh, zeit);
    expect(raster.map((f) => [f.label, f.wert])).toEqual([
      ['Status', 'in Betrieb'],
      ['Belegung', '140 / 150'],
      ['Abschnitt', 'Nord'],
    ]);
    expect(raster[0].rolle).toBe('normal');
    expect(raster[1].rolle).toBe('achtung'); // ≥ 90 % „fast voll"
  });
  it('ohne Meldung „—" statt 0, ohne Kapazität nur die Zahl', () => {
    const ohne = { ...STELLE, belegung: undefined } as Betreuungsstelle;
    expect(
      auswahlRaster(marker('betreuungsstelle', 7), { ...roh, betreuungsstellen: [ohne] }, zeit)[1]
        .wert,
    ).toBe('—');
    const ohneKap = { ...STELLE, kapazitaet_personen: undefined } as Betreuungsstelle;
    const f = auswahlRaster(
      marker('betreuungsstelle', 7),
      { ...roh, betreuungsstellen: [ohneKap] },
      zeit,
    )[1];
    expect(f.wert).toBe('140');
    expect(f.rolle).toBeUndefined();
  });
  it('Unterzeile nennt die Einrichtungsstufe', () => {
    expect(auswahlUnterzeile(marker('betreuungsstelle', 7), roh)).toBe(
      'Betreuungsstelle · Notunterkunft',
    );
  });
});

describe('auswahlRaster', () => {
  it('Einheit: Stärke in BOS-Schreibweise, Status mit Code, Seit, Abschnitt, Führer (LFH-609)', () => {
    const raster = auswahlRaster(marker('einheit', 1), ROH, zeit);
    expect(raster.map((f) => [f.label, f.wert])).toEqual([
      ['Stärke', '1/2/9//12'],
      ['Status', 'S4 · Am Einsatzort'],
      ['Seit', 'Z(2026-09-21 09:12:00)'],
      ['Abschnitt', 'Nord'],
      ['Führer', 'Meier'],
    ]);
    expect(raster[1].rolle).toBe('achtung');
  });

  it('Einheit gemischt: kein erfundener Status, Verteilung im Wert, „Seit" bleibt leer', () => {
    const gemischt = {
      ...EINHEIT,
      status: {
        quelle: 'gemischt',
        kategorie: 'gebunden',
        verteilung: [
          {
            status: {
              status_id: 3,
              label: '3 – Auf Anfahrt',
              kategorie: 'gebunden',
              fms_anker: 3,
              sortier: 30,
            },
            anzahl: 1,
          },
          {
            status: {
              status_id: 4,
              label: '4 – Am Einsatzort',
              kategorie: 'gebunden',
              fms_anker: 4,
              sortier: 40,
            },
            anzahl: 2,
          },
        ],
      },
    } as unknown as Einheit;
    const raster = auswahlRaster(marker('einheit', 1), { ...ROH, einheiten: [gemischt] }, zeit);
    expect(raster.find((f) => f.label === 'Status')?.wert).toBe('gemischt (1× S3 · 2× S4)');
    expect(raster.find((f) => f.label === 'Seit')?.wert).toBe('—');
  });

  it('Fahrzeug: Status mit Rolle aus der Statuskategorie, Seit, Disponiert-Zeit, Einheit', () => {
    const mitSeit = { ...FAHRZEUG, status_seit: '2026-09-21 10:05:00' } as EinsatzFahrzeug;
    const raster = auswahlRaster(marker('fahrzeug', 7), { ...ROH, fahrzeuge: [mitSeit] }, zeit);
    expect(raster[0]).toMatchObject({ label: 'Status', wert: 'am Einsatzort', rolle: 'achtung' });
    expect(raster[1]).toEqual({ label: 'Seit', wert: 'Z(2026-09-21 10:05:00)' });
    expect(raster[2]).toEqual({ label: 'Disponiert', wert: 'Z(2026-09-21 09:12:00)' });
    expect(raster[3]).toMatchObject({ label: 'Einheit', wert: 'Zug 1' });
  });

  it('Fahrzeug ohne bekannten Wechselzeitpunkt: „Seit" ist „—", nicht die Dispozeit', () => {
    const raster = auswahlRaster(marker('fahrzeug', 7), ROH, zeit);
    expect(raster.find((f) => f.label === 'Seit')?.wert).toBe('—');
  });

  it('UHS: Abschnittsname über die Abschnittsliste', () => {
    const raster = auswahlRaster(marker('uhs', 3), ROH, zeit);
    expect(raster.find((f) => f.label === 'Abschnitt')?.wert).toBe('Nord');
  });

  it('Abschnitt: Leiter und Zahl der zugeordneten Einheiten', () => {
    const raster = auswahlRaster(marker('abschnitt', 4), ROH, zeit);
    expect(raster.map((f) => [f.label, f.wert])).toEqual([
      ['Leiter', 'Schulz'],
      ['Einheiten', '1'],
    ]);
  });

  it('ohne Rohdatensatz kein Raster — nichts wird erfunden', () => {
    expect(auswahlRaster(marker('einheit', 99), ROH, zeit)).toEqual([]);
    expect(auswahlRaster(marker('einsatzort', 0), ROH, zeit)).toEqual([]);
  });

  it('zeigt „—" für leere Angaben statt eines leeren Feldes', () => {
    const ohne = { ...EINHEIT, abschnitt_name: null, fuehrer_name: '  ' } as unknown as Einheit;
    const raster = auswahlRaster(marker('einheit', 1), { ...ROH, einheiten: [ohne] }, zeit);
    expect(raster.find((f) => f.label === 'Abschnitt')?.wert).toBe('—');
    expect(raster.find((f) => f.label === 'Führer')?.wert).toBe('—');
  });
});

describe('letzteMeldungBlock (LFH-610)', () => {
  const rueck = (bezug_id: number, inhalt: string, meldeweg: 'funk' | 'telefon' = 'funk') => ({
    bezug_id,
    meldung_id: bezug_id * 10,
    lfd_nr: 3,
    ereigniszeit: '2026-09-21 14:11:00',
    inhalt,
    meldeweg,
    faellig_at: '2026-09-21 15:11:00',
  });
  const MIT: AuswahlRoh = {
    ...ROH,
    rueckmeldungen: {
      frist_min: 60,
      einheiten: [rueck(1, 'Sandsackverbau hält.'), rueck(2, 'andere', 'telefon')],
      abschnitte: [rueck(4, 'direkt an Nord')],
    },
  };

  it('Einheit: Wortlaut und Meta-Zeile „Zeit · Meldeweg"', () => {
    expect(letzteMeldungBlock(marker('einheit', 1), MIT, zeit)).toEqual({
      text: 'Sandsackverbau hält.',
      meta: 'Z(2026-09-21 14:11:00) · Funk',
    });
    expect(letzteMeldungBlock(marker('einheit', 2), MIT, zeit)?.meta).toMatch(/· Telefon$/);
  });

  it('kein Block, wenn die Rückmeldungen nicht vorliegen (lädt, 403, Historie)', () => {
    expect(letzteMeldungBlock(marker('einheit', 1), ROH, zeit)).toBeNull();
    expect(letzteMeldungBlock(marker('einheit', 1), LEERE_ROHDATEN, zeit)).toBeNull();
  });

  it('kein Block für eine Einheit ohne Meldung — nichts erfunden', () => {
    expect(letzteMeldungBlock(marker('einheit', 99), MIT, zeit)).toBeNull();
  });

  it('nur Einheiten: ein Abschnitt mit gleicher id liest nicht die Einheitsliste', () => {
    // Einheit-id 4 gibt es nicht, Abschnitt 4 hat eine Meldung — der Abschnittsmarker bleibt leer,
    // und eine Einheit mit der id eines Abschnitts träfe nie dessen Meldung.
    expect(letzteMeldungBlock(marker('abschnitt', 4), MIT, zeit)).toBeNull();
    expect(letzteMeldungBlock(marker('fahrzeug', 1), MIT, zeit)).toBeNull();
    expect(letzteMeldungBlock(marker('einheit', 4), MIT, zeit)).toBeNull();
  });
});

describe('auswahlUnterzeile', () => {
  it('Objektart plus Typ, wo die Daten ihn tragen', () => {
    expect(auswahlUnterzeile(marker('einheit', 1), ROH)).toBe('Einheit · Zug');
    expect(auswahlUnterzeile(marker('fahrzeug', 7), ROH)).toBe('Fahrzeug · HLF 20');
    expect(auswahlUnterzeile(marker('fuehrung', 5), ROH)).toBe('Personal');
  });
});

describe('staerkeText', () => {
  it('schreibt F/UF/M//Σ und „—" ohne Angabe', () => {
    expect(staerkeText({ fuehrer: 0, unterfuehrer: 1, mannschaft: 3 })).toBe('0/1/3//4');
    expect(staerkeText(null)).toBe('—');
  });
});

describe('Kartengrundlage', () => {
  const STILE = [
    { name: 'Liberty', url: 'x', typ: 'vektor', attribution: null },
    { name: 'TopPlus', url: 'y', typ: 'raster', attribution: null },
    { name: 'Satellit (Esri)', url: 'z', typ: 'raster', attribution: null },
  ] as never[];

  it('ein Segment je Online-Stil, dazu Offline und Blind — Satellit ist ein Stil (LFH-616)', () => {
    const optionen = grundlageOptionen(STILE, true);
    expect(optionen.map((o) => o.label)).toEqual([
      'Liberty',
      'TopPlus',
      'Satellit (Esri)',
      'Offline',
      'Blind',
    ]);
    expect(optionen.every((o) => o.gesperrt == null)).toBe(true);
  });

  it('sperrt, was nicht konfiguriert ist, statt es wegzulassen', () => {
    const optionen = grundlageOptionen([], false);
    expect(optionen.map((o) => [o.label, o.gesperrt != null])).toEqual([
      ['Online', true],
      ['Offline', true],
      ['Blind', false],
    ]);
  });

  it('bildet Modus und Stil hin und zurück ab', () => {
    expect(grundlageWert('online', 'TopPlus', STILE)).toBe('online:TopPlus');
    expect(grundlageWert('online', null, STILE)).toBe('online:Liberty');
    expect(grundlageWert('offline', 'TopPlus', STILE)).toBe('offline');
    expect(grundlageAufloesen('online:TopPlus')).toEqual({
      basemap: 'online',
      stilName: 'TopPlus',
    });
    expect(grundlageAufloesen('blind')).toEqual({ basemap: 'blind', stilName: null });
    expect(grundlageAufloesen('offline')).toEqual({ basemap: 'offline', stilName: null });
  });
});
