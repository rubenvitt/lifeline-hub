# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/kjezbk06f8l6rxkh0b6l7pnd (LLH-1613, Folge aus LLH-1493)

## Why

LLH-1493 verteilt den Kern der Stammdaten vom Hub an gekoppelte ELW. Die übrigen Kataloge fehlen
noch: Ein ELW legt Einsätze ohne die Einsatz-Vorlagen und Schichtmodelle des Hubs an, die
Sprechgruppen im Fernmeldewesen fehlen, und ETB-Bausteine, Externe Stellen, Verpflegungsplan,
Stichwort-Vorschläge und Unterkunft-Richtwerte müsste jemand im Fahrzeug doppelt pflegen. Das
Verfahren steht; es fehlen die Arten und drei Randfälle, die erst diese Kataloge auslösen.

## What Changes

- **Acht weitere Arten** gehen denselben Weg wie der Kern (Änderungslog per Trigger, Nachlieferung
  „seit Stand X“, Schreibschutz am ELW, erster Abgleich): Schichtmodelle, Einsatz-Vorlagen mit
  ihren ausgeblendeten Modulen, Stichwort-Vorschläge, Verpflegungs-Vorlagen, Sprechgruppen der
  Org, ETB-Bausteine, Externe Stellen und Unterkunft-Richtwerte der Org.
- **Nur der Org-Katalog der Sprechgruppen wird verteilt.** Einsatz-lokale Sprechgruppen bleiben,
  wo sie sind: kein Log, keine Lieferung, kein Abgleich mit ihnen.
- **Natürlicher Schlüssel aus mehreren Feldern:** Sprechgruppen gleichen über Betriebsart und
  Bezeichnung ab, denn „Rotkreuz 1“ kann es als TMO und als DMO geben.
- **Eine Markierung, die es je Org nur einmal gibt, folgt dem Hub** (Entscheidung 09.11.2026):
  Liefert der Hub die Vorgabe der Schichtmodelle oder die zuständige Leitstelle, verliert eine
  lokale Zeile am ELW diese Markierung, statt dass die Hub-Zeile mit Konflikt draußen bleibt.
- **Am Fremdschlüssel gescheiterte Löschung wird nachgeholt** (Entscheidung 09.11.2026): Löscht
  der Hub ein Schichtmodell, das er vorher aus seinen Einsatz-Vorlagen genommen hat, versucht der
  ELW die Löschung nach allen Änderungen desselben Pakets ein zweites Mal. Erst wenn sie dann
  scheitert, gilt das bisherige Verhalten (stilllegen bzw. der Instanz überlassen).
- **Oberfläche:** Die acht Reiter zeigen „vom Hub“ und „nur hier“ und sperren die Bearbeitung
  übernommener Zeilen, Unterkunft-Richtwerte je Schlüssel.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `stammdaten-verteilung`: weitere Arten, Abgleich über mehrere Felder, Teilmenge einer Tabelle
  (Org-Katalog der Sprechgruppen), exklusive Markierung folgt dem Hub, nachgeholte Löschung.

## Impact

- Backend: `src/instanz/stammdaten/` (`mod.rs` Enum, `art.rs` Beschreibungen, `liefern.rs`,
  `uebernehmen.rs`), neue Migration mit Log- und Schutz-Triggern samt Grundstock.
- Wire: `StammdatenArt` bekommt acht Werte; generierte Typen neu (`scripts/check-typ-codegen.sh`).
  Eine ältere Instanz überspringt unbekannte Arten (D2 der Vorgänger-Change), das neue
  Empfangskennzeichen startet die Nachlieferung bei 0.
- Frontend: acht Reiter unter `frontend/src/stammdaten/` (Abzeichen und Sperre),
  `RichtwerteListe` für die Sperre je Schlüssel.
- Doku: `docs/anwender/kapitel/instanzkopplung.md`, `src/AGENTS.md` „Instanzkopplung“.
