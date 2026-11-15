# modul-benennung Specification

## Purpose
Ein Name je Modul aus der Modul-Registry, überall gleich; die Kurzbeschreibung als zweite Zeile in Modulmenü und Sprungpalette (LFH-965).

## Requirements

### Requirement: Ein Modul heißt überall wie im Menü

Das System SHALL für jedes Modul der Modul-Registry denselben Namen im Modulmenü, in der
Sprungpalette, im h1 seiner Seite, im letzten Eintrag des Ortspfads und im Tab-Titel zeigen, und
zwar das `label` der Registry. Kein Modulname SHALL englisch sein. Seiten, die einen Datensatz
zeigen, SHALL den Datensatz im h1 nennen und das Modul im Ortspfad. Ein Modul mit Reitern SHALL
das Modul im h1 nennen und den Reiter darunter, nicht umgekehrt.

#### Scenario: ETB

- **WHEN** eine Person das Modul ETB öffnet
- **THEN** lautet das h1 „ETB“, wie der Menüeintrag

#### Scenario: Lagebild

- **WHEN** eine Person das Lagebild öffnet
- **THEN** heißen Menüeintrag und h1 „Lagebild“, und die Uhrzeit des Lagebilds steht neben dem
  Titel, nicht in ihm

#### Scenario: Betroffene

- **WHEN** eine Person in der Sprungpalette „Betroffene“ sucht
- **THEN** findet sie das Modul unter diesem Namen, und die Seite trägt das h1 „Betroffene“

#### Scenario: Kräfteübersicht

- **WHEN** eine Person in der Sprungpalette „Kräfteübersicht“ sucht
- **THEN** findet sie das Modul unter diesem Namen, und die Seite trägt das h1 „Kräfteübersicht“

#### Scenario: Fernmeldewesen

- **WHEN** eine Person im Modul Fernmeldewesen den Reiter „Kommunikationsplan“ öffnet
- **THEN** lautet das h1 „Fernmeldewesen“ wie der Menüeintrag in der Kategorie Kommunikation, unter
  ihm steht der Reiter „Kommunikationsplan“ als gewählt, und die Zeile unter dem Menüeintrag lautet
  „Funkplan, Skizze, Kommunikationsplan“

#### Scenario: Nachforderungen

- **WHEN** eine Person die Kategorie Kräfte & Mittel öffnet
- **THEN** steht dort „Nachforderungen“ mit der Zeile „Anforderung, Zusage, Eintreffen“, das h1
  der Seite lautet „Nachforderungen“, und die Kategorie Kommunikation führt das Modul nicht mehr

#### Scenario: Nachforderungen in der Sprungpalette

- **WHEN** eine Person in der Sprungpalette „Anforderung“ sucht
- **THEN** findet sie das Modul „Nachforderungen“, und es öffnet unter der bisherigen Adresse

### Requirement: Modulbeschreibung als zweite Zeile

Jedes Modul der Registry SHALL eine Beschreibung aus wenigen Fachwörtern tragen, ohne Satz, ohne
Bedienung und ohne Technik. Das Modulmenü (Panel und Drawer) und die Sprungpalette SHALL sie unter
dem Modulnamen zeigen und den vollen Wortlaut im `title` tragen. Im Modulmenü SHALL sie bei
Platzmangel auf höchstens zwei Zeilen umbrechen und erst danach mit Auslassung enden; die
Sprungpalette zeigt sie in einer Zeile mit Auslassung. Der zugängliche Name des Eintrags SHALL der
Modulname bleiben.

#### Scenario: ETB im Menü

- **WHEN** eine Person die Kategorie Führung öffnet
- **THEN** steht „ETB“ direkt unter „Überblick“, und unter „ETB“ steht „Einsatztagebuch“

#### Scenario: Lange Beschreibung im Modulpanel

- **WHEN** eine Person bei 1440 px die Kategorie Führung öffnet
- **THEN** steht unter „Überblick“ „Kennzahlen, Fristen, Entscheidungen“ vollständig, und keine
  Beschreibung der Kategorie endet mit Auslassung

#### Scenario: Handy

- **WHEN** eine Person bei 390 px Breite das Modulmenü öffnet
- **THEN** stehen die Beschreibungen ohne waagrechten Überlauf und ohne Auslassung

### Requirement: Leere Lagemeldungen bieten das Erfassen an

Steht noch keine Lagemeldung in der Lage, SHALL die Seite Lagemeldungen „Lagemeldung erfassen“
zeigen und keinen Erklärsatz. Ohne Schreibrecht im Modul Meldungen SHALL sie stattdessen „Nur
Ansicht“ mit Grund zeigen.

#### Scenario: Neuer Einsatz

- **WHEN** eine Person mit Schreibrecht in einem neuen Einsatz die Lagemeldungen öffnet
- **THEN** steht unter „Noch keine Lagemeldungen“ der Knopf „Lagemeldung erfassen“, und er öffnet das Meldungsformular mit der Art „Lagemeldung“

### Requirement: Lagemeldungen und Meldungen unterscheiden sich im Symbol

Die Module Lagemeldungen und Meldungen SHALL verschiedene Symbole tragen. Das Modul Meldungen
SHALL „Meldungen“ heißen, ohne Zusatz zur Richtung, und die Beschreibung „Eingang, Ausgang,
Bearbeitung“ tragen; das Modul Lagemeldungen behält seinen Namen und trägt die Beschreibung
„Lagerelevante Meldungen“.

#### Scenario: Sprungpalette

- **WHEN** eine Person in der Sprungpalette „Meldungen“ sucht
- **THEN** tragen die beiden Treffer verschiedene Symbole, und sie heißen „Meldungen“ und „Lagemeldungen“

#### Scenario: Menü Kommunikation

- **WHEN** eine Person die Kategorie Kommunikation öffnet
- **THEN** steht dort „Meldungen“ mit der Zeile „Eingang, Ausgang, Bearbeitung“, und das h1 der Seite lautet „Meldungen“

### Requirement: Die Kräfteübersicht heißt nicht mehr Meldebild
Das Modul der Kräfte mit Schlüssel `kraefteuebersicht` SHALL überall sichtbar „Kräfteübersicht“
heißen: Menü, Seite, Druck, Lagebericht-Übernahme, Hilfe und Website. „Meldebild“ MUST als
Synonym in der Sprungpalette weiter treffen. Der Begriff „Sachverhalt / Meldebild“ der
Einsatzdaten MUST bleiben; er meint den gemeldeten Sachverhalt der Leitstelle.

#### Scenario: Menü und Seite
- **WHEN** eine Person die Kategorie Kräfte & Mittel öffnet und das erste Modul wählt
- **THEN** heißen Menüeintrag, h1 und Tab-Titel „Kräfteübersicht“

#### Scenario: Verweise auf das Modul
- **WHEN** eine Einheit in der Verdichtungszeile auf das Kräftemodul verweist
- **THEN** lautet der Verweis „Kräfteübersicht“

#### Scenario: Einsatzdaten bleiben
- **WHEN** eine Person die Einsatzdaten öffnet
- **THEN** heißt das Feld weiterhin „Sachverhalt / Meldebild“

#### Scenario: Hilfe-Adresse bleibt
- **WHEN** jemand ein Lesezeichen auf `/hilfe/meldebild` öffnet
- **THEN** zeigt die Hilfe das Kapitel „Kräfteübersicht und Kräfte-Zeitachse“

### Requirement: Die Kategorie der Betroffenen
Die Kategorie, die Betroffene, Unfallhilfsstellen, Evakuierung, Betreuung, Tiere und Schäden
führt, SHALL „Betroffene & Schäden“ heißen, damit sie nicht wie ihr Modul „Betroffene“ heißt. Ihr
Etikett in der Rail MUST in die Rail passen, ohne abzuschneiden.

#### Scenario: Rail
- **WHEN** eine Person die Rail am Fükw sieht
- **THEN** trägt die dritte Kategorie das Etikett „Betroffene“ oder eine Kurzform davon, vollständig sichtbar, und ihr zugänglicher Name lautet „Betroffene & Schäden“

#### Scenario: Kein doppelter Name
- **WHEN** eine Person die Kategorie „Betroffene & Schäden“ öffnet
- **THEN** heißt in der Navigation nur das Modul „Betroffene“, die Kategorie trägt einen anderen Namen

### Requirement: Die Hilfe gliedert wie die Navigation
Die Bereiche der Anwenderhilfe SHALL den Kategorien der Navigation folgen, in derselben
Reihenfolge und mit denselben Namen: Einstieg, Führung, Kräfte & Mittel, Betroffene & Schäden,
Lage, Kommunikation, Einstellungen und Verwaltung, Gekoppelte Geräte. Das Kapitel eines Moduls MUST
im Bereich der Kategorie seines Moduls stehen. Kapitel ohne eigenes Modul MUST einem Bereich
zugeordnet sein.

#### Scenario: ETB in der Hilfe
- **WHEN** eine Person die Hilfe öffnet
- **THEN** steht „Einsatztagebuch“ im Bereich „Führung“

#### Scenario: Nachforderung in der Hilfe
- **WHEN** eine Person den Bereich „Kräfte & Mittel“ der Hilfe aufklappt
- **THEN** steht dort das Kapitel „Nachforderung“

#### Scenario: Chat in der Hilfe
- **WHEN** eine Person den Bereich „Kommunikation“ der Hilfe aufklappt
- **THEN** stehen dort Chat, Erinnerungen, Meldungen, Fernmeldewesen und Informationstelefon
