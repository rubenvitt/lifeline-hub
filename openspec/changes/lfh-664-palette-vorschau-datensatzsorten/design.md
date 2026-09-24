# Design

## Context

Siehe proposal.md, Abschnitt „Why“. Die Mechanik aus LFH-645 steht: `Befehl.vorschau` ist
eine diskriminierte Union, `Vorschau.tsx` bildet sie exhaustiv ab, die Palette zeigt das
Ergebnis in einer Region mit „Zurück“. Offen ist allein der Inhalt je Sorte.

Die Erkundung hat für die elf Sorten diese Lage ergeben:

| Sorte | Fach der Palette (`useDatensaetze`) | Einzel-GET | vorhandener Lese-Inhalt |
| --- | --- | --- | --- |
| ETB-Eintrag | `etbNummerSchluessel` / `etbSuchSchluessel` (flüchtig, `gcTime` 30 s) | nein | Zeitachsenzeile in `EtbZeitachse.tsx`, braucht für Berichtigungshinweise die ganze Liste |
| Meldung | `einsatzKeys.meldungen(id)` | nein | `MeldungKarte`, Aktionen hängen an `darfSchreiben` und Callbacks |
| Auftrag | `einsatzKeys.auftraege(id)` | nein | `AuftragKarte`, ebenso |
| Fahrzeug | `einsatzKeys.fahrzeuge(id)` | nein | Tabellenzeile; `statusDarstellung` in `pages/FahrzeugePage.tsx` |
| Personal | `einsatzKeys.personal(id)` | nein | Tabellenzeile; `statusDarstellung` in `pages/PersonalPage.tsx` |
| Einheit | `einsatzKeys.einheiten(id)` | nein | keiner (Detailseite ist Formular); `einheitStatusAnzeige` in `kraefte/meldebildRaster.ts` |
| Schaden | `einsatzKeys.schaeden(id)` | ja, Fach **nicht live** | `Datenraster` in `SchaedenDetailPage`, mit Bearbeiten verwoben |
| UHS | `einsatzKeys.uhs(id)` | ja, Fach **nicht live** | keiner (Kopf der Detailseite, Rest ist Grundriss) |
| Lagebericht | `einsatzKeys.lageberichte(id)`, Liste trägt `abschnitte[].text` | ja | Lesezweig „Berichtstext“ in `LageberichtDetailPage`, inline |
| Gefahrengebiet | `einsatzKeys.gefahrengebiete(id)` | nein | Listenzeile auf `GefahrenPage`; Datensatz trägt nur Name, höchste Warnstufe, Zonen |
| Einsatzabschnitt | `einsatzKeys.abschnitte(id)` | nein | Lesezweig in `EinsatzabschnittePage`, inline; Stärke wird aus der Einheitenliste abgeleitet |

`useDatensaetze` hält die Listen mit `staleTime: FRISCH_MS` (60 s) frisch; der globale
Vorgabewert ist 10 s. Die Listenfächer hängen am SSE-Fan-out.

## Goals / Non-Goals

**Goals:**
- Eine Datenregel für alle Sorten, die der Spec „Die Vorschau liest den Stand der
  Trefferliste“ genügt, ohne dass sie je Bauteil neu erfunden wird.
- Vorhandenen Lese-Inhalt teilen statt kopieren, wo er ohne Umbau der Seite herauslösbar ist.
- Die neuen Bauteile folgen der Gestaltungssprache des Neuentwurfs.

**Non-Goals:**
- Kein Einzel-GET im Backend, kein neuer Query-Key.
- Keine Berichtigungshinweise im ETB („berichtigt durch Nr. …“): sie brauchen den
  Berichtigungsindex über die ganze Liste, und die Palette hat nur einen Eintrag.
- Keine Gefahrenmatrix in der Vorschau (eigener Abruf, Tabelle, zu breit für 640 px).
- Kein Grundriss, kein Material und keine Bewegungen in der UHS-Vorschau.
- Kein Tippziel für Touch; das bleibt LFH-665.
- `PersonVorschau` wird nicht auf die neue Datenregel umgestellt. Sie nutzt ein
  vorhandenes, live gehaltenes Detailfach mit reicherem Inhalt (Verlauf).

## Decisions

### 1. Datenregel: Listenfach der Palette mit `select`, geteilte Abrufoptionen

Jedes Vorschau-Bauteil liest **dasselbe Fach wie die Palette**, mit derselben Abruffunktion
und derselben Frische, und wählt den Datensatz per `select: liste => liste.find(x => x.id === id)`.

Dafür exportiert `useDatensaetze.ts` je Quelle eine Optionsfunktion,
`datensatzAbfrage.meldungen(einsatzId)` usw., die `queryKey`, `queryFn` und `staleTime`
zurückgibt. Die Palette und die Bauteile rufen beide diese Funktion auf.

- **Warum dieselbe Abruffunktion:** Gleicher Key mit anderer Funktion ist der stille Fehler,
  den der Kopf von `etbSuchSchluessel` beschreibt. Zwei Beobachter schrieben dann
  verschiedene Formen in ein Fach.
- **Warum dieselbe Frische:** Ein neuer Beobachter mit 10 s holt beim Mounten neu, sobald
  das Fach älter ist. Die Spec verlangt „kein zusätzlicher Abruf“.
- **Warum die Liste statt des Detailfachs bei Schaden, UHS und Lagebericht:** Die Liste ist
  nach dem Treffer warm und live. `einsatzKeys.schaden` und `uhsDetail` stehen in
  `NICHT_LIVE_KEYS`. Eine Vorschau darauf verpasste Live-Änderungen, was die Spec
  ausschließt. Die Listenform trägt bei allen drei, was die Vorschau zeigt; gemessen für
  den Lagebericht: `src/lagebericht/repo.rs:liste` liest dasselbe `SELECT` samt
  `abschnitte` wie `laden`.
- **Verworfen: den geladenen Datensatz im `VorschauZiel` mitgeben.** Das kostet keinen
  Abruf, friert den Stand aber beim Öffnen ein. Die Palette hält die Vorschau als Objekt,
  eine Live-Änderung käme nie an.
- **Verworfen: ein Detailfach je Sorte wie bei der Person.** Für neun Sorten gibt es keinen
  Endpunkt, für zwei ist das Fach nicht live.

### 2. ETB: laufende Nummer im Ziel, Nummernfach, Id-Prüfung

Das ETB hat kein Fach, das einen Eintrag über seine `id` adressiert. Die Suchfächer hängen am
Begriff, der sich beim Weitertippen ändert. Das `VorschauZiel` des ETB trägt deshalb neben
`id` auch `lfdNr`, und das Bauteil liest `etbNummerSchluessel(einsatzId, lfdNr)` mit
derselben `queryFn` wie der Nummernzweig der Palette. Für Nummerntreffer ist dieses Fach
warm; für Volltexttreffer kostet es genau einen Abruf mit `limit: 1`.

Nach dem Laden gilt: gezeigt wird nur ein Eintrag mit **derselben `id`**. `before_lfd_nr`
filtert strikt `<`. Bei einer Nummernlücke liefert der Cursor den nächstälteren Eintrag, und
ohne den Vergleich zeigte die Vorschau still den falschen.

### 3. Das Ziel steht in der Quellentabelle

`baueQuelle` bekommt neben `label` und `ziel` einen optionalen Baustein
`vorschau: (einsatzId, x) => VorschauZiel`. Damit steht die Zuordnung in derselben Tabelle wie
Beschriftung und Sprungziel, wie ihr Kopfkommentar es verspricht. `befehlFuer` reicht nur
noch `kand.vorschau` durch. Der ETB bekommt seine `lfdNr` dort, wo der Datensatz vorliegt,
und braucht kein neues `nummer`-Feld am Volltext-Kandidaten.

`VorschauZiel` wird die Union aus zwölf Varianten, alle mit `einsatzId` und `id`, dazu
`lfdNr` beim ETB.

### 4. Ein gemeinsamer Zustands-Helfer statt elf Kopien

`command-palette/VorschauZustand.tsx` (Name vorläufig) nimmt das Query-Ergebnis und einen
Sortennamen. Er zeigt Laden (`Spin`), Fehler (`SeitenFehler` mit Wiederholen) und, wenn
`select` `undefined` liefert, den Satz „<Sorte> ist nicht mehr vorhanden.“. Erst sonst
rendert er den Inhalt. Der Fall ist sonst still: `isLoading` ist `false`, `data` ist
`undefined`, die Vorschau bliebe leer. Die Bausteine `PaneelZustand`/`SeitenZustand` werden
dafür wiederverwendet, soweit sie passen.

### 5. Herauslösen statt kopieren, je Sorte

| Sorte | Bauteil | Herkunft |
| --- | --- | --- |
| Meldung | `meldungen/MeldungVorschau.tsx` | rendert `MeldungKarte` ohne `darfSchreiben` und Callbacks |
| Auftrag | `auftraege/AuftragVorschau.tsx` | rendert `AuftragKarte` ebenso |
| Schaden | `pages/schaeden/SchadenDaten.tsx` + `SchadenVorschau.tsx` | `Datenraster` aus `SchaedenDetailPage` herausgelöst; die Seite übergibt im Bearbeiten-Modus ihre Eingabezellen als optionale Knoten, die Vorschau keine |
| Lagebericht | `lageberichte/LageberichtText.tsx` + `LageberichtVorschau.tsx` | Lesezweig „Berichtstext“ aus `LageberichtDetailPage` herausgelöst, `unterEbene` als Prop |
| Einsatzabschnitt | `pages/einsatzabschnitte/AbschnittDaten.tsx` + `AbschnittVorschau.tsx` | Lesezweig aus `EinsatzabschnittePage` herausgelöst, ohne die Knöpfe |
| ETB-Eintrag | `etb/EtbEintragVorschau.tsx` | neu; nutzt `etbTyp`, `verfasserText`, `MELDEWEG_LABEL` (wird exportiert) und `Markdown` |
| Fahrzeug, Personal | `kraefte/FahrzeugVorschau.tsx`, `kraefte/PersonalVorschau.tsx` | neu; `statusDarstellung` beider Seiten zieht nach `kraefte/mittelStatus.ts`, die Seiten importieren von dort |
| Einheit | `kraefte/EinheitVorschau.tsx` | neu; Status über `einheitStatusAnzeige` |
| UHS | `pages/uhs/UhsVorschau.tsx` | neu; Typ, Status, Standort, Notiz, Verortung |
| Gefahrengebiet | `pages/gefahren/GefahrengebietVorschau.tsx` | neu; Name, höchste Warnstufe als Wort, Zahl der Zonen |

Die Karten von Meldung und Auftrag mit einem neuen Nur-Lesen-Modus zu versehen, ist nicht
nötig. Ohne `darfSchreiben` und Callbacks rendern sie heute schon keine Aktion; ein Test
belegt das je Karte in der Vorschau.

`ART_LABEL` und `WEG_LABEL` aus `MeldungKarte` sowie `MELDEWEG_LABEL` aus `EtbZeitachse`
werden exportiert, nicht kopiert.

**Einsatzabschnitt, Stärke:** Die Stärke ist aus der Einheitenliste abgeleitet
(`abschnittStaerke.ts`). Die Vorschau liest dafür zusätzlich `datensatzAbfrage.einheiten`, also
das Fach der Palette. Bei einem Abschnittstreffer ist es nur dann warm, wenn die Suche auch
Einheiten geholt hat. Sonst kostet es einen Abruf. Die Alternative wäre, die Stärke
wegzulassen. Dann zeigte die Vorschau weniger als die Seite, die sie ankündigt.

**Gefahrengebiet:** Der Datensatz trägt nur Name, höchste Warnstufe und Zonen. „Keine
erfundenen Daten“ verbietet das Auffüllen. Die Warnstufe steht als Wort, wie auf der Karte.
„keine“ heißt „keine Stufe gesetzt“, nicht „unbewertet“ (CLAUDE.md, LFH-357).

### 6. Gestaltung: Neuentwurf, nicht das Vorbild `PersonVorschau`

Neue Bauteile nehmen `Datenraster`/`Datenfeld` statt `Descriptions`. Status erscheint als
`StatusTag` oder `StatusChip` mit Wort, nie als `<Tag color={enum}>`
(`statusVertrag.guard.test.ts`). Zahlen, Zeiten, Funkrufnamen und Nummern stehen in Mono mit
`tabular-nums`. Bei Mandantenfarbe (Fahrzeug, Personal, Einheit mit Handstatus) erzwingt
`StatusTag` die Rand-Form. Das ist eine bewusste Abweichung vom Vorbild `PersonVorschau`,
das `Descriptions` nutzt und hier unverändert bleibt.

Das Raster in der Vorschau hat 2 Spalten. Die Region ist 640 px breit, 3 Spalten ließen
jedem Wert rund 190 px.

### 7. Überschriftenebene des Markdowns in der Palette

Die Kopfzeile der Vorschau ist ein `<span>`, keine Überschrift. Die Palette ist ein
Dialog ohne eigene Gliederung. Markdown in der Vorschau (ETB-Inhalt, Lagebericht) nimmt eine
Konstante `VORSCHAU_UNTER_EBENE = 2` aus `command-palette/`: Der Lagebericht setzt seine
Abschnittstitel darunter als `h3`, `#` im Text wird `h3` bzw. `h4`. Eine Konstante für
beide Sorten, damit sie nicht auseinanderlaufen.

### 8. Verweise in der Vorschau schließen die Palette

Die Vorschau-Region in `CommandPalette.tsx` bekommt einen Klick-Riegel am Container:
Trifft ein Klick ein `<a href>` in der Region, ruft sie `schliesse()`. Die Navigation selbst
übernimmt der Link (react-router), Modifier-Klicks öffnen wie gewohnt einen neuen Tab. Der
Riegel sitzt am Container, nicht an jedem Link. So gilt er für jede künftige Sorte, und
die Karten brauchen keine Palettenkenntnis.

- **Verworfen: Verweise in der Vorschau ausblenden.** Die Karten bräuchten dann einen neuen
  Modus. „↗ Auftrag“ ist gerade in der Vorschau nützlich.
- **Zu prüfen:** Esc von einem fokussierten Link in der Region führt weiterhin eine Ebene
  zurück. Der Handler sitzt an der Wurzel der Palette, laut LFH-645 bewusst; ein Test
  belegt es.

### 9. Guard in `datensaetze.test.ts`

Der Guard wird positiv und vollständig: Er baut Treffer aus allen Quellen und verlangt für
jede Datensatzzeile eine `vorschau` mit der erwarteten `art` und der `id` des Datensatzes.
Beim ETB verlangt er zusätzlich `lfdNr`. Als Gegenaussage prüft er, dass Sammeltreffer und
Koordinatensprung keine Vorschau tragen. Eine Liste der erwarteten Arten je Quelle ist ein
exhaustiver `Record<DatensatzQuelle, …>`, damit eine neue Quelle den Typcheck bricht.

## Risks / Trade-offs

- [Die Vorschau eines Abschnitts oder eines Volltext-ETB-Treffers kostet einen Abruf] →
  Hingenommen, beide mit kleinem Umfang. Die Spec verlangt „kein Abruf“ nur für einen bereits
  geladenen Stand.
- [`select` mit `find` läuft bei jedem Render über die Liste] → Die Listen sind klein
  (Größenordnung 10²). TanStack führt `select` nur bei geänderten Daten oder geänderter
  Funktionsidentität neu aus; die Funktion wird per `useCallback` auf die `id` gebunden.
- [Die herausgelösten Bauteile ändern drei Fachseiten] → Die Bestandstests der Seiten
  müssen unverändert grün bleiben. Das ist die Zusicherung, dass nichts verloren ging.
- [Karten mit eigenem Rand und Zeitspalte in der Palette] → Sie sehen in der Vorschau aus
  wie auf ihrer Seite. Das ist gewollt: gleicher Datensatz, gleiche Gestalt.
- [Elf Sorten in einer Änderung] → Die Aufgaben kommen in drei Bündeln, ein Commit je
  Bündel, zuerst ETB, Meldung und Fahrzeug, wie das Ticket es vorschlägt.

## Migration Plan

Reine Frontend-Änderung ohne Datenmigration. Rückweg per Revert.
