---
id: ADR-0105
titel: Ein PDF entsteht am Server nur für den Ausgang
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/ausgang/**
  - assets/schriften/**
  - frontend/src/druck/**
  - Dockerfile
herleitung:
  - docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
---

# ADR-0105: Ein PDF entsteht am Server nur für den Ausgang

## Regeln

- MUST: Der Server erzeugt ein PDF nur in `src/ausgang/pdf.rs` und nur aus dem Schnappschuss
  eines Versands (Betreff, Text) und den PNG-Anlagen der Freigabe; es geht als Fax und als
  Anhang einer Mail hinaus.
- MUST: Das PDF bettet seine Schriften aus `assets/schriften/` ein (Archivo, OFL, Lizenztext
  liegt daneben); gleiche Eingabe ergibt dieselben Bytes.
- MUST NOT: Im Laufzeitbild liegen ein Browser, eine Shell oder Systemschriften für das PDF;
  das Bild bleibt distroless.
- MUST: Gedruckt und „als PDF gespeichert“ wird weiter über den Browser
  (`frontend/src/druck/AGENTS.md`); das Server-PDF ersetzt keine Druckansicht.
- MUST: Die Grenze von 30 Seiten und 10 MiB gilt nur für Fax und wird beim Anlegen geprüft; eine
  Mail geht ohne PDF hinaus, wenn es zu groß ist oder nicht entsteht, und trägt dann `ohne_pdf`.

## Prüfung

```sh
# Exit 0, solange die Regeln gelten (Hilfen und Grenzen: docs/architektur/AGENTS.md).
verlange 'include_bytes!\("\.\./\.\./assets/schriften/Archivo' src/ausgang/pdf.rs
verbiete 'printpdf' 'src/**/*.rs' ':!src/ausgang/pdf.rs'
test -f assets/schriften/OFL.txt
verlange 'distroless' Dockerfile
verlange 'ADR-0105' frontend/src/druck/AGENTS.md
```

## Kontext

Viele Behörden empfangen Lageberichte noch per Fax, und sipgate nimmt nur PDF an. Der
Ausgangskorb stellt im Hintergrund zu, auch wenn kein Browser mehr offen ist; ein PDF aus der
Druckansicht des Browsers könnte er nicht nachsenden. Ein Browser am Server passt nicht zum
distroless-Bild. Bisher galt „gedruckt wird nie auf dem Server“ ohne Ausnahme.

## Konsequenzen

Fax und Mail zeigen der Gegenstelle dasselbe Dokument, schlicht gesetzt (Kopf, Text, Anlagen je
Seite), ohne die Gestaltung der Druckansicht. Eine reine Rust-Abhängigkeit (`printpdf`) und zwei
Schriftdateien kommen ins Binary. Wer weitere Dokumente als PDF am Server will, braucht eine
neue Entscheidung.
