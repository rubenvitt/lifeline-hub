# Tasks

## 1. Backend: Wire-Feld und Abfrage

- [x] 1.1 Migration `0105_auftrag_quell_etb_index.sql` (partieller Index auf `auftrag(quell_etb_eintrag_id)`) anlegen; Nummer gegen `origin/alpha` geprüft; `cargo test` läuft mit ihr durch
- [x] 1.2 `FolgeauftragVerweis { id, lfd_nr: Option<i64> }` (ToSchema, `skip_serializing_if` an `lfd_nr`) und Feld `folgeauftraege` mit `#[sqlx(skip)]` an `EtbEintragAnzeige`; Schema in `src/api_doc.rs` registriert — geprüft durch Kompilieren und 1.4
- [x] 1.3 TDD in `src/etb/repo.rs`: roter Test zuerst (zwei Aufträge aus einer Entscheidung → beide am Quell-Eintrag, aufsteigend nach `lfd_nr`, Anordnungs-Einträge leer; Eintrag ohne Auftrag → leer; abgenommener Auftrag zählt; Cursor-Seite trägt vollständige Liste), dann gebündelte Abfrage in `laden` und `abfrage` — Tests grün
- [x] 1.4 Routentest: `GET …/etb` liefert `folgeauftraege` als Key (Presence per `contains_key`, auch bei `[]`) und nach `POST …/etb/{eid}/auftrag` den erzeugten Auftrag am Quell-Eintrag — Test grün
- [x] 1.5 `scripts/check-typ-codegen.sh` laufen lassen, `openapi.json` + `types.generated.ts` regeneriert und `tsc` grün; `FolgeauftragVerweis` im Barrel `api/types.ts` re-exportiert, falls dort üblich

## 2. Frontend: Zeitachse

- [x] 2.1 Fixtures von `EtbEintragAnzeige` um `folgeauftraege: []` ergänzen — `tsc` grün
- [x] 2.2 TDD in `EtbBacklinkBadges.test.tsx`: ein Folgeauftrag → Link „Folgeauftrag Nr. 12" mit `href` auf `?auftrag=<id>`; drei Folgeaufträge → drei verschiedene Namen; ohne Nummer → „Folgeauftrag"; ↗ nicht im zugänglichen Namen; ohne Folgeauftrag und ohne Rückverweis → nichts gerendert; Rückverweis „Auftrag" und Folgeauftrag nebeneinander unterscheidbar. Dann Umsetzung in `EtbBacklinkBadges.tsx` inkl. Dateikopf — Tests grün
- [x] 2.3 (beim Bau gefunden) `EtbZeitachse` hängt den Verweisblock nur bei Rückverweis ein — Folgeaufträge ohne Rückverweis fielen still heraus. Eine Bedingung `hatVerknuepfung` in `zeitachseModell.ts` für beide Stellen; roter Zeitachsen-Test zuerst, dann grün

## 3. Frontend: Überblick

- [x] 3.1 TDD in `UeberblickPage.test.tsx`: Auftragsliste antwortet mit Fehler, Entscheidung trägt zwei Folgeaufträge → „2 Aufträge" sichtbar, Fußnote „Folgeaufträge werden nicht gezählt" abwesend. Dann Umstellung auf `e.folgeauftraege.length`, `folgeauftraegeJeEintrag` samt Tests entfernt — Tests grün

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh` grün (inkl. Prettier, Lint, e2e)
- [ ] 4.2 Im Browser geprüft: Entscheidung erfassen → „Auftrag erteilen" zweimal → Zeitachse zeigt „Folgeauftrag Nr. …" zweimal, Klick selektiert den Auftrag; Überblick zeigt „2 Aufträge"
- [x] 4.3 `docs/design/2026-09-21-neuentwurf/umsetzung.md`: Folgeauftrag-Verweis aus der Datenlücken-Liste nehmen und Zeile „Entscheidungen" auf den neuen Stand bringen (Neuentscheid Übersicht offen, s. Abschlussmeldung)
