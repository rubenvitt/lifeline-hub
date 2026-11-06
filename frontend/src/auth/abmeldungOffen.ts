/**
 * Abmeldung, deren Serverruf scheiterte (LLH-1535).
 *
 * `logout()` meldet auch dann lokal ab, wenn `POST /api/auth/logout` scheitert (Netz, 5xx, 403);
 * Cookie und Serversitzung bleiben dann gültig. Ohne Merker übernähme die nächste Prüfung (Kanal,
 * Sichtbarkeit) oder ein neu geöffneter Tab die Sitzung wie eine Anmeldung in einem anderen Tab —
 * auf einem geteilten Gerät wäre die Abmeldung aufgehoben.
 *
 * Der Merker nennt die aufgegebene Sitzung über ihre öffentliche Kennung (`MeAntwort.sitzung`).
 * Eine neue Anmeldung, gleich auf welchem Weg und in welchem Tab, hat eine neue Kennung und wird
 * normal übernommen. Ist die Kennung unbekannt (Server beim Abmelden nicht erreichbar), gilt jede
 * Sitzung derselben Person als die aufgegebene, bis die Abmeldung nachgeholt ist.
 *
 * Im `localStorage`, weil er für alle Tabs und über ein Neuladen hinaus gelten muss. Er trägt nur
 * Benutzer-id und Sitzungskennung.
 */
import type { MeAntwort } from '../api/types';
import { ApiError } from '../api/client';
import * as authApi from '../api/auth';
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';

const SCHLUESSEL = 'lfh:abmeldung-offen';

interface OffeneAbmeldung {
  benutzer: number;
  /** `null`: Kennung unbekannt, jede Sitzung dieser Person gilt als aufgegeben. */
  sitzung: string | null;
  /** Kennt diese eine gescheiterte Abmeldung. Ein später angelegter Merker hat einen anderen
   *  Vorgang, und ein noch laufendes Nachfragen oder Nachholen ändert oder löscht ihn nicht. */
  vorgang: string;
}

function neuerVorgang(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Der gespeicherte Merker, oder `null` ohne Merker, bei gesperrtem Speicher oder kaputtem Wert. */
function lesen(): OffeneAbmeldung | null {
  const roh = sicherLesen(SCHLUESSEL);
  if (roh === null) return null;
  try {
    const wert = JSON.parse(roh) as Partial<OffeneAbmeldung> | null;
    if (typeof wert?.benutzer !== 'number') return null;
    return {
      benutzer: wert.benutzer,
      sitzung: typeof wert.sitzung === 'string' ? wert.sitzung : null,
      vorgang: typeof wert.vorgang === 'string' ? wert.vorgang : '',
    };
  } catch {
    return null;
  }
}

/** Schreibt den Merker; ohne Speicher bleibt es beim bisherigen Verhalten (Übernahme möglich). */
function schreiben(wert: OffeneAbmeldung): void {
  sicherSchreiben(SCHLUESSEL, JSON.stringify(wert));
}

/** Vergisst den Merker: die Sitzung ist auf dem Server beendet, oder jemand hat sich angemeldet.
 *  Mit `vorgang` nur, solange der Merker noch zu diesem Vorgang gehört. */
export function vergissOffeneAbmeldung(vorgang?: string): void {
  if (vorgang !== undefined && lesen()?.vorgang !== vorgang) return;
  sicherEntfernen(SCHLUESSEL);
}

/** Der Vorgang des Merkers jetzt, `null` ohne Merker. Beim Absenden einer `/me`-Anfrage
 *  festgehalten, für {@link vergissOffeneAbmeldungSeit}. */
export function offenerVorgang(): string | null {
  return lesen()?.vorgang ?? null;
}

/** Vergisst den Merker auf eine `/me`-Antwort hin, die bei Merker-Stand `vorher` angefragt wurde,
 *  und nur, wenn es noch derselbe Merker ist. Ein Merker, der erst danach entstand (in diesem oder
 *  einem anderen Tab), bleibt: die Antwort kennt seine Sitzung nicht. */
export function vergissOffeneAbmeldungSeit(vorher: string | null): void {
  if (vorher !== null) vergissOffeneAbmeldung(vorher);
}

/** Ist `aufServer` die Sitzung, deren Abmeldung scheiterte? */
export function istAufgegebeneSitzung(aufServer: MeAntwort): boolean {
  const offen = lesen();
  if (!offen || offen.benutzer !== aufServer.id) return false;
  return offen.sitzung === null || offen.sitzung === (aufServer.sitzung ?? null);
}

/**
 * Merkt die Sitzung von `bisher` als aufgegeben, schon VOR dem Serverruf: meldet sich währenddessen
 * jemand in einem anderen Tab an, vergisst dessen Anmeldung diesen Merker, und ein danach
 * scheiternder Ruf legt keinen neuen an, der die neue Sitzung träfe. Gibt den Vorgang zurück;
 * gelingt der Ruf (oder antwortet 412), fällt der Merker mit `vergissOffeneAbmeldung(vorgang)`.
 * Synchron, damit er steht, bevor das lokale Abmelden die anderen Tabs anstößt.
 */
export function beginneAbmeldung(bisher: MeAntwort): string {
  const vorgang = neuerVorgang();
  schreiben({ benutzer: bisher.id, sitzung: bisher.sitzung ?? null, vorgang });
  return vorgang;
}

/**
 * Der Serverruf zu `vorgang` ist gescheitert. Kennt der Tab die Kennung nicht (er hat sich selbst
 * angemeldet, die Login-Antwort trägt sie nicht), fragt er jetzt `/me` — ohne das Abmelden
 * aufzuhalten. Ist der Merker schon vergessen (Anmeldung in einem anderen Tab), bleibt es dabei.
 */
export function abmeldungGescheitert(bisher: MeAntwort, vorgang: string): void {
  const offen = lesen();
  if (offen?.vorgang !== vorgang || offen.sitzung !== null) return;
  void (async () => {
    try {
      const aufServer = await authApi.me();
      // Inzwischen nachgeholt, durch eine Anmeldung oder einen neueren Merker ersetzt: die
      // Antwort ist veraltet.
      if (lesen()?.vorgang !== vorgang) return;
      if (aufServer.id === bisher.id) {
        schreiben({ benutzer: bisher.id, sitzung: aufServer.sitzung ?? null, vorgang });
      } else {
        vergissOffeneAbmeldung(vorgang);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) vergissOffeneAbmeldung(vorgang);
      // Sonst bleibt die Kennung unbekannt; die nächste Prüfung holt die Abmeldung nach.
    }
  })();
}

/** Merker und gescheiterter Serverruf in einem, für einen Ruf, der schon gescheitert ist. */
export function merkeOffeneAbmeldung(bisher: MeAntwort): string {
  const vorgang = beginneAbmeldung(bisher);
  abmeldungGescheitert(bisher, vorgang);
  return vorgang;
}

let nachholLauf: Promise<void> | null = null;

/**
 * Holt die Server-Abmeldung der aufgegebenen Sitzung nach. Gelingt sie (oder ist die Sitzung
 * schon weg), fällt der Merker; sonst bleibt er für den nächsten Versuch. Läuft höchstens einmal
 * gleichzeitig und wirft nie.
 *
 * Gebunden an `aufServer`, die Sitzung, die der Aufrufer eben bei `/me` gesehen hat: Benutzer und
 * Kennung gehen als erwartete Köpfe mit; ohne Kennung unterbleibt der Ruf. Gehört das Cookie
 * inzwischen einer anderen Sitzung, antwortet der Server 412 und beendet nichts. Der Merker fällt
 * dann nur, wenn er genau `aufServer` nennt: sie ist nicht mehr die Sitzung des Cookies. Nennt er
 * keine Kennung, kann `aufServer` auch eine veraltete Antwort sein — er bleibt, und die nächste
 * Prüfung versucht es mit der aktuellen Sitzung.
 */
export function holeAbmeldungNach(aufServer: MeAntwort): Promise<void> {
  // Ohne Kennung ließe sich der Ruf nur an den Benutzer binden und träfe auch eine neue Sitzung
  // derselben Person. Jede Sitzung trägt eine (Migration 0168); fehlt sie, bleibt der Merker,
  // bis eine Anmeldung oder 401 ihn erledigt.
  if (!aufServer.sitzung) return Promise.resolve();
  nachholLauf ??= (async () => {
    // Nur der Merker, für den dieser Lauf startet, fällt mit ihm — nicht einer, den ein weiteres
    // gescheitertes Abmelden währenddessen angelegt hat.
    const offen = lesen();
    const vorgang = offen?.vorgang;
    try {
      await authApi.logout(aufServer);
      if (vorgang !== undefined) vergissOffeneAbmeldung(vorgang);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : null;
      if (status !== 401 && status !== 412) {
        console.error('Server-Abmeldung weiter nicht möglich', e);
        return;
      }
      // 401: keine Sitzung mehr. 412: das Cookie gehört nicht mehr zu `aufServer`; überholt ist
      // der Merker dann nur, wenn er genau sie nennt.
      const erledigt = status === 401 || offen?.sitzung === aufServer.sitzung;
      if (vorgang !== undefined && erledigt) vergissOffeneAbmeldung(vorgang);
    } finally {
      nachholLauf = null;
    }
  })();
  return nachholLauf;
}
