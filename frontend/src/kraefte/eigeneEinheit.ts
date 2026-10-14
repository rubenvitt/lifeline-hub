import type { EinheitTyp, EinsatzPersonal, Staerke } from '../api/types';

/**
 * Reiner Kern von „Als eigene Einheit führen“ (LLH-1073, design.md D9/D10): die Vorgabe des Typs
 * und die Besatzung, die in die neue Einheit mitkommt.
 */

const istGleich = (a: Staerke, b: Staerke) =>
  a.fuehrer === b.fuehrer && a.unterfuehrer === b.unterfuehrer && a.mannschaft === b.mannschaft;

/**
 * Typ-Vorgabe: nur wenn genau ein Katalogtyp dasselbe Soll hat wie das Fahrzeug, sonst keine —
 * nicht raten.
 */
export function typVorgabe(typen: readonly EinheitTyp[], soll: Staerke | null): number | undefined {
  if (soll == null) return undefined;
  const passend = typen.filter((t) => t.soll != null && istGleich(t.soll, soll));
  return passend.length === 1 ? passend[0].id : undefined;
}

/** Wer mitkommt: aktive Personen auf dem Fahrzeug, die keiner Einheit angehören (D10). */
export function mitkommendeBesatzung(
  personal: readonly EinsatzPersonal[],
  efId: number,
): EinsatzPersonal[] {
  return personal.filter(
    (p) => p.beendet_at == null && p.fahrzeug_id === efId && p.einheit_id == null,
  );
}

/** Die Datenzeile unter den Feldern; ohne mitkommende Personen keine. */
export function besatzungZeile(personen: readonly EinsatzPersonal[]): string | null {
  return personen.length > 0 ? `Besatzung: ${personen.map((p) => p.name).join(', ')}` : null;
}
