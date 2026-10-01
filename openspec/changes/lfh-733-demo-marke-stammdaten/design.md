# Design

## Context

- Die Marke liegt in `demo_herkunft` (`migrations/0123_demo_daten.sql`): PK
  `(tabelle, datensatz_id)`, `tabelle IN ('fahrzeug','personal','material')`, ohne FK auf die
  Stammzeile. Nur Zeilen, die der Import neu angelegt hat, tragen eine Marke. Beim Entfernen
  verliert jede Zeile ihre Marke, auch eine behaltene (`src/demo/entfernen.rs`). Die IDs sind
  je Tabelle global eindeutig, die Marke kann also nicht in eine andere Organisation zeigen.
- Die Stamm-Repos lesen über eine `SPALTEN`-Konstante in den internen Datensatz (`Fahrzeug`,
  `Personal`, `Material`, `sqlx::FromRow`). `laden` und `liste` teilen sie
  (`src/fahrzeug/repo.rs:7`, `src/personal/repo.rs:7`, `src/material/repo.rs:6`). Die
  `…Anzeige` entsteht daraus (`Fahrzeug::anzeige`, `personal::repo::zu_anzeige`,
  `Material::anzeige`). Ändern sowie Außer- und In-Dienst-Stellen antworten mit derselben Anzeige
  nach `laden`.
- Die Dispositionen lesen über `SELECT_AUFGELOEST` mit `LEFT JOIN` auf den Stamm
  (`src/{fahrzeug,personal,material}/disposition_repo.rs`). `ist_adhoc` wird dort aus
  `…_id IS NULL` abgeleitet.
- Die Auswahllisten zum Disponieren lesen `GET /api/{fahrzeuge,personal,material}?nur_im_dienst=true`
  und bauen flache antd-`Select`-Optionen mit Text-Label (`pages/FahrzeugePage.tsx:422`,
  `pages/PersonalPage.tsx:221`, `pages/MaterialPage.tsx:246`). Keins der drei Felder hat eine
  Textsuche (`showSearch`).
- Präzedenz für eine Zeilenmarke: `<Tag color="blue">ad-hoc</Tag>` in den drei Einsatz-Tabellen.
  Blau ist laut `frontend/AGENTS.md` („Farbe und Zeichen“) die Bedienfarbe, für eine reine
  Herkunftsangabe also ungeeignet.

## Goals / Non-Goals

**Goals:**
- Eine Quelle der Wahrheit für „ist Demo“: die Marke, live gelesen, ohne zweites Flag.
- Eine Darstellung der Marke im ganzen Frontend, an genau einer Stelle definiert.
- Die Reihenfolge der Auswahllisten ist rein und testbar, ohne die Seiten zu rendern.

**Non-Goals:**
- Ausblenden von Demo-Stammdaten in echten Einsätzen (verworfen am Scope-Checkpoint, s. D4).
- Ein Demo-Flag am Einsatz selbst. Der Demo-Einsatz bleibt an Einsatzart `uebung` und am Präfix
  „ÜBUNG – “ erkennbar.
- Kennzeichnung in den Folge-Pickern und -Ansichten, die auf Einsatz-Dispositionen aufsetzen
  (Einheit-Detail, Besatzung, FMS-Tableau, Kräfte-Vorschau, Funkplan, UHS-Material, BR-Detail).
  Sie bekommen das Feld mit und können es später nutzen, die Anzeige dort ist ein möglicher
  Nachzug.
- Filter oder Suche „nur Demo“ im Katalog.
- Eine neue Migration oder ein neuer Index.

## Decisions

### D1 — `ist_demo` als abgeleitete Spalte in `SPALTEN`, nicht nur in `liste`

Jede `SPALTEN`-Konstante bekommt am Ende
`EXISTS(SELECT 1 FROM demo_herkunft dh WHERE dh.tabelle = '<tabelle>' AND dh.datensatz_id = <tabelle>.id) AS ist_demo`.
Der interne Datensatz bekommt `ist_demo: bool`, die Anzeige reicht ihn durch.

- **Warum hier:** `laden` teilt `SPALTEN`. Damit tragen auch die Antworten auf Ändern und
  Dienststatus das richtige Feld. Wer im Frontend die Antwort in den Cache schreibt, löscht die
  Marke so nicht versehentlich.
- **Verworfen: eine zweite Abfrage in `liste`** (wie die Qualifikationen beim Personal). Das
  bliebe auf die Liste beschränkt, und `laden` meldete still `false`.
- **Verworfen: eine Spalte `ist_demo` in den Stammtabellen.** Das wäre eine zweite Wahrheit
  neben der Marke, und das Entfernen müsste sie mitpflegen. Die Spec LFH-690 legt die Marke als
  einzige Herkunftsquelle fest (D4 dort: „eine zweite Wahrheit ohne Nutzen“).
- **Kosten:** ein PK-Lookup je Zeile. Die Kataloge sind klein (Dutzende bis Hunderte Zeilen).

`<tabelle>.id` steht voll qualifiziert, damit der Unterselect eindeutig an die äußere Zeile
bindet, auch wenn `demo_herkunft` je eine Spalte `id` bekäme.

### D2 — Dispositionen über den vorhandenen Stamm-Join

`SELECT_AUFGELOEST` bekommt denselben `EXISTS`-Ausdruck gegen `ef.fahrzeug_id`,
`ep.personal_id` bzw. `em.material_id`. Bei `NULL` (ad-hoc) ergibt der Vergleich keinen Treffer,
das Feld ist also `false`, ohne Sonderfall im Rust-Code. Das Feld folgt **nicht** der
Live-oder-Snapshot-Regel der Identität: Die Herkunft ist keine Anzeigeeigenschaft, die
einfriert. Ist die Marke nach dem Entfernen weg, ist die Kraft auch in abgeschlossenen
Einsätzen kein Demo mehr.

### D3 — Pflichtfeld `bool`, kein `Option`

`ist_demo: bool` ohne `skip_serializing_if`, wie `ist_adhoc`. Die Norm „Optionalität ehrlich
machen“ (`src/AGENTS.md`, Typ-Codegen) spricht für das Pflichtfeld: Das Feld ist immer
bekannt. Der Preis ist, dass die Test-Fixtures im Frontend, die `Fahrzeug`, `Personal`,
`Material` oder die drei `Einsatz…`-Typen bauen, das Feld nachtragen müssen. `tsc` findet jede
dieser Stellen.

### D4 — Auswahllisten: kennzeichnen und ans Ende gruppieren (Entscheidung des Menschen)

Gewählt am Scope-Checkpoint (01.10.2026) aus drei Wegen:

| Weg | Bewertung |
|---|---|
| **Kennzeichnen + Gruppe „Demo-Daten“ am Ende** (gewählt) | Nichts verschwindet. Der Demo-Einsatz selbst funktioniert unverändert. Die Verwechslung ist an zwei Stellen sichtbar: an der Marke und am Ort in der Liste. |
| In echten Einsätzen ausblenden | Jede Rolle müsste wissen, welcher Einsatz der Demo-Einsatz ist. Heute kennt das nur der System-Admin über `/api/demo-daten`. Ein Fahrzeug, das „fehlt“, ist schwerer zu erklären als eines mit Marke. |
| Nur kennzeichnen | Minimal, aber die Demo-Einträge stehen alphabetisch zwischen echten. Die Marke ist der einzige Hinweis. |

Umsetzung: eine reine Funktion in `stammdaten/demoAuswahl.tsx` nimmt die bereits gefilterten Stammdaten, eine
Label-Funktion und das `ist_demo` und liefert antd-Optionen. Erst kommen die echten Einträge
flach in Backend-Reihenfolge, dann, falls vorhanden, eine Options-Gruppe
`{ label: 'Demo-Daten', title: 'Demo-Daten', options: [...] }`. Die Demo-Optionen bekommen ein
Label aus Text und Marke. Die drei Seiten rufen diese Funktion statt ihrer eigenen `.map`.

### D5 — Eine Marken-Komponente, neutral und textgetragen

`components/DemoMarke.tsx` rendert ein antd-`Tag` **ohne** `color` mit dem Text „Demo“ und
`title="Stammdaten aus dem Demo-Import"`. Der Text trägt die Bedeutung (WCAG 1.4.1), die
Umrandung des Tags ist die Form. Eine Farbe gibt es nicht. Das ist kein Status, deshalb keine
Karte in `theme/statusFarben.ts` und kein `StatusTag`. Blau scheidet aus, weil es bedient
(„Rot bedient nichts“, `frontend/AGENTS.md`). Alle Fundstellen (Kataloge, Detailköpfe,
Auswahllisten, Einsatz-Tabellen) nutzen nur diese Komponente. Die Regel ist geteilt, wie es der
Kopf von `src/AGENTS.md` verlangt: Die Server-Hälfte (live per `EXISTS`, kein Flag) steht in
`src/AGENTS.md`, Abschnitt „Demo-Daten zur Laufzeit“, die Darstellung in `frontend/AGENTS.md`,
„Farbe und Zeichen“. Ein Agent, der Seiten im Frontend ändert, lädt nur die zweite.

## Risks / Trade-offs

- [Fixture-Churn: rund drei Dutzend Testdateien bauen die betroffenen Typen] → mechanisch,
  `tsc` zeigt jede Stelle. Wo es schon eine Fixture-Fabrik gibt, bekommt sie den Default
  `ist_demo: false`. Für keine einzelne Datei wird eine neue Fabrik angelegt.
- [`SPALTEN` wird auch beim Zurücklesen im Import benutzt (`anlegen_tx` → `laden`), dort ist die
  Marke noch nicht geschrieben] → das Feld meldet in diesem Moment `false`. Der Import liest es
  nicht, deshalb hat das keine Wirkung. Ein Test hält fest, dass die Liste **nach** dem Import
  `true` meldet.
- [ReactNode-Label in `Select`] → keins der drei Felder filtert nach Text. Würde später
  `showSearch` ergänzt, bräuchte es `optionFilterProp` auf ein Textfeld. Das steht als Hinweis
  am Helfer.
- [Die Marke in den Einsatz-Tabellen erscheint auch im Demo-Einsatz an jeder Kraft] →
  gewollt und harmlos: Dort sind alle Kräfte Demo, und die Marke ist wahr.

## Migration Plan

Keine Datenmigration. Rückbau = Revert des PRs. Das Feld verschwindet aus dem Wire-Format, ein
älterer Client ignoriert es ohnehin.
