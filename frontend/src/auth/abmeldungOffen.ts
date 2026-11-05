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

/** Ist `aufServer` die Sitzung, deren Abmeldung scheiterte? */
export function istAufgegebeneSitzung(aufServer: MeAntwort): boolean {
  const offen = lesen();
  if (!offen || offen.benutzer !== aufServer.id) return false;
  return offen.sitzung === null || offen.sitzung === (aufServer.sitzung ?? null);
}

/**
 * Merkt die Sitzung von `bisher` als aufgegeben. Synchron, damit der Merker steht, bevor das
 * lokale Abmelden die anderen Tabs anstößt. Kennt der Tab die Kennung nicht (er hat sich selbst
 * angemeldet, die Login-Antwort trägt sie nicht), fragt er danach `/me` — ohne das Abmelden
 * aufzuhalten.
 */
export function merkeOffeneAbmeldung(bisher: MeAntwort): void {
  const sitzung = bisher.sitzung ?? null;
  const vorgang = neuerVorgang();
  schreiben({ benutzer: bisher.id, sitzung, vorgang });
  if (sitzung !== null) return;
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

let nachholLauf: Promise<void> | null = null;

/**
 * Holt die Server-Abmeldung der aufgegebenen Sitzung nach. Gelingt sie (oder ist die Sitzung
 * schon weg), fällt der Merker; sonst bleibt er für den nächsten Versuch. Läuft höchstens einmal
 * gleichzeitig und wirft nie. Der Aufrufer hat vorher lokal abgemeldet: ohne erwarteten Benutzer
 * trifft der Ruf die Sitzung des Cookies.
 */
export function holeAbmeldungNach(): Promise<void> {
  nachholLauf ??= (async () => {
    // Nur der Merker, für den dieser Lauf startet, fällt mit ihm — nicht einer, den ein weiteres
    // gescheitertes Abmelden währenddessen angelegt hat.
    const vorgang = lesen()?.vorgang;
    try {
      await authApi.logout();
      if (vorgang !== undefined) vergissOffeneAbmeldung(vorgang);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        console.error('Server-Abmeldung weiter nicht möglich', e);
      } else if (vorgang !== undefined) {
        vergissOffeneAbmeldung(vorgang);
      }
    } finally {
      nachholLauf = null;
    }
  })();
  return nachholLauf;
}
