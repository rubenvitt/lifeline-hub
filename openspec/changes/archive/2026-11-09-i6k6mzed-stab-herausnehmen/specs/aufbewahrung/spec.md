# Spec Delta

## MODIFIED Requirements

### Requirement: Führungsdokumentation steht allein im ETB

Die rechtsverbindliche Führungsdokumentation eines Einsatzes SHALL das ETB sein. Die
Datensätze der Führungsmodule (Meldungen, Aufträge samt Empfängern, Nachforderungen,
Lageberichte, Befehle, Lagebesprechungen) MUST bei der Schwärzung ihre Freitexte verlieren: Absender und Empfänger, Inhalt, Auftragstext und Befehlsgliederung,
Vollzugsmeldung, Bedarfsart und Bezeichnungen, Begründungen, Ablehnungsgründe, Titel, Abschnitte
und Entschluss. Erhalten bleiben MUST laufende Nummer, Meldungsart, Meldeweg, Priorität, Status,
Zeitpunkte und Verweise dieser Datensätze. Ein Freitext, der im Wortlaut eines ETB-Eintrags
steht, MUST dort erhalten bleiben. Ein Freitext, der nie ins ETB gelangt ist, MUST nach der
Schwärzung nirgends mehr stehen.

#### Scenario: Meldung und Auftrag nach der Schwärzung
- **WHEN** ein Einsatz mit einer Meldung „Fam. Yilmaz, Hauptstr. 5“ und einem Auftrag an eine
  externe Stelle mit Lage- und Absichtstext geschwärzt wird
- **THEN** tragen Meldung, Auftrag und Auftragsempfänger keinen dieser Freitexte mehr
- **AND** tragen sie weiter laufende Nummer, Meldeweg, Status und Zeitpunkte
- **AND** steht der Meldungsinhalt weiter im Wortlaut des zugehörigen ETB-Eintrags

#### Scenario: Ablehnungsgrund und Ziel der Nachforderung
- **WHEN** eine Nachforderung mit einem Ziel als Freitext („Wohnung Fam. Yilmaz“) mit Grund
  abgelehnt wurde und der Einsatz später geschwärzt wird
- **THEN** trägt die Nachforderung weder Ablehnungsgrund noch Ziel-Freitext
- **AND** stehen beide weiter im Wortlaut der ETB-Einträge von Anforderung und Ablehnung

#### Scenario: Lagebericht nach der Schwärzung
- **WHEN** ein Einsatz mit einem freigegebenen Lagebericht und einem Entwurf geschwärzt wird
- **THEN** tragen beide Versionen weder Titel noch Abschnittstext
- **AND** bleiben Version, Status und Zeitstand erhalten
- **AND** steht der freigegebene Bericht weiter im Wortlaut des ETB

#### Scenario: Audit nennt, was bleibt
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** nennt der System-Eintrag der Schwärzung die Freitexte der Führungsmodule als entfernt
- **AND** nennt er das ETB im Wortlaut als erhaltene Führungsdokumentation
- **AND** behauptet er nicht, Meldungen, Aufträge oder Berichte blieben als Text erhalten
