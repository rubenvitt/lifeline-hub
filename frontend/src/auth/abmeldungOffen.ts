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
}

function lesen(): OffeneAbmeldung | null {
  const roh = sicherLesen(SCHLUESSEL);
  if (roh === null) return null;
  try {
    const wert = JSON.parse(roh) as Partial<OffeneAbmeldung> | null;
    if (typeof wert?.benutzer !== 'number') return null;
    return {
      benutzer: wert.benutzer,
      sitzung: typeof wert.sitzung === 'string' ? wert.sitzung : null,
    };
  } catch {
    return null;
  }
}

function schreiben(wert: OffeneAbmeldung): void {
  sicherSchreiben(SCHLUESSEL, JSON.stringify(wert));
}

/** Vergisst den Merker: die Sitzung ist auf dem Server beendet, oder jemand hat sich angemeldet. */
export function vergissOffeneAbmeldung(): void {
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
  schreiben({ benutzer: bisher.id, sitzung });
  if (sitzung !== null) return;
  void (async () => {
    try {
      const aufServer = await authApi.me();
      const offen = lesen();
      // Inzwischen nachgeholt oder durch eine Anmeldung ersetzt: nichts mehr zu schärfen.
      if (!offen || offen.benutzer !== bisher.id || offen.sitzung !== null) return;
      if (aufServer.id === bisher.id) {
        schreiben({ benutzer: bisher.id, sitzung: aufServer.sitzung ?? null });
      } else {
        vergissOffeneAbmeldung();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) vergissOffeneAbmeldung();
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
    try {
      await authApi.logout();
      vergissOffeneAbmeldung();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) vergissOffeneAbmeldung();
      else console.error('Server-Abmeldung weiter nicht möglich', e);
    } finally {
      nachholLauf = null;
    }
  })();
  return nachholLauf;
}
