# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/stab-fernmeldeskizze/spec.md` und `specs/stab-funkplan/spec.md`. Den Stand im Code hat der
Scope-Lauf vom 01.10.2026 erhoben. Pfade sind relativ zu `frontend/src/`.

### Zwei Ableitungen, eine Platzierung

- **`stab/funkplan.ts:baueFunkplan`** baut `FunkplanZeile[]`: Abschnitt → Einheit → Fahrzeug mit
  `key` (`ab-<id>`, `eh-<id>`, `fz-<id>`, `sammel`), `rufname`, `tmo`/`dmo` als Bezeichnungen und
  `kommunikationsmittel` als Label. Die Sprechgruppen-IDs trägt die Zeile nicht.
- **`pages/einsatzabschnitte/fuehrungsorganisation.ts:baueFuehrungsorganisation`** baut
  `OrgKnoten[]` mit denselben Schlüsseln, ohne Fahrzeuge, dafür mit Zeichen (`tz`), Leitung und
  Stärke. Es ist zyklussicher, und ein Test belegt die gleiche Platzierung wie im Funkplan
  (LFH-626, Aufgabe 1.3).
- **Unterschied bei fehlenden Quellen:**
  - Der Funkplan zieht die Kinder einer fehlenden Ebene an die Wurzel.
  - Das Organigramm kennt nur `einheiten == null`. Ohne Abschnitte (`[]`) fielen alle Einheiten in
    „Ohne Abschnitt“, und das wäre falsch.

### Sprechgruppen

- `Einsatzabschnitt.sprechgruppen` und `Einheit.sprechgruppen` sind die Zuordnungen (Migration
  0073), mit `id`, `bezeichnung` und Betriebsart.
- `components/kommunikationsmittel.ts:teileSprechgruppen` trennt nach TMO und DMO.
- Ein Abschnitt trägt in der Praxis beides: den Kanal nach oben (zur Einsatzleitung) und den Kanal
  nach unten (zu seinen Einheiten). Das Datenmodell trennt die Richtung nicht.

### Lücken

`stab/luecken.ts` filtert die geladenen `Quelle<T>` (`zustand`, `daten`) zu `Luecke<T>`
(`zustand`, `treffer`). Fehlt eine Quelle, gibt es keine Zahl, sondern den Zustand. Der Funkplan
zeigt die Lücken über `LueckenZeile` im Paneel, `rendereFunkplanMarkdown` schreibt sie in den
Bericht.

### Organigramm-Layout

`pages/einsatzabschnitte/Organigramm.tsx` (`OrganigrammBild`, `Zweig`, `KnotenInhalt`) und
`organigrammPrint.css` enthalten das hängende Layout:

- erste Ebene als Grid (`SPALTE_MIN_PX = 300`, gemessen bei 1050 px Contentbreite), tiefer
  senkrecht
- Klappziel mit `aria-expanded`, Einzug gedeckelt ab Tiefe 4
- Druck mit zwei Spalten, Klappziele aus, `break-inside` je Knoten

Die Druckregeln hängen an `.organigramm-print-root`. Gates und e2e greifen über die
`data-lfh`-Attribute (`org-ebene1`, `org-spalte`, `org-knoten`, `org-klappen`).

### Funkplan-Seite

- `pages/FunkplanPage.tsx` lädt fünf Quellen mit eigener Weiche (`useQuelle`) und prüft die
  Stab-Freigabe fail-closed.
- Sie hat eine Druckwurzel (`.funkplan-print-root`), den Druckkopf „Funkplan“, das Lücken-Paneel,
  eine Werkzeugzeile (Übernahme, Druck) und die `Datensicht` als Baumtabelle.
- `EinsatzSeite` nimmt `aktionen` für den Seitenkopf an. `EinsatzabschnittePage` setzt dort die
  `Segmentleiste`.
- Gate 1 (`e2e/gate1-ueberlauf.spec.ts:641`) und Gate 3 (`e2e/gate3-trefflaeche.spec.ts:1386 ff.`)
  decken `stab/funkplan` schon ab.

## Goals / Non-Goals

**Goals:**

- Ein reines, getestetes Modell `baueFernmeldeskizze` als einzige Quelle der Skizze. Es setzt auf
  `baueFuehrungsorganisation` auf und baut keine dritte Platzierung.
- Eine Regel für „gemeinsame Sprechgruppe“, die Kante und Lücken-Paneel gleichermaßen nutzen.
- Ein Layout-Gerüst für Organigramm und Skizze, ohne Verhaltensänderung am Organigramm.

**Non-Goals:**

- **Fahrzeuge als Knoten:** Sie tragen keine Sprechgruppen (LFH-548, Non-Goal), und ihre Rufnamen
  stehen in der Tabelle.
- **Richtung der Sprechgruppe** (Kanal nach oben bzw. nach unten): Dafür bräuchte es ein neues Feld
  an der Zuordnung, also Backend und Migration. Das gehört in ein Folgeticket, wenn die gemeinsame
  Sprechgruppe nicht reicht.
- **Eigene Führungsstelle als Datum:** Das ist LFH-849. Kommt es, bekommen die Kanten der ersten
  Ebene ein Urteil, ohne dass das Modell umgebaut wird (D2).
- **Eine Grafik im Lagebericht:** Lageberichte sind Text ohne Bild (LFH-626, Non-Goals).
- **Kommunikationsebene im Organigramm der Abschnittsseite:** Die Skizze wohnt beim S6 (D1).
- **Stabsstelle in der Skizze:** Der Stab trägt keine Funkdaten.

## Decisions

### D1 · Ort und Begriff: Darstellung „Skizze“ der Funkplan-Seite

Die Skizze ist die zweite Darstellung von `/einsaetze/:id/stab/funkplan`. Eine `Segmentleiste`
„Tabelle | Skizze“ steht in `aktionen` des Seitenkopfs. Die Darstellung liegt je Seite im Zustand,
`?ansicht=skizze` wird angewendet und dann aus der Adresse entfernt, nach dem Muster von
`EinsatzabschnittePage` (`parseAbschnitteAnsicht`). Dafür gibt es `parseFunkplanAnsicht`, und
`funkplanPfad` bekommt `opts.ansicht`.

- **Warum dort:**
  - Die Fernmeldeskizze ist ein Arbeitsprodukt des S6 (FwDV 100 Anlage 2, S. 60, „Skizze/Konzept:
    Stab“; Herleitung in `docs/superpowers/specs/2026-09-12-lfh-46-stab-s1-s6-design.md`,
    Abschnitt 2.2).
  - Die Seite lädt schon alle Quellen mit Rechteweiche, prüft die Stab-Freigabe und zeigt das
    Lücken-Paneel, das in beiden Darstellungen dasselbe ist.
- **Verworfen: zuschaltbare Ebene im Organigramm** (Vorschlag aus LFH-626):
  - Das Organigramm gehört zum Modul Einsatzabschnitte und ist ohne Stab sichtbar. Funkangaben dort
    zeigten das S6-Produkt an der Stab-Sperre vorbei.
  - Leitung, Stärke und Stab teilten sich die Knoten mit den Sprechgruppen. Jeder Knoten würde
    doppelt so hoch, und die gemessene Spaltenbreite (D3 aus LFH-626) trüge nicht mehr.
- **Verworfen: dritte Ansicht der Abschnittsseite** und **eigene Unterroute
  `stab/fernmeldeskizze`.**
  - Die dritte Ansicht hat dieselben Rechteprobleme wie die zuschaltbare Ebene.
  - Die eigene Unterroute bräuchte ein zweites Lücken-Paneel und eine zweite Werkzeugzeile auf den
    gleichen Daten.
- **Begriff:** Die Dokumentart heißt „Fernmeldeskizze“, wie in FwDV 100 Anlage 2. Der Umschalter
  sagt „Skizze“, weil „Tabelle“ daneben die andere Form benennt. „Funkskizze“ und
  „Kommunikationsplan“ waren Umgangssprache aus dem Gespräch.
- **Kein Querverweis aus dem Organigramm.** Ein Verweis von der Abschnittsseite in den Stab wäre
  ohne Stab-Freigabe ein toter Link. Der Einstieg bleibt die S6-Zeile, dann der Funkplan.

### D2 · Modell: `baueFernmeldeskizze` über dem Organigramm-Modell

Die reine Funktion steht in `stab/fernmeldeskizze.ts`:

```ts
type Kante =
  | { art: 'gemeinsam'; tmo: string[]; dmo: string[] }
  | { art: 'keine' }            // beide Seiten haben Sprechgruppen, keine gemeinsame
  | { art: 'ohne-urteil' };     // Wurzel, Sammelknoten, oder einer Seite fehlt jede Sprechgruppe

type SkizzenKnoten =
  | { art: 'abschnitt' | 'einheit'; key: string; id: number; name: string; rufname: string | null;
      tmo: string[]; dmo: string[]; kommunikationsmittel: string | null; tz: TzProps;
      kante: Kante; kinder: SkizzenKnoten[] }
  | { art: 'sammel'; key: 'sammel'; kinder: SkizzenKnoten[] };

function baueFernmeldeskizze(
  abschnitte: readonly Einsatzabschnitt[],
  einheiten: readonly Einheit[] | null,
): { wurzeln: SkizzenKnoten[]; einheitenFehlen: boolean };
```

- **Struktur aus `baueFuehrungsorganisation(abschnitte, einheiten)`.** Das Modell geht den
  `OrgKnoten`-Baum ab und hängt je `key` die Funkangaben an. Es entsteht keine dritte Platzierung,
  und die Zyklussicherheit kommt mit.
- **Funkangaben je `key`:**
  - aus einer Map `key → Einsatzabschnitt | Einheit` über die Rohlisten
  - `tmo`/`dmo` über `teileSprechgruppen`
  - `kommunikationsmittel` über `kommunikationsmittelLabel`

  Das sind dieselben Funktionen wie in `baueFunkplan`. Ein Test belegt für einen gemeinsamen
  Datensatz gleiche `rufname`, `tmo`, `dmo` und `kommunikationsmittel` je `key` wie in der Tabelle.
- **Kante** zur übergeordneten Stelle über `verbindungsurteil(oben, unten)` aus `stab/luecken.ts`
  (D3). Wurzeln und Kinder des Sammelknotens bekommen `ohne-urteil`.
- **Die Wurzel „Einsatzleitung“ gehört nicht ins Modell**, wie beim Organigramm. Kommt LFH-849,
  bekommt das Modell einen optionalen Parameter mit den Sprechgruppen der Führungsstelle, und die
  Kanten der Wurzeln werden geurteilt statt `ohne-urteil`.
- **Fehlende Abschnitte** entscheidet die Seite, nicht das Modell: Ohne `daten` bei den Abschnitten
  wird kein Baum gebaut (D5).

Verworfen:

- **`baueFunkplan` als Struktur nehmen und Fahrzeuge herausfiltern.** Die Zeile trägt keine
  Sprechgruppen-IDs und kein Zeichen. Die Waisen-Regel bei fehlenden Quellen weicht vom
  Organigramm ab, und dann zeigten Skizze und Organigramm verschiedene Bäume.
- **`FunkplanZeile` um `sprechgruppeIds` erweitern.** Das zöge Felder in die Tabelle, die sie nicht
  zeigt (dasselbe Argument wie in LFH-626 D2).

### D3 · Eine Regel für „gemeinsame Sprechgruppe“

In `stab/luecken.ts` stehen zwei Funktionen:

```ts
function verbindungsurteil(oben: readonly Sprechgruppe[], unten: readonly Sprechgruppe[]): Kante;

interface Verbindung {
  unten: { art: 'abschnitt' | 'einheit'; id: number; name: string };
  oben: { art: 'abschnitt' | 'einheit'; id: number; name: string };
}
function verbindungenOhneGemeinsameSprechgruppe(
  abschnitte: Quelle<Einsatzabschnitt>,
  einheiten: Quelle<Einheit>,
): Luecke<Verbindung>;
```

- **Vergleich über `id`**, nicht über die Bezeichnung: Zwei Kataloge können dieselbe Bezeichnung
  tragen (einsatzlokal und Stammdaten).
- **`ohne-urteil`, wenn eine Seite leer ist.** Die Lücke steht dann schon am Knoten („… ohne
  Sprechgruppe“). Doppelt zählen hieße eine Ursache zweimal melden.
- **Paare** nach der Platzierungsregel der Spec „Knotenaufbau“:
  - Unterabschnitt → Abschnitt, wenn `ueber_abschnitt_id` bekannt ist
  - oberste Einheit → Abschnitt, wenn `abschnitt_id` bekannt ist
  - Untereinheit → Einheit, wenn `ueber_einheit_id` bekannt ist

  Das sind drei Zeilen Definition, keine zweite Baumbildung. Ein Test belegt, dass die Zahl der
  Lücke gleich der Zahl der `keine`-Kanten in `baueFernmeldeskizze` ist, für denselben Datensatz
  mit Waisen und Zyklus.
- **Zustand** `schlechtesterZustand(abschnitte, einheiten)`. Fehlen die Einheiten, wären die Paare
  zwischen Abschnitten zwar rechenbar, die Zahl aber unvollständig. Deshalb gilt „—“ mit Grund
  (Funkplan-Spec, Rechteweiche).
- **Sortierung** der Treffer in Baumreihenfolge, also nach der Reihenfolge der Quelllisten.

Verworfen:

- **Kante = die Sprechgruppen der unteren Stelle** (klassische Beschriftung: „EA Nord funkt auf
  TMO 311“). Das sagt nicht, ob die obere Stelle mithört, und eine fehlende Verbindung bliebe
  unsichtbar. Gerade die soll die Skizze zeigen (proposal, Why).
- **Richtungsfeld an der Zuordnung:** siehe Non-Goals.

### D4 · Geteiltes Gerüst `components/organigramm/`

Das Layout aus `Organigramm.tsx` wandert in `components/organigramm/HaengenderBaum.tsx`:

```ts
interface BaumKnoten { key: string; kinder: readonly BaumKnoten[] }
interface Props<K extends BaumKnoten> {
  kopf: ReactNode;                       // Wurzelbereich (Einsatzleitung, ggf. Stabsstelle)
  wurzeln: readonly K[];
  zugeklappt: ReadonlySet<string>;
  onUmschalten: (key: string) => void;
  bezeichnung: (k: K) => string;         // für das aria-label des Klappziels
  inhalt: (k: K, tiefe: number) => ReactNode;
}
```

- **Was mitwandert:**
  - `SPALTE_MIN_PX`, `EINRUECKEN_BIS_TIEFE`, Spalten-Grid, `Zweig` mit Klappziel und Platzhalter
  - `organigrammZielStil`, umbenannt in `baumZielStil` und unter dem alten Namen
    weiterexportiert, bis die Tests umgestellt sind
  - `klappbareSchluessel`, generisch über `BaumKnoten`
- **Druck-CSS** `components/organigramm/haengenderBaumPrint.css` mit den Regeln aus
  `organigrammPrint.css`. Die Regeln hängen an `[data-lfh='druckwurzel'] [data-lfh='org-…']`
  statt an `.organigramm-print-root`. So gelten sie in beiden Druckwurzeln, und
  `organigrammPrint.css` behält nur `.organigramm-no-print`.
- **`data-lfh`-Attribute bleiben** (`org-ebene1`, `org-spalte`, `org-knoten`, `org-klappen`,
  `org-klappen-platz`). Gate 1, Gate 3 und `e2e/fuehrungsorganisation.spec.ts` laufen ohne
  Änderung. Die Skizze setzt zusätzlich `data-lfh="skizze"` an ihre Wurzel.
- **Nachweis „ohne Verhaltensänderung“:** `Organigramm.test.tsx`,
  `organigrammPrint.test.ts` und `e2e/fuehrungsorganisation.spec.ts` bleiben unverändert grün.
  Eine Anpassung ist nur bei Importpfaden erlaubt.

Verworfen: das Layout in die Skizze kopieren. Dann gäbe es zwei Gerüste mit eigenen Messwerten und
Druckregeln, die auseinanderlaufen. Gate 3 hat beim Organigramm schon einmal einen Mangel der
Trefffläche gefunden (LFH-626 D3, Nachtrag), und der Fix soll nur einmal stehen.

### D5 · Darstellung der Skizze

`stab/FernmeldeskizzeBild.tsx` ist eine reine Darstellung über `HaengenderBaum`.

- **Kopf:** Kasten „Einsatzleitung“ mit „Gegenstelle nicht erfasst“ in gedämpfter Schrift
  (Kommentar auf LFH-849). Er trägt kein Zeichen und keine Stabsstelle.
- **Knoten:**
  - Zeichen 22 px als Zierde (`aria-hidden`, entfällt ohne darstellbares Zeichen)
  - Name als Link, mit `baumZielStil` und denselben Zielen wie in der Tabelle
  - darunter in Mono: Rufname bzw. „kein Rufname“, `TMO …`, `DMO …`, dann das
    Kommunikationsmittel
  - Ohne jede Sprechgruppe steht „keine Sprechgruppe“ als Wort in `achtungText`.
  - Werte brechen um (`overflow-wrap: anywhere`) und werden nicht gekürzt.
- **Kante** als erste Zeile des Knotenkopfs, über dem Namen, `data-lfh="skizze-kante"`:
  - `gemeinsam`: `⇄ TMO 311 · DMO 505` in Mono, gedämpft. Das Zeichen ⇄ ist Text, kein Emoji.
  - `keine`: `IkoneWarndreieck` (`aria-hidden`) und „keine gemeinsame Sprechgruppe“ in
    `achtungText`, als Wort, nicht nur als Farbe (WCAG 1.4.1).
  - `ohne-urteil`: Die Zeile entfällt.

  Die Kante steht am unteren Knoten, weil im hängenden Layout die senkrechte Linie der Elternliste
  die Verbindung zeichnet und der Knoten ihr Ende ist. Eine Beschriftung auf der Linie selbst
  bräuchte Positionierung und bräche beim Umbruch.
- **Quellen:**
  - Abschnitte `laden` → Skelett
  - Abschnitte gesperrt oder gescheitert → statt des Baums
    `Keine Skizze darstellbar — Abschnitte: <Grund>`
  - Einheiten fehlen → Abschnitte mit Hinweis `Einheiten: <Grund>`, Wortlaut über `ZUSTAND_GRUND`

### D6 · Seite: Umschalter, Druck, Werkzeugzeile

- **Umschalter** in `aktionen` von `EinsatzSeite`. Beim Druck ist er aus, weil der Seitenkopf in
  `funkplanPrint.css` ohnehin ausgeblendet wird.
- **Eine Druckwurzel** (`.funkplan-print-root`) für beide Darstellungen:
  - `Druckkopf dokumentart` ist „Funkplan“ oder „Fernmeldeskizze“, je nach Darstellung.
  - Das Lücken-Paneel wird in beiden gedruckt.
  - Die Druckregeln der Skizze kommen aus dem Gerüst (D4).
- **Klappzustand:** zwei getrennte Mengen der zugeklappten Schlüssel, je Darstellung eine. Die
  Tabelle kennt `fz-…`, die Skizze nicht. Mit einer Menge klappte „Alle zuklappen“ der Skizze die
  Fahrzeuge der Tabelle mit.
- **Werkzeugzeile:**
  - „Alle aufklappen“ und „Alle zuklappen“ nur in der Skizze; die Tabelle klappt über die
    `Datensicht`.
  - „In Lagebericht übernehmen“ in beiden Darstellungen, unverändert.
  - `DruckKnopf vorbereiten` klappt die aktive Darstellung auf.
- **Seitenkopf-Beschreibung:** Sie bleibt. Die Darstellung steht im Umschalter, nicht im Titel.

### D7 · Lücke im Paneel und im Bericht

- `FunkplanLuecken` bekommt `verbindungenOhneGemeinsameSprechgruppe`. Die neue `LueckenZeile`
  „Verbindungen ohne gemeinsame Sprechgruppe“ steht nach „Einheiten ohne Erreichbarkeit“ und vor
  den einsatzlokalen Sprechgruppen. Ihr Treffer ist `unten.name` mit Verweis auf die untere Stelle
  (Abschnitt bzw. Einheit), denn dort wird zugeordnet.
- **Bericht:** `rendereFunkplanMarkdown` schreibt nach derselben Zeile
  `- Verbindungen ohne gemeinsame Sprechgruppe: n (1. Zug → EA Nord, …)` oder „—“ mit Grund. Namen
  laufen durch `md()`.
- Das Paneel wächst um eine Zeile. Ob es im ersten Bild bleibt (Spec), belegt das e2e bei
  1366 × 768 mit offenem Panel.

### D8 · Nachweise und Regeln

- **Vitest:**
  - `stab/luecken.test.ts`: Urteil (gemeinsam, keine, ohne Urteil, Vergleich über `id`) und Lücke
    (Paare, Waisen, Zustände)
  - `stab/fernmeldeskizze.test.ts`: Modell, Gleichheit mit `baueFunkplan` je `key`, Gleichheit der
    Zahl mit der Lücke, gleiche Struktur wie das Organigramm
  - `stab/funkplan.test.ts`: Markdown
  - `components/organigramm/HaengenderBaum.test.tsx`
  - `stab/FernmeldeskizzeBild.test.tsx`
  - `pages/FunkplanPage.test.tsx`: Umschalter, `?ansicht=`, Druckkopf je Darstellung, Klappmengen
    getrennt, Übernahme in beiden
  - `routing/deeplinks.test.ts`
- **e2e:**
  - `e2e/funkplan.spec.ts` bekommt einen Block „Skizze“: Messung vor dem Bau (Laufweite langer
    Sprechgruppen-Bezeichnungen in der Spalte), Breiten 1366/1024/768/390 ohne Überhang, Druck bei
    A4 mit ausgelöstem `beforeprint`, Live-Folge einer Zuordnung, Lücken-Paneel im ersten Bild.
  - Gate 1 und Gate 3 nehmen `stab/funkplan?ansicht=skizze` auf, als Admin und als Beobachter.
- **Regeln:**
  - `stab/AGENTS.md`: ein Satz zum Funkplan-Eintrag (Skizze, Kante über `verbindungsurteil`, Lücke
    nur über `luecken.ts`).
  - `frontend/AGENTS.md`: Der Organigramm-Eintrag nennt das Gerüst `components/organigramm/` statt
    „LFH-625 setzt seine Kommunikationsebene darauf“.
- **`pruefliste.md`** mit den Kriterien der Prüfliste Einsatztauglichkeit (Vorbild LFH-626).

### Nachträge aus der Umsetzung (01.10.2026)

- **Messung vor dem Bau (Aufgabe 4.1, `e2e/funkplan.spec.ts`, „Skizze am Fükw“).** Bei
  1366 × 768 mit offenem Modulpanel, Mono 12:

  | Wert | Laufweite |
  | --- | --- |
  | Contentbreite der Funkplan-Seite | 1050 px |
  | Spaltenbreite der ersten Ebene (`auto-fill`, `SPALTE_MIN_PX = 300`) | 343 px, drei Spalten |
  | Sprechgruppe „TMO 412_F_DRK Nordwest-Reserve“ | 210 px |
  | Kante „⇄ TMO 412_F_DRK Nordwest-Reserve · DMO 505“ | 295 px |
  | Funkrufname „Florian Musterstadt 1/10“ | 168 px |

  `SPALTE_MIN_PX = 300` bleibt: Die Contentbreite ist dieselbe wie auf der Abschnittsseite. Nach
  Klappziel, Zeichen und Abständen bleiben auf Tiefe 0 rund 270 px Text. Die lange Kante bricht
  zwischen ihren Sprechgruppen in zwei Zeilen um, ohne Überhang (e2e, alle vier Breiten).
- **Betriebsart vor der Bezeichnung (D5):** Die Bezeichnung einer Sprechgruppe ist frei. Sie
  kann die Betriebsart schon tragen („DMO 505“) oder nicht („505“). Die Skizze setzt „TMO“/„DMO“
  nur davor, wenn die Bezeichnung nicht schon damit beginnt (ohne Groß-/Kleinunterscheidung).
  Sonst stünde „⇄ DMO DMO 505“ da; gefunden im e2e. Jede Sprechgruppe steht am Knoten als eigenes
  Wort, an der Kante durch „ · “ getrennt. Der Funkplan-Bericht (LFH-548) setzt das Präfix
  unbedingt; das bleibt außerhalb dieser Change (Nachzug).

- **Dateiname der Darstellung:** `stab/FernmeldeskizzeBild.tsx` statt `stab/Fernmeldeskizze.tsx`.
  Neben `stab/fernmeldeskizze.ts` löste `./Fernmeldeskizze` auf einem Dateisystem ohne
  Groß-/Kleinunterscheidung (macOS) zuerst die `.ts` auf.
- **Druckregeln des Gerüsts (D4)** hängen an der Klasse `.haengender-baum` der Gerüst-Region,
  nicht an `[data-lfh='druckwurzel']`. So bleibt die Zusicherung „keine Mechanik von `druck.css`
  ein zweites Mal“ (kein `druckwurzel` in Eigenheiten-CSS) bestehen. Die Spezifität (0,2,0) bzw.
  (0,2,1) schlägt `druck.css` (0,1,1) wie zuvor `.organigramm-print-root`. Der reine Teil
  (`BaumKnoten`, `klappbareSchluessel`) liegt in `components/organigramm/baum.ts`, damit Modelle
  das Gerüst nicht laden. Props des Gerüsts: `bezeichnung` (Name der Region), `knotenName`
  (für das Klappziel), `gruppe` (Sammelknoten als benannte Gruppe).
- **Ring (D3):** Der Server verhindert Zyklen in Abschnitten und Einheiten
  (`waere_zyklus` in `src/einsatzabschnitt/repo.rs` und `src/einheit/repo.rs`). Der Test „Zahl der
  Lücke = Zahl der `keine`-Kanten“ läuft deshalb ohne Ring. Bei korrupten Daten mit Ring bleibt
  die Skizze zyklussicher (über `baueFuehrungsorganisation`), die Zahl kann dann um die
  Ring-Kante abweichen.

## Risks / Trade-offs

- **[Gemeinsame Sprechgruppe ist nicht immer die tatsächliche Verbindung]** Eine Einheit kann ihren
  Abschnitt über Melder oder Telefon erreichen. → Die Kante sagt nur „keine gemeinsame
  Sprechgruppe“, nicht „nicht erreichbar“, und das Kommunikationsmittel steht am Knoten. Bringt der
  Einsatz Fehlalarme, kommt die Richtung als Folgeticket (Non-Goals).
- **[Umbau am frisch gelieferten Organigramm]** → Die Extraktion (D4) ist eine eigene Aufgabe
  vor der Skizze, mit unveränderten Tests und e2e des Organigramms als Nachweis.
- **[Lücken-Paneel fällt aus dem ersten Bild]** → Eine Zeile mehr. Das e2e misst es. Reicht der
  Platz nicht, werden die Treffer der Zeilen über `TREFFER_DECKEL` gekürzt, nicht die Zeilen.
- **[Breite Knoten durch lange Sprechgruppen-Bezeichnungen]** → Sie werden vor dem Bau gemessen.
  Die Werte brechen um und werden nicht gekürzt, und `minmax(min(100%, …))` verhindert den Überhang.
- **[Begriff]** „Fernmeldeskizze“ folgt FwDV 100 Anlage 2. Neuere Dienstvorschriften sagen
  vielleicht „Kommunikationsskizze“ (siehe Open Questions).

## Migration Plan

Entfällt. Es ist eine reine Frontend-Darstellung ohne Datenänderung. Zum Zurücknehmen genügt es,
den Umschalter zu entfernen. Das Gerüst (D4) bleibt für das Organigramm.

## Open Questions

- **DV 810 / DV 100 (2022):** Heißt das Druckstück dort „Kommunikationsskizze“ statt
  „Fernmeldeskizze“? Die Antwort ändert nur die Dokumentart im Druckkopf, nicht Spec, Ansatz oder
  Aufgaben. Bis dahin gilt der Begriff der FwDV 100, den das Projekt auch beim Funkplan nutzt.
