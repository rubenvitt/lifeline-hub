import { gemerktesRoutenMuster } from '../rueckmeldung/adresse';
import { apiSendKeepalive } from './client';

/**
 * Bericht eines Absturzes an den Server (LLH-1822, Change `a12ms7g9-seitenzustaende`, D3; Spec
 * `seiten-zustaende`, „Absturz wird dem Server gemeldet“). Die Fehlergrenze ruft
 * {@link meldeClientFehler}, sobald sie einen Wurf beim Zeichnen fängt; der Server schreibt eine
 * gedrosselte Warnzeile ins Log (`src/routes/client_fehler.rs`) und speichert nichts.
 *
 * Gesendet werden nur Routenmuster (ohne Kennungen), App-Version, Meldung und Stack, gekürzt.
 * Kein Wert aus Props, Datensatz oder Adresse. Der Bericht läuft nicht über `apiSend`: kein
 * Wiederholen, keine Offline-Warteschlange, keine Fehleranzeige. Was beim Senden scheitert, wird
 * verschluckt; ohne Sitzung lehnt der Server mit 401 ab, und der Bericht ist verloren.
 */
export const CLIENT_FEHLER_PFAD = '/api/client-fehler';

/** Höchstlänge der Meldung in Zeichen; `routes::client_fehler::MELDUNG_MAX` im Server. */
export const CLIENT_FEHLER_MELDUNG_MAX = 500;
/** Höchstlänge des Stacks in Zeichen; `routes::client_fehler::STACK_MAX` im Server. */
export const CLIENT_FEHLER_STACK_MAX = 2000;

/** Schon gemeldete Fehlerobjekte: StrictMode und erneutes Zeichnen rufen den Effekt doppelt. Ein
 *  Wurf ohne Objekt (Zeichenkette, Zahl) lässt sich so nicht wiedererkennen; ihn fängt die
 *  Drossel des Servers. */
const gemeldet = new WeakSet<object>();

/** Kürzt nach Zeichen (Codepoints), damit kein Ersatzpaar halbiert wird: Ein halbes Paar machte
 *  das JSON für den Server ungültig. */
function kuerze(text: string, max: number): string {
  const zeichen = Array.from(text);
  return zeichen.length > max ? zeichen.slice(0, max).join('') : text;
}

/** Meldung und Stack des Wurfs. Von einem Wurf ohne Error-Objekt geht nur die Art mit, nie sein
 *  Inhalt: Er kann ein Datensatz sein. */
function beschreibe(fehler: unknown): { meldung: string; stack: string } {
  if (fehler instanceof Error) return { meldung: fehler.message, stack: fehler.stack ?? '' };
  if (typeof fehler === 'string') return { meldung: fehler, stack: '' };
  const status = (fehler as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return { meldung: `Routenantwort ${status}`, stack: '' };
  const art = fehler === null ? 'null' : typeof fehler;
  return { meldung: `Wurf ohne Error-Objekt (${art})`, stack: '' };
}

/**
 * Meldet einen gefangenen Fehler einmal je Fehlerobjekt. `pfad` ist die Adresse der Seite
 * (`location.pathname`); gesendet wird nur ihr Routenmuster. Wirft nie und lehnt nie ab.
 */
export async function meldeClientFehler(fehler: unknown, pfad: string): Promise<void> {
  try {
    if (typeof fehler === 'object' && fehler !== null) {
      if (gemeldet.has(fehler)) return;
      gemeldet.add(fehler);
    }
    const { meldung, stack } = beschreibe(fehler);
    await apiSendKeepalive(CLIENT_FEHLER_PFAD, {
      route: gemerktesRoutenMuster(pfad),
      version: __APP_VERSION__,
      meldung: kuerze(meldung, CLIENT_FEHLER_MELDUNG_MAX),
      stack: kuerze(stack, CLIENT_FEHLER_STACK_MAX),
    });
  } catch {
    // Ein Bericht, der den Server nicht erreicht, wird still verworfen (Spec, „Ohne Netz“).
  }
}
