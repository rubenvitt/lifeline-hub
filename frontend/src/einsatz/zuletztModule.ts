/**
 * Merkt die zuletzt gewählten Module einer Person in einem Einsatz (LFH-337, LFH-436).
 *
 * JE EINSATZ, anders als `navPersistenz.ts`: „Panel zu" ist eine Vorliebe der Person,
 * „zuletzt in Personen und ETB" eine Eigenschaft der Lage. Ein Einsatzwechsel darf die
 * Abkürzungen des vorigen nicht mitschleppen.
 *
 * JE BENUTZER, weil localStorage pro Browserprofil merkt: am gemeinsamen Fükw-Rechner erbte die
 * nächste Schicht sonst die Abkürzungen der vorigen (derselbe Grund, aus dem das
 * Befehls-Gedächtnis `zuletzt_befehle` auf dem Server liegt).
 *
 * MIT FRIST je Eintrag ({@link ZULETZT_FRIST_MS}): gemerkt wird nur am bewussten Klick, eine
 * frisch geladene Sitzung zeigte sonst den Stand vom letzten Klick — womöglich von gestern.
 *
 * Gemerkt wird, was jemand GEWÄHLT hat, nicht, wohin er geleitet wurde
 * (`openspec/changes/lfh-436-zuletzt-speicher-zugaenge/design.md`):
 *
 * | Zugang                                          | merkt | warum                                  |
 * |-------------------------------------------------|-------|----------------------------------------|
 * | Modul-Panel, Drawer-Akkordeon                   | ja    | Wahl genau dieses Moduls               |
 * | Palette: Module, Zuletzt, Schnellaktionen       | ja    | ein Griff, ein Modul                   |
 * | Führung · Überblick, Lage-Dashboard             | ja    | Startseite; jedes Ziel ist eine Wahl   |
 * | Rail-Sprung                                     | nein  | leitet ins erste Modul der Kategorie — |
 * |                                                 |       | drei Rail-Klicks überschrieben die     |
 * |                                                 |       | ganze Liste                            |
 * | Einsatz-Switcher / Standardmodul                | nein  | Ankunft, das Ziel wählt `standard_modul`|
 * | Adresse von außen, neuer Tab                    | nein  | kein Klick in der App                  |
 * | Querverweise in Modulinhalten                   | nein  | folgt einem Datensatz, keiner Modulwahl|
 *
 * Seiten mit Modulzielen verdrahten sich über `useModulWahl.ts`.
 *
 * Jeder Zugriff liegt in `try`/`catch`: im Privatmodus wirft der Speicher, und eine
 * vergessene Abkürzung ist kein Grund, den Einsatz-Rahmen abstürzen zu lassen.
 *
 * Einziger LESER ist die Kommandopalette (Gruppe „Zuletzt besucht").
 */

/** Höchstzahl gemerkter Module: genug für einen Arbeitsrhythmus, kurz genug, dass die Zeile
    keine zweite Modulliste wird. */
export const ZULETZT_MAX = 3;

/** Lebensdauer eines Eintrags ab seiner letzten Wahl: eine Schichtlänge. */
export const ZULETZT_FRIST_MS = 12 * 60 * 60 * 1000;

interface Eintrag {
  key: string;
  /** Zeitpunkt der letzten Wahl, Millisekunden seit Epoch. */
  at: number;
}

const schluessel = (benutzerId: number, einsatzId: number) =>
  `lfh:nav:zuletzt:${benutzerId}:${einsatzId}`;

/**
 * Die gültigen Einträge, jüngstes zuerst. `JSON.parse` gelingt auch bei `42` oder `["etb"]`
 * (dem Format vor LFH-436, ohne Zeitstempel): fremder Inhalt gilt als „nichts gemerkt".
 */
function leseEintraege(benutzerId: number, einsatzId: number, jetzt: number): Eintrag[] {
  try {
    const roh = localStorage.getItem(schluessel(benutzerId, einsatzId));
    if (!roh) return [];
    const wert: unknown = JSON.parse(roh);
    if (!Array.isArray(wert)) return [];
    return wert
      .filter(
        (e): e is Eintrag =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as Eintrag).key === 'string' &&
          typeof (e as Eintrag).at === 'number',
      )
      .filter((e) => jetzt - e.at <= ZULETZT_FRIST_MS)
      .slice(0, ZULETZT_MAX);
  } catch {
    return [];
  }
}

/**
 * Merkt eine Wahl. Der Eintrag rutscht nach vorn und seine Frist beginnt neu; eine bestehende
 * Nennung wird entfernt statt verdoppelt — sonst füllte ein Hin-und-Her zwischen zwei Modulen
 * die Liste mit Kopien und verdrängte das dritte Ziel. Abgelaufene Einträge fallen beim
 * Schreiben mit heraus.
 */
export function merkeModulBesuch(
  benutzerId: number,
  einsatzId: number,
  modulKey: string,
  jetzt: number = Date.now(),
): void {
  try {
    const liste = [
      { key: modulKey, at: jetzt },
      ...leseEintraege(benutzerId, einsatzId, jetzt).filter((e) => e.key !== modulKey),
    ].slice(0, ZULETZT_MAX);
    localStorage.setItem(schluessel(benutzerId, einsatzId), JSON.stringify(liste));
  } catch {
    /* Speicher gesperrt (Privatmodus) — ohne Persistenz weiterarbeiten */
  }
}

/** Liest die gemerkten Modulschlüssel innerhalb der Frist, jüngstes zuerst. */
export function leseZuletztModule(
  benutzerId: number,
  einsatzId: number,
  jetzt: number = Date.now(),
): string[] {
  return leseEintraege(benutzerId, einsatzId, jetzt).map((e) => e.key);
}
