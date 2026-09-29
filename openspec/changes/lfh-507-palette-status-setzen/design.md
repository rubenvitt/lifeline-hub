# Design

## Context

Die Palette kennt Seitenaktionen über die Tastatur-Ebenen-Registry
(`command-palette/CommandPaletteProvider.tsx`, `useTastaturEbene`). Jede Ebene hat eine
DOM-Wurzel. Beim `focusin` sammelt der Provider alle Ebenen, deren Wurzel den Fokus enthält,
als Kette von tief nach flach und friert diese Kette beim Öffnen der Palette ein
(`vorPaletteKetteRef`). Ist die eingefrorene Kette leer, weil die Palette etwa über „Suchen“
geöffnet wurde, zeigt die Palette die Aktionen der **flachsten** Ebene mit belegten Aktionen
(`flachsteEbene`, Anzeige-Fallback). Die Callbacks werden erst beim Auslösen aufgelöst.

Den Statuswechsel je Zeile trägt `components/StatusWahl.tsx` (LFH-339): ein antd-`Dropdown` mit
`trigger={['click']}` und `autoFocus`, bisher unkontrolliert. Das Bauteil sitzt in
Kartenzeilen der `Datensicht` (`karte.statusBedienung`) und in Tabellenspalten, die die Seiten
selbst rendern (Fahrzeuge, Personal, Material, Meldebild), außerdem im FMS-Tableau.

Vorbild ist die Aktion „Spalten“ aus LFH-391: ein kontrolliert geöffnetes Dropdown mit
`autoFocus`, das das Fokus-Rennen gegen das schließende Palette-Modal gewinnt (nachgewiesen in
`e2e/command-palette.spec.ts`).

## Goals / Non-Goals

**Goals:**
- Fokuszeile ohne neuen Zustand: Die Fokuszeile ergibt sich allein aus der Fokus-Kette des
  Providers.
- „Status setzen“ öffnet das Menü der Fokuszeile. Eine zweite Darstellung der Statuswerte
  entsteht nicht.
- Der Leerfall ist strukturell abgesichert und nicht nur zufällig über DOM-Tiefen.

**Non-Goals:**
- **„Ansicht wechseln“:** Entscheidung in `CLAUDE.md`, kein Code (siehe proposal.md).
- **Explizite Auswahl** (Roving Tabindex, ↑/↓, Auswahlbalken, Mehrfachauswahl) ist verworfen,
  Entscheidung vom 29.09.2026.
- **Statuswerte als Palettenzeilen** („Status: verfügbar“ …) sind verworfen: Sie verdoppelten
  Farbpunkt, Mandantenfarbe und die Zustände gesperrt/läuft außerhalb des Primitivs.
- **Kennung der Zeile in der Palettenzeile** (etwa „Status setzen · Florian 2“): Dafür müsste
  die Ebenen-Registry neben Callbacks auch Beschriftungen tragen und über die Kette
  verschmelzen. Die Fokuszeile ist beim Öffnen die sichtbar fokussierte Zeile, das Menü öffnet
  an ihr. Das bleibt ein Folgeschritt, falls der Bedarf gemessen wird.
- **FMS-Tableau:** Eine Kachel ist keine Zeile. Ihr einziges Bedienziel ist schon der Auslöser
  selbst (Enter öffnet das Menü).

## Decisions

### D1 — Die Ebene hängt am Primitiv `StatusWahl`, die Wurzel ist die umgebende Zeile

`StatusWahl` meldet über `useTastaturEbene` eine Ebene mit der Aktion `status-setzen` an. Ihre
Wurzel ist die nächste umgebende Zeile: `closest('[data-row-key], [data-lfh="datensicht-karte"]')`
vom Auslöserknopf aus, einmal nach dem Einhängen über eine Callback-Ref aufgelöst und in einer
`RefObject` gehalten. Damit gilt:

- Liegt der Fokus irgendwo in der Zeile (Kennungslink, Statusknopf, Aktionsknopf), liegt die
  Zeilenebene in der Kette. Das ist genau die Fokuszeile.
- Tabellen- und Kartenzweig brauchen keinen eigenen Code in `Datensicht` oder in den Seiten,
  denn die Spalten der Seiten rendern dasselbe Primitiv.
- Außerhalb einer Zeile (FMS-Tableau) bleibt die Wurzel `null` und die Ebene wirkungslos.

*Verworfen:* eine Ebene je `Datensicht` mit einer selbst verfolgten „letzten Fokuszeile“. Sie
bräuchte eigenen Zustand samt Blur-Regeln (das Öffnen der Palette selbst nimmt den Fokus aus der
Liste) und sähe im Tabellenzweig die `statusBedienung` der Seitenspalten nicht. Die Kette des
Providers löst das Einfrieren beim Öffnen bereits.

*Verworfen:* eine Zeilenkomponente mit eigenem Hook in `Datensicht`. Die Tabellenzeilen rendert
antd, die Statuszellen rendern die Seiten.

### D2 — `aktiv` nur bei bedienbarem Auslöser

Die Ebene ist nur aktiv, wenn `darfSchreiben && !gesperrt && !laeuft`. Ohne Schreibrecht gibt
es keinen Auslöser (Lesezweig), und ein gesperrter Knopf nimmt keine Eingabe an. Eine Aktion,
die ein gesperrtes Menü öffnete, wäre wirkungslos.

### D3 — Ebenen „nur mit Fokus“ scheiden aus dem Anzeige-Fallback aus

`registriereTastaturEbene` bzw. `useTastaturEbene` bekommen ein optionales `nurMitFokus: true`.
`fallbackWurzel` liefert für solche Ebenen `null`. Heute wäre eine Zeilenebene meist tiefer als
die Werkzeugzeile und fiele deshalb nicht in den Fallback. Das hinge aber an der DOM-Tiefe. Eine
Seite ohne flachere Ebene mit Aktionen böte sonst „Status setzen“ für eine **beliebige** Zeile
an. Der Leerfall ist die tragende Aussage des Tickets und bekommt deshalb eine eigene Marke.
Wie bei `nichtMerkbar` gilt der Wert `true` statt `boolean`: Die Marke kann nur abziehen.

### D4 — Das Menü wird kontrolliert geöffnet, `autoFocus` bleibt

`StatusWahl` führt `open`/`onOpenChange` selbst (lokaler Zustand). Die Aktion setzt `offen =
true`. Das bestehende `autoFocus` des Dropdowns zieht den Fokus ins Menü, wie bei „Spalten“.
`CommandPalette.fuehreAus` ruft zuerst `schliesse()` und dann die Aktion auf, die Reihenfolge
ist dieselbe wie bei „Spalten“. Die Auswahl eines Werts schließt das Menü (`onClick` am Menü
setzt `offen = false`).

### D5 — `status-setzen` ohne Kürzel, hinten in der Reihenfolge

Der Eintrag in `TASTATUR_AKTIONEN` hat `kuerzel: () => null`, `tastaturAktionFuerEreignis`
bleibt unverändert. Damit kollidiert nichts mit Escape, Strg/⌘+S, Strg/⌘+↵ oder
Strg/⌘+Rücktaste. Die Vorbedingung aus LFH-391 (`null` = kein Tastenweg, der Schlüssel `kuerzel`
fehlt am Befehl) greift unverändert. Die Reihenfolge ist `… 'neue-zeile', 'spalten',
'status-setzen'`, die drei Aktionen mit Tastenweg bleiben vorn.

## Risks / Trade-offs

- [Viele Ebenen: eine je Zeile mit Statuswechsel, bei 300 Fahrzeugen 300 Anmeldungen] →
  Registrierung und `waehleEbene` sind lineare Schleifen über eine `Map` mit `contains()`. Beim
  Einhängen fallen O(n²) `contains()` an, einmalig. Die Revisions-Meldungen der Effekte werden
  von React in einem Commit gebündelt. Stellt sich das als spürbar heraus, meldet sich die Ebene
  lazy beim ersten `focusin` der Zeile an und bleibt dann angemeldet.
- [Fokus-Rennen zwischen schließendem Modal und Dropdown-`autoFocus`] → dieselbe Mechanik wie
  bei „Spalten“, belegt per e2e (`fokusImOffenenMenue`). Für „Status setzen“ kommt ein eigener
  e2e-Fall dazu.
- [antd lässt das Portal geschlossener Dropdowns im Baum] → Tests prüfen das sichtbare Overlay
  über `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` (CLAUDE.md, LFH-365).
- [Der Selektor `[data-row-key]` greift auch in `KatalogTabelle`-Tabellen ohne `Datensicht`]
  → gewollt: Eine Tabellenzeile ist eine Zeile. Heute rendert dort kein `StatusWahl`.
- [Eine Tabellenzeile wird neu gerendert, der Knopf bleibt aber, sodass die Callback-Ref die
  Zeile nicht neu auflöst] → antd hält das `tr` je `rowKey` stabil. Wird die Zeile ersetzt,
  hängt auch der Knopf neu ein, und die Callback-Ref läuft erneut.

## Migration Plan

Rein clientseitig, kein Datenmodell. Ein Rückbau entfernt die Ebene aus `StatusWahl` und die Id
aus dem Verzeichnis.
