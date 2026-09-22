# LFH-618 — Hellmodus des Neuentwurfs: Sichtprüfung und Nachschärfung

Stand: 22.09.2026, Basis `origin/alpha` `e6f7e967`. Alle Sichtprüfungen des Neuentwurfs
liefen bis dahin im Nachtbetrieb; der Tagmodus war nur gerechnet (`theme/tokens.ts`).

## Vorgehen

Ein temporärer Playwright-Lauf (nicht eingecheckt) säte einen Einsatz mit drei Einheiten
(Fahrzeuge in den Kategorien `verfuegbar`/`gebunden`/`nicht_verfuegbar`, damit eine
Problemzeile entsteht), jedem ETB-Typ samt Berichtigung und Nachtrag, sieben Betroffenen
(alle Sichtungskategorien, mit und ohne Lücken, eine vermisst), zwei Schäden und zwei
Meldungen. Jeder Seed-Aufruf prüfte seinen Status, damit kein leerer Screen als „sieht gut
aus" durchgeht (das hat einen falschen Kategoriewert aufgedeckt, bevor ein Bild entstand).
Fotografiert wurden hell **und** nachts, damit „ist das falsch" am freigegebenen Nachtbild
entschieden wird statt am Geschmack: Anmeldung, Einsatzauswahl, Überblick, Lage-Dashboard,
ETB (auch gefiltert auf Berichtigungen), Lagekarte, Meldebild, Betroffene, Schäden,
Gefahren, Meldungen, Verwaltung, Sprungpalette — bei 1440, 1024 und 390 px.

Vor den Bildern liefen die beiden bestehenden Kontrastspecs in beiden Modi:
`betroffene-kontrast.spec.ts` und `kraefte-kontrast.spec.ts`, 10/10 grün. **Sie waren grün,
weil der Tagmodus ausgewichen ist** — siehe Befund 1.

## Befunde und Verdikte

| # | Befund | Messwert | Verdikt |
|---|---|---|---|
| 1 | Statuszahl und -wort in `achtung`/`alarm` sind am Tag **ungefärbt**: `Kennzahl` und `statusFlaeche` weichen auf `text` aus („es fehlen Rollen `achtungText`/`alarmText`"). Nachts zeigt das Meldebild S3 gelb und S6 rot, am Tag beide schwarz; ebenso „Vermisste", „Unbearbeitet", die Statuszellen der Tabelle. | `achtung` auf `achtungFlaeche` 6,02, `alarm` auf `alarmFlaeche` 5,52 (Boden Tag 7) | erfüllt — Rollen gebaut |
| 2 | An anderen Stellen steht `achtung`/`alarm` am Tag **ungeprüft als Text**: „Verbleib offen" auf der Lückenzeile, Fehlertitel im Paneel, Warnhinweis im Dashboard, überfällige Aufträge, Hinweiszeile der Zeitachse, Stufenwort der Gefahrenmatrix. | `achtung` auf `lueckeZeile` 6,23, `alarm` auf `problemZeile` 5,91 | erfüllt — auf die Textrollen umgestellt |
| 3 | Eine **Hervorhebung auf `flaeche2`** ist am Tag nicht da: aktives Segment, aktive Verwaltungszeile, aktive Modul-/Kanalzeile, Hover von Kennzahl und Tabellenzeile. | `flaeche2` auf `flaeche` 1,08, auf `paneel` 1,01 (nachts 1,05 / 1,09) | erfüllt — Hervorhebung auf `flaeche3` |
| 4 | Platzhalter sind am Tag kaum lesbar — und mehrere Filter (`Trägerorganisation`, `Status`, `Typ`, `Ausmaß`, `Bearbeiter zuweisen`) haben **keine andere Beschriftung**. antd leitet sie aus `colorTextQuaternary` ab. | Tag ≈ 1,9, nachts ≈ 2,3 | erfüllt — `colorTextPlaceholder` auf `schwach` (beide Modi) |
| 5 | Zeilentönungen Berichtigung / Lücke / Problem | Text auf Tönung 15,9 / 16,6 / 16,1; gegen Weiß abgesetzt 1,16 / 1,11 / 1,15 — sichtbar, der zweite Kanal (Typwort, „offen“, Ausfallzahl) trägt | erfüllt |
| 6 | ETB-Typwörter waren nur gegen **Weiß** gerechnet — die Zeitachse steht aber auf `grund`. Die neue Browsermessung wurde rot. | Anordnung 6,30, Lage 5,98, Berichtigung 6,49 auf `grund` | erfüllt — Wörter nachgedunkelt (7,41 / 7,40 / 7,51), Kanten unverändert ≥ 3 |
| 7 | Dunkle Kommandoleiste und Rail auf hellem Grund | Naht sauber, nichts ragt über die Kante; die Sprungpalette hebt sich mit Bedienrahmen ab | erfüllt |
| 8 | `schwach` (Augenbrauen, `colorTextTertiary`) liegt am Tag unter dem Tagesboden der Statuspaare | 5,33 auf `grund`, 5,84 auf `paneel` | offen → LFH-643 (keine Statusfarbe; eine globale Textstufe gehört nicht neben einen Rollen-Fix) |
| 9 | Rail-Etikett „ERFASSUNG" ist in der 60-px-Rail beschnitten (beide Modi) | — | offen → LFH-644 |

## Umsetzung

- `theme/tokens.ts` / `theme/rollen.css`: Rollen `achtungText` (Tag `#604200`) und
  `alarmText` (Tag `#8f1c12`), nachts gleich `achtung`/`alarm`. Sie vervollständigen das
  Muster von `normalText`/`bedienText`. Kontrast Tag: achtungText 9,22 auf Weiß · 8,02 auf
  `achtungFlaeche` · 8,30 auf `lueckeZeile` · 7,72 auf `grund`; alarmText 8,96 · 7,31 auf
  `alarmFlaeche` · 7,82 auf `problemZeile` · 7,71 auf `berichtigungZeile` · 7,51 auf `grund`.
- Die Tagesausweiche in `statusFlaeche` und `Kennzahl` entfällt; beide Modi färben.
- Hervorhebungen lesen `flaeche3`. Nachts ändert das den Ton von `#14171b` auf `#16191d`
  (1,02 : 1 zueinander, nicht wahrnehmbar); am Tag wird aus 1,01–1,08 dann 1,17–1,28.
- `colorTextPlaceholder: schwach` — Tag 6,37 auf Weiß, nachts 5,03 auf `flaeche`.
- ETB-Typwörter am Tag: Anordnung `#7a3700`, Lage `#005357`, Berichtigung = `alarmText`.
- Neue Messung `e2e/hellmodus-kontrast.spec.ts`: alle sechs ETB-Typwörter, der Text der
  Berichtigungszeile und die Lückenmarke der Betroffenen, in beiden Modi. Der Messkern ist
  als reiner Move nach `e2e/kontrast-kern.ts` gewandert. Die Statuszahlen deckt
  `kraefte-kontrast.spec.ts` („Statusband und Verdichtungszeile“) schon ab — sie misst jetzt
  den getönten Wert statt der Ausweiche.
- Mutationsprobe: Lückenmarke zurück auf `achtung` → rot mit 6,23 : 1; die ursprünglichen
  Typwörter → rot mit 6,30 : 1 (Anordnung, erster Treffer).
