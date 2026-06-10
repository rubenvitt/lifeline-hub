# ETB-Schnellerfassung — Eingabe-UX (LFH-72)

**Status:** Design freigegeben · **Datum:** 2026-06-10 · **Task:** LFH-72 (Feature)

## Kontext

Die Eingabe im Einsatztagebuch (`frontend/src/etb/Schnellerfassung.tsx`) bremst den
Schreiber im Einsatzbetrieb aus. Heutige Reibungspunkte:

- **Kein Tastatur-Submit:** Der Inhalt steckt im `MarkdownEditor` (Schreiben/Vorschau-Tabs
  über `Input.TextArea`). Enter erzeugt einen Zeilenumbruch; Absenden geht nur per Mausklick
  auf „Erfassen".
- **Kein Fokus-Rücksprung:** Nach `form.resetFields()` landet der Cursor nicht wieder im
  Eingabefeld — der nächste Eintrag erfordert einen erneuten Klick.
- **Bausteine umständlich:** `BausteinPicker` ist ein `Select`-Dropdown; bei Platzhaltern
  öffnet sich zusätzlich ein `Modal` → mehrere Mausklicks, Kontextwechsel.
- **Optionale Felder schwer:** Von/An/Meldeweg/Veranlassung/Ereigniszeit liegen in einem
  `Collapse` („Weitere Angaben"), das aufgeklappt und per Maus befüllt werden muss.
- **Visuelles Rauschen:** Der Tab-Umschalter macht die Eingabezeile hoch und schwer.

## Ziele / Akzeptanzkriterien (aus LFH-72)

1. Ein Eintrag lässt sich routiniert **per Tastatur** erfassen und absenden, ohne den
   Eingabekontext zu verlassen.
2. Nach dem Absenden ist sofort der nächste Eintrag erfassbar (**Fokus + leeres Feld**).
3. Häufige **Bausteine/Standardmeldungen** sind in wenigen Anschlägen erreichbar.
4. **Spürbar weniger Klicks/Schritte** pro Eintrag als heute.
5. **Mobil-/Touch-Tauglichkeit** im Feldeinsatz ist gegeben (Tastatur hat Priorität, Touch
   ist gleichwertig erreichbar).

## Designentscheidungen (im Brainstorming festgelegt)

- **Primärkontext:** Desktop/Laptop-Tastatur hat Vorrang; Mobile/Tablet muss sauber
  mitlaufen (Tap-Pfad).
- **Enter sendet**, **Shift+Enter** = Zeilenumbruch. Nach dem Senden bleibt der Fokus im
  jetzt leeren Eingabefeld.
- **Schlankes Eingabefeld** mit **dezentem Vorschau-Toggle** statt Dauer-Tabs. Gespeichert
  wird weiterhin Markdown; die Vorschau ist auf Abruf.
- **Ein `/`-Trigger für alles:** öffnet ein gruppiertes Menü — oben die **Felder**
  (Zeit/Von/An/Meldeweg/Veranlassung), darunter die **Bausteine**. Eine Konvention, keine
  Trigger-Kollision. (`#` und `^` wurden verworfen: `#` = Markdown-Überschrift, `^` ist auf
  de-Tastaturen ein toter Akzent.)
- **Werterfassung = editierbare Chips (Methode C, Verschmelzung A+C):** Die Auswahl eines
  Felds aus dem `/`-Menü legt **sofort einen Chip im Edit-Zustand** in einer Chip-Leiste
  unter dem Eingabefeld an, mit feldtyp-passendem Inline-Editor. Enter schließt den Chip ab,
  Fokus springt zurück ins Hauptfeld. Erfassung und spätere Korrektur teilen sich dasselbe
  Element.
- **Inhalt bleibt sauberer Markdown.** Metadaten leben als **Chip-State**, getrennt vom
  Inhaltstext, und werden erst beim Absenden in den Eintrag gemergt. Kein Text-Token-Parsing
  des Inhalts.

## Architektur / Komponenten

Bestehende Struktur (antd v5 `Form` mit controlled Feldern, `MarkdownEditor`,
`BausteinPicker`, `bausteinEinsetzen.ts`) wird wie folgt umgebaut. Jede Einheit hat eine
klare Aufgabe und wird isoliert testbar gehalten.

### 1. `Schnellerfassung.tsx` (Container, überarbeitet)

Orchestriert den gesamten Fluss und besitzt den State:

- `inhalt` (Markdown-String, Hauptfeld)
- `typ` (Select, unverändert)
- `metadaten`: Chip-State `{ von?, an?, meldeweg?, veranlassung?, ereigniszeit? }`
- `/`-Menü offen/Filter, aktiver Edit-Chip

Beim Submit (`onFinish`) werden `inhalt` + `typ` + `metadaten` zu `NeuerEintrag` gemergt.
Die bestehende `absenden()`-Logik (inkl. `erfasst_lokal_at`, `ereigniszeit`-Default „jetzt",
Berichtigungsmodus mit `typ='berichtigung'` + `berichtigt_eintrag_id`) bleibt inhaltlich
erhalten — sie liest die Metadaten künftig aus dem Chip-State statt aus dem `Collapse`.

### 2. Eingabefeld (erweiterter `MarkdownEditor`)

- Reicht eine **Ref** auf das innere `Input.TextArea` und einen **`onKeyDown`-Passthrough**
  nach oben durch (heute kapselt es beides).
- Neue/angepasste Variante: **schlankes Feld + Vorschau-Toggle** (Augen-Button) statt des
  permanenten Schreiben/Vorschau-Tabs. Die XSS-sichere `Markdown`-Vorschau wird auf Abruf
  eingeblendet.
- Submit-Logik (modusabhängig, siehe Interaktionsfluss): Enter sendet **nur**, wenn weder
  `/`-Menü noch ein Chip-Editor offen ist.

### 3. `SlashMenu` (neu)

Gruppiertes Overlay, das bei `/` am Wortanfang erscheint:

- Sektion **Felder**: die 5 Metadatenfelder; bereits gesetzte als „✓ gesetzt" markiert
  (öffnen den bestehenden Chip statt einen zweiten anzulegen).
- Sektion **Bausteine**: aus `bausteine`-Prop (wie heute geladen).
- Tippe-zu-filtern über beide Sektionen, `↑/↓`-Navigation, `Enter`/Klick wählt.
- Liefert die Auswahl (Feldtyp **oder** Baustein-ID) an den Container; das getippte `/…`
  wird aus dem Inhalt entfernt (`preventDefault` beim `/`, sodass es gar nicht erst im Text
  landet).

### 4. `MetaChipLeiste` + `MetaChip` (neu)

- Rendert Chips aus dem `metadaten`-State unter dem Eingabefeld.
- **`MetaChip`**: geschlossen = Label + Wert + `×`; im Edit-Zustand = feldtyp-spezifischer
  Inline-Editor:
  - `von` / `an` / `veranlassung` → `Input`
  - `meldeweg` → `Select` (`MELDEWEG_OPTIONEN`)
  - `ereigniszeit` → `DatePicker showTime` / `TimePicker`, Default `dayjs()`
- Commit per Enter/Blur → Wert in `metadaten`, Fokus zurück ins Hauptfeld. Klick/Tap öffnet
  einen Chip erneut. `×`/Backspace entfernt ihn.
- **„+ Feld"-Button** (Touch-Primärpfad) öffnet dasselbe Felder-Menü ohne Tippen von `/`.

### 5. Baustein-Einsetzen (`bausteinEinsetzen.ts`, unverändert)

Die pure, getestete Engine (`ermittlePlatzhalter`, `setzeBausteinEin`, `AUTO_PLATZHALTER`)
bleibt. Baustein-Auswahl aus dem `/`-Menü setzt den Inhalt über dieselbe Logik. Der
bestehende **Platzhalter-Modal-Flow bleibt vorerst funktional erhalten** (siehe Offene
Punkte).

### 6. Neue pure Helfer (TDD-Kern, analog `bausteinEinsetzen.ts`)

- `erkenneSlashTrigger(text, caret) → { aktiv: boolean, filter: string, start: number }` —
  nur am Wortanfang (vorheriges Zeichen Whitespace/Zeilenanfang); „2/9", Datums-/Pfadangaben
  bleiben Text.
- `filterMenue(filter, felder, bausteine) → gruppierte Treffer`.
- `baueEintrag(inhalt, typ, metadaten, kontext) → NeuerEintrag` — die Merge-Logik, isoliert
  vom React-Teil.

## Interaktionsfluss (Tastatur, Primärpfad)

1. Meldung tippen. `Enter` sendet → Eintrag, Feld leert, Fokus bleibt.
2. `/` → gruppiertes Menü öffnet am Cursor; Weitertippen filtert; `↑/↓`, `Enter` wählt.
3. **Feld** gewählt → Chip im Edit-Zustand erscheint, Editor fokussiert; Wert eingeben,
   `Enter` → Chip fertig, Fokus zurück ins Hauptfeld. Nächstes `/` nahtlos möglich.
4. **Baustein** gewählt → Inhalt wird gesetzt (Platzhalter siehe Engine).
5. Chip anklicken = ändern, `×` = entfernen.

**Enter-Modus-Maschine** (Kernsubtilität): solange `/`-Menü **oder** ein Chip-Editor offen
ist, schluckt das Overlay `Enter`/`Escape` (`stopPropagation`/`preventDefault`) und löst
**nie** den Form-Submit aus.

## Touch / Tablet

- „+ Feld"-Button öffnet das Felder-Menü ohne `/`. `/` funktioniert zusätzlich (externe
  Tastatur am Tablet), ist aber nicht der Primärpfad.
- Chips sind tap-bar (ändern/entfernen), Tap-Targets ausreichend groß.
- Picker (`Select`, Zeit) öffnen als native/große Panels.
- Sichtbarer **„Erfassen"-Button bleibt** (Enter auf Soft-Tastaturen unzuverlässig).

## Edge Cases

- **Literales `/`:** triggert nur am Wortanfang; `Escape` schließt das Menü und lässt ein
  bereits getipptes Zeichen literal; Weitertippen ohne Treffer schließt das Menü.
- **Escape:** Menü offen → schließt ohne Auswahl. Frischer, leerer Chip → wird verworfen.
  Chip mit Bestandswert → Änderung verworfen, alter Wert bleibt.
- **Dasselbe Feld zweimal:** Felder sind **einwertig** → zweite Auswahl editiert den
  bestehenden Chip (kein Duplikat).
- **Ereigniszeit-Default:** Chip nur anzeigen/senden, wenn der Wert von „jetzt" abweicht;
  sonst greift der bestehende `jetztIso`-Default beim Submit (Spec §11).
- **Leerer Wert bestätigt** (`von`/`an`/`veranlassung`): kein Chip (Abbruch wie Escape).
- **Berichtigungsmodus:** unverändert — `typ='berichtigung'`, `berichtigt_eintrag_id`
  gesetzt; Typ-Select + Baustein-Sektion bleiben wie heute ausgeblendet, Felder-Erfassung
  bleibt verfügbar.
- **„Als strukturierten Lagebericht erfassen →"** (bei `typ='lage'`) bleibt erhalten.

## Testing (TDD)

Reihenfolge Tests-vor-Code, pro Einheit:

- **Pure Helfer** (Unit, wie `bausteinEinsetzen.test.ts`): `erkenneSlashTrigger`
  (Wortanfang vs. „2/9"/Pfad), `filterMenue`, `baueEintrag` (Merge inkl. Ereigniszeit-Default,
  Berichtigungsfelder).
- **Komponententests** (RTL + `userEvent`, vgl. `Schnellerfassung.test.tsx`):
  - tippen → `Enter` sendet; Fokus bleibt, Feld leer.
  - `/` → Feld → Wert → `Enter` → Chip; Eintrag enthält das Metadatum.
  - `/` → Baustein → Inhalt gesetzt.
  - Chip editieren / entfernen; selbes Feld zweimal editiert statt dupliziert.
  - `Enter` bei offenem Menü/Chip sendet **nicht**.
  - Berichtigungsmodus sendet `typ='berichtigung'` + `berichtigt_eintrag_id`.
- Beachten (Projekt-Memory): `App.useApp()` für `message`/`Modal` (kein statisches
  Leaken), `localStorage`-Polyfill in `src/test/setup.ts`, Gate via
  `vitest run --no-file-parallelism`.

## Out of Scope

- Keine Backend-/Datenmodell-Änderungen; `NeuerEintrag` bleibt unverändert.
- Keine neuen Metadatenfelder.
- `EtbTabelle`/Anzeige bleibt unverändert.

## Offene Punkte (im Spec-Review zu bestätigen)

- **Baustein-Platzhalter:** Bleibt der bestehende `Modal`-Flow für manuelle Platzhalter, oder
  sollen Platzhalter inline im Inhalt fokussierbar werden? Vorschlag: Modal-Flow vorerst
  behalten (Scope-Grenze), inline-Platzhalter als möglicher Folge-Task.
