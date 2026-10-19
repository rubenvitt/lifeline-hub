# Proposal

## Why

Wer 20 von 50 Wolldecken an eine UHS bringt, teilt heute in der Materialliste auf und setzt danach
in der Spalte „Ort“ den Ort der neuen Zeile: zwei Handgriffe, zwei ETB-Einträge, und dazwischen
steht eine Zeile am falschen Ort. Am Ort selbst (Einheit, Fahrzeug, UHS, BR) geht es gar nicht:
„Material zuordnen …“ holt immer den ganzen Posten. Nachzug aus LLH-1225 (Zunder LLH-1251); löst
die Entscheidung vom 13.10.2026 Nr. 4 („Aufteilen ohne Zielort“) ab.

## What Changes

- **Server:** `POST …/material/{em_id}/aufteilen` nimmt optional die Ort-Felder
  (`einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`, `br_id`) mit derselben Bedeutung wie der PATCH,
  bezogen auf den Ort der Ausgangszeile. Fehlen sie, bleibt alles wie heute. Mindern, Anlegen,
  Ortswechsel der neuen Zeile und **ein** ETB-Eintrag laufen in einer Transaktion; das Ziel prüft
  der Server wie jeden Ortswechsel (404/409/422), eine Ablehnung schreibt nichts.
- **ETB:** Aufteilen mit anderem Ziel schreibt einen Eintrag, der Aufteilen und Ortswechsel nennt:
  „Material «Wolldecke» aufgeteilt: 50 → 30 + 20, davon 20: Einheit «Staffel A» → UHS «Turnhalle»“.
- **Live:** zusätzlich zu `material` und dem Ort der Ausgangszeile meldet der Server den Zielort.
- **Dialog „Aufteilen …“** in der Materialliste: neues Feld „Ort“ für den abgeteilten Teil,
  vorbelegt mit dem Ort der Ausgangszeile; Auswahl wie in der Spalte „Ort“, samt „ohne Ort“.
- **Am Ort „Teilmenge hierher“:** Wählt die Person unter „Material zuordnen …“ ein Verbrauchsgut
  mit Menge ab 2, fragt ein Dialog „<Bezeichnung> hierher“ die „Menge hierher“, vorbelegt mit der
  ganzen Menge. Die ganze Menge holt den Posten wie bisher; weniger teilt auf und setzt den
  abgeteilten Teil an diesen Ort, in einem Schritt. Geräte und Posten mit Menge 1 holt die Wahl
  weiter sofort.
- Anwenderdoku: Kapitel `material.md` (Aufteilen, ETB, Bild `aufteilen.png`), Abschnitte zum
  Zuordnen in `einheiten.md`, `bereitstellungsraeume.md`, `unfallhilfsstellen.md` und
  `fahrzeuge.md`, soweit sie das Zuordnen beschreiben.

## Capabilities

### New Capabilities
<!-- keine -->

### Modified Capabilities
- `material-liste`: „Posten aufteilen“ nimmt einen Ort für die neue Zeile; „Grenzen des Aufteilens“
  nennt die Prüfung des Ziels und die Reihenfolge der Ablehnungen.
- `material-am-ort`: „Material am Ort zuordnen“ fragt bei einem Verbrauchsgut die Menge; „Ein
  Schreibweg für den Ort“ nennt das Aufteilen mit Ziel als zweiten Weg derselben Disposition.
- `material-modell`: „Ortswechsel, Ausgabe und Art im ETB“ legt fest, dass der Ortswechsel beim
  Aufteilen im Eintrag des Aufteilens steht; „Ortswechsel live“ schließt das Aufteilen mit Ziel ein.

## Impact

- Backend: `src/material/disposition_repo.rs` (`teile_auf_tx`), `src/material/mod.rs` (ETB-Text),
  `src/routes/einsatz_material.rs` (`AufteilenBody`, Handler, SSE). Kein neuer Endpunkt, keine
  Migration; der Body wird nur erweitert, alte Clients senden weiter `{ menge }`. Kein
  Response-DTO ändert sich, also kein Codegen.
- Frontend: `api/einsatzMaterial.ts` (`teileAuf`), `kraefte/MaterialAufteilenModal.tsx`,
  `pages/MaterialPage.tsx`, `kraefte/MaterialAmOrt.tsx` mit neuem Mengendialog,
  `kraefte/materialPosten.ts`; Tests daneben.
- e2e: `material-liste.spec.ts` (Aufteilen an die UHS), neuer Fall am Ort.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/t1hvaqzuetc7tal6yoagea6z
