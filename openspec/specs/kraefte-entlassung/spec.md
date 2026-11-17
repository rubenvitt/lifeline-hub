# kraefte-entlassung Specification

## Purpose
Eine Kraft verlässt den Einsatz, ohne aus ihm zu verschwinden: Personal und Fahrzeuge werden
entlassen, Material aus dem Einsatz genommen, eine Einheit aufgelöst. Sie bleiben mit Zeitachse,
Tagebuch und Bezügen im Nachweis, zählen aber in keiner Liste, Stärke und Auswahl mehr. Eine Fehldisposition lässt sich kurz nach dem Disponieren
spurlos stornieren, eine entlassene Kraft erneut disponieren.

## Requirements

### Requirement: Kraft aus dem Einsatz entlassen

Das System SHALL Personal, Fahrzeuge und Material eines Einsatzes entlassen können, ohne die
Disposition zu löschen; Material heißt in Oberfläche, Tagebuch und Doku „aus dem Einsatz
genommen“, auf dem Draht `entlassen`. Die entlassene Kraft MUST mit Zeitpunkt und entlassender
Person erhalten bleiben. Entlassen MUST ihre Bindungen lösen (Einheit, Fahrzeug, Besatzung, UHS,
Führung einer Einheit, Leitung eines Abschnitts, Einsatzleitung, Führungsstelle,
Bereitstellungsraum) und MUST ihre Historie behalten (Auftragsempfänger, Schadensbezug,
Bestätigungen). Entlassen einer Person MUST das Zeitachsen-Ereignis `entlassung` mit Quelle
`disposition` schreiben, sofern sie eine offene Periode hat. Entlassen MUST einen ETB-Eintrag erzeugen und erfordert keine Rückfrage.
Material aus dem Einsatz zu nehmen MUST seinen Ort lösen; danach liegt es ohne Ort (LLH-1224).
Entlassen eines Fahrzeugs MUST seine Beladung (Material auf dem Fahrzeug) im Einsatz lassen und
ohne Ort stellen; der ETB-Eintrag des Fahrzeugs MUST dann „Beladung ohne Ort: n Posten“ nennen,
und jeder freigegebene Posten MUST live aktualisiert werden.

#### Scenario: Zeitachse überlebt Entlassen
- **WHEN** eine Person mit Alarmierung 06:10 und Eintreffen 06:40 um 14:00 entlassen wird
- **THEN** stehen in ihrer Zeitachse Alarmierung, Eintreffen und Entlassung 14:00, und die Person ist weiter im Einsatz geführt

#### Scenario: Bindungen gelöst
- **WHEN** der Führer einer Einheit entlassen wird
- **THEN** hat die Einheit keinen Führer mehr, und die Person gehört keiner Einheit mehr an

#### Scenario: Auftrag bleibt
- **WHEN** eine Person entlassen wird, die Empfänger eines Auftrags ist
- **THEN** nennt der Auftrag sie weiter als Empfänger

#### Scenario: Fahrzeug entlassen
- **WHEN** ein Fahrzeug mit zwei Personen Besatzung, in einer Einheit und in einem Bereitstellungsraum entlassen wird
- **THEN** sind beide Personen weiter im Einsatz, nur ohne Fahrzeug, das Fahrzeug gehört keiner Einheit mehr an, und der Bereitstellungsraum verzeichnet seinen Austritt

#### Scenario: Material aus dem Einsatz genommen
- **WHEN** ein Materialposten an einer UHS aus dem Einsatz genommen wird
- **THEN** liegt er ohne Ort, und das Tagebuch nennt ihn „aus dem Einsatz genommen“

#### Scenario: Fahrzeug mit Beladung entlassen
- **WHEN** ein Fahrzeug mit zwei geladenen Materialposten entlassen wird
- **THEN** bleiben beide Posten im Einsatz, ohne Ort, und das Tagebuch nennt „Beladung ohne Ort: 2 Posten“

#### Scenario: Bereits entlassen
- **WHEN** eine entlassene Kraft erneut entlassen werden soll
- **THEN** antwortet das System mit 409

### Requirement: Einheit auflösen

Das System SHALL eine Einheit auflösen können, ohne ihre Zeile zu löschen. Auflösen MUST zuerst
alle Kräfte von der Einheit lösen und danach das Ereignis `entlassung` an der Einheit schreiben,
das keine Person erreicht. Zeitachse, abgelöste Schichten, ETB-Verknüpfungen und
Verpflegungsausgaben an die Einheit MUST erhalten bleiben. Eine Einheit ohne Zeitachse, Schicht,
ETB-Verknüpfung, Belegung eines Bereitstellungsraums, ohne Auftrag, Meldung, Dokument, Verteiler
und Verpflegungsausgabe (auch eine zurückgenommene) mit Verweis auf sie und ohne jede (auch
beendete) Kraft mit Verweis auf sie MAY stattdessen gelöscht werden.
Bleibt die Einheit als aufgelöst stehen, MUST das Auflösen in derselben Transaktion ihre letzte
Besetzung festhalten, wie sie vor dem Lösen war: jede Person mit Führer-Kennzeichen und dem
Fahrzeug, auf dem sie saß, jedes Fahrzeug und jeden Materialposten mit seiner Menge. Eine
gelöschte oder stornierte Einheit MUST nichts festhalten.

#### Scenario: Aufgelöste Einheit bleibt im Nachweis
- **WHEN** die Einheit „Florian 1“ mit Eintreffen 06:40 um 15:00 aufgelöst wird
- **THEN** trägt ihre Zeitachse Eintreffen und Entlassung, und ihre ETB-Einträge nennen sie weiter

#### Scenario: Leere Einheit gelöscht
- **WHEN** eine eben angelegte Einheit ohne Kräfte und ohne Spur aufgelöst wird
- **THEN** ist sie gelöscht

#### Scenario: Verpflegte Einheit bleibt
- **WHEN** eine Einheit ohne Kräfte und ohne andere Spur, an die eine Verpflegungsausgabe ging, aufgelöst wird
- **THEN** bleibt sie als aufgelöst stehen, und die Ausgabe nennt sie weiter als Empfänger

#### Scenario: Verpflegte Einheit stornieren
- **WHEN** eine Einheit ohne andere Spur, an die eine Verpflegungsausgabe ging, als Fehldisposition storniert werden soll
- **THEN** antwortet das System mit 422 und dem Grund, dass eine Verpflegungsausgabe die Einheit nennt

#### Scenario: Letzte Besetzung festgehalten
- **WHEN** die Einheit „Florian 1“ mit Führerin Anna Beck und Ben Kurz auf dem Fahrzeug
  „Florian 1-83-1“ und dem Materialposten „Wolldecke“ mit Menge 20 aufgelöst wird
- **THEN** liefert die Liste der aufgelösten Einheiten für „Florian 1“ als letzte Besetzung beide
  Personen, Anna Beck als Führerin, beide auf „Florian 1-83-1“, das Fahrzeug und „Wolldecke“ mit
  Menge 20, obwohl keine dieser Kräfte der Einheit noch angehört

#### Scenario: Festgehaltene Kraft wird später storniert
- **WHEN** eine Person nach dem Auflösen ihrer Einheit als Fehldisposition storniert wird
- **THEN** fehlt sie in der letzten Besetzung der aufgelösten Einheit

#### Scenario: Vor der Änderung aufgelöst
- **WHEN** eine Einheit abgefragt wird, die aufgelöst wurde, bevor das System die letzte
  Besetzung festhielt
- **THEN** trägt sie keine letzte Besetzung, statt einer leeren

### Requirement: Fehldisposition stornieren

Das System SHALL eine Kraft stornieren können, die versehentlich disponiert wurde. Ein Storno
MUST die Kraft als storniert beenden und jedes nicht gestrichene Zeitachsen-Ereignis der Kraft
mit dem Grund „Fehldisposition storniert“ streichen. Ein Storno MUST nur gelingen, solange die
Kraft aktiv ist, nie entlassen war, keine Bindung hat, keine andere Spur als die Ereignisse aus
der Disposition trägt und die Disposition höchstens 15 Minuten zurückliegt. Bei einem Fahrzeug
MUST auch ein Statuswechsel, eine Belegung eines Bereitstellungsraums, die Führungsstelle und ein
Auftrag als Spur gelten, ebenso eine Beladung mit Material. Ein Materialposten MUST für einen
Storno ohne Ort sein (LLH-1224). Sonst MUST das System mit 422 und
dem Grund als Satz antworten, bei einer schon beendeten Kraft mit 409. Die Oberfläche MUST vor dem
Storno mit einem Satz zur Folge rückfragen.

#### Scenario: Storno direkt nach dem Disponieren
- **WHEN** eine Person um 10:00 disponiert und um 10:05 storniert wird
- **THEN** ist ihr Alarmierungsereignis gestrichen, und sie erscheint in keiner Liste und keinem Nachweis

#### Scenario: Storno mit Spur
- **WHEN** eine Person storniert werden soll, die schon eingetroffen ist
- **THEN** antwortet das System mit 422, und der Grund steht am Ort der Handlung

#### Scenario: Fahrzeug mit Statuswechsel
- **WHEN** ein Fahrzeug fünf Minuten nach dem Disponieren auf „Auf Anfahrt“ steht und storniert werden soll
- **THEN** antwortet das System mit 422, und das Fahrzeug lässt sich entlassen

#### Scenario: Fahrzeug mit Beladung
- **WHEN** ein Fahrzeug, auf dem ein Materialposten liegt, storniert werden soll
- **THEN** antwortet das System mit 422 „Das Fahrzeug hat Material geladen; erst lösen oder das Fahrzeug entlassen“

#### Scenario: Material an einem Ort
- **WHEN** ein Materialposten an einer Einheit storniert werden soll
- **THEN** antwortet das System mit 422, und der Posten bleibt an der Einheit

#### Scenario: Frist abgelaufen
- **WHEN** eine Person 20 Minuten nach dem Disponieren storniert werden soll
- **THEN** antwortet das System mit 422 „nur in den ersten 15 Minuten nach der Disposition“

### Requirement: Erneut disponieren

Das System SHALL eine entlassene oder stornierte Kraft erneut disponieren, indem es ihre
bestehende Zeile reaktiviert. Das Disponieren einer beendeten Stamm-Kraft MUST gelingen statt
mit 409 abgelehnt zu werden und MUST den Initialstatus neu setzen, sodass eine neue Periode
beginnt; ein schon entlassenes Fahrzeug MUST beim Sammel-Disponieren mit dem Grund „entlassen“
abgelehnt werden, ein storniertes reaktiviert werden. Material MUST beim Reaktivieren Menge und
Status behalten; das Disponieren aus dem Stamm legt bei Material immer eine neue Zeile an.
Gestrichene Ereignisse MUST gestrichen bleiben. „Rückgängig“ nach dem Herausnehmen von Material
MUST die Kraft auf diesem Weg wieder aktiv machen; beim Fahrzeug gilt „Entlassung eines
Fahrzeugs zurücknehmen“, bei der Person „Entlassung einer Person zurücknehmen“.

#### Scenario: Stamm-Person kommt zurück
- **WHEN** eine um 14:00 entlassene Stamm-Person um 18:00 erneut disponiert wird
- **THEN** ist sie aktiv, und ihre Zeitachse zeigt eine zweite Periode ab 18:00

#### Scenario: Rückgängig nach Entlassen
- **WHEN** die Person direkt nach dem Herausnehmen eines Postens „Rückgängig“ wählt
- **THEN** ist der Posten wieder aktiv

#### Scenario: Material kommt zurück
- **WHEN** ein defekter Posten mit Menge 4 aus dem Einsatz genommen und erneut disponiert wird
- **THEN** steht er wieder in der Liste, mit Menge 4 und Status „defekt“, ohne Ort

### Requirement: Beendete Kräfte in Listen und Zahlen

Das System SHALL entlassene und stornierte Kräfte sowie aufgelöste Einheiten aus jeder Liste,
Auswahl, Karte, Stärke, Statusverteilung und jedem Zähler herauslassen. Entlassene Kräfte und
aufgelöste Einheiten MUST auf Anfrage getrennt abrufbar sein. Personal- und Fahrzeugliste MUST
sie als eingeklappten Block „Entlassen“ mit der Aktion „Erneut disponieren“ zeigen, die
Materialliste als Block „Aus dem Einsatz genommen“, die Einheitenliste aufgelöste Einheiten als
eingeklappten Block „Aufgelöst“, in dem jeder Name auf die Ansicht der Einheit führt. Jeder
Schreibweg an einer beendeten Kraft außer dem erneuten Disponieren und der Berichtigung der
Zeitachse einer entlassenen Person MUST mit 409 antworten.
Ein Test MUST fehlschlagen, wenn eine Abfrage der vier
Kräftetabellen (Personal, Einheiten, Fahrzeuge, Material) außerhalb einer Ausnahmeliste den
Zustand nicht prüft.

#### Scenario: Stärke ohne Entlassene
- **WHEN** von zwölf Personen einer Einheit zwei entlassen sind
- **THEN** zählen Meldebild, Statusband und Lagemonitor zehn

#### Scenario: Block Entlassen
- **WHEN** die Personalliste zwei Entlassene hat
- **THEN** zeigt sie unter den aktiven einen eingeklappten Block „Entlassen (2)“

#### Scenario: Status an Entlassener
- **WHEN** der Status einer entlassenen Person gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Besatzung an entlassenem Fahrzeug
- **WHEN** einem entlassenen Fahrzeug eine Person als Besatzung zugeordnet werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Aufgelöste Einheit aus dem Block öffnen
- **WHEN** jemand im aufgeklappten Block „Aufgelöst“ den Namen „Florian 1“ wählt
- **THEN** öffnet die Ansicht der aufgelösten Einheit „Florian 1“

### Requirement: Zeitachse einer entlassenen Person berichtigen

Das System SHALL an einer entlassenen Person Nachtrag, Periode nachtragen, Streichung und
Berichtigung des Zeitpunkts an ihrer Zeitachse annehmen, mit denselben Regeln wie an einer aktiven Kraft. Danach MUST die
Person ohne offene Einsatzperiode sein, sonst MUST das System mit 422 antworten, nichts schreiben
und auf das erneute Disponieren verweisen. Eine Streichung oder Berichtigung an ihrer früheren
Einheit MUST die Kopie an der entlassenen Person stehen lassen. Der ETB-Eintrag MUST „berichtigt
nach Entlassung“ bzw. bei der Berichtigung „(nach Entlassung)“ vermerken. An einer stornierten
Person und an einer aufgelösten Einheit MUST alles weiter mit 409 scheitern.

#### Scenario: Eintreffzeit nach dem Entlassen berichtigen
- **WHEN** an einer um 14:00 entlassenen Person das Eintreffen 06:40 mit Grund „Zeit verwechselt“ gestrichen und ein Eintreffen 06:30 nachgetragen wird, während ihre Periode mit der Alarmierung 06:10 beginnt
- **THEN** gelingen beide, die Periode reicht von 06:10 bis 14:00 mit Eintreffen 06:30, und beide ETB-Einträge vermerken „berichtigt nach Entlassung“

#### Scenario: Fehleintrag einer früheren Periode streichen
- **WHEN** an einer entlassenen Person mit zwei abgeschlossenen Perioden das Eintreffen der ersten mit Grund gestrichen wird, die mit einer Alarmierung beginnt
- **THEN** antwortet das System mit 200, und die Person bleibt entlassen

#### Scenario: Nachtrag öffnet eine Periode
- **WHEN** an einer um 14:00 entlassenen Person ein Eintreffen um 15:00 nachgetragen werden soll
- **THEN** antwortet das System mit 422 und dem Hinweis, die Person erst erneut zu disponieren, und die Zeitachse bleibt unverändert

#### Scenario: Abschließende Entlassung streichen
- **WHEN** an einer entlassenen Person die Entlassung gestrichen werden soll, die ihre letzte Periode schließt
- **THEN** antwortet das System mit 422, und die Oberfläche zeigt den Streichen-Knopf dieser Entlassung gesperrt mit Kurzgrund

#### Scenario: Andere Schreibwege bleiben gesperrt
- **WHEN** an einer entlassenen Person nach einer Berichtigung der Zeitachse der Status gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Stornierte Person
- **WHEN** an einer stornierten Person ein Ereignis nachgetragen oder gestrichen werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Aufgelöste Einheit
- **WHEN** an einer aufgelösten Einheit ein Ereignis nachgetragen oder gestrichen werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Entlassungszeit nach dem Entlassen berichtigen
- **WHEN** an einer um 14:00 entlassenen Person die abschließende Entlassung mit Grund „zu spät gemeldet“ auf 13:30 berichtigt wird
- **THEN** gelingt es, die letzte Periode endet um 13:30, die Person bleibt entlassen, und das ETB vermerkt „(nach Entlassung)“

#### Scenario: Berichtigung öffnet eine Periode
- **WHEN** an einer um 14:00 entlassenen Person mit Alarmierung 06:10 und Eintreffen 06:40 die Entlassung auf 06:20 berichtigt werden soll
- **THEN** antwortet das System mit 422 und dem Hinweis, die Person erst erneut zu disponieren (das Eintreffen 06:40 begänne eine offene Periode), und die Zeitachse bleibt unverändert

#### Scenario: Oberfläche einer entlassenen Person
- **WHEN** eine Person mit Schreibrecht im aktiven Einsatz die Ansicht einer entlassenen Person öffnet
- **THEN** bietet das Paneel „Zeitachse“ „Nachtragen“, „Zeit berichtigen“ und „Streichen“, an der abschließenden Entlassung steht „Streichen“ gesperrt mit Kurzgrund und „Zeit berichtigen“ offen, und Einteilung und Angaben bleiben nur lesbar

#### Scenario: Fehlende Periode nach dem Entlassen nachtragen
- **WHEN** an einer um 18:00 entlassenen Person mit einer Periode 14:00–18:00 eine Periode Eintreffen 06:40, Entlassung 12:00 nachgetragen wird
- **THEN** gelingt es, die Person trägt zwei abgeschlossene Perioden, bleibt entlassen, und das ETB vermerkt „berichtigt nach Entlassung“

#### Scenario: Periode an einer entlassenen Person verletzt die Regeln
- **WHEN** an einer entlassenen Person eine Periode nachgetragen werden soll, die eine bestehende überschneidet
- **THEN** antwortet das System mit 422 und die Zeitachse bleibt unverändert, auch ohne ETB-Eintrag

### Requirement: Entlassene im Nachweis

Meldebild-Druck, die Übernahme des Meldebilds in einen Lagebericht und der Einsatzbericht SHALL
entlassene Personen als eigenen Block „Entlassen“ führen. Meldebild-Druck und die Übernahme des
Meldebilds SHALL dort auch entlassene Fahrzeuge führen und aus dem Einsatz genommenes Material als
eigenen Block „Aus dem Einsatz genommen“, jeden Eintrag mit dem Zeitpunkt seines Endes. Scheitert
eine dieser Listen, MUST der Block das sagen („nicht geladen“), statt sie wegzulassen. Stornierte
Kräfte MUST in keinem Nachweis erscheinen.

#### Scenario: Meldebild nennt Entlassene
- **WHEN** das Meldebild mit zwei entlassenen Personen in einen Lagebericht übernommen wird
- **THEN** enthält der Text einen Block „Entlassen“ mit beiden, und die Stärke zählt sie nicht

#### Scenario: Fahrzeug und Material im Nachweis
- **WHEN** das Meldebild übernommen wird, nachdem ein Fahrzeug entlassen, ein zweites storniert
  und ein Materialposten aus dem Einsatz genommen wurde
- **THEN** steht das entlassene Fahrzeug mit Zeitpunkt im Block „Entlassen“, der Materialposten mit
  Zeitpunkt im Block „Aus dem Einsatz genommen“, und das stornierte Fahrzeug fehlt

### Requirement: Entlassung eines Fahrzeugs zurücknehmen

„Rückgängig“ nach dem Entlassen eines Fahrzeugs SHALL das Fahrzeug in einer Transaktion in den
Zustand davor zurücknehmen: aktiv, mit Status und „Status seit“, Einheit, Besatzung,
Bereitstellungsraum, Führungsstelle und Beladung. Nur der Storno MUST danach gesperrt bleiben,
denn das Fahrzeug war im Einsatz. Die Rücknahme MUST einen ETB-Eintrag
„Entlassung zurückgenommen“ schreiben, MUST keine Benachrichtigung „wieder verfügbar“ auslösen und
MUST dieselben Live-Meldungen senden wie das Entlassen.

#### Scenario: Entlassen und Rückgängig
- **WHEN** ein Fahrzeug auf Status 2 seit 10:15, in Einheit „Zug 1“, mit zwei Personen Besatzung, im Bereitstellungsraum „BR Nord“ und mit einem geladenen Posten entlassen wird und direkt danach „Rückgängig“ gewählt wird
- **THEN** ist es aktiv, auf Status 2 seit 10:15, in „Zug 1“, mit beiden Personen als Besatzung, im „BR Nord“ eingetreten und mit dem Posten beladen, und das ETB nennt „Entlassung zurückgenommen“

#### Scenario: Führungsstelle
- **WHEN** ein Fahrzeug, das die Führungsstelle trägt, entlassen und zurückgenommen wird
- **THEN** trägt es die Führungsstelle wieder

#### Scenario: Storno nach der Rücknahme
- **WHEN** ein Fahrzeug kurz nach dem Disponieren entlassen und zurückgenommen wird und danach jemand es stornieren will
- **THEN** lehnt der Server den Storno ab, auch wenn der Body der Rücknahme etwas anderes behauptet

### Requirement: Rücknahme lässt Verändertes aus

Was seit dem Entlassen anders gebunden ist oder nicht mehr besteht (Einheit aufgelöst, Person auf
einem anderen Fahrzeug oder entlassen, Raum nicht mehr aktiv, Posten an einem anderen Ort, Führung,
Leitung oder Einsatzleitung inzwischen anders besetzt, UHS aufgelöst), MUST die Rücknahme
auslassen und in ihrer Antwort nennen; der Hinweis MUST es in Worten zeigen. Ebenso MUST sie einen
Teil auslassen und nennen, für dessen Modul der Person das Schreibrecht fehlt. Das gilt für die
Rücknahme bei Fahrzeug und Person.

#### Scenario: Person inzwischen auf anderem Fahrzeug
- **WHEN** nach dem Entlassen eines Fahrzeugs eine seiner Personen auf ein anderes Fahrzeug gesetzt wird und danach „Rückgängig“ gewählt wird
- **THEN** ist das Fahrzeug aktiv ohne diese Person, die Person bleibt auf dem anderen Fahrzeug, und der Hinweis nennt sie als nicht zurückgekommen

#### Scenario: Einheit inzwischen aufgelöst
- **WHEN** die Einheit des entlassenen Fahrzeugs aufgelöst wird und danach „Rückgängig“ gewählt wird
- **THEN** ist das Fahrzeug aktiv ohne Einheit, und der Hinweis nennt die Einheit

#### Scenario: Einheit hat inzwischen einen anderen Führer
- **WHEN** nach dem Entlassen eines Einheitsführers eine andere Person die Einheit übernimmt und danach „Rückgängig“ gewählt wird
- **THEN** ist die entlassene Person wieder aktiv und Mitglied der Einheit, aber nicht ihr Führer, und der Hinweis nennt die Führung als nicht zurückgekommen

#### Scenario: Inzwischen anderer Einsatzleiter
- **WHEN** nach dem Entlassen der Einsatzleiterin ein externer Einsatzleiter eingetragen wird und danach „Rückgängig“ gewählt wird
- **THEN** bleibt der externe Einsatzleiter, und der Hinweis nennt die Einsatzleitung als nicht zurückgekommen

#### Scenario: Ohne Recht im Modul Einheiten
- **WHEN** eine Person mit Schreibrecht im Personal, aber ohne Schreibrecht im Modul Einheiten, einen Einheitsführer entlässt und zurücknimmt
- **THEN** ist er aktiv ohne Einheit und ohne Führung, und der Hinweis nennt beides mit dem fehlenden Recht

### Requirement: Rücknahme nur direkt nach dem Entlassen

Die Rücknahme MUST nur der Person gelingen, die entlassen hat, und nur, solange die Kraft
(Fahrzeug oder Person) seit diesem Entlassen unverändert entlassen ist und höchstens zehn Minuten
vergangen sind. Sonst MUST das System mit 409 antworten, und es bleibt „Erneut disponieren“.

#### Scenario: Schon erneut disponiert
- **WHEN** ein entlassenes Fahrzeug über „Erneut disponieren“ zurückgeholt wurde und danach die Rücknahme ankommt
- **THEN** antwortet das System mit 409, und das Fahrzeug bleibt unverändert

#### Scenario: Andere Person
- **WHEN** eine andere Person als die entlassende die Rücknahme sendet
- **THEN** antwortet das System mit 409

#### Scenario: Person nach zehn Minuten
- **WHEN** die Rücknahme einer entlassenen Person elf Minuten nach dem Entlassen ankommt
- **THEN** antwortet das System mit 409, und die Person bleibt entlassen

### Requirement: Entlassung einer Person zurücknehmen

„Rückgängig“ nach dem Entlassen einer Person SHALL sie in einer Transaktion in den Zustand davor
zurücknehmen: aktiv, mit Status, Dispositionszeit und Stärke-Position wie vorher, mit Einheit,
Fahrzeug, UHS, Führung ihrer Einheiten, Leitung ihrer Abschnitte und Einsatzleitung. Ihre
Zeitachse MUST keine neue Periode bekommen: die Entlassung dieses Entlassens wird gestrichen.
Der Storno MUST gesperrt bleiben. ETB „Entlassung zurückgenommen“, Live-Meldungen wie beim
Entlassen.

#### Scenario: Entlassen und Rückgängig
- **WHEN** eine Person auf Status „im Einsatz“ seit 10:15, Mitglied und Führer der Einheit „Zug 1“, Besatzung von „83-1“, an der UHS „Nord“, Leiterin des Abschnitts „Süd“ und Einsatzleiterin, entlassen wird und direkt danach „Rückgängig“ gewählt wird
- **THEN** ist sie aktiv, auf „im Einsatz“ seit 10:15, Mitglied und Führer von „Zug 1“, Besatzung von „83-1“, an der UHS „Nord“, leitet „Süd“, ist Einsatzleiterin, und das ETB nennt „Entlassung zurückgenommen“

#### Scenario: Zeitachse ohne neue Periode
- **WHEN** eine Person mit Eintreffen um 09:00 um 11:00 entlassen und direkt danach zurückgenommen wird
- **THEN** zeigt ihre Zeitachse eine offene Periode ab 09:00, die Entlassung um 11:00 ist mit Grund „Entlassung zurückgenommen“ gestrichen, und es gibt keine Periode ab 11:00

#### Scenario: Entlassen ohne offene Periode
- **WHEN** eine Person ohne offene Periode entlassen und zurückgenommen wird
- **THEN** ist sie aktiv, und ihre Zeitachse ist unverändert

#### Scenario: Zeitachse inzwischen berichtigt
- **WHEN** nach dem Entlassen einer Person jemand die Entlassungszeit berichtigt und danach „Rückgängig“ gewählt wird
- **THEN** antwortet das System mit 409, und die Person bleibt unverändert entlassen

#### Scenario: Storno nach der Rücknahme
- **WHEN** eine Person kurz nach dem Disponieren entlassen und zurückgenommen wird und danach jemand sie stornieren will
- **THEN** lehnt der Server den Storno ab
