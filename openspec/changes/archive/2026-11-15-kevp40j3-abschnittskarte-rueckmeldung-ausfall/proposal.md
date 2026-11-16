# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/kevp40j3kgdl771bbu0qsx84 (LLH-1739, Teil von LLH-1717
„Was brennt“, Welle 1)

## Why

Das Meldebild zeigt für Sanitätszug und Logistiktrupp „Rückm. überfällig“, dazu „1 Ausfall“ und
„1 Ausfall Material“. Der Überblick zeigt zur selben Minute den Abschnitt Logistik grün
„planmäßig“, „Ausfall 0“ und die letzte Rückmeldung „1550“ in Grau, zwei Stunden alt. Die
Einsatzleitung hält einen Abschnitt für ruhig, von dem sie nichts mehr hört. Zwei Ursachen:

- Die Abschnittskarte kennt nur die **jüngste** Rückmeldung im Teilbaum. Eine frische Meldung
  irgendeiner Einheit verdeckt eine andere, die schweigt. Ein Urteil „überfällig“ fällt nie.
- „Ausfall“ zählt dort Einheiten mit Status „nicht verfügbar“. Das Meldebild zählt ausgefallene
  Mittel und ausgefallenes Material. Das Wort ist dasselbe, die Zählung eine andere.

## What Changes

- Die Abschnittskarte im Überblick beurteilt die Rückmeldung **je Einheit im Teilbaum**, mit
  derselben Regel wie das Meldebild. Ist eine überfällig, steht ein Etikett in der Alarmrolle:
  **„Rückm. überfällig seit 47 min“**. Bei mehreren steht **„3 Einh. Rückm. überfällig, längste
  seit 47 min“**. Einheiten ohne jede Rückmeldung zählen mit: „keine Rückm.“ bzw. „2 Einh. ohne
  Rückm.“.
- **„Ausfall“ kommt aus der Quelle des Meldebilds**: Ausfall der Mittel und des Materials der
  Einheiten im Teilbaum, als Etiketten „1 Ausfall“ und „1 Ausfall Material“ in der Alarmrolle, nur
  wenn größer als null.
- Die Statusverteilung der Einheiten bleibt. Ihre dritte Zelle heißt **„nicht verfügbar“** statt
  „Ausfall“, damit nicht zwei verschiedene „Ausfall“ nebeneinander stehen.
- **Der gepflegte Lagezustand bleibt** (Entscheidung 15.11.2026): „planmäßig“ wird nicht
  automatisch umgefärbt. Das Alarm-Etikett steht direkt daneben, sodass die grüne Kante nicht
  unkommentiert bleibt.
- Die Zeile „letzte Rückmeldung“ bleibt als Information.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lage-verdichtung`: neue Anforderung, dass Rückmeldung und Ausfall eines Abschnitts im Überblick
  aus derselben Quelle und mit derselben Regel kommen wie im Meldebild.

## Impact

- Frontend: `pages/fuehrung/ueberblickDaten.ts` (`abschnittZeilen`: Einheiten des Teilbaums samt
  Rückmeldung und Ausfall), `pages/fuehrung/UeberblickPage.tsx` (`abschnittGliederung`), ein
  gemeinsamer Kern für den Ausfall einer Einheit (aus `kraefte/meldebildRaster.ts` gehoben), die
  Formatierer aus Change `g1u57q0f-meldebild-alarm-etiketten`.
- Regel `frontend/AGENTS.md`, „Eine Heimat je Zahl“: Ausfall und Rückmeldung eines Abschnitts.
- Tests `ueberblickDaten.test.ts`, `UeberblickPage.test.tsx`; Anwenderdoku `ueberblick.md` samt
  Bild.
- Kein Backend: Der Server rechnet die Überfälligkeit je Einheit schon (`src/meldung/rueckmeldung.rs`),
  die Zusammenfassung je Abschnitt ist Client-Sache wie bisher.
- Hängt an `g1u57q0f-meldebild-alarm-etiketten` (Rolle „überfällig“ = alarm, Formatierer). Diese
  Change wird zuerst umgesetzt.
