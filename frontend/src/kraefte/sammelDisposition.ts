import { ApiError } from '../api/client';
import type { Einheit, EinsatzFahrzeug, Fahrzeug, Personal, ZeilenArt } from '../api/types';

/**
 * Reiner Kern der Sammel-Disposition (LLH-1100, Change `iw7x9980-sammel-disposition`): Labels und
 * Suchtexte der Mehrfachauswahl, die Ziele Einheit und Fahrzeug, die Gründe je Kraft aus der
 * Ablehnung. Die Dialoge `PersonalDisponierenModal` und `FahrzeugeDisponierenModal` lesen ihn.
 */

const ohneLeere = (teile: (string | null | undefined)[]) =>
  teile.filter((t): t is string => !!t && t.trim() !== '').join(' ');

/** Label wie bisher im Einzeldialog: Name, Personalnummer in Klammern. */
export function personalLabel(p: Personal): string {
  return `${p.name}${p.personalnummer ? ` (${p.personalnummer})` : ''}`;
}

/** Suche über Name, Personalnummer, Träger und Qualifikation (Spec `kraefte-disposition`). */
export function personalSuchtext(p: Personal): string {
  return ohneLeere([
    p.name,
    p.personalnummer,
    p.traegerorganisation,
    ...p.qualifikationen.map((q) => q.label),
  ]);
}

/** Label wie bisher im Einzeldialog: Funkrufname, Fahrzeugtyp in Klammern. */
export function fahrzeugLabel(f: Fahrzeug): string {
  return `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}`;
}

/** Suche über Funkrufname, Typ, Kennzeichen und Träger. */
export function fahrzeugSuchtext(f: Fahrzeug): string {
  return ohneLeere([f.funkrufname, f.fahrzeugtyp, f.kennzeichen, f.traegerorganisation]);
}

/** Einheiten, die ein Ziel sein können: eine aufgelöste lehnt der Server mit 409 ab. */
export function aktiveEinheiten(einheiten: readonly Einheit[]): Einheit[] {
  return einheiten.filter((e) => e.aufgeloest_at == null);
}

/** Mit Einheit nur ihre Fahrzeuge (Server: 422 sonst), ohne Einheit jedes des Einsatzes. */
export function fahrzeugeDerEinheit(
  fahrzeuge: readonly EinsatzFahrzeug[],
  einheitId: number | null | undefined,
): EinsatzFahrzeug[] {
  return einheitId == null ? [...fahrzeuge] : fahrzeuge.filter((f) => f.einheit_id === einheitId);
}

/** Bleibt das gewählte Fahrzeug nach einem Einheitswechsel gültig? Ohne Fahrzeug: ja. */
export function fahrzeugPasstZurEinheit(
  fahrzeuge: readonly EinsatzFahrzeug[],
  fahrzeugId: number | null | undefined,
  einheitId: number | null | undefined,
): boolean {
  if (fahrzeugId == null) return true;
  return fahrzeugeDerEinheit(fahrzeuge, einheitId).some((f) => f.id === fahrzeugId);
}

/** Grund je abgelehnter Kraft einer Art, in der Reihenfolge der Antwort. */
export function gruendeJeKraft(fehler: unknown, art: ZeilenArt): Map<number, string> {
  if (!(fehler instanceof ApiError)) return new Map();
  return new Map(fehler.zeilen.filter((z) => z.art === art).map((z) => [z.id, z.grund]));
}

/** Erfolg als Toast: eine Kraft im bisherigen Wortlaut, eine Gruppe mit Zahl. */
export function erfolgText(anzahl: number, art: ZeilenArt): string {
  if (art === 'personal')
    return anzahl === 1 ? 'Personal disponiert' : `${anzahl} Kräfte disponiert`;
  return anzahl === 1 ? 'Fahrzeug disponiert' : `${anzahl} Fahrzeuge disponiert`;
}
