# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. LFH-689.

## 1. Backend: Wire-Feld `berichtigt_durch`

- [ ] 1.1 Integrationstests in `tests/etb.rs` schreiben und rot sehen: Eintrag ohne
  Berichtigung trägt `berichtigt_durch: []`; Nr. 7 mit zwei Berichtigungen trägt beide
  aufsteigend mit `id` und `lfd_nr`; die Berichtigungen selbst tragen `[]`; Seite mit
  `limit=1`, auf der nur der Grundeintrag steht, trägt die Berichtigung; Liste gefiltert auf
  `typ=meldung` trägt die Berichtigung der Meldung; Antwort auf das Erfassen trägt `[]`.
  Prüfung: `cargo test --test etb berichtigt_durch` rot aus dem richtigen Grund (Feld fehlt).
- [ ] 1.2 `BerichtigungVerweis { id, lfd_nr }` und das Feld `berichtigt_durch`
  (`#[sqlx(skip)]`, Doc-Kommentar mit LFH-689) in `src/etb/mod.rs`; `berichtigungen_nachladen`
  in `src/etb/repo.rs` nach D3, aufgerufen in `laden` und `abfrage`; Typ in `src/api_doc.rs`
  registrieren. Prüfung: die Tests aus 1.1 grün.
- [ ] 1.3 Migration `migrations/0131_etb_berichtigt_index.sql` (Teilindex, D4) mit Kopfkommentar
  wie `0106`. Prüfung: `scripts/check-migrationen.sh` grün gegen `origin/alpha`,
  `cargo test db::tests` grün.
- [ ] 1.4 `tests/aufbewahrung.rs`: `berichtigt_durch` in die Liste der Schlüssel, die das
  Archiv-ETB nicht tragen darf. Prüfung: `cargo test --test aufbewahrung` grün.
- [ ] 1.5 Mutationsprobe: Aufruf von `berichtigungen_nachladen` in `abfrage` auskommentieren →
  mindestens ein Test aus 1.1 rot; `ORDER BY lfd_nr` umdrehen → der Reihenfolge-Test rot.
  Ergebnis im Commit-Text nennen.

## 2. Typ-Codegen und Fixtures

- [ ] 2.1 `scripts/check-typ-codegen.sh` laufen lassen, `frontend/src/api/openapi.json` und
  `frontend/src/api/types.generated.ts` mitcommitten. Prüfung: Skript grün, im generierten Typ
  ist `berichtigt_durch` Pflichtfeld.
- [ ] 2.2 ETB-Fixtures in Frontend-Tests und e2e-Mocks um `berichtigt_durch: []` ergänzen, bis
  der Typcheck grün ist. Prüfung: `mise exec -- pnpm -C frontend typecheck` (bzw. der
  entsprechende Schritt aus `check-all.sh`) grün.

## 3. Frontend: Vorschau nennt die Berichtigungen

- [ ] 3.1 Tests in `frontend/src/etb/EtbEintragVorschau.test.tsx` schreiben und rot sehen:
  Eintrag mit `berichtigt_durch` Nr. 9 und Nr. 12 zeigt zwei Links „berichtigt durch Nr. 9“
  und „berichtigt durch Nr. 12“ (zugänglicher Name ohne ↗) in dieser Reihenfolge mit `href`
  auf `etbPfad(…, { eintrag: id })`; ohne Berichtigung kein Text „berichtigt durch“; eine
  Berichtigung, die selbst berichtigt wurde, trägt beide Richtungen; das Nummernfach wird
  dafür nicht neu abgerufen (bestehender Frische-Test deckt es, Fixture mit Feld).
- [ ] 3.2 `EtbEintragVorschau.tsx` nach D5 umsetzen, Kopfkommentar nach D6 anpassen; Satz am
  `berichtigungsindex` in `zeitachseModell.ts` ergänzen. Prüfung: Tests aus 3.1 grün,
  `EtbZeitachse.test.tsx` unverändert grün.
- [ ] 3.3 Mutationsprobe: das `map` über `berichtigt_durch` entfernen → Test aus 3.1 rot;
  die Bedingung des Datenfelds auf nur `berichtigt_eintrag_id` zurückstellen → rot.

## 4. Doku

- [ ] 4.1 Prüfliste `docs/superpowers/specs/2026-09-24-lfh-664-pruefliste.md`, Zeile ETB/9,
  auf erfüllt fortschreiben (Beleg: Tests aus 1.1 und 3.1, LFH-689). Prüfung: Zeile nennt
  keinen offenen Verweis auf LFH-689 mehr; `grep -rn "LFH-689" frontend/src` zeigt nur noch
  die neue Quellenangabe, keinen „fehlt“-Vermerk.

## 5. Integration

- [ ] 5.1 `./scripts/check-all.sh` grün (lokal, sonst durch die CI des PRs belegt).
- [ ] 5.2 Sichtprüfung im Dev-Stack: Einsatz mit Eintrag Nr. n und einer Berichtigung, in der
  Palette `#n` → Vorschau nennt „berichtigt durch Nr. m ↗“, Klick öffnet das ETB mit der
  Berichtigung und schließt die Palette.
