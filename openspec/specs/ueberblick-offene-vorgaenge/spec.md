# ueberblick-offene-vorgaenge Specification

## Purpose
Das Paneel „Offene Vorgänge“ im Führungsüberblick sammelt, was gerade auf eine Antwort, eine
Erledigung oder ein Eintreffen wartet: Meldungen, Aufträge, Nachforderungen, Erinnerungen und
Ablösungen. Es ersetzt das Paneel „Offene Aufträge“ und das Paneel „Nachforderungen“ (LLH-1145).
Gezählt wird nur in der Heimat der Zahl (Modulzähler, LFH-550); das Paneel wählt aus und ordnet.

## Requirements

### Requirement: Fünf Abschnitte in fester Folge
Das Paneel „Offene Vorgänge“ SHALL die Abschnitte Meldungen, Aufträge, Nachforderungen,
Erinnerungen und Ablösungen in dieser Folge tragen, jeden mit eigener Überschrift, Zahl, Notiz,
höchstens drei Einträgen und dem Sprung „alle ↗“ in sein Modul. Ein Abschnitt MUST stehen
bleiben, auch wenn er leer, gesperrt oder ausgefallen ist; die Folge ändert sich nie.

#### Scenario: Folge
- **WHEN** der Führungsüberblick eines Einsatzes mit allen Modulen frei geöffnet wird
- **THEN** stehen im Paneel die Überschriften „Meldungen“, „Aufträge“, „Nachforderungen“,
  „Erinnerungen“, „Ablösungen“ in dieser Reihenfolge

### Requirement: Die Zahl eines Abschnitts ist die des Moduls
Die Zahl eines Abschnitts MUST die Zahl sein, die das Modul selbst zeigt: Meldungen
`meldungen.offen`, Aufträge `auftraege.offen`, Nachforderungen `nachforderungen.offen`,
Erinnerungen `erinnerungen.faellig` aus dem Modulzähler; Ablösungen die fälligen und bald fälligen
laufenden Schichten nach demselben Browser-Zähler wie die Modulnavigation. Die Notiz liest
ebenfalls den Zähler: bei Meldungen „n neu“, „n Bestätigung überfällig“ (Ton „alarm“) und „n
Lagemeldungen neu“; bei Aufträgen „n überfällig“ (Ton „alarm“) oder „keiner überfällig“ und „n
in Arbeit“; bei Nachforderungen „n überfällig“ (Ton „achtung“) und „n unterwegs“. Die Liste
eines Abschnitts MUST NOT gezählt werden, um eine Zahl zu zeigen.

#### Scenario: Aufträge
- **WHEN** der Modulzähler `auftraege { offen: 2, in_arbeit: 0, ueberfaellig: 1 }` liefert
- **THEN** zeigt der Abschnitt „Aufträge“ die Zahl 2 und „1 überfällig · 0 in Arbeit“

### Requirement: Einträge nach Dringlichkeit mit Deeplink
Jeder Abschnitt SHALL höchstens drei Einträge zeigen, das Überfällige zuerst, dann nach der
nächsten Frist, dann das Älteste; die Kennung ordnet als letzte Stufe. Ein Eintrag MUST per
Deeplink auf sein Objekt führen, das das Ziel hervorhebt (`?meldung=`, `?auftrag=`,
`?nachforderung=`, `?schicht=`); Erinnerungen führen in ihr Modul. Ein Eintrag mit Alarm
(Bestätigung überfällig, Auftrag überfällig, Ablösung überfällig) MUST die Alarmkante links und
das Wort tragen; eine überfällige Nachforderung trägt nur das Wort im Ton „achtung“.
Erinnerungen zeigen die fälligen und die in den nächsten 30 Minuten fälligen offenen; Ablösungen
die laufenden, die überfällig oder in ihrer Vorwarnzeit sind.

#### Scenario: Überfälliger Auftrag
- **WHEN** von zwei offenen Aufträgen der jüngere seine Frist verpasst hat
- **THEN** steht er zuerst, mit Alarmkante und „überfällig“, und führt auf
  `/einsaetze/{id}/auftraege?auftrag={auftrag}`

### Requirement: Leer, gesperrt, ausgefallen, ohne Netz
Ein Abschnitt ohne Einträge MUST „keine“ zeigen. Ist sein Modul nicht freigegeben (Freigabe oder
fehlender Zähler), MUST er „—“ statt der Zahl und „nicht freigegeben“ zeigen, ohne Sprung, ohne
Einträge und ohne Abruf der Liste. Fällt die Liste aus, MUST er „Stand unbekannt, Liste nicht
abrufbar“ mit „Erneut abrufen“ zeigen, nie „keine“. Ist die Liste ohne Netz nie geladen worden,
MUST er „ohne Netz nicht geladen“ zeigen, nie „keine“. Solange die Freigaben laden oder
fehlschlagen, trägt das ganze Paneel diesen Zustand.

#### Scenario: Gesperrtes Modul
- **WHEN** das Modul Aufträge für die Person nicht freigegeben ist
- **THEN** zeigt der Abschnitt „Aufträge“ „—“ und „nicht freigegeben“, keinen Link und nicht
  „keine“, und die Auftragsliste wird nicht abgerufen

### Requirement: Sicht „alle“ und „meine Stelle“
Der Kopf des Paneels SHALL eine Segmentleiste „alle“ / „meine Stelle“ tragen, Vorgabe „alle“;
die Wahl steht als `?vorgaenge=meine` in der Adresse. „meine Stelle“ MUST nur die Einträge
filtern: Empfänger ist eine eigene Funktion (die besetzten Sachgebiete, ohne Sachgebiet mit
Rolle Einsatzleitung „EL“) oder Absender ist die Person selbst; Nachforderungen nur nach
Absender. Die Zahl MUST die des Einsatzes bleiben und heißt dann „im Einsatz“. Ablösungen haben
keinen Stellenbezug: sie bleiben ungefiltert mit der Notiz „alle Stellen“. Leer heißt ein
gefilterter Abschnitt „keine für meine Stelle“.

#### Scenario: Meine Stelle
- **WHEN** eine Person mit Sachgebiet S2 „meine Stelle“ wählt und von drei offenen Aufträgen
  einer an S2 geht
- **THEN** steht im Abschnitt „Aufträge“ nur dieser, die Zahl bleibt 3 mit „im Einsatz“, und die
  Adresse trägt `?vorgaenge=meine`
