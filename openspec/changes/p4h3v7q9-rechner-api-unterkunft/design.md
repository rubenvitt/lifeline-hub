# Design

## Context

Warum und was: siehe `proposal.md`. Der Lösungsweg wurde am 12.11.2026 mit Ruben abgestimmt
(Zunder LLH-1524, Feld `plan`); D1, D4 und D7 sind seine Entscheidungen.

Stand im Code:

- **Rechnung:** `frontend/src/betreuung/unterkunft/rechnerKern.ts` (`rechne(eingabe, richtwerte)`),
  eine reine Funktion. Sie ist nachsichtig: Ungültiges zählt als 0, Überzähliges wird übergangen.
- **Fallsammlung:** `tests/fixtures/unterkunft/faelle.json` mit 24 Fällen (seit dieser Change 25) (`eingabe`, `richtwerte`,
  `erwartet`), heute nur vom TS-Kern gelesen.
- **Richtwerte:** Basis in `src/unterkunft/richtwerte_basis.json` (38 Werte, 4 Zelttypen), per
  `include_str!` im Server und per Import in der Oberfläche. Der Server liest daraus bisher nur
  Schlüssel, Wert und Grenzen. Org- und Einsatz-Werte liegen in `org_unterkunft_richtwert` und
  `einsatz_unterkunft_richtwert` (`src/unterkunft/repo.rs`).
- **Öffentliche API:** `src/public_api/` mit vier Routen (`openapi.json`, `zugang/redeem`,
  `instanz/jwks.json`, `me`). `MachineClient` prüft Signatur, Zustand, Drosselung und Scope, liest
  den Body selbst (`client.body`) und signiert Antworten über `client.antwort`. Der Scope
  `rechner:use` steht schon in `Scope`, im Frontend und in der Doku.
- **Einsatz-Freigabe für Zugänge:** gibt es nicht. Tabelle `maschinenzugang` kennt keinen
  Einsatzbezug; das Konzept (`docs/konzepte/2026-11-11-oeffentliche-api.md`, D2) sieht sie mit
  LLH-1638 und LLH-1655 vor.
- Die Spec `unterkunftsrechner` und der Entwurf zu LLH-1520, auf die Code und
  `frontend/src/betreuung/AGENTS.md` verweisen, liegen nicht im Repo
  (`/mnt/project-files/llh-1520/`). Diese Change erfindet sie nicht nach.

Geltende Regeln: ADR-0022 (Fremdsysteme und `/api/v1/`), ADR-0006 (`wire_enum!`), `src/AGENTS.md`
(„Öffentliche API v1“, „Statuscode-Konvention“, „Eingabegrenzen“), Wurzel-`AGENTS.md`
(„Bezeichner-Sprache“).

## Goals / Non-Goals

**Goals:**

- Ein Fremdsystem bekommt für dieselbe Eingabe dasselbe Ergebnis wie die Oberfläche, belegt durch
  eine Fallsammlung für beide Kerne.
- Eine falsche Anfrage scheitert laut und nennt das Feld, statt still mit 0 zu rechnen.
- Die Routen stehen vollständig im v1-Dokument; ihre Schemas ändern sich nur additiv.

**Non-Goals:**

- Einsatz-Werte und `einsatz_id` (D1).
- Quelle und Beleg (`belegt`/`annahme`) der Richtwerte in der Auskunft (D7).
- Die Oberfläche über die API rechnen zu lassen. Sie rechnet weiter im Browser, auch ohne Netz.
- Die Grenzen der Maske (`GrundlageEingabe.tsx`) an die der API anzugleichen. Die Maske bleibt bei
  100 000 Personen; sie ist enger als die API, das ist verträglich.
- Die interne Route-Familie `…/unterkunft-richtwerte` zu ändern.

## Decisions

### D1 Ohne `einsatz_id`: Ebenen Anfrage → Organisation → Basis

Der Task sah vor, dass ein Zugang „mit `einsatz_id` und Recht“ auch die Einsatz-Werte bekommt. Das
Recht gibt es nicht: ADR-0022 verlangt für einsatzbezogenes Lesen die Freigabe der Einsatzleitung,
und die entsteht erst mit LLH-1638/LLH-1655. Die Rechnung nimmt deshalb die Org des Zugangs und
die Werte der Anfrage. `einsatz_id` kommt später als optionales Feld hinzu; das erlaubt die
Stabilitätszusage (neue optionale Felder). Bis dahin ist `einsatz_id` ein unbekanntes Feld und
damit 400 (D4): ein Client, der Einsatz-Werte erwartet, soll es merken.

Verworfen:

- *Einsatz-Werte jedes laufenden Einsatzes der Org mit `rechner:use` allein.* Bricht ADR-0022 und
  verrät über 200 gegen 404, welche Einsatz-IDs es gibt.
- *Die Freigabe jetzt mitbauen.* Tabelle, Maske für die Einsatzleitung und Ende mit dem Abschluss
  gehören zu LLH-1638/LLH-1655; hier entstünde eine zweite Fassung.

Folgeaufgabe: `einsatz_id` an der Rechner-API, blockiert durch die Einsatz-Freigabe.

### D2 Rechenkern in Rust mit geprüfter Eingabe als Typ

`src/unterkunft/rechner.rs` bekommt `rechne(&Eingabe, &Richtwerte) -> Ergebnis`, eine reine
Funktion ohne Datenbank und ohne serde. `Eingabe` ist ein Enum je Weg; die Aufteilung
gesamt/getrennt steckt im Typ, sodass ein widersprüchlicher Zustand nicht darstellbar ist. Der
Kern prüft nichts mehr; die Prüfung liegt an der Route (D4).

Die Rundungen folgen dem TS-Kern Zeile für Zeile: `glatt` (auf sechs Stellen, vor jedem Runden),
`auf`, `ab`, `eine_stelle`, `zwei_stellen`, `ganz`; je Gruppe aufrunden und dann summieren; je
Raum abrunden und dann summieren; Zeltmix mit dem größten Zelt zuerst und dem Rest im kleinsten
passenden. Alle Werte sind nicht negativ, damit runden `f64::round` und `Math.round` gleich.

`Richtwerte` hält die wirksamen Werte je Schlüssel. Ein fehlender Schlüssel ist ein Programmfehler
(die Karte entsteht immer aus der vollständigen Basis) und führt zu einem 500, nie zu einer
stillen 0, wie im TS-Kern.

Verworfen:

- *Den TS-Kern serverseitig ausführen* (eingebettete JS-Laufzeit): eine neue schwere Abhängigkeit
  für 300 Zeilen Arithmetik.
- *Den Rust-Kern nach WASM bauen und in der Oberfläche nutzen*: ein Kern statt zwei, aber ein
  neuer Bauweg im Frontend und ein Eingriff in den fertigen Rechner aus LLH-1520. Die Fallsammlung
  bindet beide Kerne ohne diesen Umbau.

### D3 Eigene v1-Schemas, die Fallsammlung prüft auf dem Wire

Nach `src/AGENTS.md` sind v1-Eingaben und -Antworten eigene Typen in `public_api`. Das neue Modul
`src/public_api/rechner.rs` trägt die Anfrage (`UnterkunftRequest`), die Antworten
(`UnterkunftResponse`, `UnterkunftRichtwerteResponse`) und die Abbildung von und zum Kern. Der
Kern selbst hat kein Schema; eine Umbenennung dort ändert den Vertrag nicht, ohne dass
`docs/api/public-v1.json` driftet.

Feste Wertemengen sind `wire_enum!` (ADR-0006) und stehen im Enum-Wire-Kontrakt: `weg`, `gruppe`
(`gesamt`, `maenner`, `frauen`), `belegung`, Zelttyp (`sg20` … `sg50`), `herkunft` (`basis`,
`org`, `anfrage`). Die Anfrage nimmt `weg` und `belegung` als Text und führt sie mit `parse` über
(unbekannt → 400). Ein Test hält den Zelttyp-Enum deckungsgleich mit `zelttypen` der Basis. Die
`gruppe` eines Richtwerts (`schlafen`, `sanitaer` …) bleibt Text aus der Basis.

Der Paritätstest liest die Fallsammlung und geht je Fall den ganzen Weg: `eingabe` als
`UnterkunftRequest` einlesen, prüfen, rechnen, als `ergebnis` serialisieren und mit `erwartet`
vergleichen. Verglichen wird der JSON-Baum mit Zahlen als `f64` (`400.0` gleich `400`), alles
andere wörtlich, auch `null` und die Reihenfolge der Listen. So belegt ein Test zugleich die
Gleichheit der Kerne, die Form der Antwort und dass jeder Fall eine gültige Anfrage ist.

Zahlen: Stückzahlen und Personen sind im Schema `integer`, Flächen und Mengen mit Nachkommastelle
`number`. `kapazitaet` und `kapazitaet.raeume` sind wie in der Fallsammlung ausdrücklich `null`,
wenn sie nicht zutreffen.

### D4 Strenge Prüfung an der Route

Die Route liest `client.body` mit `serde_json` in `UnterkunftRequest`
(`deny_unknown_fields` auf jeder Ebene). Zahlen kommen als `f64` an und werden von Hand geprüft,
damit die Meldung das Feld nennt (`personen.gesamt`, `raeume[2].laenge_m`,
`zelte.maenner.sg30`). Reihenfolge: erst jedes Feld für sich (400 `invalid_field`), dann der
Zusammenhang (422 `unprocessable`), nach `src/AGENTS.md`, „Statuscode-Konvention“.

Grenzen als Konstanten in `src/unterkunft/rechner.rs`:

| Konstante | Wert | Herkunft |
| --- | --- | --- |
| `RAEUME_MAX` | 200 | Task, Maske |
| `ABZUEGE_MAX` | 5 je Raum | neu; die Maske kennt keine. Mit 20 passten 200 Räume nicht in 64 KiB (Review) |
| `MASS_MAX_M` | 1000, Maß > 0 | Task, Maske |
| `FLAECHE_MAX_M2` | 1 000 000 | Maske (`MASS_MAX_M²`) |
| Personen | `betreuung::MAX_PERSONEN` (1 000 000) | Entscheidung Ruben, 12.11.2026 |
| `ZELTE_JE_TYP_MAX` | 1000 | Maske |
| `BEZEICHNUNG_MAX` | 80 Zeichen | Maske |

Die Personengrenze gilt je Angabe (`gesamt`, `maenner`, `frauen`). Eine aus Fläche, Räumen oder
Zelten errechnete Kapazität hat keine eigene Grenze: die Rechnung kostet unabhängig von der Größe
gleich viel, und die Eingaben sind einzeln begrenzt.

Ein Maß von 0 ist 400. Die Maske erlaubt 0 für eine leere Zeile; ein Fremdsystem, das 0 schickt,
hat meist ein Feld nicht gefüllt. Eine leere Raumliste ist dagegen gültig und ergibt 0 Plätze,
wie `personen.gesamt = 0`.

Der Fall „ohne Trennung nur `maenner` und `frauen`“ bleibt gültig und ergibt die Summe (Fall
`personen_ohne_gesamt_summe_aus_gruppen`). Gruppen kommen immer als Paar: fehlt eine, ist das
422, mit und ohne Trennung; eine leere Gruppe heißt ausdrücklich 0 (bei Zelten `{}`). Zelte ohne
Trennung brauchen `gesamt`, weil auch der TS-Kern dort nur `gesamt` liest.

**Nachtrag aus dem Review vor dem PR (12.11.2026):**

- *Feldgrenzen gegen die Body-Grenze.* 200 Räume mit je 20 Abzügen sind als kürzestes JSON 120 KB
  und endeten mit 413. Keine Feldgrenze kann 64 KiB garantieren (ein Client darf Zahlen beliebig
  lang schreiben), deshalb zwei Dinge: `ABZUEGE_MAX` 5, sodass die größte Anfrage in üblicher
  Schreibweise passt (Routentest `groesste_anfrage_passt_in_den_body`), und Spec und Anleitung
  nennen die 64 KiB als zweite Grenze mit 413. Verworfen: ein eigenes, größeres Body-Limit für
  die Route; die 64 KiB sind Vertrag der ganzen API.
- *Paar statt stiller 0.* Die erste Fassung ließ bei Trennung eine Gruppe genügen und zählte die
  andere als 0. Das widersprach dem Grundsatz dieser Entscheidung. Innerhalb von v1 lässt sich
  eine Ablehnung später lockern, eine Annahme nicht mehr zurücknehmen; deshalb streng.
- *Einlesen.* `serde_path_to_error` (über axum schon im Lockfile) liefert den Pfad auch bei
  falschem Typ und fehlendem Pflichtfeld; `1e999` ist für serde_json ein Syntaxfehler und wird
  eigens als Zahl am Feld gemeldet. Eine Hülle `Objekt<T>` nimmt nur JSON-Objekte an (ein
  abgeleitetes `Deserialize` läse ein Struct auch aus einer Liste), die Hülle `Werte` lehnt
  doppelte Schlüssel ab (`BTreeMap` nähme den letzten).
- *Negative Null.* Eine leere `f64`-Summe ist in Rust `-0.0`, der TS-Kern summiert ab `0`.
  `glatt` hängt `+ 0.0` an, die Prüfung normalisiert `-0.0` der Eingabe, und der Paritätstest
  vergleicht Zahlen Bit für Bit.

Die Werte der Anfrage prüft die vorhandene `unterkunft::pruefe` (Schlüssel, Grenzen, Ganzzahl);
ihr Text nennt den Schlüssel schon.

Verworfen: *nachsichtig wie der TS-Kern*. Eine Maske zeigt dem Menschen, was sie verstanden hat;
ein Fremdsystem sieht nur das Ergebnis und rechnete mit einem Tippfehler im Feldnamen still mit 0.

### D5 Ebenen und Herkunft

Die Route lädt die Werte der Org des Zugangs (`repo::org_werte`) und legt die geprüften Werte der
Anfrage darüber. Die v1-Herkunft ist ein eigener Enum (`basis`, `org`, `anfrage`), nicht
`unterkunft::RichtwertHerkunft` der internen API; `einsatz` kommt mit D1 später als neuer Wert
hinzu. Ein gespeicherter Org-Wert zu einem Schlüssel, den die Basis nicht mehr kennt, fällt wie in
`unterkunft::zusammenfuehren` still weg.

`Basiswert` in `src/unterkunft/mod.rs` liest zusätzlich `bezeichnung`, `gruppe` und `einheit`,
dazu kommen die `zelttypen` der Datei. Quelle und Beleg liest der Server weiter nicht (D7).

### D6 Zwei Routen, signierte Antwort, kein neuer Fehlercode

Beide Handler stehen in `src/public_api/rechner.rs` und kommen per
`.routes(routes!(…).layer(Extension(ScopeAnforderung::Scope(Scope::RechnerUse))))` in
`public_api::router()`, mit `security(("machine" = []))`, Tag „Rechner“, den besonderen Antworten
400, 401, 403, 422, 429 und `status = "default"` mit `ApiErrorBody`. Geantwortet wird über
`client.antwort` (signiert). Fehler sind `ApiError` mit `InvalidField` oder `Unprocessable`.

Die Auskunft ist eine eigene `GET`-Route statt eines Felds der Rechnung: ein Client liest
Bezeichnungen, Einheiten und Grenzen einmal und baut daraus seine Maske; die Rechnung trägt je
Schlüssel nur Wert und Herkunft.

Das Konzept nennt für `rechner:use` nur die `POST`-Route. Die Auskunft steht im Task und fällt
unter denselben Scope; das Konzept wird nicht umgeschrieben (eingefrorene Notiz), die Doku der
API nennt beide.

### D7 Auskunft schlank

Je Richtwert: `schluessel`, `bezeichnung`, `gruppe`, `einheit`, `min`, `max`, `ganzzahl`, `basis`,
`wert`, `herkunft`. Quelle und Beleg bleiben draußen: ihre Texte würden Teil des Vertrags und
ließen sich dann nicht mehr frei berichtigen. Sie können später additiv kommen.

Verworfen: *mit Quelle und Beleg*, aus diesem Grund (Entscheidung Ruben, 12.11.2026).

### D8 Testhelfer für signierte Aufrufe an einem Ort

`angebunden`, `einloesen`, `senden`, `signiert`, `schluessel` und `jetzt` stehen heute lokal in
`tests/maschinenzugang.rs`. Sie ziehen nach `tests/common/maschine.rs` (Untermodul von
`tests/common`), dazu kommt ein Helfer für signierte Aufrufe mit Body. `tests/maschinenzugang.rs`
nutzt sie von dort. Das ist ein eigener `refactor`-Commit vor der ersten neuen Route, ohne
Änderung am Verhalten der Tests.

Verworfen: *die neuen Tests in `tests/maschinenzugang.rs`*: die Datei hat 1400 Zeilen und prüft die
Anmeldung, nicht den Rechner.

## Risks / Trade-offs

- **Zwei Kerne laufen auseinander** → Die Fallsammlung prüft beide; `frontend/src/betreuung/AGENTS.md`
  verlangt, sie mit jeder Änderung der Rechnung anzupassen. Ein Wächter prüft per Textsuche, dass
  der Rust-Kern jeden Schlüssel der Basis liest (Gegenstück zu `richtwerte.guard.test.ts`).
  Restrisiko: ein Fall, den die Sammlung nicht kennt. Die Mutationsproben in den Aufgaben zeigen,
  welche Rundungsregeln die Sammlung trifft; für die Glättung fehlte ein Fall, er kam beim
  Umsetzen dazu (`flaeche_gleitkomma_glatt`).
- **Gleitkomma unterscheidet sich zwischen JS und Rust** → Beide rechnen IEEE-754-Doubles mit
  denselben Grundrechenarten in derselben Reihenfolge; `glatt` fängt die Reste vor dem Runden. Die
  Fälle `raeume_gleitkomma` und `flaeche_gleitkomma_glatt` halten das fest.
- **Der Vertrag friert die Form des Ergebnisses ein** → Sie ist seit LLH-1520 in der Fallsammlung
  festgehalten und in der Oberfläche im Einsatz. Neue Größen kommen als neue Felder.
- **`deny_unknown_fields` macht ein späteres optionales Feld für alte Server zum Fehler** → Das
  trifft nur einen Client, der neuer ist als der Server, und er bekommt ein klares 400 statt eines
  falschen Ergebnisses.
- **Maske und API haben verschiedene Personengrenzen** (100 000 gegen 1 000 000) → Die Maske ist
  die engere; was sie annimmt, nimmt auch die API. Der Kommentar in `GrundlageEingabe.tsx` nennt
  nur Raumzahl und Maße als gemeinsam, das stimmt weiter.

## Migration Plan

Keine Migration, kein Schalter. Die Routen sind mit dem Deploy da; nutzen kann sie nur ein Zugang
mit `rechner:use`. Rückbau: die zwei Einträge in `public_api::router()` entfernen und
`docs/api/public-v1.json` neu erzeugen. Solange kein Fremdsystem die Routen nutzt, bricht das
niemanden; danach gilt die Stabilitätszusage.
