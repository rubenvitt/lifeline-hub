# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- Rust: `cargo test --test <datei>`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`.

## 1. Backend: Vorlage und Tabelle (D1, D2, D7)

- [ ] 1.1 Test zuerst:
  - `tests/enum_wire_kontrakt.rs`: `ChecklistenPunkt` mit sieben Werten in `ALLE`-Reihenfolge.
  - Einheitentest am Enum: Round-Trip über `ALLE`, `parse("")`/Großschreibung → `None`, ETB-Texte
    nicht leer.
  - Nachweis: rot belegt.
- [ ] 1.2 Umsetzung:
  - `migrations/0127_stab_checkliste.sql` (Nummer gegen `origin/alpha` mit
    `scripts/check-migrationen.sh` prüfen)
  - `src/stab/checkliste.rs`: `wire_enum!` `ChecklistenPunkt`, DTO `ChecklistenEintrag`
    (`ToSchema`, ehrliche Optionalität)
  - `schwaerzung_registry.rs`: Tabelle eingetragen, `bemerkung` → `Scrub(NullSetzen)`
  - Nachweis: 1.1 grün, Schwärzungs-Guard grün, `db::tests::migrationsnummern_sind_eindeutig`
    grün.

## 2. Backend: Lesen und Setzen (D3, D4, D5)

- [ ] 2.1 `tests/stab_checkliste.rs` zuerst:
  - GET leer → `[]`. PUT `{erledigt:true}` → 200, Zeile mit `erledigt_at`. GET zeigt sie.
  - Idempotenz: zweimal `{erledigt:true}` → gleiches `erledigt_at`.
  - Umkehr: `{erledigt:false}` behält die Bemerkung. `{bemerkung:"x"}` behält `erledigt`.
    `{bemerkung:null}` bzw. `""` löscht.
  - 400: unbekannter Punkt, leerer Body `{}`, Bemerkung > 500 Zeichen, kaputter Typ. Danach ist
    nichts gespeichert.
  - ETB: sechs Punkte ab- und anhaken → ETB-Anzahl unverändert. `leitstelle_gemeldet` abhaken → +1
    System-Eintrag, erneut → +0, entfernen → +1 (E1 = A), erneut entfernen → +0.
  - Rechte: Beobachter liest 200, schreibt 403. Nichtmitglied 404. Abgeschlossener Einsatz → 409.
  - Live: Das Abhaken publiziert `stab`, der Meldungspunkt zusätzlich `etb`.
  - Nachweis: rot belegt.
- [ ] 2.2 Umsetzung:
  - Repo in `src/stab/checkliste.rs` (`write_retry!`, `fordere_aktiv_in_tx`, Upsert, bedingter
    `system_audit_tx`, frisches Lesen nach Commit)
  - Routen `checkliste_laden`/`checkliste_setzen` in `src/routes/stab.rs`, Registrierung in
    `src/app.rs`, `api_doc.rs`
  - Nachweis: 2.1 grün, `cargo test` im Workspace grün (Server ohne Hülle).
- [ ] 2.3 Codegen: `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts`
  mitcommitten.
  - Nachweis: Skript grün.

## 3. Frontend: Vorlage, API, Key (D1, D5)

- [ ] 3.1 Test zuerst:
  - `stab/checkliste.test.ts`: Die Vorlage führt genau die sieben Wire-Werte in `ALLE`-Reihenfolge,
    jeder Punkt mit nicht leerem Text und nicht leerer Quelle.
  - `checklistenZeileStil`: `minHeight` = `controlHeight` für 30 und 72, Polster aus
    `paddingSM`/`padding`, Böden als Literale.
  - `api/stab.test.ts`: `setzeChecklistenPunkt` schickt `PUT …/stab/checkliste/{punkt}` mit genau
    dem übergebenen Feld.
  - `queryKeys.test.ts`: `stabCheckliste` liegt unter dem Stab-Prefix.
  - Nachweis: rot belegt.
- [ ] 3.2 Umsetzung: `stab/checkliste.ts`, `api/stab.ts`, `einsatzKeys.stabCheckliste`.
  - Nachweis: 3.1 grün, `queryKeys.guard.test.ts` und `lagebildOffline.guard.test.ts` grün.

## 4. Frontend: Paneel auf der Stabseite (D6)

- [ ] 4.1 `stab/ChecklistePaneel.test.tsx` zuerst:
  - Sieben Zeilen in Reihenfolge mit Quelle. Zähler erst mit Daten, „2/7 erledigt“.
  - Tipp auf den Text (nicht die Box) sendet `{erledigt:true}` genau einmal. Ein erledigter Punkt
    zeigt „erledigt HH:MM“.
  - Ohne Schreibrecht: alle Boxen `disabled`, kein PUT beim Tipp, Bemerkung als „—“.
  - Ablehnung: Der Fehler steht an der Zeile (`data-fehler`), der Haken zeigt den Serverstand,
    `.ant-message` zählt 0.
  - GET-Fehler: `SeitenFehler` mit Wiederholen, keine Checkboxen.
  - Bemerkung speichern sendet `{bemerkung}` und nie `erledigt`.
  - Nachweis: rot belegt.
- [ ] 4.2 Umsetzung: `stab/ChecklistePaneel.tsx`, eingehängt in `pages/StabPage.tsx` als drittes
  Paneel.
  - Nachweis: 4.1 grün. `StabPage.test.tsx` und `StabPage.palette.test.tsx` unverändert grün (die
    bestehenden Paneele bleiben unberührt). `dichte.guard.test.ts` grün (kein `size="small"`).
    `pnpm lint` grün.

## 5. e2e und Prüfliste

- [ ] 5.1 `e2e/gate3-trefflaeche.spec.ts`: Die sieben Zeilen-Labels halten 30/48/72 px, als Admin
  und als Beobachter (Vorbedingung: Box gesperrt). Mutationsprobe: ohne `minHeight` rot.
- [ ] 5.2 Ein e2e-Test klickt den Zeilentext (nicht `toBeVisible`) und prüft den Haken nach dem
  Neuladen. Der Meldungspunkt erzeugt genau einen ETB-Eintrag, der in der ETB-Zeitachse steht.
- [ ] 5.3 `pruefliste.md` (15 Kriterien der Bedien-Leitlinie, je Zeile ein Verdikt) neben dieser
  Change.
- [ ] 5.4 `./scripts/check-all.sh` grün (lokal bzw. per CI-Lauf des PRs).

## 6. Abschluss

- [ ] 6.1 `/opsx:archive lfh-551-stab-checkliste-arbeitsaufnahme` im selben Branch (Spec-Sync nach
  `openspec/specs/stab-checkliste/`), Verweis in CLAUDE.md (Abschnitt Stab/Funkplan) nachziehen.
