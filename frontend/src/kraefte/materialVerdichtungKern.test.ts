import { describe, expect, it } from 'vitest';
import type { MaterialStatus } from '../api/types';
import { materialStatus } from '../theme/statusFarben';
import {
  isMaterialAusfall,
  materialAusfall,
  materialTopf,
  verdichteMaterial,
  type MaterialTopf,
} from './materialVerdichtungKern';

const STATUS = Object.keys(materialStatus) as MaterialStatus[];
/** Ein Gerät (kennt alle fünf Status). */
const posten = (status: MaterialStatus) => ({
  status,
  art: 'geraet' as const,
  menge: 1,
  ausgegeben: 0,
});
/** Ein Verbrauchsgut mit Menge und Ausgabe (LLH-1224). */
const vorrat = (status: MaterialStatus, menge: number, ausgegeben = 0) => ({
  status,
  art: 'verbrauchsgut' as const,
  menge,
  ausgegeben,
});

describe('materialVerdichtung (LLH-1093, design.md D10)', () => {
  it('legt jeden Materialstatus in genau einen der drei Töpfe', () => {
    const toepfe: MaterialTopf[] = ['einsatzbereit', 'imEinsatz', 'ausfall'];
    for (const s of STATUS) {
      const topf = materialTopf(posten(s));
      expect(toepfe, `Status ${s} ohne Topf`).toContain(topf);
      // Genau einer: dieselbe Zählung landet in genau einem Topf.
      const v = verdichteMaterial([posten(s)]);
      expect(v.einsatzbereit + v.imEinsatz + v.ausfall, `Status ${s}`).toBe(1);
    }
  });

  it('kennt keine Rolle außerhalb der drei Töpfe (eine neue Rolle ist neu zu entscheiden)', () => {
    const bekannt = new Set(['normal', 'bedien', 'alarm', 'achtung']);
    for (const s of STATUS) {
      expect(bekannt.has(materialStatus[s].rolle), `Rolle von ${s}`).toBe(true);
    }
  });

  it('zählt Ausfall über die Rollen alarm und achtung: defekt, verbraucht, Desinfektion nötig', () => {
    expect(isMaterialAusfall(posten('defekt'))).toBe(true);
    expect(isMaterialAusfall(posten('verbraucht'))).toBe(true);
    expect(isMaterialAusfall(posten('desinfektion_noetig'))).toBe(true);
    expect(isMaterialAusfall(posten('im_einsatz'))).toBe(false);
    expect(isMaterialAusfall(posten('einsatzbereit'))).toBe(false);
    expect(materialAusfall([posten('verbraucht'), posten('einsatzbereit')])).toBe(1);
  });

  it('ein aufgebrauchtes Verbrauchsgut ist Ausfall, ein teilweise ausgegebenes nicht (LLH-1224 D15)', () => {
    expect(isMaterialAusfall(vorrat('einsatzbereit', 50, 50))).toBe(true);
    expect(isMaterialAusfall(vorrat('im_einsatz', 50, 49))).toBe(false);
    expect(isMaterialAusfall(vorrat('defekt', 50, 10))).toBe(true);
    expect(materialTopf(vorrat('im_einsatz', 50, 50))).toBe('ausfall');
    const v = verdichteMaterial([vorrat('einsatzbereit', 50, 50), vorrat('im_einsatz', 20, 5)]);
    expect(v).toEqual({
      gesamt: 2,
      einsatzbereit: 0,
      imEinsatz: 1,
      ausfall: 1,
      ausfallRolle: materialStatus.verbraucht.rolle,
    });
  });

  it('zählt Posten, nicht Mengen: sieben einsatzbereit, drei im Einsatz, zwei Ausfall', () => {
    const liste = [
      ...Array.from({ length: 7 }, () => vorrat('einsatzbereit', 50)),
      ...Array.from({ length: 3 }, () => vorrat('im_einsatz', 4)),
      vorrat('defekt', 10),
      posten('verbraucht'),
    ];
    expect(verdichteMaterial(liste)).toEqual({
      gesamt: 12,
      einsatzbereit: 7,
      imEinsatz: 3,
      ausfall: 2,
      ausfallRolle: 'alarm',
    });
  });

  it('nennt die Rolle des schwersten Ausfalls, ohne Ausfall keine', () => {
    expect(verdichteMaterial([posten('desinfektion_noetig')]).ausfallRolle).toBe('achtung');
    expect(verdichteMaterial([posten('desinfektion_noetig'), posten('defekt')]).ausfallRolle).toBe(
      'alarm',
    );
    expect(verdichteMaterial([posten('einsatzbereit')]).ausfallRolle).toBeNull();
    expect(verdichteMaterial([])).toEqual({
      gesamt: 0,
      einsatzbereit: 0,
      imEinsatz: 0,
      ausfall: 0,
      ausfallRolle: null,
    });
  });
});
