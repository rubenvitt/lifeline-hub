import { apiGet, apiSend } from './client';
import type {
  VerpflegungVorlage,
  VerpflegungVorlageEingabe,
  VerpflegungVorlagePatch,
} from './types';

/**
 * Verpflegungsplan der Organisation (LLH-1058, Spec `kraefte-verpflegung`, „Verpflegungsplan der
 * Organisation“): Mahlzeiten mit Uhrzeit ohne Datum, nach Beginn geordnet. Lesen darf jedes
 * Mitglied der Organisation, schreiben nur der Admin; gelöscht wird nie, `aktiv` schaltet.
 */
const BASE_PATH = '/api/verpflegung-vorlagen';

/** `'aktiv'` ist die Vorgabe des Servers (Tag aus der Vorlage); die Verwaltung liest `'alle'`,
 *  weil sie deaktivierte Mahlzeiten wieder aktivieren können muss. */
export function listVerpflegungVorlagen(scope: 'aktiv' | 'alle'): Promise<VerpflegungVorlage[]> {
  return apiGet<VerpflegungVorlage[]>(
    scope === 'alle' ? `${BASE_PATH}?nur_aktive=false` : BASE_PATH,
  );
}

/** 409, wenn eine aktive Mahlzeit den Namen schon trägt; 422 bei Ende gleich Beginn. */
export function createVerpflegungVorlage(
  data: VerpflegungVorlageEingabe,
): Promise<VerpflegungVorlage> {
  return apiSend<VerpflegungVorlage>(BASE_PATH, 'POST', data);
}

/** Teiländerung, auch Aktivieren und Deaktivieren; geprüft gegen den Effektivzustand. */
export function updateVerpflegungVorlage(
  id: number,
  data: VerpflegungVorlagePatch,
): Promise<VerpflegungVorlage> {
  return apiSend<VerpflegungVorlage>(`${BASE_PATH}/${id}`, 'PATCH', data);
}
