import { etbPfad, personenPfad } from '../routing/deeplinks';
import { modulRegistry, type KategorieKey, type ModulEintrag } from './modulRegistry';

/**
 * Sprungmarken im Modulpanel (LFH-620): Einträge, die der Neuentwurf als eigene Module
 * führt, deren Daten aber ein vorhandenes Modul schon trägt. Eine Marke ist eine
 * gefilterte Sicht in dieses Modul, KEIN Modul.
 *
 * ── WARUM KEIN REGISTRY-EINTRAG MIT `verweistAuf` ──────────────────────────────────────
 *
 * Ein Registry-Eintrag ist ein Modul mit allen Folgen, und keine davon passt hier:
 *
 *  · Er hätte einen eigenen Modulschlüssel mit eigener Sichtbarkeit und eigener
 *    Rollen-Schranke (Modul-Overrides, LFH-132). „Entscheidungen" wäre dann unabhängig vom
 *    ETB schaltbar: ETB gesperrt, Entscheidungen frei, und der Sprung endete in einem 403 —
 *    das Backend gatet die ETB-Routen über den Schlüssel `etb` (`src/einsatz/modul.rs`,
 *    `PFAD_KEY`). Eine Marke ERBT deshalb Sichtbarkeit und Sperre ihres Zielmoduls.
 *  · Er bräuchte einen Eintrag in `MODUL_KEYS` im Backend und eine Zeile in den
 *    Einsatz-Einstellungen, die dort ein zweites Mal das ETB ein- und ausschaltet.
 *  · `verweistAuf` trägt ein Routen-SEGMENT, eine Marke braucht eine Query. Und
 *    `erstesFreigegebenesModul` navigiert über `modulZielRoute` — ein Eintrag in „Führung",
 *    der aufs ETB zeigt, führte den Rail-Klick in eine FREMDE Kategorie
 *    (`EinsatzLayout.test.tsx`, Kommentar am Kategorie-Sprung).
 *
 * Marken stehen deshalb in einer eigenen Liste, die nur das Modulpanel und das
 * Drawer-Akkordeon lesen. Die Registry bleibt frei von Deeplink-Bezügen
 * (`command-palette/befehle.ts`); die Pfade kommen aus `routing/deeplinks.ts`.
 *
 * ── HERVORHEBUNG ───────────────────────────────────────────────────────────────────────
 *
 * Eine Marke ist nie `aria-current`. Nach dem Sprung steht man im Zielmodul, und das trägt
 * die Hervorhebung — `modulAusPfad` kennt nur Routen. Die Marke zu markieren hieße, die
 * Query als Ort zu behandeln; bei den Personen ist sie nach dem Ankommen ohnehin geräumt.
 *
 * ── WAS NICHT HIERHER GEHÖRT ───────────────────────────────────────────────────────────
 *
 * Zähler: der Entwurf zeigt Entscheidungen 7 · Patienten 144 · Vermisste 9, dafür gibt es
 * keine Quelle (serverseitige Zähler sind LFH-612). Weggelassen, nicht erfunden.
 */
export interface Sprungmarke {
  key: string;
  kategorie: KategorieKey;
  label: string;
  /** Registry-Schlüssel des Moduls, in das gesprungen wird. Sichtbarkeit und Sperre folgen ihm. */
  zielModul: string;
  /**
   * Registry-Schlüssel des Moduls, HINTER dem die Marke im Panel steht. Fehlt es in der
   * Liste (anderer Zuschnitt), steht die Marke am Ende ihrer Kategorie.
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
    // „Patient" = gesichtet mit SK I–IV oder tot (`personen/personMeta.ts:istPatient`). Das
    // Sichtungsraster ist die verallgemeinerte Patienten-Sicht: es gruppiert ALLE Personen
    // nach Sichtung, die Patienten stehen in den Kategoriegruppen. Ein eigener Filter
    // „Patienten" vermengte Status- und Darstellungsachse (`personenFilter.ts`).
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

export type NavZeile = { art: 'modul'; modul: ModulEintrag } | { art: 'sprung'; marke: Sprungmarke };

/**
 * Module und Marken einer Kategorie in Panel-Reihenfolge. Rein, damit die Anordnung ohne
 * Rendern prüfbar ist.
 *
 * Verankert wird VOR jeder Sichtbarkeitsprüfung: ist das Ankermodul ausgeblendet, das
 * Zielmodul aber nicht, bleibt die Marke an ihrer Stelle stehen — der Aufrufer filtert
 * danach. Eine Marke darf auf eine andere Marke folgen (`nach: 'patienten'`); Marken ohne
 * auffindbaren Anker stehen am Ende.
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
