# Design

## Context

Motivation: proposal.md, „Why“. Was die Lösung formt:

- **Keine Merge Queue, kein „up to date“-Zwang.** Ein PR wird gegen den Ziel-Branch zum Zeitpunkt
  seines CI-Laufs geprüft; nach einem fremden Merge läuft nichts neu. Nur der Status
  `Migrationsnummern` wird bei jedem Push auf den Ziel-Branch für alle offenen PRs neu gesetzt
  (`.github/workflows/migrationen.yml`, Job `offene-prs`). Dieses Muster wird hier wiederverwendet.
- **Die Pflicht-Checks hängen am Kopf-Commit.** Ein neuer Commit, auch eine reine Umbenennung,
  braucht alle Required Checks neu. Der Job `aenderungen` in `ci.yml` entscheidet über
  `scripts/bereiche.sh`, welche schweren Suiten laufen; eine nicht gebrauchte läuft leer und
  meldet grün.
- **Die Release-App darf auf PR-Branches pushen** und tut es schon
  (`scripts/migrationen-autofix.sh`); ein Push mit `GITHUB_TOKEN` startete keine CI.
- **Sitzungen wachen bei PR-Kommentaren auf.** Die Claude-Sitzung, die einen PR geöffnet hat,
  bekommt neue und geänderte Kommentare als Ereignis, auch von Bots (am 12.11.2026 an den
  Cloudflare-Kommentaren beobachtet). Ob ein Kommentar mit `GITHUB_TOKEN` genauso ankommt, ist
  nicht gemessen (Aufgabe 2.6).
- **Die Website listet die ADRs schon aus den Dateien** (`website/src/pages/architektur/index.astro`,
  Abschnitt „Entscheidungen“). Die Tabelle 9.1 ist eine zweite, handgepflegte Kopie.
- `scripts/check-architektur.sh` meldet eine doppelte ADR-`id` bereits, aber erst auf dem
  zusammengeführten Stand.

## Goals / Non-Goals

**Goals:**

- Ein liegengebliebener PR ist innerhalb einer Stunde am PR selbst als solcher zu erkennen.
- Was ohne Urteil geht (CI anstoßen, Umnummerierung billig machen), geschieht ohne Menschen.
- Keine neue Konfliktstelle und kein neuer Weg, auf dem `alpha` rot wird.

**Non-Goals:**

- Konflikte automatisch lösen. Das bleibt bei der Sitzung des PRs oder beim Menschen.
- Mehr e2e-Anteile, kürzere Suiten.
- Eine geplante Claude-Aufgabe als Rückfall (Entscheidung Ruben 12.11.2026: erst messen, ob der
  Kommentar reicht).
- Semantische Konflikte nach fremden Merges erkennen (bleibt beim Push-Lauf auf `alpha`).

## Decisions

### D1 Der Wächter ist ein Skript mit Selbsttest, der Workflow nur die Hülle

`scripts/stau-waechter.sh` trägt Befund und Entscheidung, `scripts/stau-waechter.test.sh` prüft
sie an Wegwerf-Repositories (Muster `migrationen-autofix.test.sh`). GitHub-Zugriffe laufen über
eine einzige Funktion, die der Selbsttest durch eine Attrappe ersetzt (Umgebungsvariable wie
`AUTOFIX_PRUEFER`). `.github/workflows/stau-waechter.yml` ruft nur das Skript.

- Auslöser: `push` auf `alpha`, `beta`, `main`; `schedule` stündlich (krumme Minute);
  `workflow_dispatch`. Ein Lauf zur Zeit (`concurrency`, kein Abbruch).
- Der Konflikt wird lokal bestimmt: `git merge-tree --write-tree --name-only <basis> <kopf>`.
  GitHubs `mergeable` wird asynchron berechnet und ist direkt nach einem Push oft `UNKNOWN`.
- PR-Code wird nie ausgeführt; das Skript kommt vom Standard-Branch.

Alternative „im Job `offene-prs` von `migrationen.yml` mitlaufen“: verworfen, der Job hat einen
anderen Auslöser-Satz (kein Zeitplan) und andere Rechte; zwei Aufgaben in einem Job machten
beide schwerer zu lesen.

### D2 Ein Hinweis je PR, neu geschrieben nur bei neuem Befund

Der Kommentar trägt eine unsichtbare Marke (`<!-- stau-waechter -->`) und eine Kennung des
Befunds (Art, Kopf-Commit, Dateiliste). Gleiche Kennung: nichts tun. Neue Kennung mit Befund:
alten Kommentar löschen, neuen anlegen (ein neuer Kommentar benachrichtigt, ein geänderter
nicht). Kein Befund mehr: den bestehenden Kommentar auf „behoben“ ändern. Der Text nennt die
Dateien und den Handgriff: Ziel-Branch in den PR-Branch mergen, kein Rebase.

Alternative „Label statt Kommentar“: verworfen, ein Label weckt keine Sitzung und nennt keine
Dateien.

### D3 PR ohne CI-Lauf: der Ziel-Branch wird hineingemergt

„Ohne CI-Lauf“ heißt: Kopf-Commit älter als 20 Minuten und kein Check-Run `Schnellprüfungen`
auf ihm, gleich in welchem Zustand. Dann mergt der Wächter den Ziel-Branch in einem losgelösten
Arbeitsbaum und pusht mit dem Token der Release-App. Grenzen wie beim Autofix: nur PRs aus
diesem Repository, nie ein Ziel-Branch, nur Fast-Forward auf den bewerteten Kopf. Der
Merge-Commit trägt den Trailer `Stau-Waechter: LLH-1660`; sitzt der schon an der Spitze, pusht
der Wächter nicht erneut, sondern kommentiert (Schleifenbremse). Ist nichts zu mergen, kommentiert
er ebenfalls.

Warum ein Merge und kein leerer Commit: ein leerer Commit verändert nichts außer der Historie;
der Merge bringt den PR zugleich auf den Stand, gegen den er ohnehin geprüft werden soll.
Die Ursache an #1282 ist nicht ermittelt; der Wächter behandelt das Symptom.

### D4 Reine Umnummerierung übernimmt die schweren Suiten vom letzten grünen Commit

`scripts/nur-umnummeriert.sh <kopf>` geht vom Kopf-Commit des PRs rückwärts, solange jeder Commit
(a) den Trailer `Migrationsnummern-Autofix` trägt, (b) genau einen Elternteil hat und (c) sein
Diff nur aus unveränderten Umbenennungen (`R100`) von `migrations/*` nach `migrations/*` besteht.
Es gibt den ersten Commit aus, der das nicht mehr erfüllt (höchstens fünf Schritte), oder nichts,
wenn schon der Kopf es nicht erfüllt. Der Job `aenderungen` fragt für diesen Commit die
Check-Runs ab: sind `Rust-Suite`, `Frontend-Suite 1/4` bis `4/4` und `e2e 1/4` bis `4/4` alle
`success` oder `skipped`, setzt er `rust`, `frontend` und `e2e` auf `false`. In jedem anderen
Fall, auch bei einem Fehler der Abfrage, gilt `bereiche.sh` wie bisher (im Zweifel wird geprüft).

- Entschieden wird am Inhalt des Commits, nicht am Autor: wer den Trailer fälscht, kann nur eine
  inhaltsgleiche Umbenennung durchbringen, und eine umbenannte Bestandsmigration macht
  `Migrationsnummern` rot.
- Mitgezogene Verweise: Der Autofix schreibt jeden Verweis auf den alten Dateinamen um, auch in
  der Doku (an #1286 am 12.11.2026 das Glossar). Was der Commit neben den Umbenennungen ändert,
  bekommt deshalb `bereiche.sh` vorgelegt: liest keine schwere Suite die Dateien, gilt der
  Vorgänger weiter; ein Verweis im Code (`include_str!`) fordert die Rust-Suite, dann läuft alles.
- Was nicht mehr geprüft wird: das Zusammenspiel der umnummerierten Migration mit den neuen des
  Ziel-Branches. Das prüft auch heute kein PR-Lauf, der vor dem fremden Merge fertig war; der
  Push-Lauf auf `alpha` fängt es.
- Wirkung nur, wenn der Vorgänger fertig grün war (PRs, die auf den Merge von Hand warten). Lief
  seine CI noch, bricht der neue Push sie ab, und der neue Kopf läuft voll.

Alternative „CI-Lauf des Vorgängers weiterlaufen lassen und sein Ergebnis auf den neuen Commit
schreiben“: verworfen, Check-Runs lassen sich nicht auf fremde Commits übertragen, und die
Abbruch-Regel in `ci.yml` müsste Ausnahmen bekommen.

### D5 Kapitel 9 führt keine ADR-Tabelle mehr

Abschnitt 9.1 wird ein Absatz, der auf `entscheidungen/` und die Seite `/architektur/` verweist
und den Befehl nennt, der die Liste im Terminal zeigt (`scripts/adr-fuer.sh --alle`, neu: gibt
`id`, `status`, `titel` je ADR aus). Die Prüfung „Kapitel 9 nennt die ADR nicht“ in
`check-architektur.sh` und ihr Selbsttest-Fall entfallen; `docs/architektur/AGENTS.md` verliert
die Zeile „Kapitel 9 listet jede ADR“, die Mitänderungsregel verlangt bei einer Entscheidung nur
noch die neue ADR.

Alternative „Tabelle erzeugen und im Konfliktfall vom Wächter neu erzeugen lassen“: von Ruben
verworfen (mehr Mechanik, weiterer Bot-Schreibweg).

### D6 ADR-Nummern als zweiter Status neben `Migrationsnummern`

Ohne Tabelle kollidieren zwei PRs mit derselben ADR-Nummer nicht mehr in Git, die doppelte `id`
fiele erst im Gate auf `alpha` auf. `scripts/check-adr-nummern.sh <basis> <kopf>` prüft die Regel
der Spec `adr-nummernvergabe`; die beiden Jobs in `migrationen.yml` setzen damit zusätzlich den
Status `ADR-Nummern` (gleicher Ablauf, gleiche Auslöser, Warnung bei fehlendem Pflicht-Eintrag).
Kein Autofix: eine ADR umzunummerieren ändert `id`, Dateinamen und Verweise und gehört der
Sitzung des PRs. Der Workflow behält seinen Namen.

Alternative „nur Hinweis vom Stau-Wächter“: verworfen, ein Hinweis hält einen grünen PR nicht
auf, wenn zwei von Hand nacheinander gemergt werden.

### D8 „Grün, aber nicht gemergt“ ist ein dritter Befund

Nachtrag vom 12.11.2026, vor der Umsetzung mit Ruben besprochen: #1283 war eine Viertelstunde
lang vollständig grün, Auto-Merge war an, gemergt wurde erst von Hand. Der Wächter meldet das
als Hinweis (Check-Runs fertig und grün, kombinierter Commit-Status `success`, Auto-Merge an,
20 Minuten seit dem letzten Check). Er mergt nicht selbst: ein Merge mit Bypass-Rechten gehört
nicht in einen Lauf ohne Menschen. Die Ursache ist nicht ermittelt.

### D7 Keine eigene ADR

Die Entscheidungen betreffen Gate und CI, nicht die Architektur der Anwendung; für den
Migrations-Autofix gibt es ebenfalls keine. Die Regeln stehen in `scripts/AGENTS.md`, die
Herleitung in diesem Dokument.

## Risks / Trade-offs

- [Der Kommentar weckt die Sitzung nicht, weil sie beendet ist oder Kommentare mit
  `GITHUB_TOKEN` nicht zugestellt werden] → Der Befund steht trotzdem sichtbar am PR. Aufgabe 2.6
  misst die Zustellung am ersten echten Fall; reicht es nicht, ist die geplante Claude-Aufgabe der
  vertagte nächste Schritt.
- [Der Wächter mergt in einen Branch, an dem gerade jemand arbeitet] → Nur Fast-Forward auf den
  bewerteten Kopf, 20 Minuten Wartezeit, nur bei fehlendem CI-Lauf. Wer danach pusht, muss vorher
  holen (wie nach dem Autofix).
- [Übernommene Suiten verdecken einen echten Fehler] → Nur bei inhaltsgleicher Umbenennung, und
  der Push-Lauf auf `alpha` prüft voll. Restrisiko wie bei jedem PR, der vor einem fremden Merge
  grün wurde.
- [`ADR-Nummern` ist erst Pflicht, wenn Ruben das Ruleset ergänzt] → Der Push-Lauf warnt, solange
  der Eintrag fehlt (wie bei `Migrationsnummern`).
- [Stündlicher Lauf kostet Actions-Minuten] → Unter einer Minute je Lauf, kein Build.
- [Kommentar-Rauschen] → Ein Kommentar je PR, neu nur bei geändertem Befund.

## Migration Plan

Ein PR gegen `alpha`. Der Wächter wirkt ab dem ersten Push danach; der Zeitplan läuft nur vom
Standard-Branch. Rückweg: Workflow-Datei entfernen, die Bedingung in `aenderungen` zurücknehmen;
die Tabelle ließe sich aus den ADR-Köpfen wiederherstellen. Nach dem Merge trägt Ruben
`ADR-Nummern` im Ruleset 17017911 ein.

## Open Questions

- Warum lief die CI an #1282 nicht an? Für die Lösung nicht nötig; wenn der Wächter den Fall
  öfter meldet, lohnt die Suche.

## Nachträge

- **Schritte im Sammel-Gate:** Die Selbsttests hängen an den bestehenden Schritten 10
  (Migrationsnummern, Autofix, jetzt auch `nur-umnummeriert` und Stau-Wächter) und 16
  (Architekturdoku, jetzt auch ADR-Nummern), statt neue Schritte zu zählen. Die Schrittzahl
  steht an vielen Stellen, und die Tests gehören fachlich dorthin.
- **Mutationsproben (12.11.2026):** 13 Verfälschungen an den drei Skripten (Schreibgrenzen des
  Wächters, Wartezeit, Schleifenbremse, „gleicher Befund“, Trailer- und Elternprüfung,
  Kollisionsregel), alle von den Selbsttests getötet; der Fall „Merge-Commit mit
  Autofix-Kennzeichen“ wurde dafür geschärft.
- **Probe an echten Commits:** `nur-umnummeriert.sh vorgaenger` nennt für den Bot-Commit
  `26cffdbe` (#1285) den grünen Vorgänger `68efd644` und für `11ba20af` (#1286, zwei Autofixes,
  einer mit Glossar-Verweis) `64b440b5`.
- **Trockenlauf:** `scripts/stau-waechter.sh --nur-zeigen alle` gegen das echte Repository am
  12.11.2026: vier offene PRs, kein Befund (alle konfliktfrei und in der CI).
- **Offen bis zum ersten echten Fall (Aufgabe 2.6):** Kommt ein Kommentar des Wächters
  (`github-actions[bot]`) als Ereignis bei der Sitzung an, die den PR betreut? Zu prüfen am
  ersten Konflikt-Hinweis nach dem Merge: Zeigt der PR innerhalb einer Stunde einen
  Merge-Commit der Sitzung, ist die Zustellung belegt. Bleibt er liegen, ist die vertagte
  geplante Claude-Aufgabe der nächste Schritt.

