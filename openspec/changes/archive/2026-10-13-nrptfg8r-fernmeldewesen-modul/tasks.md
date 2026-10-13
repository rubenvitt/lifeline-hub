# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Backend-Tests mit `cargo test --test <datei>`, Frontend-Gates aus dem Frontend-Ordner über
`mise exec -- pnpm …` (ohne mise: `pnpm` aus `/opt/node22`). Dateien bleiben unter `stab/`
(design.md, Non-Goals); Umbenennungen nach LFH-1312 als eigener `refactor`-Commit.

## 1. Backend: Modul-Key, Marker, Pfade (D1, D2)

- [x] 1.1 `fernmeldewesen` in `MODUL_KEYS` (33, Kommunikation-Block am Ende, gleiche Stelle wie die Registry), Marker `Fernmeldewesen` in `modul_marker!`, zwei Unterpräfixe in `PFAD_KEY` mit Verweis auf D4 der Herleitung; `marker_key_werte_stimmen` und `pfad_key_laengster_praefix_gewinnt` (Unterpfade `…/stab/kommunikationsplan/stellen/1/sprechgruppen/2` → `fernmeldewesen`, `…/stab/besetzung/s1` → `stab`) grün. Registry-Eintrag aus 4.1 im selben Commit, weil `backend_modul_keys_decken_frontend_registry` beide verlangt
- [x] 1.2 Die 9 Kommunikationsplan- und 16 Skizzen-Handler in `src/routes/stab.rs` auf `EinsatzLesezugriff`/`EinsatzSchreibzugriff<Fernmeldewesen>`, Schreibaktionen auf `sse_fernmeldewesen()`, Abschnittskommentare und Doc-Kommentar in `src/stab/fernmeldeskizze.rs` nachgezogen; `tests/einsatz_kontext_guard.rs` grün (rot, solange ein Handler fehlt)
- [x] 1.3 Neue Gate-Tests (Muster `tests/lagebesprechung.rs:64-138`): Stab ausgeblendet → Kommunikationsplan und Skizze lesen 200, Stelle/Verbindung/Komponente anlegen 201, `GET …/stab` 403; Fernmeldewesen ausgeblendet → alle Kommunikationsplan- und Skizzen-Routen 403, `GET …/stab` 200; Fernmeldewesen auf Rolle beschränkt, Stab frei → 403; fremde Org 404; Beobachter schreibt 403
- [x] 1.4 `tests/stab_fernmeldeskizze.rs` (`ohne_stab_recht_ist_lesen_und_schreiben_403` auf `fernmeldewesen` umgestellt, `einzelne_lage_verwerfen_braucht_stab_recht` umbenannt), `tests/modul_override.rs` (`MODUL_GET_PFADE` um beide Pfade, `jeder_ausblendbare_modul_key_ist_guard_abgedeckt` grün) und `tests/modul_freigaben.rs` grün

## 2. Backend: Live-Ereignis und Migration (D3, D4)

- [x] 2.1 `LiveEvent::Fernmeldewesen` (Wire `fernmeldewesen`, Gate `["fernmeldewesen"]` mit Begründung), `gate_mengen_sind_gepinnt`, `tests/enum_wire_kontrakt.rs`; Kommentar an `LiveEvent::Stab` auf Besetzung und Checkliste gekürzt
- [x] 2.2 Live-Tests: `tests/stab_kommunikationsplan.rs` (`jede_schreibaktion_sendet_*`) und `tests/stab_fernmeldeskizze.rs` (`zaehle`, `jede_skizzenaenderung_sendet_*`) zählen `fernmeldewesen` und kein `stab`; `tests/sprechgruppe_einzelzuordnung.rs` (`Ziel::Stelle` → `Fernmeldewesen`); neu: Leser mit Stab-, aber ohne Fernmeldewesen-Recht erhält nichts; Besetzung ändern sendet kein `fernmeldewesen`
- [x] 2.3 Migration `0186_fernmeldewesen_modul.sql` nach design.md D4 (Nummer vorher mit `git fetch origin alpha && scripts/check-migrationen.sh` geprüft); Test `migration_0186_uebernimmt_nur_die_stab_rolle` in `src/db.rs` nach dem Muster von 0184: Stab-Rolle je Einsatz und je Org übernommen, Stab-Ausblendung nicht, ohne Stab-Vorgabe keine Zeile
- [x] 2.4 Typ-Codegen: `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommittet; `liveEvent.contract.test.ts` grün

## 3. Frontend: Freigabe-Hook, Query-Keys, Live (D3, D6)

- [x] 3.1 `useModulFreigabe(key)` aus `useStabFreigabe` verallgemeinert (Zustände `laden | fehler | gesperrt | frei`, Anzeige „Modul <Label> nicht freigegeben“), `useStabFreigabe` als dünner Aufruf; `useStabFreigabe.test.tsx` grün, neuer Test für `fernmeldewesen` (gesperrt, fehler, frei)
- [x] 3.2 Query-Keys: Prefix `einsatz-fernmeldewesen`, `fernmeldewesenKommunikationsplan`/`fernmeldewesenSkizze` statt `stabKommunikationsplan`/`stabFernmeldeskizze` (alle Schreiber und Leser umgestellt), `EINSATZ_STREAM_EVENTS.fernmeldewesen`, Kommentar an `stab` gekürzt, `LAGEBILD_OFFLINE` auf den neuen Unter-Key; `queryKeys.test.ts`, `queryKeys.guard.test.ts`, `lagebildOffline.guard.test.ts`, `useSkizzenAktionen.test.tsx`, `useEinsatzLiveStream.test.tsx` (neues Ereignis invalidiert nur den neuen Prefix) grün

## 4. Frontend: Registry, Routen, Weiterleitung (D1, D5, D7)

- [x] 4.1 Registry-Eintrag `fernmeldewesen` (Kommunikation, letzter der Kategorie, `beschreibung: 'Funkplan, Skizze, Kommunikationsplan'`, Route `fernmeldewesen`, `status: 'fertig'`); `modulRegistry.test.ts` (Reihenfolge-Pin, 40-Zeichen-Grenze), `ModulPanel.test.tsx` grün
- [x] 4.2 Icon nach Rubens Wahl (Open Question) über `scripts/icons/` und `icons/index.ts`; bis dahin kein Platzhalter-Commit, die Aufgabe blockiert nur 4.2
- [x] 4.3 `routing/deeplinks.ts`: `funkplanPfad` → `…/fernmeldewesen` (mit `ansicht`), `kommunikationsplanPfad` → `…/fernmeldewesen/kommunikationsplan`; `deeplinks.test.ts` grün
- [x] 4.4 `modulAusPfad` ordnet `stab/funkplan` und `stab/kommunikationsplan` dem Modul `fernmeldewesen` zu (längster Präfix); `AltpfadWeiterleitung` mit `<Navigate replace>` unter Erhalt der Query; Routen in `App.tsx` (`MODUL_ELEMENTE.fernmeldewesen`, `fernmeldewesen/kommunikationsplan`, die zwei Altpfade). Vitest: Altpfad mit `?ansicht=skizze` landet in der Skizze, Altpfad bei ausgeblendetem Stab leitet um, Altpfad bei gesperrtem Fernmeldewesen zeigt `ModulGesperrt` für „Fernmeldewesen“; `modulRegistry.test.ts` (`modulAusPfad`), `EinsatzLayout.test.tsx` grün

## 5. Frontend: Modulseite (D5, D6, D8)

- [x] 5.1 Reiterleiste `fernmeldewesen/FernmeldewesenReiter.tsx` (antd `Tabs` Funkplan · Fernmeldeskizze · Sprechgruppen · Kommunikationsplan, design.md D5), beide Seiten mit h1 `modulName('fernmeldewesen')` und Ortspfad Einsatz › Fernmeldewesen; Vitest: Reiterfolge, Reiter „Kommunikationsplan“ navigiert, Reiter „Fernmeldeskizze“ aus dem Kommunikationsplan führt auf `?ansicht=skizze`, h1 auf beiden Seiten
- [x] 5.2 `FunkplanPage` in der Hülle: `Segmentleiste` „Darstellung“ entfällt, Darstellung folgt dem Reiter, `?ansicht=` weiter apply-then-clean, fail-closed über `useModulFreigabe('fernmeldewesen')`; Druckköpfe unverändert; `FunkplanPage.test.tsx` nachgezogen (Pfade, h1, „Modul Fernmeldewesen nicht freigegeben“), neu: Stab gesperrt → Tabelle, Skizze, Sprechgruppen voll da
- [x] 5.3 `KommunikationsplanPage` in der Hülle, fail-closed auf `fernmeldewesen`; Besetzungs-Abfrage nur bei Stab-Freigabe, `stabZustand` kennt `gesperrt`; Nebentext „—“ mit Grund „Stab nicht freigegeben“ (`title` und zugänglicher Name) in `stab/kommunikationsplan.ts`; Vitest: Stab gesperrt → Verbindungen da, Nebentext „—“, keine Anfrage an `…/stab`; `KommunikationsplanPage.test.tsx`, `kommunikationsplan.test.ts` grün
- [x] 5.4 `useNetzQuellen(einsatzId, freigabe)` auf die Freigabe des Fernmeldewesens, Quelle `besetzung` mit eigener Weiche auf `stab`; Skizze ohne Stab: keine Sachgebietszeichen, „Stab-Besetzung: nicht freigegeben“ in den fehlenden Quellen; `recht: 'stab'` → `recht: 'fernmeldewesen'` (`fernmeldeskizze.ts`, `useSkizzenAktionen.ts`, `skizze/bedienung.ts` mit `RECHT_WORT`, `skizze/wirkung.ts`); `fernmeldenetz.test.ts`, `FernmeldeskizzeBild*.test.tsx`, `bedienung.test.ts`, `wirkung.test.ts`, `sprechgruppenplan.test.ts` grün
- [x] 5.5 Prüfliste Einsatztauglichkeit (15 Kriterien) als `pruefliste.md` in dieser Change, jede Zeile mit Verdikt; e2e: Reiter in Gate 3 (`gate3-trefflaeche.spec.ts`, alle drei Dichtestufen), 390 px ohne Querlauf (`gate1-ueberlauf.spec.ts` oder `fernmeldewesen.spec.ts`)

## 6. Frontend: Abnehmer, Stab-Seite, Marken, Palette (D9, D10)

- [x] 6.1 `entwurf/DokumentAnlagen.tsx` und `stab/SkizzenAufnahme.tsx` auf `useModulFreigabe('fernmeldewesen')`; `DokumentAnlagen.test.tsx`: Stab gesperrt → „Fernmeldeskizze anfügen“ da, Fernmeldewesen gesperrt → fehlt
- [x] 6.2 `lageberichte/fuehrungsproblemeUebernahme.ts`: `funkFrei` an `fernmeldewesen`, Quellname „Fernmeldewesen“; `fuehrungsproblemeUebernahme.test.ts`, `uebernahmen.test.ts`: Stab gesperrt → Funkplan-Lücken und Kommunikationsplan da, Fernmeldewesen gesperrt → mit Grund benannt
- [x] 6.3 Stab-Seite: S6-Einträge in `stab/unterseiten.ts` mit Zielmodul `fernmeldewesen`, in `StabPage` als `SprungKnopf` gesperrt bei `istSprungGesperrt('fernmeldewesen')`, fehlend bei ausgeblendetem Ziel; `StabPage.test.tsx`
- [x] 6.4 Sprungmarken: „Fernmeldeskizze“ und „Kommunikationsplan“ hinter „Fernmeldewesen“ (Zielmodul `fernmeldewesen`, Kategorie `kommunikation`), Marke „Funkplan“ entfernt, `STAB_SCHLAGWORTE` nur S5, S6-Schlagworte an Marken und Modul; `sprungmarken.test.ts`, `ModulPanel.test.tsx` (Stab ausgeblendet → Fernmeldewesen-Marken da)
- [x] 6.5 Palette: „Funk“ → „Fernmeldewesen“ als erster Treffer gepinnt, Ansichten nach Freigabe des Fernmeldewesens; `befehle.test.ts`, `CommandPalette.test.tsx`, `schnellaktionen.guard.test.ts` (FunkplanPage → `fernmeldewesen`) grün
- [x] 6.6 e2e nachgezogen: `funkplan*.spec.ts`, `kommunikationsplan*.spec.ts`, `fernmeldeskizze*.spec.ts` und die Kern-Dateien, `einsatzleiter.spec.ts`, `command-palette.spec.ts`, `gate1-ueberlauf.spec.ts`, `gate3-trefflaeche.spec.ts`, `dokument-anlage-druck.spec.ts`, `zeichen-kontrast.spec.ts`; neu `fernmeldewesen.spec.ts`: Stab ausgeblendet → Funkplan in allen drei Darstellungen, Kommunikationsplan bearbeitbar mit Besetzung „—“, Skizze anfügen, alter Link `stab/funkplan?ansicht=skizze` landet in der Skizze

## 7. Regeln (D11)

- [x] 7.1 `frontend/src/stab/AGENTS.md` (Titel und Geltungsbereich „Stab und Fernmeldewesen“, Funkplan, Skizze, Kommunikationsplan, Offline, neue Regel zur Stab-Weiche, S5-Abschnitt), `frontend/AGENTS.md` („Keine Arbeitsplatzachse“, Sprungmarken-Absatz, Verweisblock), `frontend/src/command-palette/AGENTS.md`, `frontend/src/offline/AGENTS.md`, Regelkarte der Wurzel-`AGENTS.md` (Datei unter 200 Zeilen); `grep -rn "stab/AGENTS.md" frontend src` zeigt keinen Verweis auf einen geänderten Abschnitt mit altem Wortlaut; Prettier über `frontend/` grün

## 8. Anwenderdoku (D12)

- [x] 8.1 `funkplan.md` (Titel, Einstiege, „Wer was darf“, `quellen:`), `stab.md`, `einsatz-oberflaeche.md`, `lageberichte.md`, `auftraege-befehle.md`, `ohne-netz.md`, `README.md`-Zeile; `anwenderdoku.guard.test.ts` grün
- [x] 8.2 Bilder: `funkplan.bilder.ts` auf die neuen Adressen, `einsatz-oberflaeche.bilder.ts` und `stab.bilder.ts` geprüft; erzeugt mit `pnpm doku:bilder --grep "funkplan|einsatz-oberflaeche|stab"`, jedes Bild ≤ 300 KB; gelingt der Lauf in der Sitzung nicht, steht das im PR und die Aufgabe bleibt offen

## 9. Integration

- [x] 9.1 `./scripts/check-all.sh` grün (Bündel laut Skriptkopf), insbesondere Typ-Codegen, Migrationsnummern, Prettier/rustfmt, Vitest, Rust-Tests, e2e
  - Lauf 13.10.2026 in der Cloud-Sitzung: Bündel `schnell` grün (Schritt 12 nach Nachbessern des
    `mise`-Ersatzes der Sitzung), Vitest voll grün (882 Dateien, 13.572 Tests), Rust-Workspace grün,
    Schritt 15 (Dev-Seed) grün, die 16 betroffenen e2e-Specs grün (`pruefliste.md`). Nicht lokal:
    Desktop-Hülle (`gdk-3.0` fehlt im Container) und die volle e2e-Suite; beide fährt die CI im PR.
- [x] 9.2 Am laufenden System (Backend `cargo run --features dev-seeds`, Vite): Stab ausblenden → Fernmeldewesen voll nutzbar; Verbindung auf zweitem Tab live; Fernmeldewesen sperren → Hinweis, auch über den alten Link
  - Nachgeklickt per Probelauf (Playwright gegen Backend und Vite, nicht committet): Stab ausgeblendet,
    Führungspersonal; eine Verbindung aus Tab 1 erscheint in Tab 2 ohne Neuladen; Fernmeldewesen
    ausgeblendet → `…/stab/kommunikationsplan` und `…/stab/funkplan?ansicht=skizze` zeigen den
    Hinweis „Fernmeldewesen · Keine Berechtigung · In diesem Einsatz ausgeblendet“. Der Rahmen
    fängt die Sperre vor der Umleitung ab, die alte Adresse bleibt dann in der Leiste stehen.

## Workflow follow-up

- Vor dem PR `/opsx:archive nrptfg8r-fernmeldewesen-modul` im selben Branch: Spec-Sync, Purpose von `stab-funkplan` und `stab-kommunikationsplan` auf „Modul Fernmeldewesen“ prüfen, Verweise nachziehen.
- `feat`-Commit mit dem Versionshinweis „Wer den Stab ausgeblendet hat, bekommt das Fernmeldewesen zurück“ in Betreff und Text (design.md D4).
- PR gegen `alpha`, Zunder-Aufgabe auf `review` mit `pr_url`, dann `release_task`.
- Notiz an LLH-722: S6 zählt nicht mehr als Stabsnutzung (D9 der Herleitung).
