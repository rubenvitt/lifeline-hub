# Spec Delta

## MODIFIED Requirements

### Requirement: Eine Kraft entlassen

Das Beenden einer Kraft SHALL „Entlassen“ heißen, bei Material „Aus dem Einsatz nehmen“. In einer
Liste MUST es im ⋮ stehen, in einer Detailseite im letzten Abschnitt „Aus dem Einsatz“. Es MUST
NOT Hauptaktion einer Karte sein. Es SHALL ohne Rückfrage wirken, wenn sein Rückgängig den Zustand
davor herstellt, sonst MUST es eine Rückfrage zeigen.

#### Scenario: Fahrzeugkarte am Handy
- **WHEN** die Fahrzeugliste am Handy als Karten erscheint
- **THEN** trägt keine Karte einen Knopf „Entlassen“, und „Entlassen“ steht in ihrem ⋮

#### Scenario: Person entlassen und Rückgängig
- **WHEN** jemand auf der Detailseite einer Person „Entlassen“ wählt und im Hinweis „Rückgängig“
- **THEN** wirkt das Entlassen ohne Rückfrage, und die Person steht wieder mit ihren Bindungen da; was nicht zurückkam, nennt der Seitenhinweis in Worten

#### Scenario: Material aus dem Einsatz nehmen und Rückgängig
- **WHEN** jemand einen Posten an einer Einheit über sein ⋮ aus dem Einsatz nimmt und im Hinweis „Rückgängig“ wählt
- **THEN** wirkt das Herausnehmen ohne Rückfrage, und der Posten steht wieder an seiner Einheit; einen Ort, der ihn nicht mehr aufnimmt, nennt der Seitenhinweis in Worten
