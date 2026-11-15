/**
 * Das zuletzt besuchte Modul je Kategorie, je Person und Einsatz (LLH-1734, Spec
 * `seiten-orientierung`, design.md D1 in `openspec/changes/f24jkokr-rahmen-kleinteile/`). Einziger
 * Leser ist der Rail-Sprung: ein Klick auf „Kräfte“ führt dorthin zurück, wo die Person in den
 * Kräften zuletzt war, nicht immer ins Meldebild.
 *
 * Wie `letzterOrt.ts` zählt jede ANKUNFT, nicht nur die Wahl: gefragt ist „wo war ich in dieser
 * Kategorie“. Gemerkt wird nur der Modulschlüssel, nicht die Unterseite; ein Datensatz könnte
 * inzwischen fehlen. „Zuletzt besucht“ der Sprungpalette (`zuletztModule.ts`) bleibt davon
 * getrennt, dort zählen nur Wahlen.
 *
 * JE EINSATZ und JE BENUTZER, MIT FRIST einer Schicht, aus denselben Gründen wie
 * `zuletztModule.ts`: am geteilten Fükw-Rechner erbte die nächste Schicht sonst die Wege der
 * vorigen.
 */
import { sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import {
  istModulFreigegeben,
  erstesFreigegebenesModul,
  modulRegistry,
  type KategorieKey,
  type ModulEintrag,
} from './modulRegistry';
import type { ModulFreigaben } from '../api/types';
import { ZULETZT_FRIST_MS } from './zuletztModule';

/** Lebensdauer eines Eintrags ab der letzten Ankunft: eine Schichtlänge. */
export const KATEGORIE_MODUL_FRIST_MS = ZULETZT_FRIST_MS;

interface Entry {
  key: string;
  /** Zeitpunkt der letzten Ankunft, Millisekunden seit Epoch. */
  at: number;
}

const storageKey = (benutzerId: number, einsatzId: number) =>
  `lfh:nav:kategorie-modul:${benutzerId}:${einsatzId}`;

/** Die gültigen Einträge je Kategorie; fremder oder kaputter Inhalt gilt als „nichts gemerkt“. */
function readAll(benutzerId: number, einsatzId: number, jetzt: number): Record<string, Entry> {
  const raw = sicherLesen(storageKey(benutzerId, einsatzId));
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const valid: Record<string, Entry> = {};
  for (const [kategorie, e] of Object.entries(value as Record<string, unknown>)) {
    if (typeof e !== 'object' || e === null) continue;
    const { key, at } = e as Record<string, unknown>;
    if (typeof key !== 'string' || typeof at !== 'number') continue;
    if (jetzt - at > KATEGORIE_MODUL_FRIST_MS) continue;
    valid[kategorie] = { key, at };
  }
  return valid;
}

/** Merkt die Ankunft in einem Modul für dessen Kategorie; Abgelaufenes fällt dabei heraus. */
export function saveKategorieModul(
  benutzerId: number,
  einsatzId: number,
  modul: ModulEintrag,
  jetzt: number = Date.now(),
): void {
  const all = readAll(benutzerId, einsatzId, jetzt);
  all[modul.kategorie] = { key: modul.key, at: jetzt };
  // Speicher gesperrt (Privatmodus): ohne Persistenz weiterarbeiten.
  sicherSchreiben(storageKey(benutzerId, einsatzId), JSON.stringify(all));
}

/** Der gemerkte Modulschlüssel einer Kategorie innerhalb der Frist, sonst `null`. */
export function loadKategorieModul(
  benutzerId: number,
  einsatzId: number,
  kategorie: KategorieKey,
  jetzt: number = Date.now(),
): string | null {
  return readAll(benutzerId, einsatzId, jetzt)[kategorie]?.key ?? null;
}

/**
 * Ziel des Rail-Sprungs: das gemerkte Modul, wenn es zur Kategorie gehört und freigegeben ist,
 * sonst das erste freigegebene der Kategorie. Rein, ohne Speicherzugriff. Unbekannte Freigaben
 * geben nichts frei, wie bei {@link erstesFreigegebenesModul}.
 */
export function rueckkehrModul(
  kategorie: KategorieKey,
  gemerkt: string | null,
  freigaben: ModulFreigaben | undefined,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  const modul = gemerkt ? register.find((m) => m.key === gemerkt) : undefined;
  if (modul && modul.kategorie === kategorie && istModulFreigegeben(modul, freigaben)) return modul;
  return erstesFreigegebenesModul(kategorie, freigaben, register);
}
