# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der Test, der ohne die
Änderung rot ist.

## 1. Zähler folgt der Uhr (D1)

- [x] 1.1 `fuehrung::repo::next_stand` vergibt `MAX(fuehrung_stand + 1, Unix-Sekunden)`, die
  Sekunden kommen als Parameter einer inneren Fassung. Unit-Tests in `src/instanz/fuehrung/repo.rs`:
  Ein kleiner Zähler springt auf die gesetzte Uhrzeit, ein Zähler über ihr zählt +1, und zwei
  Vergaben in derselben Sekunde bleiben streng steigend. Prüfen: `cargo test instanz::fuehrung::repo`.
- [x] 1.2 Integrationstest „Hub zurückgespielt, neuer Einsatz am Hub“ in `tests/instanz_fuehrung.rs`.
  Das Zurückspielen wird nachgestellt: `fuehrung_stand` und die Stände der Kopplung des Hubs auf
  einen früheren Schnappschuss setzen, der kleiner ist als die Quittung des ELW. Danach legt der Hub
  einen Einsatz an, der ELW meldet sich, und der ELW kennt die Akte. Ohne 1.1 ist der Test rot.
  Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt`.
- [x] 1.3 Die ganze Suite der Führung und Kopplung läuft grün. Tests, die feste kleine Stände
  erwarten, werden auf relative Aussagen umgestellt. Prüfen: `cargo test --test instanz_fuehrung`
  und `cargo test instanz::`.

## 2. Kleinere Quittung an der meldenden Seite (D2)

- [x] 2.1 `fuehrung::repo::reset_gesendet_bis` setzt den Wert, statt ihn mit `MAX` zu mischen.
  `melden_einmal` ruft ihn auf, wenn `0 < a.fuehrung_bis < fuehrung_gesendet_bis`. Unit-Test am
  Schreibweg. Prüfen: `cargo test instanz::fuehrung::repo`.
- [x] 2.2 Integrationstest „Hub zurückgespielt, Akte des ELW ging verloren“: Der ELW legt nach dem
  Schnappschuss einen Einsatz an und meldet sich (nur Meldung, ohne Abgleich, die Akte liegt am
  Hub also ohne Spiegel). Danach spielt der Hub zurück (Zähler, Stände, die übernommene Akte
  entfernen). Zwei Meldungen später kennt der Hub die Akte wieder. Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt`.
- [x] 2.3 Integrationstest, dass ein Gegenüber ohne Schalter (Quittung 0) keinen erneuten Versand
  auslöst: `fuehrung_gesendet_bis` des ELW bleibt stehen. Prüfen: wie 2.2.

## 3. Netz für eine falsche Uhr (D3)

- [x] 3.1 `fuehrung::repo::raise_stand` und `renew_stand_ueber(org_ids, ab)` mit Unit-Tests:
  `raise_stand` senkt nie. `renew_stand_ueber` stempelt nur Akten der genannten Orgs über `ab` neu,
  in der Reihenfolge ihres Stands. Prüfen: `cargo test instanz::fuehrung::repo`.
- [x] 3.2 `handle_meldung`: vor `apply_eingang` den Rückschritt erkennen
  (`fuehrung_stand < anfrage.fuehrung_bis <= STAND_RAISE_MAX`), den Zähler heben, über dem
  gespeicherten `fuehrung_gesendet_bis` neu stempeln und einen Hinweis an die Kopplung setzen.
  Integrationstest „nachgehende Uhr“: Die Quittung des ELW wird über die Uhrzeit gesetzt (Sekunden
  jetzt + 10 000), der Zähler des Hubs klein. Danach legt der Hub einen Einsatz an, und er erreicht
  den ELW. Ohne 3.2 ist der Test rot. Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt`.
- [x] 3.3 `melden_einmal`: Liegt `a.fuehrung_bis` über `fuehrung_stand` und höchstens bei
  `STAND_RAISE_MAX`, wird nur der Zähler gehoben. Integrationstest „ELW zurückgespielt“: Der ELW
  spielt zurück, legt einen Einsatz an, der Hub kennt ihn, und ein danach am Hub angelegter Einsatz
  erreicht den ELW. Danach liegt `fuehrung_stand` des ELW mindestens bei `empfangen_bis` des Hubs.
  Prüfen: wie 3.2.
- [x] 3.4 Eine Quittung über `STAND_RAISE_MAX` hebt keinen Zähler (Unit- oder Integrationstest mit
  `STAND_MAX`). Prüfen: wie 3.2.

## 4. Doku und Gates

- [x] 4.1 `docs/betrieb/backup-restore.md`: Abschnitt „Gekoppelte Instanz zurückspielen“. Die
  Kopplung gleicht die Führungsakten selbst nach. Die Uhr des Servers muss stimmen. Verlorene
  Akten des Gegenübers kommen mit den nächsten Meldungen. Prüfen: Abschnitt gelesen, Verweise
  stimmen.
- [x] 4.2 `src/AGENTS.md`, Instanzkopplung, Führung je Einsatz: eine Zeile, dass `next_stand` der
  Uhr folgt und `fuehrung_gesendet_bis` an der meldenden Seite nach unten gesetzt werden darf
  (Verweis auf diese Change). Prüfen: `scripts/check-fmt.sh` bleibt grün.
- [ ] 4.3 `./scripts/check-all.sh --geaendert` grün, ohne `| tail`.

## 5. Befunde des Reviews vor dem PR (12.11.2026)

Entscheidungen des Menschen: B1 additives Feld (D5), B2 alle Kopplungen neu stempeln (D3). B3
verworfen (der jüngste Hinweis gilt, so ist das Modell).

- [x] 5.1 Bezeichner und Kommentare (B7, B8) als eigener `refactor`-Commit: `STAND_HEBEN_MAX` →
  `STAND_RAISE_MAX`, Testhelfer `kennt` → `has_akte`. Den Kommentar an `STAND_MAX` an D1 anpassen.
  Den Punkt in `src/AGENTS.md` berichtigen: Instanzzähler und Kopplungsstände getrennt, beide
  Schreibwege nennen. Prüfen: `grep -rn STAND_HEBEN_MAX src tests` leer,
  `cargo test --test instanz_fuehrung zurueckgespielt` grün.
- [x] 5.2 Feld `fuehrung_gesendet_bis` in `MeldenAnfrage` (`#[serde(default)]`). `melden_einmal`
  füllt es aus dem gespeicherten Sendestand. `handle_meldung` liest `fuehrung_empfangen_bis` vor
  `apply_eingang` und antwortet mit diesem alten Wert, wenn er unter dem Feld liegt (D5).
  Integrationstest „ELW hat während des Ausfalls geändert“: Wie 2.2, aber der ELW legt nach dem
  Zurückspielen und vor der ersten Meldung einen weiteren Einsatz an. Nach den nächsten Meldungen
  kennt der Hub beide Akten. Ohne 5.2 ist der Test rot. Unit-Test: Eine Anfrage ohne das Feld liest
  sich mit 0. Prüfen: `cargo test --test instanz_fuehrung zurueckgespielt` und
  `cargo test --lib instanz::melden`.
- [x] 5.3 `repair_stand` als gemeinsamer Schritt beider Seiten (D3). Nach dem Heben werden die Akten
  jeder aktiven Kopplung, in der die Instanz erreichte Seite ist, über deren eigenem
  `fuehrung_gesendet_bis` neu gestempelt, mit Hinweis an jeder; die erkennende Kopplung bekommt den
  Hinweis immer. `melden_einmal` ruft ihn statt `raise_stand` direkt. Unit-Test mit zwei erreichten
  Kopplungen und getrennten Orgs: Eine Quittung an Kopplung 1 stempelt auch die Akte der Org, die
  nur an Kopplung 2 hängt, über die Quittung und setzt an beiden einen Hinweis. Ein zweiter Fall
  ruft ihn mit einer Kopplung, in der die Instanz meldende Seite ist. Ohne 5.3 ist der Test rot.
  Prüfen: `cargo test --lib instanz::fuehrung`.
- [x] 5.4 Grenztests (B6): Eine Quittung von genau `STAND_RAISE_MAX` hebt, `STAND_RAISE_MAX + 1`
  nicht, einmal an der erreichten Seite (Unit-Test an `repair_stand`) und einmal an der meldenden
  Seite (Integrationstest, Antwort mit überhöhtem `fuehrung_empfangen_bis` am Hub). Prüfen: wie 5.2
  und 5.3, Mutation der Grenze (`+1`) wird rot.
- [x] 5.5 `docs/betrieb/backup-restore.md` (B4): Der Hinweis erscheint nach dem Zurückspielen der
  erreichten Seite meist auch bei richtiger Uhr. Auch die meldende Seite zeigt ihn. Ausnahmen
  nennen: nachgehende Uhr mit mehr Vergaben als verloren, Sicherung von vor der ersten Übernahme,
  Gegenstelle älteren Stands. Prüfen: Abschnitt gegen design.md D3–D5 und Risiken gelesen.

## 6. Befunde des Reviews der Behebungen (12.11.2026)

Gegenprüfung: B-1, B-2 und B-3 bestätigt, B-4 verworfen (die Formulierung in `src/AGENTS.md` ist
richtig). B-3 nimmt der Mensch als Risiko hin.

- [x] 6.1 B-1: Bei erkanntem Rückschritt mit Empfangsstand > 0 hebt `handle_meldung` den
  Empfangsstand nicht an (D5). Integrationstest „verlorene Antwort“: Nach der ersten Meldung wird der
  Sendestand des ELW wieder auf den alten Wert gesetzt. Ohne 6.1 ist der Test rot. Prüfen:
  `cargo test --test instanz_fuehrung`.
- [x] 6.2 B-2 und B-3 in Spec und Design: Die Ausnahme nennt die verschieden weit quittierenden
  Gegenstellen, das Szenario mit zwei Kopplungen setzt gleich weite Quittungen voraus, B-3 steht
  unter den Risiken. Prüfen: `openspec validate xi5ugyt8-fuehrung-stand-nach-restore --strict`.

## Workflow follow-up

- Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4) über den ganzen Branch.
- `/opsx:archive xi5ugyt8-fuehrung-stand-nach-restore` im selben Branch vor dem PR, Verweise auf
  den alten Pfad nachziehen.
- Folgeaufgabe auf dem Board: die Zähler der Unterschriftsschlüssel und der Stammdaten nach dem
  Zurückspielen prüfen.
