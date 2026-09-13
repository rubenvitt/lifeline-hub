import { describe, expect, it } from 'vitest';
import { TbHome } from 'react-icons/tb';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import type { ModulEintrag } from '../einsatz/modulRegistry';
import { werkzeugeFuer } from './werkzeuge';

/**
 * Registry-STUB statt der echten Registry (Muster `befehle.modulstatus.test.ts`): nach dem Flip
 * gibt es kein `wip`-Modul mehr, an dem sich der Status-Zweig beobachten ließe.
 */
const stub = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'x',
  kategorie: 'fuehrung',
  label: 'X',
  icon: TbHome,
  route: 'x',
  status: 'fertig',
  ...over,
});
const REGISTER = [
  stub({ key: 'fertig-a', label: 'A', route: 'a' }),
  stub({ key: 'unfertig', label: 'U', route: 'u', status: 'wip' }),
  stub({ key: 'nur-admin', label: 'N', route: 'n', benoetigteRolle: 'admin' }),
  stub({ key: 'fertig-b', label: 'B', route: 'b' }),
];
const nutzer = {
  id: 1,
  anzeigename: 'N',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
} as BenutzerAnzeige;

describe('werkzeugeFuer', () => {
  it('liefert freigegebene Module in der Reihenfolge der Schlüssel', () => {
    expect(
      werkzeugeFuer(['fertig-b', 'fertig-a'], nutzer, undefined, REGISTER).map((m) => m.key),
    ).toEqual(['fertig-b', 'fertig-a']);
  });

  it('lässt unfertige, rollen-gesperrte und unbekannte Module weg', () => {
    expect(
      werkzeugeFuer(
        ['unfertig', 'nur-admin', 'gibt-es-nicht', 'fertig-a'],
        nutzer,
        undefined,
        REGISTER,
      ).map((m) => m.key),
    ).toEqual(['fertig-a']);
  });

  it('lässt per Override ausgeblendete Module weg', () => {
    const overrides = { 'fertig-a': { sichtbar: false } } as unknown as ModulOverrides;
    expect(
      werkzeugeFuer(['fertig-a', 'fertig-b'], nutzer, overrides, REGISTER).map((m) => m.key),
    ).toEqual(['fertig-b']);
  });
});
