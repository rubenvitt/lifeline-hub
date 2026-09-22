# Tasks

## 1. Backend: ETB-Zählung

- [x] 1.1 Die Filterfelder in `src/etb/repo.rs` in `EtbZaehlFilter` herauslösen (`EtbFilter` enthält ihn plus Cursor und Limit). Die gemeinsame Funktion `filter_bedingung(qb, einsatz_id, filter)` schreibt FTS-Join und WHERE. `abfrage` nutzt sie. Verifikation: Die bestehenden ETB-Tests (`cargo test --test etb*`) bleiben grün, ohne dass ein Test angepasst wird.
- [x] 1.2 `EtbZaehlerAnzeige`/`EtbTypZaehler` (`Serialize`, `ToSchema`) in `src/etb/` anlegen. `repo::zaehle` baut `GROUP BY e.typ` über `filter_bedingung` und befüllt die Felder per vollständigem `match` über `EtbTyp`; `gesamt` ist die Summe. Verifikation: Ein Unit-Test in `repo` zählt einen gemischten Einsatz korrekt, und Σ je_typ = gesamt.
- [x] 1.3 Das Parsen der Parameter in `src/routes/etb.rs` in eine gemeinsame Funktion ziehen (Typ → 400, `normalisiere_zeit`, `q` trimmen), die `liste` und der neue Handler `zaehler` nutzen. Route `GET /api/einsaetze/{id}/etb/zaehler` in `src/app.rs`, Gates wie bei der Liste. Verifikation: Die neuen Integrationstests in `tests/etb_zaehler.rs` sind grün.
- [x] 1.4 Integrationstests `tests/etb_zaehler.rs`:
  - gemischter Einsatz mit 0 für leere Typen
  - mehr als 100 Einträge ergeben den vollen `gesamt`
  - Fremd-Einsatz zählt nicht
  - `q`, `typ`, `von`/`bis` (Grenzen inklusive) und `erfasser_id` je gegen die seitenweise vollständig geladene Liste mit denselben Parametern (Paritätstest), dazu `q=*`
  - `typ=unsinn` → 400, unlesbares `von` → 400
  - Beobachter → 200, ausgeblendetes Modul `etb` → 403, unbekannter Einsatz → 404

  Mutationsprobe: Den Typfilter nur in der Liste anwenden, dann wird der Paritätstest rot.

## 2. Backend: Modulzähler

- [x] 2.1 `erlaubte_module` aus `src/routes/live.rs` nach `src/einsatz/berechtigung.rs` verschieben (pub) und in `/live` von dort rufen. Verifikation: Die Live-Tests (`cargo test --test live*`) bleiben grün.
- [x] 2.2 `fn ist_offen(AuftragBearbeitungsstatus) -> bool` mit vollständigem `match` im Modul `auftrag` einführen. Verifikation: Ein Unit-Test legt alle vier Status als Literal-Paar fest (offen/in_arbeit → true, vollzogen/abgenommen → false).
- [x] 2.3 DTOs `ModulZaehlerAnzeige` mit Unterstrukturen (`MengenZaehler`, `MeldungsZaehler`, `AuftragsZaehler`, `ErinnerungsZaehler`, `ChatZaehler`) anlegen. Alle Felder sind `Option` mit `skip_serializing_if`. Die Zählfunktionen nach der Tabelle in design.md D4 schreiben: COUNT für die vier Mengen, Wiederverwendung der Listenfunktionen für die vier Kommunikationsmodule. Verifikation: Ein Unit-Test prüft, dass jeder Feldname ein Eintrag aus `MODUL_KEYS` ist.
- [x] 2.4 Neue Datei `src/routes/modul_zaehler.rs` mit dem Handler (`EinsatzLesezugriff`, Marker `OhneModul`), der nur erlaubte Felder füllt. Route in `src/app.rs`, `PFAD_KEY`-Eintrag mit Kommentar in `src/einsatz/modul.rs`, Modul in `src/routes/mod.rs`. Verifikation: `cargo test --test einsatz_kontext_guard` ist grün.
- [x] 2.5 Integrationstests `tests/modul_zaehler.rs`:
  - volle Antwort mit Mengen (Person storniert zählt nicht)
  - Parität Meldungen/Aufträge/Erinnerungen gegen die jeweiligen Listen-Endpunkte
  - Chat je Benutzer verschieden
  - leeres Modul ergibt 0
  - ausgeblendetes Modul fehlt: Presence per `as_object().contains_key`, nicht per `== Null`
  - Org-Rollensperre fehlt
  - System-Admin sieht alles
  - ohne Lesezugriff → 403, unbekannt → 404

  Mutationsprobe: Den Rechtefilter entfernen, dann wird „ausgeblendetes Modul fehlt“ rot.
- [x] 2.6 Schemas in `src/api_doc.rs` registrieren, `scripts/check-typ-codegen.sh` ausführen, `openapi.json` und `types.generated.ts` mitcommitten und Aliasse im Barrel `frontend/src/api/types.ts` ergänzen. Verifikation: Das Skript endet mit Exit 0, und `cargo test --test openapi_spec_aktuell` ist grün.

## 3. Frontend: Modulzähler

- [x] 3.1 `api/modulZaehler.ts` (`ladeModulZaehler`), Präfix `modul-zaehler` in `EINSATZ_KEYS` und Accessor `einsatzKeys.modulZaehler(id)` anlegen. In `EINSATZ_STREAM_EVENTS` den Key bei jedem Ereignis ergänzen, das einen gezählten Listen-Key invalidiert. Verifikation: `queryKeys.guard.test.ts` und `globalKeys`/Byte-Pin-Tests bleiben grün, der Byte-Pin gilt für das neue Literal.
- [x] 3.2 Vollständigkeitstest in `api/queryKeys.test.ts`: Jedes Ereignis, das einen der gezählten Listen-Keys invalidiert, invalidiert auch `modulZaehler`. Die Menge der gezählten Keys stammt aus der Abbildung, die der Hook nutzt. Verifikation: Die Mutationsprobe (Eintrag bei `erinnerung` entfernen) färbt den Test rot.
- [x] 3.3 In `einsatz/modulRegistry.ts` `ModulZaehlerQuelle` um `etb | personen | einheiten | einsatzabschnitte` erweitern und `zaehlerQuelle` an den vier Modulen setzen. Verifikation: `modulRegistry`-Tests grün, `tsc` ohne Fehler.
- [x] 3.4 `einsatz/useModulZaehler.ts` umbauen: Eine Query auf `modulZaehler` ersetzt die vier Listenabfragen. Reine Abbildungsfunktionen Serverfeld → `{wert, beschreibung}` mit byte-gleichem Wortlaut für die vier Bestandszähler, dazu neue Beschreibungen (ETB, Betroffene, Einheiten, Einsatzabschnitte, jeweils Ein- und Mehrzahl). Die Anzeige bleibt an Sichtbarkeit und Sperre gebunden. Verifikation: `useModulZaehler.test.ts` ersetzt die alten Rechentests durch Abbildungstests mit denselben Wortlaut-Paaren; fehlendes Feld → `undefined`.
- [x] 3.5 Hooktest `einsatz/useModulZaehler.hook.test.tsx` (der Rahmentest mockt den Hook): Es geht kein Request an die Listen-Endpunkte von Meldungen, Aufträgen, Erinnerungen und Chat-Kanälen; der Zähler „Betroffene 248“ erscheint mit zugänglichem Namen. Verifikation: Der Test ist grün, und die Mutationsprobe (alte Listenquery zurück) macht ihn rot.
- [x] 3.6 `pages/ChatPage.tsx`: Nach dem Markieren als gelesen (beide Stellen) auch `modulZaehler` invalidieren. Verifikation: Ein Test in `ChatPage.test.tsx` belegt die Invalidierung.

## 4. Frontend: ETB-Kopf und Bilanz

- [x] 4.1 In `api/etb.ts` die Filterabbildung auf Query-Parameter mit `listeEtb` teilen und `ladeEtbZaehler(einsatzId, filter)` anlegen. Accessor `einsatzKeys.etbZaehler(id, filter)` unter dem Präfix `etb` anlegen. Verifikation: Der Unit-Test prüft dieselben Parameter für Liste und Zählung.
- [x] 4.2 `etb/zeitachseModell.ts`:
  - `kopfMeta({gesamt, filterAktiv})` → „n Einträge“ bzw. „n Treffer“, bei `undefined` kein Meta
  - `typBilanz(jeTyp)` aus dem Serverobjekt
  - `bilanzUmfang` entfernen

  Verifikation: Die Modelltests sind angepasst, mit Einzahl, Mehrzahl, Filter und `system` nur bei > 0.
- [x] 4.3 `etb/EtbBilanz.tsx`:
  - Props `zaehler` und `filterAktiv`, Titel „Bilanz“ bzw. „Bilanz im Filter“
  - Balken gegen `gesamt`, Beschriftung „… von n Einträgen/Treffern“
  - Lade- und Fehlerhinweis
  - Dateikommentar neu

  Verifikation: `EtbBilanz`-Tests.
- [x] 4.4 `pages/EtbPage.tsx`: Zählquery mit demselben Filter wie die Liste, Kopf und Bilanz daraus. Verifikation: `EtbPage.test.tsx`:
  - 100 geladen bei `gesamt` 412 → „412 Einträge“
  - Filter → „7 Treffer“ und „Bilanz im Filter“
  - Zählfehler → keine Gesamtzahl, Liste bedienbar

## 5. Abschluss

- [x] 5.1 In `CLAUDE.md` den Verweis `EtbTabelle.tsx:117-119` und die ETB-Stellen, die sich auf die fehlende Gesamtzahl berufen, auf den neuen Stand bringen. Verifikation: `grep -n "EtbTabelle.tsx:117" CLAUDE.md` findet nichts mehr.
- [ ] 5.2 Gesamt-Gate `./scripts/check-all.sh` ausführen. Verifikation: Exit 0, ohne `| tail`.

  Stand 22.09.2026: Schritte 1–4 (Format, Lint, Typ-Drift/tsc, Rust-Suite Workspace) zweimal
  grün. Schritt 5 (Vitest) meldete 13 Fehlschläge in 6 Dateien, alle als `Test timed out in
  10000ms` und alle in Dateien, die diese Änderung nicht anfasst. Die Zuordnung ist gemessen,
  nicht vermutet: dieselbe Datei abwechselnd mit und ohne den neuen MSW-Default-Handler aus
  `src/test/server.ts` — 4/4 rot in BEIDEN Fassungen bei Load ~100, 6/6 Dateien grün bei
  Load ~36 (Fremdlast anderer Sessions, [[frontend-testsuite-parallel-timeouts]]). Die
  Schritte 6–9 (Abhängigkeits-Audit, e2e, Ruhefenster-Selbsttest, check-deps-Selbsttest)
  sind in diesem Ticket noch nicht bis zum Ende gelaufen; ein Lauf bei ruhiger Maschine steht
  aus. e2e ist gegen diese Änderung gegriffen: kein Spec prüft die Kopfzahl-Wortlaute oder
  die Bilanz-Zeile, `etb-chronologie.spec.ts` hängt nur am unveränderten `aria-label`
  „Bilanz des Tagebuchs".
- [x] 5.3 Sichtprüfung im Browser — gegen ein echtes Backend (eigene DB, Port 8099) mit
      produktivem Frontend-Build, Daten über die API angelegt (25 ETB-Einträge plus 14
      System-/Modul-Einträge, 5 Betroffene, 2 Einheiten, 2 Abschnitte, 3 Meldungen,
      2 Aufträge, 1 Erinnerung):
  - Modulpanel je Kategorie: „ETB, 39 Einträge im Einsatztagebuch" · „Personen, 5 Betroffene" ·
    „Einheiten, 2 Einheiten" · „Einsatzabschnitte, 2 Einsatzabschnitte" · „Meldungen
    (eingehend), 3 offene Meldungen, davon 3 ungesehen" · „Aufträge/Befehle, 2 offene
    Aufträge, davon 1 überfällig" · „Erinnerungen, 2 fällige Erinnerungen". Chat steht bei
    `ungelesen: 0` OHNE Zahl.
  - ETB-Kopf „39 Einträge", Leiste „BILANZ / 39 Einträge" mit Meldungen 17 · Anordnungen 8 ·
    Entscheidungen 2 · Lagemeldungen 3 · Berichtigungen 0 · Systemeinträge 9 — deckungsgleich
    mit `GET …/etb/zaehler`. Der Fall „mehr als 100 Einträge" ist hier nicht gestellt worden
    (40 Einträge); er ist in `EtbPage.test.tsx` gepinnt (Serverzahl 412 gegen 101 geladene).
  - Filter `?typ=meldung`: Kopf „17 Treffer", Leiste „BILANZ IM FILTER / 17 Treffer", die
    Systemzeile fällt weg. Der Volltextweg (`q=`) ist im Browser nicht gefahren, sondern in
    `EtbPage.test.tsx` (Kopf „7 Treffer" plus Gleichheit des `q`-Parameters mit der Liste).
  - Live: ein per API angelegter ETB-Eintrag hob OHNE Reload Kopf, Bilanz und Modulzähler
    von 39 auf 40 — das `etb`-Ereignis zieht beide Zählungen mit.
  - Der Chat-Zähler stand auf 0, ohne dass ein Kanal entstand (Review-Fix live bestätigt).
