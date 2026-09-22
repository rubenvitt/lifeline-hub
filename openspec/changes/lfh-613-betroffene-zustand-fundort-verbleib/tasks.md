# Tasks

## 1. Datenmodell und Migrationen

- [x] 1.1 Migration `…_person_lagedaten.sql`: sieben Spalten an `einsatz_person` und Backfill der Verbleib-Cache-Spalten aus dem jüngsten `person_verbleib` (Tiebreak `id DESC`), dazu `vermisst_seit` für Vermisste aus `geaendert_at`. Verifikation: Migrationstest gegen eine DB mit zwei Ereignissen je Person, eines davon in derselben Sekunde, prüft Art, Ziel und Status des jüngsten.
- [x] 1.2 Migration `…_person_verbleib_notunterkunft.sql` (`-- no-transaction`, Leaf-Rebuild, CHECK mit `notunterkunft`). Verifikation: Test über `include_str!` gegen eine synthetische Alt-Schema-DB, Zeilen und `sqlite_sequence` bleiben erhalten, das Schema-Diff per `pragma_table_info`/`index_list` zeigt nur den CHECK, `foreign_key_check` ist leer.
- [x] 1.3 Schwärzungs-Registry: `zustand`, `antreff_lat`, `antreff_lon` und `aktuelles_verbleib_ziel` werden gescrubbt, `aktuelle_verbleib_art`/`aktueller_verbleib_status` behalten `G_TRIAGE`, `vermisst_seit` behält `G_ZEIT`. Verifikation: der Registry-Vollständigkeitsguard ist grün, und ein Schwärzungstest prüft das Spec-Szenario „Geschwärzter Einsatz“.

## 2. Backend-Domäne und Routen

- [x] 2.1 `VerbleibArt::Notunterkunft` mit `as_str`/`parse`/`kurzform`/`etb_sachverhalt`, Nachtrag in `tests/enum_wire_kontrakt.rs`. Verifikation: Roundtrip-Unit-Test, und `cargo test --test enum_wire_kontrakt` ist grün.
- [x] 2.2 `PersonAnzeige` und `SELECT_ALLE` um die sieben Felder erweitern (`skip_serializing_if` für `Option`). Verifikation: der Detail- und Listentest liefert die Felder, und ein fehlender Key ist per `contains_key` geprüft.
- [x] 2.3 `verbleib_repo::erfassen` pflegt Art, Ziel und Status im Cache in derselben Transaktion. `notunterkunft` löst den UHS-Auto-Austritt aus. Verifikation: Integrationstests für die Spec-Szenarien „Verbleib Notunterkunft“, „Notunterkunft beendet den UHS-Aufenthalt“ und „Unbekannte Verbleib-Art“ (400).
- [x] 2.4 Anlege-POST: `zustand`, `antreff_lat/lon` (Paar- und Bereichsprüfung 422) und `vermisst_seit` (400/422 nach D4/D5) in `NeueDaten` und im INSERT. Verifikation: Integrationstests je Spec-Szenario, dazu ein Replay derselben `client_id`, bei dem `vermisst_seit` und die Koordinate unverändert bleiben und keine zweite Person entsteht.
- [x] 2.5 PATCH: `zustand`, `antreff_lat/lon` gegen den effektiven Zustand und `vermisst_seit` (nur bei vermisst, `null` ergibt 400) als Tri-State. Die Bindekette ist nummeriert. Verifikation: `aktualisiere_setzt_jede_spalte_an_ihren_platz` ist erweitert und grün, dazu Tests „Halbe Koordinate im PATCH gegen den Bestand“ und „Leeren ist nicht vorgesehen“.
- [x] 2.6 Der Statuswechsel nach `vermisst` setzt `vermisst_seit = now`. Verifikation: Integrationstest „Wechsel nach vermisst“, der Zeitpunkt liegt nach dem Wechsel und nicht bei der Anlage.
- [x] 2.7 Codegen mit `scripts/check-typ-codegen.sh`, danach `openapi.json`/`types.generated.ts` committen. Verifikation: das Skript endet mit Exit 0 ohne Diff.

## 3. Frontend-Grundlagen

- [x] 3.1 `api/einsatzPerson.ts` (`PersonAnlegenEingabe`, `PersonEingabe`, Verbleib-Art-Union mit `notunterkunft`) und die Offline-Queue-Typen nachziehen. Verifikation: `tsc` ist grün.
- [x] 3.2 Koordinaten-Parser als reine Funktion (`personen/koordinate.ts`: `parseKoordinate`, `formatKoordinate`), mit Punkt, Komma, Minus und Bereich. Verifikation: Unit-Tests einschließlich der Ablehnungsfälle.
- [x] 3.3 `personBefehl.ts`: der Teil `koordinate` ersetzt die `#`-Ablehnung, `eingabe` trägt `antreff_lat/lon`, und ein zweites `#` oder ein ungültiges `#` ist ein Problem. Verifikation: den bestehenden Test „schluckt #… nicht als Namen“ umschreiben, dazu das Spec-Szenario „Koordinate in der Schnellerfassung“ als Parser- und Zeilentest mit geprüftem POST-Body.
- [x] 3.4 `personenBilanz.ts` auf `aktuelle_verbleib_art` umstellen, `notunterkunft` wird ein Posten, die Fundort-Lücke schließt Freitext ODER Koordinate. Verifikation: Unit-Test für das Spec-Szenario „Zählung nach Art“, `verbleibArtAus` ist entfernt, und kein Test pinnt es mehr.

## 4. Frontend-Anzeige Betroffene

- [x] 4.1 Spalte „Zustand“ über `BemerkungZelle` mit PATCH und Wertgleichheits-Riegel, die Fundort-Spalte zeigt die Koordinate. Verifikation: `personenSpalten.test.tsx` mit umgeschriebenem „ohne Zustand“-Test, dazu ein Test für das Spec-Szenario „Zustand in der Liste bearbeiten“.
- [x] 4.2 Maske (`AufnahmeFelder`): „Zustand“ und „Koordinate“ unter „Weitere Angaben“, bei Status vermisst ein Feld „vermisst seit“. Das sichtbare Feldbudget bleibt unverändert. Verifikation: `AufnahmeFelder.test.tsx` zählt die sichtbaren Felder vor und nach dem Aufklappen (`forceRender`), und der POST-Body enthält die Felder.
- [x] 4.3 Detailseite: Zustand, Koordinate (Textfeld mit `parseKoordinate`) und „vermisst seit“ bearbeitbar, dazu die Aktion „Auf Lagekarte verorten“ als Deeplink. Verifikation: `PersonenDetailPage.test.tsx` für den PATCH-Body und den Link mit `?platzieren=person:<id>`.
- [x] 4.4 Seitenleiste „Verbleib“ und „Offene Felder“ lesen die neue Bilanz. Verifikation: Komponententest mit einem Notunterkunft-Posten.

## 5. Kartenansicht und Verorten

- [x] 5.1 `MarkerTyp` bekommt `person`, dazu `personen/personenKarte.ts` (`personenMarker`, Anzahl ohne Koordinate, Farbe aus der Sichtungsachse, Label `R-042 · SK II`). Verifikation: Unit-Test gegen das Spec-Szenario „Personen auf der Karte“ (2 Marker, 3 ohne Koordinate).
- [x] 5.2 `personen/BetroffeneKarte.tsx` mit `Kartenflaeche` + `useBasemap`, per `React.lazy` in die Segmentleiste „Karte“ von `PersonenPage`, Leerzustand und Hinweis „n ohne Koordinate“. Verifikation: `PersonenPage.test.tsx` mit gemocktem `Kartenflaeche`. Die Ansicht ist wählbar, die Marker werden übergeben, und der Markerklick navigiert zur Detailseite. Der bisherige Test „Karte gibt es nicht“ ist umgeschrieben.
- [x] 5.3 Platzier-Auftrag `person`: `PlatzierenZielTyp`/`PlatzierenPunktTyp` und ein `useKartenInteraktion`-Zweig rufen `aktualisierePerson` mit lat/lon. Verifikation: `deeplinks.test.ts` für den Roundtrip `person:<id>`, dazu der Test des Mutationszweigs.
- [x] 5.4 e2e `e2e/betroffene-karte.spec.ts`: eine Person mit Koordinate anlegen, Ansicht „Karte“, ein Marker ist über `window.__lfhKarte` vorhanden. Verifikation: `pnpm e2e` für diese Spec ist grün.

## 6. Lage-Dashboard

- [x] 6.1 Sichtungspaneel-Fuß „Transportiert / offen“ als reine Ableitung. Verifikation: Unit-Test für das Spec-Szenario (2 / 2 mit einer angemeldeten Person), der Test „fehlt (LFH-613)“ in `LageDashboardPage.test.tsx` ist umgeschrieben.
- [x] 6.2 Die Kennzahl „Vermisste“ bekommt die Notiz „n seit über 4 h“ aus `vermisst_seit` und dem Uhr-Takt. Verifikation: Unit-Test für das Spec-Szenario mit fester Uhr, dazu ein Test, dass die Notiz ohne neue Daten nach Ablauf der Schwelle erscheint.

## 7. Abschluss

- [x] 7.1 LFH-613-Verweise im Frontend-Kommentarbestand (`PersonenPage`, `personenSpalten`, `personBefehl`, `personenBilanz`, `LageDashboardPage`, `LagePaneele`) auf den neuen Stand bringen, und `umsetzung.md` fortschreiben. Verifikation: `rg "LFH-613" frontend/src` zeigt nur noch zutreffende Aussagen.
- [x] 7.2 Folgetask „Personen als Layer auf der Lagekarte“ über `clickup-task-anlegen` erfassen. Verifikation: der Task existiert im Entwicklungsboard.
- [ ] 7.3 Gesamt-Gate `./scripts/check-all.sh` (ohne `| tail`). `cargo test --no-default-features` entfällt, weil der Anhang-Code nicht berührt wird. Verifikation: Exit 0.
- [x] 7.4 Prüfliste Einsatztauglichkeit (15 Kriterien) für die umgebaute Betroffenen-Seite und die Kartenansicht ausfüllen, jede Zeile mit Verdikt. Verifikation: die Prüfliste liegt unter `docs/superpowers/specs/2026-09-22-lfh-613-pruefliste.md`.
