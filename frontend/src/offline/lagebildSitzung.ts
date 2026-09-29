import { hydrate, type QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientSave,
  persistQueryClientSubscribe,
  type PersistedClient,
} from '@tanstack/query-persist-client-core';
import type { BenutzerAnzeige } from '../api/types';
import { fetchErfolgeVerfolgen } from './lagebildBestaetigung';
import { lagebildDehydrierOptionen, lagebildStandZulaessig } from './lagebildFilter';
import { erzeugeLagebildPersister, type LagebildPersister } from './lagebildPersister';
import {
  lagebildAnlegen,
  lagebildBestaetigen,
  lagebildLesen,
  lagebildLoeschenPlatte,
} from './lagebildSpeicher';
import { startEntscheidung, type MeErgebnis } from './lagebildStart';

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

type VorratEintrag = PersistedClient['clientState']['queries'][number];

/** Die Einträge eines gelesenen Stands, die jetzt noch gelten dürfen (Allowlist, Sperrmarke,
 *  24 h je Einzelstand). Wirft bei einem unlesbaren Stand. */
function zulaessigeEintraege(qc: QueryClient, eintraege: VorratEintrag[]): VorratEintrag[] {
  const jetzt = Date.now();
  return eintraege.filter((q) =>
    lagebildStandZulaessig(qc, q.queryKey, q.state.dataUpdatedAt, jetzt),
  );
}

/**
 * Beginnt das Speichern für einen Benutzer. Ein bestehender Datensatz wird vorausgesetzt: der
 * Persister legt keinen an (design.md D1).
 *
 * `vorrat` ist der gelesene Stand einer SERVERBESTÄTIGTEN Sitzung, der bewusst NICHT im
 * Speicher liegt (design.md D2). Jede Speicherung führt ihn mit dem Live-Stand zusammen: der
 * Live-Stand gewinnt je `queryHash`, übrige Vorrat-Einträge kommen dazu — gefiltert bei JEDER
 * Speicherung, damit ein Rechteentzug im Lauf der Sitzung (Sperrmarke) und die Höchstliegezeit
 * auch den Vorrat treffen. Ohne das Zusammenführen überschriebe die erste Speicherung den
 * Datensatz mit dem fast leeren Cache eines frisch geladenen Tabs, und offline wäre nur noch
 * da, was seit dem letzten Neuladen besucht wurde.
 */
function abonnieren(
  qc: QueryClient,
  benutzerId: number,
  buster: string,
  { drosselMs }: SitzungsOptionen,
  vorrat: VorratEintrag[] = [],
): void {
  const innen = erzeugeLagebildPersister(benutzerId, { drosselMs });
  const persister: LagebildPersister = {
    ...innen,
    persistClient: (client) => {
      const live = new Set(client.clientState.queries.map((q) => q.queryHash));
      const dazu = zulaessigeEintraege(qc, vorrat).filter((q) => !live.has(q.queryHash));
      return innen.persistClient({
        ...client,
        clientState: {
          ...client.clientState,
          queries: [...client.clientState.queries, ...dazu],
        },
      });
    },
  };
  const speichern = {
    queryClient: qc,
    persister,
    buster,
    dehydrateOptions: lagebildDehydrierOptionen(qc),
  };
  const speichernAbmelden = persistQueryClientSubscribe(speichern);
  // Einmal sofort (gedrosselt): das Abonnement sieht nur KÜNFTIGE Änderungen. Serverbestätigt
  // hängen die Seiten ihre Abfragen schon ein, während der Start noch die IndexedDB liest —
  // sind sie fertig, bevor das Abonnement steht, käme sonst nie ein Ereignis, und der Stand
  // bliebe leer (gemessen an der Lagekarte, e2e `lagebild-offline.spec.ts`).
  void persistQueryClientSave(speichern);
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

/**
 * Legt den vorgehaltenen Stand in den Speicher — NUR ohne Serverbestätigung (design.md D2):
 * online ist der Server die Wahrheit, und ein hydrierter älterer Stand ließe jede Stelle, die
 * „Daten da" als „geladen" liest, am alten Stand entscheiden (gemessen in der CI: die
 * Deeplink-Logik räumte `?eintrag=`, bevor der neue Eintrag geladen war).
 *
 * Eigener Schritt statt `persistQueryClientRestore`, weil gefiltert wird, UNMITTELBAR vor dem
 * `hydrate` und ohne `await` dazwischen: Allowlist, Sperrmarke, 24 h je Einzelstand, und keine
 * Query, die im Cache schon auf `error` steht — ihr Fehler ist jünger als jeder vorgehaltene
 * Stand. Ein Stand, der mit einem Leitungsfehler gespeichert wurde (`error` MIT Daten), kommt
 * als `success` zurück: die Daten sind der letzte gute Stand, der Fehler gehörte zur Sitzung
 * davor.
 *
 * Mutationen stellt der Schritt nie her — es werden keine geschrieben (`lagebildFilter.ts`).
 */
function wiederherstellen(qc: QueryClient, client: PersistedClient): void {
  const cache = qc.getQueryCache();
  const queries = zulaessigeEintraege(qc, client.clientState.queries)
    .filter((q) => cache.find({ queryKey: q.queryKey, exact: true })?.state.status !== 'error')
    .map((q) =>
      q.state.status === 'error'
        ? { ...q, state: { ...q.state, status: 'success' as const, error: null } }
        : q,
    );
  hydrate(qc, { mutations: [], queries });
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

    // Serverbestätigt wird NICHT hydriert, der gelesene Stand bleibt als Vorrat für die
    // Platte (design.md D2). Ohne Bestätigung ist er der einzige Stand und kommt in den
    // Speicher.
    let vorrat: VorratEintrag[] = [];
    if (entscheidung.wiederherstellen && satz) {
      try {
        if (me.art === 'ok') vorrat = zulaessigeEintraege(qc, satz.client.clientState.queries);
        else wiederherstellen(qc, satz.client);
      } catch (fehler) {
        // Ein unlesbarer Stand ist verworfen. Ohne Serverbestätigung gibt es dann auch keine
        // Offline-Anmeldung: sie verspräche einen Stand, der nicht da ist.
        console.warn('Lagebild: vorgehaltener Stand unlesbar, verworfen', fehler);
        await lagebildLoeschenPlatte();
        if (me.art !== 'ok') return null;
      }
    }
    if (abgebrochen()) return null;
    if (me.art === 'ok') {
      // Serverbestätigt: Datensatz anlegen bzw. mit frischer Identität und Bestätigung
      // fortschreiben — mit dem GEFILTERTEN Vorrat, nie dem gelesenen Stand. Ohne Server
      // (Netzfehler) bleibt der Datensatz, wie er ist.
      await lagebildAnlegen({
        benutzer,
        bestaetigtAt: jetzt,
        buster,
        client: { ...leererClient(buster), clientState: { mutations: [], queries: vorrat } },
      });
    }
    abonnieren(qc, benutzer.id, buster, optionen, vorrat);
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
    let vorrat: VorratEintrag[] = [];
    try {
      if (bestand && bestand.buster === buster) {
        vorrat = zulaessigeEintraege(qc, bestand.client.clientState.queries);
      }
    } catch {
      // Unlesbarer Stand: ohne Vorrat weiter, der Datensatz wird unten ersetzt.
    }
    await lagebildAnlegen({
      benutzer,
      bestaetigtAt: jetzt,
      buster,
      client: { ...leererClient(buster), clientState: { mutations: [], queries: vorrat } },
    });
    if (SITZUNGEN.get(qc)?.benutzerId !== benutzer.id)
      abonnieren(qc, benutzer.id, buster, optionen, vorrat);
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
