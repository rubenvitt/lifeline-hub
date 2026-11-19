# Kürzel erklären sich: antippbare Legende, Glossar in der Hilfe — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/f71gxt0s31vicq6xy0ipx2yt (LLH-1825, Teil von LLH-1812)
Route: `entwurf` (E1 mehrere Wege, E2 ändert die Regel „Kürzel sind eingeführt oder erklärt“ in
`frontend/AGENTS.md`). Größe: kleine Änderung, kurzer Entwurf.

## Absicht

Die UI/UX-Analyse vom 12.11.2026 fand: Die Stärke „F/UF/M//Σ 1/3/8//12“ erklärt sich nur per
Maus-Tooltip, auf dem Tablet navigiert Antippen weg, und die Hilfesuche nach „F/UF/M“ fand nichts.
LLH-1750 (gemergt 18.11.2026) hat seither das Kapitel „Zeiten und Kürzel“ mit Kürzeltabelle
eingeführt, „UA“ ausgeschrieben und die Schreibweise an jeder Stärke-Fläche sichtbar gemacht. Was
bleibt: Die Erklärung muss **ohne Maus** erreichbar sein, und die Hilfe muss die Kürzel sicher
finden. Ziel ist, dass jemand am Tablet mit Handschuh „F/UF/M//Σ“ antippt und versteht, was die
Zahlen bedeuten, ohne die Seite zu verlassen.

## Ziele

- Die sichtbare Schreibweise „F/UF/M//Σ“ ist an jeder Stärke-Fläche antippbar (Touch, Maus,
  Tastatur) und öffnet eine kurze Erklärung mit Link ins Kapitel.
- Ein Baustein, der jedes eingeführte Kürzel (`EINGEFUEHRTE_KUERZEL`) erklären kann; eingesetzt
  wird er in dieser Aufgabe nur für die Stärke.
- Die Hilfesuche findet das Kapitel über „F/UF/M“, „SK“ und „Glossar“; Tests halten das fest.
- Das Kapitel „Zeiten und Kürzel“ ist das Glossar und erklärt auch die Kurzbezeichnungen der
  Organisation („EA 1“).

## Nicht-Ziele

- Keine Legende für FMS-Status, Sichtungskategorien oder andere Kürzel (abgestimmt: nur Stärke).
- Kein Knopf „Legende“ im Seitenkopf, kein eigenes Kapitel „Glossar“.
- Kein „?“ im Kopf, das das Kapitel zur Seite öffnet: das ist LLH-1824.
- Die Stärke-Werte („1/2/5//8“) selbst werden nicht antippbar; sie behalten `title`.

## Anti-Ziele

- Ein Tippen auf die Erklärung darf nie die Zeile, Karte oder den Link darum auslösen und darf
  in einer sortierbaren Tabelle nicht sortieren.
- Kein Knopf in einem Link (ungültiges HTML, Vorlesehilfen lesen Unsinn).
- Keine unruhige Oberfläche: die Schreibweise sieht weiter aus wie bisher, nur mit gepunkteter
  Unterstreichung.
- Auf Papier (Druck) erscheint die Schreibweise als schlichter Text.

## Ansätze

1. **Schreibweise selbst antippbar → Popover (gewählt).** Die vorhandene sichtbare Schreibweise
   wird zum Auslöser. Kein neues Element, die Stelle ist schon „einmal sichtbar“ je Fläche
   (Regel aus LLH-1750); der Baustein ersetzt sie dort.
2. Knopf „Legende“ im Seitenkopf mit allen Kürzeln der Seite. Verworfen: jede Seite müsste ihre
   Kürzel aufzählen, und der Kopf bekommt ein weiteres Bedienelement.
3. Info-Symbol (i) neben der Schreibweise. Verworfen: braucht Platz und ein zusätzliches Tippziel
   in ohnehin dichten Köpfen und Tabellen.

Entscheidung Ruben, 19.11.2026: Ansatz 1, Umfang „Stärke überall“, Hilfe „Kapitel + Suchtest“.

## Wie es gebaut wird

### Baustein `anzeige/KuerzelErklaerung.tsx`

- Props: `kuerzel` (Typ: die `kuerzel`-Werte aus `EINGEFUEHRTE_KUERZEL`), optional `children`
  (Standard: das Kürzel selbst; so kann eine Fläche „F/UF/M“ · `<wbr>` · „//Σ“ übergeben).
- Rendert einen `button` (Typ `button`) ohne Knopfoptik: erbt Schrift und Farbe, gepunktete
  Unterstreichung, `cursor: help`. Ein vergrößertes Tippfeld über ein Pseudo-Element, damit die
  Zeilenhöhe gleich bleibt (Mindestmaß nach Bedien-Leitlinie, `frontend/AGENTS.md`).
- Öffnet ein antd-`Popover` mit `trigger="click"` (Klick, Tippen, Enter/Leertaste über den Knopf;
  Escape schließt, der Fokus kehrt zurück). Inhalt: Kürzel als Titel, Bedeutung, ein Beispiel
  (nur wenn die Liste eins trägt), Link „Zeiten und Kürzel“ auf `/hilfe/zeiten-und-kuerzel`.
- `onClick` stoppt die Weitergabe (`stopPropagation`), auch beim Popover-Inhalt, damit
  Tabellenkopf-Sortierung und klickbare Zeilen nicht auslösen.
- `aria-label` nennt die Bedeutung („F/UF/M//Σ: Führer / Unterführer / Mannschaft // Summe
  (Stärke), Erklärung öffnen“ o. ä.), `aria-expanded` folgt dem Popover.
- Druck: `@media print` zeigt nur den Text ohne Unterstreichung.

### Liste `anzeige/kuerzel.ts`

`EINGEFUEHRTE_KUERZEL` bekommt ein optionales Feld `beispiel`. Für die Stärke: „1/2/5//8: ein
Führer, zwei Unterführer, fünf Helferinnen und Helfer, zusammen acht“ (Wortlaut wie im Kapitel).
`kuerzel.test.ts` vergleicht weiter nur Kürzel und Bedeutung.

### Einsatz an den Stärke-Flächen

Jede Stelle, an der `STAERKE_SCHREIBWEISE` heute sichtbar steht (rund 15: Tabellenköpfe,
`Datenfeld`-Etiketten, Augenbrauen, Verdichtungszeile, Organigramm, Kennzahl-Einheit), zeigt sie
über den Baustein. Zwei Sonderfälle:

- **Schreibweise in einem Link** (Überblick, Zeile `abschnitt` ist ganz ein Link): dort bleibt sie
  in der Zeile reiner Text, und der Baustein steht einmal im Kopf des Bereichs bzw. als
  Legendenzeile darüber. Meine Entscheidung, weil ein Knopf im Link nicht geht.
- **Nur ein Textplatz** (z. B. `meta` als String, zusammengefügte `metaTeile`): der Platz wird auf
  `ReactNode` geöffnet, wo das ohne Umbau geht; sonst steht der Baustein an der nächsten sichtbaren
  Stelle derselben Fläche. Die Entscheidung je Stelle trifft der Plan.

### Wächter

Ein Wächter-Test (`anzeige/kuerzelErklaerung.guard.test.ts`) findet in `.tsx` jede Verwendung von
`STAERKE_SCHREIBWEISE`, die nicht in `KuerzelErklaerung` steckt, und hält sie gegen eine kurze
Ausnahmeliste mit Begründung (Druck, `aria-label`, Text in Links). Mit Gegenprobe.

### Hilfe

- Kapitel `zeiten-und-kuerzel.md`: im Überblick das Wort „Glossar“; im Ablauf „Eine Stärke
  lesen“ Schritt 3 neu: auf die Schreibweise tippen oder klicken öffnet die Erklärung; neuer
  `###` im Hintergrund „Kurzbezeichnungen der Organisation“ (EA 1, EA 1.1 sind Daten der
  Organisation, die App übernimmt sie unverändert; Abschnitte ohne Kurzbezeichnung zeigen den
  Namen). Quelle `anzeige/KuerzelErklaerung.tsx` in den Kopf. Bild nur, wenn der Bildlauf das
  Popover sauber aufnimmt; sonst bleibt das vorhandene Bild.
- `HilfePage.test.tsx`: die Suche nach „F/UF/M“, „SK“ und „Glossar“ zeigt „Zeiten und Kürzel“.
  Schlägt „F/UF/M“ heute fehl, wird die Suche repariert (Ursache vorher klären).

### Regel

`frontend/AGENTS.md`, „Kürzel sind eingeführt oder erklärt“: die sichtbare Schreibweise der Stärke
steht über `anzeige/KuerzelErklaerung.tsx` (antippbar, Popover), nicht als nackter Text; in Links
als Legende daneben; Wächter genannt.

## Dem Bauenden überlassen

Genauer Wortlaut des `aria-label`, Maße und Farben aus den Tokens, Abstand des Popovers, die
Einordnung jeder einzelnen Stelle in die Sonderfälle oben, ob die Augenbraue ihre Großschreibung
an den Baustein weitergibt.
