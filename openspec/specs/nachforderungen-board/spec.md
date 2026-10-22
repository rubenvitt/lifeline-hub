# nachforderungen-board Specification

## Purpose
Die Nachforderungen eines Einsatzes stehen als Board nach ihrer Stufe: Angefordert, Zugesagt,
Unterwegs, Eingetroffen, Abgelehnt und Zurückgezogen. Wer Kräfte und Mittel nachfordert, sieht auf einen Blick,
was noch aussteht, und schaltet eine Nachforderung mit einem Knopf eine Stufe weiter. Zahlen kommen
aus dem Modulzähler des Servers, damit Modulmenü, Seitenkopf, Führungsüberblick, Stab-Seite und
Vorbereitung der Lagebesprechung dieselbe Zahl zeigen.

## Requirements

### Requirement: Board nach Stufe als einzige Ansicht
Die Seite Nachforderungen SHALL ihre Nachforderungen als Board nach Stufe zeigen, ab der Breite
`md` in Spalten nebeneinander: Angefordert, Zugesagt, Unterwegs, Eingetroffen. Es gibt keinen
Schalter zwischen Liste und Board.
- Jede Spalte MUST im Kopf ihr Wort und die Zahl ihrer Karten tragen. Eine leere Spalte MUST
  stehen bleiben und „keine“ zeigen.
- In den offenen Spalten MUST die Folge nach Priorität gehen, dann die am längsten wartende zuerst.
  In Eingetroffen, Abgelehnt und Zurückgezogen MUST der jüngste Abschluss zuerst stehen.
- „Eingetroffen“ MUST die in den letzten 12 h eingetroffenen zeigen und das im Kopf nennen
  („letzte 12 h“). Ältere MUST unter „Ältere eingetroffen (n)“ gesammelt stehen und aufklappen.
  Eine eingetroffene ohne Zeitpunkt MUST vorn stehen.
- „Abgelehnt“ und „Zurückgezogen“ MUST eingeklappt untereinander in einer schmalen Spalte daneben
  stehen, je mit Wort und Zahl, und aufklappen. Eine zurückgezogene Karte MUST ihr Etikett im neutralen Ton
  tragen, ohne den Alarmrand einer abgelehnten.
- Eine Karte MUST ihre Stufe nicht wiederholen, die der Spaltenkopf schon nennt.

#### Scenario: Drei offene in drei Stufen
- **WHEN** je eine Nachforderung angefordert, zugesagt und unterwegs ist
- **THEN** steht jede in der Spalte ihrer Stufe, jeder Kopf zeigt „1“, und „Eingetroffen“ zeigt
  „keine“

#### Scenario: Gestern eingetroffen
- **WHEN** eine Nachforderung vor 14 h eingetroffen ist
- **THEN** fehlt sie in der Spalte „Eingetroffen“, und „Ältere eingetroffen (1)“ zeigt sie nach dem
  Aufklappen

#### Scenario: Abgelehnte
- **WHEN** zwei Nachforderungen abgelehnt sind
- **THEN** steht „Abgelehnt 2“ eingeklappt neben den Spalten, und erst das Aufklappen zeigt die
  Karten

#### Scenario: Zurückgezogene
- **WHEN** eine Nachforderung mit dem Grund „nicht mehr benötigt“ zurückgezogen ist
- **THEN** steht „Zurückgezogen 1“ eingeklappt unter „Abgelehnt“, und aufgeklappt trägt die Karte
  „Zurückgezogen (…): nicht mehr benötigt“

### Requirement: Segmentleiste unter md
Unter der Breite `md` SHALL das Board eine Segmentleiste der sechs Stufen mit der Zahl je Stufe
zeigen und darunter nur die Karten der gewählten Stufe. Ohne Wahl MUST die erste offene Stufe mit
Karten gewählt sein, sonst „Angefordert“; die Vorgabe MUST beim ersten Datenstand feststehen und
MUST NOT mitspringen, wenn die letzte Karte ihrer Stufe weiterwandert.

#### Scenario: Handy
- **WHEN** eine Person bei 390 px Breite die Nachforderungen öffnet und eine Nachforderung zugesagt,
  eine unterwegs ist
- **THEN** zeigt die Leiste „Angefordert 0 · Zugesagt 1 · Unterwegs 1 · Eingetroffen 0 ·
  Abgelehnt 0 · Zurückgezogen 0“, gewählt ist „Zugesagt“, und nur deren Karte steht darunter

### Requirement: Fortschalten per Knopf mit Rückweg
Eine offene Nachforderung SHALL sich mit einem Knopf an ihrer Karte um eine Stufe weiterschalten
lassen; der Knopf nennt die Handlung („Zusage erfassen“, „Abfahrt melden“, „Eintreffen melden“).
„Zusage erfassen“ MUST das Formular der Zusage an der Karte öffnen (Spec `nachforderung-zusage`);
sein Absenden ist die Fortschaltung. Bearbeiten, Zurückziehen und Ablehnen MUST im ⋮-Menü der
Karte stehen, Zurückziehen und Ablehnen rot hinter dem Trenner.
Das Board MUST NOT Ziehen als Weg der Fortschaltung verlangen. Nach dem Klick MUST ein Rückgängig
die Fortschaltung um genau diese Stufe zurücknehmen. Nach der eigenen Fortschaltung MUST die Karte
in die Spalte ihrer neuen Stufe wandern, ohne dass die übrigen Karten springen, und der Fokus MUST
der Karte folgen. Scheitert die Fortschaltung, MUST der Grund an der Karte stehen; steht die Karte
dann nicht im Bild, im Seitenhinweis.

#### Scenario: Zusage erfassen
- **WHEN** die Person an einer angeforderten Nachforderung „Zusage erfassen“ wählt und im Formular
  mit Enter absendet
- **THEN** steht die Karte in „Zugesagt“, der Fokus liegt auf ihr, und „Rückgängig“ setzt sie auf
  „Angefordert“ zurück

#### Scenario: Abfahrt melden
- **WHEN** die Person an einer zugesagten Nachforderung „Abfahrt melden“ wählt
- **THEN** steht die Karte in „Unterwegs“, und „Rückgängig“ setzt sie auf „Zugesagt“ zurück

#### Scenario: Schon weiter
- **WHEN** die Fortschaltung scheitert, weil ein anderer Arbeitsplatz das Eintreffen schon gemeldet
  hat
- **THEN** steht der Grund an der Karte, und die Karte nennt ihre neue Stufe

### Requirement: Das Board hält still
Solange der Zeiger oder der Fokus im Board ist, ein Dialog der Seite oder ein Formular an einer
Karte offen ist, SHALL das Board
Menge, Spalte und Folge seiner Karten halten (Spec `datensicht-zufluss`). Was ein anderer
Arbeitsplatz ändert, MUST ein Sammelbanner nennen („1 neue Nachforderung · 1 in anderer Stufe“),
und „anzeigen“ MUST den neuen Stand zeigen. Eine gehaltene Karte, die inzwischen weiter ist, MUST
ihre neue Stufe an sich tragen.

#### Scenario: Fremde Fortschaltung
- **WHEN** eine Person den Fokus auf einer Karte hat und ein anderer Arbeitsplatz eine andere
  Nachforderung als unterwegs meldet
- **THEN** bleibt diese in ihrer Spalte, der Sammelbanner nennt „1 in anderer Stufe“, und
  „anzeigen“ trägt sie nach „Unterwegs“

### Requirement: Zeitpunkte an der Karte
Die Karte SHALL die Zeitpunkte ihrer Stufen zeigen, die vorhanden sind: angefordert mit Person,
benötigt bis (Bedarfszeit, Spec `nachforderung-erfassung`), zugesagt, das erwartete Eintreffen
einer laufenden Zusage (Spec `nachforderung-zusage`), unterwegs, eingetroffen, dazu das Alter seit
der Anforderung. Fehlt ein Zeitpunkt, MUST die Zeile fehlen, nicht erfunden werden.

#### Scenario: Unterwegs
- **WHEN** eine Nachforderung um 09:00 angefordert, um 09:10 zugesagt und um 09:20 als unterwegs
  gemeldet wurde
- **THEN** trägt die Karte „Angefordert: …“, „Zugesagt: …“ und „Unterwegs: …“, aber keine Zeile
  „Eingetroffen“

#### Scenario: Mit Bedarfszeit
- **WHEN** eine Nachforderung um 09:00 angefordert wurde und bis 13:30 benötigt wird
- **THEN** steht nach „Angefordert: …“ die Zeile „Benötigt bis: …“

### Requirement: Zahlen aus dem Modulzähler
Der Seitenkopf SHALL „n offen · m unterwegs“ aus dem Modulzähler `nachforderungen` zeigen. Fehlt
der Zähler oder lädt er, MUST der Kopf keine Zahl zeigen. Die Spaltenköpfe MUST die Karten zählen,
die das Board zeigt, nach derselben Regel wie der Server (offen = angefordert + zugesagt +
unterwegs); ein gemeinsames Fixture MUST beide Seiten gleich halten.

#### Scenario: Kopfzeile
- **WHEN** der Modulzähler `{ offen: 5, angefordert: 1, zugesagt: 2, unterwegs: 2 }` liefert
- **THEN** lautet der Kopf „5 offen · 2 unterwegs“

### Requirement: Paneel „Nachforderungen“ im Führungsüberblick
Der Führungsüberblick SHALL ein Paneel „Nachforderungen“ tragen: die offenen je Stufe aus dem
Modulzähler, darunter die zwei am längsten wartenden offenen mit ihrem Alter und einem Sprung auf
ihre Karte, und einen Sprung ins Modul. Ohne offene MUST es „Keine offenen Nachforderungen.“
zeigen, mit Schreibrecht mit „Nachforderung anlegen“. Ist das Modul nicht frei, MUST es „Modul
nicht freigegeben.“ zeigen, ohne Sprung und ohne Abruf der Liste.

#### Scenario: Überblick
- **WHEN** drei Nachforderungen offen sind, die älteste seit 95 min unterwegs
- **THEN** zeigt das Paneel „Angefordert“, „Zugesagt“ und „Unterwegs“ mit ihrer Zahl, und die
  erste Zeile nennt „vor 1 h 35 min“ und führt auf die Karte dieser Nachforderung
