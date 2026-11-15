## MODIFIED Requirements

### Requirement: Unlesbare Eingabe wird nicht übernommen
Eine Eingabe, die sich nicht eindeutig als Zeitpunkt lesen lässt, SHALL nicht übernommen und
nicht still korrigiert werden. Das Feld MUST den Grund in wenigen Wörtern sichtbar nennen, und
Enter MUST dann nicht absenden. Verlässt die Person das Feld, MUST es wieder den geltenden Wert
zeigen und den Grund weiter nennen, bis erneut getippt, eine Zeit gewählt, der Wert von außen
geändert oder im Feld Enter bzw. Escape gedrückt wird; Enter und Escape behalten dabei den
gezeigten Wert, und Escape gilt dann dem Feld.

#### Scenario: Uhrzeit gibt es nicht
- **WHEN** „2460“ eingegeben und Enter gedrückt wird
- **THEN** sendet das Formular nicht ab, und das Feld nennt „Uhrzeit gibt es nicht“

#### Scenario: Verlassen mit unlesbarer Eingabe
- **WHEN** ein Feld 161430okt26 zeigt, „14:3x“ getippt und danach „Speichern“ geklickt wird
- **THEN** zeigt das Feld wieder 161430okt26, nennt den Grund, und gesendet wird der unveränderte Wert

#### Scenario: Enter oder Escape nimmt den Grund zurück
- **WHEN** ein Feld nach einer verworfenen Eingabe 161430okt26 und den Grund zeigt und im Feld
  Enter oder Escape gedrückt wird
- **THEN** nennt das Feld keinen Grund mehr und hält weiter 161430okt26

#### Scenario: Zukunftstag in einem Feld ohne Zukunftstage
- **WHEN** ein Feld keine Zukunftstage erlaubt und ein Tag nach heute (Kalender der Anzeigezone) eingegeben wird
- **THEN** wird die Eingabe nicht übernommen, und das Feld nennt „liegt in der Zukunft“
