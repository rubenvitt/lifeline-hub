# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/fuehrungsorganisation/spec.md`. Den Stand im Code hat der Scope-Lauf vom 01.10.2026
erhoben.

### Daten im Client

`EinsatzabschnittePage` lädt `abschnitte`, `einheiten`, `personal` und `einsatz`.

- **`Einsatzabschnitt`:** `ueber_abschnitt_id`, `name`, `kurzbezeichnung?`, `leiter_name?` und
  `tz_*`. Der Server liefert eine flache Liste, den Baum baut der Client (`src/einsatzabschnitt/mod.rs:31`).
- **`Einheit`:** `abschnitt_id`, `ueber_einheit_id`, `name`, `funkrufname?`, `fuehrer_name?`,
  `typ_label`, `tz_*` und `ist_kumuliert`.

### Live

Das SSE-Ereignis `abschnitt` invalidiert `einsatzKeys.abschnitte`, `einheit` und `personal`
invalidieren `einsatzKeys.einheiten`, `stab` invalidiert `einsatzKeys.stab`
(`api/queryKeys.ts`). Eine Ansicht auf diesen Schlüsseln ist ohne Zusatzarbeit live.

### Stärke

- `abschnittStaerken(abschnitte, einheiten, id).inklUnter` ist der Wert des Gliederungsbaums
  (`baueBaum`). Er läuft über `summiereStaerke` und zählt nur die obersten Einheiten.
- `staerkeText` ist die einzige Formatierung.
- Das Meldebild zählt die Einsatzstärke anders, nämlich Personen nach Position und auch
  Einzelpersonal (`kraefte/kraeftebild.ts`). Eine Gesamtsumme aus Einheiten wäre deshalb eine
  zweite, abweichende Zahl.

### Platzierung

`stab/funkplan.ts:baueFunkplan` und `baueKraeftebild` hängen gleich auf:

- Unterabschnitte unter ihren Abschnitt, Waisen an die Wurzel
- oberste Einheiten unter ihren Abschnitt
- Untereinheiten unter ihre Einheit
- Einheiten ohne Abschnitt in einen Sammelknoten

### Zeichen

`EinsatzZeichen` zeichnet Inline-SVG mit eigenem `idPrefix`. `baueTzProps({objekttyp})` kennt
`abschnitt` (Führungs-Formation) und `einheit` (Größe aus `typ_label`). Für die Einsatzleitung
oder eine Führungsstelle gibt es kein eigenes Zeichen.

### Einsatzleitung

Ein Einsatzleiter ist kein Datum. Die Einsatzrolle `einsatzleitung` ist die Rechteachse, die
eigene Führungsstelle fehlt (LFH-849). Die Stab-Besetzung kommt aus `GET …/stab` und ist nur mit
Stab-Freigabe sichtbar (`stab/useStabFreigabe.tsx`, fail-closed).

### Druck und Übernahme

- Druckwurzel, `Druckkopf`, `DruckKnopf vorbereiten` und `useDruckModus` (`druck/AGENTS.md`)
- Übernahme in einem `POST` mit `abschnitte` als Startinhalt
- `md()` aus `stab/funkplan.ts` maskiert Namen

Vorbild für alles ist `FunkplanPage`.

### Ansichtsumschalter

`FahrzeugePage` hält die Ansicht je Einsatz im Zustand, die `Segmentleiste` steht im Kopf, und
`?ansicht=` wird angewendet und dann geräumt (`parseFahrzeugeAnsicht`).

### Abhängigkeiten

Es gibt keine Graph- oder Layout-Bibliothek (`frontend/package.json`).

## Goals / Non-Goals

**Goals:**

- Ein reines, getestetes Knotenmodell `baueFuehrungsorganisation` als einzige Quelle für
  Bildschirm, Druck und Markdown.
- Eine Darstellung, die ohne Bibliothek und ohne waagerechtes Scrollen in jeder Breite trägt.
- LFH-625 soll auf demselben Modell eine Kommunikationsebene ergänzen können, ohne es umzubauen.

**Non-Goals:**

- **Kommunikationsebene:** Sprechgruppen an den Kanten bringt LFH-625.
- **Fahrzeuge als Knoten:** Das Organigramm zeigt Führungsorganisation, keine Fahrzeugliste. Die
  steht im Funkplan.
- **Eine Einsatzleitung als Datum:** Das gehört zu LFH-849.
- **Ein eigenes Zeichen für die Einsatzleitung:** Das sind die Lücken der Zeichenbibliothek
  (LFH-829–834).
- **Bearbeiten im Organigramm, etwa Drag & Drop zum Umhängen:** Bearbeitet wird am Datensatz.
- **Eine Grafik im Lagebericht:** Lageberichte sind Markdown-Text ohne Bilder
  (`components/Markdown.tsx`). Eine Bildeinbettung wäre eine eigene Backend- und Spec-Änderung.
- **Ein eigener Platz in der Vorbereitung der Lagebesprechung:** Die Lagebesprechung nimmt das
  Organigramm über den Ausdruck oder über den übernommenen Lagebericht.

## Decisions

### D1 · Ort und Begriff: Ansicht „Organigramm“ der Seite Einsatzabschnitte

Am Phase-1-Checkpoint vom 01.10.2026 entschieden: Das Organigramm wird eine zweite Ansicht von
`/einsaetze/:id/einsatzabschnitte`. Die `Segmentleiste` „Gliederung | Organigramm“ steht in
`aktionen` des Seitenkopfs vor „Abschnitt anlegen“. Die Ansicht liegt je Einsatz im Zustand
(Muster `FahrzeugePage`). `?ansicht=organigramm` wird angewendet und geräumt, über
`parseAbschnitteAnsicht` in `routing/deeplinks.ts`. `einsatzabschnittePfad` bekommt
`opts.ansicht`.

- **Warum dort:** Die Daten liegen auf der Seite, sie ist live, und Sperre und Sichtbarkeit erbt
  das Organigramm vom Modul `einsatzabschnitte`. Es braucht keinen Registry-Eintrag und keine
  Änderung an `MODUL_KEYS` im Backend.
- **Verworfen: Stab-Unterseite neben dem Funkplan.** Die Führungsorganisation ist keine Arbeit des
  S6 allein, und die Seite müsste die Stab-Freigabe für Daten prüfen, die ihr nicht gehören.
- **Verworfen: eigenes Modul.** Das wäre ein Registry-Eintrag mit Backend-Liste für eine reine
  Darstellung derselben Daten.
- **Begriff:** Die Dokumentart im Druckkopf heißt „Führungsorganisation“, der Fachbegriff der
  FwDV 100 für die Gliederung der Führung. Der Umschalter sagt „Organigramm“, weil das die
  Darstellungsform ist und „Gliederung“ daneben schon die andere Form benennt. „Führungsskizze“ war
  Umgangssprache aus dem Gespräch und wird nicht übernommen.
- Im Organigramm entfällt das Detailpaneel. Ein Klick auf einen Abschnittsnamen wechselt in die
  Gliederung mit Auswahl (D7).

### D2 · Knotenmodell: `baueFuehrungsorganisation` als reine Funktion

Die Funktion liegt in `pages/einsatzabschnitte/fuehrungsorganisation.ts`:

```ts
type OrgKnoten =
  | { art: 'abschnitt'; key: string; id: number; name: string; rufname: string | null;
      leitung: string | null; staerke: Staerke | null; tz: TzProps; kinder: OrgKnoten[] }
  | { art: 'einheit'; key: string; id: number; name: string; rufname: string | null;
      leitung: string | null; staerke: Staerke | null; tz: TzProps; kinder: OrgKnoten[] }
  | { art: 'sammel'; key: 'sammel'; kinder: OrgKnoten[] };

interface Fuehrungsorganisation {
  wurzeln: OrgKnoten[];             // oberste Abschnitte, dann „Ohne Abschnitt“
  einheitenFehlen: boolean;         // Quelle Einheiten nicht da → Stärke „—“, Hinweis
}
```

- **Platzierung wie im Funkplan** (Context, Platzierung). Damit sind Organigramm, Funkplan und
  Meldebild deckungsgleich, und LFH-625 kann die Sprechgruppen je `key` anhängen.
- **Die Wurzel „Einsatzleitung“ gehört nicht ins Modell.** Sie ist fest und trägt keine Zahl (D4).
  Die Stabsstelle kommt aus einer eigenen Quelle (D5).
- **Stärke:**
  - Abschnitt: `abschnittStaerken(abschnitte, einheiten, a.id).inklUnter`, also derselbe Aufruf
    wie in `baueBaum`.
  - Einheit: `summiereStaerke([e])`, das ist ihr `ist_kumuliert` über die eine Funktion.
  - Fehlen die Einheiten, ist die Stärke `null`.
- **Zeichen:**
  - Abschnitt: `baueTzProps({objekttyp:'abschnitt', organisation: a.tz_organisation, fachaufgabe:
    a.tz_fachaufgabe})`
  - Einheit: wie `kraefte/EinheitZeichen.tsx`
- **Sortierung:**
  - Abschnitte nach `sortier`, dann Name (wie der Server liefert, ohne Neusortierung)
  - Einheiten nach `sortier`, dann Name
- **Zyklussicher:** Ein Abschnitt oder eine Einheit wird höchstens einmal aufgenommen (besuchte
  Menge), wie `nachfahrenInkl`.

Verworfen: `FunkplanZeile` direkt wiederverwenden. Sie trägt Fahrzeuge, TMO/DMO und
Erreichbarkeit, aber kein Zeichen und keine Stärke. Ein gemeinsamer Typ würde beide Seiten an
Felder binden, die sie nicht zeigen. Die Gleichheit der Platzierung belegt stattdessen ein Test
(Aufgabe 1.3).

### D3 · Layout: hängendes Organigramm aus CSS, keine Bibliothek

Am Phase-1-Checkpoint entschieden.

```text
                 ┌──────────────────┐        ┌────────────┐
                 │  Einsatzleitung  │────────│ Stab S1–S6 │
                 └────────┬─────────┘        └────────────┘
     ┌────────────────────┼────────────────────┐
┌────┴──────┐        ┌────┴──────┐        ┌────┴──────┐
│ EA Nord   │        │ EA Süd    │        │ EA Mitte  │     ← Grid, bricht in Zeilen um
│ │ UA 1    │        │ │ Zug 1   │        └───────────┘
│ │ │ Zug 2 │        │ │ │ Gr 1  │
│ │ Zug 3   │        └───────────┘                         ← tiefer: senkrecht, eingerückt
└───────────┘
```

- **Wurzel oben**, die Stabsstelle rechts daneben (unter `md` darunter) mit einer waagerechten
  Stabslinie (FwDV 100: Stab ist der Einsatzleitung beigeordnet, nicht unterstellt).
- **Erste Ebene:**
  - `display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, <Spalte>px), 1fr))`
  - Die Spaltenbreite wird vor dem Bau gemessen (Aufgabe 2.1): längster Name, Rufname und Stärke
    bei Fükw-Breite, Ziel drei Spalten bei 1366 × 768 mit offenem Panel.
  - Die Verbindungslinie von der Wurzel zur ersten Ebene ist eine obere Kante je Spalte. Ein
    durchgehender Querbalken würde beim Umbruch in die zweite Zeile lügen.
- **Tiefere Ebenen** hängen senkrecht als Liste mit linker Linie (`border-inline-start`) und
  fester Einrückung je Ebene (`token.marginSM`). Bei tiefen Gliederungen wächst die Einrückung,
  nicht die Breite: Ab Tiefe 4 rückt nichts mehr weiter ein, die Linie bleibt.
- **Knoten:**
  - Zeichen 22 px links
  - Name als Link, darunter in Mono `tabular-nums` Rufname · Leitung · Stärke
  - Lange Werte brechen um (`overflow-wrap: anywhere`) und werden nicht gekürzt, denn eine
    Kürzung versteckte Rufnamen.
- **Rahmen und Farben:** Rahmen aus `rollen` (`linie`/`linieStark`), Radius 0, keine Statusfarbe
  für die Struktur. Nur „Leitung nicht besetzt“ trägt `achtung`, und zwar als Wort, nicht nur als
  Farbe (WCAG 1.4.1, Muster `AbschnittKnoten`).
- **Verworfen: breites Organigramm mit elkjs/dagre und Zoom.** Das wäre eine neue Abhängigkeit,
  und bei acht Abschnitten wird es so breit, dass Zoom das Scrollen nur ersetzt, nicht vermeidet
  (Akzeptanzkriterium).
- **Verworfen: eingerückter Baum allein.** Das ist der heutige Gliederungsbaum mit Zeichen, aber
  kein Organigramm.

**Nachtrag „Messung vor dem Bau“ (01.10.2026, `e2e/fuehrungsorganisation.spec.ts`).** Gemessen
bei 1366 × 768 mit offenem Modulpanel, Grundschrift 16 px, Namen in 600:

| Wert | Laufweite |
| --- | --- |
| Contentbreite der Seite Einsatzabschnitte | 1050 px |
| Abschnittsname „Deichverteidigung Nordwest II“ | 212 px |
| Einheitsname „Fachgruppe Wasserschaden Musterstadt-Nordwest“ | 350 px |
| Führer „Kirchgassner-Wohlfahrt, Maximiliane“ | 262 px |
| Kurzbezeichnung „EA-NORD-2“ (Mono 12) | 63 px |
| Funkrufname „Florian Musterstadt 1/10“ (Mono 12) | 168 px |
| Stärke „12/34/156//202“ (Mono 12) | 98 px |

Daraus folgt `SPALTE_MIN_PX = 300`: drei Spalten zu je 339 px bei 1050 px Contentbreite und
16 px Lücke. Vier Spalten (≈ 250 px) ließen nach Klappknopf und Zeichen keine 200 px für den
Namen. In der Spalte bleiben auf Tiefe 0 nach Klappknopf, Zeichen und Abständen etwa 270 px für
den Text. Der lange Abschnittsname steht in einer Zeile, der lange Einheitsname bricht in zwei
Zeilen um. Die Metazeile (Rufname · Leitung · Stärke) bricht zwischen ihren Teilen um.

### D4 · Stärke: dieselbe Rechnung, keine Gesamtzahl an der Wurzel

Jeder Abschnittsknoten zeigt `inklUnter` aus `abschnittStaerken`, wie der Gliederungsbaum. Ein
Test belegt die Gleichheit für denselben Datensatz (Aufgabe 1.2). Die Wurzel zeigt keine Zahl,
denn die Einsatzstärke hat ihre Heimat im Meldebild (`frontend/AGENTS.md`, „Eine Heimat je Zahl“,
LFH-550), und eine Summe über Einheiten wiche von ihr ab (Context, Stärke).

Verworfen: Wurzel = `summiereStaerke(alle Einheiten)`. Das wäre eine zweite Gesamtzahl neben dem
Meldebild, die bei Einzelpersonal stillschweigend abweicht.

### D5 · Einsatzleitung und Stabsstelle

- **Wurzel:** „Einsatzleitung“, darunter „Leitung nicht erfasst“ in gedämpfter Schrift, mit
  Code-Kommentar auf LFH-849. Ein Zeichen trägt sie nicht (Non-Goal).
- **Stabsstelle:**
  - `useStabFreigabe(einsatzId)`. Nur bei `zustand === 'frei'` läuft `useQuery({queryKey:
    einsatzKeys.stab(id), queryFn: ladeStab, enabled})`.
  - Sie zeigt je besetztem Sachgebiet das Kürzel und die Besetzung. Der Text kommt aus
    `stab/besetzung.ts:besetzungDarstellung`, demselben Wortlaut wie auf der Stabseite (etwa
    „Einsatzleitung“, „Name (extern)“, „Name (rückwärtig)“, „Name · nicht mehr disponiert“).
  - Unbesetzte Sachgebiete erscheinen nicht. Gibt es keines, steht „Kein Sachgebiet besetzt“ da.
  - Kürzel und Reihenfolge kommen aus `stab/sachgebiete.ts:SACHGEBIETE`. Es gibt keine zweite
    Labelliste und keinen weiteren Abruf des Funktionskatalogs, denn das Organigramm zeigt nur
    das Kürzel.
- **Laden, Fehler, gesperrt:** Die Stabsstelle fehlt, und nichts aus dem Stab wird angezeigt.
  Scheitert der Abruf bei freigegebenem Stab, steht in der Stabsstelle „Besetzung nicht geladen“.

Verworfen: die Leitung aus den Mitgliedern mit Einsatzrolle `einsatzleitung` ableiten. Das ist die
Rechteachse und kann mehrere Personen tragen, auch einen Führungsassistenten
(`src/einsatz/funktion.rs`). Das wäre eine erfundene Leitung.

### D6 · Ein- und Ausklappen, Druck

- **Klappzustand:**
  - Gemerkt wird die Menge der zugeklappten `key`s (Muster `FunkplanPage`). Das Organigramm startet
    offen, und live Hinzukommendes steht offen da.
  - Das Bedienziel ist ein `Button` mit `aria-expanded` und `aria-controls`, Höhe aus der
    Dichte-Staffel, kein `size="small"`.
  - „Alle aufklappen“ und „Alle zuklappen“ stehen in der Werkzeugzeile des Organigramms.
- **Druck:**
  - Das Organigramm-Paneel ist die Druckwurzel (`data-lfh="druckwurzel"`) mit `Druckkopf
    dokumentart="Führungsorganisation"` (`sichtbarkeit="druck"`, Zeile „Stand“ als DTG).
  - `DruckKnopf vorbereiten={() => setZugeklappt(new Set())}`.
  - Eigenheiten stehen in `pages/einsatzabschnitte/organigrammPrint.css`:
    - Grid auf zwei Spalten fest
    - Bedienziele `display: none`
    - `break-inside: avoid` je Knoten, nicht je Spalte, sonst verschluckte eine lange Spalte ganze
      Seiten
  - Die Mechanik bleibt in `druck/druck.css`.
- **Gliederung und Organigramm:** In der Ansicht „Gliederung“ gibt es keine Druckwurzel und keinen
  Druckknopf. Damit gilt „eine Druckwurzel je Seite“ in beiden Ansichten.

### D7 · Deeplinks und Auswahl

- Der Abschnittsname ist ein `Link` auf `einsatzabschnittePfad(id, {abschnitt})`. Der bestehende
  `useQueryParamSelektion('abschnitt', …)` setzt beim Treffer zusätzlich die Ansicht auf
  „Gliederung“, denn dort steht das Detail.
- Der Einheitsname ist ein `Link` auf `einheitDetailPfad(id, eid)`.
- Pfade kommen nur aus `routing/deeplinks.ts`.

### D8 · Übernahme in den Lagebericht

- `rendereFuehrungsorganisationMarkdown(org, stab, stand)` in `fuehrungsorganisation.ts`
  erzeugt:
  - die Überschriftzeile „Führungsorganisation, Stand <DTG>“
  - den Abschnitt „Einsatzleitung“ mit „Leitung nicht erfasst“
  - falls freigegeben und geladen, den Stab als Zeile „Stab: S1 Name · S2 …“ (Wortlaut über
    `stabZeilen`, dieselbe Funktion wie die Stabsstelle am Bildschirm)
  - bei fehlenden Einheiten einen Abschnitt „Quellen“ mit dem Grund
  - dann die verschachtelte Liste, je Knoten
    `**Name** · Rufname … · Leitung … · Stärke F/UF/M//Σ` (Format wie der Funkplan)
  - Fehlende Werte erscheinen als Wort wie am Bildschirm („kein Rufname“, „Leitung nicht
    besetzt“, „Stärke —“), auch bei Einheiten „Leitung“ statt „Führer“, wie in der Spec.
- Namen laufen durch `md()` aus `stab/funkplan.ts`, die eine Maskierung.
- **Aufruf und Rechte:**
  - `legeLageberichtAn(einsatzId, {vorlage:'freitext', titel:'Führungsorganisation <DTG>',
    abschnitte:[{schluessel:'text', text}]})`, danach `navigate(lageberichtDetailPfad)`.
  - Die Aktion erscheint nur mit `darfImEinsatzSchreiben` und
    `istKeyFreigegeben('lageberichte', …, overrides)`.
  - Die Overrides kommen aus derselben Query wie `useStabFreigabe` (`einsatzKeys.modulOverrides`).
  - Gesperrt ist die Aktion, solange Abschnitte, Einheiten oder eine freigegebene Stab-Besetzung
    laden. Fehler stehen als `SpeicherFehler` an der Seite.
- Erreichbarkeit führt das Organigramm gar nicht, also auch nicht im Bericht.

### D9 · Quellen und Zustände

- **Abschnitte:**
  - Laden → Skeleton
  - Fehler ohne Daten → `SeitenFehler` mit Wiederholen
  - Fehler mit Daten → Organigramm plus `SeitenStandVeraltet`
  - Leer → `SeitenLeer` „Noch keine Abschnitte“. Gibt es Einheiten, steht trotzdem der Sammelknoten
    da, denn auch eine Lage ohne Abschnitte hat eine Führungsorganisation.
- **Einheiten fehlen:** Abschnitte mit Stärke „—“ und ein Hinweis „Einheiten: nicht geladen“ bzw.
  „nicht freigegeben“, Wortlaut über `abrufZustand` und `ZUSTAND_GRUND`.
- Die Datenstand-Anzeige im Kopf läuft wie bisher über `gemeinsamerDatenstand`.

### D10 · Nachweise und Regeln

- **Vitest:**
  - Knotenmodell (Platzierung, Waisen, Zyklus, Sammelknoten)
  - Stärke-Gleichheit mit `baueBaum`
  - Markdown (Maskierung, Abwesenheiten)
  - Seite (Umschalter, `?ansicht=`, Stab nur bei Freigabe, Übernahme mit genau einem POST)
- **e2e:**
  - `e2e/fuehrungsorganisation.spec.ts`: Breite bei 1366/1024/768/390 ohne Überhang, Druck mit
    ausgelöstem `beforeprint` bei A4-Breite, Live-Folge eines Umhängens, Übernahme
  - Aufnahme in `gate1-ueberlauf` und `gate3-trefflaeche`
- **Regel-Eintrag** in `frontend/AGENTS.md` (UI-Form, neben dem FMS-Tableau): Das Organigramm ist
  eine Ansicht von Einsatzabschnitte, kein Modul. Es ist rein abgeleitet über
  `baueFuehrungsorganisation`, die Wurzel trägt keine Zahl, und der Verweis zeigt auf diese Change
  im Archiv.
- **`pruefliste.md`** mit den 15 Kriterien der Prüfliste Einsatztauglichkeit.

## Risks / Trade-offs

- **[Breite Knoten mit langen Namen]** → Werte brechen um statt zu kürzen. Die Spaltenbreite wird
  vor dem Bau gemessen (Aufgabe 2.1). `minmax(min(100%, …))` verhindert einen Überhang unter der
  Spaltenbreite.
- **[Sehr große Gliederung (> 15 Abschnitte, > 100 Einheiten)]** → Spalten brechen in Zeilen um,
  die Seite wächst nach unten. Ausklappen und „Alle zuklappen“ geben den Überblick. Eine
  Virtualisierung braucht es nicht, denn die Knotenzahl entspricht dem Gliederungsbaum, der heute
  ebenfalls alles rendert.
- **[Querbalken beim Umbruch]** → Es gibt keinen durchgehenden Querbalken, jede Spalte trägt ihre
  eigene Oberkante (D3). Optisch ist das weniger klassisch, sachlich aber richtig.
- **[Zwei Ansichten auf einer Seite]** → Jede hat genau eine Verantwortung: Die Gliederung
  bearbeitet, das Organigramm liest, druckt und übernimmt. Der Umschalter steht im Kopf und ist im
  Druck ausgeblendet.
- **[Abhängigkeit zu LFH-625]** → Das Modell legt für LFH-625 nur den Baum und stabile `key`s fest
  (`ab-<id>`, `eh-<id>`, `sammel`, wie im Funkplan). Die Kommunikationsebene entscheidet LFH-625 selbst.

## Migration Plan

Entfällt. Es ist eine reine Frontend-Ansicht ohne Datenänderung. Zum Zurücknehmen genügt es, den
Umschalter zu entfernen.
