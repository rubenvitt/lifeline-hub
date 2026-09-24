/**
 * Verpflegung (LFH-634) — GERÜST für Aufgabe 5.3, noch nicht die Seite.
 *
 * Steht nur, damit die Route aus der Registry (Aufgabe 3.6) auf eine eigene Seite statt auf
 * den `ModulStub` führt. Kopf-Meta, Primäraktion „Zeitfenster anlegen“, Segmentleiste,
 * Zeitfenster-Karten, `RechteHinweis` und `Sammelbanner` baut 5.3 (design.md D7).
 */
import EinsatzSeite from '../components/EinsatzSeite';

export default function VerpflegungPage() {
  return <EinsatzSeite titel="Verpflegung">{null}</EinsatzSeite>;
}
