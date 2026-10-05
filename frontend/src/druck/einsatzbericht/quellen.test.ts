import { describe, expect, it } from 'vitest';
import type { ModulFreigaben } from '../../api/types';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { freigabenFixture } from '../../test/fixtures';
import { STANDARDUMFANG } from './auswahl';
import { BLOECKE, QUELLEN, berichtFreigabe } from './quellen';

/**
 * Die Freigaben rechnet der Server je Benutzer aus (LFH-669: Override, Rolle, Org-Vorgabe):
 * `sichtbar` = im Einsatz eingeblendet, `zugriff` = für DIESEN Benutzer abrufbar. Eine
 * Rollensperre kommt hier also als `zugriff: false` an, nicht als Rolle plus Override.
 */

describe('QUELLEN', () => {
  it('nennt nur Modul-Keys, die es in der Registry gibt', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const q of QUELLEN) {
      if (q.modul != null) expect(keys, q.schluessel).toContain(q.modul);
    }
  });

  it('ordnet jede Quelle mindestens einem Block zu, und jeder Block hat eine Quelle', () => {
    const bloecke = new Set(BLOECKE.map((b) => b.schluessel));
    for (const q of QUELLEN) {
      expect(q.bloecke.length, q.schluessel).toBeGreaterThan(0);
      for (const b of q.bloecke) expect(bloecke).toContain(b);
    }
    const ohneQuelle = BLOECKE.filter(
      (b) => !QUELLEN.some((q) => q.bloecke.includes(b.schluessel)),
    );
    expect(ohneQuelle).toEqual([]);
  });

  it('die Anlagen schöpfen aus der Kräfte-Zeitachse (LFH-902, design.md D2)', () => {
    const quellenVon = (b: string) =>
      QUELLEN.filter((q) => q.bloecke.includes(b as never)).map((q) => q.schluessel);
    expect(quellenVon('einheiten-zeiten')).toEqual(['einsatz', 'einheiten', 'einheitenPerioden']);
    expect(quellenVon('personal-kopf')).toEqual([
      'einsatz',
      'einheiten',
      'personal',
      'personalPerioden',
    ]);
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
      'Anlage Einheiten mit Einsatzzeiten',
      'Anlage Personal je Kopf',
    ]);
  });
});

describe('berichtFreigabe', () => {
  it('ruft bei freien Modulen jede Quelle ab', () => {
    const f = berichtFreigabe(freigabenFixture());
    expect(Object.values(f.je).every((z) => z === 'abrufen')).toBe(true);
    expect(f.gesperrteModule).toEqual([]);
  });

  it('ein im Einsatz ausgeblendetes Modul ist „nicht genutzt“ und sperrt nicht', () => {
    const f = berichtFreigabe(freigabenFixture({ betreuung: { sichtbar: false } }));
    expect(f.je.betreuung).toBe('nicht-genutzt');
    expect(f.gesperrteModule).toEqual([]);
  });

  it('ein Modul ohne Zugriff (Rolle oder Org-Vorgabe) sperrt den Bericht', () => {
    const f = berichtFreigabe(freigabenFixture({ personen: { zugriff: false } }));
    expect(f.je.personen).toBe('gesperrt');
    expect(f.gesperrteModule).toEqual(['Personen']);
  });

  it('nennt ein gesperrtes Modul mit mehreren Quellen genau einmal', () => {
    const f = berichtFreigabe(
      freigabenFixture({ personal: { zugriff: false }, etb: { zugriff: false } }),
    );
    expect(f.je.personal).toBe('gesperrt');
    expect(f.je.personalPerioden).toBe('gesperrt');
    expect(f.je.etbZaehler).toBe('gesperrt');
    expect(f.je.etbEntscheidungen).toBe('gesperrt');
    expect(f.gesperrteModule).toEqual(['Personal', 'ETB']);
  });

  it('ausgeblendet geht vor gesperrt', () => {
    const f = berichtFreigabe(freigabenFixture({ schaeden: { sichtbar: false, zugriff: false } }));
    expect(f.je.schaeden).toBe('nicht-genutzt');
    expect(f.gesperrteModule).toEqual([]);
  });

  it('ein Modul ohne Eintrag in den Freigaben sperrt (unbekannt gibt nichts frei)', () => {
    const freigaben: ModulFreigaben = freigabenFixture();
    delete freigaben.personen;
    const f = berichtFreigabe(freigaben);
    expect(f.je.personen).toBe('gesperrt');
    expect(f.gesperrteModule).toEqual(['Personen']);
  });

  it('Einsatz und Mitglieder hängen an keinem Modul und werden immer abgerufen', () => {
    const alleAus = Object.fromEntries(
      modulRegistry.map((m) => [m.key, { sichtbar: false, zugriff: false }]),
    ) as ModulFreigaben;
    const f = berichtFreigabe(alleAus);
    expect(f.je.einsatz).toBe('abrufen');
    expect(f.je.mitglieder).toBe('abrufen');
  });
});

describe('berichtFreigabe mit Auswahl (LFH-902, design.md D3)', () => {
  it('ohne Auswahl gilt der Standardumfang, die Anlagen-Quellen bleiben trotzdem abgerufen', () => {
    // Personal und Einheiten speisen auch den Block Kräfte.
    const f = berichtFreigabe(freigabenFixture());
    expect(f.je.personal).toBe('abrufen');
    expect(f.je.einheitenPerioden).toBe('abrufen');
  });

  it('ein gesperrtes Modul eines gewählten Blocks sperrt', () => {
    const f = berichtFreigabe(freigabenFixture({ personen: { zugriff: false } }), [
      'stammdaten',
      'bilanz',
    ]);
    expect(f.gesperrteModule).toEqual(['Personen']);
  });

  it('ein gesperrtes Modul eines abgewählten Blocks sperrt nicht und wird nicht abgerufen', () => {
    const f = berichtFreigabe(
      freigabenFixture({ personen: { zugriff: false } }),
      STANDARDUMFANG.filter((b) => b !== 'bilanz'),
    );
    expect(f.je.personen).toBe('nicht-gewaehlt');
    expect(f.je.schaeden).toBe('nicht-gewaehlt');
    expect(f.gesperrteModule).toEqual([]);
  });

  it('nur die Personal-Anlage: Einsatz, Einheiten und Personal, sonst nichts', () => {
    const f = berichtFreigabe(freigabenFixture(), ['personal-kopf']);
    const abgerufen = QUELLEN.filter((q) => f.je[q.schluessel] === 'abrufen').map(
      (q) => q.schluessel,
    );
    expect(abgerufen).toEqual(['einsatz', 'einheiten', 'personal', 'personalPerioden']);
  });

  it('der Einsatz wird bei jeder Auswahl abgerufen', () => {
    const f = berichtFreigabe(freigabenFixture(), ['etb']);
    expect(f.je.einsatz).toBe('abrufen');
    expect(f.je.mitglieder).toBe('nicht-gewaehlt');
  });
});
