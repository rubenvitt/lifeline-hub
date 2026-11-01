import { describe, expect, it } from 'vitest';
import { postenAus } from './posten';
import { rechne } from './rechnerKern';
import { basisRichtwerte } from './richtwerte';

/** Posten für „Nachforderungen anlegen“ (LLH-1520, design.md D6). */
describe('postenAus', () => {
  const rw = basisRichtwerte();

  it('nennt je Bedarf einen Posten mit Anzahl; vorausgewählt sind Betten, Decken, Toiletten, Waschplätze', () => {
    const p = postenAus(
      rechne({ weg: 'personen', trennung: false, personen: { gesamt: 100 } }, rw),
    );
    expect(p.map((x) => [x.art, x.anzahl, x.vorgewaehlt])).toEqual([
      ['Feldbetten', 100, true],
      ['Decken', 200, true],
      ['Mobile Toiletten', 5, true],
      ['Urinale', 4, false],
      ['Waschplätze', 20, true],
      ['Duschen', 5, false],
      ['Biergarnituren', 5, false],
      ['Wasser', 2500, false],
      ['Zelt SG 20', 1, false],
      ['Zelt SG 50', 7, false],
    ]);
    expect(p.find((x) => x.schluessel === 'wasser')?.bezeichnung).toBe('Liter je Tag');
    expect(p.find((x) => x.schluessel === 'zelt_sg50')?.bezeichnung).toBe('Schlafzelt');
  });

  it('beim Weg Zelte stehen die Zelte schon: kein Zeltmix als Posten', () => {
    const p = postenAus(
      rechne({ weg: 'zelte', trennung: false, zelte: { gesamt: { sg50: 2 } } }, rw),
    );
    expect(p.some((x) => x.schluessel.startsWith('zelt_'))).toBe(false);
    expect(p.find((x) => x.schluessel === 'feldbetten')?.anzahl).toBe(28);
  });

  it('ohne Personen gibt es keine Posten', () => {
    expect(postenAus(rechne({ weg: 'personen', trennung: false, personen: {} }, rw))).toEqual([]);
  });
});
