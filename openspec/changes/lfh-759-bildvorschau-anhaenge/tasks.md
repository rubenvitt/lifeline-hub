# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code. Backend-Tests: `cargo test`. Frontend: `mise exec -- pnpm -C frontend test`.

## 1. Backend: Fassungen und Schutz-Header

- [x] 1.1 `Fassung` um `Vorschau` und `Grossansicht` erweitern, `FassungParam::fassung` liest
  `vorschau` und `grossansicht`, die 400-Meldung nennt alle vier Werte. Belegt durch Unit-Tests in
  `routes/support.rs`: beide neuen Werte, `roh` → 400, doppelt → 400, ohne → `Bereinigt`.
- [x] 1.2 `anhang_antwort` setzt an jeder Antwort mit Inhalt `X-Content-Type-Options: nosniff` und
  `Content-Security-Policy: default-src 'none'; sandbox`. Belegt durch `tests/anhang_vorschau.rs`:
  bereinigte Fassung, Original (als Einsatzleitung), Vorschau, Großansicht und eine Textdatei mit
  HTML tragen beide Header.

## 2. Backend: Vorschaubild erzeugen

- [x] 2.1 `image` 0.25 in `Cargo.toml` mit `default-features = false` und nur `jpeg`, `png`, `gif`,
  `webp` und `tiff` aufnehmen, mit Begründungskommentar (reines Rust, Single-Binary). Belegt durch
  `cargo tree -e normal -i image`, das kein `-sys`-Crate zeigt, und `cargo build` sowie
  `cargo test --no-default-features`, die grün sind.
- [x] 2.2 Die Signaturprüfung aus `metadaten::bereinigen` als `pub(crate)`-Funktion freilegen, ohne
  ihr Verhalten zu ändern. Belegt dadurch, dass die bestehenden Tests von `anhang::metadaten` und
  `tests/anhang_metadaten.rs` unverändert grün sind.
- [x] 2.3 Modul `src/anhang/vorschau/` mit `erzeugen(&[u8], Groesse) -> Result<Vec<u8>, KeineVorschau>`
  nach design.md D4, samt `VORSCHAU_VERSION`. Unit-Tests mit im Test kodierten echten Bildern.
  Belegt durch:
  - JPEG 2016 × 1512 (4:3) → 256 × 192 bzw. 1600 × 1200
  - PNG 120 × 80 → 120 × 80, nicht vergrößert
  - JPEG mit EXIF-Ausrichtung 6 und GPS → 192 × 256, ohne EXIF/XMP (Kontrollnetz und Suche nach
    `Exif\0\0`)
  - PNG mit Alpha → JPEG ohne Fehler
  - GIF mit zwei Bildern → erstes Bild
  - TIFF mit zwei Seiten → erste Seite
  - WebP → JPEG
  - Ein PNG-Kopf mit 20 000 × 20 000 px → `KeineVorschau`, ohne zu dekodieren (die Datei ist nur
    der Kopf)
  - Ein abgeschnittenes PNG → `KeineVorschau`
  - PDF, HEIF (`testbau::heif`) und BigTIFF → `KeineVorschau`
- [x] 2.4 Fassungen `Vorschau`/`Grossansicht` in `anhang_antwort` verdrahten nach D5 und D6:
  - ETag `"<sha256>.v<n>.<k|g>"` und 304 vor dem BLOB
  - `spawn_blocking` mit Semaphore (`VORSCHAU_PARALLEL = 2`), Panic → 422
  - `Content-Type: image/jpeg`, `Content-Disposition: inline` mit `<stamm>.vorschau.jpg`
  - 422 mit eigener Meldung

  Belegt durch `tests/anhang_vorschau.rs`, je Route Chat, Dokument, ETB und Schaden, abgelegt als
  die ablegende Person:
  - 200 mit JPEG der erwarteten Größe, `inline`, kein neuer ETB-Eintrag
  - 304 mit dem ETag
  - verschiedene ETags für Vorschau, Großansicht und bereinigt
  - ohne Lesezugriff derselbe Fehlerstatus wie beim Download
  - 422 ohne Bytes für PDF und HEIC
  - Vorschau eines lesbaren Bildes, das die Bereinigung abweist (Download 422) → 200
  - Der Guard `nur_support_liefert_anhang_bytes_aus` bleibt grün.
- [x] 2.5 `static_files.rs`: `wasm` → `application/wasm`. Belegt durch einen Unit-Test neben
  `liefert_vorhandenes_asset_mit_content_type_und_cache`.
- [x] 2.6 Regelblock „Vorschau (LFH-759)“ in `src/AGENTS.md`, Abschnitt „Anhänge“, nach design.md
  D9. Belegt dadurch, dass `scripts/check-fmt.sh` grün ist und Verweise mit Datei und Abschnitt im
  Code-Kommentar von `anhang_antwort` stehen.

## 3. Frontend: Vorschau für Bilder vom Server

- [x] 3.1 In `api/anhangFassung.ts`: `vorschauPfad`, `grossansichtPfad`, `istHeicMime` und
  `hatServerVorschau(mime)` (JPEG, PNG, WebP, GIF, TIFF). Belegt durch Unit-Tests in
  `anhangFassung.test.ts`, auch für Adressen, die schon `?` enthalten.
- [x] 3.2 `components/AnhangVorschau.tsx` und `AnhangVorschauGruppe` nach design.md D7:
  - quadratisch, Kante = Mindesthöhe der Dichtestufe, antd `Image`, `loading="lazy"`
  - Platzhalter mit Dateityp bei `onError`
  - zugänglicher Name „Vorschau: <dateiname>, <kennung>“

  Belegt durch Vitest/RTL:
  - Ein JPEG rendert ein `img` mit Vorschau-Adresse, ein PDF rendert nichts.
  - Ein Fehler-Ereignis zeigt den Platzhalter gleicher Größe und keinen Hinweis über der Seite.
  - Enter öffnet die Großansicht mit Großansicht-Adresse, Escape schließt sie, der Fokus steht
    wieder auf dem Vorschaubild.
  - In einer Gruppe mit drei Bildern lässt sich blättern.
  - Keine Adresse enthält `fassung=original`.
- [x] 3.3 `DownloadAnker` bekommt `mime`, mit Vorschaubild vor dem Verweis bei Bildern. Durchreichen
  in `pages/schaeden/SchadenAnhaenge.tsx`, `pages/DokumentePage.tsx` und
  `chat/NachrichtenStrom.tsx`, mit Gruppen je Schaden bzw. Nachricht. Belegt durch die
  bestehenden Tests dieser Komponenten, die grün bleiben (Download-Verweis und Original-Aktion
  unverändert), und neue Fälle „Foto hat Vorschau, PDF nicht“. Die Fokuslogik nach dem Löschen in
  `SchadenAnhaenge` (`a[download]`) prüft ein Test.
- [x] 3.4 `etb/EtbAnhaenge.tsx` und `etb/EtbDokumente.tsx` zeigen das Vorschaubild neben dem Verweis,
  gruppiert je Eintrag. Damit hat es auch `EtbEintragVorschau`. Belegt durch Tests: ein Eintrag Nr. 4
  mit Foto hat ein Vorschaubild, dessen Name „Nr. 4“ enthält. Die bestehenden Tests der
  Hinweiszeile bleiben grün (Mindesthöhe der Dichtestufe, ETB-Route statt generischer Route).

## 4. Frontend: HEIC/HEIF auf dem Gerät

- [x] 4.1 `libheif-js@1.23.2` als Abhängigkeit aufnehmen (`mise exec -- pnpm -C frontend add`).
  Lizenztexte von libheif-js, libheif und libde265 nach `frontend/public/lizenzen/`, dazu
  `frontend/src/heic/LIESMICH.md` (Herkunft, Version, Lizenz, Pflichten). Belegt durch
  `mise exec -- pnpm -C frontend build`: `dist/` enthält eine eigene `libheif-*.wasm` und die
  Lizenztexte, und das Haupt-Chunk wächst nicht um die WASM.
- [x] 4.2 HEIC-Fixture `frontend/src/heic/__fixtures__/hochkant.heic` (klein, mit `irot`, mit EXIF
  und GPS) erzeugen, etwa mit pillow-heif. Herkunft und Befehl stehen in `LIESMICH.md`. Belegt
  dadurch, dass `anhang::metadaten::bereinigen` die Datei bereinigt (Backend-Test, der die Fixture
  liest) und `heif-info` bzw. pillow-heif `irot` zeigen.
- [x] 4.3 `heic/heicWorker.ts` und `heic/dekodiereHeic.ts` nach design.md D8 (Modul-Worker,
  Warteschlange, 50-MP-Grenze, zwei JPEG-Blobs, Ausrichtung angewendet). Belegt durch einen
  Vitest-Test, der die Dekodierfunktion des Workers mit der Fixture in Node ausführt: Die
  Abmessungen sind hochkant, beide Kanten passen zu den Größen. Die Warteschlange prüft ein Test
  mit gemocktem Worker: zwei Aufträge laufen nacheinander.
- [x] 4.4 Query-Key `einsatzKeys.anhangHeicVorschau` in `api/queryKeys.ts`, in `NICHT_LIVE_KEYS`,
  nicht in `LAGEBILD_OFFLINE`, und ein `QueryCache`-Abonnent, der Object-URLs bei `removed`
  freigibt. Belegt dadurch, dass `lagebildOffline.guard.test.ts` und der Live-Guard grün sind, und
  durch einen Test: `queryClient.clear()` ruft `URL.revokeObjectURL` für jede URL.
- [x] 4.5 HEIC-Zweig in `AnhangVorschau`: lädt erst, wenn sichtbar (`IntersectionObserver`), und
  importiert den Decoder dynamisch. Bei Fehler steht der Platzhalter. Belegt durch Tests:
  - Ein HEIC zeigt nach der Dekodierung ein `img` mit `blob:`-Adresse.
  - Eine Liste nur mit JPEG/PDF ruft den dynamischen Import nie auf.
  - Die geladene Adresse ist die bereinigte, nie eine mit `fassung=original`.
  - Ein Decoder-Fehler zeigt den Platzhalter.

## 5. Integration

- [ ] 5.1 e2e `frontend/e2e/anhang-vorschau.spec.ts`, Regeln in `frontend/e2e/AGENTS.md` beachten
  (kein `networkidle`, klicken statt `toBeVisible`, Rollen über `rollen-kern.ts`):
  - Ein Schaden mit echtem JPEG zeigt als Beobachter das Vorschaubild.
  - Ein Klick öffnet die Großansicht, Escape schließt sie.
  - Ein ETB-Eintrag mit der HEIC-Fixture zeigt ein Vorschaubild.
  - Keine Anfrage mit `fassung=original`.

  Belegt durch einen grünen Lauf und eine Mutationsprobe: Ohne den `mime`-Durchgriff in
  `SchadenAnhaenge` wird der Test rot.
- [ ] 5.2 `scripts/check-typ-codegen.sh` ist unverändert grün (keine DTO-Änderung erwartet), und
  `./scripts/check-all.sh` läuft grün (ohne `| tail`).
- [ ] 5.3 Abnahme in der Desktop-Hülle bzw. dem Prod-Bundle: Großansicht ohne Download, `blob:`-Bild
  für HEIC sichtbar. Ergebnis als Bediensicht und Klickweg für die Abschlussmeldung notieren.
