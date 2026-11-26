# Schriften des Server-PDFs

Archivo Regular und Bold für das PDF des Ausgangs (`src/ausgang/pdf.rs`, ADR-0107), per
`include_bytes!` ins Binary. Die TTF-Dateien sind die entpackten Schnitte
`frontend/src/assets/fonts/archivo-{400,700}.woff2` (latin-Subset, Herkunft dort in
`LIESMICH.md`), ohne Änderung an den Glyphen nach TTF umgewandelt (fontTools). Lizenz: SIL Open
Font License 1.1, Text in `OFL.txt`; er geht mit jeder Weitergabe der Dateien mit.
