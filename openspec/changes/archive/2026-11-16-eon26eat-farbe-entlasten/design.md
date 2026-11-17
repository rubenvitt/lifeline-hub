# Design

## Context

Motivation in `proposal.md`. Abgestimmt am Phase-1-Checkpoint vom 16.11.2026 (LLH-1720): zwei
Wellen. Dies ist Welle 1 („Farbe“). Welle 2 baut auf ihr auf: Der große Statusblock des
FMS-Tableaus darf „gebunden“ nicht als gelbe Wand zeigen.

Ist-Stand:

- **Die Statusrolle eines Fahrzeugs oder einer Kraft kommt nur aus der Kategorie.**
  `statusKategorie` in `theme/statusFarben.ts`: verfügbar `normal`, gebunden `achtung`, nicht
  verfügbar `alarm`. Nach dem Startkatalog (`src/fahrzeug/mod.rs`) liegen in „gebunden“ S3, S4,
  S5, S7, S8, S9 und S0, beim Personal alarmiert, auf Anfahrt und im Einsatz. Abnehmer sind
  `kraefte/mittelStatus.ts`, `kraefte/meldebildRaster.ts`, `kraefte/fmsTableauKern.ts`,
  `kraefte/Verdichtungszeile.tsx` und `pages/lagekarte/leistenDaten.ts`. Ausnahmen davon:
  `KraefteuebersichtPage.tsx` setzt „gebunden“ hart auf `achtung`, `UeberblickPage.tsx` hart auf
  `bedien`.
- **Der Eingang der Kommunikation ist gelb.** `kommunikation/kartenKante.ts`: `phaseTon` gibt bei
  `unbearbeitet` `achtung` (Etikett „Neu“/„Offen“), `kartenKante` färbt die linke Kante
  `rollen.achtung`.
- **Die Flächenstufen liegen nachts fast gleichauf.** Nachts `grund` #08090b, `paneel` #0a0c0e,
  `kopf` #0c0e11, `flaeche` #0f1215, `flaeche2` #14171b, `flaeche3` #16191d, Schritte 1,01 bis
  1,05 : 1. Am Tag ist die Folge nicht einmal monoton. `.lfh-segment--aktiv` setzt nur
  `flaeche3`. `rollen.guard.test.ts` hält TS und CSS deckungsgleich.
- **Die Ortsmarke ist rot.** `IconRail.tsx` (`inset 2px 0 0 rahmenFarben.marke`),
  `ModulAkkordeon.tsx` und `GeraeteLayout.tsx`, aus `umsetzung.md`, Entscheidung 2. Gegen `aktiv`
  misst sie 2,28 : 1. Modulpanel, Sprungpalette, Hilfe und Lagekarte tragen dieselbe Marke schon
  in `bedien` (5,48 : 1).
- **Die Sichtungswahl fällt nach einer Wahl in die Randform.** `personen/SichtungsWahl.tsx`:
  Danach tragen die übrigen Kacheln nur noch einen 8-px-Streifen. „tot“ (#000) und „unverletzt“
  (`flaeche`) liegen nachts bei 1,12 : 1. Es gibt zwei Paletten: `sichtungsflaechen` für die
  Wahl, `sichtungsfarben` für die Anzeige. Herleitung des Ist-Stands:
  `openspec/changes/archive/2026-10-18-knc0jyjd-sichtungswahl-flaechen/design.md`.

## Goals / Non-Goals

**Goals:**

- Jede Rolle hat eine Bedeutung, und dieselbe Zuordnung gilt an jeder Stelle (eine Funktion,
  keine fest verdrahteten Töne in Seiten).
- Gewählt und aktiv sind nachts an einer Form erkennbar, nicht nur an einer Fläche.

**Non-Goals:**

- Die Form des Statusetiketts (Rand, Größe, Knopf): das ist Welle 2 (LLH-1779/1780).
- Rote Zeilenknöpfe: LLH-1722 hat sie am 15.11. entschieden (D2, LFH-363 bleibt), die Lücke in
  MaterialAmOrt liegt in LLH-1924.
- Blau als ETB-Typ „Meldung“ und SK IV: SK IV ist nach BBK fest, der ETB-Typ bleibt.
- Die Anzeigepalette der Sichtung (Liste, Karte, Donut): Sie bleibt unverändert.
- Die Rollennamen `paneel` und `kopf` ausbauen: Sie bleiben als Aliasse (D5).

## Decisions

### D1 — „gebunden“ wird `neutral`, an einer Stelle

`statusKategorie.gebunden` wird `neutral`. Die fest verdrahteten Töne in
`KraefteuebersichtPage.tsx` (Verteilung) und `UeberblickPage.tsx` (Abschnittskarte) nehmen ihre
Rolle aus `statusKategorie`, statt sie hart zu setzen. Dann kann „gebunden“ nicht wieder
auseinanderlaufen.

*Verworfen:* `bedien`, wie die Palette des Neuentwurfs (`umsetzung.md`, Zeile 76) und der heutige
Überblick. Blau heißt „bedienbar“, und ein blaues Etikett wäre in Welle 2 schwer von einem Knopf
zu unterscheiden.

*Trade-off:* Grau trennt „gebunden“ kaum von „ohne Status“; das trägt das Wort.

### D2 — Sprechwunsch über den FMS-Anker

Eine neue Funktion `fahrzeugStatusRolle(kategorie, fmsAnker)` in `theme/statusFarben.ts` gibt
`achtung` für Anker 5 und 0 (`FMS_SPRECHWUNSCH`), sonst die Rolle der Kategorie. Alle Stellen,
die den Status eines **einzelnen** Fahrzeugs zeigen, gehen durch sie: `fahrzeugStatusDarstellung`,
`fmsStatusOptionen`, `tonAusKategorie` im Meldebild und die Kartenleiste. Zählungen nach
Kategorie (Verdichtung, Verteilung) bleiben bei der Kategorie.

Damit ist der Satz „STATUSTON NUR AUS DER KATEGORIE“ in `meldebildRaster.ts` überholt; er wird
berichtigt. Begründung: Die Bedeutung von FMS 5 und 0 legt der Funkstandard fest, nicht der
Mandant. Zwei feste Anker sind keine Tabelle über fremde Daten. Ein Status ohne Anker bleibt bei
seiner Kategorie.

*Verworfen:* eine vierte Kategorie im Backend (Migration, Katalogpflege, eigene Aufgabe) und
„Sprechwunsch auch grau“ (der Sprechwunsch fiele nicht mehr auf).

### D3 — Weitere gelbe Normalzustände (zur Freigabe)

Die Regel aus `statusrollen` angewandt auf die übrigen `achtung`-Zuordnungen in
`statusFarben.ts`. Nur diese ändern sich:

| Zuordnung | heute | neu | Grund |
|---|---|---|---|
| `schadenStatus.offen` | achtung | neutral | Eingang wie Auftrag „Offen“; Handlungsbedarf zeigt die Dringlichkeit |
| `belegungsArt.austritt` | achtung | neutral | Bewegungsart einer UHS-Belegung, kein Zustand |
| `etbTyp.anordnung` (nur Etikett) | achtung | neutral | Eintragstyp ist eine Kategorie; die Zeitachse hat eine eigene Palette |
| `raeumungszustand.laeuft` | achtung | neutral | planmäßiger Ablauf; „angeordnet“ bleibt gelb, dort muss jemand anfangen |
| `brAbgerufen` | achtung | neutral | abgerufene Einheit ist unterwegs, Normalbetrieb |

Gelb bleiben unter anderem: `transportDurch.eigen` (bewusst in LLH-1332 D5: Verantwortung bis zur
Übergabe), Aufbereitung, Desinfektion nötig, kontaminiert, nicht übernommen, Übergabe offen,
vermisst, unterbesetzt, Ablösung bald fällig, Rückruf offen, Löschfrist, Wetter- und Warnstufen
„mittel“ (eigene Skalen), SK II (BBK).

### D4 — Eingang der Kommunikation: neutrales Etikett, leise Kante

`phaseTon(…, unbearbeitet)` gibt `neutral`. `kartenKante` färbt den Eingang in `linieStark` statt
in `achtung`. So bleibt er an einer Kante erkennbar, die sich von `linie` unterscheidet, ohne Gelb
zu tragen. Die Priorität („dringend“ gelb, „sofort“ rot) bleibt der Weg für Dringliches.

*Verworfen:* Die Kante ersatzlos streichen. Dann fände die Führung den Eingang in der Liste nur
noch über das Wort.

### D5 — Vier Flächenwerte, Rollennamen bleiben

Die sechs Rollen behalten ihre Namen, belegen aber nur vier Werte je Modus. Zusammengelegt wird
**je Modus entlang der heutigen Helligkeitsfolge**, damit sich zwischen zwei Rollen nichts
umkehrt. Die Folge ist am Tag eine andere als nachts. Nachgetragen in der Umsetzung, nach
Rückfrage am 16.11.: „`paneel` = `grund`“ in beiden Modi hätte am Tag die Paneele mit dem
Seitengrund verschmolzen.

| Stufe | Nacht (dunkel → hell) | Tag (hell → dunkel) |
|---|---|---|
| 1 | `grund` = `paneel` #08090b | `flaeche` #ffffff |
| 2 | `kopf` = `flaeche` #151719 | `paneel` = `flaeche2` #f2f3f5 |
| 3 | `flaeche2` #1f2123 | `grund` = `kopf` #e6e7e9 |
| 4 | `flaeche3` #27292b | `flaeche3` #dbdcde |

Zwischen zwei Stufen liegen mindestens **1,10 : 1**, im Tag- und im Nachtmodus. Ein Wächter in
`tokens.test.ts` zählt die verschiedenen Flächenwerte (höchstens vier) und prüft die Schritte.

Der dauerdunkle Rahmen (Kopfleiste, Rail, `rahmenFarben`) ist keine Inhaltsfläche und behält
seine Werte (`grund` #0c0e11, `aktiv` #16191d, `feld` #14171b) als eigene Literale, statt
weiter auf `farbenDunkel.kopf`, `flaeche3` und `flaeche2` zu zeigen. Dafür gibt es zwei Gründe:
#0c0e11 ist zugleich das Kopf-Schwarz von Bildmarke, PWA-Manifest und `index.html`. Und die
zweite Textstufe des Rahmens (`#a0a8b1`) fiele auf einem helleren `aktiv` unter die
Tag-Schwelle 7 : 1 (LFH-434). Der Wächter in `rollen.guard.test.ts` pinnt die Literale statt
der Gleichheit mit `kopf`.

*Abstand:* Der Scope schlug 1,15 : 1 vor. Das hellt die oberste Stufe nachts bis etwa #303030 auf
und erhöht die Blendung im abgedunkelten Fahrzeug. 1,10 ist der Kompromiss, zur Freigabe.

*Verworfen:* `paneel` und `kopf` als Rollen ganz entfernen (rund 80 Stellen in etwa 50 Dateien,
Konflikte mit Welle 2). Kann später als Aufräumarbeit kommen.

*Folge:* Alle Textstufen- und Kontrasttests über diese Flächen laufen erneut. Wo `gedaempft` oder
`schwach` auf der helleren `flaeche3` den Nachtboden verliert, wird die Textstufe nachgezogen,
nicht die Fläche.

### D6 — Gewählt: 2-px-Bedienkante unten

`.lfh-segment--aktiv` bekommt `box-shadow: inset 0 -2px 0 var(--lfh-bedien)`. Ein Segment mit
`kante` (ETB-Typ) behält seine Typkante, die schon jetzt die Wahl markiert, und bekommt keine
zweite. Dieselbe Klasse in `KartenUeberlagerung.tsx` erbt es.

*Verworfen:* Invertiert (heller Block im Nachtbild, Blendung, Farbpunkte neu rechnen), gefüllt in
`bedien` (sieht aus wie der Primärknopf), Ring ringsum (sieht aus wie der Fokus).

*Grenze:* Bei 20 % Helligkeit misst die Kante nur noch rund 2 : 1. Die Form (ein Strich an genau
einem Segment) trägt dort weiter, die Fläche allein nicht.

### D7 — Ortsmarke in der Bedienfarbe

Neue Rahmenrolle `rahmenFarben.bedien` (= `farbenDunkel.bedien`, `--lfh-rahmen-bedien`). Rail,
ModulAkkordeon und Gerätehülle nehmen sie statt `marke`. `umsetzung.md`, Entscheidung 2, bekommt
einen Nachtrag, der auf diese Change verweist; `marke` bleibt für die Bildmarke.

*Verworfen:* neutral hell (`rahmenFarben.text`). Rail und Modulpanel zeigten „aktiv“ dann in zwei
Farben.

### D8 — Sichtungswahl: Innenrahmen, Schraffur, Gruppenfokus

- **Nicht gewählt nach einer Wahl:** 4 px Innenrahmen in der **Anzeigefarbe** (`punkt`) plus
  Tönung (die Anzeigefarbe mit 18 % Deckkraft über `flaeche`), Kante 1 px in `text`. Text in
  `text`, Kontrast gegen die Tönung im Test. Die Anzeigefarbe statt der abgedunkelten
  Flächenfarbe (in der Umsetzung entschieden): Dunkelrot, -grün und -blau stünden nachts mit
  rund 2 : 1 auf dem Grund. Die Anzeigefarben leuchten dort, und die Wahl zeigt danach dieselben
  Töne wie Liste und Karte.
- **„tot“:** Schraffur 45° mit 20 % Deckkraft, in jedem Zustand. Gefüllt und gewählt nimmt sie
  die Schrift der Fläche (Weiß auf Schwarz, Text gegen den Strich rund 12 : 1), getönt die
  Textfarbe des Modus.
  *Verworfen:* „†“ (Zeichen mit religiöser Lesart, klein) und ein Diagonalkreuz (liest sich wie
  „gesperrt“).
- **„unverletzt“:** transparent auf dem Grund der Maske, 1 px Rahmen, ohne Streifen und ohne Tönung.
- **Gewählt:** unverändert (Vollfläche, ✓, 3 px Rahmen).
- **Paletten:** `tokens.ts` führt je Kategorie ein Objekt `{ punkt, flaeche, schrift }`;
  `sichtungsfarben` und `sichtungsflaechen` werden daraus abgeleitet und bleiben als Namen. Die
  Töne ändern sich nicht (Option B vom 18.10.).
- **Startfokus:** Die `radiogroup` trägt `tabIndex={-1}` und `data-erfassung-fokus`. Sie bekommt
  einen eigenen Fokusring. Eine Pfeiltaste auf der Gruppe fokussiert die gewählte oder die erste
  Kachel. Tab führt weiter auf die gewählte Kachel bzw. SK I (Roving Tabindex bleibt).
  `Erfassung.tsx` fokussiert die Gruppe beim Öffnen und nach dem Serien-Speichern.

### D9 — Regeln und Erzeugtes

- **`frontend/AGENTS.md`:**
  - „Farbe und Zeichen“ bekommt die Bedeutung der Rollen und den Verweis auf `statusrollen`.
  - Der Sichtungsabsatz verliert die „Randform“.
  - Die Gestaltungssprache nennt die vier Flächenstufen und die Ortsmarke.
- **Neu erzeugt:**
  - Design System (`pnpm -C frontend design-system`), weil `statusFarben.ts`, `tokens.ts`,
    `rollen.css` und `sprache.css` sich ändern.
  - Bilder der Anwenderdoku: Kapitel Kräfte, Arbeitsfläche, Betroffene und Kommunikation.

## Risks / Trade-offs

- **Hellere Flächen nachts blenden mehr.** → Abstand 1,10 statt 1,15. Die hellste Stufe nur für
  aktive oder überfahrene Zeilen, nie als Seitengrund.
- **Eine Textstufe kann auf `flaeche3` den Nachtboden verlieren.** → Die Kontrasttests laufen vor
  jedem anderen Schritt (Aufgabe 2.1). Nachgezogen wird die Textstufe.
- **Viele Tests pinnen „gebunden → achtung“ oder die rote Marke.** → Sie werden umgeschrieben,
  nicht gelöscht. Jede Umschreibung prüft das neue Verhalten (Gegenprobe).
- **Die Sprechwunsch-Ausnahme hängt am Katalog-Anker.** Ein Mandant ohne Anker sieht S5 grau. →
  Das ist hingenommen und steht in der Spec (Szenario „Mandantenstatus ohne Anker“).
- **Die Anwenderbilder ändern sich breit.** → Der Bildlauf erzeugt nur die betroffenen Kapitel neu.

## Freigabe

Am 16.11.2026 freigegeben, mit D3 (alle fünf Zuordnungen neutral) und D5 (Abstand 1,10 : 1) wie
empfohlen.
