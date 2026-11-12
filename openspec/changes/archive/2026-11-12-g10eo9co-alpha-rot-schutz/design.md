# Design

## Context

Motivation: proposal.md, „Why“. Was heute schon da ist:

- `ci.yml` prüft einen PR auf `refs/pull/<n>/merge`, also gegen den Stand des Ziel-Branches beim
  Ereignis. Bewegt sich der Ziel-Branch danach, bleibt das Grün stehen, und nichts rechnet neu.
- `e2e.yml` ist die zweite Stufe: Sie läuft erst, wenn der PR fertig ist (Auto-Merge an oder Label
  `e2e`). Vorher fehlen ihre Pflicht-Checks, weil ein übersprungener Job ohne Matrix seinen Check
  grün erfüllte. Die Form beider Workflows hält `scripts/ci-stufen.test.sh` im Wortlaut fest.
- Der Stau-Wächter (`scripts/stau-waechter.sh`) bewertet offene PRs bei jedem Push auf einen
  Kanal-Branch, stündlich und von Hand. Er führt keinen PR-Code aus, schreibt höchstens einen
  Hinweis je PR (Marke `<!-- stau-waechter:<art>:<kennung> -->`) und mergt beim Befund „ohne CI“
  den Ziel-Branch per Fast-Forward mit Lease in den PR-Branch (Release-App, Schleifenbremse über
  den Trailer `Stau-Waechter`).
- Eine Merge Queue gibt es für Repositories eines Benutzerkontos nicht.

## Goals / Non-Goals

**Goals:**

- Ein Bruch, der nur in der Kombination zweier PRs entsteht und sich beim Kompilieren zeigt, kommt
  nicht mehr auf `alpha`.
- Bricht `alpha` trotzdem, etwa in einem Test, der kompiliert, aber fehlschlägt, baut genau eine
  Sitzung den Fix, und die übrigen PRs werden danach ohne Zutun wieder grün.

**Non-Goals:**

- Die volle Testsuite gegen jeden neuen Stand von `alpha` fahren (siehe D1, verworfene Wege).
- „alpha rot“ für `beta` und `main`: Dort landen nur Freigaben aus `alpha`.
- Die Ursache selbst reparieren: Der Wächter nennt sie und bestimmt den Zuständigen, den Fix baut
  eine Sitzung.

## Decisions

### D1 Eigener Workflow `ziel-branch-build.yml` mit Check über die Checks-API

Der Check `Baut mit Ziel-Branch` entsteht nicht als Job-Name, sondern per Checks-API am Kopf-Commit
des PRs. Ein Push auf `alpha` muss ihn an vielen PR-Köpfen neu setzen, das geht nur über die API;
und ein übersprungener Job meldete seinen Check grün (den Fehler umgeht `e2e.yml` mit der
Matrix-Krücke). Über die API entsteht der Check nur, wenn gerechnet oder bewusst „wartet“ gemeldet
wird. Sonst fehlt er.

Auslöser und Jobs:

- `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`, `auto_merge_enabled`,
  `labeled`): `vorbereiten` setzt den Check eines fertigen PRs (gleiche Definition wie
  `pr-pruefstufen`, kein Entwurf, kein Fork) auf „läuft“, an einem nicht fertigen, der ihn trägt,
  auf „wartet“. Dann `kompilieren` und `melden`.
- `push` auf `alpha`, `beta`, `main`: Nur `verteilen` läuft. Es setzt den Check jedes fertigen PRs
  auf „läuft“ und startet für ihn einen **eigenen Lauf** dieses Workflows per `workflow_dispatch`
  auf seinem Branch; jeder übrige mit Check (auch ein Entwurf) bekommt „wartet“. Kennt ein Branch
  den Workflow noch nicht (HTTP 422/404), wird der Check rot mit dem Hinweis, den Ziel-Branch
  hineinzumergen; scheitert der Start sonst (5xx, Drosselung), wird er abgebrochen und der Lauf
  rot, ohne falschen Rat.
- `workflow_dispatch` (der eigene Lauf): `vorbereiten` prüft, dass der Lauf auf dem Kopf-Branch
  des PRs läuft, der PR in diesem Repository liegt und der Ref kein Kanal-Branch ist (ein von
  Hand ohne `--ref` gestarteter Lauf liefe sonst auf `alpha`); `kompilieren` sperrt Kanal-Refs
  ein zweites Mal. Dann schließt es den Check von `verteilen` als übernommen und legt einen
  frischen an: sonst bliebe der Check eines PR-Laufs, den der Einzellauf abgebrochen hat, als
  jüngster auf „läuft“. Gerechnet wird gegen die aktuelle Spitze des Ziel-Branches.

Eine Nebenläufigkeitsgruppe je PR (Ereignis und Einzellauf teilen sie) bzw. je Kanal-Branch bricht
einen älteren Lauf ab. Ein Fehler an einem PR hält `verteilen` nicht auf; der Lauf endet dann rot.

Verworfen:

- **Ruleset „Require branches to be up to date“:** Jeder Merge macht alle anderen PRs veraltet und
  zwingt sie durch die ganze CI (15 bis 80 Minuten). Bei vielen parallelen Sitzungen ein Dauerstau.
- **Job in `e2e.yml`:** deckt nur PR-Ereignisse ab, nicht die Bewegung des Ziel-Branches, und ändert
  die festgeschriebene Form der zweiten Stufe.
- **Der Wächter mergt `alpha` in jeden fertigen PR:** löst je Merge auf `alpha` die volle CI samt
  e2e für jeden fertigen PR aus, über eine Stunde Runner-Zeit je PR.
- **Im Push-Lauf selbst kompilieren (erster Entwurf, im Review verworfen):** Der Push-Lauf hat den
  Cache-Bereich von `alpha`. Code aus dem PR (etwa ein `build.rs` einer Abhängigkeit in einem
  Dependabot-PR) kann über das Runtime-Token des Runners Cache-Einträge anlegen, auch wenn keine
  Action speichert, etwa durch Überschreiben einer später laufenden Action. `release.yml` führt
  einen Binär-Cache mit dem Secret der Release-App aus. Entscheidung Ruben, 12.11.2026.
- **Push-Lauf setzt nur „wartet“:** nach jedem Merge hinge jeder fertige PR, bis ihn jemand
  anstößt.

### D2 Kompilieren und Melden sind getrennte Jobs, PR-Code nur im Bereich des PRs

PR-Code läuft nur in `kompilieren` und nie in einem Lauf auf einem Kanal-Branch (D1). Auch dort mit
`permissions: contents: read`, ohne Secrets und ohne gespeicherte Zugangsdaten (das Token bekommt
nur der Fetch des PR-Kopfes als Umgebung seines Schritts), und ohne gespeicherten Cache:
`rust-cache` mit `save-if: false`, nur `actions/cache/restore`, mise ohne Cache. Er liest den Cache
der Rust-Suite. Sein Ergebnis (grün, rot, Konflikt, veraltet und die Ausgabe) geht als Artefakt an
`melden` (`checks: write`), das es nur als Text liest.

In einem Lauf eines PRs (Ereignis oder Einzellauf) stammen Workflow und Skripte aus dem PR selbst,
wie bei `ci.yml`. Ein PR bestimmt dort seine eigenen Checks; das ist keine neue Grenze und kein
Ziel dieser Trennung. Die Trennung schützt den Bereich der Kanal-Branches.

Bevor `melden` ein Ergebnis schreibt, prüft es, ob Kopf-Commit des PRs und Ziel-Branch noch auf dem
gerechneten Stand stehen. Wenn nicht, schließt es den Check als „überholt“ (abgebrochen), denn den
neuen Stand rechnet dessen eigener Lauf. Ausnahme: Ist der Ziel-Branch nur um Release-Commits
weiter, gilt das Ergebnis. Die tragen `[skip ci]` und starten keinen Push-Lauf, sonst hinge der PR
bis zum nächsten Merge.

### D3 Der Umfang steht in `check-all.sh`, Bündel `baut`

Wie jeder CI-Job ruft der Kompilier-Job `scripts/check-all.sh` auf, mit dem neuen Bündel
`--nur baut`: `cargo check` für den Workspace mit allen Zielen (auch Tests und die Hülle), dasselbe
mit dem Feature `dev-seeds`, und die Typprüfung des Frontends (`pnpm typecheck`). Kein `cargo
test`, kein Lint. Die nativen Systempakete kommen wie in der Rust-Suite. Erwartet: wenige Minuten
mit warmem Cache.

### D4 „alpha rot“ liest den Zustand aus den CI-Läufen auf `alpha`

`stau-waechter.yml` bekommt den Auslöser `workflow_run` (Workflow `CI`, `completed`, Branch `alpha`)
und das Recht `actions: read`. Der Wächter liest die Push-Läufe von `ci.yml` auf `alpha`. Rot ist
`alpha`, wenn im jüngsten abgeschlossenen ein Job außer dem Release (`Release / …`) fehlschlägt.
Erster roter und letzter grüner Lauf davor ergeben die Spanne; die PRs dazu stehen in den
Betreffen der First-Parent-Commits der Spanne (`Merge pull request #N …`, bei Squash `(#N)`), per
`git log`, ohne weiteren API-Aufruf. Die ID des ersten roten Laufs ist die Kennung des Befunds.

### D5 Zuständigkeit: der Auftrag haftet eine Stunde

Kandidaten sind die offenen PRs gegen `alpha`: kein Entwurf, kein Fork, nicht Dependabot und ohne
Label `alpha-rot`, sortiert nach Nummer. Trägt ein PR das Label, ist er zuständig, bei mehreren der
mit der kleinsten Nummer, die übrigen sind `doppelt`; ein Entwurf mit Label zählt in beiden
Rollen, damit der Zuständige den Fix sofort belegen kann. Sonst liest der Wächter, welcher PR den
Hinweis `zustaendig` trägt und wann er angelegt wurde; ist ein PR dabei nicht lesbar, schreibt die
Runde nichts (ein unbekannter Halter ist nicht „keiner“). Die Kennung des Auftrags hängt nur am
ersten roten Lauf, nicht an Ursache oder roten Jobs: sonst erneuerte jeder weitere rote Lauf den
Hinweis und damit die Stunde. Ist das weniger als eine Stunde her und der PR noch Kandidat, bleibt er zuständig. Sonst
geht der Auftrag an den nächsten Kandidaten mit größerer Nummer, nach dem letzten an den ersten.
Ohne Halter bekommt ihn der älteste.

Verworfen, im Review: die Stelle `floor((jetzt − rot_seit) / 3600) mod n` über die aktuelle Liste.
Sie braucht keinen Zustand, verschiebt den Auftrag aber mitten in der Stunde, sobald ein PR gemergt,
geöffnet oder zum Entwurf wird; die erste Sitzung baut dann vielleicht schon. Der Hinweis selbst ist
der Zustand, der Wächter liest ihn ohnehin. Entscheidung Ruben, 12.11.2026.

### D6 Eigene Marke für den Hinweis

Die Hinweise zu „alpha rot“ tragen die Marke `<!-- stau-waechter-alpha:<art>:<kennung> -->`, die
Arten `fix`, `zustaendig`, `wartet`, `doppelt`, `behoben` und `angestossen`. `hinweis_lesen` und
`hinweis_setzen` lesen die Marke aus einer lokal gesetzten Variablen; die Regeln (ein Hinweis je
Marke, gleicher Befund schreibt nichts, neuer löscht und legt neu an, behobener wird geändert, nur
eigene Kommentare) bleiben dieselben. Die Kennung hasht Art, ersten roten Lauf, Ursache und
fehlgeschlagene Jobs, bei `wartet` den Fix-PR, aber **nicht** den wechselnden Zuständigen: sonst
weckte jeder Wechsel jede wartende Sitzung (beim Bau bemerkt, Spec entsprechend gefasst). Der Fix-PR
bekommt eine kurze Bestätigung (`fix`), damit seine Sitzung weiß, dass die übrigen warten. Ein
Entwurf bekommt keinen neuen Hinweis; trägt er noch den Auftrag, wird der zu `wartet`. Kann kein PR
den Auftrag übernehmen (nur Entwürfe, Forks, Dependabot), sagt der Hinweis das. Fehlt das Label im
Repository, legt der Wächter es an (`issues: write`).

### D7 Nach dem Fix: hineinmergen wie bei „ohne CI“

Ist `alpha` grün und trägt ein PR einen offenen Hinweis dieser Marke, sieht der Wächter die Checks
seines Kopfes an. Sind sie nicht lesbar oder läuft noch ein Check (abgebrochene laufen nicht),
bleibt der Hinweis offen: ein
„behoben“ wäre endgültig, der nächste Lauf sähe den PR nicht mehr an. Ist der jüngste Lauf eines
Checks rot, der PR kein Entwurf, konfliktfrei und ohne den grünen Stand von `alpha`, mergt der
Wächter `alpha` mit `basis_hineinmergen` (gleicher Trailer, eigener Text) und setzt den Hinweis auf
`angestossen`; scheitert der Push, bleibt er offen. Sonst setzt er ihn auf `behoben`. Die
Schleifenbremse ist, dass der Branch danach den grünen Stand enthält (nicht der Trailer wie bei
`ohne-ci`).

Den Zustand liest der Wächter ohne Filter auf abgeschlossene Läufe: Ein neu gestarteter roter Lauf
(Versuch > 1), der noch läuft, macht den Zustand unbestimmt, ebenso ein fehlgeschlagener Lauf mit
nicht lesbaren Jobs. Sonst gälte währenddessen das ältere Grün, und der Wächter mergte das noch
rote `alpha` in die PRs.

### D8 Sitzungsverhalten steht in `dev-zunder-ausfuehren`

Ein neuer Abschnitt sagt, was eine Sitzung tut, die der Hinweis weckt. Ist sie zuständig, öffnet
sie **sofort** einen PR von `alpha` mit Label `alpha-rot`, als Entwurf genügt, und belegt damit den
Fix; erst dann baut sie ihn und stimmt Ursache und Fix mit dem Menschen ab. Ohne diesen Beleg
wanderte der Auftrag nach einer Stunde weiter, während die erste Sitzung noch auf die Antwort
wartet, und zwei Sitzungen bauten denselben Fix (Review, Entscheidung Ruben 12.11.2026). Sonst
ändert sie nichts an `alpha`-Brüchen in ihrem PR und wartet auf den Merge des Wächters.
`scripts/AGENTS.md` beschreibt die Mechanik bei Stau-Wächter und PR-Prüfstufen.

## Risks / Trade-offs

- [Ein Flake auf `alpha` ruft einen Zuständigen auf den Plan] → Der Auftrag sagt, zuerst den
  fehlgeschlagenen Job neu zu starten, wenn der Fehler nicht im Code liegt. Während des Neustarts
  ist der Zustand unbestimmt, ein grüner Neulauf beendet den Befund.
- [Zusätzliche Runner-Zeit: je Merge auf `alpha` ein Kompilierlauf je fertigem PR] → Nur fertige
  PRs, Abbruch älterer Läufe je PR. Meist sind es null bis drei PRs.
- [Der Check fängt nur, was beim Kompilieren bricht] → Für den Rest gibt es „alpha rot“. Beides
  zusammen ist das Ziel, keines allein.
- [Restfenster: zwischen dem Push auf `alpha` und dem „läuft“ von `verteilen` steht an einem
  fertigen PR noch das alte Grün; mergt GitHub ihn genau dann, landet der Bruch doch] → Ohne Merge
  Queue oder „up to date“ nicht schließbar (D1). `verteilen` ist schlank und setzt den Check als
  Erstes; was durchrutscht, fängt „alpha rot“ auf.
- [Ein PR-Branch ohne den neuen Workflow kann keinen eigenen Lauf starten] → Der Check wird rot und
  sagt, `alpha` hineinzumergen; einmalig nach der Einführung.
- [Der älteste PR ist verwaist] → Nach einer Stunde geht der Auftrag weiter.
- [Ein Required Check, der noch nie lief, sperrt jeden PR] → Er wird erst eingetragen, wenn er an
  einem PR grün gelaufen ist (Migration Plan).

## Migration Plan

1. Merge dieses PRs. Ab dann rechnet `Baut mit Ziel-Branch` an fertigen PRs, ist aber noch nicht
   Pflicht. „alpha rot“ ist sofort aktiv; das Label `alpha-rot` legt der Wächter beim ersten Rot an.
   Offene PR-Branches ohne den neuen Workflow bekommen nach dem nächsten Merge auf `alpha` einen
   roten Check mit dem Hinweis, `alpha` hineinzumergen.
2. Läuft der Check an einem PR grün, trägt Ruben `Baut mit Ziel-Branch` im Ruleset 17017911 als
   Required Check ein (ohne `integration_id`).
3. Rückweg: den Required Check austragen; der Workflow und der Befund lassen sich einzeln
   zurücknehmen, ohne den übrigen Wächter zu berühren.
