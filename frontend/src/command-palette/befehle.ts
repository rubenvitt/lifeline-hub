// frontend/src/command-palette/befehle.ts
import { TbList, TbUser, TbSettings, TbLogout, TbPlus, TbSun, TbMoon, TbDeviceDesktop, TbWorld } from 'react-icons/tb';
import {
  modulRegistry, istModulSichtbar, istModulGesperrt, modulZielRoute,
} from '../einsatz/modulRegistry';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import type { IconType } from 'react-icons';
import type { Befehl, BefehlKontext } from './typen';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Koordinatenformat } from '../api/types';

const SCHNELLAKTIONEN: { modulKey: string; route: string; label: string; schlagworte: string[] }[] = [
  { modulKey: 'personen', route: 'personen', label: 'Neue Person erfassen', schlagworte: ['registrieren', 'vermisst', 'betroffen', 'patient'] },
  { modulKey: 'etb', route: 'etb', label: 'Neuer ETB-Eintrag', schlagworte: ['tagebuch', 'meldung', 'eintrag'] },
  { modulKey: 'unfallhilfsstellen', route: 'unfallhilfsstellen', label: 'Neue Unfallhilfsstelle', schlagworte: ['uhs', 'behandlungsplatz', 'patientenablage'] },
  { modulKey: 'schaeden', route: 'schaeden', label: 'Neuen Schaden erfassen', schlagworte: ['schaden', 'objekt'] },
];

const THEME_BEFEHLE: { id: string; label: string; modus: ThemeModus; icon: IconType }[] = [
  { id: 'theme:system', label: 'Darstellung: System', modus: 'system', icon: TbDeviceDesktop },
  { id: 'theme:light', label: 'Darstellung: Hell', modus: 'light', icon: TbSun },
  { id: 'theme:dark', label: 'Darstellung: Dunkel', modus: 'dark', icon: TbMoon },
];

const KOORD_BEFEHLE: { format: Koordinatenformat; label: string }[] = [
  { format: 'wgs84', label: 'WGS84 (Dezimalgrad)' },
  { format: 'dms', label: 'Grad/Minuten/Sekunden' },
  { format: 'utm', label: 'UTM' },
  { format: 'mgrs', label: 'MGRS / UTMREF' },
  { format: 'gk', label: 'Gauß-Krüger' },
];

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

    // 2. Schnellaktionen — nur wenn der User schreiben darf (kein Beobachter, aktiver Einsatz)
    if (k.darfSchreibenImEinsatz) {
      for (const a of SCHNELLAKTIONEN) {
        const m = modulRegistry.find((x) => x.key === a.modulKey);
        if (!m || !istModulSichtbar(m, k.overrides) || istModulGesperrt(m, k.benutzer, k.overrides)) continue;
        const ziel = `/einsaetze/${k.einsatzId}/${a.route}?neu=1`;
        befehle.push({
          id: `aktion:${a.modulKey}`, gruppe: 'schnellaktionen', label: a.label,
          icon: TbPlus, schlagworte: a.schlagworte, ausfuehren: () => k.navigate(ziel),
        });
      }
    }
  }

  // 3. Einsatz-Wechsel — aktive Einsätze (global)
  for (const e of k.einsaetze) {
    if (e.status !== 'aktiv') continue;
    befehle.push({
      id: `einsatz:${e.id}`, gruppe: 'einsaetze', label: e.bezeichnung, icon: TbList,
      schlagworte: e.stichwort ? [e.stichwort] : undefined,
      ausfuehren: () => k.navigate(`/einsaetze/${e.id}`),
    });
  }

  // 4. Schnelleinstellungen — global
  for (const t of THEME_BEFEHLE) {
    befehle.push({ id: t.id, gruppe: 'einstellungen', label: t.label, icon: t.icon, schlagworte: ['theme', 'hell', 'dunkel'], ausfuehren: () => k.setThemeModus(t.modus) });
  }
  for (const c of KOORD_BEFEHLE) {
    befehle.push({ id: `koord:${c.format}`, gruppe: 'einstellungen', label: `Koordinaten: ${c.label}`, icon: TbWorld, schlagworte: ['koordinaten', 'format', c.format], ausfuehren: () => k.setKoordinaten(c.format) });
  }

  // 5. Navigation — global
  befehle.push({ id: 'nav:einsaetze', gruppe: 'navigation', label: 'Alle Einsätze', icon: TbList, ausfuehren: () => k.navigate('/einsaetze') });
  befehle.push({ id: 'nav:profil', gruppe: 'navigation', label: 'Profil', icon: TbUser, ausfuehren: () => k.navigate('/profil') });
  // Zwei Stufen, bewusst getrennt (LFH-328/M8): Verwaltungsbereich und Stammdaten hängen am
  // AdminLayout-Gate `darfVerwaltung` — vorher standen sie unter `system_rolle === 'admin'`
  // allein, weshalb eine Führungskraft „Verwaltung" in der Topbar sah und die Route betreten
  // durfte, den Eintrag hier aber nicht fand.
  if (darfVerwaltung(k.benutzer)) {
    befehle.push({ id: 'nav:stammdaten', gruppe: 'navigation', label: 'Stammdaten', icon: TbList, ausfuehren: () => k.navigate('/stammdaten') });
    befehle.push({ id: 'nav:admin', gruppe: 'navigation', label: 'Administration', icon: TbSettings, ausfuehren: () => k.navigate('/admin') });
  }
  // Die Benutzerverwaltung bleibt strenger: `/benutzer` leitet auf `/admin/benutzer`, und
  // AdminLayout zeigt diesen Menüpunkt nur System-Admins. Sie mitzuziehen wäre eine Ausweitung.
  if (k.benutzer?.system_rolle === 'admin') {
    befehle.push({ id: 'nav:benutzer', gruppe: 'navigation', label: 'Benutzerverwaltung', icon: TbUser, ausfuehren: () => k.navigate('/benutzer') });
  }
  befehle.push({ id: 'nav:abmelden', gruppe: 'navigation', label: 'Abmelden', icon: TbLogout, ausfuehren: () => k.logout() });

  return befehle;
}
