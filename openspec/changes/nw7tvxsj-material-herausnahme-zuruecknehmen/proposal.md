# Proposal

## Why

„Rückgängig“ nach „Aus dem Einsatz nehmen“ ruft heute nur `…/reaktivieren`: Der Posten wird wieder
aktiv, liegt aber ohne Ort. Wer sich vertippt hat, muss Einheit, Fahrzeug, UHS oder
Bereitstellungsraum von Hand wieder eintragen, und `reaktivieren` setzt zusätzlich die
Dispositionszeit neu. Das widerspricht der Regel „Rückgängig nur, wenn der Rückweg den Zustand davor
herstellt“ (`frontend/AGENTS.md`, „Beenden: Verb, Ort und Sicherung je Art“). Dort ist die Lücke als
bekannt eingetragen, mit dieser Folgeaufgabe LLH-1923 aus LLH-1722. Das Fahrzeug nimmt seit LLH-1722
vollständig zurück; Material zieht nach demselben Muster nach.

## What Changes

- `POST …/material/{em}/entlassen` antwortet mit `{ material, vorzustand }`. Der `vorzustand` nennt
  `entlassen_at` und den Ort davor (`einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`, `br_id`).
  **BREAKING** für Aufrufer der Route; sie gehört nicht zur öffentlichen API v1, der einzige
  Aufrufer ist die eigene Oberfläche.
- Neu `POST …/material/{em}/entlassen/zuruecknehmen` mit dem Vorzustand als Body: Nur die Person,
  die herausgenommen hat, nur dieses Herausnehmen und höchstens zehn Minuten danach, sonst 409. Der
  Posten wird wieder aktiv mit Menge, Status und Dispositionszeit von vorher; die Storno-Sperre
  bleibt.
- Der Ort kommt zurück, wenn er den Posten noch aufnimmt. Sonst bleibt der Posten aktiv ohne Ort,
  und die Antwort nennt den Ort mit Grund in `ausgelassen`.
- Steht ein Gerät mit Bestandsnummer inzwischen in einer anderen Zeile wieder aktiv im Einsatz,
  lehnt die Rücknahme mit 409 ab.
- ETB-Eintrag „Material «…» (×n): Herausnahme zurückgenommen“, bei ausgelassenem Ort mit
  „, ohne <Ort> (<Grund>)“. Live-Meldungen an Material und Ort wie beim Herausnehmen.
- Materialseite: „Rückgängig“ im Hinweis ruft die Rücknahme; ein ausgelassener Ort steht im
  Seitenhinweis „<Posten> zurück, ohne: …“ wie auf der Fahrzeugseite.
- `frontend/AGENTS.md`: Material verlässt die Liste der bekannten Lücken; Personal (LLH-1922) bleibt.
- Anwenderdoku `material.md`, „Material aus dem Einsatz nehmen“: Rückgängig bringt den Posten an
  seinen Ort zurück.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `kraefte-entlassung`: „Erneut disponieren“ nennt Material nicht mehr als Kraft, die beim
  Rückgängig nur reaktiviert wird; neue Anforderung „Herausnahme von Material zurücknehmen“ mit
  Ort, Auslassung, Riegel und Gerät mit Bestandsnummer.

## Impact

- Backend: `src/material/disposition_repo.rs` (`entlassen_tx` liefert den Vorzustand, neu
  `zuruecknehmen_tx`), `src/material/mod.rs` (Vorzustand, Antworttypen, ETB-Text),
  `src/routes/einsatz_material.rs`, `src/app.rs`, `src/api_doc.rs`; Tests in
  `src/material/disposition_repo.rs` und `tests/`.
- Generierte Typen: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- Frontend: `api/einsatzMaterial.ts`, `pages/MaterialPage.tsx`, `ausgelassenSatz` aus
  `pages/FahrzeugePage.tsx` in eine geteilte Datei; Tests der Materialseite.
- Regeln und Doku: `frontend/AGENTS.md`, `docs/anwender/kapitel/material.md`.
- Keine Migration, kein neues Modulrecht.
