import { describe, expect, it } from 'vitest';
import {
  personDruckPfad,
  personenDruckPfad,
  parsePersonenDruckAuswahl,
  tiereDruckPfad,
  parseTiereDruckAuswahl,
  schaedenDruckPfad,
  parseSchaedenDruckAuswahl,
  einsaetzePfad,
  einsatzPfad,
  einsatzModulPfad,
  uhsDetailPfad,
  unfallhilfsstellenListePfad,
  bereitstellungsraumDetailPfad,
  bereitstellungsraeumePfad,
  bereitstellungsraeumeListePfad,
  lageberichtDetailPfad,
  lageberichtePfad,
  befehlDetailPfad,
  auftragDruckPfad,
  personDetailPfad,
  tiereDetailPfad,
  schadenDetailPfad,
  tierePfad,
  parseKartenzentrum,
  parsePlatzierenAuftrag,
  parseZurueck,
  rueckwegPfad,
  parseZeichnenAuftrag,
  parseKreisVorbelegung,
  parseZeichnenBezug,
  personenAufnahmePfad,
  personenPfad,
  schaedenPfad,
  lagebesprechungPfad,
  stabPfad,
  funkplanPfad,
  kommunikationsplanPfad,
  infotelefonPfad,
  pressePfad,
  pressemitteilungPfad,
  dokumentePfad,
  abloesungPfad,
  betreuungPfad,
  betreuungsstellePfad,
  evakuierungPfad,
  evakuierungsbezirkPfad,
  verpflegungAusgabePfad,
  verpflegungAusVorlagePfad,
  parseVerpflegungTag,
  parseVerpflegungStelle,
  geraetVerpflegungAusgabePfad,
  verpflegungPfad,
  wetterPegelPfad,
  pegelZielPfad,
  etbPfad,
  etbDruckPfad,
  einsatzberichtPfad,
  parseEtbFilter,
  parsePersonenSicht,
  parseBerichtAuswahl,
  personalPfad,
  einsatzkraftPfad,
  einheitenPfad,
  einheitAusVorlagePfad,
  einheitDetailPfad,
  fahrzeugePfad,
  parseFahrzeugeAnsicht,
  einsatzabschnittePfad,
  parseAbschnitteAnsicht,
  parseFunkplanAnsicht,
  meldungenPfad,
  chatPfad,
  nachforderungenPfad,
  parseNachforderungBezug,
  parseNachforderungStelle,
  parseNachforderungVorbelegung,
  auftraegePfad,
  parseAuftraegeReiter,
  parseUhsBereich,
  uhsBereichSuche,
  gefahrenPfad,
  lagekartePfad,
  einsatzdatenPfad,
  einsatzEinstellungenPfad,
  EINSTELLUNGEN_SEKTIONEN,
  koppelnAdresse,
  erinnerungenPfad,
  kraefteuebersichtPfad,
  materialPfad,
  parseRouteId,
  ueberblickPfad,
  parseMeldungInhalt,
  hilfePfad,
  parseHilfeGruppe,
} from './deeplinks';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { STANDARDUMFANG } from '../druck/einsatzbericht/auswahl';

const E = 5; // einsatzId

describe('deeplinks — Basis', () => {
  it('einsaetzePfad baut die zentrale Einsatzliste', () => {
    expect(einsaetzePfad()).toBe('/einsaetze');
  });

  it('einsatzPfad baut den zentralen Einsatz-Workspace', () => {
    expect(einsatzPfad(7)).toBe('/einsaetze/7');
  });

  it('einsatzModulPfad baut /einsaetze/<id>/<modul>', () => {
    expect(einsatzModulPfad(E, 'etb')).toBe('/einsaetze/5/etb');
  });
});

describe('deeplinks — Item-Routes (Vollseiten-Detail)', () => {
  it('uhsDetailPfad', () => {
    expect(uhsDetailPfad(E, 9)).toBe('/einsaetze/5/unfallhilfsstellen/9');
  });
  it('bereitstellungsraumDetailPfad', () => {
    expect(bereitstellungsraumDetailPfad(E, 3)).toBe('/einsaetze/5/bereitstellungsraeume/3');
  });
  it('lageberichtDetailPfad', () => {
    expect(lageberichtDetailPfad(E, 7)).toBe('/einsaetze/5/lageberichte/7');
  });
  it('befehlDetailPfad nutzt die sprechende Route (auftraege/befehle/<id>)', () => {
    expect(befehlDetailPfad(E, 42)).toBe('/einsaetze/5/auftraege/befehle/42');
  });
  it('auftragDruckPfad: Druckansicht eines Auftrags unter auftraege/<id>/druck (LLH-1171)', () => {
    expect(auftragDruckPfad(E, 31)).toBe('/einsaetze/5/auftraege/31/druck');
  });
  it('personDruckPfad: Druckansicht einer Person unter personen/<id>/druck (LLH-1120)', () => {
    expect(personDruckPfad(E, 10)).toBe('/einsaetze/5/personen/10/druck');
  });
  it('personDetailPfad', () => {
    expect(personDetailPfad(E, 10)).toBe('/einsaetze/5/personen/10');
  });
  it('tiereDetailPfad', () => {
    expect(tiereDetailPfad(E, 10)).toBe('/einsaetze/5/tiere/10');
  });
  it('schadenDetailPfad', () => {
    expect(schadenDetailPfad(E, 8)).toBe('/einsaetze/5/schaeden/8');
  });
});

describe('deeplinks — Listen-Routes (NaN-Redirect-Ziele)', () => {
  it('unfallhilfsstellenListePfad', () => {
    expect(unfallhilfsstellenListePfad(E)).toBe('/einsaetze/5/unfallhilfsstellen/liste');
  });
  /** Die Schnellerfassung der UHS-Liste: `UnfallhilfsstellenPage` liest `?neu=1`. */
  it('unfallhilfsstellenListePfad mit ?neu=1', () => {
    expect(unfallhilfsstellenListePfad(E, { neu: true })).toBe(
      '/einsaetze/5/unfallhilfsstellen/liste?neu=1',
    );
  });
  it('bereitstellungsraeumePfad', () => {
    expect(bereitstellungsraeumePfad(E)).toBe('/einsaetze/5/bereitstellungsraeume');
  });
  it('bereitstellungsraeumeListePfad', () => {
    expect(bereitstellungsraeumeListePfad(3)).toBe('/einsaetze/3/bereitstellungsraeume/liste');
  });
  /**
   * Die Schnellerfassung zeigt auf die LISTEN-Route (LFH-506): der bare Modulpfad trägt
   * `BereitstellungsraeumeDefault`, das `?neu=1` nicht liest — dieselbe Falle wie bei den UHS.
   */
  it('bereitstellungsraeumeListePfad mit ?neu=1 zeigt auf die Listen-Route', () => {
    expect(bereitstellungsraeumeListePfad(E, { neu: true })).toBe(
      '/einsaetze/5/bereitstellungsraeume/liste?neu=1',
    );
    expect(bereitstellungsraeumeListePfad(E, { neu: false })).toBe(
      '/einsaetze/5/bereitstellungsraeume/liste',
    );
  });
  it('lageberichtePfad', () => {
    expect(lageberichtePfad(E)).toBe('/einsaetze/5/lageberichte');
  });
  it('tierePfad (Liste / NaN-Redirect-Ziel)', () => {
    expect(tierePfad(E)).toBe('/einsaetze/5/tiere');
  });
  it('tierePfad mit ?neu=1', () => {
    expect(tierePfad(E, { neu: true })).toBe('/einsaetze/5/tiere?neu=1');
    expect(tierePfad(E, { neu: false })).toBe('/einsaetze/5/tiere');
  });
  it('erinnerungenPfad zeigt auf die Erinnerungen-Liste', () => {
    expect(erinnerungenPfad(7)).toBe('/einsaetze/7/erinnerungen');
  });
  /** Die aggregierende Kräfteübersicht. */
  it('materialPfad', () => {
    expect(materialPfad(7)).toBe('/einsaetze/7/material');
  });

  it('materialPfad mit ?material= steuert einen Posten an und übersteht den Round-Trip (LLH-1260)', () => {
    const pfad = materialPfad(E, { material: 12 });
    expect(pfad).toBe('/einsaetze/5/material?material=12');
    expect(parseRouteId(new URLSearchParams(pfad.split('?')[1]).get('material') ?? undefined)).toBe(
      12,
    );
  });

  it('kraefteuebersichtPfad', () => {
    expect(kraefteuebersichtPfad(E)).toBe('/einsaetze/5/kraefteuebersicht');
  });

  it('kraefteuebersichtPfad mit ?einheit= springt auf eine Einheit (LLH-1049)', () => {
    expect(kraefteuebersichtPfad(E, { einheit: 12 })).toBe(
      '/einsaetze/5/kraefteuebersicht?einheit=12',
    );
    expect(kraefteuebersichtPfad(E, {})).toBe('/einsaetze/5/kraefteuebersicht');
  });

  it('ueberblickPfad — Startseite des Einsatzes (Neuentwurf)', () => {
    expect(ueberblickPfad(E)).toBe('/einsaetze/5/ueberblick');
  });
});

describe('deeplinks — Listen mit Query-Selektion / Schnellerfassung', () => {
  it('personenPfad ohne Optionen', () => {
    expect(personenPfad(E)).toBe('/einsaetze/5/personen');
  });
  it('personenPfad mit ?person=', () => {
    expect(personenPfad(E, { person: 10 })).toBe('/einsaetze/5/personen?person=10');
  });
  it('personenPfad mit ?neu=1', () => {
    expect(personenPfad(E, { neu: true })).toBe('/einsaetze/5/personen?neu=1');
  });
  it('personenPfad mit Sichtvorgabe (LFH-620)', () => {
    expect(personenPfad(E, { filter: 'vermisst', ansicht: 'zeilen' })).toBe(
      '/einsaetze/5/personen?filter=vermisst&ansicht=zeilen',
    );
    expect(personenPfad(E, { ansicht: 'raster' })).toBe('/einsaetze/5/personen?ansicht=raster');
  });
  it('parsePersonenSicht liest zurück, was personenPfad geschrieben hat', () => {
    const pfad = personenPfad(E, { filter: 'verstorben', ansicht: 'raster' });
    expect(parsePersonenSicht(new URLSearchParams(pfad.split('?')[1]))).toEqual({
      filter: 'verstorben',
      ansicht: 'raster',
    });
  });
  it('parsePersonenSicht verwirft je Achse einen unbekannten Wert GANZ', () => {
    // „patienten" ist bewusst kein Filterwert: Patient ist eine Darstellung, kein Status.
    expect(parsePersonenSicht(new URLSearchParams('filter=patienten&ansicht=raster'))).toEqual({
      ansicht: 'raster',
    });
    expect(parsePersonenSicht(new URLSearchParams('filter=vermisst&ansicht=globus'))).toEqual({
      filter: 'vermisst',
    });
    expect(parsePersonenSicht(new URLSearchParams('ansicht=karte'))).toEqual({ ansicht: 'karte' });
    expect(parsePersonenSicht(new URLSearchParams(''))).toEqual({});
  });
  it('lagekartePfad mit Platzier-Auftrag', () => {
    /*
     * Der Doppelpunkt steht als `%3A` in der URL (`mitQuery` kodiert) — unschädlich, weil der
     * Aufrufer über `searchParams.get()` liest. Tragend ist der Round-Trip darunter.
     */
    expect(lagekartePfad(E, { platzieren: { typ: 'schaden', id: 7 } })).toBe(
      '/einsaetze/5/lagekarte?platzieren=schaden%3A7',
    );
  });
  it('der Platzier-Auftrag überlebt den Weg durch die URL', () => {
    const pfad = lagekartePfad(E, { platzieren: { typ: 'uhs', id: 3 } });
    const params = new URLSearchParams(pfad.split('?')[1]);
    expect(parsePlatzierenAuftrag(params.get('platzieren'))).toEqual({ typ: 'uhs', id: 3 });
  });
  it('lagekartePfad trägt einen Kartenmittelpunkt als ?zentrum=lat,lon (LFH-619)', () => {
    // Fünf Nachkommastellen ≙ rund 1 m — genauer als jede Angabe, die jemand abtippt,
    // und kurz genug, um als Link lesbar zu bleiben.
    const pfad = lagekartePfad(E, { zentrum: { lat: 52.520008, lon: 13.404954 } });
    expect(new URL(pfad, 'http://x').searchParams.get('zentrum')).toBe('52.52001,13.40495');
  });
  it('lagekartePfad trägt einen Suchtext als ?ort= und übersteht den Weg durch die URL (LFH-638)', () => {
    const text = 'Hauptstraße 12 & Ecke, Musterstadt';
    const pfad = lagekartePfad(E, { ort: text });
    expect(new URL(pfad, 'http://x').searchParams.get('ort')).toBe(text);
    // Ohne Text kein Parameter.
    expect(lagekartePfad(E, { ort: '' })).not.toContain('ort=');
  });
  it('lagekartePfad trägt den Abschnittsfokus als ?abschnitt= (LLH-1057)', () => {
    const pfad = lagekartePfad(E, { abschnitt: 12 });
    expect(pfad).toBe('/einsaetze/5/lagekarte?abschnitt=12');
    const wert = new URL(pfad, 'http://x').searchParams.get('abschnitt');
    expect(parseRouteId(wert ?? undefined)).toBe(12);
    // Ohne Abschnitt kein Parameter.
    expect(lagekartePfad(E)).not.toContain('abschnitt=');
  });
  it('der Kartenmittelpunkt überlebt den Weg durch die URL', () => {
    const pfad = lagekartePfad(E, { zentrum: { lat: -33.8688, lon: 151.2093 } });
    const wert = new URL(pfad, 'http://x').searchParams.get('zentrum');
    expect(parseKartenzentrum(wert)).toEqual({ lat: -33.8688, lon: 151.2093 });
  });
  it('parseKartenzentrum verwirft Unbrauchbares ganz statt halb zu füllen', () => {
    // Eine halbe Koordinate schickte die Karte auf den Nullmeridian.
    for (const w of [
      null,
      '',
      '52.5',
      '52.5,',
      ',13.4',
      'a,b',
      '52.5,13.4,7',
      '91,13',
      '52,181',
      '-91,0',
      'NaN,1',
      'Infinity,1',
      '52.5 13.4',
    ]) {
      expect(parseKartenzentrum(w), String(w)).toBeNull();
    }
    expect(parseKartenzentrum('0,0')).toEqual({ lat: 0, lon: 0 });
  });
  it('parseZeichnenAuftrag liest jeden Zonentyp, mit und ohne Form (LFH-825)', () => {
    for (const typ of [
      'gefahrengebiet',
      'absperrbereich',
      'absperrgrenze',
      'sperrgebiet',
      'freie_skizze',
      'evakuierungsbezirk',
    ] as const) {
      expect(parseZeichnenAuftrag(typ)).toEqual({ typ });
      expect(parseZeichnenAuftrag(`${typ}:flaeche`)).toEqual({ typ, form: 'flaeche' });
      expect(parseZeichnenAuftrag(`${typ}:linie`)).toEqual({ typ, form: 'linie' });
    }
  });
  it('parseZeichnenAuftrag verwirft Unbrauchbares statt halb zu füllen (LFH-825)', () => {
    expect(parseZeichnenAuftrag(null)).toBeNull();
    expect(parseZeichnenAuftrag(undefined)).toBeNull();
    expect(parseZeichnenAuftrag('')).toBeNull();
    expect(parseZeichnenAuftrag('tier')).toBeNull();
    expect(parseZeichnenAuftrag('gefahrengebiet:')).toBeNull();
    expect(parseZeichnenAuftrag('gefahrengebiet:polygon')).toBeNull();
    expect(parseZeichnenAuftrag('gefahrengebiet:linie:x')).toBeNull();
    expect(parseZeichnenAuftrag(':linie')).toBeNull();
    // Kein Prototyp-Schlüssel schlüpft als Typ oder Form durch.
    expect(parseZeichnenAuftrag('toString')).toBeNull();
    expect(parseZeichnenAuftrag('gefahrengebiet:toString')).toBeNull();
  });
  it('parseZeichnenAuftrag kennt die Form kreis (LLH-1043)', () => {
    expect(parseZeichnenAuftrag('absperrbereich:kreis')).toEqual({
      typ: 'absperrbereich',
      form: 'kreis',
    });
    expect(parseZeichnenAuftrag('evakuierungsbezirk:kreis')).toEqual({
      typ: 'evakuierungsbezirk',
      form: 'kreis',
    });
    expect(parseZeichnenAuftrag('absperrbereich:kreis:300')).toBeNull();
  });
  it('parseKreisVorbelegung nimmt jeden Teil für sich (LLH-1043)', () => {
    expect(parseKreisVorbelegung('300', '54.1,9.5')).toEqual({
      radius: 300,
      mitte: { lat: 54.1, lon: 9.5 },
    });
    expect(parseKreisVorbelegung('12.5', null)).toEqual({ radius: 12.5 });
    expect(parseKreisVorbelegung(null, null)).toEqual({});
    // Unbrauchbares fällt weg, der Rest bleibt.
    for (const r of ['0', '-5', '1e3', '50001', 'abc', '', ' ', 'Infinity']) {
      expect(parseKreisVorbelegung(r, '54,9'), r).toEqual({ mitte: { lat: 54, lon: 9 } });
    }
    expect(parseKreisVorbelegung('50000', '91,0')).toEqual({ radius: 50_000 });
  });
  it('der Kreis-Auftrag überlebt den Weg durch die URL (LLH-1043)', () => {
    const pfad = lagekartePfad(E, {
      zeichnen: {
        typ: 'evakuierungsbezirk',
        form: 'kreis',
        radius: 300,
        mitte: { lat: 54.123456, lon: 9.5 },
      },
    });
    expect(pfad).toBe(
      '/einsaetze/5/lagekarte?zeichnen=evakuierungsbezirk%3Akreis&radius=300&mitte=54.12346%2C9.5',
    );
    const params = new URLSearchParams(pfad.split('?')[1]);
    expect(parseZeichnenAuftrag(params.get('zeichnen'))).toEqual({
      typ: 'evakuierungsbezirk',
      form: 'kreis',
    });
    expect(parseKreisVorbelegung(params.get('radius'), params.get('mitte'))).toEqual({
      radius: 300,
      mitte: { lat: 54.12346, lon: 9.5 },
    });
    // Ohne Form kreis schreibt der Builder keine Vorbelegung.
    expect(lagekartePfad(E, { zeichnen: { typ: 'absperrbereich', radius: 300 } as never })).toBe(
      '/einsaetze/5/lagekarte?zeichnen=absperrbereich',
    );
  });
  it('der Zeichnen-Auftrag überlebt den Weg durch die URL (LFH-825)', () => {
    for (const zeichnen of [
      { typ: 'gefahrengebiet' as const },
      { typ: 'freie_skizze' as const, form: 'linie' as const },
    ]) {
      const pfad = lagekartePfad(E, { zeichnen });
      expect(pfad.split('?')[0]).toBe('/einsaetze/5/lagekarte');
      const params = new URLSearchParams(pfad.split('?')[1]);
      expect(parseZeichnenAuftrag(params.get('zeichnen'))).toEqual(zeichnen);
    }
    expect(lagekartePfad(E, { zeichnen: { typ: 'gefahrengebiet' } })).toBe(
      '/einsaetze/5/lagekarte?zeichnen=gefahrengebiet',
    );
  });
  it('Zeichnen mit Bezirk: `bezirk=<id>` neben `zeichnen` und zurück (LLH-1069)', () => {
    const pfad = lagekartePfad(E, { zeichnen: { typ: 'evakuierungsbezirk', bezirk: 12 } });
    expect(pfad).toBe('/einsaetze/5/lagekarte?zeichnen=evakuierungsbezirk&bezirk=12');
    const params = new URLSearchParams(pfad.split('?')[1]);
    expect(
      parseZeichnenBezug(parseZeichnenAuftrag(params.get('zeichnen')), params.get('bezirk')),
    ).toEqual({ typ: 'evakuierungsbezirk', bezirk: 12 });
  });
  it('parseZeichnenBezug: ohne Bezug unverändert, ein falscher Bezug verwirft den ganzen Auftrag', () => {
    const eb = { typ: 'evakuierungsbezirk' as const };
    // Ohne `bezirk` bleibt der Auftrag, wie er ist (LFH-825).
    expect(parseZeichnenBezug(eb, null)).toEqual(eb);
    expect(parseZeichnenBezug({ typ: 'gefahrengebiet' }, null)).toEqual({ typ: 'gefahrengebiet' });
    expect(parseZeichnenBezug(null, null)).toBeNull();
    // Mit Fläche als ausdrücklicher Form.
    expect(parseZeichnenBezug({ ...eb, form: 'flaeche' }, '3')).toEqual({
      ...eb,
      form: 'flaeche',
      bezirk: 3,
    });
    // `bezirk` gilt nur am Typ Evakuierungsbezirk: sonst kein Auftrag, kein Zeichnen ohne Bezug.
    expect(parseZeichnenBezug({ typ: 'gefahrengebiet' }, '3')).toBeNull();
    expect(parseZeichnenBezug({ typ: 'freie_skizze', form: 'linie' }, '3')).toBeNull();
    // Unbrauchbare Kennung.
    for (const roh of ['abc', '', '0', '-2', '1.5', ' ', '3x']) {
      expect(parseZeichnenBezug(eb, roh), roh).toBeNull();
    }
    // Ein Bezug ohne Auftrag ist kein Auftrag.
    expect(parseZeichnenBezug(null, '3')).toBeNull();
  });
  it('parsePlatzierenAuftrag liest den Auftrag zurück', () => {
    expect(parsePlatzierenAuftrag('schaden:7')).toEqual({ typ: 'schaden', id: 7 });
    expect(parsePlatzierenAuftrag('uhs:2')).toEqual({ typ: 'uhs', id: 2 });
  });
  it('parsePlatzierenAuftrag verwirft Unbrauchbares statt halb zu füllen', () => {
    // Ein halb gefülltes Objekt schickte die Karte in einen Modus ohne Ziel.
    expect(parsePlatzierenAuftrag(null)).toBeNull();
    expect(parsePlatzierenAuftrag('')).toBeNull();
    expect(parsePlatzierenAuftrag('schaden')).toBeNull();
    expect(parsePlatzierenAuftrag('schaden:abc')).toBeNull();
    expect(parsePlatzierenAuftrag('schaden:0')).toBeNull();
    expect(parsePlatzierenAuftrag('schaden:-1')).toBeNull();
    expect(parsePlatzierenAuftrag('katze:7')).toBeNull();
    expect(parsePlatzierenAuftrag('person:x')).toBeNull();
    // Kein Prototyp-Schlüssel schlüpft als Typ durch.
    expect(parsePlatzierenAuftrag('toString:7')).toBeNull();
  });
  it('der Platzier-Auftrag „person“ überlebt den Weg durch die URL (LFH-613)', () => {
    const pfad = lagekartePfad(E, { platzieren: { typ: 'person', id: 42 } });
    const wert = new URL(pfad, 'http://x').searchParams.get('platzieren');
    expect(wert).toBe('person:42');
    expect(parsePlatzierenAuftrag(wert)).toEqual({ typ: 'person', id: 42 });
  });
  it('der Platzier-Auftrag „betreuungsstelle“ überlebt den Weg durch die URL (LFH-673)', () => {
    const pfad = lagekartePfad(E, { platzieren: { typ: 'betreuungsstelle', id: 7 } });
    const wert = new URL(pfad, 'http://x').searchParams.get('platzieren');
    expect(wert).toBe('betreuungsstelle:7');
    expect(parsePlatzierenAuftrag(wert)).toEqual({ typ: 'betreuungsstelle', id: 7 });
    expect(parsePlatzierenAuftrag('betreuungsstelle:abc')).toBeNull();
    expect(parsePlatzierenAuftrag('betreuungsstelle:0')).toBeNull();
  });
  it('der Platzier-Auftrag „bereitstellungsraum“ überlebt den Weg durch die URL (LLH-1107)', () => {
    const pfad = lagekartePfad(E, { platzieren: { typ: 'bereitstellungsraum', id: 9 } });
    const wert = new URL(pfad, 'http://x').searchParams.get('platzieren');
    expect(wert).toBe('bereitstellungsraum:9');
    expect(parsePlatzierenAuftrag(wert)).toEqual({ typ: 'bereitstellungsraum', id: 9 });
    expect(parsePlatzierenAuftrag('bereitstellungsraum:abc')).toBeNull();
  });
  describe('Rückweg nach dem Verorten (LLH-1125)', () => {
    it('lagekartePfad trägt ?zurueck=1 nur mit Herkunft', () => {
      const pfad = lagekartePfad(E, { platzieren: { typ: 'person', id: 42, zurueck: true } });
      const params = new URL(pfad, 'http://x').searchParams;
      expect(params.get('platzieren')).toBe('person:42');
      expect(params.get('zurueck')).toBe('1');
      expect(parseZurueck(params.get('zurueck'))).toBe(true);
      expect(lagekartePfad(E, { platzieren: { typ: 'person', id: 42 } })).not.toContain('zurueck');
      expect(
        lagekartePfad(E, { platzieren: { typ: 'person', id: 42, zurueck: false } }),
      ).not.toContain('zurueck');
    });
    it('parseZurueck zählt nur genau „1“ — ein Pfad oder eine Adresse ist kein Rückweg', () => {
      expect(parseZurueck('1')).toBe(true);
      expect(parseZurueck(null)).toBe(false);
      expect(parseZurueck('')).toBe(false);
      expect(parseZurueck('0')).toBe(false);
      expect(parseZurueck('true')).toBe(false);
      expect(parseZurueck('/einsaetze/5/personen/42')).toBe(false);
      expect(parseZurueck('https://example.org')).toBe(false);
    });
    it('rueckwegPfad leitet das Ziel allein aus Typ und Kennung ab', () => {
      expect(rueckwegPfad(E, 'person', 42)).toBe(personDetailPfad(E, 42));
      expect(rueckwegPfad(E, 'schaden', 7)).toBe(schadenDetailPfad(E, 7));
      expect(rueckwegPfad(E, 'betreuungsstelle', 3)).toBe(betreuungsstellePfad(E, 3));
      expect(rueckwegPfad(E, 'bereitstellungsraum', 9)).toBe(bereitstellungsraumDetailPfad(E, 9));
      expect(rueckwegPfad(E, 'tier', 4)).toBe(tiereDetailPfad(E, 4));
    });
    it('rueckwegPfad: die UHS hat keinen äußeren Einstieg, ein unbekannter Typ kein Ziel', () => {
      expect(rueckwegPfad(E, 'uhs', 2)).toBeNull();
      // Ein Typ von außerhalb der Union (etwa aus einer manipulierten URL) findet kein Ziel.
      expect(rueckwegPfad(E, 'katze' as never, 2)).toBeNull();
      expect(rueckwegPfad(E, 'toString' as never, 2)).toBeNull();
    });
  });
  it('der Platzier-Auftrag „tier“ überlebt den Weg durch die URL (LLH-1123)', () => {
    const pfad = lagekartePfad(E, { platzieren: { typ: 'tier', id: 4, zurueck: true } });
    const url = new URL(pfad, 'http://x');
    expect(url.searchParams.get('platzieren')).toBe('tier:4');
    expect(url.searchParams.get('zurueck')).toBe('1');
    expect(parsePlatzierenAuftrag('tier:4')).toEqual({ typ: 'tier', id: 4 });
    expect(parsePlatzierenAuftrag('tier:abc')).toBeNull();
  });
  it('lagekartePfad trägt ?evakuierungsbezirk= (LFH-673)', () => {
    const pfad = lagekartePfad(E, { evakuierungsbezirk: 5 });
    expect(new URL(pfad, 'http://x').searchParams.get('evakuierungsbezirk')).toBe('5');
    expect(parseRouteId('5')).toBe(5);
    expect(parseRouteId('abc')).toBeNull();
  });
  it('Hin- und Rückweg passen zusammen', () => {
    // Die belastbare Aussage über das Paar: der Builder erzeugt, was der Parser liest.
    const pfad = lagekartePfad(E, { platzieren: { typ: 'uhs', id: 12 } });
    const wert = new URL(pfad, 'http://x').searchParams.get('platzieren');
    expect(parsePlatzierenAuftrag(wert)).toEqual({ typ: 'uhs', id: 12 });
  });
  it('personenAufnahmePfad zeigt auf die Vollseiten-Aufnahme', () => {
    expect(personenAufnahmePfad(E)).toBe('/einsaetze/5/personen/aufnahme');
  });
  it('personenAufnahmePfad ist KEIN Detail-Pfad — die Segmente dürfen nicht kollidieren', () => {
    // Beide Routen liegen unter `personen/`; ein Detail-Pfad mit numerischer Id und die
    // Aufnahme mit ihrem statischen Segment müssen unterscheidbar bleiben.
    expect(personenAufnahmePfad(E)).not.toBe(personDetailPfad(E, 1));
  });
  it('schaedenPfad ohne Optionen', () => {
    expect(schaedenPfad(E)).toBe('/einsaetze/5/schaeden');
  });
  it('schaedenPfad mit ?neu=1', () => {
    expect(schaedenPfad(E, { neu: true })).toBe('/einsaetze/5/schaeden?neu=1');
  });
  it('dokumentePfad ohne Optionen', () => {
    expect(dokumentePfad(E)).toBe('/einsaetze/5/dokumente');
  });
  it('dokumentePfad mit ?neu=1', () => {
    expect(dokumentePfad(E, { neu: true })).toBe('/einsaetze/5/dokumente?neu=1');
  });
  it('abloesungPfad (LFH-635)', () => {
    expect(abloesungPfad(E)).toBe('/einsaetze/5/abloesung');
  });
  it('abloesungPfad mit ?schicht= wie der Server-Pfad der Benachrichtigung (LLH-1131 Teil II)', () => {
    expect(abloesungPfad(E, { schicht: 9 })).toBe('/einsaetze/5/abloesung?schicht=9');
  });

  it('verpflegungPfad trifft die Registry-Route (LFH-634)', () => {
    expect(verpflegungPfad(E)).toBe('/einsaetze/5/verpflegung');
  });

  it('Ausgabeansicht eines Zeitfensters an Stab und Gerät (LLH-1032, design.md D1)', () => {
    expect(verpflegungAusgabePfad(E, 12)).toBe('/einsaetze/5/verpflegung/12/ausgabe');
    expect(geraetVerpflegungAusgabePfad(E, 12)).toBe('/geraet/5/verpflegung/12/ausgabe');
  });

  it('Ausgabeansicht mit gewählter Stelle per `?stelle=` (LLH-1040, D13 Punkt 7)', () => {
    expect(verpflegungAusgabePfad(E, 12, { stelle: 21 })).toBe(
      '/einsaetze/5/verpflegung/12/ausgabe?stelle=21',
    );
    expect(geraetVerpflegungAusgabePfad(E, 12, { stelle: 21 })).toBe(
      '/geraet/5/verpflegung/12/ausgabe?stelle=21',
    );
    expect(verpflegungAusgabePfad(E, 12, {})).toBe('/einsaetze/5/verpflegung/12/ausgabe');
    expect(parseVerpflegungStelle(new URLSearchParams('?stelle=21'))).toBe(21);
    expect(parseVerpflegungStelle(new URLSearchParams(''))).toBeNull();
    expect(parseVerpflegungStelle(new URLSearchParams('?stelle=abc'))).toBeNull();
    expect(parseVerpflegungStelle(new URLSearchParams('?stelle=0'))).toBeNull();
    expect(parseVerpflegungStelle(new URLSearchParams('?stelle=-3'))).toBeNull();
  });

  it('Tag aus der Vorlage mit gewähltem Tag per `?tag=` (LLH-1058)', () => {
    expect(verpflegungAusVorlagePfad(E)).toBe('/einsaetze/5/verpflegung/aus-vorlage');
    expect(verpflegungAusVorlagePfad(E, { tag: '2026-10-11' })).toBe(
      '/einsaetze/5/verpflegung/aus-vorlage?tag=2026-10-11',
    );
    expect(parseVerpflegungTag(new URLSearchParams('?tag=2026-10-11'))).toBe('2026-10-11');
    expect(parseVerpflegungTag(new URLSearchParams(''))).toBeNull();
    // Kein Kalendertag: ganz verworfen, nie ein „Invalid Date“ in der Rechnung.
    for (const roh of [
      '2026-13-01',
      '2026-02-30',
      '11.10.2026',
      '2026-10-1',
      'heute',
      '2026-10-11T00:00',
    ]) {
      expect(parseVerpflegungTag(new URLSearchParams({ tag: roh })), roh).toBeNull();
    }
  });

  it('betreuungPfad ohne Selektion trifft die Registry-Route (LFH-639)', () => {
    expect(betreuungPfad(E)).toBe('/einsaetze/5/betreuung');
    expect(betreuungPfad(E, {})).toBe('/einsaetze/5/betreuung');
  });

  it('betreuungsstellePfad: Item-Route unter dem Modul Betreuung (LLH-1044)', () => {
    expect(betreuungsstellePfad(E, 4)).toBe('/einsaetze/5/betreuung/4');
    // Der Modulwächter liest das Modul aus dem dritten Segment — die Detailseite gehört dazu.
    expect(betreuungsstellePfad(E, 4).split('/')[3]).toBe('betreuung');
  });

  it('betreuungPfad trägt `?stelle=` weiter als Altadresse — Round-Trip (LFH-639, LLH-1044)', () => {
    // Die Betreuungsseite leitet sie auf die Detailseite um.
    const stelle = betreuungPfad(E, { stelle: 4 });
    expect(stelle.split('?')[0]).toBe('/einsaetze/5/betreuung');
    const ps = new URLSearchParams(stelle.split('?')[1]);
    expect(ps.get('stelle')).toBe('4');
    expect(ps.has('bezirk')).toBe(false);
  });

  it('evakuierungPfad trifft die Registry-Route und selektiert den Bezirk (LLH-1034)', () => {
    expect(evakuierungPfad(E)).toBe('/einsaetze/5/evakuierung');
    const bezirk = evakuierungPfad(E, { bezirk: 12 });
    expect(bezirk.split('?')[0]).toBe('/einsaetze/5/evakuierung');
    expect(new URLSearchParams(bezirk.split('?')[1]).get('bezirk')).toBe('12');
  });

  it('evakuierungsbezirkPfad ist die Item-Route unter dem Modul (LLH-1076)', () => {
    // Unter dem Segment `evakuierung`: Sperre und Sichtbarkeit erbt die Detailseite vom Modul.
    expect(evakuierungsbezirkPfad(E, 12)).toBe('/einsaetze/5/evakuierung/12');
  });

  it('wetterPegelPfad (LFH-633)', () => {
    expect(wetterPegelPfad(E)).toBe('/einsaetze/5/wetter-pegel');
  });

  it('pegelZielPfad: Modul frei → Modulseite, sonst Einstellungen › Pegel (LFH-633)', () => {
    expect(pegelZielPfad(E, true)).toBe('/einsaetze/5/wetter-pegel');
    expect(pegelZielPfad(E, false)).toBe('/einsaetze/5/einstellungen/pegel');
  });

  it('stabPfad ohne Optionen', () => {
    expect(stabPfad(E)).toBe('/einsaetze/5/stab');
  });
  it('Presse- und Infotelefon-Seiten liegen unter dem Stab (LFH-554)', () => {
    expect(pressePfad(E)).toBe('/einsaetze/5/stab/presse');
    expect(pressePfad(E, { kontakt: 12 })).toBe('/einsaetze/5/stab/presse?kontakt=12');
    expect(pressemitteilungPfad(E, 4)).toBe('/einsaetze/5/stab/presse/mitteilungen/4');
    expect(infotelefonPfad(E)).toBe('/einsaetze/5/stab/infotelefon');
    expect(infotelefonPfad(E, { anruf: 9 })).toBe('/einsaetze/5/stab/infotelefon?anruf=9');
    // Round-Trip: der Query-Wert liest sich über URLSearchParams unverändert zurück.
    const q = new URLSearchParams(pressePfad(E, { kontakt: 12 }).split('?')[1]);
    expect(parseRouteId(q.get('kontakt') ?? undefined)).toBe(12);
  });

  it('kommunikationsplanPfad liegt im Fernmeldewesen (LFH-848, LLH-1180)', () => {
    expect(kommunikationsplanPfad(E)).toBe('/einsaetze/5/fernmeldewesen/kommunikationsplan');
  });
  it('funkplanPfad ist die Modulroute des Fernmeldewesens (LFH-548, LLH-1180)', () => {
    expect(funkplanPfad(E)).toBe('/einsaetze/5/fernmeldewesen');
  });
  it('funkplanPfad mit ?ansicht= (Fernmeldeskizze, LFH-625)', () => {
    expect(funkplanPfad(E, { ansicht: 'skizze' })).toBe(
      '/einsaetze/5/fernmeldewesen?ansicht=skizze',
    );
  });
  it('parseFunkplanAnsicht liest alle drei Darstellungen und verwirft einen unbekannten Wert GANZ', () => {
    expect(parseFunkplanAnsicht(new URLSearchParams('ansicht=skizze'))).toBe('skizze');
    expect(parseFunkplanAnsicht(new URLSearchParams('ansicht=tabelle'))).toBe('tabelle');
    // Dritte Darstellung „Sprechgruppen“ (LFH-848 D8).
    expect(parseFunkplanAnsicht(new URLSearchParams('ansicht=sprechgruppen'))).toBe(
      'sprechgruppen',
    );
    expect(funkplanPfad(E, { ansicht: 'sprechgruppen' })).toBe(
      '/einsaetze/5/fernmeldewesen?ansicht=sprechgruppen',
    );
    expect(parseFunkplanAnsicht(new URLSearchParams('ansicht=quatsch'))).toBeUndefined();
    expect(parseFunkplanAnsicht(new URLSearchParams('ansicht=toString'))).toBeUndefined();
    expect(parseFunkplanAnsicht(new URLSearchParams(''))).toBeUndefined();
  });
  it('lagebesprechungPfad ohne und mit neu', () => {
    expect(lagebesprechungPfad(E)).toBe('/einsaetze/5/lagebesprechung');
    expect(lagebesprechungPfad(E, { neu: true })).toBe('/einsaetze/5/lagebesprechung?neu=1');
  });
  it('etbPfad mit ?eintrag=', () => {
    expect(etbPfad(E, { eintrag: 7 })).toBe('/einsaetze/5/etb?eintrag=7');
  });
  it('etbPfad mit ?neu=1', () => {
    expect(etbPfad(E, { neu: true })).toBe('/einsaetze/5/etb?neu=1');
  });
  it('personalPfad mit ?personal=', () => {
    expect(personalPfad(E, { personal: 12 })).toBe('/einsaetze/5/personal?personal=12');
  });
  it('einsatzkraftPfad ist die Item-Route der Personenansicht (LLH-1060)', () => {
    expect(einsatzkraftPfad(E, 12)).toBe('/einsaetze/5/personal/12');
  });
  it('einheitAusVorlagePfad liegt unter den Einheiten, nicht auf einer Detail-ID (LLH-1049)', () => {
    expect(einheitAusVorlagePfad(E, 3)).toBe('/einsaetze/5/einheiten/aus-vorlage/3');
    expect(einheitAusVorlagePfad(E, 3)).not.toBe(einheitDetailPfad(E, 3));
  });
  it('einheitenPfad mit ?einheit=', () => {
    expect(einheitenPfad(E, { einheit: 4 })).toBe('/einsaetze/5/einheiten?einheit=4');
  });
  it('fahrzeugePfad mit ?fahrzeug=', () => {
    expect(fahrzeugePfad(E, { fahrzeug: 6 })).toBe('/einsaetze/5/fahrzeuge?fahrzeug=6');
  });
  it('fahrzeugePfad mit ?ansicht= (Sprungmarke FMS-Tableau, LFH-642)', () => {
    expect(fahrzeugePfad(E, { ansicht: 'tableau' })).toBe('/einsaetze/5/fahrzeuge?ansicht=tableau');
  });
  it('parseFahrzeugeAnsicht liest beide Ansichten und verwirft einen unbekannten Wert GANZ', () => {
    expect(parseFahrzeugeAnsicht(new URLSearchParams('ansicht=tableau'))).toBe('tableau');
    expect(parseFahrzeugeAnsicht(new URLSearchParams('ansicht=liste'))).toBe('liste');
    expect(parseFahrzeugeAnsicht(new URLSearchParams('ansicht=kachel'))).toBeUndefined();
    // Ein geerbter Objektschlüssel ist kein erlaubter Wert (hasOwnProperty, nicht `in`).
    expect(parseFahrzeugeAnsicht(new URLSearchParams('ansicht=toString'))).toBeUndefined();
    expect(parseFahrzeugeAnsicht(new URLSearchParams(''))).toBeUndefined();
  });
  it('einsatzabschnittePfad mit ?abschnitt=', () => {
    expect(einsatzabschnittePfad(E, { abschnitt: 2 })).toBe(
      '/einsaetze/5/einsatzabschnitte?abschnitt=2',
    );
  });
  it('einsatzabschnittePfad mit ?neu=1', () => {
    expect(einsatzabschnittePfad(E, { neu: true })).toBe('/einsaetze/5/einsatzabschnitte?neu=1');
    expect(einsatzabschnittePfad(E, { neu: false })).toBe('/einsaetze/5/einsatzabschnitte');
  });
  it('einsatzabschnittePfad mit ?ansicht= (Organigramm, LFH-626)', () => {
    expect(einsatzabschnittePfad(E, { ansicht: 'organigramm' })).toBe(
      '/einsaetze/5/einsatzabschnitte?ansicht=organigramm',
    );
  });
  it('parseAbschnitteAnsicht liest beide Ansichten und verwirft einen unbekannten Wert GANZ', () => {
    expect(parseAbschnitteAnsicht(new URLSearchParams('ansicht=organigramm'))).toBe('organigramm');
    expect(parseAbschnitteAnsicht(new URLSearchParams('ansicht=gliederung'))).toBe('gliederung');
    expect(parseAbschnitteAnsicht(new URLSearchParams('ansicht=quatsch'))).toBeUndefined();
    expect(parseAbschnitteAnsicht(new URLSearchParams('ansicht=toString'))).toBeUndefined();
    expect(parseAbschnitteAnsicht(new URLSearchParams(''))).toBeUndefined();
  });
  it('chatPfad mit ?kanal= (Sprung einer Erwähnung)', () => {
    expect(chatPfad(E)).toBe('/einsaetze/5/chat');
    expect(chatPfad(E, { kanal: 3 })).toBe('/einsaetze/5/chat?kanal=3');
  });

  it('meldungenPfad mit ?meldung=', () => {
    expect(meldungenPfad(E, { meldung: 11 })).toBe('/einsaetze/5/meldungen?meldung=11');
  });
  it('auftraegePfad mit ?auftrag=', () => {
    expect(auftraegePfad(E, { auftrag: 13 })).toBe('/einsaetze/5/auftraege?auftrag=13');
  });
  it('auftraegePfad ohne Optionen', () => {
    expect(auftraegePfad(E)).toBe('/einsaetze/5/auftraege');
  });
  it('auftraegePfad mit ?reiter=befehle (LFH-972); „Aufträge" ist die Vorgabe ohne Parameter', () => {
    expect(auftraegePfad(E, { reiter: 'befehle' })).toBe('/einsaetze/5/auftraege?reiter=befehle');
    expect(auftraegePfad(E, { reiter: 'auftraege' })).toBe('/einsaetze/5/auftraege');
    // `?auftrag=` gewinnt: der hervorgehobene Auftrag steht im Reiter Aufträge.
    expect(auftraegePfad(E, { auftrag: 13, reiter: 'befehle' })).toBe(
      '/einsaetze/5/auftraege?auftrag=13',
    );
  });
  it('auftraegePfad mit ?befehl= setzt den Reiter Einsatzbefehle (oxgob5gk D6)', () => {
    expect(auftraegePfad(E, { befehl: 7 })).toBe('/einsaetze/5/auftraege?befehl=7&reiter=befehle');
    const rund = new URL(auftraegePfad(E, { befehl: 7 }), 'http://x').searchParams;
    expect(parseAuftraegeReiter(rund)).toBe('befehle');
    expect(rund.get('befehl')).toBe('7');
  });
  it('parseAuftraegeReiter: Round-Trip, unbekannter und fehlender Wert ergeben die Vorgabe', () => {
    const rund = (pfad: string) => parseAuftraegeReiter(new URL(pfad, 'http://x').searchParams);
    expect(rund(auftraegePfad(E, { reiter: 'befehle' }))).toBe('befehle');
    expect(rund(auftraegePfad(E))).toBe('auftraege');
    expect(parseAuftraegeReiter(new URLSearchParams('reiter=chat'))).toBe('auftraege');
    // Ein geerbter Objektschlüssel ist kein erlaubter Wert (hasOwnProperty, nicht `in`).
    expect(parseAuftraegeReiter(new URLSearchParams('reiter=toString'))).toBe('auftraege');
  });
  it('gefahrenPfad ohne Optionen', () => {
    expect(gefahrenPfad(E)).toBe('/einsaetze/5/gefahren');
  });
  it('gefahrenPfad mit ?gefahrengebiet=', () => {
    expect(gefahrenPfad(E, { gefahrengebiet: 4 })).toBe('/einsaetze/5/gefahren?gefahrengebiet=4');
  });
  it('lagekartePfad ohne Optionen', () => {
    expect(lagekartePfad(E)).toBe('/einsaetze/5/lagekarte');
  });
  it('lagekartePfad mit ?gefahrengebiet= (Reverse-Deeplink)', () => {
    expect(lagekartePfad(E, { gefahrengebiet: 4 })).toBe('/einsaetze/5/lagekarte?gefahrengebiet=4');
  });
  it('lagekartePfad mit ?ansicht= (Kartenansicht-Selektion, LFH-319)', () => {
    expect(lagekartePfad(E, { ansicht: 7 })).toBe('/einsaetze/5/lagekarte?ansicht=7');
  });
  it('einsatzdatenPfad', () => {
    expect(einsatzdatenPfad(E)).toBe('/einsaetze/5/einsatzdaten');
  });
});

describe('personenAufnahmePfad', () => {
  it('bleibt ohne UHS-Auftrag die nackte Route', () => {
    expect(personenAufnahmePfad(4)).toBe('/einsaetze/4/personen/aufnahme');
  });

  it('trägt den UHS-Auftrag als Query-Param', () => {
    expect(personenAufnahmePfad(4, { uhs: 7 })).toBe('/einsaetze/4/personen/aufnahme?uhs=7');
  });
});

describe('parseRouteId — strenger als nur NaN (Number.isInteger && > 0)', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['0', null],
    ['-1', null],
    ['5.5', null],
    ['', null],
    ['abc', null],
    [undefined, null],
  ])('parseRouteId(%o) -> %o', (input, expected) => {
    expect(parseRouteId(input as string | undefined)).toBe(expected);
  });
});

describe('etbPfad mit Filterachse (LFH-342 · C7)', () => {
  it('baut alle vier Filterwerte in die Query', () => {
    expect(etbPfad(7, { q: 'brand', typ: 'meldung', von: '2026-08-21 06:00:00' })).toBe(
      '/einsaetze/7/etb?q=brand&typ=meldung&von=2026-08-21%2006%3A00%3A00',
    );
  });

  it('lässt leere Werte weg statt leere Parameter zu schreiben', () => {
    expect(etbPfad(7, { q: '', typ: undefined })).toBe('/einsaetze/7/etb');
  });

  it('kodiert einen Suchbegriff mit Trennzeichen, statt die Query zu zerlegen', () => {
    // Der Volltext ist Freitext. Unkodiert machte ein `&` aus einem Suchbegriff zwei
    // Parameter, ein `=` verschöbe die Grenze zwischen Name und Wert.
    const pfad = etbPfad(7, { q: 'a&b=c' });
    expect(new URLSearchParams(pfad.split('?')[1]).get('q')).toBe('a&b=c');
  });

  it('parseEtbFilter liest zurück, was etbPfad geschrieben hat', () => {
    const pfad = etbPfad(7, { q: 'br and', typ: 'meldung', von: '2026-08-21 06:00:00' });
    const params = new URLSearchParams(pfad.split('?')[1]);
    expect(parseEtbFilter(params)).toEqual({
      q: 'br and',
      typ: 'meldung',
      von: '2026-08-21 06:00:00',
    });
  });

  it('verwirft einen unbekannten Typ GANZ statt halb zu füllen', () => {
    // Wie bei `parsePlatzierenAuftrag`: ein unbrauchbarer Wert ergibt gar keinen Filter.
    expect(parseEtbFilter(new URLSearchParams('q=x&typ=quatsch'))).toEqual({ q: 'x' });
  });

  it('trägt die Einheit hin und zurück (LFH-616)', () => {
    const pfad = etbPfad(7, { einheit_id: 12 });
    expect(pfad).toBe('/einsaetze/7/etb?einheit_id=12');
    expect(parseEtbFilter(new URLSearchParams(pfad.split('?')[1]))).toEqual({ einheit_id: 12 });
  });

  it.each(['abc', '0', '-3', '1.5', ''])('verwirft einheit_id=%s GANZ (LFH-616)', (wert) => {
    expect(parseEtbFilter(new URLSearchParams(`q=x&einheit_id=${wert}`))).toEqual({ q: 'x' });
  });

  it('trägt den Ausschluss der Systemeinträge hin und zurück (LFH-958)', () => {
    const pfad = etbPfad(7, { ohne_system: true, typ: 'meldung' });
    expect(pfad).toBe('/einsaetze/7/etb?typ=meldung&ohne_system=true');
    expect(parseEtbFilter(new URLSearchParams(pfad.split('?')[1]))).toEqual({
      typ: 'meldung',
      ohne_system: true,
    });
  });

  it.each(['false', '0', 'ja', ''])(
    'liest ohne_system=%s nicht als Ausschluss (LFH-958)',
    (wert) => {
      expect(parseEtbFilter(new URLSearchParams(`q=x&ohne_system=${wert}`))).toEqual({ q: 'x' });
    },
  );

  it('nimmt `1` als Ausschluss, schreibt aber `true` (LFH-958)', () => {
    expect(parseEtbFilter(new URLSearchParams('ohne_system=1'))).toEqual({ ohne_system: true });
  });

  it('lässt typ=system vor dem Ausschluss gelten; die Seite schickt nie die 422 (LFH-958)', () => {
    expect(parseEtbFilter(new URLSearchParams('typ=system&ohne_system=true'))).toEqual({
      typ: 'system',
    });
  });

  it('liefert für eine leere Query ein leeres Filterobjekt', () => {
    // Ohne Parameter ist kein Filter gesetzt (Gegenaussage zu `filterAktiv` in `EtbPage`).
    expect(parseEtbFilter(new URLSearchParams(''))).toEqual({});
  });
});

describe('einsatzberichtPfad (LFH-726)', () => {
  it('zeigt auf die Druckansicht unter den Einsatzdaten', () => {
    expect(einsatzberichtPfad(7)).toBe('/einsaetze/7/einsatzdaten/bericht');
  });

  it('schreibt den Standardumfang nicht in die Adresse (LFH-902)', () => {
    expect(einsatzberichtPfad(7, STANDARDUMFANG)).toBe('/einsaetze/7/einsatzdaten/bericht');
  });

  it('trägt eine Auswahl kanonisch geordnet, die Umkehr liest sie zurück (LFH-902)', () => {
    const pfad = einsatzberichtPfad(7, ['personal-kopf', 'stammdaten']);
    expect(pfad).toBe('/einsaetze/7/einsatzdaten/bericht?bloecke=stammdaten%2Cpersonal-kopf');
    const query = new URLSearchParams(pfad.split('?')[1]);
    expect(parseBerichtAuswahl(query)).toEqual(['stammdaten', 'personal-kopf']);
  });
});

describe('etbDruckPfad (LFH-22)', () => {
  it('zeigt ohne Filter auf die Druckansicht des Tagebuchs', () => {
    expect(etbDruckPfad(7, {})).toBe('/einsaetze/7/etb/druck');
  });

  it('trägt den Filter durch URLSearchParams hin und zurück — auch mit & = und Leerzeichen', () => {
    const filter = {
      q: 'Brücke & Damm = gesperrt',
      typ: 'meldung' as const,
      von: '2026-08-21 06:00:00',
      bis: '2026-08-21 10:00:00',
      einheit_id: 12,
      ohne_system: true as const,
    };
    const pfad = etbDruckPfad(7, filter);
    expect(pfad.startsWith('/einsaetze/7/etb/druck?')).toBe(true);
    expect(parseEtbFilter(new URLSearchParams(pfad.split('?')[1]))).toEqual(filter);
  });
});

/**
 * Druck der Modul-Listen (LFH-727, design.md D5): Die Adresse trägt den Seitenfilter der Liste.
 * Ein fehlender Wert heißt „alle“ (nicht die Vorgabe der Liste), ein unbekannter fällt ganz weg.
 */
describe('Druckpfade der Modul-Listen (LFH-727)', () => {
  const rundlauf = (pfad: string) => new URLSearchParams(pfad.split('?')[1] ?? '');

  it('Personen: ohne Filter der blanke Pfad, mit Filter hin und zurück', () => {
    expect(personenDruckPfad(7, { filter: 'alle', nurLuecken: false })).toBe(
      '/einsaetze/7/personen/druck',
    );
    const pfad = personenDruckPfad(7, { filter: 'vermisst', nurLuecken: true });
    expect(pfad).toBe('/einsaetze/7/personen/druck?filter=vermisst&luecken=1');
    expect(parsePersonenDruckAuswahl(rundlauf(pfad))).toEqual({
      filter: 'vermisst',
      nurLuecken: true,
    });
  });

  it('Personen: Unbekanntes fällt weg, fehlender Filter ist „alle“', () => {
    expect(parsePersonenDruckAuswahl(new URLSearchParams('filter=patienten&luecken=ja'))).toEqual({
      filter: 'alle',
      nurLuecken: false,
    });
    expect(parsePersonenDruckAuswahl(new URLSearchParams(''))).toEqual({
      filter: 'alle',
      nurLuecken: false,
    });
  });

  it('Tiere: Sicht und Spezies hin und zurück, „alle“ entfällt', () => {
    expect(tiereDruckPfad(7, { sicht: 'alle' })).toBe('/einsaetze/7/tiere/druck');
    const pfad = tiereDruckPfad(7, { sicht: 'vermisst', spezies: ['hund'] });
    expect(pfad).toBe('/einsaetze/7/tiere/druck?sicht=vermisst&spezies=hund');
    expect(parseTiereDruckAuswahl(rundlauf(pfad))).toEqual({
      sicht: 'vermisst',
      spezies: ['hund'],
    });
    // Mehrere Spezies aus dem Kopffilter der Liste (LLH-1096).
    const mehrere = tiereDruckPfad(7, { sicht: 'alle', spezies: ['hund', 'katze'] });
    expect(parseTiereDruckAuswahl(rundlauf(mehrere))).toEqual({
      sicht: 'alle',
      spezies: ['hund', 'katze'],
    });
    // Die Vorgabe der Liste (`aktiv`) reist ausdrücklich mit.
    expect(parseTiereDruckAuswahl(rundlauf(tiereDruckPfad(7, { sicht: 'aktiv' })))).toEqual({
      sicht: 'aktiv',
    });
  });

  it('Tiere: fehlende Sicht ist „alle“, Unbekanntes fällt je Achse weg', () => {
    expect(parseTiereDruckAuswahl(new URLSearchParams(''))).toEqual({ sicht: 'alle' });
    expect(parseTiereDruckAuswahl(new URLSearchParams('sicht=weg&spezies=drache'))).toEqual({
      sicht: 'alle',
    });
    expect(parseTiereDruckAuswahl(new URLSearchParams('sicht=weg&spezies=katze,drache'))).toEqual({
      sicht: 'alle',
      spezies: ['katze'],
    });
  });

  it('Schäden: Sicht hin und zurück, fehlend oder unbekannt ist „alle“', () => {
    expect(schaedenDruckPfad(7, { sicht: 'alle' })).toBe('/einsaetze/7/schaeden/druck');
    const pfad = schaedenDruckPfad(7, { sicht: 'uebergeben' });
    expect(pfad).toBe('/einsaetze/7/schaeden/druck?sicht=uebergeben');
    expect(parseSchaedenDruckAuswahl(rundlauf(pfad))).toEqual({ sicht: 'uebergeben' });
    expect(parseSchaedenDruckAuswahl(new URLSearchParams('sicht=storniert'))).toEqual({
      sicht: 'alle',
    });
    expect(parseSchaedenDruckAuswahl(new URLSearchParams(''))).toEqual({ sicht: 'alle' });
  });
});

describe('einsatzEinstellungenPfad (LFH-345 · C10, H15/M15)', () => {
  it('zeigt ohne Sektion auf den Einstieg — der bare Modulpfad leitet dorthin um', () => {
    expect(einsatzEinstellungenPfad(E)).toBe('/einsaetze/5/einstellungen/allgemein');
  });

  it('baut alle Sektionen', () => {
    expect(einsatzEinstellungenPfad(E, 'allgemein')).toBe('/einsaetze/5/einstellungen/allgemein');
    expect(einsatzEinstellungenPfad(E, 'verhalten')).toBe('/einsaetze/5/einstellungen/verhalten');
    expect(einsatzEinstellungenPfad(E, 'aufbewahrung')).toBe(
      '/einsaetze/5/einstellungen/aufbewahrung',
    );
    expect(einsatzEinstellungenPfad(E, 'module')).toBe('/einsaetze/5/einstellungen/module');
    expect(einsatzEinstellungenPfad(E, 'pegel')).toBe('/einsaetze/5/einstellungen/pegel');
    expect(einsatzEinstellungenPfad(E, 'geraete')).toBe('/einsaetze/5/einstellungen/geraete');
    expect(einsatzEinstellungenPfad(E, 'zugriff')).toBe('/einsaetze/5/einstellungen/zugriff');
  });

  it('trägt den Aufnahme-Auftrag der Schnellaktion als `?neu=1` (LFH-1170)', () => {
    expect(einsatzEinstellungenPfad(E, 'zugriff', { neu: true })).toBe(
      '/einsaetze/5/einstellungen/zugriff?neu=1',
    );
    expect(einsatzEinstellungenPfad(E, 'zugriff', { neu: false })).toBe(
      '/einsaetze/5/einstellungen/zugriff',
    );
  });

  it('trägt den Kopplungscode im Fragment, nie im Pfad oder in der Abfrage (LFH-892)', () => {
    const adresse = new URL(koppelnAdresse('https://hub.example', 'ABCD1234'));
    expect(adresse.pathname).toBe('/koppeln');
    expect(adresse.search).toBe('');
    expect(adresse.hash).toBe('#ABCD1234');
  });

  /**
   * Die Liste ist die Wahrheit für Tab-Band und Routentabelle; die Reihenfolge ist gepinnt,
   * weil das erste Element das Ziel des baren Pfades ist.
   */
  it('führt die Sektionen in Bedienreihenfolge; die erste ist das Redirect-Ziel', () => {
    expect(EINSTELLUNGEN_SEKTIONEN.map((s) => s.key)).toEqual([
      'allgemein',
      'verhalten',
      'aufbewahrung',
      'module',
      'pegel',
      'kennzahlen',
      'abloesung',
      'geraete',
      'zugriff',
    ]);
    expect(einsatzEinstellungenPfad(E, EINSTELLUNGEN_SEKTIONEN[0].key)).toBe(
      einsatzEinstellungenPfad(E),
    );
  });
});

describe('deeplinks — Nachforderung mit Vorbelegung (LFH-634)', () => {
  // Typographische Anführungszeichen, Halbgeviertstrich, Doppelpunkt — dazu `&`, `=` und `+`,
  // die unkodiert Parameter zerschneiden bzw. zu Leerzeichen würden.
  const vorbelegung = {
    art: 'Verpflegung',
    bezeichnung: 'Essensportionen ‚Mittag‘ 12:00–13:30 & Getränke = 1+1',
    anzahl: 20,
    begruendung: 'Unterdeckung Verpflegung ‚Mittag‘: Bedarf 250, ausgegeben 230.',
  };

  /** Zerlegt den gebauten Pfad so, wie der Router ihn der Seite gibt. */
  const params = (pfad: string) => new URLSearchParams(pfad.split('?')[1] ?? '');

  it('nachforderungenPfad ohne Optionen ist der bare Modulpfad', () => {
    expect(nachforderungenPfad(E)).toBe('/einsaetze/5/nachforderungen');
    expect(nachforderungenPfad(E, { neu: true })).toBe('/einsaetze/5/nachforderungen?neu=1');
  });

  it('Stellenbezug setzt neu=1 und betreuungsstelle, der Filter stelle bleibt Zustand (LLH-1082)', () => {
    const pfad = nachforderungenPfad(E, { bezugStelle: 7, stelle: 7 });
    expect(pfad).toBe('/einsaetze/5/nachforderungen?neu=1&betreuungsstelle=7&stelle=7');
    const p = params(pfad);
    expect(parseNachforderungBezug(p)).toBe(7);
    expect(parseNachforderungStelle(p)).toBe(7);
    // Ohne Art keine Vorbelegung: der Bezug steht für sich.
    expect(parseNachforderungVorbelegung(p)).toBeNull();
    expect(nachforderungenPfad(E, { stelle: 3 })).toBe('/einsaetze/5/nachforderungen?stelle=3');
  });

  it.each(['0', '-1', 'abc', '1.5', ''])('unlesbarer Stellenbezug %j heißt kein Bezug', (wert) => {
    const p = new URLSearchParams({ betreuungsstelle: wert, stelle: wert });
    expect(parseNachforderungBezug(p)).toBeNull();
    expect(parseNachforderungStelle(p)).toBeNull();
  });

  it('?nachforderung= steuert eine Nachforderung an und übersteht den Round-Trip (LLH-1226 D10)', () => {
    const pfad = nachforderungenPfad(E, { nachforderung: 4 });
    expect(pfad).toBe('/einsaetze/5/nachforderungen?nachforderung=4');
    expect(parseRouteId(params(pfad).get('nachforderung') ?? undefined)).toBe(4);
  });

  it('eine Vorbelegung setzt neu=1 und übersteht den Round-Trip durch URLSearchParams', () => {
    const pfad = nachforderungenPfad(E, { vorbelegung });
    expect(pfad.startsWith('/einsaetze/5/nachforderungen?neu=1&')).toBe(true);
    const p = params(pfad);
    expect(p.get('neu')).toBe('1');
    expect(parseNachforderungVorbelegung(p)).toEqual(vorbelegung);
  });

  it('die Begründung ist optional', () => {
    const ohne = { art: vorbelegung.art, bezeichnung: vorbelegung.bezeichnung, anzahl: 20 };
    const p = params(nachforderungenPfad(E, { vorbelegung: ohne }));
    expect(p.has('begruendung')).toBe(false);
    expect(parseNachforderungVorbelegung(p)).toEqual(ohne);
  });

  it.each(['0', '-3', 'abc', '1.5', '1e2', ' 5', ''])(
    'Anzahl %j verwirft die GANZE Vorbelegung',
    (anzahl) => {
      const p = params(nachforderungenPfad(E, { vorbelegung }));
      p.set('anzahl', anzahl);
      expect(parseNachforderungVorbelegung(p)).toBeNull();
    },
  );

  // Eine Teil-Vorbelegung (LLH-1133, „Fehlmenge melden“ an der UHS) lässt Anzahl und Bezeichnung
  // offen: die Person trägt sie selbst ein. Verworfen wird nur, was gesetzt und unbrauchbar ist.
  it('fehlende Anzahl lässt das Feld leer, die übrigen Angaben bleiben', () => {
    const p = params(nachforderungenPfad(E, { vorbelegung }));
    p.delete('anzahl');
    expect(parseNachforderungVorbelegung(p)).toEqual({
      art: vorbelegung.art,
      bezeichnung: vorbelegung.bezeichnung,
      begruendung: vorbelegung.begruendung,
    });
  });

  it.each(['art', 'bezeichnung'])('leere %s verwirft die ganze Vorbelegung', (feld) => {
    const leer = params(nachforderungenPfad(E, { vorbelegung }));
    leer.set(feld, '   ');
    expect(parseNachforderungVorbelegung(leer)).toBeNull();
  });

  it('fehlende Art verwirft die ganze Vorbelegung, fehlende Bezeichnung nicht', () => {
    const ohneArt = params(nachforderungenPfad(E, { vorbelegung }));
    ohneArt.delete('art');
    expect(parseNachforderungVorbelegung(ohneArt)).toBeNull();
    const ohneBezeichnung = params(nachforderungenPfad(E, { vorbelegung }));
    ohneBezeichnung.delete('bezeichnung');
    expect(parseNachforderungVorbelegung(ohneBezeichnung)).toEqual({
      art: vorbelegung.art,
      anzahl: vorbelegung.anzahl,
      begruendung: vorbelegung.begruendung,
    });
  });

  it('eine leere Begründung fällt weg, statt als leerer Text vorzubelegen', () => {
    const p = params(nachforderungenPfad(E, { vorbelegung }));
    p.set('begruendung', '  ');
    expect(parseNachforderungVorbelegung(p)).toEqual({
      art: 'Verpflegung',
      bezeichnung: vorbelegung.bezeichnung,
      anzahl: 20,
    });
  });

  it('ohne Parameter gibt es keine Vorbelegung', () => {
    expect(parseNachforderungVorbelegung(new URLSearchParams('neu=1'))).toBeNull();
    expect(parseNachforderungVorbelegung(new URLSearchParams())).toBeNull();
  });
});

describe('parseMeldungInhalt (Verpflegungsgerät, LFH-1044)', () => {
  const params = (inhalt?: string) =>
    new URLSearchParams(inhalt === undefined ? '' : `?${new URLSearchParams({ inhalt })}`);

  it('übernimmt den Inhalt getrimmt', () => {
    expect(parseMeldungInhalt(params('  Fehlmenge 20 EP  '))).toBe('Fehlmenge 20 EP');
  });

  it('ohne oder mit leerem Inhalt nichts', () => {
    expect(parseMeldungInhalt(params())).toBeNull();
    expect(parseMeldungInhalt(params('   '))).toBeNull();
  });

  it('kappt auf die Grenze des Inhalts', () => {
    expect(parseMeldungInhalt(params('x'.repeat(ETB_INHALT_MAX + 5)))).toHaveLength(ETB_INHALT_MAX);
  });
});

describe('hilfePfad / parseHilfeGruppe (LFH-1096)', () => {
  it('lässt die Vorgabe „alle“ aus der Adresse', () => {
    expect(hilfePfad()).toBe('/hilfe');
    expect(hilfePfad({ gruppe: 'alle' })).toBe('/hilfe');
    expect(hilfePfad({ kapitel: 'ohne-netz', gruppe: 'administration' })).toBe(
      '/hilfe/ohne-netz?gruppe=administration',
    );
  });

  it('liest die Gruppe zurück, Unbekanntes wird „alle“', () => {
    const rund = new URL(hilfePfad({ gruppe: 'geraete' }), 'http://x').searchParams;
    expect(parseHilfeGruppe(rund)).toBe('geraete');
    expect(parseHilfeGruppe(new URLSearchParams('gruppe=leitstelle'))).toBe('alle');
    expect(parseHilfeGruppe(new URLSearchParams(''))).toBe('alle');
  });
});

describe('deeplinks — Bereiche der UHS-Seite (LLH-1133)', () => {
  const params = (pfad: string) => new URLSearchParams(pfad.split('?')[1] ?? '');

  it('die Belegung ist die Vorgabe und steht ohne Parameter', () => {
    expect(uhsDetailPfad(E, 9, { bereich: 'belegung' })).toBe('/einsaetze/5/unfallhilfsstellen/9');
    expect(uhsBereichSuche('belegung')).toBe('');
  });

  it.each(['material', 'kraefte', 'bewegungen', 'dateien'] as const)(
    '%s steht in der Adresse und übersteht den Round-Trip',
    (bereich) => {
      const pfad = uhsDetailPfad(E, 9, { bereich });
      expect(pfad).toBe(`/einsaetze/5/unfallhilfsstellen/9?bereich=${bereich}`);
      expect(parseUhsBereich(params(pfad))).toBe(bereich);
      expect(uhsBereichSuche(bereich)).toBe(`?bereich=${bereich}`);
    },
  );

  it.each(['', 'belegung', 'Material', 'grundriss', 'toString'])(
    'ein unbekannter oder leerer Wert %j fällt auf die Belegung zurück',
    (wert) => {
      expect(parseUhsBereich(new URLSearchParams({ bereich: wert }))).toBe('belegung');
    },
  );

  it('ohne Parameter gilt die Belegung', () => {
    expect(parseUhsBereich(new URLSearchParams())).toBe('belegung');
  });
});

describe('deeplinks — Teil-Vorbelegung einer Nachforderung (LLH-1133, „Fehlmenge melden“)', () => {
  const params = (pfad: string) => new URLSearchParams(pfad.split('?')[1] ?? '');

  it('Art und Begründung ohne Bezeichnung und Anzahl übersteht den Round-Trip', () => {
    const teil = { art: 'Material', begruendung: 'Fehlmenge UHS «Turnhalle»' };
    const pfad = nachforderungenPfad(E, { vorbelegung: teil });
    expect(params(pfad).get('neu')).toBe('1');
    expect(parseNachforderungVorbelegung(params(pfad))).toEqual(teil);
  });

  it('eine gesetzte, aber unbrauchbare Anzahl verwirft auch die Teil-Vorbelegung', () => {
    const p = params(nachforderungenPfad(E, { vorbelegung: { art: 'Material' } }));
    p.set('anzahl', '0');
    expect(parseNachforderungVorbelegung(p)).toBeNull();
  });
});
