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

Der Check `Baut mit Ziel-Branch` entsteht nicht als Job-Name, sondern wird von einem Melde-Job per
Checks-API auf den Kopf-Commit des PRs geschrieben. Das hat zwei Gründe. Ein Push auf `alpha` muss
den Check an vielen PR-Köpfen neu setzen, und das geht nur über die API. Und ein übersprungener Job
meldete seinen Check grün; den Fehler hat `e2e.yml` schon einmal mit der Matrix-Krücke umgangen.
Über die API entsteht der Check nur, wenn wirklich gerechnet wurde oder bewusst „wartet“ gemeldet
wird. Sonst fehlt er.

Auslöser:

- `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`, `auto_merge_enabled`,
  `labeled`): rechnet nur, wenn der PR fertig ist (gleiche Definition wie `pr-pruefstufen`), kein
  Entwurf und kein Fork. Eine Nebenläufigkeitsgruppe je PR bricht einen älteren Lauf ab.
- `push` auf `alpha`, `beta`, `main`: Ein Auswahl-Job listet die offenen PRs gegen den Branch. Für
  fertige PRs rechnet je PR ein Matrix-Job (begrenzte Parallelität). PRs, die nicht fertig sind und
  den Check schon tragen, bekommen ihn als `queued` mit dem Text „wartet, bis der PR fertig ist“.
  Eine Gruppe je Ziel-Branch bricht einen älteren Push-Lauf ab.

Verworfen:

- **Ruleset „Require branches to be up to date“:** Jeder Merge macht alle anderen PRs veraltet und
  zwingt sie durch die ganze CI (15 bis 80 Minuten). Bei vielen parallelen Sitzungen ein Dauerstau.
- **Job in `e2e.yml`:** deckt nur PR-Ereignisse ab, nicht die Bewegung des Ziel-Branches, und ändert
  die festgeschriebene Form der zweiten Stufe.
- **Der Wächter mergt `alpha` in jeden fertigen PR:** löst je Merge auf `alpha` die volle CI samt
  e2e für jeden fertigen PR aus, über eine Stunde Runner-Zeit je PR.

### D2 Kompilieren und Melden sind getrennte Jobs

Der Kompilier-Job führt PR-Code aus (Build-Skripte, Makros). Er läuft mit `permissions: contents:
read`, ohne Secrets und ohne gespeicherte Zugangsdaten (das Token bekommt nur der Fetch des
PR-Kopfes als Umgebung seines Schritts), und er speichert keinen Cache: `rust-cache` mit
`save-if: false`, nur `actions/cache/restore`, mise ohne Cache. Ein Push-Lauf speichert in den
Bereich des Kanal-Branches, und ein vergifteter Cache landete sonst im Release-Build. Er liest den
Cache der Rust-Suite. Sein Ergebnis (grün, rot, Konflikt, veraltet und die Ausgabe) geht als
Artefakt an den Melde-Job (`checks: write`), der keinen PR-Code ausführt und den Check schreibt.

Bevor der Melde-Job ein Ergebnis schreibt, prüft er, ob Kopf-Commit des PRs und Ziel-Branch noch auf
dem gerechneten Stand stehen. Wenn nicht, schreibt er nichts; der Lauf zum neueren Stand schreibt
selbst. So bleibt nie ein Ergebnis gegen einen alten Stand als jüngstes stehen.

Verworfen: ein Job mit Schreibrechten, der selbst kompiliert. Am PR-Ereignis wäre das wegen des
eingeschränkten Tokens noch harmlos, beim Push auf `alpha` liefe PR-Code aber mit dem Token des
Kanal-Branches.

### D3 Der Umfang steht in `check-all.sh`, Bündel `baut`

Wie jeder CI-Job ruft der Kompilier-Job `scripts/check-all.sh` auf, mit dem neuen Bündel
`--nur baut`: `cargo check` für den Workspace mit allen Zielen (auch Tests und die Hülle), dasselbe
mit dem Feature `dev-seeds`, und die Typprüfung des Frontends (`pnpm typecheck`). Kein `cargo
test`, kein Lint. Die nativen Systempakete kommen wie in der Rust-Suite. Erwartet: wenige Minuten
mit warmem Cache.

### D4 „alpha rot“ liest den Zustand aus den CI-Läufen auf `alpha`

`stau-waechter.yml` bekommt den Auslöser `workflow_run` (Workflow `CI`, `completed`, Branch `alpha`)
und das Recht `actions: read`. Der Wächter liest die abgeschlossenen Push-Läufe von `ci.yml` auf
`alpha`. Rot ist `alpha`, wenn im jüngsten ein Job außer `Release` fehlschlägt. Erster roter Lauf
und letzter grüner Lauf davor ergeben die Spanne; die PRs dazu liefert
`commits/<sha>/pulls` für jeden First-Parent-Commit der Spanne. `rot_seit` ist das Ende des ersten
roten Laufs.

### D5 Zuständigkeit ohne gespeicherten Zustand

Kandidaten sind die offenen PRs gegen `alpha`: kein Entwurf, kein Fork, nicht Dependabot und ohne
Label `alpha-rot`. Sortiert nach Nummer. Trägt ein PR das Label, ist er zuständig, bei mehreren der
mit der kleinsten Nummer. Sonst ist der Kandidat an Stelle `floor((jetzt − rot_seit) / 3600) mod n`
zuständig. Das ergibt die stündliche Rotation ohne Zustand: Jeder Lauf rechnet dasselbe Ergebnis,
und ein Wechsel ergibt einen neuen Befund und damit einen neuen Kommentar.

Verworfen: die Zuständigkeit in den Kommentaren mitführen und nach einer Stunde weiterreichen. Das
braucht Lesen, Parsen und Schreiben über mehrere Läufe und bricht bei jedem Aussetzer der API.

### D6 Eigene Marke für den Hinweis

Die Hinweise zu „alpha rot“ tragen die Marke `<!-- stau-waechter-alpha:<art>:<kennung> -->`, die
Arten `fix`, `zustaendig`, `wartet`, `doppelt`, `behoben` und `angestossen`. `hinweis_lesen` und
`hinweis_setzen` lesen die Marke aus einer lokal gesetzten Variablen; die Regeln (ein Hinweis je
Marke, gleicher Befund schreibt nichts, neuer löscht und legt neu an, behobener wird geändert, nur
eigene Kommentare) bleiben dieselben. Die Kennung hasht Art, ersten roten Lauf, Ursache und
fehlgeschlagene Jobs, bei `wartet` den Fix-PR, aber **nicht** den rotierenden Zuständigen: sonst
weckte jede Stunde jede wartende Sitzung (beim Bau bemerkt, Spec entsprechend gefasst). Der Fix-PR
bekommt eine kurze Bestätigung (`fix`), damit seine Sitzung weiß, dass die übrigen warten.

### D7 Nach dem Fix: hineinmergen wie bei „ohne CI“

Ist `alpha` grün und trägt ein PR einen offenen Hinweis dieser Marke, ist der Befund behoben. Ist
der jüngste Lauf eines Checks auf dem Kopf-Commit rot, der PR konfliktfrei und der grüne Stand von
`alpha` noch nicht im Branch, mergt der Wächter `alpha` mit `basis_hineinmergen` (gleicher Trailer,
eigener Text) und setzt den Hinweis auf `angestossen`. Sonst setzt er ihn auf `behoben`. Die
Schleifenbremse ergibt sich daraus, dass der Branch danach den grünen Stand enthält.

### D8 Sitzungsverhalten steht in `dev-zunder-ausfuehren`

Ein neuer Abschnitt sagt, was eine Sitzung tut, die der Hinweis weckt. Ist sie zuständig, baut sie
den Fix in einem eigenen Branch von `alpha` und öffnet den PR mit Label `alpha-rot`, sonst ändert
sie nichts an `alpha`-Brüchen in ihrem PR und wartet auf den Merge des Wächters.
`scripts/AGENTS.md` beschreibt die Mechanik bei Stau-Wächter und PR-Prüfstufen.

## Risks / Trade-offs

- [Ein Flake auf `alpha` ruft einen Zuständigen auf den Plan] → Der Auftrag sagt, zuerst den
  fehlgeschlagenen Job neu zu starten, wenn der Fehler nicht im Code liegt. Ein grüner Neulauf
  beendet den Befund.
- [Zusätzliche Runner-Zeit: je Merge auf `alpha` ein Kompilierlauf je fertigem PR] → Nur fertige
  PRs, Abbruch älterer Läufe, begrenzte Parallelität. Meist sind es null bis drei PRs.
- [Der Check fängt nur, was beim Kompilieren bricht] → Für den Rest gibt es „alpha rot“. Beides
  zusammen ist das Ziel, keines allein.
- [Der älteste PR ist verwaist] → Die Rotation reicht nach einer Stunde weiter.
- [Ein Required Check, der noch nie lief, sperrt jeden PR] → Er wird erst eingetragen, wenn er an
  einem PR grün gelaufen ist (Migration Plan).

## Migration Plan

1. Merge dieses PRs. Ab dann rechnet `Baut mit Ziel-Branch` an fertigen PRs, ist aber noch nicht
   Pflicht. „alpha rot“ ist sofort aktiv.
2. Läuft der Check an einem PR grün, trägt Ruben `Baut mit Ziel-Branch` im Ruleset 17017911 als
   Required Check ein (ohne `integration_id`).
3. Rückweg: den Required Check austragen; der Workflow und der Befund lassen sich einzeln
   zurücknehmen, ohne den übrigen Wächter zu berühren.
