# Design

## Context

- **Speichern:** Jede Datei landet über `anhang::repo::anlegen`/`anlegen_tx` als BLOB in
  `anhang` (`migrations/0052_anhang.sql`: `dateiname`, `mime`, `groesse`, `sha256`, `daten`).
  `groesse` und `sha256` werden aus den Bytes berechnet. Das Heraufstufen aus dem Chat
  (`etb::repo::anhaenge_kopieren_tx`) kopiert `daten` und `sha256` per SQL. Die Schwärzung
  löscht die ganze Zeile (`einsatz/schwaerzung_registry.rs`).
- **Ausliefern:** Alle vier Download-Wege enden in `routes::support::anhang_antwort`
  (`routes/support.rs:93`):
  - generisch/Chat: `routes/anhang.rs:82`
  - Dokument: `routes/dokument.rs:175`
  - Schaden: `routes/schaden_anhang.rs:127`
  - ETB: `routes/etb.rs:227`

  Die Zugriffsprüfung (Lesezugriff, Modul, Bindung) macht der Handler vorher. Der Helfer setzt
  den ETag aus `sha256`, antwortet bei passendem `If-None-Match` mit 304, ohne den BLOB zu
  lesen, und liefert sonst `laden_bytes`.
- **Erlaubte Bildtypen** (`src/anhang/mod.rs`):
  - Chat: JPEG/PNG/GIF/WebP
  - Ablage und ETB: dazu HEIC/HEIF/TIFF
  - Schaden: JPEG/PNG/WebP/HEIC/HEIF

  Geprüft wird nur die Endung.
- **Abhängigkeiten:** Im Server gibt es kein Bild-Crate. `png` steht nur über `src-tauri` im
  Lockfile.
- **Frontend:** Downloads sind native `<a href download>`. `components/DownloadAnker.tsx`
  dient Chat (`chat/NachrichtenStrom.tsx`), Ablage (`pages/DokumentePage.tsx`) und Schaden
  (`pages/schaeden/SchadenAnhaenge.tsx`), das ETB hat einen eigenen Anker in
  `etb/EtbAnhaenge.tsx`. Keine Inline-Vorschau, kein Druck von Anhängen, kein Offline-Cache
  von Anhang-Bytes.
- **Rollen:**
  - Backend: `EinsatzRolle::ist_einsatzleitung`, `Benutzer::ist_admin` (System-Admin, darf
    jeden Einsatz serverweit lesen).
  - Frontend: `istEinsatzLeitung`/`istAdmin` in `einsatz/schreibrecht.ts`, dort der einzige
    erlaubte Rollenvergleich.
- **ETB-Vermerke:** `etb::system_audit(pool, einsatz_id, erfasser_id, inhalt)` prüft keinen
  Einsatzstatus. Auch die Aufbewahrung schreibt so in abgeschlossene Einsätze.

## Goals / Non-Goals

**Goals:**
- Eine Stelle, an der jede Auslieferung eines Anhangs vorbeiläuft und die Fassung wählt. Ein
  fünfter Linker erbt die Bereinigung, ohne dass jemand daran denken muss.
- Eine Bereinigung, die nie das Original durchreicht, wenn sie unsicher ist.
- Keine Änderung an gespeicherten Daten, kein Crate, keine Migration.

**Non-Goals:**
- Metadaten in PDF und Office (Autor, Software, eingebettete Bilder).
- Bereinigung beim Upload oder eine zweite gespeicherte Fassung (D1).
- Pixel-Schwärzung (Gesichter, Kennzeichen) und Neukodierung.
- Karten-Hintergrundbild und Org-Logo: keine Anhänge, Org-Material statt Fotos Betroffener.

## Decisions

### D1 — Bereinigen bei der Auslieferung, das Original bleibt der einzige gespeicherte Stand

So hat es der Mensch am Phase-1-Checkpoint entschieden. Technisch folgt daraus: Die
Bereinigung ist eine reine Funktion `&[u8] -> Result<Vec<u8>, Unbereinigbar>`, die bei jedem
Download läuft.

- **Warum nicht zusätzlich speichern** (Spalte `daten_bereinigt`): Die DB und jedes Backup
  würden doppelt so groß. Eine korrigierte Bereinigung erreichte schon gespeicherte Fassungen
  nicht. Und die Schwärzungs-Registry bekäme eine Spalte mehr, die sie kennen muss.
- **Kosten:** Ein Durchlauf über höchstens 25 MiB, linear (die Grenzen in D4 halten das auch
  für bösartige Dateien). Für Bilder ist das ein
  Segment-Walk mit Kopie, ohne Dekodieren, also im Millisekundenbereich. `spawn_blocking` ist
  dafür nicht nötig.

### D2 — Eigenes Modul `src/anhang/metadaten/`, kein Crate

Für jedes Format gibt es eine Datei (`jpeg.rs`, `png.rs`, `webp.rs`, `gif.rs`, `heif.rs`,
`tiff.rs`), dazu `exif.rs` (Ausrichtung lesen, Mini-EXIF bauen) und `mod.rs` (Erkennung,
Kontrollnetz, öffentliche Funktion `bereinigen`).

- **Verworfen: `img-parts`.** Das Crate kann JPEG, PNG und WebP, aber weder HEIC noch TIFF
  noch GIF. Für die drei bräuchten wir trotzdem eigenen Code, hätten also zwei Wege. Es lässt
  außerdem Daten hinter dem JPEG-EOI stehen (D4).
- **Verworfen: `image`, `little_exif`, `kamadak-exif`.** `image` dekodiert und kodiert neu,
  das verbietet die Spec. `kamadak-exif` liest nur. `little_exif` schreibt EXIF, entfernt aber
  weder XMP noch Trailer.
- **Warum eigener Code reicht:** Alle sechs Formate sind auf Containerebene einfach (Segmente,
  Chunks, Blöcke, Boxen, IFDs). Wir müssen nur Metadaten weglassen oder nullen, nicht Bilder
  verstehen. CRC32 für PNG ist eine Tabelle mit 20 Zeilen.

### D3 — Das Format bestimmen die Magic Bytes, nicht `mime`

| Magic | Format |
|---|---|
| `FF D8 FF` | JPEG |
| `89 50 4E 47 0D 0A 1A 0A` | PNG |
| `RIFF....WEBP` | WebP |
| `GIF87a`/`GIF89a` | GIF |
| `II*\0`/`MM\0*` | TIFF |
| ISOBMFF `ftyp` mit HEIF-Marke (`heic`, `heix`, `heim`, `heis`, `hevc`, `hevx`, `mif1`, `msf1`) | HEIF |

Regel in `bereinigen`:

1. Ein erkanntes Bildformat wird bereinigt, egal was `mime` sagt. Damit hilft auch eine
   falsche Endung nicht, Metadaten durchzureichen.
2. Kein Bild erkannt, aber `mime` beginnt mit `image/`: `Unbereinigbar`.
3. Sonst wird unverändert durchgereicht (PDF, Text, Office).

BigTIFF (`II+\0`) und ein unbekannter HEIF-Aufbau sind ebenfalls `Unbereinigbar`.

### D4 — Was je Format geschieht

Grundsatz: Behalten wird nur, was auf einer **Positivliste** steht. Unbekannte, rein
beschreibende Teile fallen weg. Unbekannte Teile, die für das Bild wesentlich sind, führen zu
`Unbereinigbar`.

- **JPEG:** Die Segmente werden bis SOS gelesen, danach die Entropiedaten (`FF00`, `RSTn`) und
  weitere Segmente progressiver Scans bis EOI.
  - Behalten: `SOFn`, `DHT`, `DQT`, `DRI`, `SOS`, `DNL`, `APP0` JFIF (ohne JFXX-Vorschau),
    `APP2 ICC_PROFILE`, `APP14 Adobe` (Farbtransformation).
  - Weg: `APP1` (Exif, XMP, erweitertes XMP), `APP13` (Photoshop/IPTC), `COM`, `APP2` außer
    ICC (FlashPix, MPF), alle übrigen `APPn`.
  - **Alles nach dem ersten EOI fällt weg.** Dort hängen MPF-Zweitbilder (Tiefenkarte, eigenes
    EXIF) und Hersteller-Trailer wie Samsungs `SEFH`, die GPS tragen können.
- **PNG:** Behalten werden die kritischen Chunks (`IHDR`, `PLTE`, `IDAT`, `IEND`), dazu
  `tRNS`, `cHRM`, `gAMA`, `iCCP`, `sBIT`, `sRGB`, `cICP`, `mDCv`, `cLLi`, `bKGD`, `hIST`,
  `pHYs`, `sPLT`, `acTL`, `fcTL`, `fdAT`. Weg sind `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` und
  unbekannte Hilfs-Chunks. Ein unbekannter kritischer Chunk führt zu `Unbereinigbar`. Die CRCs
  vorhandener Chunks bleiben, wie sie sind.
- **Speicher:** JPEG und WebP schreiben direkt in einen Ausgabepuffer, nie einen Vektor je
  Segment oder Chunk. 13 Mio. eigenständige `FFD0` in 25 MiB ergaben sonst ein Vielfaches der
  Datei im Speicher (Review). Das Mini-EXIF kommt über eine gemerkte Einfügestelle hinein.
- **WebP:**
  - Behalten: `VP8 `, `VP8L`, `VP8X`, `ALPH`, `ANIM`, `ANMF`, `ICCP`. Ein `ANMF`-Frame darf
    selbst nur `ALPH`, `VP8 ` und `VP8L` tragen, sonst `Unbereinigbar` (ein darin geschachteltes
    `EXIF` liefe sonst durch).
  - Weg: `EXIF`, `XMP ` und unbekannte Chunks.
  - In `VP8X` werden die Flags für XMP (`0x04`) und EXIF (`0x08`) gelöscht. Wird das Mini-EXIF
    geschrieben, wird das EXIF-Flag wieder gesetzt.
  - Die RIFF-Länge wird neu berechnet.
- **GIF:** Die Blöcke werden gelesen. Weg: Comment Extension (`0xFE`) und Application
  Extensions außer `NETSCAPE2.0`, `ANIMEXTS1.0` und `ICCRGBG1`, damit auch XMP (`XMP DataXMP`).
  Graphic Control und Plain Text bleiben, weil sie dargestellt werden.
- **HEIF/HEIC:** Der Code liest die Boxen `ftyp` → `meta` → `iinf`/`infe` und `iloc` (Version
  0–2, `construction_method` 0 oder 1 mit `idat`).
  - Items vom Typ `Exif`, jedes `mime`-Item (XMP und anderes Beschreibendes) und jedes
    `uri `-Item werden **an Ort und Stelle mit Nullen überschrieben**. Alle Offsets bleiben
    dadurch gültig, nichts muss umgebaut werden.
  - Das Exif-Item bekommt statt reiner Nullen einen gültigen leeren TIFF-Block (Offset 0, IFD
    ohne Einträge). Ein genulltes Item ließ Leser beim EXIF-Lesen abbrechen (Praxistest mit
    pillow-heif).
  - In `meta` nur die HEIF-Struktur (`hdlr`, `dinf`, `pitm`, `iinf`, `iref`, `iprp`, `iloc`,
    `idat`, `grpl`); ein `xml `/`bxml` oder Unbekanntes ist `Unbereinigbar`. Die Property `udes`
    (Titel, Beschreibung, Schlagworte) wird genullt. Alte `infe` (Version 0/1) zählen jedes Item
    mit Inhaltstyp als Metadaten.
  - Top-Level-Boxen nur `ftyp`, `meta`, `mdat`, `free`, `skip`. Alles andere, etwa `moov` einer
    Bildfolge mit `udta/©xyz`-Standort, ist `Unbereinigbar`. Ebenso eine zweite
    `iinf`/`iloc`/`idat` in derselben `meta`.
  - Schutz vor Überlast (Review): Extents nicht gesuchter Items werden ohne Schleife
    übersprungen (mit Feldgrößen 0 rückte die Schleife nie vor), höchstens 64 Metadaten-Items,
    und die Summe der genullten Bytes darf die Dateigröße nicht übersteigen.
  - Die Ausrichtung trägt HEIF über die Properties `irot`/`imir`, nicht über EXIF. Sie bleibt
    also ohne Mini-EXIF erhalten.
  - `construction_method` 2 oder ein Verweis ins Leere führt zu `Unbereinigbar`.
- **TIFF:** Die IFD-Kette wird gelesen, und auf jedem IFD (also jeder Seite eines Scans)
  geschieht dasselbe an Ort und Stelle:
  - **Positivliste der Bild-Tags** (Baseline und Erweiterungen der TIFF-6.0-Spec, ICC 34675,
    Ausrichtung 274). **Die Werte aller übrigen Tags werden genullt**, darunter
    ImageDescription, Make, Model, Software, DateTime, Artist, XMP, IPTC, Photoshop und auch
    Hersteller-Tags wie CameraSerialNumber 50735, DNGPrivateData 50740 oder XPComment 40092.
    Zuerst stand hier eine Negativliste; das Review fand die Hersteller-Tags.
  - Ein Eintrag vom Typ IFD (13) zeigt auf ein unbekanntes Unter-IFD; es wird geleert. Die
    Summe der genullten Bytes darf die Dateigröße nicht übersteigen (sonst quadratisches
    memset).
  - **Unter-IFDs leeren:** ExifIFD 34665, GPSIFD 34853, InteropIFD 40965. Zuerst werden die
    Werte ihrer Einträge genullt, dann wird ihr Eintragszähler auf 0 gesetzt und ein
    Nachfolger-Offset 0 geschrieben, der Rest der alten Tabelle wird genullt.
  - Damit bleibt die Datei gültig, und die sortierte Tag-Reihenfolge bleibt erhalten.
  - Ausrichtung (274) und alle Bild-Tags bleiben.
- **Mini-EXIF** (JPEG `APP1`, PNG `eXIf`, WebP `EXIF`): Es wird nur geschrieben, wenn das
  Original eine Ausrichtung ≠ 1 trug. Inhalt: TIFF-Kopf in der Byte-Reihenfolge des Originals,
  IFD0 mit genau einem Eintrag (274, SHORT, 1, Wert), Nachfolger 0. Im JPEG steht es direkt
  hinter `SOI`/`APP0`, im PNG vor dem ersten `IDAT`.

### D5 — Kontrollnetz nach der Bereinigung

`bereinigen` prüft die Ausgabe ein zweites Mal, unabhängig vom Format-Code. Findet sich eine
der folgenden Signaturen, wird das Ergebnis verworfen und es gilt `Unbereinigbar`:

- `http://ns.adobe.com/xap/1.0/`
- `<x:xmpmeta`
- `Photoshop 3.0`
- `Exif\0\0` mit folgendem TIFF-Kopf (`II*\0`/`MM\0*`), außer an der Stelle des eigenen
  Mini-EXIF, das dort genau einen Eintrag (Ausrichtung) tragen muss

Beim Umsetzen gefunden: Die Kennung `Exif\0\0` allein steht in jedem HEIC im `infe` (Item-Typ
`Exif`, leerer Name, dann die Nullbytes der nächsten Box). Ohne den TIFF-Kopf als Teil der
Signatur hätte das Kontrollnetz jedes iPhone-Foto abgewiesen.

Das fängt einen Parser-Fehler ab, der sonst still Metadaten durchließe. Ein Fehlalarm ist
denkbar, wenn Bilddaten zufällig eine dieser Zeichenketten enthalten. Er ist praktisch
ausgeschlossen und kostete nur ein 422 mit Verweis auf die Einsatzleitung.

**Kein Panic:** Jeder Parser liest mit geprüften Grenzen (`get(..)`, `checked_add`). Ein
Property-Test kürzt und verfälscht jede Fixture an vielen Stellen und verlangt `Ok` oder
`Err`, nie einen Panic.

### D6 — `anhang_antwort` bekommt die Fassung, `laden_bytes` hat nur diesen einen Aufrufer

```text
pub enum Fassung { Bereinigt, Original }
anhang_antwort(pool, anhang_id, req_headers, fassung)
```

- **`Bereinigt`:**
  - `Cache-Control: private, no-cache` statt `ASSET_CACHE_CONTROL` (immutable): Sonst böte ein
    Browser nach einer korrigierten Bereinigung ein Jahr lang die alte Fassung an (Review).
    Revalidieren kostet nur ein 304 ohne BLOB.
  - Der ETag ist `"<sha256>.b<BEREINIGUNG_VERSION>"` (Konstante in `metadaten/mod.rs`, Start
    bei 1). Er gilt für jeden Dateityp, damit der 304-Kurzschluss den BLOB weiter nicht lesen
    muss.
  - Danach werden die Bytes geladen und bereinigt. `Unbereinigbar` wird zu
    `AppError::UnprocessableEntity` mit dem Text „Die Datei lässt sich nicht von
    Metadaten bereinigen. Das Original kann die Einsatzleitung abrufen.“ Nach der
    Statuscode-Konvention ist das 422, weil der Zustand der Datei das Problem ist, nicht ein
    Feld der Anfrage.
- **`Original`:** Kein ETag, kein 304, `Cache-Control: no-store`, die Bytes unverändert.
- **Guard:** Ein Test verlangt, dass `anhang::repo::laden_bytes` außerhalb von Tests nur in
  `routes/support.rs` vorkommt. Wer einen neuen Download-Weg baut, kommt an der Fassung nicht
  vorbei.

### D7 — `?fassung=original` an den vier bestehenden Routen statt einer eigenen Route

Die Handler ziehen den eigenen Extractor `FassungParam` (liest die Query als Liste von Paaren).

- Keine Angabe oder `bereinigt` ergibt `Bereinigt`.
- `original` ergibt `Original`.
- Jeder andere Wert und eine doppelte Angabe ergeben 400 über `AppError::Validation`. Ein
  eigener Extractor statt `Query<…>`, weil axums Rejection (etwa „duplicate field“) nicht im
  `{error}`-Format ankäme.

Reihenfolge im Handler:

1. Die bestehenden Gates und Bindungsprüfungen bleiben unverändert. Fremd oder unbekannt bleibt
   404.
2. Bei `Original` folgt `support::original_freigeben(&state, &ctx, anhang_id, ablage)`. Es
   prüft auf Einsatzleitung oder System-Admin **der Einsatz-Org**
   (`benutzer.ist_admin() && benutzer.org_id == einsatz.org_id`) und antwortet sonst mit 403.
3. Danach schreibt es `etb::system_audit` und meldet den Eintrag per
   `state.live.publiziere`. Scheitert der Vermerk, liefert der Handler kein Original.
4. Zuletzt folgt `anhang_antwort(…, Fassung::Original)`.

- **Warum der Org-Bezug beim Admin:** Der Archivzugriff (`fordere_archivzugriff`) zieht
  dieselbe Grenze. Ein System-Admin einer fremden Org soll keinen Standort Betroffener ziehen
  können, nur weil er serverweit lesen darf. Das ist eine Verengung der Antwort des Menschen
  („Einsatzleitung + Admin“) und wird am Freigabe-Checkpoint ausdrücklich vorgelegt.
- **Vermerk:** Text „Originaldatei mit Metadaten (Standort, Gerät) abgerufen: <Ablage>,
  Anhang #<anhang_id>“.
  - `<Ablage>` ist „Chat“ (bzw. „noch nicht versendeter Anhang“, solange der Anhang an keiner
    Nachricht hängt), „Dokumentenablage“, „ETB-Eintrag Nr. <lfd_nr>“ oder „Schaden <kennung>“.
  - Nie der Dateiname, wie die Regel in `src/AGENTS.md` zu Schaden-Anhängen es verlangt.
  - Die abrufende Person steht als Erfasser im Eintrag (pseudonym wie jeder System-Eintrag).
- **Verworfen: eigene Route `…/anhaenge/{aid}/original`.** Sie müsste die vier Linker-Gates
  nachbauen (Modul, Bindung, Tombstone), und genau dieses Nachbauen hat LFH-117 abgeschafft.
- **Verworfen: Vermerk in derselben Transaktion wie das Lesen.** Ein Lesen braucht keine
  Transaktion. Der Vermerk muss nur vor der Auslieferung bestehen, und das stellt die
  Reihenfolge sicher.
- **Abgeschlossene Einsätze:** Die Einsatzleitung behält dort Lesezugriff, und `system_audit`
  prüft keinen Status. Der Vermerk entsteht also auch dort. Ein Test belegt das.

### D8 — Frontend: zweiter Verweis am bestehenden Anker, Sichtbarkeit beim Aufrufer

- `DownloadAnker` bekommt die optionalen Props `originalHref` und `originalKennung`. Ist
  `originalHref` gesetzt, steht neben dem Hauptverweis ein zweiter nativer Verweis „Original (mit
  Standort)“. Sein zugänglicher Name beginnt mit dem sichtbaren Text, die Zeilenkennung des Aufrufers
  steht am Ende („Original (mit Standort) herunterladen: dach.jpg, Schaden S-003“). So trifft
  eine Suche nach dem Hauptverweis weder über dessen Anfang (Dateiname) noch über sein Ende
  („…, Anhang zu Nr. 1 herunterladen“) auch das Original (Befund der e2e-Suite im PR).
- **Eigener Dateiname für das Original** (Review): `dach.original.jpg`, im `download`-Attribut
  (`originalDateiname`) und in der `Content-Disposition` des Servers
  (`anhang::original_dateiname`). Sonst lägen `dach.jpg` und `dach (1).jpg` nebeneinander, und
  niemand sähe, welche Datei den Standort trägt. Zielgröße und Farben kommen aus demselben Stil (`downloadAnkerStil`,
  Rollen), es gibt keinen neuen Farbton.
- `etb/EtbAnhaenge.tsx` stellt auf `DownloadAnker` um oder bekommt denselben Zweitverweis. Die
  Wahl fällt beim Umsetzen nach dem dortigen Layout, der Wortlaut bleibt gleich.
- Neue reine Helfer in `api/anhangFassung.ts`: `originalPfad(href)` hängt
  `?fassung=original` an, `istBildMime(mime)` prüft auf `image/`, `originalDateiname` und
  `originalZugaenglicherName` bauen Name und zugänglichen Namen.
- `darfOriginalLaden(einsatz, benutzer)` ist `istEinsatzLeitung(einsatz) || istAdmin(benutzer)`
  und steht in `einsatz/schreibrecht.ts`, weil der Rollen-Guard dort jeden Vergleich verlangt.
- Bewusste Grenze: Die Oberfläche erkennt Bilder am MIME aus der Endung, der Server am Inhalt.
  Ein JPEG namens `scan.pdf` wird bereinigt ausgeliefert, der Original-Verweis fehlt aber in der
  Oberfläche. Die Einsatzleitung kommt dann nur über die Adresse ans Original.
- Die vier Aufrufer setzen `originalHref` nur, wenn `darfOriginalLaden` gilt und `istBildMime`
  zutrifft. Für Nicht-Bilder gibt es keinen Zweitverweis, die Spec verlangt das so.
- Wie die Aufrufer an die Rolle kommen (beim Umsetzen entschieden): Chat und Dokumentenablage
  haben Einsatz und Benutzer schon und rufen `darfOriginalLaden` direkt. Schaden-Paneel,
  ETB-Zeitachse und Palettenvorschau fragen den Hook `einsatz/useDarfOriginalLaden.ts`. Er liest
  den Einsatz nur aus dem Cache (`enabled: false`), den `EinsatzLayout` auf jeder Einsatzseite
  hält. Fehlt er, ist die Antwort `false`, also nur der bereinigte Download.
  `etb/EtbAnhaenge.tsx` bleibt bei seinem eigenen Anker und bekommt `darfOriginal` als Prop,
  damit es ohne Provider renderbar bleibt.
- Nach dem Rebase auf `alpha` kam `etb/EtbDokumente.tsx` hinzu (LFH-743: Dokumente mit
  ETB-Bezug an der Zeitachse). Es bekommt denselben Zweitverweis und dieselbe Prop wie
  `EtbAnhaenge`; der Hauptverweis lief schon über die Dokument-Route und ist damit bereinigt.
- **Admin-Org im Frontend:** Die UI-Schranke prüft nur `istAdmin`. Ein fremder Admin sähe die
  Aktion, bekäme aber 403. Das Backend ist verbindlich, und der Fall ist selten, deshalb kein
  zusätzliches Feld im DTO.

### D9 — Regel und Verweise

`src/AGENTS.md`, Abschnitt „Anhänge“, bekommt einen Punkt „Auslieferung (LFH-747)“:

- Jeder Download läuft über `anhang_antwort` mit einer `Fassung`.
- Bereinigt ist der Standard, das Original gibt es nur über `original_freigeben`.
- Wo der Guard steht.
- Verweis auf diese Herleitung im Archiv.

Die Prüflisten unter `docs/superpowers/specs/` sind eingefrorenes Archiv und bleiben
unverändert.

## Risks / Trade-offs

- **[Ein Parser übersieht einen Metadatenort]**
  → Positivlisten statt Negativlisten, Abschneiden nach EOI, das Kontrollnetz aus D5 und
  Tests mit synthetischen Fixtures je Ort (APP1 Exif/XMP, APP13, COM, MPF-Trailer, PNG
  `iTXt`-XMP, WebP `XMP `, GIF-XMP, HEIF Exif/`mime`, TIFF GPS-IFD).
  → Ein Prüfschritt mit echten Gerätefotos (iPhone-HEIC, Android-JPEG, Samsung) steht in der
  manuellen Verifikation.
- **[Die Bereinigung beschädigt Bilder]** (fehlendes ICC, gebrochene Struktur)
  → Bildsegmente und Farbprofil laufen bytegleich durch (Spec-Szenario).
  → Tests prüfen die Struktur der Ausgabe erneut mit dem eigenen Parser.
  → Echte Dateien werden in der manuellen Verifikation im Browser geöffnet.
- **[Der Normal-Download eines ungewöhnlichen Bildes antwortet 422]**
  → Das ist gewollt (fail-closed). Die Meldung nennt den Ausweg über die Einsatzleitung.
  → Häufen sich solche Fälle, wird der Parser erweitert und die `BEREINIGUNG_VERSION`
    erhöht.
- **[Das Original steht weiter in DB und Backup]**
  → So entschieden (Beweismittel). Die Schwärzung löscht es physisch (LFH-725).
- **[Schon heruntergeladene Originale auf Endgeräten]**
  → Liegen außerhalb der Reichweite.
- **[Vorschauen als eigene Bilder in HEIF und TIFF bleiben]**
  → Die Spec nennt nur die Vorschaubilder in EXIF und JFIF (die verschwinden mit dem EXIF).
    HEIF-`thmb`-Items und TIFF-Seiten mit reduzierter Auflösung sind Bildinhalt. Genullt zeigten
    Betrachter eine kaputte Vorschau. Ein beschnittenes Foto mit unbeschnittener
    Container-Vorschau bleibt damit ein Restrisiko, das ein Folgeticket klären kann.
- **[Private TIFF-Unter-IFDs über LONG-Zeiger]**
  → Ein unbekannter Tag vom Typ LONG, der auf ein privates Unter-IFD zeigt (etwa 400
    GlobalParametersIFD oder ein Hersteller-IFD), verliert seinen Zeiger (genullt). Die Bytes
    dahinter bleiben unreferenziert stehen und sind mit `strings` lesbar. Den Zeiger zu verfolgen
    hieße zu raten, ob ein LONG ein Offset ist; ein Fehlgriff nullte Bilddaten. Echte
    Scanner-TIFFs tragen so etwas kaum, das Kontrollnetz fängt XMP und EXIF, keinen Freitext.
- **[HEIF mit eigenen Boxen der Kamera]**
  → Kameras, die oben `uuid`-Boxen schreiben (etwa Canon-HIF mit CMT-Metadaten), bekommen beim
    normalen Download 422; die Einsatzleitung lädt das Original. Fail-closed und gewollt; häufen
    sich solche Fälle, wird der Parser erweitert und `BEREINIGUNG_VERSION` erhöht.
- **[Genulltes XMP-Item in HEIF]**
  → Leser sehen ein XMP aus Nullbytes (Pillow liest es als Bytes, ohne Fehler). Ein gültiges
    leeres XMP-Paket würde das Kontrollnetz auslösen.
- **[Vor dem Deploy im Browser-Cache liegende Originale]**
  → Bisher lieferte dieselbe Adresse das Original mit `immutable`. Ein Browser, der es schon
    hält, fragt nicht nach, bis der Cache verfällt. Das betrifft nur Geräte, die die Datei schon
    geladen haben, und auf denen liegt sie ohnehin als Download.
- **[ETB-Rauschen durch wiederholte Original-Abrufe]**
  → Gewollt: Jeder Abruf von Standortdaten ist ein Zugriff auf personenbezogene Daten und
    soll einzeln nachvollziehbar sein.

## Migration Plan

Kein Datenumbau. Mit dem Deploy liefern alle Downloads bereinigt aus. Ein Rollback ist ein
reiner Code-Rollback, die gespeicherten Daten bleiben unberührt. Die ETags ändern sich einmal
(`.b1`). Browser laden jede Datei danach einmal neu.
