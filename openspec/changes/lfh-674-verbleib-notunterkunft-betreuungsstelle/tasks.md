# Tasks

Jede Aufgabe entsteht test-first nach `superpowers:test-driven-development`: zuerst der
rote Test, dann der Code. Gruppe 1–3 ist das Backend, Gruppe 4–5 das Frontend, Gruppe 6
der Abschluss. Das Frontend baut auf den generierten Typen aus 3.4 auf.

## 1. Datenbank und Schreibweg des Verbleibs

- [x] 1.1 Migration `0121_verbleib_betreuungsstelle.sql` nach design.md D1 anlegen: zwei `ADD COLUMN … REFERENCES betreuungsstelle(id) ON DELETE SET NULL` und ein partieller Index. In den Kopf kommt, dass `betreuungsstelle` damit kein Leaf mehr ist und ein Rebuild den FK-Schalter braucht. Vorher `git fetch` und die höchste Nummer auf `origin/alpha` prüfen. Verifiziert durch einen `db`-Test auf der migrierten DB: `PRAGMA foreign_key_list(person_verbleib)` zeigt auf `betreuungsstelle` mit `SET NULL`, `PRAGMA foreign_key_check` ist leer, und `migration_0112_*` bleibt grün
- [x] 1.2 `verbleib_repo`: `VerbleibDaten.betreuungsstelle_id`, INSERT, Cache-UPDATE, `SELECT_VERBLEIB`. `VerbleibAnzeige.betreuungsstelle_id` mit `skip_serializing_if`. Verifiziert durch die Erweiterung von `erfassen_pflegt_art_ziel_und_status_im_cache`: Notunterkunft mit Stelle setzt beide Spalten, ein folgender Verbleib ohne Stelle leert den Cache, und der Verlauf behält den Verweis am ersten Ereignis
- [x] 1.3 `PersonAnzeige.aktuelle_verbleib_betreuungsstelle_id` (`skip_serializing_if`) samt SELECT in `person/repo.rs`. Verifiziert durch einen Repo-Test: gesetzt → Feld da, ungesetzt → Schlüssel fehlt (`contains_key`)
- [x] 1.4 Route `verbleib`: `VerbleibBody.betreuungsstelle_id` und die Prüfkette aus design.md D2 in genau dieser Reihenfolge (400 → 422 → 403 → 404 → 409, geschlossen erlaubt). `ziel` bleibt unangetastet. Verifiziert durch `tests/verbleib_betreuungsstelle.rs`, je ein Test pro Zeile der D2-Tabelle: Notunterkunft mit Stelle → 201 mit Verweis; Transport mit Stelle → 422; ohne Betreuungsrecht → 403, auch für eine unbekannte Stelle-ID (nicht 404); ohne Betreuungsrecht und ohne Verweis → 201; fremder Einsatz → 404; storniert → 409; geschlossen → 201; mit Stelle ohne Ziel → Kurzform „Notunterkunft“ ohne Stellennamen, ETB-Text ohne Stellennamen

## 2. „davon namentlich“ an der Betreuungsübersicht

- [x] 2.1 `person::repo::namentlich_je_stelle(pool, einsatz_id)` mit der Abfrage aus design.md D4. Verifiziert durch einen Repo-Test mit dem Spec-Szenario „Zählung an der Stelle“: drei mit Stelle 7, einer davon storniert, ein vierter danach entlassen → `[(7, 2)]`, und Stellen mit 0 fehlen in der Liste
- [x] 2.2 `BetreuungUebersicht.namentlich: Option<Vec<StelleNamentlich>>` (`skip_serializing_if`). `repo::uebersicht` setzt `None`, `routes::betreuung::uebersicht` füllt das Feld nur, wenn `fordere_modul_zugriff_laden(…, "personen", …)` für den Lesenden gelingt. Verifiziert durch `tests/verbleib_betreuungsstelle.rs`: mit Personenrecht steht die Zahl da, ohne Personenrecht fehlt der Schlüssel `namentlich` (`contains_key`)
- [x] 2.3 Gegenprobe „nie summieren“ (design.md D4). Verifiziert durch Tests mit zwei namentlich zugeordneten Personen an einer Stelle mit Belegung 40: `GET …/betreuung/belegung` liefert für die Stelle 40 und eine unveränderte Summe, `stelle.belegung.belegt` bleibt 40, und ein gesicherter Lagestand enthält kein `namentlich` (alle drei in `tests/verbleib_betreuungsstelle.rs`)

## 3. Schwärzung, Codegen, Gates Backend

- [x] 3.1 `schwaerzung_registry.rs`: `retain(…, G_FK)` für `person_verbleib.betreuungsstelle_id` und `einsatz_person.aktuelle_verbleib_betreuungsstelle_id`. Verifiziert durch den Klassifizierungstest der Registry (erst rot, dann grün) und die Erweiterung von `schwaerzung_nullt_lagedaten_der_person_und_behaelt_die_kategorien`: Verweis bleibt, Ziel leer
- [x] 3.2 `StelleNamentlich` und die neuen Felder in `src/api_doc.rs` registrieren, falls nötig. Verifiziert durch `tests/enum_wire_kontrakt.rs` (Inventar-Guard grün, kein neues Enum)
- [ ] 3.3 `cargo fmt --all` und `cargo test --workspace`. Verifiziert durch den grünen Lauf
- [x] 3.4 `scripts/check-typ-codegen.sh`. `openapi.json` und `types.generated.ts` werden mitcommittet, `VerbleibEingabe` (handgepflegt in `api/types.ts` bzw. `api/einsatzPerson.ts`) bekommt `betreuungsstelle_id`. Verifiziert durch das grüne Skript samt `tsc`

## 4. Frontend: Verbleib-Dialog

- [x] 4.1 Den Verbleib-Dialog in `PersonenDetailPage.tsx` auf `ErfassungsModal` umziehen (`onErfassen` über `mutateAsync`, kein eigenes `resetFields`). Felder je Art nach design.md D6, Notiz unter „Weitere Angaben“ (ohne `forceRender`, siehe D6). Verifiziert durch Tests: Struktur ohne `.ant-modal-footer` und mit Knopf im `<form>`; bei Transport höchstens drei sichtbare Felder, beim Aufklappen steigt die Zahl; Transportmittel nur bei Transport; eine Ablehnung (409) steht im Dialog und lässt die Felder stehen
- [x] 4.2 Stellen-Auswahl bei `notunterkunft`: Zugriff über `betreuungZugriffVon`, Query `einsatzKeys.betreuung` nur bei `'frei'`, Optionen ohne stornierte Stellen, geschlossene mit „· geschlossen“ im Label und wählbar. Die Vorbelegung von `ziel` folgt der Regel aus D6 und überschreibt keinen eigenen Text. `betreuungsstelle_id` geht nur bei `notunterkunft` mit. Verifiziert durch Tests: ohne Modulrecht kein Abruf und keine Auswahl; eine Wahl belegt das Ziel vor; eigener Text bleibt beim Stellenwechsel; ein Stellenwechsel ersetzt eine unveränderte Vorbelegung; ein Artwechsel auf Transport schickt keinen Verweis mit (Request-Body geprüft)
- [x] 4.3 Live-Fan-out: `EINSATZ_STREAM_EVENTS.person` um `EINSATZ_KEYS.betreuung` ergänzen. Verifiziert durch `queryKeys.test.ts` (Zuordnung gepinnt) und den bestehenden Klassifizierungs-Guard

## 5. Frontend: Anzeige an der Stelle

- [x] 5.1 `betreuung/StellenBlock.tsx`: Die Zelle „belegt“ zeigt nach design.md D7 „· davon namentlich n“ bzw. ohne Meldung „keine Meldung · namentlich n“, in Mono mit `tabular-nums`. Bei 0 oder fehlender Liste steht nichts. Die Summenzeile addiert nur `belegung.belegt`. Verifiziert durch `StellenBlock`- bzw. `BetreuungPage`-Tests: Zahl erscheint; ohne `namentlich` in der Antwort kein Text (Abwesenheit gepinnt); Summe mit namentlich zugeordneten Personen unverändert
- [ ] 5.2 `pnpm lint`, Vitest und `prettier --check`. Verifiziert durch die grünen Läufe

## 6. Abschluss

- [ ] 6.1 Browser-Durchstich mit Vite und Backend: Stelle „NU Turnhalle Nord“ anlegen, Belegung 40 melden, bei einer Person „Verbleib erfassen“ → Notunterkunft → Stelle wählen → Ziel ist vorbelegt → erfassen. Die Personenseite zeigt „Notunterkunft → NU Turnhalle Nord“, die Betreuungsseite in einem zweiten Tab ohne Reload „40 belegt · davon namentlich 1“. Mit einem Benutzer ohne Modul Betreuung fehlt die Auswahl. Verifiziert durch Screenshots
- [ ] 6.2 Prüfliste Einsatztauglichkeit (15 Kriterien) für den umgebauten Verbleib-Dialog und die Stellenzelle, als Abschnitt in dieser `design.md` oder in einer eigenen Prüfliste. Jede Zeile trägt ein Verdikt. Verifiziert durch die ausgefüllte Liste
- [x] 6.3 CLAUDE.md: kurzer Absatz unter „Betreuung auf der Lagekarte“ bzw. „Verpflegung“ zur Personenverknüpfung (Kennung statt Name, „davon namentlich“ nie summiert, Zählung in der Route wegen des Lagestands). Verifiziert durch den Diff
- [ ] 6.4 `scripts/check-migrationen.sh` nach `git fetch` und `./scripts/check-all.sh`. Verifiziert durch den grünen Lauf, danach Review (`superpowers:requesting-code-review`) und PR gegen `alpha`
