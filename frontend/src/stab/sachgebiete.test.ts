import { describe, expect, it } from 'vitest';
import { modulRegistry } from '../einsatz/modulRegistry';
import { SACHGEBIETE } from './sachgebiete';

describe('SACHGEBIETE', () => {
  it('führt genau die sechs Sachgebiete in Anlage-2-Reihenfolge', () => {
    expect(SACHGEBIETE.map((s) => s.sachgebiet)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(SACHGEBIETE.map((s) => s.kuerzel)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  /**
   * Die Labels sind DIESELBEN wie im System-ETB-Eintrag (`src/stab/mod.rs`, `Sachgebiet::label`):
   * die Zeile und der Führungsnachweis dürfen dasselbe Sachgebiet nicht verschieden benennen.
   * Literale, nicht aus dem Backend gelesen — sonst prüfte der Test die Quelle gegen sich selbst.
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

  /** Ein vertippter Schlüssel fiele sonst still aus der Werkzeugzeile — ohne Fehlerbild. */
  it('verweist nur auf existierende Registry-Module', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const s of SACHGEBIETE) {
      for (const w of s.werkzeuge) expect(keys.has(w), `${s.kuerzel}: ${w}`).toBe(true);
    }
  });

  it('S5 hat im Bestand kein Werkzeug (Spec 2.2: 0 Treffer im Repo)', () => {
    expect(SACHGEBIETE.find((s) => s.sachgebiet === 's5')!.werkzeuge).toEqual([]);
  });
});
