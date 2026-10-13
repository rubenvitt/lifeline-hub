# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Die Nachweise von 1.3–2.2 stehen als Integrationstests in `tests/befehl_quittung.rs` (über
die Routen statt im Repo, ein Testbinary weniger); Mutationsproben: `OR` statt `AND NOT EXISTS`
in der Quittierbarkeit und ein UPDATE ohne `quittiert_at IS NULL` machen sie rot. Pfade ohne Präfix sind im Frontend relativ zu `frontend/src/`, im Backend relativ zum
Wurzelverzeichnis des Repos. Zunder: https://zunder.rubeen.dev/#/aufgabe/koiqi51uupnmhnuaiww3wgq3

## 1. Backend: Spalten und Lesen (D1, D2, D6)

- [x] 1.1 Nummer prüfen mit `git fetch origin alpha && scripts/check-migrationen.sh`. Dann
  `migrations/0186_verteiler_quittung.sql` anlegen: `quittiert_at` und `quittiert_von_id` an
  `befehl_verteiler` und `lagebericht_verteiler`, im Kopfkommentar LLH-1173 und diese Change.
  Nachweis: `scripts/check-migrationen.sh` meldet keinen Konflikt.
- [x] 1.2 Schwärzung: In `src/einsatz/schwaerzung_registry.rs` behalten beide Tabellen
  `quittiert_at` (`G_ZEIT`) und `quittiert_von_id` (`G_FK`). Nachweis: Der Wächter
  `jede_einsatz_scoped_spalte_ist_klassifiziert` ist grün. Gegenprobe: Ohne die Regel wird er rot.
- [x] 1.3 `json_column`/`from_json` lesen die Quittung mit, `VerteilerEintragAnzeige` trägt
  `quittiert_at` und `quittiert_von_id` (optional). Nachweis: Ein Repo-Test belegt, dass eine
  frische Zeile ohne Quittung geladen wird.
- [x] 1.4 `is_quittierbar` an `Dokument` und `DokumentKopf` nach D2, `BefehlAnzeige` und
  `BefehlKopf` tragen es. `liste_koepfe` liest den Verteiler, und `BefehlKopf` trägt ihn.
  `LageberichtKopf` und `LageberichtAnzeige` bleiben ohne neue Felder. Nachweis: Repo-Tests für
  Entwurf → falsch, v1 freigegeben → wahr, v2 Entwurf → v1 wahr, v2 freigegeben → v1 falsch.
  Ein Test zeigt, dass die Kopfliste der Befehle den Verteiler in Reihenfolge trägt und die der
  Lageberichte ihn nicht nennt.
- [x] 1.5 Fortschreiben kopiert keine Quittung. Nachweis: Ein Repo-Test quittiert in v1,
  schreibt fort und prüft, dass die Zeilen in v2 offen sind und v1 die Quittung behält.

## 2. Backend: Quittieren und Zurücknehmen (D3, D4, D5)

- [x] 2.1 `verteiler::quittieren_tx` und `zuruecknehmen_tx` nach D3 mit bedingtem UPDATE. Den
  ETB-Eintrag nach D4 (System, `von` = Anzeigename, Inhalt mit Fassung und Nr. des
  Freigabe-Eintrags) schreiben nur bei Wirkung. Nachweis: Repo-Tests für Quittieren setzt
  Zeitpunkt und Person, doppelt Quittieren ändert nichts und schreibt kein zweites ETB, Rücknahme
  leert und schreibt den Gegeneintrag, Rücknahme an einer offenen Zeile schreibt nichts, Entwurf
  ergibt 422, überholte Fassung ergibt 422 und lässt die Quittung stehen, fremde Zeile ergibt 404.
- [x] 2.2 Kernhandler in `src/routes/vorlagendokument.rs` (`fordere_schreiben`, `write_retry!`,
  Live nach D5), Routen in `src/routes/befehl.rs` und `src/app.rs`. Nachweis: neue Datei
  `tests/befehl_quittung.rs` mit 200 und Anzeige, ETB-Eintrag mit Wortlaut, `von` und `an`
  „System“, 403 ohne Schreibrecht, 404 bei fremdem Einsatz und fremder Zeile, 422 am Entwurf und
  an überholter Fassung, Live-Ereignis `befehl` ohne `nur_inhalt`.
- [x] 2.3 `tests/aufbewahrung_e2e.rs`, `AUSNAHMEN_SYSTEM_ETB`: Einträge für `quittieren_tx` und
  `zuruecknehmen_tx` je `befehl_verteiler.snap_anzeige`, `.funktion_text` und
  `.extern_bezeichnung` (Gruppe `Fuehrungsmodul`). Nachweis: Der Selbsttest der Liste ist grün.
- [x] 2.4 Typ-Codegen: `scripts/check-typ-codegen.sh`, beide generierten Dateien
  mitcommitten. Prüfen, ob Zulassungs- und Routenwächter (`tests/zulassung_guard.rs`, Liste der
  Geräte-Routen) einen Eintrag für die neuen Routen verlangen. Nachweis: Das Skript und
  `cargo test` sind grün.

## 3. Frontend: gemeinsame Bausteine (D7)

- [x] 3.1 `Quittungsstand({ anzahl, quittiert })` aus `AuftragQuittungsstand`. Auftragskarte und
  Auftragsdetail stellen um. Nachweis: Die bestehenden Auftragstests sind unverändert grün.
- [x] 3.2 `auftraege/EmpfaengerQuittung.tsx` aus dem Körper von `AuftragEmpfaenger` mit neutralen
  Zeilen und optionaler `rueckfrage`. `AuftragEmpfaenger` wird zur Hülle. Nachweis:
  `AuftragTeile`- und Gerätetests sind unverändert grün. Ein neuer Test zeigt, dass ohne
  `rueckfrage` ein Klick direkt `onQuittieren` ruft und mit `rueckfrage` erst die Bestätigung.
- [x] 3.3 `auftraege/EmpfaengerFilter.tsx` und `trifftEmpfaenger`, `AuftraegeListe` stellt um.
  Nachweis: Die Tests des Empfängerfilters der Aufträge sind unverändert grün, und ein
  Unit-Test prüft `trifftEmpfaenger` für Abschnitt, Einheit, Funktion und keinen Verteiler.

## 4. Frontend: Befehl

- [x] 4.1 `api/befehle.ts`: `quittiereBefehlEmpfang` und `nimmBefehlQuittungZurueck`.
- [x] 4.2 `BefehlListenKarte`: Verteilernamen und bei freigegebenen Befehlen der
  `Quittungsstand`. Nachweis: Komponententest für einen freigegebenen Befehl mit Verteiler
  („2 Empfänger · 1/2 quittiert“), einen Entwurf (Namen ohne Stand) und einen Befehl ohne
  Verteiler (keine Zeile).
- [x] 4.3 `BefehlDetail`: Block „Verteiler“ mit `EmpfaengerQuittung`, Quittieren ohne Rückfrage,
  `zeigeRueckgaengig` mit Rücknahme, Fehler je Zeile, Knopf nur bei `darfSchreiben &&
  is_quittierbar`. Nachweis: Komponententests für Quittieren mit Rückgängig, überholte Fassung
  ohne Knopf, Beobachter ohne Knopf und Ablehnung mit Grund am Block.
- [x] 4.4 `BefehlListe`: Empfängerfilter, Filter im Client, Segmentzahlen zählen das Gefundene.
  `pages/AuftraegePage.reiter.test.tsx` wird umgestellt: Beide Reiter tragen den
  Empfängerfilter, nur die Aufträge die Richtung. Nachweis: Test mit Filter auf einen Abschnitt.
  Bereichskopf zählt den Bestand.
- [x] 4.5 `pnpm lint` und `pnpm typecheck` sind grün. Der Wortlautwächter
  (`kommunikation/wortlaut.guard.test.ts`) ist grün.

## 5. e2e und Doku (D8)

- [ ] 5.1 e2e in `e2e/auftraege-befehle-liste-detail.spec.ts`: Befehl mit Verteiler freigeben,
  im Detail quittieren, Karte zählt „1/1 quittiert“, Rückgängig, Karte zählt „0/1“. Nachweis:
  Die Spec ist lokal grün (`PW_PROJEKTE=chromium`).
- [ ] 5.2 Kapitel `docs/anwender/kapitel/auftraege-befehle.md` nach D8, Bildlauf
  `e2e/doku-bilder/auftraege-befehle.bilder.ts` mit Verteiler und Quittung, Bild
  `befehl-detail.png` hell und dunkel neu. Nachweis: `src/hilfe/anwenderdoku.guard.test.ts` ist
  grün.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh --geaendert` lokal grün, soweit die Umgebung es erlaubt. Den
  vollen Lauf belegt die CI des PRs.
- [x] 6.2 Folgeaufgabe „Abschnittsgerät quittiert Einsatzbefehle“ auf dem Board anlegen
  (`zunder-task-anlegen`) und hier verlinken: LLH-1190,
  https://zunder.rubeen.dev/#/aufgabe/lxlrhstatrfr70dcomgayx43
