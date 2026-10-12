# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Pfade ohne Präfix sind im Frontend relativ zu `frontend/src/`, im Backend relativ zum
Wurzelverzeichnis des Repos. Zunder: https://zunder.rubeen.dev/#/aufgabe/kz5udbogri69301lwymcx5aa

## 1. Backend: Tabellen und Haken (D1)

- [x] 1.1 Nummer prüfen mit `git fetch origin alpha && scripts/check-migrationen.sh`. Dann
  `migrations/0183_dokument_verteiler.sql` mit `befehl_verteiler` und `lagebericht_verteiler`
  nach D1 anlegen (CHECKs, FKs, `UNIQUE(<art>_id, reihenfolge)`, Index auf `einsatz_id`,
  Kopfkommentar mit LLH-1172 und dieser Change). Nachweis: `scripts/check-migrationen.sh` meldet
  keinen Konflikt, und `db::tests::migrationsnummern_sind_eindeutig` ist grün.
- [x] 1.2 `VerteilerTabelle` und `const VERTEILER` an `Dokumentart` anlegen, Befehl und
  Lagebericht belegen ihn, die Pressemitteilung nicht. Nachweis: Der Repo-Test der `Fall`-Tabelle
  prüft die Belegung als Literal je Art.
- [x] 1.3 Schwärzung nach D6: `TABELLEN` in `src/einsatz/schwaerzung_registry.rs` um beide
  Tabellen ergänzen. Nachweis: Die Wächter `jede_einsatz_scoped_spalte_ist_klassifiziert`, Guard
  2–5 und `jeder_personenverweis_ist_als_bezug_deklariert` sind grün. Gegenprobe: Ohne die
  Regel wird Guard 1 rot.

## 2. Backend: Prüfung, Speichern, Laden (D2, D3)

- [x] 2.1 `validate_verteiler` in `src/auftrag/eingabe.rs` (`pub(crate)`, Zahl und Person/Fahrzeug
  vor der ersten Abfrage, dann `validiere_empfaenger_liste`), `snap_anzeige_fuer` aus
  `src/auftrag/repo.rs` `pub(crate)` (design.md D3). Nachweis: Die bestehenden
  Auftragstests (`tests/auftrag*.rs`, `tests/eingabegrenzen_auftrag.rs`) sind unverändert grün.
- [x] 2.2 `src/vorlagendokument/verteiler.rs`: `VerteilerEintrag`/`VerteilerEintragAnzeige`
  (`ToSchema`), `laden_tx`, `ersetzen_tx` (löschen und mit Snapshot und Reihenfolge einfügen),
  `kopieren_tx`, `render_abschnitt`. Nachweis: Repo-Tests je Art: Ersetzen bewahrt die
  Reihenfolge, leert bei leerer Liste und lässt einen Snapshot nach `DELETE` des Abschnitts
  stehen. Der Snapshot einer besetzten Funktion lautet „S3 Einsatz“ ohne Personennamen.
- [x] 2.3 `Dokument<A>` um `verteiler` erweitern, `laden` liest ihn bei gesetztem Haken.
  `BefehlAnzeige` und `LageberichtAnzeige` tragen `verteiler`, die Pressemitteilung nicht.
  Nachweis: Integrationstest „Neuer Befehl hat leeren Verteiler“. Ein Test belegt, dass die
  Anzeige einer Pressemitteilung kein Feld `verteiler` hat.
- [x] 2.4 PATCH nach D2: `PatchBody.verteiler`, Prüfung mit Typmenge abschnitt, einheit,
  funktion, extern und ohne Pflicht, alles in einem `write_retry!` (UPDATE mit Status-Guard,
  Ersetzen, Rücklesen). Eine Art ohne Haken antwortet bei gesetztem Feld mit 400. Nachweis: neue
  Datei `tests/dokument_verteiler.rs` mit `struct Art` für Befehl und Lagebericht (Muster
  `tests/dokument_anlage.rs`). Sie deckt jedes Szenario der Anforderungen „wird im Entwurf als
  Ganzes ersetzt“ und „Grenzen und Prüfung“ ab: Ersetzen, Feld fehlt, fremde Einheit → 400 und
  Titel unverändert, freigegeben → 422, 51 Einträge → 400, Doppelte zusammengeführt, Person →
  400, Bezeichnung mit 201 Zeichen → 400. Mutationsprobe: Ohne `verteiler::copy_tx` im
  Fortschreiben wird `fortschreiben_uebernimmt_den_verteiler_je_fassung` rot.
- [x] 2.5 Eingabegrenzen: `VERTEILER_MAX` und `VERTEILER_BEZEICHNUNG_MAX` als Alias in
  `src/vorlagendokument/verteiler.rs`, gespiegelt in `api/eingabegrenzen.ts` und
  `tests/eingabegrenzen_spiegel.rs`. Nachweis: Der Spiegeltest ist grün.

## 3. Backend: Freigabe, ETB, Fortschreiben (D4, D5)

- [x] 3.1 `freigeben_tx`: Verteiler-Abschnitt nach den Anlagen, `an` = `kappe_an(namen)` oder
  `None`. Nachweis: In `tests/dokument_verteiler.rs` sind `an` und Wortlaut mit Verteiler belegt,
  ebenso der lange Verteiler (≤ 500 Zeichen, „… und N weitere“, der Wortlaut nennt alle). Der
  byte-genaue Test `tests/befehl.rs` (ohne Verteiler) bleibt unverändert grün, und `an` lautet
  dort „System“.
- [x] 3.2 `AUSNAHMEN_SYSTEM_ETB` in `tests/aufbewahrung_e2e.rs` um die drei Spalten je Art für
  `freigeben_tx` ergänzen (D6). Nachweis: `cargo test --test aufbewahrung_e2e` ist grün, und
  die Einträge stehen im Diff.
- [x] 3.3 `fortschreiben_tx` ruft `verteiler::copy_tx`. Nachweis: Ein Test belegt, dass
  Fassung 2 den Verteiler trägt und dass Leeren in Fassung 2 Fassung 1 unverändert lässt.
- [x] 3.4 Schwärzungs-Ende-zu-Ende: Ein Einsatz mit Befehl, dessen Verteiler „ILS Musterstadt“
  nennt, wird geschwärzt. Nachweis: Kein Feld der Verteiler-Zeilen enthält den Text danach (Test
  im bestehenden Schwärzungstest-Muster).
- [x] 3.5 Demo-Import unverändert: `src/demo/import_tests.rs` und der Demo-Test „jedes ETB hat
  Von/An“ bleiben grün. Nachweis: `cargo test demo` ist grün.
- [x] 3.6 Typ-Codegen: `scripts/check-typ-codegen.sh`, dazu `openapi.json` und
  `types.generated.ts` committen. `BefehlPatch` in `api/befehle.ts` und den Lagebericht-Patch in
  `api/lageberichte.ts` um `verteiler?: NeuerEmpfaenger[]` ergänzen. Nachweis: Das Skript ist
  grün.

## 4. Frontend: Empfängerwahl herauslösen (D7)

- [x] 4.1 `fuehrung/empfaengerKern.ts`: Kodierung, `baueEmpfaenger` und `toEmpfaengerTags` aus
  `auftraege/auftragFormularKern.ts` und `auftragBerichtigungKern.ts` herauslösen. Die alten
  Stellen importieren von dort. Nachweis: Ein neuer Kern-Test geht hin und zurück für Abschnitt,
  Einheit, Katalogfunktion mit Bezeichnung und Freitext. `auftragFormularKern`- und
  `auftragBerichtigungKern`-Tests bleiben grün.
- [x] 4.2 `fuehrung/EmpfaengerWahl.tsx` (kontrollierter Tags-Select, drei Gruppen, eigener
  Such-State, Blur übernimmt keinen getippten Text). Nachweis: Komponententest „Blur nach Tippen
  erzeugt keinen Tag“, „Besetzung im Vorschlag, Wert ohne Namen“.
- [x] 4.3 `AuftragFormular.tsx` auf `EmpfaengerWahl` umstellen. Nachweis:
  `AuftragFormular.test.tsx` ist ohne inhaltliche Änderung grün (Mock von
  `useFunktionsVorschlaege` gilt weiter).
- [x] 4.4 `fuehrung/ExterneEmpfaenger.tsx` (Zeilen aus Kategorie und Bezeichnung, Vorschläge
  aus `externeStellenVorschlaege`, Hinzufügen und Entfernen, Grenze 200 aus `eingabegrenzen.ts`
  mit Zählanzeige). Nachweis: Komponententest „Vorschlag übernehmen“, „Überlänge sperrt“,
  „Zeile entfernen“.

## 5. Frontend: Befehl und Lagebericht (D7)

- [x] 5.1 `pages/BefehlDetailPage.tsx`: Feld „Verteiler“ im Entwurf (`befehl-no-print`), Formtyp
  erweitern, `werteAus`/`speichern` mit Verteiler, Abschnitte und Einheiten laden. Nachweis:
  `BefehlDetailPage.test.tsx` belegt „wählen und speichern sendet `verteiler` im PATCH“ und
  „Neuladen zeigt die Einträge“, und der Verlustschutz-Test markiert eine Verteiler-Änderung als
  ungespeichert.
- [x] 5.2 Druckkopf und Lesefassung Befehl: Zeile „Verteiler“ im `Druckkopf` aus
  `useWatch('verteiler')` (Entwurf) bzw. `snap_anzeige` (freigegeben), leer ohne Zeile. Dazu ein
  `Datenfeld` im freigegebenen Zweig der Vollseite (`VerteilerAnzeige` neben der
  Lesefassung) und eine Zeile in `auftraege/BefehlDetail.tsx`. Nachweis: Tests „Druck eines Entwurfs mit ungespeichertem
  Verteiler“, „leerer Verteiler ohne Zeile“, „Detail nennt Verteiler“. Ein DOM-Test belegt,
  dass das Auswahlfeld `befehl-no-print` trägt.
- [x] 5.3 Wächtertest: Keine Vorlage in `befehle/vorlagen.ts` und den Lagebericht-Vorlagen trägt
  den Schlüssel `verteiler`. Nachweis: Der Test ist grün, und mit einem Testschlüssel
  `verteiler` wird er rot.
- [x] 5.4 `lageberichte/LageberichtDetailPage.tsx`: Feld, Druckkopf und Lesefassung wie 5.1 und
  5.2. Nachweis: Die entsprechenden Fälle in `LageberichtDetailPage.test.tsx` sind grün.
- [x] 5.5 e2e: In `e2e/druck-fluss.spec.ts` bekommt der Befehlsentwurf einen Verteiler, und der
  Ausdruck nennt ihn ohne Auswahlfeld. Nachweis: Die Spec ist in Chromium grün.

## 6. Doku

- [x] 6.1 `docs/anwender/kapitel/auftraege-befehle.md`: Absatz „Verteiler“ im Entwurfsablauf
  (wählen, externe Stellen, Druck, ETB, Fortschreiben). `quellen:` um die neuen Dateien
  ergänzen, `e2e/doku-bilder/auftraege-befehle.bilder.ts` füllt den Verteiler, und
  `befehl-entwurf.png` wird hell und dunkel neu erzeugt (`pnpm doku:bilder --grep
  auftraege-befehle`). Nachweis: `hilfe/anwenderdoku.guard.test.ts` ist grün, und das Bild zeigt
  den gefüllten Verteiler.
- [x] 6.2 `docs/anwender/kapitel/lageberichte.md` entsprechend, samt Bild des Entwurfs aus
  `lageberichte.bilder.ts`. Nachweis wie 6.1.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` ist grün (bei fehlender lokaler Werkzeugkette: Nachweis durch
  den CI-Lauf des PRs). Nachweis: Ausgabe bzw. CI-Lauf.

## Workflow follow-up

- `/opsx:archive kz5udbog-verteiler-vorlagendokument` im selben Branch vor dem PR (Spec-Sync nach
  `openspec/specs/dokument-verteiler/`).
- PR gegen `alpha` mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/kz5udbogri69301lwymcx5aa`.
