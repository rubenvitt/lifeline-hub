import { dichten, schriftskala, type Dichte } from '../theme/tokens';

/**
 * Breite einer Aktionsspalte, die nur den Menüauslöser trägt (Entscheidung 14.10.2026, LLH-1722):
 * die quadratische Steuerhöhe der Dichte oder der Kopf „Aktionen“, was breiter ist, plus das
 * Zellpolster beidseits (`abstand.md`). Der Kopf steht in der Augenbraue (11 px, fest in jeder
 * Dichte, LLH-2044); „AKTIONEN“ misst gesperrt rund 65 px, sechs Augenbrauen-Größen lassen Luft
 * für den Schriftsatz der CI (LLH-2083, `e2e/aktionen-kopf.spec.ts`). Vorher rechnete die Spalte
 * mit 4,4 Grundschriftgrößen, und der Kopf brach in `kompakt` und `komfortabel` mitten im Wort um.
 * Ergibt 90 / 106 / 120 px. Eine Quelle für Fahrzeug- und Materialliste.
 */
export function menueSpaltenBreite(dichte: Dichte): number {
  const stufe = dichten[dichte];
  const kopf = 6 * schriftskala.augenbraue.groesse;
  return Math.ceil(Math.max(stufe.zeilenhoehe, kopf)) + 2 * stufe.abstand.md;
}
