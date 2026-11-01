import {
  abloesungPfad,
  etbPfad,
  fahrzeugePfad,
  funkplanPfad,
  kommunikationsplanPfad,
  personenPfad,
} from '../routing/deeplinks';
import { SACHGEBIETE } from '../stab/sachgebiete';
import { unterseitenFuer } from '../stab/unterseiten';
import {
  istModulFreigegeben,
  modulRegistry,
  type KategorieKey,
  type ModulEintrag,
} from './modulRegistry';
import type { ModulFreigaben } from '../api/types';

/**
 * Sprungmarken im Modulpanel: Einträge, die der Entwurf als eigene Module führt, deren Daten
 * aber ein vorhandenes Modul trägt. Eine Marke ist eine gefilterte Sicht in dieses Modul, KEIN
 * Modul.
 *
 * Kein Registry-Eintrag mit `verweistAuf`, weil ein Modul eigene Sichtbarkeit und
 * Rollen-Schranke hätte („Entscheidungen" frei, ETB gesperrt → 403, das Backend gatet über
 * `etb`), einen Eintrag in `MODUL_KEYS` bräuchte und `verweistAuf` nur ein Routen-SEGMENT
 * trägt, keine Query. Außerdem führte der Rail-Klick über `modulZielRoute` in eine FREMDE
 * Kategorie. Eine Marke ERBT Sichtbarkeit und Sperre ihres Zielmoduls; die Pfade kommen aus
 * `routing/deeplinks.ts`.
 *
 * Eine Marke ist nie `aria-current`: nach dem Sprung trägt das Zielmodul die Hervorhebung, und
 * das Panel folgt dem Ort (Erfassung statt Führung) — gewollt, die Marke trägt ihr Ziel im
 * Namen („springt zu ETB …").
 *
 * Keine Zähler: für Sprungmarken gibt es keine Quelle — weggelassen, nicht erfunden.
 *
 * Dieselbe Tabelle speist die Gruppe „Ansichten“ der Sprungpalette (LLH-1127,
 * `command-palette/befehle.ts`); dort zählen zusätzlich die `schlagworte`.
 */
export interface Sprungmarke {
  key: string;
  kategorie: KategorieKey;
  label: string;
  /** Registry-Schlüssel des Moduls, in das gesprungen wird. Sichtbarkeit und Sperre folgen ihm. */
  zielModul: string;
  /**
   * Registry-Schlüssel des Moduls, HINTER dem die Marke im Panel steht. Fehlt es (anderer
   * Zuschnitt), steht die Marke am Ende ihrer Kategorie.
   */
  nach: string;
  /**
   * Was der Sprung zeigt, als Ziel ohne Verb („ETB · Entscheidung“, LFH-1078): der Titel; der
   * zugängliche Name stellt „springt zu“ davor, weil der Pfeil daneben nur Dekoration ist.
   */
  hinweis: string;
  /** Suchworte für die Sprungpalette; das Menü zeigt sie nicht. */
  schlagworte: string[];
  /**
   * Weiteres Modul (Registry-Schlüssel), ohne dessen Daten die Ansicht nicht steht. Ist es nicht
   * frei, ist die Marke gesperrt wie bei gesperrtem Zielmodul (LLH-1312). Ein einzelner Schlüssel
   * statt einer Liste: ein String-Array sähe für `queryKeys.guard` wie ein Query-Key aus.
   */
  braucht?: string;
  pfad: (einsatzId: number) => string;
}

/** Suchworte der Stab-Unterseiten je Schlüssel aus `stab/unterseiten.ts`; das Kürzel (s5) kommt dazu. */
const STAB_SCHLAGWORTE: Record<string, string[]> = {
  presse: ['presse', 'medien', 'pressemitteilung', 'medienlage'],
  infotelefon: ['bürgertelefon', 'anrufe', 'hotline', 'infotelefon', 'informationstelefon'],
};

/**
 * Die Arbeitsseiten des Stabs (LLH-1127) als Marken direkt hinter „Stab“, nach Sachgebiet: nur
 * die Unterseiten, die dem Stab gehören (S5). Name und Adresse kommen aus `stab/unterseiten.ts`,
 * EINE Wahrheit mit den Einstiegen der Stab-Seite. Sperre und Sichtbarkeit erben sie vom Stab.
 */
function stabMarken(): Sprungmarke[] {
  const marken: Sprungmarke[] = [];
  let nach = 'stab';
  for (const { sachgebiet, kuerzel } of SACHGEBIETE) {
    for (const seite of unterseitenFuer(sachgebiet)) {
      if (seite.modul !== 'stab') continue;
      marken.push({
        key: seite.key,
        kategorie: 'fuehrung',
        label: seite.label,
        zielModul: 'stab',
        nach,
        hinweis: `Stab · ${seite.label}`,
        schlagworte: [...(STAB_SCHLAGWORTE[seite.key] ?? []), kuerzel.toLowerCase()],
        pfad: seite.pfad,
      });
      nach = seite.key;
    }
  }
  return marken;
}

/**
 * Die Ansichten des Fernmeldewesens (LLH-1180, design.md D10) als Marken direkt hinter
 * „Fernmeldewesen“: die Fernmeldeskizze und der Kommunikationsplan. Den Funkplan öffnet das Modul
 * selbst, eine Marke dafür wäre doppelt. Sperre und Sichtbarkeit erben sie vom Fernmeldewesen.
 * Die Funk-Schlagworte hängen an der Skizze, damit „tmo“ oder „sprechgruppe“ in der Palette
 * weiter in die Fernmeldeansicht führt; „funk“ selbst nicht, das trifft das Modul über seine
 * Beschreibung („Funkplan, …“) als ersten Treffer (Spec `sprungpalette`).
 */
const FERNMELDEWESEN_MARKEN: Sprungmarke[] = [
  {
    key: 'fernmeldeskizze',
    kategorie: 'kommunikation',
    label: 'Fernmeldeskizze',
    zielModul: 'fernmeldewesen',
    nach: 'fernmeldewesen',
    hinweis: 'Fernmeldewesen · Skizze',
    schlagworte: [
      'skizze',
      'fernmeldeskizze',
      'kommunikationsskizze',
      'sprechgruppe',
      'tmo',
      'dmo',
      'kanal',
      'rufname',
      's6',
    ],
    pfad: (einsatzId) => funkplanPfad(einsatzId, { ansicht: 'skizze' }),
  },
  {
    key: 'kommunikationsplan',
    kategorie: 'kommunikation',
    label: 'Kommunikationsplan',
    zielModul: 'fernmeldewesen',
    nach: 'fernmeldeskizze',
    hinweis: 'Fernmeldewesen · Kommunikationsplan',
    schlagworte: ['telefon', 'rufnummer', 'leitstelle', 'erreichbarkeit', 's6'],
    pfad: kommunikationsplanPfad,
  },
];

export const sprungmarken: Sprungmarke[] = [
  {
    key: 'entscheidungen',
    kategorie: 'fuehrung',
    label: 'Entscheidungen',
    zielModul: 'etb',
    nach: 'auftraege',
    hinweis: 'ETB · Entscheidung',
    schlagworte: ['entscheidung', 'beschluss', 'entschluss'],
    pfad: (einsatzId) => etbPfad(einsatzId, { typ: 'entscheidung' }),
  },
  {
    // „Patient" = gesichtet mit SK I–IV oder tot. Das Sichtungsraster ist die verallgemeinerte
    // Patienten-Sicht; ein Filter „Patienten" vermengte Status- und Darstellungsachse.
    key: 'patienten',
    kategorie: 'erfassung',
    label: 'Patienten',
    zielModul: 'personen',
    nach: 'personen',
    hinweis: 'Personen · Sichtungsraster',
    schlagworte: ['sichtung', 'sichtungsraster', 'sk', 'verletzte'],
    pfad: (einsatzId) => personenPfad(einsatzId, { ansicht: 'raster', filter: 'alle' }),
  },
  {
    key: 'vermisste',
    kategorie: 'erfassung',
    label: 'Vermisste',
    zielModul: 'personen',
    nach: 'patienten',
    hinweis: 'Personen · Vermisst',
    schlagworte: ['vermisst', 'suche', 'abgängig'],
    pfad: (einsatzId) => personenPfad(einsatzId, { ansicht: 'zeilen', filter: 'vermisst' }),
  },
  {
    // Das Tableau ist eine Ansicht der Fahrzeugseite und erbt Sichtbarkeit und Sperre von
    // `fahrzeuge` (dort hängen Status-PATCH und Live-Ereignis).
    key: 'fms-tableau',
    kategorie: 'kraefte',
    label: 'FMS-Tableau',
    zielModul: 'fahrzeuge',
    nach: 'fahrzeuge',
    hinweis: 'Fahrzeuge · FMS-Tableau',
    schlagworte: ['fms', 'status', 'statustableau', 'fahrzeugstatus'],
    pfad: (einsatzId) => fahrzeugePfad(einsatzId, { ansicht: 'tableau' }),
  },
  {
    // Einheiten im Einsatz ohne Schicht (LLH-1312): die Ansicht der Seite Ablösung, die in der
    // Anlaufphase zählt. Ohne Freigabe des Moduls Einheiten zeigt die Seite „Laufend“, deshalb
    // sperrt sie auch die Marke.
    key: 'ohne-schicht',
    kategorie: 'kraefte',
    label: 'Ohne Schicht',
    zielModul: 'abloesung',
    nach: 'abloesung',
    hinweis: 'Ablösung · Ohne Schicht',
    schlagworte: ['ohne schicht', 'schicht beginnen', 'anlaufphase', 'eingetroffen'],
    braucht: 'einheiten',
    pfad: (einsatzId) => abloesungPfad(einsatzId, { ansicht: 'ohne-schicht' }),
  },
  ...stabMarken(),
  ...FERNMELDEWESEN_MARKEN,
];

export function sprungmarkenNachKategorie(
  kategorie: KategorieKey,
  marken: Sprungmarke[] = sprungmarken,
): Sprungmarke[] {
  return marken.filter((m) => m.kategorie === kategorie);
}

/** Das Zielmodul einer Marke — oder `null`, wenn es nicht (mehr) in der Registry steht. */
export function sprungZiel(
  marke: Sprungmarke,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  return register.find((m) => m.key === marke.zielModul) ?? null;
}

/**
 * Sperrt das Modul aus `braucht` die Marke? Erst mit bekannten Freigaben, wie `istModulGesperrt`:
 * beim Laden flackerte das Menü sonst. Die Sprungpalette prüft das Zielmodul ohnehin mit
 * `istModulFreigegeben`, das bei Unbekanntem zu bleibt.
 */
export function sprungVoraussetzungGesperrt(
  marke: Sprungmarke,
  freigaben?: ModulFreigaben,
  register: ModulEintrag[] = modulRegistry,
): boolean {
  if (freigaben == null || marke.braucht == null) return false;
  const modul = register.find((m) => m.key === marke.braucht);
  return !modul || !istModulFreigegeben(modul, freigaben);
}

type NavZeile = { art: 'modul'; modul: ModulEintrag } | { art: 'sprung'; marke: Sprungmarke };

/**
 * Module und Marken einer Kategorie in Panel-Reihenfolge. Rein.
 * Verankert wird VOR jeder Sichtbarkeitsprüfung: ist das Ankermodul ausgeblendet, das Ziel aber
 * nicht, bleibt die Marke an ihrer Stelle. Eine Marke darf auf eine Marke folgen; ohne
 * auffindbaren Anker steht sie am Ende.
 */
export function navZeilen(module: ModulEintrag[], marken: Sprungmarke[]): NavZeile[] {
  const zeilen: NavZeile[] = [];
  const offen = new Set(marken);
  const appendAn = (anker: string) => {
    for (const marke of marken) {
      if (!offen.has(marke) || marke.nach !== anker) continue;
      offen.delete(marke);
      zeilen.push({ art: 'sprung', marke });
      appendAn(marke.key);
    }
  };
  for (const modul of module) {
    zeilen.push({ art: 'modul', modul });
    appendAn(modul.key);
  }
  for (const marke of marken) {
    if (offen.has(marke)) zeilen.push({ art: 'sprung', marke });
  }
  return zeilen;
}
