import type { ExterneStelle, ExterneStelleArt } from './types';
import { apiGet, apiSend } from './client';

/** Anlegen einer externen Stelle (LFH-1194); Request-Typ von Hand (`src/AGENTS.md`, Typ-Codegen). */
export interface NeueExterneStelle {
  bezeichnung: string;
  art: ExterneStelleArt;
  rufnummer?: string | null;
  funkrufname?: string | null;
  zustaendig?: boolean;
}

/** Teil-Patch: ein fehlendes Feld bleibt, `null` leert Rufnummer und Funkrufname. */
export interface ExterneStellePatch {
  bezeichnung?: string;
  art?: ExterneStelleArt;
  rufnummer?: string | null;
  funkrufname?: string | null;
  aktiv?: boolean;
  zustaendig?: boolean;
}

/**
 * Stellen der eigenen Organisation. `'aktiv'` für die Vorschläge, `'alle'` für die Verwaltung.
 * Der Parameter steht ausgeschrieben: `mitParametern` ließe ein `false` weg.
 */
export function listeExterneStellen(umfang: 'aktiv' | 'alle'): Promise<ExterneStelle[]> {
  return apiGet<ExterneStelle[]>(
    umfang === 'alle' ? '/api/externe-stellen?nur_aktive=false' : '/api/externe-stellen',
  );
}

export function legeExterneStelleAn(daten: NeueExterneStelle): Promise<ExterneStelle> {
  return apiSend<ExterneStelle>('/api/externe-stellen', 'POST', daten);
}

export function aendereExterneStelle(
  id: number,
  patch: ExterneStellePatch,
): Promise<ExterneStelle> {
  return apiSend<ExterneStelle>(`/api/externe-stellen/${id}`, 'PATCH', patch);
}
