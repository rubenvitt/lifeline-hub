import type {
  AblehnungGrund,
  AnbindungAblehnung,
  AnbindungAnzeige,
  AnbindungCode,
  AnbindungenListe,
  Scope,
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

/** Erlaubte Abweichung der Uhren in Sekunden (ADR-0014). */
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
