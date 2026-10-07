# HEIC-Vorschau — Herkunft und Lizenz

HEIC/HEIF-Fotos (iPhone) bekommen ihre Vorschau auf dem Gerät (LFH-759, Spec `anhang-vorschau`,
Herleitung `openspec/changes/archive/2026-10-02-lfh-759-bildvorschau-anhaenge/design.md`, D8). Der Server dekodiert
kein HEIC: dafür bräuchte er HEVC in C (libheif, libde265), und das Binary bleibt reines Rust.

| Datei               | Rolle                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| `dekodiereHeic.ts`  | Client: lädt die bereinigte Fassung, Warteschlange, ein Worker                         |
| `heicWorker.ts`     | Worker: lädt libheif zur Laufzeit, verkleinert per `OffscreenCanvas` auf 256 / 1600 px |
| `heicDekodieren.ts` | Dekodierkern ohne DOM (auch in Node getestet), 50-MP-Grenze, Laden des Glue            |
| `lizenz.test.ts`    | Wächter: Paketfassung, Quellenliste, Hinweis und WASM passen zusammen                  |
| `__fixtures__/`     | Testbild, Erzeugung in `mach_heic.py`                                                  |

## Bibliothek und Lizenz (LFH-1000)

**`libheif-js` 1.23.2** (npm, exakt gepinnt), Variante `libheif-wasm/` mit Glue `libheif.js` und
eigener `libheif.wasm`. Darin libheif 1.23.2 und libde265 1.0.15 (HEVC-Decoder), alle unter der
**GNU LGPL 3.0**. Gebaut wird die WASM von `libheif-emscripten` v1.23.2 aus dem unveränderten
libheif.

**Entscheidung (Ruben, 07.10.2026):** die Vorschau bleibt, die Auslieferung erfüllt die LGPL 3.0
so (Beurteilung und verworfene Wege im Ticket; keine Rechtsberatung):

| Pflicht                              | Wie                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Austauschbarkeit (LGPL § 4 d 1)      | Glue und WASM gehen **unverändert und nie gebündelt** unter `/bibliotheken/libheif/` aus (`vite.config.ts`, `libheifBibliothek`), der Worker lädt sie zur Laufzeit. `--heic-decoder-verzeichnis` ersetzt sie ohne Neubau (`src/static_files.rs`). |
| Hinweis (§ 4 a), Lizenztexte (§ 4 b) | `public/lizenzen/` (Hinweis `HEIC-DECODER.txt`, LGPL- und GPL-Text) geht mit `dist` ins Binary; das Benutzermenü verlinkt den Hinweis; jedes Release trägt ihn als `…-DRITTANBIETER.txt`.                                                         |
| Quelle (GPL § 6 über LGPL § 1)       | Jedes Release trägt `…-drittanbieter.zip` mit den Archiven der gepinnten Stände (`scripts/release/drittanbieter-quellen.sh`, Liste `drittanbieter-quellen.txt` mit Commit).                                                                       |
| Installationsinformationen (§ 4 e)   | entfallen: das Binary ist kein Verbrauchergerät („User Product“).                                                                                                                                                                                 |

Was das Ganze still brechen würde, hält ein Wächter fest: der Build bricht, sobald ein Chunk
unter `assets/` den Glue enthält (`vite.config.ts`); `lizenz.test.ts` vergleicht Paketfassung,
Quellenliste, Hinweis und die Versionsstrings in der WASM.

**Bei jedem Versionswechsel** von `libheif-js`: die vier Zeilen in
`scripts/release/drittanbieter-quellen.txt` (Tag und Commit von libheif-js, libheif-emscripten,
libheif, libde265; die libheif-emscripten-Fassung steht in `scripts/install.js` von libheif-js),
`public/lizenzen/HEIC-DECODER.txt` und die Lizenztexte aus dem Paket nachziehen.

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
