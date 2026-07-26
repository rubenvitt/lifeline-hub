# Schriften — Herkunft und Lizenz

Alle Schnitte sind **lokal ausgeliefert** und werden von Vite ins Bundle gehasht. **Kein
Google-Fonts-CDN, kein externer Abruf zur Laufzeit** — der Fükw arbeitet ohne Netz (LFH-352).

Alle Familien stehen unter der **SIL Open Font License 1.1**. Der Lizenztext liegt je Familie
unter `lizenzen/` und muss bei jeder Weitergabe der Schriftdateien mitgehen — das verlangt die
OFL ausdrücklich; eine nackte `.woff2` im Repo erfüllt die Bedingung nicht.

| Datei                                            | Familie                    | Herkunft                     | Lizenz                                        |
| ------------------------------------------------ | -------------------------- | ---------------------------- | --------------------------------------------- |
| `ibm-plex-sans-{400,500,600}.woff2`              | IBM Plex Sans              | IBM Corp.                    | `lizenzen/OFL-IBM-Plex.txt`                   |
| `ibm-plex-sans-condensed-600.woff2`              | IBM Plex Sans Condensed    | IBM Corp.                    | `lizenzen/OFL-IBM-Plex.txt`                   |
| `ibm-plex-mono-{400,500}.woff2`                  | IBM Plex Mono              | IBM Corp.                    | `lizenzen/OFL-IBM-Plex.txt`                   |
| `atkinson-hyperlegible-next-{400,500,700}.woff2` | Atkinson Hyperlegible Next | Braille Institute of America | `lizenzen/OFL-Atkinson-Hyperlegible-Next.txt` |
| `atkinson-hyperlegible-mono-{400,600}.woff2`     | Atkinson Hyperlegible Mono | Braille Institute of America | `lizenzen/OFL-Atkinson-Hyperlegible-Mono.txt` |
| `archivo-{400,500,700}.woff2`                    | Archivo                    | Omnibus-Type                 | `lizenzen/OFL-Archivo.txt`                    |
| `archivo-narrow-600.woff2`                       | Archivo Narrow             | Omnibus-Type                 | `lizenzen/OFL-Archivo-Narrow.txt`             |
| `jetbrains-mono-{400,600}.woff2`                 | JetBrains Mono             | JetBrains s.r.o.             | `lizenzen/OFL-JetBrains-Mono.txt`             |

Bezogen über den Fontsource-Spiegel (`cdn.jsdelivr.net/fontsource/fonts/…`) im `latin`-Subset
(U+0000–00FF — deutsche Diakritika und `ß` vollständig). Lizenztexte aus dem
Google-Fonts-Repository (`github.com/google/fonts/ofl/<familie>/OFL.txt`).

## Stand: Variantenrunde, nicht Endzustand

Hier liegen **drei Kandidaten-Paarungen** nebeneinander, weil LFH-352 sie an derselben echten
Seite gegeneinander zeigen soll (270,4 KB gesamt). Jede **einzelne** Paarung liegt unter dem
200-KB-Deckel aus dem Task:

- Plex (A) 117,6 KB · 6 Schnitte
- Atkinson (B) 56,2 KB · 5 Schnitte
- Archivo + JetBrains Mono (C) 96,6 KB · 6 Schnitte

**Nach der Richtungsentscheidung bleibt genau eine Paarung übrig**; die übrigen Dateien und
ihre Lizenztexte werden entfernt, und die verbleibende wird auf die tatsächlich benutzten
Zeichen subgesetzt.
