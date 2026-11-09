# Spec Delta

## MODIFIED Requirements

### Requirement: Weitere Abschnitte des Lagevortrags zur Information
Im Lagevortrag zur Information SHALL je eine Übernahme in den Abschnitten „Besondere
(Führungs-)Probleme“, „Gefahren-/Schadenlage“ und „Lageentwicklung“ stehen. Die Abschnitte
„Auftrag“, „Anträge und Vorschläge“, „Zusammenfassung“ und „Medienlage“ MUST ohne Übernahme
bleiben; die Medienlage ist Freitext.

#### Scenario: Knopf in der Gefahren-/Schadenlage
- **WHEN** eine Person mit Schreibrecht einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** steht im Abschnitt „Gefahren-/Schadenlage“ ein Übernahme-Knopf mit einem Nebentext,
  der die Herkunft nennt

#### Scenario: Kein Knopf im Auftrag
- **WHEN** eine Person einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** zeigt der Abschnitt „Auftrag“ keinen Übernahme-Knopf

#### Scenario: Medienlage als Freitext
- **WHEN** eine Person mit Schreibrecht einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** zeigt der Abschnitt „Medienlage“ ein Textfeld ohne Übernahme-Knopf und ohne Hinweis auf eine Quelle

### Requirement: Neuer Lagevortrag startet mit dem Lagebild
„Neuer Lagevortrag“ SHALL den Lagevortrag zur Information mit allen Abschnitten anlegen, denen
eine Quelle zugeordnet ist, als Startinhalt in genau einer anlegenden Anfrage. Die Daten der
Quellen MUST erst mit diesem Klick geladen werden. Jeder Text MUST derselbe sein, den die
Übernahme im Abschnitt aus demselben Datenstand erzeugt. Lehnt der Server das Anlegen ab, MUST
kein Entwurf entstehen und MUST der Grund an der Seite stehen.

#### Scenario: Anlegen mit Startinhalt
- **WHEN** eine Person mit Schreibrecht „Neuer Lagevortrag“ wählt
- **THEN** sendet der Client genau eine anlegende Anfrage mit Texten für Gefahren-/Schadenlage,
  Eigene Lage, Lageentwicklung und Besondere (Führungs-)Probleme, die Medienlage bleibt leer, und
  der Entwurf öffnet sich

#### Scenario: Anlegen abgelehnt
- **WHEN** der Server das Anlegen mit 400 ablehnt
- **THEN** steht der Grund an der Seite, es folgt keine weitere Anfrage, und kein Entwurf öffnet
  sich

### Requirement: Ausfall im Startinhalt
Ist eine Quelle für die Person nicht freigegeben, MUST ihr Abschnitt im Startinhalt „—“ mit dem
Grund tragen, und die Daten dieser Quelle MUST NOT angefragt werden. Dasselbe MUST gelten, wenn
die Freigaben nicht ermittelbar sind oder eine Quelle ihren Text nicht erzeugen kann. Kein
Abschnitt mit Quelle MUST leer bleiben oder für Fehlendes eine 0 tragen.

#### Scenario: Gesperrte Quelle
- **WHEN** das ETB für die Person nicht freigegeben ist und sie „Neuer Lagevortrag“ wählt
- **THEN** trägt die Lageentwicklung „— (ETB nicht freigegeben)“ ohne Zahl, und keine Liste des
  ETB wurde angefragt

#### Scenario: Freigaben nicht ermittelbar
- **WHEN** die Modulfreigaben beim Klick nicht geladen werden können
- **THEN** trägt jeder Abschnitt mit Quelle „— (Freigaben nicht ermittelbar)“
