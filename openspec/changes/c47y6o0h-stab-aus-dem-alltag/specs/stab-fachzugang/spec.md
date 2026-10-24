## Purpose

Der Fachzugang gibt jedem Sachgebiet S1–S6 des Stabs ein eigenes gekoppeltes Gerät, so wie die
UHS ihr Tablet hat. Wer im Stab S2 führt, arbeitet dort nur mit den Werkzeugen seines Sachgebiets.
Die Hauptanwendung bleibt frei vom Stab. Die Fähigkeit regelt die Funktionsansicht
`stab-sachgebiet`, ihre Schranke, ihre Hülle und die Startseite des Sachgebiets.

## ADDED Requirements

### Requirement: Ansicht Stab-Sachgebiet
Die Funktionsansicht `stab-sachgebiet` SHALL an genau ein Sachgebiet `s1` bis `s6` gebunden sein
und die Einsatzrolle Führungspersonal tragen. Die Kopplungsmaske SHALL sie als „Stab-Fachzugang“
anbieten, mit dem Sachgebiet als Pflichtangabe. Die Liste der Sachgebiete MUST S1 bis S6 mit dem
wirksamen Label der Organisation zeigen. Ein Sachgebiet SHALL mehrere gekoppelte Geräte haben
dürfen. Der Server MUST eine Kopplung mit 400 ablehnen, wenn das Sachgebiet fehlt oder unbekannt
ist.

#### Scenario: Koppeln
- **WHEN** die Einsatzleitung einen Stab-Fachzugang für „S2 · Lage“ koppelt
- **THEN** zeigt die Übersicht der Kopplungen das Gerät mit der Stelle „S2 · Lage“

#### Scenario: Ohne Sachgebiet
- **WHEN** die Einsatzleitung einen Stab-Fachzugang ohne Sachgebiet anlegen will
- **THEN** antwortet der Server mit 400

#### Scenario: Zwei Geräte für S1
- **WHEN** die Einsatzleitung zwei Stab-Fachzugänge für S1 koppelt
- **THEN** sind beide Kopplungen gültig

### Requirement: Werkzeugmodule je Sachgebiet
Jedes Sachgebiet SHALL genau diese Werkzeugmodule haben:
- S1: Personal, Einheiten, Bereitstellungsräume, Nachforderungen
- S2: Lagekarte, Lagemeldungen, Einsatztagebuch
- S3: Einsatzabschnitte, Aufträge, Meldungen
- S4: Nachforderungen, Verpflegung, Material
- S5: Presse
- S6: Fernmeldewesen

Die Werkzeuge sind diese Seiten:
- S5: „Presse“ und „Informationstelefon“
- S6: „Funkplan“, „Fernmeldeskizze“, „Sprechgruppen“ und „Kommunikationsplan“
- übrige Sachgebiete: je Werkzeugmodul dessen Modulseite

#### Scenario: Nachforderungen bei S1 und S4
- **WHEN** je ein Fachzugang S1 und S4 gekoppelt ist
- **THEN** führen beide das Werkzeug „Nachforderungen“ in dasselbe Modul

#### Scenario: Werkzeuge S6
- **WHEN** ein Fachzugang S6 startet
- **THEN** zeigt er die Werkzeuge Funkplan, Fernmeldeskizze, Sprechgruppen und Kommunikationsplan,
  und „Fernmeldeskizze“ öffnet die Darstellung Fernmeldeskizze des Funkplans

### Requirement: Volle Modulrechte nur in den Werkzeugmodulen
Ein Stab-Fachzugang SHALL jede Einsatzroute aufrufen dürfen, die einem Werkzeugmodul seines
Sachgebiets gehört. Lesen und Schreiben richten sich dabei nach den Regeln des Moduls für die
Rolle Führungspersonal. Darüber hinaus SHALL er lesen dürfen:
- den Einsatzkopf, die Modulfreigaben, die Modulzähler und den Live-Kanal
- die Besetzung des Stabs

Jede andere Route MUST 403 sein, auch eine, die später hinzukommt. Aktionen, die der Einsatzleitung
vorbehalten sind, MUST 403 sein, ebenso Einstellungen und Verwaltung. Modulfreigabe des Einsatzes
und der Organisation MUST zusätzlich gelten, wie bei jeder Ansicht.

#### Scenario: S2 schreibt ins ETB
- **WHEN** ein Fachzugang S2 einen ETB-Eintrag anlegt
- **THEN** speichert der Server ihn, und der Eintrag nennt Gerät und Sachgebiet

#### Scenario: S2 erteilt keinen Auftrag
- **WHEN** ein Fachzugang S2 einen Auftrag erteilen will
- **THEN** antwortet der Server mit 403

#### Scenario: S3 erteilt einen Auftrag
- **WHEN** ein Fachzugang S3 einen Auftrag erteilt
- **THEN** speichert der Server ihn

#### Scenario: S5 gibt keine Pressemitteilung frei
- **WHEN** ein Fachzugang S5 eine Pressemitteilung freigeben will
- **THEN** antwortet der Server mit 403, und die Oberfläche nennt die Einsatzleitung als zuständig

#### Scenario: Keine Personendaten außerhalb
- **WHEN** ein Fachzugang S1 die Personenliste der Betroffenen abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Werkzeugmodul ausgeblendet
- **WHEN** der Einsatz die Verpflegung ausblendet und ein Fachzugang S4 sie abruft
- **THEN** antwortet der Server mit 403, und die Startseite zeigt „Verpflegung“ nicht

### Requirement: Fachzugang setzt den Stab voraus
Ist der Stab im Einsatz ausgeblendet oder für Mitglieder gesperrt, MUST ein Stab-Fachzugang nur den
Einsatzkopf erreichen. Jede andere Einsatzroute MUST 403 sein. Das Gerät MUST dann statt der
Startseite den Hinweis „Stab in diesem Einsatz nicht freigegeben“ zeigen. Die Kopplungsmaske MUST
den Stab als gesperrt nennen.

#### Scenario: Stab nach dem Koppeln ausgeblendet
- **WHEN** die Einsatzleitung den Stab ausblendet, während ein Fachzugang S3 gekoppelt ist
- **THEN** zeigt das Gerät ohne Neuladen den Hinweis, und ein Abruf der Aufträge antwortet 403

### Requirement: Live und Zähler folgen dem Sachgebiet
Der Live-Kanal eines Stab-Fachzugangs SHALL nur Ereignisse der Werkzeugmodule seines Sachgebiets und
des Stabs liefern. Die Modulzähler SHALL nur für die Werkzeugmodule geliefert werden, einsatzweit.
Ein Fachzugang ist an keine Stelle des Einsatzes gebunden, die einen Ausschnitt verlangte.

#### Scenario: Kein ETB-Ereignis an S4
- **WHEN** im Einsatz ein ETB-Eintrag entsteht
- **THEN** erhält ein Fachzugang S4 dazu kein Live-Ereignis, ein Fachzugang S2 schon

### Requirement: Eigene Hülle ohne Hauptnavigation
Ein Stab-Fachzugang SHALL in einer eigenen Hülle laufen, die nur Startseite und Werkzeuge seines
Sachgebiets anbietet. Es gibt keine Modulleiste, keine Sprungpalette, kein Benutzermenü, keinen Ton
und keine Benachrichtigung. Die Hülle SHALL im Kopf das Sachgebiet mit wirksamem Label und die
Bezeichnung des Geräts zeigen. Werkzeuge öffnen die Seiten ihrer Module in der Hülle. Ein Sprung
einer solchen Seite in ein Modul außerhalb des Sachgebiets MUST fehlen oder gesperrt mit Grund
stehen. Die Hülle MUST bei 390 px Breite ohne waagerechten Überlauf bleiben.

#### Scenario: Werkzeug öffnen
- **WHEN** an einem Fachzugang S2 das Werkzeug „Einsatztagebuch“ getippt wird
- **THEN** zeigt die Hülle das ETB des Einsatzes, und der Weg zurück zur Startseite bleibt sichtbar

#### Scenario: Sprung aus dem Sachgebiet
- **WHEN** an einem Fachzugang S3 ein Auftrag auf eine Einheit verweist
- **THEN** führt der Name der Einheit nicht in das Modul Einheiten

### Requirement: Startseite des Sachgebiets
Die Startseite SHALL zeigen:
- als Überschrift Kennung und wirksames Label („S4 · Versorgung (Logistik)“)
- die Besetzung des Sachgebiets: nicht vergeben, bei der Einsatzleitung, Name, extern oder
  rückwärtig
- die Aufgaben des Sachgebiets mit der Fundstelle „FwDV 100 Anl. 2, S. n“
- die Werkzeuge als gleich große Bedienziele, die mindestens die Trefffläche der Dichtestufe halten
- den Termin der nächsten Lagebesprechung, sobald einer gesetzt ist, mit Zustand

Solange die Besetzung nicht geladen ist, MUST die Seite nichts über sie behaupten. Die Seite MUST
NOT die Besetzung ändern. Das geschieht im Paneel „Stab“ der Einsatzdaten.

Ein Werkzeug MUST die Freigabe seines Ziels übernehmen:
- ausgeblendet: Das Werkzeug fehlt.
- gesperrt: Das Werkzeug steht gesperrt mit sichtbarem Grund, ohne Sprung und ohne Zahl.

Ist der Termin der Lagebesprechung erreicht oder verstrichen, MUST die Seite ihn mit Ton und Wort
der Fähigkeit `lagebesprechung-vorbereitung` zeigen.

#### Scenario: Startseite S4
- **WHEN** ein Fachzugang S4 startet und die Organisation `s4` „Versorgung (Logistik)“ nennt
- **THEN** zeigt die Startseite „S4 · Versorgung (Logistik)“, die Besetzung, die Aufgabenzeile mit
  Fundstelle und die Werkzeuge Nachforderungen, Verpflegung und Material

#### Scenario: Handy
- **WHEN** die Startseite bei 390 px Breite geöffnet wird
- **THEN** stehen die Werkzeuge untereinander, und die Seite läuft nicht waagerecht über

### Requirement: Zustandszahl je Werkzeug aus ihrer Heimat
Ein Werkzeug der Startseite SHALL höchstens eine Zahl zeigen, und nur aus einer Quelle, die diese
Zahl schon führt. Die Seite MUST NOT selbst zählen. Die Quellen sind:
- Ein Modul, für das das Modulmenü einen Zähler führt, zeigt dieselbe Zahl mit derselben Bedeutung.
  Aufträge zeigen die offenen und nennen die überfälligen darunter. Sind Aufträge überfällig, MUST
  die Zahl als Achtung gekennzeichnet sein, mit Wort und nicht nur mit Farbe.
- „Presse“ zeigt die offenen Presseanfragen aus den Kennzahlen des Presse-Logs.
- „Informationstelefon“ zeigt die offenen Rückrufe aus der Zählung der Anrufe.
- „Funkplan“ zeigt die Zahl der Funkplan-Lücken, dieselbe wie im Kopf des Lücken-Paneels im
  Funkplan.
- Ein Werkzeug ohne solche Quelle zeigt keine Zahl.

Eine Null MUST als „0“ stehen. Fehlt die Quelle einer Zahl, MUST das Werkzeug zeigen, warum, und
MUST NOT „0“ zeigen:
- nicht freigegeben: „—“ mit Grund
- nicht geladen: einen unbekannten Stand mit Grund
- im Laden: den Ladezustand

Jede Zahl MUST live dem Stand ihrer Quelle folgen.

#### Scenario: Überfällige Aufträge
- **WHEN** zwei Aufträge offen sind, einer davon überfällig, und ein Fachzugang S3 seine Startseite
  zeigt
- **THEN** zeigt „Aufträge“ „2“ als Achtung und nennt „1 überfällig“

#### Scenario: Nachforderungen bei S1 und S4
- **WHEN** drei Nachforderungen offen sind, eine davon unterwegs
- **THEN** zeigt „Nachforderungen“ auf den Startseiten von S1 und S4 „3“ und nennt „1 unterwegs“

#### Scenario: Lücken im Funkplan
- **WHEN** der Funkplan in seinem Lücken-Paneel drei Lücken zählt
- **THEN** zeigt „Funkplan“ auf der Startseite S6 „3“

#### Scenario: Quelle nicht geladen
- **WHEN** der Abruf der Modulzähler scheitert
- **THEN** zeigen die Werkzeuge mit Modulzahl einen unbekannten Stand, keine „0“

#### Scenario: Live
- **WHEN** auf einem anderen Arbeitsplatz ein Auftrag erledigt wird
- **THEN** sinkt die Zahl an „Aufträge“ auf der Startseite S3 ohne Neuladen
