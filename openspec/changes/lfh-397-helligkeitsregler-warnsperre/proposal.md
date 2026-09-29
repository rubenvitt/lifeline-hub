# Proposal

## Why

Kriterium 8 der Prüfliste Einsatztauglichkeit (LFH-327, Festlegung 7) verlangt einen
**Helligkeits-/Kontrastregler**, der bei aktiver Warnung nicht bis AUS dimmbar ist: „1 Regler,
1 Sperre“ (MIL 5.2.2.1.9, 5.2.4.2.2.3). Die Anwendung hat keinen solchen Regler. Deshalb steht
Zeile 8 in jeder bisher ausgefüllten Prüfliste auf „offen → LFH-397“.

Der Bedarf kommt aus den Einsatzkontexten. Der Fükw ist nachts ein abgedunkelter Raum, dort
blendet selbst die Nachtpalette auf voller Helligkeit. Die ortsfeste Stelle läuft über
Stunden im Dauerbetrieb. Wer dimmt, darf dabei eine anstehende Warnung nicht mitdimmen.
Deshalb gehört zum Regler eine Sperre.

## What Changes

- **Dritte Darstellungsachse „Helligkeit“** neben Farbschema und Bediendichte, im selben
  Träger (`theme/ThemeModeProvider.tsx`). Es gibt fünf Stufen: 100 · 80 · 60 · 40 · 20 %.
  AUS ist keine Stufe. Die Wahl wird gespeichert (`lifeline-hub.helligkeit`). Eine getroffene
  Wahl gewinnt beim Neuladen, ein unbekannter gespeicherter Wert fällt auf 100 %.
- **Die Sperre:** Solange eine aktive Warnung besteht, gilt eine Untergrenze
  (`HELLIGKEIT_BODEN_WARNUNG`, Vorschlag 80 %). Die wirksame Stufe ist dann
  `max(Wahl, Boden)`. Die Wahl selbst bleibt unverändert. Endet die Warnung, gilt wieder die
  Wahl. Die Regel ist eine reine Funktion (`theme/helligkeit.ts`) und wird in beiden Hälften
  getestet.
- **Aktive Warnung** gilt im geöffneten Einsatz. Sie liegt vor, wenn mindestens eines der
  beiden Merkmale zutrifft:
  (a) Ein Gefahrengebiet hat die Warnstufe `hoch` oder `akut`. Das sind genau die Stufen, die
  der Statusvertrag `warnstufeKennzahl` auf `alarm` legt.
  (b) Eine Meldung hat eine überfällige Bestätigungspflicht. Die Regel ist dieselbe wie
  `istAlarmiert` in `meldungen/meldungKennzahlen.ts`.
  Außerhalb eines Einsatzes gibt es keine Warnung und damit keine Sperre.
- **Darstellung:** Eine schwarze Abdunklungsschicht über der ganzen Seite
  (`html::after`, `pointer-events: none`, nur `@media screen`). Die Deckkraft ist
  `1 − Stufe`. Paletten, antd-Tokens und Kontrast-Gates bleiben unberührt. Der Druck wird nie
  abgedunkelt.
- **Früher Aufruf:** Das Bootstrap-Skript in `index.html` setzt die gespeicherte Stufe vor dem
  ersten Bild. So blitzt der Bildschirm im dunklen Fükw beim Laden nicht hell auf.
  `ThemeModeProvider` und `index.html` werden gespiegelt, wie schon beim Farbschema.
- **Bedienwege:** Das Benutzermenü bekommt die Umschaltgruppe „Helligkeit“. Die aktive Stufe
  trägt „✓“ im Text. Während einer Warnung sind die Stufen unter dem Boden gesperrt, und die
  Gruppe sagt warum. Die Sprungpalette bekommt fünf Schnelleinstellungen. Beides folgt dem
  Muster der Bediendichte.
- **Backend:** Der Modulzähler bekommt `meldungen.bestaetigung_ueberfaellig`. Gezählt wird
  aus der Liste, die `zaehler.rs` ohnehin lädt. Die Zahl ist live über das bestehende
  Stream-Ereignis `meldung → modulZaehler`.
- **Doku:** Ein CLAUDE.md-Absatz nennt den Träger. Kriterium 8 kann danach in jeder
  Modul-Prüfliste mit Verweis darauf auf „erfüllt“ stehen. Die Leitlinie unter
  `docs/superpowers/` ist eingefrorenes Archiv und bleibt unverändert.

## Capabilities

### New Capabilities
- `bedien-helligkeit`: Der app-weite Helligkeitsregler mit Warnsperre. Dazu gehören Stufen,
  Speicherung, die Definition „aktive Warnung“, die wirksame Stufe, die Darstellung und die
  Bedienwege.

### Modified Capabilities
- keine

## Impact

- **Frontend:** `theme/ThemeModeProvider.tsx`, neu `theme/helligkeit.ts` (+ Test),
  `theme/rollen.css` (Abdunklungsschicht), `theme/darstellungOptionen.ts`,
  `components/BenutzerMenu.tsx`, `command-palette/befehle.ts`, `typen.ts`, `useBefehle.ts`,
  `einsatz/EinsatzLayout.tsx` (Warnsignal melden), `einsatz/useModulZaehler.ts`,
  `index.html`.
- **Backend:** `src/einsatz/zaehler.rs` (ein Feld, ein Test). Codegen
  (`openapi.json`, `types.generated.ts`). Keine Migration.
- **Abruf:** `EinsatzLayout` liest zusätzlich die Gefahrengebiete
  (`einsatzKeys.gefahrengebiete`, live über `gefahr`/`lage_zone`). Das geschieht nur, wenn das
  Modul erlaubt ist. Seiten, die denselben Key lesen, teilen den Cache.
- **e2e:** Ein Klick durch die Abdunklungsschicht hindurch bei 40 % (LFH-355:
  `toBeVisible()` ist kein Beleg für Klickbarkeit).
