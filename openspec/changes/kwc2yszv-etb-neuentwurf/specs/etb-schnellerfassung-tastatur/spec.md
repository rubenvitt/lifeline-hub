## RENAMED Requirements

- FROM: `### Requirement: Nur protokollieren`
- TO: `### Requirement: Auch in den Meldungseingang`

- FROM: `### Requirement: Nur protokollieren ohne Recht der Meldungen`
- TO: `### Requirement: Meldungseingang ohne Recht der Meldungen`

- FROM: `### Requirement: Einstellungen der Erfassung kosten keine Zeile`
- TO: `### Requirement: Einstellungen in der Fußzeile der Erfassung`

## MODIFIED Requirements

### Requirement: Der Vertrag steht am Knopf, nicht im Text

Die ETB-Schnellerfassung MUST den Tastaturvertrag nicht in einer Hinweiszeile oder im Platzhalter
erklären (Bedien-Leitlinie „Text erklärt nie die Bedienung“, LFH-1078). Bei feinem Zeiger SHALL
der Knopf „Erfassen“ ab Breite `lg` eine Tastenkappe ↵ tragen; schmaler entfällt sie, damit das
Textfeld seinen Anteil an der Zeile behält. Bei grobem Zeiger MUST keine Tastenkappe und keine
Tastenkombination sichtbar sein. Der Knopf SHALL die gültigen Kürzel auf jeder Breite in
`aria-keyshortcuts` nennen.
Kein Platzhalter der ETB-Schnellerfassung MUST eine Taste, ein Kürzel oder das Wort „Befehle“
enthalten.
Weicht die Ereigniszeit von „jetzt“ ab, SHALL der Knopf sie nennen („Erfassen als 1912“); sein
zugänglicher Name MUST die Zeit ebenfalls tragen.

#### Scenario: Touch-Tablet quer
- **WHEN** die Erfassung bei 1180 px Breite und grobem Zeiger steht
- **THEN** steht unter dem Feld keine Hinweiszeile zur Tastatur, und der Knopf „Erfassen“ trägt keine Tastenkappe

#### Scenario: Platzhalter auf dem Handschirm
- **WHEN** die Erfassung bei 390 px Breite leer steht
- **THEN** lautet der Platzhalter „Inhalt …“

#### Scenario: Nachtrag am Knopf
- **WHEN** im Feld Zeit 1912 steht und es 1926 ist
- **THEN** heißt der Knopf „Erfassen als 1912“

### Requirement: Kurzeingabe der Ereigniszeit
Beginnt der Text der ETB-Schnellerfassung (nach einem etwaigen Typbefehl) mit `/zeit` und einer
lesbaren Zeitangabe, SHALL die Erfassung daraus die Ereigniszeit setzen, nach denselben Regeln wie
das Zeitfeld eines Ereignisses (`1420`, `14:20`, `101420`, `-15`), und sie im Feld Zeit zeigen. Der
Rest der Zeile MUST als Inhalt stehen bleiben. Ist die Angabe unlesbar, bleibt sie Text, und das
Feld nennt den Grund.

#### Scenario: Uhrzeit mit Inhalt
- **WHEN** „/zeit 1420 Pumpe läuft“ getippt wird
- **THEN** zeigt das Feld Zeit 1420, und der Inhalt lautet „Pumpe läuft“

#### Scenario: Relativ
- **WHEN** um 14:31 Serverzeit „/zeit -10 Lage ruhig“ getippt und erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit 14:21 und den Hinweis „nachgetragen“

#### Scenario: Unlesbar
- **WHEN** „/zeit 2590 Pumpe“ getippt wird
- **THEN** bleibt das Feld Zeit bei „jetzt“, der Text bleibt stehen, und das Feld nennt den Grund

### Requirement: Keine Ereigniszeit in der Zukunft
Liegt die Ereigniszeit eines ETB-Entwurfs mehr als 60 Sekunden nach jetzt (Serveruhr, soweit der
Versatz bekannt ist), MUST die Erfassung das Senden verweigern, am Feld Zeit den Grund „liegt in
der Zukunft“ nennen und Text und Felder stehen lassen. Der Server begrenzt die Ereigniszeit
weiterhin nicht.

#### Scenario: Tippfehler in die Zukunft
- **WHEN** um 14:20 Serverzeit im Feld Zeit 18:20 desselben Tages steht und „Erfassen“ gewählt wird
- **THEN** entsteht kein Eintrag, das Feld Zeit nennt „liegt in der Zukunft“, und der Text bleibt

#### Scenario: Vorgemerkter Eintrag
- **WHEN** ein offline vorgemerkter Eintrag mit vergangener Ereigniszeit später gesendet wird
- **THEN** nimmt der Server ihn an

### Requirement: Typwort statt Slash-Präfix
Die ETB-Erfassung SHALL den Typ als Auswahl aus vier Segmenten „Meldung“, „Anordnung“,
„Entscheidung“ und „Lage“ zeigen, jedes mit einem Farbpunkt der Typfarbe; das gewählte trägt eine
Kante in der Typfarbe und meldet sich über `aria-pressed` bzw. als gewählte Option der Gruppe. Die
Gruppe MUST den zugänglichen Namen „Typ des Eintrags“ tragen. Die Slash-Schreibweise MUST nirgends
als Beschriftung stehen. Der Slash-Befehl am Zeilenanfang wechselt den Typ weiterhin. Unter `md`
SHALL ein Knopf mit Typwort und Pfeil die Auswahl öffnen.

#### Scenario: Wechsel per Slash-Befehl
- **WHEN** „/anordnung Abschnitt Nord räumen“ getippt wird
- **THEN** ist das Segment „Anordnung“ gewählt und trägt die Kante der Anordnung

#### Scenario: Wechsel per Klick
- **WHEN** das Segment „Entscheidung“ gewählt wird
- **THEN** ist der Typ „Entscheidung“, und Von und An folgen der Vorgabe des Typs, soweit sie nicht ausdrücklich gesetzt sind

### Requirement: Auch in den Meldungseingang
Bei den Typen „Meldung“ und „Lage“ SHALL die ETB-Erfassung den Schalter „Auch in den
Meldungseingang“ zeigen; an heißt, der Eintrag legt den Vorgang im Meldungseingang an. Vorgabe ist
an, außer Von und An sind beide die eigene Stelle: dann ist die Vorgabe aus. Wechselt Von oder An,
SHALL die Vorgabe neu gelten, solange der Schalter nicht von Hand gesetzt ist. Der Schalter MUST
nach jedem erfolgreichen Erfassen wieder auf seiner Vorgabe stehen, auch wenn „Werte behalten“ an
ist, und MUST im Entwurf erhalten bleiben, bis dieser gesendet ist. Bei anderen Typen MUST er
fehlen.

#### Scenario: Vorgabe
- **WHEN** eine Person mit eigener Stelle „ELW 1“ eine Meldung mit Von „Florian 3“ und An „ELW 1“ schreibt
- **THEN** steht „Auch in den Meldungseingang“ an

#### Scenario: Eigener Vermerk
- **WHEN** eine Person mit eigener Stelle „ELW 1“ den Typ „Lage“ wählt und Von und An „ELW 1“ bleiben
- **THEN** steht „Auch in den Meldungseingang“ aus, und das Erfassen legt keine Meldung an

#### Scenario: Zurück nach dem Erfassen
- **WHEN** „Werte behalten“ an ist und eine Person eine Meldung von „Florian 3“ mit dem Schalter von Hand aus erfasst
- **THEN** beginnt der nächste Entwurf als Meldung von „Florian 3“ mit dem Schalter an

#### Scenario: Anordnung
- **WHEN** eine Person den Typ „Anordnung“ wählt
- **THEN** fehlt der Schalter

### Requirement: Einstellungen in der Fußzeile der Erfassung
„Auch in den Meldungseingang“ und „Werte behalten“ SHALL in der Fußzeile unter dem Inhalt stehen,
links, und „+ Veranlassung“, „+ Anhang“ und „+ weiterer Entwurf“ rechts in derselben Zeile. Die
Erfassungsleiste MUST höchstens die Hälfte der Fensterhöhe belegen und MUST im Handschuh-Betrieb
die Trefffläche der Dichtestufe halten. Unter `md` SHALL die Fußzeile waagerecht rollen statt
umzubrechen. Ist das Fenster niedriger als 700 px, SHALL ab `md` die Feldzeile mit Typ-Knopf und
die Fußzeile in einer einzigen, waagerecht rollenden Zeile über dem Inhalt stehen.

#### Scenario: Fükw im Handschuh-Betrieb
- **WHEN** die Erfassung bei 1366 × 768 im Handschuh-Betrieb mit Typ „Meldung“ steht
- **THEN** stehen beide Schalter in der Fußzeile mit mindestens 72 px Trefffläche, und die Leiste belegt höchstens 384 px

#### Scenario: Niedriges Fenster
- **WHEN** die Erfassung bei 1366 × 520 im Handschuh-Betrieb steht
- **THEN** stehen Typ, Zeit, Von, An, Weg und beide Schalter in einer rollenden Zeile über dem Inhalt, und beim Tabben durch die Zeitachse verschwindet keine Zeile hinter der Leiste

### Requirement: Meldungseingang ohne Recht der Meldungen
Ist das Modul Meldungen für die Person nicht freigegeben, SHALL der Schalter „Auch in den
Meldungseingang“ aus und gesperrt stehen, den Grund nennen und der Eintrag nur protokolliert
werden. Der Schalter MUST die Breite des Inhaltsfelds in keinem Fall verringern.

#### Scenario: Ohne Recht für Meldungen
- **WHEN** eine Person im ETB schreiben darf, das Modul Meldungen für sie aber gesperrt ist, und sie den Typ „Meldung“ wählt
- **THEN** steht „Auch in den Meldungseingang“ aus und gesperrt mit dem Grund „Modul Meldungen gesperrt“, und das Erfassen legt keine Meldung an

#### Scenario: Feldbreite
- **WHEN** der Typ „Lage“ gewählt ist und die Erfassung bei 1440 × 900 steht
- **THEN** ist das Inhaltsfeld so breit wie bei Typ „Anordnung“

## ADDED Requirements

### Requirement: Feste Felder der Erfassung
Die ETB-Erfassung SHALL über dem Inhalt eine Zeile mit festen, beschrifteten Feldern zeigen: Typ,
Zeit, Von, An, Meldeweg. Ohne gesetzte Ereigniszeit zeigt Zeit „jetzt“. Tab MUST die Felder in dieser Ordnung durchlaufen
und danach ins Inhaltsfeld springen. Ein Feld MUST seinen Wert behalten, wenn ein anderes Feld
bearbeitet wird; ein Wert gilt, sobald das Feld verlassen wird. Die Veranlassung SHALL hinter dem
Textknopf „+ Veranlassung“ liegen.

#### Scenario: Funkspruch nachtragen
- **WHEN** jemand den Typ „Meldung“ lässt, im Feld Zeit „1912“, im Feld Von „Sanitätszug Musterstadt“ setzt, den Meldeweg „Funk“ wählt und den Inhalt erfasst
- **THEN** trägt der Eintrag 19:12, Von „Sanitätszug Musterstadt“, An die eigene Stelle und Meldeweg Funk

#### Scenario: Reihenfolge per Tastatur
- **WHEN** der Fokus im Feld Zeit steht und dreimal Tab gedrückt wird
- **THEN** steht der Fokus im Feld Meldeweg, beim vierten Tab im Inhalt

### Requirement: Fokus im ersten leeren Pflichtfeld
Beim Laden des ETB und nach jedem erfolgreichen Erfassen SHALL der Fokus im ersten leeren
Pflichtfeld der Feldzeile stehen, sonst im Inhalt.

#### Scenario: Fokus beim Laden
- **WHEN** das ETB mit Typ „Meldung“ und leerem Von geladen wird
- **THEN** steht der Fokus im Feld Von

#### Scenario: Alles vorbelegt
- **WHEN** das ETB mit Typ „Lage“ und gesetzter eigener Stelle geladen wird
- **THEN** steht der Fokus im Inhalt

### Requirement: Abweichende Ereigniszeit bleibt sichtbar
Weicht die Ereigniszeit eines Entwurfs um mindestens eine Minute von „jetzt“ ab, SHALL das Feld Zeit
in der Achtungsrolle stehen und die Fußzeile „Nachtrag · Ereignis vor n min“ nennen. Die
Ereigniszeit MUST stehen bleiben, bis sie im Feld geändert, geleert oder der Eintrag gesendet ist;
„Werte behalten“ übernimmt sie nie. Ein geleertes Feld Zeit SHALL wieder „jetzt“ gelten.

#### Scenario: Nachtrag
- **WHEN** um 19:26 im Feld Zeit 19:12 steht
- **THEN** steht das Feld in der Achtungsrolle, und die Fußzeile nennt „Nachtrag · Ereignis vor 14 min“

#### Scenario: Geleert
- **WHEN** das Feld Zeit geleert und verlassen wird
- **THEN** zeigt es wieder „jetzt“, und der Eintrag bekommt die Zeit des Erfassens

### Requirement: Enter im Inhalt kennt keine offenen Editoren
Enter im Inhaltsfeld MUST ausschließlich dem Tastaturvertrag der Zeigerart folgen. Kein Feld der
Erfassung MUST Enter im Inhalt sperren oder einen Zeilenumbruch einfügen lassen, wo der Vertrag
senden würde. Enter in einem Feld der Feldzeile SHALL dessen Wert übernehmen und in den Inhalt
springen, ohne zu senden.

#### Scenario: Nach dem Setzen der Zeit
- **WHEN** bei feinem Zeiger im Feld Zeit „1420“ getippt, mit Tab in den Inhalt gewechselt, „Pumpe läuft“ getippt und Enter gedrückt wird
- **THEN** entsteht der Eintrag mit 14:20, und der Inhalt enthält keinen Zeilenumbruch

#### Scenario: Enter im Feld Von
- **WHEN** im Feld Von ein Vorschlag mit Enter übernommen wird
- **THEN** steht der Fokus im Inhalt, und nichts ist gesendet

### Requirement: Entwurfsreiter und Vorschau nur bei Bedarf
Die Reiter der Entwürfe SHALL erst erscheinen, wenn mehr als ein Entwurf besteht; „+ weiterer
Entwurf“ legt einen weiteren an. „Vorschau“ SHALL nur angeboten werden, wenn der Inhalt
Formatierung trägt (Markdown-Auszeichnung, Liste, Verweis).

#### Scenario: Ein Entwurf
- **WHEN** genau ein Entwurf besteht
- **THEN** steht kein Reiterband über der Erfassung

#### Scenario: Reiner Text
- **WHEN** der Inhalt „Pumpe läuft“ lautet
- **THEN** steht kein Knopf „Vorschau“
