# einsatz-abschluss Specification

## Purpose
Regelt, wie ein Einsatz abgeschlossen und innerhalb einer kurzen Frist wieder geöffnet wird: was
vor dem Abschluss noch offen ist, wie der Abschluss bewusst bestätigt wird und welche Spur beide
Schritte im Einsatztagebuch hinterlassen.

## Requirements

### Requirement: Offene Punkte vor dem Abschluss

Vor dem Abschluss SHALL das System der Einsatzleitung eines aktiven Einsatzes die offenen Punkte
nennen, je Gruppe mit Anzahl: nicht entlassene Fahrzeuge und Einsatzkräfte, offene Aufträge,
offene Meldungen, laufende Nachforderungen, Betroffene mit offenem oder unterwegs befindlichem
Verbleib sowie vermisste Personen. Die Zählung MUST unabhängig von den Modulfreigaben der
anfragenden Person sein. Texte und Bezeichnungen einzelner Punkte MUST das System nur aus
Modulen nennen, die die Person lesen darf; für ein gesperrtes Modul nennt es nur die Anzahl.

#### Scenario: Gebundene Einheit und offener Verbleib

- **WHEN** ein aktiver Einsatz eine nicht entlassene Einheit mit Status „3 – Auf Anfahrt“ und
  eine Betroffene ohne Verbleib hat und die Einsatzleitung den Abschluss öffnet
- **THEN** nennt der Dialog unter den Kräften die Einheit mit ihrem Status und unter den
  Betroffenen eine offene Person

#### Scenario: Gesperrtes Modul nennt nur die Zahl

- **WHEN** das Modul Meldungen für eine Einsatzleitung ausgeblendet ist und der Einsatz eine
  offene Meldung hat, und sie den Abschluss öffnet
- **THEN** nennt der Dialog bei den Meldungen die Anzahl 1, aber weder den Text der Meldung noch
  einen Sprung ins Modul

#### Scenario: Nichts offen

- **WHEN** ein aktiver Einsatz keine offenen Punkte hat und die Einsatzleitung den Abschluss
  öffnet
- **THEN** steht im Dialog „Nichts offen“

#### Scenario: Prüfung ohne Leitungsrecht

- **WHEN** Führungspersonal oder ein Beobachter die offenen Punkte des Abschlusses abfragt
- **THEN** antwortet das System mit 403

### Requirement: Offene Punkte sperren den Abschluss nicht

Offene Punkte SHALL nur warnen. Der Abschluss MUST auch mit offenen Punkten möglich sein; jede
Gruppe mit offenen Punkten MUST in ihr Modul springen können, sofern es für die Person sichtbar
ist.

#### Scenario: Abschluss trotz offener Aufträge

- **WHEN** ein Einsatz zwei offene Aufträge hat und die Einsatzleitung ihn bestätigt abschließt
- **THEN** ist der Einsatz abgeschlossen

#### Scenario: Sprung ins Modul

- **WHEN** die Einsatzleitung im Dialog bei den offenen Aufträgen „alle“ wählt
- **THEN** öffnet sich die Auftragsliste des Einsatzes, und der Einsatz bleibt aktiv

### Requirement: Bewusste Bestätigung durch Eintippen

Der Knopf „Einsatz abschließen“ im Dialog SHALL erst aktiv sein, wenn die eingetippte Eingabe
der internen Einsatznummer oder der Bezeichnung des Einsatzes entspricht. Groß- und
Kleinschreibung sowie Leerraum am Anfang und Ende MUST dabei keine Rolle spielen. Der Dialog
MUST Bezeichnung und Nummer in voller Länge zeigen.

#### Scenario: Nummer eingetippt

- **WHEN** die Einsatzleitung im Dialog die interne Einsatznummer in Kleinbuchstaben eintippt
- **THEN** ist der rote Knopf „Einsatz abschließen“ aktiv

#### Scenario: Falscher Einsatz

- **WHEN** die Einsatzleitung die Bezeichnung eines anderen Einsatzes eintippt
- **THEN** bleibt der rote Knopf inaktiv, und der Einsatz bleibt aktiv

#### Scenario: Einsatz ohne Nummer

- **WHEN** ein Einsatz keine interne Einsatznummer hat und die Einsatzleitung seine Bezeichnung
  eintippt
- **THEN** ist der rote Knopf aktiv

### Requirement: Folgen des Abschlusses für gebundene Kräfte

Der Abschluss MUST Fahrzeuge und Einsatzkräfte im Einsatz unverändert lassen: sie behalten ihren
letzten Status und werden nicht entlassen. Für andere Einsätze MUST eine solche Bindung nicht
mehr gelten. Der Abschlussdialog SHALL das in einem festen Satz sagen. Der Satz MUST immer
stehen, auch solange die offenen Punkte noch laden, ohne Netz nicht geladen sind oder ihre
Abfrage gescheitert ist: er ist ein Pflichtsatz, kein Ergebnis der Prüfung.

#### Scenario: Satz ohne Antwort der Prüfung

- **WHEN** die Abfrage der offenen Punkte scheitert und die Einsatzleitung den Abschlussdialog
  offen hat
- **THEN** steht der Satz zu nicht entlassenen Kräften trotzdem im Dialog

#### Scenario: Fahrzeug nach dem Abschluss

- **WHEN** ein Einsatz mit einem nicht entlassenen Fahrzeug abgeschlossen wird
- **THEN** steht das Fahrzeug im abgeschlossenen Einsatz weiter mit seinem letzten Status
- **AND** kann es in einem anderen aktiven Einsatz disponiert werden

### Requirement: Abschluss und Wiederöffnen nur mit Verbindung

Abschluss und Wiederöffnen MUST ohne Verbindung zum Server gesperrt sein und dürfen nicht
vorgemerkt oder angehalten werden: ein Klick geht sofort hinaus oder scheitert sofort. Der
Dialog SHALL den Grund nennen. Sind die offenen Punkte ohne Netz nicht geladen, SHALL der Dialog
das sagen und ein erneutes Abrufen anbieten, statt einen Ladezustand zu zeigen. Ein offener
Dialog MUST schließen, sobald der Einsatz nicht mehr zu ihm passt (anderswo abgeschlossen oder
wieder geöffnet, Frist abgelaufen).

#### Scenario: Netz fällt bei offenem Dialog weg

- **WHEN** die Einsatzleitung die Nummer eingetippt hat und dann die Verbindung verliert
- **THEN** ist der rote Knopf gesperrt mit dem Grund „Ohne Verbindung nicht änderbar“, und auch
  nach der Rückkehr des Netzes geht kein Abschluss hinaus

#### Scenario: Anderswo abgeschlossen

- **WHEN** die Einsatzleitung den Abschlussdialog offen hat und ein anderes Mitglied der
  Einsatzleitung den Einsatz abschließt
- **THEN** schließt der Dialog, und das Paneel zeigt den Abschluss

### Requirement: Abschluss im Einsatztagebuch

Schließt der Abschluss einen Einsatz ab, SHALL er im selben atomaren Vorgang einen
System-Eintrag „Einsatz abgeschlossen“ im ETB schreiben, mit der abschließenden Person als
Erfasser. Ein Aufruf an einem schon abgeschlossenen Einsatz MUST keinen Eintrag schreiben.

#### Scenario: Abschluss schreibt einen Eintrag

- **WHEN** die Einsatzleitung einen aktiven Einsatz abschließt
- **THEN** enthält sein ETB einen System-Eintrag „Einsatz abgeschlossen“ mit ihr als Erfasser

### Requirement: Wiederöffnen innerhalb von 24 Stunden

Die Einsatzleitung und der System-Admin der Organisation des Einsatzes SHALL einen
abgeschlossenen Einsatz binnen 24 Stunden nach dem Abschluss wieder öffnen können; danach ist er
wieder aktiv und beschreibbar. Nach Ablauf der Frist MUST das System mit 422 antworten, ebenso
an einem aktiven Einsatz.

#### Scenario: Einsatzleitung öffnet nach zwei Stunden

- **WHEN** die Einsatzleitung einen vor zwei Stunden abgeschlossenen Einsatz mit Grund wieder
  öffnet
- **THEN** ist der Einsatz aktiv, und Einträge im ETB sind wieder möglich

#### Scenario: Frist abgelaufen

- **WHEN** die Einsatzleitung einen vor 25 Stunden abgeschlossenen Einsatz wieder öffnen will
- **THEN** antwortet das System mit 422, und der Einsatz bleibt abgeschlossen

#### Scenario: Zur Löschung vorgemerkt

- **WHEN** ein abgeschlossener Einsatz zur Löschung vorgemerkt ist und die Einsatzleitung ihn
  wieder öffnen will
- **THEN** antwortet das System mit 403, und der Einsatz bleibt abgeschlossen

#### Scenario: Admin der Einsatz-Organisation ohne Mitgliedschaft

- **WHEN** ein System-Admin der Organisation des Einsatzes ohne Einsatzrolle ihn binnen 24
  Stunden wieder öffnet
- **THEN** ist der Einsatz aktiv

### Requirement: Wer nicht wieder öffnen darf

Führungspersonal, Beobachter, org-weite Führungskräfte ohne Einsatzrolle, gekoppelte Geräte und
der System-Admin einer fremden Organisation MUST beim Wiederöffnen 403 erhalten.

#### Scenario: Führungspersonal

- **WHEN** Führungspersonal einen vor einer Stunde abgeschlossenen Einsatz wieder öffnen will
- **THEN** antwortet das System mit 403

#### Scenario: Admin einer fremden Organisation

- **WHEN** ein System-Admin einer anderen Organisation den Einsatz wieder öffnen will
- **THEN** antwortet das System mit 403

### Requirement: Grund des Wiederöffnens im Einsatztagebuch

Das Wiederöffnen SHALL einen nicht leeren Grund verlangen und im selben atomaren Vorgang einen
System-Eintrag im ETB schreiben, der den Grund, den ursprünglichen Abschlusszeitpunkt und die
abschließende Person nennt, mit der wieder öffnenden Person als Erfasser. Ein fehlender oder
leerer Grund MUST 400 ergeben.

#### Scenario: Eintrag mit Grund

- **WHEN** die Einsatzleitung einen Einsatz mit dem Grund „Falscher Einsatz abgeschlossen“
  wieder öffnet
- **THEN** enthält das ETB einen System-Eintrag mit diesem Grund, dem Abschlusszeitpunkt und
  der Person, die abgeschlossen hatte

#### Scenario: Ohne Grund

- **WHEN** das Wiederöffnen ohne Grund oder mit nur Leerzeichen gesendet wird
- **THEN** antwortet das System mit 400, und der Einsatz bleibt abgeschlossen

### Requirement: Wiederöffnen nimmt die automatischen Abschluss-Folgen zurück

Das Wiederöffnen SHALL im selben atomaren Vorgang zurücknehmen, was der Abschluss automatisch
gesetzt hat: die Aufbewahrungsfrist des Einsatzes, sofern sie beim Abschluss entstand, die beim
Abschluss entstandenen Kategorie-Fristen samt ihrer Vormerkung und die Nachbereitungsfrist. Eine
von Hand gesetzte Aufbewahrungsfrist oder Kategorie-Frist MUST bleiben. Die Nachbereitungsfrist
MUST in jedem Fall zurückgenommen werden, auch wenn sie nach dem Abschluss von Hand geändert
wurde: wer sie gesetzt hat, ist nicht gespeichert, und der erneute Abschluss setzt sie aus der
Vorgabe der Organisation neu. Beendete Gerätekopplungen und eine beendete Freigabe für
Maschinenzugänge MUST beendet bleiben, auch an einer Instanz, die den Einsatz spiegelt. Ein
erneuter Abschluss MUST die Fristen neu setzen.

#### Scenario: Automatische Frist zurückgenommen

- **WHEN** ein Einsatz mit Aufbewahrungsdauer 30 Tage abgeschlossen und binnen 24 Stunden wieder
  geöffnet wird
- **THEN** hat er keine Aufbewahrungsfrist mehr, und das ETB nennt die Rücknahme

#### Scenario: Manuelle Frist bleibt

- **WHEN** die Einsatzleitung nach dem Abschluss die Aufbewahrungsfrist oder die Frist einer
  Datenkategorie von Hand setzt und den Einsatz dann wieder öffnet
- **THEN** bleibt die von Hand gesetzte Frist

#### Scenario: Von Hand geänderte Nachbereitung geht mit

- **WHEN** die Einsatzleitung nach dem Abschluss die Nachbereitung von Hand auf 30 Tage setzt und
  den Einsatz dann wieder öffnet
- **THEN** hat er keine Nachbereitungsfrist mehr, und das ETB nennt die Rücknahme

#### Scenario: Erneuter Abschluss

- **WHEN** ein wieder geöffneter Einsatz mit Aufbewahrungsdauer 30 Tage erneut abgeschlossen
  wird
- **THEN** liegt seine Frist 30 Tage nach dem neuen Abschlusszeitpunkt

#### Scenario: Kopplung bleibt beendet

- **WHEN** ein Einsatz mit gekoppeltem Gerät abgeschlossen und wieder geöffnet wird
- **THEN** ist die Kopplung beendet, und das Gerät muss neu gekoppelt werden

#### Scenario: Kopplung bleibt beendet am Spiegel

- **WHEN** an einer Instanz, die den Einsatz spiegelt, noch eine Gerätekopplung und eine Freigabe
  für einen Maschinenzugang stehen (etwa nach einer Führungsübergabe) und die führende Instanz
  den Einsatz abschließt und binnen 24 Stunden wieder öffnet
- **THEN** sind Kopplung und Freigabe am Spiegel nach dem Abgleich beendet und leben mit dem
  Rückweg nach `aktiv` nicht wieder auf

### Requirement: Kein Wiederöffnen, wenn die Aufbewahrung schon greift

Das System MUST das Wiederöffnen mit 422 ablehnen, wenn der Einsatz oder eine seiner
Datenkategorien schon geschwärzt ist, ein Schwärzungsantrag für ihn gestellt ist, oder der
Einsatz archiviert, zur Verwahrung übergeben oder zum Abräumen vorgesehen ist. Ist der Einsatz
zur Löschung vorgemerkt, MUST das System ablehnen; weil ein vorgemerkter Einsatz für niemanden
mehr lesbar ist, antwortet es dann wie bei jedem nicht lesbaren Einsatz mit 403.

#### Scenario: Geschwärzte Kategorie

- **WHEN** an einem abgeschlossenen Einsatz eine Datenkategorie geschwärzt ist und die
  Einsatzleitung ihn wieder öffnen will
- **THEN** antwortet das System mit 422, und der Einsatz bleibt abgeschlossen

### Requirement: Kein Wiederöffnen am Spiegel

Ein Einsatz, den eine andere gekoppelte Instanz führt, MUST NOT hier wieder geöffnet werden;
das System MUST mit 409 antworten. Öffnet die führende Instanz einen Einsatz wieder, SHALL ihr
Spiegel bei der Gegenstelle mit dem nächsten Abgleich wieder aktiv sein.

#### Scenario: Wiederöffnen am Spiegel

- **WHEN** die Einsatzleitung am Spiegel eines Einsatzes, den der Hub führt, ihn wieder öffnen
  will
- **THEN** antwortet das System mit 409

#### Scenario: Führende Instanz öffnet wieder

- **WHEN** der Hub einen Einsatz wieder öffnet, den ein gekoppelter ELW spiegelt
- **THEN** zeigt der Spiegel beim ELW nach dem nächsten Abgleich den Einsatz als aktiv

### Requirement: Wiederöffnen in der Oberfläche

Auf den Einsatzdaten eines abgeschlossenen Einsatzes SHALL das Paneel „Einsatzabschluss“
Abschlusszeitpunkt und abschließende Person zeigen. Für die Einsatzleitung und den System-Admin
der Einsatz-Organisation MUST es binnen der Frist „Einsatz wieder öffnen“ anbieten, mit dem Ende
der Frist und einem Pflichtfeld für den Grund. Nach der Frist und für andere MUST der Knopf
fehlen.

#### Scenario: Einsatzleitung innerhalb der Frist

- **WHEN** die Einsatzleitung die Einsatzdaten eines vor einer Stunde abgeschlossenen Einsatzes
  öffnet
- **THEN** zeigt das Paneel „Einsatz wieder öffnen“ mit dem Ende der Frist

#### Scenario: Nach der Frist

- **WHEN** die Einsatzleitung die Einsatzdaten eines vor zwei Tagen abgeschlossenen Einsatzes
  öffnet
- **THEN** zeigt das Paneel Abschlusszeitpunkt und abschließende Person ohne Knopf
