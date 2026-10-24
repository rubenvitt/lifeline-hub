# Tasks

**Arbeitsweise je Aufgabe:** `superpowers:test-driven-development`, also erst der rote Test, dann
der Code.
- Backend-Tests mit `cargo test --test <datei>`.
- Frontend-Gates aus dem Frontend-Ordner über `mise exec -- pnpm …`; ohne mise `pnpm` aus
  `/opt/node22`.
- Dateien bleiben unter `stab/` (design.md, Non-Goals).
- Umbenennungen nach LFH-1312 kommen als eigener `refactor`-Commit.
- Jeder Teil endet grün für sich, mit eigenem `feat`-Commit.

## 1. Teil A, Presse: Backend (LLH-1451; D2, D3, D4)

- [ ] 1.1 Den Modul-Key `presse` anlegen. Grün sind danach `marker_key_werte_stimmen`,
  `pfad_key_laengster_praefix_gewinnt` (`…/stab/infotelefon/3` → `presse`, `…/stab/besetzung/s1` →
  `stab`) und `backend_modul_keys_decken_frontend_registry`.
  - `MODUL_KEYS` wächst auf 35, `presse` vor `fernmeldewesen`.
  - In `modul_marker!` kommt der Marker `Presse`.
  - `PFAD_KEY` bekommt drei Unterpräfixe mit Verweis auf D3.
  - Im selben Commit kommt der Registry-Eintrag aus 3.1.
- [ ] 1.2 `routes/presse.rs`, `routes/infotelefon.rs` und `presse/mitteilung.rs` auf
  `EinsatzLese-`, `EinsatzSchreib-` und `EinsatzLeitungszugriff<Presse>` umstellen. Die
  Doc-Kommentare ziehen mit. `tests/einsatz_kontext_guard.rs` ist grün.
- [ ] 1.3 Neue Gate-Tests nach dem Muster `tests/lagebesprechung.rs:64-138`:
  - Stab ausgeblendet: Presse-Log, Mitteilungen und Infotelefon lesen 200, anlegen 201,
    `GET …/stab` 403.
  - Presse ausgeblendet: alle drei 403, `GET …/stab` 200.
  - Presse auf eine Rolle beschränkt: 403.
  - Fremde Org: 404.
  - Führungspersonal gibt eine Mitteilung frei: 403.
  - Die bestehenden Presse- und Infotelefon-Tests sind grün.
- [ ] 1.4 Live umstellen: `LiveEvent::Presse` und `LiveEvent::Infotelefon` gaten auf
  `["presse"]`. Grün sind `gate_mengen_sind_gepinnt` und der Test „Leser mit Stab-, ohne
  Presse-Recht erhält nichts“.
- [ ] 1.5 Migration nach D4 (Nummer per `git fetch origin alpha && scripts/check-migrationen.sh`):
  Rolle und Sichtbarkeit aus `stab` in Override, Org-Einstellung und Vorlagen kopieren.
  `EINSATZ_VORLAGE_STARTLISTE` bleibt ohne `presse`. Der Test in `src/db.rs` deckt ab:
  - Ausblendung übernommen
  - Rolle übernommen
  - ohne Vorgabe keine Zeile
  - `migration_0238_seedet_die_startliste` bleibt grün
- [ ] 1.6 `scripts/check-typ-codegen.sh` laufen lassen und beide generierten Dateien
  mitcommitten. `tests/modul_override.rs` und `tests/modul_freigaben.rs` sind grün.

## 2. Teil A, Presse: Frontend (D5, D6)

- [ ] 2.1 Den Registry-Eintrag `presse` anlegen (Kategorie Kommunikation vor Fernmeldewesen,
  Beschreibung „Presse-Log, Mitteilungen, Infotelefon“). Grün sind `modulRegistry.test.ts`
  (Reihenfolge, 40 Zeichen) und `ModulPanel.test.tsx`.
- [ ] 2.2 Icon nach Rubens Wahl über `scripts/icons/` und `icons/index.ts` einbinden (Open
  Question). Diese Aufgabe allein wartet auf die Wahl.
- [ ] 2.3 Routen und Weiterleitung umstellen. Vitest prüft:
  - `stab/presse?kontakt=12` landet mit Hervorhebung im Modul Presse.
  - Die alte Adresse leitet bei ausgeblendetem Stab um.
  - Bei gesperrter Presse erscheint `ModulGesperrt` für „Presse“.

  Dazu gehören:
  - `deeplinks.ts`: `pressePfad`, `pressemitteilungPfad`, `infotelefonPfad`
  - `App.tsx`: `MODUL_ELEMENTE.presse` und Unterrouten
  - `ALTPFAD_MODUL` mit `stab/presse` und `stab/infotelefon`
  - `AltpfadWeiterleitung` behält Restpfad und Query.

  `deeplinks.test.ts` und `EinsatzLayout.test.tsx` sind grün.
- [ ] 2.4 `presse/PresseReiter.tsx` bauen (Presse · Informationstelefon). Die drei Seiten prüfen
  `useModulFreigabe('presse')` fail-closed, mit h1 „Presse“ und Ortspfad Einsatz › Presse. Vitest
  prüft:
  - Reiterfolge und -wechsel
  - Stab gesperrt: Seiten voll da
  - „Modul Presse nicht freigegeben“

  Die Seiten-Tests sind nachgezogen.
- [ ] 2.5 Die Abnehmer auf `presse` umstellen. Grün sind `befehle.test.ts`,
  `sprungmarken.test.ts`, `uebernahmen.test.ts` und `schnellaktionen.guard.test.ts`.
  - `medienlageQuelle.ts`
  - Palette „Anruf erfassen“
  - Sprungmarke „Informationstelefon“ hinter „Presse“, Schlagworte
  - `stab/unterseiten.ts`: S5 auf `presse`
  - „Pressearbeit“-Marke und `stabMarken()` entfernen
- [ ] 2.6 e2e nachziehen: `pressemitteilung-navigation.spec.ts`, `stab-schmal.spec.ts`
  (Infotelefon-Teil), `command-palette.spec.ts`, `gate1-ueberlauf.spec.ts` und
  `gate3-trefflaeche.spec.ts` (Reiter in allen drei Dichtestufen). Neu ist `presse-modul.spec.ts`:
  - Stab ausgeblendet: Anruf erfassen, Mitteilung anlegen.
  - Der alte Link landet richtig.
- [ ] 2.7 Regeln und Doku für Teil A. Prettier und `anwenderdoku.guard.test.ts` sind grün.
  - Neu ist `frontend/src/presse/AGENTS.md`, mit Regelkarte der Wurzel-`AGENTS.md`.
  - Der S5-Abschnitt aus `frontend/src/stab/AGENTS.md` zieht dorthin um, Verweise per `grep`
    nachziehen.
  - `docs/anwender/kapitel/presse-infotelefon.md`: Titel, Einstiege, „Wer was darf“, Bilder über
    `pnpm doku:bilder --grep presse`.

## 3. Teil B, Stab aus der Navigation (LLH-1452; D7, D8, D9)

- [ ] 3.1 `ohneNavigation` und `istNavigationsziel` in `modulRegistry.ts` einführen, `stab` mit
  Flag und Beschreibung „Besetzung, Fachzugänge, Stabsmonitor“ versehen. Ein Guard-Test prüft:
  `stab` ist das einzige Modul ohne Navigationsziel.
- [ ] 3.2 Alle Navigationsabnehmer nach D7 umstellen. Vitest prüft:
  - Der Stab fehlt in Panel, Drawer, Palette und Startseiten-Wahl.
  - Ein gespeichertes `standard_modul='stab'` öffnet die Vorgabe.
  - Der Rückweg überspringt den Stab.
  - Die Modul-Einstellungen führen den Stab weiter.
- [ ] 3.3 `stab/StabPaneel.tsx` mit Besetzungszeilen, Besetzungsstand und `BesetzungModal` bauen.
  `ChecklistePaneel` wird ein Abschnitt. Das Paneel steht in `EinsatzdatenPage` nach der
  Führungsstelle, mit `id="stab"`, fail-closed über `useStabFreigabe`. Vitest übernimmt die Fälle
  aus `StabPage.test.tsx`:
  - Besetzung ändern
  - Beobachter ohne Aktion mit Grund
  - Laden scheitert, veraltet
  - Mandantenlabel
  - Stab ausgeblendet: kein Paneel, keine Anfrage
  - alle Checklisten-Fälle

  `ChecklistePaneel.test.tsx` ist grün.
- [ ] 3.4 Die Adresse `stab` als `AltpfadWeiterleitung` auf `einsatzdaten#stab` umleiten.
  `ALTPFAD_MODUL` lernt den Schlüssel mit einem Segment, und die Einsatzdaten rollen bei `#stab`
  zum Paneel. Vitest prüft:
  - Weiterleitung bei freiem Stab
  - Weiterleitung bei ausgeblendetem Stab ohne Sperrhinweis
  - kein zweiter Verlaufseintrag
- [ ] 3.5 `pages/StabPage.tsx` und `StabPage.test.tsx` entfernen.
  - `LagebesprechungZeile` bekommt die Variante ohne Sprung (Vitest).
  - Der Verweis im ersten Checklistenpunkt zeigt auf `#fuehrungsstelle`.
  - Ungenutzte Exporte entfernen; Lint (knip bzw. Projektregel) ist grün.
- [ ] 3.6 e2e nachziehen:
  - `stab-checkliste.spec.ts`, `stab-kontrast.spec.ts` und `stab-schmal.spec.ts` gegen das Paneel
    in den Einsatzdaten, 390 px ohne Querlauf
  - `gate1-ueberlauf.spec.ts`, `gate3-trefflaeche.spec.ts`
  - `doku-bilder/stab.bilder.ts`
  - neu: Der Stab fehlt im Modulmenü.
- [ ] 3.7 Regeln und Doku für Teil B. Prettier und der Doku-Guard sind grün.
  - `frontend/src/stab/AGENTS.md`: Stab-Seite → Paneel „Stab“, Checkliste.
  - `frontend/AGENTS.md`: Modul ohne Navigationsziel.
  - `frontend/src/command-palette/AGENTS.md`
  - `docs/anwender/kapitel/stab.md` neu gegliedert: Besetzung in den Einsatzdaten, Verweis auf
    Fachzugang und Stabsmonitor.
  - `einsatz-oberflaeche.md`, `lagebesprechung.md`, `funkplan.md`, Bilder

## 4. Teil D, Stabsmonitor (LLH-1454; D10, D11, D12, D14)

- [ ] 4.1 Migration „Neubau `geraet_kopplung`“ nach D14 schreiben: neun Ansichten, Spalte
  `sachgebiet`, CHECKs. Der Test in `src/db.rs` nach `migration_0213_…` ist grün.
- [ ] 4.2 `Funktionsansicht::Stabsmonitor` mit allen `match`-Zweigen anlegen und
  `ist_verfuegbar` erst in 4.6 setzen. Grün sind:
  - die Rust-Tests in `geraet/mod.rs` (Rolle, Stellenart, `nicht_gelistete_route_ist_verboten`)
  - `tests/enum_wire_kontrakt.rs`
  - `tests/geraet_routen_guard.rs` mit `stabsmonitor_schreibt_nichts`
- [ ] 4.3 `routes/stabsmonitor.rs` nach D11 bauen. Die Zuordnung der Zahlen zu den Sachgebieten
  steht mit Test gegen `stab/sachgebiete.ts`. Tests:
  - Zahlen gleich `modul-zaehler`
  - ausgeblendetes Modul ohne Zahl
  - Antwort ohne Anrufername, Rückrufnummer und Ansprechperson
  - Person ruft den Endpunkt: 403
  - Stab ausgeblendet: 403
  - nur Funktionsträger mit Namen
- [ ] 4.4 Refactor-Commit: die Bausteine aus `LagemonitorPage.tsx` nach
  `geraet/monitorBausteine.tsx` ziehen. `LagemonitorPage.test.tsx` und
  `geraet-lagemonitor*.spec.ts` bleiben unverändert grün.
- [ ] 4.5 `geraet/StabsmonitorPage.tsx`, die Wahl in `GeraeteLayout`, `einsatzKeys.stabsmonitor`
  und `EINSATZ_STREAM_EVENTS` umsetzen. Vitest prüft:
  - Kacheln S1–S6 mit Label und Besetzung
  - überfällige Aufträge mit Wort
  - Termin überfällig „seit n min überfällig“ im Ton `achtung`
  - veralteter Stand
  - Anstieg 60 s
  - stumm
- [ ] 4.6 `ist_verfuegbar` setzen, die Kopplungsmaske um den Stabsmonitor erweitern
  (`geraeteKern.ts`, `EinsatzGeraete.tsx`). Grün sind `uebersicht_bietet_alle_ansichten` und der
  400-Fall „mit Sachgebiet“ in `tests/geraet_kopplung.rs`. Neu ist das e2e
  `geraet-stabsmonitor.spec.ts`:
  - 1920 × 1080 ohne Bildlauf
  - Kennzahl ≥ 72 px
  - kein Name eines Anrufers im DOM
  - neuer Termin ohne Neuladen
  - Langdruck öffnet das Menü
- [ ] 4.7 Regeln und Doku für Teil D. Prettier und der Doku-Guard sind grün.
  - `frontend/src/geraet/AGENTS.md`, Abschnitt Stabsmonitor
  - neues Anwenderkapitel „Stabsmonitor und Fachzugang“ (Teil zum Monitor) mit Bild

## 5. Teil C, Fachzugang je Sachgebiet (LLH-1453; D13, D15–D19)

- [ ] 5.1 Spike in einem Wegwerf-Test, nicht committet: Jede der 15 Werkzeugseiten in einer
  Test-Hülle mit Gerätesitzung rendern. Ergebnisse als Kommentar an LLH-1453 und, falls nötig,
  Rückfrage an Ruben:
  - fehlende Kontexte
  - abgelehnte Routen (Kandidaten für `STAB_SACHGEBIET_ZUSATZ` mit Grund)
  - Sprünge ohne Freigabeprüfung
- [ ] 5.2 `src/stab/werkzeuge.rs` (`werkzeug_module`) mit Test gegen `stab/sachgebiete.ts` anlegen.
- [ ] 5.3 Bindung an ein Sachgebiet nach D13 umsetzen. Tests in `tests/geraet_kopplung.rs`:
  - ohne Sachgebiet 400
  - `s9` 400
  - zwei Geräte für S1
  - Übersicht nennt „S2 · Lage“

  Dazu gehören:
  - `Bindungsart::Sachgebiet`, `GeraetKontext.sachgebiet`, Body und Anzeigen
  - `repo.rs` (Spalte, `kontext_wenn_gueltig`)
  - `stelle_pruefen` ohne DB-Abfrage
  - Typ-Codegen
- [ ] 5.4 Schranke nach D16 umsetzen: `darf_route(&GeraetKontext, …)`,
  `GeraetKontext::lese_module()`, die Zusatzliste aus 5.1 und die Stab-Vorbedingung in
  `fordere_geraeteroute`. Tests:
  - je Sachgebiet erlaubtes Schreiben, etwa S2 ETB-Eintrag 201, S3 Auftrag 201, S1 Einheit ändern
  - fremdes Modul 403, etwa S2 Auftrag erteilen, S1 Personenliste
  - S5 Mitteilung freigeben 403
  - Werkzeugmodul ausgeblendet 403
  - Stab ausgeblendet: alles außer Einsatzkopf 403
  - Live nur der Werkzeugmodule
  - Zähler einsatzweit
  - Guard: Jede Zusatzroute existiert.
- [ ] 5.5 Belege nach D17: ETB-Eintrag, Absender und `erstellt_von` eines Fachzugangs nennen Gerät
  und Sachgebiet. Rust-Test je Schreibweg der Werkzeugmodule mit Personenfeld; Stichprobe ETB,
  Meldung, Auftrag, Nachforderung.
- [ ] 5.6 `geraet/FachzugangHuelle.tsx` nach D18 mit Routen `/geraet/:id/stab/…` bauen, mit den
  Kontexten des Einsatzrahmens für Geräte und der Leiste aus Startseite und Werkzeugen. Vitest
  prüft:
  - Werkzeug öffnet die Modulseite.
  - Rückweg zur Startseite.
  - Sprung in ein fremdes Modul gesperrt.
  - stumm, keine Palette
  - 390 px ohne Querlauf
- [ ] 5.7 `geraet/FachzugangStartPage.tsx` nach D19 bauen, dazu die Quelle „Informationstelefon“
  in `werkzeugZahlen.ts`. Vitest übernimmt die Werkzeug- und Zahlenfälle aus dem alten
  `StabPage.test.tsx`:
  - überfällig mit Wort
  - Nachforderungen S1/S4
  - Funkplan-Lücken
  - Quelle nicht geladen
  - gesperrt ohne Zahl
  - ausgeblendet fehlt
  - live

  Hinzu kommt „Stab nicht freigegeben“ als Hinweis.
- [ ] 5.8 `ist_verfuegbar` setzen und die Kopplungsmaske mit Sachgebietswahl ausstatten
  (`stellenOptionen`, `StellenWert`, `stelleIdAusWahl`). Grün ist
  `uebersicht_bietet_alle_ansichten` mit neun Ansichten. Neu ist das e2e
  `geraet-stab-fachzugang.spec.ts`:
  - S2 koppeln, ETB-Eintrag schreiben, Eintrag nennt das Gerät
  - Lagekarte öffnen
  - Aufträge fehlen
  - S5 kann nicht freigeben
  - Stab ausblenden: Hinweis ohne Neuladen
- [ ] 5.9 Prüfliste Einsatztauglichkeit für Paneel „Stab“, Presse-Reiter, Fachzugang und
  Stabsmonitor als `pruefliste.md` in dieser Change anlegen, jede Zeile mit Verdikt.
- [ ] 5.10 Regeln und Doku für Teil C. Prettier und der Doku-Guard sind grün.
  - `frontend/src/geraet/AGENTS.md`: Fachzugang, Schranke über Modulmenge, Belege
  - `src/AGENTS.md`, falls die Schranke dort Regeln berührt
  - Anwenderkapitel „Stabsmonitor und Fachzugang“ (Teil zum Fachzugang) mit Bildern

## 6. Integration

- [ ] 6.1 `./scripts/check-all.sh` ist grün (Bündel laut Skriptkopf), besonders Typ-Codegen,
  Migrationsnummern, OpenSpec-Archiv, Prettier/rustfmt, Vitest, Rust-Tests und e2e. Was in der
  Sitzung nicht läuft (Desktop-Hülle, volle e2e), wird hier mit Verweis auf die CI des PRs
  vermerkt.
- [ ] 6.2 Am laufenden System nachklicken (`cargo run --features dev-seeds` und Vite):
  - Stab fehlt im Menü.
  - Besetzung in den Einsatzdaten ändern.
  - Presse ohne Stab nutzen.
  - Fachzugang S2 koppeln und ins ETB schreiben.
  - Stabsmonitor koppeln und Termin ändern.
  - Den Ablauf in dieser Aufgabe festhalten.

## Workflow follow-up

- Vor dem PR `/opsx:archive c47y6o0h-stab-aus-dem-alltag` im selben Branch laufen lassen: Spec-Sync,
  Purpose von `stab-uebersicht` (jetzt Paneel und Navigation), `stab-medienlage` und
  `stab-checkliste` prüfen, Verweise nachziehen.
- `feat`-Commits mit den Versionshinweisen aus design.md, Migration Plan.
- PR gegen `alpha`. Zunder LLH-1450 und die Unteraufgaben auf `review` mit `pr_url`, dann
  `release_task`.
- Notiz an LLH-722 (Feldbefund Stab): Die Stabsnutzung läuft künftig über Fachzugänge und
  Stabsmonitor.
