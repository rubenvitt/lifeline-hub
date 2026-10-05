# Design

## Context

Motivation in `proposal.md`, Anforderungen in `specs/uhs-plan/spec.md`. Stand `origin/alpha`
am 05.10.2026, höchste Migration `0149`.

- **Platz-Layout:** `uhs_platz.pos_x/pos_y` in Flächen-Pixeln. Der Server vergibt neue Plätze
  im Raster `raster_position` (`src/uhs/platz_repo.rs`: 5 Spalten, Schritt 160 × 120, Rand 10).
  `Grundriss.tsx` zeichnet eine `position: relative`-Fläche mit
  `max(700, maxX + 160) × max(420, maxY + 140)` und darin absolut platzierte Platzkarten
  (140 × 116, deckender Grund `rollen.flaeche`/`bedienFlaeche`). Die Bedienform je Dichtestufe
  regelt die Spec `uhs-grundriss`.
- **Vorbild Bild-Hintergrund der Lagekarte** (`0075_karte_hintergrundbild.sql`,
  `src/karte_hintergrundbild/`, `routes/karte_hintergrundbild.rs`): BLOB in SQLite, MIME aus
  Magic Bytes, `anhang::scan` vor dem Speichern, Download mit sha256-ETag und 304-Kurzschluss
  ohne BLOB-Read, Client lädt per `fetch` in eine Object-URL (`api/kartenbilder.ts`). Kein
  Lese-Audit.
- **UHS-Anhänge** (LFH-758, `src/uhs/anhang.rs`, `routes/uhs_anhang.rs`): Linker-id als
  `{aid}`, jeder Download schreibt vor der Antwort eine Zeile in `anhang_zugriff_audit`
  (`anhang::audit_repo::anlegen`, `fassung` `bereinigt|original`), fail-closed.
- **Bereinigung** `anhang::metadaten::bereinigen(daten, mime)`: JPEG/PNG/WebP/GIF/TIFF/HEIF
  aus Magic Bytes, Positivlisten, Kontrollnetz, fail-closed (`Unbereinigbar`).
- **Geräte** (LFH-892, `src/geraet/mod.rs`): Routenlisten je Ansicht. `uhs-tablet` liest
  `GET …/uhs/{uid}` und meldet Verfügbarkeit/Belegung, `uhs-laptop` darf zusätzlich Plätze
  anlegen, verschieben und löschen. `stelle::fordere_uhs` bindet an die eigene UHS (fremd 404).
- **Live:** `sse_uhs(state, einsatz_id, uhs_id)` publiziert `LiveEvent::Uhs`; der Client lädt
  daraufhin `uhsDetail` neu.

## Goals / Non-Goals

**Goals:**

- Der Plan liegt unter den Platzkarten, ohne deren Bedienung oder Größe zu berühren.
- Das Lese-Audit der UHS-Dateien enthält weiter nur echte Abrufe, die Übernahme als Plan
  eingeschlossen.
- Der Plan folgt den bestehenden Mustern (Bild-Hintergrund, Bereinigung, Gerätelisten), ohne
  neue Abhängigkeit.

**Non-Goals:**

- **Kein PDF als Plan.** Ein PDF müsste gerastert werden (Server-Abhängigkeit oder pdf.js im
  Client). Wer einen PDF-Plan hat, exportiert eine Seite als Bild. Folgeticket nur bei Bedarf.
- **Keine Drehung, kein Zuschnitt, keine Georeferenz.** Versatz und Breite reichen für einen
  Hallenplan; das Raster dreht sich auch nicht.
- **Kein Ziehen des Plans mit der Maus.** Lage über Zahlenfelder und „An Plätze einpassen“.
  Ein Zug-Griff am Plan konkurrierte mit dem Zug der Platzkarten (Spec `uhs-grundriss`,
  „Gesten bleiben Zusatzwege“).
- **Nicht offline.** Das Lagebild ohne Netz speichert den Plan nicht; ohne Netz zeigt der
  Grundriss die leere Fläche wie bisher. Geräte speichern ohnehin nichts (`geraet/AGENTS.md`).
- **Kein Plan in Lagemonitor, Druck, Lage-Snapshot oder Demo-Daten.**
- **Keine Änderung an UHS-Anhängen, Lese-Audit, Lagekarte und `raster_position`.**

## Decisions

### D1 Eigene Bytes statt Verweis auf einen Anhang

Der Plan hat eigene Bytes in einer eigenen Tabelle. Er kann hochgeladen oder aus einem
Bild-Anhang derselben UHS **kopiert** werden.

**Warum:** Das Lese-Audit soll sagen, wer eine Datei geöffnet hat. Ein Verweis auf einen
Anhang hätte nur zwei Wege, und beide brechen das:
- **Verweis mit Audit je Anzeige:** Jede Ansicht des Grundrisses, auch jedes Neuladen nach
  einem Live-Ereignis, schriebe eine Zeile. Das Protokoll wäre Lärm.
- **Verweis mit eigenem Anzeige-Endpunkt ohne Audit:** Der Anhang wäre über einen zweiten
  Weg unprotokolliert lesbar, solange er Plan ist. Das Audit wäre für genau diese Datei
  falsch.

Die Kopie macht den Unterschied sichtbar: Die Übernahme ist ein bewusster Abruf (eine
Audit-Zeile, D4) und ein ETB-Eintrag „Plan hinterlegt“. Ab dann ist der Plan ein eigenes,
für alle Modul-Lesenden sichtbares Bild wie ein Bild-Hintergrund der Lagekarte.

**Verworfen:**
- **Audit gedrosselt (eine Zeile je Person und Tag):** weniger Lärm, aber das Protokoll
  sagt dann „hat den Grundriss angesehen“ statt „hat die Datei geöffnet“, und die Drossel
  braucht eigenen Zustand.
- **Nur Upload, keine Übernahme:** einfacher, aber LFH-758 hat den Plan zum Anhang erklärt;
  wer ihn dort abgelegt hat, müsste ihn erst herunterladen (eine Audit-Zeile ohne Kontext)
  und wieder hochladen.

### D2 Tabelle `uhs_plan`, eine Zeile je UHS

Migration `0150_uhs_plan.sql` (Nummer vor dem PR gegen frisches `origin/alpha` prüfen):

```sql
CREATE TABLE uhs_plan (
    uhs_id          INTEGER PRIMARY KEY REFERENCES uhs(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    daten           BLOB    NOT NULL,          -- bereinigt (D3), nie das Original
    mime            TEXT    NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    bild_breite     INTEGER NOT NULL CHECK (bild_breite > 0),
    bild_hoehe      INTEGER NOT NULL CHECK (bild_hoehe > 0),
    x               INTEGER NOT NULL DEFAULT 0,
    y               INTEGER NOT NULL DEFAULT 0,
    breite          INTEGER NOT NULL CHECK (breite BETWEEN 100 AND 5000),
    helligkeit      INTEGER NOT NULL DEFAULT 100 CHECK (helligkeit BETWEEN 20 AND 100),
    kontrast        INTEGER NOT NULL DEFAULT 100 CHECK (kontrast BETWEEN 50 AND 150),
    nacht_umkehren  INTEGER NOT NULL DEFAULT 1 CHECK (nacht_umkehren IN (0, 1)),
    hinterlegt_von  INTEGER NOT NULL REFERENCES benutzer(id),
    hinterlegt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
```

- **`uhs_id` als Schlüssel** setzt „höchstens ein Plan“ durch Bau durch; Ersetzen ist ein
  `INSERT … ON CONFLICT(uhs_id) DO UPDATE`.
- **`einsatz_id` am Plan** dient der Schwärzung (`Scoping::EinsatzId`) und dem Zugriff mit
  `WHERE einsatz_id = ? AND uhs_id = ?`, wie bei `karte_hintergrundbild`.
- **Ganze Zahlen statt `REAL`:** Werte rasten ohnehin auf 10 px ein (D5).
- **Kein FK auf `anhang`:** Die Kopie ist unabhängig (Spec „Anhang danach entfernt“). Der
  Guard `jeder_fremdschluessel_auf_anhang_ist_registriert` bleibt unberührt.

**Verworfen:** Spalten an `uhs`. Der BLOB läge dann in jeder `SELECT *`-nahen Abfrage der UHS
im Weg, und die Schwärzung müsste Spalten statt einer Zeile behandeln.

### D3 Annahme eines Bildes

Gemeinsamer Weg für Upload und Übernahme in `src/uhs/plan.rs`:

1. `karte_hintergrundbild::pruefe_groesse` (0 Byte / > 25 MiB → 400).
2. Format aus `anhang::metadaten::erkenne`: nur PNG, JPEG, WebP. Beim Upload sonst 400
   („Nur PNG-, JPEG- oder WebP-Bilder können als Plan dienen“), bei der Übernahme 422, weil
   dort der Zusammenhang (Anhang ist ein PDF/HEIC) entscheidet, nicht das Feld.
3. **Nur beim Upload:** `anhang::scan` vor allem Weiteren (fail-closed 503, Fund 422). Ein
   Anhang wurde beim Ablegen schon geprüft.
4. `metadaten::bereinigen` → gespeichert werden **die bereinigten Bytes**. Anders als beim
   Anhang gibt es kein Original als Beweismittel; der Plan ist eine Anzeige. `Unbereinigbar`
   → 422.
5. Bildmaße aus dem Kopf (`image::ImageReader::with_format(..).into_dimensions()`, ohne
   Dekodieren). Scheitert das → 422. Grenze: höchstens 10 000 px je Kante, sonst 422 (ein
   größeres Bild lässt der Browser auf Tablets nicht zuverlässig zeichnen).
6. sha256 über die gespeicherten Bytes (ETag).

Die Prüfungen 1–5 laufen vor der Transaktion; HEIC wird abgelehnt, weil der Browser es ohne
den HEIC-Decoder der Anhangvorschau nicht als `<img>` zeigt.

### D4 Übernahme aus einem Anhang

`POST …/uhs/{uid}/plan/aus-anhang` mit `{ "anhang_id": <Linker-id> }`:

1. Gate, Stellenbindung, UHS im Einsatz (404), storniert (409).
2. `uhs_anhang::anhang_id_fuer_download(einsatz, uhs, linker_id)` → fremd oder entfernt 404.
3. `audit_repo::anlegen(…, ablage = "UHS BHP 50", fassung = Bereinigt)` **vor** dem Lesen der
   Bytes. Scheitert sie → Fehler, kein Plan. Die Fassung `bereinigt` ist wahr: Gespeichert wird
   die bereinigte Fassung. Kein neuer CHECK-Wert, also keine Migration der Audit-Tabelle.
4. Bytes über einen neuen, engen Weg aus `anhang::repo` laden, der nur `uhs::plan` nutzt.
   **Achtung Guard** `nur_support_liefert_anhang_bytes_aus` (`tests/anhang_metadaten.rs`): Er
   erlaubt `anhang::repo::laden_bytes` nur in `routes/support.rs`. Der Plan liefert die Bytes
   nicht aus, er kopiert sie bereinigt. Lösung: eine Funktion `support::anhang_bereinigt_kopieren`
   in `routes/support.rs`, die die bereinigten Bytes zurückgibt; damit bleibt der Guard
   unverändert und die einzige Lesestelle in `support`.
5. D3 Schritte 2, 4–6 (ohne Scan), dann die Transaktion wie beim Upload (D6).

Scheitert ein Schritt nach der Audit-Zeile (etwa 422 für ein PDF), bleibt die Zeile stehen,
wie beim 422 eines nicht bereinigbaren Downloads in LFH-758: Sie belegt einen Versuch. Um
diesen Fall klein zu halten, prüft die Route den gespeicherten `mime` des Anhangs **vor** dem
Audit und lehnt Nicht-Bilder mit 422 ab, ohne Zeile.

### D5 Lage und Einpassen

- **Koordinaten** wie `pos_x/pos_y` der Plätze. Höhe = `breite × bild_hoehe / bild_breite`.
- **Einrasten** auf 10 px im Server (`(v + 5) / 10 * 10` für nicht-negative, symmetrisch für
  negative Werte): eine Regel, egal ob Client oder Test schreibt.
- **Startlage** beim ersten Hinterlegen: der Server berechnet „an Plätze einpassen“ (D5a);
  ohne Plätze `x = 0, y = 0, breite = 820` (5 Rasterspalten). Beim **Ersetzen** bleibt die
  Lage, Darstellung bleibt ebenso; nur Bytes und Maße wechseln.
- **D5a Einpassen:** Rahmen aller Plätze (`min/max pos` plus Kartengröße 140 × 116) plus
  20 px Rand; der Plan wird so skaliert, dass er diesen Rahmen ganz überdeckt (größerer der
  beiden Faktoren), und am Rahmen oben links angesetzt. Im Client als Knopf, der einen PATCH mit
  den errechneten Werten schickt; die Rechnung steht einmal in `api/uhsPlan.ts` und im Server
  für die Startlage (gleiche Konstanten, je ein Test).
- **Fläche:** `Grundriss.tsx` nimmt `x + breite` und `y + hoehe` in die Größe der Fläche auf.

### D6 Routen, Rechte, ETB, Live

`src/routes/uhs_plan.rs`, Block in `src/app.rs`:

| Methode | Pfad | Gate |
|---|---|---|
| `PUT` | `…/uhs/{uid}/plan` (Multipart `datei`) | `EinsatzSchreibzugriff<Unfallhilfsstellen>`, `DefaultBodyLimit::max(26 MiB)` |
| `POST` | `…/uhs/{uid}/plan/aus-anhang` | `EinsatzSchreibzugriff<Unfallhilfsstellen>` |
| `PATCH` | `…/uhs/{uid}/plan` (`x`, `y`, `breite`, `helligkeit`, `kontrast`, `nacht_umkehren`) | `EinsatzSchreibzugriff<Unfallhilfsstellen>` |
| `DELETE` | `…/uhs/{uid}/plan` | `EinsatzSchreibzugriff<Unfallhilfsstellen>` |
| `GET` | `…/uhs/{uid}/plan/bild` | `EinsatzLesezugriff<Unfallhilfsstellen>`, `ConcurrencyLimitLayer` |

- Jede Route ruft `stelle::fordere_uhs` und lädt die UHS im Einsatz (404). Schreibende Routen
  lehnen eine stornierte UHS mit 409 ab, in der Route und in der Transaktion.
- **Geräte:** `GET …/plan/bild` in die Listen `uhs-tablet` und `uhs-laptop`; `PUT`, `POST`,
  `PATCH`, `DELETE` nur in `uhs-laptop`, wie die Platz-Routen. Test zuerst in
  `tests/geraet_kopplung.rs` (Regel `geraet/AGENTS.md`), der Routen-Guard
  `tests/geraet_routen_guard.rs` muss die neuen Pfade kennen.
- **ETB:** `PUT` und `aus-anhang` schreiben in einem `write_retry!` Plan und
  `etb::system_audit_tx("UHS BHP 50: Plan hinterlegt")`; `DELETE` ebenso „Plan entfernt“.
  `PATCH` schreibt keinen Eintrag. Der Text nennt nur die Bezeichnung (`uhs_anhang::ablage_name`),
  die die Schwärzung behält (`retain`, `G_OP_LABEL`). Weil sie keine Scrub-Spalte ist, braucht
  sie keinen Eintrag in `AUSNAHMEN_SYSTEM_ETB` (`tests/aufbewahrung_e2e.rs`).
- **Statuscodes** nach `src/AGENTS.md`: Feldwerte außerhalb der Grenzen 400, Zustand
  (storniert) 409, Inhalt (Bild nicht nutzbar, Anhang kein Bild) 422, kein Plan 404.
- **Live:** nach jedem Commit `sse_uhs` (schon `pub(crate)`). Der Plan reist als Feld im
  Detail mit (D7), also lädt der Client ihn mit dem bestehenden Neuladen nach.
- **`GET …/plan/bild`:** Meta (`sha256`, `mime`) ohne BLOB, ETag `"<sha256>"`,
  `If-None-Match` → 304; sonst Bytes mit `Content-Type` des Plans,
  `Content-Disposition: inline`, `nosniff`, `ANHANG_CSP` und `ASSET_CACHE_CONTROL`. Kein Audit,
  kein ETB.

### D7 DTO am Detail

`UhsDetail` (`routes/einsatz_uhs.rs`) bekommt `plan: Option<UhsPlanAnzeige>` mit
`skip_serializing_if` (Norm „Optionalität ehrlich“). `UhsPlanAnzeige`: `mime`, `sha256`,
`bild_breite`, `bild_hoehe`, `x`, `y`, `breite`, `helligkeit`, `kontrast`,
`nacht_umkehren: bool`, `hinterlegt_at`, `geaendert_at`. Antworten der schreibenden Routen
liefern dasselbe DTO. Typ-Codegen (`scripts/check-typ-codegen.sh`) mit beiden generierten
Dateien.

**Verworfen:** eigener Query-Key `uhsPlan`. Das Detail lädt ohnehin bei jedem
`LiveEvent::Uhs` neu; ein zweiter Key bräuchte eine eigene Live-Zuordnung.

### D8 Frontend

- **`api/uhsPlan.ts`:** `ladePlanBild(einsatzId, uhsId, sha256)` → Object-URL wie
  `ladeBildBlobUrl` (Freigabe beim Wechsel), `hinterlegePlan`, `uebernehmePlan`,
  `aenderePlan`, `entfernePlan`, `einpassen(plaetze, plan)`.
- **Bildebene in `Grundriss.tsx`:** erstes Kind der Fläche, `<img>` mit
  `position: absolute`, `left/top/width` aus dem DTO, `pointer-events: none`,
  `user-select: none`, `draggable={false}`, `alt=""` und `aria-hidden` (der Plan trägt keine
  Information, die nicht auch in den Platzkarten steht). Die Bild-Query hängt an
  `[…uhsDetail, 'plan', sha256]`, also lädt ein unveränderter Plan nach einem Live-Ereignis
  nicht neu; `staleTime: Infinity`. Der Key steht in der Query-Key-Registry
  (`frontend/AGENTS.md`), als `NICHT_LIVE`, weil er am sha256 hängt.
- **Filter:** `filter: brightness(h%) contrast(k%)`; im dunklen Thema (`useRollen().dunkel`)
  und `nacht_umkehren` vorneweg `invert(1) hue-rotate(180deg)`. Die Reihenfolge ist Absicht:
  erst umkehren, dann dimmen, sonst hellt „Helligkeit 40 %“ nach dem Umkehren auf.
- **Platzkarten:** unverändert. Ihr Grund ist schon deckend; ein Test pinnt, dass er es bleibt
  (Spec „Plätze bleiben auf dem Plan bedienbar“).
- **Bedienfeld „Plan“:** nur bei `platzEditAktiv`, als Knopf „Plan“ in der Kopfzeile der Fläche
  neben „Platz anlegen“. Er öffnet ein Seitenpaneel nach der UI-Form-Leitlinie
  (`frontend/AGENTS.md`) mit: „Bild hochladen“ (`DateiFeld`, Accept PNG/JPEG/WebP), „Aus
  Dateien übernehmen“ (Auswahl der Bild-Anhänge dieser UHS aus der vorhandenen Liste, ohne
  Vorschau, mit dem Hinweis, dass die Übernahme als Abruf protokolliert wird), Zahlenfelder
  „Links“, „Oben“, „Breite“ (Schritt 10), Regler „Helligkeit“ und „Kontrast“, Schalter „Im
  Nachtbetrieb umkehren“, Knopf „An Plätze einpassen“ und „Plan entfernen“ mit roter Rückfrage.
  Zahlen und Regler schicken den PATCH beim Loslassen, nicht bei jedem Schritt.
- **Ohne Bearbeiten-Modus** gibt es keine Plan-Bedienung; das Tablet sieht nur das Bild.

### D9 Schwärzung und Aufbewahrung

`TabellenRegel` `uhs_plan` mit `Scoping::EinsatzId` und `ZeileLoeschen`, eingereiht vor `uhs`.
Anders als `karte_hintergrundbild` (Kartografie, bleibt) kann ein übernommenes Bild ein Foto
aus der Behandlungsstelle sein; der Plan ist für das Skelett nicht nötig. Guards
`entdeckte_tabellen_gleich_registry_tabellen` und `keine_toten_registry_eintraege` decken den
Eintrag; `schwaerzung_hinterlaesst_keine_altbytes` bekommt einen Plan in den Testeinsatz.
Die Akte im Archiv projiziert die Tabelle nicht (keine Retain-Spalte mit Inhalt außer
Schlüsseln und Zahlen); `jede_archivspalte_ist_retain` bleibt unberührt.

### D10 Dokumentation

`src/AGENTS.md`, Abschnitt „Anhänge“, unter dem UHS-Lese-Audit ein Satz: Der Plan einer UHS
(`uhs_plan`, LFH-999) ist kein Anhang; seine Anzeige schreibt kein Audit, nur die Übernahme
aus einem Anhang eine Zeile; Herleitung dieses Design. `frontend/src/geraet/AGENTS.md` bleibt
unverändert (die Regel „Listeneintrag zuerst“ gilt schon).

## Risks / Trade-offs

- **[Unprotokolliertes Patientenfoto als Plan]** Wer ein Foto als Plan hochlädt oder
  übernimmt, macht es allen Modul-Lesenden ohne Audit sichtbar. → Upload und Übernahme
  stehen mit Person im ETB, die Übernahme zusätzlich im Lese-Audit; das Bedienfeld sagt „Nur
  Pläne, keine Fotos von Patienten“; die Schwärzung löscht den Plan (D9).
- **[Große Bilder auf Tablets]** Ein 10 000-px-Plan belastet ein schwaches Tablet. → Grenze
  10 000 px je Kante (D3), Bild nur einmal je sha256 geladen (D8).
- **[Guard `nur_support_liefert_anhang_bytes_aus`]** Die Übernahme muss Anhang-Bytes lesen. →
  Die Lesestelle bleibt in `routes/support.rs` (D4); der Guard bleibt unverändert grün.
- **[Umkehren verfälscht Farben]** Ein farbiger Plan (Fluchtwege grün) wird im dunklen Thema
  in Gegenfarben gezeigt. → `hue-rotate(180deg)` hält Farbtöne annähernd; wer Originalfarben
  braucht, schaltet die Umkehr je Plan ab.
- **[Migrationsnummer]** Parallele Tickets vergeben ebenfalls Nummern. → vor dem PR
  `scripts/check-migrationen.sh` gegen frisches `origin/alpha`, bei Bedarf `--umnummerieren`.

## Migration Plan

Eine additive Migration (neue Tabelle, kein Rebuild). Rückweg über das vorige Release; die
Tabelle bleibt dann leer zurück, wie es die Migrationsregel verlangt.
