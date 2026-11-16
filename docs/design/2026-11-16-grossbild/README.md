# Großbild für Lagebild und Lagebesprechung (16.11.2026)

Entwurf zu LLH-1747 („Großbild-Modus für Lagebild und Lagebesprechung“), Unteraufgabe von LLH-1717
aus der UI/UX-Analyse vom 12.11.2026 (LLH-1714). Bei 1920 × 1080 blieben Lagebild und
Lagebesprechung bei 12–13,5 px, das untere Drittel des Lagebilds war leer, und in der Vorbereitung
lagen Bezeichnung und Wert rund 1500 px auseinander.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/2A2jye29b7KuXJVvYfmN4m (Artifact-Typ „Design“, Design System „Lifeline
Hub“). Die Schriften lädt der Canvas aus `ds/lifeline-hub/`; im Repo fallen die Flächen auf die
Systemschrift zurück. Der Lösungsweg wurde am 16.11.2026 mit Ruben abgestimmt, die Change dazu ist
`openspec/changes/ckl1wbvz-grossbild-lage/`.

Das Design System hing am 16.11.2026 unter https://claude.ai/artifact/2irtEnowNvCAAkAzKL2YNo (Stand
1792911536-f512), nicht unter der Adresse in `docs/design/design-system/ARTIFACT.md`; die war aus
der Sitzung nicht erreichbar.

| Datei                        | Zeichenfläche                                                     |
| ---------------------------- | ----------------------------------------------------------------- |
| `Main.dc.html`               | Lagebild im Großbild, 1920 × 1080, Nacht, mit Alarmzahl und Übung |
| `Lagebesprechung.dc.html`    | Lagebesprechung im Großbild, 1920 × 1080, Nacht                   |
| `Beamer-Tag.dc.html`         | Lagebild auf einem Beamer 1280 × 720, Tag: alles auf zwei Drittel |
| `Vorbereitung-Seite.dc.html` | Vorbereitung auf der normalen Seite: Wert neben der Bezeichnung   |

## Was der Entwurf vorschlägt

1. **Eine Fläche ohne Rahmen.** Kopfzeile mit Titel, Uhrzeit und Datenstand, rechts die Alarmzahl
   („1 Alarm offen“ in Alarmrolle, ohne Titel), die Übungsmarke und „Großbild verlassen“.
2. **Größen des Lagemonitors bei 1920 × 1080:** Zahl 96 px, Zahl klein 72 px, Titel 32 px, Text
   28 px. Jede Größe ist ein Vielfaches einer Einheit, die mit dem Fenster geht
   (`min(vw, vh)`, Bezug 1920 × 1080); der Beamer zeigt dieselbe Aufteilung auf zwei Drittel.
3. **Lagebild:** die sechs Kennzahlen in einer Reihe; darunter, die Höhe füllend, Gefahren je Typ
   (Farbmarke und Wort), Sichtung (BBK-Farbe und Kategorie) und der Führungsstand 2 × 2. Kein
   Meldungsstrom.
4. **Lagebesprechung:** Termin mit Zustand und „Abgeschlossen“ groß, darunter die Vorbereitung
   zweispaltig, je Zeile Bezeichnung links und Wert direkt daneben, Notiz unter dem Wert, ohne
   Quellenangabe.
5. **Normale Seite:** In der Vorbereitung beginnt der Wert höchstens 16 em rechts der Bezeichnung;
   Quelle unter der Bezeichnung, Notiz unter dem Wert.
