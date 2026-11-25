import type { FuehrungAnzeige, FuehrungCodeAntwort } from './types';
import { apiGet, apiSend, mitParametern } from './client';
import { unterschreibeErklaerung } from './instanz';

// Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`). Jede Aktion gibt es zweimal: am lokalen
// Einsatz (`/api/incidents/{id}/command`, Einsatzleitung oder Admin der Einsatz-Org) und an einer
// Akte des Gegenübers (`/api/admin/instance/command/{akte}`, Admin der Org). Den Pfad einer
// Aktion bildet `fuehrungPfad`.

/**
 * Wo die Führung bedient wird: am Einsatz oder an einer Akte des Gegenübers. Die Akte trägt ihre
 * Kennung als Gegenprobe (LLH-1862): Der Server vergibt die ID einer gelöschten Akte neu und lehnt
 * mit 409 ab, wenn unter ihr inzwischen ein anderer Einsatz liegt.
 */
export type FuehrungOrt = { einsatzId: number } | { akteId: number; kennung: string };

export function fuehrungPfad(ort: FuehrungOrt, aktion: string): string {
  return 'einsatzId' in ort
    ? `/api/incidents/${ort.einsatzId}/command/${aktion}`
    : mitParametern(`/api/admin/instance/command/${ort.akteId}/${aktion}`, {
        kennung: ort.kennung,
      });
}

export function loadFuehrung(einsatzId: number): Promise<FuehrungAnzeige> {
  return apiGet<FuehrungAnzeige>(`/api/incidents/${einsatzId}/command`);
}

/** Einsätze beim Gegenüber (Akten ohne lokalen Einsatz), für die Seite „Instanzkopplung“. */
export function loadFuehrungFremd(): Promise<FuehrungAnzeige[]> {
  return apiGet<FuehrungAnzeige[]>('/api/admin/instance/command');
}

/** Reguläre Übergabe an das Gegenüber `an` (Instanzkennung). */
export function uebergebeFuehrung(ort: FuehrungOrt, an: string): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'hand-over'), 'POST', { an });
}

/** Abgabe per Code: der Code steht nur in dieser Antwort. */
export function gibFuehrungPerCodeAb(ort: FuehrungOrt, an: string): Promise<FuehrungCodeAntwort> {
  return apiSend<FuehrungCodeAntwort>(fuehrungPfad(ort, 'code'), 'POST', { an });
}

/** Die Führung beim Gegenüber erbitten (meldende Seite, vor Ort jede Seite). */
export function frageFuehrungAn(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'request'), 'POST');
}

/** Die Anfrage der Gegenstelle vor Ort ablehnen (LLH-1678); die Führung bleibt hier. */
export function lehneAnfrageAb(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'request/decline'), 'POST');
}

/** Einen Spiegel zurückholen, dessen Führer nicht mehr gekoppelt ist (LLH-1850): nur mit Grund,
 *  nur am lokalen Einsatz. */
export function holeFuehrungZurueck(einsatzId: number, grund: string): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(`/api/incidents/${einsatzId}/command/reclaim`, 'POST', {
    grund,
  });
}

/** Notübernahme gegen die erreichte Seite: nur mit Grund. */
export function uebernimmFuehrung(ort: FuehrungOrt, grund: string): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'emergency-takeover'), 'POST', { grund });
}

/** Notübernahme gegen die meldende Seite mit der Unterschrift eines eigenen Schlüssels. */
export function uebernimmFuehrungMitUnterschrift(
  ort: FuehrungOrt,
  grund: string,
): Promise<FuehrungAnzeige> {
  return unterschreibeErklaerung<FuehrungAnzeige>(
    fuehrungPfad(ort, 'emergency-takeover/start'),
    fuehrungPfad(ort, 'emergency-takeover/finish'),
    { grund },
  );
}

/** Notübernahme gegen die meldende Seite mit ihrem Abgabecode. */
export function uebernimmFuehrungMitCode(
  ort: FuehrungOrt,
  grund: string,
  code: string,
): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'emergency-takeover/code'), 'POST', {
    grund,
    code,
  });
}

export function bestaetigeUebernahme(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'confirm'), 'POST');
}

export function widersprecheUebernahme(ort: FuehrungOrt): Promise<FuehrungAnzeige> {
  return apiSend<FuehrungAnzeige>(fuehrungPfad(ort, 'object'), 'POST');
}
