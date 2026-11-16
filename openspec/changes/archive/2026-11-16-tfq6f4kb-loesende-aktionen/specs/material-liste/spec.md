# Spec Delta

## MODIFIED Requirements

### Requirement: Zeilenaktionen der Materialliste

Jede Zeile der Materialliste SHALL für schreibberechtigte Personen ihre Handlungen in einem
Zeilenmenü bündeln, dessen Name den Posten nennt; sein erster Eintrag MUST neutral „Aus dem
Einsatz nehmen“ sein, kein Knopf in der Zeile und keine Hauptaktion der Karte (LLH-1722). Danach
folgen bei einem Verbrauchsgut „Menge ändern …“, „Ausgabe zurücknehmen …“, „Aufteilen …“, „Als
Gerät führen“, „Angaben ändern …“ und „Stornieren“; bei einem Gerät „Als Verbrauchsgut führen“,
„Angaben ändern …“ und „Stornieren“. Die Einträge zur Art MUST nur ein Ad-hoc-Posten tragen; ein
Stamm-Posten trägt die Art seines Stammeintrags (LLH-1224). Ein Eintrag, den es für die Art gibt, der aber gerade nicht
möglich ist, MUST gesperrt mit seinem Grund im Etikett stehen. „Stornieren“ MUST rot hinter einem
Trenner stehen und vor dem Senden in einem Dialog mit dem Knopf „Stornieren“ rückfragen. Ein
Posten mit Verweis auf eine Nachforderung MUST vor dem Trenner zusätzlich „Von Nachforderung lösen“
tragen, wenn das Modul Nachforderungen bedienbar ist (LLH-1403, Spec `nachforderung-material`,
„Lösen an der Materialzeile“).

#### Scenario: Stamm-Posten im Menü
- **WHEN** die Person das Zeilenmenü eines Stamm-Postens öffnet
- **THEN** steht „Angaben ändern · im Stamm pflegen“ gesperrt darin

#### Scenario: Stornieren fragt im Dialog
- **WHEN** die Person im Zeilenmenü „Stornieren“ wählt
- **THEN** öffnet sich ein Dialog mit dem Knopf „Stornieren“, und erst dieser sendet

#### Scenario: Nichts ausgegeben
- **WHEN** die Person das Zeilenmenü eines Verbrauchsguts ohne Ausgabe öffnet
- **THEN** steht „Ausgabe zurücknehmen · nichts ausgegeben“ gesperrt darin

#### Scenario: Gerät ohne Mengeneinträge
- **WHEN** die Person das Zeilenmenü eines Geräts öffnet
- **THEN** stehen darin weder „Menge ändern …“ noch „Ausgabe zurücknehmen …“ noch „Aufteilen …“

#### Scenario: Aus dem Einsatz nehmen im Menü
- **WHEN** die Person das Zeilenmenü der Wolldecke öffnet
- **THEN** steht „Aus dem Einsatz nehmen“ als erster Eintrag, neutral, und die Zeile trägt keinen Knopf dafür

#### Scenario: Karte am Handy
- **WHEN** die Materialliste als Karten erscheint
- **THEN** trägt keine Karte einen Knopf „Aus dem Einsatz nehmen“, und ihr Menü beginnt damit
