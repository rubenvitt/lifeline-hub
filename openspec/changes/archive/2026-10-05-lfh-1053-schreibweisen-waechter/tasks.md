# Tasks

## 1. Wächter (TDD, Selbsttest zuerst)

- [x] 1.1 `scripts/check-schreibweisen.test.sh` gegen Wegwerf-Git-Repos schreiben, jedes
  Szenario aus `specs/dateinamen-schreibweise/spec.md` ein Fall: Stand vor LFH-1050 (rot,
  beide Dateien genannt) · `Stab/` neben `stab/` (rot) · `README.md` neben `readme.md` (rot) ·
  `Lagekarte.tsx` neben `lagekarte/` (rot) · neue, nicht hinzugefügte Datei (rot) ·
  `GefahrenMatrix.tsx` neben `gefahrenMatrix.css` (grün) · `EinsatzSeite.tsx`,
  `.test.tsx`, `.css` (grün) · ignorierte Datei in anderer Schreibung (grün). Geprüft werden
  Exit-Code und Meldung. Zuerst laufen lassen und rot sehen (Skript fehlt).
- [x] 1.2 `scripts/check-schreibweisen.sh [<repo-wurzel>]` nach design.md D1 bis D4 umsetzen,
  bis 1.1 grün ist; Kopfkommentar mit Herkunft (LFH-1050), Regel, Abhilfe und der
  ASCII-Grenze.
- [x] 1.3 Mutationsproben von Hand, jeweils muss ein Fall aus 1.1 rot werden: Verzeichnisse
  nicht mitzählen · Modulschlüssel weglassen · `--others` weglassen · `.css` als Modulendung
  zählen. Danach zurückdrehen. Ergebnis 05.10.2026: alle vier rot, dazu `--exclude-standard`
  weglassen und die Schwelle auf drei Schreibungen heben, ebenfalls rot. Der Selbsttest läuft
  auch mit BWK-awk (`original-awk`, Abstammung des macOS-awk) grün. Gefunden und behoben: mawk
  legt `mitglieder[s]` schon beim Lesen an, die Meldung begann mit „, “; der Selbsttest prüft
  jetzt die ganze Zeile.

## 2. Gate

- [x] 2.1 `scripts/check-all.sh`: Schritt 14 (erst Selbsttest, dann Prüfung) im Bündel
  `schnell`, `SCHRITTE=14`, Kopfkommentar und Bündelbeschreibung nachziehen; die
  Bündel-Selbstprüfung bleibt grün. Prüfen mit `./scripts/check-all.sh --nur schnell`.
- [x] 2.2 `scripts/AGENTS.md`: `check-schreibweisen.sh` in die Gate-Kette aufnehmen, eine Zeile
  zur Regel mit Verweis auf diese Change. Prettier betrifft die Datei nicht; Verweise auf
  „dreizehn Schritte“ per `grep` gesucht und nachgezogen.

## 3. Nachweis

- [x] 3.1 Gegenprobe: auf dem Stand vor LFH-1050 (`git worktree add … 5df0fa2d`) ist
  `scripts/check-schreibweisen.sh` rot und nennt `frontend/src/stab/medienlageUebernahme.ts`
  und `MedienlageUebernahme.tsx`; auf dem Branch grün. Laufzeit messen und in der PR-Beschreibung
  nennen. Ergebnis: rot mit genau der Gruppe
  `frontend/src/stab/MedienlageUebernahme.tsx, frontend/src/stab/medienlageUebernahme.ts`,
  auf dem Branch grün; 0,05 s bei 4 011 Dateien.
- [x] 3.2 `./scripts/check-all.sh --nur schnell` vollständig grün.
