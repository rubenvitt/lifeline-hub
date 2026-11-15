## ADDED Requirements

### Requirement: Abmelden aus der Palette fragt zurück

Der Befehl „Abmelden“ der Sprungpalette SHALL die Palette schließen und dieselbe Rückfrage öffnen
wie „Abmelden“ im Benutzermenü. Erst ihre Bestätigung MUST die Sitzung beenden; „Abbrechen“ MUST
die Person angemeldet und auf derselben Seite lassen. Der Befehl MUST NOT ins Befehlsgedächtnis.

#### Scenario: Abmelden per Enter
- **WHEN** in der Palette „Abmelden“ markiert ist und ↵ gedrückt wird
- **THEN** schließt sich die Palette, und die Rückfrage „Abmelden“ öffnet sich, ohne dass die Sitzung endet

#### Scenario: Rückfrage bestätigt
- **WHEN** die aus der Palette geöffnete Rückfrage mit „Abmelden“ bestätigt wird
- **THEN** endet die Sitzung, und die App zeigt die Anmeldung

#### Scenario: Rückfrage abgebrochen
- **WHEN** die aus der Palette geöffnete Rückfrage mit „Abbrechen“ geschlossen wird
- **THEN** bleibt die Person angemeldet und auf derselben Seite
