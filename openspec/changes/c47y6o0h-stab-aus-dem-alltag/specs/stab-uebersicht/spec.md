## ADDED Requirements

### Requirement: Stab ohne eigenes Navigationsziel
Der Stab SHALL keine eigene Seite in der Hauptanwendung haben. Das Modul `stab` MUST in diesen Teilen
fehlen:
- Icon-Rail, Modulmenü, Navigations-Drawer und Sprungpalette
- „Zuletzt besucht“
- der Wahl der Startseite eines Einsatzes

Als Freigabe SHALL es in den Modul-Einstellungen von Einsatz, Organisation und Einsatz-Vorlage
bleiben, mit der Beschreibung „Besetzung, Fachzugänge, Stabsmonitor“. Die alte Adresse
`/einsaetze/:id/stab` MUST dauerhaft auf die Einsatzdaten umleiten und das Paneel „Stab“ in den
Blick rollen. Eine gespeicherte Startseite `stab` MUST wie nicht gesetzt wirken.

#### Scenario: Kategorie Führung
- **WHEN** eine Person mit Stab-Freigabe die Kategorie Führung öffnet
- **THEN** steht dort kein Eintrag „Stab“

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab` aufruft
- **THEN** zeigt die App die Einsatzdaten mit dem Paneel „Stab“ im Blick, und „Zurück“ im Browser
  führt nicht erneut auf die alte Adresse

#### Scenario: Gespeicherte Startseite
- **WHEN** ein Einsatz die Startseite `stab` gespeichert hat und eine Person ihn öffnet
- **THEN** öffnet die App die Startseite, die ohne gespeicherten Wert gilt

#### Scenario: Freigabe bleibt schaltbar
- **WHEN** die Einsatzleitung die Modul-Einstellungen des Einsatzes öffnet
- **THEN** steht dort „Stab“ mit „Besetzung, Fachzugänge, Stabsmonitor“ und lässt sich ausblenden
  und auf eine Rolle beschränken

### Requirement: Besetzung im Paneel „Stab“ der Einsatzdaten
Mit Leserecht auf den Stab SHALL die Seite Einsatzdaten ein Paneel „Stab“ zeigen. Es enthält:
- je Sachgebiet S1 bis S6 eine Zeile mit Kennung, wirksamem Label und Besetzung als Statuschip mit
  Wort, ungekürzt
- im Kopf des Paneels den Besetzungsstand („4/6 besetzt“), sobald die Besetzung geladen ist; als
  besetzt zählt jedes Sachgebiet, das nicht „nicht vergeben“ ist

Ohne Freigabe des Stabs MUST das Paneel fehlen, und die Seite MUST keine Anfrage an den Stab
stellen. Solange die Besetzung nicht geladen ist, MUST das Paneel nichts über sie behaupten.
Scheitert das Laden ohne vorhandenen Stand, MUST ein Fehler mit Wiederholen stehen und keine Zeile
„nicht vergeben“ zeigen. Scheitert ein erneuter Abruf mit vorhandenem Stand, MUST das Paneel den
Stand als veraltet kennzeichnen.

Mit Schreibrecht auf den Stab SHALL jede Zeile die Aktion „Besetzung ändern“ tragen. Ihr
zugänglicher Name MUST Kennung und Label enthalten („Besetzung ändern – S4 Versorgung“). Ohne
Schreibrecht MUST die Aktion fehlen, und das Paneel MUST den Grund nennen. Das Paneel MUST bei
390 px Breite ohne waagerechten Überlauf bleiben.

#### Scenario: Besetzung ändern
- **WHEN** eine Person mit Schreibrecht im Paneel „Stab“ bei S4 auf „Besetzung ändern“ tippt
- **THEN** öffnet sich der Dialog der Besetzung von S4

#### Scenario: Nur Ansicht
- **WHEN** ein Beobachter die Einsatzdaten öffnet
- **THEN** trägt keine Zeile „Besetzung ändern“, und das Paneel nennt den Grund

#### Scenario: Stab ausgeblendet
- **WHEN** der Stab im Einsatz ausgeblendet ist
- **THEN** fehlt das Paneel „Stab“, und keine Anfrage geht an `…/stab`

#### Scenario: Mandantenlabel
- **WHEN** die Organisation das Label von `s4` auf „Versorgung (Logistik)“ gesetzt hat
- **THEN** heißt die Zeile „S4 · Versorgung (Logistik)“

## REMOVED Requirements

### Requirement: Raster der Sachgebiete
**Reason**: Die Stab-Seite entfällt (LLH-1452). Der Stab verlässt die tägliche Navigation.
**Migration**: Die Besetzung je Sachgebiet steht im Paneel „Stab“ der Einsatzdaten. Aufgaben und
Werkzeuge stehen auf der Startseite des Fachzugangs (Fähigkeit `stab-fachzugang`), die Übersicht
aller sechs Sachgebiete auf dem Stabsmonitor (Fähigkeit `stabsmonitor`).

### Requirement: Besetzung je Kachel
**Reason**: Die Kacheln entfallen mit der Stab-Seite.
**Migration**: „Besetzung im Paneel „Stab“ der Einsatzdaten“ in dieser Fähigkeit.

### Requirement: Werkzeuge je Sachgebiet
**Reason**: Die Werkzeuge stehen nicht mehr in der Hauptanwendung.
**Migration**: „Werkzeugmodule je Sachgebiet“ und „Startseite des Sachgebiets“ der Fähigkeit
`stab-fachzugang`.

### Requirement: Zustandszahl je Werkzeug aus ihrer Heimat
**Reason**: Die Zahlen ziehen mit den Werkzeugen um.
**Migration**: „Zustandszahl je Werkzeug aus ihrer Heimat“ der Fähigkeit `stab-fachzugang` und
„Zahlen je Sachgebiet vom Server“ der Fähigkeit `stabsmonitor`.
