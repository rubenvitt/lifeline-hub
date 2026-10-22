# kraeftebaum Specification

## Purpose
Das Meldebild zeigt die Kräfte als einen Baum: Einheit mit Untereinheiten, darunter ihre Fahrzeuge
mit Besatzung und Beladung, ihr Personal ohne Fahrzeug und ihr Material. Eine Baumlogik trägt
Schirm, Lagebericht-Text und Druck, damit jede Kraft genau einmal steht und die Stärke der
Elternzeile mit dem Seitenkopf übereinstimmt.

## Requirements
### Requirement: Gliederung des Kräftebaums

Das Meldebild SHALL die Kräfte als Baum zeigen: Einheiten mit ihren Untereinheiten als
eingerückte Kinder, unter jeder Einheit ihre Fahrzeuge mit Besatzung und Beladung, ihr Personal
ohne Fahrzeug und ihr Material als eine verdichtete Gruppenzeile. Die Beladung eines Fahrzeugs MUST
als Gruppenzeile „Beladung“ unter dem Fahrzeug nach seiner Besatzung stehen und MUST NOT zusätzlich
in der Material-Gruppe der Einheit zählen. Kräfte ohne Einheit und Material ohne Ort MUST unter
einer letzten Wurzel „Ohne Einheit“ mit derselben Unterstruktur stehen. Material an einer
Unfallhilfsstelle oder in einem Bereitstellungsraum MUST NOT im Baum stehen. Hat eine Einheit kein
Fahrzeug, MUST ihr Personal direkt unter ihr stehen. Ausfall in der Beladung eines eigenen
Fahrzeugs MUST die Einheit tönen wie Ausfall in ihrem Material.

#### Scenario: Zug mit Gruppen
- **WHEN** der Einheit „Zug 1“ die Gruppen „Gr 1“ und „Gr 2“ unterstellt sind
- **THEN** stehen beide eingerückt unter „Zug 1“ und nicht als eigene Wurzeln

#### Scenario: Besatzung unter dem Fahrzeug
- **WHEN** zwei Personen der Einheit das Fahrzeug „Florian 1-44-1“ besetzen und eine dritte kein Fahrzeug hat
- **THEN** stehen die beiden unter dem Fahrzeug und die dritte unter „Ohne Fahrzeug“

#### Scenario: Material verdichtet
- **WHEN** einer Einheit drei Materialposten zugeordnet sind, einer davon defekt
- **THEN** zeigt sie eine Zeile „Material · 3 Posten · 1 Ausfall“, aufklappbar zu den Posten

#### Scenario: Beladung unter dem Fahrzeug
- **WHEN** dem Fahrzeug „Florian 1-44-1“ der Einheit „Gr 1“ ein defekter Stromerzeuger zugeordnet ist
- **THEN** steht unter dem Fahrzeug nach der Besatzung „Beladung · 1 Posten · 1 Ausfall“, und „Gr 1“ ist als Problemzeile getönt

#### Scenario: Material an einer UHS
- **WHEN** 50 Wolldecken an der UHS „Turnhalle“ liegen
- **THEN** stehen sie weder unter einer Einheit noch unter „Ohne Einheit“

### Requirement: Material-Ausfall wie in der Materialliste

Den Ausfall der Material-Gruppenzeile SHALL dieselbe Zählung liefern wie die Materialverdichtung
der Materialliste (Spec `material-liste`, LLH-1093): Posten, nicht Mengen, deren Status im
Statusvertrag die Rolle Alarm oder Achtung trägt.

#### Scenario: Verbraucht und Desinfektion zählen mit
- **WHEN** einer Einheit vier Materialposten zugeordnet sind, einer defekt, einer verbraucht und einer mit „Desinfektion nötig“
- **THEN** nennt ihre Gruppenzeile 4 Posten und 3 Ausfall, so wie die Materialliste für dieselben Posten „3 Ausfall“ zählt

### Requirement: Jede Kraft genau einmal

Jede Kraft der Auswahl SHALL genau einmal im Baum stehen. Eine Person, die ein Fahrzeug einer
anderen Einheit besetzt oder deren Fahrzeug weggefiltert ist, MUST bei ihrer Einheit unter
„Ohne Fahrzeug“ stehen und „fährt auf <Funkrufname>“ tragen. Die Besatzung Ist eines Fahrzeugs
MUST alle Personen zählen, die es besetzen, auch fremde.

#### Scenario: Person auf fremdem Fahrzeug
- **WHEN** eine Person der Einheit A das Fahrzeug der Einheit B besetzt
- **THEN** steht sie einmal, bei A mit „fährt auf <Funkrufname>“, und das Fahrzeug von B zählt sie in seiner Besatzung Ist

Der Baum MUST nur aktive Kräfte zeigen: entlassene oder stornierte Personen und Fahrzeuge,
herausgenommenes Material und aufgelöste Einheiten MUST NOT darin stehen, auch nicht über eine
veraltete Bindung (Spec `kraefte-entlassung`). Eine Einheit, deren Über-Einheit aufgelöst ist,
MUST als eigene Wurzel stehen.

#### Scenario: Nur aktive Kräfte, aufgelöste Über-Einheit macht die Untereinheit zur Wurzel
- **WHEN** die Gruppe „Gr X“ unter „Zug 1“ aufgelöst ist, ihr Trupp noch auf sie zeigt und ein Fahrzeug von „Zug 1“ entlassen ist
- **THEN** stehen „Gr X“ und das entlassene Fahrzeug nirgends im Baum, der Trupp steht als eigene Wurzel, und jede aktive Kraft steht genau einmal

### Requirement: Stärke im Kräftebaum

Die Zeile einer Einheit SHALL ihre Stärke samt aller Untereinheiten zeigen. Die Summe der Stärken
der Wurzeln MUST der Stärke im Seitenkopf gleichen. Fahrzeug-, Personen- und Gruppenzeilen MUST
keine Stärke zeigen; ein Fahrzeug zeigt stattdessen seine Besatzung Ist und Soll. Verteilung der
Mittel und Tönung einer Einheit MUST nur ihre eigenen Mittel zählen.

#### Scenario: Kumulierte Elternzeile
- **WHEN** „Zug 1“ selbst 1/1/2 hat und ihre Gruppen 0/1/8 und 0/1/8
- **THEN** zeigt „Zug 1“ 1/3/18//22, jede Gruppe ihre eigene Stärke, und der Kopf zählt 1/3/18//22 einmal

### Requirement: Zeilenarten ohne Farbe unterscheidbar

Einheit, Fahrzeug, Person und Gruppenzeile SHALL sich durch Zeichen, Einzug und Schrift
unterscheiden, nicht nur durch Farbe oder ein Kürzel. Personen MUST ihre Stärkeposition (F, UF,
M) als Marke tragen, der Einheitsführer zusätzlich „EF“.

#### Scenario: Zeilenart im Graustufendruck
- **WHEN** das Meldebild in Graustufen gedruckt wird
- **THEN** ist jede Zeile als Einheit, Fahrzeug, Person oder Gruppe erkennbar

### Requirement: Einstiege aus dem Meldebild

Das Meldebild SHALL eine Lesefläche bleiben. Einheitenname, Funkrufname und Personenname MUST in
die Einheit-Ansicht, die Fahrzeugzeile bzw. die Personalzeile springen; fehlt das Recht auf das
Zielmodul, MUST der Name als Text stehen. Der Handstatus einer Einheit ohne Fahrzeug bleibt.

#### Scenario: Sprung zur Fahrzeugzeile
- **WHEN** die Person im Meldebild den Funkrufnamen „Florian 1-44-1“ wählt
- **THEN** öffnet sich die Fahrzeugseite mit dieser Zeile hervorgehoben

#### Scenario: Modul gesperrt
- **WHEN** die Person kein Leserecht auf Personal hat
- **THEN** stehen Personennamen als Text ohne Sprung

### Requirement: Ausklappstufen

Das Meldebild SHALL drei Ausklappstufen bieten: „Einheiten“ (Untereinheiten sichtbar),
„mit Fahrzeugen“ (zusätzlich Fahrzeuge, Personal ohne Fahrzeug und Material) und „alles“. Beim
Öffnen MUST „Einheiten“ gelten, der Druck MUST alles aufklappen. Die Stufe MUST NOT die Zeilen
filtern, nur auf- und zuklappen.

#### Scenario: Vorgabe beim Öffnen
- **WHEN** die Person das Meldebild öffnet
- **THEN** sind Untereinheiten sichtbar und Fahrzeuge zugeklappt

### Requirement: Statusband ohne Füllkacheln

Das Statusband SHALL die Einheiten je FMS-Status und das Personal je Zustand als Zahl mit
Aufgliederung zeigen und MUST NOT leere Kacheln zum Auffüllen zeigen. „Keine Rückmeldung“ MUST nur
erscheinen, wenn es sie gibt.

#### Scenario: Wenige Status
- **WHEN** alle zwölf Personen gebunden sind
- **THEN** zeigt das Band „Personal 12“ mit einem Segment „gebunden“ und keine leere Kachel

### Requirement: Zulauf aus Nachforderungen

Das Statusband SHALL eine eigene Kennzahl „Zulauf“ zeigen, solange eine Nachforderung des Einsatzes
angefordert, zugesagt oder unterwegs ist (LLH-1384). Ihre Zahl MUST die Menge sein, die zugesagt
oder unterwegs ist; je Nachforderung ihre Anzahl, ohne Anzahl 1, abzüglich der schon als Einheit
übernommenen. Die Notiz MUST je Art, Stufe und erwartetem Eintreffen einen Eintrag nennen:
zugesagt „+n Art, Eintreffen HH:MM“, unterwegs „+n Art unterwegs, Eintreffen HH:MM“, angefordert
„n Art angefordert“ ohne Beitrag zur Zahl. Eingetroffene, abgelehnte und zurückgezogene
Nachforderungen MUST NOT zum Zulauf zählen. Der Zulauf MUST NOT in Stärke, Einheitenzahl oder
Personal zählen. Ist ein erwartetes Eintreffen verstrichen, MUST der Eintrag „überfällig“ tragen
und die Kennzahl im Ton „achtung“ stehen, ohne Ton, Toast oder Hinweis. Die Kennzahl MUST auf das
Board der Nachforderungen führen.

Ohne Freigabe des Moduls Nachforderungen MUST das Meldebild die Nachforderungen weder abrufen noch
die Kennzahl zeigen, auch nicht ohne Freitexte; ebenso, solange sie laden, gescheitert oder
gesperrt sind. Bei gesetztem Filter MUST der Zulauf entfallen: er gehört zu keiner Auswahl.

#### Scenario: Zwei RTW zugesagt
- **WHEN** eine Nachforderung „2× RTW“ mit erwartetem Eintreffen 15:30 zugesagt ist
- **THEN** zeigt das Statusband „Zulauf 2“ mit „+2 RTW, Eintreffen 15:30“
- **AND** die Stärke im Kopf bleibt unverändert

#### Scenario: Eingetroffen oder zurückgezogen
- **WHEN** die einzige offene Nachforderung als eingetroffen gemeldet oder zurückgezogen wird
- **THEN** entfällt die Kennzahl „Zulauf“

#### Scenario: Ohne Freigabe Nachforderungen
- **WHEN** eine Person das Meldebild liest, die das Modul Nachforderungen nicht lesen darf
- **THEN** fragt das Meldebild keine Nachforderungen ab, und das Statusband zeigt keinen Zulauf

### Requirement: Lagebericht-Text folgt dem Kräftebaum

Der Text, den „In Lagebericht übernehmen“ aus dem Meldebild erzeugt, SHALL dieselbe Gliederung
tragen wie der Schirm: Fahrzeug mit Besatzung und Beladung als Unterpunkte, Personal ohne Fahrzeug,
Material verdichtet, gegliedert nach Abschnitten.

#### Scenario: Besatzung im Text
- **WHEN** das Meldebild mit einem besetzten Fahrzeug übernommen wird
- **THEN** nennt der Text die Besatzung als Unterpunkt des Fahrzeugs

#### Scenario: Beladung im Text
- **WHEN** das Meldebild mit einem Fahrzeug übernommen wird, das zwei Posten geladen hat, einer davon defekt
- **THEN** nennt der Text unter dem Fahrzeug „Beladung: 2 Posten, 1 Ausfall“

### Requirement: Sprung auf eine Einheit

Das Meldebild SHALL einen Deeplink `?einheit=<id>` annehmen. Für eine aktive Einheit des
Einsatzes MUST es deren übergeordnete Einheiten und ihren Teilbaum bis zur Stufe „mit Fahrzeugen“
aufklappen, die Zeile ins Bild holen und sie nach Spec `deeplink-hervorhebung` markieren. Die
übrigen Zeilen MUST in der Vorgabestufe bleiben. Eine unbekannte oder fremde ID MUST die
Vorgabestufe ohne Markierung lassen.

#### Scenario: Nach dem Bilden aus einer Vorlage
- **WHEN** das Meldebild mit `?einheit=` eines gerade gebildeten Zugs öffnet
- **THEN** sind Zug, Staffel und ihre Fahrzeuge aufgeklappt, und die Zeile des Zugs ist markiert

#### Scenario: Unbekannte Einheit
- **WHEN** das Meldebild mit `?einheit=` einer nicht vorhandenen Einheit öffnet
- **THEN** zeigt es die Vorgabestufe „Einheiten“ ohne Markierung

### Requirement: Nicht übernommene Einheit im Kräftebaum
Eine unangemeldet erfasste Einheit, die die Führung noch nicht übernommen hat, SHALL in ihrer
Zeile des Kräftebaums hinter dem Namen das Wort „nicht übernommen“ tragen, in der Rolle Achtung
und ohne Blinken. Das Wort MUST auch im Druck und in Graustufen lesbar sein. Nach der Übernahme
oder dem Abweisen MUST das Wort entfallen. Dieselbe Marke MUST in der Gliederung der Einheiten
stehen.

#### Scenario: Unangemeldete Einheit im Meldebild
- **WHEN** am BR Sportplatz „FL-MUS 1-44-1“ unangemeldet gebucht wurde und die Führung das Meldebild öffnet
- **THEN** trägt die Zeile der Einheit „FL-MUS 1-44-1“ das Wort „nicht übernommen“

#### Scenario: Nach der Übernahme
- **WHEN** die Einsatzleitung die Einheit übernommen hat
- **THEN** trägt ihre Zeile im Kräftebaum das Wort nicht mehr
