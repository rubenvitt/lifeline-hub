# L‑2 — Taktische Gliederung auf der Lagekarte

**Teilprojekt:** 4 „Lage" — Spec **2 von 3**. Baut auf
[L‑1 Karten-Fundament](2026-05-30-lage-karten-fundament-design.md) auf und bringt die in
[K&M‑3](2026-05-26-kraefte-mittel-einheiten-abschnitte-design.md) gebaute taktische
Gliederung (Einheiten, Einsatzabschnitte) sowie die disponierten Fahrzeuge als **echte
taktische Zeichen nach DV 102** auf die bestehende Lagekarte. Die örtliche Ausdehnung der
**Gefahren-/Absperrzonen** und das freie, entitätslose Zeichnen bleiben
[L‑3](#folge-specs-lage-sequenz) vorbehalten.

**Unterbau (wiederverwendet, nicht neu gebaut):** die `LagekartePage` + MapLibre-GL-Karte,
Basemap-Auslieferung und Marker-/Live-Muster aus L‑1 (`src/routes/karte.rs`,
`frontend/src/pages/LagekartePage.tsx`, `frontend/src/pages/lagekarte/`); die K&M‑Entities
`einsatz_einheit`/`einsatzabschnitt`/`einheit_typ` (`src/einheit/`, `src/einsatzabschnitt/`,
Migr. `0014`–`0017`) und `einsatz_fahrzeug` inkl. **FMS-Status** (`src/fahrzeug/`,
`fahrzeug_status` mit `kategorie`/`farbe`/`fms_anker`, Migr. `0007`–`0009`); der disponierte
Personal-Stamm (`einsatz_personal`, Migr. `0013`); Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs`); der `LiveHub` (`src/live/mod.rs`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 4 — Lage".

## Worum es geht

L‑1 hat die ortsfesten/erfassten Objekte (Einsatzort, UHS, Schäden) verortbar gemacht. Was
fehlt, ist die **taktische Lage**: die Kräftegliederung — Einheiten, Fahrzeuge, Abschnitte,
Führung — räumlich als **taktische Zeichen** darzustellen, wie es ein Lagebild auf der
Führungsebene verlangt. K&M‑3 hat diese Gliederung als Datenstruktur gebaut (Einheiten-/
Abschnitts-Bäume, Mitgliedschaft, Soll/Ist-Stärke) und die Lagekarten-Darstellung ausdrücklich
ans Lage-Modul vertagt; L‑1 hat den operativen Fahrzeug-Standort und die taktischen Zeichen
(DV 102) ausdrücklich nach L‑2 geschoben. L‑2 löst beides ein.

Drei Punkte prägen das Design:

1. **Entity-gekoppelt — der Marker *ist* das Objekt.** Wie in L‑1 legt L‑2 **keine** neue
   Lage-Entität an. Es ergänzt die bestehenden taktischen Objekte um Geometrie + Symbol-
   Attribute und rendert sie. Anlegen/Bearbeiten/Auflösen bleiben in den Fach-Modulen (K&M).
2. **Echte DV 102, nicht bunte Punkte.** Die Zeichen werden normgerecht generiert — über die
   fertige, abhängigkeitsfreie Bibliothek `taktische-zeichen-core`/`-react` (MIT-Lizenz,
   `https://taktische-zeichen.dev`). Wir liefern die Symbol-**Spezifikation**, bauen keinen
   eigenen Generator.
3. **Manuelle Verortung, live.** Positionen werden von Hand gesetzt (Klick/Zeichnen), kein
   GPS-Tracking (→ L‑4). Änderungen verbreiten sich über neue SSE-Kanäle live an alle Clients.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Alle vier taktischen Objekttypen sind platzierbar**, je verknüpft mit dem App-Entity:
   **Einheiten**, **einzelne Fahrzeuge**, **Personal-Führungskräfte** (Einheits-/Abschnitts-
   führung) als **Punkt**-Zeichen; **Einsatzabschnitte** als **Fläche (Polygon)**.
2. **DV‑102-Rendering über `taktische-zeichen-react`.** Die Lib nimmt
   `{grundzeichen, organisation, fachaufgabe, einheit, verwaltungsstufe}` und erzeugt das SVG.
   `grundzeichen` und `einheit` (Größe) werden abgeleitet, `organisation` und `fachaufgabe`
   werden im Modell ergänzt (s. Symbol-Modell).
3. **Symbol-Modell = Org-Default + Fachaufgabe je Objekt** (plus optionaler Org-Override pro
   Objekt). **Verworfen:** vollständige Freiform-TZ-Spec je Platzierung (entkoppelt das Zeichen
   vom Entity-Datum); Fachaufgabe an den Größen-Katalog `einheit_typ` hängen (eine „Gruppe" kann
   Sanität *oder* Betreuung sein — Fachaufgabe gehört ans konkrete Objekt, nicht an die Größe).
4. **Positionen sind entity-gekoppelt** (Spalten direkt am Objekt, analog L‑1; beide Koordinaten
   nullable, paarweise gesetzt, kein Mehrspalten-CHECK). **Verworfen:** separater Lage-/Overlay-
   Layer (zweite Wahrheit → Drift; widerspricht dem projektweiten „eine Wahrheit"-Prinzip).
5. **Verorten/Zeichnen erzeugt keinen ETB-Eintrag** — reine Lage-Pflege, kein sinntragendes
   Ereignis (konsistent mit L‑1 §5). Die fachlichen K&M‑3-Ereignisse (Einheit bilden/auflösen,
   Mitglied zuordnen, Führer setzen …) schreiben ihre ETB-Spur unverändert weiter.
6. **Live über neue SSE-Kanäle.** Für `fahrzeug`/`einheit`/`abschnitt` gibt es heute keinen
   SSE-Kanal (K&M‑3 hat Live bewusst vertagt); L‑2 ergänzt sie über den bestehenden `LiveHub`.
   `person` existiert bereits.
7. **Manuelles Platzieren, kein Geocoding, kein GPS-Tracking.** Position per Klick (Punkt) bzw.
   Stützpunkt-Zeichnen (Fläche). Live-Fahrzeugpositionen → L‑4 (geparkt).

## Symbol-Modell

Die Lib-Spezifikation wird aus dem Objekt abgeleitet bzw. ergänzt:

| Objekt | `grundzeichen` | `einheit` (Größe) | `fachaufgabe` | `organisation` |
|---|---|---|---|---|
| **Einheit** | `taktische-formation` | aus `einheit_typ`-Label (Trupp→`trupp`, Staffel→`staffel`, Gruppe→`gruppe`, Zug→`zug`/`zugtrupp`; „Sonstige" → keine) | `tz_fachaufgabe` (Default leer) | Org-Default, `tz_organisation`-Override |
| **Fahrzeug** | `kraftfahrzeug-landgebunden` | — | `tz_fachaufgabe` | Org-Default, Override |
| **Personal-Führung** | `person` | — | `fuehrung` (Default) | Org-Default, Override |
| **Abschnitt** | `befehlsstelle` | — | `fuehrung` | Org-Default, Override |

- **`grundzeichen`** und die **Größe** (`einheit`) sind **abgeleitet** (Objekttyp bzw. `einheit_typ`),
  werden **nicht** gespeichert.
- **`organisation`** ist ein **Org-Default** (eine neue Spalte `tz_organisation` an der Tabelle
  `organisation`; z. B. DRK/ASB/JUH/MHD → `hilfsorganisation`), pro platziertem Objekt optional
  überschreibbar (für ad-hoc/externe Kräfte anderer Organisation, z. B. `feuerwehr`/`thw`).
- **`fachaufgabe`** wird **pro Objekt** gewählt (Lib-Schlüssel, u. a. `rettungswesen` = Sanitäts-/
  Gesundheitswesen, `betreuung`, `verpflegung`, `fuehrung`, `bergung`, `wasserrettung`,
  `aerztliche-versorgung`). Default: Abschnitt/Personal-Führung → `fuehrung`, sonst leer.
- **Verwaltungsstufe** wird in L‑2 nicht genutzt (Feld bleibt unbelegt; späteres Thema).
- **FMS am Fahrzeug:** DV 102 kodiert keinen FMS-Status. Der vorhandene `fahrzeug_status`
  (`kategorie`/`farbe`) wird als **Statusring/Badge um das Kfz-Zeichen** gelegt, nicht ins
  Grundzeichen gemischt.
- **Komposition im Frontend:** ein Mapping-Modul `frontend/src/pages/lagekarte/taktischesZeichen.ts`
  nimmt `(objekttyp, einheit_typ_label, organisation, fachaufgabe)` und liefert die
  `TaktischesZeichen`-Props. Das Backend liefert die Rohfelder + die bereits aufgelöste Größe.

## Datenmodell & Migration

Eine Migration (`migrations/00NN_lage_taktik.sql`, Nummer beim Schreiben des Plans festlegen —
folgt auf `0034`):

```sql
ALTER TABLE einsatz_einheit    ADD COLUMN lat REAL;
ALTER TABLE einsatz_einheit    ADD COLUMN lon REAL;
ALTER TABLE einsatz_einheit    ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_einheit    ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatz_fahrzeug   ADD COLUMN lat REAL;
ALTER TABLE einsatz_fahrzeug   ADD COLUMN lon REAL;
ALTER TABLE einsatz_fahrzeug   ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_fahrzeug   ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatz_personal   ADD COLUMN lat REAL;
ALTER TABLE einsatz_personal   ADD COLUMN lon REAL;
ALTER TABLE einsatz_personal   ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_personal   ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatzabschnitt   ADD COLUMN flaeche_geojson TEXT;   -- GeoJSON-Polygon
ALTER TABLE einsatzabschnitt   ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatzabschnitt   ADD COLUMN tz_organisation TEXT;

ALTER TABLE organisation       ADD COLUMN tz_organisation TEXT;   -- Org-Default
-- Backfill bestehender Orgs in derselben Migration (Default 'hilfsorganisation');
-- Bootstrap (src/auth/bootstrap.rs) setzt den Default für neue Orgs.
```

- Alle neuen Spalten **nullable**, kein Default-Wert, kein Mehrspalten-CHECK (folgt dem
  Einsatzort-/L‑1-Vorbild). `lat`/`lon` werden stets **paarweise** behandelt (beide NULL =
  nicht verortet).
- **Abschnitt = Fläche, kein separater Punkt.** Die Führungsstelle wird am **Zentroid** des
  Polygons gelabelt; ein eigener Führungsstellen-Punkt am Abschnitt ist bewusst nicht Teil von
  L‑2 (späteres Thema). `flaeche_geojson` hält ein einzelnes GeoJSON-Polygon (MapLibre rendert
  GeoJSON direkt).
- **`einsatz_personal.lat/lon` existiert auf allen Zeilen**, wird in L‑2 aber **nur für
  Führungskräfte** befüllt/angezeigt (s. Backend/Frontend) — die Spalte trägt keine Filterlogik.

## Backend

### Verorten/Zeichnen = dedizierte Geo-Endpunkte (No-ETB strukturell)

**Bewusst eigene Endpunkte**, nicht die bestehenden K&M‑3/K&M‑1-PATCH-Routen erweitern: jene
schreiben für sinntragende Änderungen ETB-Einträge — eine reine Verortung darf das nicht
auslösen (Annahme 5). Eigene Routen machen den No-ETB-Vertrag **baulich** statt über einen
bedingten Diff-Guard:

- `PATCH /api/einsaetze/{id}/einheiten/{eid}/position` — `lat`/`lon`/`tz_fachaufgabe`/`tz_organisation`.
- `PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}/position` — dito.
- `PATCH /api/einsaetze/{id}/personal/{ep_id}/position` — dito.
- `PATCH /api/einsaetze/{id}/abschnitte/{aid}/flaeche` — `flaeche_geojson`/`tz_fachaufgabe`/`tz_organisation`.

Jeder Handler **merged gegen den Effektivzustand** (Bestandswert), damit ein Partial-PATCH
nicht versehentlich `lon` nullt, wenn nur `lat` kommt; `lat`/`lon` werden als Paar geschrieben
(Setzen = beide, Löschen = beide auf NULL). **Kein** ETB-Schreibpfad in diesen Handlern.

### Karten-Lesedaten

Die **bestehenden** Listen-Endpunkte um die neuen Felder erweitern (eine Wahrheit je Typ, kein
neuer Aggregat-Endpunkt — bleibt als spätere Option vermerkt, falls die Typanzahl weiter wächst):

- `GET …/einheiten` und `GET …/fahrzeuge` liefern zusätzlich `lat/lon` +
  `tz_fachaufgabe/tz_organisation` (Fahrzeug zusätzlich die schon vorhandene
  `status_kategorie/status_farbe`); `GET …/abschnitte` zusätzlich `flaeche_geojson` +
  `tz_fachaufgabe/tz_organisation`.
- **Personal-Führungskräfte:** ein schlanker Lese-Pfad liefert nur die Führungskräfte mit
  Koordinate — die Personen, die `einsatz_einheit.fuehrer_id` **oder** `einsatzabschnitt.leiter_id`
  sind. So wird die Karte/„Nicht verortet"-Liste nicht mit dem gesamten disponierten Personal
  geflutet. (Umsetzung: gefilterte Query oder ein `…/karte/fuehrungskraefte`-Lesepfad — im Plan
  entscheiden.)
- Alle Lese-Queries filtern Storniertes/Aufgelöstes bereits heraus (kein „Marker-Leichen"-Problem).

### Live (neue SSE-Kanäle)

Über den bestehenden `LiveHub`: Event-Tags `fahrzeug`/`einheit`/`abschnitt` ergänzen (`person`
existiert), Publish bei den relevanten Mutationen — **sowohl** den K&M-Fachaktionen
(anlegen/ändern/auflösen/zuordnen) **als auch** den neuen Geo-PATCHes. Stream-Routen analog
L‑1/ETB:

- `GET /api/einsaetze/{id}/einheiten/stream`
- `GET /api/einsaetze/{id}/fahrzeuge/stream`
- `GET /api/einsaetze/{id}/abschnitte/stream`

Nebeneffekt (kein L‑2-Scope, aber kostenlos): die K&M-Arbeitsseiten können später dieselben
Kanäle abonnieren.

### Berechtigung / Nachlauf

Wie bei allen Einsatz-Sub-Routen über `src/einsatz/berechtigung.rs`: lesen = `darf_lesen`;
verorten/zeichnen = `ist_schreibberechtigt` + `fordere_aktiv`. Der **Org-Default** `tz_organisation`
an der `organisation` wird im **Stammdaten-Bereich vom Admin** gepflegt (eigener kleiner
PATCH/Setting; im Plan verorten).

## Frontend (`LagekartePage` erweitern, keine neue Seite)

- **Neue Layer** in der linken Sidebar zusätzlich zu Einsatzort/UHS/Schäden: **Einheiten,
  Fahrzeuge, Personal-Führung, Abschnitte** — je mit Toggle. Die „⚠ Nicht verortet"-Sektion
  umfasst nun auch die noch nicht platzierten taktischen Objekte (Einheiten/Fahrzeuge/
  Führungskräfte ohne Koordinate, Abschnitte ohne Fläche).
- **DV‑102-Marker:** neue Komponente, die `taktische-zeichen-react` rendert und das SVG als
  HTML-Marker an MapLibre hängt (wie die L‑1-Marker). Props aus dem Mapping-Modul
  `taktischesZeichen.ts`. **Fahrzeug:** FMS-`status_farbe` als Ring/Badge um das Kfz-Zeichen.
- **Platzieren (Punkt):** nicht-verortetes Objekt in der Sidebar wählen → Klick auf die Karte
  setzt `lat/lon` (Geo-PATCH); alternativ Koordinate manuell eingeben. **Symbol-Auswahl**
  (Fachaufgabe-`Select` + optionaler Org-`Select`) im Inspector des Objekts.
- **Abschnittsfläche (Polygon):** Zeichenmodus — Stützpunkte klicken, Fläche schließen →
  `flaeche_geojson` (Geo-PATCH). Gefüllte Fläche (dezent) + Führungsstellen-Label am Zentroid.
  **Plan-Spike (offen):** Zeichen-Lib — `@mapbox/mapbox-gl-draw` ist Mapbox-GL-JS-orientiert und
  nur über Adapter/Version-sensibel mit MapLibre kompatibel; gegen die **installierte**
  MapLibre-Version verifizieren, sonst `terra-draw` (MapLibre-nativ) als Fallback. **L‑3
  verwendet dieselbe Zeichen-Mechanik wieder** (für entitätslose Zonen) — die Lib-Wahl trägt
  also über L‑2 hinaus.
- **Marker-/Flächen-Klick → Inspector** mit Objekt-Info + **Link ins Fach-Modul**
  (EinheitenPage / FahrzeugePage / EinsatzabschnittePage).
- **Kein Clustering der taktischen Zeichen** — sie sollen einzeln lesbar bleiben (Clustering
  würde das Lagebild verdecken). L‑1s dezentes Clustering für UHS/Schäden bleibt unberührt.
- **Live:** EventSource auf die neuen Streams → Zeichen erscheinen/verschieben/verschwinden live.
- **Neue Abhängigkeiten:** `taktische-zeichen-react` (+ transitiv `taktische-zeichen-core`);
  Polygon-Draw-Lib gemäß Plan-Spike. `maplibre-gl`/`pmtiles` bestehen aus L‑1.

## Bewusst NICHT in L‑2 (Abgrenzung)

- **Freies, entitätsloses Zeichnen; Gefahren-/Absperrzonen** (Flächen/Linien ohne Entity) → **L‑3**
  (nutzt L‑2s Polygon-Mechanik wieder). L‑2s Abschnittsfläche ist **entity-gekoppelt**.
- **GPS-/Live-Fahrzeug-Tracking** → **L‑4** (geparkt, Machbarkeit zuerst — ClickUp `86ca1nv2v`).
  Jede Fahrzeug-Position in L‑2 ist **manuell**.
- **Kräfteübersicht / Lage-Dashboard** (geplante Lage-Listen-Module) bleiben getrennt — L‑2 ist
  „auf der Karte"; jene konsumieren später dieselben Daten.
- **Material** auf der Karte (Lager-Freitext, kein operativer Marker) → nicht vorgesehen.
- **Verwaltungsstufen-Aufsatz** und **Geocoding** → später.
- **Separater Führungsstellen-Punkt** am Abschnitt (zusätzlich zur Fläche) → späteres Thema.

## Tests

- **Backend:** Geo-PATCH setzt/ändert/löscht `lat/lon` + `tz_*` auf Einheit/Fahrzeug/Personal
  und `flaeche_geojson` + `tz_*` auf Abschnitt (inkl. Partial-Merge: nur `lat` gesendet nullt
  `lon` nicht); **Verorten/Zeichnen erzeugt KEINEN ETB-Eintrag** (während die K&M‑3-Fachaktionen
  ihre Einträge weiter schreiben); Kartendaten filtern Storniertes/Aufgelöstes heraus;
  Personal-Lesepfad liefert **nur Führungskräfte**; neue SSE-Kanäle feuern bei Geo-PATCH **und**
  K&M-Mutation; Berechtigung (lesen/schreiben/Nachlauf); **Org-Isolation** explizit (Nutzer aus
  Org A kann fremde Objekte weder lesen noch verorten — gemäß bekannter Cross-Org-Lücke).
- **Frontend (Vitest/@testing-library/MSW):** neue Layer-Toggles + „Nicht verortet"-Liste (inkl.
  taktischer Objekte); Platzieren-Flow Punkt (wählen → Karten-Klick → PATCH); Polygon-Zeichnen
  für Abschnitt (Stützpunkte → schließen → PATCH); DV‑102-Symbol rendert je Objekt korrekt
  (Org-Default + Fachaufgabe; Größe aus `einheit_typ`); FMS-Farbe am Fahrzeug; nur Führungskräfte
  als Personal-Zeichen; Marker-Klick → Inspector + Modul-Link; Live via SSE.

## Folge-Specs (Lage-Sequenz)

- **L‑3 — Gefahren- & Absperrzonen:** freies Zeichnen von Flächen/Linien, **entitätsloser**
  Annotations-Layer — verwendet die in L‑2 gewählte Polygon-Zeichen-Mechanik wieder.
- **(L‑4, geparkt):** Live-Fahrzeugpositionen / Tracking — Machbarkeit zuerst (ClickUp).
- **Kräfteübersicht / Lage-Dashboard:** stellen die hier verorteten Kräfte als Liste/Meldebild
  dar (konsumieren dieselben Daten).
