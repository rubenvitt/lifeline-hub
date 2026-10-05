# Tasks

## 1. Backend: Präfixsuche

- [x] 1.1 Test in `src/etb/repo.rs` zuerst: „Deich“ trifft „Deichbruch gemeldet“, „bruch“ trifft es nicht; Test schlägt vor der Änderung fehl
- [x] 1.2 Test: `anzahl` und `zaehle` melden zu „Deich“ dieselbe Menge wie `abfrage`; Test grün
- [x] 1.3 Test: Eingabe nur aus Sonderzeichen (`* :`) liefert ungefiltert alle Einträge; der bestehende Sonderzeichen-Test (`Status: "alles" AND *`) bleibt grün
- [x] 1.4 `fts_query` hängt je Phrase ein `*` an, Doc-Kommentar nachgezogen; `cargo test etb::repo` grün

## 2. Frontend: Begründungen nachziehen

- [x] 2.1 Kommentar in `frontend/src/dokumente/bezugswahl.ts` (`sucheEtbBezuege`, `waehleEtbEintraege`) auf Wortanfänge korrigieren und Hinweise in `command-palette/useDatensaetze.ts` prüfen; `pnpm lint` und Prettier grün
- [x] 2.2 Server-Mock in `DokumentAblegenModal.test.tsx` auf Wortanfänge umstellen; Test „Wortanfang am Server jenseits des Fensters“ und „Wortmitte nur im Fenster“; Vitest grün, Mutationsprobe (Mock auf ganze Wörter) rot

## 3. Abschluss

- [x] 3.1 `./scripts/check-all.sh` grün (lokal vor dem Push, danach CI des PRs)
