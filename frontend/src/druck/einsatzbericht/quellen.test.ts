import { describe, expect, it } from 'vitest';
import type { BenutzerAnzeige, ModulOverrides } from '../../api/types';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { adminFixture, benutzerFixture } from '../../test/fixtures';
import { BLOECKE, QUELLEN, berichtFreigabe } from './quellen';

const kraft: BenutzerAnzeige = benutzerFixture({ system_rolle: 'keiner', org_rolle: 'keine' });
const fuehrung: BenutzerAnzeige = benutzerFixture({
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
});
const admin = adminFixture();

function override(sichtbar: boolean, benoetigte_rolle: string | null = null) {
  return { sichtbar, benoetigte_rolle } as ModulOverrides[string];
}

describe('QUELLEN', () => {
  it('nennt nur Modul-Keys, die es in der Registry gibt', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const q of QUELLEN) {
      if (q.modul != null) expect(keys, q.schluessel).toContain(q.modul);
    }
  });

  it('ordnet jede Quelle einem Block zu, und jeder Block außer Zeiten hat eine eigene', () => {
    const bloecke = new Set(BLOECKE.map((b) => b.schluessel));
    for (const q of QUELLEN) expect(bloecke).toContain(q.block);
    // Zeiten liest den Einsatz mit, den die Stammdaten schon holen.
    const ohneQuelle = BLOECKE.filter((b) => !QUELLEN.some((q) => q.block === b.schluessel));
    expect(ohneQuelle.map((b) => b.schluessel)).toEqual(['zeiten']);
  });

  it('hält die Reihenfolge der Blöcke fest', () => {
    expect(BLOECKE.map((b) => b.titel)).toEqual([
      'Stammdaten',
      'Zeiten',
      'Führung',
      'Kräfte',
      'Lage',
      'Bilanz',
      'ETB-Auszug',
    ]);
  });
});

describe('berichtFreigabe', () => {
  it('ruft ohne Overrides jede Quelle ab', () => {
    const f = berichtFreigabe(kraft, {});
    expect(Object.values(f.je).every((z) => z === 'abrufen')).toBe(true);
    expect(f.gesperrteModule).toEqual([]);
  });

  it('ein im Einsatz ausgeblendetes Modul ist „nicht genutzt“ und sperrt nicht', () => {
    const f = berichtFreigabe(kraft, { betreuung: override(false) });
    expect(f.je.betreuung).toBe('nicht-genutzt');
    expect(f.gesperrteModule).toEqual([]);
  });

  it('eine Rollensperre sperrt für Einsatzkräfte, nicht für Führungskraft und Admin', () => {
    const overrides = { personen: override(true, 'fuehrungskraft') };
    const f = berichtFreigabe(kraft, overrides);
    expect(f.je.personen).toBe('gesperrt');
    expect(f.gesperrteModule).toEqual(['Personen']);
    expect(berichtFreigabe(fuehrung, overrides).je.personen).toBe('abrufen');
    expect(berichtFreigabe(admin, overrides).je.personen).toBe('abrufen');
  });

  it('nennt ein gesperrtes Modul mit mehreren Quellen genau einmal', () => {
    const f = berichtFreigabe(kraft, {
      personal: override(true, 'fuehrungskraft'),
      etb: override(true, 'admin'),
    });
    expect(f.je.personal).toBe('gesperrt');
    expect(f.je.personalPerioden).toBe('gesperrt');
    expect(f.je.etbZaehler).toBe('gesperrt');
    expect(f.je.etbEntscheidungen).toBe('gesperrt');
    expect(f.gesperrteModule).toEqual(['Personal', 'ETB']);
  });

  it('ausgeblendet geht vor gesperrt', () => {
    const f = berichtFreigabe(kraft, { schaeden: override(false, 'fuehrungskraft') });
    expect(f.je.schaeden).toBe('nicht-genutzt');
    expect(f.gesperrteModule).toEqual([]);
  });

  it('Einsatz und Mitglieder hängen an keinem Modul und werden immer abgerufen', () => {
    const alleAus = Object.fromEntries(
      modulRegistry.map((m) => [m.key, override(false, 'admin')]),
    ) as ModulOverrides;
    const f = berichtFreigabe(kraft, alleAus);
    expect(f.je.einsatz).toBe('abrufen');
    expect(f.je.mitglieder).toBe('abrufen');
  });
});
