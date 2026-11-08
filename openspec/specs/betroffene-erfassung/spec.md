# betroffene-erfassung Specification

## Purpose
Wie Betroffene und Tiere erfasst werden: eine allgemeine Maske je Liste neben „Vermisst melden“,
derselbe Statusname in Maske, Filter und Tabelle, und ein Feldbudget, das die Erfassung am Handy
kurz hält (LFH-963).

## Requirements

### Requirement: Eine allgemeine Maske für Betroffene

Die Betroffenenliste MUST genau eine allgemeine Erfassungsmaske anbieten, dazu „Vermisst melden“.
Der Knopf im Seitenkopf und der Einstieg der Sprungpalette (`?neu=1`) MUST dieselbe Maske öffnen.
Eine über diese Maske erfasste Person MUST den Status „erfasst“ erhalten, unabhängig davon, über
welchen Einstieg die Maske geöffnet wurde; mit einer Sichtung hebt der Server sie wie bisher auf
„betroffen“. Die Maske MUST den Status, den die Person erhält, sichtbar nennen, samt dem Hinweis,
dass eine Sichtung sie zu „betroffen“ macht. „Vermisst melden“ bleibt ein eigener Weg mit dem
Status „vermisst“.

#### Scenario: Beide Einstiege, eine Maske
- **WHEN** die Maske einmal über den Kopfknopf und einmal über `?neu=1` geöffnet wird
- **THEN** tragen beide denselben Titel und dieselben Felder, und eine ohne Sichtung erfasste Person wird mit Status „erfasst“ angelegt

#### Scenario: Folgestatus sichtbar
- **WHEN** die allgemeine Maske geöffnet ist
- **THEN** steht im Dialog sichtbar, dass die Person als „erfasst“ angelegt wird und mit Sichtung als „betroffen“ gilt

#### Scenario: Kein zweiter allgemeiner Weg
- **WHEN** ein Benutzer mit Schreibrecht die Betroffenenliste öffnet
- **THEN** gibt es im Seitenkopf genau einen Knopf, der die allgemeine Maske öffnet, und keinen Knopf „Schnellerfassung“ oder „Betroffene/n erfassen“

### Requirement: Statusfilter und Tabelle nennen den Status gleich

Der Statusfilter der Betroffenenliste MUST jeden Personenstatus mit demselben Wort nennen wie die
Statusspalte der Tabelle. Der Status `erfasst` heißt im Filter „Erfasst“, nicht „Neu“.

#### Scenario: Filter „Erfasst“
- **WHEN** der Statusfilter der Betroffenenliste angezeigt wird
- **THEN** heißt das Segment für den Status `erfasst` „Erfasst“, und kein Segment heißt „Neu“

### Requirement: Tiere-Erfassung hält das Feldbudget

Die Erfassung eines Tieres auf der Tiere-Liste MUST in beiden Modi (Erfassen und „Vermisst
melden“) höchstens vier Eingabefelder sichtbar zeigen. Alle weiteren Felder MUST unter einem
aufklappbaren Bereich „Weitere Angaben“ stehen, der beim Aufklappen mehr Felder sichtbar macht.
Ein Pflichtfeld MUST nie hinter dem aufklappbaren Bereich stehen.

#### Scenario: Erfassen
- **WHEN** die Tiere-Erfassung geöffnet ist
- **THEN** sind höchstens vier Eingabefelder sichtbar, darunter Spezies und Fundort, und nach dem Aufklappen von „Weitere Angaben“ sind es mehr

#### Scenario: Vermisst melden
- **WHEN** „Vermisst melden“ auf der Tiere-Liste geöffnet ist
- **THEN** sind höchstens vier Eingabefelder sichtbar, und Farbe, Kennzeichnung und Halter-Kontakt erscheinen erst nach dem Aufklappen von „Weitere Angaben“

### Requirement: Versorgende Einheit in der Maske

Die Maske „Betroffene erfassen“ SHALL unter „Weitere Angaben“ das Feld „Versorgende Einheit“
führen (aktive Einheiten des Einsatzes mit Abschnitt), damit das Budget von vier sichtbaren
Feldern bleibt. Ohne Wahl MUST der POST kein `versorgende_einheit_id` tragen. Am gekoppelten Gerät
MUST das Feld fehlen. Der Server MUST eine Einheit eines anderen Einsatzes oder eine aufgelöste
mit 422 ablehnen. Eine Einheit mit einem nicht stornierten Patienten MUST beim Auflösen als
aufgelöst stehen bleiben („Die Einheit hat Patienten versorgt“).

#### Scenario: Einheit beim Erfassen
- **WHEN** in der Maske unter „Weitere Angaben“ „RTW 1“ gewählt und „Erfassen“ gewählt wird
- **THEN** trägt der POST `versorgende_einheit_id` von „RTW 1“

### Requirement: Patient aus einer Meldung anlegen

Die Meldungskarte SHALL mit Schreibrecht im ⋮-Menü „Patient anlegen“ anbieten; ohne Freigabe des
Moduls Betroffene MUST der Eintrag gesperrt mit Grund stehen. Er MUST dieselbe Maske „Betroffene
erfassen“ auf der Meldungsseite öffnen, mit der Zeile „Zu Meldung #n“, der Verortung der Meldung
als Fundort-Koordinate (falls verortet) und der Absender-Einheit als versorgender Einheit (falls
strukturiert und nicht aufgelöst); dann steht „Weitere Angaben“ offen. Jede so erfasste Person
MUST `meldung_id` tragen, im Serienlauf auch die folgenden. Eine Meldung MAY mehrere Patienten
haben, eine Person höchstens eine Meldung. Die Karte MUST je nicht stornierten Patienten einen
Verweis mit der Registriernummer („↗ R-012“) auf die Personen-Detailseite zeigen, ohne Zugriff
auf die Betroffenen nur die Nummer. Eine Anlage mit Meldungsbezug MUST zusätzlich das Live-Ereignis
der Meldungen auslösen.

#### Scenario: Patient aus verorteter Meldung einer Streife
- **WHEN** an Meldung #17 der „Streife 2“ mit Verortung „Patient anlegen“ gewählt und „Erfassen“
  gewählt wird
- **THEN** trägt der POST `meldung_id` 17, die Koordinate der Meldung und die Einheit „Streife 2“,
  und die Karte zeigt danach „↗ R-…“ der neuen Person

#### Scenario: Meldung eines anderen Einsatzes
- **WHEN** ein POST eine `meldung_id` eines anderen Einsatzes trägt
- **THEN** antwortet der Server mit 422

### Requirement: Kontakte je Einheit

Die Seitenleiste der Betroffenen SHALL einen Block „Versorgt von“ zeigen, sobald mindestens eine
Person eine versorgende Einheit hat: je Einheit (mit Abschnitt) die Zahl ihrer Patienten, ohne
Stornierte, mit Abgeschlossenen, absteigend nach Zahl. Die Zählung MUST eine reine Funktion
(`kontakteJeEinheit`) sein, die Lagebild und Bericht mitnutzen.

#### Scenario: Zwei Patienten einer Streife
- **WHEN** zwei Personen „Streife 2“ als Einheit tragen, eine davon abgeschlossen
- **THEN** zeigt „Versorgt von“ „Streife 2 · Bühne“ mit 2

### Requirement: Leichter Fall in einem Schritt

Die Betroffenenliste und das UHS-Gerät SHALL mit Schreibrecht den Dialog „Versorgt und entlassen“
anbieten (Liste: im Kopf neben „Vermisst melden“; Gerät: neben „Patient aufnehmen“); die
Kurzeingabe SHALL dasselbe mit `+Kürzel` für Maßnahmen und `>entl` können. Der Dialog MUST den
Anlass verlangen, bis zu drei Maßnahmen als Flächen und Name und Alter optional anbieten. In der
Liste MUST „Versorgt von“ (aktive UHS und Einheiten) den Fundort vorbelegen (UHS: Bezeichnung und
Koordinate; Einheit: Abschnitt, sonst Name) und für den nächsten Fall stehen bleiben; am Gerät
MUST die eigene UHS feststehen.

Der Server MUST eine Anlage mit `massnahmen` und `entlassen: true` in EINER Transaktion schreiben:
Person mit Registriernummer und Status `betroffen`, ohne Sichtung, die Maßnahmen und den Verbleib
„Entlassung“ zur Erfassungszeit, mit `uhs_id` Eintritt und Austritt zur Erfassungszeit, und genau
einen ETB-Eintrag „Person R-… versorgt und entlassen“ (an einer UHS „Person R-…: in … versorgt und
entlassen“). Ein Replay derselben `client_id` MUST nichts doppelt schreiben. Unbekannte oder
doppelte Maßnahmen MUST 400 ergeben, `massnahmen` oder `entlassen` an einer vermissten oder
abgemeldeten Anlage 422, an der Betreuungsstelle 403; in allen Fällen MUST nichts geschrieben
werden. Ohne `entlassen` MUST eine Anlage mit `massnahmen` eine gewöhnliche Anlage bleiben.

#### Scenario: Pflaster an der Bühne
- **WHEN** jemand in der Liste „Versorgt und entlassen“ wählt, „Allergie / Insektenstich“ antippt
  und „Entlassen“ wählt
- **THEN** steht die Person mit Registriernummer, Status „betroffen“, ohne Sichtung und mit dem
  Verbleib „entlassen“ in der Liste, und das Einsatztagebuch hat einen Eintrag für sie

#### Scenario: Leichter Fall am UHS-Tablet ohne Netz
- **WHEN** das UHS-Tablet ohne Netz einen leichten Fall entlässt und das Netz zurückkehrt
- **THEN** geht genau ein POST mit Erfassungszeit hinaus, Eintritt und Austritt tragen diese Zeit
