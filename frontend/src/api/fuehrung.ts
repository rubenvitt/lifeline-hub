import type { FuehrungAnzeige, FuehrungCodeAntwort } from './types';
import { apiGet, apiSend, mitParametern } from './client';
import { unterschreibeErklaerung } from './instanz';

// Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`). Jede Aktion gibt es zweimal: am lokalen
// Einsatz (`/api/einsaetze/{id}/fuehrung`, Einsatzleitung oder Admin der Einsatz-Org) und an einer
// Akte des Gegenübers (`/api/admin/instanz/fuehrung/{akte}`, Admin der Org). Den Pfad einer
// Aktion bildet `fuehrungPfad`.

/**
 * Wo die Führung bedient wird: am Einsatz oder an einer Akte des Gegenübers. Die Akte trägt ihre
 * Kennung als Gegenprobe (LLH-1862): Der Server vergibt die ID einer gelöschten Akte neu und lehnt
 * mit 409 ab, wenn unter ihr inzwischen ein anderer Einsatz liegt.
 */
export type FuehrungOrt = { einsatzId: number } | { akteId: number; kennung: string };

export function fuehrungPfad(ort: FuehrungOrt, aktion: string): string {
  return 'einsatzId' in ort
    ? `/api/einsaetze/${ort.einsatzId}/fuehrung/${aktion}`
    : mitParametern(`/api/admin/instanz/fuehrung/${ort.akteId}/${aktion}`, {
        kennung: ort.kennung,
      });
}

export function loadFuehrung(einsatzId: number): Promise<FuehrungAnzeige> {
  return apiGet<FuehrungAnzeige>(`/api/einsaetze/${einsatzId}/fuehrung`);
}

/** Einsätze beim Gegenüber (Akten ohne lokalen Einsatz), für die Seite „Instanzkopplung“. */
export function loadFuehrungFremd(): Promise<FuehrungAnzeige[]> {
  return apiGet<FuehrungAnzeige[]>('/api/admin/instanz/fuehrung');
}

/** Reguläre Übergabe an das Gegenüber `an` (Instanzkennung). */
export function uebergebeFuehrung(ort: FuehrungOrt, an: string): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'uebergeben'), 'POST', { an });
}

/** Abgabe per Code: der Code steht nur in dieser Antwort. */
export function gibFuehrungPerCodeAb(ort: FuehrungOrt, an: string): Promise<FuehrungCodeAntwort> {
  return apiSend<FuehrungCodeAntwort>(fuehrungPfad(ort, 'code'), 'POST', { an });
}

/** Die Führung beim Gegenüber erbitten (meldende Seite). */
export function frageFuehrungAn(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'anfragen'), 'POST');
}

/** Notübernahme gegen die erreichte Seite: nur mit Grund. */
export function uebernimmFuehrung(ort: FuehrungOrt, grund: string): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'notuebernahme'), 'POST', { grund });
}

/** Notübernahme gegen die meldende Seite mit der Unterschrift eines eigenen Schlüssels. */
export function uebernimmFuehrungMitUnterschrift(
  ort: FuehrungOrt,
  grund: string,
): Promise<FuehrungAnzeige> {
  return unterschreibeErklaerung<FuehrungAnzeige>(
    fuehrungPfad(ort, 'notuebernahme/start'),
    fuehrungPfad(ort, 'notuebernahme/abschluss'),
    { grund },
  );
}

/** Notübernahme gegen die meldende Seite mit ihrem Abgabecode. */
export function uebernimmFuehrungMitCode(
  ort: FuehrungOrt,
  grund: string,
  code: string,
): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'notuebernahme/code'), 'POST', {
    grund,
    code,
  });
}

export function bestaetigeUebernahme(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'bestaetigen'), 'POST');
}

export function widersprecheUebernahme(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'widersprechen'), 'POST');
}
