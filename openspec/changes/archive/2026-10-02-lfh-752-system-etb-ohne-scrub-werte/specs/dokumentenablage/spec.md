# Spec Delta

## MODIFIED Requirements

### Requirement: Eine wirksame Änderung ist im ETB nachgewiesen
Ändert eine Anfrage mindestens eine Angabe, SHALL das System in derselben Transaktion einen
System-ETB-Eintrag schreiben, der mit „Dokument geändert:“ beginnt, das Dokument über die
laufende Nummer des ETB-Eintrags seiner Ablage bezeichnet, die neue Kategorie nennt und jede
geänderte Angabe aufführt. Kategorie und Bezug SHALL mit altem und neuem Wert erscheinen. Eine
Titeländerung SHALL nur als „Titel geändert“ erscheinen, ohne alten und neuen Titel, weil der
Titel bei der Schwärzung entfällt. Es SHALL denselben Live-Hinweis auslösen wie das Ablegen.
Eine Anfrage, deren Werte dem Stand entsprechen, SHALL mit 200 antworten, ohne ETB-Eintrag und
ohne Live-Hinweis.

#### Scenario: Titeländerung im ETB
- **WHEN** ein Schreibberechtigter den Titel eines Befehls von „Befehl 1“ auf „Befehl 1 – Nachtrag“
  ändert
- **THEN** steht im ETB genau ein neuer System-Eintrag, der mit „Dokument geändert:“ beginnt,
  die laufende Nummer des Ablage-Eintrags und „Titel geändert“ nennt
- **AND** nennt dieser Eintrag weder „Befehl 1“ noch „Befehl 1 – Nachtrag“

#### Scenario: Kategorieänderung im ETB
- **WHEN** ein Schreibberechtigter die Kategorie eines Dokuments von „Sonstiges“ auf „Lagekarte/Plan“ ändert
- **THEN** nennt der neue System-Eintrag „Kategorie: Sonstiges → Lagekarte/Plan“

#### Scenario: Unveränderte Werte
- **WHEN** eine Änderung Titel, Kategorie und Bezug mit den Werten nennt, die das Dokument schon
  trägt
- **THEN** antwortet das System mit 200 und das ETB erhält keinen neuen Eintrag
