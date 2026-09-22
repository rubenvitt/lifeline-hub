import { describe, expect, it } from 'vitest';
import type { Uhs } from '../api/types';
import { loeseBefehl, loeseUhsAuf, nameAus, parsePersonBefehl } from './personBefehl';

/**
 * Der Parser der Betroffenen-Zeile. Jede Aussage über ein Kürzel steht mit ihrer
 * Gegenhälfte: dass etwas erkannt wird, belegt nur dann etwas, wenn Ähnliches NICHT erkannt
 * wird (sonst wäre ein Parser grün, der alles als Namen führt oder alles als Kürzel).
 */

function uhs(id: number, bezeichnung: string, extra: Partial<Uhs> = {}): Uhs {
  return {
    id,
    einsatz_id: 1,
    bezeichnung,
    typ: 'uhs',
    status: 'aktiv',
    erfasst_at: '2026-05-27 09:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-05-27 09:00:00',
    geaendert_von: 1,
    ...extra,
  } as Uhs;
}

describe('parsePersonBefehl — das Beispiel des Entwurfs', () => {
  it('zerlegt „Kowalski, Anna w 34 sk3" in Name, Geschlecht+Alter und Sichtung', () => {
    const b = parsePersonBefehl('Kowalski, Anna w 34 sk3');
    expect(b.probleme).toEqual([]);
    expect(b.eingabe).toEqual({
      name: 'Kowalski',
      vorname: 'Anna',
      geschlecht: 'weiblich',
      alter_geschaetzt: 34,
      sichtung: 'sk3',
    });
    expect(b.teile.map((t) => t.art)).toEqual(['name', 'geschlecht', 'sichtung']);
    expect(b.teile[1]).toMatchObject({ text: 'w 34', alter: 34 });
  });

  it('ist reihenfolgeunabhängig', () => {
    const a = parsePersonBefehl('sk3 w 34 Kowalski, Anna');
    const b = parsePersonBefehl('w 34 Kowalski, Anna sk3');
    expect(a.eingabe).toEqual(b.eingabe);
    expect(a.eingabe).toEqual(parsePersonBefehl('Kowalski, Anna w 34 sk3').eingabe);
    // Der Name steht als EIN Teil an seiner ersten Stelle.
    expect(a.teile.map((t) => t.art)).toEqual(['sichtung', 'geschlecht', 'name']);
  });
});

describe('Name', () => {
  it('trennt „Nachname, Vorname" am Komma', () => {
    expect(nameAus('Kowalski, Anna')).toEqual({ name: 'Kowalski', vorname: 'Anna' });
    expect(nameAus('von der Heide, Eva Maria')).toEqual({
      name: 'von der Heide',
      vorname: 'Eva Maria',
    });
  });

  it('führt ohne Komma alles als Nachnamen', () => {
    expect(nameAus('Kowalski')).toEqual({ name: 'Kowalski', vorname: null });
  });

  it('kennt „unbekannt" und „?" als ausdrücklich keinen Namen', () => {
    expect(parsePersonBefehl('unbekannt m ~50 sk1').eingabe).toEqual({
      geschlecht: 'maennlich',
      alter_geschaetzt: 50,
      sichtung: 'sk1',
    });
    expect(nameAus('?')).toEqual({ name: null, vorname: null });
  });

  it('behält einen einzelnen Namensteil (Vorname ohne Nachnamen)', () => {
    expect(nameAus(', Anna')).toEqual({ name: null, vorname: 'Anna' });
  });
});

describe('Geschlecht und Alter', () => {
  it.each([
    ['w 34', 'weiblich', 34],
    ['m ~50', 'maennlich', 50],
    ['d 7', 'divers', 7],
    ['W34', 'weiblich', 34],
    ['m~50', 'maennlich', 50],
  ])('„%s" → %s, %i Jahre', (text, geschlecht, alter) => {
    const b = parsePersonBefehl(text);
    expect(b.eingabe).toEqual({ geschlecht, alter_geschaetzt: alter });
    expect(b.probleme).toEqual([]);
  });

  it('nimmt Geschlecht ohne Alter und Alter ohne Geschlecht', () => {
    expect(parsePersonBefehl('Meier w').eingabe).toEqual({ name: 'Meier', geschlecht: 'weiblich' });
    expect(parsePersonBefehl('Meier ~8').eingabe).toEqual({ name: 'Meier', alter_geschaetzt: 8 });
  });

  it('führt ein Wort mit mehr als einem Buchstaben nicht als Geschlecht', () => {
    // Gegenhälfte: „Mw" oder „mw" sind Namensteile, keine Kürzel.
    expect(parsePersonBefehl('Mw').eingabe).toEqual({ name: 'Mw' });
  });

  it('meldet ein Alter außerhalb 0–120 und sendet dann nicht', () => {
    expect(parsePersonBefehl('w 200').probleme).toEqual(['Alter außerhalb 0–120 („w 200")']);
    expect(parsePersonBefehl('150').probleme).toHaveLength(1);
  });

  it('meldet doppelte Angaben', () => {
    expect(parsePersonBefehl('w 34 m').probleme).toEqual(['Geschlecht doppelt angegeben („m")']);
    expect(parsePersonBefehl('34 40').probleme).toEqual(['Alter doppelt angegeben („40")']);
  });
});

describe('Sichtung', () => {
  it.each([
    ['sk1', 'sk1'],
    ['sk2', 'sk2'],
    ['sk3', 'sk3'],
    ['sk4', 'sk4'],
    ['skt', 'tot'],
    ['sku', 'unverletzt'],
    ['SK1', 'sk1'],
    ['SKIII', 'sk3'],
    ['SK III', 'sk3'],
    ['sk iv', 'sk4'],
    ['SK 2', 'sk2'],
    ['SK I', 'sk1'],
  ])('„%s" → %s', (text, kategorie) => {
    const b = parsePersonBefehl(text);
    expect(b.eingabe).toEqual({ sichtung: kategorie });
    expect(b.teile).toEqual([{ art: 'sichtung', text, wert: kategorie }]);
  });

  it.each(['sk5', 'skx', 'skiiii', 'sk'])('führt „%s" NICHT als Sichtung', (text) => {
    const b = parsePersonBefehl(text);
    expect(b.eingabe.sichtung).toBeUndefined();
  });

  it('meldet eine zweite Sichtung, statt die erste still zu überschreiben', () => {
    const b = parsePersonBefehl('sk1 sk3');
    expect(b.eingabe.sichtung).toBe('sk1');
    expect(b.probleme).toEqual(['Sichtung doppelt angegeben („sk3")']);
  });
});

describe('Koordinate und Unerkanntes', () => {
  it('schluckt „#…" nicht als Namen, sondern meldet es (LFH-613)', () => {
    const b = parsePersonBefehl('Kowalski #52.2691/9.1342 sk3');
    expect(b.eingabe.name).toBe('Kowalski');
    expect(b.teile).toContainEqual({
      art: 'unerkannt',
      text: '#52.2691/9.1342',
      grund: 'keine Koordinate an der Person',
    });
    expect(b.probleme).toHaveLength(1);
  });

  it('ist bei nur Leerraum leer und ohne Problem', () => {
    const b = parsePersonBefehl('   ');
    expect(b.leer).toBe(true);
    expect(b.probleme).toEqual([]);
    expect(b.teile).toEqual([]);
  });
});

describe('Unfallhilfsstelle', () => {
  it('nimmt nach „@" alle Wörter bis zum nächsten Kürzel', () => {
    const b = parsePersonBefehl('Bauer, Lena @UHS Weserstadion w 8 sk3');
    expect(b.uhsSuche).toBe('UHS Weserstadion');
    expect(b.eingabe).toEqual({
      name: 'Bauer',
      vorname: 'Lena',
      geschlecht: 'weiblich',
      alter_geschaetzt: 8,
      sichtung: 'sk3',
    });
  });

  it('führt Zahlen in der Bezeichnung als Teil des Namens der Stelle', () => {
    const b = parsePersonBefehl('@UHS 2 sk3');
    expect(b.uhsSuche).toBe('UHS 2');
    expect(b.eingabe).toEqual({ sichtung: 'sk3' });
  });

  it('meldet ein nacktes „@"', () => {
    expect(parsePersonBefehl('Meier @').probleme).toEqual([
      '„@" ohne Bezeichnung der Unfallhilfsstelle',
    ]);
  });
});

describe('loeseUhsAuf', () => {
  const liste = [
    uhs(1, 'Weserstadion'),
    uhs(2, 'UHS Nord'),
    uhs(3, 'UHS Nordhafen'),
    uhs(4, 'Altstadt', { status: 'aufgeloest' }),
  ];

  it('trifft eindeutig, auch mit oder ohne „UHS"', () => {
    expect(loeseUhsAuf('weserstadion', liste)).toEqual({ uhs: liste[0] });
    expect(loeseUhsAuf('UHS Weserstadion', liste)).toEqual({ uhs: liste[0] });
    expect(loeseUhsAuf('weser', liste)).toEqual({ uhs: liste[0] });
  });

  it('bevorzugt den exakten Treffer vor dem Teilwort', () => {
    // „Nord" steckt in beiden, heißt aber genau eine.
    expect(loeseUhsAuf('Nord', liste)).toEqual({ uhs: liste[1] });
  });

  it('rät bei Mehrdeutigkeit nicht', () => {
    expect(loeseUhsAuf('Nor', liste)).toEqual({
      problem: '„Nor" ist mehrdeutig (2 Unfallhilfsstellen)',
    });
  });

  it('bietet eine aufgelöste Stelle nicht an', () => {
    expect(loeseUhsAuf('Altstadt', liste)).toEqual({
      problem: 'Keine Unfallhilfsstelle „Altstadt"',
    });
  });
});

describe('loeseBefehl', () => {
  const liste = [uhs(7, 'Weserstadion')];

  it('setzt uhs_id im selben Anlagesatz', () => {
    const e = loeseBefehl(parsePersonBefehl('Kowalski sk3 @Weser'), liste);
    expect(e).toEqual({
      ok: true,
      eingabe: { name: 'Kowalski', sichtung: 'sk3', uhs_id: 7 },
      uhs: liste[0],
    });
  });

  it('sendet ohne „@" kein uhs_id', () => {
    const e = loeseBefehl(parsePersonBefehl('Kowalski sk3'), liste);
    expect(e.ok && e.eingabe).not.toHaveProperty('uhs_id');
  });

  it('sendet bei unbekannter Stelle nicht', () => {
    expect(loeseBefehl(parsePersonBefehl('Kowalski @Mars'), liste)).toEqual({
      ok: false,
      probleme: ['Keine Unfallhilfsstelle „Mars"'],
    });
  });

  it('liefert für leere Eingabe „nicht senden" OHNE Grund', () => {
    expect(loeseBefehl(parsePersonBefehl(''), liste)).toEqual({ ok: false, probleme: [] });
  });

  it('sendet eine Person ganz ohne Angaben außer der Sichtung', () => {
    // An der Aufnahme ist die Kategorie oft das Einzige, was man weiß.
    expect(loeseBefehl(parsePersonBefehl('sk1'), liste)).toEqual({
      ok: true,
      eingabe: { sichtung: 'sk1' },
      uhs: null,
    });
  });
});
