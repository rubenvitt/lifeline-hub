import { BENUTZER_PRUEFEN } from '../auth/sitzungsEvent';
import { merkeServerzeit } from '../offline/serveruhr';

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

/** Kopf, mit dem jede schreibende Anfrage den Benutzer nennt, den dieser Tab anzeigt (LFH-387).
 *  Das Session-Cookie gilt originweit; meldet sich in einem anderen Tab jemand anderes an,
 *  lehnt der Server Schreibanfragen dieses Tabs mit 412 ab, statt sie still unter der fremden
 *  Sitzung auszuführen (`CurrentUser`-Extractor, `src/auth/session.rs`). */
export const ERWARTETER_BENUTZER_HEADER = 'X-Erwarteter-Benutzer-Id';

/** Der Benutzer, den dieser Tab anzeigt. Gesetzt vom `AuthProvider`, und zwar synchron an
 *  denselben Stellen wie sein `benutzer` — ein Effekt ließe ein Render-Fenster mit altem Wert. */
let erwarteterBenutzer: number | null = null;

export function setzeErwartetenBenutzer(id: number | null): void {
  erwarteterBenutzer = id;
}

/** Köpfe einer schreibenden Anfrage, die jeder Schreibweg (`apiSend`, `apiUpload`) trägt. */
function schreibKoepfe(): Record<string, string> {
  return erwarteterBenutzer == null
    ? {}
    : { [ERWARTETER_BENUTZER_HEADER]: String(erwarteterBenutzer) };
}

/** `undefined` statt eines leeren Objekts — ein Upload ohne Kopf bleibt wie bisher kopflos. */
function oderNichts(koepfe: Record<string, string>): Record<string, string> | undefined {
  return Object.keys(koepfe).length > 0 ? koepfe : undefined;
}

const NETZFEHLER_TEXT = 'Keine Verbindung — die Aktion wurde NICHT abgeschickt';

/** Fehler einer API-Antwort mit Nicht-2xx-Status. Trägt den Statuscode und die
 *  Server-Meldung aus dem `{ error }`-Format. */
export class ApiError extends Error {
  status: number;
  /**
   * Hat der eigene Anwendungsserver geantwortet, erkennbar am `{error}`-Umschlag, den jede
   * `AppError`-Antwort trägt (LFH-723)? Ein 502/503/504 OHNE Umschlag ist die Fehlerseite eines
   * vorgeschalteten Gateways: der Server dahinter ist nicht erreichbar. MIT Umschlag hat er
   * geantwortet (Lastabwurf, ausgefallener Upstream wie die Pegel-Vorhersage) — er ist also da.
   */
  vomAnwendungsserver: boolean;
  constructor(status: number, message: string, { vomAnwendungsserver = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.vomAnwendungsserver = vomAnwendungsserver;
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

const AUSGANG_UNBEKANNT_TEXT =
  'Keine Antwort — ob die Aktion angekommen ist, ist unklar. Erst die Liste prüfen, dann erneut versuchen';

/**
 * Die Anfrage ist vollständig beim Server angekommen, die Antwort aber ausgeblieben (Zeitlimit
 * oder Leitungsabbruch NACH dem letzten Byte, LFH-654). Ob der Server gespeichert hat, weiß der
 * Client nicht — „NICHT abgeschickt“ wäre hier falsch. Als Unterklasse bleibt sie für jede
 * Offline-Erkennung ein {@link NetzFehler}.
 */
export class AusgangUnbekannt extends NetzFehler {
  constructor() {
    super();
    this.name = 'AusgangUnbekannt';
    this.message = AUSGANG_UNBEKANNT_TEXT;
  }
}

/** Bedienbarer Fehlertext für schreibende Aktionen; fachliche API-Meldungen bleiben erhalten. */
export function fehlerText(e: unknown, standard = 'Aktion fehlgeschlagen'): string {
  if (e instanceof AusgangUnbekannt) return AUSGANG_UNBEKANNT_TEXT;
  if (e instanceof NetzFehler) return NETZFEHLER_TEXT;
  if (e instanceof ApiError) return e.message;
  return standard;
}

/**
 * Hängt die gesetzten Parameter als Query an (`URLSearchParams`-Kodierung). Ohne Wert gilt
 * `undefined`, `null`, `''` und `false`; eine `0` bleibt stehen.
 */
export function mitParametern(
  pfad: string,
  parameter: Record<string, string | number | boolean | null | undefined>,
): string {
  const p = new URLSearchParams();
  for (const [name, wert] of Object.entries(parameter)) {
    if (wert != null && wert !== '' && wert !== false) p.set(name, String(wert));
  }
  const q = p.toString();
  return q ? `${pfad}?${q}` : pfad;
}

/** True, wenn der Fehler ein optimistischer Sperrkonflikt (HTTP 409) ist: der Datensatz wurde
 *  seit dem Laden von jemand anderem geändert. Der Aufrufer bietet dann „neu laden vs.
 *  überschreiben“ an. */
export function istKonflikt(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409;
}

async function fehlerWerfen(res: Response): Promise<never> {
  // 412 heißt: die Sitzung gehört (vielleicht) nicht mehr dem Benutzer, den dieser Tab zeigt.
  // Nie abmelden — nur prüfen lassen; das entscheidet der AuthProvider (LFH-387).
  if (res.status === 412) window.dispatchEvent(new CustomEvent(BENUTZER_PRUEFEN));
  let message = `Serverfehler (${res.status})`;
  let vomAnwendungsserver = false;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') {
      message = body.error;
      vomAnwendungsserver = true;
    }
  } catch {
    // keine JSON-Antwort — generische Meldung beibehalten
  }
  throw new ApiError(res.status, message, { vomAnwendungsserver });
}

/** Fetch wirft bei einem Leitungsfehler `TypeError`, bei Abbruch je nach Browser
 *  `AbortError` und für `AbortSignal.timeout` in aktuellen Engines `TimeoutError`. */
function netzFehlerWerfen(e: unknown): never {
  // DOMException stammt in jsdom und in eingebetteten Browser-Kontexten nicht zwingend
  // aus demselben Realm wie `Error`; der standardisierte `name` ist hier verlässlicher
  // als ein `instanceof DOMException`-/`Error`-Test.
  const name =
    typeof e === 'object' && e !== null && 'name' in e ? (e as { name?: unknown }).name : undefined;
  if (e instanceof TypeError || name === 'AbortError' || name === 'TimeoutError') {
    throw new NetzFehler();
  }
  throw e;
}

export async function apiGet<T>(pfad: string): Promise<T> {
  try {
    // Bewusst ohne `cache`-Option: bedingte Abrufe (ETag → `If-None-Match` → 304, LFH-594)
    // erledigt der HTTP-Cache des Browsers und reicht die gespeicherte Antwort als 200 durch.
    // `no-store`/`reload` machten jeden Fachebenen-Poll wieder zur vollen Nutzlast
    // (`e2e/fachebenen-bedingt.spec.ts`).
    const res = await fetch(pfad, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
    });
    // Jede Antwort des Servers, auch eine Ablehnung, nennt seine Uhr (LFH-705).
    merkeServerzeit(res);
    if (!res.ok) return fehlerWerfen(res);
    return (await res.json()) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}

interface DateiOptionen {
  /** Abbruch nach dieser Zeit. Default 15 s; ein Vollexport braucht mehr. */
  timeoutMs?: number;
}

/**
 * Lädt eine Datei (CSV-Export u. ä., LFH-728) als `Blob`. Fehler wie bei {@link apiGet}: der
 * Aufrufer zeigt sie an der Seite, statt eine Fehlerantwort als Datei zu speichern.
 *
 * `no-store`, anders als `apiGet`: ein Export ist eine Momentaufnahme (der Personen-Export wird
 * je Abruf auditiert) und hat im HTTP-Cache des Browsers nichts verloren.
 */
export async function apiDatei(pfad: string, optionen: DateiOptionen = {}): Promise<Blob> {
  try {
    const res = await fetch(pfad, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(optionen.timeoutMs ?? 15_000),
    });
    if (!res.ok) return fehlerWerfen(res);
    return await res.blob();
  } catch (e) {
    netzFehlerWerfen(e);
  }
}

export interface UploadOptionen {
  /** Abbruch nach dieser Zeit. Default 15 s; große Dateien mit AV-Scan brauchen mehr. */
  timeoutMs?: number;
}

/** Lädt Dateien per multipart/form-data hoch. Setzt KEINEN Content-Type-Header,
 *  damit der Browser die Multipart-Boundary selbst bestimmt. Fehler werden wie bei
 *  apiSend/apiGet als {@link ApiError} geworfen. */
export async function apiUpload<T>(
  pfad: string,
  formData: FormData,
  optionen: UploadOptionen = {},
): Promise<T> {
  try {
    const res = await fetch(pfad, {
      method: 'POST',
      credentials: 'same-origin',
      headers: oderNichts(schreibKoepfe()),
      body: formData,
      signal: AbortSignal.timeout(optionen.timeoutMs ?? 15_000),
    });
    merkeServerzeit(res);
    if (!res.ok) return fehlerWerfen(res);
    return (await res.json()) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}

/**
 * Stand einer Übertragung (LFH-654): `senden` mit dem Anteil der übertragenen Bytes (0…1, `null`,
 * wenn der Browser die Gesamtgröße nicht kennt), danach `pruefen` — das letzte Byte ist beim
 * Server, die Antwort (Virenscan, Speichern) steht noch aus.
 */
export type UploadFortschritt = { phase: 'senden'; anteil: number | null } | { phase: 'pruefen' };

export interface UploadMitFortschrittOptionen extends UploadOptionen {
  onFortschritt?: (stand: UploadFortschritt) => void;
}

/** Status, deren `Response` keinen Body tragen darf. */
const OHNE_BODY = new Set([204, 205, 304]);

/**
 * Upload mit Byte-Fortschritt (LFH-654) über `XMLHttpRequest`: `fetch` meldet keinen
 * Upload-Fortschritt, ein Stream-Body (`duplex: 'half'`) fehlt in Safari/iOS. Köpfe, Cookie und
 * Fehlerformat wie {@link apiUpload} — eine Nicht-2xx-Antwort läuft durch dasselbe
 * `fehlerWerfen`. Darüber laden Dokumentenablage, ETB- und Erfassungs-Anhänge (Schaden, Tier,
 * UHS, Person; LFH-878); `apiUpload` tragen nur noch Organisationslogo, Kartenhintergründe und
 * Chat-Anhänge.
 *
 * Bricht die Leitung ab oder läuft das Zeitlimit ab, entscheidet die Phase: vor dem letzten Byte
 * {@link NetzFehler} („nicht abgeschickt“), danach {@link AusgangUnbekannt}.
 */
export function apiUploadMitFortschritt<T>(
  pfad: string,
  formData: FormData,
  optionen: UploadMitFortschrittOptionen = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let uebertragen = false;
    xhr.open('POST', pfad);
    xhr.withCredentials = true;
    xhr.timeout = optionen.timeoutMs ?? 15_000;
    for (const [name, wert] of Object.entries(schreibKoepfe())) xhr.setRequestHeader(name, wert);

    xhr.upload.addEventListener('progress', (e) => {
      const anteil = e.lengthComputable && e.total > 0 ? e.loaded / e.total : null;
      optionen.onFortschritt?.({ phase: 'senden', anteil });
    });
    xhr.upload.addEventListener('load', () => {
      uebertragen = true;
      optionen.onFortschritt?.({ phase: 'pruefen' });
    });

    const leitungWeg = () => reject(uebertragen ? new AusgangUnbekannt() : new NetzFehler());
    xhr.addEventListener('error', leitungWeg);
    xhr.addEventListener('timeout', leitungWeg);
    xhr.addEventListener('abort', leitungWeg);
    xhr.addEventListener('load', () => {
      // Status 0 nach `load` gibt es nur ohne Antwort (z. B. CORS-Abbruch) — Leitung, nicht Server.
      if (xhr.status === 0) return leitungWeg();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((xhr.responseText.length === 0 ? undefined : JSON.parse(xhr.responseText)) as T);
        } catch (e) {
          reject(e);
        }
        return;
      }
      const body = OHNE_BODY.has(xhr.status) ? null : xhr.responseText;
      fehlerWerfen(new Response(body, { status: xhr.status })).catch(reject);
    });

    xhr.send(formData);
  });
}

export async function apiSend<T>(
  pfad: string,
  methode: HttpMethode,
  body?: unknown,
  optionen: ApiSendOptionen = {},
): Promise<T> {
  try {
    const headers: Record<string, string> = methode === 'GET' ? {} : schreibKoepfe();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (optionen.offlineQueueBenutzerId != null) {
      headers[OFFLINE_QUEUE_BENUTZER_HEADER] = String(optionen.offlineQueueBenutzerId);
    }
    const res = await fetch(pfad, {
      method: methode,
      credentials: 'same-origin',
      headers: oderNichts(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    merkeServerzeit(res);
    if (!res.ok) return fehlerWerfen(res);
    // Leerer Body: nicht nur 204, sondern auch 200/201 ohne Json (z. B. WebAuthn-Finish). Aufrufer
    // solcher Endpunkte MÜSSEN T = void verwenden, nur dann ist der Cast sicher; `res.json()`
    // würfe auf leerem Body einen SyntaxError.
    const text = await res.text();
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}
