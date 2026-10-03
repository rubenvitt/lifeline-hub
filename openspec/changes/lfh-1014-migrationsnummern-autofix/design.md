# Design

## Context

- `scripts/check-migrationen.sh` (LFH-658) prüft einen Kopf gegen den Ziel-Branch und kann mit
  `--umnummerieren` die neuen Migrationen im Arbeitsbaum auf `max(Basis)+1, …` legen und alle
  Dateinamen-Verweise mitziehen. Bei einer verletzten Bestandsmigration endet es auch mit
  `--umnummerieren` auf Exit 1, ohne etwas anzufassen; liegt nichts an, auf Exit 0 mit
  „Nichts umzunummerieren“. Es committet nie.
- `.github/workflows/migrationen.yml` hat zwei Jobs: `pr` (Auslöser `pull_request`, prüft den
  Kopf gegen den Ziel-Branch, das Skript kommt vom Ziel-Branch) und `offene-prs` (Auslöser
  `push` auf `alpha`/`beta`/`main`, prüft jeden offenen PR). Beide setzen den Commit-Status
  `Migrationsnummern` mit dem `GITHUB_TOKEN`.
- **Gemessen am 03.10.:** Das Ruleset 17017911 führt elf Required Checks, `Migrationsnummern`
  nicht (`GET /repos/rubenvitt/lifeline-hub/rules/branches/alpha`). Aufgabe 5.3 aus LFH-658
  steht offen. #367 stand ab 07:10:40 UTC auf failure und wurde um 07:12:15 gemergt. Die
  Push-Läufe brauchen 10–15 Sekunden.
- Ein Push mit dem `GITHUB_TOKEN` löst keine Workflows aus. Die Release-App (`RELEASE_APP_ID`,
  `RELEASE_APP_PRIVATE_KEY`) hat Contents und Issues Read & Write und ist der einzige
  Bypass-Actor des Rulesets (Integration 1018751).
- Ein grüner Lauf auf `alpha` released und rollt aus (`ci.yml`, Job `release`). Eine dort
  eingespielte Migration darf nie umbenannt werden: sqlx fände unter der alten Version eine
  andere Prüfsumme und startete nicht.

## Goals / Non-Goals

**Goals:**
- Ein PR, der wegen eines reinen Nummernkonflikts rot wird, ist ohne Handgriff wieder
  mergebar, sobald seine CI auf dem Autofix-Commit grün ist.
- Ein roter Status `Migrationsnummern` blockiert den Merge, und sein Fehlen im Ruleset fällt auf.

**Non-Goals:**
- Kein Autofix auf `alpha`, `beta` oder `main`, auch nicht für eine Doppelung, die trotz
  Pflicht-Status im Rennfenster durchrutscht. Die bleibt ein Fix-PR wie #379.
- Keine fachliche Prüfung, ob die umnummerierte Migration hinter den neuen Vorgängern noch
  das Richtige tut. Das zeigen die Tests auf dem Autofix-Commit.
- Keine Umbenennung von Bezeichnern, die die alte Nummer tragen (`migration_0143_…`). Der
  Kommentar nennt sie, die CI fängt Bruch.
- Kein Opt-out-Label. Kommt Bedarf, ist es eine kleine Ergänzung.

## Decisions

### D1 — Reparieren auf dem PR-Branch, nicht vergeben beim Merge (revidiert D2 aus LFH-658)
LFH-658 D2 hat verworfen, die Nummer erst beim Merge zu vergeben, weil das einen Bot-Push auf
jeden PR mit Migration bedeutete, die volle CI neu auslöste und das Rennen nur verschob. Der
Autofix hier ist reaktiv: er läuft nur, wenn ein PR tatsächlich kollidiert. Dieser PR braucht
ohnehin einen neuen Commit und einen vollen CI-Lauf, nur bisher von Hand. Kollidiert er auf
dem Autofix-Commit erneut, weil inzwischen der nächste PR gemergt wurde, nummeriert der
nächste Push-Lauf wieder um. Das konvergiert mit jedem Merge.
Verworfen: **Autofix auf `alpha`** (Bestandsregel, ausgerollte Migrationen, Bypass-Rechte der
App) und **Fix-PR gegen `alpha` bei Doppelung** (braucht den vollen CI-Lauf, während alle PRs
rot sind; mit Pflicht-Status nur noch im Sekundenfenster nötig).

### D2 — Ein Skript trägt die Regel, der Workflow ruft es
`scripts/migrationen-autofix.sh <basis> <kopf-branch> <kopf-sha>` im Muster von
`check-migrationen.sh` (D4 aus LFH-658: das Skript ist die Wahrheit, die CI der Ort,
Selbsttest gegen echte Git-Repos). Ablauf:
1. Verweigern (Exit 3, „nicht anwendbar“), wenn `<kopf-branch>` `alpha`, `beta` oder `main`
   heißt oder die letzten drei Commits von `<kopf-sha>` Autofix-Commits sind (erkannt am
   Trailer `Migrationsnummern-Autofix: LFH-1014`).
2. `<kopf-sha>` als losgelösten Stand auschecken und `check-migrationen.sh --umnummerieren
   <basis>` laufen lassen. Die Fassung des Prüfskripts kommt vom Ziel-Branch, wie im PR-Job.
   Exit 1 (Bestandsverletzung) wird durchgereicht, „nichts umzunummerieren“ ist Exit 0 ohne
   Commit.
3. Bei Änderungen committen mit festem Betreff `fix(migrationen): Nummern über <basis> legen`,
   Liste alt → neu im Text, Trailer wie oben.
4. `git push origin HEAD:refs/heads/<kopf-branch>` ohne Force. Weil der Commit direkt auf
   `<kopf-sha>` sitzt, ist das nur ein Fast-Forward, wenn der Branch noch auf `<kopf-sha>`
   steht. Ein abgewiesener Push ist Exit 4, der Branch bleibt, wie er ist.
5. Die Umbenennungen und die Hinweise auf Restfundstellen landen in einer Datei, die der
   Workflow als Kommentar postet.
Wie beim Prüfskript kommt die Fassung vom Ziel-Branch; trägt der sie noch nicht, gilt die
des PRs. Push-Ziel und Remote kommen als Umgebung (`AUTOFIX_REMOTE`), damit der Selbsttest gegen ein
lokales Bare-Repo pushen kann.

### D3 — Beide Jobs reparieren, mit eingeengtem App-Token
`pr` und `offene-prs` rufen das Skript nach einem Exit 1 der Prüfung auf, `pr` nur, wenn
`head.repo.full_name == github.repository`; `offene-prs` liest dafür `headRepository`,
`headRepositoryOwner` und `headRefName` aus `gh pr list`. Der Token kommt aus
`actions/create-github-app-token` mit `permission-contents: write` und
`permission-issues: write`, nur für dieses Repository, und wird erst im Reparaturschritt
erzeugt. `actions/checkout` läuft mit `persist-credentials: false`; der Token geht nur in die
Push-URL und in `gh`. PR-Code wird nie ausgeführt: das Skript benennt um und ersetzt Text.
Fehlt `RELEASE_APP_ID`, wird die Reparatur mit `::notice::` übersprungen, die Prüfung bleibt.
Den alten Kopf-Commit lässt der Workflow auf failure, mit der Beschreibung „umnummeriert, neuer
Commit folgt“; der neue Kopf bekommt seinen Status aus dem eigenen `pull_request`-Lauf.

### D4 — Kommentar statt stiller Commit
Lokale und Cloud-Sitzungen auf dem Branch würden beim nächsten Push abgewiesen und wüssten
nicht warum. Der Kommentar (über die Issues-API mit dem App-Token) nennt die Umbenennungen und
den nötigen `git pull`. Er weckt außerdem Sitzungen, die den PR beobachten.

### D5 — Pflicht-Status überwachen statt erzwingen
`offene-prs` fragt `GET /repos/{repo}/rules/branches/{basis}` ab. Fehlt `Migrationsnummern`
unter `required_status_checks`, schreibt der Lauf `::warning::` und eine Zeile in die
Zusammenfassung, bleibt aber grün. Ein roter Push-Lauf auf `alpha` hätte keine Wirkung auf
den Merge und wäre ein rot geborenes Gate. Den Eintrag selbst setzt Ruben (Aufgabe 5.3 aus
LFH-658), weil die Session keine Rechte am Ruleset hat.

## Risks / Trade-offs

- [Rennen im Sekundenfenster bleibt] → Zwischen einem Merge und dem Ende des Push-Laufs
  (10–15 s) ist der zweite PR noch grün. Rutscht er durch, ist `alpha` rot wie heute; der
  Autofix greift dort bewusst nicht (Non-Goal).
- [Lokaler Stand veraltet] → Wer weiterarbeitet, wird beim Push abgewiesen. Der Kommentar
  sagt es; ein Merge des Remote-Stands genügt, die Umbenennung kollidiert textuell nicht.
- [App mit Bypass auf `alpha`] → Das Skript verweigert Ziel-Branch-Namen, pusht nur
  Fast-Forward ohne Force, und der Push geht immer an `refs/heads/<kopf-branch>` aus dem
  PR-Objekt. Ein Fehler würde an der Fast-Forward-Regel scheitern, weil der Commit auf dem
  PR-Kopf sitzt und nicht auf `alpha`.
- [Ersetzung trifft Workflow-Dateien] → Nennt eine Datei unter `.github/workflows/` den
  Dateinamen der Migration, lehnt GitHub den Push ohne `workflows`-Recht ab. Exit 4, der
  Status bleibt rot, Handarbeit wie heute.
- [Autofix-Schleife] → Begrenzt auf drei aufeinanderfolgende Autofix-Commits.
- [Freigaben gehen verloren] → Das Ruleset verlangt keine Reviews; Claude Approvals bewertet
  den neuen Kopf neu.
- [Zweiter Lauf gleichzeitig] → `pr` und `offene-prs` können denselben PR gleichzeitig
  reparieren wollen. Der zweite Push ist kein Fast-Forward mehr und wird abgewiesen.

## Migration Plan

1. Plan, Umsetzung und Archiv in einem PR gegen `alpha` (Merge-Commit).
2. Ruben trägt `Migrationsnummern` ohne `integration_id` ins Ruleset 17017911 ein, sobald es
   ihm passt; unabhängig vom Merge, der Status existiert schon auf allen offenen PRs.
3. Nach dem Merge zeigt der erste Push-Lauf, ob die Ruleset-Warnung verschwunden ist.
4. Rückweg: die Reparaturschritte im Workflow entfernen; die Prüfung bleibt.
