# HEIC-Vorschau — Herkunft und Lizenz

HEIC/HEIF-Fotos (iPhone) bekommen ihre Vorschau auf dem Gerät (LFH-759, Spec `anhang-vorschau`,
Herleitung `openspec/changes/lfh-759-bildvorschau-anhaenge/design.md`, D8). Der Server dekodiert
kein HEIC: dafür bräuchte er HEVC in C (libheif, libde265), und das Binary bleibt reines Rust.

| Datei               | Rolle                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `dekodiereHeic.ts`  | Client: lädt die bereinigte Fassung, Warteschlange, ein Worker                            |
| `heicWorker.ts`     | Worker: libheif als WASM, verkleinert per `OffscreenCanvas` auf 256 / 1600 px, JPEG-Blobs |
| `heicDekodieren.ts` | Dekodierkern ohne DOM (auch in Node getestet), 50-MP-Grenze                               |
| `libheif.d.ts`      | Typ des Emscripten-Glue                                                                   |
| `__fixtures__/`     | Testbild, Erzeugung in `mach_heic.py`                                                     |

## Bibliothek

**`libheif-js` 1.23.2** (npm, exakt gepinnt), Variante `libheif-wasm/libheif.js` mit eigener
`libheif.wasm`. Darin libheif 1.23 und libde265 (HEVC-Decoder), alle unter der **GNU LGPL 3.0**.

- Die `.wasm` geht **unverändert und als eigene Datei** aus (Vite `?url`, im Bündel
  `assets/libheif-*.wasm`), getrennt vom App-Code und austauschbar. Nicht `wasm-bundle` und nicht
  `heic-to`: dort steckt die WASM als Base64 im JavaScript.
- Die Lizenztexte liegen unter `public/lizenzen/` (`HEIC-DECODER.txt`, `libheif-LGPL-3.0.txt`,
  `libheif-js-LGPL-3.0.txt`) und gehen mit `dist` ins Binary. **Bei jedem Versionswechsel
  mitziehen** (Version in `HEIC-DECODER.txt`, Texte aus dem Paket kopieren).
- Offene Rechtsfrage (design.md, Risiken): wie das Austauschen bei einem ins Binary eingebetteten
  Frontend zu bewerten ist.

## Testbild

`__fixtures__/hochkant.heic` ist 64 × 48 px quer kodiert (links rot, rechts blau) und über `irot`
zur Anzeige hochkant, mit EXIF (Gerät, GPS) und XMP, jede Personenangabe mit `MARKER`. Erzeugt mit
pillow-heif 1.8 (libheif 1.23.4, x265):

```sh
python3 -m venv /tmp/heic && /tmp/heic/bin/pip install pillow pillow-heif
/tmp/heic/bin/python src/heic/__fixtures__/mach_heic.py src/heic/__fixtures__/hochkant.heic
```

`hochkant.bereinigt.heic` ist, was der Server davon ausliefert (`anhang::metadaten::bereinigen`).
`tests/anhang_vorschau.rs` nagelt das bytegleich fest, `heicDekodieren.test.ts` dekodiert genau
diese Bytes mit dem echten WASM. Ändert sich die Bereinigung, wird der Backend-Test rot; dann
die Datei aus dem Download neu schreiben.
