# Proposal

## Why

Ein erteilter Einzelauftrag lässt sich heute weder zurückziehen noch korrigieren. Im Einsatz kommt
beides ständig vor: Die Lage ändert sich und der Auftrag erledigt sich, er ging an die falsche
Einheit, oder Frist und Ort waren falsch. So ein Auftrag bleibt „offen“, wird überfällig und zählt im
Modulzähler, im Überblick, in der Vorbereitung der Lagebesprechung und in der Lagebericht-Übernahme
mit. Außerdem löst er weiter die Erinnerung „Quittierfrist“ aus. Der einzige Ausweg ist ein falscher
„Vollzug“, und der verfälscht die Dokumentation. Nach FwDV 100 ist das Aufheben oder Ändern eines
Auftrags selbst ein Führungsvorgang und gehört ins Einsatztagebuch.

## What Changes

- **Aufheben:** `POST /api/einsaetze/{id}/auftraege/{aid}/aufheben` mit Pflichtgrund.
  - Erlaubt für Einsatzleitung und Führungspersonal, solange der Auftrag weder abgenommen noch
    schon aufgehoben ist; sonst 422.
  - Neuer Bearbeitungsstatus `aufgehoben` (Wire-Wert, Wort „Aufgehoben“). Er gehört zur
    Abgeschlossen-Phase, ist nie offen und nie überfällig.
  - Offene Quittungen werden nicht mehr erwartet. Quittieren, Vollzug und Abnahme am aufgehobenen
    Auftrag ergeben 422. Die offene Erinnerung „Quittierfrist“ wird geschlossen.
  - Im selben Commit entsteht ein ETB-Eintrag vom Typ „Anordnung“:
    „Auftrag #4 aufgehoben: <Grund>“. Das Aufheben ist unumkehrbar.
- **Berichtigen:** `PATCH /api/einsaetze/{id}/auftraege/{aid}` als Teil-Patch.
  - Änderbar sind Auftragstext, Empfänger, Priorität, Frist und die Felder des Befehlsschemas.
  - Erlaubt nur, solange der Auftrag „offen“ ist und noch kein Empfänger quittiert hat; sonst 422.
    Danach bleibt nur Aufheben und ein neuer Auftrag, denn der Empfänger hat den alten Wortlaut
    bestätigt.
  - Ein Patch ohne fachliche Änderung schreibt nichts. Sonst entsteht im selben Commit ein
    ETB-Eintrag vom Typ „Anordnung“, der die geänderten Felder nennt, etwa
    „Auftrag #4 geändert: Frist 12.10. 16:00 (vorher 12.10. 15:00).“
  - Eine geänderte Frist verschiebt die Erinnerung „Quittierfrist“. Eine entfernte Frist schließt
    sie, eine neue Frist legt sie an.
- **Oberfläche:**
  - An der Auftragskarte kommen die Handlungen „Berichtigen“ und „Auftrag aufheben“ hinzu. Sie
    liegen hinter dem Menüauslöser, „Auftrag aufheben“ rot hinter einem Trenner.
  - Aufheben fragt mit Pflichtgrund nach und bestätigt mit dem Knopf „Auftrag aufheben“. Es gibt
    keinen Rückgängig-Toast.
  - Berichtigen öffnet das Auftragsformular vorbelegt und speichert mit „Berichtigung speichern“.
  - Ein aufgehobener Auftrag steht unter „Abgeschlossen“, mit dem neutralen Etikett „Aufgehoben“
    und mit Grund, Zeit und Namen.
- **Zahlen:** Modulzähler, Überblick (samt Abschnittsbilanz), Vorbereitung der Lagebesprechung,
  Lagebericht-Übernahme und das Abschnittsgerät zählen einen aufgehobenen Auftrag nie als offen
  oder überfällig. Das gemeinsame Fixture beider Sprachen bekommt den Fall.
- **Grenzen:** `AUFHEBUNGSGRUND_MAX` (2 000 Zeichen) neu. Die Berichtigung prüft dieselben Grenzen
  wie das Erteilen.
- **Doku:** Kapitel `auftraege-befehle.md` bekommt die Abläufe „Einen Auftrag berichtigen“ und
  „Einen Auftrag aufheben“. Das Bild `auftraege-liste` wird neu erzeugt.

## Capabilities

### New Capabilities

- `auftrag-aufheben-berichtigen`: Aufheben eines erteilten Einzelauftrags mit Pflichtgrund und
  Berichtigen vor der ersten Quittung. Dazu gehören:
  - Statuswert `aufgehoben` und seine Phasen-Semantik in allen Zahlen,
  - die ETB-Einträge beider Vorgänge,
  - die Wirkung auf Quittung, Vollzug, Abnahme und die Erinnerung „Quittierfrist“,
  - die Rechte und Statuscodes,
  - die Bedienung an der Karte.

### Modified Capabilities

- `eingabegrenzen`: „Auftrag begrenzt Text und Empfänger“ gilt auch für die Berichtigung. Neu ist
  die Grenze für den Aufhebungsgrund.

## Impact

- **Backend:**
  - Migration (nächste freie Nummer über 0179) mit `aufgehoben_at`, `aufgehoben_von_id` und
    `aufhebungsgrund` an `auftrag`, jeweils `ALTER TABLE … ADD COLUMN`, kein Tabellen-Neuaufbau.
  - Code:
    - `src/auftrag/mod.rs`: Enum, `ist_offen`, Konstante.
    - `src/auftrag/repo.rs`: Status-, Überfällig-, Abschluss- und Cursor-SQL, `aufheben_tx`,
      `berichtigen_tx`.
    - `src/auftrag/eingabe.rs`: Empfänger-Validierung teilen.
    - `src/routes/auftrag.rs` und `src/app.rs`: zwei Handler. Quittieren, Vollzug und Abnahme
      sperren den aufgehobenen Auftrag.
  - Erinnerung: `erinnerung::repo` (Schließen und Verschieben in der Transaktion).
  - Schwärzungs-Register, Typ-Codegen, `tests/enum_wire_kontrakt.rs`,
    `tests/fixtures/verdichtung/regeln.json`.
  - Allowlist der Funktionsansichten: Der Wächtertest bekommt beide Routen als „verboten“.
- **Frontend:**
  - `kommunikation/phase.ts` mit Ton-Override am Status-Deskriptor, `kommunikation/kartenKante.ts`.
  - `api/auftraege.ts` und `api/eingabegrenzen.ts`.
  - `auftraege/AuftragKarte.tsx`, `auftraege/AuftraegeListe.tsx`, `auftraege/AuftragFormular.tsx`
    (Berichtigen-Modus) und neu `auftraege/AuftragAufhebenDialog.tsx`.
  - `pages/fuehrung/ueberblickDaten.ts` (Bilanz) und `test/auftraegeAttrappe.ts`.
- **Doku:** `docs/anwender/kapitel/auftraege-befehle.md` und die Bilder unter
  `docs/anwender/bilder/auftraege-befehle/`.
- **Berührung mit laufender Arbeit:**
  - LLH-1091 (Schema nach EAMZW, neues Feld `weg`, eigene Migration) und LLH-1084 (Listen- und
    Detailmuster) ändern dieselben Dateien. Abstimmung in `design.md`, Risiken.
- Kein Einfluss auf Befehle, Lageberichte, den ETB-Typ „Berichtigung“ und manuelle Erinnerungen.
