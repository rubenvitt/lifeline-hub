# LFH‑10 — Begriff „Patient" als eigene Personen-Sicht

**Bezug:** Verfeinerung auf der in [E‑2](2026-05-27-erfassung-sichtung-medizinischer-verlauf-design.md)
gebauten medizinischen Schicht. Teil der Sammel-Initiative **LFH‑63** (Erfassung & ETB —
Verbesserungen). Rein additiv; **keine DB-/Modell-Änderung**.

## Worum es geht

Mit E‑2 hat jede Person zusätzlich zum Admin-Status (`erfasst·vermisst·betroffen·verstorben·
abgemeldet`) eine medizinische Sichtungskategorie (`sk1–sk4·tot·unverletzt`, Cache-Feld
`einsatz_person.aktuelle_sichtung`). Fachlich (BOS/Rettungsdienst) ist eine gesichtete,
behandlungsrelevante Person ein **Patient** — der Begriff fehlt aber bislang als eigene Sicht und
als Fachsprache in der UI. Diese Spec führt ihn ein, **ohne** den Admin-Status zu ersetzen
(beide Konzepte koexistieren, wie in E‑2 Annahme 1 grundgelegt).

## Gesetzte Definition (verbindlich)

> **Patient = Person mit `aktuelle_sichtung` ∈ {`sk1`, `sk2`, `sk3`, `sk4`, `tot`}.**

- **Rein medizinische Achse**, unabhängig vom Admin-Status. Eine als `verstorben` markierte Person
  mit Sichtung `tot` ist damit ebenfalls ein (abgeschlossener) Patient und erscheint sowohl in der
  „Verstorben"- als auch in der „Patienten"-Sicht. Diese Achsen-Überlappung ist **gewollt**.
- `unverletzt` (gesichtet, keine Behandlung) und `ungesichtet` (kein Sichtungseintrag, `NULL`)
  zählen **nicht** als Patient — sie bleiben eigene Lagebild-Gruppen (E‑2 Annahme 3).

Diese Definition löst den internen Widerspruch der E‑2-Spec (Annahme 1 „betroffen + Sichtung" vs.
Annahme 3 „SK I–IV, tot") **zugunsten der rein medizinischen Lesart (Annahme 3)** auf.

Single Source of Truth im Frontend: ein Helper
`istPatient(p) = p.aktuelle_sichtung != null && p.aktuelle_sichtung !== 'unverletzt'`.

## Scope

**Drinnen:**

- Neuer Tab „Patienten" in `frontend/src/pages/PersonenPage.tsx` mit SK-Abschnitten.
- Aggregierte Kennzahl „Patienten: N" im bestehenden Lagebild-Streifen.
- „Patient"-Badge im Detail-Drawer (zusätzlich zum Admin-Status).
- Neue `sichtung`-Spalte im CSV-Export (`src/routes/einsatz_person.rs`).
- Konsistenz-Check der Modul-Beschreibung in `modulRegistry.ts`.
- Frontend- und Backend-Tests (siehe unten).

**Draußen:**

- Kein neues Datenmodell, keine Migration, keine neue Route, kein SSE-/ETB-Eingriff.
- Keine Änderung an der Sichtungs-/Verbleib-/Abgleich-Logik aus E‑2.
- Lagekarte bleibt unangetastet (der Begriff wird dort nicht eingeführt).

## Frontend

### Patienten-Tab (`PersonenPage.tsx`)

- `SICHTEN` um Eintrag `{ key: 'patienten', label: 'Patienten' }` zwischen „Betroffen" und
  „Verstorben" erweitern; `Sicht`-Typ entsprechend ergänzen.
- Filterbasis = alle (nicht ausgeblendeten) Personen mit `istPatient(p)` — **über alle
  Admin-Status hinweg**, nicht status-gefiltert wie die übrigen Tabs.
- Darstellung als **echte Abschnitte je SK** in Triage-Reihenfolge `sk1 → sk2 → sk3 → sk4 → tot`:
  - Pro nicht-leerer SK-Gruppe eine Überschrift mit Farb-Badge (`SK_META`) + Anzahl, z. B.
    „SK I (3)".
  - Darunter die bestehende Personen-Tabelle (gleiche `spalten`) mit den Personen dieser Gruppe.
  - Leere SK-Gruppen werden ausgeblendet (analog Lagebild-Streifen).
- Die status-basierten Aktionsspalten (z. B. Vermisstenabgleich) sind im Patienten-Tab nicht aktiv;
  Zeilenklick öffnet wie gewohnt den Detail-Drawer.

### Lagebild-Streifen

- Im bestehenden Streifen zusätzlich „Patienten: N" anzeigen, N = Anzahl `istPatient`
  (Summe SK I–IV + tot). Reine Ableitung aus den schon berechneten Zählungen; keine neue Abfrage.

### Detail-Drawer

- Ist die geöffnete Person Patient, ein zusätzliches **„Patient"-Tag** neben dem Admin-Status-Tag
  anzeigen (im Stammdaten-Kopf und in der Badge-Zeile des Med-Tabs). Der Admin-Status-Tag
  („betroffen" usw.) bleibt unverändert daneben stehen.

### Modul-Beschreibung

- `modulRegistry.ts` beschreibt den Fluss bereits als „vermisst → betroffen → Patient →
  verstorben". Nur auf Konsistenz mit der hier gesetzten Definition prüfen; kein neuer Text nötig.

## Backend — CSV-Export

- `GET /api/einsaetze/{id}/personen/export` (`src/routes/einsatz_person.rs`): Header und Zeilen um
  eine `sichtung`-Spalte ergänzen.
- Neuer Header: `registrier_nr;status;sichtung;name;vorname;geschlecht;alter;antreff_ort`.
- Wert der Spalte = `aktuelle_sichtung` als Code (`sk1`…`sk4`/`tot`/`unverletzt`) bzw. leer bei
  `NULL` (ungesichtet). Der Patient-Status ist daraus ableitbar — **keine** separate Patient-Spalte.
- RFC-4180-Quoting wie bestehend über `csv_feld`.

## Tests

**Frontend (`PersonenPage.test.tsx`):**

- Patienten-Tab zeigt genau die Personen mit Sichtung ∈ {SK I–IV, tot}; `unverletzt` und
  ungesichtet erscheinen **nicht**.
- SK-Abschnitte erscheinen mit korrekter Überschrift + Anzahl; leere SK-Gruppen werden ausgeblendet;
  Reihenfolge SK I → tot.
- Eine `verstorben`+`tot`-Person erscheint sowohl im „Verstorben"- als auch im „Patienten"-Tab.
- Lagebild-Streifen zeigt „Patienten: N" mit korrekter Summe.
- Detail-Drawer einer Patienten-Person zeigt das „Patient"-Tag zusätzlich zum Status-Tag;
  bei unverletzt/ungesichtet kein Patient-Tag.

**Backend:**

- CSV-Export enthält die `sichtung`-Spalte an Position 3 mit korrektem Wert (gesetzte Sichtung,
  leer bei ungesichtet) und unverändertem Quoting.

## Offene Punkte

- Keine. Definition, Platzierung, Gliederung, Touchpoints und Spec-Heimat sind im Brainstorming
  (2026-06-02) abgestimmt.
