# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Backend-Tests laufen mit `cargo test --test <datei>` bzw. `cargo test <modul>`. Die
Frontend-Gates laufen aus dem Frontend-Ordner über `mise exec -- pnpm …`. Die Reihenfolge der
Gruppen ist die Reihenfolge der Commits. Jede Gruppe endet grün und bringt ihre Tests und ihre
Doku selbst mit. Die Umzüge (Gruppen 2 und 3) sind `refactor`-Commits ohne Verhaltensänderung
(LFH-1312).

## 1. Machbarkeit der Tabellenlöschung (D4, zuerst)

- [x] 1.1 Migrationstest in `src/db.rs` gegen das gebündelte SQLite: Eine Test-DB mit ETB-Einträgen, die auf eine Pressemitteilung zeigen, führt `ALTER TABLE etb_eintrag DROP COLUMN pressemitteilung_id` und danach `DROP TABLE medienkontakt`, `pressemitteilung` aus. Danach gelingt ein ETB-INSERT. Mit `PRAGMA foreign_key_check` gibt es keinen Treffer. Ergebnis und Laufzeit bei Demo-Größe kommen als Notiz in `design.md` D4. Schlägt der Test fehl, gilt der Rückfall aus D4 (leere `pressemitteilung` bleibt, Spalte NULL), und D4 wird angepasst, bevor Gruppe 6 beginnt.

## 2. Umzug Frontend (D5, refactor)

- [x] 2.1 Allgemeine Helfer verschieben:
  - `md` nach `lib/markdown.ts`
  - `ZUSTAND_GRUND` und `Quelle<T>` nach `api/abrufZustand.ts`
  - `zeilenziel.ts` nach `components/zeilenziel.ts` (`zeilenzielStil`)

  Alle Importe (Lageberichte, Lagebesprechung, Organigramm, Seiten) werden umgestellt.
  `pnpm exec tsc --noEmit`, `pnpm lint` und die betroffenen Vitest-Dateien sind grün.
- [x] 2.2 `einsatzleiter.ts` und `fuehrungsstelle.ts` samt Tests nach `einsatz/` verschieben. Die Importeure (Einsatzdaten, Einsätze, Einsatzleiter-Angabe, Organigramm, Einsatzbericht, Eigene Lage) werden umgestellt. Vitest ist grün.
- [x] 2.3 Fernmeldewesen-Dateien aus `stab/` nach `fernmeldewesen/` verschieben, samt `skizze/`, `luecken`, `useNetzQuellen`, `SkizzenAufnahme`, `rufnameVorschlaege` und Tests. Dazu `e2e/fernmeldeskizze-ausstattung.spec.ts` (Import) und die `quellen:` in `docs/anwender/kapitel/{funkplan,einsatzdaten,einsatzabschnitte,einsatzabschluss}.md` anpassen. Vitest und `anwenderdoku.guard.test.ts` sind grün.
- [x] 2.4 Den Fernmeldewesen-Teil von `stab/AGENTS.md` nach `fernmeldewesen/AGENTS.md` übernehmen. Die Tabelle in der Wurzel-`AGENTS.md` und die Verweise nachziehen (`grep -rn "stab/AGENTS.md"` hat keinen Treffer außer dem Rest-Abschnitt). Prettier ist grün.

## 3. Umzug Backend (D5, refactor)

- [x] 3.1 `fordere_aktiv_in_tx` nach `src/einsatz/repo.rs` verschieben. Die Aufrufer (Lagebesprechung, Führungsstelle, Lagemonitor-Zugang, Kommunikation, Fernmeldeskizze) werden umgestellt. `cargo test --lib` ist grün.
- [x] 3.2 `src/stab/{kommunikation,fernmeldeskizze}.rs` nach `src/fernmeldewesen/` verschieben. Die Fernmeldewesen-Handler und `sse_fernmeldewesen` ziehen aus `routes/stab.rs` nach `routes/fernmeldewesen.rs`. `Sachgebiet` kommt nach `src/fuehrung/`. Die Pfade in `tests/` (`lifeline_hub::stab::…`), `src/demo/import.rs`, `einsatzabschnitt`, `einheit` und `einsatz` werden umgestellt. `cargo test`, `scripts/check-typ-codegen.sh` (die Schema-Namen bleiben gleich) und `tests/einsatz_kontext_guard.rs` sind grün.
- [x] 3.3 Die Bausteinsicht (`docs/architektur/05-bausteinsicht.md`) und das Glossar (`Sachgebiet`) auf die neuen Module nachziehen. `scripts/check-architektur.sh` ist grün.

## 4. Informationstelefon als eigenes Modul (D3)

- [x] 4.1 Backend:
  - `infotelefon` in `MODUL_KEYS` aufnehmen, Marker `Infotelefon`, Unterpräfix `…/stab/infotelefon` → `infotelefon` in `PFAD_KEY`
  - Handler in `routes/infotelefon.rs` auf `<Infotelefon>` umstellen
  - `LiveEvent::Infotelefon` auf das Gate `["infotelefon"]`
  - Registry-Eintrag aus 4.4 im selben Commit, weil `backend_modul_keys_decken_frontend_registry` beide verlangt

  `marker_key_werte_stimmen`, `pfad_key_laengster_praefix_gewinnt`, `gate_mengen_sind_gepinnt`, `tests/enum_wire_kontrakt.rs` und `tests/einsatz_kontext_guard.rs` sind grün.
- [x] 4.2 Gate-Tests nach dem Muster `tests/lagebesprechung.rs:64-138` in `tests/stab_infotelefon.rs`:
  - Infotelefon ausgeblendet → alle Infotelefon-Routen 403
  - auf eine Rolle beschränkt → 403 für andere
  - Leser ohne Recht `infotelefon` erhält kein Live-Ereignis
  - fremde Organisation → 404

  `tests/infotelefon_zaehler.rs` und `tests/modul_override.rs` (`MODUL_GET_PFADE`) sind grün.
- [x] 4.3 Migration A „infotelefon_modul“ (Nummer vorher mit `git fetch origin alpha && scripts/check-migrationen.sh` geprüft): Rolle und Sichtbarkeit von `stab` auf `infotelefon` übernehmen, in `einsatz_modul_override`, `org_modul_einstellung` und `einsatz_vorlage_modul_aus`. Danach alle Zeilen mit `modul_key = 'stab'` löschen. Die Startvorlagen (`EINSATZ_VORLAGE_STARTLISTE`) blenden `infotelefon` aus.
  - Test `migration_<nr>_uebernimmt_stab_freigaben_fuer_infotelefon` in `src/db.rs` deckt Rolle, Ausblendung, Vorlagen-Ausblendung und das Löschen ab.
  - `einsatz_vorlage/tests.rs` ist grün, mit `stab_steht_in_keiner_vorlage` umgestellt auf `infotelefon`.
- [x] 4.4 Frontend:
  - Registry-Eintrag `infotelefon` (Kommunikation, `IconTelefon`, „Bürgeranrufe, Rückrufe, Anliegen“)
  - `MODUL_ELEMENTE.infotelefon`
  - `ALTPFAD_MODUL['stab/infotelefon']` mit Weiterleitung, die `?anruf=` und `?neu=1` erhält
  - `infotelefonPfad` auf `einsatzModulPfad`
  - `InfotelefonPage` auf `useModulFreigabe('infotelefon')`, Titel `modulName`, Ortspfad ohne „Stab“
  - Anliegen-Labels nach `infotelefon/labels.ts`
  - Schnellaktion „Anruf erfassen“ mit `modulKey: 'infotelefon'`
  - Infotelefon-Marke aus `sprungmarken.ts` entfernen

  Vitest grün: `modulRegistry.test.ts` (Reihenfolge-Pin, 40 Zeichen), `InfotelefonPage.test.tsx`, `deeplinks.test.ts`, `befehle.test.ts`, `schnellaktionen.guard.test.ts`, `sprungmarken.test.ts`, `websiteModule.guard.test.ts` (mit `website/src/daten/module.json`).
- [x] 4.5 Typ-Codegen (`scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts` mitcommittet), `liveEvent.contract.test.ts` grün.
- [ ] 4.6 Anwenderdoku: `presse-infotelefon.md` wird `infotelefon.md` (Bereich, `quellen:`, Adresse). `e2e/doku-bilder/presse-infotelefon.bilder.ts` wird `infotelefon.bilder.ts`, die Bilder neu aufnehmen. Die e2e-Specs mit dem Pfad `/stab/infotelefon` umstellen (`leisten-flaeche`, `fokus-verdeckung`, `command-palette`, `stab-schmal`). Grün sind `anwenderdoku.guard.test.ts`, der Bildlauf des Kapitels und die betroffenen e2e-Specs.

## 5. Auflösung über die Mitgliedschaft (D2, D7)

- [x] 5.1 `fuehrung::aufloesung` liest `einsatz_mitgliedschaft.fuehrungsfunktion` statt der Besetzung, ohne `darf_stab_lesen`. Geräte bleiben ausgeschlossen. Mehrere Mitglieder ergeben alle Namen alphabetisch. Die Wire-Form `AktuelleBesetzung` bleibt. Grün sind `src/fuehrung/tests.rs`, `tests/fuehrungsfunktionen.rs` (Setup auf Mitgliedschaft) und `tests/geraet_kopplung.rs`.
- [x] 5.2 `benachrichtigung::aufloesung` (`besetzung_nutzer`, `funktionen_der_nutzer`) liest nur noch die Mitgliedschaft und den EL der Führungsstelle. Die `tests/benachrichtigung*.rs` (Setup auf Mitgliedschaft), `tests/dokument_verteiler.rs` und `tests/lagebesprechung.rs` sind grün.
- [x] 5.3 `einsatz::funktion`, `meine_sachgebiete`/`meine_funktion` (`einsatz/mod.rs`, `routes/einsatz.rs`), `fuehrungsstelle::absender_tx` und den ETB-Funktions-Snapshot auf die Mitgliedschaft umstellen. `tests/einsatz_funktion.rs`, `tests/einsatz_live.rs` und `tests/org_live.rs` sind grün.
- [x] 5.4 Live-Ereignis `mitglieder` (Wire `mitglieder`, Gate Einsatz-Lesezugriff) bei `PUT`/`DELETE …/mitglieder/…`. Ein Leser des Einsatzes erhält es. Eine fremde Organisation erhält nichts. Außerdem entsteht keine Auflösung für geschwärzte Einsätze. Grün sind `gate_mengen_sind_gepinnt`, `tests/enum_wire_kontrakt.rs`, `tests/einsatz_live.rs` und der Codegen. Frontend: `EINSATZ_STREAM_EVENTS.mitglieder` invalidiert Mitglieder, Aufträge, Erinnerungen und Modulzähler; dazu `useEinsatzLiveStream.test.tsx` und `liveEvent.contract.test.ts`.
- [ ] 5.5 Frontend: gemeinsame Ableitung `fuehrung/besetzungAusMitgliedern.ts` aus `GET …/mitglieder`. Folgende Stellen lesen sie:
  - Organigramm (Stabsstelle ohne Stab-Freigabe)
  - `fuehrungsorganisation.ts`
  - Fernmeldeskizze (`useNetzQuellen`, Quelle „Mitglieder“)
  - Kommunikationsplan (Spalte „Besetzung“)
  - Eigene Lage
  - Einsatzbericht (Block „Führungsfunktionen“)
  - `useFunktionsVorschlaege`/`funktionsOptionenKern`
  - Chat-Erwähnungen
  - `stammdaten/vorschlagsquellen.ts`

  Grün sind die Vitest-Dateien dieser Stellen und `e2e/fernmeldeskizze-ausstattung.spec.ts`, `fuehrungsfunktionen.spec.ts`, `einsatzbericht-druck.spec.ts` und `kommunikationsplan-offline.spec.ts`.
- [x] 5.6 `frontend/src/fuehrung/AGENTS.md`, `src/AGENTS.md` (Auflösung) und `lagebesprechung/AGENTS.md` nachziehen. Die Anwenderdoku-Kapitel `einsatzabschnitte`, `funkplan`, `rechte-im-einsatz` und `auftraege-befehle` beschreiben die Pflege unter „Mitglieder“. `anwenderdoku.guard.test.ts` und Prettier sind grün.

## 6. Stab und Presse entfernen (D1, D4, D6, D8)

- [ ] 6.1 Migration B „stab_presse_entfernen“ nach D4 (Ergebnis aus 1.1): Spalte `etb_eintrag.pressemitteilung_id` und die vier Tabellen löschen. Den Test aus 1.1 auf die echte Migration umstellen.
- [ ] 6.2 Backend löschen bzw. bereinigen:
  - `src/stab/`, `src/presse/`, `routes/stab.rs` (Rest), `routes/presse.rs`, die Routen in `app.rs`
  - `api_doc.rs`
  - `LiveEvent::{Stab,Presse}`, `Betroffen.stab` in `einsatz_personal.rs`
  - `disposition_repo.rs` (Bindungen, SPUREN)
  - Modul-Key `stab` (`MODUL_KEYS`, Marker, `PFAD_KEY`)
  - Dokumentart Pressemitteilung in `vorlagendokument` (Tests und Kommentare)
  - `schwaerzungs_audit`-Text
  - `lagebericht`-Kommentar zur Medienlage (der Abschnitt bleibt, D6)
  - Tests `tests/{stab,stab_checkliste,stab_presse}.rs`, Medienkontakte in `eingabegrenzen_*`

  `cargo test` ist grün.
- [ ] 6.3 Schwärzung und Aufbewahrung:
  - Registry-Einträge der vier Tabellen und der Spalte entfernen
  - `PERSONENBEZUEGE` (Stabsfunktion, Medienkontakt) entfernen, ebenso `PersonenArt::Medienkontakt` und die Suche
  - `AUSNAHMEN_SYSTEM_ETB` in `tests/aufbewahrung_e2e.rs` bereinigen
  - Ein neues Ersuchen mit Ziel `medienkontakt` ergibt 422, ein altes bleibt lesbar (neuer Test in `tests/aufbewahrung*.rs`)

  Grün sind `jede_einsatz_scoped_spalte_ist_klassifiziert`, `keine_toten_registry_eintraege`, `entdeckte_tabellen_gleich_registry_tabellen` und `purge_scheduler`-Tests. Den Verweis in `src/einsatz/schwaerzung_person_tests.rs:521` auf die neue Requirement „Vollzug für eine Betroffene, externe Kraft oder anrufende Person“ umstellen.
- [ ] 6.4 Typ-Codegen (Stab-, Checklisten-, Presse-Schemas entfallen, `LiveEvent` ohne `stab`/`presse`) mitcommittet. `tests/enum_wire_kontrakt.rs` und `liveEvent.contract.test.ts` sind grün.
- [ ] 6.5 Frontend löschen:
  - `pages/{Stab,Presse,PressemitteilungDetail}Page*`, `presse/`, restliches `stab/`
  - `api/{stab,presse}.ts`, `test/presseAttrappe.ts`, `useStabFreigabe`
  - `lagebesprechung/LagebesprechungZeile*`
  - Registry-Eintrag `stab`, `MODUL_ELEMENTE.stab`
  - Routen `stab`, `stab/presse*` als Weiterleitung auf `/einsaetze/:id` (D8)
  - `stabPfad`/`pressePfad`/`pressemitteilungPfad`, `stabMarken`
  - Query-Keys und Stream-Ereignisse `stab`/`presse`, Ziel `medienkontakte` in `zeilenAbgleich`
  - Statusfarben Medienkontakt und Pressemitteilung, `eingabegrenzen` Presse, `archivText` Medienkontakt
  - `MEDIENLAGE_QUELLE` (der Abschnitt Medienlage bleibt)

  Vitest ist grün, auch `queryKeys.guard`, `lagebildOffline.guard`, `schnellaktionen.guard` und `designSystem.guard`. Ein Vitest belegt die Weiterleitung `…/stab/presse` → `/einsaetze/:id`.
- [ ] 6.6 Tests, die `stab` nur als Beispielmodul nutzen, auf ein anderes ausblendbares Modul umstellen:
  - Backend: `tests/{org_einstellungen,einsatz_vorlage,modul_override,aufbewahrung_e2e}.rs`, `einsatz/berechtigung.rs`, `org/modul_einstellung.rs`, `auth/bootstrap.rs`
  - Frontend: `EinsatzModule`, `EinsatzDefaults`, `ModulEinstellungsListe`, `useModulFreigabe`, `ModulPanel`, `ModulAkkordeon`, `EinsatzLayout`, `UeberblickPage`, `EinsatzVorlage*`

  Alle sind grün.
- [ ] 6.7 e2e:
  - Löschen: `stab-checkliste`, `stab-kontrast` (den Kontrast des Zeilenziels belegt künftig `lagebesprechung` oder `infotelefon`) und `pressemitteilung-navigation`
  - Auf Infotelefon und Lagebesprechung kürzen: `stab-schmal`
  - Anpassen: `gate1-ueberlauf`, `gate3-trefflaeche`, `druck-fluss`, `listen-blaettern`, `auswahl-kontrast`, `lagebesprechung`, `einsatzkopf-live`, `einsatz-vorlagen`, `fernmeldewesen`, `fernmeldeskizze`, `lageberichte-anlegen`
  - `e2e/laufzeiten.json` nachziehen

  Die betroffenen Specs sind einzeln grün.

## 7. Doku, Hilfe, Website, ADR (D9)

- [ ] 7.1 Anwenderdoku:
  - `kapitel/stab.md`, `bilder/stab/` und `e2e/doku-bilder/stab.bilder.ts` löschen
  - Hilfe-Bereich „Stab“ wird „Führungsorganisation“ (`hilfe/bereiche.ts`, `website/src/daten/bereiche.ts`, `docs/anwender/AGENTS.md`, `README.md`)
  - Stab-Erwähnungen in den übrigen Kapiteln nachziehen
  - `stammdaten.bilder.ts` auf ein anderes Modul umstellen

  `anwenderdoku.guard.test.ts` und der Bildlauf der geänderten Kapitel sind grün.
- [ ] 7.2 Website: Text „Stab in S1 bis S6“ und Kennzahl „6 Sachgebiete“ in `website/src/pages/index.astro` und `DokuSuche.astro` entfernen. Der Website-Build und Prettier sind grün.
- [ ] 7.3 Neue ADR „Lifeline Hub hat kein Stab-Modul“ nach `docs/architektur/entscheidungen/VORLAGE.md`. Die Prüfung verbietet `src/stab/`, `src/presse/`, `frontend/src/stab/`, `frontend/src/presse/` und den Modul-Key `stab` in `MODUL_KEYS`. Dazu Kapitel 9 und die Kapitel 1 und 3 ohne Stab und Presse. `scripts/adr-fuer.sh` und `scripts/check-architektur.sh` sind grün.
- [ ] 7.4 Regeldateien:
  - Abschnitt „Stab“ aus `frontend/AGENTS.md` entfernen (Organigramm, Sprungmarken)
  - `src/AGENTS.md` (Presse-Log, Infotelefon-Pfad, `PERSONENBEZUEGE`)
  - `command-palette/AGENTS.md`, `lagebesprechung/AGENTS.md`, `offline/AGENTS.md`
  - Rest von `frontend/src/stab/AGENTS.md` löschen, Wurzel-Tabelle nachziehen
  - Den Absatz zum Informationstelefon in eine eigene Bereichsdatei `frontend/src/infotelefon/AGENTS.md`

  `grep -rn "stab/AGENTS.md\|Stab-Freigabe\|Presse-Log" --include=AGENTS.md .` hat keinen veralteten Treffer. Prettier ist grün.

## 8. Gesamtprüfung

- [ ] 8.1 `./scripts/check-all.sh` ist grün, mit `scripts/check-migrationen.sh` gegen ein frisches `origin/alpha`.
- [ ] 8.2 Lauf mit einer DB aus dem Bestand: Einsatz mit Besetzung, Presse-Log, Pressemitteilung und Checkliste, Organisation mit ausgeblendetem Stab, Vorlage MANV. Nach dem Start fehlen Tabellen und Spalte, das Informationstelefon ist dort ausgeblendet, wo der Stab es war, und das ETB bleibt lesbar und beschreibbar.
- [ ] 8.3 Bilder der Änderung für PR und Meldung aufnehmen (Wegwerf-Spec `zz-i6k6mzed.bilder.ts`): Modulliste ohne Stab und mit Informationstelefon, Organigramm mit Führungsfunktionen aus den Mitgliedern, Kommunikationsplan-Spalte „Besetzung“.

## 9. Spec-Nachzug

- [ ] 9.1 Die Deltas der Specs liegen unter `specs/` dieser Change. `openspec validate i6k6mzed-stab-herausnehmen --strict` ist grün. Die Specs, die den Stab nur beispielhaft nennen und nicht geändert wurden, sind im Bericht der Change-Vorlage aufgeführt. Nach der Umsetzung `grep -rn "Stab-Besetzung\|Presse-Log\|Pressemitteilung" openspec/specs` prüfen und für jeden normativen Rest ein Delta ergänzen.

## Workflow follow-up

- `/opsx:archive i6k6mzed-stab-herausnehmen` im selben Branch vor dem PR, Spec-Sync und Verweise eingeschlossen. Die Specs `stab-uebersicht`, `stab-checkliste`, `stab-presse-log`, `stab-pressemitteilung` und `stab-medienlage` sind danach leer und werden entfernt (`retire_capabilities: true` in `.openspec.yaml`).
- Beim Archivieren die `## Purpose`-Texte von Hand berichtigen, weil ein Delta sie nicht ändert: `stab-infotelefon` („des Sachgebiets S5“), `dokument-entwurf` (Pressemitteilung), `nachforderungen-board` („Stab-Seite“), `lage-verdichtung` („der Stab“).
- PR gegen `alpha` mit Bildern. Board-Status `review`, `pr_url` und `release_task`.
