## ADDED Requirements

### Requirement: Zugriff wird in den Einsatz-Einstellungen verwaltet
Die Mitglieder eines Einsatzes, ihre Rollen und ihre Führungsstelle SHALL in den
Einsatz-Einstellungen in der Sektion „Zugriff“ unter `…/einstellungen/zugriff` stehen. Die
Rechte MUST dieselben bleiben: bedienen darf die Einsatzleitung eines laufenden Einsatzes; alle
anderen Mitglieder sehen die Liste ohne Bedienziele und lesen den Grund. Die Seite Einsatzdaten
MUST die Mitgliederliste nicht mehr zeigen.

#### Scenario: Einsatzleitung öffnet die Sektion
- **WHEN** die Einsatzleitung eines laufenden Einsatzes `…/einstellungen/zugriff` öffnet
- **THEN** zeigt die Sektion die Mitglieder samt Rolle und Führungsstelle und die Zeile zum Aufnehmen einer Person

#### Scenario: Führungspersonal öffnet die Sektion
- **WHEN** Führungspersonal desselben Einsatzes die Sektion öffnet
- **THEN** sieht es die Mitglieder, jede Rolle ist gesperrt, es gibt weder „Hinzufügen“ noch „Entfernen“, und ein Hinweis nennt, dass nur die Einsatzleitung den Zugriff verwaltet

#### Scenario: Reiter neben Module und Geräte
- **WHEN** eine Person die Einsatz-Einstellungen öffnet
- **THEN** steht der Reiter „Zugriff“ hinter „Geräte“, und die erste Sektion bleibt „Allgemein“

#### Scenario: Keine Mitgliederliste auf den Einsatzdaten
- **WHEN** eine Person die Seite Einsatzdaten öffnet
- **THEN** gibt es dort kein Paneel „Zugriff“

### Requirement: Sprung zum Zugriff von den Einsatzdaten
Die Seite Einsatzdaten SHALL der Einsatzleitung eines laufenden Einsatzes im Seitenkopf einen
Nebenweg „Zugriff verwalten“ anbieten, der die Sektion „Zugriff“ der Einsatz-Einstellungen
öffnet. Wer den Zugriff nicht verwalten darf, MUST diesen Nebenweg nicht sehen.

#### Scenario: Einsatzleitung springt
- **WHEN** die Einsatzleitung auf den Einsatzdaten „Zugriff verwalten“ wählt
- **THEN** öffnet `…/einstellungen/zugriff` mit markiertem Reiter „Zugriff“

#### Scenario: Beobachter
- **WHEN** ein Beobachter die Einsatzdaten öffnet
- **THEN** gibt es keinen Nebenweg „Zugriff verwalten“

### Requirement: Schnellaktion „Mitglied aufnehmen“
Die Sprungpalette SHALL der Einsatzleitung eines laufenden Einsatzes die Schnellaktion „Mitglied
aufnehmen“ anbieten. Sie öffnet die Sektion „Zugriff“ der Einsatz-Einstellungen mit
aufgeklappter, fokussierter Personenauswahl. Wer den Zugriff nicht verwalten darf, MUST die
Schnellaktion nicht sehen. Der Auftrag MUST nach dem Öffnen aus der Adresse verschwinden. „Person aufnehmen“ MUST NOT
auf diese Schnellaktion führen: so heißt im Lage-Überblick die Erfassung von Betroffenen.

#### Scenario: Einsatzleitung nimmt per Palette auf
- **WHEN** die Einsatzleitung eines laufenden Einsatzes in der Sprungpalette „Mitglied aufnehmen“ wählt
- **THEN** steht sie in `…/einstellungen/zugriff`, die Auswahl „Benutzer …“ hat den Fokus und ist aufgeklappt

#### Scenario: Ohne Leitungsrecht keine Zeile
- **WHEN** Führungspersonal oder ein Beobachter die Sprungpalette in einem laufenden Einsatz öffnet, oder die Einsatzleitung in einem abgeschlossenen
- **THEN** gibt es keine Zeile „Mitglied aufnehmen“

#### Scenario: Suche nach „person“
- **WHEN** die Einsatzleitung in der Sprungpalette „person“ sucht
- **THEN** steht „Person erfassen“ vor „Mitglied aufnehmen“

#### Scenario: Neuladen öffnet nicht erneut
- **WHEN** die Sektion nach der Schnellaktion geöffnet ist und die Seite neu geladen wird
- **THEN** enthält die Adresse keinen Auftrag mehr, und die Auswahl ist zugeklappt
