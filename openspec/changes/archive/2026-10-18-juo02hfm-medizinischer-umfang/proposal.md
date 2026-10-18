# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1018, Subtask LLH-1109): „Medizinisch kann noch
einiges mehr hinein.“ Bevor Felder entstehen, muss feststehen, wie weit Lifeline Hub medizinisch
dokumentiert. Die App ist Führungsunterstützung und kein Notfallprotokoll. Jedes medizinische
Feld fällt unter die besondere Kategorie nach Art. 9 DSGVO, unterliegt Aufbewahrung und
Schwärzung und darf das Rettungsdienstprotokoll nicht doppeln. Diese Change hält die Entscheidung
fest und schneidet die Folgearbeit. Sie ändert keinen Code und kein Verhalten.

## What Changes

- **Entscheidung „PAT-Kern“ (Option A, Ruben 18.10.).** Lifeline Hub führt:
  - Verdachtsdiagnose
  - Verletzungen am Körperschema
  - Maßnahmen aus festem Katalog mit Uhrzeit
  - Transportpriorität und Transportart
  - benötigte Fachrichtung
  - Kontamination
  - PAT-Nummer
  - keine Vitalwerte und keinen Kurzbefund
- **„Zustand“ heißt „Zustand / Verdacht“.** Daten wandern nicht, ein Freitext bleibt. Umgesetzt
  wird das in `y18v58dt-patientenkopf-bezuege`.
- **Regeln für alles Neue:**
  - Kategorie „Behandlung“
  - Katalog fest im Code
  - ohne Netz nur Enum-Werte im Lagebild
  - ins ETB nur die Transportpriorität, pseudonym
  - Schreibrecht wie heute plus UHS-Gerät mit „Bestätigt von“
  - keine Sanitätsrolle
- **Folgetickets** auf dem Board: Maßnahmen, Transport (Priorität, Art, Fachrichtung), PAT-Nummer
  und Kontamination. Die Kataloge für Verletzungen (LLH-1113) und die Figur für das Körperschema
  (LLH-1120) stehen als Kommentar an den Tickets.

## Capabilities

### New Capabilities
<!-- keine: Diese Change hält eine Entscheidung fest (skip_specs). Die Specs entstehen mit den
     Folgetickets, etwa `personen-verletzungen` und `personen-massnahmen`. -->

### Modified Capabilities
<!-- keine -->

## Impact

- Kein Code, keine Migration.
- Zunder: neue Folgetickets unter LLH-1018 und Kommentare an LLH-1113 und LLH-1120.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/juo02hfmty62l0f0vyr4htm1
