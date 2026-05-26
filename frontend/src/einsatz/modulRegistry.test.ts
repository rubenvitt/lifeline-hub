import { describe, expect, it } from 'vitest';
import {
  modulRegistry,
  kategorien,
  moduleNachKategorie,
  istModulGesperrt,
  redirectZiel,
  type ModulEintrag,
} from './modulRegistry';
import type { BenutzerAnzeige } from '../api/types';

const admin: BenutzerAnzeige = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const ohne: BenutzerAnzeige = { ...admin, system_rolle: 'keiner', org_rolle: 'keine' };
const fk: BenutzerAnzeige = { ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };

const offen: ModulEintrag = {
  key: 'x', kategorie: 'erfassung', label: 'X', icon: modulRegistry[0].icon,
  route: 'x', status: 'geplant',
};
const adminModul: ModulEintrag = { ...offen, benoetigteRolle: 'admin' };
const fkModul: ModulEintrag = { ...offen, benoetigteRolle: 'fuehrungskraft' };

describe('modulRegistry', () => {
  it('enthaelt das fertige ETB-Modul in der Kategorie Erfassung', () => {
    const etb = modulRegistry.find((m) => m.key === 'etb');
    expect(etb).toBeDefined();
    expect(etb?.status).toBe('fertig');
    expect(etb?.kategorie).toBe('erfassung');
    expect(etb?.route).toBe('etb');
  });

  it('liefert jede Kategorie aus der Reihenfolge mit mindestens einem Modul', () => {
    for (const k of kategorien) {
      expect(moduleNachKategorie(k.key).length).toBeGreaterThan(0);
    }
  });

  it('moduleNachKategorie filtert nach Kategorie', () => {
    expect(moduleNachKategorie('erfassung').every((m) => m.kategorie === 'erfassung')).toBe(true);
  });

  it('istModulGesperrt: ohne benoetigteRolle nie gesperrt', () => {
    expect(istModulGesperrt(offen, ohne)).toBe(false);
    expect(istModulGesperrt(offen, null)).toBe(false);
  });

  it('istModulGesperrt: admin-Modul nur fuer Admin frei', () => {
    expect(istModulGesperrt(adminModul, admin)).toBe(false);
    expect(istModulGesperrt(adminModul, fk)).toBe(true);
    expect(istModulGesperrt(adminModul, ohne)).toBe(true);
  });

  it('istModulGesperrt: fuehrungskraft-Modul fuer Admin und Fuehrungskraft frei', () => {
    expect(istModulGesperrt(fkModul, admin)).toBe(false);
    expect(istModulGesperrt(fkModul, fk)).toBe(false);
    expect(istModulGesperrt(fkModul, ohne)).toBe(true);
  });

  it('redirectZiel: Fallback ETB solange Dashboard nicht fertig', () => {
    expect(redirectZiel(modulRegistry)).toBe('etb');
  });

  it('redirectZiel: Dashboard sobald es fertig ist', () => {
    const mitFertigemDashboard = modulRegistry.map((m) =>
      m.key === 'lage-dashboard' ? { ...m, status: 'fertig' as const } : m,
    );
    expect(redirectZiel(mitFertigemDashboard)).toBe('lage-dashboard');
  });

  it('fahrzeuge ist fertig, abrollbehaelter ist entfernt', () => {
    const fahrzeuge = modulRegistry.find((m) => m.key === 'fahrzeuge');
    expect(fahrzeuge?.status).toBe('fertig');
    expect(fahrzeuge?.kategorie).toBe('kraefte');
    expect(modulRegistry.find((m) => m.key === 'abrollbehaelter')).toBeUndefined();
  });
});
