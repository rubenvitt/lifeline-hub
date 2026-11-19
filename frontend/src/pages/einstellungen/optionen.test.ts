import { describe, expect, it } from 'vitest';
import { ROLLEN_OPTIONEN, rollenName } from './optionen';

/** Spec `modul-freigabe`, „Die Einstellungsseiten benennen die Rollenstufen eindeutig“ (LFH-1150). */
describe('ROLLEN_OPTIONEN', () => {
  it('bietet die Stufen von offen nach eng an', () => {
    expect(ROLLEN_OPTIONEN.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: '', label: 'Frei (alle)' },
      { value: 'einsatzfuehrung', label: 'Führung im Einsatz' },
      { value: 'fuehrungskraft', label: 'Führungskraft der Organisation' },
      { value: 'admin', label: 'System-Admin' },
    ]);
    // Jede Stufe trägt ihre Darf-Zeile aus dem Vokabular (LLH-1818).
    expect(ROLLEN_OPTIONEN[0].darf).toBe('alle, die den Einsatz sehen');
    expect(ROLLEN_OPTIONEN[3].darf).toBe('nur System-Admin');
  });

  it('nennt jede gesetzte Stufe mit dem Namen der Auswahl', () => {
    expect(rollenName('einsatzfuehrung')).toBe('Führung im Einsatz');
    expect(rollenName('fuehrungskraft')).toBe('Führungskraft der Organisation');
    expect(rollenName('admin')).toBe('System-Admin');
    expect(rollenName('')).toBeUndefined();
    expect(rollenName(null)).toBeUndefined();
  });
});
