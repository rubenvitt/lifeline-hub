# Proposal

## Why

Die Fernmeldeskizze (LFH-625) zeigt heute einen hängenden Baum aus Textkarten mit einer Kante je
Eltern-Kind-Paar. Eine taktische Fernmeldeskizze nach BBK „Taktische Zeichen im
Bevölkerungsschutz“, Anhang J.5, zeigt dagegen ein **Netz von Teilnehmern an gemeinsamen
Kanälen**: jede Sprechgruppe als Sammelschiene mit Bedingungszeichen, die Stellen als taktische
Zeichen, dazu Leitstelle, Polizei, Melder, Telefon und Daten, ein rückwärtiger Bereich und ein
Schriftfeld. Wer heute die Fernmeldeorganisation ändern will, geht Datensatz für Datensatz durch
Formularfelder; an der Skizze selbst lässt sich nichts ändern. S6 plant aber am Bild, auf Papier
oder an der Magnettafel. Seit LFH-849 gibt es die eigene Führungsstelle als Wurzel, seit LFH-848
die externen Stellen des Kommunikationsplans. Damit liegen die Daten für eine echte taktische
Skizze vor.

## What Changes

- **Darstellung nach BBK-Anhang J** (Schnitt 1, abgeleitet):
  - Jede Sprechgruppe des Einsatzes erscheint **einmal als Sammelschiene** mit Bedingungszeichen
    (Langsechseck mit Betriebsart und Bezeichnung, darunter der Hinweis). Jede Stelle mit dieser
    Sprechgruppe hängt mit einer Stichleitung daran. Wer an zwei Schienen hängt, ist sichtbar
    Übergang.
  - Führungsstelle und Abschnitte als **Führungsstellen-Kästen** mit taktischem Zeichen,
    Bezeichnung und Rufname; Einheiten als **taktische Zeichen ohne Kasten**.
  - **BREAKING (Spec):** Die Kante je Eltern-Kind-Paar, das Ein- und Ausklappen und der Baum als
    Knotenaufbau entfallen. Der Baum der Führungsorganisation bleibt die Vorlage des Auto-Layouts.
- **Schriftfeld und Druck** (Schnitt 2): Schriftfeld nach J.5 (Herausgeber, Titel, VS-Vermerk,
  „Gültig ab“, „gez.“, Stand). Druck auf A3 oder A4 quer, in Graustufen eindeutig, die
  Funkplan-Tabelle folgt als Anlage.
- **Zeichenfläche mit Layout** (Schnitt 3): Auto-Layout aus der Führungsorganisation beim ersten
  Öffnen, danach frei verschiebbar mit Raster. Verschobene Elemente behalten ihren Platz,
  „Neu anordnen“ stellt das Auto-Layout her. Zoomen, Verschieben der Ansicht, Hervorheben („Wer hört
  auf BN_BOS mit?“), Ebenenfilter.
- **Zuordnen am Bild** (Schnitt 4): Eine Stelle auf eine Schiene ziehen ordnet ihr die Sprechgruppe
  zu, eine Stichleitung lösen nimmt sie weg, mit Rückgängig. Gleichwertig per Tastatur über
  „Verbinden mit …“. Geschrieben wird **in dieselben Datensätze** wie heute (M:N aus Migration 0073
  bzw. 0145), Funkplan, Datensatz und andere Arbeitsplätze ändern sich live mit. Dafür bekommen
  Abschnitt, Einheit und Führungsstelle Endpunkte, die **eine** Zuordnung setzen oder lösen, statt
  die ganze Menge zu ersetzen.
- **Externe Stellen, Verbindungen, Komponenten, Bereich** (Schnitt 5):
  - Externe Stellen sind die **Stellen des Kommunikationsplans** (Leitstelle, Behörde,
    Verbindungsperson, sonstige). Sie bekommen Sprechgruppen; eine in der Skizze angelegte
    Leitstelle steht auch im Kommunikationsplan und umgekehrt.
  - Punkt-zu-Punkt-Verbindungen (Telefon, Fax, Daten, Melder, Richtfunk, Satellit u. a.) mit
    Medium (Funk oder leitergebunden), Status (bestehend oder geplant) und Betriebsart
    (Wechsel- oder Gegenverkehr).
  - Komponenten (Repeater, Gateway, Basisstation, mobile Basisstation, Antenne, Vermittlung), die an
    Schienen hängen können.
  - Ein rückwärtiger Bereich mit Strich-Punkt-Grenze.
  - „Geplant“ ist gestrichelt **und** trägt das Wort „geplant“, am Bildschirm und im Druck.
- **Lücken am Bild**: dieselben Lücken wie im Lücken-Paneel, als Wort und Zeichen am Element.
  Neu im Paneel aller drei Darstellungen: „Sprechgruppen mit nur einem Teilnehmer“. Die Lücke
  „Leitstelle“ des Kommunikationsplans wird die eine Regel für „keine Verbindung zur Leitstelle“
  und zählt künftig auch Sprechgruppe und Skizzen-Verbindung als Verbindung.
- **Übernahme als Kommunikationsunterlage** (Schnitt 6): Die bestehende Funkplan-Übernahme in den
  Lagebericht schreibt zusätzlich die Kanäle der Skizze als Text (je Sprechgruppe die Teilnehmer,
  dann die übrigen Verbindungen mit Status) und „Gültig ab“. Lageberichte bleiben Text ohne Bild.
- **Rechte:** Bearbeiten nur mit Schreibrecht. Je Element gilt das Recht seines Datensatzes
  (Abschnitte, Einheiten, Einsatzverwaltung für die Führungsstelle, Stab für alles Skizzeneigene).
  Mobil und ohne Schreibrecht nur lesen, hervorheben und zoomen.

## Capabilities

### New Capabilities

- `stab-fernmeldeskizze-bearbeitung`: Bearbeiten der Fernmeldeskizze am Bild: Zeichenfläche,
  Layout und Auto-Layout, Zuordnen und Lösen von Sprechgruppen, externe Stellen, Punkt-zu-Punkt-
  Verbindungen, Komponenten, Bereich, Schriftfeld, Rückgängig, Tastatur und Touch, Rechte,
  gleichzeitiges Bearbeiten.

### Modified Capabilities

- `stab-fernmeldeskizze`: Darstellung nach BBK-Anhang J statt Baum mit Kanten; Sammelschiene,
  Kästen und Zeichen, externe Stellen, Lücken am Bild, Schriftfeld, Druck quer mit Anlage,
  Erkunden. Abgelöst werden „Abgeleitet und live“, „Knotenaufbau wie das Organigramm“, „Kante mit
  gemeinsamer Sprechgruppe“, „Ein- und Ausklappen“, „Deeplinks statt Bearbeitung“ und „Skizze hält
  ihre Knoten …“.
- `stab-funkplan`: neue Lücke „Sprechgruppen mit nur einem Teilnehmer“ und die Lücke „Leitstelle“
  im Paneel; die Darstellung „Sprechgruppen“ nennt auch externe Stellen als Teilnehmer; die
  Übernahme in den Lagebericht schreibt die Kanäle der Skizze mit.
- `stab-kommunikationsplan`: Externe Stellen tragen Sprechgruppen; die Lücke „Leitstelle“ zählt
  auch Sprechgruppe und Skizzen-Verbindung; das Entfernen einer Stelle nennt auch ihre Kanäle und
  Skizzen-Verbindungen.

## Impact

- **Backend:** eine Migration (nächste freie Nummer beim Umsetzen, heute nach 0146) mit
  `einsatz_kommunikation_stelle_sprechgruppe` und den Skizzen-Tabellen für Lage, Komponente,
  Verbindung, Bereich und Schriftfeld. Neues Modul `src/stab/fernmeldeskizze.rs`, Routen unter
  `…/stab/fernmeldeskizze`. Neue Einzel-Zuordnungsendpunkte an Abschnitt, Einheit, Führungsstelle
  und Kommunikationsstelle. Neue Wire-Enums, Typ-Codegen, Schwärzungsregister (`gez.`-Name,
  Hinweise), Aufräumen der Skizzen-Bezüge beim Löschen von Abschnitt, Einheit und Stelle, Live über
  das bestehende Stab-Ereignis.
- **Frontend:** `stab/fernmeldeskizze.ts` wird das Netzmodell (Schienen, Stellen, Verbindungen),
  `stab/FernmeldeskizzeBild.tsx` die SVG-Zeichenfläche; neu Auto-Layout, Eigenschaftspaneel,
  Palette, Befehlsstapel für Rückgängig, Zeichen-Bausteine für Bedingungszeichen und
  Verbindungsarten, Druck-CSS. `stab/luecken.ts` bekommt die neuen Regeln, `stab/funkplan.ts` die
  Übernahme, `pages/FunkplanPage.tsx` zwei weitere Quellen. Keine neue Abhängigkeit
  (eigene SVG-Lösung auf `@dnd-kit/core`).
- **e2e:** Skizzen-Spec neu (Zuordnen per Ziehen und per Tastatur, Live, Druck in Graustufen,
  Rechte), Gate 1 und Gate 3 für die Fläche, Prüfliste Einsatztauglichkeit.
- **Nicht betroffen:** Modulfreigaben und Rollen, die Funkplan-Tabelle (Zeilen bleiben Abschnitt,
  Einheit, Fahrzeug), die technische Fernmeldeskizze (J.6).
