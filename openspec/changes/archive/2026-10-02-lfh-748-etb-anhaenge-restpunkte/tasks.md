# Tasks

## 1. Backend: fremde Anhänge sind beim Erfassen unbekannt (D1)

- [x] 1.1 Test zuerst in `tests/etb_anhang.rs`: Eine andere Person nennt einen von `admin` hochgeladenen und schon an einen ETB-Eintrag gebundenen Anhang. Erwartet werden 400 und derselbe `error`-Wortlaut wie für eine unbekannte ID, außerdem kein neuer Eintrag. Ein zweiter Fall prüft dasselbe für eine fremde Schaden-Datei (Modul-Linker). Nachweis: Der Test ist vor dem Fix rot (422).
- [x] 1.2 `src/etb/repo.rs:pruefe_anhaenge`: Jeden Anhang mit `hochgeladen_von != erfasser_id` auf „unbekannt“ abbilden und Doc-Kommentar samt Verweis auf LFH-748 nachziehen. Nachweis: Test 1.1 grün, `gebundener_anhang_ist_422`, `schaden_anhang_nicht_an_etb_verknuepfbar` und `fremder_ungebundener_upload_laesst_sich_nicht_binden` bleiben grün (`cargo test --test etb_anhang`).
- [x] 1.3 Mutationsprobe: Mit dem alten Match-Arm (`Some((false, von))`) wird Test 1.1 rot. Ergebnis im PR-Text vermerken.

## 2. Frontend: Entwurf mit Dateien bleibt gespeichert (D2)

- [x] 2.1 Test zuerst in `useEtbEntwuerfe.test.tsx`: `entwurfAktualisieren(id, leer, { festhalten: true })` speichert den geleerten Entwurf, ohne Option wird er wie bisher entfernt. Nachweis: Der Test ist vor dem Fix rot.
- [x] 2.2 `useEtbEntwuerfe.entwurfAktualisieren` um die Option `festhalten` erweitern und `EtbEntwurfsTabs` reicht sie, solange der Entwurf Dateien trägt. Nachweis: Test 2.1 grün.
- [x] 2.3 Integrationstest in `pages/EtbPage.test.tsx` (oder `EtbEntwurfsTabs.test.tsx` mit Remount): Datei wählen, Text tippen und ganz löschen, Reiter neu montieren (Berichtigen → Abbrechen). Danach steht die Datei weiter am Reiter. Nachweis: Der Test ist ohne 2.2 rot und mit 2.2 grün.

## 3. Frontend: Upload-Hinweis überlebt eine Berichtigung (D3)

- [x] 3.1 Test zuerst in `pages/EtbPage.test.tsx`: Upload scheitert, Berichtigen, Abbrechen. Danach steht der Hinweis mit dem Grund wieder an der Erfassung. Nachweis: Der Test ist vor dem Fix rot.
- [x] 3.2 Hook `etb/entwuerfe/useEntwurfsVersand.ts` (`je`, `aendern`, `umhaengen`) anlegen und `EtbEntwurfsTabs` nimmt ihn als optionales Prop `versand` mit eigenem Fallback. Der 409-Umzug schreibt über `umhaengen`. `EtbPage` führt den Hook und reicht ihn durch. Nachweis: Test 3.1 grün, die bestehenden Tests in `EtbEntwurfsTabs.test.tsx` (Tabwechsel während des Uploads, 409-Umzug) bleiben grün.

## 4. Frontend: offener Chip-Editor ist beim Senden gesperrt (D4)

- [x] 4.1 Test zuerst in `MetaChip.test.tsx`: Mit `editing` und `gesperrt` ist das Eingabefeld je Editorart (Text, Text mit Vorschlägen, Meldeweg, Zeit) `disabled`, und Enter ruft kein `onCommit`. Nachweis: Der Test ist vor dem Fix rot.
- [x] 4.2 `MetaChip` setzt `disabled` im Editor-Zweig, und `Schnellerfassung` reicht `gesperrt={sendet}` auch an den Editor für ein neues Feld. Nachweis: Test 4.1 grün.
- [x] 4.3 Test in `Schnellerfassung.anhaenge.test.tsx`: Editor „Von“ offen, „Erfassen“ mit hängendem Upload. Das Feld ist gesperrt, solange der Versand läuft, und nach einem Fehler wieder bedienbar, mit dem getippten Wert. Nachweis: grün mit 4.2, rot ohne.

## 5. Abschluss

- [x] 5.1 `./scripts/check-all.sh` grün (Frontend-Lint, Prettier, Vitest, Rust-Tests). Wo die Umgebung einen Schritt nicht ausführen kann, ist die CI des PRs der Nachweis. Lokal: rustfmt, Prettier, ESLint, `tsc`, Archiv-Gate grün; `cargo test --workspace --exclude lifeline-desktop` 3689/3689; Vitest 8782/8783 — rot nur `api/kartenbilder.test.ts` (`object.stream`, Node 22 statt der gepinnten 26.7, Datei unberührt). Gesamtnachweis: CI des PRs.
- [x] 5.2 Review (`requesting-code-review`), Findings abarbeiten, dann `/opsx:archive` im selben Branch und Verweise auf den Change-Pfad nachziehen.
