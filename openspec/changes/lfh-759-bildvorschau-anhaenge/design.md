# Design

## Context

- **Ausliefern:** Alle vier Download-Wege enden in `routes::support::anhang_antwort`:
  - generisch/Chat: `routes/anhang.rs`
  - Dokument: `routes/dokument.rs`
  - ETB: `routes/etb.rs`
  - Schaden: `routes/schaden_anhang.rs`

  Jeder Handler prüft vorher Lesezugriff, Modul und Bindung und liest `?fassung=` über
  `FassungParam`. Heute kennt der Parameter `bereinigt` (Vorgabe) und `original`; jeder andere Wert
  und eine doppelte Angabe ergeben 400. Die Antwort trägt den gespeicherten `mime` als
  `Content-Type` und immer `Content-Disposition: attachment`. `X-Content-Type-Options` und eine
  CSP fehlen. Eine globale Header-Schicht gibt es nicht.
- **Bereinigung (LFH-747):** `anhang::metadaten` erkennt das Format an den Magic Bytes
  (`erkenne`), dekodiert aber nichts. Im Server gibt es kein Bild-Crate. Der ETag der bereinigten
  Fassung ist `"<sha256>.b<BEREINIGUNG_VERSION>"`, mit `Cache-Control: private, no-cache`; 304
  geht ohne BLOB-Zugriff.
- **Erlaubte Bildtypen:** Chat ohne HEIC/TIFF; Ablage und ETB mit HEIC/HEIF/TIFF; Schaden mit
  HEIC/HEIF, ohne GIF/TIFF. `mime` stammt aus der Endung.
- **Speicher:** BLOB in `anhang`. Die Schwärzung löscht die Zeile, und die Registry verlangt jede
  einsatzbezogene Tabelle (`schwaerzung_registry.rs`). Jeder Fremdschlüssel auf `anhang` muss in
  `MODUL_LINKER` stehen.
- **Auslieferung als eine Datei:** Der Server ist ein einziges Binary für vier Ziele (Linux
  x86_64/aarch64, macOS aarch64, Windows per MinGW-Cross-Build), distroless im Docker. Es ist
  durchgehend reines Rust; C gibt es nur für SQLite und OpenSSL, beide statisch gebaut.
- **Frontend:**
  - Downloads sind native `<a href download>`: `components/DownloadAnker.tsx` für Chat, Ablage
    und Schaden, eigene Anker in `etb/EtbAnhaenge.tsx` und `etb/EtbDokumente.tsx`.
  - Es gibt keine Bildvorschau. `api/anhangFassung.ts` kennt `istBildMime` und `originalPfad`.
  - Die Desktop-Hülle macht jede Navigation auf `/api/` zum Download (`src-tauri/src/links.rs`),
    ein Bild in einem neuen Tab gibt es dort also nicht.
  - Ohne Netz liest die App Query-JSON aus IndexedDB (`LAGEBILD_OFFLINE`), aber keine
    Anhang-Bytes.
- **Statische Auslieferung:** `static_files.rs` kennt `.wasm` nicht und liefert es als
  `application/octet-stream`.

## Goals / Non-Goals

**Goals:**
- Eine Stelle für alle Fassungen: Die Vorschau läuft durch `anhang_antwort`, mit den Gates des
  Handlers. Ein fünfter Linker erbt sie ohne eigenen Code.
- Nichts Neues wird gespeichert: keine Migration, kein Fall für die Schwärzung oder Aufbewahrung.
- Server bleibt reines Rust. Der HEIC-Decoder läuft nur im Browser und nur bei Bedarf.

**Non-Goals:**
- Vorschau für PDF, Office oder Video.
- Ein Cache der Vorschaubilder im Server (Arbeitsspeicher oder DB). Bei Bedarf als Folgeticket,
  wenn die Last es zeigt.
- Vorschau der gewählten Dateien vor dem Hochladen.
- Anhang-Bilder im Druck. Das ETB druckt weiter nur Name und Größe.
- Vorschaubilder ohne Netz.
- Eine CSP für die ganze App. `index.html` hat Inline-Skripte, die eine strenge CSP brechen
  würde. Das ist ein eigenes Thema.
- Die ETB-Anker auf `DownloadAnker` umstellen.

## Decisions

### D1 — Zwei neue Werte für `fassung` statt eigener Routen

Neu sind `fassung=vorschau` (längste Kante ≤ 256 px) und `fassung=grossansicht` (≤ 1600 px). Die
Vorgabe bleibt `bereinigt`. `FassungParam` lehnt Unbekanntes und Doppeltes weiter mit 400 ab. Die
Meldung nennt die vier erlaubten Werte.

- **Warum:** Die vier Handler machen ihre Prüfungen schon vor `anhang_antwort`. Eine Vorschau
  bekommt sie damit ohne eine Zeile Gate-Code. Für `Original` bleibt `original_freigeben` die
  einzige Sonderbehandlung. Die Vorschau braucht keine Freigabe und keinen Vermerk.
- **Verworfen: eigene Routen `…/vorschau`.** Das wären vier neue Routen, jede mit kopierten Gates,
  ConcurrencyLimit und Eintrag in `zulassung.rs`. Ein vergessenes Gate wäre ein Leck.
- **Verworfen: zweiter Parameter `?vorschau=klein`.** Er ergäbe Kombinationen wie
  `fassung=original&vorschau=klein`, die eine eigene Regel bräuchten. Ein Parameter mit einem Wert
  je Lieferung hält das Feld für sich prüfbar (Statuscode-Konvention: 400).
- Die Spec `anhang-metadaten` bleibt gültig: `fassung=roh` ist weiter unbekannt und ergibt 400.

### D2 — Vorschau bei jedem Abruf erzeugen, nichts speichern

Wie bei der Bereinigung (LFH-747, D1) ist die Vorschau eine reine Funktion
`(&[u8], Groesse) -> Result<Vec<u8>, KeineVorschau>`. Den Cache übernimmt der Browser über den
ETag: Revalidieren kostet ein 304 ohne BLOB und ohne Dekodieren.

- **Verworfen: Tabelle `anhang_vorschau`.** Sie bräuchte einen Fremdschlüssel auf `anhang`, und
  der Guard `jeder_fremdschluessel_auf_anhang_ist_registriert` würde ihn als Linker zählen. Dazu
  kämen ein Eintrag in der Schwärzungs-Registry, `secure_delete` und WAL-Rückschreiben für eine
  Ableitung sowie ein Weg, alte Fassungen nach einer Änderung der Erzeugung zu erneuern.
- **Verworfen: Cache-DB (`cache_db.rs`).** Die Schwärzung erreicht sie nicht, und ein Vorschaubild
  ist ein Bild aus dem Einsatz.
- **Verworfen für jetzt: LRU im Arbeitsspeicher.** Das wäre ein Speicherpool mehr, für einen
  Gewinn, den erst die Last zeigt. Kandidat für ein Folgeticket.

### D3 — Crate `image` in reinem Rust, schmal eingebunden

`image` 0.25 mit `default-features = false` und nur `jpeg`, `png`, `gif`, `webp` und `tiff`.
Diese Decoder sind reines Rust (zune-jpeg, png, gif, image-webp, tiff). Ohne `rayon` und ohne die
übrigen Formate. Der JPEG-Encoder ist dabei.

- **Warum:** Die Spec von LFH-747 verbot das Neukodieren für die *bereinigte Fassung*. Ein
  Vorschaubild ist eine eigene Fassung und darf nur aus Bildpunkten bestehen. Neu zu kodieren ist
  hier der Zweck, denn so kommt kein Byte Metadaten aus dem Original mit.
- **Verworfen: libvips, ImageMagick, libheif im Server.** C/C++ mit statischem Bau für vier Ziele,
  neue CVE-Pflicht, H.265-Patentfragen (Entscheidung des Menschen am Phase-1-Checkpoint).
- **Verworfen: `zune-image` direkt.** Schmaler, aber weniger erprobt im Zusammenspiel von
  Ausrichtung, Mehrseitigkeit und Grenzen. `image` nutzt `zune-jpeg` ohnehin für JPEG.
- **Prüfung beim Einbinden:** `cargo tree -e normal -i image` zeigt kein `-sys`-Crate.

### D4 — Wie ein Vorschaubild entsteht

Das Modul `src/anhang/vorschau/` arbeitet in dieser Reihenfolge:

1. **Format** aus `anhang::metadaten::erkenne` (Magic Bytes, nicht `mime`). Nur JPEG, PNG, GIF,
   WebP und TIFF gehen weiter, und zwar mit fest gesetztem `image::ImageFormat`, ohne
   `guess_format`. HEIF, BigTIFF, Unbekanntes und Nicht-Bilder ergeben `KeineVorschau` (422).
2. **Abmessungen aus dem Kopf** (`ImageReader::into_dimensions`): über 16 384 px Kante oder über
   50 Mio. Bildpunkte ergeben `KeineVorschau`, bevor ein Byte Bilddaten dekodiert wird. 50 MP
   decken jedes Handyfoto ab (iPhone 48 MP = 8064 × 6048).
3. **Dekodieren** mit `image::Limits` (`max_alloc` 512 MiB, Kanten wie oben). Bei GIF und TIFF
   zählt nur das erste Bild bzw. die erste Seite. Das ist das Standardverhalten von
   `ImageReader::decode`.
4. **Verkleinern** mit `DynamicImage::thumbnail` (Flächenmittel, schnell, ohne Aliasing beim
   Verkleinern). Ist die Kante schon kleiner, wird nicht verkleinert und nie vergrößert.
5. **Ausrichtung** über `ImageDecoder::orientation()` und `DynamicImage::apply_orientation`, erst
   am verkleinerten Bild. Am vollen Bild legte die Drehung eine zweite volle Kopie an, außerhalb
   von `max_alloc` (Review). Weil die Zielkante ein Quadrat ist, ändert die Reihenfolge die Maße
   nicht. Das deckt EXIF-Ausrichtung in JPEG, PNG `eXIf`, WebP und das TIFF-Tag 274 ab.
6. **Alpha** wird auf Weiß verrechnet, denn JPEG kennt kein Alpha. Transparente Screenshots und
   Pläne bleiben so lesbar.
7. **Kodieren** als JPEG, Qualität 80, `Rgb8`. Der Encoder schreibt nur JFIF-`APP0`.
8. **Kontrollnetz:** Die Ausgabe läuft durch dieselben Signaturprüfungen wie die Bereinigung
   (D5 von LFH-747). Sie stecken heute privat in `metadaten::bereinigen` und werden dafür als
   `pub(crate)`-Funktion freigelegt, ohne ihr Verhalten zu ändern. Ein Fund ist ein
   Programmierfehler und ergibt 500, nicht 422.

`VORSCHAU_VERSION` (Start 1) steht im ETag. Wer Größe, Qualität, Filter oder Ablauf ändert,
erhöht sie.

Das Vorschaubild entsteht aus den **gespeicherten** Bytes, nicht aus der bereinigten Fassung. Die
Bildpunkte sind dieselben. Die Ausrichtung steht aber im EXIF des Originals, das die Bereinigung
auf ein Mini-EXIF kürzt. So hängt die Vorschau nicht an der Bereinigung, und ein Foto, dessen
Metadaten sich nicht bereinigen lassen, bekommt trotzdem eine Vorschau (Spec, Szenario
„Nicht bereinigbares Foto“).

### D5 — Last begrenzen

- Dekodieren läuft in `tokio::task::spawn_blocking`, nie auf einem Async-Worker. Ein Panic im
  Decoder wird als `JoinError` gefangen und ergibt 422 mit Log-Eintrag; der Prozess läuft weiter.
- **Höchstens zwei Dekodierungen gleichzeitig** (`tokio::sync::Semaphore`, `VORSCHAU_PARALLEL = 2`,
  prozessweit). Weitere Abrufe warten. Das Spitzenmaß liegt bei rund 2 × 200 MB für zwei
  48-MP-Fotos. Das `ConcurrencyLimitLayer(16)` der Routen und die Zulassungsgrenze bleiben
  darüber.
- **Der Platz kommt vor dem BLOB und geht mit der Arbeit** (Review): `platz_holen` vor
  `laden_bytes`, damit wartende Abrufe keine Dateien im Speicher halten. Der Platz wandert in die
  `spawn_blocking`-Closure. Ein abgebrochener Abruf (Zeitbudget der Zulassung, Client weg) lässt
  die Dekodierung weiterlaufen, deren Platz bleibt aber belegt. Hielte das Future den Platz,
  ließe sich die Grenze durch Abbrüche umgehen.
- Der Abruf mit passendem ETag liest weder BLOB noch Semaphore.

### D6 — Header: inline nur für eigene Bilder, Schutz für alle

- `vorschau` und `grossansicht`:
  - `Content-Type: image/jpeg` fest, nie der gespeicherte `mime`
  - `Content-Disposition: inline` mit dem Namen `<stamm>.vorschau.jpg`
  - ETag `"<sha256>.v<VORSCHAU_VERSION>.<k|g>"` und `Cache-Control: private, no-cache` wie bei
    der bereinigten Fassung
- **Jede** Antwort von `anhang_antwort` mit Inhalt trägt `X-Content-Type-Options: nosniff` und
  `Content-Security-Policy: default-src 'none'; sandbox`. Damit wird keine Anhang-Adresse, die
  jemand direkt öffnet, zu einem Dokument, das Skripte ausführt oder Inhalte nachlädt, auch kein
  SVG und kein HTML hinter einer Bild-Endung. Für ein `<img>` gilt die CSP der Antwort nicht. Die
  Vorschau in der App zeigt sie also trotzdem.
- **Verworfen: die bereinigte Fassung inline ausliefern** (Alternative am Phase-1-Checkpoint). Dann
  würden fremde Bytes inline ausgeliefert, und jede Liste lüde volle Fotos.
- **Verworfen: Header-Middleware für die ganze App.** Das ist ein eigenes Thema, s. Non-Goals.

### D7 — Oberfläche: eine Komponente, antd `Image` für die Großansicht

- **`components/AnhangVorschau.tsx`:**
  - Ein quadratisches Vorschaubild (`object-fit: cover`). Seine Kante ist die Mindesthöhe der
    aktiven Dichtestufe, so ist der Platz vor dem Laden fest und trifft die Zielgröße der
    Bedienung.
  - Darin ein antd `Image` mit `src = vorschauPfad(href)`, `preview.src = grossansichtPfad(href)`
    und `loading="lazy"`.
  - Bei einem Fehler (`onError`, auch bei 422 und ohne Netz) zeigt es einen Platzhalter mit
    Dateityp-Kürzel und bleibt still.
  - Zugänglicher Name: „Vorschau: <dateiname>, <kennung>“. Er beginnt nicht mit dem Dateinamen,
    damit eine Suche nach dem Download-Verweis nicht beide trifft (Befund e2e LFH-747).
- **`AnhangVorschauGruppe`** umschließt die Bilder einer Nachricht, eines Eintrags oder eines
  Schadens (`Image.PreviewGroup`) und erlaubt so das Blättern.
- **Einbau:**
  - `DownloadAnker` bekommt eine optionale Angabe `mime`. Ist es ein Bild, steht das
    Vorschaubild vor dem Verweis. Das trifft Chat, Ablage und Schaden an einer Stelle.
  - `EtbAnhaenge` und `EtbDokumente` binden `AnhangVorschau` selbst ein. Damit hat auch die
    Vorschau in der Sprungpalette (`EtbEintragVorschau`) die Bilder.
- **Großansicht** ist die Überlagerung von antd `Image`, also kein Tab und keine Navigation. Das
  funktioniert in der Desktop-Hülle. Den Fokus gibt die Gruppe zurück, sobald die Großansicht zu
  ist (Effekt auf `offen`), nicht erst nach der Ausblend-Animation.
- **Reihenfolge der Anzeige:** Die Gruppe sortiert ihre Einträge nach der Lage im DOM. Ein HEIC
  meldet sich erst nach dem Dekodieren an, ein neuer Eintrag erscheint oben (Review).
- **Bedienziel:** Rahmen `steuerRahmen`, Fokusring in `bedien` über `.lfh-anhang-vorschau` in
  `sprache.css`, wie `.lfh-kennzahl__ziel`.
- **Ausnahme Sprungpalette** (Review): Die Palettenvorschau eines ETB-Eintrags sichert „keine
  Bedienelemente“ zu und ist selbst eine Überlagerung. Escape und die Pfeiltasten aus einer
  Großansicht darin landeten über das React-Portal bei ihren Tasten-Handlern. Dort zeigt
  `grossansicht={false}` nur das Bild.
- **Verworfen: eigene Lightbox.** antd bringt Zoom, Drehen, Blättern und Tastaturbedienung schon
  mit. Die Gestaltungssprache (Radius 0, Rollenfarben) greift über das Theme.

### D8 — HEIC/HEIF: libheif als WASM im Worker

- **Paket:** `libheif-js` 1.23.2 (libheif 1.23, LGPL-3.0), Variante `libheif-wasm/libheif.js`
  (ca. 90 KB Glue) mit **eigener** `libheif.wasm` (1,4 MB). Vite bindet sie als Asset-URL
  (`?url`) ein, `locateFile` zeigt dorthin.
- **Ablauf:**
  - `heic/dekodiereHeic.ts` lädt die bereinigte Fassung (`fetch`, gleiche Herkunft, Cookie) und
    reicht den `ArrayBuffer` an einen Modul-Worker (`heic/heicWorker.ts`).
  - Der Worker dekodiert das Hauptbild. libheif wendet `irot` und `imir` dabei an, die Ausrichtung
    stimmt also.
  - Der Worker prüft dieselbe 50-MP-Grenze, zeichnet in zwei `OffscreenCanvas` (256 und 1600 px)
    und gibt zwei JPEG-Blobs zurück.
  - Das Original wird nie angefordert.
- **Zeitpunkt:** Worker und WASM entstehen beim ersten HEIC, das sichtbar wird
  (`IntersectionObserver`), per `import()`. Ein Worker arbeitet eine Warteschlange der Reihe nach
  ab. So belegt ein schwaches Tablet nie zwei Dekodierungen auf einmal.
- **Robustheit** (Review):
  - libheif-js gibt den Kontext eines Decoders erst beim nächsten `decode` desselben Objekts
    frei. `dekodiereHeicPixel` ruft deshalb `heif_context_free` selbst auf, sonst wüchse der
    WASM-Speicher mit jedem Foto.
  - Ein Absturz im WASM kommt als unbehandelte Ablehnung aus einem Timer, weder als Antwort noch
    als `error`. Der Worker übersetzt sie in eine Fehlerantwort mit `tot`, und der Client
    ersetzt ihn.
  - Jeder Auftrag hat ein Zeitlimit (`ZEITLIMIT_MS`, 60 s), danach wird der Worker ersetzt. So
    hängt die Warteschlange nie.
  - Ein gescheitertes Laden der WASM wird nicht zwischengespeichert (`einmalLaden`).
- **Cache:**
  - Die Object-URLs liegen im Query-Cache unter einem neuen Prefix in `api/queryKeys.ts`
    (`einsatzKeys.anhangHeicVorschau(einsatzId, href)`), mit `staleTime: Infinity` und `gcTime`
    5 min.
  - Klassifikation: `NICHT_LIVE_KEYS`, denn ein Anhang ändert sich nie, die Schwärzung löscht ihn
    nur. Nicht in `LAGEBILD_OFFLINE`.
  - Ein Abonnent des `QueryCache` gibt die URLs frei (`URL.revokeObjectURL`), sobald die Query
    den Cache verlässt (`removed`, auch beim Abmelden) oder ihre Daten wechseln. Ein
    Rechteentzug setzt sie auf `undefined`, ein Neuversuch ersetzt sie. Dazu merkt er sich je
    Query die zuletzt gehaltenen URLs.
- **Precache:** Workbox nimmt die WASM-Datei nicht auf (Standardmuster `js,css,html`). Das ist
  gewollt, denn ohne Netz gibt es auch keine HEIC-Bytes.
- **`static_files.rs`:** `wasm` → `application/wasm`. Sonst scheitert
  `WebAssembly.instantiateStreaming`, und Emscripten fällt mit Warnung auf den langsameren Weg
  zurück.
- **Lizenz:** Die WASM-Datei geht unverändert und getrennt vom App-Code aus, ist also
  austauschbar, wie die LGPL es für eingebundene Bibliotheken verlangt. Die Lizenztexte von
  `libheif-js`, libheif und libde265 liegen unter `frontend/public/lizenzen/` und gehen so mit
  dem `dist` ins Binary. Herkunft und Pflichten beschreibt `frontend/src/heic/LIESMICH.md`, nach
  dem Muster von `assets/fonts/LIESMICH.md`.
- **Verworfen:**
  - **`heic-to`:** Die WASM steckt als Base64 im JS-Bündel (3,2 MB statt 1,4 MB), getrennt
    cachen oder austauschen lässt sie sich nicht.
  - **`heic2any`:** MIT-Hülle um ein libheif von 2020, nicht mehr gepflegt.
  - **Nur Safari nativ:** wirkt nur auf Apple-Geräten. Die Fükw-Rechner laufen meist mit Chromium
    und der Hülle.

### D9 — Regeln

In `src/AGENTS.md`, Abschnitt „Anhänge“, kommt ein Block „Vorschau (LFH-759)“ unter
„Auslieferung“:

- Fassungen `vorschau` und `grossansicht` in `anhang_antwort`
- `VORSCHAU_VERSION`
- inline nur für Vorschaubilder
- die Schutz-Header jeder Anhang-Antwort
- Frontend: Bild-Anhänge zeigen `AnhangVorschau`, kein `<img>` auf die Download-Adresse und nie
  `fassung=original` zur Anzeige
- Eine künftige App-CSP muss `img-src blob:`, `worker-src 'self'` und `'wasm-unsafe-eval'`
  erlauben.

Der Block steht dort, weil `frontend/AGENTS.md` für Anhänge schon auf `src/AGENTS.md` verweist.

## Risks / Trade-offs

- **[CPU und Speicher beim ersten Abruf]** Eine ETB-Seite mit 20 frischen Fotos löst
  20 Dekodierungen aus, je ~50–150 ms bei 12 MP. → Höchstens zwei gleichzeitig, lazy geladene
  `<img>`, Revalidieren per 304 ohne Dekodieren. Ein LRU folgt erst, wenn der Betrieb Last zeigt.
- **[Decoder-Fehler in `image`]** In reinem Rust führt ein Fehler eher zu einem Panic als zu
  Speicherfehlern. → `spawn_blocking` fängt den Panic, die Grenzen vor dem Dekodieren greifen,
  und Tests decken kaputte und riesige Dateien ab.
- **[LGPL-3.0 im proprietären Produkt]** Das Repo steht unter keiner Open-Source-Lizenz. Die WASM
  wird unverändert und getrennt geladen, die Lizenztexte gehen mit. Wie das Austauschen in einem
  ins Binary eingebetteten Frontend zu bewerten ist, ist eine Rechtsfrage. → Am
  Freigabe-Checkpoint vorlegen. Fällt sie negativ aus, wird D8 zu einem Platzhalter für HEIC,
  ohne die übrigen Teile anzufassen (Gruppe 4 der Tasks ist abtrennbar).
- **[Größeres Binary]** Rund 1,5 MB mehr im eingebetteten Frontend. → Hingenommen; der Download
  lädt sie nur bei HEIC.
- **[HEIC auf schwachen Geräten]** Ein 12-MP-HEIC braucht im WASM rund 0,5–2 s und ~50 MB. → Ein
  Worker, eine Warteschlange, nur sichtbare Bilder, Platzhalter bis dahin.
- **[Desktop-Hülle und `blob:`]** Die CSP in `tauri.conf.json` erlaubt kein `blob:`. Sie gilt aber
  nur für die eigene `ui/`-Maske, das Hauptfenster lädt den Server extern. Die Lagekarte zeigt dort
  schon `blob:`-Bilder. → In der Abnahme in der Hülle prüfen.
- **[Falsche Endung]** `mime` aus der Endung entscheidet, ob die Oberfläche eine Vorschau anfragt.
  Ein `.jpg`, das ein PDF ist, ergibt 422 und damit den Platzhalter. → Hingenommen.

## Migration Plan

Keine Datenmigration. Ausrollen mit dem nächsten Release. Zurückrollen heißt den Code
zurücknehmen: Es bleiben keine Daten zurück, und alte Browser-Caches laufen über den ETag ins
Leere.
