# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der Code.
Vor jedem „fertig“ gelten `verification-before-completion` und `requesting-code-review`.

## 1. Datenmodell und Schwärzung

- [x] 1.1 Migration `0129_presse.sql` anlegen (D3):
  - Tabellen `medienkontakt`, `pressemitteilung` und `infotelefon_anruf` samt CHECKs und Indizes
  - `etb_eintrag.pressemitteilung_id`
  
  Prüfen: `scripts/check-migrationen.sh` gegen `origin/alpha` ist grün, und
  `db::tests::migrationsnummern_sind_eindeutig` ist grün.
- [x] 1.2 Regeln für die drei Tabellen und die neue ETB-Spalte in
  `src/einsatz/schwaerzung_registry.rs` eintragen (D9). Prüfen: Die Guards
  `jede_einsatz_scoped_spalte_ist_klassifiziert`, `entdeckte_tabellen_gleich_registry_tabellen` und
  `fremde_fk_auf_scoped` sind grün.
- [x] 1.3 Schwärzungstests für `medienkontakt` und `infotelefon_anruf` in
  `src/einsatz/purge_scheduler.rs` schreiben. Sie decken ab:
  - Kontaktdaten und Anrufdaten sind leer.
  - Medium, Antwort und Anliegen stehen noch da.
  - Ein offener Anruf lässt sich schwärzen (CHECK-Frage aus D9 klären und den Nachtrag im Design
    schreiben).
  
  Prüfen: Die Tests sind grün, und die Mutationsprobe (Scrub-Regel entfernt → rot) ist belegt.

## 2. Backend Presse-Log

- [x] 2.1 `src/presse/` anlegen: Typen, Enums (Art, Status) mit `wire_enum` und Repo `anlegen_tx`,
  `liste`, `patch_tx` und `status_tx`, mit der Art/Status-Prüfung als 422. Prüfen: Repo-Tests zu
  jedem erlaubten und verbotenen Übergang sowie zu Rücknahme mit stehender Antwort sind grün.
- [x] 2.2 Routen `…/stab/medienkontakte` in `src/routes/presse.rs` bauen (D2): `JsonBody`,
  `PfadParam`, `EinsatzLese-/Schreibzugriff<Stab>`, `write_retry!`, `LiveEvent::Presse`.
  Registrierung in `app.rs`. Prüfen: `tests/stab_presse.rs` deckt ab:
  - 400: leeres Thema, unbekannte Art
  - 422: `beantwortet` ohne Antwort, Termin → `beantwortet`, Bezug auf einen Entwurf
  - 404: fremder Einsatz
  - 403: Beobachtung schreibt
  - Modulsperre
  - abgeschlossener Einsatz schreibgeschützt
  
  Dazu sind `json_extractor_guard`, `path_extractor_guard` und der `PFAD_KEY`-Guard grün.
- [x] 2.3 `LiveEvent::Presse` und `LiveEvent::Infotelefon` in `src/live/mod.rs` eintragen
  (`modul_keys` → `stab`) und in `tests/enum_wire_kontrakt.rs` pinnen. Die neuen Enums laufen
  durch `jedes_toschema_enum_ist_gepinnt`. Prüfen: `cargo test --test enum_wire_kontrakt` ist grün.

## 3. Backend Pressemitteilung

- [x] 3.1 Die Freigabe der Pressemitteilung über das Gate `EinsatzLeitungszugriff<Stab>` an der
  Route regeln (D4, Nachtrag); den Kern um `NOMEN_MIT_ARTIKEL`/`IM_NOMEN` für das Genus erweitern.
  Prüfen: Die Paar-Tests sind grün (Führungspersonal gibt Lagebericht und Befehl frei), und die
  bestehenden Tests `tests/lagebericht*.rs` und `tests/befehl*.rs` sind unverändert grün.
- [x] 3.2 `Dokumentart` für die Pressemitteilung umsetzen: vier Vorlagen, `ETB_TYP = meldung`,
  `ETB_VERWEIS = pressemitteilung_id`, `DokumentRoute` mit `MODUL_KEY = stab` und
  `FREIGABE = Einsatzleitung`. Die Routen `…/stab/pressemitteilungen` reichen an den Kern durch.
  Prüfen: `tests/stab_pressemitteilung.rs` deckt ab:
  - Anlegen mit Vorlage
  - 400 bei unbekannter Vorlage und unbekanntem Schlüssel
  - PATCH eines freigegebenen Dokuments → 422
  - Freigabe durch die Einsatzleitung schreibt den ETB-Eintrag `meldung` mit Verweis
  - Führungspersonal → 403
  - leere Mitteilung → 422
  - Fortschreiben → Version 2
  - fremder Einsatz → 404
- [x] 3.3 Response-DTOs in `src/api_doc.rs` aufnehmen und `scripts/check-typ-codegen.sh`
  ausführen. `openapi.json` und `types.generated.ts` gehen mit in den Commit. Prüfen: Schritt 3
  von `check-all.sh` ist grün.

## 4. Backend Informationstelefon

- [x] 4.1 `src/infotelefon/` anlegen: Enum Anliegen (sieben Werte), Status, Repo `anlegen_tx`
  (Status aus „Rückruf nötig“, 422 ohne Nummer), `liste` (Eingang absteigend) und `status_tx`
  (erledigen/öffnen mit Person und Zeit). Prüfen: Die Repo-Tests sind grün.
- [x] 4.2 Routen `…/stab/infotelefon` in `src/routes/infotelefon.rs` bauen, mit
  `LiveEvent::Infotelefon`. Prüfen: `tests/stab_infotelefon.rs` deckt ab: 400 bei unbekanntem
  Anliegen, 422 bei Rückruf ohne Nummer, 404 bei fremdem Einsatz, 403 für die Beobachtung,
  Modulsperre, abgeschlossenen Einsatz. `api_doc.rs` und Codegen wie in 3.3.

## 5. Frontend-Grundlage

- [x] 5.1 API-Module `api/presse.ts` und `api/infotelefon.ts` anlegen. Die Query-Keys
  `medienkontakte`, `pressemitteilungen`, `pressemitteilung(id)` und `infotelefon` kommen in
  `EINSATZ_KEYS` und `EINSATZ_STREAM_EVENTS`. Die Prefixe stehen ausdrücklich außerhalb von
  `LAGEBILD_OFFLINE` (D8). Prüfen: `queryKeys.test.ts`, `queryKeys.guard.test.ts` und
  `lagebildOffline.guard.test.ts` sind grün, und `globalKeys.test.ts` ist unverändert.
- [x] 5.2 Deeplink-Bauer `pressePfad`, `pressemitteilungPfad` und `infotelefonPfad` mit Parsern für
  `?kontakt=` und `?anruf=` in `routing/deeplinks.ts` anlegen. Prüfen: Die Unit-Tests mit
  Round-Trip sind grün.
- [x] 5.3 Hook `useStabFreigabe()` aus `FunkplanPage` herausziehen (fail-closed, Fehler mit
  Wiederholen) und im Funkplan einsetzen. Prüfen: Die bestehenden Funkplan-Tests sind grün, und der
  neue Hook-Test deckt Laden, Fehler, gesperrt und frei ab.
- [x] 5.4 Statuskarten `medienkontaktStatus`, `infotelefonStatus` und `pressemitteilungStatus` in
  `theme/statusFarben.ts` anlegen (D6). Prüfen: `ALLE_MAPS` steigt von 26 auf 29, und
  `statusVertrag.guard.test.ts` ist grün. Den Stand in `frontend/AGENTS.md` nachziehen (vormals CLAUDE.md).
- [x] 5.5 Die S5-Zeile bekommt die Verweise „Pressearbeit“ und „Informationstelefon“ über die
  Tabelle `unterseiten` je Sachgebiet (D1). S6 zieht auf dieselbe Tabelle um. Die Routen gehen in
  `App.tsx`. Prüfen: Die Tests in `StabPage.test.tsx` belegen beide Verweise mit Ziel, dass S6
  unverändert ist und dass `modulAusPfad` den Stab markiert.

## 6. Frontend Presseseite und Pressemitteilung

- [x] 6.1 `PressePage` mit `EinsatzSeite` bauen:
  - Primäraktion „Neue Pressemitteilung“
  - sekundär „Medienkontakt erfassen“
  - Paneele Medienlage, Pressemitteilungen, Presse-Log
  - `RechteHinweis`
  
  Prüfen: Die Tests zu Stab gesperrt → Sackgasse, Beobachtung liest mit gesperrter Erfassung und
  `?kontakt=` rollt zur Zeile sind grün.
- [x] 6.2 Presse-Log als `Datensicht form="karte"` bauen, mit `StatusWahl` am Status-Slot,
  Segmentleiste „alle/offen“, Kennzahl „offene Anfragen“, Erfassung als `ErfassungsModal` mit
  Serie (drei sichtbare Felder) und „Beantworten“ als `ErfassungsModal`. Prüfen:
  - Feldbudget mit `forceRender` und Gegenprobe
  - Enter sendet
  - Rücknahme ohne Rückfrage, mit Rückgängig-Toast
  - Speicherfehler an der Seite
- [x] 6.3 Die Pressemitteilungsliste als Kettenköpfe bauen (Kettenmuster aus
  `lageberichte/ketten.ts` teilen, nicht kopieren). Prüfen: Die Tests zu Ketten und Zyklen
  bleiben grün, und ein neuer Test belegt die Mitteilungsliste.
- [x] 6.4 `PressemitteilungDetailPage` mit `key={mitteilungId}` bauen: Akkordeon, Verlustschutz,
  Autosave, `FreigabeDialog` und Druckwurzel samt `Druckkopf`. Wo die Lageberichtseite Teile hart
  verdrahtet hat, per Prop hereinreichen (D4). Prüfen:
  - Freigabe ohne `darfEinsatzLeiten` gesperrt, mit Grund
  - Freigabe durch die Einsatzleitung
  - „Entwurf speichern“ ist EIN PATCH
  - Druck eines Entwurfs mit Kennzeichnung
  - Die bestehenden Lagebericht-Tests sind unverändert grün.

## 7. Frontend Informationstelefon

- [x] 7.1 `InfotelefonPage` als Zeitachse bauen:
  - Kennzahlen Anrufe und offene Rückrufe, `Aufgliederung` nach Anliegen
  - Segmentleiste „alle/offene Rückrufe“
  - Erledigen/Öffnen über `StatusWahl`
  - Sprung „Vermisste ↗“ nur mit Freigabe des Moduls Personen
  - `?anruf=`
  
  Prüfen: Die Tests zu Kennzahlen aus derselben Menge (keine Zahl ohne Daten), fehlendem Sprung
  bei gesperrten Personen und Filter „offene Rückrufe“ sind grün.
- [x] 7.2 Die Schnellerfassung als `fuss` von `EinsatzSeite` bauen, mit
  `Schnellerfassungszeile`, Hinweiszeile, eingeklappten Feldern, „Rückruf nötig“ und sichtbarer
  Pflicht-Rückrufnummer. Prüfen:
  - Serie mit Enter, Fokus nach dem Speichern im Feld Anliegen
  - „Werte behalten“ steht auf AUS
  - Die Rückrufnummer liegt nie hinter der Einklappung, wenn sie Pflicht ist.
  - Die Erfassung hat unter `md` eine eigene Zeile.

## 8. Medienlage und Lagebericht

- [x] 8.1 `stab/medienlage.ts` mit `baueMedienlage` und `rendereMedienlageMarkdown` schreiben
  (D7). Prüfen: Die Unit-Tests pinnen die Abwesenheit von Namen, Nummern, Notizen und Themen und
  zeigen „—“ mit Grund für jede nicht geladene Quelle. Die Mutationsprobe (Name ins Markdown →
  rot) ist belegt.
- [x] 8.2 Den Abschnitt `medienlage` vor `zusammenfassung` in `src/lagebericht/mod.rs` und
  `frontend/src/lageberichte/vorlagen.ts` einfügen. Prüfen:
  - `vorlagen_haben_erwartete_abschnittszahl` erwartet 8.
  - Ein alter Entwurf ohne den Schlüssel lässt sich per PATCH speichern.
  - Der Snapshot ohne Medienlage enthält keine Überschrift „Medienlage“.
  - Der Paartest der Vorlagen im Frontend ist grün.
- [x] 8.3 „Aus S5 übernehmen“ als `zusatz` des Abschnitts im `AbschnittsAkkordeon` bauen, mit
  Abruf per `fetchQuery` beim Klick und `<Modal>`-Rückfrage bei gefülltem Abschnitt. Prüfen:
  - Der Knopf fehlt ohne Stab-Freigabe.
  - Übernahme in einen leeren Abschnitt ohne Rückfrage.
  - Ersetzen erst nach Bestätigung.
  - Der Render-Zähler-Test des Akkordeons bleibt grün.
- [x] 8.4 Das Paneel Medienlage auf der Presseseite bauen, aus derselben Ableitung. Prüfen: Der
  Test belegt dieselben Zahlen wie in Presse-Log und Informationstelefon.

## 9. Nachweise und Abschluss

- [x] 9.1 Die drei Routen in `e2e/gate1-ueberlauf.spec.ts` (1366/1024/768/390 px) und
  `e2e/gate3-trefflaeche.spec.ts` aufnehmen, jeweils als Admin und als Beobachtung
  (`e2e/rollen-kern.ts`, Rollenzweig als Vorbedingung). Den Druckfluss der Pressemitteilung mit
  ausgelöstem `beforeprint` in `e2e/druck-fluss.spec.ts` prüfen. Prüfen: `pnpm e2e` für diese
  Specs ist grün.
- [x] 9.2 Die Prüfliste Einsatztauglichkeit (15 Kriterien) als `pruefliste.md` in dieser Change
  anlegen, mit einem Verdikt je Seite und Kriterium (erfüllt / offen → Zielticket / nicht
  anwendbar). Prüfen: Keine Zeile steht auf „nicht geprüft“.
- [x] 9.3 Folgetickets auf dem Entwicklungsboard anlegen: serverseitige Zählung des
  Informationstelefons und Mandanten-Labels für S5. Außerdem die S5-Beobachtung in LFH-852
  ergänzen. Prüfen: Die Tickets sind verlinkt und im Design-Nachtrag genannt.
- [x] 9.4 `frontend/src/stab/AGENTS.md` fortschreiben (vormals CLAUDE.md; `ALLE_MAPS` steht in
  `frontend/AGENTS.md`): ein Absatz „Presse und Medienarbeit S5“ mit Ort, Freigaberegel,
  Datenschutz und Offline-Entscheidung, dazu `ALLE_MAPS` = 29. Prüfen: Der Abschnitt nennt die
  Change und den Archivpfad.
- [x] 9.5 `./scripts/check-all.sh` vollständig grün ausführen, danach `/opsx:archive` im selben
  Branch (Spec-Sync, Verweise auf den Archivpfad nachziehen). Prüfen: Der Gesamtstatus aller
  Schritte ist grün, und `check-openspec-archiv.sh` meldet keine abgehakte aktive Change.
  _Stand 30.09.2026:_ lokal grün sind Bündel `schnell` und Rust (3418). Vitest ist bis auf
  Umgebungsfälle grün, die auf `alpha` ebenso rot sind; e2e ist gezielt gelaufen. Den vollen
  Lauf belegt die CI auf dem PR-Head (`ci.yml` ruft `check-all.sh`).
