# Design

## Context

Motivation und Messung vorher: proposal.md, „Why“. Was die Lösung formt:

- **Pflicht-Checks hängen am Namen und am Kopf-Commit.** Das Ruleset 17017911 verlangt unter
  anderem `Schnellprüfungen`, `Rust-Suite`, `Frontend-Suite 1/4` bis `4/4`, `e2e-Binary` und
  `e2e 1/4` bis `4/4`. Ein übersprungener Job **ohne** Matrix meldet sich unter seinem Namen als
  `skipped` und erfüllt damit seinen Check. Ein per Job-`if` übersprungener **Matrix**-Job meldet
  sich unter seinem unexpandierten Namen (`e2e ${{ matrix.shard }}/4`), der gerenderte Name fehlt
  (Kopf von `ci.yml`). Gibt es zu einem Namen mehrere Check-Runs auf einem Commit, zählt der
  jüngste.
- **`ci.yml` bricht nur PR-Läufe ab** (`concurrency: ci-<ref>`, `cancel-in-progress` bei
  `pull_request`). Jeder weitere Lauf desselben Workflows auf demselben PR bricht den laufenden ab.
- **Der Release hängt in `ci.yml`** und nennt `schnell`, `rust`, `frontend`, `e2e` in `needs`.
  `workflow_run` taugt nicht (semantic-release liest den Branch aus `GITHUB_REF`, Kopf von
  `release.yml`).
- **`pull_request` kennt die Ereignistypen `auto_merge_enabled`, `auto_merge_disabled`, `labeled`
  und `unlabeled`.** Die Nutzlast trägt `pull_request.auto_merge` (Objekt oder `null`) und
  `pull_request.labels` im Zustand **nach** dem Ereignis. Ein Lauf auf `pull_request` nimmt den
  Workflow aus dem Merge-Commit von PR und Ziel-Branch; eine Änderung wirkt also auf alle offenen
  PRs, sobald sie auf `alpha` liegt.
- **Auto-Merge schalten Menschen ein.** Sitzungen mergen nicht; ein Label setzen dürfen sie.
- **PR #1289 (LLH-1660)** zieht in `ci.yml` den Schritt „Nur umnummeriert?“ in den Job
  `aenderungen` (`scripts/nur-umnummeriert.sh vorgaenger|gruen`) und bringt den Stau-Wächter
  (`scripts/stau-waechter.sh`). `gruen` verlangt heute `Rust-Suite`, `Frontend-Suite k/4` und
  `e2e k/4` gemeinsam. Diese Change setzt auf den Stand nach dem Merge auf.

## Goals / Non-Goals

**Goals:**

- Kein e2e-Job auf einem PR, der nicht fertig markiert ist; die zweite Stufe startet ohne neuen
  Commit, sobald er es ist.
- Keine Stelle, an der ein ungeprüfter Commit grüne e2e-Pflicht-Checks trägt.
- Die e2e-Jobs stehen in genau einer Datei, für PR und Kanal-Branch.

**Non-Goals:**

- Den Zeitpunkt der ersten Stufe ändern (sie läuft weiter bei jedem Push).
- Das Ruleset ändern oder Check-Namen umbenennen.
- Die Merge Queue (LLH-1663) vorwegnehmen.

## Decisions

### D1 Die zweite Stufe ist ein eigener Workflow `e2e.yml`

`e2e.yml` enthält die Jobs `aenderungen` (nur e2e-Auswahl), `binaer`, `e2e` (Matrix 1–4) und
`berichte` (nur Playwright). Auslöser:

- `pull_request` mit den Typen `opened`, `synchronize`, `reopened`, `auto_merge_enabled`,
  `auto_merge_disabled`, `labeled`, `unlabeled`: die zweite Stufe für PRs.
- `workflow_call`: `ci.yml` ruft ihn bei einem Push auf einen Kanal-Branch als Job `e2e` auf, und
  `release` wartet darauf wie bisher.

Im aufgerufenen Lauf ist `github.event_name` das Ereignis des Aufrufers (`push`). Bei Push heißen
die Checks `e2e (Kanal) / e2e 1/4` usw. (Name des Aufruf-Jobs als Vorsilbe, an `Release / release`
belegt); auf Kanal-Branches verlangt das Ruleset keine Checks, also stört
das Präfix nicht. Im PR heißen sie genau `e2e-Binary` und `e2e 1/4` bis `4/4`, weil der Workflow
dort direkt läuft.

Verworfen:

- **Alles in `ci.yml`, mit den zusätzlichen Ereignistypen.** Das Einschalten von Auto-Merge
  startete einen zweiten `ci.yml`-Lauf in derselben Nebenläufigkeitsgruppe und bräche den
  laufenden ab (Rust mittendrin). Sollte der neue Lauf Schnellprüfungen und Rust überspringen,
  meldete er sie als `skipped`, also als jüngsten und grünen Check-Run, auch über einem roten
  (Lücke).
- **Composite Action, e2e-Jobs in beiden Workflows.** Hält die Schritte einmal, aber die
  Job-Definitionen (Bedingungen, Matrix, Artefakte, Bericht) doppelt. Der Aufruf als
  wiederverwendbarer Workflow hält alles einmal. (In der Abstimmung am 12.11.2026 als „Composite
  Action“ genannt; der Weg bleibt derselbe, nur das Mittel der Teilung ist ein anderes.)
- **Kommentar `/e2e`** und **nur Label**: am Checkpoint mit Ruben verworfen.

### D2 „Fertig“ und „starten“ stehen als Ausdruck am Job, nicht im Auslöser

Fertig heißt `auto_merge != null || contains(labels.*.name, 'e2e')`, gelesen im Zustand nach dem
Ereignis. Gestartet wird nicht bei jedem Ereignis, an dem der PR fertig ist, sondern nur, wenn
sich etwas zu prüfen ergibt (sonst liefe etwa bei einem fremden Label ein zweiter e2e-Lauf neben
dem ersten):

- immer bei Push (Aufruf aus `ci.yml`);
- bei einem neuen Commit (`opened`, `synchronize`, `reopened`), wenn der PR fertig ist;
- bei `auto_merge_enabled`, wenn das Label `e2e` nicht schon gesetzt war;
- bei `labeled` mit `e2e`, wenn Auto-Merge nicht schon an war.

Diese Bedingung steht **nur** am Job `aenderungen` (`e2e-Auswahl`); `binaer` und `e2e` hängen an
dessen Ergebnis (`needs.aenderungen.result != 'skipped'`). Eine Stelle statt drei Kopien, und
eine rote Auswahl lässt die Stufe trotzdem laufen (im Zweifel wird geprüft).

### D3 Die Pflicht-Checks fehlen, weil beide Jobs Matrix-Jobs sind

- `e2e` ist schon eine Matrix (`shard: [1, 2, 3, 4]`). Bisher trug er die Bedingung „e2e
  betroffen“ an jedem Schritt (leer grün). Neu hängt das Job-`if` am Ergebnis der Auswahl (D2),
  „e2e betroffen“ bleibt an den Schritten. Nicht fertig: unexpandierter Name, die gerenderten Checks fehlen.
  Fertig, aber nicht betroffen: leer grün wie bisher.
- `binaer` bekommt eine Matrix mit einem Eintrag, aus dem der Name entsteht
  (`name: ${{ matrix.check }}`, `check: [e2e-Binary]`). Nicht fertig: Check-Run
  `${{ matrix.check }}`, `e2e-Binary` fehlt. Fertig, aber nicht betroffen: Job-`if` wie bisher
  ersetzt durch Schritt-Bedingungen, damit er leer grün meldet, statt als übersprungen unter dem
  unexpandierten Namen zu fehlen.
- Die `e2e`-Anteile laufen weiter nur bei grünem oder leerem Binary; ein rotes Binary lässt sie
  per Job-`if` aus, also fehlen sie.
- In `ci.yml` entfallen `binaer` und `e2e` als eigene Jobs; der Aufruf-Job `e2e` hat
  `if: github.event_name == 'push'`. Sein Name enthält keinen Pflicht-Check-Namen, ein
  übersprungener Aufruf erfüllt also nichts.

Ein Selbsttest prüft die Workflows auf diese Form (D7), weil ein falsch gesetztes `if` sonst erst
am ersten ungeprüft gemergten PR auffiele.

### D4 Die Nebenläufigkeit unterscheidet umschaltende von bedeutungslosen Ereignissen

`concurrency` von `e2e.yml` (`cancel-in-progress` nur im PR):

- Gemeinsame Gruppe `e2e-pr-<nummer>` für jedes Ereignis, das nach D2 startet (auch einen neuen
  Commit an einem fertigen PR), und für das Zurücknehmen der letzten Fertig-Markierung
  (`auto_merge_disabled` oder `unlabeled e2e`, wenn der PR danach nicht mehr fertig ist). Ein
  neuer Lauf bricht den alten ab; startet er selbst nichts, ist der alte trotzdem beendet. So
  bricht „Auto-Merge aus“ einen laufenden e2e-Lauf ab.
- Eigene Gruppe je Lauf (`run_id`) für alles andere: ein fremdes Label, `unlabeled e2e` oder
  `auto_merge_disabled` bei weiter fertigem PR, `auto_merge_enabled` bei schon gesetztem Label,
  und ein neuer Commit an einem PR, der laut Nutzlast nicht fertig ist. Diese Läufe starten nichts
  und bremsen keinen laufenden. Der letzte Fall ist eine Korrektur aus dem Review: Die Nutzlast ist
  der Stand beim Ereignis, und GitHub garantiert die Reihenfolge der Läufe nicht. Pusht jemand und
  schaltet Sekunden später Auto-Merge ein, oder legt eine Sitzung den PR mit Label an (`opened`,
  dann `labeled`), käme der Commit-Lauf mit der Nutzlast „nicht fertig“ unter Umständen erst
  danach und bräche den gerade gestarteten e2e-Lauf ab.
- Bleibt ein Rest: Ein `auto_merge_disabled`-Lauf, der erst nach einem späteren
  `auto_merge_enabled` eingereiht wird, bricht dessen Lauf ab. Dann stehen auf dem Kopf nur
  abgebrochene e2e-Checks; der Stau-Wächter meldet das nach 20 Minuten (D8).
- Aufruf aus `ci.yml` (Push): eigene Gruppe je Lauf; die Nebenläufigkeit regelt dort `ci.yml`.

Folge: Wer Auto-Merge einschaltet, nachdem das Label schon einen Lauf gestartet hat, startet
keinen zweiten; ist der erste grün, mergt GitHub.

### D5 Die Auswahl der Suiten wird ein Skript, das beide Workflows fragen

Die Logik des Jobs `aenderungen` (nach #1289: Umnummerierung prüfen, sonst `bereiche.sh` auf den
Diff) zieht nach `scripts/ci-auswahl.sh <stufe>` um. `stufe` ist `eins` (rust, frontend) oder
`zwei` (e2e). Das Skript liest Ereignis, Kopf-Commit und Repository aus der Umgebung, holt
Check-Runs über eine einzige Funktion (im Selbsttest ersetzt, Muster des Stau-Wächters) und
schreibt die Zeilen für `$GITHUB_OUTPUT`. Push-Läufe bekommen alles. Jeder Fehler fällt auf „alles
läuft“ zurück. Beide Workflows rufen es, keiner trägt die Logik inline.

### D6 Die Umnummerierung entscheidet je Suite

`nur-umnummeriert.sh gruen` bekommt die Suite als Argument (`frontend` oder `e2e`) und prüft nur
deren Checks am Vorgänger: `Frontend-Suite 1/4` bis `4/4` bzw. `e2e-Binary` und `e2e 1/4` bis
`4/4`, jeweils `success` oder `skipped` mit gerendertem Namen. Die Rust-Suite läuft weiter immer
neu und wird nicht mehr abgefragt. Ein Vorgänger ohne e2e-Lauf lässt so nur die e2e-Übernahme
scheitern, nicht die der Frontend-Suite. In der zweiten Stufe fehlen die e2e-Checks ohnehin, bis
der PR fertig ist; ist er fertig und war e2e am Vorgänger grün, meldet die zweite Stufe leer grün.

### D7 Selbsttests statt Vertrauen in YAML

- `scripts/ci-auswahl.test.sh`: Stufe eins und zwei, Push, PR mit Diff, reine Umnummerierung mit
  grünem, rotem und fehlendem Vorgänger je Suite, Fehler der Abfrage.
- `scripts/ci-stufen.test.sh`: liest `ci.yml` und `e2e.yml` und prüft die Form aus D2–D4
  (Start-Bedingung an der Auswahl, Matrix an `binaer` und `e2e`, „betroffen“ nur an Schritten,
  kein Job in `ci.yml` mit einem Pflicht-Check-Namen der zweiten Stufe, kein neuer Ereignistyp in
  `ci.yml`, `release` nennt den Aufruf-Job, Gruppe und Start teilen die Ereignisliste). Ohne
  YAML-Parser (keiner ist überall da, wo das Gate läuft): Jobblöcke per `awk`.
- Beide hängen an Schritt 11 von `check-all.sh` (Selbsttests der Gate-Skripte).
- Mutationsproben am Ende: Job-`if` an `e2e` entfernen, Matrix an `binaer` entfernen,
  `gruen e2e` auf Frontend-Checks verbiegen; die Tests müssen sie töten.

### D8 Der Stau-Wächter meldet „Auto-Merge an, e2e fehlt“

`stau-waechter.sh` bekommt einen vierten Befund neben Konflikt, fehlender CI und
„grün, nicht gemergt“: Auto-Merge an, die zweite Stufe ist auf dem Kopf-Commit nicht gelaufen,
Wartezeit 20 Minuten. Gelaufen ist sie, wenn der jüngste Lauf von `e2e-Binary` oder eines
Anteils weder übersprungen noch abgebrochen ist, oder solange `e2e-Auswahl` läuft (das
Startfenster, bevor die übrigen Checks entstehen). Je Name zählt der jüngste Check-Run, wie bei
den Required Checks; das gilt seit dem Review auch für „grün, nicht gemergt“, das sonst ein
abgebrochener erster Lauf auf demselben Kopf für immer abschaltete. Die Uhr läuft ab dem späteren von (a) frühestem Check-Run des Kopf-Commits
und (b) dem Zeitpunkt, zu dem Auto-Merge eingeschaltet wurde (Ereignis
`auto_merge_enabled` der PR-Zeitleiste; fehlt es, gilt `updated_at` des PRs). Der Hinweis nennt
den Handgriff: Auto-Merge aus- und wieder einschalten oder einen neuen Commit pushen. Das Label
`e2e` hilft hier nicht: bei eingeschaltetem Auto-Merge ändert es den Zustand nicht und startet
nach D4 nichts. Umgekehrt startet Aus- und Einschalten nichts, wenn das Label gesetzt ist; der
Wächter kennt die Labels nicht und nennt deshalb beides im Text (Label vorher entfernen). Kein Push. Der Befund steht vor „grün, nicht gemergt“: ohne e2e-Checks sind die
vorhandenen grün, und der alte Befund schlüge fälschlich an (im Selbsttest vor der Umsetzung
belegt). Die Art heißt `ohne-e2e`; das Muster der Marke erlaubt dafür Ziffern.

### D9 Messung als Skript

`scripts/ci-messung.sh --von <zeit> --bis <zeit>` fragt über `gh api` die Läufe von `ci.yml` und
`e2e.yml` mit Ereignis `pull_request` im Zeitraum ab und gibt je PR (Kopf-Branch) eine Zeile aus:
Läufe, davon abgebrochen/rot/grün/laufend, gestartete Jobs (ohne `skipped`), Job-Minuten und,
getrennt, Läufe ohne gestarteten Job (die übersprungene zweite Stufe an einem PR in Arbeit belegt
keinen Runner und zählt nicht als Lauf). Dazu eine Summenzeile. Nur ein 404 lässt einen Workflow
aus (vor der Zweiteilung gibt es `e2e.yml` nicht); jeder andere Abruffehler und eine von GitHub
abgeschnittene Liste (höchstens 1000 Läufe mit diesen Filtern) brechen mit Exit 2 ab. Die Messung vorher (proposal.md) entstand von Hand über dieselbe API; das Skript
rechnet sie für den Vergleich nach. Selbsttest mit eingespielten API-Antworten.

## Risks / Trade-offs

- [Ein roter e2e-Fall fällt erst nach dem Einschalten von Auto-Merge auf, eine Stunde später als
  heute] → Gewollter Tausch. Wer früher Rückmeldung will, setzt das Label `e2e` oder fährt
  `check-all.sh --geaendert` lokal; das steht in `scripts/AGENTS.md` und in
  `dev-zunder-ausfuehren`.
- [GitHub schaltet Auto-Merge nach einem Push der Release-App (Autofix, Stau-Wächter) aus] →
  Laut Doku nur bei Pushes ohne Schreibrecht; die App hat es. Nicht gemessen. Passiert es, fehlen
  die e2e-Checks sichtbar, der PR mergt nicht; am ersten echten Fall prüfen.
- [Der unexpandierte Name eines übersprungenen Matrix-Jobs zählt eines Tages als erfüllt oder
  wird anders gerendert] → Dasselbe Verhalten trägt heute schon die Frontend-Suite; der
  Selbsttest hält die Form fest, und Auto-Merge an einem frischen PR zeigt es sofort.
- [Ein Ereignis kommt nicht an (Ausfall bei GitHub), Auto-Merge wartet für immer] → Befund D8
  des Stau-Wächters.
- [Die Check-Liste eines PRs zeigt Einträge wie `e2e ${{ matrix.shard }}/4` als übersprungen] →
  Kosmetisch, heute schon bei der Frontend-Suite so; der Kopf von `e2e.yml` erklärt es.
- [`continue-on-error` am Job `berichte` hält den Aufruf in `ci.yml` womöglich nicht grün] → Die
  GitHub-Doku sagt nur, dass der Workflow-Lauf dann nicht scheitert; für den Aufrufer eines
  wiederverwendbaren Workflows ist es nicht belegt. Am ersten Push-Lauf mit rotem Bericht prüfen;
  hält es nicht, wandert der Bericht bei Push in einen eigenen Job in `ci.yml`, auf den `release`
  nicht wartet.
- [#1289 ändert sich im Review noch] → Die Umsetzung beginnt erst nach dessen Merge und baut auf
  `alpha` auf; Abweichungen fließen per `/opsx:update` ein.

## Migration Plan

Ein PR gegen `alpha`, nach dem Merge von #1289. Ab dem Merge gilt die neue Form für jedes
PR-Ereignis, weil `pull_request` den Workflow aus dem Merge mit `alpha` nimmt. Offene PRs mit
Auto-Merge brauchen nach dem Merge einmal Aus- und Einschalten oder einen Push, damit die zweite
Stufe startet; der Wächter (D8) weist darauf hin. Rückweg: `e2e.yml` entfernen und `binaer`/`e2e`
in `ci.yml` wiederherstellen (ein Revert). Einen Tag nach dem Merge misst die Folgeaufgabe mit
`scripts/ci-messung.sh` über denselben Zeitraum-Typ (ein Werktag) nach.

Die Artefakte der e2e-Jobs (`lifeline-hub-debug`, `playwright-blob-k`, `e2e-laufzeiten`,
`playwright-report-versuch-n`) liest kein anderer Workflow (geprüft 12.11.2026); ihr Umzug nach
`e2e.yml` braucht keine Nachzüge.

## Nachträge

- **Messung vorher, Jobs je PR (12.11.2026):** `scripts/ci-messung.sh` ist gegen eingespielte
  API-Antworten geprüft, aber nicht gegen die echte API gelaufen: in der Cloud-Sitzung ist `gh`
  nur für die Suche freigegeben. Die Zahlen in proposal.md (Läufe, Abschlüsse) stammen aus der
  Workflow-Liste über den GitHub-Connector; Jobs und Job-Minuten je PR fehlen dort. Die
  Folgeaufgabe misst deshalb beide Zeiträume mit demselben Skript (vorher: 11.11. 10:17 bis
  12.11. 07:50 UTC; die Läufe bleiben 90 Tage abrufbar).
- **Gruppe und Start (D2, D4) beim Umsetzen geschärft:** Die Start-Bedingung steht nur an der
  Auswahl, `binaer` und `e2e` hängen an deren Ergebnis; ein Fertig-Ereignis, das den Zustand
  nicht ändert (Label bei schon eingeschaltetem Auto-Merge und umgekehrt), startet nichts.
- **Mutationsproben (12.11.2026):** 17 Verfälschungen, alle getötet. Workflows
  (`ci-stufen.test.sh`): Job-`if` an `e2e` entfernt, Matrix-Name an `binaer` entfernt, „betroffen“
  an den Binary-Job gezogen, Fertig-Bedingung bei neuem Commit entfernt, e2e-Aufruf in `ci.yml`
  für alle Ereignisse, Auto-Merge-Ereignis in `ci.yml`, `release` ohne `e2e`. Skripte:
  `gruen e2e` auf Frontend-Checks (von beiden Selbsttests getötet), Auswahl fragt immer Frontend,
  Push wie PR behandelt (erst nach einem zusätzlichen Fall „Push mit reinem Doku-Diff“ getötet).
  Stau-Wächter: Wartezeit umgedreht, Auto-Merge-Bedingung entfernt, Uhr ab Kopf entfernt,
  übersprungen zählt als gelaufen.
- **Folgeaufgabe Messung:** LLH-1695
  (https://zunder.rubeen.dev/#/aufgabe/l9tq50mmn1hmbha9u6o0fv9s), hängt an LLH-1662 und misst
  vorher und nachher mit `scripts/ci-messung.sh`.
