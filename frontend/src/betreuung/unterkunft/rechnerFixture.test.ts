import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nutzflaeche, rechne, type Eingabe } from './rechnerKern';
import { mitOverrides } from './richtwerte';

/**
 * Gemeinsame Testfälle (LLH-1520, design.md D1): `tests/fixtures/unterkunft/faelle.json`. Dieselbe
 * Datei liest später der Rust-Kern der Rechner-API (LLH-1524); ändert eine Seite die Rechnung ohne
 * die Datei, wird ihre Suite rot.
 */
const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../tests/fixtures/unterkunft/faelle.json',
    ),
    'utf8',
  ),
) as {
  faelle: {
    name: string;
    bezug: string;
    eingabe: Eingabe;
    richtwerte: Record<string, number>;
    erwartet: unknown;
  }[];
};

describe('Rechenkern Unterkunft gegen die gemeinsamen Fälle', () => {
  it.each(fixture.faelle.map((f) => [f.name, f] as const))('%s', (_name, fall) => {
    expect(rechne(fall.eingabe, mitOverrides(fall.richtwerte))).toEqual(fall.erwartet);
  });

  it('deckt jeden Weg, beide Trennungen und jeden Befund W1–W9 ab', () => {
    const wege = new Set(fixture.faelle.map((f) => `${f.eingabe.weg}:${f.eingabe.trennung}`));
    for (const weg of ['personen', 'raeume', 'flaeche', 'zelte']) {
      expect(wege).toContain(`${weg}:true`);
      expect(wege).toContain(`${weg}:false`);
    }
    const bezuege = fixture.faelle.map((f) => f.bezug).join(' ');
    for (let i = 1; i <= 9; i++) expect(bezuege).toMatch(new RegExp(`W${i}\\b`));
  });
});

describe('Spec-Szenarien', () => {
  it('50 Männer und 50 Frauen mit den Basiswerten', () => {
    const e = rechne(
      { weg: 'personen', trennung: true, personen: { maenner: 50, frauen: 50 } },
      mitOverrides(),
    );
    expect(e.schlafen.flaeche_m2).toBe(400);
    expect(e.material.feldbetten).toBe(100);
    expect(e.sanitaer).toEqual({ toiletten: 6, urinale: 4, waschplaetze: 20, duschen: 6 });
    expect(e.versorgung.wasser_l_tag).toBe(2500);
  });

  it('zwei Räume mit Abzug ergeben 48 + 22 = 70 Plätze', () => {
    const e = rechne(
      {
        weg: 'raeume',
        trennung: false,
        raeume: [
          { laenge_m: 15, breite_m: 13.5, abzuege: [{ laenge_m: 4, breite_m: 2.5 }] },
          { laenge_m: 12, breite_m: 8, abzuege: [{ laenge_m: 3, breite_m: 2 }] },
        ],
      },
      mitOverrides(),
    );
    expect(e.kapazitaet?.raeume?.map((r) => r.plaetze)).toEqual([48, 22]);
    expect(e.kapazitaet?.plaetze).toBe(70);
  });

  it('Nutzfläche ist nie negativ', () => {
    expect(nutzflaeche({ laenge_m: 2, breite_m: 2, abzuege: [{ laenge_m: 3, breite_m: 3 }] })).toBe(
      0,
    );
  });

  it('ein fehlender Richtwert ist ein Fehler, keine stille 0', () => {
    const rw = mitOverrides();
    delete rw.dusche_je_personen;
    expect(() =>
      rechne({ weg: 'personen', trennung: false, personen: { gesamt: 10 } }, rw),
    ).toThrow('dusche_je_personen');
  });
});
