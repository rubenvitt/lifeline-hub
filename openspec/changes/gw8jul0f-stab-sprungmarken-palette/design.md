# Design

## Context

Motivation: siehe `proposal.md`, „Why“. Anforderungen: `specs/modul-sprungmarken/spec.md`,
`specs/sprungpalette/spec.md`.

Stand im Code:

- `einsatz/sprungmarken.ts` führt vier Marken (Entscheidungen, Patienten, Vermisste,
  FMS-Tableau). `ModulListe` (Panel und Drawer-Akkordeon) reiht sie über `navZeilen` hinter ihr
  Ankermodul (`nach`) und blendet sie über `sprungZiel` + `istModulSichtbar`/`istModulGesperrt`
  des Zielmoduls aus oder sperrt sie. Neue Marken sind Daten, kein neuer Renderpfad.
- Die Stab-Unterseiten stehen als Tabelle in `stab/unterseiten.ts` (S5: Pressearbeit,
  Informationstelefon; S6: Funkplan, Kommunikationsplan) und werden nur auf der Stab-Seite
  gerendert. Die Fernmeldeskizze ist `funkplanPfad(id, { ansicht: 'skizze' })`
  (apply-then-clean auf der Funkplanseite). Jede Unterseite prüft `useStabFreigabe` fail-closed.
- `baueBefehle` (`command-palette/befehle.ts`) kennt Module, Zuletzt, Einsatzbericht,
  Schnellaktionen, aber keine Marken. Gruppen sind ein `as const`-Tupel (`GRUPPEN_REIHENFOLGE`),
  jede neue Gruppe braucht Einträge in `GRUPPEN_LABEL` und `GRUPPE_MERKBAR` (exhaustiv).
- Der Schnellaktionen-Guard ordnet `?neu`-Leser über den Dateinamen einem Registry-Modul zu.
  `InfotelefonPage.tsx` hätte keinen Treffer und wäre „verwaist“ (Guard rot); umgekehrt deckte
  `StabPage.tsx` (liest `neu` für die Lagebesprechung) eine Stab-Schnellaktion schon, egal ob die
  Zielseite liest.

## Goals / Non-Goals

**Goals:**
- Fünf Stab-Arbeitsseiten in einem Griff erreichbar, aus Menü und Palette.
- Eine Quelle für Marken: Menü und Palette lesen dieselbe Tabelle.
- Der Guard bleibt scharf: eine Schnellaktion auf eine Stab-Unterseite braucht einen Leser
  genau auf dieser Unterseite.

**Non-Goals:**
- Kein neues Modul, keine Änderung an Freigabe oder Rechten (das klärt LLH-1116).
- Keine Zähler an den Marken (keine Quelle, Regel LFH-620).
- Kein Umbau der Stab-Seite; ihre Einstiege bleiben.
- Keine Marke für Sprechgruppen-Ansicht oder Pressemitteilungen (seltener, über die Seite).

## Decisions

**D1 Stab-Seiten als Sprungmarken, nicht als Module.** Ziel `stab`, Kategorie `fuehrung`,
Ankerkette `stab → presse → infotelefon → funkplan → fernmeldeskizze → kommunikationsplan`
(S-Nummer, dann Reihenfolge der Stab-Seite). Hinweis (Ziel ohne Verb, LFH-1078):
„Stab · Pressearbeit“, „Stab · Informationstelefon“, „Stab · Funkplan“,
„Funkplan · Skizze“, „Stab · Kommunikationsplan“. Verworfen: Registry-Einträge mit
`verweistAuf` — eigene Sichtbarkeit und Schranke, `MODUL_KEYS`-Eintrag, Backend-Gate, genau die
Gründe, aus denen LFH-620 Marken eingeführt hat; und es griffe der Entscheidung in LLH-1116 vor.

**D2 Eine Wahrheit für die Namen.** Die Marken der Stab-Unterseiten nehmen Label und Pfad aus
`stab/unterseiten.ts` (über `unterseitenFuer`), nicht als zweite Abschrift; nur die
Fernmeldeskizze ist eine eigene Zeile. Ein Test pinnt: jede Stab-Unterseite hat genau eine Marke
gleichen Namens und gleichen Pfads. Verworfen: Literale doppelt pflegen — eine Umbenennung auf
der Stab-Seite ließe das Menü still zurück.

**D3 Sperre im Menü wie bisher: geerbt, nicht versteckt.** Ein gesperrter Stab steht im Menü
mit Schloss, seine Marken auch (bestehende Regel LFH-620, eine Mechanik für alle Marken).
Ausgeblendet = weg. Das Ticket-Kriterium „ohne Stab-Freigabe weder im Menü noch in der Palette“
lesen wir so: nicht bedienbar im Menü, gar nicht angeboten in der Palette. Alternative (am
Checkpoint zu entscheiden): gesperrte Marken im Menü ganz weglassen — das ändert dann auch
Entscheidungen/Patienten/Vermisste/FMS-Tableau und die Regel LFH-620.

**D4 Palette-Gruppe „Ansichten“.** Neue Gruppe `ansichten` in `GRUPPEN_REIHENFOLGE` direkt
hinter `module`; `GRUPPE_MERKBAR.ansichten = true` (wiederholte Sprünge wie `navigation`; das
Modulgedächtnis trägt Marken nicht, weil sie keine Module sind). Zeile: Id `ansicht:<key>`,
Label der Marke, Icon und `kontext` = Label des Zielmoduls (wie Schnellaktionen), `schlagworte`
= Schlagworte der Marke + `hinweis`. Navigation nur über `sprungZu` (Strg/⌘+↵ geschenkt).
Filter: `istModulFreigegeben(zielModul)` (fertig, sichtbar, Zugriff) — gesperrt wird nie
angeboten, wie bei Modulen. Verworfen: Marken in die Gruppe `module` mischen — die Startansicht
verlöre die Trennung „Modul“ / „gefilterte Sicht“, und `module` ist nicht merkbar.

**D5 Schlagworte an der Marke.** `Sprungmarke` bekommt `schlagworte?: string[]`; die Palette
liest sie, das Menü nicht. Für die Stab-Marken aus dem Ticket („funk“, „sprechgruppe“, „tmo“,
„dmo“, „s6“; „telefon“, „rufnummer“, „leitstelle“; „presse“, „medien“, „s5“; „bürgertelefon“,
„anrufe“, „hotline“; Fernmeldeskizze „skizze“, „fernmeldeskizze“, „kommunikationsskizze“, „s6“),
für die Bestandsmarken knapp („entscheidung“; „sichtung“, „sk“; „vermisst“, „suche“; „fms“,
„status“). Rangfolge macht die bestehende Fuzzy-Suche; „Funk“ → „Funkplan“ als erster Treffer
wird per Test gepinnt. Reicht das Präfix-Gewicht nicht, wird nur das Schlagwort angepasst, nicht
die Rangfunktion.

**D6 „Anruf erfassen“.** Schnellaktion am Ende von `SCHNELLAKTIONEN`: Träger `stab`, Parameter
`neu`, Kennung `infotelefon-anruf`, Pfad `infotelefonPfad(id, { neu: true })` (Builder bekommt
`neu`), Schlagworte „anruf“, „bürgertelefon“, „hotline“, „infotelefon“, „informationstelefon“.
`InfotelefonPage` liest `searchParams.get('neu') === '1'`, fokussiert das erste Feld der
Erfassung (Zähler-Prop `focusRequest` an `AnrufErfassung`; nur ein neuer Wert fokussiert, ein
Neu-Einhängen nicht) und räumt den Parameter
(apply-then-clean, Muster `StabPage`/`EtbPage`). Fokus erst, wenn die Stab-Freigabe `frei` ist.

**D7 Guard kennt Stab-Unterseiten.** `modulZuLeserDatei` ordnet eine Datei, deren Basisname
einem Schlüssel aus `stab/unterseiten.ts` entspricht (`InfotelefonPage.tsx` → `infotelefon`),
dem Modul `stab` zu. Die Deckungsprüfung wird schärfer: liegt das Ziel einer Schnellaktion
unter `…/stab/<unterseite>`, MUSS der Leser in der Datei dieser Unterseite stehen, nicht
irgendwo im Stab; umgekehrt deckt eine Unterseite nie ein Ziel auf den Stab selbst
(„Lagebesprechung abschließen“ braucht den Leser in `StabPage.tsx`, `findCoveringFiles`). Verworfen: Leser im `StabPage` als Deckung gelten lassen — die Schnellaktion
liefe ins Leere, ohne dass ein Test rot wird (genau was der Guard verhindern soll).

**D8 Regeln.** `frontend/AGENTS.md` (LFH-620-Absatz): Stab-Unterseiten als Marken, Marken stehen
auch in der Palette (Gruppe „Ansichten“, nur frei). `command-palette/AGENTS.md`: Abschnitt
„Ansichten“ und Satz zur Unterseiten-Zuordnung im Schnellaktionen-Absatz. `stab/AGENTS.md`:
Einstieg nicht mehr „nur in der S6-Zeile“, sondern auch Marke und Palette.

## Risks / Trade-offs

- [Menü wird in „Führung“ fünf Zeilen länger] → Marken sind ruhig gesetzt (kein Zähler), stehen
  nur mit sichtbarem Stab; wer den Stab ausblendet, sieht sie nicht. Bildbeleg im PR.
- [Startansicht der Palette wird länger (bis 9 Ansichten)] → Gruppe steht unter „Module“, nicht
  davor; bei Suche flach nach Rang.
- [LLH-1116 macht S6 zum Modul] → Die S6-Marken werden dann Registry-Einträge, die Palette zeigt
  sie unter „Module“; Ids `ansicht:funkplan` verfallen im Gedächtnis (fallen still heraus, wie
  jede unbekannte Id).
- [Fokus im Infotelefon kollidiert mit Fokusabstand der klebenden Leiste] → derselbe Weg wie
  nach dem Speichern (`anliegenRef.focus()`), Test im Seitentest.

## Migration Plan

Keine Daten, kein Server. Rücknahme = Revert des PRs.
