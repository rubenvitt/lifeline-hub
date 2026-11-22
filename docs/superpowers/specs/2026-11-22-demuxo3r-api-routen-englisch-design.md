# API-Routen auf Englisch (LLH-1979)

Zunder: https://zunder.rubeen.dev/#/aufgabe/demuxo3rcnfmof9uvilczsnz

Abgestimmt mit Ruben am 22.11.2026 (Phase-1-Checkpoint), freigegeben am selben Tag. Grundlage: Bestandsaufnahme vom
selben Tag, drei Leser über Backend, Clients und Regeln.

## Absicht

Ruben hat am 18.11.2026 bei LLH-1978 entschieden: API-Routen sind englisch. Die einzige neue
Route seitdem ist englisch (`GET /api/shell`). Der Bestand ist fast ganz deutsch. Die
Bezeichner-Sprache (Wurzel-`AGENTS.md`, LFH-1312) zählt Routen bisher zu den Grenzwerten, die
nicht wegen der Regel umbenannt werden. Diese Arbeit schreibt die neue Regel fest, macht sie
prüfbar und stellt den Bestand in Paketen um.

Am Checkpoint entschieden:

1. **Alles englisch, auch Fachbegriffe** (`/api/einsaetze` → `/api/incidents`), über ein
   Glossar. Abkürzungen ohne gebräuchliche Übersetzung bleiben (`etb`, `uhs`).
2. **Fundament + Pakete.** Dieser Branch bringt Regel, ADR, Glossar, Wächter und ein erstes
   Paket. Die übrigen Module werden Unteraufgaben von LLH-1979, je Paket ein PR.
3. **Keine Ausnahmen.** Auch `/api/v1/…`, `/api/extern/v1/…` und die Instanzkopplung werden
   umgestellt („wir haben noch nichts veröffentlicht“).
4. **Harter Schnitt ohne Alias**, weil Lifeline Hub in der Alpha ist. Künftig, ab der ersten
   stabilen Version (1.0.0), bleibt ein umbenannter Pfad 3 Majors lang als Alias erreichbar.

Damit entfällt das Akzeptanzkriterium „alte Routen funktionieren während der Übergangszeit
weiter“ der Aufgabe für diese Umstellung (Kommentar an LLH-1979, 22.11.2026).

## Bestand (22.11.2026)

- 598 verschiedene Pfade, 567 davon mit mindestens einem deutschen Segment. Registriert in einer
  flachen `.route(…)`-Kette in `src/app.rs` (`build_router_mit`, 656 Registrierungen), v1 über
  `#[utoipa::path(path = …)]` in `src/public_api/**`. Drei Pfade stehen als Konstanten
  (`MELDEN_PFAD`, `SPIEGEL_PFAD` in `src/instanz/extractor.rs`, `ZERTIFIKAT_PFAD` in
  `src/instanz/melden.rs`).
- `/api/einsaetze/…` allein: 362 Pfade. Zweite Ebene darunter u. a. `personen` 36,
  `einheiten` 25, `uhs` 24, `stab` 21, `abloesungen` 20.
- Pfade nach Routenmuster (`MatchedPath`) in Tabellen: `src/geraet/mod.rs` (317 Literale),
  `src/einsatz/modul.rs` (96), `src/zulassung.rs` (43), `src/routes/live.rs`
  `STAMMDATEN_PFADE` (25), `src/instanz/spiegel/antrag.rs` (18), `src/auth/session.rs`,
  `src/static_files.rs`. Vier Wächtertests lesen `src/app.rs` als Text
  (`tests/geraet_routen_guard.rs`, `tests/zulassung_guard.rs`,
  `tests/stammdaten_live_guard.rs`, `tests/einsatz_kontext_guard.rs`).
- Verweise: rund 5.100 in Rust-Tests (`tests/`, Literale und `format!`), 554 im Frontend-Code
  (523 in `frontend/src/api/*.ts`), rund 6.100 in Frontend-Tests (MSW), rund 1.680 in
  `frontend/e2e/`.
- Feste Pfade außerhalb des Frontends: `/api/auth/app-code/einloesen` in
  `src-tauri/src/anmeldung.rs` und `ios/LifelineKern/Sources/LifelineKern/Anmeldung.swift`;
  v1-Pfade in `crates/lifeline-machine-client/`, `docs/api/` (Testvektoren signieren den Pfad als
  `htu`), `src/public_api/description.md`; Kopplungspfade zwischen Servern verschiedener Stände.
- Die erzeugten Typen enthalten keine Pfade (`frontend/src/api/openapi.json` ohne `paths`);
  `docs/api/public-v1.json` enthält die 12 v1-Pfade.

## Ziele

- Jede API-Route ist englisch: jedes feste Segment besteht aus erlaubten englischen Wörtern.
- Ein Wächter macht das Gate rot, sobald ein Pfad mit einem nicht erlaubten Wort registriert
  wird, der nicht im schrumpfenden Bestand steht.
- Am Ende aller Pakete ist der Bestand leer.
- Jedes Paket stellt Backend, Frontend, Hüllen, Tests, e2e und Doku seiner Pfade in einem PR um;
  danach gibt es den alten Pfad nicht mehr.

## Nicht-Ziele

- **Wire-Felder, Wire-Werte, Ereignisnamen, Query-Parameter, Tabellen, gespeicherte Schlüssel**
  bleiben, wie sie sind. Für bestehende gilt weiter „Grenzwerte bleiben“.
- **Bezeichner im Code** folgen weiter „Fachbegriffe deutsch, Technik englisch“
  (`load_einsatz` bedient `/api/incidents/{id}`). Pfadparameter-Namen (`{einsatz_id}`) sind
  Code, nicht Wire, und bleiben.
- **App-Routen** des Frontends (`/einsaetze/…`, Deeplinks) bleiben deutsch; sie sind Oberfläche.
- **Keine Alias-Schicht jetzt.** Sie wird erst gebaut, wenn nach 1.0.0 ein Pfad umbenannt wird.

## Anti-Ziele

- Die API umbauen statt übersetzen: Pfadform, Methoden, Verschachtelung und Statuscodes bleiben;
  übersetzt wird Segment für Segment.
- Zwei Namen für dasselbe Ding: ein deutscher Begriff bekommt genau ein englisches Wort, quer über
  alle Module (`personal` überall `personnel`, nie hier `staff`, dort `personnel`).
- Ein Paket, das die alten Pfade teilweise stehen lässt oder doppelt registriert.

## Ansätze

**Übergang** (am Checkpoint entschieden):

- *Harter Schnitt je Paket* (gewählt): Backend, Frontend und Hüllen ziehen im selben PR um. Das
  Frontend ist ins Backend-Binary eingebettet, Desktop-Hülle und Server teilen die Version. Was
  bricht: offene Tabs und der Alarm-Service-Worker mit altem Bundle bis zum Update, iOS-Builds
  älterer Stände, gekoppelte Instanzen verschiedener Stände. In der Alpha vertretbar.
- *Alias bis 1.0* (verworfen): eine Umschreib-Schicht vor dem Router, die alte Pfade auf neue
  abbildet. Mehr Arbeit, denn signierte Pfade brauchen dann den Original-URI; der Nutzen fällt in
  der Alpha kaum an.
- *Doppelte Registrierung* (verworfen): verdoppelt alle `MatchedPath`-Tabellen und Wächter.

**Umfang** (am Checkpoint entschieden): alle Segmente mit Glossar, statt nur technische Wörter
(Verben, Strukturwörter, rund 170 Pfade). Letzteres hätte die Code-Regel gespiegelt, aber
`/api/einsaetze` deutsch gelassen, und das Ticket nennt es ausdrücklich.

**Wächter** (meine Wahl): eine Liste erlaubter englischer Wörter statt einer Erkennung, die
„deutsch“ rät. Eine Heuristik irrt bei `material`, `plan`, `transport` oder `position` in beide
Richtungen. Mit der Liste wird jedes neue Wort ausdrücklich eingetragen und ist im Diff sichtbar.
Gleichzeitig ist die Wortliste das Glossar.

## Die Regel

**Wurzel-`AGENTS.md`, „Bezeichner-Sprache“** bekommt einen Punkt „API-Routen englisch“ und einen
geänderten Punkt „Grenzwerte bleiben“ (Routen fallen dort heraus):

- Jedes feste Segment einer API-Route ist englisch, auch Fachbegriffe; die Übersetzung steht im
  Glossar (`scripts/api-routen-woerter.tsv`). Abkürzungen ohne gebräuchliche Übersetzung
  (`etb`, `uhs`) stehen dort als eigenes Wort.
- Kleinbuchstaben, Wörter mit `-` verbunden; Sammlungen im Plural, Aktionen als Verb am Ende
  (`/acknowledge`).
- Neue Request- und Response-Typen haben englische Wire-Felder, auch für Fachbegriffe; ihre
  Rust-Felder heißen wie das Wire-Feld (kein `#[serde(rename)]`, LFH-1312 D4). Ein neues Feld in
  einem bestehenden Typ folgt der Sprache dieses Typs. *(Meine Wahl: ein Typ mit gemischten
  Feldsprachen wäre schlechter als ein deutsches Feld mehr; umgestellt wird der Typ als Ganzes,
  in einer eigenen Aufgabe.)*
- Ab 1.0.0: Wer einen Pfad umbenennt, lässt den alten 3 Majors lang als Alias erreichbar.

**Neue ADR** (`ADR-0082`, sofern die Nummer auf `alpha` dann noch frei ist; `gilt_fuer`:
`src/app.rs`, `src/public_api/**`, `scripts/api-routen-*`). Regeln: Routen englisch nach Glossar,
Bestand darf nur schrumpfen, harter Schnitt bis 1.0.0, Alias für 3 Majors danach. Prüfung:
`verlange` auf den Wächter-Aufruf in `scripts/check-all.sh`. Kontext und Konsequenzen verweisen
auf dieses Design-Doc. Die Wurzel-`AGENTS.md` verweist auf die ADR, die ADR auf die
`AGENTS.md`-Stelle, ohne den Wortlaut zu wiederholen.

**ADR-0022** (v1-Stabilitätszusage „innerhalb von v1 nur hinzufügen“) widerspricht der
Umbenennung der v1-Pfade. Das löst das **v1-Paket** auf, nicht das Fundament: Es ersetzt
ADR-0022 durch eine neue ADR mit denselben Regeln, deren Stabilitätszusage ab 1.0.0 gilt. Bis
dahin stehen die v1-Pfade im Bestand, und es gibt keinen Widerspruch.

**Kapitel 12** (`docs/architektur/12-glossar.md`) bekommt einen Satz, der auf die Wortliste als
englisches Glossar der API zeigt.

## Glossar und Wächter

**`scripts/api-routen-woerter.tsv`** (das Glossar): eine Zeile je erlaubtem **Segment**, nicht
je Einzelwort, Spalten `segment`, `deutsch`. `segment` ist ein ganzes Pfadsegment, auch
zusammengesetzt (`command-post`, `resource-requests`, `end-others`); `deutsch` ist der Begriff,
den es übersetzt (`Führungsstelle`), oder `-` für Segmente ohne deutsches Gegenstück (`api`,
`v1`, `openapi.json`, `health`). Beide Spalten sind eindeutig (außer `-`): ein deutscher Begriff
hat genau ein englisches Segment und umgekehrt. *(Meine Wahl nach dem Gegenlesen: Eine reine
Wortliste hätte das Anti-Ziel „zwei Namen für dasselbe Ding“ nicht prüfen können; Stellen /
Posten / Plätze werden drei Zeilen.)* Sortiert nach `segment`. Das Fundament trägt die heute schon
englischen Segmente, die des ersten Pakets und den Kern der Fachbegriffe (unten). Jedes Paket
ergänzt die Segmente seiner Pfade.

**`scripts/api-routen-bestand.txt`**: die heute registrierten Pfade mit mindestens einem
Segment, das nicht im Glossar steht, einer je Zeile, sortiert. Darf nur schrumpfen.

**`scripts/check-api-routen.sh`** (+ `.test.sh`, Muster wie `check-schreibweisen.sh`):

1. Pfade sammeln: Literale aus `.route("…"` in `src/app.rs`, `path = "…"` in
   `src/public_api/**`, Konstanten `const …_PFAD: &str = "/api/…"` unter `src/`.
2. Jedes feste Segment (nicht `{…}`) im Glossar nachschlagen. Ein Pfad mit einem Segment
   außerhalb des Glossars muss im Bestand stehen, sonst rot, mit Pfad, Segment und Abhilfe
   („Segment ins Glossar oder englisch benennen“).
3. Ein Bestandseintrag, der nicht mehr registriert ist, ist rot (veraltet, Zeile löschen); so
   schrumpft die Datei mit jedem Paket.
4. Mehr Zeilen im Bestand als auf `origin/alpha` (Merge-Base) ist rot. Ohne den Ref laut
   übersprungen, wie `check-adr-nummern.sh`.
5. Das Glossar selbst: sortiert, beide Spalten eindeutig (außer `-` in `deutsch`), `segment`
   nur `[a-z0-9]+([.-][a-z0-9]+)*`.

Eingehängt in **Schritt 14** von `check-all.sh` (Bündel `schnell`, läuft also in jedem PR),
erst der Selbsttest, dann die Prüfung; der Titel des Schritts nennt beide Wächter. *(Meine Wahl:
ein eigener Schritt 20 hieße, Bündel, Selbstprüfung und beide Workflows `ci.yml`/`pr.yml`
mitzuziehen, für einen Wächter, der unter einer Sekunde läuft.)* `scripts/AGENTS.md` nennt den
Wächter in der Kette.

## Kern des Glossars (freigegeben 22.11.2026)

| deutsch | englisch | | deutsch | englisch |
| --- | --- | --- | --- | --- |
| Einsätze | `incidents` | | Stab | `staff` |
| Einsatzabschnitte | `sectors` | | Führung | `command` |
| Lage | `situation` | | Führungsstelle | `command-post` |
| Lagebild | `situation-picture` | | Führungsfunktionen | `command-roles` |
| Lageberichte | `situation-reports` | | Stellen / Posten / Plätze | `positions` / `posts` / `seats` |
| Meldungen | `reports` | | Sprechgruppen | `talk-groups` |
| Lagebesprechung | `briefings` | | Fernmeldeskizze | `comms-sketch` |
| Lagemonitor | `situation-monitor` | | Kommunikationsplan | `comms-plan` |
| Karte | `map` | | Infotelefon | `info-line` |
| ETB, UHS | `etb`, `uhs` | | Befehle | `orders` |
| Personen | `persons` | | Aufträge | `tasks` |
| Sichtung | `triage` | | Nachforderungen | `resource-requests` |
| Betreuung | `care` | | Anträge | `requests` |
| Verpflegung | `catering` | | Schäden | `damages` |
| Unterkunft | `accommodation` | | Gefahrengebiete | `hazard-areas` |
| Evakuierung | `evacuation` | | Pegel | `gauges` |
| Tiere | `animals` | | Notübernahme | `emergency-takeover` |
| Verbleib | `whereabouts` | | Einwurf | `intake` |
| Kräfte | `forces` | | Anbindungen | `integrations` |
| Einheiten | `units` | | Kopplungen / koppeln | `pairings` / `pair` |
| Personal | `personnel` | | Geräte | `devices` |
| Fahrzeuge | `vehicles` | | Instanz / Spiegel | `instance` / `mirror` |
| Material | `material` | | Stammdaten | `master-data` |
| Ablösungen | `reliefs` | | Aufbewahrung | `retention` |
| Schichtplan | `shift-plan` | | Einsatzakte | `case-file` |
| Bereitstellungsräume | `staging-areas` | | Planungen | `plans` |
| Versionsstand | `release-notes` | | Benutzer / Sitzungen | `users` / `sessions` |

Verben und Strukturwörter (`einloesen` → `redeem`, `quittieren` → `acknowledge`, `widerrufen` →
`revoke`, `vorschau` → `preview`, `suche` → `search`) übersetzt das jeweilige Paket; das Wort
landet mit dem PR in der Liste, wo es Ruben im Diff sieht.

## Erstes Paket im Fundament: Anmeldung und Neuigkeiten

Grund: Es enthält den einzigen Pfad, den die Hüllen fest eingebaut haben, und prüft den Weg also
dort, wo er am heikelsten ist. Umfang:

- `/api/auth/…`: `app-code/einloesen` → `app-code/redeem`, `sitzungen` → `sessions`,
  `passwort` → `password`, `…/festlegen` → `…/set`, `andere-beenden` → `end-others`
  (genaue Zuordnung im Plan aus `src/app.rs`). Cookie-Pfade `/api/auth` und
  `/api/auth/webauthn` bleiben (schon englisch).
- `/api/versionsstand`, `/api/versionsstand/gelesen` → `/api/release-notes`,
  `/api/release-notes/read`.
- Mitziehen: `MatchedPath`-Tabellen, Wächtertests, Rust-Tests, `frontend/src/api` und
  `frontend/src/auth`, MSW-Handler, e2e, `src-tauri/src/anmeldung.rs` samt Test,
  `ios/LifelineKern` (`Anmeldung.swift`, `AnmeldungTests.swift`), Doku mit diesen Pfaden.
- **`SHELL_CONTRACT` von 1 auf 2** (`src/routes/shell.rs`): Der Login-Pfad der Hülle bricht, und
  genau dafür steigt der Vertrag. Eine ältere iOS-Hülle (`bekannteVertraege = [1]` in
  `ios/LifelineKern/Sources/LifelineKern/LifelineKern.swift`) zeigt dann „Hülle zu alt“ statt
  einer gescheiterten Anmeldung (`Vertragspruefung.richtung` → `.zuNeu`).
- **Die neue iOS-Hülle kennt nur Vertrag 2** (`bekannteVertraege = [2]`): Ein Server älteren
  Stands zeigt ihr „Server zu alt“. *(Ruben, 22.11.2026: nur Vertrag 2. Die Alternative `[1, 2]` mit Pfadwahl nach
  Vertrag wäre neue Logik im Kern, also genau der Alias, den der harte Schnitt vermeidet.)*
- **Desktop-Hülle:** Sie prüft keinen Vertrag (das bringt LLH-1982). Bei Versionsabstand
  zwischen Hülle und Server scheitert „Im Browser anmelden“ mit 404. Sie aktualisiert sich selbst
  (`tauri-plugin-updater`), der Abstand ist also kurz. *(Ruben, 22.11.2026: als Alpha-Risiko
  hingenommen; keine Vertragsprüfung und kein Rückfall auf den alten Pfad hier.)*

## Pakete (Unteraufgaben von LLH-1979)

Je Paket ein PR mit hartem Schnitt; Reihenfolge von oben nach unten, das Präfix `einsaetze`
zuletzt. Pakete unter `/api/einsaetze/{id}/` übersetzen zunächst nur die Segmente nach `{id}`.

1. **Stammdaten** — `fahrzeuge`, `personal`, `material`, `qualifikationen`, `einheit-typen`,
   `einheit-vorlagen`, `einsatz-vorlagen`, `verpflegung-vorlagen`, `etb-bausteine`,
   `fahrzeug-status`, `personal-status`, `sprechgruppen`, `stichwort-vorschlaege`,
   `material-kategorien`, `fuehrungsfunktionen`, `schichtmodelle`, `externe-stellen`,
   `unterkunft-richtwerte`, `*-vorschlaege`, `ort-suche`, `ort-vorschau`.
2. **Konten, Org und System** — `benutzer`, `benutzer-einstellungen`, `organisation`,
   `org-*`, `zugangsprotokoll`, `benachrichtigungen`, `antraege`, `web-push`, `client-fehler`,
   `demo-daten`, `system`, `verwaltung`, `geraete/koppeln`.
3. **Admin** — `/api/admin/…` ohne `admin/instanz`.
4. **Karte** — `/api/karte/…` (auch `tiles_url` und Stil-JSON aus `src/routes/karte.rs`,
   `src/karte/proxy.rs`).
5. **Planungen** — `/api/planungen/…`.
6. **Aufbewahrung** — `/api/aufbewahrung/…`.
7. **Instanzkopplung** — `/api/instanz/…`, `/api/admin/instanz/…`, `…/bruchstelle`; mit
   Sprung von `instanz::PROTOKOLL`, damit verschieden alte Instanzen einen klaren Fehler sehen.
8. **Öffentliche API** — `/api/v1/…`, `/api/extern/v1/lagebild`; ersetzt ADR-0022 (s. o.),
   zieht `crates/lifeline-machine-client`, `docs/api/` samt Testvektoren,
   `src/public_api/description.md` und `docs/api/public-v1.json` mit.
9. **Einsatz: Personen und Betreuung** — `personen`, `uhs`, `betreuung`, `verpflegung`,
   `tiere`, `evakuierung`, `unterkunft-richtwerte`.
10. **Einsatz: Kräfte** — `einheiten`, `personal`, `fahrzeuge`, `material`, `abloesungen`,
    `bereitstellungsraeume`, `geraete`, `mitglieder`.
11. **Einsatz: Stab, Führung, Fernmelden** — `stab`, `fuehrung`, `fuehrungsstelle`,
    `lagebesprechung(en)`, `sprechgruppen`, Fernmeldeskizze, Kommunikationsplan, Infotelefon.
12. **Einsatz: ETB, Meldungen, Aufträge** — `etb`, `meldungen`, `lageberichte`, `befehle`,
    `auftraege`, `nachforderungen`, `chat`, `erinnerungen`, `dokumente`, `anhaenge`, `antraege`.
13. **Einsatz: Lage und Karte** — `schaeden`, `gefahrengebiete`, `zonen`, `pegel`, `karte`,
    `freie-zeichen`, `karten-ansichten`, `abschnitte`, `wetter`, `lage`, `lage-snapshots`,
    `lagebild-freigaben`, `lagemonitor`, `lagekennzahl-wahl`.
14. **Einsatz: Rahmen** — die übrigen Segmente unter `/api/einsaetze/{id}/` (`modul-*`,
    `einstellungen`, `einsatzakte`, `abschluss`, `abschliessen`, `wiedereroeffnen`,
    `nachbereitung`, `aufbewahrungsfrist`, `benachrichtigung-vorgaben`, `anbindungen`,
    `praesenz`, `live`) und `/api/einsaetze` ohne Unterpfad.
15. **Präfix** — `einsaetze` → `incidents` in allen Pfaden, ein mechanischer PR. Danach ist der
    Bestand leer.

Der Zuschnitt ist ein Vorschlag nach Pfadzahl und Bereichs-`AGENTS.md`; wo der Plan eines
Pakets zeigt, dass ein Segment besser zu einem Nachbarpaket passt, darf er es verschieben. Jedes
Paket ist Route `klar` (Übersetzung nach Glossar, keine neue Entscheidung); fehlt ein
Fachbegriff im Glossar, legt das Paket ihn Ruben vor, bevor es baut.

## Was jedes Paket mitzieht

- `src/app.rs`, die `MatchedPath`-Tabellen und die Wächtertests, die `src/app.rs` lesen.
- Rust-Tests unter `tests/` und `#[cfg(test)]` in `src/`.
- `frontend/src/api/*.ts` und die übrigen Stellen mit Pfaden (u. a. `live/`, `auth/`,
  `geraet/`, `chat/`, `routing/deeplinks.ts`, `public/alarm-sw.js`, Regex in
  `api/anhangFassung.ts` und `api/antragEreignis.ts`), MSW-Handler, `frontend/e2e/`.
- Doku mit diesen Pfaden (`docs/architektur/`, `docs/betrieb/`, `docs/api/`, Bereichs-
  `AGENTS.md`). Was in archivierten Design-Docs, OpenSpec-Archiv und alten Plänen steht, bleibt.
- **Gespeicherte Pfade suchen:** Steht ein Pfad des Pakets in einer Datenbankzeile, in
  IndexedDB, in einem Push-Payload oder einem gespeicherten Link, braucht es eine Migration oder
  einen Nachzug, sonst zeigt der alte Wert ins Leere. Jeder Plan prüft das ausdrücklich.
- Wortliste ergänzen, Bestandszeilen löschen.

## Risiken

- **Parallele PRs:** Jedes Paket berührt `src/app.rs` und `src/geraet/mod.rs`. Pakete
  nacheinander mergen, `alpha` vor dem Auto-Merge in den Branch holen
  (`dev-zunder-ausfuehren`, „Mit `alpha` zusammen bauen“).
- **Signierte Pfade:** Testvektoren und Kopplungssignaturen enthalten den Pfad; sie werden im
  v1- bzw. Kopplungspaket neu erzeugt, nicht von Hand angepasst.
- **Nach dem Update** sehen offene Tabs mit altem Bundle 404 auf umbenannten Pfaden, bis neu
  geladen wird; ebenso eine Desktop-Hülle mit anderem Stand als der Server bei der Anmeldung.
  Bewusst hingenommen (Alpha).

## Dem Planer überlassen

- Die genaue Übersetzung der Verben und Strukturwörter je Paket, im Rahmen des Glossars.
- Die Form des Wächterskripts und seiner Selbsttests, im Rahmen der fünf Prüfpunkte.
- Ob ein Paket groß genug ist, dass seine Umsetzung Subagents je Teilbereich lohnt.
