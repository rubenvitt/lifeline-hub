import {
  TbList,
  TbUser,
  TbSettings,
  TbLogout,
  TbPlus,
  TbSun,
  TbMoon,
  TbDeviceDesktop,
  TbWorld,
  TbArrowsMinimize,
  TbArrowsMaximize,
  TbHandStop,
} from 'react-icons/tb';
import {
  kategorien,
  modulRegistry,
  istModulFreigegeben,
  modulZielRoute,
  type KategorieKey,
} from '../einsatz/modulRegistry';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import {
  bereitstellungsraeumeListePfad,
  dokumentePfad,
  einsaetzePfad,
  einsatzabschnittePfad,
  einsatzModulPfad,
  einsatzPfad,
  etbPfad,
  personenPfad,
  schaedenPfad,
  stabPfad,
  tierePfad,
  unfallhilfsstellenListePfad,
} from '../routing/deeplinks';
import type { IconType } from 'react-icons';
import { GRUPPE_MERKBAR, sprungZu } from './typen';
import type { Befehl, BefehlKontext, Oeffnung, TastaturAktionId } from './typen';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
import { HELLIGKEIT_OPTIONEN } from '../theme/darstellungOptionen';
import type { Koordinatenformat } from '../api/types';

/** Kontext einer Moduloption: der volle Kategoriename. */
function kategorieKontext(key: KategorieKey): string | undefined {
  return kategorien.find((k) => k.key === key)?.label;
}

/**
 * Die Ziele stehen als **Builder** aus `routing/deeplinks.ts` in der Tabelle, nicht als
 * Routenstück: Unfallhilfsstellen und Bereitstellungsräume liegen unter `…/liste`, der bare
 * Modulpfad zeigt jeweils auf eine Seite, die `?neu=1` nicht liest.
 *
 * GEFAHREN FEHLEN BEWUSST (LFH-506): die Gefahrenmatrix hat keine Erfassungsmaske — ein
 * Gefahrengebiet entsteht durch Zeichnen auf der Lagekarte. Eine Zeile hierher zeigte ins Leere;
 * ein Einstieg bräuchte einen Zeichnen-Deeplink auf die Karte (eigenes Ticket).
 *
 * DIE REIHENFOLGE IST EINE ERFASSUNGSHÄUFIGKEIT, bewusst nicht die Registry-Reihenfolge (die ist
 * die Navigations-Rangfolge); sonst sortierte eine Umsortierung der Navigation still die Palette
 * um. Der `toEqual`-Pin in `befehle.test.ts` ist Absicht.
 *
 * Exportiert für `schnellaktionen.guard.test.ts` (Trägermodul, Ziel, Deckung gegen die Seiten,
 * die `?neu=1` lesen). Die Tabelle bleibt hier statt in der `modulRegistry`, die frei von
 * Router-/Deeplink-Bezügen ist.
 */
export const SCHNELLAKTIONEN: {
  modulKey: string;
  pfad: (einsatzId: number) => string;
  label: string;
  schlagworte: string[];
}[] = [
  {
    modulKey: 'personen',
    pfad: (id) => personenPfad(id, { neu: true }),
    label: 'Neue Person erfassen',
    schlagworte: ['registrieren', 'vermisst', 'betroffen', 'patient'],
  },
  {
    modulKey: 'etb',
    pfad: (id) => etbPfad(id, { neu: true }),
    label: 'Neuer ETB-Eintrag',
    schlagworte: ['tagebuch', 'meldung', 'eintrag'],
  },
  {
    modulKey: 'unfallhilfsstellen',
    pfad: (id) => unfallhilfsstellenListePfad(id, { neu: true }),
    label: 'Neue Unfallhilfsstelle',
    schlagworte: ['uhs', 'behandlungsplatz', 'patientenablage'],
  },
  {
    modulKey: 'schaeden',
    pfad: (id) => schaedenPfad(id, { neu: true }),
    label: 'Neuen Schaden erfassen',
    schlagworte: ['schaden', 'objekt'],
  },
  {
    // Ans ENDE: eine Lagebesprechung fällt seltener an als Person, ETB-Eintrag, UHS oder Schaden.
    // Leser: `pages/StabPage.tsx`.
    modulKey: 'stab',
    pfad: (id) => stabPfad(id, { neu: true }),
    label: 'Lagebesprechung abschließen',
    schlagworte: ['lagebesprechung', 'entschluss', 'stab', 'führungsvorgang'],
  },
  {
    // Ans ENDE: eine neue Zeile ordnet die Bestandszeilen nicht um. Leser: `pages/DokumentePage.tsx`.
    modulKey: 'dokumente',
    pfad: (id) => dokumentePfad(id, { neu: true }),
    label: 'Dokument ablegen',
    schlagworte: ['datei', 'hochladen', 'foto', 'lageplan', 'formular'],
  },
  // Ans ENDE (LFH-506), untereinander nach Erfassungshäufigkeit. Leser: `pages/TierePage.tsx`,
  // `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` (Listenroute, nicht der bare
  // Modulpfad), `pages/EinsatzabschnittePage.tsx`.
  {
    modulKey: 'tiere',
    pfad: (id) => tierePfad(id, { neu: true }),
    label: 'Neues Tier erfassen',
    schlagworte: ['tier', 'hund', 'katze', 'haustier', 'nutztier'],
  },
  {
    modulKey: 'bereitstellungsraeume',
    pfad: (id) => bereitstellungsraeumeListePfad(id, { neu: true }),
    label: 'Neuen Bereitstellungsraum anlegen',
    schlagworte: ['br', 'bereitstellung', 'sammelraum', 'kräfte'],
  },
  {
    modulKey: 'einsatzabschnitte',
    pfad: (id) => einsatzabschnittePfad(id, { neu: true }),
    label: 'Neuen Einsatzabschnitt anlegen',
    schlagworte: ['abschnitt', 'unterabschnitt', 'gliederung', 'ea'],
  },
];

const THEME_BEFEHLE: { id: string; label: string; modus: ThemeModus; icon: IconType }[] = [
  { id: 'theme:system', label: 'Darstellung: System', modus: 'system', icon: TbDeviceDesktop },
  { id: 'theme:light', label: 'Darstellung: Hell', modus: 'light', icon: TbSun },
  { id: 'theme:dark', label: 'Darstellung: Dunkel', modus: 'dark', icon: TbMoon },
];

/** Bediendichte über die Palette, die schnelle Abkürzung neben der Umschaltgruppe im
 *  Benutzermenü. Kein Ersatz: ein `Befehl` trägt kein Zustandsfeld, die Palette zeigt die
 *  aktive Stufe nicht an. */
const DICHTE_BEFEHLE: { id: string; label: string; stufe: Dichte; icon: IconType }[] = [
  { id: 'dichte:kompakt', label: 'Dichte: Kompakt', stufe: 'kompakt', icon: TbArrowsMinimize },
  {
    id: 'dichte:komfortabel',
    label: 'Dichte: Komfortabel',
    stufe: 'komfortabel',
    icon: TbArrowsMaximize,
  },
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
 * EIN exhaustives Verzeichnis je Aktion: eine neue `TastaturAktionId` ohne Eintrag bricht den
 * Typcheck (TS2741), statt still nie in der Palette zu erscheinen. Das Kürzel liegt am selben
 * Eintrag, damit keine ungebundene Aktion das Kürzel einer anderen trägt.
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
 * Die Reihenfolge der Gruppe „Aktionen“; getrennt, weil ein Record keine vertragliche Ordnung
 * hat. Dass sie jede Id genau einmal führt, prüft `befehle.test.ts`. Die drei Aktionen mit
 * Tastenweg bleiben vorn.
 */
export const TASTATUR_AKTION_REIHENFOLGE: readonly TastaturAktionId[] = [
  'speichern',
  'verwerfen',
  'filter-zuruecksetzen',
  'neue-zeile',
  'spalten',
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
 * Sichtbarer Gegenpart zur Ereignisauflösung; der User-Agent ist ein Parameter, damit beide
 * Plattformzweige ohne globale Browserwerte testbar sind. `null` heißt „kein Tastenweg“.
 */
export function kuerzelFuerTastaturAktion(id: TastaturAktionId, userAgent: string): string | null {
  return TASTATUR_AKTIONEN[id].kuerzel(istApplePlattform(userAgent));
}

/**
 * EINE Plattformweiche für alle sichtbaren Kürzel (auch „⌘ ↵ / Strg + ↵ neuer Tab“), damit ein
 * iPad mit Tastatur nicht einmal ⌘ und einmal Strg angezeigt bekommt.
 */
export function istApplePlattform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
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
    // 2. Zuletzt besucht. Freigabe über `istModulFreigegeben` wie in der Modul-Schleife und im
    //    Navigationsrahmen: ein entzogenes Modul verschwindet aus der Abkürzung.
    //    Eigenes id-Präfix: derselbe Eintrag steht auch unter „Module“, gleiche `id` machten
    //    `aria-activedescendant` mehrdeutig.
    //    Das aktuelle Modul fällt heraus: ein Sprung auf die eigene Seite kostet einen der Plätze.
    for (const key of k.zuletztModulKeys ?? []) {
      if (key === k.aktuellerModulKey) continue;
      const m = modulRegistry.find((x) => x.key === key);
      if (!m || !istModulFreigegeben(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
      befehle.push({
        id: `zuletzt:${m.key}`,
        gruppe: 'zuletzt',
        label: m.label,
        kontext: kategorieKontext(m.kategorie),
        icon: m.icon,
        ...sprungZu(ziel, k.navigate, () => k.merkeModulBesuch?.(m.key)),
      });
    }

    // 3. Module
    for (const m of modulRegistry) {
      if (!istModulFreigegeben(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
      befehle.push({
        id: `modul:${m.key}`,
        gruppe: 'module',
        label: m.label,
        kontext: kategorieKontext(m.kategorie),
        icon: m.icon,
        schlagworte: m.beschreibung ? [m.beschreibung] : undefined,
        ...sprungZu(ziel, k.navigate, () => k.merkeModulBesuch?.(m.key)),
      });
    }

    // 4. Schnellaktionen, nur mit Schreibrecht (kein Beobachter, aktiver Einsatz). Modulfilter ist
    //    die LESEACHSE `istModulFreigegeben` wie in 2. und 3., sonst zeigte eine Schnellaktion auf
    //    ein unfertiges Modul.
    if (k.darfSchreibenImEinsatz) {
      for (const a of SCHNELLAKTIONEN) {
        const m = modulRegistry.find((x) => x.key === a.modulKey);
        if (!m || !istModulFreigegeben(m, k.benutzer, k.overrides)) continue;
        const ziel = a.pfad(k.einsatzId);
        befehle.push({
          id: `aktion:${a.modulKey}`,
          gruppe: 'schnellaktionen',
          label: a.label,
          icon: TbPlus,
          schlagworte: a.schlagworte,
          ...sprungZu(ziel, k.navigate),
        });
      }
    }
  }

  // 5. Einsatz-Wechsel — aktive Einsätze (global)
  for (const e of k.einsaetze) {
    if (e.status !== 'aktiv') continue;
    befehle.push({
      id: `einsatz:${e.id}`,
      gruppe: 'einsaetze',
      label: e.bezeichnung,
      icon: TbList,
      schlagworte: e.stichwort ? [e.stichwort] : undefined,
      ...sprungZu(einsatzPfad(e.id), k.navigate),
    });
  }

  // 6. Schnelleinstellungen — global
  for (const t of THEME_BEFEHLE) {
    befehle.push({
      id: t.id,
      gruppe: 'einstellungen',
      label: t.label,
      icon: t.icon,
      schlagworte: ['theme', 'hell', 'dunkel'],
      ausfuehren: () => k.setThemeModus(t.modus),
    });
  }
  for (const d of DICHTE_BEFEHLE) {
    befehle.push({
      id: d.id,
      gruppe: 'einstellungen',
      label: d.label,
      icon: d.icon,
      schlagworte: ['dichte', 'treffflaeche', 'handschuh', 'tablet', 'bedienung'],
      ausfuehren: () => k.setDichte(d.stufe),
    });
  }
  // Helligkeit (LFH-397): aus derselben Stufenliste wie das Benutzermenü, keine Handkopie.
  for (const h of HELLIGKEIT_OPTIONEN) {
    befehle.push({
      id: `helligkeit:${h.wert}`,
      gruppe: 'einstellungen',
      label: `Helligkeit: ${h.titel}`,
      icon: h.Icon,
      schlagworte: ['helligkeit', 'dimmen', 'abdunkeln', 'nacht', 'bildschirm'],
      ausfuehren: () => k.setHelligkeit(h.wert),
    });
  }
  for (const c of KOORD_BEFEHLE) {
    befehle.push({
      id: `koord:${c.format}`,
      gruppe: 'einstellungen',
      label: `Koordinaten: ${c.label}`,
      icon: TbWorld,
      schlagworte: ['koordinaten', 'format', c.format],
      ausfuehren: () => k.setKoordinaten(c.format),
    });
  }

  // 7. Navigation — global
  befehle.push({
    id: 'nav:einsaetze',
    gruppe: 'navigation',
    label: 'Alle Einsätze',
    icon: TbList,
    ...sprungZu(einsaetzePfad(), k.navigate),
  });
  befehle.push({
    id: 'nav:profil',
    gruppe: 'navigation',
    label: 'Profil',
    icon: TbUser,
    ...sprungZu('/profil', k.navigate),
  });
  // Verwaltungsbereich und Stammdaten hängen am AdminLayout-Gate `darfVerwaltung`, wie Topbar und
  // Route.
  if (darfVerwaltung(k.benutzer)) {
    befehle.push({
      id: 'nav:stammdaten',
      gruppe: 'navigation',
      label: 'Stammdaten',
      icon: TbList,
      ...sprungZu('/stammdaten', k.navigate),
    });
    befehle.push({
      id: 'nav:admin',
      gruppe: 'navigation',
      label: 'Administration',
      icon: TbSettings,
      ...sprungZu('/admin', k.navigate),
    });
  }
  // Die Benutzerverwaltung bleibt strenger: `/benutzer` leitet auf `/admin/benutzer`, und
  // AdminLayout zeigt den Punkt nur System-Admins.
  if (k.benutzer?.system_rolle === 'admin') {
    befehle.push({
      id: 'nav:benutzer',
      gruppe: 'navigation',
      label: 'Benutzerverwaltung',
      icon: TbUser,
      ...sprungZu('/benutzer', k.navigate),
    });
  }
  // `nichtMerkbar`: der einzige Befehl ohne Rückweg. Gemerkt stünde er als erste, VORAUSGEWÄHLTE
  // Zeile der Startansicht, und `Strg/⌘+K` + Enter beendete die Sitzung.
  befehle.push({
    id: 'nav:abmelden',
    gruppe: 'navigation',
    label: 'Abmelden',
    icon: TbLogout,
    nichtMerkbar: true,
    ausfuehren: () => k.logout(),
  });

  // 8. Gedächtnis, ZULETZT, weil beide Hälften die FERTIGE Liste brauchen. Die Position im Array
  //    sagt nichts über die Palette: die Startansicht rendert über `GRUPPEN_REIHENFOLGE`.
  return mitGedaechtnis(befehle, k);
}

/**
 * Darf dieser Befehl ins Gedächtnis? KONJUNKTION aus Gruppenurteil und Einzel-Opt-out. EINE
 * Funktion für Schreib- UND Leseseite: der Serverstand kann von einem älteren Client stammen,
 * die Leseseite räumt ihn auf.
 */
function istMerkbar(b: Befehl): boolean {
  return GRUPPE_MERKBAR[b.gruppe] && !b.nichtMerkbar;
}

/** Id-Präfix der Gedächtniszeilen, wie bei `zuletzt:`: dieselbe `id` zweimal im Baum machte
 *  `aria-activedescendant` mehrdeutig. */
const AUSGEFUEHRT_PRAEFIX = 'ausgefuehrt:';

/**
 * Hängt das Gedächtnis an eine fertige Befehlsliste; rein, alles nach außen kommt über
 * `k.merkeBefehl` bzw. `k.zuletztBefehlIds`.
 *
 * ERST wickeln, DANN klonen: die Gedächtniszeile erbt die Meldung ihres Originals mit dessen
 * `b.id`. Andersherum wüchse bei jedem Griff ein Präfix an, das beim nächsten Aufbau nicht mehr
 * auflöst.
 */
function mitGedaechtnis(befehle: Befehl[], k: BefehlKontext): Befehl[] {
  // OHNE Callback bleibt die Liste unangetastet (kein Wrapper, keine neue Identität):
  // `useBefehle` wird auch außerhalb der Palette gerendert.
  const merkend = k.merkeBefehl
    ? befehle.map((b) =>
        istMerkbar(b)
          ? {
              ...b,
              // Die Öffnungsart geht durch: ein Griff mit Strg/⌘+↵ merkt sich den Befehl wie ein ↵.
              ausfuehren: (oeffnung?: Oeffnung) => {
                k.merkeBefehl?.(b.id);
                b.ausfuehren(oeffnung);
              },
            }
          : b,
      )
    : befehle;

  const ausgefuehrt: Befehl[] = [];
  for (const id of k.zuletztBefehlIds ?? []) {
    const treffer = merkend.find((b) => b.id === id);
    // DER RIEGEL GILT AUCH BEIM LESEN: ein älterer Client kann `GRUPPE_MERKBAR` nicht gekannt
    // haben, sonst stünde ein Modul zum DRITTEN Mal in der Liste.
    if (!treffer || !istMerkbar(treffer)) continue;
    ausgefuehrt.push({
      ...treffer,
      id: `${AUSGEFUEHRT_PRAEFIX}${treffer.id}`,
      gruppe: 'ausgefuehrt',
    });
  }
  return ausgefuehrt.length > 0 ? [...merkend, ...ausgefuehrt] : merkend;
}
