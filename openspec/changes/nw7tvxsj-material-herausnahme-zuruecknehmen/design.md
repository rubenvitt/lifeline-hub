# Design

## Context

Das Fahrzeug nimmt sein Entlassen seit LLH-1722 vollständig zurück
(`openspec/changes/archive/2026-11-16-tfq6f4kb-loesende-aktionen/design.md` D5): `entlassen_tx`
liefert einen Vorzustand, die Antwort trägt ihn zum Client, und `…/entlassen/zuruecknehmen` stellt
mit diesem Vorzustand den Zustand davor her (`src/fahrzeug/disposition_repo.rs`, `zuruecknehmen_tx`).

Beim Material liegt das Gegenstück halb vor:

- `material::disposition_repo::entlassen_tx` löst den Ort schon über `ort::set_ort_tx` und gibt den
  Ort davor als `Entlassen.ort` zurück. Die Route meldet damit nur den Leser des Orts (`sse_ort`)
  und antwortet mit der bloßen `EinsatzMaterialAnzeige`.
- „Rückgängig“ in `pages/MaterialPage.tsx` ruft `reaktiviereDisposition`. `reaktivieren_tx` setzt
  `disponiert_at` neu, erneuert den Snapshot aus dem Stamm und prüft den Dienststatus. Für den Block
  „Aus dem Einsatz genommen“ ist das richtig, für ein Rückgängig nicht.
- Den Ort setzt allein `ort::set_ort_tx` (Spec `material-modell`, „Ein Schreibweg für den Ort“). Er
  prüft das Ziel über `require_ziel_tx`: Einheit aufgelöst und Fahrzeug beendet → 409, UHS und Raum
  storniert → 404, aufgelöst → 422. Das Ziel braucht kein Recht seines Moduls, nur das auf Material
  (Spec `material-liste`).

## Goals / Non-Goals

**Goals:**

- Rückgängig stellt Ort, Dispositionszeit, Menge und Status her, mit demselben Riegel wie das Fahrzeug.
- Wire-Form und Benennung bleiben nah am Fahrzeug, damit LLH-1922 (Personal) dasselbe Muster findet.

**Non-Goals:**

- Keine gemeinsame Abstraktion für Fahrzeug, Material und Personal (Entscheidung am Checkpoint:
  nur Material). Geteilt wird nur der Hinweissatz im Frontend.
- Der Block „Aus dem Einsatz genommen“ bleibt bei `reaktivieren` und ohne Ort.
- Kein Rückgängig für den Nachforderungsbezug: das Herausnehmen fasst ihn nicht an.

## Decisions

### D1 Vorzustand flach mit den vier Ortsspalten

`MaterialEntlassungVorzustand { entlassen_at, einheit_id, einsatz_fahrzeug_id, uhs_id, br_id }`,
alle Ortsfelder `Option<i64>` mit `#[serde(default)]`. Gebaut aus `Entlassen.ort` über
`MaterialOrt::spalten`, gelesen über `MaterialOrt::aus_spalten`.

- Alternative `ort: { art, id }`: kompakter, aber eine zweite Form neben `OrtPatch` und den
  Tabellenspalten, die der Client sonst nirgends kennt. Verworfen.
- Mehr als eine gesetzte Ortsspalte im Body ist eine Feld-Kombination → 422 vor der Transaktion
  (`src/AGENTS.md`, Statuscode-Konvention), wie `OrtPatch::validate`.
- Der Typ heißt eigens für Material, weil `fahrzeug::EntlassungVorzustand` Fahrzeugfelder trägt.
  `RuecknahmeAusgelassen` wird wiederverwendet: Er ist schon generisch (Bezeichnung, Grund).

Antwort von `…/entlassen`: `MaterialEntlassungAntwort { material, vorzustand }`; Antwort der
Rücknahme: `MaterialRuecknahmeAntwort { material, ausgelassen }`.

### D2 Rücknahme in einer Transaktion, eigener Schreibweg statt `reaktivieren`

Neu `material::disposition_repo::zuruecknehmen_tx(conn, einsatz_id, em_id, benutzer_id, jetzt,
vorzustand)`:

1. **Riegel** wie beim Fahrzeug: `beendet_als = entlassen`, `beendet_von` = Aufrufer, `beendet_at`
   = `vorzustand.entlassen_at`, `jetzt ≤ entlassen_at + RUECKNAHME_FRIST_MINUTEN`. Die Frist nimmt
   die Konstante des Fahrzeugs (`fahrzeug::disposition_repo::RUECKNAHME_FRIST_MINUTEN`), keine
   zweite Zahl. Sonst 409 „Die Herausnahme lässt sich nicht mehr zurücknehmen; das Material lässt
   sich erneut disponieren“.
2. **Bestimmtes Stück:** Hat die Zeile einen Stamm, prüft `stamm_stueck_tx` + die Logik von
   `check_stueck_frei_tx`, ob dasselbe Gerät in einer anderen Zeile aktiv ist → 409 mit dem Grund
   von dort. Ohne Dienststatus-Prüfung und ohne neuen Snapshot: Die Rücknahme stellt die Zeile her,
   wie sie zehn Minuten zuvor aktiv war; `reaktivieren` bleibt der Weg, der den Stamm neu liest.
3. **Endzustand aufheben:** `beendet_* = NULL` mit `AND beendet_at = ?` im UPDATE (zweite Rücknahme
   trifft keine Zeile → 409). `disponiert_at`, `disponiert_von`, Menge, Status, Snapshot und
   `zuletzt_entlassen_at` bleiben; Letzteres hält die Storno-Sperre wie beim Fahrzeug.
4. **Ort:** Ist im Vorzustand einer gesetzt, `ort::set_ort_tx(conn, einsatz_id, em_id, Some(ort))`.
   `Conflict`, `UnprocessableEntity` und `NotFound` des Ziels → Posten bleibt ohne Ort, Eintrag in
   `ausgelassen` mit dem Ortsnamen (`ort_text_tx`) und einem Grund je Art: „inzwischen aufgelöst“
   (Einheit), „inzwischen entlassen oder storniert“ (Fahrzeug), „nimmt kein Material mehr auf“ (UHS,
   Raum). Gibt es den Ort nicht mehr (`ort_text_tx` → `NotFound`, etwa eine spurlos aufgelöste und
   darum gelöschte Einheit), nur die Art mit „nicht mehr vorhanden“: kein erfundener Grund. Ein
   anderer Fehler bricht die Transaktion ab.
5. **Neue Einheit mit alter ID** (Review vor dem PR): `einsatz_einheit.id` hat kein AUTOINCREMENT,
   eine gelöschte Einheit gibt ihre ID an die nächste. Ist die Einheit des Vorzustands jünger als
   `entlassen_at` (`angelegt_at`), war sie nie der Ort davor: ausgelassen mit „nicht mehr
   vorhanden“, ohne ihren Namen. UHS und Raum zählen mit AUTOINCREMENT, Fahrzeugzeilen bleiben
   stehen. Dasselbe Loch hat der Einheit-Zweig der Fahrzeug-Rücknahme (Folgeaufgabe).

Weil `set_ort_tx` bei einem Fehler nichts schreibt und der Endzustand schon aufgehoben ist, bleibt der
Posten bei einem ausgelassenen Ort aktiv ohne Ort (Entscheidung am Checkpoint: nicht 409).

Alternative: `reaktivieren_tx` um einen Ort erweitern. Verworfen, weil es `disponiert_at` neu setzt,
den Riegel nicht kennt und dem Block dient.

### D3 Route, Rechte, ETB und Live

`POST /api/einsaetze/{id}/material/{em_id}/entlassen/zuruecknehmen` in `src/routes/einsatz_material.rs`,
Gate `EinsatzSchreibzugriff<Material>` (ADR-0005), kein `fordere_zielmodul`: Den Ort setzt auch der
PATCH nur mit dem Recht auf Material. In einer `write_retry!`-Transaktion: `zuruecknehmen_tx`, Anzeige
laden, `system_audit_tx` mit `material::etb_text_herausnahme_zurueckgenommen(bezeichnung, menge,
ort, ausgelassen)` → „Material «Wolldecke» (×20): Herausnahme zurückgenommen[, Ort Einheit «Staffel
A»][, ohne Einheit «Staffel A» (inzwischen aufgelöst)]“. Den Ort, an den der Posten zurückkam, nennt
der Eintrag immer: Er kommt aus dem Vorzustand des Clients, und ein Ortswechsel ohne Spur im ETB
widerspräche Spec `material-modell` (Review vor dem PR). Nach dem Commit `sse_material` und `sse_ort` für den zurückgewonnenen Ort.
`notify_nachforderung` nicht: Das Herausnehmen meldet die Nachforderung auch nicht.

### D4 Oberfläche wie die Fahrzeugseite

`api/einsatzMaterial.ts`: `nimmAusDemEinsatz` liefert `MaterialEntlassungAntwort`, neu
`nimmHerausnahmeZurueck(einsatzId, emId, vorzustand)`. In `MaterialPage` hält `herausnehmenMutation`
den Vorzustand aus der Antwort im Rückgängig-Hinweis; `rueckgaengigMutation` ruft die Rücknahme,
invalidiert Liste und Einheiten (der Ort kann eine Einheit sein) und setzt bei `ausgelassen` einen
`SeitenHinweis` „Wolldecke zurück, ohne: Einheit «Staffel A» (inzwischen aufgelöst)“. Der Satz
kommt aus einer geteilten Funktion `ausgelassenSatz(name, ausgelassen)` in
`kraefte/ruecknahme.ts`; `FahrzeugePage` nutzt sie auch (ihr Export bleibt als Weiterleitung nicht
stehen, die Aufrufer ziehen mit). Eine Ablehnung (409) steht wie bisher im Seitenhinweis
„Nicht zurückgenommen“.

## Risks / Trade-offs

- [Ein Client hält den Vorzustand und schickt einen anderen Ort] → Der Riegel bindet an Person,
  Zeitpunkt und Frist; ein anderer Ort ginge durch `require_ziel_tx` und ist ein Ort, den dieselbe
  Person über den PATCH ohnehin setzen dürfte. Kein Rechtegewinn.
- [Der Snapshot eines Stamm-Postens bleibt zehn Minuten alt] → Gewollt; „Erneut disponieren“ liest
  den Stamm neu.
- [Die Antwort von `…/entlassen` ändert ihre Form] → Nicht in der öffentlichen API v1; der einzige
  Aufrufer ist `api/einsatzMaterial.ts`, den derselbe PR nachzieht. Typ-Codegen hält beide Seiten
  gleich.
