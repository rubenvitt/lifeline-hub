# Proposal

## Why

Anhänge an Schäden, ETB-Einträgen, in der Dokumentenablage und im Chat gibt es heute nur als
Download-Verweis (LFH-21, LFH-117, LFH-632). Wer wissen will, was auf einem Foto zu sehen ist,
muss es herunterladen und außerhalb der App öffnen. Das kostet im Einsatz Zeit, und in der
Desktop-Hülle landet jede Datei im Download-Ordner. iPhone-Fotos kommen als HEIC an, und das
zeigen außer Safari kaum Browser an.

## What Changes

- **Vorschaubilder vom Server.** JPEG, PNG, WebP, GIF und TIFF bekommen ein verkleinertes
  Vorschaubild in zwei Größen: klein für Listen, groß für die Großansicht. Der Server erzeugt es
  bei jedem Abruf neu aus der gespeicherten Datei und speichert nichts. Ein ETag hält es im
  Browser-Cache. Abgerufen wird es über die bestehenden vier Download-Wege mit
  `?fassung=vorschau` bzw. `?fassung=grossansicht`, mit denselben Zugriffsprüfungen und ohne
  Vermerk im ETB.
- **Keine Metadaten in der Vorschau.** Ein Vorschaubild ist ein neu kodiertes JPEG. Die
  Ausrichtung des Fotos ist schon angewendet, und es trägt weder EXIF noch XMP. Das Original
  verlässt den Server auf diesem Weg nie (Bezug LFH-747).
- **HEIC/HEIF im Browser.** Für HEIC und HEIF dekodiert die App die bereinigte Fassung auf dem
  Gerät, mit einem WebAssembly-Decoder (libheif). Er wird nur bei Bedarf und in einem Worker
  geladen.
- **Inline nur für eigene Bilder.** `Content-Disposition: inline` bekommen nur die Vorschaubilder,
  die der Server selbst erzeugt hat. Jede Anhang-Antwort trägt `X-Content-Type-Options: nosniff`
  und eine CSP, die nichts ausführt. Die Downloads bleiben `attachment`.
- **Vorschau in der Oberfläche.** Alle vier Ablagen zeigen bei Bild-Anhängen ein kleines
  Vorschaubild neben dem Download-Verweis. Ein Klick öffnet die Großansicht in der App, nie in
  einem neuen Tab. Ohne Netz oder bei einem Fehler steht dort ein Platzhalter. Der
  Download-Verweis und die Original-Aktion bleiben, wie sie sind.

## Capabilities

### New Capabilities

- `anhang-vorschau`: Vorschaubilder und Großansicht für Bild-Anhänge. Das umfasst die Fassungen
  `vorschau` und `grossansicht`, die Dekodierung von HEIC auf dem Gerät, die Schutz-Header jeder
  Anhang-Antwort und die Anzeige in Chat, Dokumentenablage, ETB und Schäden.

### Modified Capabilities

Keine. Die bestehenden Anforderungen bleiben wörtlich gültig: Downloads als Anlage
(`schaden-anhaenge`), Download-Verweis mit Name und Größe (`etb-anhaenge`), Bereinigung und
Original-Abruf (`anhang-metadaten`). Die Vorschau kommt dazu und ersetzt nichts.

## Impact

- **Backend:** `routes/support.rs` (`Fassung`, `FassungParam`, `anhang_antwort`), neues Modul
  `src/anhang/vorschau/`, `static_files.rs` (MIME-Typ für `.wasm`). Neues Crate `image` in reinem
  Rust, ohne Default-Features und nur mit den Decodern für JPEG, PNG, GIF, WebP und TIFF. Keine
  Migration, keine gespeicherten Ableitungen, kein neuer Linker.
- **Frontend:** neue Komponente für Vorschau und Großansicht, eingebaut in
  `components/DownloadAnker.tsx` (Chat, Ablage, Schaden) und `etb/EtbAnhaenge.tsx` /
  `etb/EtbDokumente.tsx`. HEIC-Worker mit `libheif-js` (LGPL-3.0, eigene `.wasm`-Datei). Ein
  neuer Query-Key für die HEIC-Dekodierung.
- **Auslieferung:** Das Binary wächst um rund 1,5 MB (WASM-Decoder im eingebetteten Frontend).
  Die Lizenzhinweise der LGPL gehen mit aus.
- **Betrieb:** CPU-Last beim ersten Abruf eines Vorschaubilds. Eine feste Obergrenze für
  gleichzeitige Dekodierungen hält sie begrenzt, ebenso Grenzen für Pixelzahl und Speicher.
