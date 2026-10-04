# Tasks

## 1. Backend: Präfixsuche

- [ ] 1.1 Test in `src/etb/repo.rs` zuerst: „Deich“ trifft „Deichbruch gemeldet“, „bruch“ trifft es nicht; Test schlägt vor der Änderung fehl
- [ ] 1.2 Test: `anzahl` und `zaehle` melden zu „Deich“ dieselbe Menge wie `abfrage`; Test grün
- [ ] 1.3 Test: Eingabe nur aus Sonderzeichen (`* :`) liefert ungefiltert alle Einträge; der bestehende Sonderzeichen-Test (`Status: "alles" AND *`) bleibt grün
- [ ] 1.4 `fts_query` hängt je Phrase ein `*` an, Doc-Kommentar nachgezogen; `cargo test etb::repo` grün

## 2. Frontend: Begründungen nachziehen

- [ ] 2.1 Kommentar in `frontend/src/dokumente/bezugswahl.ts` (`sucheEtbBezuege`, `waehleEtbEintraege`) auf Wortanfänge korrigieren und Hinweise in `command-palette/useDatensaetze.ts` prüfen; `pnpm lint` und Prettier grün

## 3. Abschluss

- [ ] 3.1 `./scripts/check-all.sh` grün
