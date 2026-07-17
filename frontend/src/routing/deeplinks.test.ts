import { describe, expect, it } from 'vitest';
import {
  einsatzModulPfad,
  uhsDetailPfad,
  unfallhilfsstellenListePfad,
  bereitstellungsraumDetailPfad,
  bereitstellungsraeumePfad,
  lageberichtDetailPfad,
  lageberichtePfad,
  befehlDetailPfad,
  personDetailPfad,
  tiereDetailPfad,
  schadenDetailPfad,
  tierePfad,
  personenPfad,
  schaedenPfad,
  etbPfad,
  personalPfad,
  einheitenPfad,
  fahrzeugePfad,
  einsatzabschnittePfad,
  meldungenPfad,
  auftraegePfad,
  gefahrenPfad,
  lagekartePfad,
  einsatzdatenPfad,
  erinnerungenPfad,
  parseRouteId,
} from './deeplinks';

const E = 5; // einsatzId

describe('deeplinks — Basis', () => {
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
  it('bereitstellungsraeumePfad', () => {
    expect(bereitstellungsraeumePfad(E)).toBe('/einsaetze/5/bereitstellungsraeume');
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
  it('schaedenPfad ohne Optionen', () => {
    expect(schaedenPfad(E)).toBe('/einsaetze/5/schaeden');
  });
  it('schaedenPfad mit ?neu=1', () => {
    expect(schaedenPfad(E, { neu: true })).toBe('/einsaetze/5/schaeden?neu=1');
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
  it('einsatzabschnittePfad mit ?abschnitt=', () => {
    expect(einsatzabschnittePfad(E, { abschnitt: 2 })).toBe('/einsaetze/5/einsatzabschnitte?abschnitt=2');
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
  it('einsatzdatenPfad', () => {
    expect(einsatzdatenPfad(E)).toBe('/einsaetze/5/einsatzdaten');
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
