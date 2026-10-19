# Proposal

## Why

Mit LLH-1109 steht fest, was Lifeline Hub medizinisch führt (Option A, „PAT-Kern“). Gebaut ist
davon bisher nur die Umbenennung „Zustand / Verdacht“. Verletzungen, Maßnahmen, Transport,
PAT-Nummer und Kontamination fehlen, also genau das, womit die Führung entscheidet, wer als
Nächstes wohin muss und womit.

Am UHS-Gerät gehen Nachsichtung, Verbleib und Notiz ohne Netz heute verloren. In Hallen und
Kellern fällt das Netz aber oft aus. Alle diese Schreibwege teilen dieselben Regeln für
Aufbewahrung, Gerät, Erfassungszeit und Patientenkopf. Deshalb kommen sie in einer Change.

## What Changes

- **Verletzungen (LLH-1113):**
  - neue Tabelle `person_verletzung`, nur anhängend, mit Ansicht, Region, Art, optional Schwere,
    Lage und kurzer Notiz
  - Aufheben genau einmal, POST am Detail, UHS-Gerät mit „Bestätigt von“, Kategorie „Behandlung“
  - kein ETB
- **Körperschema (LLH-1120):**
  - neuer Baustein mit drei Figuren (männlich, weiblich, neutral) über einer gemeinsamen Geometrie
  - Markieren per Tipp mit nummerierten Sternchen und einer Liste als zweitem Kanal
  - Lesefassung im Patientenkopf und in der Schnellansicht, Markieren im Paneel
  - Druckseite der Person, schwarz-weiß
- **Maßnahmen (LLH-1324):** neue Tabelle `person_massnahme`, nur anhängend, mit festem Katalog
  und Uhrzeit, Aufheben genau einmal, ohne ETB.
- **Transport (LLH-1325):**
  - neue Verlaufstabelle `person_transport` mit Cache an der Person: Priorität, Art, Fachrichtung
  - ETB-Zeile nur zur Priorität, pseudonym
  - Priorität sortiert innerhalb der Sichtungskategorie
  - neue Spalte „Transport“ in der Betroffenenliste
- **PAT-Nummer und Kontamination (LLH-1326):**
  - zwei neue Felder an der Person, per PATCH
  - PAT-Nummer suchbar in Liste und Sprungpalette
  - Kontamination als Marke im Patientenkopf und in den Listen
- **Ohne Netz (LLH-1138):**
  - Gilt für Sichtung, Verbleib, Notiz und die neuen Schreibwege Verletzung, Maßnahme und
    Transport.
  - Die POSTs nehmen `client_id` und `zeitpunkt_at` an.
  - Der Cache folgt dem jüngsten Zeitpunkt statt der Einfügung.
  - Am UHS-Gerät lassen sich die Einträge ohne Netz vormerken, mit der Quittung
    „Offline vorgemerkt“.
- **Regeländerung:** Die Annahme „Zeitstempel = Server-Jetzt, kein Backdating“ (E-2, Annahme 9)
  wird durch eine Spec abgelöst. Ein Eintrag trägt seine Erfassungszeit, gekappt nach der
  Serveruhr. Nachgereichte ältere Einträge stehen im Verlauf, ändern aber den aktuellen Stand
  nicht.
- **Patientenkopf:** Er nimmt Transport, PAT-Nummer, Kontamination, Maßnahmen und Verletzungen auf
  und bleibt bei 1280 × 800 ohne Bildlauf.

## Capabilities

### New Capabilities
- `personen-verletzungen`: Verletzungen am Körperschema als Datensatz: Katalog, Aufheben, Schreibrecht, Gerät, Leak-Schutz
- `koerperschema`: Baustein zum Lesen und Markieren von Verletzungen: Figur je Geschlecht, Trefferflächen, Liste, Druck
- `personen-massnahmen`: Maßnahmen am Patienten mit festem Katalog und Uhrzeit
- `personen-transport`: Transportpriorität, -art und benötigte Fachrichtung mit Verlauf, ETB-Zeile und Sortierung
- `personen-verlauf`: Erfassungszeit, Idempotenz und „jüngster Stand gewinnt“ für alle medizinischen Einträge einer Person, auch ohne Netz vorgemerkt

### Modified Capabilities
- `personen-detail`:
  - Der Patientenkopf zeigt zusätzlich Transport, PAT-Nummer, Kontamination, Maßnahmen und
    Verletzungen.
  - Sichten, Verbleib und Notiz zeigen eine Quittung, wenn der Eintrag ohne Netz vorgemerkt ist.
- `aufbewahrung-kategorien`:
  - Die Kategorie „Behandlung“ nennt auch die neuen Freitexte und Koordinaten.
  - Behandlungsbezug entsteht auch durch Verletzung, Maßnahme, Transport, PAT-Nummer und
    Kontamination.
- `geraete-kopplung`: „Bestätigt von“ gilt auch für Verletzung, Maßnahme und Transport und reist mit einem vorgemerkten Eintrag mit
- `funktionsansichten`: Scope-Matrix: Das UHS-Gerät schreibt Verletzungen, Maßnahmen und Transport
- `betroffene-lagedaten`: neue Anforderung PAT-Nummer und Kontamination an der Person; die Zeilen-Sichtung lässt sich ohne Netz vormerken
- `sprungpalette`: die Suche nach einer PAT-Nummer findet die Person
- `iconsatz`: die Figur des Körperschemas ist wie Bildmarke und taktische Zeichen eine Zeichnung, kein Icon
- `druck-dokumente`: Druckansicht einer Person mit Körperschema
- `feldgeraet-bedienung`: Nachsichtung, Verbleib, Notiz und die neuen Einträge gehen ohne Netz in die Warteschlange
- `benachrichtigungen`: ein nachgereichter älterer SK-I-Eintrag löst keinen Hinweis aus

## Impact

- **Backend:**
  - drei neue Tabellen (`person_verletzung`, `person_massnahme`, `person_transport`)
  - neue Spalten an `einsatz_person`: Transport-Cache, `pat_nummer`, `kontamination`
  - `client_id`, Erfassungszeit und Ankunftszeit an Sichtung, Verbleib und Notiz
  - Migrationen ab 0217
  - neue Routen unter `…/personen/{pid}/`
  - Änderungen an `PersonDetail`, `PersonAnzeige` und `PersonAuswahl`
  - Typ-Codegen und Wire-Kontrakt für sieben neue Enums
  - Aufbewahrungsregister (`schwaerzung_registry.rs`, `schwaerzung_person.rs`)
  - Routenlisten der UHS-Geräte
- **Frontend:**
  - neuer Baustein `personen/koerperschema/Koerperschema.tsx`
  - Patientenkopf, Verlauf, Betroffenenliste, UHS-Grundriss und Gerätelisten
  - Offline-Schicht (`offline/schreiben.ts`, `queue.ts`, `useOfflineSync.ts`)
  - Sprungpalette und Lagebild-Kürzung
  - neue Druckseite `/einsaetze/:id/personen/:pid/druck`
- **Regeln:**
  - `frontend/AGENTS.md` („Ein Iconsatz“)
  - `frontend/src/personen/AGENTS.md`
  - `frontend/src/geraet/AGENTS.md`
  - `frontend/src/offline/AGENTS.md`
- **Doku:**
  - Kapitel `betroffene.md`, `geraet-uhs.md`, `ohne-netz.md`, `unfallhilfsstellen.md` und
    `aufbewahrung.md`
  - Doku-Bilder `betroffene` und `geraet-uhs` neu erzeugen
- **Keine neue Abhängigkeit:** axe kommt nicht hinzu. Die Prüfung von Rollen und Namen läuft im
  e2e.
