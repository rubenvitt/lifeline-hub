import type { QueryClient } from '@tanstack/react-query';
import { adminSektionPfad } from '../../admin/adminNav';
import { hasEinsatzbezug } from '../../api/anbindungen';
import { globalKeys } from '../../api/queryKeys';
import type { AnbindungAnzeige, AnbindungenListe } from '../../api/types';

// Gemeinsames der Anbindungen-Seiten (LLH-1652): Liste und Ansicht eines Zugangs.

/** Die Liste: `/admin/einstellungen/anbindungen`; zugleich Ziel einer unbekannten Kennung. */
export function anbindungenPath(): string {
  return adminSektionPfad('einstellungen', 'anbindungen');
}

/** Die Ansicht eines Zugangs (Item-Route, `frontend/AGENTS.md`, „Bearbeiten in der Ansicht“). */
export function anbindungPath(id: string): string {
  return `${anbindungenPath()}/${encodeURIComponent(id)}`;
}

/** Wort und Ton des Zustands, rein und exportiert für den Test. */
export function zustandAnzeige(z: Pick<AnbindungAnzeige, 'zustand' | 'is_abgelaufen'>): {
  wort: string;
  ton: 'normal' | 'bedien' | 'neutral' | 'achtung';
} {
  if (z.zustand === 'widerrufen') return { wort: 'widerrufen', ton: 'neutral' };
  if (z.is_abgelaufen) return { wort: 'abgelaufen', ton: 'achtung' };
  if (z.zustand === 'wartet') return { wort: 'wartet auf Schlüssel', ton: 'bedien' };
  return { wort: 'aktiv', ton: 'normal' };
}

/**
 * Welchen Einsatz eine Anbindung mit Lese-Recht mit Einsatzbezug gerade liest (LLH-1638); die
 * Einsatzleitung gibt ihn auf der Seite „Geräte“ frei. `null`, wenn die Zeile fehlt: ohne solches
 * Recht, widerrufen oder abgelaufen. Rein und exportiert für den Test.
 */
export function einsatzAnzeige(
  z: Pick<AnbindungAnzeige, 'scopes' | 'zustand' | 'is_abgelaufen' | 'einsatz_bezeichnung'>,
): string | null {
  if (z.zustand === 'widerrufen' || z.is_abgelaufen || !hasEinsatzbezug(z.scopes)) return null;
  return z.einsatz_bezeichnung ? `liest ${z.einsatz_bezeichnung}` : 'kein Einsatz freigegeben';
}

/**
 * Setzt die Antwort einer eigenen Änderung in die Liste und lässt sie danach neu laden: die
 * Antwort zeigt den Zugang sofort, der Abruf alles, was andere inzwischen geändert haben.
 */
export function uebernimmAnbindung(qc: QueryClient, z: AnbindungAnzeige): void {
  qc.setQueryData<AnbindungenListe>(globalKeys.anbindungen(), (alt) =>
    alt
      ? {
          ...alt,
          zugaenge: alt.zugaenge.some((x) => x.id === z.id)
            ? alt.zugaenge.map((x) => (x.id === z.id ? z : x))
            : [z, ...alt.zugaenge],
        }
      : alt,
  );
  void qc.invalidateQueries({ queryKey: globalKeys.anbindungen() });
}

/**
 * Abrufabstand der Liste: „zuletzt genutzt“ und Ablehnungen kommen von Fremdsystemen, nicht als
 * Org-Ereignis (`api/queryKeys.ts`, `NICHT_LIVE_GLOBAL_KEYS`).
 */
export const ANBINDUNGEN_ABRUF_MS = 30_000;
