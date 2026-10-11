# Design

## Context

Siehe proposal.md für das Warum. Der Stand heute stammt aus dem Scope-Lauf vom 10.10.2026
(Kommentar an LFH-836, Anhang `lfh-836-abgleich-2026-10-10.tar.gz`).

- **Speicherung:** Freie Zeichen liegen in `freies_zeichen` (Migrationen 0085, 0094) mit den
  Altspalten `grundzeichen` (NOT NULL), `organisation`, `fachaufgabe`, `symbol`, `einheit`,
  `funktion` und `farbe` (freie Hexfarbe). Bezeichnung, Ansicht und Koordinate stehen in eigenen
  Spalten. Es gibt keine CHECKs. Der einzige 400er ist `grundzeichen_pflicht`. Der PATCH ist ein
  Tri-State mit einer nummerierten CASE-Kette (`repo.rs`).
- **Weitere Ablageorte:** Lage-Snapshots frieren `FreiesZeichenAnzeige` als JSON ein, also für
  immer im Altformat. Der Offline-Stand hängt am Query-Key `einsatz-freie-zeichen` mit dem
  Puffer `__APP_VERSION__`. „Zuletzt verwendet“ liegt in localStorage unter
  `lfh:lagekarte:zeichen-zuletzt`.
- **Darstellung:** `taktischesZeichen.ts` liefert `TzProps` und die ID-Typen des Altpakets. Diese
  Typen nutzen auch Fachobjekte, Skizze und Tests. `marker.ts:baueFreiesZeichenTz` filtert per
  `accepts`, und der `tz|`-Weg im Resolver zeichnet asynchron. Fachobjekte laufen bereits über
  `zeichen/fachobjektZeichen.ts` mit Kaskade, Cache und `ez|`-Schlüssel (LFH-835, D1–D7).
- **Bibliothek 5.2.0:**
  - `AnySpec` = `SymbolSpec` | freistehend (`movement`, `line`, `weather`, `animal-state`,
    neu `state`, `pictogram`).
  - Codec `serializeAnySpec`/`parseAnySpec` im Format `{"v":1}`.
  - `vocabulary()`, neu `freestandingVocabulary()` und `freestandingRedirect()`.
  - `drawAnySpec`/`checkAnySpec`.
  - Feste Palette `PALETTE` mit `TECHNICAL_FILL_TOKENS`.
  - Deutsche Namen für Organisationen und Stärken (`ORGANIZATION_LABELS`, `STRENGTH_LABELS`)
    sowie Piktogrammtitel. Für `SymbolKind` gibt es keine Namen.
- **Abgleich der 84 Alt-Symbole:** 67 haben eine Einzelzeichnung. Mit 5.2 sind 49 weitere
  freistehend zeichenbar: 19 als `state`, 11 J-Zeichen und 28 Kapitel-4-Fähigkeiten als
  `pictogram`, abzüglich Überschneidungen. Ohne Nachfolger bleiben Geräte, Sichten,
  Fernschreiben (Draht/Funk) und Festbildübertragung (Draht/Funk).

## Goals / Non-Goals

**Goals:**
- Eine gespeicherte Form für neue freie Zeichen (`zeichen_spec`), eine Übersetzung für den
  Altbestand und ein Renderweg (`ez|`) für alle Zeichen des Hubs.
- Kein Bruch für veraltete Clients während der Übergangszeit.
- Altpaket vollständig entfernt, Lagekarten-Chunk nicht größer.

**Non-Goals:**
- Kein Backfill der Altspalten und kein Löschen der Altspalten. Beides ist ein eigener Task,
  wenn der Übergang endet.
- Keine Pfeile und Linien als freie Zeichen. Sie brauchen einen Verlauf und gehören zum
  Zeichnen (`lagekarte-zeichnen`).
- Fachobjekt-Abbildungen bleiben wie in LFH-835. Ob UHS/Betreuung weiter fest auf
  `hilfsorganisation` stehen und ob Führungskräfte eine abgeleitete Fachaufgabe zeigen, wird
  eigener Task (LFH-829/LFH-830 sind in der Bibliothek erledigt).
- Kein Dunkelmodus-Umbau der Zeichen (LFH-833).

## Decisions

### D1 Neue Spalte mit kanonischer Spec statt Hub-Vokabular

`freies_zeichen.zeichen_spec TEXT NULL` trägt `serializeAnySpec(spec)`. Neue und geänderte
Zeichen schreiben nur diese Spalte; die Altspalten bleiben NULL.

*Warum:* Freie Zeichen komponiert der Nutzer frei aus jeder Achse der Bibliothek. Ein
Hub-Vokabular müsste jede Achse spiegeln und mit jeder Bibliotheksversion nachziehen. Bei den
Fachobjekten entscheidet dagegen der Hub selbst die Abbildung, deshalb war dort ein Leseadapter
richtig (LFH-835, D1). Diese Abweichung von D1 ist bewusst. Die kanonische Form ist stabil
(`v` bleibt bei additiven Änderungen 1) und dient zugleich als Bildschlüssel.

*Verworfen:*
- Altspalten weiterführen und um neue Spalten je Achse ergänzen: viele Spalten, und die Regeln
  zur Kombinierbarkeit lägen doppelt.
- Eigenes JSON ohne den Codec der Bibliothek: keine Kanonik und kein Prüfer.

### D2 Migration: Spalte anhängen, Altspalten per Tabellen-Rebuild nullable

Die Migration hat die nächste freie Nummer auf `alpha`, heute 0172 (vorher
`scripts/check-migrationen.sh`). Sie baut `freies_zeichen` neu auf:
- `grundzeichen` wird nullable, `zeichen_spec TEXT` kommt neu dazu.
- Ein `CHECK` verlangt genau eine Form: `(zeichen_spec IS NULL) <> (grundzeichen IS NULL)`.
- Fremdschlüssel (`einsatz` CASCADE, `karten_ansicht` SET NULL, `benutzer`), Index und alle
  Daten bleiben erhalten.
- Präzedenz für den Rebuild ist 0082.

*Verworfen:* einen Platzhalterwert in `grundzeichen` schreiben. Das wäre ein Wert ohne Bedeutung,
und jeder Leser bräuchte eine Sonderregel.

### D3 Server prüft Form und Wertezugehörigkeit gegen eine erzeugte Werteliste

Das Rust-Backend kennt die Bibliothek nicht. Ein Skript im Frontend erzeugt aus
`@einsatzzeichen` die Datei `src/freies_zeichen/zeichen_werte.json`. Sie enthält die Arten, je
Art die erlaubten Felder und je Feld die Wertemengen (`SPEC_FIELD_VALUES`,
`FREESTANDING_FIELD_VALUES`, `PICTOGRAM_IDS`).

- Ein Vitest-Wächter vergleicht die eingecheckte Datei mit der installierten Bibliothek. Damit
  wird ein Bibliotheksupgrade ohne Neuerzeugung rot.
- Rust bindet die Datei per `include_str!` ein und prüft:
  - JSON lesbar, `v == 1`, genau eines von `spec`/`freestanding`;
  - bekannte `kind`, nur Felder dieser Art, Werte aus der Menge;
  - Listenfelder ohne Dubletten, Längengrenze `ZEICHEN_SPEC_MAX`;
  - kein `designation` und kein `labels`; die Bezeichnung bleibt in `label`.
- Ein Verstoß ergibt 400 nach `src/AGENTS.md`, Statuscode-Konvention. Die Spalte wird
  unverändert gespeichert, wie der Client sie gesendet hat. Kanonisieren ist Sache des Clients.
- Ob sich eine gültige Spec zeichnen lässt, prüft nur der Client. Was nicht zeichnet, fällt beim
  Lesen in die Kaskade (D5).
- Pfade (`movement`, `line`) prüft der Server nur der Form nach. Der Picker bietet sie nicht an.

*Verworfen:*
- Nur die Struktur prüfen: das ließe Müllwerte in die DB.
- Komponierbarkeit am Server prüfen: das ginge nur mit einer JS-Laufzeit im Backend.

### D4 Übergang: zwei Bodies, genau einer

`AnlegenBody` und `PatchBody` nehmen zusätzlich `zeichen_spec` an.

- **Neuer Body:** trägt `zeichen_spec`. Der Server setzt die Altspalten auf NULL.
- **Alter Body:** trägt `grundzeichen` und Overlays. Der Server schreibt die Altspalten wie
  bisher und setzt `zeichen_spec` auf NULL.
- **Beides oder keines** beim Anlegen ergibt 400. Beim PATCH ohne Zeichenfelder (nur Bezeichnung,
  Koordinate oder Ansicht) bleibt die gespeicherte Form unberührt.
- **DTO `FreiesZeichenAnzeige`:** gibt beide Formen aus (`zeichen_spec` und die Altfelder, je
  nach Zeile). Damit funktionieren alte Clients mit neuen Zeilen nur eingeschränkt: Sie sehen ein
  Zeichen ohne Grundzeichen. Das wird als Risiko angenommen, siehe unten.
- **Testnamen:** Die Statuscode-Referenztests in `tests/freies_zeichen.rs` werden bewusst
  umbenannt, und `src/AGENTS.md` wird nachgezogen.
- **Generierte Typen:** `scripts/check-typ-codegen.sh` läuft mit.

*Verworfen:* ein harter Schnitt, bei dem der alte Body sofort 400 bekommt. Veraltete PWA-Stände
(`registerType: 'prompt'`) und die Tauri-Hülle senden nach dem Release noch tagelang das alte
Format.

### D5 Ein Leseadapter für freie Zeichen, Muster LFH-835

Neu ist `zeichen/freiesZeichen.ts` mit `freiesZeichen(eingabe)`. Rückgabe ist
`{ spec, drawing, schluessel, vereinfacht }`, wie bei `fachobjektZeichen` mit Cache nach
Eingabeschlüssel.

1. **Ist `zeichen_spec` gesetzt:** `parseAnySpec`, dann `drawAnySpec`. Lehnt die Bibliothek ab,
   zum Beispiel nach einem Upgrade mit einer neuen Sperrregel, greift die Kaskade über die
   Felder der Spec.
2. **Sonst die Altspalten:** Sie werden über Abbildungstabellen übersetzt.
   - Wiederverwendet aus `fachobjektZeichen.ts`: Körper, Organisations-Alias, Stärke,
     Fachaufgaben.
   - Neu ist die Symboltabelle, Grundlage `mapping.mjs` aus dem Abgleich.
   - Mehrdeutige Symbole werden bildtreu übersetzt, also so, wie das Altpaket sie gezeichnet hat
     (abc → 4.1.1, sammelplatz-betroffene → F.3.12).
   - Freistehende Alt-Symbole werden zu `state`, `pictogram` oder `animal-state`. Für
     Personenzustände gilt `{ kind: 'person', states }` nach `freestandingRedirect`.
   - Alt-Funktionen (`fuehrungskraft`, `sonderfunktion`) haben keinen Nachfolger und entfallen.
3. **Kaskade:** Symbol → Fachaufgabe → Einheitsgröße → Organisation → Farbe → Körper (Spec
   `lagekarte-taktische-zeichen`). Jeder Versuch steht in `try/catch`.
4. **Platzhalter:** Zeichnet nichts, wird das Grundzeichen „Punkt“ (`{ kind: 'point' }`)
   verwendet, mit `vereinfacht: true`. Der Inspector nennt dann die Alt-Kennung.

Derselbe Adapter bedient DB-Zeilen, Snapshots (`snapshotDaten.ts`), den Offline-Stand und
„zuletzt verwendet“. Ein Backfill per SQL ist nicht möglich, weil der Übersetzer in TypeScript
steht. Er ist auch unnötig, weil Snapshots ohnehin im Altformat bleiben.

Näherungen bis zu den Bibliothekstasks:
- Befehlsstelle → `formation` mit `fuehrung-leitung` (LFH-1293).
- Behälter-Familie → `trailer` bzw. `swap-loader-vehicle` ohne Aufbau (LFH-831).
- Zweirad, Krad, Fahrrad → `vehicle-land` (LFH-1298).
- Stelle → `circle-12`.
- Grundzeichen im Grundzeichen fällt per Kaskade weg (Entscheidung der Bibliothek vom
  10.10.2026, Punkt 5).

### D6 Farbe: feste Palette, Alt-Hex auf das nächste Token

Der Picker bietet die Farbe nur an, wo `vocabulary(spec, 'technicalFill')` Werte erlaubt. Die
Auswahl kommt aus `TECHNICAL_FILL_TOKENS` und zeigt die Farben aus `PALETTE`.

Eine Alt-Hexfarbe wird auf das Token mit dem kleinsten Abstand im RGB-Raum abgebildet. Bei
Gleichstand gewinnt die Reihenfolge in `TECHNICAL_FILL_TOKENS`. Erlaubt das Zeichen keine
Füllung, entfällt die Farbe.

Die Kachel im Inspector (Spec `lagekarte-taktische-zeichen`) zeigt das gezeichnete Zeichen über
`EinsatzZeichen`. Der Rahmen trägt das Token, ohne Füllung eine Textrolle.

*Verworfen:* die freie Hexfarbe neben der Spec behalten. Die Bibliothek kennt nur Tokens, und
eine zweite Farbquelle widerspräche „eine Spec je Bild“.

### D7 Picker aus dem Vokabular

- **Raster „Grundzeichen“:**
  - Die `SymbolKind`s, die `vocabulary(draft, 'kind')` erlaubt. Die deutschen Namen der 19 Arten
    stehen in einer kleinen Hub-Tabelle, weil die Bibliothek für Arten keine Namen führt.
  - Dazu die Kachel „Kein Grundzeichen“.
- **Raster „Symbol“:**
  - **Mit Grundzeichen:** Fähigkeiten in der Boxfassung (`capabilities`) und Zustände
    (`states`), soweit das Vokabular sie am Körper erlaubt, dazu „Kein Symbol“.
  - **Ohne Grundzeichen:** die Werte von `state`, `pictogram` und `animal-state`, die
    `freestandingVocabulary` erlaubt.
  - Namen kommen aus den Piktogrammtiteln.
- **„Details“:**
  - Organisation (`ORGANIZATION_LABELS`).
  - Fachaufgabe als `bodyMarks`, randbündig wie bei den Fachobjekten.
  - Einheit als `strength` bzw. `unitGrouping`.
  - Farbe nach D6, dazu die Bezeichnung.
  - Die Achse „Funktion“ entfällt.
- **Kacheln:**
  - Gezeichnet über `EinsatzZeichen` mit eigenem `idPrefix` (LFH-835, D6).
  - `vocabulary()` zeichnet jeden Kandidaten probeweise. Die Optionen werden deshalb je
    Entwurfsstand gemerkt (`useMemo`).
  - Die Kosten werden in einem Test gemessen.
- **Grundzeichenwechsel:** Der Wechsel verwirft Felder, die das Vokabular für die neue Art
  ablehnt. Das Verhalten bleibt wie bisher.
- **Unverändert:** Tastatur, Suche, Enter und das entprellte Schreiben im Inspector.

### D8 Karte: ein Renderweg

- `markerIconKey` gibt für freie Zeichen `freiesZeichen(...).schluessel` zurück (`ez|…`).
  Gleiche Spec heißt gleicher Schlüssel, auch über Fachobjekte hinweg.
- `kartenbildResolver` verliert den `tz|`-Zweig. `zeichenDichte` rastert `ez|` bei einem Wechsel
  der Pixeldichte schon neu.
- `baueFreiesZeichenTz`, `tzIconKey`, `grundzeichenAkzeptiert` und `erzeugeTaktischesZeichen`
  entfallen.
- Der tote Zweig für freie Zeichen in `Inspector.tsx:markerBildUrl` entfällt ebenfalls.

### D9 Altpaket entfernen, Typen lokal

- Die ID-Unions aus `TzProps` (`GrundzeichenId`, `OrganisationId` …) stehen danach als lokale
  String-Unions in `taktischesZeichen.ts`, nur mit den Werten, die der Hub für Fachobjekte
  vergibt. Die Alt-Kennungen der freien Zeichen tippt der Leseadapter als `string`, denn sie sind
  Eingabe.
- `taktische-zeichen-react` und `taktische-zeichen-core` fallen aus `package.json` und dem
  Lockfile. Ein Grep-Nachweis zeigt, dass kein Import bleibt.
- Die Bundle-Größe des Lagekarten-Chunks und der Precache werden vor und nach dem Umbau gemessen.

### D10 „Zuletzt verwendet“ unter neuem Schlüssel

- Neuer Schlüssel `lfh:lagekarte:zeichen-zuletzt-v2` mit Einträgen `{ spec: string }`, die
  Farbe ist in der Spec enthalten.
- Beim ersten Lesen, wenn v2 fehlt, werden die Einträge des alten Schlüssels über D5 übersetzt
  (nicht übersetzbare entfallen), in v2 geschrieben und der alte Schlüssel gelöscht.
- `offline/geraetRaeumung.ts` räumt beide Schlüssel.

## Risks / Trade-offs

- **Alter Client sieht neue Zeilen ohne Grundzeichen** und zeichnet sie nach seinem Altpfad als
  leeres Zeichen. → Der Zeitraum ist kurz, weil PWA und Tauri beim nächsten Start aktualisieren.
  Die Daten bleiben unversehrt, und Schreiben über den alten Body bleibt möglich.
- **Ein Bibliotheksupgrade erweitert die Wertemengen**, und die Werteliste veraltet. → Der
  Vitest-Wächter macht die Abweichung rot. Ein Upgrade ohne Neuerzeugung kommt nicht durch das
  Gate.
- **Abgeleitete Zeichnungen:** 2179 der 3964 alten Picker-Kombinationen zeichnet die Bibliothek
  nur abgeleitet. → Das ist so gewollt (Entscheidung der Bibliothek vom 02.10.2026). Die
  Oberfläche zeigt keinen Hinweis darauf.
- **Farbverlust beim Altbestand:** Freie Farben ohne Füllung entfallen, und ähnliche Farben
  fallen auf ein Token zusammen. → Die Abbildung ist deterministisch, belegt durch einen
  Abbildungstest. Die Alt-Hexfarbe bleibt in der DB, bis das Zeichen geändert wird.
- **Picker-Kosten:** `vocabulary()` zeichnet probeweise. → Optionen per `useMemo`, Kosten im
  Test gemessen. Wird es spürbar, werden die Optionen je Art vorab berechnet.
- **Platzhalter „Punkt“ kann mit einem echten Punkt verwechselt werden.** → Der Inspector nennt
  „vereinfacht dargestellt“ und die Alt-Kennung.

## Migration Plan

1. Migration (D2) und Server (D3, D4) mit Tests. Der alte Body bleibt gültig.
2. Frontend auf 5.2.0, Leseadapter, Picker, Karte, „zuletzt verwendet“.
3. Altpaket entfernen, Bundle messen.
4. e2e, Sichtprüfung, Anwenderdoku.

**Rollback:** Ein älterer Hub-Stand liest `grundzeichen` als NOT NULL. Neue Zeilen mit
`zeichen_spec` hätten dann `grundzeichen = NULL`. Ein Rollback des Backends nach dem Release
braucht deshalb einen Rückwärtsschritt, der diese Zeilen löscht oder mit `grundzeichen = 'ohne'`
füllt. Das wird im Release-Hinweis vermerkt. Die Migration ist vorwärtsgerichtet wie alle
Migrationen im Hub.

## Open Questions

- Wann der Übergang endet (alter Body 400, Altspalten weg), entscheidet ein eigener Task nach
  dem Release. Sinnvoll ist das frühestens nach dem nächsten Tauri-Release.
