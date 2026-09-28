import type { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/query-persist-client-core';
import type { BenutzerAnzeige } from '../api/types';
import { fetchErfolgeVerfolgen } from './lagebildBestaetigung';
import { lagebildDehydrierFilter } from './lagebildFilter';
import { erzeugeLagebildPersister, type LagebildPersister } from './lagebildPersister';
import {
  lagebildAnlegen,
  lagebildBestaetigen,
  lagebildLesen,
  lagebildLoeschenPlatte,
} from './lagebildSpeicher';
import { HOECHSTLIEGEZEIT_MS, startEntscheidung, type MeErgebnis } from './lagebildStart';

/**
 * Steuerung der Lagebild-Vorhaltung je QueryClient (LFH-723, design.md D2/D5): Start nach
 * geklärter Identität, Anmeldung, Löschen. `AuthProvider` ist der einzige Aufrufer.
 *
 * Alle Schritte eines Clients laufen HINTEREINANDER (`reihe`): React ruft den Start-Effekt im
 * StrictMode zweimal, und ein Löschen, das sich mit einem noch laufenden Start überholt,
 * hinterließe einen wieder angelegten Datensatz.
 */

/** Die Bestätigung braucht keine Sekundengenauigkeit — ein Schreibvorgang je halbe Minute
 *  reicht und hält die IndexedDB aus dem Takt jedes einzelnen Abrufs heraus. */
const BESTAETIGUNG_DROSSEL_MS = 30_000;

interface Sitzung {
  benutzerId: number;
  persister: LagebildPersister;
  abmelden: () => void;
}

export interface SitzungsOptionen {
  /** Drosselung des Persisters, im Test kürzer. */
  drosselMs?: number;
  /** Zeitpunkt der Serverbestätigung beim Start, im Test festgelegt. */
  jetzt?: number;
  /** Ist der Aufrufer inzwischen weg (Effekt abgeräumt)? Dann tut der Start nichts mehr —
   *  sonst abonnierte ein Start, dessen Sitzungsprüfung erst nach dem Aushängen antwortet,
   *  einen verwaisten Client und legte einen Datensatz an, den niemand mehr löscht. */
  abgebrochen?: () => boolean;
}

const SITZUNGEN = new WeakMap<QueryClient, Sitzung>();
const REIHEN = new WeakMap<QueryClient, Promise<unknown>>();

function reihe<T>(qc: QueryClient, schritt: () => Promise<T>): Promise<T> {
  const vorher = REIHEN.get(qc) ?? Promise.resolve();
  const dieser = vorher.catch(() => {}).then(schritt);
  REIHEN.set(qc, dieser);
  return dieser;
}

function leererClient(buster: string) {
  return { timestamp: Date.now(), buster, clientState: { queries: [], mutations: [] } };
}

/** Beginnt das Speichern für einen Benutzer. Ein bestehender Datensatz wird vorausgesetzt:
 *  der Persister legt keinen an (design.md D1). */
function abonnieren(
  qc: QueryClient,
  benutzerId: number,
  buster: string,
  { drosselMs }: SitzungsOptionen,
): void {
  const persister = erzeugeLagebildPersister(benutzerId, { drosselMs });
  const speichernAbmelden = persistQueryClientSubscribe({
    queryClient: qc,
    persister,
    buster,
    dehydrateOptions: { shouldDehydrateQuery: lagebildDehydrierFilter(qc) },
  });
  let zuletztBestaetigt = 0;
  const bestaetigungAbmelden = fetchErfolgeVerfolgen(qc, () => {
    const jetzt = Date.now();
    if (jetzt - zuletztBestaetigt < BESTAETIGUNG_DROSSEL_MS) return;
    zuletztBestaetigt = jetzt;
    void lagebildBestaetigen(benutzerId, jetzt);
  });
  SITZUNGEN.set(qc, {
    benutzerId,
    persister,
    abmelden: () => {
      speichernAbmelden();
      bestaetigungAbmelden();
    },
  });
}

/** Beendet das Speichern, ohne zu löschen: ein ausstehender Durchlauf entfällt. */
async function beenden(qc: QueryClient): Promise<void> {
  const sitzung = SITZUNGEN.get(qc);
  if (!sitzung) return;
  SITZUNGEN.delete(qc);
  sitzung.abmelden();
  await sitzung.persister.abbrechen();
}

async function loeschen(qc: QueryClient): Promise<void> {
  await beenden(qc);
  qc.clear();
  await lagebildLoeschenPlatte();
}

/**
 * Start der App: entscheidet nach der Sitzungsprüfung, wer angemeldet ist und ob der
 * vorgehaltene Stand in den Speicher darf, und beginnt danach das Speichern.
 *
 * Muss fertig sein, BEVOR eine Seite eine Query einhängt — `AuthProvider` hält `laedt` bis
 * dahin, und `RequireAuth` rendert nichts Geschütztes. Ein Fremdstand erreicht den Speicher
 * damit nie, auch nicht kurz vor einer 401.
 */
export function lagebildStarten(
  qc: QueryClient,
  me: MeErgebnis,
  optionen: SitzungsOptionen = {},
): Promise<BenutzerAnzeige | null> {
  const abgebrochen = optionen.abgebrochen ?? (() => false);
  return reihe(qc, async () => {
    if (abgebrochen()) return null;
    const jetzt = optionen.jetzt ?? Date.now();
    const buster = __APP_VERSION__;
    const satz = await lagebildLesen();
    const entscheidung = startEntscheidung(me, satz, jetzt, buster);
    // Beim Start nur die PLATTE: im Speicher steht noch nichts vom verworfenen Stand — er
    // wurde nicht wiederhergestellt, und `RequireAuth` hält die Seiten bis zum Ende des
    // Starts zurück. Ein `clear()` hier träfe allein Abfragen, die schon laufen (Palette,
    // Kopfleiste) — Daten der aktuellen Sitzung, nicht die des verworfenen Stands.
    if (entscheidung.loeschen) {
      await beenden(qc);
      await lagebildLoeschenPlatte();
    }
    const benutzer = entscheidung.benutzer;
    if (!benutzer) return null;

    // Läuft schon eine Sitzung derselben Person (zweiter Effekt-Lauf im StrictMode), bleibt
    // sie stehen: nochmals wiederherzustellen, bräuchte nichts.
    if (SITZUNGEN.get(qc)?.benutzerId === benutzer.id) return benutzer;
    await beenden(qc);

    if (entscheidung.wiederherstellen) {
      try {
        await persistQueryClientRestore({
          queryClient: qc,
          persister: erzeugeLagebildPersister(benutzer.id),
          buster,
          maxAge: HOECHSTLIEGEZEIT_MS,
        });
      } catch {
        // Ein unlesbarer Stand ist verworfen (der Restore löscht ihn selbst) — weiter ohne.
      }
    }
    if (abgebrochen()) return null;
    if (me.art === 'ok') {
      // Serverbestätigt: Datensatz anlegen bzw. mit frischer Identität und Bestätigung
      // fortschreiben. Ohne Server (Netzfehler) bleibt der Datensatz, wie er ist.
      const bestand = entscheidung.wiederherstellen ? await lagebildLesen() : undefined;
      await lagebildAnlegen({
        benutzer,
        bestaetigtAt: jetzt,
        buster,
        client: bestand?.client ?? leererClient(buster),
      });
    }
    abonnieren(qc, benutzer.id, buster, optionen);
    return benutzer;
  });
}

/**
 * Nach einer erfolgreichen Anmeldung (Passwort, Passkey, TOTP). Eine andere Person als die
 * der laufenden Sitzung oder des Datensatzes räumt zuerst Speicher und Platte.
 */
export function lagebildAnmelden(
  qc: QueryClient,
  benutzer: BenutzerAnzeige,
  optionen: SitzungsOptionen = {},
): Promise<void> {
  return reihe(qc, async () => {
    const jetzt = optionen.jetzt ?? Date.now();
    const buster = __APP_VERSION__;
    const laufend = SITZUNGEN.get(qc);
    const satz = await lagebildLesen();
    const fremd =
      (laufend !== undefined && laufend.benutzerId !== benutzer.id) ||
      (satz !== undefined && satz.benutzer.id !== benutzer.id);
    if (fremd) await loeschen(qc);
    const bestand = fremd ? undefined : satz;
    await lagebildAnlegen({
      benutzer,
      bestaetigtAt: jetzt,
      buster,
      client: bestand && bestand.buster === buster ? bestand.client : leererClient(buster),
    });
    if (SITZUNGEN.get(qc)?.benutzerId !== benutzer.id)
      abonnieren(qc, benutzer.id, buster, optionen);
  });
}

/** Abmelden, Sitzungsablauf, Benutzerwechsel: Speicher UND Platte leeren (design.md D5). Die
 *  Offline-Queue bleibt unberührt — sie ist Beweissicherung. */
export function lagebildLoeschen(qc: QueryClient): Promise<void> {
  return reihe(qc, () => loeschen(qc));
}

/** Beendet das Speichern ohne zu löschen — beim Aushängen des `AuthProvider`. */
export function lagebildBeenden(qc: QueryClient): Promise<void> {
  return reihe(qc, () => beenden(qc));
}
