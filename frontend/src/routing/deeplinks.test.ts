import { describe, expect, it } from 'vitest';
import {
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
  personDetailPfad,
  tiereDetailPfad,
  schadenDetailPfad,
  tierePfad,
  parseKartenzentrum,
  parsePlatzierenAuftrag,
  personenAufnahmePfad,
  personenPfad,
  schaedenPfad,
  stabPfad,
  dokumentePfad,
  abloesungPfad,
  wetterPegelPfad,
  pegelZielPfad,
  etbPfad,
  parseEtbFilter,
  parsePersonenSicht,
  personalPfad,
  einheitenPfad,
  fahrzeugePfad,
  parseFahrzeugeAnsicht,
  einsatzabschnittePfad,
  meldungenPfad,
  auftraegePfad,
  gefahrenPfad,
  lagekartePfad,
  einsatzdatenPfad,
  einsatzEinstellungenPfad,
  EINSTELLUNGEN_SEKTIONEN,
  erinnerungenPfad,
  kraefteuebersichtPfad,
  parseRouteId,
  ueberblickPfad,
} from './deeplinks';

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
  /**
   * Die Schnellerfassung der UHS-Liste (LFH-331 · B3). `UnfallhilfsstellenPage` liest
   * `?neu=1` seit je, der Builder konnte den Param aber nicht bauen — jeder Aufrufer
   * musste ihn danebenschreiben. Der Schalter ist damit KEIN toter: er hat eine Seite,
   * die ihn liest.
   */
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
  it('lageberichtePfad', () => {
    expect(lageberichtePfad(E)).toBe('/einsaetze/5/lageberichte');
  });
  it('tierePfad (Liste / NaN-Redirect-Ziel)', () => {
    expect(tierePfad(E)).toBe('/einsaetze/5/tiere');
  });
  it('erinnerungenPfad zeigt auf die Erinnerungen-Liste', () => {
    expect(erinnerungenPfad(7)).toBe('/einsaetze/7/erinnerungen');
  });
  /**
   * Die aggregierende Kräfteübersicht (LFH-338 · C3, Befund H21). Sie war bis dahin von
   * KEINER der vier Kräfte-Modulseiten verlinkt — es gab schlicht keinen Builder, und ein
   * Inline-Literal wäre an dieser Datei vorbeigelaufen.
   */
  it('kraefteuebersichtPfad', () => {
    expect(kraefteuebersichtPfad(E)).toBe('/einsaetze/5/kraefteuebersicht');
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
    // „karte" ist seit LFH-613 eine Ansicht (Kartenansicht der Betroffenen).
    expect(parsePersonenSicht(new URLSearchParams('ansicht=karte'))).toEqual({ ansicht: 'karte' });
    expect(parsePersonenSicht(new URLSearchParams(''))).toEqual({});
  });
  it('lagekartePfad mit Platzier-Auftrag', () => {
    /*
     * Der Doppelpunkt steht seit LFH-342 als `%3A` in der URL: `mitQuery` kodiert die
     * Werte, seit der ETB-Volltextfilter Freitext durchreicht. Das ist die EINZIGE
     * Bestandsstelle, an der die Kodierung nicht die Identität ist — und sie ist
     * unschädlich, weil der Aufrufer den Wert über `searchParams.get()` liest, das
     * dekodiert. Die tragende Zusicherung ist deshalb der Round-Trip darunter, nicht
     * das rohe Zeichen in der Zeile hier.
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
    expect(parsePlatzierenAuftrag('tier:7')).toBeNull();
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
  it('stabPfad mit neu hängt ?neu=1 an', () => {
    expect(stabPfad(E, { neu: true })).toBe('/einsaetze/5/stab?neu=1');
    expect(stabPfad(E, { neu: false })).toBe('/einsaetze/5/stab');
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
  it('meldungenPfad mit ?meldung=', () => {
    expect(meldungenPfad(E, { meldung: 11 })).toBe('/einsaetze/5/meldungen?meldung=11');
  });
  it('auftraegePfad mit ?auftrag=', () => {
    expect(auftraegePfad(E, { auftrag: 13 })).toBe('/einsaetze/5/auftraege?auftrag=13');
  });
  it('auftraegePfad ohne Optionen', () => {
    expect(auftraegePfad(E)).toBe('/einsaetze/5/auftraege');
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
    // Dieselbe Regel wie bei `parsePlatzierenAuftrag` (LFH-340 · C5): ein unbrauchbarer
    // Wert ergibt keinen Filter auf diesen Wert, sondern gar keinen.
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

  it('liefert für eine leere Query ein leeres Filterobjekt', () => {
    // Trägt die Gegenaussage zu `filterAktiv` in `EtbPage`: ohne Parameter ist kein
    // Filter gesetzt, und der leer-OHNE-Filter-Zweig aus B3 greift.
    expect(parseEtbFilter(new URLSearchParams(''))).toEqual({});
  });
});

describe('einsatzEinstellungenPfad (LFH-345 · C10, H15/M15)', () => {
  it('zeigt ohne Sektion auf den Einstieg — der bare Modulpfad leitet dorthin um', () => {
    expect(einsatzEinstellungenPfad(E)).toBe('/einsaetze/5/einstellungen/allgemein');
  });

  it('baut alle fünf Sektionen', () => {
    expect(einsatzEinstellungenPfad(E, 'allgemein')).toBe('/einsaetze/5/einstellungen/allgemein');
    expect(einsatzEinstellungenPfad(E, 'verhalten')).toBe('/einsaetze/5/einstellungen/verhalten');
    expect(einsatzEinstellungenPfad(E, 'aufbewahrung')).toBe(
      '/einsaetze/5/einstellungen/aufbewahrung',
    );
    expect(einsatzEinstellungenPfad(E, 'module')).toBe('/einsaetze/5/einstellungen/module');
    expect(einsatzEinstellungenPfad(E, 'pegel')).toBe('/einsaetze/5/einstellungen/pegel');
  });

  /**
   * Die Liste ist die Wahrheit für das Tab-Band UND für die Routentabelle. Ein Pin auf ihre
   * Reihenfolge, weil das erste Element zugleich das Ziel des baren Pfades ist: eine
   * Umsortierung ohne diesen Test verschöbe stillschweigend den Einstieg.
   */
  it('führt die Sektionen in Bedienreihenfolge; die erste ist das Redirect-Ziel', () => {
    expect(EINSTELLUNGEN_SEKTIONEN.map((s) => s.key)).toEqual([
      'allgemein',
      'verhalten',
      'aufbewahrung',
      'module',
      'pegel',
    ]);
    expect(einsatzEinstellungenPfad(E, EINSTELLUNGEN_SEKTIONEN[0].key)).toBe(
      einsatzEinstellungenPfad(E),
    );
  });
});
