# Tasks

Subtask LLH-1133 (`i0x7xjk3`) von LLH-1018. Jede Aufgabe entsteht per TDD. Geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. mit der genannten e2e-Spec.

## 1. Bereiche der UHS-Seite

- [x] 1.1 `bereich`-Param in `routing/deeplinks.ts` (Parser mit Rückfall auf Belegung). Vitest.
- [x] 1.2 `UhsDetailPage`: Bereichsleiste unter dem Kopf, gewählter Bereich in `fensterInhalt` mit voller Höhe, Unterreiter des Grundrisses unverändert. Vitest `UhsDetailPage.test.tsx` (Vorgabe Belegung, `?bereich=material`, Wechsel schreibt die URL).
- [x] 1.3 Kopfzahl `materialKopfzahl` als Sprung in der Meta-Zeile, ohne Freigabe Material keine Zahl. Vitest.

## 2. Material am Ort

- [x] 2.1 `MaterialAmOrt`: Statusanzeige als `StatusWahl` mit den Rechten des Zuordnens, Fehler an der Zeile, Geräte lesend. Vitest `MaterialAmOrt.test.tsx`, `materialSchreibweg.test.tsx` (gleicher Schreibweg wie `MaterialPage`).
- [x] 2.2 `kraefte/MaterialAdhocDialog.tsx` aus `MaterialPage` herauslösen, „Material erfassen“ in `MaterialAmOrt` mit Ort in einem Request, gesperrt am beendeten Ort. Vitest; `MaterialPage`-Test bleibt grün.
- [x] 2.3 „Fehlmenge melden“ an der UHS (Vorbelegung Nachforderung, nur mit Freigabe). Vitest.

## 3. Nachweise und Doku

- [x] 3.1 e2e `uhs-hoehe.spec.ts` auf Bereiche umgestellt (1440 × 900 und 1280 × 800: Material ohne Bildlauf wählbar, jeder Bereich volle Höhe).
- [ ] 3.2 `frontend/AGENTS.md`, Abschnitt Material (LFH-341): Status und Ad-hoc am Ort. Kapitel `unfallhilfsstellen.md` (Bild `grundriss.png` neu) und `material.md`; Prettier und Wächter der Anwenderdoku grün.
