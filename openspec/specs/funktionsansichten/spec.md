# funktionsansichten Specification

## Purpose
Legt fest, welche Funktionsansichten ein gekoppeltes Gerät haben kann, was jede davon lesen und
schreiben darf und wie der Server diese Schranke durchsetzt.

## Requirements

### Requirement: Katalog der Funktionsansichten

Das System SHALL genau diese Funktionsansichten kennen: `uhs-tablet`, `uhs-laptop`,
`lagemonitor`, `betreuungsstelle`, `bereitstellungsraum`, `einsatzabschnitt` und `verpflegung`.
Die beiden UHS-Ansichten MUST an genau eine UHS des Einsatzes gebunden sein, `betreuungsstelle`
an genau eine Betreuungsstelle, `bereitstellungsraum` an genau einen Bereitstellungsraum und
`einsatzabschnitt` an genau einen Einsatzabschnitt. `verpflegung` MAY an genau eine
Verpflegungsstelle des Einsatzes gebunden sein; ohne Stelle MUST sie einsatzweit gelten
(LLH-1048). `lagemonitor` MUST an keine Stelle gebunden sein. Ein unbekannter Ansichtswert MUST
beim Anlegen einer Kopplung 400 sein, ebenso eine fehlende Stelle bei einer Ansicht mit
Pflichtstelle und eine angegebene Stelle beim Lagemonitor. Die Übersicht der Kopplungen MUST je
Ansicht die Art ihrer Stelle nennen und ob die Stelle Pflicht ist.

#### Scenario: Unbekannte Ansicht

- **WHEN** die Einsatzleitung eine Kopplung mit der Ansicht `kiosk` anlegt
- **THEN** antwortet der Server mit 400

#### Scenario: Alle Ansichten wählbar

- **WHEN** die Einsatzleitung die Kopplungsmaske öffnet
- **THEN** bietet sie alle sieben Ansichten an, jede mit der Stellenart, an die sie gebunden ist oder sein kann, oder ohne Stelle
- **AND** nennt sie die Stelle der Verpflegung als wahlweise, die der übrigen gebundenen Ansichten als Pflicht

#### Scenario: Gebundene Ansicht ohne Stelle

- **WHEN** die Einsatzleitung ein UHS-Tablet ohne Angabe einer UHS koppeln will
- **THEN** antwortet der Server mit 400

#### Scenario: Ungebundene Ansicht mit Stelle

- **WHEN** die Einsatzleitung einen Lagemonitor mit einer UHS koppeln will
- **THEN** antwortet der Server mit 400

#### Scenario: UHS aus fremdem Einsatz

- **WHEN** die Einsatzleitung eine UHS-Ansicht an eine UHS eines anderen Einsatzes binden will
- **THEN** antwortet der Server mit 404

### Requirement: Scope-Matrix

Die Ansichten `uhs-tablet`, `uhs-laptop` und `lagemonitor` SHALL genau die folgenden Rechte
haben, je Modul getrennt nach Lesen (L) und Schreiben (S). Was die Tabelle nicht nennt, MUST
verboten sein. „Eigene UHS“ heißt die UHS der Kopplung. Die übrigen Ansichten regelt je eine
eigene Anforderung („Ansicht Betreuungsstelle“, „Ansicht Bereitstellungsraum“, „Ansicht
Einsatzabschnitt“, „Ansicht Verpflegung“).

| Modul / Bereich | UHS-Tablet | UHS-Laptop | Lagemonitor |
| --- | --- | --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L | L | L |
| `unfallhilfsstellen`: eigene UHS mit Plätzen und Belegung | L | L | — |
| `unfallhilfsstellen`: Belegung (Eintritt, Wechsel in der eigenen UHS, Austritt), Platzverfügbarkeit | S | S | — |
| `unfallhilfsstellen`: Plätze anlegen, ändern, stornieren; Stammdaten der eigenen UHS; Anhänge der eigenen UHS | — | L/S | — |
| `unfallhilfsstellen`: Kräfte der eigenen UHS zuordnen, ad hoc erfassen, lösen | — | L/S | — |
| `unfallhilfsstellen`: UHS anlegen, Status wechseln, stornieren | — | — | — |
| `personen`: Personen der eigenen UHS | L | L | — |
| `personen`: Aufnahme in die eigene UHS, Stammdaten, Sichtung, Verbleib, Notizen, Verletzungen, Maßnahmen, Transport, Auswahl „Bestätigt von“ | S | S | — |
| `personen`: Export, Druck, Abgleich, Anhänge | — | — | — |
| `material`: Material der eigenen UHS | — | L | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | — | L/S | — |
| Lagemonitor-Lagebild (verdichtete Zahlen) | — | — | L |
| `lagekarte`, `gefahrenzonen`, `einsatzabschnitte` ohne personenbezogene Ebenen | — | — | L |
| alle übrigen Module, Einstellungen, Verwaltung | — | — | — |

Der Lagemonitor MUST NOT schreiben dürfen, in keinem Modul.

#### Scenario: Tablet liest das ETB nicht

- **WHEN** ein UHS-Tablet das ETB seines Einsatzes abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Tablet bearbeitet den Grundriss nicht

- **WHEN** ein UHS-Tablet in seiner UHS einen Platz anlegt
- **THEN** antwortet der Server mit 403

#### Scenario: Laptop bearbeitet den Grundriss

- **WHEN** ein UHS-Laptop in seiner UHS einen Platz anlegt
- **THEN** legt der Server den Platz an

#### Scenario: Laptop wechselt den UHS-Status nicht

- **WHEN** ein UHS-Laptop seine UHS auf „aufgelöst“ setzen will
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor schreibt nichts

- **WHEN** ein Lagemonitor irgendeine schreibende Anfrage an eine Einsatzroute schickt
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor liest keine Personen

- **WHEN** ein Lagemonitor die Personenliste oder eine UHS-Detailseite abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor zeigt Gefahrenzonen und Abschnittsflächen

- **WHEN** der Einsatz einen Absperrbereich, einen Evakuierungsbezirk, eine freie Skizze und einen Abschnitt mit Fläche hat
- **THEN** zeigt die Karte des Lagemonitors den Absperrbereich und die Fläche des Abschnitts, aber weder den Bezirk noch die Skizze
- **AND** enthält die Antwort des Servers dafür weder Beschriftung und Notiz der Zone noch Leitung und Bemerkung des Abschnitts
- **AND** bleiben Zonenliste und Abschnittsliste für den Lagemonitor gesperrt (403), denn sie tragen Notizen und Leiternamen

#### Scenario: Tablet markiert eine Verletzung

- **WHEN** ein UHS-Tablet an einer Person seiner UHS eine Verletzung markiert
- **THEN** speichert der Server sie

### Requirement: Stellenbindung

Ein Gerät mit stellengebundener Ansicht SHALL nur Daten der eigenen UHS sehen und schreiben.
Eine fremde UHS MUST 404 sein. Eine Person MUST für das Gerät sichtbar sein, wenn sie mindestens
eine Belegung in der eigenen UHS hat, auch nach ihrem Austritt. Für die übrigen Stellenarten
gilt dasselbe Muster; was dort „eigene Stelle“ und „sichtbare Person“ heißt, regelt die
Anforderung der jeweiligen Ansicht.

#### Scenario: Fremde UHS

- **WHEN** das Tablet der UHS Nord die UHS Süd abruft
- **THEN** antwortet der Server mit 404

#### Scenario: UHS-Liste

- **WHEN** das Tablet der UHS Nord die UHS-Liste abruft
- **THEN** enthält sie nur die UHS Nord

#### Scenario: Person der anderen UHS

- **WHEN** das Tablet der UHS Nord eine Person abruft, die nie in der UHS Nord war
- **THEN** antwortet der Server mit 404

#### Scenario: Verbleib nach Austritt

- **WHEN** eine Person die UHS Nord verlassen hat
- **AND** das Tablet der UHS Nord ihren Verbleib einträgt
- **THEN** speichert der Server den Verbleib

#### Scenario: Belegung in fremde UHS

- **WHEN** das Tablet der UHS Nord eine Person in die UHS Süd buchen will
- **THEN** antwortet der Server mit 403

### Requirement: Aufnahme bucht in die eigene UHS

Legt ein UHS-Gerät eine Person an, SHALL der Server sie im selben Schritt in den Eingang der
eigenen UHS buchen. Beides MUST gemeinsam gelingen oder gemeinsam scheitern.

#### Scenario: Aufnahme am Tablet

- **WHEN** das Tablet der UHS Nord eine Person aufnimmt
- **THEN** steht die Person im Eingang der UHS Nord
- **AND** erscheint sie in der Patientenliste des Tablets

### Requirement: Schranke liegt auf dem Server

Der Server SHALL die Ansicht bei jeder Anfrage einer Gerätesitzung prüfen, unabhängig davon,
was die Oberfläche anbietet. Eine Route, die die Ansicht nicht ausdrücklich zulässt, MUST für
ein Gerät 403 sein; das gilt auch für jede künftig hinzukommende Route. Außerhalb des Einsatzes
MUST eine Gerätesitzung nur Anmeldestatus, Abmelden, Kartengrundlagen und das Branding der
Organisation erreichen.

#### Scenario: Route außerhalb des Einsatzes

- **WHEN** ein gekoppeltes Gerät die Benutzerverwaltung oder die Stammdaten abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Anderer Einsatz

- **WHEN** ein gekoppeltes Gerät einen anderen Einsatz als seinen eigenen abruft
- **THEN** antwortet der Server mit 404

#### Scenario: Neue Route ohne Zulassung

- **WHEN** eine neue Einsatzroute hinzukommt, die keine Ansicht zulässt
- **THEN** antwortet sie einem Gerät mit 403, ohne dass die Ansicht geändert wurde

### Requirement: Modulfreigabe gilt zusätzlich

Die Modulfreigabe des Einsatzes und der Organisation SHALL für ein Gerät zusätzlich zur Ansicht
gelten. Ein Gerät MUST behandelt werden wie ein Mitglied ohne System- und Org-Rolle. Beim Anlegen
einer Kopplung MUST die Maske sagen, welche Module der Ansicht gesperrt sind.

#### Scenario: Org sperrt Personen für Mitglieder

- **WHEN** die Organisation das Modul Personen nur für Führungskräfte freigibt
- **AND** die Einsatzleitung ein UHS-Tablet koppeln will
- **THEN** nennt die Maske das Modul Personen als gesperrt

### Requirement: Live-Kanal folgt der Ansicht

Der Live-Kanal eines Geräts SHALL nur Ereignisse der Module liefern, die seine Ansicht lesen
darf.

#### Scenario: Kein ETB-Ereignis am Tablet

- **WHEN** im Einsatz ein ETB-Eintrag entsteht
- **THEN** erhält ein UHS-Tablet dazu kein Live-Ereignis

### Requirement: Ansicht Bereitstellungsraum

Die Funktionsansicht `bereitstellungsraum` SHALL an genau einen Bereitstellungsraum des Einsatzes
gebunden sein und die Einsatzrolle Führungspersonal tragen. Sie SHALL genau diese Rechte haben;
was die Tabelle nicht nennt, MUST verboten sein. „Eigener BR“ heißt der BR der Kopplung. Das
Anlegen einer Kraft beim Eintreffen, unangemeldet oder aus einer Einheiten-Vorlage der
Organisation, ist die einzige Änderung an Einheiten und Fahrzeugen, die das Gerät darf; sie
verlangt wie am Desktop die Freigabe der Module Einheiten und Fahrzeuge. Abrufen ist eine Entscheidung der Führung: Das Gerät sieht einen Abruf und bestätigt
das Ausrücken als Austritt, ruft aber selbst nicht ab.

| Modul / Bereich | Bereitstellungsraum |
| --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L |
| `bereitstellungsraeume`: eigener BR mit Belegung, abgerufene Kräfte mit Ziel | L |
| `bereitstellungsraeume`: Verlauf der Belegung des eigenen BR | L |
| `bereitstellungsraeume`: Einheit oder Fahrzeug im eigenen BR anmelden (Eintritt, Wechsel herein), abmelden (Austritt), Ausrücken einer abgerufenen Kraft bestätigen (Austritt) | S |
| `bereitstellungsraeume`: Eintreffen am eigenen BR buchen, auch eine unangemeldete Kraft anlegen (Einheit mit Fahrzeugen, Meldung an die Einsatzleitung) oder eine Einheit aus einer Einheiten-Vorlage bilden (mit ihren Stamm-Fahrzeugen, ohne Besatzung und Material), auf Wunsch mit Verweis auf eine Nachforderung mit Ziel = eigener BR | S |
| `bereitstellungsraeume`: erwartete Kräfte aus Nachforderungen mit Ziel = eigener BR (Art, Anzahl, Stufe, offene Rufnamen, erwartetes Eintreffen) | L |
| `bereitstellungsraeume`: Stamm-Treffer zum eigenen BR (Suche ab drei Zeichen, höchstens zehn Einheiten-Vorlagen mit Name, Funkrufname, Typ, Zahl der Untereinheiten und Funkrufnamen der mitkommenden Fahrzeuge) | L |
| `nachforderungen`: Liste, Stufen, Zusage, Übernahme als Einheit | — |
| `bereitstellungsraeume`: eigenen BR in Betrieb nehmen (`geplant → aktiv`) | S |
| `bereitstellungsraeume`: Kräfte abrufen, Abruf zurücknehmen, in einen anderen BR verlegen | — |
| `bereitstellungsraeume`: BR anlegen, Stammdaten ändern, auflösen, stornieren | — |
| `einheiten`, `fahrzeuge`: Liste des Einsatzes | L |
| `einheiten`: Zeitachsen-Übersicht der Einheiten (Perioden je Einheit) | L |
| `einheiten`, `fahrzeuge`: Detail, Position, Ändern, Abschnitt oder Auftrag zuweisen, Übernehmen, Abweisen | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | L/S |
| `material`: Material des eigenen BR (Materialliste, auf den eigenen BR geschnitten) | L |
| `material`: zuordnen, lösen, Status setzen, ausgeben, aufteilen, erfassen | — |
| Stammdaten-Kataloge (`/api/einheit-vorlagen`, `/api/fahrzeuge`, …) | — |
| alle übrigen Module, Einstellungen, Verwaltung | — |

#### Scenario: Stamm-Treffer ohne Katalog

- **WHEN** das Gerät des BR Sportplatz `…/bereitstellungsraeume/{Sportplatz}/stamm-treffer?suche=florian`
  und danach `GET /api/einheit-vorlagen` abfragt
- **THEN** liefert die erste Anfrage die passenden Vorlagen und die zweite 403; am BR Schule
  antwortet `…/stamm-treffer` mit 404

#### Scenario: Material des eigenen BR

- **WHEN** am BR Sportplatz ein Lichtmast liegt, am BR Schule eine Trage und ein Stromerzeuger ohne
  Ort ist
- **AND** das Gerät des BR Sportplatz die Materialliste abruft
- **THEN** enthält sie nur den Lichtmast

#### Scenario: Material am Gerät nicht zuordnen

- **WHEN** das Gerät des BR Sportplatz einen Posten dem BR Sportplatz zuordnen oder vom BR
  Sportplatz lösen will
- **THEN** antwortet der Server mit 403
- **AND** bleibt der Ort des Postens unverändert

#### Scenario: Fremder BR

- **WHEN** das Gerät des BR Sportplatz den BR Schule abruft
- **THEN** antwortet der Server mit 404

#### Scenario: BR-Liste

- **WHEN** das Gerät des BR Sportplatz die BR-Liste abruft
- **THEN** enthält sie nur den BR Sportplatz

#### Scenario: Verlauf des eigenen BR

- **WHEN** das Gerät des BR Sportplatz den Verlauf des BR Sportplatz abruft
- **THEN** liefert der Server die Reihe der Belegungsereignisse des BR Sportplatz

#### Scenario: Verlauf eines fremden BR

- **WHEN** das Gerät des BR Sportplatz den Verlauf des BR Schule abruft
- **THEN** antwortet der Server mit 404

#### Scenario: Erwartete Kräfte des eigenen BR

- **WHEN** eine Nachforderung „2× RTW“ mit Ziel BR Sportplatz und Zusage „83-1“, „83-2“ unterwegs ist
- **AND** das Gerät des BR Sportplatz die erwarteten Kräfte abruft
- **THEN** nennt die Antwort Art, Anzahl, Stufe, die Rufnamen und das erwartete Eintreffen, aber weder Details, Begründung, Adressat noch Gründe
- **AND** die erwarteten Kräfte des BR Schule und die Nachforderungsliste bleiben dem Gerät verschlossen (404 bzw. 403)

#### Scenario: Wechsel im Verlauf des eigenen BR

- **WHEN** eine Einheit aus dem BR Schule in den BR Sportplatz wechselt
- **AND** das Gerät des BR Sportplatz den Verlauf des BR Sportplatz abruft
- **THEN** nennt der Eintrag des Wechsels die Bezeichnung „BR Schule“ als Herkunft
- **AND** bleiben Detail und Verlauf des BR Schule für das Gerät 404

#### Scenario: Einheit anmelden

- **WHEN** das Gerät des BR Sportplatz eine Einheit mit Eintritt in den BR Sportplatz bucht
- **THEN** steht die Einheit im BR Sportplatz

#### Scenario: Einheit in fremden BR buchen

- **WHEN** das Gerät des BR Sportplatz eine Einheit in den BR Schule bucht
- **THEN** antwortet der Server mit 404

#### Scenario: Einheit abmelden

- **WHEN** das Gerät des BR Sportplatz eine Einheit mit Austritt aus dem BR Sportplatz bucht
- **THEN** steht die Einheit in keinem BR mehr

#### Scenario: Abruf sehen

- **WHEN** die Einsatzleitung eine Einheit aus dem BR Sportplatz nach „EA Deich“ abruft
- **AND** das Gerät des BR Sportplatz danach seinen BR abruft
- **THEN** trägt die Einheit im Detail den Abruf mit dem Ziel „EA Deich“

#### Scenario: Ausrücken bestätigen

- **WHEN** das Gerät des BR Sportplatz für eine abgerufene Einheit den Austritt aus dem BR
  Sportplatz bucht
- **THEN** steht die Einheit in keinem BR mehr

#### Scenario: Abrufen am Gerät

- **WHEN** das Gerät des BR Sportplatz eine Einheit im BR Sportplatz abrufen oder einen Abruf
  zurücknehmen will
- **THEN** antwortet der Server mit 403, und nichts ist geschrieben

#### Scenario: Abruf am Tablet

- **WHEN** die Einsatzleitung eine Einheit aus dem BR Sportplatz abruft, während das Tablet des
  Raums die Seite zeigt
- **THEN** steht die Einheit am Tablet ohne Neuladen unter „Abgerufen“ mit „Ausrücken buchen“
- **AND** bietet das Tablet weder „Abrufen“ noch „Abruf zurücknehmen“ an und spielt keinen Ton

#### Scenario: Unangemeldete Kraft am Gerät

- **WHEN** das Gerät des BR Sportplatz am BR Sportplatz eine unangemeldete Kraft bucht
- **THEN** gibt es eine neue Einheit mit ihrem Fahrzeug im BR Sportplatz und eine Meldung an die Einsatzleitung

#### Scenario: Eintreffen am fremden BR

- **WHEN** das Gerät des BR Sportplatz ein Eintreffen am BR Schule bucht
- **THEN** antwortet der Server mit 404, und nichts ist angelegt

#### Scenario: Zeitachsen-Übersicht lesen

- **WHEN** das Gerät die Zeitachsen-Übersicht der Einheiten abruft
- **THEN** erhält es die Perioden je Einheit

#### Scenario: In Betrieb nehmen

- **WHEN** das Gerät seinen geplanten BR auf `aktiv` setzt
- **THEN** ist der BR aktiv

#### Scenario: Auflösen am Gerät

- **WHEN** das Gerät seinen aktiven BR auf `aufgeloest` setzt
- **THEN** antwortet der Server mit 403

#### Scenario: Einheit ändern

- **WHEN** das Gerät eine Einheit des Einsatzes ändert
- **THEN** antwortet der Server mit 403

#### Scenario: Übernehmen am Gerät

- **WHEN** das Gerät eine nicht übernommene Einheit übernehmen oder abweisen will
- **THEN** antwortet der Server mit 403

#### Scenario: Nur eigene Meldungen

- **WHEN** die Einsatzleitung und das Gerät je eine Meldung anlegen
- **AND** das Gerät die Meldungsliste abruft
- **THEN** enthält sie nur die Meldung des Geräts

#### Scenario: Widerruf

- **WHEN** die Einsatzleitung die Kopplung widerruft
- **AND** das Gerät danach seinen BR abruft
- **THEN** antwortet der Server mit 401

### Requirement: Ansicht Verpflegung

Die Funktionsansicht `verpflegung` SHALL ohne Stelle einsatzweit gelten oder an genau eine
Verpflegungsstelle gebunden sein (Anforderung „Verpflegungsgerät an einer Verpflegungsstelle“)
und die Einsatzrolle Führungspersonal tragen. Sie SHALL genau diese Rechte haben; was die Tabelle
nicht nennt, MUST verboten sein. Sie MUST keine Namen von Einsatzkräften oder Benutzern
erhalten. Nachschub stößt sie als Meldung an die Einsatzleitung an, nie als Nachforderung. Die
Verpflegungsstellen des Einsatzes MUST sie ohne Stelle alle lesen; beim Buchen einer Ausgabe MUST
sie dann eine Verpflegungsstelle wählen können. Stellen planen MUST sie nicht. Die Empfängerliste der
Verpflegung (Einheiten mit Name, Funkrufname, Gliederung, Abschnitt, Stärke und Eintreffen;
Abschnitte mit Name) MUST sie lesen und beim Buchen einen Empfänger daraus wählen können; daraus
MUST sie auch zeigen, welche Einheit in einem Zeitfenster noch nicht verpflegt ist.
Einheiten- und Abschnittsnamen gelten dabei nicht als Namen von Einsatzkräften; Namen von
Einheitsführern und Mitgliedern MUST sie weiterhin nicht erhalten. Die Einheitenliste des
Einsatzes MUST ihr verschlossen bleiben.

| Modul / Bereich | Verpflegung |
| --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L |
| `verpflegung`: Zeitfenster mit Bedarf, Ausgaben und Deckung | L |
| `verpflegung`: Verpflegungsstellen mit Art, Standort und Status | L |
| `verpflegung`: Empfängerliste (Einheiten und Abschnitte ohne Personenangaben) | L |
| `verpflegung`: Ausgabe buchen (ohne Bezug auf eine Nachforderung, optional an einer Verpflegungsstelle und an eine Einheit oder einen Abschnitt), Ausgabe zurücknehmen | S |
| `verpflegung`: Zeitfenster anlegen, ändern, löschen, Stellen zuordnen | — |
| `verpflegung`: Verpflegungsstelle anlegen, ändern, in Betrieb nehmen, auflösen, stornieren | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | L/S |
| `einheiten`, `nachforderungen`, `personal`, `betreuung`, `personen`, `etb` | — |
| alle übrigen Module, Einstellungen, Verwaltung | — |

Die Modulzähler eines Geräts MUST keine einsatzweiten Zähler für `meldungen` und `personen`
enthalten, auch ohne Stellenbindung. Eigene Meldungen MUST ohne die Namen von Bearbeiter und
Bestätiger kommen, der Einsatzkopf ohne Sachverhalt, meldende Stelle und Ortsangabe (wie beim
Lagemonitor).

#### Scenario: Ohne Stelle einsatzweit

- **WHEN** die Einsatzleitung ein Verpflegungsgerät ohne Stelle koppelt
- **THEN** koppelt der Server es einsatzweit, und es sieht alle Zeitfenster, Stellen und Ausgaben wie bisher

#### Scenario: Portionen buchen

- **WHEN** das Verpflegungsgerät zum Zeitfenster „Mittag“ eine Ausgabe von 40 EP bucht
- **THEN** steigt die ausgegebene Menge des Zeitfensters um 40, und die Antwort nennt keinen Namen

#### Scenario: Ausgabe auf eine Nachforderung

- **WHEN** das Verpflegungsgerät eine Ausgabe mit Bezug auf eine Nachforderung bucht
- **THEN** antwortet der Server mit 403, gleich ob es die Nachforderung gibt

#### Scenario: Planen am Gerät

- **WHEN** das Verpflegungsgerät ein Zeitfenster anlegt, ändert oder löscht
- **THEN** antwortet der Server mit 403

#### Scenario: Kein Personal

- **WHEN** das Verpflegungsgerät Personal, Betreuung oder die Nachforderungen abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Fehlmenge melden

- **WHEN** das Verpflegungsgerät bei einem Zeitfenster mit Fehlmenge „Fehlmenge melden“ wählt und absendet
- **THEN** entsteht eine Meldung an die Einsatzleitung mit Zeitfenster, Fehlmenge, Bedarf und ausgegebener Menge, und keine Nachforderung

#### Scenario: Bearbeitete Meldung ohne Namen

- **WHEN** die Einsatzleitung eine Meldung des Verpflegungsgeräts an sich nimmt und bestätigt
- **AND** das Gerät seine Meldungen abruft
- **THEN** steht die Meldung als bestätigt da, ohne den Namen der Bearbeiterin oder des Bestätigers

#### Scenario: Live-Kanal

- **WHEN** im Einsatz eine Ausgabe gebucht wird und ein ETB-Eintrag entsteht
- **THEN** erhält das Verpflegungsgerät das Verpflegungsereignis und kein ETB-Ereignis

#### Scenario: Widerruf

- **WHEN** die Einsatzleitung die Kopplung widerruft
- **AND** das Gerät danach eine Ausgabe bucht
- **THEN** antwortet der Server mit 401

#### Scenario: Stellen lesen

- **WHEN** das Verpflegungsgerät die Verpflegung seines Einsatzes abruft
- **THEN** erhält es alle nicht stornierten Verpflegungsstellen mit Bezeichnung, Art, Standort und Status, aber keine Namen und keine Benutzerkennungen

#### Scenario: Buchen an einer Stelle

- **WHEN** das Verpflegungsgerät eine Ausgabe von 40 EP an der Stelle „Ausgabe Turnhalle Nord“ bucht
- **THEN** trägt die Ausgabe diese Stelle, und die ausgegebene Menge der Stelle steigt um 40

#### Scenario: Stellen planen am Gerät

- **WHEN** das Verpflegungsgerät eine Verpflegungsstelle anlegt, ändert, in Betrieb nimmt, auflöst oder storniert oder einem Zeitfenster Stellen zuordnet
- **THEN** antwortet der Server mit 403

#### Scenario: Empfängerliste ohne Führernamen

- **WHEN** das Verpflegungsgerät die Verpflegung abruft und die Einheit „2. Gruppe“ einen Einheitsführer und Personal hat
- **THEN** enthält die Antwort den Namen „2. Gruppe“ und ihre Stärke, aber weder den Namen des Einheitsführers noch ihre Verbindungen noch Namen von Mitgliedern

#### Scenario: Keine Einheitenliste

- **WHEN** das Verpflegungsgerät die Einheitenliste des Einsatzes abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Buchen an eine Einheit

- **WHEN** das Verpflegungsgerät eine Ausgabe von 9 EP an die Einheit „2. Gruppe“ bucht
- **THEN** trägt die Ausgabe die Einheit, und die Antwort nennt keinen Namen einer Person

#### Scenario: Noch nicht verpflegt am Gerät

- **WHEN** das Verpflegungsgerät die Ausgabeansicht von „Mittag“ öffnet
- **THEN** zeigt es, welche Einheiten noch nicht verpflegt sind, mit Name, Stärke und Abschnitt aus der Empfängerliste, und ruft die Einheitenliste nicht ab

#### Scenario: Einheit kommt live dazu

- **WHEN** an einem anderen Arbeitsplatz eine Einheit gebildet wird, während das Verpflegungsgerät verbunden ist
- **THEN** erhält das Gerät das Ereignis `einheit` und lädt die Verpflegung neu, ohne Zugriff auf das Modul Einheiten zu bekommen

### Requirement: Verpflegungsgerät an einer Verpflegungsstelle

Ist ein Verpflegungsgerät an eine Verpflegungsstelle gebunden (LLH-1048), SHALL es nur die
Zeitfenster sehen, die dieser Stelle zugeordnet sind, und die einsatzweiten ohne Zuordnung. Ein
Zeitfenster, das nur anderen Stellen zugeordnet ist, MUST für das Gerät 404 sein. Bedarf,
ausgegebene Menge und Fehlmenge MUST die Werte des ganzen Zeitfensters bleiben; im Einzelnen MUST
das Gerät nur die eigene Stelle sehen: ihre Ausgaben, ihren Eintrag der Aufstellung je Stelle, ihre
Zuordnung und in der Stellenliste nur sie. Was in einem sichtbaren Zeitfenster anderswo (an einer
anderen Stelle oder ohne Stelle) an Einheiten ausgegeben wurde, MUST es als Summe je Einheit
erhalten, nur mit Kennung der Einheit und Menge, ohne Zurückgenommenes. Jede Ausgabe des Geräts
MUST an seiner Stelle gebucht werden: ohne Angabe setzt der Server sie, eine andere Stelle MUST 403
sein. Eine Ausgabe, die nicht an seiner Stelle gebucht ist, MUST es nicht zurücknehmen können
(404). Ein Replay über `client_id` MUST die gespeicherte Ausgabe liefern, auch wenn das
Zeitfenster inzwischen nicht mehr an der Stelle gilt. Die Empfängerliste MUST einsatzweit bleiben.
Wird die Stelle aufgelöst, MUST die Kopplung bestehen bleiben wie bei den übrigen Stellengeräten;
für Ausgaben gilt die Regel der aufgelösten Stelle (`kraefte-verpflegung`, „Ausgabe an einer
Verpflegungsstelle“). Die Kopplung MUST nur eine geplante oder aktive Stelle des eigenen Einsatzes
annehmen: eine Stelle eines anderen Einsatzes oder eine unbekannte 404, eine stornierte 409, eine
aufgelöste 422. Solange eine laufende Kopplung an einer geplanten Stelle hängt, MUST deren Storno
409 sein („Gerät gekoppelt“). In der Oberfläche MUST der Kopf des Geräts die Stelle nennen und
eine Umbenennung ohne neue Anmeldung zeigen; die Ausgabeansicht und der Nachtrag MUST die Stelle
fest als Text zeigen statt einer Wahl (`kraefte-verpflegung`, „Ausgabeansicht eines
Zeitfensters“), und „Noch nicht verpflegt“ MUST die Summe anderswo verrechnen
(`kraefte-verpflegung`, „Noch nicht verpflegt“).

#### Scenario: Nur die eigenen Zeitfenster

- **WHEN** das Gerät der Feldküche die Verpflegung abruft und es Zeitfenster der Feldküche, der Turnhalle und ohne Zuordnung gibt
- **THEN** enthält die Antwort die Zeitfenster der Feldküche und das ohne Zuordnung, aber nicht das der Turnhalle, und als Stelle nur die Feldküche

#### Scenario: Zeitfenster einer fremden Stelle

- **WHEN** das Gerät der Feldküche eine Ausgabe zu einem Zeitfenster bucht, das nur der Turnhalle zugeordnet ist
- **THEN** antwortet der Server mit 404 und legt nichts an

#### Scenario: Buchen ohne Angabe

- **WHEN** das Gerät der Feldküche eine Ausgabe ohne Stelle bucht
- **THEN** trägt die Ausgabe die Feldküche

#### Scenario: Buchen an einer fremden Stelle

- **WHEN** das Gerät der Feldküche eine Ausgabe an der Turnhalle bucht
- **THEN** antwortet der Server mit 403 und legt nichts an

#### Scenario: Anderswo verpflegt

- **WHEN** zum Zeitfenster „Abend“ der Feldküche und der Turnhalle die „1. Gruppe“ 30 EP an der Turnhalle und 10 EP ohne Stelle bekommen hat
- **AND** das Gerät der Feldküche die Verpflegung abruft
- **THEN** sieht es diese Ausgaben nicht einzeln, aber für die „1. Gruppe“ 40 EP anderswo
- **AND** bleibt die ausgegebene Menge des Zeitfensters die Summe aller Ausgaben

#### Scenario: Fremde Ausgabe zurücknehmen

- **WHEN** das Gerät der Feldküche eine Ausgabe der Turnhalle zurücknehmen will
- **THEN** antwortet der Server mit 404

#### Scenario: Stelle aufgelöst

- **WHEN** die Einsatzleitung die Feldküche auflöst
- **THEN** bleibt das Gerät gekoppelt und liest weiter
- **AND** antwortet der Server auf eine neue Ausgabe mit 409, eine vor der Auflösung gezählte nimmt er an

#### Scenario: Kopf nennt die Stelle

- **WHEN** das Gerät an der Feldküche gekoppelt ist und die Einsatzleitung sie in „Feldküche Festwiese“ umbenennt
- **THEN** zeigt der Kopf des Geräts erst „Feldküche BR Sportplatz“ und danach ohne neue Anmeldung „Feldküche Festwiese“

#### Scenario: Stelle mit Gerät stornieren

- **WHEN** die Einsatzleitung die geplante Feldküche stornieren will, an der das Gerät gekoppelt ist
- **THEN** antwortet der Server mit 409 „Gerät gekoppelt“, und die Stelle bleibt

#### Scenario: Stornierte Stelle koppeln

- **WHEN** die Einsatzleitung ein Verpflegungsgerät an eine stornierte Verpflegungsstelle koppeln will
- **THEN** antwortet der Server mit 409

### Requirement: Ansicht Betreuungsstelle

Die Funktionsansicht `betreuungsstelle` SHALL an genau eine Betreuungsstelle gebunden sein, die
Einsatzrolle Führungspersonal tragen und genau diese Rechte haben; was die Tabelle nicht nennt,
MUST verboten sein. Sichtbar MUST eine Person sein, die je mit Verbleib „Notunterkunft“ an der
eigenen Stelle war, auch nach ihrer Entlassung. Einsatzweite Modulzähler für `betreuung`,
`personen` und `meldungen` MUST das Gerät nicht erhalten.

| Modul / Bereich | Betreuungsstelle |
| --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L |
| `betreuung`: eigene Stelle mit Belegung und „davon namentlich“, Meldeverlauf der eigenen Stelle | L |
| `betreuung`: Belegung der eigenen Stelle melden, eine Belegungsmeldung der eigenen Stelle zurücknehmen | S |
| `betreuung`: Bezirke und Stände, Kopfzahl, Stelle anlegen, ändern, stornieren | — |
| `personen`: Personen der eigenen Stelle | L |
| `personen`: Aufnahme in die eigene Stelle, Stammdaten, Verbleib, Notizen | S |
| `personen`: Sichtung, UHS-Belegung, Export, Druck, Abgleich, Anhänge | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | L/S |
| alle übrigen Module, Einstellungen, Verwaltung | — |

#### Scenario: Nur die eigene Stelle

- **WHEN** das Gerät der Notunterkunft Nord die Betreuungsübersicht abruft
- **THEN** enthält sie nur die Notunterkunft Nord und keine Bezirke

#### Scenario: Fremde Stelle

- **WHEN** das Gerät der Notunterkunft Nord eine Belegung der Notunterkunft Süd meldet, deren Meldeverlauf abruft oder eine ihrer Belegungsmeldungen zurücknimmt
- **THEN** antwortet der Server mit 404

#### Scenario: Keine einsatzweiten Zähler

- **WHEN** das Gerät der Notunterkunft Nord die Modulzähler abruft
- **THEN** fehlen die Zähler für `betreuung`, `personen` und `meldungen`

#### Scenario: Stelle verwalten

- **WHEN** das Gerät die Kopfzahl abruft, seine Stelle ändert, eine Stelle anlegt oder storniert
- **THEN** antwortet der Server mit 403

#### Scenario: Aufnahme

- **WHEN** das Gerät der Notunterkunft Nord eine Person aufnimmt
- **THEN** ist die Person „betroffen“ mit Verbleib „Notunterkunft“ an der Notunterkunft Nord
- **AND** bleibt die gemeldete Belegung der Stelle gleich, und „davon namentlich“ steigt um eins

#### Scenario: Aufnahme mit Sichtung

- **WHEN** das Gerät eine Person mit Sichtung oder mit UHS aufnehmen will
- **THEN** antwortet der Server mit 403

#### Scenario: Person einer anderen Stelle

- **WHEN** das Gerät eine Person abruft, die nie mit Verbleib „Notunterkunft“ an der eigenen Stelle war
- **THEN** antwortet der Server mit 404

#### Scenario: Fremde Notunterkunft

- **WHEN** das Gerät einer Person den Verbleib „Notunterkunft“ an einer anderen Stelle oder ohne Stelle gibt
- **THEN** antwortet der Server mit 403

#### Scenario: Widerruf

- **WHEN** die Einsatzleitung die Kopplung widerruft
- **AND** das Gerät danach seine Stelle abruft oder eine Belegung meldet
- **THEN** antwortet der Server mit 401

### Requirement: Ansicht Einsatzabschnitt

Die Funktionsansicht `einsatzabschnitt` SHALL an genau einen Einsatzabschnitt gebunden sein,
die Einsatzrolle Führungspersonal tragen und genau diese Rechte haben; was die Tabelle nicht
nennt, MUST verboten sein. Der Bereich MUST der Teilbaum des eigenen Abschnitts samt seiner
Einheiten sein, bei jeder Anfrage neu bestimmt. Löst die Einsatzleitung den Abschnitt auf, MUST
die Kopplung enden. Einsatzweite Modulzähler für `einsatzabschnitte`, `einheiten`, `auftraege`,
`betreuung`, `personen` und `meldungen` MUST das Gerät nicht erhalten; sie verrieten den Rest
des Einsatzes.

| Modul / Bereich | Einsatzabschnitt |
| --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L |
| `einsatzabschnitte`: eigener Abschnitt mit seinen Unterabschnitten | L |
| `einsatzabschnitte`: anlegen, ändern, Fläche setzen, auflösen | — |
| `einheiten`: Einheiten im Bereich | L |
| `einheiten`: anlegen, ändern, Status, Position | — |
| `auftraege`: Aufträge mit mindestens einem Empfänger im Bereich | L |
| `auftraege`: die eigene Empfängerzeile quittieren, Vollzug melden | S |
| `auftraege`: erteilen, abnehmen, Kennzahlen | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen (Absender aus dem Bereich), eigene Meldungen lesen | L/S |
| `lagekarte`: Gefahrenzonen des ganzen Einsatzes | L |
| `lagekarte`: Evakuierungsbezirke, Skizzen, Zonen anlegen, gespeicherte Kartenansichten | — |
| alle übrigen Module, Einstellungen, Verwaltung | — |

#### Scenario: Teilbaum

- **WHEN** das Gerät des Abschnitts Nord Abschnitte und Einheiten abruft
- **THEN** enthalten die Listen nur den Abschnitt Nord, seine Unterabschnitte und deren Einheiten

#### Scenario: Umgehängter Unterabschnitt

- **WHEN** die Einsatzleitung einen Unterabschnitt von Nord unter Süd hängt
- **THEN** sieht das Gerät des Abschnitts Nord dessen Einheiten bei der nächsten Anfrage nicht mehr

#### Scenario: Keine einsatzweiten Zähler

- **WHEN** das Gerät des Abschnitts Nord die Modulzähler abruft
- **THEN** fehlen die Zähler für `einsatzabschnitte`, `einheiten`, `auftraege` und `meldungen`

#### Scenario: Verwaltung am Gerät

- **WHEN** das Gerät einen Abschnitt ändert, einen Einheitenstatus setzt oder einen Auftrag erteilt
- **THEN** antwortet der Server mit 403

#### Scenario: Fremder Auftrag

- **WHEN** das Gerät einen Auftrag abruft, dessen Empfänger alle außerhalb des Bereichs liegen
- **THEN** antwortet der Server mit 404

#### Scenario: Quittieren nur die eigene Zeile

- **WHEN** ein Auftrag an eine Einheit des Bereichs und an den Abschnitt Süd geht
- **AND** das Gerät die Empfängerzeile des Abschnitts Süd quittieren will
- **THEN** antwortet der Server mit 404, und die eigene Zeile lässt sich quittieren

#### Scenario: Absender einer Meldung

- **WHEN** das Gerät eine Meldung ohne Absender anlegt
- **THEN** ist der eigene Abschnitt der Absender
- **AND** antwortet der Server mit 403, wenn als Absender ein Abschnitt oder eine Einheit außerhalb des Bereichs steht

#### Scenario: Zonen ohne Bezirke

- **WHEN** im Einsatz ein Absperrbereich, ein Evakuierungsbezirk und eine Skizze liegen
- **THEN** sieht das Gerät nur den Absperrbereich

#### Scenario: Aufgelöster Abschnitt

- **WHEN** die Einsatzleitung den Abschnitt des Geräts auflöst
- **THEN** antwortet der Server auf die nächste Anfrage des Geräts mit 401, und das ETB nennt das Gerät

#### Scenario: Widerruf

- **WHEN** die Einsatzleitung die Kopplung widerruft
- **AND** das Gerät danach seinen Abschnitt abruft
- **THEN** antwortet der Server mit 401
