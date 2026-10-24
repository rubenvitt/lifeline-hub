# Tasks

Jede Aufgabe per `superpowers:test-driven-development` (erst der rote Test). Pfade ohne Präfix im
Frontend relativ zu `frontend/src/`.

## 1. Server: letzte Besetzung festhalten (D1)

- [x] 1.1 Migration mit der nächsten freien Nummer über `origin/alpha`
      (`scripts/check-migrationen.sh`): Tabelle `einsatz_einheit_letzte_besetzung` (Art, genau ein
      Dispo-Verweis per CHECK, `ist_fuehrer`, `auf_fahrzeug_id`, `menge`, Index auf `einheit_id`)
      und `einsatz_einheit.besetzung_festgehalten INTEGER NOT NULL DEFAULT 0`
- [x] 1.2 Test in `einheit::repo`: Auflösen einer Einheit mit Führer, zwei Personen (eine auf
      einem Fahrzeug der Einheit), einem Fahrzeug und Material mit Menge 2 hält genau das fest und
      setzt das Kennzeichen; dann `aufloesen_tx` so erweitern, dass es vor dem Lösen liest und nach
      `!geloescht` schreibt
- [x] 1.3 Test: gelöschte Einheit (ohne Spur) und stornierte Einheit halten nichts fest
- [x] 1.4 Wächter nachziehen, die die neue Tabelle und Spalte melden: Schwärzungsregister
      (`einsatz::schwaerzung_registry`, FK-Prüfung), Zustandswächter der Kräftetabellen
      (Ausnahme mit Grund: liest bewusst nicht-aktive Kräfte, filtert `storniert`), Löschen eines
      Einsatzes und Demo-Import/-Löschen, falls ihre Wächter die Tabelle verlangen

## 2. Server: auf dem Draht (D2)

- [x] 2.1 DTOs `LetzteBesetzung`, `LetztePerson`, `LetztesFahrzeug`, `LetztesMaterial` in
      `src/einheit/mod.rs`, Feld `letzte_besetzung` an `EinheitAnzeige` (fehlt statt `null`)
- [x] 2.2 Test: `list_aufgeloeste` liefert die festgehaltene Besetzung mit Namen aus den
      Dispositionszeilen; eine danach stornierte Person fehlt; eine Einheit ohne Kennzeichen trägt
      kein Feld; eine ohne Kräfte festgehaltene trägt drei leere Listen; `liste` (aktiv) trägt nie
      eins. Dann je Art eine gebündelte Abfrage implementieren
- [x] 2.3 `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten

## 3. Server: ETB-Verweis (D4)

- [x] 3.1 Test in `routes::einsatz_einheit` bzw. `einheit::repo`: Auflösen mit Spur verknüpft den
      System-Eintrag in `etb_eintrag_einheit`; Auflösen ohne Spur und Stornieren verknüpfen nichts;
      dann `end_einheit` erweitern
- [x] 3.2 Test in `etb::repo`: `einheiten` an Liste und `laden` (Auftragseintrag mit zwei
      Empfängern, Eintrag der Auflösung, Handeintrag leer); Filter `einheit_id` findet den Eintrag
      der Auflösung. Dann `einheiten_nachladen` nach dem Muster `folgeauftraege_nachladen`, Kommentar
      am Filter berichtigen
- [x] 3.3 Typ-Codegen erneut, generierte Dateien mitcommitten

## 4. Frontend: lesende Ansicht (D3)

- [x] 4.1 `KraftZeitachse` mit `lesend`: Vitest, dass weder „Nachtragen“ noch Streichen-Knöpfe noch
      Rechte-Hinweis erscheinen; dann umsetzen
- [x] 4.2 `pages/einheit/EinheitAufgeloestAnsicht.tsx`: Vitest mit Schreibrecht und allen Freigaben
      — Kopf „aufgelöst“ mit Zeit, Kopfdaten, Besatzung nach Fahrzeugen mit Führer, Material mit
      Menge, Zeitachse; **keine** Bedienelemente (kein `button`, `textbox`, `combobox`, `menu`
      außer Links); ohne `letzte_besetzung` der Hinweis „nicht festgehalten“; Links nur mit
      Freigabe des Moduls. Dann umsetzen
- [x] 4.3 `EinheitDetailPage`: Vitest für den Rückfall (aktiv nicht gefunden → aufgelöste
      abgefragt → lesende Ansicht; dort auch nicht → „gibt es nicht (mehr)“; aktive Einheit fragt die
      aufgelösten nicht ab). Dann umsetzen

## 5. Frontend: Einstiege

- [x] 5.1 `EinheitenPage`: Block „Aufgelöst“ mit `ziel` auf `einheitDetailPfad` (Vitest: der Name
      ist ein Link auf die Ansicht)
- [x] 5.2 `etb/EtbBacklinkBadges.tsx` und `hatVerknuepfung`: Verweis „Einheit «Name» ↗“ je
      Einheit, ↗ `aria-hidden`; Vitest für Verweis, zugänglichen Namen und Einzelstehen eines
      Systemeintrags mit Verweis
- [x] 5.3 e2e `e2e/einheit-aufgeloest.spec.ts`: Einheit mit Person bilden, eintreffen lassen (Spur),
      auflösen, im ETB am Eintrag „aufgelöst“ den Verweis anklicken → lesende Ansicht zeigt
      „aufgelöst“, die Person und keinen Knopf (Regeln: `frontend/e2e/AGENTS.md`)

## 6. Doku und Abschluss

- [x] 6.1 Anwenderdoku `docs/anwender/kapitel/einheiten.md`: aufgelöste Einheit öffnen
      (Mitänderungsregel, `docs/anwender/AGENTS.md`)
- [x] 6.2 Kommentar in `EntlassenBlock` (`ziel` fehlt nicht mehr für Einheiten) und Dateikopf von
      `EinheitDetailPage` nachziehen
- [ ] 6.3 `./scripts/check-all.sh` grün (bzw. die CI des PRs)
- [ ] 6.4 Review (`superpowers:requesting-code-review`), dann `/opsx:archive` im selben Branch
