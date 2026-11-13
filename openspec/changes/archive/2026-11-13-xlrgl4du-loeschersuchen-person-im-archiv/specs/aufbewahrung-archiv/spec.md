# Spec Delta

## MODIFIED Requirements

### Requirement: Archiv liest nur, bis auf Wiederherstellen und Schwärzungsantrag

Der Archiv-Namensraum SHALL ausschließlich lesende Abrufe anbieten, mit drei Ausnahmen: dem
Wiederherstellen, dem Stellen eines Schwärzungsantrags und seiner Rücknahme. Die Personensuche
ist ein lesender Abruf, auch wenn sie ihren Suchtext im Anfrage-Body trägt. Über den Namensraum
MUST sich keine Angabe eines Einsatzes, einer Person, eines Tiers, eines Schadens oder eines
ETB-Eintrags unmittelbar ändern lassen; geschwärzt wird nur durch den Vollzug im Purge-Lauf,
eine Person in den Blöcken eines Archivs nur durch den Befehl mit dem Archiv-Schlüssel. Die
regulären Einsatz-Routen MUST für einen gesperrten Einsatz weiter 403 liefern, auch dem
System-Admin. Das gilt für Detail, ETB, Personen, Tiere, Schäden, Anhänge, Dokumente, Chat,
Lagekarte, Export und Live-Strom.

#### Scenario: Reguläre Routen bleiben gesperrt
- **WHEN** der System-Admin nach der Schwärzung ETB, Personenliste, Anhänge oder Live-Strom des Einsatzes über die regulären Routen abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Kein Schreibweg im Archiv
- **WHEN** die Routen des Archiv-Namensraums aufgezählt werden
- **THEN** ist jede davon ein lesender Abruf, außer Wiederherstellen, Antrag und Rücknahme
- **AND** ist die Personensuche als einzige lesende Route kein GET

#### Scenario: Antrag ändert keine Angabe
- **WHEN** der Admin einen Schwärzungsantrag für eine Person stellt
- **THEN** trägt die Person unmittelbar danach unveränderte Angaben
