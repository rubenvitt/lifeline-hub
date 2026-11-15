## MODIFIED Requirements

### Requirement: Rechte je Quelle und Hinweis bei Sperre
Jede Quelle SHALL ihre Freigabe selbst prüfen, bevor sie Daten lädt. Ist keine Quelle eines
Abschnitts für die Person freigegeben, MUST der Knopf fehlen und an seiner Stelle ein Hinweis mit
dem Grund stehen. Solange die Freigaben nicht ermittelt sind, MUST weder Knopf noch Hinweis
stehen; ist die Freigabe nicht ermittelbar, MUST ein Hinweis das sagen. Ist nur ein Teil der
Quellen frei, MUST der Knopf stehen; der gesperrte Teil MUST im übernommenen Text mit „—“ und
Grund erscheinen, nie mit 0. Dasselbe gilt für eine Quelle, die beim Klick nicht geladen werden
kann.

#### Scenario: Alle Quellen gesperrt
- **WHEN** für die Person weder Kräfteübersicht noch Führungsorganisation freigegeben sind
- **THEN** zeigt der Abschnitt „Eigene Lage“ keinen Übernahme-Knopf, sondern einen Hinweis, der
  die fehlenden Freigaben nennt

#### Scenario: Teil gesperrt
- **WHEN** das Personal für die Person nicht freigegeben ist, Abschnitte und Einheiten aber schon
- **THEN** steht der Knopf, und der übernommene Text führt die Kräfteübersicht als „—“ mit Grund
  und die Führungsorganisation vollständig

#### Scenario: Quelle scheitert beim Klick
- **WHEN** die Abschnitte beim Klick nicht geladen werden können
- **THEN** steht für die betroffenen Teile „—“ mit Grund im Text, und der Abschnitt bleibt
  bearbeitbar

### Requirement: Eigene Lage aus Meldebild und Führungsorganisation
Der Abschnitt „Eigene Lage“ des Lagevortrags zur Information SHALL die Kräfteübersicht und die
Führungsorganisation des ganzen Einsatzes übernehmen können, in dieser Reihenfolge. Jeder Teil
MUST denselben Text tragen wie die Fassung, die „In Lagebericht übernehmen“ in der Kräfteübersicht (ohne
Filter) bzw. im Organigramm erzeugt, mit derselben Zahl an jeder Stelle. Jeder Teil MUST seinen
Stand (DTG) im Text tragen; der Stand ist der älteste Abruf der Listen, aus denen der Teil
gerechnet wurde. Die Übernahme MUST keine zweite Verdichtung rechnen.

#### Scenario: Gleicher Text wie die Einzelübernahme
- **WHEN** die Person „Eigene Lage“ übernimmt und im selben Datenstand die Kräfteübersicht und das
  Organigramm in einen Lagebericht übernimmt
- **THEN** stimmen die beiden Teile in „Eigene Lage“ wörtlich mit den Texten der beiden neuen
  Freitext-Berichte überein, bis auf den Stand

#### Scenario: Stand im Text
- **WHEN** die Person „Eigene Lage“ übernimmt
- **THEN** nennt jeder Teil eine Zeile „Stand:“ mit einer taktischen DTG


#### Scenario: Überschrift des Kräfteteils
- **WHEN** die Person „Eigene Lage“ übernimmt
- **THEN** ist der Kräfteteil mit „Kräfteübersicht“ überschrieben, nicht mit „Kräftemeldebild“
