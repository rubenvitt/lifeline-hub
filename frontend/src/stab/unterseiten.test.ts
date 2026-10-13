import { describe, expect, it } from 'vitest';
import { unterseitenFuer } from './unterseiten';

describe('unterseitenFuer', () => {
  it('S6 führt die vier Einstiege des Fernmeldewesens in fester Reihenfolge (Spec `fernmeldewesen`)', () => {
    const s6 = unterseitenFuer('s6');
    expect(s6.map((u) => u.label)).toEqual([
      'Funkplan',
      'Fernmeldeskizze',
      'Sprechgruppen',
      'Kommunikationsplan',
    ]);
    expect(s6.every((u) => u.modul === 'fernmeldewesen')).toBe(true);
    expect(s6.map((u) => u.pfad(7))).toEqual([
      '/einsaetze/7/fernmeldewesen',
      '/einsaetze/7/fernmeldewesen?ansicht=skizze',
      '/einsaetze/7/fernmeldewesen?ansicht=sprechgruppen',
      '/einsaetze/7/fernmeldewesen/kommunikationsplan',
    ]);
  });

  it('S5 führt Pressearbeit und Informationstelefon unter dem Stab', () => {
    expect(unterseitenFuer('s5').map((u) => [u.key, u.modul])).toEqual([
      ['presse', 'stab'],
      ['infotelefon', 'stab'],
    ]);
  });
});
