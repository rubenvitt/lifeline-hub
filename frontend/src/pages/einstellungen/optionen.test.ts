import { describe, expect, it } from 'vitest';
import { ROLLEN_OPTIONEN, rollenName } from './optionen';

/** Spec `modul-freigabe`, „Die Einstellungsseiten benennen die Rollenstufen eindeutig“ (LFH-1150). */
describe('ROLLEN_OPTIONEN', () => {
  it('bietet die Stufen von offen nach eng an', () => {
    expect(ROLLEN_OPTIONEN).toEqual([
      { value: '', label: 'Frei (alle)' },
      { value: 'einsatzfuehrung', label: 'Führung im Einsatz' },
      { value: 'fuehrungskraft', label: 'Führungskraft der Organisation' },
      { value: 'admin', label: 'Admin' },
    ]);
  });

  it('nennt jede gesetzte Stufe mit dem Namen der Auswahl', () => {
    expect(rollenName('einsatzfuehrung')).toBe('Führung im Einsatz');
    expect(rollenName('fuehrungskraft')).toBe('Führungskraft der Organisation');
    expect(rollenName('admin')).toBe('Admin');
    expect(rollenName(null)).toBeUndefined();
  });
});
