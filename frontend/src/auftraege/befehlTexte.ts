import type { BefehlVorlageKey } from '../api/types';
import { VORLAGEN } from '../befehle/vorlagen';

/** Etikett des Befehlsschemas; ein unbekannter Schlüssel steht roh. */
export function befehlSchemaLabel(schluessel: BefehlVorlageKey | string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? String(schluessel);
}
