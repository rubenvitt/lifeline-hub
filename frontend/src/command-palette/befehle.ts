// frontend/src/command-palette/befehle.ts
import { TbList, TbUser, TbSettings, TbLogout, TbPlus, TbSun, TbMoon, TbDeviceDesktop, TbWorld, TbArrowsMinimize, TbArrowsMaximize, TbHandStop } from 'react-icons/tb';
import {
  modulRegistry, istModulFreigegeben, istModulSichtbar, istModulGesperrt, modulZielRoute,
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

interface TastaturAktionDefinition {
  label: string;
  schlagworte: string[];
  /** Sichtbares Kürzel je Plattform — `null`, wo es keinen Tastenweg gibt. */
  kuerzel: (mac: boolean) => string | null;
}

/**
 * EIN exhaustives Verzeichnis je Aktion (LFH-391 · B3) statt des früheren Arrays.
 *
 * Der Wechsel schließt einen stillen Anzeigefehler: ein Array kann keine Vollständigkeit
 * behaupten, eine neue `TastaturAktionId` ohne Zeile erschien schlicht NIE in der Palette
 * — ohne Typfehler und ohne roten Test. Das Record bricht dafür den Typcheck (TS2741).
 * Das Kürzel liegt am selben Eintrag, weil der zweite stille Fehler genau dort saß:
 * `kuerzelFuerTastaturAktion` fiel für jede unbekannte Id auf „Strg + Rücktaste" durch und
 * beschriftete damit eine ungebundene Aktion mit dem Kürzel des Filter-Zurücksetzens.
 */
export const TASTATUR_AKTIONEN: Record<TastaturAktionId, TastaturAktionDefinition> = {
  speichern: {
    label: 'Speichern',
    schlagworte: ['sichern', 'formular', 'submit'],
    kuerzel: (mac) => (mac ? '⌘ S / ⌘ ↵' : 'Strg + S / Strg + ↵'),
  },
  verwerfen: {
    label: 'Verwerfen',
    schlagworte: ['abbrechen', 'schließen', 'escape'],
    kuerzel: () => 'Esc',
  },
  'filter-zuruecksetzen': {
    label: 'Filter zurücksetzen',
    schlagworte: ['suche', 'leeren', 'reset'],
    kuerzel: (mac) => (mac ? '⌘ ⌫' : 'Strg + Rücktaste'),
  },
  'neue-zeile': {
    label: 'Neue Zeile',
    schlagworte: ['anlegen', 'erfassen', 'neu', 'hinzufügen'],
    kuerzel: () => null,
  },
  spalten: {
    label: 'Spalten',
    schlagworte: ['spalten', 'ausblenden', 'einblenden', 'tabelle', 'ansicht'],
    kuerzel: () => null,
  },
};

/**
 * Die Reihenfolge der Gruppe „Aktionen" in der Palette. Sie steht getrennt, weil ein
 * Record keine vertragliche Ordnung hat — vorher trug sie die Einfügereihenfolge des
 * Arrays. Dass sie jede Id genau einmal führt, prüft der Guard in `befehle.test.ts`; das
 * ist die einzige Hälfte dieses Vertrags, die von Hand gepflegt wird.
 *
 * Die drei Aktionen mit Tastenweg bleiben vorn: sie sind die Antwort auf „was kann ich
 * hier gerade tun", und ihre Reihenfolge ist von `befehle.test.ts` gepinnt.
 */
export const TASTATUR_AKTION_REIHENFOLGE: readonly TastaturAktionId[] = [
  'speichern', 'verwerfen', 'filter-zuruecksetzen', 'neue-zeile', 'spalten',
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

/**
 * Sichtbarer Gegenpart zur Ereignisauflösung; der User-Agent ist absichtlich ein
 * Parameter, damit beide Plattformzweige ohne Manipulation globaler Browserwerte testbar
 * sind. `null` heißt „diese Aktion hat keinen Tastenweg" — der frühere Rest-Zweig, der
 * jede unbekannte Id mit dem Filter-Kürzel beschriftete, ist ersatzlos entfallen.
 */
export function kuerzelFuerTastaturAktion(id: TastaturAktionId, userAgent: string): string | null {
  const mac = /Mac|iPhone|iPad|iPod/.test(userAgent);
  return TASTATUR_AKTIONEN[id].kuerzel(mac);
}

export function baueBefehle(k: BefehlKontext): Befehl[] {
  const befehle: Befehl[] = [];

  // 1. Aktionen — die kontextabhängigen Tastatur-Aktionen der gerade aktiven Maske
  for (const id of TASTATUR_AKTION_REIHENFOLGE) {
    const ausfuehren = k.tastaturAktionen?.[id];
    if (!ausfuehren) continue;
    const definition = TASTATUR_AKTIONEN[id];
    const kuerzel = kuerzelFuerTastaturAktion(id, k.userAgent ?? '');
    befehle.push({
      id: `tastatur:${id}`,
      gruppe: 'aktionen',
      label: definition.label,
      schlagworte: definition.schlagworte,
      // Der Schlüssel FEHLT bei Aktionen ohne Tastenweg, statt auf `undefined` zu stehen:
      // `Befehl.kuerzel` ist optional, und die Palette rendert die Marke am truthy-Zweig.
      ...(kuerzel ? { kuerzel } : {}),
      ausfuehren,
    });
  }

  // 2. bis 4. gelten nur im Einsatz-Kontext.
  if (k.einsatzId != null) {
    // 2. Zuletzt besucht — Freigabe fragt `istModulFreigegeben` (fertig, sichtbar, nicht
    //    rollen-gesperrt), dieselbe Funktion wie die Modul-Schleife darunter und der
    //    Navigationsrahmen. Ein seit dem Besuch entzogenes Modul verschwindet damit aus
    //    der Abkürzung, statt in eine gesperrte Seite zu führen.
    //    Eigenes id-Präfix: derselbe Registry-Eintrag steht hier UND unter „Module", und
    //    zwei gleiche `id` machten `aria-activedescendant` mehrdeutig.
    for (const key of k.zuletztModulKeys ?? []) {
      const m = modulRegistry.find((x) => x.key === key);
      if (!m || !istModulFreigegeben(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
      befehle.push({
        id: `zuletzt:${m.key}`, gruppe: 'zuletzt', label: m.label, icon: m.icon,
        ausfuehren: () => { k.merkeModulBesuch?.(m.key); k.navigate(ziel); },
      });
    }

    // 3. Module
    for (const m of modulRegistry) {
      if (!istModulFreigegeben(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
      befehle.push({
        id: `modul:${m.key}`, gruppe: 'module', label: m.label, icon: m.icon,
        schlagworte: m.beschreibung ? [m.beschreibung] : undefined,
        ausfuehren: () => { k.merkeModulBesuch?.(m.key); k.navigate(ziel); },
      });
    }

    // 4. Schnellaktionen — nur wenn der User schreiben darf (kein Beobachter, aktiver Einsatz)
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

  // 5. Einsatz-Wechsel — aktive Einsätze (global)
  for (const e of k.einsaetze) {
    if (e.status !== 'aktiv') continue;
    befehle.push({
      id: `einsatz:${e.id}`, gruppe: 'einsaetze', label: e.bezeichnung, icon: TbList,
      schlagworte: e.stichwort ? [e.stichwort] : undefined,
      ausfuehren: () => k.navigate(einsatzPfad(e.id)),
    });
  }

  // 6. Schnelleinstellungen — global
  for (const t of THEME_BEFEHLE) {
    befehle.push({ id: t.id, gruppe: 'einstellungen', label: t.label, icon: t.icon, schlagworte: ['theme', 'hell', 'dunkel'], ausfuehren: () => k.setThemeModus(t.modus) });
  }
  for (const d of DICHTE_BEFEHLE) {
    befehle.push({ id: d.id, gruppe: 'einstellungen', label: d.label, icon: d.icon, schlagworte: ['dichte', 'treffflaeche', 'handschuh', 'tablet', 'bedienung'], ausfuehren: () => k.setDichte(d.stufe) });
  }
  for (const c of KOORD_BEFEHLE) {
    befehle.push({ id: `koord:${c.format}`, gruppe: 'einstellungen', label: `Koordinaten: ${c.label}`, icon: TbWorld, schlagworte: ['koordinaten', 'format', c.format], ausfuehren: () => k.setKoordinaten(c.format) });
  }

  // 7. Navigation — global
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
