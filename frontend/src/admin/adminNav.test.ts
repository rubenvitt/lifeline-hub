import { describe, expect, it } from 'vitest';
import {
  adminGruppen,
  adminBenutzer,
  adminSektionPfad,
  adminBenutzerPfad,
  defaultAdminPfad,
  ersteSektionPfad,
} from './adminNav';

describe('adminNav — Pfad-Builder', () => {
  it('baut Sektions- und Benutzer-Pfade', () => {
    expect(adminSektionPfad('stammdaten', 'fahrzeuge')).toBe('/admin/stammdaten/fahrzeuge');
    expect(adminSektionPfad('karten', 'offline')).toBe('/admin/karten/offline');
    expect(adminBenutzerPfad()).toBe('/admin/benutzer');
  });

  it('Default- und Gruppen-Erst-Pfade', () => {
    expect(defaultAdminPfad()).toBe('/admin/stammdaten/stichworte');
    expect(ersteSektionPfad('einstellungen')).toBe('/admin/einstellungen/anzeige');
    expect(ersteSektionPfad('karten')).toBe('/admin/karten/online');
  });
});

describe('adminNav — Registry', () => {
  it('drei Gruppen mit 16 Sektionen gesamt (Stammdaten 11)', () => {
    expect(adminGruppen.map((g) => g.key)).toEqual(['stammdaten', 'einstellungen', 'karten']);
    expect(adminGruppen.flatMap((g) => g.sektionen).length).toBe(16);
    expect(adminGruppen.find((g) => g.key === 'stammdaten')!.sektionen.length).toBe(11);
    expect(adminBenutzer.key).toBe('benutzer');
  });

  it('Sektions-Keys je Gruppe eindeutig; jede Sektion trägt ein Element', () => {
    for (const g of adminGruppen) {
      const keys = g.sektionen.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const s of g.sektionen) {
        expect(s.element).toBeTruthy();
        expect(typeof s.label).toBe('string');
      }
    }
  });
});
