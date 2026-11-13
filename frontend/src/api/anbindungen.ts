import type {
  AblehnungGrund,
  AnbindungAblehnung,
  AnbindungAnzeige,
  AnbindungCode,
  AnbindungenListe,
  AnbindungFreigabe,
  EventType,
  RuhtGrund,
  Scope,
  WebhookAnzeige,
  WebhookFehler,
  WebhookTestErgebnis,
  WebhookVersuch,
} from './types';
import { apiGet, apiSend } from './client';

// Anbindungen: Maschinenzugänge für Fremdsysteme (LLH-1652, Spec `maschinenzugang`). Die
// Verwaltung macht der System-Admin; die Anmeldung der Fremdsysteme läuft unter `/api/v1/`.

export interface AnbindungEingabe {
  name: string;
  scopes: Scope[];
  /** UTC im Wire-Format; `null`: unbegrenzt. */
  gueltig_bis: string | null;
}

export function ladeAnbindungen(): Promise<AnbindungenListe> {
  return apiGet<AnbindungenListe>('/api/admin/anbindungen');
}

/** Legt einen Zugang an; der Einmal-Code steht nur in dieser Antwort. */
export function legeAnbindungAn(eingabe: AnbindungEingabe): Promise<AnbindungCode> {
  return apiSend<AnbindungCode>('/api/admin/anbindungen', 'POST', eingabe);
}

/**
 * Teiländerung aus der Ansicht (LLH-1139): nur die geänderten Felder; ein fehlender Schlüssel
 * bleibt, wie er ist, `gueltig_bis: null` hebt die Frist auf. `basis_geaendert_at` ist der Stand
 * beim Öffnen; hat ein anderer den Zugang inzwischen geändert, antwortet der Server 409.
 */
export interface AnbindungPatch {
  name?: string;
  scopes?: Scope[];
  gueltig_bis?: string | null;
  basis_geaendert_at?: string;
}

export function aendereAnbindung(id: string, aenderung: AnbindungPatch): Promise<AnbindungAnzeige> {
  return apiSend<AnbindungAnzeige>(`/api/admin/anbindungen/${id}`, 'PATCH', aenderung);
}

/** Neuer Einmal-Code (Schlüsselwechsel); ein früherer offener Code verfällt. */
export function stelleAnbindungsCodeAus(id: string): Promise<AnbindungCode> {
  return apiSend<AnbindungCode>(`/api/admin/anbindungen/${id}/code`, 'POST');
}

export function widerrufeAnbindung(id: string): Promise<AnbindungAnzeige> {
  return apiSend<AnbindungAnzeige>(`/api/admin/anbindungen/${id}/widerrufen`, 'POST');
}

/**
 * Die Anbindungen der Org, für die sich ein Einsatz freigeben lässt, aus Sicht dieses Einsatzes
 * (LLH-1638). Nur die Einsatzleitung liest und schaltet sie.
 */
export function loadEinsatzAnbindungen(einsatzId: number): Promise<AnbindungFreigabe[]> {
  return apiGet<AnbindungFreigabe[]>(`/api/einsaetze/${einsatzId}/anbindungen`);
}

/** Gibt den Einsatz für die Anbindung frei (an) oder beendet die Freigabe (aus). */
export function setAnbindungFreigabe(
  einsatzId: number,
  zugangId: string,
  an: boolean,
): Promise<AnbindungFreigabe[]> {
  return apiSend<AnbindungFreigabe[]>(
    `/api/einsaetze/${einsatzId}/anbindungen/${encodeURIComponent(zugangId)}/freigabe`,
    an ? 'PUT' : 'DELETE',
  );
}

/**
 * Klartext der Rechte in der Reihenfolge der Auswahl. Exhaustiv: ein neuer Scope im Backend bricht
 * hier den Typecheck. Daneben steht der Wire-Wert, damit der Admin ihn mit der Doku des
 * Fremdsystems vergleicht.
 */
export const SCOPE_TEXT: Record<Scope, string> = {
  'lage:read': 'Lage lesen',
  'einsaetze:read': 'Einsätze lesen',
  'events:read': 'Ereignisse abrufen',
  'alarmmeldungen:write': 'Alarmmeldungen einliefern',
  'positionen:write': 'Positionen einliefern',
  'rechner:use': 'Rechner nutzen',
};

export const SCOPES = Object.keys(SCOPE_TEXT) as Scope[];

/** Klartext eines Scopes; ein unbekannter (neuerer Server) bleibt als Wire-Wert stehen. */
export function scopeText(scope: string): string {
  return Object.prototype.hasOwnProperty.call(SCOPE_TEXT, scope)
    ? SCOPE_TEXT[scope as Scope]
    : scope;
}

const GRUND_TEXT: Record<AblehnungGrund, string> = {
  uhr: 'Zeitangaben im Token ungültig',
  signatur: 'Signatur passt nicht zum Schlüssel',
  body: 'Body passt nicht zur Signatur (bh)',
  pfad: 'Pfad passt nicht zur Signatur (htu)',
  methode: 'Methode passt nicht zur Signatur (htm)',
  ziel: 'Anfrage für eine andere Instanz (aud)',
  form: 'Anfrage unlesbar oder falscher Typ',
  wiederholung: 'Dieselbe Anfrage zweimal (jti)',
  abgelaufen: 'Zugang abgelaufen',
  widerrufen: 'Zugang widerrufen',
  kein_schluessel: 'Code noch nicht eingelöst',
  instanz_gekoppelt: 'Instanz meldet sich bei einem Hub',
};

/** Erlaubte Abweichung der Uhren in Sekunden (ADR-0034). */
const UHR_TOLERANZ_S = 300;

/**
 * Klartext der letzten Ablehnung. Bei `uhr` mit Abweichung über der Toleranz: Richtung und Minuten
 * („Uhr geht 7 min nach“); darunter lag es an der Lebensdauer des Tokens.
 */
export function ablehnungText(a: Pick<AnbindungAblehnung, 'grund' | 'abweichung_s'>): string {
  if (a.grund === 'uhr' && a.abweichung_s != null) {
    const s = a.abweichung_s;
    if (Math.abs(s) <= UHR_TOLERANZ_S) return 'Token lebt länger als 60 s';
    const minuten = Math.round(Math.abs(s) / 60);
    return `Uhr geht ${minuten} min ${s < 0 ? 'nach' : 'vor'}`;
  }
  return GRUND_TEXT[a.grund] ?? a.grund;
}

// ---- Webhook einer Anbindung (LLH-1656, Spec `webhook-zustellung`) ----

export interface WebhookEingabe {
  url: string;
  arten: EventType[];
  lan_erlaubt: boolean;
}

/**
 * Teiländerung; `basis_geaendert_at` ist der Stand beim Öffnen (409 bei fremder Änderung). Fehlt er
 * („Meine Änderung übernehmen“ nach der Rückfrage), schreibt der Server ohne Vergleich.
 */
export interface WebhookPatch {
  url?: string;
  arten?: EventType[];
  lan_erlaubt?: boolean;
  basis_geaendert_at?: string;
}

const webhookPfad = (id: string) => `/api/admin/anbindungen/${encodeURIComponent(id)}/webhook`;

export function createWebhook(id: string, eingabe: WebhookEingabe): Promise<WebhookAnzeige> {
  return apiSend<WebhookAnzeige>(webhookPfad(id), 'POST', eingabe);
}

export function updateWebhook(id: string, patch: WebhookPatch): Promise<WebhookAnzeige> {
  return apiSend<WebhookAnzeige>(webhookPfad(id), 'PATCH', patch);
}

export function deleteWebhook(id: string): Promise<void> {
  return apiSend<void>(webhookPfad(id), 'DELETE');
}

export function nimmWebhookWiederAuf(id: string): Promise<WebhookAnzeige> {
  return apiSend<WebhookAnzeige>(`${webhookPfad(id)}/wieder-aufnehmen`, 'POST');
}

export function sendTestereignis(id: string): Promise<WebhookTestErgebnis> {
  return apiSend<WebhookTestErgebnis>(`${webhookPfad(id)}/test`, 'POST');
}

export function loadWebhookVersuche(id: string): Promise<WebhookVersuch[]> {
  return apiGet<WebhookVersuch[]>(`${webhookPfad(id)}/versuche`);
}

/**
 * Klartext der Ereignisarten in der Reihenfolge der Auswahl. Exhaustiv: eine neue Art im Backend
 * bricht hier den Typecheck.
 */
export const ART_TEXT: Record<EventType, string> = {
  'einsatz.created': 'Einsatz lesbar geworden',
  'einsatz.updated': 'Einsatzkopf geändert',
  'einsatz.closed': 'Einsatz nicht mehr lesbar',
  'lage.changed': 'Lage geändert',
};

export const ARTEN = Object.keys(ART_TEXT) as EventType[];

/**
 * Das Recht, das eine Art öffnet (wie `EventType::scope` im Backend); dazu braucht jede Art
 * „Ereignisse abrufen“.
 */
export const ART_RECHT: Record<EventType, Scope> = {
  'einsatz.created': 'einsaetze:read',
  'einsatz.updated': 'einsaetze:read',
  'einsatz.closed': 'einsaetze:read',
  'lage.changed': 'lage:read',
};

/** Warum der Zugang die Art nicht zugestellt bekäme; `null`, wenn er sie bekommt. */
export function artGesperrtGrund(art: EventType, scopes: readonly string[]): string | null {
  if (!scopes.includes('events:read')) return `braucht „${SCOPE_TEXT['events:read']}“`;
  const recht = ART_RECHT[art];
  return scopes.includes(recht) ? null : `braucht „${SCOPE_TEXT[recht]}“`;
}

const FEHLER_TEXT: Record<WebhookFehler, string> = {
  status: 'Ziel antwortete mit Fehler',
  weiterleitung: 'Ziel wollte weiterleiten',
  zeitueberschreitung: 'Keine Antwort in 15 s',
  verbindung: 'Keine Verbindung zum Ziel',
  tls: 'Zertifikat des Ziels nicht anerkannt',
  ziel_intern: 'Ziel liegt in einem gesperrten Netz',
  dns: 'Name des Ziels nicht auflösbar',
  ziel_ungueltig: 'Ziel-URL ungültig',
};

/** Klartext eines Fehlschlags, mit HTTP-Status, falls das Ziel antwortete. */
export function webhookFehlerText(art: WebhookFehler, status?: number | null): string {
  const text = FEHLER_TEXT[art] ?? art;
  return status != null ? `${text} (${status})` : text;
}

export const RUHT_TEXT: Record<RuhtGrund, string> = {
  zugang_wartet: 'Code noch nicht eingelöst',
  zugang_widerrufen: 'Anbindung widerrufen',
  zugang_abgelaufen: 'Anbindung abgelaufen',
  ohne_events_read: `Recht „${SCOPE_TEXT['events:read']}“ fehlt`,
};
