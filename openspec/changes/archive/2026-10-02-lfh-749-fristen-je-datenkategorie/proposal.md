# Proposal

## Why

Heute hat ein Einsatz genau eine Aufbewahrungsfrist. Läuft sie ab, werden alle
personenbezogenen Daten auf einmal geschwärzt. Die Recherche zu LFH-749 (Kommentare am Task,
02.10.2026) zeigt, dass das in einem Fall gegen das Gesetz verstößt und in einem zweiten nicht
zur Praxis passt:

- **Personenauskunft muss früh weg.** In NRW sind die Daten einer Auskunftsstelle „spätestens
  nach einem Monat zu löschen“ (§ 46 Abs. 5 S. 2 BHKG). Daten, die länger gebraucht werden,
  sind zu sperren (Abs. 6). Sachsen (§ 37 SächsBRKG) und der DRK-Suchdienst (§ 5 DRK-SDDSG)
  verlangen das Löschen, sobald der Zweck erfüllt ist.
- **Behandlungsdokumentation muss lange bleiben.** Für Sanitätsdienst, UHS und MANV-Sichtung
  gelten in der Praxis 10 Jahre, übertragen aus § 630f Abs. 3 BGB und § 10 Abs. 3 MBO-Ä. Der
  DRK-LV Saarland empfiehlt das ausdrücklich.
- **Bildaufnahmen** aus Drohnen sind in Niedersachsen spätestens nach zwei Monaten zu löschen
  (§ 32b Abs. 3 NKatSG).

Beide Zwecke hängen an derselben Personenzeile. Mit nur einer Frist kann eine Organisation
entweder die Monatsfrist der Auskunft reißen oder die Behandlungsdoku nach einem Monat mit
schwärzen. Eine feste Frist im Code löst das nicht: Das Recht unterscheidet sich je
Bundesland, je verantwortlicher Stelle (Behörde oder Hilfsorganisation) und je
Datenschutzregime (JUH und MHD unterliegen kirchlichem Recht). Fristen und Rechtsgrundlage
muss die Organisation selbst festlegen.

## What Changes

- **Drei Datenkategorien mit eigener Frist:**
  - `behandlung`: Zustand sowie die Notizen zu Sichtung, Verlauf und UHS-Belegung.
  - `personenauskunft`: Herkunftsadresse und Melderkontakt.
  - `anhaenge`: Dateien und Fotos samt ihrer Ablage als Dokument.

  Alle übrigen Daten folgen weiter der Frist des Einsatzes. ETB, Registriernummer sowie
  Triage- und Statuskategorien bleiben wie bisher Skelett.
- **Der Personenstamm folgt dem Zweck der Person.** Dazu gehören Name, Vorname, Geschlecht,
  Geburtsdatum, geschätztes Alter, Antreffort, Personennotiz und Verbleib. Diese Angaben
  bleiben, solange ein Zweck sie noch braucht. Bei einer Person mit Behandlungsbezug
  (Sichtung, Verlaufsnotiz, UHS-Belegung oder Zustand) sind das Behandlung *und*
  Personenauskunft, bei einer nur registrierten Person nur die Personenauskunft.
- **Dauer und Rechtsgrundlage je Organisation:** Der System-Admin legt je Kategorie eine
  Dauer in Tagen (0 bis 3650) und eine Rechtsgrundlage fest. Ohne Dauer folgt die Kategorie
  der Einsatz-Frist. Eine Dauer ohne Rechtsgrundlage wird abgewiesen. Es gibt keine stillen
  Vorgabewerte: Die Oberfläche nennt Vorschläge mit Quelle, setzt sie aber nicht ein.
- **Frist je Kategorie am Einsatz:** Beim Abschluss entsteht aus jeder gesetzten Dauer eine
  Kategorie-Frist mit ETB-Eintrag. Einsatzleitung und System-Admin können sie am Einsatz
  setzen, verlängern und aufheben, etwa bei einem laufenden Ermittlungsverfahren. Für eine
  Verkürzung gilt dieselbe Bestätigungsregel wie bei der Einsatz-Frist.
- **Eigener Ablauf je Kategorie:** Nach Fristablauf wird die Kategorie vorgemerkt, nach
  30 Tagen Karenz unwiderruflich geschwärzt. Beide Schritte stehen im ETB. Der Einsatz bleibt
  dabei lesbar; nur die Daten der Kategorie verschwinden. Während der Karenz hebt eine neue,
  künftige Frist die Vormerkung auf.
- **Zustand je Kategorie** mit denselben sechs Werten wie der Einsatz. Er erscheint in der
  Aufbewahrung des Einsatzes und in der Archivakte.

## Capabilities

### New Capabilities

- `aufbewahrung-kategorien`: Fristen je Datenkategorie. Die Capability umfasst Zuordnung der
  Daten, Dauer und Rechtsgrundlage je Organisation, Frist am Einsatz, Vormerkung, Karenz und
  Schwärzung je Kategorie sowie den Zustand je Kategorie.

### Modified Capabilities

- `aufbewahrung`:
  - Die Klassifikation ordnet jede Scrub-Spalte einer Datenkategorie zu.
  - Die Auslöser umfassen den Kategorie-Ablauf.
  - Der Audit im ETB deckt die Kategorie-Mutationen ab.
- `aufbewahrung-archiv`:
  - Die Archivakte zeigt den Zustand je Kategorie.
  - Die Aufbewahrung am Einsatz zeigt die Kategorie-Fristen und ändert sie.

## Impact

- **Backend:**
  - `src/einsatz/schwaerzung_registry.rs`: Kategorie je Scrub-Spalte, Scrub je Kategorie,
    neuer Guard-Test.
  - `src/einsatz/retention.rs`: Zustand je Kategorie.
  - `src/einsatz/repo.rs`: Abschluss, Kategorie-Frist, Vormerkung, Schwärzung.
  - `src/einsatz/purge_scheduler.rs`: neue Phase für Kategorien.
  - `src/org/einstellungen.rs` und die Org-Einstellungsroute: Dauer und Rechtsgrundlage je
    Kategorie.
  - `src/aufbewahrung/` (Archivakte) und `src/routes/einsatz.rs` (Kategorie-Frist am Einsatz).
- **Migration:** neue Tabellen für die Org-Vorgabe je Kategorie und für die Kategorie-Frist je
  Einsatz. Die Tabelle je Einsatz ist einsatzbezogen, also selbst in der Registry zu
  klassifizieren.
- **API/Typen:** neue und erweiterte DTOs. Danach `scripts/check-typ-codegen.sh` laufen
  lassen und beide generierten Dateien mitcommitten.
- **Frontend:** Org-Einstellungen (Abschnitt Aufbewahrung), Einsatz-Einstellungen
  (Aufbewahrung), Archivakte.
- **Verhalten für Bestandsdaten:** unverändert, solange keine Organisation eine Kategorie-Dauer
  setzt. Bereits abgeschlossene Einsätze erhalten keine Kategorie-Frist rückwirkend.
