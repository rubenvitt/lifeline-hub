import { describe, expect, it } from 'vitest';
import type { Einsatzabschnitt } from '../../api/types';
import {
  abschnittZielGueltig,
  einheitVerschiebeText,
  einheitZielGueltig,
  elternSchluessel,
  gliederungKnoten,
  ohneEntfallenes,
  verschiebeText,
  verschiebeZiele,
} from './gliederungZugKern';

function abschnitt(id: number, name: string, ueber: number | null): Einsatzabschnitt {
  return { id, name, ueber_abschnitt_id: ueber } as unknown as Einsatzabschnitt;
}

// Nord ─┬─ Nord-Ost ── Nord-Ost-1
//       └─ Nord-West
// Süd
const nord = abschnitt(1, 'Nord', null);
const nordOst = abschnitt(2, 'Nord-Ost', 1);
const nordOst1 = abschnitt(3, 'Nord-Ost-1', 2);
const nordWest = abschnitt(4, 'Nord-West', 1);
const sued = abschnitt(5, 'Süd', null);
const alle = [nord, nordOst, nordOst1, nordWest, sued];

describe('abschnittZielGueltig (LFH-1212)', () => {
  it('erlaubt einen fremden Zweig und die oberste Ebene', () => {
    expect(abschnittZielGueltig(alle, nordOst.id, sued.id)).toBe(true);
    expect(abschnittZielGueltig(alle, nordOst.id, null)).toBe(true);
    expect(abschnittZielGueltig(alle, nordOst1.id, nordWest.id)).toBe(true);
  });

  it('sperrt sich selbst und jeden Nachfahren: ein Zyklus ist unmöglich', () => {
    expect(abschnittZielGueltig(alle, nord.id, nord.id)).toBe(false);
    expect(abschnittZielGueltig(alle, nord.id, nordOst.id)).toBe(false);
    expect(abschnittZielGueltig(alle, nord.id, nordOst1.id)).toBe(false);
  });

  it('sperrt den jetzigen Über-Abschnitt: der Zug änderte nichts', () => {
    expect(abschnittZielGueltig(alle, nordOst.id, nord.id)).toBe(false);
    expect(abschnittZielGueltig(alle, sued.id, null)).toBe(false);
  });

  it('sperrt einen unbekannten Abschnitt', () => {
    expect(abschnittZielGueltig(alle, 99, sued.id)).toBe(false);
  });
});

describe('einheitZielGueltig (LFH-1212)', () => {
  it('erlaubt jeden anderen Abschnitt, nicht den eigenen und nicht die oberste Ebene', () => {
    expect(einheitZielGueltig({ abschnitt_id: nord.id }, sued.id)).toBe(true);
    expect(einheitZielGueltig({ abschnitt_id: null }, sued.id)).toBe(true);
    expect(einheitZielGueltig({ abschnitt_id: nord.id }, nord.id)).toBe(false);
    expect(einheitZielGueltig({ abschnitt_id: nord.id }, null)).toBe(false);
  });
});

describe('verschiebeZiele (LFH-1212)', () => {
  it('nennt die oberste Ebene zuerst, dann die Abschnitte in Baumfolge mit Tiefe', () => {
    expect(verschiebeZiele(alle, nordOst1.id)).toEqual([
      { id: null, name: 'Oberste Ebene', tiefe: 0, jetzt: false },
      { id: nord.id, name: 'Nord', tiefe: 0, jetzt: false },
      { id: nordOst.id, name: 'Nord-Ost', tiefe: 1, jetzt: true },
      { id: nordWest.id, name: 'Nord-West', tiefe: 1, jetzt: false },
      { id: sued.id, name: 'Süd', tiefe: 0, jetzt: false },
    ]);
  });

  it('lässt den Abschnitt selbst und seine Nachfahren weg', () => {
    expect(verschiebeZiele(alle, nord.id).map((z) => z.id)).toEqual([null, sued.id]);
  });

  it('markiert die oberste Ebene als jetzigen Ort eines obersten Abschnitts', () => {
    expect(verschiebeZiele(alle, sued.id)[0]).toEqual({
      id: null,
      name: 'Oberste Ebene',
      tiefe: 0,
      jetzt: true,
    });
  });
});

describe('gliederungKnoten (LFH-1212)', () => {
  it('baut den Baum über `ueber_abschnitt_id` mit dem Abschnitt am Knoten', () => {
    const baum = gliederungKnoten(alle);
    expect(baum.map((k) => k.key)).toEqual(['1', '5']);
    expect(baum[0].kinder.map((k) => k.key)).toEqual(['2', '4']);
    expect(baum[0].kinder[0].kinder[0].abschnitt).toBe(nordOst1);
  });

  it('hängt einen Abschnitt mit unbekanntem Über-Abschnitt an die Wurzel statt ihn zu verlieren', () => {
    const waise = abschnitt(7, 'Waise', 42);
    expect(gliederungKnoten([nord, waise]).map((k) => k.key)).toEqual(['1', '7']);
  });
});

describe('verschiebeText (LFH-1212)', () => {
  it('nennt Abschnitt und Ziel', () => {
    expect(verschiebeText('Nord-Ost', 'Süd')).toBe('„Nord-Ost“ unter „Süd“ verschoben');
    expect(verschiebeText('Nord-Ost', null)).toBe('„Nord-Ost“ auf die oberste Ebene verschoben');
    expect(einheitVerschiebeText('1. Zug', 'Süd')).toBe('„1. Zug“ zu „Süd“ zugeordnet');
  });
});

describe('ohneEntfallenes (LFH-1212)', () => {
  it('nimmt Entfallenes heraus und hebt seine Kinder an seinen Platz', () => {
    const baum = gliederungKnoten(alle);
    const gezeigt = ohneEntfallenes(baum, new Set(['2']));
    expect(gezeigt.map((k) => k.key)).toEqual(['1', '5']);
    expect(gezeigt[0].kinder.map((k) => k.key)).toEqual(['3', '4']);
  });

  it('lässt ohne Entfallenes alles stehen', () => {
    const baum = gliederungKnoten(alle);
    expect(ohneEntfallenes(baum, new Set())).toEqual(baum);
  });
});

describe('elternSchluessel (LFH-1212)', () => {
  it('nennt jeden Abschnitt mit Unterabschnitten', () => {
    expect(elternSchluessel(gliederungKnoten(alle))).toEqual([1, 2]);
  });
});
