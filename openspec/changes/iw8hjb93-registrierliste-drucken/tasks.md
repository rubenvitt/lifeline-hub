# Tasks

Jede Aufgabe entsteht per TDD (erst der rote Test). Zunder: LLH-1616,
`https://zunder.rubeen.dev/#/aufgabe/iw8hjb93d4wnw3dcrh7kxat7`.

## 1. Server: protokollierter Druckabruf

- [x] 1.1 `registrierung::liste` über einen Executor lesbar machen (Pool und Transaktion) und `audit_repo::anlegen_tx` ergänzen; bestehende Tests in `tests/betreuung_registrierung.rs` bleiben grün
- [x] 1.2 Handler `druck` in `routes/betreuung_registrierung.rs` und Route in `src/app.rs` (D1/D2/D3): Prüfkette 403 → 404, Transaktion mit je Person einem `druck`-Eintrag, Unverträglichkeiten nur mit `?unvertraeglichkeiten=1`; Tests in `tests/betreuung_registrierung.rs`: Einträge je Person (keine für fremde Stellen), Neu laden doppelt, leere Stelle ohne Eintrag, ohne Personenrecht 403 ohne Eintrag, ohne Parameter kein Feld `unvertraeglichkeiten`, mit Parameter vorhanden
- [x] 1.3 Gerät (D5): Route in die Routenliste der Betreuungsstelle in `src/geraet/mod.rs`, Tests in `tests/geraet_kopplung.rs` (eigene Stelle 200 mit Eintrag des Gerätekontos, fremde Stelle 403 ohne Eintrag, UHS-Gerät 403); Modultests in `src/geraet/mod.rs` grün
- [x] 1.4 `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten (neuer Pfad in OpenAPI); `cargo test` der berührten Testdateien grün

## 2. Oberfläche: Druckansicht und Blatt

- [x] 2.1 API-Funktion `loadRegistrierlisteDruck` (`api/betreuungRegistrierung.ts`), nicht-live Key `registrierlisteDruck` in `api/queryKeys.ts` (nicht im Offline-Lagebild), Pfade `registrierlisteDruckPfad` (Stab) und Gerätepfad in `routing/deeplinks.ts` sowie `EinsatzPfade.registrierlisteDruck`; Unit-Tests der Pfade und der Key-Einordnung grün
- [x] 2.2 Blatt `RegistrierlisteBlatt.tsx` (D4): Summentabelle aus `kostformBand`, je Haushalt ein nicht brechender Zeilenblock mit Abhakspalte, Block „ohne Haushalt“, Spalte Unverträglichkeiten nur mit Wahl; Vitest `RegistrierlisteBlatt.test.tsx` für Summen, Gruppen, leere Abhakspalte und die Spalte nur auf Wunsch
- [x] 2.3 Seite `RegistrierlisteDruckSeite.tsx` mit Schalter in der Adresse, Protokollhinweis, Zuständen (laden, Fehler, 403, 404, leer ohne Druckknopf), Druckkopf mit Stand, Umfang und „Gesundheitsangaben: mit“; Vitest für Zustände und Schalter → neuer Abruf
- [x] 2.4 Routen in `App.tsx` (Stab unter dem Segment `betreuung`, Gerät im `GeraetBetreuungRahmen`), `geraetDarf('registrierliste-druck')` nur für die Betreuungsstelle; Tests `geraetSicht.test.ts` grün
- [x] 2.5 Knopf „Registrierliste drucken“ im Kopf des `RegistrierungPaneel` (nur mit `personenFrei`, auch ohne Schreibrecht); `RegistrierungPaneel.test.tsx` und `GeraetBetreuungsstelle.test.tsx` um Sichtbarkeit und Ziel erweitert

## 3. Druck-Gate und e2e

- [x] 3.1 `e2e/registrierliste-druck.spec.ts` in `DRUCK_SPECS` (drei Engines, Mechanik unter Druckmedium mit `beforeprint`): Blatt mit Haushalt, Summen und Abhakspalte, Unverträglichkeit nur nach Wahl; Lauf grün in Chromium, Firefox, WebKit (Chromium lokal grün samt Mutationsprobe; Firefox und WebKit belegt die CI des PRs, der Container hat sie nicht)
- [x] 3.2 Gerätefall in `e2e/geraet-betreuungsstelle.spec.ts`: „Registrierliste drucken“ öffnet die Druckansicht der eigenen Stelle; Lauf grün

## 4. Regeln, Doku, Gate

- [x] 4.1 Regeln nachziehen: `frontend/src/druck/AGENTS.md` (Eintrag Registrierliste, Ausnahme Gerät), `frontend/src/betreuung/AGENTS.md` (Registrierstelle: Druck), `frontend/src/geraet/AGENTS.md` (Betreuungsstelle druckt die eigene Liste); `prettier --check` grün
- [x] 4.2 Anwenderkapitel `docs/anwender/kapitel/betreuung.md` und `geraet-betreuungsstelle.md` um „Registrierliste drucken“ ergänzen (Mitänderungsregel, `docs/anwender/AGENTS.md`); Doku-Wächter grün
- [ ] 4.3 `./scripts/check-all.sh` grün (bzw. die CI des PRs)

## 5. Review-Nachzüge (Entscheidungen 09.11.2026)

- [x] 5.1 Druckabruf in `write_retry!` (`BEGIN IMMEDIATE`) statt deferred `BEGIN`; Repo-Test `druck_wartet_auf_einen_fremden_schreiber` (gehaltener fremder Schreiber auf der Datei-DB) rot vorher, grün danach
- [x] 5.2 Eigene Protokollart `registrierliste` (Migration 0311, `ZugriffArt`, Enum-Kontrakt, generierte Typen, Klartext „Registrierliste gedruckt“); `db::tests::migration_0311_*`, `zugriffArt.test.ts` grün
- [x] 5.3 Bezugsperson, die nicht auf der Liste steht, fällt im Druck aus dem Haushaltskopf; Repo-Test `druck_nennt_eine_abgemeldete_bezugsperson_nicht` grün
- [x] 5.4 Bezeichner nach LFH-1312: `audit_repo::anlegen` → `create` als eigener `refactor`-Commit, neue Wahrheitswerte `has_…`

## Workflow follow-up

- `/opsx:archive iw8hjb93-registrierliste-drucken` im selben Branch vor dem PR.
- Bilder der Änderung (Stabsansicht, Blatt mit und ohne Gesundheitsangaben, Gerät) in PR und Meldung.
