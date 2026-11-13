# Tasks

Jede Aufgabe entsteht per TDD: zuerst der Test, der ohne die Änderung rot ist.

## 1. Antrag am archivierten Einsatz (Backend)

- [ ] 1.1 `antrag::stellen` nimmt am archivierten Einsatz einen Personen-Antrag an. Am
      geschwärzten Einsatz ohne Archiv bleibt es bei 409. Test in
      `src/aufbewahrung/antrag_tests.rs`: Der bisherige Test
      `archivierter_einsatz_nur_ganz_und_der_vollzug_loescht_das_archiv` wird umgeschrieben;
      dazu „Archiv abgelaufen“ → 409. Kommentar und 409-Text in `antrag.rs` nachziehen.
- [ ] 1.2 Ziel per Kennung (design.md D3): `AntragZielEingabe` mit optionalem `kennung`;
      `ziel_aus` verlangt genau `id` oder `kennung` bei einer Person, sonst 400. `stellen` löst
      `R-`, `EK-` und `IT-` in der Transaktion auf: falsches Präfix 400, keine Zeile 404,
      Stammkraft 422. Tests: Einheitentests in `antrag_tests.rs`, dazu ein Routentest in
      `tests/aufbewahrung.rs`, der per Kennung stellt.
- [ ] 1.3 Purge-Lauf lässt Personen-Anträge am archivierten Einsatz offen (D1): `faellige`
      schließt sie aus, `vollziehen_ergebnis` gibt dort `Vollzug::Nichts` zurück, ohne
      `vollzogen_at` zu setzen. Ist das Archiv abgelaufen, gilt wie bisher „bereits
      geschwärzt“. Tests: offen nach 25 Stunden mit unveränderten Blöcken; vollzogen nach
      Ablauf des letzten Blocks.

## 2. Admin-Spur

- [ ] 2.1 `AdminAktion::ArchivPersonGeschwaerzt` (`archiv_person_geschwaerzt`) und
      `ArchivDurchsucht` (`archiv_durchsucht`) anlegen. Die neue Migration baut den CHECK von
      `admin_audit` nach dem Muster 0340 neu; die Nummer liegt über der höchsten auf
      `origin/alpha`, geprüft mit `scripts/check-migrationen.sh`. Dazu die Varianten in
      `tests/enum_wire_kontrakt.rs`, das Detail in der Doku von `AdminDetail`,
      `scripts/check-typ-codegen.sh` samt beiden generierten Dateien und die Beschriftung im
      Zugangsprotokoll des Frontends. Prüfen mit `jede_aktion_passiert_den_db_check` grün und
      dem Frontend-Test der Beschriftung.

## 3. Block öffnen und neu bauen (Backend-Kern)

- [ ] 3.1 Gemeinsamen Kern aus `einspielen.rs` und `bauen.rs` herauslösen, ohne Verhalten zu
      ändern:
      - einen Block aus Bytes in eine Zwischendatei entschlüsseln und migriert öffnen,
      - eine Zwischendatei verschlüsseln und `sha256`/Größe mitzählen (`Mitzaehlen`),
      - eingespielte Kopien zu einer Menge von `sha256` vormerken (aus `alle_loeschen_tx`).

      Prüfen: Die bestehenden Tests in `src/einsatz/archiv/tests.rs` und
      `src/einsatz/archiv/einspielen/tests.rs` bleiben grün.
- [ ] 3.2 Neues Modul `src/einsatz/archiv/loeschersuchen.rs` (D2): fällige Anträge je Einsatz
      sammeln, Blöcke bauen (entschlüsseln, migrieren, `scrubbe_person` je Antrag,
      `einsatz_aenderung` leeren, `VACUUM`, neu verschlüsseln an `gepruefte`) und in einer
      `write_retry!`-Transaktion ablegen. Abgelegt werden das bewachte `vollzogen_at`, das
      UPDATE je Block mit `sha256 = <alt>` und das Vormerken der Kopien. Tests in
      `src/einsatz/archiv/loeschersuchen/tests.rs` mit echtem Schlüsselpaar:
      - Person in zwei Blöcken entfernt, andere Person unverändert, Nummer und Frist gleich,
        Antrag vollzogen,
      - noch nicht fällig → nichts,
      - falscher Schlüssel → nichts geändert,
      - keine geprüften Schlüssel → nichts geändert,
      - Antrag zwischen Bauen und Ablage zurückgenommen → nichts geändert,
      - Fotos der Person sind im neuen Block auch als Bytes nicht mehr enthalten.
- [ ] 3.3 Alte Blöcke (D4): Test, dass ein vor dem Vollzug gelesener Block danach von
      `einspielen` mit „nicht mehr im Archiv“ abgelehnt wird, und dass eine vorher
      eingespielte Kopie zum Abräumen vorgemerkt ist.
- [ ] 3.4 Spur (D5): je Antrag ein ETB-Systemeintrag mit Aktenzeichen, Art, Kennung und Zahl
      der Blöcke, Erfasser wie beim Purge-Vollzug; je Einsatz `archiv_person_geschwaerzt` in
      der Admin-Spur, in derselben Transaktion. Test: Die Einträge stehen da und enthalten den
      Namen der Person nicht.

## 4. Personensuche im Block (Backend-Kern)

- [ ] 4.1 Neues Modul `src/einsatz/archiv/personen.rs` (D6): gültigen Block entschlüsseln,
      migrieren, `aufbewahrung::suche::personensuche` auf der Zwischendatei ausführen, je
      Treffer Art, Kennung, Erfassungszeit und Namen liefern und `archiv_durchsucht` schreiben.
      Suchtext unter 3 Zeichen → Fehler, ohne Spur. Tests: Treffer mit Namen, Spur ohne
      Suchtext, Archiv unverändert, Zwischendatei danach weg.

## 5. Befehle

- [ ] 5.1 `ArchivBefehl::Loeschersuchen { identitaet, einsatz: Option<i64> }` und
      `ArchivBefehl::Personen { einsatz, identitaet, suche }` in `src/config.rs`, dazu der
      Dispatch und `cmd_archiv_*` in `src/main.rs`: Schlüssel über `identitaet_laden`,
      `db::stand_abweichung`, Abbruch bei Signal. Die Ausgabe nennt je Einsatz die Anträge,
      die Blöcke und die Fehler. Prüfen: Ein Parse-Test der Unterbefehle (Muster der
      vorhandenen CLI-Tests) und ein Lauf von `cargo run -- archiv loeschersuchen --help`.
- [ ] 5.2 Betriebsdoku `docs/betrieb/backup-restore.md`: Abschnitt „Löschersuchen für eine
      Person im Archiv“ mit beiden Befehlen, Schlüsselweg, Abbruchfällen und der Grenze für
      Downloads. Prüfen: Die Befehle laufen so, wie sie dort stehen (`--help`).

## 6. Archivakte (Frontend)

- [ ] 6.1 `antragswege` mit Archivzustand (D7): archiviert → Person per Kennung immer, Einsatz
      ohne offenen Einsatz-Antrag; geschwärzt ohne Archiv → keiner. Tests in
      `Loeschersuchen.test.tsx` (die Fälle zu `geschwaerzt` umschreiben, die neuen Fälle
      dazu).
- [ ] 6.2 Dialog „Person per Kennung schwärzen“: Kennung eingeben, Art aus dem Präfix, dann der
      bestehende `SchwaerzungsantragDialog` mit `{ art, kennung }`. Er nennt den Vollzug per
      Befehl und `archiv personen` als Weg zur Kennung. `antragBody` sendet `kennung` statt
      `id`. Tests: reine Funktionen (Präfix → Art, ungültige Kennung gesperrt, Body)
      und ein Rendertest des Dialogs.
- [ ] 6.3 Hinweis an offenen, fälligen Personen-Anträgen am Archiv: „wartet auf Befehl mit
      Archiv-Schlüssel“. Prüfen mit einem Rendertest in `Loeschersuchen.test.tsx`.
- [ ] 6.4 Anwenderkapitel `docs/anwender/kapitel/aufbewahrung.md` nachziehen (Sätze zu „nur
      ganzer Einsatz“, Abschnitt „Person“, archivierter Einsatz). Bild der Archivakte neu
      aufnehmen, falls das Kapitel eines zeigt. Prüfen mit den Wächtern der Anwenderdoku aus
      `check-all.sh`.

## 7. Regeln und Abschluss

- [ ] 7.1 `src/AGENTS.md`, „Archiv am Hub“: Der Satz „ein Löschersuchen … geht nur ganz“ wird
      ersetzt durch Personen-Antrag per Befehl, offenen Antrag im Purge-Lauf und das Vormerken
      der Kopien. Kapitel 6 der Architekturdoku, falls dort der Ablauf des Archivs steht.
      Prüfen: `grep` nach „nur ganz“ findet nichts mehr.
- [ ] 7.2 `./scripts/check-all.sh` grün (oder die Bündel der berührten Bereiche, dazu der Lauf
      im PR).

## Workflow follow-up

- Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4) über den ganzen Branch.
- Bilder der Archivakte (archivierter Einsatz mit beiden Wegen, Dialog, offener Antrag mit
  Hinweis) für PR und Meldung.
- `/opsx:archive` vor dem PR im selben Branch.
