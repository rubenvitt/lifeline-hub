import { dichten, type Dichte } from '../theme/tokens';

/**
 * Breite einer Aktionsspalte, die nur den Menüauslöser trägt (Entscheidung 14.10.2026, LLH-1722):
 * die quadratische Steuerhöhe der Dichte oder der Kopf „Aktionen“ (rund 4,4 Schriftgrößen), was
 * breiter ist, plus das Zellpolster beidseits (`abstand.md`). Gemessen 82 / 102 / 124 px
 * (`e2e/gate1-ueberlauf.spec.ts`). Eine Quelle für Fahrzeug- und Materialliste.
 */
export function menueSpaltenBreite(dichte: Dichte): number {
  const stufe = dichten[dichte];
  return Math.ceil(Math.max(stufe.zeilenhoehe, 4.4 * stufe.schriftgroesse)) + 2 * stufe.abstand.md;
}
