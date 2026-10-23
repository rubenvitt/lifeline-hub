# stammdaten-feld Specification

## Purpose
Ein Freitextfeld, für das es Stammdaten oder Einsatzdaten gibt, schlägt diese vor, ohne Freitext
zu verbieten. So entsteht aus der Erfassung kein Datensalat („ELW1“, „ELW 1“), und Unbekanntes aus
der Lage (fremde Einheit, Polizei vor Ort) bleibt erfassbar. Ein Baustein trägt das für alle
Einsatzorte (LLH-1144, `frontend/src/components/StammdatenFeld.tsx`).

## Requirements

### Requirement: Vorschläge in festen Gruppen
Das Feld SHALL beim Tippen die Vorschläge seiner Quellen per Teilwort auf Wert und Beschriftung
filtern, ohne Groß-/Kleinschreibung, und sie in den Gruppen „Im Einsatz“, „Stammdaten“ und
„Zuletzt verwendet“ in dieser Folge zeigen. Ein Wert MUST nur einmal erscheinen, in der ersten
Gruppe, die ihn kennt. Leere Gruppen MUST samt Überschrift entfallen. Demo-Stammdaten MUST hinter
allen echten Einträgen in der Gruppe „Demo-Daten“ mit Demo-Marke stehen. Quellen SHALL Adapter
sein; eine neue Quelle MUST ohne Änderung am Feld hinzukommen.

#### Scenario: Reihenfolge
- **WHEN** ein Feld Vorschläge aus allen drei Gruppen und einen Demo-Eintrag hat
- **THEN** stehen „Im Einsatz“, „Stammdaten“, „Zuletzt verwendet“ und „Demo-Daten“ in dieser Folge

#### Scenario: Doppelter Wert
- **WHEN** „ELW 1“ im Einsatz disponiert ist und in den Stammdaten steht
- **THEN** steht „ELW 1“ nur unter „Im Einsatz“

### Requirement: Freitext bleibt und ist erkennbar
Das Feld MUST jeden getippten Text als Wert annehmen. Ein Wert, der in keiner Quelle aus Einsatz
oder Stammdaten steht, SHALL sichtbar das Wort „frei“ tragen; ein gewählter oder exakt passender
Wert SHALL seine Herkunft als Wort tragen („Im Einsatz“, „Stammdaten“). „Zuletzt verwendet“ MUST
keine Herkunft sein. Die Eingabe MUST per `aria-describedby` auf die Marke verweisen. Ohne jede
Quelle SHALL keine Marke stehen.

#### Scenario: Freitext
- **WHEN** jemand „Polizei vor Ort“ tippt, das in keiner Quelle steht
- **THEN** ist „Polizei vor Ort“ der Wert, und neben dem Feld steht „frei“

#### Scenario: Auswahl aus den Stammdaten
- **WHEN** jemand den Vorschlag „ILS Musterkreis“ aus den externen Stellen wählt
- **THEN** trägt der Wert die Referenz auf die Stelle, und neben dem Feld steht „Stammdaten“

### Requirement: Wertform
Der Wert SHALL `{ text, ref? }` sein, `ref` mit Quelle und Kennung des gewählten Datensatzes. Wo
nur Text gespeichert wird, SHALL das Feld im Modus `nurText` den reinen Text liefern und die
Herkunft aus dem Text ableiten.

#### Scenario: Nur Text
- **WHEN** ein Feld im Modus `nurText` den Vorschlag „Florian 1“ aus dem Einsatz bekommt
- **THEN** ist der Formularwert „Florian 1“, und die Marke sagt „Im Einsatz“

### Requirement: Tastatur
↓ SHALL die Liste öffnen. Enter MUST den mit ↓/↑ markierten Vorschlag übernehmen, sonst den
getippten Text, und die Liste schließen. Enter bei offener Liste MUST das umgebende Formular nicht
absenden; bei geschlossener Liste gilt die Erfassungs-Norm. Escape SHALL eine offene Liste
schließen; erst bei geschlossener Liste darf der Aufrufer Escape als Abbruch deuten.

#### Scenario: Enter nach dem Tippen
- **WHEN** jemand in einer Meldung „Flo“ tippt, die Liste „Florian 1“ zeigt und Enter drückt
- **THEN** ist „Flo“ übernommen, die Liste zu und die Meldung nicht abgesendet; ein zweites Enter
  sendet

#### Scenario: Vorschlag per Tastatur
- **WHEN** jemand ↓, ↓ und Enter drückt
- **THEN** ist der erste Vorschlag übernommen und nichts abgesendet

### Requirement: In Stammdaten übernehmen
Neben einem freien Wert SHALL „In Stammdaten übernehmen“ stehen, wenn eine Quelle einen Katalog
mit reiner Textanlage über eine bestehende Schnittstelle mitbringt. Mit Stammdaten-Recht MUST der
Knopf den Eintrag anlegen und der Wert danach die Referenz tragen. Ohne Recht MUST der Knopf
gesperrt sein und der Grund in wenigen Wörtern sichtbar daneben stehen. Eine Ablehnung MUST am Feld
stehen. Ein Text über der Grenze des Katalogs MUST gesperrt sein mit „zu lang“.

#### Scenario: Mit Recht
- **WHEN** eine System-Admin in einer Meldung den freien Absender „Polizei Musterstadt“ in die
  Stammdaten übernimmt
- **THEN** steht „Polizei Musterstadt“ als externe Stelle der Art „Sonstige“ im Katalog, und das
  Feld zeigt „Stammdaten“

#### Scenario: Ohne Recht
- **WHEN** eine Führungskraft ohne Admin-Rolle einen freien Absender tippt
- **THEN** ist „In Stammdaten übernehmen“ gesperrt, und daneben steht „nur System-Admin“

#### Scenario: Kein passender Katalog
- **WHEN** ein Feld nur Quellen ohne Anlage hat (etwa die ETB-Erfassung)
- **THEN** steht neben einem freien Wert nur „frei“, kein Knopf

### Requirement: Zuletzt verwendet am Gerät
Das Feld SHALL je Kontext höchstens acht zuletzt übernommene Werte am Gerät zeigen, neueste vorn,
ohne Doppel. Gemerkt MUST nur ein übernommener Wert werden (Chip übernommen, Meldung erfasst), nie
ein Tastendruck. Abmelden und Sitzungsende MUST die Werte räumen.

#### Scenario: Nach dem Abmelden
- **WHEN** jemand „Polizei vor Ort“ als Absender erfasst und sich abmeldet
- **THEN** steht „Polizei vor Ort“ für die nächste Person nicht unter „Zuletzt verwendet“

### Requirement: Trefflächen
Die Vorschlagszeilen MUST in jeder Dichte die Steuerhöhe halten (30/48/72 px), im Handschuh also
72 px. Der Knopf „In Stammdaten übernehmen“ MUST der Dichte-Staffel folgen.

#### Scenario: Handschuh
- **WHEN** die Dichte „Handschuh“ gewählt ist und die Liste offen steht
- **THEN** ist jede Vorschlagszeile mindestens 72 px hoch
