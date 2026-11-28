import type {
  AdapterAnzeige,
  AdapterFehler,
  AdapterListe,
  AdapterPruefErgebnis,
  AdapterVersuchAnzeige,
} from './types';
import { apiGet, apiSend } from './client';

// Adapter: Anbindungen, die der Hub selbst abruft (LLH-2017 Backend, LLH-2018 Verwaltung; ADR-0077,
// `src/routes/adapter.rs`). Lesen darf, wer in die Verwaltung darf; die Einstellungen und jedes
// Schreiben nur der System-Admin. Ein Geheimnis geht nur hinaus, nie zurück: die Antworten nennen je
// Platz nur, ob und wann er gesetzt ist.

/**
 * Mutationen der Verwaltung laufen sofort oder gar nicht (`networkMode: 'always'`): ohne Netz
 * scheitern sie sichtbar, statt in einer Warteschlange auf später zu warten.
 */
export const SOFORT_ODER_NIE = { networkMode: 'always' } as const;

/** Einstellungen eines Adapters; was darin steht, legt die Art fest (nie etwas Geheimes). */
export type AdapterEinstellungen = Record<string, string | number>;

export interface AdapterEingabe {
  art: string;
  name: string;
  einstellungen: AdapterEinstellungen;
  /** Fehlt es, gilt der Vorschlag der Art. */
  intervall_s?: number;
  lan_erlaubt?: boolean;
}

/**
 * Teiländerung aus der Ansicht: nur die geänderten Felder; `einstellungen` ersetzt alle.
 * `basis_geaendert_at` ist der Stand beim Öffnen (409 `veraltet` bei fremder Änderung).
 */
export interface AdapterPatch {
  name?: string;
  einstellungen?: AdapterEinstellungen;
  intervall_s?: number;
  lan_erlaubt?: boolean;
  basis_geaendert_at?: string;
}

const pfad = (id: string) => `/api/admin/adapter/${encodeURIComponent(id)}`;

export function loadAdapterListe(): Promise<AdapterListe> {
  return apiGet<AdapterListe>('/api/admin/adapter');
}

export function createAdapter(eingabe: AdapterEingabe): Promise<AdapterAnzeige> {
  return apiSend<AdapterAnzeige>('/api/admin/adapter', 'POST', eingabe);
}

export function updateAdapter(id: string, patch: AdapterPatch): Promise<AdapterAnzeige> {
  return apiSend<AdapterAnzeige>(pfad(id), 'PATCH', patch);
}

export function deleteAdapter(id: string): Promise<void> {
  return apiSend<void>(pfad(id), 'DELETE');
}

/**
 * Setzt oder ersetzt ein Geheimnis. Nie über `useMutation` aufrufen: deren Cache hielte den Wert
 * als `variables` fest (`components/Geheimfeld.tsx`).
 */
export function setGeheimnis(id: string, platz: string, wert: string): Promise<void> {
  return apiSend<void>(`${pfad(id)}/secrets/${encodeURIComponent(platz)}`, 'PUT', { wert });
}

export function deleteGeheimnis(id: string, platz: string): Promise<void> {
  return apiSend<void>(`${pfad(id)}/secrets/${encodeURIComponent(platz)}`, 'DELETE');
}

/** „Verbindung prüfen“: ruft einmal ab, übernimmt nichts, ändert den Zustand nicht. */
export function checkAdapter(id: string): Promise<AdapterPruefErgebnis> {
  return apiSend<AdapterPruefErgebnis>(`${pfad(id)}/check`, 'POST');
}

export function haltAdapter(id: string): Promise<AdapterAnzeige> {
  return apiSend<AdapterAnzeige>(`${pfad(id)}/pause`, 'POST');
}

export function resumeAdapter(id: string): Promise<AdapterAnzeige> {
  return apiSend<AdapterAnzeige>(`${pfad(id)}/resume`, 'POST');
}

/**
 * „Erneut vorlegen“ (LLH-1194, nur Art `stammdaten_abruf`): der nächste Abruf legt in jedem Fall
 * einen Schnappschuss zum Prüfen an, auch ohne Änderung an der Quelle.
 */
export function resubmitAdapter(id: string): Promise<void> {
  return apiSend<void>(`${pfad(id)}/resubmit`, 'POST');
}

export function loadAdapterVersuche(id: string): Promise<AdapterVersuchAnzeige[]> {
  return apiGet<AdapterVersuchAnzeige[]>(`${pfad(id)}/attempts`);
}

/** Klartext der Fehlercodes. Exhaustiv: ein neuer Code im Backend bricht hier den Typecheck. */
export const ADAPTER_FEHLER_TEXT: Record<AdapterFehler, string> = {
  status: 'Ziel antwortete mit Fehler',
  abgelehnt: 'Zugang abgelehnt',
  weiterleitung: 'Ziel wollte weiterleiten',
  zeitueberschreitung: 'Keine Antwort in 20 s',
  verbindung: 'Keine Verbindung zum Ziel',
  tls: 'Zertifikat des Ziels nicht anerkannt',
  ziel_intern: 'Ziel liegt in einem gesperrten Netz',
  dns: 'Name des Ziels nicht auflösbar',
  ziel_ungueltig: 'Adresse ungültig',
  zu_gross: 'Antwort zu groß',
  antwort_ungueltig: 'Antwort nicht lesbar',
  geheimnis_fehlt: 'Geheimnis fehlt',
  geheimnis_unlesbar: 'Geheimnis mit anderem Schlüssel gesetzt',
  geheimnisspeicher_gesperrt: 'Geheimnisspeicher ohne Schlüssel',
  einstellung_ungueltig: 'Einstellung ungültig',
  version_unbekannt: 'Unbekannte Schnittstellenversion',
  intern: 'Fehler im Server',
  schluessel_passen_nicht:
    'Schlüssel passen nicht zum Gerät des Tokens. Ein neues Access-Token anlegen.',
  schluesselspeicher_unlesbar:
    'Schlüsselspeicher nicht zu öffnen (Passphrase oder Speicher beschädigt)',
};

/** Klartext eines Fehlschlags, mit HTTP-Status, falls das Ziel antwortete. */
export function adapterFehlerText(art: AdapterFehler, status?: number | null): string {
  const text = ADAPTER_FEHLER_TEXT[art] ?? art;
  return status != null ? `${text} (${status})` : text;
}

const eintraege = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`);

/**
 * Ergebnis eines Versuchs oder einer Prüfung in einer Zeile: „abgerufen (200) · 4 Einträge“, bei
 * einer Prüfung „erreichbar …· Prüfung“, sonst der Fehler.
 */
export function adapterVersuchText(
  v: Pick<AdapterVersuchAnzeige, 'erfolg' | 'status' | 'fehler_art' | 'anzahl' | 'probe'>,
): string {
  const teile: string[] = [];
  if (v.erfolg) {
    const wort = v.probe ? 'erreichbar' : 'abgerufen';
    teile.push(v.status != null ? `${wort} (${v.status})` : wort);
    if (v.anzahl != null) teile.push(eintraege(v.anzahl));
  } else {
    teile.push(v.fehler_art ? adapterFehlerText(v.fehler_art, v.status) : 'gescheitert');
  }
  if (v.probe) teile.push('Prüfung');
  return teile.join(' · ');
}
