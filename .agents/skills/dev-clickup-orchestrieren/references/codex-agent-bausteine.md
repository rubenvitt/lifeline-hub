# Codex-Agent-Bausteine

Diese Vorlagen ersetzen die Claude-Workflow-Skripte durch Codex-Kollaboration. Passe
Platzhalter an den geladenen ClickUp-Task an. Agenten in diesen Bausteinen arbeiten read-only,
sofern nicht ausdrücklich ein eigener Worktree genannt ist.

## Koordination

1. Zerlege nur in voneinander unabhängige, begrenzte Aufträge.
2. Starte höchstens so viele Agenten, wie freie Slots vorhanden sind; weitere Aufträge kommen
   in die nächste Welle.
3. Verwende aussagekräftige Task-Namen und gib jedem Agenten Taskbeschreibung, relevante
   Custom-IDs, erlaubte Pfade und erwartetes Ergebnis mit.
4. Sammle Ergebnisse über die Kollaborationswerkzeuge ein und synthetisiere sie im Main-Agent.
5. Unterbrich Agenten nur, wenn neue User-Angaben den Auftrag überholen oder sie nachweislich
   am falschen Scope arbeiten.

## 1. Scope-Reader

```text
Analysiere read-only den Subtask <CUSTOM_ID> "<NAME>" gegen dieses Repository.

Taskbeschreibung:
<BESCHREIBUNG>

Andere Subtasks: <IDS UND KURZTITEL>

Liefere genau:
- files: wahrscheinliche bestehende Dateien/Pfade
- existing_patterns: relevante vorhandene Muster und Tests
- depends_on: Custom-IDs mit konkreter Begründung
- overlaps_with: Custom-IDs und gemeinsame Dateien
- complexity: trivial | klar | unklar | multi-step
- risks: konkrete Risiken
- open_questions: nur Fragen, die Repository/Task nicht beantworten
- summary: maximal fünf Sätze

Ändere keine Dateien und führe keine externen Writes aus.
```

Der Main-Agent vergleicht anschließend die `files`-Mengen. Gemeinsame Dateien oder fachliche
Abhängigkeiten schließen parallele Implementierung im selben Checkout aus.

## 2. Plan-Entwurf je Subtask

```text
Erstelle read-only einen knappen, ausführbaren Plan für <CUSTOM_ID> "<NAME>".
Nutze die Taskbeschreibung und die Scope-Map unten.

<TASK UND SCOPE>

Liefere:
1. Änderungsschritte mit konkreten Dateien oder Symbolen
2. Teststrategie einschließlich Regressionstest bzw. Akzeptanz-Gate
3. Reihenfolge und Abhängigkeiten
4. Risiken und Rollback-/Fallback-Gedanke
5. offene Entscheidung, falls wirklich nötig

Bevorzuge bestehende Repository-Muster. Ändere keine Dateien.
```

## 3. Konkurrierender Entwurf

Nutze zwei bis drei Perspektiven nur bei echtem Lösungsraum, zum Beispiel:

- minimaler Eingriff/MVP;
- Risiko und Migration zuerst;
- engste Passung zu bestehenden Repository-Mustern.

Jeder Agent erhält denselben Task und liefert `approach`, `steps`, `tests`, `risks` und
`tradeoffs`. Der Main-Agent oder ein read-only Judge prüft danach:

```text
Bewerte die Entwürfe gegen Task-Akzeptanzkriterien und den realen Codebestand.
Bewertung: Machbarkeit, Risiko, Wartbarkeit, Testbarkeit und Konventionspassung.
Nenne den stärksten Entwurf, übernehmbare Ideen der anderen und verbleibende Unsicherheiten.
Erfinde keine Belege; verweise auf konkrete Dateien/Symbole.
```

## 4. Review: Finden und widerlegen

Erste Welle, je Dimension ein read-only Agent:

```text
Reviewe den Diff für <CUSTOM_ID> in der Dimension <DIMENSION>.
Prüfe nur geänderte Pfade und direkt relevante Aufrufer. Liefere pro möglichem Finding:
- title
- file und genaue Stelle
- execution_path oder reproduzierbares Szenario
- violated_requirement
- suggested_check

Keine Stilpräferenzen ohne Projektbeleg. Ändere keine Dateien.
```

Sinnvolle Dimensionen sind Logik/Boundary Cases, Security/Org-Isolation,
Projektkonventionen und Testabdeckung.

Zweite Welle, potenzielle Findings adversarial prüfen:

```text
Versuche dieses mögliche Finding am aktuellen Diff und Codepfad zu widerlegen:
<FINDING>

Prüfe Aufrufer, Guards, Typen und Tests. Antworte mit:
- is_real: true | false
- evidence: konkrete Codebelege
- confidence: high | medium | low
- minimal_fix: nur wenn is_real=true

Bei nicht ausreichendem Beleg ist is_real=false. Ändere keine Dateien.
```

Nur Findings mit `is_real=true` und konkretem Beleg gehen in die Umsetzung zurück.

## 5. Schreibender Agent in eigenem Worktree

Dieser Baustein ist nur zulässig, wenn der User Mehragenten-Implementierung wünscht und ein
eigener Worktree bereits eingerichtet und eindeutig benannt ist:

```text
Implementiere ausschließlich <CUSTOM_ID> im Worktree <ABSOLUTER PFAD>.
Erlaubte Dateien: <PFADE>
Verbotene Dateien: <PFADE ODER "alles andere">
Akzeptanzkriterien: <KRITERIEN>
Pflichttests: <BEFEHLE>

Arbeite testgetrieben bzw. mit Regressionstest, erhalte fremde Änderungen und führe keine
externen Writes, Commits, Pushes oder Board-Updates aus. Melde abschließend:
- changed_files
- tests mit Exit-Code
- assumptions
- blockers
- handoff_summary
```

Boardstatus, Integration, Konfliktauflösung und User-Kommunikation bleiben beim Main-Agent.
