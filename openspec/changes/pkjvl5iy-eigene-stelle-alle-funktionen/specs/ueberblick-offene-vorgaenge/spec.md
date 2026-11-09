# Spec Delta

## MODIFIED Requirements

### Requirement: Sicht „alle“ und „meine Stelle“
Der Kopf des Paneels SHALL eine Segmentleiste „alle“ / „meine Stelle“ tragen, Vorgabe „alle“;
die Wahl steht als `?vorgaenge=meine` in der Adresse. „meine Stelle“ MUST nur die Einträge
filtern: Empfänger ist die eigene Funktion oder Absender ist die Person selbst; Nachforderungen nur
nach Absender. Eigene Funktion ist die Führungsfunktion der eigenen Mitgliedschaft aus dem ganzen
Katalog (Einsatzleitung, S1–S7, Führungshilfspersonal, Fachberater), ohne Führungsfunktion mit
Rolle Einsatzleitung „EL“. Bei Führungshilfspersonal und Fachberater MUST zusätzlich die
Bezeichnung passen, sobald Empfänger und eigene Funktion je eine tragen; verglichen wird ohne
Groß-/Kleinschreibung und ohne Leerraum am Rand. Die Zahl MUST die des Einsatzes bleiben und heißt
dann „im Einsatz“. Ablösungen haben keinen Stellenbezug: sie bleiben ungefiltert mit der Notiz
„alle Stellen“. Leer heißt ein gefilterter Abschnitt „keine für meine Stelle“.

#### Scenario: Meine Stelle
- **WHEN** eine Person mit Sachgebiet S2 „meine Stelle“ wählt und von drei offenen Aufträgen
  einer an S2 geht
- **THEN** steht im Abschnitt „Aufträge“ nur dieser, die Zahl bleibt 3 mit „im Einsatz“, und die
  Adresse trägt `?vorgaenge=meine`

#### Scenario: Funktion S7
- **WHEN** eine Person mit der Führungsfunktion S7 „meine Stelle“ wählt und ein offener Auftrag an
  S7 geht
- **THEN** steht dieser Auftrag im Abschnitt „Aufträge“

#### Scenario: Fachberater mit Bezeichnung
- **WHEN** eine Person mit der Führungsfunktion Fachberater und der Bezeichnung „THW“ „meine
  Stelle“ wählt, und je ein offener Auftrag geht an „Fachberater: thw“ und an „Fachberater:
  Polizei“
- **THEN** steht im Abschnitt „Aufträge“ nur der Auftrag an „Fachberater: thw“

#### Scenario: Empfänger ohne Bezeichnung
- **WHEN** eine Person mit der Führungsfunktion Fachberater und der Bezeichnung „THW“ „meine
  Stelle“ wählt und eine offene Meldung an die Funktion Fachberater ohne Bezeichnung geht
- **THEN** steht diese Meldung im Abschnitt „Meldungen“
