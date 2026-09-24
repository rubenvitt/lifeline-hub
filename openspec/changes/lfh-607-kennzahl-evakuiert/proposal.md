# Proposal

## Why

Das Lage-Dashboard des Neuentwurfs (S3) zeigt „Evakuiert 1 320 · von 1 850 geplant“. Diese
Kennzahl fehlt bis heute. LFH-639 hat die Datenquelle gebaut (Evakuierungsbezirke mit
Plangröße und Standmeldungen, `betreuung/useEvakuierungKennzahl.ts`), LFH-640 den
Mechanismus der Kennzahlreihe mit festen Heimatplätzen. Beides liegt auf `alpha`. Es fehlt
der Einbau: der Auslöser am Einsatz und die Zelle auf Lageplatz B.

## What Changes

- **Backend:** Neue Variante `evakuiert` in `Lagekennzahl` (Wire `evakuiert`).
  `EinsatzAnzeige.lagekennzahlen` enthält sie genau dann, wenn der Einsatz mindestens einen
  **aktiven** Evakuierungsbezirk hat (nicht storniert, Räumung nicht `aufgehoben`). Das ist
  dieselbe Definition von „aktiv“ wie `istAktiverBezirk` im Frontend. Gebaut wird der
  Auslöser an beiden Stellen, an denen `EinsatzAnzeige` entsteht (Detail und Liste).
- **Frontend, Lagebild:** Neues Etikett „Evakuiert“, Kandidat auf Lageplatz B (Platz 3) mit
  Rang 0. Bei aktivem Auslöser zeigt Platz 3 „Evakuiert“ statt „Schäden offen“. Wert ist N
  (Summe der Stände), Notiz „von M geplant“, ggf. „· k ohne Meldung“. Das Zeichen „≈“ markiert
  geschätzte Anteile. Ohne jede Standmeldung steht „—“ statt 0. Ziel der Zelle ist das Modul
  Betreuung.
- **Frontend, Formatierung:** Die bestehende `kennzahlText`-Formatierung aus
  `betreuung/betreuungText.ts` wird in Wert und Notiz geteilt. Blockkopf der Modulseite und
  Dashboard-Zelle lesen damit aus EINER Formatierung.
- **Frontend, Invalidierung:** Bezirks-Mutationen (anlegen, ändern, stornieren) invalidieren
  zusätzlich `einsatzKeys.einsatz`. Die festlegende Person sieht den neuen Zuschnitt dann ohne
  Wartezeit. Andere Betrachter bekommen ihn beim nächsten Abruf des Einsatzes über das
  bestehende Sammelbanner („Evakuiert statt Schäden offen · übernehmen“).
- **Spec-Abbildung:** Die LFH-640-Regel „Plangröße auf 0 oder gelöscht“ wird auf **Aufheben
  oder Stornieren** des letzten aktiven Bezirks abgebildet. Eine Plangröße 0 ist nicht
  erreichbar, weil `plan_personen` den CHECK `>= 1` trägt.
- **Doku:** Die Lückenvermerke werden abgeräumt: Dateiköpfe von `lagekennzahl.rs`,
  `lagebild.ts`, `LageDashboardPage.tsx` und `evakuierungKennzahl.ts`, außerdem
  `docs/design/2026-09-21-neuentwurf/umsetzung.md` Punkt 4 und der Absatz in CLAUDE.md.

## Capabilities

### New Capabilities
- `lage-dashboard-kennzahlreihe`: Die lagebezogene Kennzahlreihe des Lage-Dashboards, hier
  mit der Lagekennzahl „Evakuiert“: Auslöser am Einsatz, Heimatplatz, Wert und Notiz,
  Datenzustände, Verhalten bei fehlendem Modulzugriff und beim Wechsel während der
  Betrachtung.

### Modified Capabilities
- keine. LFH-640 ist als Superpowers-Spec abgelegt (`docs/superpowers/specs/…-lfh-640-…`),
  nicht unter `openspec/specs/`. Die LFH-639-Anforderung „Kennzahl“ (Change
  `lfh-639-fachmodul-betreuung`) bleibt unverändert. Dieser Change liest sie nur.

## Impact

- **Backend:** `src/einsatz/lagekennzahl.rs`, `src/einsatz/mod.rs` (Feld am `Einsatz`),
  `src/einsatz/repo.rs` (zwei SQL-Literale), `src/einsatz/berechtigung.rs` (Test-Literal),
  `tests/enum_wire_kontrakt.rs`, ein neuer Integrationstest. Keine Migration.
- **API:** Additive Enum-Variante am Wire, `lagekennzahlen` kann jetzt `"evakuiert"` tragen.
  Codegen (`openapi.json`, `types.generated.ts`) wird regeneriert.
- **Frontend:** `pages/lage-dashboard/lagebild.ts`, `LageDashboardPage.tsx` samt Tests,
  `betreuung/betreuungText.ts`, `pages/BetreuungPage.tsx` (Invalidierung).
- **Kein Zusatzabruf:** Die Betreuungs-Übersicht wird über den Modulzähler im
  Einsatz-Layout ohnehin geladen. Das Dashboard teilt den Query-Key.
