import { etbPfad, fahrzeugePfad, funkplanPfad, personenPfad } from '../routing/deeplinks';
import { SACHGEBIETE } from '../stab/sachgebiete';
import { unterseitenFuer } from '../stab/unterseiten';
import { modulRegistry, type KategorieKey, type ModulEintrag } from './modulRegistry';

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
  pfad: (einsatzId: number) => string;
}

/** Suchworte der Stab-Unterseiten je Schlüssel aus `stab/unterseiten.ts`; das Kürzel (s5, s6) kommt dazu. */
const STAB_SCHLAGWORTE: Record<string, string[]> = {
  presse: ['presse', 'medien', 'pressemitteilung', 'medienlage'],
  infotelefon: ['bürgertelefon', 'anrufe', 'hotline', 'infotelefon', 'informationstelefon'],
  funkplan: ['funk', 'sprechgruppe', 'tmo', 'dmo', 'kanal', 'rufname'],
  kommunikationsplan: ['telefon', 'rufnummer', 'leitstelle', 'erreichbarkeit'],
};

/**
 * Die Arbeitsseiten des Stabs (LLH-1127) als Marken direkt hinter „Stab“, nach Sachgebiet.
 * Name und Adresse kommen aus `stab/unterseiten.ts`, EINE Wahrheit mit den Einstiegen der
 * Stab-Seite; nur die Fernmeldeskizze ist eine Ansicht des Funkplans und steht hier selbst.
 * Sperre und Sichtbarkeit erben sie vom Stab, wie die Seiten selbst (`useStabFreigabe`).
 */
function stabMarken(): Sprungmarke[] {
  const marken: Sprungmarke[] = [];
  let nach = 'stab';
  const append = (marke: Omit<Sprungmarke, 'kategorie' | 'zielModul' | 'nach'>) => {
    marken.push({ ...marke, kategorie: 'fuehrung', zielModul: 'stab', nach });
    nach = marke.key;
  };
  for (const { sachgebiet, kuerzel } of SACHGEBIETE) {
    const sg = kuerzel.toLowerCase();
    for (const seite of unterseitenFuer(sachgebiet)) {
      append({
        key: seite.key,
        label: seite.label,
        hinweis: `Stab · ${seite.label}`,
        schlagworte: [...(STAB_SCHLAGWORTE[seite.key] ?? []), sg],
        pfad: seite.pfad,
      });
      if (seite.key === 'funkplan') {
        append({
          key: 'fernmeldeskizze',
          label: 'Fernmeldeskizze',
          hinweis: 'Funkplan · Skizze',
          schlagworte: ['skizze', 'fernmeldeskizze', 'kommunikationsskizze', 'funk', sg],
          pfad: (einsatzId) => funkplanPfad(einsatzId, { ansicht: 'skizze' }),
        });
      }
    }
  }
  return marken;
}

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
  ...stabMarken(),
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
