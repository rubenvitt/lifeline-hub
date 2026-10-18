# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1018) zur Patientenansicht: „Auf einen Blick
sehen, was die Person hat. Nicht für alles ein Modal.“ Und zur Zuordnung: „Tier, dann Schaden,
dann UHS – technisch gedacht, nicht aus Gestaltungssicht.“

Heute stehen auf der Detailseite zwei gleichrangige Spalten. Der Zustand (praktisch die
Verdachtsdiagnose) liegt zwischen Herkunft und Antreffort. UHS und Platz stecken eingeklappt
unter „Zuordnungen“, und für Sichten, Verbleib und Status öffnet je ein Dialog. Die Führung an
BHP und UHS fragt aber je Patient zuerst: Welche Sichtung, seit wann? Was hat er? Wo liegt er,
wohin geht er? LLH-1094 (Patientenkopf) und LLH-1129 (Bezüge) bauen dieselbe Seite um und ziehen
beide den Aufenthalt nach oben. Sie kommen deshalb als eine Change.

## What Changes

- **Patientenkopf (LLH-1094)** als erstes Paneel über die volle Breite. Er enthält:
  - die Sichtung als große Fläche (Baustein `SichtungsWahl` aus `knc0jyjd-sichtungswahl-flaechen`)
    mit taktischer Zeit, „vor n min“ und dem Namen dessen, der bestätigt hat;
  - „Zustand / Verdacht“ groß und direkt schreibbar;
  - den Aufenthalt (UHS · Platz bzw. Wartebereich · seit) oder nach dem Austritt den Verbleib;
  - die letzte Verlaufsnotiz mit einer Eingabezeile „Notiz“.
- **Sichten, Verbleib und Notiz in der Ansicht statt im Dialog.** Ein Tipp auf die Sichtung
  klappt die Wahl im Kopf auf, „Verbleib erfassen“ klappt ein Paneel auf. Eine Ablehnung steht
  am Ort, und ein laufendes Speichern sperrt nur das eigene Paneel. Das Kopfmenü behält
  Statuswechsel und Stornieren.
- **Aufenthalt im Kopf (LLH-1129, Option A).** „In UHS aufnehmen“, „Verlegen“ und „Austragen“
  liegen am Aufenthalt. Der Server liefert dafür im `PersonDetail` UHS- und Platzbezeichnung und
  „seit“, sodass kein zusätzlicher Abruf nötig ist.
- **Bezüge (LLH-1129, Option A).** Tier und Schaden stehen in **einem** Abschnitt „Bezüge“ als
  Liste in Einsatzsprache, etwa „Halter von T-003 · Hund „Bello““ oder „Geschädigt bei S-007 ·
  Wasserschaden“, jede Zeile mit „Bezug lösen“. Ein Knopf „Bezug hinzufügen“ öffnet eine
  gemeinsame Suche über freie Tiere und Schäden.
- **Wortlaut:** „Zustand / Verdacht“ (Entscheidung zu LLH-1109), „Bezug hinzufügen“,
  „Bezug lösen“, „In UHS aufnehmen“, „Verlegen“, „Austragen“.
- **Darunter:** Verlauf, Personendaten, Bezüge, Fotos und Dateien, Zugriffsprotokoll. Die zwei
  gleichrangigen Spalten entfallen.

## Capabilities

### New Capabilities
- `personen-detail`: Aufbau und Bedienung der Detailseite einer Person. Das umfasst den
  Patientenkopf, Sichten, Verbleib und Notiz in der Ansicht, den Aufenthalt mit
  Verlegen/Austragen und den Abschnitt „Bezüge“.

### Modified Capabilities
- `einsatztauglichkeit-layout`: Die Anforderung „Das Personen-Detail stellt die medizinische
  Spalte vor die Stammdaten“ wird zu „Das Personen-Detail beginnt mit dem Patientenkopf“. Die
  Regel „Ohne Angabe: …“ bleibt.
- `betroffene-lagedaten`: Das Feld „Zustand“ heißt in der Oberfläche „Zustand / Verdacht“.

## Impact

- Backend:
  - `src/routes/einsatz_person.rs`: `PersonDetail` bekommt `aufenthalt` mit UHS-Bezeichnung,
    Platzbezeichnung und seit.
  - `src/person/` (Abfrage), `api_doc.rs`, Typ-Codegen (`scripts/check-typ-codegen.sh`, beide
    generierten Dateien).
  - Keine Migration.
- Frontend:
  - `pages/PersonenDetailPage.tsx`; neu `personen/Patientenkopf.tsx`,
    `personen/PersonBezuege.tsx`, `personen/BezugSuche.tsx`.
  - `personen/SichtungDialog.tsx` (Felder herausgelöst für die Inline-Fassung),
    `personen/VerbleibErfassung.tsx`, `personen/ZuweisungsDialoge.tsx`.
  - ein geteilter Helfer „vor n min“ in `anzeige/`.
  - Wortlaut der Gegenrichtung in `pages/TiereDetailPage.tsx` und `pages/SchaedenDetailPage.tsx`.
- e2e: `personen-detail.spec.ts`, `betroffene-handy.spec.ts`, `geraet-uhs-tablet.spec.ts`.
- Regeln: `frontend/src/personen/AGENTS.md` (Personen-Detail, Bezüge).
- Doku: Kapitel `betroffene.md`, `geraet-uhs.md`, `tiere.md` und `schaeden.md` samt Bildern.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/bti508xbyndh4jia8kddopbk (LLH-1094),
  https://zunder.rubeen.dev/#/aufgabe/mtcm6ied3hzmsmqs1231z7be (LLH-1129)
