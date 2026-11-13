import type { QueryClient } from '@tanstack/react-query';
import { adminSektionPfad } from '../../admin/adminNav';
import { globalKeys } from '../../api/queryKeys';
import type { AnbindungAnzeige, AnbindungenListe, WebhookAnzeige } from '../../api/types';

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
 * Welchen Einsatz eine Anbindung gerade liest (LLH-1638); die Einsatzleitung gibt ihn auf der
 * Seite „Geräte“ frei. `null`, wenn die Zeile fehlt: der Server nennt die Anbindung nicht
 * freigebbar (ohne Lese-Recht mit Einsatzbezug, widerrufen, abgelaufen, oder die Instanz meldet
 * sich bei einem Hub). Welche Rechte Einsatzbezug haben, weiß allein der Server. Rein und
 * exportiert für den Test.
 */
export function einsatzAnzeige(
  z: Pick<AnbindungAnzeige, 'einsatz_freigebbar' | 'einsatz_bezeichnung'>,
): string | null {
  if (!z.einsatz_freigebbar) return null;
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

/**
 * Wort und Ton des Webhook-Zustands (LLH-1656): „angehalten“ verlangt eine Handlung des Admins,
 * eine Störung zeigt nur, dass der Lauf es weiter versucht. Rein und exportiert für den Test.
 */
export function webhookZustandAnzeige(w: Pick<WebhookAnzeige, 'zustand'>): {
  wort: string;
  ton: 'normal' | 'bedien' | 'neutral' | 'achtung';
} {
  switch (w.zustand) {
    case 'angehalten':
      return { wort: 'Webhook angehalten', ton: 'achtung' };
    case 'fehler':
      return { wort: 'Webhook gestört', ton: 'bedien' };
    case 'ruht':
      return { wort: 'Webhook ruht', ton: 'neutral' };
    case 'aktiv':
      return { wort: 'Webhook stellt zu', ton: 'normal' };
  }
}
