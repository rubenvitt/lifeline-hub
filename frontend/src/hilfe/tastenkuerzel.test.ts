import { describe, expect, it } from 'vitest';
import { TASTATUR_AKTIONEN, TASTATUR_AKTION_REIHENFOLGE } from '../command-palette/befehle';
import { kuerzelGruppen } from './tastenkuerzel';

function ueberall(apple: boolean) {
  const gruppe = kuerzelGruppen(apple, null).find((g) => g.titel === 'Überall');
  if (!gruppe) throw new Error('Gruppe „Überall“ fehlt');
  return gruppe;
}

describe('kuerzelGruppen', () => {
  it('führt jede Tastatur-Aktion mit Tastenweg unter „Überall“', () => {
    for (const id of TASTATUR_AKTION_REIHENFOLGE) {
      const def = TASTATUR_AKTIONEN[id];
      const kuerzel = def.kuerzel(false);
      if (kuerzel === null) continue;
      const eintrag = ueberall(false).eintraege.find((e) => e.wirkung === def.label);
      expect(eintrag?.tasten).toEqual(kuerzel.split(' / '));
    }
  });

  it('zeigt am Mac ⌘, sonst Strg', () => {
    const palette = (apple: boolean) =>
      ueberall(apple).eintraege.find((e) => e.wirkung === 'Sprungpalette öffnen')?.tasten;
    expect(palette(true)).toEqual(['⌘ K']);
    expect(palette(false)).toEqual(['Strg + K']);
  });

  it('nennt ? und F1 für die Hilfe', () => {
    const hilfe = ueberall(false).eintraege.find((e) => e.wirkung === 'Hilfe zu dieser Seite');
    expect(hilfe?.tasten).toEqual(['?', 'F1']);
  });

  it('stellt die Gruppe des aktuellen Moduls an den Anfang', () => {
    expect(kuerzelGruppen(false, 'lagekarte')[0].modulKey).toBe('lagekarte');
    expect(kuerzelGruppen(false, 'etb')[0].modulKey).toBe('etb');
    expect(kuerzelGruppen(false, null)[0].titel).toBe('Überall');
    expect(kuerzelGruppen(false, 'chat')[0].titel).toBe('Überall');
  });

  it('hat keine leere Gruppe und keinen leeren Eintrag', () => {
    for (const g of kuerzelGruppen(true, null)) {
      expect(g.eintraege.length).toBeGreaterThan(0);
      for (const e of g.eintraege) expect(e.tasten.length).toBeGreaterThan(0);
    }
  });
});
