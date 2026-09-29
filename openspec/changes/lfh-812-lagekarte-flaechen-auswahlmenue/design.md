# Design

## Context

Motivation: siehe `proposal.md`. Stand nach LFH-764 (`openspec/changes/lfh-764-lagekarte-griffe-klickwege/design.md`, D4):

- `entscheideKlickziel(merkmale, punkt, projiziere)` in `pages/lagekarte/klickziel.ts` ist rein und
  liefert genau einen Gewinner. Im Flächenzweig nimmt er das erste Merkmal aus
  `queryRenderedFeatures` (oben zuerst), das eine Fläche ist (`zone`, `abschnitt`, `fachebeneFlaeche`).
- `klickzielAm(map, e)` in `Kartenflaeche.tsx` fragt einmal je Tipp über alle Klickebenen und cacht das
  Urteil in einer `WeakMap` am `originalEvent`. Die Hörer für Abschnitt, Zone (drei Ebenen), Fachebenen
  (je Ebene), Marker und der globale Hörer für Personen-Cluster/Spider handeln nur als Gewinner.
- `queryRenderedFeatures` meldet eine Zone über `zonen-fill` **und** `zonen-line`, und ein Polygon an
  einer Kachelgrenze mehrfach. Fachebenen-Merkmale tragen oft keine Feature-`id`.
- Zonen-Merkmale tragen `id` und `label` (ggf. leer), aber keinen Typ (`baueZonenFc`). Die
  Typbezeichnung steht in `ZONE_TYPEN` (`zonenStil.ts`). Abschnitte tragen `id` und `label`.
- Die Titelableitung einer Fachebenen-Meldung steckt in `FachebenenInspector.tsx` (~Z. 688:
  DWD-Ereignis mit Wetter-Emoji, NINA „Amtliche Warnung", sonst `titel`/`name`, Rückfall Ebenenname).
- Die Sperre im exklusiven Modus liegt heute in den Callbacks (`useKartenInteraktion`,
  `exklusiverModusAktiv = modus.art !== 'idle'`, deckt Platzieren, Abschnitt, Zone, Bild, Zeichen,
  Messen). `Kartenflaeche` kennt sie nicht.
- `escGehoertOverlay` (`zeichnenEsc.ts`) erkennt ein offenes `.ant-dropdown` und `[role="menu"]`.

## Goals / Non-Goals

**Goals:**
- Mehrdeutigkeit wird im reinen Schiedsrichter entschieden und dort per Vitest belegt, einschließlich
  Entdoppelung.
- Das Menü ist ein eigenes, in jsdom prüfbares Bauteil; die Karte liefert nur Punkt und Einträge.
- Die Wahl läuft über dieselben Callbacks wie der direkte Tipp, damit Inspector-Verhalten und
  Rechte-/Modussperren nicht doppelt entstehen.

**Non-Goals:**
- Punktziele, Trefferzonen, Personen-Cluster, Spider und KRITIS-Bündel: Rangfolge unverändert.
- Mauszeiger über Flächen, Hover-Hervorhebung der Menüeinträge auf der Karte (keine Vorschau der
  Fläche beim Durchgehen des Menüs — mögliches Folgeticket).
- Kräfte-Cluster als DOM-Donut (laufen nicht über die Karten-Klickhörer).

## Decisions

### D1 — Schiedsrichter meldet `mehrdeutig` erst nach dem Entdoppeln

`Klickziel` erhält die Variante `{ art: 'mehrdeutig'; flaechen: Flaechenziel<F>[] }` mit
`Flaechenziel<F> = { art: 'zone' | 'abschnitt' | 'fachebene'; merkmal: F }`. Der Flächenzweig
sammelt alle Flächenmerkmale, entdoppelt über einen Schlüssel und zählt danach:

- Schlüssel: Zone `zone:<properties.id>`, Abschnitt `abschnitt:<properties.id>`, Fachebene
  `<layer.id>:<feature.id>`, ohne Feature-`id` `<layer.id>:<JSON.stringify(properties)>`
  (die Properties einer Meldung sind über Kachelgrenzen gleich; zwei verschiedene Meldungen mit
  identischen Properties wären ununterscheidbar und dürfen zusammenfallen).
- Genau eine Fläche → wie bisher `zone` / `abschnitt` / `fachebene`. Zwei oder mehr → `mehrdeutig`.
- Reihenfolge: eigene (Zone, Abschnitt) vor Fachebenen, innerhalb jeder Gruppe die Reihenfolge aus
  `queryRenderedFeatures` (erstes Auftreten des Schlüssels).
- *Warum nicht zählen vor dem Entdoppeln:* eine einzelne Zone öffnete sonst am Rand (Füllung + Linie)
  ein Menü mit zweimal derselben Zone.
- *Warum Fachebenen hinten statt reiner Zeichenreihenfolge:* Vorgabe des Tickets („eigene zuerst");
  die eigenen Flächen sind die, die der Stab bearbeitet.

### D2 — Ein Hörer auf Kartenebene öffnet das Menü

Die Flächen-Hörer (Abschnitt, Zone, Fachebene) handeln bei `mehrdeutig` nicht, weil keiner der
Gewinner ist — das folgt schon aus ihren bestehenden `art`-Prüfungen. Ein neuer globaler
`map.on('click')`-Hörer in `Kartenflaeche` öffnet bei `mehrdeutig` das Menü mit Punkt (`e.point`),
Ort (`e.lngLat`) und Einträgen. Neue Prop `flaechenwahl?: boolean` (Vorgabe `false`), die
`LagekartePage` mit `!exklusiverModusAktiv` setzt; ist sie aus, tut der Hörer nichts. Über einen Ref
gelesen, damit ein Moduswechsel die Hörer nicht neu bindet.

*Verworfen:* die Mehrdeutigkeit an `onKarteKlick` hängen. Der gilt nur in exklusiven Modi und ist
genau dort der alleinige Empfänger.

### D3 — Menü: antd-`Dropdown` an einem Punktanker, Portal, gesteuert

Neues Bauteil `pages/lagekarte/FlaechenwahlMenue.tsx`: ein unsichtbarer 1×1-Anker, absolut an
`{x, y}` im Kartencontainer, darum ein antd-`Dropdown` mit `open` gesteuert, `trigger={['click']}`,
`autoFocus`, `menu={{ items, onClick }}` (Leitlinie „Datensatz-Aktionen", Muster `StatusWahl`), Portal
nach `body` (antd-Vorgabe). Pfeile/Enter/Esc bringt antds Menü mit.

- **Schließen:** Wahl, Esc und Außenklick über `onOpenChange(false)`; `movestart` der Karte
  (wie beim Spider) und der Beginn eines exklusiven Modus nehmen die Wahl von außen weg. Jeder
  Weg gibt den Fokus an den Canvas zurück (`preventScroll`); beim Wegnehmen von außen nur, wenn
  er noch im Menü oder auf `body` steht (Review: sonst fiel er mit dem Eintrag auf `body`).
- **Dichte:** antds Menüeinträge folgen `controlHeight` nicht. Jeder Eintrag bekommt `style` aus der
  reinen Funktion `flaechenwahlEintragStil(token)` (`minHeight: token.controlHeight`, Innenabstand aus
  `token.paddingSM`), geprüft mit Böden als Literalen (30/48/72) wie `bedienzielStil`.
- **Zugänglicher Name:** Menü `aria-label="Fläche wählen"`; Einträge tragen die Kennung aus D4 als
  Text, keine Emoji.
- **Esc:** `escGehoertOverlay` greift über `.ant-dropdown:not(.ant-dropdown-hidden)` und
  `[role="menu"]`; der Zeichnen-Esc läuft ohnehin nur im exklusiven Modus, in dem kein Menü aufgeht.
  Belegt wird es trotzdem (Vitest am Riegel mit offenem Menü).
- *Verworfen:* eigenes Popover mit Listbox — doppelter Tastaturvertrag; `Popover` ist für
  Aktionsmenüs laut Leitlinie gesperrt.
- *Risiko Außenklick:* Der öffnende Tipp darf das Menü nicht sofort als Außenklick schließen. Das
  Öffnen geschieht im `click`, antds Außenklick hört auf `mousedown`/`touchstart` des nächsten
  Tipps; belegt im e2e mit echtem Touch-Tipp und anschließendem Klick auf einen Eintrag.

### D4 — Kennung der Einträge als reine Funktion

`flaechenKennung(ziel, kontext)` in `pages/lagekarte/flaechenwahl.ts` → `{ titel, art }`:

- Zone: `art` = Typbezeichnung aus `ZONE_TYPEN` (neue Merkmals-Eigenschaft `typ`, eingetragen in
  `ZoneFeature` und `baueZonenFc`), `titel` = `label`, leer → Typbezeichnung. Evakuierungsbezirke
  und Gefahrengebiete bekommen ihre Typbezeichnung wie jede Zone.
- Abschnitt: `art` = „Abschnitt", `titel` = `label`.
- Fachebene: `art` = `FACHEBENEN[quelle].label`, `titel` = Titel der Meldung aus
  `fachebeneTitel(quelle, props)`, fehlt er → Ebenenname allein. `fachebeneTitel` wird aus
  `FachebenenInspector.tsx` als reine Funktion herausgezogen **ohne** Wetter-Emoji; der Inspector
  setzt sein Zeichen weiterhin selbst davor (keine Verhaltensänderung dort, bestehende Tests grün).
- Keine DB-`id` im Text. Gleichnamige Einträge bleiben möglich (zwei Zonen „Nord") — die Art
  unterscheidet oft, sonst die Reihenfolge; hingenommen.

### D5 — Wahl über die bestehenden Callbacks

`onWaehlen(flaechenziel)` in `Kartenflaeche`: Zone → `onZoneKlick(id)`, Abschnitt →
`onFlaecheKlick(id)`, Fachebene → Quelle aus der Layer-ID (`fachebene-<key>-fill`), `fe` aus
`fachebenenRef`, dann `onFachebeneKlick(...werteFachebenenKlickAus(merkmal, lngLat, fe.daten))` —
dieselbe Auswertung wie im Fachebenen-Hörer, dafür in eine gemeinsame Hilfsfunktion gezogen. Die
Modussperre der Callbacks bleibt die zweite Linie.

### D6 — Spec-Abhängigkeit zu LFH-764

`lagekarte-klickziele` existiert erst nach dem Archivieren von LFH-764. Das Delta hier ist ein
`MODIFIED` auf dessen Anforderung „Rangfolge der Klickziele" (vollständiger Block, Szenario „Zwei
Flächen übereinander" umgeschrieben) plus eine neue Anforderung. **Reihenfolge:** LFH-764 mergen und
archivieren, dann LFH-812. Bis dahin prüft `openspec validate` das Delta nur strukturell.
`klickziel.test.ts` aus LFH-764 („oberste Fläche gewinnt") wird umgeschrieben, nicht gelöscht.

### D7 — Nachweise

- Vitest `klickziel.test.ts`: zwei Flächen → `mehrdeutig` mit Reihenfolge eigene vor Fachebene;
  Zone über Füllung + Linie → direkt `zone`; zwei Kachel-Duplikate einer Fachebenen-Meldung ohne `id`
  → direkt; Trefferzone und Punktziel schlagen weiterhin mehrere Flächen.
- Vitest `flaechenwahl.test.ts`: Kennung je Art, Rückfall auf Typ, Fachebene mit und ohne Titel, kein
  Emoji; `flaechenwahlEintragStil` mit Böden 30/48/72.
- Vitest `FlaechenwahlMenue.test.tsx`: Einträge in Reihenfolge, Pfeil+Enter wählt den zweiten, Esc
  schließt ohne Wahl, Fokus zurück an das übergebene Ziel; `escGehoertOverlay` bei offenem Menü `true`.
- Vitest `fachebeneTitel` (herausgezogen) plus bestehende `FachebenenInspector`-Tests unverändert grün.
- e2e `lagekarte-touch.spec.ts` (Touch, 1024 px): Zone und Abschnitt per API überlappend anlegen,
  Tipp in die Überschneidung → Menü mit beiden, Abschnitt tippen → Abschnitts-Inspector. DWD per
  `page.route` mit einer Warnfläche über der Zone stubben, Ebene einschalten → Menü Zone vor Warnung,
  Warnung tippen → Fachebenen-Detail. Marker in der Zone, Tipp in seinen Ring → Marker-Inspector,
  kein Menü. Trefferwache per `elementFromPoint` wie in LFH-764. **Mutationsprobe:** `mehrdeutig`-Zweig
  im Schiedsrichter aus (oberste Fläche zurück) → der Menü-Test wird rot; Ergebnis im Commit bzw. in
  der Prüfliste festgehalten.
- Gate 3: Menüeinträge im Handschuh-Modus ≥ 72 px, im e2e an der Bounding-Box gemessen.
- Prüfliste Einsatztauglichkeit: `docs/superpowers/specs/2026-09-29-lfh-812-pruefliste.md` nach dem
  Muster von LFH-712 (15 Kriterien, je Verdikt).

## Risks / Trade-offs

- [Mehr Tipps bis zum Ziel bei Flächen] → gewollt; nur bei echter Überlagerung, eine einzelne Fläche
  bleibt ein Tipp.
- [Menü verdeckt die Karte am Tipppunkt] → schließt bei jeder Kartenbewegung und jedem Außenklick.
- [Außenklick-Rennen beim öffnenden Tipp] → e2e mit echtem Touch-Tipp (D3).
- [Fachebenen-Entdoppelung über Properties] → zwei identisch beschriebene Meldungen fallen zusammen;
  ohne Unterschied in den Daten ist das für den Menschen ohnehin dieselbe Wahl.
- [LFH-764 ändert sich noch im Review] → Branch per `rebase --onto` nachziehen; PR gegen `alpha` erst
  nach dessen Merge.
- [Unbekannte neue Flächenebene] → `ordneKlickebene` liefert `null`, sie erscheint nie im Menü; der
  Guard aus LFH-764 (jede Klickebene eingeordnet) deckt das ab.

## Migration Plan

Reines Frontend, kein Datenmodell. Rückweg: Revert des Branches; der Schiedsrichter fällt dann auf
„oberste Fläche" zurück.
