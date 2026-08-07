/** Fehler einer API-Antwort mit Nicht-2xx-Status. Trägt den Statuscode und die
 *  Server-Meldung aus dem `{ error }`-Format. */
export type HttpMethode = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Zusätzliche Metadaten für einen schreibenden API-Aufruf.
 *
 * `offlineQueueBenutzerId` ist kein Ersatz für die Session-Authentifizierung. Der
 * Server vergleicht die erwartete Queue-Eigentümer-ID mit der aktuellen Session,
 * bevor er einen offlinefähigen Request verarbeitet. So kann ein alter Tab nach
 * einem Benutzerwechsel keine fremde lokale Queue unter der neuen Sitzung leeren. */
export interface ApiSendOptionen {
  offlineQueueBenutzerId?: number;
}

export const OFFLINE_QUEUE_BENUTZER_HEADER = 'X-Offline-Queue-Benutzer-Id';

const NETZFEHLER_TEXT = 'Keine Verbindung — die Aktion wurde NICHT abgeschickt';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Einheitlicher Fehler für nicht erreichbare bzw. abgebrochene HTTP-Verbindungen.
 *
 *  Die Ableitung von `TypeError` hält bestehende Offline-Erkennung kompatibel, die
 *  native Fetch-Netzfehler bereits über `instanceof TypeError` einordnet. Neue
 *  Aufrufer können präziser auf `NetzFehler` prüfen. */
export class NetzFehler extends TypeError {
  constructor() {
    super(NETZFEHLER_TEXT);
    this.name = 'NetzFehler';
  }
}

/** Bedienbarer Fehlertext für schreibende Aktionen; fachliche API-Meldungen bleiben erhalten. */
export function fehlerText(e: unknown, standard = 'Aktion fehlgeschlagen'): string {
  if (e instanceof NetzFehler) return NETZFEHLER_TEXT;
  if (e instanceof ApiError) return e.message;
  return standard;
}

/** True, wenn der Fehler ein optimistischer Sperrkonflikt (HTTP 409) ist — der Datensatz
 *  wurde seit dem Laden von jemand anderem geändert (LFH-241/F10). Der Aufrufer bietet dann
 *  „neu laden vs. überschreiben" an, statt den Fehler nur generisch zu melden. */
export function istKonflikt(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409;
}

async function fehlerWerfen(res: Response): Promise<never> {
  let message = `Serverfehler (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // keine JSON-Antwort — generische Meldung beibehalten
  }
  throw new ApiError(res.status, message);
}

/** Fetch wirft bei einem Leitungsfehler `TypeError`, bei Abbruch je nach Browser
 *  `AbortError` und für `AbortSignal.timeout` in aktuellen Engines `TimeoutError`. */
function netzFehlerWerfen(e: unknown): never {
  // DOMException stammt in jsdom und in eingebetteten Browser-Kontexten nicht zwingend
  // aus demselben Realm wie `Error`; der standardisierte `name` ist hier verlässlicher
  // als ein `instanceof DOMException`-/`Error`-Test.
  const name =
    typeof e === 'object' && e !== null && 'name' in e
      ? (e as { name?: unknown }).name
      : undefined;
  if (e instanceof TypeError || name === 'AbortError' || name === 'TimeoutError') {
    throw new NetzFehler();
  }
  throw e;
}

export async function apiGet<T>(pfad: string): Promise<T> {
  try {
    const res = await fetch(pfad, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fehlerWerfen(res);
    return (await res.json()) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}

/** Lädt Dateien per multipart/form-data hoch. Setzt KEINEN Content-Type-Header,
 *  damit der Browser die Multipart-Boundary selbst bestimmt. Fehler werden wie bei
 *  apiSend/apiGet als {@link ApiError} geworfen. */
export async function apiUpload<T>(pfad: string, formData: FormData): Promise<T> {
  try {
    const res = await fetch(pfad, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fehlerWerfen(res);
    return (await res.json()) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}

export async function apiSend<T>(
  pfad: string,
  methode: HttpMethode,
  body?: unknown,
  optionen: ApiSendOptionen = {},
): Promise<T> {
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (optionen.offlineQueueBenutzerId != null) {
      headers[OFFLINE_QUEUE_BENUTZER_HEADER] = String(optionen.offlineQueueBenutzerId);
    }
    const res = await fetch(pfad, {
      method: methode,
      credentials: 'same-origin',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return fehlerWerfen(res);
    // Leerer Body: nicht nur 204 No Content (z.B. Logout), sondern auch 200/201 ohne
    // Json-Wrapper (z.B. die WebAuthn-Finish-Endpunkte, die nur `StatusCode` liefern,
    // LFH-275). Aufrufer solcher Endpunkte MÜSSEN T = void verwenden — der Cast ist nur
    // unter dieser Vertragsannahme sicher. `res.json()` auf leerem Body würfe sonst einen
    // kryptischen SyntaxError statt sauber `undefined` zu liefern.
    const text = await res.text();
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}
