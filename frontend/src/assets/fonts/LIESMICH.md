# Schriften — Herkunft und Lizenz

Die Schriftrollen der Gestaltungssprache **E · Lagekarte nachts** (LFH-352 · A0). Alle Schnitte
sind **lokal ausgeliefert** und werden von Vite ins Bundle gehasht, von rust-embed ins Binary.
**Kein Google-Fonts-CDN, kein externer Abruf zur Laufzeit** — der Fükw arbeitet ohne Netz.

Alle Familien stehen unter der **SIL Open Font License 1.1**. Der Lizenztext liegt je Familie
unter `lizenzen/` und muss bei jeder Weitergabe der Schriftdateien mitgehen — das verlangt die
OFL ausdrücklich; eine nackte `.woff2` im Repo erfüllt die Bedingung nicht.

| Rolle                                        | Familie        | Dateien                          | Herkunft         | Lizenz                            |
| -------------------------------------------- | -------------- | -------------------------------- | ---------------- | --------------------------------- |
| **Text** — Fließtext, Formulare, Listen      | Archivo        | `archivo-{400,500,700}.woff2`    | Omnibus-Type     | `lizenzen/OFL-Archivo.txt`        |
| **Display** — Köpfe, Sektionsmarken          | Archivo Narrow | `archivo-narrow-600.woff2`       | Omnibus-Type     | `lizenzen/OFL-Archivo-Narrow.txt` |
| **Zahl** — Stärke, DTG, Koordinaten, Nummern | JetBrains Mono | `jetbrains-mono-{400,600}.woff2` | JetBrains s.r.o. | `lizenzen/OFL-JetBrains-Mono.txt` |

Bezogen über den Fontsource-Spiegel (`cdn.jsdelivr.net/fontsource/fonts/…`) im `latin`-Subset
(U+0000–00FF — deutsche Diakritika und `ß` vollständig). Lizenztexte aus dem
Google-Fonts-Repository (`github.com/google/fonts/ofl/<familie>/OFL.txt`).

## Budget

**96,6 KB in 6 Schnitten** — der Deckel aus LFH-352 liegt bei 200 KB. Nachprüfbar mit
`du -ch frontend/src/assets/fonts/*.woff2`.

Die Kandidaten der Variantenrunde (IBM Plex, Atkinson Hyperlegible) sind mit der Entscheidung
entfernt worden. **Feineres Subsetting** — nur die tatsächlich benutzten Zeichen statt des
vollen `latin`-Bereichs — ist möglich und würde das Budget weiter drücken; es lohnt erst, wenn
der Zeichenbedarf der Anwendung stabil ist, und ist deshalb bewusst nicht gemacht.

## Warum diese Auswahl

Die Kriterien aus LFH-352 sind an einem gerenderten Specimen geprüft, nicht aus Beschreibungen
übernommen:

- **Echte tabellarische Ziffern.** JetBrains Mono trägt `tabular-nums` von Haus aus — bei
  Stärkeangaben (`5/6/24//35`), DTG-Zeiten, Koordinaten und Funkrufnamen ist Ziffernflattern
  ein Lesefehler, kein Schönheitsfehler.
- **Unverwechselbare Zeichen.** `1 l I`, `0 O`, `5 S`, `8 B` sind in JetBrains Mono über
  Strichstärke, Punkt in der Null und unterschiedliche Höhen sicher getrennt.
- **Vollständige deutsche Diakritika und `ß`.**
- **Mehrere Schnitte inkl. eines echten Halbfetten** für Kennzahlen (Archivo 500/700).
- **Freie Lizenz** (SIL OFL 1.1).
