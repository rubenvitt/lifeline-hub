# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Vor jedem „fertig“ gelten `verification-before-completion` und `requesting-code-review`.

## 1. Katalog und Migration (Backend)

- [ ] 1.1 Migration mit der nächsten freien Nummer auf `origin/alpha` anlegen (`git fetch`, dann
  `scripts/check-migrationen.sh`), Inhalt nach design.md D2/D3:
  - `ADD COLUMN` `erinnerung.empfaenger_funktion_code`, `auftrag_empfaenger.funktion`,
    `einsatz_mitgliedschaft.fuehrungsfunktion`, je mit CHECK, NULL erlaubt
  - `CREATE TABLE org_fuehrungsfunktion`
  - Kommentar zur Doppelrolle der Textspalten

  Nachweis: `cargo test db::tests` grün, `check-migrationen.sh` grün.
- [ ] 1.2 `Fuehrungsfunktion` als `wire_enum!` in `src/fuehrung/mod.rs` mit `art()`,
  `sachgebiet()`, `kuerzel()` und Standardlabel (s1–s6 aus `Sachgebiet::label()`) anlegen.
  Nachweis: Unit-Tests für Reihenfolge, `art` je Code, `sachgebiet()` für s7 = `None`. Guard-Test,
  dass die CHECK-Listen aller vier Spalten im Schema genau `ALLE` entsprechen (Mutationsprobe:
  einen Wert aus der CHECK-Liste nehmen → rot).
- [ ] 1.3 Eintrag in `tests/enum_wire_kontrakt.rs` für `Fuehrungsfunktion` und den Auflösungs-Enum.
  Nachweis: Test grün, Mutationsprobe mit umbenanntem Wire-Wert → rot.
- [ ] 1.4 Repo für Mandantenlabels: Labelkarte je Org laden, Label setzen/leeren, S7-Schalter.
  `aktiv` nur für `s7` erlaubt (422). Nachweis: Repo-Tests für leer → Standard, S7 Vorgabe aus,
  `aktiv` an `s4` → 422.
- [ ] 1.5 Endpunkte `GET /api/fuehrungsfunktionen` (angemeldet, Org aus der Sitzung) und Admin-PUT
  je Code (`AdminUser`), über `JsonBody`/`PfadParam`. Nachweis: `tests/fuehrungsfunktionen.rs`
  deckt ab:
  - Reihenfolge, S7 nur eingeschaltet, wirksames Label
  - fremde Org sieht eigenes Label nicht
  - Nicht-Admin → 403
  - unbekannter Code → 400
  - Label > 60 → 400

## 2. Drei Felder: Validierung und Speichern (Backend)

- [ ] 2.1 Eine gemeinsame Prüffunktion `pruefe_funktion(code, text, s7_aktiv)` mit den Statuscodes
  aus design.md D3. Nachweis: Unit-Tests je Zweig. Referenzpaar 400 („unbekannter Code“) gegen 422
  („Fachberater ohne Bezeichnung“).
- [ ] 2.2 Erinnerung: `NeueErinnerung.empfaenger_funktion_code`, Speichern im Repo,
  `ErinnerungAnzeige` mit Code. Nachweis: Route-Tests für
  - Code + Bezeichnung
  - nur Freitext bleibt Freitext (kein Code)
  - `s3` + Text → 422
- [ ] 2.3 Auftrag: `EmpfaengerEingabeReq.funktion`, `validiere_empfaenger` für den Funktionszweig,
  INSERT in `anlegen_tx`. Nachweis: `tests/auftrag.rs` für
  - `s3`
  - `fachberater` + „THW“
  - Freitext „S3“ ohne Code
  - `s9` → 400
  - `s7` bei ausgeschaltetem S7 → 422

  Außerdem alle Aufrufer (`routes/meldung.rs`, `routes/chat.rs`, `routes/etb.rs`) kompilieren
  unverändert.
- [ ] 2.4 Führungsstelle: `MitgliedRolle.fuehrungsfunktion` tri-state, `setze_mitgliedschaft`
  schreibt Code und Text gemeinsam, `null` leert beide. Nachweis: `tests/fuehrungsstelle.rs`
  deckt ab:
  - setzen, leeren
  - fehlendes Feld behält
  - Rollenwechsel behält
  - bestehende Tests bleiben grün
- [ ] 2.5 Schwärzungs-Registry: drei Codespalten Retain `G_ENUM`, Textspalten unverändert.
  Nachweis: Registry-Guards grün. Ein Scrub-Test zeigt, dass der Code die Schwärzung überlebt und
  der Erinnerungstext geleert wird.

## 3. Snapshot und Auflösung zur Lesezeit (Backend)

- [ ] 3.1 `snap_anzeige_fuer` für Codes nach design.md D4, ohne Personennamen. Nachweis:
  Repo-Test „S3 mit Müller besetzt → Snapshot ‚S3 Einsatz‘, ETB-`an` ohne ‚Müller‘“.
- [ ] 3.2 Besetzung je Einsatz einmal laden und `aktuelle_besetzung` an Auftragsempfängern und
  Erinnerungen zuordnen (nur s1–s6, sonst absent). Nachweis: **Paar-Test** in
  `tests/fuehrungsfunktionen.rs`:
  - Auftrag an `s3` bei Müller → Besetzung Müller
  - S3 wechselt auf Schulz → gleicher Snapshot, Besetzung Schulz
  - dazu „nicht vergeben“ und „bei der Einsatzleitung“

  Die Presence-Prüfung per `contains_key`.
- [ ] 3.3 Modulrecht: Ohne Stab-Freigabe fehlt `aktuelle_besetzung`. Nachweis: Test mit
  Stab-Override auf `admin` und einem Führungspersonal-Mitglied → Feld fehlt, Snapshot da.
  Gegenprobe mit Recht → Feld da.
- [ ] 3.4 Schwärzung: Nach dem Scrub liefert die Auflösung keinen Namen mehr. Nachweis: Test über
  den bestehenden Schwärzungspfad.
- [ ] 3.5 Keine N+1-Abfrage: Die Liste lädt die Besetzung einmal je Anfrage. Nachweis: Test oder
  Zählung der Abfragen in `liste_liefert_auftraege_mit_empfaenger` mit Besetzung.

## 4. Wirksames Label in Stab, Kopf und System-ETB (Backend)

- [ ] 4.1 `funktion::ableiten` nimmt die Labelkarte als Parameter. Einsatzkopf und
  `kurz_fuer` laden sie. Nachweis: Unit-Test „S4 mit THW-Label → ‚S4 Versorgung (Logistik)‘“,
  bestehende Tests grün.
- [ ] 4.2 System-ETB-Texte der Besetzung (`stab/repo.rs`) mit wirksamem Label. Nachweis:
  `tests/stab.rs` mit gesetztem Label.
- [ ] 4.3 `EinsatzAnzeige.meine_fuehrungsfunktion` ergänzen. `meine_fuehrungsstelle` liefert den
  Vorbelegungstext:
  - Kürzel bei `el`/Sachgebiet
  - „<Label>: <Bezeichnung>“ bei FHP/FB
  - sonst der Freitext

  Nachweis: Test je Zweig.

## 5. Typ-Codegen

- [ ] 5.1 `#[derive(ToSchema)]` für alle neuen DTOs, Eintrag in `src/api_doc.rs`, dann
  `scripts/check-typ-codegen.sh`. `openapi.json` und `types.generated.ts` werden mitcommittet.
  Handgepflegte Request-Typen in `frontend/src/api/types.ts` (`NeueErinnerung`, `NeuerEmpfaenger`)
  werden ergänzt. Nachweis: Codegen-Skript grün, `pnpm tsc -b` grün.

## 6. Frontend: Katalog, Kodierung, Query-Keys

- [ ] 6.1 `globalKeys.fuehrungsfunktionen()` samt Klassifikation (`NICHT_LIVE`). Im
  `lagebildOffline`-Guard ausdrücklich draußen, mit Begründung. `EINSATZ_STREAM_EVENTS.stab` um
  `auftraege` und `erinnerungen` erweitert. Nachweis: `queryKeys.test.ts`, `globalKeys.test.ts`,
  `lagebildOffline.guard.test.ts` grün. Mutationsprobe am Stream-Eintrag → rot.
- [ ] 6.2 `fuehrung/useFuehrungsfunktionen.ts` und `fuehrung/funktionsOptionenKern.ts`
  (`funktionsOptionen`, `dekodiere`, Anzeigetext). Nachweis: Vitest:
  - Reihenfolge, Besetzungsname im Optionslabel
  - Tipptext ergibt „Fachberater: <Text>“, „Führungshilfspersonal: <Text>“ und Freitext
  - Rohtext „S3“ dekodiert zu Freitext
  - Rohtext mit Präfix `funktion:` ohne passende Option ergibt Freitext

## 7. Frontend: Masken

- [ ] 7.1 `AuftragFormular`: Optionsgruppe „Funktionen“, `baueEmpfaenger` mit `funktion:`.
  Nachweis: `AuftragFormular.test.tsx` deckt ab:
  - Wahl „S3 – Einsatz (Müller)“ ergibt `{empfaenger_typ:'funktion', funktion:'s3'}`
  - Tipp „S3“ + Enter ergibt Freitext
  - Fachberater aus dem Tipptext

  Die vier Aufrufer bleiben grün.
- [ ] 7.2 `ErinnerungFormular`: Auswahl mit denselben Optionen, Enter sendet weiter (Erfassungs-Norm).
  Nachweis: Test für Wahl, Freitext und Strukturprüfung „Knopf im `<form>`“. „Werte behalten“
  übernimmt den Empfänger.
- [ ] 7.3 `FuehrungsstelleModal` mit derselben Auswahl, `extra` nennt den Vorrang. Nachweis:
  `MitgliederAbschnitt.test.tsx` für Setzen, Leeren und Anzeige „S2 Lage“.
- [ ] 7.4 Prüfliste Einsatztauglichkeit (15 Kriterien) für die drei Masken als
  `openspec/changes/lfh-549-funktionskatalog/pruefliste.md`, jede Zeile mit Verdikt. Nachweis:
  Datei vollständig, `dichte.guard.test.ts` grün (kein neues `size="small"`).

## 8. Frontend: ETB-Vorschläge und Vorbelegung (Nachzug LFH-545)

- [ ] 8.1 `etb/funkrufnamen.ts` nimmt die Sachgebiete als Vorschläge (Wert = Kürzel) neben die
  Funkrufnamen. Nachweis: Vitest, dass die Funkrufnamen weiter vorhanden sind und „S2 – Lage
  (Müller)“ „S2“ einsetzt.
- [ ] 8.2 Reine Funktion `anVorbelegung(einsatz)`, eingesetzt in `Schnellerfassung.tsx` und
  `useEtbEntwuerfe.ts`. Nachweis: Paar-Tests:
  - Führungsstelle gewinnt
  - Ableitung „S2“ aus `meine_sachgebiete` [s2, s3]
  - weder noch → leer
  - Berichtigung → leer

  Die bestehenden Tests in `Schnellerfassung.test.tsx`, `EtbEntwurfsTabs.test.tsx` und
  `EtbPage.test.tsx` bleiben grün.

## 9. Frontend: Anzeige

- [ ] 9.1 `AuftragKarte`, Auftragsvorschau, `ueberblickDaten.empfaengerText` und `ErinnerungKarte`
  zeigen Snapshot und, falls vorhanden, die Besetzung („S3 Einsatz · Schulz“, „· nicht vergeben“
  neutral). Nachweis: Vitest mit und ohne `aktuelle_besetzung`. Ohne Feld steht kein Platzhalter
  (Abwesenheit getestet).
- [ ] 9.2 Die Stabseite nimmt das wirksame Label aus dem Katalog. Der Aufgaben-Kurztext bleibt in
  `stab/sachgebiete.ts`, dessen Labelfeld entfällt oder wird Rückfall bis zum Laden. Nachweis:
  `StabPage`-Test mit THW-Label. `sachgebiete.test.ts` wird angepasst, nicht gelöscht.

## 10. Frontend: Admin-Sektion „Führungsfunktionen“

- [ ] 10.1 Sektion in `admin/adminNav.tsx` nach design.md D6 (Liste, `InlineAngabe`, S7-Schalter,
  `RechteHinweis`). Nachweis:
  - `adminNav.test.tsx` (Drift)
  - Komponententest für Label setzen, leeren und S7
  - `e2e/gate3-trefflaeche.spec.ts` erfasst die Route
- [ ] 10.2 Prüfliste Einsatztauglichkeit der Sektion in derselben `pruefliste.md`. Nachweis: Zeilen
  mit Verdikt.

## 11. Integration, Doku, Abschluss

- [ ] 11.1 e2e `frontend/e2e/fuehrungsfunktionen.spec.ts`, ohne `networkidle`:
  - S3 besetzen
  - Auftrag an „S3 – Einsatz (…)“ erteilen
  - Karte zeigt die Besetzung
  - S3 umbesetzen → Karte folgt live
  - Rollenzweig nicht-privilegiert über `e2e/rollen-kern.ts` (ohne Stab-Recht keine Besetzung)

  Nachweis: grün. Mutationsprobe „Auflösung liefert Snapshot-Namen“ → rot.
- [ ] 11.2 CLAUDE.md: kurzer Absatz „Führungsfunktionen (LFH-549)“ unter dem Stab-Kontext
  (Katalog im Backend, Codespalte neben Text, Snapshot ohne Person, Auflösung zur Lesezeit mit
  Modulrecht, kein Regex). Verweis auf den Archivpfad dieser Change. Nachweis: Verweis zeigt nach
  dem Archivieren auf eine existierende Datei.
- [ ] 11.3 ClickUp: an LFH-545 vermerken, dass Vorschläge und Vorrangregel hier eingelöst werden.
  Nachweis: Kommentar am Task.
- [ ] 11.4 `./scripts/check-all.sh` grün (Nachweis: der Lauf lokal oder der CI-Lauf des PRs).
- [ ] 11.5 `/opsx:archive lfh-549-funktionskatalog` im selben Branch mit Spec-Sync nach
  `openspec/specs/fuehrungsfunktionen/`, Verweise nachgezogen. Nachweis:
  `scripts/check-openspec-archiv.sh` grün.
