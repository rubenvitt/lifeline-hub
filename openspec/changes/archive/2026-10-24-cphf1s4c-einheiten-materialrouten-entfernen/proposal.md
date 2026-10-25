# Proposal

## Why

Seit LLH-1225 (Entwurf D2, Teil II) setzt die Oberfläche den Ort eines Materialpostens nur noch
über die Material-Disposition (`PATCH …/material/{em_id}`). Daneben stehen weiter die
Einheiten-Routen `PUT` und `DELETE …/einheiten/{eid}/material/{em_id}`. Sie haben keinen
Client-Aufrufer mehr und weichen in zwei Punkten von den Specs ab:

- Sie verlangen das Recht des Moduls **Einheiten**. Die Spec `material-am-ort` („Rechte für
  Material am Ort“) verlangt fürs Zuordnen und Lösen die Freigabe des Moduls **Material** und
  ausdrücklich nicht das Recht des Moduls, das den Ort führt. Wer Einheiten schreiben darf, aber
  kein Material, kann über diese Route heute trotzdem einen Posten umhängen.
- `DELETE` an einem Posten, der nicht an dieser Einheit liegt, antwortet 404. Die Spec
  `material-modell` („Ort setzen und lösen“) verlangt, dass das Lösen eines fremden Orts nichts
  ändert, ohne dass es ein Fehler ist.

Zwei Schreibwege mit verschiedenen Rechten für denselben Ort sind eine Lücke, die keine
Oberfläche mehr braucht (Nachzug LLH-1253).

## What Changes

- **BREAKING (API):** `PUT` und `DELETE /api/einsaetze/{id}/einheiten/{eid}/material/{em_id}`
  entfallen. Danach antwortet der Server dort mit 404. Den Ort setzt und löst allein die
  Material-Disposition (`PATCH …/material/{em_id}` mit `einheit_id`, dazu Disponieren und
  Aufteilen mit Ort-Feld).
- Neue Regel in der Spec `material-modell`: Ort-Schreibwege gibt es nur in der
  Material-Disposition. Die Module, die einen Ort führen, bieten keine eigene Route dafür an.
- Backend- und e2e-Tests, die die Einheiten-Route nur als Vorbereitung nutzen, gehen über den
  Material-PATCH. Fälle, die nur die Route selbst prüften, entfallen, wenn ein PATCH-Test sie
  schon abdeckt.
- Der Hinweis im Client (`frontend/src/api/einsatzMaterial.ts`) nennt die Routen als entfernt.

Typen und OpenAPI ändern sich nicht: Die Routen standen nie im OpenAPI-Dokument und hatten
keinen Body.

## Capabilities

### New Capabilities

- keine

### Modified Capabilities

- `material-modell`: neue Anforderung „Ein Schreibweg für den Ort“. Den Ort eines Postens
  schreibt nur die Material-Disposition, mit deren Rechten. Eine eigene Ort-Route eines
  Ort-Moduls gibt es nicht.

## Impact

- **Backend:** `src/app.rs` (zwei Routen), `src/routes/einsatz_einheit.rs` (`material_zuordnen`,
  `material_freigeben`, `set_material_ort` und ihre Imports), `tests/einsatz_einheit.rs`,
  `tests/einsatz_material.rs`.
- **Frontend:** `frontend/e2e/meldebild-druck.spec.ts`,
  `frontend/e2e/trefflaeche-pruefflaechen.spec.ts` (Vorbereitung über den PATCH), Kommentar in
  `frontend/src/api/einsatzMaterial.ts`. Die Wächter in den Vitest-Dateien
  (`materialSchreibweg.test.tsx`, `EinheitMaterial.test.tsx`, `MaterialPage.test.tsx`) bleiben:
  Sie belegen, dass der Client die Route nicht ruft.
- **API-Nutzer:** Kein bekannter Aufrufer außerhalb des Repos. Gekoppelte Geräte nutzen
  dieselbe Oberfläche und rufen die Route nicht.
