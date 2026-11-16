# Spec Delta

## MODIFIED Requirements

### Requirement: Der Einsatzname hat Vorrang in der Kopfleiste

Der Einsatzname in der Kopfleiste des Einsatzes SHALL in der Schriftstufe `titel` stehen (16 px
in `kompakt`, mit der Dichte wachsend nach der Spec `schriftskala`: 18,4 px in `komfortabel`,
20 px in `handschuh`), in jeder Breite. Reicht die Breite der Kopfzeile nicht für Name und
Suchfeld, MUST zuerst das Suchfeld schmaler werden, bis nur das Suchsymbol bleibt; erst danach
MUST der Name mit „…“ kürzen. Ein gekürzter Name MUST ganz im Titel des Wechslers stehen.

#### Scenario: Arbeitsplatz 1280 px
- **WHEN** der Überblick des Demo-Einsatzes „ÜBUNG – Starkregen Musterstadt“ bei 1280 × 800 in `kompakt` geöffnet ist und alle Anzeigen im Ruhezustand stehen
- **THEN** steht der Einsatzname ungekürzt in 16 px Schrift in der Kopfzeile

#### Scenario: Handschuh-Betrieb 1180 px
- **WHEN** derselbe Einsatz bei 1180 × 820 in `handschuh` geöffnet ist und alle Anzeigen im Ruhezustand stehen
- **THEN** steht der Einsatzname ungekürzt in 20 px Schrift in der Kopfzeile

#### Scenario: Zu schmal für Name und Suchtext
- **WHEN** die Kopfzeile ab `lg` nicht breit genug ist für den ganzen Namen und den Hinweistext im Suchfeld
- **THEN** kürzt zuerst der Hinweistext des Suchfelds, und der Name kürzt erst, wenn vom Suchfeld nur das Suchsymbol bleibt
