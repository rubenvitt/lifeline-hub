import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { mitProzessZone } from '../test/prozessZone';
import {
  datum,
  kalendertag,
  tagUndUhrzeit,
  leereUhrzeit,
  MONATE_DTG,
  uhrzeit,
  uhrzeitOhneDatum,
  wirksameZeitdarstellung,
  zeitKurz,
  zeitpunkt,
} from './zeitDarstellung';
import type { AnzeigeKonventionen } from './format';

dayjs.extend(utc);

const BERLIN = 'Europe/Berlin';
const taktisch: AnzeigeKonventionen = { zeitzone: BERLIN, zeitdarstellung: 'taktisch' };
const datumUhrzeit: AnzeigeKonventionen = { zeitzone: BERLIN, zeitdarstellung: 'datum_uhrzeit' };

/** 10.10.2026 14:30 Europe/Berlin (Sommerzeit, UTC+2). */
const WERT = '2026-10-10 12:30:00';
/** Am selben Tag in Berlin, später. */
const JETZT_HEUTE = dayjs.utc('2026-10-10 16:00:00');
/** Am Vortag desselben Werts: 09.10.2026 14:30 Berlin. */
const WERT_VORTAG = '2026-10-09 12:30:00';

// Die Prozesszone (= Browserzone im Test) ist UTC, die Anzeigezone Berlin: so fiele jede Stelle
// auf, die in der Browserzone rechnet (`test/prozessZone.ts`).
describe('Zeitdarstellung — drei Rollen (LLH-1053, Spec `zeitdarstellung`)', () => {
  mitProzessZone('UTC');

  describe('taktisch (Vorgabe)', () => {
    it('Zeitpunkt ist die volle DTG: Tag, Uhrzeit, Monat klein, Jahr zweistellig', () => {
      expect(zeitpunkt(WERT, taktisch)).toBe('101430okt26');
    });
    it('Kurz: heute nur die Uhrzeit, am Vortag Tag und Uhrzeit', () => {
      expect(zeitKurz(WERT, taktisch, JETZT_HEUTE)).toBe('1430');
      expect(zeitKurz(WERT_VORTAG, taktisch, JETZT_HEUTE)).toBe('091430');
    });
    it('Uhrzeit ohne Doppelpunkt', () => {
      expect(uhrzeit(WERT, taktisch)).toBe('1430');
    });
    it('ohne gesetzte Darstellung gilt taktisch', () => {
      expect(zeitpunkt(WERT, { zeitzone: BERLIN })).toBe('101430okt26');
      expect(zeitpunkt(WERT, { zeitzone: BERLIN, zeitdarstellung: null })).toBe('101430okt26');
    });
  });

  describe('Datum und Uhrzeit', () => {
    it('Zeitpunkt `10.10.26 14:30`', () => {
      expect(zeitpunkt(WERT, datumUhrzeit)).toBe('10.10.26 14:30');
    });
    it('Kurz: heute `14:30`, am Vortag `09.10. 14:30`', () => {
      expect(zeitKurz(WERT, datumUhrzeit, JETZT_HEUTE)).toBe('14:30');
      expect(zeitKurz(WERT_VORTAG, datumUhrzeit, JETZT_HEUTE)).toBe('09.10. 14:30');
    });
    it('Uhrzeit `14:30`', () => {
      expect(uhrzeit(WERT, datumUhrzeit)).toBe('14:30');
    });
  });

  it('die Monatskürzel nach E1: klein, drei Buchstaben, ohne Umlaut', () => {
    expect(MONATE_DTG).toEqual([
      'jan',
      'feb',
      'mrz',
      'apr',
      'mai',
      'jun',
      'jul',
      'aug',
      'sep',
      'okt',
      'nov',
      'dez',
    ]);
    // Je Monat der 15., 10:00 UTC — weit weg von jeder Tages- oder Zonengrenze.
    const kuerzel = Array.from({ length: 12 }, (_, i) =>
      zeitpunkt(`2026-${String(i + 1).padStart(2, '0')}-15 10:00:00`, taktisch).slice(6, 9),
    );
    expect(kuerzel).toEqual([...MONATE_DTG]);
  });

  it('Monatswechsel: der Monat folgt der Anzeigezone, nicht UTC', () => {
    // 31.10. 23:30 UTC ist in Berlin (Winterzeit, UTC+1) schon der 1. November.
    expect(zeitpunkt('2026-10-31 23:30:00', taktisch)).toBe('010030nov26');
    expect(zeitpunkt('2026-10-31 23:30:00', datumUhrzeit)).toBe('01.11.26 00:30');
  });

  it('Jahreswechsel: Tag, Monat und Jahr springen gemeinsam', () => {
    expect(zeitpunkt('2026-12-31 23:15:00', taktisch)).toBe('010015jan27');
    expect(zeitpunkt('2026-12-31 23:15:00', datumUhrzeit)).toBe('01.01.27 00:15');
    // „Heute“ über die Jahresgrenze: der 31.12. ist am 1.1. ein anderer Tag.
    const neujahr = dayjs.utc('2027-01-01 08:00:00');
    expect(zeitKurz('2026-12-31 20:00:00', taktisch, neujahr)).toBe('312100');
    expect(zeitKurz('2026-12-31 20:00:00', datumUhrzeit, neujahr)).toBe('31.12. 21:00');
  });

  it('Sommerzeitgrenze: die Uhrzeit folgt dem Versatz des Augenblicks', () => {
    // 29.03.2026: 01:00 UTC springt die Berliner Uhr von 02:00 auf 03:00.
    expect(zeitpunkt('2026-03-29 00:30:00', taktisch)).toBe('290130mrz26');
    expect(zeitpunkt('2026-03-29 01:30:00', taktisch)).toBe('290330mrz26');
    // 25.10.2026: die Stunde 02:00–03:00 kommt zweimal; die DTG zeigt beide gleich.
    expect(zeitpunkt('2026-10-25 00:30:00', taktisch)).toBe('250230okt26');
    expect(zeitpunkt('2026-10-25 01:30:00', taktisch)).toBe('250230okt26');
  });

  it('„heute“ wird in der Anzeigezone bestimmt, nicht in der Browserzone', () => {
    // Jetzt: 10.10. 22:30 UTC = 11.10. 00:30 Berlin. Wert: 10.10. 21:00 UTC = 10.10. 23:00 Berlin.
    // In UTC wären beide am 10.10.; in Berlin ist der Wert von gestern.
    const jetzt = dayjs.utc('2026-10-10 22:30:00');
    expect(zeitKurz('2026-10-10 21:00:00', taktisch, jetzt)).toBe('102300');
    expect(zeitKurz('2026-10-10 22:45:00', taktisch, jetzt)).toBe('0045');
  });

  it('nimmt auch einen dayjs-Wert', () => {
    expect(zeitpunkt(dayjs.utc(WERT), taktisch)).toBe('101430okt26');
  });

  it('leer bleibt leer', () => {
    expect(zeitpunkt(null, taktisch)).toBe('');
    expect(zeitKurz(undefined, datumUhrzeit)).toBe('');
    expect(uhrzeit('', taktisch)).toBe('');
  });

  it('Datum: der Tagesteil der DTG bzw. `10.10.26`, in der Anzeigezone (LLH-1061)', () => {
    expect(datum(WERT, taktisch)).toBe('10okt26');
    expect(datum(WERT, datumUhrzeit)).toBe('10.10.26');
    // 31.10. 23:30 UTC ist in Berlin schon der 01.11.
    expect(datum('2026-10-31 23:30:00', taktisch)).toBe('01nov26');
    expect(datum(null, taktisch)).toBe('');
  });

  it('Tag und Uhrzeit ohne Heute-Prüfung, unlesbar bleibt leer', () => {
    expect(tagUndUhrzeit(WERT, taktisch)).toBe('101430');
    expect(tagUndUhrzeit(WERT, datumUhrzeit)).toBe('10.10. 14:30');
    expect(tagUndUhrzeit('Unsinn', taktisch)).toBe('');
    expect(zeitpunkt('Unsinn', taktisch)).toBe('');
  });

  it('Kalendertag ohne Zone: der gespeicherte Tag bleibt der Tag', () => {
    expect(kalendertag('2026-03-29', taktisch)).toBe('29mrz26');
    expect(kalendertag('2026-03-29', datumUhrzeit)).toBe('29.03.26');
    expect(kalendertag('2026-03-29', { zeitzone: 'Pacific/Kiritimati' })).toBe('29mrz26');
    expect(kalendertag('', taktisch)).toBe('');
    expect(kalendertag('Unsinn', taktisch)).toBe('');
  });

  it('Uhrzeit ohne Datum (LLH-1437): die Rolle „Uhrzeit“ ohne Zone, `HH:MM` vom Server', () => {
    expect(uhrzeitOhneDatum('14:30', taktisch)).toBe('1430');
    expect(uhrzeitOhneDatum('14:30', datumUhrzeit)).toBe('14:30');
    expect(uhrzeitOhneDatum('06:30', {})).toBe('0630');
    // Keine Zonenrechnung: die Wanduhrzeit IST schon die Uhrzeit.
    expect(uhrzeitOhneDatum('06:30', { zeitzone: 'Pacific/Kiritimati' })).toBe('0630');
    expect(uhrzeitOhneDatum('', datumUhrzeit)).toBe('');
    expect(uhrzeitOhneDatum(null, taktisch)).toBe('');
    // Unlesbares wird nicht umgedeutet, sondern steht, wie es kam.
    expect(uhrzeitOhneDatum('abends', datumUhrzeit)).toBe('abends');
  });

  it('der Leerwert einer Zeitspalte hat die Ziffernbreite der Darstellung', () => {
    expect(leereUhrzeit(taktisch)).toBe('————');
    expect(leereUhrzeit(datumUhrzeit)).toBe('——:——');
    expect(leereUhrzeit({})).toBe('————');
  });

  it('eine ungültige Zone crasht nicht, sondern fällt auf die Browserzone (hier UTC)', () => {
    expect(zeitpunkt(WERT, { zeitzone: 'Müll/Quatsch' })).toBe('101230okt26');
  });
});

describe('wirksameZeitdarstellung — Gerät vor Einsatz vor Organisation vor Vorgabe', () => {
  it('nimmt die erste gesetzte Stufe', () => {
    expect(
      wirksameZeitdarstellung({ geraet: 'datum_uhrzeit', einsatz: 'taktisch', org: 'taktisch' }),
    ).toBe('datum_uhrzeit');
    expect(
      wirksameZeitdarstellung({ geraet: null, einsatz: 'datum_uhrzeit', org: 'taktisch' }),
    ).toBe('datum_uhrzeit');
    expect(wirksameZeitdarstellung({ geraet: null, einsatz: null, org: 'datum_uhrzeit' })).toBe(
      'datum_uhrzeit',
    );
    expect(wirksameZeitdarstellung({})).toBe('taktisch');
  });

  it('im Druck zählt das Gerät nie (E4: ein Ausdruck ist ein Dokument der Führungsstelle)', () => {
    expect(
      wirksameZeitdarstellung({ geraet: 'datum_uhrzeit', einsatz: null, org: null, druck: true }),
    ).toBe('taktisch');
    expect(
      wirksameZeitdarstellung({ geraet: 'taktisch', einsatz: 'datum_uhrzeit', druck: true }),
    ).toBe('datum_uhrzeit');
  });
});
