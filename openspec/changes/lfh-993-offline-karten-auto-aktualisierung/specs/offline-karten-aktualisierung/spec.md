# Spec Delta

## Purpose

Hält heruntergeladene Offline-Karten ohne Zutun aktuell, lässt einen Admin eine Aktualisierung
sofort anstoßen und zeigt in der Offline-Karten-Verwaltung, was gerade läuft, wann zuletzt
aktualisiert wurde und wann der nächste Lauf ansteht.

## ADDED Requirements

### Requirement: Der Hub lädt neuere Katalog-Stände selbst

Ist die automatische Aktualisierung eingeschaltet, MUST der Hub den Offline-Katalog im
eingestellten Abstand prüfen. Für jede heruntergeladene Karte im
Status `bereit`, für die der Katalog einen neueren lieferbaren Stand führt, MUST er diesen Stand
ohne Klick laden. Während des Ladens MUST die bisherige Karte ausgeliefert bleiben. Erst nach
vollständigem und verifiziertem Download SHALL die neue Datei sie ersetzen, unter derselben
Kennung. Es SHALL höchstens eine automatische Aktualisierung zur selben Zeit laufen. Karten, die
über einen eigenen Pfad registriert wurden oder keine Quell-URL tragen, MUST der Hub nicht
automatisch anfassen. Ist die automatische Aktualisierung ausgeschaltet, SHALL der Hub keine
Karte ohne Klick laden.

#### Scenario: Neuerer Stand wird ohne Klick geladen

- **WHEN** der Katalog für eine heruntergeladene, bereite Karte einen lieferbaren Stand mit
  anderer URL führt und die nächste Prüfung fällig ist
- **THEN** lädt der Hub diesen Stand, die Karte bleibt währenddessen ausgeliefert, und danach
  trägt dieselbe Karte den neuen Stand

#### Scenario: Gescheiterter Download lässt die alte Karte stehen

- **WHEN** eine automatische Aktualisierung scheitert (Netz, Prüfsumme, Plattenplatz)
- **THEN** bleibt die bisherige Karte bereit und ausgeliefert, und die Verwaltung zeigt den
  Fehler an dieser Karte

#### Scenario: Nur eine automatische Aktualisierung zur Zeit

- **WHEN** für zwei Karten gleichzeitig ein neuerer Stand vorliegt
- **THEN** lädt der Hub zuerst eine Karte und die zweite erst nach deren Ende

#### Scenario: Registrierte Karte bleibt unberührt

- **WHEN** eine über einen eigenen Pfad registrierte Karte denselben Namen trägt wie ein neuerer
  Katalogeintrag
- **THEN** lädt der Hub für sie nichts automatisch

#### Scenario: Automatik ausgeschaltet

- **WHEN** die automatische Aktualisierung ausgeschaltet ist
- **THEN** lädt der Hub keinen neueren Stand ohne Klick, und die Verwaltung zeigt die Automatik
  als aus

### Requirement: Ein Admin stellt die Automatik in der Verwaltung ein

Die Offline-Karten-Verwaltung MUST einem System-Admin erlauben, die automatische Aktualisierung
an- und auszuschalten und den Prüfabstand in ganzen Stunden zu wählen. Erlaubt sind 1 bis 168
Stunden. Die Einstellung MUST gespeichert werden, einen Neustart überstehen und ohne Neustart
wirken. Ist nichts gespeichert, MUST die Vorgabe des Betriebs gelten: Automatik an und 6 Stunden,
sofern die Server-Konfiguration nichts anderes setzt. Ein Prüfabstand außerhalb des erlaubten
Bereichs MUST mit 400 abgelehnt werden. Nicht-Admins MUST die Einstellung sehen, aber nicht ändern
können. Der Server MUST ihren Schreibversuch mit 403 ablehnen.

#### Scenario: Automatik ausschalten

- **WHEN** ein Admin die Automatik in der Verwaltung ausschaltet
- **THEN** lädt der Hub ab sofort keinen neueren Stand mehr ohne Klick, und nach einem Neustart
  ist sie weiter aus

#### Scenario: Prüfabstand ändern

- **WHEN** ein Admin den Prüfabstand von 6 auf 1 Stunde ändert und die letzte Prüfung über eine
  Stunde zurückliegt
- **THEN** prüft der Hub ohne Neustart sofort, und die nächste Prüfung steht danach eine Stunde
  später

#### Scenario: Ungültiger Prüfabstand

- **WHEN** ein Prüfabstand von 0 oder über 168 Stunden gespeichert werden soll
- **THEN** antwortet der Server mit 400, und die bisherige Einstellung bleibt

#### Scenario: Ohne gespeicherte Einstellung

- **WHEN** noch nie eine Einstellung gespeichert wurde
- **THEN** gelten die Vorgaben aus der Server-Konfiguration

#### Scenario: Führungskraft liest nur

- **WHEN** eine Führungskraft ohne System-Admin-Rolle die Verwaltung öffnet
- **THEN** sieht sie, ob die Automatik an ist und in welchem Abstand sie prüft, kann beides aber
  nicht ändern

### Requirement: Ein Neubau zählt auch bei gleicher URL als neuer Stand

Ein Katalogeintrag MUST als neuerer Stand einer Karte gelten, wenn er denselben Namen trägt,
lieferbar ist und entweder eine andere URL führt oder einen SHA256-Pin, der von der Prüfsumme der
installierten Datei abweicht. Ein nicht lieferbarer Eintrag (ohne Pin oder mit Platzhalter-URL)
MUST NOT als neuerer Stand gelten.

#### Scenario: Zweiter Bau am selben Tag

- **WHEN** die Region am selben Tag ein zweites Mal gebaut wurde, der Katalog also dieselbe URL
  mit einem anderen SHA256-Pin führt
- **THEN** gilt der Eintrag als neuerer Stand

#### Scenario: Gleiche URL und gleiche Prüfsumme

- **WHEN** URL und Pin des Katalogeintrags der installierten Karte entsprechen
- **THEN** gilt die Karte als aktuell

#### Scenario: Platzhalter ist nie ein Update

- **WHEN** der Katalogeintrag keinen Pin oder eine Platzhalter-URL trägt
- **THEN** gilt er nicht als neuerer Stand

### Requirement: Ein Admin stößt die Aktualisierung einer Karte sofort an

Die Verwaltung MUST einem System-Admin je heruntergeladener Karte mit Quell-URL die Aktion
„Jetzt aktualisieren“ anbieten. Sie gilt unabhängig davon, ob die Automatik an ist.

- Führt der Katalog bereits einen neueren Stand, MUST die Aktion ihn sofort laden, ohne neu zu
  bauen.
- Sonst MUST die Aktion, wenn der karten-service konfiguriert ist und die Region baut, einen
  Neubau anstoßen. Nach dessen Erfolg MUST der Hub den neuen Stand ohne weiteren Klick laden.
  Läuft für die Region schon ein Bau, MUST sich die Aktion daran anhängen, statt einen zweiten
  anzustoßen.
- Ohne karten-service, oder wenn die Region dort nicht baubar ist, MUST die Aktion den Katalog
  frisch prüfen und, wenn nichts Neueres vorliegt, „aktuell“ melden.

Läuft für die Karte schon eine Aktualisierung, MUST der Server mit 422 antworten. Für eine Karte
ohne Quell-URL oder eine registrierte Karte MUST er ebenfalls mit 422 antworten. Für Nicht-Admins
MUST er mit 403 antworten.

#### Scenario: Neubau und automatisches Laden

- **WHEN** ein Admin „Jetzt aktualisieren“ wählt, der Katalog nichts Neueres führt und der
  karten-service die Region baut
- **THEN** zeigt die Karte „Neubau wartet“ und dann „wird neu gebaut“, danach lädt der Hub den
  neuen Stand ohne weiteren Klick und tauscht ihn ohne Ausfall ein

#### Scenario: Neuerer Stand liegt schon vor

- **WHEN** ein Admin „Jetzt aktualisieren“ wählt und der Katalog schon einen neueren Stand führt
- **THEN** lädt der Hub diesen Stand sofort, und es wird nicht neu gebaut

#### Scenario: Bau läuft bereits

- **WHEN** ein Admin „Jetzt aktualisieren“ wählt, während der karten-service die Region schon baut
- **THEN** wird kein zweiter Bau angestoßen, und der Hub lädt nach dem laufenden Bau

#### Scenario: Ohne karten-service

- **WHEN** kein karten-service konfiguriert ist und der Katalog nichts Neueres führt
- **THEN** meldet die Verwaltung, dass die Karte aktuell ist

#### Scenario: Neubau scheitert

- **WHEN** der angestoßene Bau im karten-service scheitert
- **THEN** bleibt die bisherige Karte ausgeliefert, und die Verwaltung zeigt den Fehler an der
  Karte

#### Scenario: Doppelter Anstoß

- **WHEN** für die Karte schon ein Bau oder Download läuft und erneut angestoßen wird
- **THEN** antwortet der Server mit 422, und die Verwaltung bietet die Aktion währenddessen nicht an

### Requirement: Die Verwaltung zeigt, ob gerade aktualisiert wird

Die Offline-Karten-Verwaltung MUST je Karte zeigen, ob gerade eine Aktualisierung läuft, und in
welcher Phase: Neubau wartet, wird neu gebaut, lädt (mit Fortschritt). Das MUST auch für Bauten
gelten, die der Zeitplan des karten-service ausgelöst hat. Solange eine Phase läuft, MUST sich die
Anzeige ohne Neuladen der Seite fortschreiben. Ist die letzte Aktualisierung gescheitert, MUST die
Karte das zeigen und den Grund auf Nachfrage nennen, bis eine spätere Aktualisierung gelingt.

#### Scenario: Geplanter Bau ist sichtbar

- **WHEN** der karten-service nach seinem Zeitplan die Region einer installierten Karte baut
- **THEN** zeigt die Verwaltung an dieser Karte „wird neu gebaut“

#### Scenario: Download mit Fortschritt

- **WHEN** der Hub einen neueren Stand einer Karte lädt
- **THEN** zeigt die Karte „aktualisiert“ mit Fortschritt und bleibt als bereit ausgewiesen

#### Scenario: Fehler bleibt bis zum nächsten Erfolg

- **WHEN** die letzte Aktualisierung einer Karte gescheitert ist
- **THEN** zeigt die Karte „Update fehlgeschlagen“ mit dem Grund, bis eine spätere Aktualisierung
  gelingt

### Requirement: Die Verwaltung zeigt, wann eine Karte zuletzt aktualisiert wurde

Die Verwaltung MUST je Karte den Datenstand zeigen, soweit die Quell-URL ihn trägt, und den
Zeitpunkt, seit dem die aktuelle Datei auf dem Gerät liegt, in Ortszeit.

#### Scenario: Stand und Ankunft auf dem Gerät

- **WHEN** eine Karte mit datierter Quell-URL bereit ist
- **THEN** zeigt die Verwaltung „Stand“ mit dem Datum aus der URL und „auf dem Gerät seit“ mit
  dem Zeitpunkt des letzten erfolgreichen Downloads

#### Scenario: Nach einer Aktualisierung

- **WHEN** eine Aktualisierung der Karte erfolgreich war
- **THEN** zeigen „Stand“ und „auf dem Gerät seit“ den neuen Stand

### Requirement: Die Verwaltung zeigt die letzte und die nächste Prüfung

Die Verwaltung MUST über der Tabelle zeigen, ob die automatische Aktualisierung an ist, wann der
Hub zuletzt geprüft hat und wann er das nächste Mal prüft. Ist ein karten-service konfiguriert
und erreichbar, MUST sie auch den nächsten geplanten Kartenbau zeigen. Ist er nicht erreichbar,
MUST sie das sagen, und die übrige Verwaltung MUST bedienbar bleiben. Ist keiner konfiguriert,
MUST der Kartenbau-Teil entfallen. Zeiten MUST sie in Ortszeit zeigen. Lesen dürfen alle, die den
Admin-Bereich sehen. Schreiben darf nur der System-Admin.

#### Scenario: Automatik an, karten-service erreichbar

- **WHEN** die Automatik an ist und der karten-service seinen Zeitplan liefert
- **THEN** zeigt die Zeile die letzte Prüfung, die nächste Prüfung und den nächsten Kartenbau

#### Scenario: karten-service nicht erreichbar

- **WHEN** der karten-service konfiguriert, aber nicht erreichbar ist
- **THEN** sagt die Zeile, dass der Kartenbau-Dienst nicht erreichbar ist, und die Tabelle lädt
  normal

#### Scenario: Vor der ersten Prüfung nach dem Start

- **WHEN** der Hub seit dem Start noch nicht geprüft hat
- **THEN** zeigt die Zeile keine letzte Prüfung, aber die nächste

### Requirement: Der karten-service nennt seinen nächsten geplanten Lauf

Der karten-service MUST unter `GET /zeitplan` mit Bearer-Token den Zeitpunkt seines nächsten
geplanten Neubaus als absoluten Zeitpunkt (RFC 3339, UTC) liefern, dazu den Cron-Ausdruck. Ohne
gültiges Token MUST er mit 401 antworten.

#### Scenario: Zeitplan abfragen

- **WHEN** der Hub `GET /zeitplan` mit gültigem Token ruft
- **THEN** antwortet der karten-service mit dem nächsten Laufzeitpunkt und dem Cron-Ausdruck

#### Scenario: Ohne Token

- **WHEN** `GET /zeitplan` ohne oder mit falschem Token gerufen wird
- **THEN** antwortet der karten-service mit 401
