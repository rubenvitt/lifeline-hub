import type { ModulZaehler } from './types';
import { apiGet } from './client';

/** Zähler je erlaubtem Modul des Einsatzes (LFH-612). Nicht erlaubte Module fehlen. */
export function ladeModulZaehler(einsatzId: number): Promise<ModulZaehler> {
  return apiGet<ModulZaehler>(`/api/einsaetze/${einsatzId}/modul-zaehler`);
}
