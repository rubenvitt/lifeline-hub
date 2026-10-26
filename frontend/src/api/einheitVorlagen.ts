import type {
  EinheitVorlage,
  EinheitVorlageMaterialEingabe,
  EinheitVorlagePersonalEingabe,
  NeueEinheitVorlage,
  PatchEinheitVorlage,
} from './types';
import { apiGet, apiSend } from './client';

/**
 * Katalog „Einheiten-Vorlagen“ (LLH-1042). Die Liste trägt Kopf, Fahrzeuge, Stammbesetzung und
 * Material (LLH-1261); die Detailseite liest dieselbe Liste und braucht keinen Einzel-GET.
 * Fahrzeuge, Stammbesetzung und Material werden je als ganze Liste ersetzt (PUT).
 */
const BASE_PATH = '/api/einheit-vorlagen';

/** `'aktiv'` ist die Vorgabe des Servers; die Verwaltung liest `'alle'`, weil sie deaktivierte
 *  Vorlagen wieder aktivieren können muss. */
export function loadEinheitVorlagen(scope: 'aktiv' | 'alle'): Promise<EinheitVorlage[]> {
  return apiGet<EinheitVorlage[]>(scope === 'alle' ? `${BASE_PATH}?nur_aktive=false` : BASE_PATH);
}

export function createEinheitVorlage(data: NeueEinheitVorlage): Promise<EinheitVorlage> {
  return apiSend<EinheitVorlage>(BASE_PATH, 'POST', data);
}

export function updateEinheitVorlage(
  id: number,
  data: PatchEinheitVorlage,
): Promise<EinheitVorlage> {
  return apiSend<EinheitVorlage>(`${BASE_PATH}/${id}`, 'PATCH', data);
}

/** Ersetzt die Stamm-Fahrzeuge; die Reihenfolge ist die Anzeigereihenfolge. */
export function replaceVorlageFahrzeuge(
  id: number,
  fahrzeugIds: number[],
): Promise<EinheitVorlage> {
  return apiSend<EinheitVorlage>(`${BASE_PATH}/${id}/fahrzeuge`, 'PUT', {
    fahrzeug_ids: fahrzeugIds,
  });
}

/** Ersetzt die Stammbesetzung. */
export function replaceVorlagePersonal(
  id: number,
  personal: EinheitVorlagePersonalEingabe[],
): Promise<EinheitVorlage> {
  return apiSend<EinheitVorlage>(`${BASE_PATH}/${id}/personal`, 'PUT', { personal });
}

/** Ersetzt die Material-Positionen (LLH-1261); die Reihenfolge ist die Anzeigereihenfolge. */
export function replaceVorlageMaterial(
  id: number,
  material: EinheitVorlageMaterialEingabe[],
): Promise<EinheitVorlage> {
  return apiSend<EinheitVorlage>(`${BASE_PATH}/${id}/material`, 'PUT', { material });
}
