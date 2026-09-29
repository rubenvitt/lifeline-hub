import { etbPfad, fahrzeugePfad, personenPfad } from '../routing/deeplinks';
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
  /** Was der Sprung zeigt — zugänglicher Name und Titel („springt zu …"). */
  hinweis: string;
  pfad: (einsatzId: number) => string;
}

export const sprungmarken: Sprungmarke[] = [
  {
    key: 'entscheidungen',
    kategorie: 'fuehrung',
    label: 'Entscheidungen',
    zielModul: 'etb',
    nach: 'auftraege',
    hinweis: 'ETB, Typ Entscheidung',
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
    hinweis: 'Personen, Sichtungsraster',
    pfad: (einsatzId) => personenPfad(einsatzId, { ansicht: 'raster', filter: 'alle' }),
  },
  {
    key: 'vermisste',
    kategorie: 'erfassung',
    label: 'Vermisste',
    zielModul: 'personen',
    nach: 'patienten',
    hinweis: 'Personen, Filter Vermisst',
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
    hinweis: 'Fahrzeuge, FMS-Tableau',
    pfad: (einsatzId) => fahrzeugePfad(einsatzId, { ansicht: 'tableau' }),
  },
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

export type NavZeile =
  { art: 'modul'; modul: ModulEintrag } | { art: 'sprung'; marke: Sprungmarke };

/**
 * Module und Marken einer Kategorie in Panel-Reihenfolge. Rein.
 * Verankert wird VOR jeder Sichtbarkeitsprüfung: ist das Ankermodul ausgeblendet, das Ziel aber
 * nicht, bleibt die Marke an ihrer Stelle. Eine Marke darf auf eine Marke folgen; ohne
 * auffindbaren Anker steht sie am Ende.
 */
export function navZeilen(module: ModulEintrag[], marken: Sprungmarke[]): NavZeile[] {
  const zeilen: NavZeile[] = [];
  const offen = new Set(marken);
  const haengeAn = (anker: string) => {
    for (const marke of marken) {
      if (!offen.has(marke) || marke.nach !== anker) continue;
      offen.delete(marke);
      zeilen.push({ art: 'sprung', marke });
      haengeAn(marke.key);
    }
  };
  for (const modul of module) {
    zeilen.push({ art: 'modul', modul });
    haengeAn(modul.key);
  }
  for (const marke of marken) {
    if (offen.has(marke)) zeilen.push({ art: 'sprung', marke });
  }
  return zeilen;
}
