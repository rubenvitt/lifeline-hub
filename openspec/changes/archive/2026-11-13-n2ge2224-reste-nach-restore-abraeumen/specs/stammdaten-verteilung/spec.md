# Spec Delta

## ADDED Requirements

### Requirement: Zeilen, die die Quelle nicht mehr führt, werden abgeräumt

Führt die erreichte Seite eine Zeile nicht mehr, die die meldende Seite aus dieser Zuordnung
übernommen hat, etwa nach dem Zurückspielen einer Sicherung, SHALL die meldende Seite sie ohne
Eingriff wie eine gelieferte Löschung behandeln. Das MUST unabhängig davon gelten, wie die erreichte
Seite zurückgespielt wurde und wann sich die meldende Seite danach meldet. Die meldende Seite MUST
dazu einen Hinweis an der Org-Zuordnung zeigen.

#### Scenario: Verlorenes Fahrzeug
- **WHEN** der Hub ein neues Fahrzeug an den ELW geliefert hat, danach aus einer Sicherung von vorher zurückgespielt wird und der ELW sich meldet
- **THEN** ist das Fahrzeug am ELW nach den nächsten Meldungen gelöscht, und die Seite „Instanzkopplung“ am ELW zeigt an der Org-Zuordnung einen Hinweis darauf

#### Scenario: Verlorene Zeile mit Einsatzdaten
- **WHEN** der Hub das Material „Decke“ mit der Sicherung verliert, das am ELW ein Einsatz nutzt
- **THEN** setzt der ELW die Decke außer Dienst, statt sie zu löschen, und sie gehört danach dem ELW

#### Scenario: Verlorenes Konto
- **WHEN** der Hub ein Konto mit der Sicherung verliert, das er an den ELW geliefert hatte
- **THEN** ist das Konto am ELW nach den nächsten Meldungen deaktiviert, und seine Sitzungen am ELW sind beendet

#### Scenario: Hub ändert vor der ersten Meldung
- **WHEN** der Hub zurückgespielt wird, ein Admin dort ein Fahrzeug anlegt, bevor sich der ELW meldet, und der ELW sich danach meldet
- **THEN** sind am ELW nach den nächsten Meldungen die Zeilen abgeräumt, die der Hub mit der Sicherung verlor und deren Kennung er nicht neu vergeben hat, und keine Zeile, die der ELW schon hatte und der Hub weiter führt, ist abgeräumt

#### Scenario: Gegenstelle älteren Stands
- **WHEN** eine der beiden Seiten einen älteren Stand hat, der diesen Abgleich nicht kennt
- **THEN** räumt der ELW nichts ab, und die Nachlieferung läuft wie bisher

### Requirement: Der Abgleich des Bestands belastet die Meldung nur bei Abweichung

Die meldende Seite SHALL je Org eine Prüfsumme der übernommenen Zeilen dieser Zuordnung melden.
Die erreichte Seite MUST die Liste ihres Bestands nur schicken, wenn die Prüfsumme von ihrem
Bestand abweicht und die meldende Seite alle Änderungen schon hat. Bleibt dieselbe Abweichung
bestehen, MUST die Liste höchstens alle 10 Minuten gehen. Passt die Liste nicht in die Antwort,
MUST sie ausbleiben.

#### Scenario: Gleicher Bestand
- **WHEN** der ELW alle Zeilen des Hubs hat und sich meldet
- **THEN** trägt die Antwort keine Liste des Bestands

#### Scenario: Nachlieferung läuft noch
- **WHEN** der ELW frisch gekoppelt ist und die Nachlieferung über mehrere Meldungen läuft
- **THEN** trägt keine dieser Antworten eine Liste des Bestands, und der ELW räumt keine Zeile ab

#### Scenario: Bleibende Abweichung
- **WHEN** der ELW eine gelieferte Zeile nicht übernehmen konnte und sich jede Minute meldet
- **THEN** trägt höchstens eine Antwort je 10 Minuten die Liste des Bestands
