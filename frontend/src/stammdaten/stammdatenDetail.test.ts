import { describe, expect, it } from 'vitest';
import {
  fahrzeugDetailPfad,
  fahrzeugListePfad,
  personalDetailPfad,
  personalListePfad,
} from './stammdatenDetail';

/**
 * Der Vertrag dieser Datei sind die vier Pfade.
 *
 * `parseRouteId` wird hier bewusst NICHT geprüft: die Funktion lebt in `routing/deeplinks.ts`
 * und ist dort gepinnt; hier ein zweites Mal gemessen, behauptete sie einen eigenen Vertrag,
 * den dieses Modul nicht hat.
 */
describe('stammdatenDetail — Admin-Detailpfade', () => {
  it('baut die Detailpfade unter der Stammdaten-Sektion', () => {
    expect(fahrzeugDetailPfad(42)).toBe('/admin/stammdaten/fahrzeuge/42');
    expect(personalDetailPfad(7)).toBe('/admin/stammdaten/personal/7');
  });

  /**
   * Der Rückweg MUSS der Sektionspfad selbst sein — er ist zugleich das Redirect-Ziel einer
   * ungültigen Route-ID. Ein Detailpfad, der nicht auf seiner Liste aufsetzt, führte den
   * Redirect in eine dritte Adresse.
   */
  it('setzt jeden Detailpfad auf seinem Listenpfad auf', () => {
    expect(fahrzeugListePfad()).toBe('/admin/stammdaten/fahrzeuge');
    expect(personalListePfad()).toBe('/admin/stammdaten/personal');
    expect(fahrzeugDetailPfad(1).startsWith(`${fahrzeugListePfad()}/`)).toBe(true);
    expect(personalDetailPfad(1).startsWith(`${personalListePfad()}/`)).toBe(true);
  });
});
