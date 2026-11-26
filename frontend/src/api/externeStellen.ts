import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExterneStelle,
  ExterneStelleArt,
  ExterneStelleKanal,
  KanalArt,
  KanalMitStelle,
} from './types';
import { apiGet, apiSend } from './client';
import { globalKeys } from './queryKeys';

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
export function fetchExterneStellen(umfang: 'aktiv' | 'alle'): Promise<ExterneStelle[]> {
  return apiGet<ExterneStelle[]>(
    umfang === 'alle' ? '/api/external-agencies?nur_aktive=false' : '/api/external-agencies',
  );
}

export function createExterneStelle(daten: NeueExterneStelle): Promise<ExterneStelle> {
  return apiSend<ExterneStelle>('/api/external-agencies', 'POST', daten);
}

export function updateExterneStelle(id: number, patch: ExterneStellePatch): Promise<ExterneStelle> {
  return apiSend<ExterneStelle>(`/api/external-agencies/${id}`, 'PATCH', patch);
}

// ---- Kanaladressen (LLH-2093, Fax LLH-2095) ----

export interface NeuerKanal {
  /** Der Server nimmt `email`, `fax` (LLH-2095) und `matrix` (LLH-2094) an; Threema ist noch zu. */
  channel: KanalArt;
  address: string;
  label?: string;
}

export function fetchExterneStelleKanaele(stelleId: number): Promise<ExterneStelleKanal[]> {
  return apiGet<ExterneStelleKanal[]>(`/api/external-agencies/${stelleId}/channels`);
}

/** Alle Adressen der aktiven Stellen der Organisation, ohne `kanal` aller Kanäle. */
export function fetchKanaeleSammlung(kanal?: KanalArt): Promise<KanalMitStelle[]> {
  return apiGet<KanalMitStelle[]>(
    kanal ? `/api/external-agencies/channels?channel=${kanal}` : '/api/external-agencies/channels',
  );
}

export function createKanal(stelleId: number, daten: NeuerKanal): Promise<ExterneStelleKanal> {
  return apiSend<ExterneStelleKanal>(`/api/external-agencies/${stelleId}/channels`, 'POST', daten);
}

export function deleteKanal(stelleId: number, kanalId: number): Promise<void> {
  return apiSend<void>(`/api/external-agencies/${stelleId}/channels/${kanalId}`, 'DELETE');
}

/**
 * Schreiben nur mit Netz, ohne Warteschlange (`frontend/src/offline/AGENTS.md`, „Schreiben ohne
 * Netz“): eine Adresse der Stelle wird nicht vorgemerkt, die Maske sagt es.
 */
const SOFORT_ODER_NIE = { networkMode: 'always' } as const;

/** Adressen einer Stelle. `aktiv` hält die Abfrage zurück, solange keine Stelle gewählt ist. */
export function useExterneStelleKanaele(stelleId: number | undefined) {
  return useQuery({
    queryKey: globalKeys.externeStelleKanaele(stelleId ?? 0),
    queryFn: () => fetchExterneStelleKanaele(stelleId as number),
    enabled: stelleId !== undefined,
  });
}

/** Alle Adressen der aktiven Stellen (Zählhinweis der Liste, Auswahl beim Senden). */
export function useKanaeleSammlung(kanal?: KanalArt) {
  return useQuery({
    queryKey: globalKeys.externeStellenKanaeleSammlung(kanal ?? 'alle'),
    queryFn: () => fetchKanaeleSammlung(kanal),
  });
}

export function useCreateKanal(stelleId: number) {
  const qc = useQueryClient();
  return useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (daten: NeuerKanal) => createKanal(stelleId, daten),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.externeStellen() }),
  });
}

export function useDeleteKanal(stelleId: number) {
  const qc = useQueryClient();
  return useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (kanalId: number) => deleteKanal(stelleId, kanalId),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.externeStellen() }),
  });
}
