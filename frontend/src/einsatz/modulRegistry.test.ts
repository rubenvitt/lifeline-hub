import { describe, expect, it } from 'vitest';
import {
  modulRegistry,
  kategorien,
  moduleNachKategorie,
  istModulGesperrt,
  istModulSichtbar,
  istModulAusblendbar,
  redirectZiel,
  modulZielRoute,
  aufloeseStandardModul,
  erstesFreigegebenesModul,
  type ModulEintrag,
} from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

const admin: BenutzerAnzeige = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', totp_aktiviert: false,
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

  // --- Override-Kontext (LFH-132) ---

  const ov = (key: string, sichtbar: boolean, rolle: 'admin' | 'fuehrungskraft' | null = null): ModulOverrides => ({
    [key]: { einsatz_id: 1, modul_key: key, sichtbar, benoetigte_rolle: rolle, geaendert_at: null, geaendert_von: null },
  });

  it('istModulAusblendbar: Stammdaten + Einstellungen nicht ausblendbar', () => {
    expect(istModulAusblendbar('einsatzdaten')).toBe(false);
    expect(istModulAusblendbar('einsatz-einstellungen')).toBe(false);
    expect(istModulAusblendbar('etb')).toBe(true);
  });

  it('istModulSichtbar: ohne Override sichtbar', () => {
    expect(istModulSichtbar(offen)).toBe(true);
    expect(istModulSichtbar(offen, {})).toBe(true);
  });

  it('istModulSichtbar: Override sichtbar=false versteckt ausblendbares Modul', () => {
    expect(istModulSichtbar(offen, ov('x', false))).toBe(false);
    expect(istModulSichtbar(offen, ov('x', true))).toBe(true);
  });

  it('istModulSichtbar: nicht-ausblendbares Modul bleibt trotz Override sichtbar', () => {
    const einsatzdaten = modulRegistry.find((m) => m.key === 'einsatzdaten')!;
    expect(istModulSichtbar(einsatzdaten, ov('einsatzdaten', false))).toBe(true);
  });

  it('istModulGesperrt: nicht-ausblendbares Modul nie rollen-gesperrt (Selbst-Aussperr-Schutz)', () => {
    const einstellungen = modulRegistry.find((m) => m.key === 'einsatz-einstellungen')!;
    // Selbst mit (defensiv ohnehin abgelehntem) Rollen-Override bleibt es frei.
    expect(istModulGesperrt(einstellungen, ohne, ov('einsatz-einstellungen', true, 'fuehrungskraft'))).toBe(false);
  });

  it('istModulGesperrt: Override-Rolle hat Vorrang vor Registry-Default', () => {
    // offen hat keinen Registry-Default; Override fordert fuehrungskraft.
    expect(istModulGesperrt(offen, ohne, ov('x', true, 'fuehrungskraft'))).toBe(true);
    expect(istModulGesperrt(offen, fk, ov('x', true, 'fuehrungskraft'))).toBe(false);
    // Admin nie gesperrt, auch bei admin-Override.
    expect(istModulGesperrt(offen, admin, ov('x', true, 'admin'))).toBe(false);
  });

  it('istModulGesperrt: Override-Rolle null faellt auf Registry-Default zurueck', () => {
    // adminModul hat Registry-Default 'admin'; Override setzt nur Sichtbarkeit (Rolle null).
    // Wie das Backend (or_else(registry_default)) greift dann weiterhin der Default 'admin'.
    expect(istModulGesperrt(adminModul, ohne, ov('x', true, null))).toBe(true);
    expect(istModulGesperrt(adminModul, admin, ov('x', true, null))).toBe(false);
  });

  it('redirectZiel: Dashboard ist Default sobald fertig', () => {
    expect(redirectZiel(modulRegistry)).toBe('lage-dashboard');
  });

  it('redirectZiel: Fallback ETB solange Dashboard nicht fertig', () => {
    const ohneFertigesDashboard = modulRegistry.map((m) =>
      m.key === 'lage-dashboard' ? { ...m, status: 'geplant' as const } : m,
    );
    expect(redirectZiel(ohneFertigesDashboard)).toBe('etb');
  });

  it('aufloeseStandardModul: liefert Route eines fertigen Standard-Moduls', () => {
    expect(aufloeseStandardModul('etb')).toBe('etb');
  });

  it('aufloeseStandardModul: Fallback auf redirectZiel bei null', () => {
    expect(aufloeseStandardModul(null)).toBe(redirectZiel());
  });

  it('aufloeseStandardModul: Fallback bei unbekanntem Modul-Key', () => {
    expect(aufloeseStandardModul('gibtsnicht')).toBe(redirectZiel());
  });

  it('aufloeseStandardModul: Fallback bei nicht-fertigem Modul (wip)', () => {
    expect(aufloeseStandardModul('stab')).toBe(redirectZiel()); // stab = wip
  });

  it('aufloeseStandardModul: nutzt modulZielRoute (key!=route, z.B. gefahrenzonen)', () => {
    expect(aufloeseStandardModul('gefahrenzonen')).toBe('gefahren');
  });

  it('fahrzeuge ist fertig, abrollbehaelter ist entfernt', () => {
    const fahrzeuge = modulRegistry.find((m) => m.key === 'fahrzeuge');
    expect(fahrzeuge?.status).toBe('fertig');
    expect(fahrzeuge?.kategorie).toBe('kraefte');
    expect(modulRegistry.find((m) => m.key === 'abrollbehaelter')).toBeUndefined();
  });

  it('personal ist fertig in der Kategorie kraefte', () => {
    const personal = modulRegistry.find((m) => m.key === 'personal');
    expect(personal?.status).toBe('fertig');
    expect(personal?.kategorie).toBe('kraefte');
    expect(personal?.route).toBe('personal');
  });

  it('material ist fertig in der Kategorie kraefte', () => {
    const material = modulRegistry.find((m) => m.key === 'material');
    expect(material?.status).toBe('fertig');
    expect(material?.kategorie).toBe('kraefte');
    expect(material?.route).toBe('material');
  });

  it('einheiten und einsatzabschnitte sind fertig', () => {
    const einheiten = modulRegistry.find((m) => m.key === 'einheiten');
    const abschnitte = modulRegistry.find((m) => m.key === 'einsatzabschnitte');
    expect(einheiten?.status).toBe('fertig');
    expect(abschnitte?.status).toBe('fertig');
  });

  it('Lageberichte-Modul ist fertig (Kategorie lage, ohne Rollensperre)', () => {
    const lb = modulRegistry.find((m) => m.key === 'lageberichte');
    expect(lb).toBeDefined();
    expect(lb?.status).toBe('fertig');
    expect(lb?.kategorie).toBe('lage');
    expect(lb?.benoetigteRolle).toBeUndefined();
  });

  it('gefahrenzonen ist eine eigene Seite (kein Deep-Link mehr)', () => {
    const gz = modulRegistry.find((m) => m.key === 'gefahrenzonen');
    expect(gz).toBeDefined();
    expect(gz?.kategorie).toBe('lage');
    expect(gz?.status).toBe('fertig');
    // LFH-74: Der Gefahren-Button zeigt die Gefahrenmatrix selbst, nicht die Lagekarte.
    expect(gz?.verweistAuf).toBeUndefined();
    expect(gz?.route).toBe('gefahren');
    expect(modulZielRoute(gz!)).toBe('gefahren');
  });

  it('modulZielRoute: Deep-Link-Ziel hat Vorrang vor der eigenen Route', () => {
    expect(modulZielRoute({ ...offen, route: 'gefahrenzonen', verweistAuf: 'lagekarte' }))
      .toBe('lagekarte');
  });

  it('modulZielRoute: ohne Deep-Link die eigene Route', () => {
    expect(modulZielRoute({ ...offen, route: 'etb' })).toBe('etb');
  });
});

describe('erstesFreigegebenesModul (LFH-337)', () => {
  const admin: BenutzerAnzeige = {
    id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
    org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', totp_aktiviert: false,
  };

  it('liefert das erste fertige Modul der Kategorie in Registry-Reihenfolge', () => {
    const m = erstesFreigegebenesModul('fuehrung', admin);
    expect(m?.kategorie).toBe('fuehrung');
    expect(m?.status).toBe('fertig');
  });

  it('überspringt ausgeblendete Module', () => {
    // Kategorie 'kraefte', nicht 'fuehrung': deren erstes Modul wäre 'einsatzdaten' —
    // eines der beiden `NICHT_AUSBLENDBARE_MODULE`, an dem ein Sichtbarkeits-Override
    // wirkungslos bleibt (`istModulSichtbar` liefert dafür immer `true`). Der Test
    // bräuchte dann ein Modul, das der Override überhaupt treffen kann.
    const erstes = erstesFreigegebenesModul('kraefte', admin)!;
    const m = erstesFreigegebenesModul('kraefte', admin, {
      [erstes.key]: {
        einsatz_id: 1, modul_key: erstes.key, sichtbar: false,
        benoetigte_rolle: null, geaendert_at: null, geaendert_von: null,
      },
    });
    // Konkretes Folgemodul statt bloßer Ungleichheit (Fix-Runde 1): ein Resolver, der bei
    // gesetztem Override fälschlich kapituliert (`null` statt weiterzusuchen), bestünde
    // `not.toBe(erstes.key)` trivial — `expect(undefined).not.toBe('einheiten')` ist wahr.
    // 'personal' ist laut Registry-Reihenfolge das nächste fertige/sichtbare/entsperrte
    // Modul der Kategorie 'kraefte' nach 'einheiten'.
    expect(erstes.key).toBe('einheiten');
    expect(m?.key).toBe('personal');
  });

  it('überspringt rollen-gesperrte Module', () => {
    // Dieselbe Begründung wie oben: 'einsatzdaten' ist als nicht-ausblendbares Modul
    // auch nie rollen-sperrbar (Selbst-Aussperr-Schutz in `istModulGesperrt`) — 'kraefte'
    // trifft mit 'einheiten' ein Modul, an dem der Rollen-Override tatsächlich greift.
    const erstes = erstesFreigegebenesModul('kraefte', admin)!;
    const ohne: BenutzerAnzeige = { ...admin, system_rolle: 'keiner', org_rolle: 'keine' };
    const m = erstesFreigegebenesModul('kraefte', ohne, {
      [erstes.key]: {
        einsatz_id: 1, modul_key: erstes.key, sichtbar: true,
        benoetigte_rolle: 'admin', geaendert_at: null, geaendert_von: null,
      },
    });
    // Konkretes Folgemodul statt bloßer Ungleichheit — dieselbe Begründung wie im Test darüber.
    expect(erstes.key).toBe('einheiten');
    expect(m?.key).toBe('personal');
  });

  it('liefert null, wenn die Kategorie kein freigegebenes Modul hat', () => {
    // Die Gegenaussage: ohne sie bliebe unbewiesen, dass der Resolver überhaupt
    // ablehnen KANN — und der Aufrufer navigierte auf `undefined`.
    const nurGeplant: ModulEintrag[] = [
      { key: 'x', kategorie: 'lage', label: 'X', icon: () => null, route: 'x', status: 'geplant' },
    ];
    expect(erstesFreigegebenesModul('lage', admin, undefined, nurGeplant)).toBeNull();
  });
});
