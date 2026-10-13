import type { ReactNode } from 'react';
import {
  modulFreigabeAnzeige,
  useModulFreigabe,
  type ModulFreigabe,
  type ModulSeite,
} from '../einsatz/useModulFreigabe';

/**
 * Freigabe des Stab-Moduls für die Unterseiten des Stabs (Pressearbeit und Informationstelefon,
 * LFH-554). Diese Seiten sind keine eigenen Module; sie erben Sperre und Sichtbarkeit vom Stab und
 * müssen sie deshalb selbst ermitteln, bevor sie Daten zeigen — fail-closed wie jede Seite mit
 * `useModulFreigabe`. Funkplan und Kommunikationsplan gehören seit LLH-1180 dem Fernmeldewesen.
 */
export type StabFreigabe = ModulFreigabe;

export function useStabFreigabe(einsatzId: number): StabFreigabe {
  return useModulFreigabe(einsatzId, 'stab');
}

/** Wie die Seite heißt: als Titel („Pressearbeit“) und mit Artikel im Satz („die Pressearbeit“). */
export type StabUnterseite = ModulSeite;

/**
 * Was eine Stab-Unterseite zeigt, solange die Freigabe nicht `frei` ist. Liefert `null` bei
 * `frei` — dann rendert die Seite selbst.
 */
export function stabFreigabeAnzeige(
  freigabe: StabFreigabe,
  seite: StabUnterseite,
  einsatzId: number,
): ReactNode {
  return modulFreigabeAnzeige(freigabe, 'stab', seite, einsatzId);
}
