# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der Test, der ohne die
Änderung rot ist.

## 1. Zähler folgt der Uhr (D1)

- [ ] 1.1 `fuehrung::repo::next_stand` vergibt `MAX(fuehrung_stand + 1, Unix-Sekunden)`, die
  Sekunden kommen als Parameter einer inneren Fassung. Unit-Tests in `src/instanz/fuehrung/repo.rs`:
  Ein kleiner Zähler springt auf die gesetzte Uhrzeit, ein Zähler über ihr zählt +1, und zwei
  Vergaben in derselben Sekunde bleiben streng steigend. Prüfen: `cargo test instanz::fuehrung::repo`.
- [ ] 1.2 Integrationstest „Hub zurückgespielt, neuer Einsatz am Hub“ in `tests/instanz_fuehrung.rs`.
  Das Zurückspielen wird nachgestellt: `fuehrung_stand` und die Stände der Kopplung des Hubs auf
  einen früheren Schnappschuss setzen, der kleiner ist als die Quittung des ELW. Danach legt der Hub
  einen Einsatz an, der ELW meldet sich, und der ELW kennt die Akte. Ohne 1.1 ist der Test rot.
  Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt`.
- [ ] 1.3 Die ganze Suite der Führung und Kopplung läuft grün. Tests, die feste kleine Stände
  erwarten, werden auf relative Aussagen umgestellt. Prüfen: `cargo test --test instanz_fuehrung`
  und `cargo test instanz::`.

## 2. Kleinere Quittung an der meldenden Seite (D2)

- [ ] 2.1 `fuehrung::repo::reset_gesendet_bis` setzt den Wert, statt ihn mit `MAX` zu mischen.
  `melden_einmal` ruft ihn auf, wenn `0 < a.fuehrung_bis < fuehrung_gesendet_bis`. Unit-Test am
  Schreibweg. Prüfen: `cargo test instanz::fuehrung::repo`.
- [ ] 2.2 Integrationstest „Hub zurückgespielt, Akte des ELW ging verloren“: Der ELW legt nach dem
  Schnappschuss einen Einsatz an und meldet sich. Danach spielt der Hub zurück (Zähler, Stände, die
  übernommene Akte samt ihrem Spiegel entfernen). Zwei Meldungen später kennt der Hub die Akte
  wieder. Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt`.
- [ ] 2.3 Integrationstest, dass ein Gegenüber ohne Schalter (Quittung 0) keinen erneuten Versand
  auslöst: `fuehrung_gesendet_bis` des ELW bleibt stehen. Prüfen: wie 2.2.

## 3. Netz für eine falsche Uhr (D3)

- [ ] 3.1 `fuehrung::repo::raise_stand` und `renew_stand_ueber(org_ids, ab)` mit Unit-Tests:
  `raise_stand` senkt nie. `renew_stand_ueber` stempelt nur Akten der genannten Orgs über `ab` neu,
  in der Reihenfolge ihres Stands. Prüfen: `cargo test instanz::fuehrung::repo`.
- [ ] 3.2 `handle_meldung`: vor `apply_eingang` den Rückschritt erkennen
  (`fuehrung_stand < anfrage.fuehrung_bis <= STAND_HEBEN_MAX`), den Zähler heben, über dem
  gespeicherten `fuehrung_gesendet_bis` neu stempeln und einen Hinweis an die Kopplung setzen.
  Integrationstest „nachgehende Uhr“: Die Quittung des ELW wird über die Uhrzeit gesetzt (Sekunden
  jetzt + 10 000), der Zähler des Hubs klein. Danach legt der Hub einen Einsatz an, und er erreicht
  den ELW. Ohne 3.2 ist der Test rot. Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt`.
- [ ] 3.3 `melden_einmal`: Liegt `a.fuehrung_bis` über `fuehrung_stand` und höchstens bei
  `STAND_HEBEN_MAX`, wird nur der Zähler gehoben. Integrationstest „ELW zurückgespielt“: Der ELW
  spielt zurück, legt einen Einsatz an, der Hub kennt ihn, und ein danach am Hub angelegter Einsatz
  erreicht den ELW. Danach liegt `fuehrung_stand` des ELW mindestens bei `empfangen_bis` des Hubs.
  Prüfen: wie 3.2.
- [ ] 3.4 Eine Quittung über `STAND_HEBEN_MAX` hebt keinen Zähler (Unit- oder Integrationstest mit
  `STAND_MAX`). Prüfen: wie 3.2.

## 4. Doku und Gates

- [ ] 4.1 `docs/betrieb/backup-restore.md`: Abschnitt „Gekoppelte Instanz zurückspielen“. Die
  Kopplung gleicht die Führungsakten selbst nach. Die Uhr des Servers muss stimmen. Verlorene
  Akten des Gegenübers kommen mit den nächsten Meldungen. Prüfen: Abschnitt gelesen, Verweise
  stimmen.
- [ ] 4.2 `src/AGENTS.md`, Instanzkopplung, Führung je Einsatz: eine Zeile, dass `next_stand` der
  Uhr folgt und `fuehrung_gesendet_bis` an der meldenden Seite nach unten gesetzt werden darf
  (Verweis auf diese Change). Prüfen: `scripts/check-fmt.sh` bleibt grün.
- [ ] 4.3 `./scripts/check-all.sh --geaendert` grün, ohne `| tail`.

## Workflow follow-up

- Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4) über den ganzen Branch.
- `/opsx:archive xi5ugyt8-fuehrung-stand-nach-restore` im selben Branch vor dem PR, Verweise auf
  den alten Pfad nachziehen.
- Folgeaufgabe auf dem Board: die Zähler der Unterschriftsschlüssel und der Stammdaten nach dem
  Zurückspielen prüfen.
