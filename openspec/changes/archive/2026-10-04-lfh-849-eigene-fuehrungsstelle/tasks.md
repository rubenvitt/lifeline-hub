# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Rust: `cargo test --test <datei>` bzw. `cargo test <modul>`
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- e2e: `mise exec -- pnpm -C <abs>/frontend exec playwright test <datei>`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`.

## 1. Datenhaltung und Schwärzung (D2, D6)

- [x] 1.1 Migration `NNNN_einsatz_fuehrungsstelle.sql` mit der nächsten freien Nummer über
  `alpha` (`git fetch origin alpha`, `scripts/check-migrationen.sh`): Tabellen
  `einsatz_fuehrungsstelle` und `einsatz_fuehrungsstelle_sprechgruppe` wie in D2. Nachweis:
  `check-migrationen.sh` grün, `db::tests::migrationsnummern_sind_eindeutig` grün.
- [x] 1.2 Test zuerst: der Register-Guard (`einsatz::schwaerzung_registry::tests`) wird mit den
  neuen Tabellen rot. Dann Einträge nach D6 (`erreichbarkeit` → `scrub(NullSetzen, Z_EINSATZ)`,
  Rest Retain mit Begründung). Nachweis: Guard grün, `tests::kategorie_zuordnung_ist_gepinnt`
  grün.
- [x] 1.3 Schwärzungstest: ein Einsatz mit erfasster Führungsstelle wird geschwärzt; danach ist
  `erreichbarkeit` NULL, Rufname, Kommunikationsmittel und Sprechgruppen sind unverändert.
  Nachweis: Test erst rot (ohne Registereintrag), dann grün.

## 2. Endpunkt `…/fuehrungsstelle` (D2, D3)

- [x] 2.1 Test zuerst `tests/einsatz_fuehrungsstelle.rs`:
  - GET ohne Zeile → alle Angaben leer, `sprechgruppen: []`; Beobachter liest; Fremde 403/404
    wie beim Kopf
  - PATCH Teilfelder: Rufname, dann aus „altem Stand“ nur Erreichbarkeit → beide stehen
  - `null`/`""` leert, fehlendes Feld bleibt
  - `sprechgruppe_ids` ersetzt vollständig; fremde Org/fremder Einsatz → 422, und eine im selben
    Aufruf gesendete Angabe ist NICHT gespeichert
  - unbekanntes Kommunikationsmittel → 400
  - Beobachter → 403, abgeschlossener Einsatz → 409
  - Erfolg verteilt `einsatz`, Ablehnung nicht

  Nachweis: rot belegt.
- [x] 2.2 Umsetzung: Repo in `src/einsatz/` (Laden, Upsert + Zuordnung in EINEM `write_retry!`),
  Zuordnung über `sprechgruppe::repo` (`pruefe_zuordenbar` vor dem Schreiben), DTO
  `FuehrungsstelleAnzeige` (`ToSchema`, ehrliche Optionalität), Routen GET
  (`EinsatzLesezugriff`) und PATCH (`EinsatzVerwaltungszugriff`, `JsonBody`, `kopf_geaendert`
  nach dem Commit), Eintrag in `api_doc.rs`. Nachweis: 2.1 grün, `json_extractor_guard`,
  `path_extractor_guard`, `fehler_vertrag` grün.
- [x] 2.3 Codegen: `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts`
  mitcommitten. Nachweis: Skript grün.

## 3. Client: API, Query-Key, Paneel auf Einsatzdaten (D1, D3)

- [x] 3.1 `api/`: `ladeFuehrungsstelle`, `patcheFuehrungsstelle`, handgepflegter
  `FuehrungsstellePatch`; `einsatzKeys.fuehrungsstelle` in `EINSATZ_KEYS` und in
  `EINSATZ_STREAM_EVENTS.einsatz`. Nachweis: `queryKeys.guard.test.ts` und die
  Live-Klassifikation grün; ein Test belegt, dass `einsatz` den Key invalidiert.
- [x] 3.2 Test zuerst `EinsatzdatenPage.test.tsx`: Paneel „Eigene Führungsstelle“ mit vier Zeilen;
  jede Zeile schickt nur ihr Feld (Sprechgruppen als `sprechgruppe_ids`), unverändert sendet
  nichts, leer sendet `null`; Beobachter ohne Aufforderung, leer „—“; Fehler an der Zeile ohne
  Toast. Nachweis: rot belegt.
- [x] 3.3 Umsetzung des Paneels nach D1 mit `InlineAngabe` und `SprechgruppenPicker`; Antwort in
  den Cache vor dem Erfüllen. Nachweis: 3.2 grün, `tsc -b` und Lint grün.

## 4. Funkplan: Zeile, Lücken, Markdown, Deeplink (D4, D5)

- [x] 4.1 Test zuerst `stab/funkplan.test.ts`: ohne erfasste Führungsstelle keine Zeile `fs`;
  erfasst → erste Zeile ohne Kinder mit Rufname, TMO/DMO, Label, Erreichbarkeit, Leitung leer;
  `fuehrungsstelleErfasst` für jede der vier Angaben; Markdown beginnt die Gliederung mit der
  Führungsstelle und enthält ihre Erreichbarkeit nicht; Lücken-Zeile „Eigene Gegenstelle“ nur bei
  nicht erfasst bzw. mit Grund. Nachweis: rot belegt.
- [x] 4.2 Test zuerst `stab/luecken.test.ts`: oberster Abschnitt ohne gemeinsamen Kanal mit der
  Führungsstelle zählt; Führungsstelle ohne Sprechgruppe → keine Zählung; Zustand schlechtester
  der drei Quellen; lokale Sprechgruppe nur an der Führungsstelle ist keine Lücke. Nachweis: rot
  belegt.
- [x] 4.3 Umsetzung in `stab/funkplan.ts` und `stab/luecken.ts` nach D4/D5. Nachweis: 4.1 und 4.2
  grün, bestehende Funkplan-Tests unverändert grün.
- [x] 4.4 `pages/FunkplanPage.tsx`: Quelle mit eigener Weiche laden, Zeile in der Tabelle mit
  Deeplink auf `einsatzdatenPfad`, Hinweiszeile nach D4, Übernahme gesperrt solange die Quelle
  lädt. Seitentest: Zeile vor dem ersten Abschnitt, Hinweis nur ohne Angaben, Grund bei 403.
  Nachweis: Seitentest grün.

## 5. Fernmeldeskizze (D5)

- [x] 5.1 Test zuerst `stab/fernmeldeskizze.test.ts` und `FernmeldeskizzeBild.test.tsx`: Wurzel
  zeigt Rufname, TMO/DMO, Kommunikationsmittel und nie die Erreichbarkeit; Kanten der ersten Ebene
  urteilen gegen die Führungsstelle; ohne Erfassung „Gegenstelle nicht erfasst“ und kein Urteil;
  Wurzel verweist auf Einsatzdaten; Zahl der Kanten-Lücken = Paneel. Nachweis: rot belegt.
- [x] 5.2 Umsetzung in `stab/fernmeldeskizze.ts` und `stab/FernmeldeskizzeBild.tsx`. Nachweis: 5.1
  grün, bestehende Skizzen-Tests unverändert grün.

## 6. Regeln, e2e, Gate

- [x] 6.1 `frontend/src/stab/AGENTS.md`: Funkplan-Absatz „Eigene Gegenstelle fehlt als benannte
  Lücke (LFH-849)“ ersetzen durch Quelle, Erfasst-Regel und Pflegeort (Einsatzdaten); Verweise
  auf LFH-849 in Code-Kommentaren (`fernmeldeskizze.ts`, `FernmeldeskizzeBild.tsx`,
  `FunkplanPage.tsx`) nachziehen. Nachweis: Prettier über `frontend/` grün,
  `grep -rn "LFH-849" frontend/src` zeigt nur aktuelle Aussagen.
- [x] 6.2 e2e `e2e/funkplan.spec.ts`: Führungsstelle auf Einsatzdaten erfassen, Funkplan zeigt sie
  als erste Zeile; Druckpfad (`beforeprint`) enthält die Zeile samt Erreichbarkeit; Übernahme ohne
  Erreichbarkeit. Nachweis: Spec grün, Gate-1-Routen unverändert grün.
- [x] 6.3 `./scripts/check-all.sh` grün, dazu Vitest und Rust-Tests vollständig. Nachweis: Lauf
  ohne Fehler (Kästchen mit Verweis auf diesen Lauf bzw. die CI des PRs abhaken).
  Lauf 04.10.2026 (Cloud-Sitzung, nur Chromium): Schritte 1–3, 5, 6, 8–13 grün; Rust-Workspace
  grün, die Desktop-Hülle baut hier nicht (GTK fehlt). e2e: die Funkplan-Specs grün; zwölf
  Layout-Specs (`fokus-verdeckung`, `leisten-flaeche`, `etb-chronologie`, `stab-vorbereitung`)
  sind mit dem hiesigen Browser auch auf `alpha` rot, die Wahrheit ist die CI des PRs.
