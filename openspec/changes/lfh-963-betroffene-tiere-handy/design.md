# Design

## Context

Die Begriffe sind in der Klärungsrunde der Welle 4 entschieden (06.10.2026, jeweils Option A):
Nebenwege am Handy zentral unter „Weitere“ (Frage 8), eine Maske mit festem Status „erfasst“
und Hinweis „mit Sichtung → betroffen“ (Frage 9), „Betroffene“ als Begriff für die Personen
(Frage 3). Offen sind nur noch die Bauentscheidungen dieses Dokuments.

Bestand: `EinsatzSeite` nimmt im Slot `aktionen` einen beliebigen `ReactNode` und bricht ihn nur
um (`flexWrap`). Das ETB bündelt unter `md` schon selbst (LFH-955, D4): eigene Weiche
`istSchmal`, Druck und Abschluss hinter `MenueAusloeser` mit dem Namen „Weitere Aktionen zum
Einsatztagebuch“. `MenueAusloeser` ist der einzige zugelassene Dreipunkt-Auslöser
(`menueAusloeser.guard.test.ts`). `Datenraster`/`Datenfeld` setzt das Etikett immer über den
Wert und gibt die Spaltenzahl auf schmalem Schirm selbst ab; seit LFH-961 zeichnen leere
Restspuren keine graue Kachel mehr.

## Goals / Non-Goals

**Goals:**
- Ein Mechanismus für Nebenwege im Seitenkopf, den jede Seite nutzt, statt je Seite eine Weiche.
- Betroffenenliste und Personen-Detail zeigen am Handy zuerst Lage, Person und Verlauf.
- Eine Personenmaske, ein Wort je Status, Feldbudget auch bei den Tieren.

**Non-Goals:**
- Das ETB bleibt bei seiner eigenen Weiche: sein Kopf trägt dazu den Filter-Umschalter und den
  Einsatzabschluss, der nach Entscheidung 5 auf die Einsatzdaten wandert; ein Umbau jetzt
  kollidierte mit der offenen Arbeit an der ETB-Zeitachse.
- Detail- und Stabseiten mit Nebenwegen im Kopf (Kräfteübersicht, Lagebericht,
  Pressemitteilung, Befehl, Funkplan, Kommunikationsplan) werden nicht in diesem Change
  umgestellt; dafür entsteht ein Folgeticket.
- Die Erfassungszeile (`/person`, Knopf „Person erfassen“) und der Paletteneintrag bleiben;
  Modulnamen in Menü, Palette und Tab gehören zur Arbeit an den Modulnamen.
- Der Tiere-Detaildialog bleibt unberührt (eigene Arbeit an `TiereDetailPage`).

## Decisions

### D1 Nebenwege als eigener Slot `weitere` an `EinsatzSeite`

`EinsatzSeite` bekommt `weitere?: { name: string; eintraege: readonly Nebenweg[] }` mit
`Nebenweg = { key; label; onWahl; ziel?; laeuft? }`. Ab `md` rendert sie je Eintrag einen
sekundären Knopf hinter `aktionen` (mit `ziel` als Link mit Knopfgestalt: Strg/⌘+Klick öffnet
einen Tab, wie der bisherige `DruckAnsichtKnopf`), unter `md` einen `MenueAusloeser` mit `name` als
zugänglichem Namen („Weitere Aktionen zu den Betroffenen“). Ist ein Eintrag `laeuft`, zeigt der
Auslöser das. Leere Liste: kein Auslöser, kein Knopf. Die Weiche liest `useViewport().istSchmal`;
das erste Bild ist breit, wie überall.

Strukturierte Einträge statt eines zweiten `ReactNode`: aus einem Knoten lässt sich kein
Menüeintrag ziehen, und nur so trägt eine Stelle beide Gestalten.

Alternativen: je Seite eine `istSchmal`-Weiche wie im ETB (verworfen: 37 Seiten mit Kopfaktionen,
jede baute dieselbe Weiche; das ist Option B der Klärungsrunde); automatisches Bündeln über die
Breite des Kopfes (verworfen: misst erst nach dem Rendern, der Kopf spränge).

Der Dreipunkt bleibt, wie im ETB; die Klärungsrunde nennt den Ort „Weitere“, und so beginnt der
zugängliche Name. Ein Menü mit nur einem Eintrag (Beobachter auf Schäden: nur Drucken) ist
gewollt: der Nebenweg steht auf jeder Seite an derselben Stelle.

### D2 Umgestellte Seiten

Betroffene (Drucken, CSV, Listenzugriffe), Tiere (Drucken, CSV) und Schäden (Drucken). Sichtbar
bleiben unter `md`: Betroffene Ansicht-Segmentleiste, „Betroffene erfassen“, „Vermisst melden“;
Tiere „Tier erfassen“, „Vermisst melden“; Schäden „Schnellerfassung“. Die Regel in
`frontend/AGENTS.md` (Aktionen) gilt für jede Seite; die übrigen folgen mit dem Folgeticket.

### D3 Eine Personenmaske

`AufnahmeModus` wird `'erfassen' | 'vermisst'`. Kopfknopf, `?neu=1` und die Aufnahme-Route
öffnen `'erfassen'`; der Folgestatus ist dort immer `erfasst` (der Server hebt mit Sichtung auf
`betroffen`). Titel und Knopf „Betroffene erfassen“, der Knopf ist die eine Primäraktion des
Kopfes (vorher drei sekundäre). `AufnahmeFelder` zeigt im Modus `'erfassen'` über den Feldern
eine Zeile „Status: erfasst · mit Sichtung → betroffen“ — beide Mounts (Modal und
`/personen/aufnahme`) sagen damit dasselbe. Die Zeile ist Text, kein Feld; das Budget von vier
sichtbaren Feldern bleibt.

Alternative: Segmentleiste „erfasst / betroffen“ im Dialog (Option B der Klärungsrunde,
verworfen).

### D4 Ein Wort je Status, „gesamt“ für die Summe

Der Filter heißt „Erfasst“ wie die Tabelle („erfasst“ aus `personStatus`). Damit kollidierte die
bisherige Summe „n erfasst“ (Seitenkopf-Meta, Sichtungsbild der Seitenleiste) mit dem Status;
Summen heißen deshalb „gesamt“ („12 gesamt“). Notiert in `personen/AGENTS.md`.

### D5 Sichtungszeile über der Liste

Neuer Baustein `personen/Sichtungszeile.tsx`: Summe und Zahl je Kategorie (SK I–IV, tot,
unverletzt, ohne Sichtung nur wenn > 0), Zahl vor Wort, Farbfeld wie die Seitenleiste, Mono.
Zahlen über `sichtungsbild` aus `personenBilanz.ts` (eine Heimat je Zahl, dieselbe Menge wie
die Seitenleiste). Sie steht unter `xl` (ohne rechte Seitenleiste) zwischen Erfassungsband und
Statusfilter und bricht notfalls um, statt waagerecht zu rollen. Ab `xl` entfällt sie, die
Seitenleiste steht daneben.

### D6 Kürzel-Hinweis der Erfassungszeile unter `md`

Unter `md` steht statt der fünf Kürzel ein Knopf „Kürzel anzeigen“ (`aria-expanded`), der die
Liste aufklappt. Das gestapelte „erkannt: …“ bleibt, wie es ist; die Zeile behält beim Tippen
ihre Höhe.

### D7 Tiere im Feldbudget

Sichtbar: Spezies (Pflicht), Rufname, Antreffort. Unter „Weitere Angaben“ (`Collapse` mit
`forceRender`): Rasse/Beschreibung, im Vermisst-Modus Farbe, Kennzeichnung, Halter-Kontakt,
dann Notiz. `forceRender`, weil die Norm sonst nicht zählbar ist und „Werte behalten“
eingeklappte Felder mitnehmen soll. Knopf und Titel „Tier erfassen“ statt „Schnellerfassung“
(Entscheidung 1: Knöpfe nennen die Handlung).

### D8 Personen-Detail

Lesezweig der Stammdaten: `Datenraster` (zwei Spalten) mit `Datenfeld` nur für gesetzte Angaben;
die leeren in einer Zeile „Ohne Angabe: Geburtsdatum, Herkunft / Adresse, …“ unter dem Raster.
Die Koordinate steht als Feld, sobald sie gesetzt ist oder „Auf Lagekarte verorten“ angeboten
wird. `Descriptions` verschwindet von der Seite; der Bearbeiten-Zweig bleibt ein `Form`.
Spalten: `Col` mit `order` — unter `lg` medizinische Spalte 1, Stammdaten 2; ab `lg` Stammdaten
links wie bisher. Die DOM-Reihenfolge bleibt für den Tastaturfluss am Fükw.

## Risks / Trade-offs

- [Viele Tests nennen „Schnellerfassung“ für Personen] → Namen in Vitest und e2e nachziehen;
  die e2e-Specs, die über die Maske Personen anlegen, laufen danach einzeln.
- [Ein Menü mit einem Eintrag] → bewusst (D1), Ort vor Kürze.
- [`order` trennt Bild- und DOM-Reihenfolge unter `lg`] → Tastaturfolge am Handy ist Nebensache;
  am Fükw stimmen beide.
- [Erstes Bild breit] → am Handy blitzen für einen Frame die Knöpfe; derselbe Preis wie überall
  (`useViewport`).
