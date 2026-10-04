# Tasks

## 1. Vertragskarte

- [x] 1.1 Test zuerst: in `frontend/src/theme/statusFarben.test.ts` einen Block `pegelZustand (LFH-881)` mit Byte-Pin der drei Einträge, „keine Rolle ist `alarm` oder `bedien`“ und `pegelZustandVon` (`'high'` → Eintrag, `'unknown'`/`'commented'`/`'out-dated'`/`'constructor'`/`null` → `null`); `pegelZustand` in die `ALLE_MAPS`-Liste, Testname „zweiunddreißig“; Vitest rot.
- [x] 1.2 `pegelZustand` und `pegelZustandVon` in `frontend/src/theme/statusFarben.ts` anlegen, JSDoc mit Verweis auf D1–D4 dieser Change; Vitest für `statusFarben.test.ts` und `statusVertrag.guard.test.ts` grün.
- [x] 1.3 `frontend/AGENTS.md`, Regel „Ein Status gehört in den Vertrag“: Zahl auf 32 mit Datum und Ticket, `pegelZustand` mit Verweis auf diese Change als weiteres Beispiel; Prettier für `frontend/` grün.

## 2. Inspector

- [x] 2.1 Test zuerst: in `FachebenenInspector.test.tsx` die Pegel-Fälle auf Rolle und Wort umstellen (`high` → „Hoch“ in `achtung`, `normal` → „Normal“ in `normal`, `low` → „Niedrig“ in `achtung`, `unknown` und fehlend ohne Tag und ohne Rohwert); Vitest rot, wo die Rolle geprüft wird.
- [x] 2.2 In `FachebenenInspector.tsx` die Konstante `ZUSTAND` entfernen und den Zustand über `StatusTag` mit `pegelZustandVon(zustand)` zeigen; kein `<Tag color=…>` mehr im Pegel-Inhalt; Vitest für die Datei grün.

## 3. Abschluss

- [x] 3.1 `./scripts/check-all.sh` grün (lokal, Bündel `schnell` plus Frontend-Tests: 685 Dateien, 9485 Tests) und im PR-Lauf (Rust und e2e belegt die CI des PRs).
