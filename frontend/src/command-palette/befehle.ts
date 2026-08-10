// frontend/src/command-palette/befehle.ts
import { TbList, TbUser, TbSettings, TbLogout, TbPlus, TbSun, TbMoon, TbDeviceDesktop, TbWorld, TbArrowsMinimize, TbArrowsMaximize, TbHandStop } from 'react-icons/tb';
import {
  modulRegistry, istModulSichtbar, istModulGesperrt, modulZielRoute,
} from '../einsatz/modulRegistry';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import {
  einsaetzePfad,
  einsatzModulPfad,
  einsatzPfad,
  etbPfad,
  personenPfad,
  schaedenPfad,
  unfallhilfsstellenListePfad,
} from '../routing/deeplinks';
import type { IconType } from 'react-icons';
import type { Befehl, BefehlKontext, TastaturAktionId } from './typen';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
import type { Koordinatenformat } from '../api/types';

/**
 * Die Ziele stehen als **Builder** aus `routing/deeplinks.ts` in der Tabelle, nicht als
 * Routenstück, das unten zu einem Vorlagentext zusammengesetzt wird (LFH-331 · B3).
 *
 * Der Unterschied war an einer Zeile messbar und ein echter Fehler: die Unfallhilfsstellen
 * liegen unter `/unfallhilfsstellen/liste`, während der bare Modulpfad auf
 * `UnfallhilfsstellenDefault` zeigt — eine Seite, die `?neu=1` nicht liest. Die
 * Schnellaktion lief damit ins Leere. Ein Routenstück nur für diese eine Zeile
 * auszunehmen hätte zwei Wahrheiten für dieselbe Sache stehen lassen; deshalb tragen
 * alle vier Zeilen den Builder.
 */
const SCHNELLAKTIONEN: { modulKey: string; pfad: (einsatzId: number) => string; label: string; schlagworte: string[] }[] = [
  { modulKey: 'personen', pfad: (id) => personenPfad(id, { neu: true }), label: 'Neue Person erfassen', schlagworte: ['registrieren', 'vermisst', 'betroffen', 'patient'] },
  { modulKey: 'etb', pfad: (id) => etbPfad(id, { neu: true }), label: 'Neuer ETB-Eintrag', schlagworte: ['tagebuch', 'meldung', 'eintrag'] },
  { modulKey: 'unfallhilfsstellen', pfad: (id) => unfallhilfsstellenListePfad(id, { neu: true }), label: 'Neue Unfallhilfsstelle', schlagworte: ['uhs', 'behandlungsplatz', 'patientenablage'] },
  { modulKey: 'schaeden', pfad: (id) => schaedenPfad(id, { neu: true }), label: 'Neuen Schaden erfassen', schlagworte: ['schaden', 'objekt'] },
];

const THEME_BEFEHLE: { id: string; label: string; modus: ThemeModus; icon: IconType }[] = [
  { id: 'theme:system', label: 'Darstellung: System', modus: 'system', icon: TbDeviceDesktop },
  { id: 'theme:light', label: 'Darstellung: Hell', modus: 'light', icon: TbSun },
  { id: 'theme:dark', label: 'Darstellung: Dunkel', modus: 'dark', icon: TbMoon },
];

/** Bediendichte über die Palette (LFH-329 · B1) — der zweite Bedienweg neben dem
 *  Kopfzeilen-Umschalter, und auf schmalem Schirm der einzige, weil die Kopfzeile
 *  dort ihre Umschalter ablegt. */
const DICHTE_BEFEHLE: { id: string; label: string; stufe: Dichte; icon: IconType }[] = [
  { id: 'dichte:kompakt', label: 'Dichte: Kompakt', stufe: 'kompakt', icon: TbArrowsMinimize },
  { id: 'dichte:komfortabel', label: 'Dichte: Komfortabel', stufe: 'komfortabel', icon: TbArrowsMaximize },
  { id: 'dichte:handschuh', label: 'Dichte: Handschuh', stufe: 'handschuh', icon: TbHandStop },
];

const KOORD_BEFEHLE: { format: Koordinatenformat; label: string }[] = [
  { format: 'wgs84', label: 'WGS84 (Dezimalgrad)' },
  { format: 'dms', label: 'Grad/Minuten/Sekunden' },
  { format: 'utm', label: 'UTM' },
  { format: 'mgrs', label: 'MGRS / UTMREF' },
  { format: 'gk', label: 'Gauß-Krüger' },
];

interface TastaturEreignis {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  repeat: boolean;
  isComposing?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const TASTATUR_AKTIONEN: {
  id: TastaturAktionId;
  label: string;
  schlagworte: string[];
}[] = [
  { id: 'speichern', label: 'Speichern', schlagworte: ['sichern', 'formular', 'submit'] },
  { id: 'verwerfen', label: 'Verwerfen', schlagworte: ['abbrechen', 'schließen', 'escape'] },
  { id: 'filter-zuruecksetzen', label: 'Filter zurücksetzen', schlagworte: ['suche', 'leeren', 'reset'] },
];

/** Reine Auflösung der globalen Mutationskürzel. Bereits behandelte und wiederholte
 * Ereignisse haben bewusst keinen Besitzer mehr. */
export function tastaturAktionFuerEreignis(e: TastaturEreignis): TastaturAktionId | null {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.shiftKey || e.altKey) return null;
  const mitPrimaerModifikator = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape' && !mitPrimaerModifikator) return 'verwerfen';
  if (!mitPrimaerModifikator) return null;
  if (e.key.toLowerCase() === 's' || e.key === 'Enter') return 'speichern';
  if (e.key === 'Backspace') return 'filter-zuruecksetzen';
  return null;
}

/** Sichtbarer Gegenpart zur Ereignisauflösung; der User-Agent ist absichtlich ein
 * Parameter, damit beide Plattformzweige ohne Manipulation globaler Browserwerte testbar sind. */
export function kuerzelFuerTastaturAktion(id: TastaturAktionId, userAgent: string): string {
  const mac = /Mac|iPhone|iPad|iPod/.test(userAgent);
  if (id === 'verwerfen') return 'Esc';
  if (id === 'speichern') return mac ? '⌘ S / ⌘ ↵' : 'Strg + S / Strg + ↵';
  return mac ? '⌘ ⌫' : 'Strg + Rücktaste';
}

export function baueBefehle(k: BefehlKontext): Befehl[] {
  const befehle: Befehl[] = [];

  for (const definition of TASTATUR_AKTIONEN) {
    const ausfuehren = k.tastaturAktionen?.[definition.id];
    if (!ausfuehren) continue;
    befehle.push({
      id: `tastatur:${definition.id}`,
      gruppe: 'aktionen',
      label: definition.label,
      schlagworte: definition.schlagworte,
      kuerzel: kuerzelFuerTastaturAktion(definition.id, k.userAgent ?? ''),
      ausfuehren,
    });
  }

  // 1. Module — nur im Einsatz-Kontext, fertig, sichtbar, nicht rollen-gesperrt
  if (k.einsatzId != null) {
    // 0. Zuletzt besucht — dieselben Freigabe-Filter wie bei den Modulen darunter
    //    (fertig, sichtbar, nicht rollen-gesperrt). Ein seit dem Besuch entzogenes Modul
    //    verschwindet damit aus der Abkürzung, statt in eine gesperrte Seite zu führen.
    //    Eigenes id-Präfix: derselbe Registry-Eintrag steht hier UND unter „Module", und
    //    zwei gleiche `id` machten `aria-activedescendant` mehrdeutig.
    for (const key of k.zuletztModulKeys ?? []) {
      const m = modulRegistry.find((x) => x.key === key);
      if (!m || m.status !== 'fertig') continue;
      if (!istModulSichtbar(m, k.overrides)) continue;
      if (istModulGesperrt(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
      befehle.push({
        id: `zuletzt:${m.key}`, gruppe: 'zuletzt', label: m.label, icon: m.icon,
        ausfuehren: () => k.navigate(ziel),
      });
    }

    for (const m of modulRegistry) {
      if (m.status !== 'fertig') continue;
      if (!istModulSichtbar(m, k.overrides)) continue;
      if (istModulGesperrt(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
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
        const ziel = a.pfad(k.einsatzId);
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
      ausfuehren: () => k.navigate(einsatzPfad(e.id)),
    });
  }

  // 4. Schnelleinstellungen — global
  for (const t of THEME_BEFEHLE) {
    befehle.push({ id: t.id, gruppe: 'einstellungen', label: t.label, icon: t.icon, schlagworte: ['theme', 'hell', 'dunkel'], ausfuehren: () => k.setThemeModus(t.modus) });
  }
  for (const d of DICHTE_BEFEHLE) {
    befehle.push({ id: d.id, gruppe: 'einstellungen', label: d.label, icon: d.icon, schlagworte: ['dichte', 'treffflaeche', 'handschuh', 'tablet', 'bedienung'], ausfuehren: () => k.setDichte(d.stufe) });
  }
  for (const c of KOORD_BEFEHLE) {
    befehle.push({ id: `koord:${c.format}`, gruppe: 'einstellungen', label: `Koordinaten: ${c.label}`, icon: TbWorld, schlagworte: ['koordinaten', 'format', c.format], ausfuehren: () => k.setKoordinaten(c.format) });
  }

  // 5. Navigation — global
  befehle.push({ id: 'nav:einsaetze', gruppe: 'navigation', label: 'Alle Einsätze', icon: TbList, ausfuehren: () => k.navigate(einsaetzePfad()) });
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
