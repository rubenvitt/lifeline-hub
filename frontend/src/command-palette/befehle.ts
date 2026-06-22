// frontend/src/command-palette/befehle.ts
import { TbList, TbUser, TbSettings, TbLogout } from 'react-icons/tb';
import {
  modulRegistry, istModulSichtbar, istModulGesperrt, modulZielRoute,
} from '../einsatz/modulRegistry';
import type { Befehl, BefehlKontext } from './typen';

export function baueBefehle(k: BefehlKontext): Befehl[] {
  const befehle: Befehl[] = [];

  // 1. Module — nur im Einsatz-Kontext, fertig, sichtbar, nicht rollen-gesperrt
  if (k.einsatzId != null) {
    for (const m of modulRegistry) {
      if (m.status !== 'fertig') continue;
      if (!istModulSichtbar(m, k.overrides)) continue;
      if (istModulGesperrt(m, k.benutzer, k.overrides)) continue;
      const ziel = `/einsaetze/${k.einsatzId}/${modulZielRoute(m)}`;
      befehle.push({
        id: `modul:${m.key}`, gruppe: 'module', label: m.label, icon: m.icon,
        schlagworte: m.beschreibung ? [m.beschreibung] : undefined,
        ausfuehren: () => k.navigate(ziel),
      });
    }
  }

  // 5. Navigation — global
  befehle.push({ id: 'nav:einsaetze', gruppe: 'navigation', label: 'Alle Einsätze', icon: TbList, ausfuehren: () => k.navigate('/einsaetze') });
  befehle.push({ id: 'nav:profil', gruppe: 'navigation', label: 'Profil', icon: TbUser, ausfuehren: () => k.navigate('/profil') });
  if (k.benutzer?.system_rolle === 'admin') {
    befehle.push({ id: 'nav:benutzer', gruppe: 'navigation', label: 'Benutzerverwaltung', icon: TbUser, ausfuehren: () => k.navigate('/benutzer') });
    befehle.push({ id: 'nav:stammdaten', gruppe: 'navigation', label: 'Stammdaten', icon: TbList, ausfuehren: () => k.navigate('/stammdaten') });
    befehle.push({ id: 'nav:admin', gruppe: 'navigation', label: 'Administration', icon: TbSettings, ausfuehren: () => k.navigate('/admin') });
  }
  befehle.push({ id: 'nav:abmelden', gruppe: 'navigation', label: 'Abmelden', icon: TbLogout, ausfuehren: () => k.logout() });

  return befehle;
}
