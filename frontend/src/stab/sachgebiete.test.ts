import { describe, expect, it } from 'vitest';
import { modulRegistry } from '../einsatz/modulRegistry';
import { mitWirksamemLabel, SACHGEBIETE } from './sachgebiete';
import { unterseitenFuer } from './unterseiten';

describe('SACHGEBIETE', () => {
  it('führt genau die sechs Sachgebiete in Anlage-2-Reihenfolge', () => {
    expect(SACHGEBIETE.map((s) => s.sachgebiet)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(SACHGEBIETE.map((s) => s.kuerzel)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  /**
   * Die Labels sind DIESELBEN wie im System-ETB-Eintrag (`Sachgebiet::label`). Literale, sonst
   * prüfte der Test die Quelle gegen sich selbst.
   */
  it('benennt die Sachgebiete wie der System-ETB-Eintrag', () => {
    expect(SACHGEBIETE.map((s) => s.label)).toEqual([
      'Personal',
      'Lage',
      'Einsatz',
      'Versorgung',
      'Presse- und Medienarbeit',
      'Information und Kommunikation',
    ]);
  });

  it('trägt je Zeile einen Aufgaben-Kurztext mit Seite aus Anlage 2 (S. 55–60)', () => {
    SACHGEBIETE.forEach((s, i) => {
      expect(s.aufgaben.length).toBeGreaterThan(0);
      expect(s.seite).toBe(55 + i);
    });
  });

  /** Ein vertippter Schlüssel fiele sonst still aus der Kachel — ohne Fehlerbild. */
  it('verweist nur auf existierende Registry-Module und Unterseiten', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const s of SACHGEBIETE) {
      const seiten = new Set(unterseitenFuer(s.sachgebiet).map((u) => u.key));
      for (const w of s.werkzeuge) {
        const bekannt = w.art === 'modul' ? keys.has(w.key) : seiten.has(w.key);
        expect(bekannt, `${s.kuerzel}: ${w.art} ${w.key}`).toBe(true);
      }
    }
  });

  /** Literale je Kachel, damit ein stiller Tausch auffällt (design.md D2, LLH-1124). */
  const keysVon = (sg: string) =>
    SACHGEBIETE.find((s) => s.sachgebiet === sg)!.werkzeuge.map((w) => w.key);

  it('S1 und S4 führen beide Nachforderungen', () => {
    expect(keysVon('s1')).toEqual([
      'personal',
      'einheiten',
      'bereitstellungsraeume',
      'nachforderungen',
    ]);
    expect(keysVon('s4')).toEqual(['nachforderungen', 'verpflegung', 'material']);
  });

  it('S2 und S3 führen ihre Arbeitsmodule', () => {
    expect(keysVon('s2')).toEqual(['lagekarte', 'lagemeldungen', 'etb']);
    expect(keysVon('s3')).toEqual(['einsatzabschnitte', 'auftraege', 'meldungen']);
  });

  it('S5 führt Pressearbeit und Informationstelefon als Unterseiten', () => {
    expect(SACHGEBIETE.find((s) => s.sachgebiet === 's5')!.werkzeuge).toEqual([
      { art: 'seite', key: 'presse' },
      { art: 'seite', key: 'infotelefon' },
    ]);
  });

  it('S6 führt die vier Fernmelde-Einstiege in dieser Reihenfolge, keine Module anderer Sachgebiete', () => {
    const s6 = SACHGEBIETE.find((s) => s.sachgebiet === 's6')!.werkzeuge;
    expect(s6.every((w) => w.art === 'seite')).toBe(true);
    expect(s6.map((w) => w.key)).toEqual([
      'funkplan',
      'fernmeldeskizze',
      'sprechgruppen',
      'kommunikationsplan',
    ]);
  });
});

describe('mitWirksamemLabel (LFH-549)', () => {
  it('nimmt das Mandantenlabel aus dem Katalog, sonst das Standardlabel', () => {
    const zeilen = mitWirksamemLabel([
      {
        funktion: 's4',
        kuerzel: 'S4',
        label: 'Versorgung (Logistik)',
        standard_label: 'Versorgung',
        art: 'sachgebiet',
        bezeichnung_pflicht: false,
      },
    ]);
    expect(zeilen.find((z) => z.sachgebiet === 's4')?.label).toBe('Versorgung (Logistik)');
    expect(zeilen.find((z) => z.sachgebiet === 's2')?.label).toBe('Lage');
    expect(mitWirksamemLabel([]).map((z) => z.label)).toEqual(SACHGEBIETE.map((z) => z.label));
  });
});
