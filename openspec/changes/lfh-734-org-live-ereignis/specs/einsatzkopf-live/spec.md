# Spec Delta

## MODIFIED Requirements

### Requirement: Wer vom Einsatzkopf erfährt
Das Ereignis `einsatz` MUST jeden Abonnenten erreichen, der den Live-Strom des Einsatzes öffnen darf,
unabhängig von seinen Modulfreigaben. Die Tür des Stroms und die des Einsatzkopfs sind dieselbe
(Lesezugriff auf den Einsatz ohne Modul). Außer `einsatz` und dem Kontrollereignis `lagged` MUST
jedes Einsatz-Ereignis mindestens einem Modul zugeordnet bleiben. Die Org-Ereignisse `einsatzliste`
und `stammdaten`, die derselbe Strom mitträgt (LFH-734), sind keine Einsatz-Ereignisse: sie gehören
keinem Modul und folgen den Gates der Fähigkeit `org-live`. Ihre Wire-Namen MUST sich von allen
Einsatz-Ereignissen unterscheiden.

#### Scenario: Leser ohne jedes ausblendbare Modul
- **WHEN** ein Mitglied, dem jedes ausblendbare Modul des Einsatzes entzogen ist, den Strom geöffnet hat und der Kopf geändert wird
- **THEN** erhält es das Ereignis `einsatz`

#### Scenario: Leser ohne Stab-Recht bei einer Besprechung ohne neuen Termin
- **WHEN** ein Mitglied ohne Stab-Recht den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es weder `stab` noch `einsatz`

#### Scenario: Org-Ereignis auf dem Einsatz-Strom
- **WHEN** ein Mitglied den Strom eines Einsatzes geöffnet hat und der System-Admin seiner Organisation ein Fahrzeug im Katalog ändert
- **THEN** erhält es auf demselben Strom das Ereignis `stammdaten`, unabhängig von seinen Modulfreigaben
