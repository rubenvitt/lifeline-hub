# Design

## Context

Warum: siehe `proposal.md`. Verhalten: Delta-Spec `specs/rechner-api-unterkunft/spec.md`.

Bestand, an den diese Change anschließt:

- `src/public_api/rechner.rs` (LLH-1524): `parse_body` → `check_request` (400 je Feld, 422 im
  Zusammenhang) → `wirksame_werte(org, anfrage)` → Rechenkern. `calculate(req, org)` ist ohne
  Datenbank, damit der Paritätstest (`src/public_api/rechner/tests.rs`) jeden Fall der
  Fallsammlung ohne Server durchschicken kann. `UnterkunftRequest` trägt `deny_unknown_fields`,
  `einsatz_id` ist heute 400.
- `src/public_api/freigabe.rs` (LLH-1638, ADR-0035): `freigegebene_einsaetze(conn, zugang_id)`
  liefert die wirksam freigegebenen Einsätze (aktiv, nicht gelöscht). Freigebbar ist ein Zugang
  nur mit `lage:read` oder `einsaetze:read` (`Scope::has_einsatzbezug`).
- `src/public_api/einsaetze.rs`, `GET /api/v1/einsaetze/{id}`: das Muster „Kennung aus der
  Anfrage, gegen die Freigabe geprüft, Org doppelt geprüft, sonst stets dieselbe 404“.
- `src/unterkunft/mod.rs`, `zusammenfuehren(org, einsatz)`: die Ebenen Einsatz → Organisation →
  Basis der internen API und des Unterkunftsrechners, mit `RichtwertHerkunft`.
- `src/unterkunft/repo.rs`, `einsatz_werte(conn, einsatz_id)`: die gesetzten Werte eines Einsatzes.
  Die Tabelle wird gespiegelt (`instanz::spiegel::art`, Kategorie Betreuung).

## Goals / Non-Goals

**Goals:**

- Einsatz-Werte in Rechnung und Auskunft, nur über eine wirksame Freigabe.
- Dieselbe Rangfolge der Ebenen wie die Oberfläche, aus einer Quelle.
- Bestehende Clients ohne `einsatz_id` merken nichts.

**Non-Goals:**

- Keine Änderung am Freigabemodell, am Paneel „Anbindungen“ oder an `Scope::has_einsatzbezug`.
- Kein Schreiben von Einsatz-Werten über die API.
- Kein neuer Fehlercode.

## Decisions

### D1 Recht: `rechner:use` und eine wirksame Freigabe genügen (abgestimmt 13.11.2026)

Die Route verlangt weiter nur `rechner:use`. Mit `einsatz_id` muss zusätzlich genau dieser Einsatz
für den Zugang wirksam freigegeben sein. Ein eigener Scope-Check entfällt: Freigeben lässt sich
ein Zugang nur mit `lage:read` oder `einsaetze:read`, und eine Freigabe endet, sobald sich diese
Rechte ändern (Spec `maschinenzugang`). Wer also eine wirksame Freigabe hat, trägt eines davon.
Die Doku empfiehlt `einsaetze:read`, denn darüber findet das Fremdsystem die `einsatz_id`.

Verworfen:

- *`einsaetze:read` ausdrücklich verlangen (sonst 403).* Klarer zu lesen, schließt aber einen
  Lagemonitor mit `lage:read` und `rechner:use` aus, den die Einsatzleitung schon freigegeben hat,
  und fügt eine zweite Regel neben die Freigabe.
- *`rechner:use` bekommt selbst Einsatzbezug.* Ein reiner Rechner-Zugang sähe nur Richtwerte statt
  des Einsatz-Kopfs. Kostet aber Änderungen an ADR-0035, Spec `maschinenzugang`, Paneel und
  Einsatztagebuch: Geben oder Nehmen von `rechner:use` beendete dann eine Freigabe. Und das
  Fremdsystem müsste die `einsatz_id` von außen kennen.

### D2 Die Kennung wählt nur aus, die Freigabe entscheidet (ADR-0035)

`einsatz_id` ist nie Quelle des Einsatzes, nur Auswahl unter den freigegebenen. Neue Funktion in
`public_api::freigabe`, etwa `is_lesbar(conn, zugang_id, org_id, einsatz_id) -> bool`: wahr genau
dann, wenn `einsatz_id` unter `freigegebene_einsaetze(zugang_id)` steht **und** der Einsatz zur
Org des Zugangs gehört (doppelt geprüft wie in `einsaetze.rs`; ein Treffer einer fremden Org
wird zusätzlich als Fehler protokolliert). Jeder andere Fall, auch ohne Freigabe, mit anderem,
abgeschlossenem, gelöschtem, fremdem oder unbekanntem Einsatz, ist dieselbe 404 `not_found` mit
festem Text, ohne Hinweis, ob es den Einsatz gibt.

Verworfen: *`lesbare_einsaetze` aus `einsaetze.rs` mitbenutzen.* Sie lädt den ganzen Kopf in
v1-Form; hier reicht ein Ja oder Nein, und der Ort der Freigabe-Regel bleibt `freigabe.rs`.

**Spiegel.** Hält die Instanz den Einsatz als Spiegel, kommen seine Werte über die Spiegelung.
Liefert die Freigabestufe die Kategorie von `einsatz_unterkunft_richtwert` nicht (heute gibt es
nur `alles`, unbekannte Stufen kommen mit neueren Versionen), gilt der Einsatz für die Rechnung als
nicht lesbar und ergibt 404. Ohne diese Sperre rechnete der Server still mit den Werten der
Organisation und nennte die Herkunft `org`, obwohl der Einsatz eigene Werte hat. Dieselbe Prüfung
macht `GET /api/v1/lage` (`is_lage_vollstaendig`).

### D3 Erst die Anfrage prüfen, dann die Freigabe

Reihenfolge im Handler: `parse_body` (400) → `check_request` (400/422) → bei `einsatz_id` die
Freigabe (404) und die Werte des Einsatzes → Rechnung. Eine kaputte Anfrage bekommt so immer
400/422, gleich welche Kennung sie trägt; ein Fremdsystem kann über die Reihenfolge nichts über
fremde Einsätze erfahren, denn die 404 ist für jeden nicht lesbaren Einsatz gleich.

`calculate` bleibt ohne Datenbank: `check_request` gibt die Kennung mit heraus, die Rechnung nimmt
die schon geladenen Ebenen (`org`, `Option<einsatz>`) herein. Der Paritätstest ruft weiter ohne
Einsatz.

### D4 Wire-Formen

- **Body:** `einsatz_id: Option<i64>` an `UnterkunftRequest`. Zeichenkette oder gebrochene Zahl
  scheitern in `parse_body` mit 400 und dem Pfad `einsatz_id`. `null` gilt wie fehlend, wie bei
  `richtwerte`. Eine Kennung ≤ 0 ist kein eigener Fehler, sondern ein nicht lesbarer Einsatz (404).
- **Abfrage:** `GET …/richtwerte?einsatz_id=…`, gelesen wie `after` in `events.rs` als
  `Option<String>` und im Handler zu `i64` geprüft; keine ganze Zahl → 400 `invalid_field` mit
  `einsatz_id`. Unbekannte Abfrageparameter bleiben wie heute unbeachtet, denn sie jetzt
  abzulehnen bräche v1. Die Abfrage ist Teil von `htu` und damit signiert (`machine.rs` prüft
  `path_and_query`).
- **Herkunft:** `RichtwertEbene::Einsatz => "einsatz"`, additiv. Der Enum-Wire-Kontrakt
  (`tests/enum_wire_kontrakt.rs`) und `docs/api/public-v1.json` ziehen nach.

### D5 Ebenen aus einer Quelle

`wirksame_werte` baut auf `unterkunft::zusammenfuehren(org, einsatz)` auf und legt nur die Anfrage
darüber; die Herkunft der internen Ebenen wird per vollständigem `match` von `RichtwertHerkunft`
auf `RichtwertEbene` abgebildet. So steht die Rangfolge Einsatz → Organisation → Basis an einer
Stelle für Oberfläche, interne API und v1. Ein gespeicherter Wert zu einem Schlüssel, den die
Basis nicht mehr kennt, fällt dort schon still weg.

Verworfen: *die Rangfolge in `rechner.rs` um einen Zweig erweitern.* Kleiner, aber dann führten
zwei Stellen dieselbe Regel, und eine dritte Ebene (etwa die Betreuungsstelle) liefe auseinander.

### D6 ADR-0032 wird durch ADR-0039 ersetzt

ADR-0032 verbot der Rechner-API, Werte eines Einsatzes zu lesen, „solange es keine
Einsatz-Freigabe für den Zugang gibt“, und prüfte das mit `verbiete 'einsatz_werte'`. Akzeptierte
ADRs sind unveränderlich (`docs/architektur/AGENTS.md`, „Entscheidungen“): ADR-0039 übernimmt
ihre übrigen Regeln unverändert, ersetzt das Verbot durch die Regel aus D2 und hält D5 fest; ihre
Prüfung verlangt `freigabe::is_lesbar` und `unterkunft::zusammenfuehren` in `rechner.rs`.
ADR-0032 bekommt `status: ersetzt`. Erst beim Umsetzen aufgefallen (Wächter
`check-architektur.sh`), aber ohne Spielraum: ADR-0032 sah genau diesen Schritt vor.

## Risks / Trade-offs

- [Ein Zugang mit Freigabe und `rechner:use` sieht die Richtwerte des Einsatzes, auch wenn die
  Einsatzleitung beim Freigeben nur an Lage oder Einsatzkopf dachte] → Die Richtwerte sind
  Planungswerte ohne Personenbezug; das Paneel zeigt die Rechte des Zugangs samt „Rechner nutzen“.
  Das Anwenderkapitel „Anbindungen“ nennt es ausdrücklich.
- [Ein Client, der sich auf 400 für `einsatz_id` verlassen hat] → Die Doku nannte das als Übergang
  („gibt es noch nicht“); die Spec von LLH-1524 sah das Feld ausdrücklich vor (D1 dort).
- [Zwei Datenbankabfragen mehr je Anfrage mit `einsatz_id`] → vernachlässigbar, beide über Index.

## Migration Plan

Keine Migration. Rückbau: Feld und Abfrageparameter entfernen ginge in v1 nicht mehr
(Stabilitätszusage); ein Fehler wird vorwärts behoben.
