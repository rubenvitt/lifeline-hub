# Tasks

Jede Aufgabe entsteht per TDD: zuerst der Test, rot belegt, dann die Umsetzung. Pfade im Frontend
relativ zu `frontend/src/`.

## 1. Backend: Datenhaltung und Statusmodell (D1, D10)

- [x] 1.1 Migration `0180_auftrag_aufhebung.sql` mit `aufgehoben_at`,
  `aufgehoben_von_id` (FK `benutzer`) und `aufhebungsgrund` als `ADD COLUMN` anlegen. Nachweis:
  `git fetch origin alpha && scripts/check-migrationen.sh` grün, `db::tests` grün.
- [x] 1.2 Test zuerst:
  - Unit-Tests in `src/auftrag/repo.rs`: Ein Auftrag mit `aufgehoben_at` liefert den Status
    `aufgehoben`, auch wenn er vollzogen ist. Er ist abgeschlossen und nicht überfällig, und sein
    Abschluss-Cursor ist `aufgehoben_at`.
  - `zaehler.rs`: `zaehle_auftraege_gewichtet` zählt ihn nicht.
  - Ein Fall in `tests/fixtures/verdichtung/regeln.json`.

  Nachweis: rot belegt.
- [x] 1.3 Enum `AuftragBearbeitungsstatus::Aufgehoben`, `BEARB_AUFGEHOBEN` und `ist_offen()`
  umsetzen. Ebenso `bearbeitungsstatus_sql!`, `ist_abgeschlossen_sql!`, `abschluss_zeit_sql!`,
  `ist_ueberfaellig_sql!` und `AuftragAnzeige` (Felder `aufgehoben_at`, `aufgehoben_von_name`,
  `aufhebungsgrund`, `berichtigbar`). Den Pin in `tests/enum_wire_kontrakt.rs` und die Doku der
  Kennzahl `abgeschlossen` nachziehen. Nachweis: 1.2 grün, `tests/auftrag_blaettern.rs` und
  `tests/verdichtung_fixture.rs` grün.
- [x] 1.4 Schwärzungs-Register (D11): `aufhebungsgrund` scrub, Zeit und FK retain, gegebenenfalls
  `PERSONENBEZUEGE`. Nachweis: `jede_einsatz_scoped_spalte_ist_klassifiziert`,
  `jeder_personenverweis_ist_als_bezug_deklariert` und `tests/aufbewahrung_e2e.rs` grün.

## 2. Backend: Aufheben (D2–D5, D7)

- [ ] 2.1 Test zuerst in `tests/auftrag_aufheben.rs` (neu). Abgedeckt sind:
  - Aufheben aus „offen“, „in Arbeit“ und „vollzogen“; die Vollzugsmeldung bleibt.
  - 422 für einen abgenommenen und für einen schon aufgehobenen Auftrag, ohne zweiten
    ETB-Eintrag.
  - 400 für einen fehlenden, leeren oder zu langen Grund; 403 für einen Beobachter; 409 am
    abgeschlossenen Einsatz; 404 für einen fremden Einsatz.
  - Genau eine Anordnung im Wortlaut der Spec, auch bei ausgeschaltetem Auto-ETB. Sie trägt
    `auftrag_id`, und die ursprüngliche Anordnung bleibt unverändert.
  - Die Auto-Erinnerung ist geschlossen, eine manuelle Erinnerung zum Auftrag bleibt offen.
  - Quittieren, Vollzug (auch die Rücknahme) und Abnehmen danach ergeben 422.
  - Das Live-Ereignis `auftrag` kommt nach dem Commit, bei einem Fehler kommt nichts.

  Nachweis: rot belegt.
- [ ] 2.2 `src/auftrag/etb_text.rs` (neu, rein, mit Unit-Tests) für „aufgehoben“ und „geändert“
  umsetzen, ebenso `AUFHEBUNGSGRUND_MAX`. Dazu `repo::aufheben_tx` im `write_retry!` (Prüfung,
  Spalten, ETB, `schliesse_offene_auto_tx`) und den Handler `aufheben`. Route in `src/app.rs`
  eintragen. Quittieren, Vollzug und Abnehmen sperren den aufgehobenen Auftrag, das Quittieren über
  die Bedingung im `UPDATE` (D6). Nachweis: 2.1 grün, `tests/auftrag.rs` grün.
- [ ] 2.3 Den Spiegel der Grenze in `api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs`
  eintragen, Szenario „Zu langer Aufhebungsgrund“ in `tests/eingabegrenzen_auftrag.rs`. Nachweis:
  beide grün.

## 3. Backend: Berichtigen (D6, D7)

- [ ] 3.1 Test zuerst in `tests/auftrag_berichtigen.rs` (neu). Abgedeckt sind:
  - Teil-Patch je Feld, `null` leert ein optionales Feld, ein fehlendes Feld bleibt.
  - Empfänger ersetzen: Zusammenführen gleicher Empfänger, Funktions-Snapshot, 50er-Grenze.
  - 422 nach einer Quittung, im Status „in Arbeit“, „vollzogen“ und „aufgehoben“.
  - 400 für einen zu langen Text und für einen leeren Auftragstext.
  - Ein Patch ohne Änderung schreibt kein ETB und sendet kein Ereignis.
  - Genau eine Anordnung, die die geänderten Felder nennt: Frist in der Zeitzone des Einsatzes,
    Text wörtlich, Schemafeld nur mit Namen.
  - Die Frist verschiebt die Erinnerung und setzt den Auslöser zurück. Eine entfernte Frist
    schließt sie, eine neue Frist legt sie an.
  - Das Flag `berichtigbar` in der Antwort und in der Liste.
  - Rechte und Statuscodes wie beim Aufheben.

  Nachweis: rot belegt.
- [ ] 3.2 `AuftragPatch`, `repo::berichtigen_tx` im `write_retry!` und den Handler `berichtigen`
  (`.patch(...)` an der Detail-Route) umsetzen. `validiere_empfaenger` und `empfaenger_schluessel`
  auf `pub(crate)` öffnen und teilen. Nachweis: 3.1 grün, `tests/auftrag.rs` und
  `tests/auftrag_erteilen_freigabe.rs` grün.
- [ ] 3.3 Den Wächtertest der Allowlist des Abschnittsgeräts in `src/geraet/mod.rs` um
  `POST …/aufheben` und `PATCH …/auftraege/{aid}` als verboten ergänzen. Nachweis: Test grün und
  rot belegt, wenn die Route testweise in die Allowlist kommt.
- [ ] 3.4 `scripts/check-typ-codegen.sh` laufen lassen, danach `openapi.json` und
  `types.generated.ts` committen. Request-Typen `AuftragPatch` und `AuftragAufheben` in
  `api/types.ts`. Nachweis: Skript grün.

## 4. Frontend: Status und Zahlen (D8, D10)

- [ ] 4.1 Test zuerst:
  - `kommunikation/phase.test.ts`: `aufgehoben` mit dem Etikett „Aufgehoben“, Phase
    `abgeschlossen` und Ton `neutral`.
  - `kommunikation/kartenKante.test.ts` bzw. `StatusBadge`: Der Ton-Override schlägt die Phase.
  - `pages/fuehrung/ueberblickDaten.test.ts`: Die Bilanz zeigt „1 von 2“ für vollzogen, offen und
    aufgehoben.
  - `lageberichte/fuehrungsproblemeUebernahme.test.ts`: Der aufgehobene überfällige Auftrag fehlt.
  - `geraet/GeraetAuftraegePage` filtert ihn heraus.
  - `api/auftraege`: Der Abschluss-Cursor nimmt `aufgehoben_at` zuerst.

  Nachweis: rot belegt, `lage/verdichtungFixture.test.ts` rot mit dem neuen Fixture-Fall.
- [ ] 4.2 Umsetzen: `StatusDeskriptor.ton` und `AUFTRAG_STATUS.aufgehoben`, dazu `phaseTon` und
  `StatusBadge`. Ebenso `auftragAbschlussCursor`, die Bilanz in `ueberblickDaten.ts`,
  `test/auftraegeAttrappe.ts` und die Client-Regel im Fixture-Test. Vorher
  `grep -rn "bearbeitungsstatus\|AuftragBearbeitungsstatus" frontend/src` nach weiteren
  Konsumenten absuchen und jeden Treffer prüfen. Nachweis: 4.1 grün, `kopfStatus.guard.test.ts`
  und `wortlaut.guard.test.ts` grün.

## 5. Frontend: Aufheben (D9)

- [ ] 5.1 Test zuerst in `auftraege/AuftragAufhebenDialog.test.tsx` und
  `pages/AuftraegePage.test.tsx`. Abgedeckt sind:
  - Menüeintrag „Auftrag aufheben“ rot hinter dem Trenner, nur mit Schreibrecht.
  - Der Dialog verlangt einen Grund und sendet `{ grund }`.
  - Der Bestätigungsknopf heißt „Auftrag aufheben“.
  - Der Fehler steht im Dialog, und der Dialog bleibt offen; es gibt keinen Rückgängig-Toast.
  - Die Karte steht danach unter „Abgeschlossen“ mit „Aufgehoben“, Grund, Zeit und Name.
  - Ein abgenommener Auftrag hat keinen Eintrag.

  Nachweis: rot belegt.
- [ ] 5.2 `hebeAuf` in `api/auftraege.ts` (neben `nimmAb`), den Dialog, `MenueAusloeser` an
  `AuftragKarte` und die Mutation in `AuftraegeListe` umsetzen (Invalidierung `auftraege` samt
  `modulZaehler`). Nachweis: 5.1 grün, `rueckfrage.guard.test.ts` grün,
  `e2e/knopf-wortlaut.spec.ts` unverändert grün.

## 6. Frontend: Berichtigen (D9)

- [ ] 6.1 Test zuerst in `auftraege/AuftragFormular.test.tsx` und `pages/AuftraegePage.test.tsx`.
  Abgedeckt sind:
  - „Berichtigen“ öffnet das Formular vorbelegt mit dem Titel „Auftrag #4 berichtigen“.
  - Eine geänderte Frist sendet nur `frist_at`; ohne Änderung wird nichts gesendet.
  - Ein geleertes Schemafeld sendet `null`.
  - Der Knopf heißt „Berichtigung speichern“.
  - Bei `berichtigbar = false` ist der Eintrag gesperrt mit dem Grund „Schon quittiert, nur noch
    aufheben“.
  - Eine Live-Aktualisierung überschreibt die Eingabe nicht.
  - Der Fehler steht am Formular.

  Nachweis: rot belegt.
- [ ] 6.2 Modus `berichtigen` in `AuftragFormular` (Vorbelegung, Patch-Bildung als reine
  Funktion), `patcheAuftrag` in `api/auftraege.ts` und die Einbindung in `AuftraegeListe`
  umsetzen. Nachweis: 6.1 grün, `pnpm lint` und `tsc` grün.

## 7. Doku

- [ ] 7.1 Kapitel `docs/anwender/kapitel/auftraege-befehle.md` nachziehen
  (`docs/anwender/AGENTS.md`, Mitänderungsregel):
  - Überblick: Lebenslauf mit „aufgehoben“.
  - Neue Abläufe „Einen Auftrag berichtigen“ und „Einen Auftrag aufheben“, je mit der Rolle davor.
  - Hintergrund „Aufträge im Einsatztagebuch“ (die zwei neuen Anordnungen) und „Fristen und
    Alarm“ (Erinnerung beim Aufheben und Berichtigen).
  - `quellen` um den neuen Dialog ergänzen.

  Nachweis: `hilfe/anwenderdoku.guard.test.ts` grün.
- [ ] 7.2 Das Bild `auftraege-liste` neu erzeugen (`pnpm doku:bilder --grep auftraege-befehle`,
  hell und dunkel, je höchstens 300 KB). Nachweis: Bilder im Commit, Guard grün. Geht es in der
  Sitzung nicht, steht der Grund hier, und die CI des PRs belegt die Bilder.

## 8. e2e und Gate

- [ ] 8.1 e2e `e2e/auftrag-aufheben.spec.ts` (neu): als Einsatzleitung einen Auftrag erteilen, über
  das Menü aufheben (Grund), „Abgeschlossen“ wählen, dann stehen „Aufgehoben“ und der Grund dort.
  Ein zweiter Fall: Frist berichtigen, im ETB steht „geändert“. Als Beobachter fehlen beide
  Handlungen (Regeln aus `e2e/AGENTS.md`). Nachweis: Spec grün (Chromium).
- [ ] 8.2 `origin/alpha` hereinholen (LLH-1091 und LLH-1084 prüfen, Migrationsnummer prüfen),
  dann `./scripts/check-all.sh` grün, dazu Vitest und die Rust-Tests der berührten Dateien.
  Nachweis: Lauf ohne Fehler; das Kästchen wird mit Verweis auf diesen Lauf bzw. die CI des PRs
  abgehakt.
