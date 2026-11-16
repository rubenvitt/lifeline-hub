# Alarmzone und Eingangsleiste (15.11.2026)

Entwurf zu LLH-1716 („Alarme und Hinweise: eigene Zone, nichts verdecken“) mit den Unteraufgaben
LLH-1735 bis LLH-1738, entstanden aus der UI/UX-Analyse vom 12.11.2026 (LLH-1714). Heute stehen
Alarme als antd-Notifications oben rechts (`duration: 0`, bis zu drei einzeln) über Seitenaktionen,
dem Navigations-Drawer am Handy und Dialogen. Das Schließkreuz quittiert, und am Handy belegen
Alarm und Eingangsband zusammen rund 360 px.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/8HGwL9bGqJcXg7p2TtWiXj (Artifact-Typ „Design“, Design System „Lifeline
Hub“, aus der erzeugten Kopie unter `docs/design/design-system/project/`). Die Schriften lädt der
Canvas aus `ds/lifeline-hub/`; im Repo fallen die Flächen auf die Systemschrift zurück. Der
Lösungsweg wurde am 15.11.2026 mit Ruben abgestimmt (Phase-1-Checkpoint), die Change dazu ist
`openspec/changes/archive/2026-11-15-zu9ptja2-alarmzone/`.

| Datei                    | Zeichenfläche                                                   | Dichte      |
| ------------------------ | --------------------------------------------------------------- | ----------- |
| `Main.dc.html`           | Fükw 1440 × 900: Alarmzone unter dem Kopf, drei Alarme gebündelt | kompakt     |
| `Zone-Zustaende.dc.html` | Alarmzone in fünf Zuständen                                     | kompakt     |
| `Handy-Leiste.dc.html`   | Handy 390 × 844, eine Leiste „1 Alarm · 3 Eingänge ›“ unten     | komfortabel |
| `Handy-Tippen.dc.html`   | Handy 390 × 844 beim Tippen: nur der Alarm bleibt als Zeile     | komfortabel |
| `Handy-Blatt.dc.html`    | Handy 390 × 844, Blatt „Alarme und Eingänge“ von unten          | komfortabel |

## Was der Entwurf vorschlägt

1. **Eine Alarmzone im Rahmen, direkt unter dem Kopf** (und unter einem Übungsband). Sie klebt wie
   die übrigen Rahmenbänder und liegt deshalb unter Drawer und Dialogen. Sie steht nur, solange ein
   Alarm ansteht, und schiebt den Inhalt um eine Zeile (40 px) nach unten, statt ihn zu verdecken.
2. **Ein Alarm ist eine Zeile:** Wort „ALARM“ (bei Org-Hinweisen „HINWEIS“ mit blauer Kante), Titel,
   Gegenstand und Kurztext, Zeit, dann „Öffnen“, „Gelesen“ und ✕.
3. **Ab zwei Alarmen gebündelt:** Die Zeile zeigt den jüngsten mit „+ n weitere ▾“. Aufgeklappt steht
   eine Kopfzeile mit Zähler und den Arten („2 × Auftrag überfällig · 1 × Bestätigung ausstehend“),
   darunter je Alarm eine Zeile mit eigenen Knöpfen.
4. **✕ blendet nur aus.** Quittiert wird mit „Öffnen“ (springt) und „Gelesen“ (bleibt). Ein
   ausgeblendeter Alarm bleibt in diesem Tab weg, auch nach dem Neuladen, und steht im Verlauf
   „Eingänge“ unter „Neu“.
5. **Unwetterwarnung** in derselben Zone, ohne „Gelesen“, weil keine Benachrichtigung dahinter steht.
6. **Fükw und Tablet:** Das Eingangsband bleibt unten rechts. Seine Zeilen nennen den Gegenstand,
   etwa „Erinnerung fällig: Pegel prüfen“.
7. **Handy:** Alarm und Eingänge teilen sich eine Leiste von 48 px unten, über einer unteren Leiste
   wie der ETB-Schreibzeile. Ein Tipp öffnet das Blatt „Alarme und Eingänge“ von unten (die
   vorhandene Klappfläche der Eingänge). Bei Fokus in einem Eingabefeld klappt die Leiste ganz ein.
   Steht ein Alarm an, bleibt sie als eine Zeile mit diesem Alarm stehen.

## Entscheidungen (Ruben, 15.11.2026)

1. Die Zone erscheint einzeilig und schiebt den Inhalt. Die Regel „Live-Updates springen nicht unter
   dem Cursor“ bekommt dafür eine benannte Ausnahme für Alarme.
2. Am Handy klappt ein anstehender Alarm beim Tippen nicht ein.
3. Ausgeblendet bleibt ein Alarm bis zum Schließen des Tabs (sessionStorage), ohne Server-Zustand.
4. Der Knopf zum Quittieren ohne Sprung heißt „Gelesen“, nicht „Quittieren“ (Spec `bedien-wortlaut`).
