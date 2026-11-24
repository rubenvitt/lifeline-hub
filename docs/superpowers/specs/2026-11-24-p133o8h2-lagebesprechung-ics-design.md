# Lagebesprechungstermin als ICS herunterladen — Design

Stand: 24.11.2026 · Zunder LLH-2101 (Teil D von LLH-1196)
Zunder: https://zunder.rubeen.dev/#/aufgabe/p133o8h2jfikuow48jczhlw9
Bezug: `docs/konzepte/2026-11-10-schnittstellen-ausbau.md` („ICS als Einzel-Export in UTC, kein
Abo“), `frontend/src/lagebesprechung/AGENTS.md`.

## Absicht

Der nächste Lagebesprechungstermin steht nur in der App. Wer ihn im eigenen Kalender braucht
(Outlook, Apple-Kalender, Thunderbird), etwa als Fachberater, Verbindungsperson oder
Einsatzleitung auf dem Handy, soll ihn mit einem Knopf übernehmen können.

## Ziele

- Ein Knopf am Termin lädt eine `.ics`-Datei nach RFC 5545 mit genau diesem Termin.
- Import in Outlook, Apple-Kalender und Thunderbird ohne Warnung.
- Wird der Termin verschoben und die Datei erneut importiert, aktualisiert der Kalender den
  Eintrag, statt einen zweiten anzulegen.

## Nicht-Ziele

- Kein abonnierbarer Feed. Kalender aktualisieren Abos nur alle 1 bis 24 Stunden, für einen
  Besprechungstakt ist das zu träge (Konzept, 10.11.2026).
- Keine vergangenen Besprechungen und keine Termine mehrerer Einsätze in einer Datei.
- Keine Absage-Datei, wenn der Termin entfällt.

## Anti-Ziele

- Weder Einsatzort noch Entschluss oder Sachverhalt in der Datei: Sie landet in privaten
  Kalendern, Aufbewahrung und Schwärzung greifen dort nicht.

## Abgestimmt (Phase-1-Checkpoint, 24.11.2026)

- **Dauer 30 min:** Das Modell kennt nur den Start, `einsatz.naechste_lagebesprechung_at`.
- **Erinnerung 10 min vorher:** `VALARM` 10 min vorher.
- **Titel:** SUMMARY „Lagebesprechung – <Einsatzbezeichnung>“, ohne Ort.
- **UID:** bleibt je Einsatz und Instanz gleich.
- **Erzeugung:** im Backend, der Knopf im TerminPaneel ist nur an Lesen gebunden.
- **Ohne Termin:** Der Knopf ist gesperrt, die Route antwortet 404.

## Ansätze

1. **Backend erzeugt, Route liefert die Datei (gewählt).**
   - Das Lese-Gate (`EinsatzLesezugriff<Lagebesprechung>`) gilt dort, wo die Daten liegen.
   - UID braucht die Instanzkennung (`instanz_identitaet.kennung`), die der Client nicht hat,
     DTSTAMP die Serveruhr.
   - Faltung, CRLF und Escaping lassen sich an einer Stelle testen.
   - Ein späterer Feed kann den Generator nutzen.
   - Preis: Ohne Netz geht es nicht. Wie beim CSV-Export ist der Knopf dann gesperrt.
2. **Frontend erzeugt aus dem Einsatzkopf.** Ginge offline. Verworfen wegen der fehlenden
   Instanzkennung für eine stabile UID und der Uhrfalle (DTSTAMP), bei einem Termin, den man
   ohnehin mit Netz setzt.

## Entwurf

### Generator (`src/lagebesprechung/ics.rs`)

Reine Funktion `build_ics(eingabe: IcsEingabe, jetzt: DateTime<Utc>) -> String`. `IcsEingabe`
enthält `einsatz_id`, `bezeichnung`, `termin` (UTC) und `instanz_kennung`.

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Lifeline Hub//Lagebesprechung//DE
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:lagebesprechung-<einsatz_id>@<instanz_kennung>
DTSTAMP:<jetzt>Z
SEQUENCE:<Minuten seit 2026-01-01T00:00Z, aus jetzt>
DTSTART:<termin>Z
DTEND:<termin + 30 min>Z
SUMMARY:Lagebesprechung – <bezeichnung>
STATUS:CONFIRMED
TRANSP:OPAQUE
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:Lagebesprechung
TRIGGER:-PT10M
END:VALARM
END:VEVENT
END:VCALENDAR
```

- **Zeitformat:** alle Zeiten in UTC als `YYYYMMDDTHHMMSSZ` (ADR-0012). Es braucht kein
  `VTIMEZONE`. Der Auftrag nennt Europe/Berlin, das Konzept hat am 10.11.2026 auf UTC entschieden;
  die Kalender zeigen in ihrer eigenen Zone.
- **UID:** Die Instanzkennung wird auf `[A-Za-z0-9.-]` beschränkt, damit die UID eine gültige
  Adresse bildet.
- **SEQUENCE:** wächst mit jedem Export, also auch nach einer Verschiebung. Dadurch übernimmt
  ein Kalender beim erneuten Import den neuen Stand. In int32 reicht es für Jahrtausende.
- **Textregeln:**
  - Escaping nach RFC 5545 3.3.11: `\` → `\\`, `;` → `\;`, `,` → `\,`, Zeilenumbruch → `\n`;
  - Zeilen enden mit CRLF;
  - Faltung bei 75 Oktetten, ohne ein UTF-8-Zeichen zu teilen (Fortsetzung mit Leerzeichen);
  - die Bezeichnung wird vor dem Escaping auf 200 Zeichen gekürzt.

### Route

- **Pfad:** `GET /api/einsaetze/{id}/briefing/schedule/export`. `schedule` und `export` stehen
  schon im Glossar.
- **Gate:** `EinsatzLesezugriff<Lagebesprechung>`.
- **Statuscodes:** ohne Termin 404, sonst 200.
- **Antwort:**
  - `Content-Type: text/calendar; charset=utf-8`;
  - `Content-Disposition` über `anhang::content_disposition` mit
    `lagebesprechung-einsatz-<id>-<YYYY-MM-DD-HHMM>.ics` (Terminzeit);
  - `Cache-Control: no-store`.
- **Kein JSON-DTO**, also keine Codegen-Änderung.
- **Kein Audit-Eintrag:** keine personenbezogenen Daten.

### Oberfläche

- **Knopf:** im `TerminPaneel` neben der Terminwahl:

  ```
  Nächste Lagebesprechung  14:30 (in 25 min)
  [+15] [+30] [+60] [Kein Termin] [Zeit wählen …]
  [In Kalender übernehmen]
  ```

- **Sperren:**
  - an Lesen gebunden, nicht an `darfSchreiben` oder `isGesperrt`;
  - gesperrt ohne Termin, sichtbar mit „Kein Termin“ am Knopf;
  - gesperrt ohne Netz, sichtbar mit „Offline“.
- **Ablauf:** `apiDatei` → `speichereDatei` (`components/dateiSpeichern.ts`). Den Dateinamen
  liefert `exportDateiname`, erweitert um Inhalt und Endung, gemeinsam mit Teil A.
- **Fehler:** Ein Fehler erscheint im Paneel wie `SpeicherFehler`.
- **Mobil:** Auf Android und iOS öffnet die Hülle die Datei über Teilen bzw. den Download. Dort
  bietet das System die Kalender-App an; dafür sind keine eigenen Änderungen nötig.

### Prüfungen

- **Rust-Einheitentests des Generators:**
  - CRLF überall;
  - Faltung bei 75 Oktetten mit Umlauten an der Grenze;
  - Escaping;
  - DTEND = DTSTART + 30 min;
  - UID-Säuberung;
  - die Datei wird mit einem einfachen eigenen Zeilenparser im Test wieder gelesen.
- **Integrationstest:**
  - 200 mit Kopfzeilen und Inhalt;
  - 404 ohne Termin;
  - 403 bzw. 404 ohne Mitgliedschaft (Gate-Verhalten wie die anderen Lagebesprechungsrouten).
- **Frontend-Test:** Knopf gesperrt ohne Termin, aktiv als Leser, Aufruf von `speichereDatei`.
- **Akzeptanz in Outlook, Apple-Kalender und Thunderbird:** Ruben importiert eine Datei aus dem
  Dev-Stack. Das ist ein Prüfpunkt im PR, außerhalb der Sitzung.

### Doku

- **Anwenderdoku:** Kapitel Lagebesprechung, „Termin in den Kalender übernehmen“.

## Dem Bauenden überlassen

- Ob `exportDateiname` den Server-Dateinamen nutzt oder ihn selbst bildet (heute bildet ihn der
  Client).
- Die genaue Platzierung des Knopfs im Paneel.
