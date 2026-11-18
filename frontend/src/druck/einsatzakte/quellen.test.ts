import { describe, expect, it } from 'vitest';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { freigabenFixture } from '../../test/fixtures';
import { QUELLEN } from '../einsatzbericht/quellen';
import { AKTE_MODULE, KAPITEL, akteFreigabe } from './quellen';

describe('Einsatzakte: Module und Kapitel', () => {
  it('nennt nur Modul-Keys der Registry', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const m of AKTE_MODULE) expect(keys, m).toContain(m);
    for (const k of KAPITEL) if (k.modul) expect(AKTE_MODULE).toContain(k.modul);
  });

  it('enthält jedes Modul des vollen Einsatzberichts', () => {
    for (const q of QUELLEN) if (q.modul) expect(AKTE_MODULE, q.schluessel).toContain(q.modul);
  });

  it('hält die Reihenfolge der Kapitel fest', () => {
    expect(KAPITEL.map((k) => k.titel)).toEqual([
      'Einsatzbericht',
      'Einsatztagebuch',
      'Betroffene',
      'Aufträge',
      'Einsatzbefehle',
      'Lageberichte',
    ]);
  });
});

describe('akteFreigabe', () => {
  it('ruft bei freien Modulen jedes Kapitel ab', () => {
    const f = akteFreigabe(freigabenFixture());
    expect(f.gesperrteModule).toEqual([]);
    expect(Object.values(f.kapitel).every((z) => z === 'abrufen')).toBe(true);
  });

  it('ein gesperrtes Modul sperrt die Akte, auch eines nur des ZIP', () => {
    expect(
      akteFreigabe(freigabenFixture({ personen: { zugriff: false } })).gesperrteModule,
    ).toEqual(['Betroffene']);
    expect(
      akteFreigabe(freigabenFixture({ tiere: { zugriff: false } })).gesperrteModule,
    ).toHaveLength(1);
  });

  it('ein ausgeblendetes Modul sperrt nicht, sein Kapitel ist „nicht genutzt“', () => {
    const f = akteFreigabe(freigabenFixture({ auftraege: { sichtbar: false, zugriff: false } }));
    expect(f.gesperrteModule).toEqual([]);
    expect(f.kapitel.auftraege).toBe('nicht-genutzt');
    expect(f.kapitel.befehle).toBe('nicht-genutzt');
    expect(f.kapitel.etb).toBe('abrufen');
  });

  it('ohne Eintrag in den Freigaben gilt fail-closed', () => {
    const freigaben = freigabenFixture();
    delete freigaben.etb;
    expect(akteFreigabe(freigaben).gesperrteModule).toEqual(['ETB']);
  });
});
