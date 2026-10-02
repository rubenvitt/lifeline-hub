# Tasks

Jede Aufgabe entsteht per TDD: zuerst der rote Test, dann der Code. Fixtures werden in den
Tests synthetisch gebaut (Segment- und Chunk-Bauer in `src/anhang/metadaten/testbau.rs`,
nur unter `#[cfg(test)]`). In jede Fixture kommen GPS-Koordinaten, Make/Model, Seriennummer,
Aufnahmezeit, ein XMP-Block mit `exif:GPSLatitude` und ein Vorschaubild, jeweils als
erkennbare Marker-Strings.

## 1. Grundgerüst und Kontrollnetz (D3, D5)

- [x] 1.1 Gerüst anlegen: `src/anhang/metadaten/mod.rs` mit `pub fn bereinigen(daten: &[u8], mime: &str) -> Result<Cow<[u8]>, Unbereinigbar>`, `BEREINIGUNG_VERSION = 1` und der Formaterkennung über Magic Bytes. Beleg: Unit-Tests für jedes Format aus der Tabelle in D3, für „kein Bild, `mime` ist `application/pdf`“ (durchgereicht, `Cow::Borrowed`, bytegleich) und für „kein Bild erkannt, `mime` ist `image/*`“ (`Unbereinigbar`). Ein weiterer Test zeigt, dass ein JPEG mit `mime` `application/pdf` trotzdem bereinigt wird.
- [x] 1.2 Kontrollnetz bauen: die Signaturen aus D5 nach der Bereinigung prüfen. Beleg: Ein Test schleust über einen Test-Bereiniger, der nichts entfernt, ein XMP-Paket durch und erwartet `Unbereinigbar`.
- [x] 1.3 `exif.rs` bauen: Ausrichtung aus einem TIFF-Block lesen (II/MM, IFD0, Tag 274) und Mini-EXIF erzeugen. Beleg: Round-Trip-Test in beiden Byte-Reihenfolgen. Die Ausrichtung 6 wird gelesen, das Mini-EXIF trägt genau einen Eintrag. Kaputte Offsets ergeben `None` statt Panic.

## 2. Formate (D4)

- [x] 2.1 JPEG: Positivliste der Segmente, Entropie-Scan bis EOI, alles nach EOI abschneiden, Mini-EXIF bei Ausrichtung ≠ 1. Beleg: Tests mit APP1-Exif, APP1-XMP, erweitertem XMP, APP13, COM, MPF-APP2 samt Zweitbild nach EOI und Samsung-Trailer. Die Ausgabe enthält keinen Marker-String, ICC-`APP2`, `APP14` und die Scan-Daten bleiben bytegleich, und progressives JPEG mit mehreren SOS übersteht die Bereinigung.
- [x] 2.2 PNG: Positivliste der Chunks, unbekannter kritischer Chunk ergibt `Unbereinigbar`, `eXIf` mit Ausrichtung als neuer Chunk samt CRC32. Beleg: Tests für `tEXt`, `zTXt`, `iTXt`-XMP, `eXIf` und `tIME`. Der eigene Parser liest die Ausgabe wieder, alle CRCs stimmen, `iCCP` und `IDAT` bleiben bytegleich.
- [x] 2.3 WebP: `EXIF` und `XMP ` entfernen, VP8X-Flags anpassen, RIFF-Länge neu berechnen. Beleg: Tests für einfaches VP8 (unverändert) und für VP8X mit EXIF, XMP und ICCP. Die Flags passen zu den vorhandenen Chunks, die RIFF-Länge stimmt.
- [x] 2.4 GIF: Comment Extension und fremde Application Extensions entfernen. Beleg: Tests für ein GIF mit `XMP DataXMP`, einem Kommentar und `NETSCAPE2.0`. Die Schleife bleibt, die Metadaten sind weg, und die Ausgabe endet mit dem Trailer `0x3B`.
- [x] 2.5 HEIF: `ftyp`/`meta`/`iinf`/`iloc` lesen und Exif- sowie XMP-Items an Ort und Stelle nullen, bei `construction_method` 0 und 1. Beleg: Tests mit einem synthetischen HEIF (Exif-Item in `mdat`, XMP-`mime`-Item in `idat`). Die Länge bleibt gleich, die Marker-Strings sind weg, alle übrigen Bytes sind gleich. `construction_method` 2 und ein Extent jenseits des Dateiendes ergeben `Unbereinigbar`.
- [x] 2.6 TIFF: Textwerte nullen und Unter-IFDs leeren, auf jedem IFD der Kette. Beleg: Tests mit einem zweiseitigen TIFF in II und MM, mit Make, Model, DateTime, ExifIFD samt Seriennummer und GPSIFD. Die Marker-Strings sind weg, Ausrichtung und Bild-Tags bleiben, beide Seiten sind lesbar, und die Unter-IFDs haben 0 Einträge. BigTIFF ergibt `Unbereinigbar`.
- [x] 2.7 Robustheit absichern. Beleg: Ein Property-Test kürzt jede Fixture aus 2.1–2.6 an jeder Länge von 0 bis n und kippt einzelne Bytes an 200 zufälligen Stellen. Ergebnis ist immer `Ok` oder `Err`, nie ein Panic, und jedes `Ok` besteht das Kontrollnetz. `cargo test anhang::metadaten` ist grün.

## 3. Auslieferung im Backend (D6, D7)

- [x] 3.1 `routes/support.rs`: `Fassung` einführen, `anhang_antwort(…, fassung)` mit ETag `"<sha256>.b<VERSION>"` für die bereinigte Fassung, `Unbereinigbar` als 422 mit Hinweis auf die Einsatzleitung, Original ohne ETag und mit `no-store`. Beleg: Integrationstests in `tests/anhang_metadaten.rs`. Der Normal-Download eines JPEG mit GPS liefert die bereinigte Fassung, die gespeicherte Datei trägt weiter GPS, ein 304 kommt mit dem neuen ETag, und der ETag unterscheidet sich vom `sha256` des Originals. Das PDF bleibt bytegleich, das kaputte JPEG ergibt 422 ohne Dateibytes.
- [x] 3.2 Den Parameter `?fassung=` an allen vier Routen lesen (`routes/anhang.rs`, `routes/dokument.rs`, `routes/etb.rs`, `routes/schaden_anhang.rs`). Ein unbekannter Wert ergibt 400. Beleg: Je Route ein Test für Normal-Download (bereinigt) und für `fassung=roh` (400 im `{error}`-Format). `tests/fehler_vertrag.rs` bleibt grün.
- [x] 3.3 `support::original_freigeben` bauen: Einsatzleitung oder System-Admin der Einsatz-Org, sonst 403. Davor kommt der Vermerk per `etb::system_audit` ohne Dateinamen, danach `live.publiziere`. Beleg: Tests für folgende Fälle:
  - Einsatzleitung erhält das Original bytegleich, mit GPS.
  - Führungspersonal und Beobachter erhalten 403, und kein ETB-Eintrag entsteht.
  - Ein System-Admin der eigenen Org darf, einer fremden Org erhält 403.
  - Zwei Abrufe ergeben zwei Vermerke, ohne 304.
  - Der Vermerk enthält weder Dateinamen noch Endung.
  - Der Vermerk entsteht auch im abgeschlossenen Einsatz.
  - Fremder Einsatz und falsche Bindung bleiben 404, auch mit `fassung=original`.
  - Ein Original im Schadenmodul ohne Modulrecht ergibt 403.
- [x] 3.4 Guard: `anhang::repo::laden_bytes` darf außerhalb von `#[cfg(test)]` nur in `routes/support.rs` vorkommen. Beleg: Ein Test in `tests/anhang_metadaten.rs` liest die Quelltexte unter `src/` und wird rot, wenn ein zweiter Aufrufer hinzukommt. Gegenprobe: Ein temporärer zweiter Aufruf macht den Test rot.
- [x] 3.5 Regel nachtragen: `src/AGENTS.md`, Abschnitt „Anhänge“, bekommt den Punkt „Auslieferung (LFH-747)“ nach D9. Beleg: `rg 'LFH-747' src/AGENTS.md` trifft, die Datei bleibt prettier-neutral (Backend-Datei, kein Prettier).

## 4. Frontend (D8)

- [x] 4.1 Reine Helfer bauen: `originalPfad` und `istBildMime` in `api/anhangFassung.ts`, `darfOriginalLaden` in `einsatz/schreibrecht.ts`. Beleg: Unit-Tests, darunter `originalPfad` mit vorhandenem Query-String. Der Guard `schreibrecht.guard.test.ts` bleibt grün.
- [x] 4.2 `components/DownloadAnker.tsx` bekommt das optionale `originalHref` mit Zweitverweis „Original (mit Standort)“ und zugänglichem Namen nach D8. Beleg: Ein Komponententest zeigt, dass der Zweitverweis ohne Prop fehlt und mit Prop `href` plus `?fassung=original` und das `download`-Attribut trägt. Ein Stiltest prüft, dass der Zweitverweis den Steuerhöhen-Boden aus `downloadAnkerStil` hält.
- [x] 4.3 Die vier Aufrufer verdrahten: `chat/NachrichtenStrom.tsx`, `pages/DokumentePage.tsx`, `pages/schaeden/SchadenAnhaenge.tsx` und `etb/EtbAnhaenge.tsx`. Beleg: Je Aufrufer ein Test, in dem die Einsatzleitung an einem Bild den Zweitverweis sieht, Beobachter und Führungspersonal nicht, und an einem PDF auch die Einsatzleitung keinen.
- [x] 4.4 Frontend-Gates laufen lassen. Beleg: `mise exec -- pnpm -C frontend exec tsc --noEmit`, `lint` und `prettier --check` sind grün.

## 5. Abschluss und Integration

- [x] 5.1 `./scripts/check-all.sh` laufen lassen, außerdem `cargo test --no-default-features` (ClamAV-Regel, weil `src/anhang/` berührt ist). Beleg: Das Protokoll im PR, Umgebungsgrenzen der Cloud-Sitzung benannt.
  - Lokal am 02.10.2026 in der Cloud-Sitzung: `check-all.sh` selbst lief nicht, weil dem Container `mise` fehlt und die 114 Debug-Testbinaries des Workspace die Platte füllten (26 GB). Gelaufen sind die Teile, die die Änderung berührt, mit `CARGO_PROFILE_DEV_DEBUG=0`:
    - `cargo fmt --all --check`.
    - `cargo test --lib anhang` mit und ohne `--no-default-features` (90 bzw. 100 Tests).
    - Die Integrationstests `anhang_metadaten`, `anhang`, `dokument`, `dokument_startinhalt`, `etb_anhang`, `schaden_anhang`, `aufbewahrung`, `einsatz`, `fehler_vertrag`, `json_extractor_guard` und `path_extractor_guard`.
    - Frontend: `tsc --noEmit`, ESLint, `prettier --check src` und vitest.
  - Beleg für das ganze Gate: die CI des PRs.
- [x] 5.2 Prüfung im laufenden Stack (`cargo run --features dev-seeds`, Vite-Dev-Server). Ein echtes Handyfoto mit GPS wird als Schaden-Anhang abgelegt. Der Normal-Download wird per `exiftool` oder einem Python-EXIF-Leser geprüft, dann folgen Original als Einsatzleitung, ETB-Vermerk und Zweitverweis in der Oberfläche. Beleg: Befund in dieser Datei, steht ein echtes Gerätefoto nicht zur Verfügung, wird das benannt.
  - Ein echtes Gerätefoto stand nicht zur Verfügung. Ersatz waren Dateien echter Encoder, erzeugt mit Pillow 12.3, piexif und pillow-heif 1.8: JPEG mit EXIF, GPS, Seriennummer, MakerNote, Vorschaubild, ICC und Kommentar; progressives JPEG; PNG mit eXIf, iTXt-XMP, tEXt und ICC; WebP verlustbehaftet und verlustfrei mit EXIF, XMP und ICC; TIFF; animiertes GIF mit Kommentar; HEIC mit EXIF und XMP.
  - Nach der Bereinigung: kein Marker mehr, die Pixel dekodiert gleich, ICC gleich, als EXIF nur die Ausrichtung 6. Beim HEIC bleibt die Ausrichtung über `irot` (gleiche Maße).
  - Befund und Fix: Ein genulltes HEIF-Exif-Item ließ Pillow beim EXIF-Lesen abbrechen. Jetzt steht dort ein leerer TIFF-Block.
  - Laufender Stack (`cargo run --features dev-seeds`, Vite):
    - Das Foto wurde als Schaden-Anhang abgelegt.
    - Führungspersonal bekommt die bereinigte Fassung (EXIF nur 274, ETag `….b1`, `private, no-cache`). Das Original wird mit 403 abgelehnt.
    - Admin/Einsatzleitung bekommt das Original bytegleich mit GPS, `no-store`, als `IMG_0412.original.jpg`.
    - Im ETB steht „Originaldatei mit Metadaten (Standort, Gerät) abgerufen: Schaden S-001, Anhang #1“.
    - In der Oberfläche sieht die Einsatzleitung neben dem Foto „Original (mit Standort)“, Führungspersonal sieht nur den normalen Verweis (Playwright-Screenshot).
- [x] 5.3 `requesting-code-review` durchführen und die bestätigten Findings abarbeiten. Beleg: Findings und Umgang im PR.
  - Zwei Reviewer (Backend/Sicherheit, Frontend/Konventionen) prüften, danach eine Nachprüfung der Fixes.
  - Behoben:
    - Backend: zwei DoS-Wege (HEIF-`iloc`, quadratisches memset), Speicher-Verstärkung bei JPEG und WebP, TIFF-Negativliste (jetzt Positivliste), WebP-`ANMF`, HEIF-Struktur, `immutable`-Cache und Query-Extractor.
    - Frontend: gleicher Dateiname für Original und bereinigte Fassung, fehlende Zeilenkennung im zugänglichen Namen.
  - Bewusst offen und in design.md benannt: Container-Vorschauen in HEIF und TIFF, private TIFF-Unter-IFDs.
  - Mutationsproben (APP13 behalten, HEIF nicht nullen, Make im TIFF behalten): Alle machen Tests rot.
