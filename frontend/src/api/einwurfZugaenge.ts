import type {
  EinwurfZugaengeListe,
  EinwurfZugangAnzeige,
  EinwurfZugangSchluessel,
  Scope,
} from './types';
import { apiGet, apiSend } from './client';

// Einwurf-Zugänge: Absender ohne Signatur (BOSWatch, FE2, Divera-Webhook, OsmAnd) werfen über
// einen Schlüssel im Pfad ein (LLH-1654, Spec `einwurf-zugang`, ADR-0023). Die Verwaltung macht
// der System-Admin; die Einwürfe selbst laufen unter `/api/v1/einwurf/`.

/** Die Zwecke eines Einwurf-Zugangs; genau einer je Zugang. */
export type EinwurfZweck = Extract<Scope, 'alarmmeldungen:write' | 'positionen:write'>;

/** In der Reihenfolge der Auswahl. Der Klartext steht in `SCOPE_TEXT` (`api/anbindungen.ts`). */
export const EINWURF_ZWECKE: readonly EinwurfZweck[] = ['alarmmeldungen:write', 'positionen:write'];

export interface EinwurfZugangEingabe {
  name: string;
  scope: EinwurfZweck;
  /** UTC im Wire-Format; `null`: unbegrenzt. */
  gueltig_bis: string | null;
}

export function loadEinwurfZugaenge(): Promise<EinwurfZugaengeListe> {
  return apiGet<EinwurfZugaengeListe>('/api/admin/einwurf-zugaenge');
}

/** Legt einen Zugang an; der Schlüssel steht nur in dieser Antwort. */
export function createEinwurfZugang(
  eingabe: EinwurfZugangEingabe,
): Promise<EinwurfZugangSchluessel> {
  return apiSend<EinwurfZugangSchluessel>('/api/admin/einwurf-zugaenge', 'POST', eingabe);
}

/** Neuer Schlüssel für den Zugang; der alte gilt ab sofort nicht mehr. */
export function wechsleEinwurfSchluessel(id: string): Promise<EinwurfZugangSchluessel> {
  return apiSend<EinwurfZugangSchluessel>(
    `/api/admin/einwurf-zugaenge/${encodeURIComponent(id)}/schluessel`,
    'POST',
  );
}

export function widerrufeEinwurfZugang(id: string): Promise<EinwurfZugangAnzeige> {
  return apiSend<EinwurfZugangAnzeige>(
    `/api/admin/einwurf-zugaenge/${encodeURIComponent(id)}/widerrufen`,
    'POST',
  );
}

/** Unterpfad der Route eines Zwecks; ein unbekannter Scope (neuerer Server) hat keinen. */
const UNTERPFAD: Record<EinwurfZweck, string> = {
  'alarmmeldungen:write': 'alarmmeldung',
  'positionen:write': 'position',
};

/**
 * Die Adresse, die der Absender aufruft. `origin` ist die Adresse, unter der die Seite gerade
 * geöffnet ist (`window.location.origin`): Erreicht der Absender den Server unter einem anderen
 * Namen, tauscht der Admin den Host.
 */
export function einwurfAdresse(origin: string, schluessel: string, scope: Scope): string {
  const unterpfad = (UNTERPFAD as Partial<Record<Scope, string>>)[scope] ?? '';
  return `${origin}/api/v1/einwurf/${schluessel}/${unterpfad}`;
}
