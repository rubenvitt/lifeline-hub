# L‑3 — Gefahren- & Absperrzonen auf der Lagekarte

**Teilprojekt:** 4 „Lage" — Spec **3 von 3**. Baut auf
[L‑1 Karten-Fundament](2026-05-30-lage-karten-fundament-design.md) auf und verwendet die in
[L‑2 Taktische Gliederung](2026-05-31-lage-taktische-gliederung-design.md) gewählte
Polygon-Zeichen-Mechanik (`terra-draw` + `terra-draw-maplibre-gl-adapter`) wieder. L‑3 bringt
den **freien, entitätslosen Annotations-Layer** auf die Karte: **Gefahren- und Absperrzonen**
als Flächen und Linien, die — anders als L‑1/L‑2 — **kein** Fachobjekt abbilden.

**Unterbau (wiederverwendet, nicht neu gebaut):** die `LagekartePage` + MapLibre-GL-Karte,
Basemap-Auslieferung, Marker-/Live-Muster und die Polygon-Zeichen-Mechanik aus L‑1/L‑2
(`frontend/src/pages/LagekartePage.tsx`, `frontend/src/pages/lagekarte/` inkl.
`abschnittDraw.ts`, `geo.ts`); der `LiveHub` (`src/live/mod.rs`); das Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs`); der ETB-Append-Pfad (`src/etb/`); das Modul-Vorbild
`src/einsatzabschnitt/` für eine einsatz-skopierte Sub-Entity.

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 4 — Lage".

## Worum es geht

L‑1 hat ortsfeste/erfasste Objekte (Einsatzort, UHS, Schäden) verortbar gemacht, L‑2 die
taktische Kräftegliederung als DV‑102-Zeichen auf die Karte gebracht — **beide entity-gekoppelt**
(der Marker *ist* das Objekt, keine eigene Lage-Entität). Was fehlt, ist die Möglichkeit,
**Lage-Information ohne dahinterliegendes Fachobjekt** zu zeichnen: das **Gefahrengebiet**, den
**Absperrbereich**, die **Absperrgrenze** — Flächen und Linien, die eine taktische Aussage tragen,
aber zu keiner Einheit, keinem Fahrzeug, keinem erfassten Objekt gehören.

**Bewusste Abweichung vom „entity-gekoppelt"-Prinzip — und nur hier erlaubt.** PROGRESS hält
ausdrücklich fest: „Der freie, entitätslose Zeichen-/Annotations-Layer ist bewusst L‑3
vorbehalten." L‑3 ist damit die **eine** sanktionierte eigenständige Lage-Entität. Eine neue
Tabelle `lage_zone` verletzt das projektweite „eine Wahrheit"-Prinzip nicht — es gibt für diese
Zonen schlicht kein Fachobjekt, an das sie sich koppeln ließen; die Zone *ist* das Objekt.

Drei Punkte prägen das Design:

1. **Eigenständige Entität, typisiert.** Eine neue `lage_zone`-Tabelle (einsatz-skopiert, analog
   `einsatzabschnitt`). Jede Zone hat einen **Typ** aus einem kleinen fachlichen Katalog; der Typ
   bestimmt Geometrie (Fläche/Linie) und Darstellungsstil. Ein Auffang-Typ **„freie Skizze"**
   deckt alles ab, was der Katalog nicht trifft.
2. **Stil aus dem Typ abgeleitet — eine Wahrheit.** Wie `taktischesZeichen.ts` für DV‑102 leitet
   ein Frontend-Mapping (`zonenStil.ts`) Farbe/Strich/Füllung aus dem `typ` ab; nichts
   Stilbezogenes wird je typisierter Zone gespeichert. Nur die **freie Skizze** trägt eine
   gespeicherte Farbe. So greift eine spätere Katalog-Stiländerung rückwirkend, ohne Drift.
3. **Zone-Lebenszyklus ist sinntragend → ETB.** Anders als das reine Verorten in L‑1/L‑2 (das
   keinen ETB-Eintrag erzeugt, weil die fachliche Aktion die ETB-Spur ohnehin schreibt) hat eine
   Zone **keine dahinterliegende Aktion** — sie *ist* das Ereignis. Ein Gefahrengebiet
   einzurichten oder aufzuheben ist eine taktische Entscheidung und schreibt daher **automatisch**
   einen ETB-Eintrag.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Typ-Set mit freier-Skizze-Auffang.** Kleiner fachlicher Typ-Katalog (s. u.), Stil pro Typ
   voreingestellt; „freie Skizze" als Auffang-Typ mit frei wählbarer Farbe. **Verworfen:** rein
   freiform (keine sprechende Legende, keine einheitliche fachliche Lesart) und rein typisiert
   (jede nicht-katalogisierte Markierung unmöglich).
2. **Geometrie = Fläche (Polygon) + Linie (LineString).** Deckt „Gefahren- & Absperrzonen" exakt
   ab. **Verworfen für L‑3:** Punkt-Marker und freie Text-Annotationen (Scope-Erweiterung,
   späteres Thema).
3. **Stil typisierter Zonen wird im Frontend aus `typ` abgeleitet** (`zonenStil.ts`), nicht
   gespeichert. Nur die freie Skizze speichert `farbe`. **Verworfen:** Stil immer pro Zone
   speichern (verliert „Typ ⇒ Stil = eine Wahrheit", weicht vom L‑2-Muster ab).
4. **Anlegen / wesentliche Änderung / Aufheben einer Zone schreiben automatisch einen
   ETB-Eintrag.** Damit ist die Gefahrenlage nachvollziehbar dokumentiert. Folge: **Hard-Delete**
   ist sauber — die unveränderliche Spur lebt im ETB. **Verworfen:** kein ETB (würde Soft-Delete
   erzwingen, nur um überhaupt eine Spur zu behalten — und das sinntragende Ereignis bliebe
   undokumentiert).
5. **Bearbeiten ohne Reshape.** Nach dem Zeichnen sind **Typ, Label, Farbe (freie Skizze), Notiz**
   änderbar und die Zone löschbar — die **Geometrie nicht**. Falsch gezeichnet = löschen + neu.
   **Verworfen für L‑3:** Stützpunkt-Editing (terra-draw Select/Edit-Modus; deutlich mehr
   Frontend-State, späteres Thema).
6. **Live über einen neuen SSE-Kanal** `lage_zone` über den bestehenden `LiveHub`.
7. **Org-Bindung implizit über `einsatz_id`** (wie alle Einsatz-Sub-Entities); Org-Isolation wird
   explizit getestet (bekannte Cross-Org-Lücke).

## Typ-Katalog

| Typ (`typ`) | Geometrie | Stil (im FE aus `typ` abgeleitet) | Fachlich |
|---|---|---|---|
| `gefahrengebiet` | Fläche | Rot, transparent gefüllt, rote Kante | Eigentlicher Gefahrenbereich |
| `absperrbereich` | Fläche | Gelb/Orange, transparent gefüllt | Freizuhaltender Bereich um die Gefahr |
| `absperrgrenze` | Linie | Kräftige rote Linie (Absperr-/Postenkette) | Absperrgrenze als Linie |
| `sperrgebiet` | Fläche | Graue Schraffur/Füllung | Gesperrter Bereich |
| `freie_skizze` | Fläche **oder** Linie | Frei wählbare Farbe (`farbe`, gespeichert) | Auffang für alles Übrige |

- Der `typ` bestimmt beim Zeichnen automatisch das Werkzeug (Polygon bzw. Linie). Nur
  `freie_skizze` lässt Fläche/Linie **und** Farbe wählen.
- `gefahrengebiet`/`absperrbereich`/`sperrgebiet` ⇒ `geometrie_typ = 'Polygon'`;
  `absperrgrenze` ⇒ `'LineString'`; `freie_skizze` ⇒ je nach Wahl.

## Datenmodell & Migration

Eine Migration `migrations/0036_lage_zone.sql` (folgt auf `0035`) — neue Tabelle:

```sql
CREATE TABLE lage_zone (
  id            TEXT PRIMARY KEY,
  einsatz_id    TEXT NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
  typ           TEXT NOT NULL
                  CHECK (typ IN ('gefahrengebiet','absperrbereich','absperrgrenze','sperrgebiet','freie_skizze')),
  geometrie_typ TEXT NOT NULL
                  CHECK (geometrie_typ IN ('Polygon','LineString')),
  geometrie     TEXT NOT NULL,   -- GeoJSON-Geometry (Polygon oder LineString)
  label         TEXT,
  farbe         TEXT,            -- nur freie_skizze; sonst NULL (Stil aus typ abgeleitet)
  notiz         TEXT,
  erstellt_von  TEXT NOT NULL REFERENCES benutzer(id),
  erstellt_at   TEXT NOT NULL,
  geaendert_at  TEXT NOT NULL
);
CREATE INDEX idx_lage_zone_einsatz ON lage_zone(einsatz_id);
```

- `typ`/`geometrie_typ` mit `CHECK`-Constraint (sprechende 422 statt Silent-Garbage).
- **Hard-Delete**, kein Soft-Delete: die ETB-Spur trägt die Historie; `ON DELETE CASCADE` räumt
  beim Einsatz-Löschen mit auf.
- Org-Bindung implizit über `einsatz_id` (kein eigener Org-Fremdschlüssel, wie bei den anderen
  Einsatz-Sub-Entities).
- **Keine Plausibilitäts-Kopplung zwischen `typ` und `geometrie_typ` auf DB-Ebene** (z. B. „nur
  `absperrgrenze` darf LineString sein") — die fachliche Bindung erzwingt die App beim Anlegen
  (im Plan verorten), die DB hält nur die beiden unabhängigen `CHECK`s. So bleibt das Schema frei
  von Mehrspalten-CHECKs (Vorbild Einsatzort/L‑1).

## Backend — Modul `src/lage_zone/` (analog `einsatzabschnitt`)

Einsatz-skopierte CRUD-Routen:

- `GET    /api/einsaetze/{id}/zonen` — Liste aller Zonen des Einsatzes (Felder vollständig inkl.
  `geometrie`). Eine „Nicht verortet"-Sektion entfällt — Zonen entstehen durch Zeichnen und sind
  damit immer verortet.
- `POST   /api/einsaetze/{id}/zonen` — anlegen: `typ`, `geometrie_typ`, `geometrie`, `label?`,
  `farbe?` (nur freie Skizze), `notiz?`. Server setzt `id`, `erstellt_von`, `erstellt_at`,
  `geaendert_at`.
- `PATCH  /api/einsaetze/{id}/zonen/{zid}` — `label`/`typ`/`farbe`/`notiz` ändern. **Geometrie ist
  nicht änderbar** (kein Reshape). **Merge gegen den Effektivzustand** (Partial-PATCH-Vorbild aus
  L‑2: nur gesendete Felder ändern, nichts versehentlich nullen).
- `DELETE /api/einsaetze/{id}/zonen/{zid}` — aufheben (Hard-Delete).

### ETB-Integration (L‑3-spezifisch)

Anders als L‑1/L‑2 schreibt L‑3 ETB-Einträge, weil die Zone selbst das sinntragende Ereignis ist
(Annahme 4). Über den bestehenden Append-Pfad (`src/etb/`):

- **POST** → Eintrag „<Typ-Label> ‚<Label>' eingerichtet" (z. B. „Gefahrengebiet ‚Chemie Halle 3'
  eingerichtet"; ohne Label: „Gefahrengebiet eingerichtet").
- **PATCH** (wesentliche Änderung: `typ` oder `label`) → „… geändert". Reine `notiz`-/`farbe`-
  Änderung erzeugt **keinen** Eintrag (nicht sinntragend) — Abgrenzung im Plan festziehen.
- **DELETE** → „… aufgehoben".

Genauer Wortlaut/Format der Einträge im Plan festlegen (am vorhandenen ETB-Eintrags-Format
ausrichten).

### Berechtigung / Nachlauf

Wie alle Einsatz-Sub-Routen über `src/einsatz/berechtigung.rs`: lesen = `darf_lesen`;
anlegen/ändern/löschen = `ist_schreibberechtigt` + `fordere_aktiv`.

### Live (neuer SSE-Kanal)

Über den bestehenden `LiveHub`: Event-Tag `lage_zone` ergänzen, Publish bei POST/PATCH/DELETE.
Stream-Route analog L‑1/L‑2:

- `GET /api/einsaetze/{id}/zonen/stream`

## Frontend — `LagekartePage` erweitern (keine neue Seite)

- **Neuer Layer „Zonen"** in der linken Sidebar mit Toggle, neben Einsatzort/UHS/Schäden/
  Einheiten/Fahrzeuge/Personal-Führung/Abschnitte.
- **Zeichnen:** Typ aus dem Katalog wählen → der Zeichenmodus startet im passenden `terra-draw`-
  Modus (Polygon bzw. Linie). Dazu wird `abschnittDraw.ts` zu einem generischen Modul
  `zeichnen.ts` (Polygon **+** `TerraDrawLineStringMode`) verallgemeinert, das der L‑2-Abschnitt
  weiterhin (nur Polygon) nutzt. „Freie Skizze" lässt Fläche/Linie **und** Farbe wählen. Fertig
  gezeichnet → `POST`.
- **Rendering:** MapLibre-GeoJSON-Layer (Fill+Line bzw. Line); Stil aus `typ` abgeleitet über ein
  Mapping-Modul `frontend/src/pages/lagekarte/zonenStil.ts` (Analogon zu `taktischesZeichen.ts` —
  eine Wahrheit). `freie_skizze` rendert mit gespeicherter `farbe`. Label am Polygon-Zentroid bzw.
  an der Linienmitte.
- **Klick → Inspector:** Typ, Label, Notiz (und Farbe bei freier Skizze) anzeigen und editierbar
  (`PATCH`); Löschen-Button (`DELETE`). **Kein Stützpunkt-Editing.**
- **Live:** EventSource auf `…/zonen/stream` → Zonen erscheinen/ändern/verschwinden live (Muster
  aus L‑1/L‑2).
- **Kein Clustering** der Zonen (Flächen/Linien werden nicht geclustert).
- **Neue Abhängigkeiten:** keine — `terra-draw`/`terra-draw-maplibre-gl-adapter`/`maplibre-gl`
  bestehen aus L‑1/L‑2; nur der LineString-Modus der bereits installierten `terra-draw` kommt
  hinzu.

## Tests

- **Backend:** CRUD setzt/ändert/löscht eine Zone; `CHECK` lehnt ungültigen `typ`/`geometrie_typ`
  ab (422); Partial-`PATCH` nullt nichts versehentlich (Merge gegen Effektivzustand); **jede
  sinntragende Mutation schreibt den erwarteten ETB-Eintrag** (POST/wesentliches PATCH/DELETE),
  reine `notiz`/`farbe`-Änderung **nicht**; neuer SSE-Kanal feuert bei POST/PATCH/DELETE;
  Berechtigung (lesen/schreiben/Nachlauf); **Org-Isolation** explizit (Nutzer aus Org A kann fremde
  Zonen weder lesen noch ändern noch löschen — gemäß bekannter Cross-Org-Lücke).
- **Frontend (Vitest/@testing-library/MSW):** Layer-Toggle; Zeichen-Flow **Polygon und Linie**
  (Typ wählen → zeichnen → POST mit korrektem `geometrie_typ`); Stil je Typ korrekt aus
  `zonenStil.ts`; freie Skizze mit eigener Farbe (Fläche und Linie); Inspector-Edit (PATCH) +
  Löschen (DELETE); Live via SSE.

## Bewusst NICHT in L‑3 (Abgrenzung)

- **Stützpunkt-Reshape** nach dem Zeichnen (terra-draw Select/Edit-Modus) → späteres Thema
  (löschen + neu zeichnen).
- **CBRN-/ABC-konzentrische bzw. gestaffelte Gefahrenzonen** (automatisch generierte Ringe um eine
  Quelle) → späteres Thema.
- **Punkt-Marker und freie Text-Annotationen** → nicht in L‑3 (Geometrie auf Fläche + Linie
  begrenzt).
- **Zonen-Verschneidung / Flächenberechnung / Betroffenen-Verschneidung** (welche Personen/Objekte
  liegen in der Zone) → späteres Thema.
- **Drucklegende / PDF-Export der Lage** → querschnittlicher Report (Backlog).

## Abschluss Teilprojekt 4

Mit L‑3 ist die Lage-Sequenz funktional abgeschlossen (L‑1 Fundament, L‑2 taktische Gliederung,
L‑3 Gefahren-/Absperrzonen). Weiterhin offen/geparkt:

- **(L‑4, geparkt):** Live-Fahrzeugpositionen / Tracking — Machbarkeit zuerst (ClickUp
  `86ca1nv2v`).
- **Kräfteübersicht / Lage-Dashboard:** stellt die verorteten Kräfte als Liste/Meldebild dar
  (konsumiert dieselben Daten) — eigenes Modul außerhalb der Karte.
