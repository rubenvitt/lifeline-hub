# Proposal

## Why

Wie lange eine Einheit oder eine Helferin schon im Einsatz ist und wie lange jemand nach der
Ablösung schon ruht, weiß heute nur die Führung im Kopf. Im Lagevortrag gehört die
Einsatzdauer aber zum Einsatzwert (DRK RLP, Lagevortrag II), und die THW-Fassung von S1 ergänzt
Ablösung und Schichtdienst (FwDV 100 Anlage 2). Das System kennt je Kraft nur
`disponiert_at`/`angelegt_at` und den letzten Statuswechsel (`status_seit`, LFH-609). Ein
Verlauf steht allein als Freitext im System-ETB und lässt sich nicht auswerten. LFH-635 hat
Ablösungsschichten je Einheit gebaut, ohne Alarmierung, Eintreffen und Personal-Ebene.

**Bewusster Bruch des Feldbefund-Riegels.** LFH-46 (Entscheidung 17, §13.6) stellt diese
Folge-Spec hinter den Feldbefund der ersten Übung mit echter Fahrzeugbesatzung. Der liegt
nicht vor. Der Nutzer hat am 30.09.2026 entschieden, die Spec trotzdem jetzt zu schreiben.
Die Abweichung gilt nur für LFH-552 und hebt Entscheidung 17 für die übrigen Punkte aus §13
nicht auf. Der Riegel schützt gegen eine Pflege, die im Feld nicht stattfindet. Deshalb
entstehen die Zeitpunkte hier überwiegend aus Statuswechseln, die ohnehin gepflegt werden,
und nicht aus einer zweiten Erfassung.

## What Changes

- Neue **Kräfte-Zeitachse**: ein Ereignisprotokoll je Einheit und je Person im Einsatz mit den
  Arten Alarmierung, Eintreffen, Ablösung und Entlassung. Es ist append-only; eine Berichtigung
  streicht ein Ereignis sichtbar, sie löscht es nicht. Die Zeitachse steht in einer eigenen
  Tabelle nach dem Muster von `br_belegung`, nicht als Spalten an den Dispositionstabellen.
- **Zeitachsen-Marke am Status-Katalog**: Ein Eintrag im Fahrzeug- oder Personal-Status-Katalog
  kann optional eine Marke tragen (Alarmierung, Eintreffen, Entlassung). Ein Wechsel auf einen
  markierten Status schreibt das Ereignis in derselben Transaktion. Bestehende Kataloge
  bekommen keine Marken von selbst; nur die Startlisten neuer Organisationen tragen sie.
- **Fan-out**: Ein Ereignis an einer Einheit gilt auch für die Personen, die ihr in diesem
  Moment zugeordnet sind. Es wird für sie mitgeschrieben und als „über Einheit“ gekennzeichnet.
- **Nachtrag und Streichung** von Hand, mit Zeitpunkt in der Vergangenheit. Beides wird im
  System-ETB festgehalten.
- **Kopplung an die Ablösung (LFH-635)**: Der Vollzug schreibt ein Ablösungsereignis für die
  abgelöste Einheit, die Rücknahme streicht es wieder. Eine neue Schicht ohne Beginn übernimmt
  das Eintreffen der laufenden Einsatzperiode.
- **Ableitungen beim Lesen**: Einsatzperiode, laufende Einsatzdauer (mit genanntem Anker),
  Gesamteinsatzzeit und Ruhezeit. Grenzwerte gibt es nicht, die Werte werden also nicht
  eingestuft.
- **Anzeige**: Spalte „Im Einsatz“ im Meldebild (Kräfteübersicht, auch im Druck), die
  Zeitachse samt Nachtrag auf der Einheit-Detailseite, und die Spalten Einsatzdauer und
  Ruhezeit auf der Personal-Seite des Einsatzes. Ohne Ereignis steht „—“, nie 0.

## Capabilities

### New Capabilities

- `kraefte-zeitachse`: Umfasst die Zeitachse der Einheiten und Personen im Einsatz, also
  Ereignisarten, Entstehung aus Status-Marken, Fan-out, Nachtrag und Streichung,
  Einsatzperioden, Einsatzdauer und Ruhezeit, die Kopplung an die Ablösung sowie Rechte und
  Anzeige.

### Modified Capabilities

- `kraefte-abloesung`: Eine Schicht ohne Beginn übernimmt das Eintreffen der laufenden
  Einsatzperiode der Einheit, sonst wie bisher den Anlagezeitpunkt.

## Impact

- **Datenbank:** Migration `0127` mit der Tabelle `einsatz_kraft_zeitachse` und der Spalte
  `zeitachse_marke` an `fahrzeug_status` und `personal_status`. Die Nummer wird vor dem Merge
  gegen `origin/alpha` geprüft.
- **Backend:** neues Modul `src/zeitachse/`. Berührt werden die Statuswechsel in
  `src/fahrzeug/disposition_repo.rs`, `src/personal/disposition_repo.rs` und
  `src/einheit/repo.rs` samt ihren Routen, außerdem `src/abloesung/` (Vollzug, Rücknahme,
  Beginn), die Kataloge und Startlisten (`src/personal/mod.rs`, Fahrzeug-Startliste,
  `src/auth/bootstrap.rs`), `src/einsatz/schwaerzung_registry.rs`, die Aufbewahrungs-
  Klassifikation, `src/api_doc.rs` und `src/app.rs`.
- **API:** neue Endpunkte unter `/api/einsaetze/{id}/einheiten/…/zeitachse` und
  `/api/einsaetze/{id}/personal/…/zeitachse`. Die Katalog-DTOs bekommen ein optionales
  Feld `zeitachse_marke`. Die übrigen bestehenden Endpunkte bleiben unverändert.
- **Frontend:** `pages/KraefteuebersichtPage.tsx` + `kraefte/meldebildRaster.ts`,
  `pages/EinheitDetailPage.tsx`, `pages/PersonalPage.tsx`, `stammdaten/StatusKatalogTab.tsx`,
  `api/queryKeys.ts`, die generierten Typen und der Meldebild-Druck.
- **Tests und Guards:** `tests/enum_wire_kontrakt.rs`, `tests/einsatz_kontext_guard.rs`, die
  Extractor-Guards, die Schwärzungs- und Aufbewahrungs-Guards, `queryKeys`-Guards und die
  Prüfliste Einsatztauglichkeit für die berührten Seiten.
