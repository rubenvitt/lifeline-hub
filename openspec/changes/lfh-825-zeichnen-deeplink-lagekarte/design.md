# Design

## Context

Motivation: `proposal.md`. Anforderungen: Delta-Specs `lagekarte-zeichnen` (Zeichnen per Link) und
`sprungpalette` (Gefahrengebiet zeichnen aus der Palette).

Vorhandene Bausteine:

- `routing/deeplinks.ts`: `lagekartePfad(einsatzId, opts)` baut alle Lagekarte-Links;
  `parsePlatzierenAuftrag` liest `?platzieren=<typ>:<id>` gegen einen exhaustiven
  `Record<Zieltyp, true>` zurück.
- `pages/LagekartePage.tsx`: ein Effekt je Auftragsparameter (`gefahrengebiet`,
  `evakuierungsbezirk`, `platzieren`, `zentrum`, `ort`), jeweils „anwenden, dann räumen“. Der
  Platzier-Effekt trägt den Lade-Riegel `if (ladt) return` vor dem Räumen, weil `darfSchreiben`
  vor dem Laden des Einsatzes `false` liefert.
- `pages/lagekarte/useKartenInteraktion.ts`: `onZoneZeichnenStart({ typ, modus, farbe? })` ist der
  einzige Einstieg in den Zonen-Zeichenmodus; das Paneel in `Sidebar.tsx` ruft ihn je Eintrag aus
  `ZONE_TYPEN` (`geometrie` `Polygon` | `LineString` | `beides`, bei `beides` mit Farbe
  `'#1677ff'`, die als Datenwert gespeichert wird).
- `command-palette/befehle.ts`: `SCHNELLAKTIONEN` (Träger `modulKey`, `pfad`, `label`,
  `schlagworte`); `baueBefehle` zeigt sie nur bei `darfSchreibenImEinsatz` und
  `istModulFreigegeben(Träger)`, Befehls-Id `aktion:<modulKey>`.
- `command-palette/schnellaktionen.guard.test.ts`: Träger fertig; Ziel unter dem Modulpfad des
  Trägers mit `neu=1`; Deckung über einen AST-Scan nach `X.get('neu')`/`X.has('neu')`, Zuordnung
  der Leser-Datei zum Modul über den Dateinamen.

## Goals / Non-Goals

**Goals:**

- Ein Link betritt den Zonen-Zeichenmodus mit derselben Wirkung wie der Knopf im Paneel.
- Die Palette bekommt genau eine neue Zeile, deren Ziel der Guard so streng prüft wie die
  Erfassungsaktionen.

**Non-Goals:**

- Weitere Palettenzeilen für andere Zonentypen (der Link kann es, die Palette führt sie nicht).
- Abschnitts-Zeichnen per Link (braucht eine Abschnitts-Id, eigener Fall).
- Eine Erfassungsmaske auf der Gefahrenmatrix.
- Änderungen am Zeichnen selbst (Esc, Punktzähler, Serie, Speichern).

## Decisions

### D1 — Auftragsformat `zeichnen=<zonentyp>[:flaeche|:linie]`

Der Parameter nennt den Zonentyp, wie ihn API und `ZONE_TYPEN` schreiben (`gefahrengebiet`,
`freie_skizze`, …). Die Form ist nur für Typen mit `geometrie: 'beides'` frei; ohne Angabe gilt die
Fläche (erster Knopf im Paneel). Bei fester Geometrie ist eine passende Form erlaubt, eine
abweichende macht den Auftrag ungültig — ein Link, der eine Absperrgrenze als Fläche verlangt, ist
ein Fehler und soll nicht still umgedeutet werden.

Die Formwörter sind deutsch und sprechend (`flaeche`/`linie`) statt der internen Moduswerte
(`polygon`/`linie`), weil der Link ein äußerer Vertrag ist; die Übersetzung steht an einer Stelle.

*Verworfen:* zwei Parameter (`zeichnen=` + `form=`) — ein Auftrag in zwei Teilen kann halb
geräumt werden; ein Parameter je Typ (`?gefahrengebiet-zeichnen`) — jede neue Zonenart bräuchte
einen neuen Leser.

### D2 — Zweiteiliger Parser: Syntax in `deeplinks.ts`, Geometrie in `pages/lagekarte/`

`parseZeichnenAuftrag(wert)` in `routing/deeplinks.ts` prüft den Typ gegen einen exhaustiven
`Record<ZoneTyp, true>` (ein neuer API-Zonentyp bricht den Typcheck, wie bei
`PLATZIEREN_ZIEL_ERLAUBT`) und die Form gegen `flaeche`/`linie`; Ergebnis `{ typ, form? }` oder
`null`. Die Auflösung zum Zonen-Entwurf (`{ typ, modus, farbe? }`) übernimmt eine reine Funktion in
`pages/lagekarte/` über `ZONE_TYPEN`: sie kennt die Geometrie je Typ und die Vorgabefarbe. Liefert
sie `null`, wird nur geräumt.

Die Vorgabefarbe der freien Skizze wird aus `Sidebar.tsx` in eine benannte Konstante neben
`ZONE_TYPEN` gezogen und von Paneel und Link gemeinsam genutzt; das ist ein Datenwert (wird
gespeichert), also bleibt es ein Literal, nur eben an einer Stelle.

*Verworfen:* die Geometrie-Tabelle in `deeplinks.ts` doppeln — zwei Wahrheiten über die
Geometrie je Typ; `deeplinks.ts` von `pages/lagekarte/zonenStil.ts` abhängig machen — das
Routing-Modul bliebe nicht frei von Seitenbezügen.

### D3 — Leser in `LagekartePage.tsx` nach dem Muster des Platzier-Effekts

Ein eigener Effekt liest `searchParams.get('zeichnen')` **als Literal** (sonst sieht der
Guard-Scanner ihn nicht, Kopfkommentar Punkt 2 des Guards): fehlt der Parameter → nichts; `ladt` →
warten; sonst bei `darfSchreiben` und gültigem Entwurf `onZoneZeichnenStart(entwurf)`, danach
räumen (anwenden, dann räumen). `darfSchreiben` ist im Historien-Modus schon `false`
(`useLagekarteDaten`), ein eigener Snapshot-Zweig entfällt.

Damit gelten automatisch: zweistufiges Esc (LFH-712, gleicher Modus), Freigabe der Karte unter
`lg` (LFH-765, abgeleitet aus `exklusiverModusAktiv`), Exklusivität gegen andere Modi (ein Modus-Feld).
Treffen `platzieren` und `zeichnen` in einem Link zusammen, startet zuerst das Zeichnen; weil
beide Effekte dieselben alten `searchParams` kopieren, schreibt das Räumen von `zeichnen` den
Platzier-Auftrag zurück, und der Platzier-Effekt läuft danach und verdrängt den Zeichenmodus. Die
App erzeugt solche Links nicht, eine eigene Regel lohnt nicht.

`lagekartePfad` bekommt `zeichnen?: { typ: ZoneTyp; form?: 'flaeche' | 'linie' }`.

### D4 — Schnellaktion mit Träger `lagekarte` und deklariertem Leseparameter

`SCHNELLAKTIONEN` bekommt je Eintrag das Feld `parameter: 'neu' | 'zeichnen'` (der Suchparameter,
den die Zielseite liest) und optional `kennung` für die Befehls-Id (`aktion:<kennung ?? modulKey>`),
damit ein Träger später mehr als eine Aktion haben kann, ohne dass Ids kollidieren. Der neue
Eintrag: Träger `lagekarte`, Ziel `lagekartePfad(id, { zeichnen: { typ: 'gefahrengebiet' } })`,
Label „Gefahrengebiet zeichnen“, Kennung `lagekarte-gefahrengebiet`, Schlagworte zu Gefahr, Zone,
Gefahrenbereich, Skizze. Er steht **am Ende** (Pin in `befehle.test.ts` bleibt für die bestehenden
Zeilen gleich). Gemerkt wird wie bei allen Schnellaktionen das Trägermodul (`lagekarte`).

Die Sichtbarkeit ergibt sich ohne neuen Code aus `baueBefehle`: `darfSchreibenImEinsatz` und
Freigabe des Trägers `lagekarte`. Eine Prüfung der Gefahren-Freigabe fehlt bewusst: das Paneel
zeigt den Typ Gefahrengebiet ebenfalls ohne sie (Entscheidung 03.10.2026).

*Verworfen:* Träger `gefahrenzonen` mit Ausnahme in der Ziel-Regel (weicht die Regel auf, vom
Menschen abgelehnt); eine zweite Tabelle `ZEICHENAKTIONEN` (zweiter Guard, zweiter Schleifenzweig,
gleiche Aussagen).

### D5 — Guard: Ziel und Deckung je deklariertem Parameter

- **Ziel:** unverändert „unter dem Modulpfad des eigenen Trägers“; der Query-Teil muss den
  deklarierten Parameter tragen — bei `neu` den Wert `1`, bei `zeichnen` einen Wert, den
  `parseZeichnenAuftrag` annimmt.
- **Deckung:** der Scanner wird über den Parameternamen parametrisiert
  (`findeLeser(pfad, quelltext, parameter)`); je Eintrag muss es einen Leser **seines** Parameters
  in einer Datei **seines** Trägermoduls geben. Die Zuordnung über den Dateinamen bleibt
  (`LagekartePage.tsx` → `lagekarte`).
- **Verwaist/mehrdeutig:** gilt je Parameter; geprüft werden die Parameter, die in
  `SCHNELLAKTIONEN` vorkommen.
- **Selbstbeweis:** um einen Fall für `zeichnen` erweitert (Literal ja, Kommentar und fremder
  Schlüssel nein), und ein `neu`-Leser zählt nicht als `zeichnen`-Leser.
- **Leerlauf-Schutz:** je benutztem Parameter mindestens ein Leser.

### D6 — Zonen-Zeichnen wartet auf das Style-JSON (beim Umsetzen gefunden)

Der e2e-Kaltstart zeigte, was die Seitentests mit gemockter Karte nicht sehen: der Link startet
den Modus, während die Karte noch den Blindstil lädt, und kurz danach ersetzt `setStyle` (Style der
Ansicht, `diff: false`) die Sources des terra-draw-Adapters. Folge: „Style is not done loading“
und ein Absturz in die Fehlergrenze. Über das Paneel trat das nie auf, weil dort erst nach dem
Laden geklickt wird.

`Kartenflaeche.tsx` startet das Zonen-Zeichnen deshalb erst, wenn das Style-JSON steht (eigener
Merker: wahr ab `style.load`, falsch ab `setStyle`). Sonst wird vertagt: nach dem nächsten
`style.load` UND dem Neuaufbau der App-Ebenen (einmaliges `load` der Karte bzw. Render-Poller von
`planeReAnlegenNachStyle`), damit die `td-zone-*`-Ebenen wie beim Start über das Paneel über
Zonen und Abschnitten liegen; gestartet wird der dann gewünschte Modus. Es steht höchstens ein
vertagter Start aus, Nonce- und Stilwechsel stapeln keine Hörer. Ein Stilwechsel während des
Zeichnens räumt und startet auf demselben Weg neu wie bei der Messung (eine angefangene Figur geht
dabei verloren, wie dort). Die Merker gehören zur Karteninstanz und werden mit ihr zurückgesetzt.

*Verworfen:* `map.isStyleLoaded()` als Bedingung — es wartet zusätzlich auf alle Kacheln, danach
kommt kein `style.load` mehr, und der Modus startete nie (fünf bestehende e2e-Tests wurden rot);
ein „Karte bereit“-Signal an `LagekartePage` durchreichen und den Deeplink dort warten lassen —
hilft nur dem Link, nicht dem Stilwechsel mitten im Zeichnen.

## Risks / Trade-offs

- [Der Leser hängt nicht am Literal (Konstante, Helfer)] → Guard wird rot, wie heute bei `neu`;
  der Kopfkommentar des Guards nennt die Falle, D3 schreibt das Literal vor.
- [Typ in der API kommt dazu, Paneel kennt ihn noch nicht] → `parseZeichnenAuftrag` nimmt ihn
  syntaktisch an, die Auflösung über `ZONE_TYPEN` liefert `null` → nur geräumt; der exhaustive
  Record erzwingt beim Typwechsel ohnehin einen Blick.
- [Zeile erscheint, obwohl `LagekartePage` später doch nicht schreiben lässt (z. B. Modul nur
  lesend)] → beide Seiten hängen an `darfImEinsatzSchreiben`; der Link räumt ohne Recht still,
  die Person landet auf der Karte statt im Leeren.
- [Die Kennung ändert das Id-Schema, und das Befehlsgedächtnis merkt Schnellaktionen über ihre Id
  (`GRUPPE_MERKBAR.schnellaktionen`)] → die bestehenden Einträge bekommen keine Kennung, ihre Ids
  bleiben `aktion:<modulKey>`, gemerkte Einträge bleiben gültig; nur die neue Zeile trägt
  `aktion:lagekarte-gefahrengebiet`.
