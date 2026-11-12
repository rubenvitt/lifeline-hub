# Tasks

Die Change ändert nur Anleitungen und die PR-Vorlage; es gibt keinen Code, an dem ein Test rot
werden könnte. Jede Aufgabe nennt deshalb, woran ihr Ergebnis zu prüfen ist.

## 1. Prüfliste (D8)

- [x] 1.1 `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md` anlegen: Kopf (Herkunft, Zweck, „kein Ersatz für das Lesen des Diffs“), zehn Klassen mit Prüffragen und „Trifft zu, wenn der Diff …“. Prüfung: jede Klasse aus design.md D8 steht darin, je mit mindestens einer Prüffrage
- [x] 1.2 Je Klasse zwei bis drei Beispiele aus den Commits der Testphase eintragen (Kurz-Hash, ein Satz zum Fall). Prüfung: jeder genannte Hash löst sich mit `git cat-file -e <hash>` auf und sein Commit-Text passt zur Klasse

## 2. Review-Schritt in `dev-zunder-ausfuehren` (D1, D2, D4, D5, D10)

- [x] 2.1 Abschnitt „Review vor dem PR“ in `SKILL.md`: wann (jede Route außer `trivial`, ein Review je PR), Reihenfolge in Schritt 4, Auftragsvorlage für den Reviewer, Gegenprüfung, Tabelle zum Verbleib, Regel zur Pflege der Prüfliste. Prüfung: jede Anforderung der Delta-Spec hat eine Stelle im Abschnitt
- [x] 2.2 Schritt 4: Zeile `superpowers:requesting-code-review` durch den Verweis auf den neuen Abschnitt ersetzen und vor das Archivieren stellen; Hinweis, dass der Review entfällt, wenn `dev-zunder-orchestrieren` aufruft. Prüfung: `grep -n requesting-code-review .claude/skills/dev-zunder-ausfuehren/SKILL.md` ist leer
- [x] 2.3 Tabelle „Agenten nach Bedarf“: Zeile „Review parallel zu laufenden Gates“ auf den neuen Abschnitt verweisen lassen; „Don'ts“ um „keinen PR ohne Review und Abschnitt „Review““ ergänzen. Prüfung: beide Stellen nennen den Abschnitt beim Namen

## 3. Orchestrator (D3, D7)

- [x] 3.1 `dev-zunder-orchestrieren/SKILL.md`, Phase 4: ein Review über den ganzen Branch, Ablauf und Verbleib per Verweis auf `dev-zunder-ausfuehren`, Punkt 3 (`superpowers:requesting-code-review`) streichen. Prüfung: Phase 4 nennt die Prüfliste und keine eigene Dimensionsliste
- [x] 3.2 `references/workflow-bausteine.md`, Skelett „Review-find-verify“: `DIMENSIONS` durch die vier Gruppen aus D3 ersetzen, jeder Agent bekommt den Pfad der Prüfliste und die Namen seiner Klassen; Schlusssatz ohne `superpowers:requesting-code-review`. Prüfung: das Skript bleibt syntaktisch gültig (`node --check` auf den herausgelösten Block) und enthält keine Kopie der Prüffragen

## 4. Projektregel und PR-Vorlage (D6, D9)

- [x] 4.1 `AGENTS.md`, Abschnitt „Planung und Ausführung“: `requesting-code-review` an beiden Stellen ersetzen, ein Punkt zum Review vor dem PR mit Verweis auf Skill und Herleitung. Prüfung: `wc -l AGENTS.md` unter 200, `grep -n requesting-code-review AGENTS.md` leer
- [x] 4.2 `.github/pull_request_template.md`: Abschnitt „Review“ zwischen „Bilder“ und „Geprüft“ wie in D6. Prüfung: die Vorlage zeigt den Abschnitt, der Kommentar nennt die drei Fälle (bestätigt, verworfen, kein Review)

## 5. Probelauf und Abschluss

- [x] 5.1 Probelauf am echten Fall: den Reviewer nach der neuen Vorlage auf den Diff eines gemergten PRs der Testphase ansetzen, in dem CodeRabbit etwas fand, und zwar auf den Stand **vor** der Behebung (Vorschlag: #1243 vor `773b6b44`). Prüfung: Ergebnis als Tabelle in dieser Datei unter „Probelauf“: welche der dort von CodeRabbit gemeldeten Fehler der eigene Review findet, welche nicht. Fehlt eine ganze Klasse, Prüffrage schärfen und Lauf wiederholen
- [x] 5.2 Verweise prüfen: `grep -rn "requesting-code-review" AGENTS.md .claude .github` ist leer; Verweise auf den Abschnitt „Review vor dem PR“ und auf `review-pruefliste.md` zeigen auf vorhandene Stellen
- [x] 5.3 `./scripts/check-all.sh --nur schnell` grün (Prettier und der Archiv-Wächter betreffen die geänderten Dateien)
  Lauf vom 12.11.2026 mit `--geaendert` (Schritte 1 2 3 6 8 9 10 11 12 13 14 16): grün 9, 10, 13
  (Archiv-Wächter), 14, 16 (Architekturdoku). Rot 1, 2, 3, 6, 8, 11, 12, jeder mit
  `mise: command not found`: die Cloud-Sitzung hat kein mise. Keiner dieser Schritte liest eine
  Datei dieses Diffs (Prettier prüft nur `frontend/` und `website/`). Der volle Lauf gilt in der
  CI des PRs.
- [ ] 5.4 Der Review dieser Change selbst läuft nach dem neuen Abschnitt; der PR trägt den Abschnitt „Review“

## Probelauf

12.11.2026, PR #1243 („Führung je Einsatz“, LLH-1491) auf dem Stand `887c79cd`, also vor den
Behebungen `773b6b44` und `da7c3553`; Diff `8176add9...887c79cd`, rund 7800 Zeilen in 99 Dateien.
Wegen der Größe vier Reviewer nach den Gruppen aus D3, je mit dem Auftrag aus dem Abschnitt
„Review vor dem PR“. Ohne Gegenprüfung: gemessen wurde, ob der Review die Fehler findet, nicht,
wie viele seiner übrigen Befunde zutreffen.

| Befund von CodeRabbit | Behoben in | Gefunden | Von |
| --- | --- | --- | --- |
| Ein ELW nimmt einem anderen ELW die Führung | `773b6b44` | ja ¹ | `zugriff`, `belege` |
| Widerruf räumt offene Übernahmen nicht | `773b6b44` | ja | `zugriff` |
| Bestätigen verlangt kein gekoppeltes Gegenüber | `773b6b44` | ja | `zugriff` |
| Schwärzung setzt `offen` ohne `offen_bruch_at` auf NULL | `773b6b44` | ja | `daten` |
| „Sofort wieder melden“ ohne Fortschritt der Quittung | `773b6b44` | ja | `daten` |
| Fremde Zeremonie ist nicht 422 | `773b6b44` | nein | |
| Grund-Grenze fehlt im Eingabegrenzen-Spiegel | `773b6b44` | ja | `daten`, `belege` |
| Hinweisband ohne Anzeige-Konventionen des Einsatzes | `773b6b44` | nein | |
| Paneel „Führung“ ohne Fehlerzustand | `773b6b44` | ja | `oberflaeche`, `zugriff`, `belege` |
| Neue Org-Zuordnung gibt Akten keinen frischen Stand | `da7c3553` | ja | `daten` |
| Widerruf meldet die freigegebenen Einsätze nicht | `da7c3553` | ja ¹ | `zugriff` |
| Hinweisband verschwindet bei Ladefehler | `da7c3553` | ja | `oberflaeche`, `zugriff`, `belege` |

10 von 12 gefunden. ¹ Diese zwei Fälle stehen als Beispiel in der Prüfliste (Klassen 4 und 9);
der Reviewer hatte hier also einen Hinweis. Ohne sie: 8 von 10.

Keine Klasse fiel ganz aus. Die zwei verfehlten Fälle sind Regelverstöße im Einzelnen
(Statuscode eines Fehlerzweigs, Anzeige-Konvention an einer neuen Stelle). Daraufhin Klasse 7 um
Projektregeln erweitert und zwei Prüffragen ergänzt; auf einen zweiten Lauf verzichtet, weil
keine Klasse fehlte und ein Lauf dieser Größe rund 900 000 Tokens kostet.

Daneben meldeten die Reviewer rund 30 weitere Befunde, die CodeRabbit nicht hatte, ungeprüft.
Sie betreffen den Stand vom 09.11.2026 und gehören nicht zu dieser Change.

## Workflow follow-up

- `/opsx:archive review-vor-dem-pr` vor dem PR, im selben Branch; danach den Verweis in `AGENTS.md` auf den Archivpfad nachziehen.
- PR gegen `alpha` mit Plan, Umsetzung und Archiv zusammen.
- Außerhalb des Repos, bei Ruben: CodeRabbit-App am Repository abschalten oder auf Review nur auf Zuruf stellen.
