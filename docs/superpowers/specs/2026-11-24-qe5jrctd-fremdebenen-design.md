# Fremdebenen aus Datei und URL — Design

Stand: 24.11.2026 · gemeinsames Design-Doc für LLH-2099 (Teil B, Datei) und LLH-2100 (Teil C,
URL) von LLH-1196
Zunder: https://zunder.rubeen.dev/#/aufgabe/nk5bt34vnamokity1l3izqyo ·
https://zunder.rubeen.dev/#/aufgabe/jgmuoqbeycimf0dadl664who
Bezug: `docs/konzepte/2026-11-10-schnittstellen-ausbau.md` (Geodaten, „Fremdebene aus URL“).

## Absicht

Ein Nachbarkreis schickt seine Lage als KML, das THW seine Abschnitte als GeoJSON, die Suchlage
stellt Sektoren und Flugspuren unter einer Adresse bereit. Bis heute geht das nur als
Screenshot. Eine **Fremdebene** zeigt solche Geodaten über der eigenen Karte: für alle
Arbeitsplätze des Einsatzes, nur lesend, klar als fremd erkennbar und ein- und ausblendbar.

## Ziele

- **Datei (B):** GeoJSON, KML oder KMZ hochladen. Die Ebene erscheint für alle am Einsatz, live.
- **URL (C):** eine Adresse eintragen, an der GeoJSON oder KML liegt. Der Server hält die Ebene
  aktuell (bedingt per ETag), und die Karte zeigt, wie alt der Stand ist.
- Ungültige Dateien und gestörte Abrufe geben eine verständliche Meldung, nie einen stillen
  Fehler.
- **Fremddaten sind abgesichert:**
  - Größen- und Mengengrenzen, Koordinatenprüfung;
  - keine DTDs, kein Folgen verlinkter Inhalte;
  - SSRF-Schutz beim URL-Abruf;
  - ClamAV beim Upload.

## Nicht-Ziele

- Einzelne Objekte als eigene Zeichnung übernehmen (optional laut Auftrag, Folgeaufgabe).
- Fremdebenen in gesicherten Ständen (Lage-Snapshot) und im Lagemonitor bzw. Lagebild extern.
- Fremde Stile (KML-Icons, Farben der Quelle) übernehmen. Eine Fremdebene hat genau eine Farbe.
- WMS/WFS, GPX, Shapefile, Copernicus (eigene Aufgabe LLH-1200).

## Anti-Ziele

- Der Server holt nie, was eine Datei verlinkt (`NetworkLink`, `Icon/href`, `<link>`,
  `xlink`, externe Entities).
- Eine Fremdebene sieht nie aus wie eigene Lage. Sie hat eine eigene Farbe, keine taktischen
  Zeichen und ist im Baum als fremd gruppiert.
- Ein gestörter Abruf löscht nicht den letzten guten Stand.

## Abgestimmt (Phase-1-Checkpoint, 24.11.2026)

- Die Fremdebene **lebt am Einsatz, für alle**: serverseitig gespeichert, geprüft, gescannt, live
  verteilt.
- Der Server parst, der Browser bekommt nur normiertes GeoJSON.
- Die URL holt nur der Server, über den Weg von `adapter::ziel` (`check_url`, keine
  Weiterleitung, nur `https`, gedeckeltes Lesen).
- Farbe aus einer festen Palette, je Ebene automatisch eine eigene.
- `quick-xml` wird direkte Abhängigkeit.

## Ansätze

1. **Server parst und speichert, Vorbild Bild-Hintergründe (gewählt).** Eigene Tabellen,
   multipart-Upload, ClamAV, Spiegel-Kategorie, Live-Ereignis. Alle Arbeitsplätze sehen
   dasselbe, und die Prüfung liegt an einer Stelle.
2. **Browser parst, Ebene nur lokal.** Verworfen: Die anderen sehen sie nicht, die Prüfung fehlt,
   und die URL-Ebene scheitert an CORS.
3. **URL-Ebene als Adapter-Art (`adapter::art`).** Verworfen: Adapter sind org-weit, von
   Admins verwaltet und schreiben in einen Vertrag. Eine Fremdebene gehört zu einem Einsatz und
   wird in der Lagekarte angelegt. Übernommen wird nur der Netzweg (`adapter::ziel`).

## Entwurf

### Daten

Migration `karte_fremdebene` (Metadaten) und `karte_fremdebene_daten` (Inhalt). Die Teilung folgt
LFH-936 bzw. `karte_hintergrundbild_daten`: Die Liste liest nie den Inhalt.

```
karte_fremdebene
  id, einsatz_id → einsatz ON DELETE CASCADE, name TEXT (≤ 120),
  quelle TEXT ('datei' | 'url'), url TEXT NULL,
  farbe TEXT (Palettenschlüssel), angelegt_von → benutzer, erstellt_at, geaendert_at,
  -- nur URL:
  quelle_etag TEXT NULL, quelle_last_modified TEXT NULL,
  abgerufen_at TEXT NULL,        -- letzter erfolgreicher Abruf (auch 304)
  versucht_at TEXT NULL, fehler TEXT NULL  -- Code, nie Text des Ziels
karte_fremdebene_daten
  ebene_id → karte_fremdebene ON DELETE CASCADE, geojson TEXT, sha256 TEXT,
  objekte INTEGER, verworfen INTEGER   -- Zahl der Objekte ohne lesbare Geometrie
```

- **Arten** als `wire_enum!` (ADR-0006): `FremdebeneQuelle`, `FremdebeneFehler` (siehe unten),
  im Enum-Kontrakt.
- **Pflicht-Einträge wie bei `karte_hintergrundbild`:**
  - `instanz::spiegel::art`: Metadaten `K::Lage`, Daten `K::Anhaenge`, und die Übernahme in
    `uebernehmen.rs`;
  - Aufbewahrung über CASCADE am Einsatz, Archiv-Klassifikation (`klassifikation_von`);
  - Schwärzungsregister für den Freitext `name` und die `url`;
  - Kapitel 5 der arc42 für das neue Modul `src/karte_fremdebene/`.
  Was die Wächter verlangen, zeigt `grep karte_hintergrundbild` über `src/` und `tests/`.

### Routen (englisch, Glossar um `foreign-layers	Fremdebenen` ergänzt)

**Präfix `/api/incidents` (Ruben, 24.11.2026):** Neue Einsatzrouten können nicht unter
`/api/einsaetze/{id}/…` entstehen, weil der Bestand des Routen-Wächters nicht wachsen darf
(ADR-0097). Sie liegen deshalb schon unter `/api/incidents/{id}/…`, bis das Präfix-Paket die
übrigen nachzieht. Der Einsatz-Gate-Wächter (`tests/einsatz_kontext_guard.rs`, ADR-0005) prüft
dafür beide Präfixe, und der Extractor für die Einsatz-ID muss unter beiden greifen. Gemeinsam
mit LLH-2101; der Schritt kommt als erste Aufgabe in den Plan.

| Methode und Pfad | Gate | Zweck |
|---|---|---|
| `GET /api/incidents/{id}/map/foreign-layers` | `EinsatzLesezugriff<Lagekarte>` | Liste mit Metadaten, Stand, Fehler, Zahl der Objekte |
| `POST /api/incidents/{id}/map/foreign-layers` | `EinsatzSchreibzugriff<Lagekarte>` | multipart: `name`, und genau eines von `file` (Datei) oder `url` |
| `GET …/foreign-layers/{ebeneId}/data` | `EinsatzLesezugriff<Lagekarte>` | normiertes GeoJSON, `ETag` = sha256, 304 bei `If-None-Match` (Vorbild `karte::fachebene_antwort`, ungepackt nach LFH-940) |
| `PATCH …/foreign-layers/{ebeneId}` | `EinsatzSchreibzugriff<Lagekarte>` | `name`, `farbe` |
| `DELETE …/foreign-layers/{ebeneId}` | `EinsatzSchreibzugriff<Lagekarte>` | entfernen |

- **Upload-Grenzen:** `DefaultBodyLimit::max(UPLOAD_BODY_MAX)` und `upload_grenze` wie bei den
  Bild-Hintergründen; die eigene Dateigrenze ist kleiner (unten).
- **Neue Wire-Felder** sind englisch (`name`, `source`, `url`, `color`, `fetched_at`,
  `attempted_at`, `error`, `feature_count`, `dropped_count`), die Rust-Felder gleich benannt.
  Danach `scripts/check-typ-codegen.sh`.
- **Live:** ein Ereignis wie `sse_bild`, das im Client die Liste und gegebenenfalls die Daten
  einer Ebene ungültig macht. Es wird beim Anlegen, Ändern, Löschen und bei einem Abruf mit neuem
  Inhalt gesendet.

### Einlesen (`src/karte_fremdebene/einlesen/`)

Erkannt wird am Inhalt, nicht an der Endung: ZIP-Signatur heißt KMZ, `<` als erstes
Nicht-Leerzeichen heißt KML, `{` heißt GeoJSON.

- **GeoJSON:**
  - `serde_json` in `FeatureCollection`, `Feature` oder eine nackte Geometrie;
  - `crs` wird ignoriert (RFC 7946: WGS84);
  - `GeometryCollection` wird flachgeklopft.
- **KML:**
  - `quick-xml` als Ereignisleser;
  - **`DocType` → sofort Ablehnung** (`dtd`), Entities werden nie aufgelöst;
  - gelesen werden `Placemark` mit `name`, `description`, `Point`, `LineString`, `LinearRing`,
    `Polygon` (äußerer und innerer Ring), `MultiGeometry` und `gx:Track` (`gx:coord` → LineString,
    die Flugspuren der Suchlage);
  - `coordinates` kommen als `lon,lat[,alt]`, die Höhe wird verworfen;
  - alles andere wird überlesen, auch `NetworkLink`, `Icon`, `href`, `Style` und `ExtendedData`;
  - der `Document`-`name` dient als Namensvorschlag.
- **KMZ:**
  - mit `zip` (Muster `abloesung/schichtplan/uebernahme/datei.rs`), nur der erste Eintrag mit
    Endung `.kml` (bevorzugt `doc.kml`);
  - die entpackte Größe wird beim Lesen gedeckelt, nicht aus dem Kopf geglaubt;
  - andere Einträge werden nie gelesen.
- **Normieren:**
  - je Objekt nur `name` (≤ 200 Zeichen) und `description` als reiner Text (Tags entfernt,
    ≤ 1000 Zeichen);
  - sonst keine Properties;
  - Koordinaten auf 6 Nachkommastellen gerundet.
- **Grenzen** als Konstanten im Modul, gespiegelt in `frontend/src/api/eingabegrenzen.ts`:
  - Datei ≤ 10 MiB, KMZ entpackt ≤ 20 MiB;
  - ≤ 5000 Objekte, ≤ 200 000 Stützpunkte gesamt, ≤ 5000 je Linie oder Ring;
  - normiertes GeoJSON ≤ 8 MiB.
- **Koordinaten:**
  - lon −180…180, lat −90…90, endlich;
  - ein Ring hat ≥ 4 Punkte und ist geschlossen (wird sonst geschlossen);
  - ein Objekt mit ungültiger Geometrie wird verworfen und gezählt (`dropped_count`), ein
    Objekt ganz ohne Geometrie ebenso;
  - die vorhandene `pruefe_geometrie_struktur` (`lage_zone`) wird auf Punkt und Multi-Geometrien
    verallgemeinert oder neben ihr ergänzt (Wahl des Bauenden, ein Ort für die Bereichsprüfung).

### Fehler

400 mit `grund` (Statuscode-Konvention `src/AGENTS.md`). Eine Datei über der Grenze bekommt
413. Die Texte stehen gleichlautend im Client:

| Code | Meldung |
|---|---|
| `unlesbar` | Die Datei ist kein GeoJSON, KML oder KMZ. |
| `dtd` | Die Datei enthält eine DTD und wird aus Sicherheitsgründen nicht gelesen. |
| `zu_gross` | Die Datei ist zu groß (höchstens 10 MB). |
| `zu_umfangreich` | Die Datei ist zu umfangreich. |
| `zu_viele_objekte` | Die Datei enthält zu viele Objekte (höchstens 5000). |
| `leer` | Die Datei enthält keine lesbaren Orte. |
| `koordinaten` | Die Koordinaten liegen außerhalb der Erde. Ist die Datei in WGS84? |
| `virus` | Die Datei wurde vom Virenscanner abgelehnt. |

Für eine URL kommen hinzu (gespeichert in `fehler`, angezeigt an der Ebene): `nicht_erreichbar`,
`weiterleitung`, `abgelehnt`, `status`, `ziel_intern`, `zeitlimit` und die Einlese-Codes oben.

### URL-Ebene (C)

- **Anlegen:**
  - `check_url(url, lan_erlaubt)` (liegt in `public_api::webhook::ziel`, `adapter::ziel` nutzt es) vor dem Speichern, nur `https`;
  - der erste Abruf läuft synchron in der Anlage-Anfrage, damit ein Tippfehler sofort als
    Fehler zurückkommt (nach dem Ablauf beim Adapter-Probelauf).
- **Abruf** über einen neuen öffentlichen Helfer in `adapter::ziel`, etwa
  `abrufen_begrenzt(url, lan_erlaubt, deckel, etag, last_modified)`:
  - derselbe Client (`no_proxy`, keine Weiterleitung, pinnender `WebhookResolver`, Zeitlimits);
  - `If-None-Match` und `If-Modified-Since`, gedeckeltes Lesen über `http_begrenzt`.
  - Die Regel „kein Client außerhalb von `adapter::ziel`“ bleibt damit wahr. In `src/AGENTS.md`,
    Abschnitt Adapter, steht ein Satz, dass die Fremdebene diesen Weg mitbenutzt.
- **Aktualisieren beim Lesen:**
  - Fragt ein Client `…/data` und liegt `versucht_at` länger als 60 s zurück, holt der Server
    zuerst bedingt nach;
  - je Ebene nur ein Abruf gleichzeitig (Single-Flight), Wartende bekommen das Ergebnis;
  - 304 aktualisiert nur `abgerufen_at`, 200 mit neuem Inhalt ersetzt die Daten und sendet das
    Live-Ereignis;
  - ein Fehler setzt `fehler`, die Daten bleiben;
  - ein Hintergrundlauf ist dafür nicht nötig, solange niemand hinsieht.
- **Client:** `refetchInterval` 60 s auf `…/data`, solange die Ebene sichtbar ist und der Tab im
  Vordergrund.
- **Anzeige** an der Zeile im Baum:
  - Alter des Stands („vor 3 min“, Regel „Fachebenen nennen ihr Alter“,
    `frontend/src/pages/lagekarte/AGENTS.md`);
  - bei `fehler` ein Warnhinweis mit der Meldung, der letzte Stand bleibt sichtbar.

### Oberfläche

- **Anlegen:** „Fremdebene hinzufügen …“ in „Weitere Aktionen zur Lagekarte“ (nur mit
  Schreibrecht, abgeleitet über `einsatz/schreibrecht.ts`). Der Dialog bietet zwei Wege:

  ```
  Fremdebene hinzufügen
  (•) Datei   [Datei wählen …]        ( ) Adresse [https://…            ]
  Name        [Lage Nachbarkreis   ]   ← vorbelegt aus Dateiname bzw. KML-Name
                                        [Abbrechen] [Hinzufügen]
  ```

  Die Größe wird vorab im Client geprüft (`DateiFeld`). Serverfehler stehen im Dialog.
- **Ebenenbaum:** neue Gruppe „Fremdebenen“ neben „Bilder“ (`leistenDaten.ts`). Je Ebene eine
  Zeile als Schalter (`role="switch"`) mit Farbpunkt, Name, bei URL dem Alter bzw. dem
  Warnhinweis und einem ⋮-Menü:
  - Umbenennen;
  - Farbe wählen;
  - Entfernen. Korrigiert nach dem Abschluss-Review (25.11.2026): Das Entfernen löscht die Daten
    für alle und hat keinen Rückweg, also unumkehrbar nach ADR-0055 — rot hinter dem Trenner,
    Rückfrage mit einem Folgesatz und rotem Bestätigungsknopf, wie „Bild entfernen …“.
- **Sichtbarkeit ist je Arbeitsplatz** (`LayerSichtbar`, über `lib/sichererSpeicher`), nicht am
  Datensatz. Wer eine Fremdebene ausblendet, blendet sie nicht für die anderen aus. Neue
  Ebenen sind sichtbar. Ein neuer Speicherort steht in `GERAETESPEICHER`
  (`frontend/src/offline/AGENTS.md`).
- **Zeichnen:**
  - über den Mischgeometrie-Weg der Fachebenen (`sorgeFuerFachebeneLayer`/`setzeFachebeneDaten`,
    Pfad `gemischteGeometrie`) mit eigenem Schlüssel je Ebene und `wendeKartenDatenAn`;
  - Punkte als Kreis, Linien und Flächen in der Ebenenfarbe, Beschriftung aus `name` ab einer
    Zoomstufe;
  - die Ebene liegt über den Hintergründen und unter den eigenen Zeichnungen;
  - ein Klick zeigt eine Detailkarte nur zum Lesen mit Name, Beschreibung, Ebene und „Fremde Daten“.
- **Palette:** sechs Töne, die sich von BBK-Farben, Zonen- und Gefahrenfarben absetzen, in beiden
  Themes lesbar. Sie stehen im Farbvertrag (`theme/`). Die nächste neue Ebene nimmt den ersten
  freien Ton.
- **Lageplan-Druck:** Eine sichtbare Fremdebene erscheint in der Legende mit Farbe und Name
  (Regel „Legende nur aus dem Gezeichneten“).
- **Offline:** Liste und Daten kommen in `LAGEBILD_OFFLINE`, damit eine gezeigte Fremdebene ohne
  Netz bleibt. Anlegen und Ändern gehen nur mit Netz und sind dann gesperrt.

### ADR

Eine neue ADR für A, B und C, Nummer nach `docs/architektur/AGENTS.md`: **„Geodaten verlassen
das System aus dem Client, fremde Geodaten kommen nur geprüft über den Server“**. Inhalt:

- Export im Client, nur Sichtbares, nichts Personenbezogenes;
- Fremdebenen parst der Server, keine DTDs, keine Links;
- URL nur über `adapter::ziel`, nur `https`;
- gilt für `frontend/src/pages/lagekarte/geo*`, `src/karte_fremdebene/**`.

### Prüfungen

- **Einheitentests Einlesen:**
  - je Format ein gutes Beispiel, darunter `gx:Track` und KMZ mit `doc.kml`;
  - Ablehnungen: DTD bzw. Billion Laughs, externe Entity, KMZ-Bombe (kleiner Kopf, große Daten),
    zu viele Objekte bzw. Punkte, Koordinaten außerhalb, leer;
  - `NetworkLink` wird nicht verfolgt.
- **Integrationstests unter `tests/`:**
  - Upload, Liste, Daten mit ETag/304, PATCH, DELETE;
  - 403 ohne Schreibrecht, Lesen als Beobachter;
  - die URL-Ebene gegen einen lokalen Testserver mit ETag, 304, 500 (Daten bleiben) und
    Weiterleitung (abgelehnt);
  - Single-Flight.
- **Frontend:** Dialog, Baumzeile (Schalter, Alter, Fehler), Layer-Daten, Legende im Druck.

### Doku

- **Anwenderdoku:** Kapitel Lagekarte, Abschnitt „Fremdebenen“.
- **arc42:**
  - Kapitel 5: neues Modul;
  - Kapitel 6: Abruf beim Lesen;
  - Kapitel 11: Risiko fremde URL;
  - Kapitel 12: Begriff „Fremdebene“.
- **`src/AGENTS.md`:** Satz im Abschnitt Adapter.

### Festlegungen nach dem Builder-Check (meine Wahl)

- **Virenscan nur beim Upload** (Abschluss-Review 25.11.2026): Vom URL-Abruf wird nie das
  Rohmaterial gespeichert, sondern nur das vom Server neu geschriebene, normierte GeoJSON mit
  `name` und `description` als reinem Text; ein Scan brächte dort nichts. „Gescannt“ oben gilt
  für Dateien.
- **Spiegel-Grundrauschen hingenommen:** Jeder Abrufversuch einer sichtbaren URL-Ebene schreibt
  `versucht_at` und erzeugt damit höchstens einmal je Minute eine Spiegeländerung.

- **Gekoppelte Instanzen:** Nur die führende Seite eines Einsatzes holt nach. Auf einem Spiegel
  zeigt die Ebene den gespiegelten Stand mit dessen `abgerufen_at`; der Abruf beim Lesen
  entfällt dort (Schutz-Trigger, eigenes Netz). `url` wird mitgespiegelt.
- **Abgeschlossener oder gesperrter Einsatz:** kein Nachholen mehr; der letzte Stand bleibt
  Teil der Akte.
- **URL mit Geheimnis im Query:**
  - Die volle `url` sehen nur Schreiber (Wire-Feld `url` nur mit Schreibrecht), Leser bekommen
    `url_host`.
  - Die URL geht nie in Log, Fehlertext oder Admin-Spur; ein Abruffehler trägt nur den Code.
  - Für `url` gilt die Schwärzung wie für `name`.
- **Fehlercodes der URL-Ebene** sind `FremdebeneFehler`, eigene Werte, keine Wiederverwendung
  von `AdapterFehler` (andere Einteilung, keine Meldung an Admins).

## Dem Bauenden überlassen

- Ob die Bereichsprüfung in `lage_zone` verallgemeinert oder neben ihr ergänzt wird.
- Die genauen Paletten-Töne.
- Die Zoomstufe der Beschriftung.
- Der Name des Live-Ereignisses.
- Ob `adapter::ziel` einen eigenen `Zweck` für die Fremdebene bekommt (für den User-Agent bzw. das
  Log).

## LAN-Ziele (Ruben, 24.11.2026)

- Eine **Org-Einstellung** „Fremdebenen dürfen das eigene Netz abrufen“ (Standard aus), die nur
  Admins setzen. Jede Änderung geht in die Admin-Spur (neue `AdminAktion`, Vorbild
  `AdapterLanErlaubt`).
- Ist sie an, nimmt der Abruf den Client mit LAN-Ausnahme (`adapter::ziel`, `lan_erlaubt =
  true`). Loopback, Link-Local und Multicast bleiben immer gesperrt (`WebhookResolver`).
- Die Einstellung wird bei jedem Abruf gelesen, nicht an der Ebene gespeichert: Wird sie
  abgeschaltet, scheitert der nächste Abruf eines LAN-Ziels mit `ziel_intern`.
- Die Oberfläche zeigt den Schalter in der Verwaltung der Organisation; im Dialog erscheint
  nichts zusätzlich.
