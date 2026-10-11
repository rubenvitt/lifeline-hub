## Why

Die meldende bzw. anfordernde Stelle eines Einsatzes ist heute reiner Freitext. Dieselben Stellen
kommen immer wieder vor (eigene Integrierte Leitstelle, Nachbar-ILS, Polizei, Ordnungsamt,
Landratsamt) und werden jedes Mal anders geschrieben. Im Einsatzbericht und bei Rückfragen muss die
Stelle aber einheitlich heißen. Ruben (10.10.2026): „‚Meldende Stelle‘ soll zusätzlich zum Freitext
in den Stammdaten gepflegt werden können.“ Die Nachforderung braucht außerdem eine Vorgabe für den
Adressaten „Leitstelle“: die Leitstelle, die für die Organisation zuständig ist (LFH-1162).

## What Changes

- Neuer Stammdaten-Katalog **„Externe Stellen“** je Organisation. Felder: Bezeichnung (Pflicht),
  Art (Leitstelle, Behörde, Polizei, Hilfsorganisation, sonstige), optional Rufnummer und
  Funkrufname, aktiv/inaktiv. Pflege unter Verwaltung → Stammdaten durch den Admin, Lesen für
  jeden Angemeldeten der Organisation. Kein Löschen; Deaktivieren lässt sich zurücknehmen.
- Markierung **„zuständige Leitstelle“**: höchstens eine aktive Stelle der Art Leitstelle je
  Organisation. Wer sie an einer Stelle setzt, nimmt sie der bisherigen in derselben Anfrage ab.
- Katalogänderungen lösen das Org-Ereignis `stammdaten` aus (live in allen Tabs der Organisation).
- **Einsatzdaten:** „Meldende Stelle“ (Zeile in der Leseansicht und Vollformular) schlägt die
  aktiven Stellen nach Art gruppiert vor. Freitext bleibt erlaubt. Gespeichert wird wie bisher
  nur der Text in `einsatz.meldende_stelle` (Momentaufnahme, kein Verweis).
- **Nachforderung:** „Adressat-Bezeichnung“ schlägt die aktiven Stellen vor. Bei der Kategorie
  „Leitstelle“ ist das Feld mit der zuständigen Leitstelle vorbelegt, solange es leer ist.
- `meldende_stelle` bekommt eine Höchstlänge (200 Zeichen), gespiegelt im Frontend (Spec
  `eingabegrenzen`). Neu ist das nur für Schreibanfragen; gespeicherte längere Werte bleiben.
- Anwenderkapitel `stammdaten`, `einsatzdaten` und `nachforderung` nachgezogen.

Nicht in dieser Change: Übernahme in den Kommunikationsplan S6 („Externe Stelle hinzufügen“ aus
dem Katalog, Lücke „Leitstelle“ in `stab/luecken.ts`) und die Umstellung auf den Baustein
`StammdatenFeld` (LFH-1284). Beides kommt als eigenes Ticket.

## Capabilities

### New Capabilities
- `stammdaten-externe-stellen`: Org-Katalog externer Stellen samt Art, Aktiv-Schalter und
  zuständiger Leitstelle; Lese- und Schreibrechte, Org-Grenze, Vorschläge in Einsatzdaten und
  Nachforderung.

### Modified Capabilities
- `org-live`: Die Liste der Stammdaten-Kataloge, deren Änderung `stammdaten` auslöst, nennt die
  externen Stellen.
- `eingabegrenzen`: `meldende_stelle` hat beim Ändern des Einsatzes eine Höchstlänge.

## Impact

- **Backend:** Migration `0176_org_externe_stelle.sql` (neue Tabelle, partieller UNIQUE-Index),
  neues Modul `src/externe_stelle/` und Route `src/routes/externe_stelle.rs`, Routen in
  `src/app.rs`, `STAMMDATEN_PFADE` in `src/routes/live.rs`, Grenze in `src/routes/einsatz.rs`.
  Tests: `tests/externe_stelle.rs`, `tests/stammdaten_live_guard.rs`, `tests/org_live.rs`,
  `tests/enum_wire_kontrakt.rs`, `tests/eingabegrenzen_spiegel.rs`.
- **API:** neu `GET/POST /api/externe-stellen`, `PATCH /api/externe-stellen/{id}`. Neues
  Antwort-DTO `ExterneStelle` und Enum `ExterneStelleArt` im Typ-Codegen
  (`openapi.json`, `types.generated.ts`). `PATCH /api/einsaetze/{id}` lehnt eine zu lange
  `meldende_stelle` mit 400 ab.
- **Frontend:** `api/externeStellen.ts`, `stammdaten/ExterneStellenTab.tsx` mit Formular-Modal,
  `admin/adminNav.tsx`, `api/queryKeys.ts` (neuer globaler Key, live über `stammdaten`, offline
  ausdrücklich draußen), `api/eingabegrenzen.ts`, `pages/EinsatzdatenPage.tsx`,
  `nachforderungen/NachforderungFormular.tsx`.
- **Doku:** `docs/anwender/kapitel/stammdaten.md`, `einsatzdaten.md`, `nachforderung.md`.
- Keine neue Spalte am Einsatz, keine Änderung an Aufbewahrung und Schwärzung (der Katalog ist
  Org-Stammdatum, `meldende_stelle` bleibt wie klassifiziert).
