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
const posten = (status: MaterialStatus, menge = 1) => ({ status, menge });

describe('materialVerdichtung (LLH-1093, design.md D10)', () => {
  it('legt jeden Materialstatus in genau einen der drei Töpfe', () => {
    const toepfe: MaterialTopf[] = ['einsatzbereit', 'imEinsatz', 'ausfall'];
    for (const s of STATUS) {
      const topf = materialTopf(s);
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
    expect(isMaterialAusfall('defekt')).toBe(true);
    expect(isMaterialAusfall('verbraucht')).toBe(true);
    expect(isMaterialAusfall('desinfektion_noetig')).toBe(true);
    expect(isMaterialAusfall('im_einsatz')).toBe(false);
    expect(isMaterialAusfall('einsatzbereit')).toBe(false);
    expect(materialAusfall([posten('verbraucht'), posten('einsatzbereit')])).toBe(1);
  });

  it('zählt Posten, nicht Mengen: sieben einsatzbereit, drei im Einsatz, zwei Ausfall', () => {
    const liste = [
      ...Array.from({ length: 7 }, () => posten('einsatzbereit', 50)),
      ...Array.from({ length: 3 }, () => posten('im_einsatz', 4)),
      posten('defekt', 10),
      posten('verbraucht', 20),
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
