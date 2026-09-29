# Proposal

## Why

LFH-645 hat der Sprungpalette die Lese-Vorschau (→) gegeben. Angebunden ist sie aber nur an
Personen. Für die übrigen elf Datensatzsorten ist → wirkungslos, und diese Zeilen tragen
keine →-Marke. Wer im Einsatz „was steht in Meldung 42?“ fragt, muss deshalb die Palette
verlassen, auf die Fachseite springen und dort suchen. Die Vorschau spart genau diesen Weg,
und die Mechanik dafür steht schon.

## What Changes

- Für jede übrige Datensatzsorte entsteht ein Lese-Bauteil: ETB-Eintrag, Meldung, Fahrzeug,
  Auftrag, Personal, Einheit, Schaden, Unfallhilfsstelle, Lagebericht, Gefahrengebiet,
  Einsatzabschnitt. Wo eine Fachseite den Lese-Inhalt schon trägt, wird er herausgelöst und
  von Seite und Vorschau gemeinsam genutzt. So wird er nicht kopiert.
- `VorschauZiel` (`command-palette/typen.ts`) wird um elf Sorten erweitert.
  `command-palette/Vorschau.tsx` bekommt je Sorte einen Zweig, der `never`-Zweig bleibt.
- Die Quellentabelle in `command-palette/datensaetze.ts` nennt je Quelle ihr Vorschauziel
  neben Beschriftung und Sprungziel. `befehlFuer` reicht es nur noch durch.
- Die Vorschau-Bauteile lesen dasselbe Cache-Fach wie die Palette, mit derselben
  Abruffunktion und derselben Frische. Ein zweites Fach und ein zusätzlicher Abruf entstehen
  dadurch nicht.
- Ist der gezeigte Datensatz nicht mehr in seiner Quelle, etwa weil er gelöscht oder
  storniert wurde oder ein ETB-Eintrag eine andere Nummer trägt, sagt die Vorschau das
  ausdrücklich. Sie bleibt nicht leer.
- Ein Verweis in der Vorschau (etwa „↗ Auftrag“ an einer Meldung) schließt die Palette beim
  Folgen. Sonst navigierte die App unter der offenen Palette weg.
- Der Guard in `datensaetze.test.ts` „nur die Person trägt eine Vorschau“ wird positiv
  umgestellt: jede Datensatzquelle trägt eine Vorschau mit der richtigen Sorte und id. Der
  ETB-Sammeltreffer und der Koordinatensprung tragen keine.
- Eine Einsatztauglichkeits-Prüfliste für die neuen Vorschauen wird angelegt.

## Capabilities

### New Capabilities

Keine. Die Fähigkeit `sprungpalette` bringt LFH-645 (`openspec/changes/lfh-645-palette-vorschau-neuer-tab/`)
mit. Sie ist noch nicht nach `openspec/specs/` übernommen.

### Modified Capabilities

- `sprungpalette`: Neue Anforderung „Jede Datensatzsorte hat eine Vorschau“ mit
  Datenregel (gleiches Cache-Fach), Zustand „nicht mehr vorhanden“ und Verweisen, die die
  Palette schließen. Die Anforderungen aus LFH-645 zu Taste, Rückweg und Fußzeile gelten
  unverändert für alle Sorten.

## Impact

- **Frontend, Palette:** `command-palette/typen.ts`, `Vorschau.tsx`, `datensaetze.ts`,
  `useDatensaetze.ts` (Abrufoptionen werden exportiert und geteilt), `CommandPalette.tsx`
  (Verweis-Klick in der Vorschau-Region schließt die Palette).
- **Frontend, Fachmodule:** neue Lese-Bauteile unter `etb/`, `meldungen/`, `auftraege/`,
  `kraefte/`, `lageberichte/`, `pages/schaeden/`, `pages/uhs/`, `pages/gefahren/` und
  `pages/einsatzabschnitte/`.
  Aus `SchaedenDetailPage`, `LageberichtDetailPage` und `EinsatzabschnittePage` wird der
  Lese-Inhalt herausgelöst, die Seiten nutzen danach das Bauteil. `statusDarstellung` von
  Fahrzeug und Personal zieht aus den Seiten nach `kraefte/`.
- **Backend:** keine Änderung. Kein neuer Endpunkt, kein Einzel-GET.
- **Tests:** Vitest je Bauteil (Inhalt, Ladefehler, „nicht mehr vorhanden“), Guard in
  `datensaetze.test.ts`, Palettentest für den Verweis-Klick, ein e2e-Fall für eine
  Nicht-Personen-Vorschau.
- **Doku:** Prüfliste unter `docs/superpowers/specs/` nach dem Muster von LFH-645, dazu ein
  Satz in CLAUDE.md (Sprungpalette) zur Datenregel der Vorschau.
