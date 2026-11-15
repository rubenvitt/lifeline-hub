# Design

## Context

Stand `alpha` f534030f (15.11.2026). Warum: proposal.md. Der Lösungsweg je Unteraufgabe ist am
15.11.2026 mit dem Menschen abgestimmt (Zunder-Kommentar an LLH-1723). Heute:

- **Palette:** `command-palette/fuzzy.ts` filtert mit Fuse.js (`threshold: 0.4`,
  `ignoreLocation`, `minMatchCharLength: 1`) über `label` und `schlagworte`. `ordneTreffer`
  sortiert nach [Präfixstufe 0–3, Fuse-Score, Gruppenrang, Index]. Umlaute werden nicht gefaltet
  (Kommentar „Blindfleck, bewusst“). Modulbefehle tragen als einziges Schlagwort die
  `beschreibung`. Datensätze (`datensaetze.ts`) laufen ohne Fuse über Teilzeichenketten des
  Basislabels; das Fahrzeug nur über `funkrufname`, das Personal nur über `name`.
- **Schnellaktionen:** feste Tabelle `SCHNELLAKTIONEN` (`befehle.ts`), Reihenfolge als
  Erfassungshäufigkeit kuratiert und per `toEqual` gepinnt; Guard
  `schnellaktionen.guard.test.ts` verlangt einen Leser für `neu` oder `zeichnen`. Das Gedächtnis
  „Zuletzt ausgeführt“ liegt am Benutzer auf dem Server (`zuletzt_befehle`, Whitelist
  `src/benutzer_einstellungen/mod.rs`, Wert opak, höchstens 2000 Zeichen).
- **Meldungen:** Das Modell aus LLH-1027 trägt `lagerelevant`, Lagemeldungen sind eine Sicht,
  `etb::repo::anlegen_idempotent_mit_meldung` legt Eintrag und Meldung in einer Transaktion an
  (`meldung::repo::anlegen_zu_etb_tx`). `chat::repo::heraufstufen_zu_etb` legt nur den Eintrag an.
  `MeldungenPage`, `LagemeldungenPage` und `AuftraegePage` lesen kein `?neu=1`.
- **Navigation:** `modulRegistry.ts` ordnet ETB unter `erfassung` („Erfass.“), die Hilfe
  (`hilfe/bereiche.ts`, Kapitelpakete in `docs/anwender/AGENTS.md`) gliedert nach
  Führungsmittel/Führungsorganisation/Betroffene. Zwischen Modul und Hilfekapitel gibt es keine
  Zuordnung im Code.
- **Name:** „Meldebild“ ist Label des Moduls `kraefteuebersicht` und steht als Literal in etwa zehn
  sichtbaren Stellen, im Hilfekapitel `meldebild.md`, im Glossar und auf der Website. LFH-965
  (D1) hatte ihn bewusst behalten.

## Goals / Non-Goals

**Goals:** Die Palette trifft, was gemeint ist, und ordnet die Schnellaktionen nach Gebrauch; das
Kräftemodul trägt einen Namen, nach dem man sucht; „Meldung erfassen“ hat einen Einstieg und der
Chat keinen Weg mehr am Meldungseingang vorbei; App und Hilfe gliedern gleich.

**Non-Goals:**
- Das Meldungsmodell ändern; das ETB nur noch anzeigen lassen (verworfen am Checkpoint, Variante B).
- Das Informationstelefon an die Meldungen koppeln.
- Schlüssel, Routen, Bezeichner, `data-lfh`-Haken, Dateinamen und die Hilfe-Adresse
  `/hilfe/meldebild` umbenennen (Grenzwerte, `AGENTS.md` „Bezeichner-Sprache“).
- Jede Erwähnung von „Meldebild“ in Spec-Prosa anderer Fähigkeiten umschreiben (D9).
- Die Kategorie-Schlüssel ändern; nur Beschriftungen und Zuordnung des ETB.

## Decisions

### D1 Eigener Abgleich statt Fuse (LLH-1804)

`filtereBefehle` normalisiert Suche und Texte gleich: klein, `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, danach
NFD ohne Kombinationszeichen. Die Suche zerfällt an Leerzeichen in Wörter, die Texte (Label und
jedes Schlagwort) an `WORTGRENZE` in Wörter. Ein Suchwort trifft, wenn ein Textwort damit beginnt
oder es ab drei Zeichen als Teilzeichenkette in einem normalisierten Text steht. Ein Befehl ist
Treffer, wenn **jedes** Suchwort trifft (über Label und Schlagworte zusammen).

Stufen bleiben die erste Ordnungsachse: 0 Label gleich Suche, 1 Label beginnt mit Suche, 2 jedes
Wort trifft einen Wortanfang, 3 mindestens ein Wort nur als Teilwort. Der Score wird zur zweiten
Achse ohne Fuse: 0, wenn alle Wörter im Label treffen, 0,5, wenn Schlagworte nötig sind.
`UNBEWERTET = 1` für Datensätze bleibt und ist strikt schlechter. `textStufe` (Datensätze) nutzt
dieselbe Normalisierung. `fuse.js` fällt aus `frontend/package.json`, weil `fuzzy.ts` der einzige
Nutzer ist.

Verworfen: Fuse verschärfen (`threshold` 0,1–0,2 oder Extended Search). Bleibt unscharf, ist als
Anforderung nicht fassbar, und kurze Labels wie „Dunkel“ treffen „funk“ weiter.

### D2 Synonyme in der Modul-Registry (LLH-1803)

`ModulEintrag` bekommt `schlagworte?: string[]`; `befehle.ts` führt Modulbefehle mit
`[...m.schlagworte, m.beschreibung]`. Erstausstattung: Kräfteübersicht „Meldebild“, „Stärke“,
„Kräfte“; ETB „Tagebuch“, „Einsatztagebuch“; Unfallhilfsstellen „BHP“, „UHS“,
„Behandlungsplatz“; Fahrzeuge „FMS“, „RTW“, „KTW“, „Kennzeichen“; Bereitstellungsräume „BR“;
Einsatzabschnitte „EA“; Betroffene „Patient“, „Vermisst“; Nachforderungen „Anforderung“. Ein früherer
Name kommt immer als Synonym dazu (Regel in `frontend/AGENTS.md`). Die Website-Kopie
(`module.json`) braucht die Schlagworte nicht; ihr Wächter prüft weiter nur die Namen.

Verworfen: eigene Synonymtabelle in der Palette, nach Modulschlüssel. Das wäre eine zweite Quelle für
Modulwissen und bräuchte einen Wächter über die Schlüssel.

### D3 Merkmale der Datensätze

Die Quellentabelle in `datensaetze.ts` bekommt je Quelle optional `merkmale: (x) => string[]`.
Getroffen wird über Basislabel und Merkmale mit der Regel aus D1. Trifft nur ein Merkmal, zeigt die
Zeile es als Hinweis (wie „PAT 4711“). Fahrzeug: `fahrzeugtyp`, `kennzeichen`; Personal:
`funktion`, `einsatzfunktion`. Kein Backend, die Felder stehen schon in den DTOs.

### D4 Neue Schnellaktionen, dritter Auftrag `ansicht`

Neue Zeilen: „Meldung erfassen“ (Träger `meldungen`, `meldungenPfad(id, { neu: true })`),
„Lagemeldung erfassen“ (Träger `lagemeldungen`, braucht zusätzlich die Freigabe `meldungen`),
„Auftrag erteilen“ (`auftraege`, `AuftraegePage` öffnet bei `?neu=1` den Erteilen-Dialog),
„Nachforderung stellen“ (`nachforderungen`, Leser gibt es) und „Fahrzeugstatus setzen“
(`fahrzeuge`, `fahrzeugePfad(id, { ansicht: 'tableau' })`). `SchnellaktionParameter` wird
`'neu' | 'zeichnen' | 'ansicht'`, der Guard prüft für `ansicht` das Literal `get('ansicht')` auf
der Zielseite. Die neuen Zeilen tragen eine `kennung`; die Ids der Bestandszeilen bleiben.

„Fahrzeugstatus setzen“ überschneidet sich mit der Ansicht „FMS-Tableau“. Bewusst: die Ansicht
steht in „Ansichten“ und findet sich über den Namen, die Schnellaktion folgt Objekt + Verb und
nimmt an der Zählung teil.

### D5 Reihenfolge nach gemessener Nutzung

Neuer Schlüssel `schnellaktionen_zaehler` in `BEKANNTE_SCHLUESSEL`; Wert JSON-Objekt
`{ "<befehls-id>": <anzahl> }`, opak wie `zuletzt_befehle`. Der Client
(`command-palette/schnellaktionZaehler.ts` für den reinen Kern, Verdrahtung im Muster von
`useZuletztBefehle`) zählt bei jeder Ausführung einer Schnellaktion, auch aus „Zuletzt
ausgeführt“ (gezählt wird die Original-Id). Weil der Wert aufzählt und das PUT ihn ganz ersetzt,
holt er vor jedem Schreiben den aktuellen Serverstand und schreibt der Reihe nach (Review vor dem
PR: aus dem Cache gebaut, überschrieb ein alter Stand die Zahlen eines anderen Tabs oder Rechners).
Bleibt der Stand unbekannt, schreibt er nicht. Lesen räumt auf: unbekannte Ids fallen weg, Zahlen
deckeln bei 9999, und der Wert bleibt unter 2000 Zeichen.

`baueBefehle` sortiert die Tabelle vor dem Aufbau stabil nach Anzahl absteigend, bei Gleichstand
nach der festen Folge (Person, ETB, Meldung, Lagemeldung, Auftrag, Nachforderung, Fahrzeugstatus,
Rest in bisheriger Folge). Die feste Folge ist die Reihenfolge der Tabelle. Damit gilt die Folge in der Startansicht und als Gleichstandsachse der Suche.
Während die Palette offen ist, ändert sich nichts: gezählt wird erst nach `schliesse()`.

Verworfen: feste Folge ohne Messung (Empfehlung am Checkpoint, der Mensch wählte die Messung) und
Browserspeicher (am gemeinsamen Fükw-Rechner erbte die nächste Schicht die Zahlen).

### D6 Hilfe als Navigationszeile

`baueBefehle` führt in `navigation` die Zeile „Hilfe“ (`hilfePfad()`), auch außerhalb eines
Einsatzes, mit den Schlagworten „Anleitung“, „Dokumentation“, „Handbuch“. Ihr Label ist gleich
der Suche „hilfe“ (Stufe 0), daher steht sie vor „Unfallhilfsstelle anlegen“.

### D7 Kräfteübersicht statt Meldebild

`label: 'Kräfteübersicht'` in der Registry. Literale werden auf `modulName('kraefteuebersicht')`
umgestellt (Verdichtungszeile, MaterialVerdichtung, Ladeplatzhalter in `App.tsx`, `dokumentart`
im Druckkopf, Datensicht und SpaltenSchalter), die Texte der Lagebericht-Übernahme lauten
„Kräfteübersicht“ (`kraeftebild.ts`, `eigeneLageUebernahme.ts`). Gespeicherte Lageberichte
behalten ihren Text. Hilfekapitel: Titel „Kräfteübersicht und Kräfte-Zeitachse“, Text angepasst,
Datei, Adresse und Bildordner bleiben, Bilder neu aufgenommen. Glossar: Eintrag
„Kräfteübersicht“ mit dem Hinweis auf den früheren Namen. `frontend/AGENTS.md` ersetzt die Regel
„Meldebild heißt sichtbar die Kräfteübersicht“. Website: `module.json`, `index.astro`. Diese
Entscheidung löst LFH-965 D1 ab.

### D8 Chat-Heraufstufung mit Meldung (LLH-1802)

`HeraufstufenBody` bekommt `in_meldungseingang: Option<bool>` (fehlt = nur protokollieren, für
ältere Clients). `true` nur bei Typ `meldung`/`lage`, sonst 422; dann zusätzlich
`fordere_zielmodul::<Meldungen>` (403 vor jedem Schreiben). `heraufstufen_zu_etb` nimmt die
Meldungsdaten optional mit und ruft im selben `write_retry!` nach dem Eintrag
`meldung::repo::anlegen_zu_etb_tx` (ohne `client_id`; Doppelungen sperrt der Guard „bereits
heraufgestuft“). Absender ist der Anzeigename der Person, die die Nachricht schrieb, Meldeweg
`sonstige`, Ereigniszeit und Eingang die Zeit der Nachricht, Wortlaut der des Eintrags. Nach dem
Commit `meldung::live_publikation_sicherstellen`. Der Dialog zeigt bei Typ Meldung oder Lage und
freigegebenen Meldungen die Checkbox „Auch in den Meldungseingang“ (vorgewählt, Wortlaut der
ETB-Schnellerfassung), sonst einen Hinweis. Die Regel kommt
in `src/AGENTS.md` neben „ETB → Meldung (LLH-1037)“.

`?neu=1`: `meldungenPfad` und `lagemeldungenPfad` bekommen `neu`; beide Seiten öffnen das
Formular wie `NachforderungenPage` und nehmen den Parameter danach weg (`replace`).

### D9 Spec-Prosa mit „Meldebild“

Geändert werden nur die Anforderungen, die „Meldebild“ als sichtbaren Wortlaut verlangen
(Druckkopf, Knopf der Führungsorganisation, Lagevortrag, Ortspfad). Die Namen von Anforderungen und
Szenarien bleiben, auch wenn sie „Meldebild“ tragen („Meldebild mit Auswahl“, „Eigene Lage aus
Meldebild und Führungsorganisation“): ein RENAMED neben einem MODIFIED birgt beim Archivieren ein
Risiko (wie ysjiv1n3). Rund 20 weitere Specs nennen das Modul in der Prosa „Meldebild“. Sie
bekommen eine Folgeaufgabe statt eines Deltas, das keine Anforderung ändert.

### D10 ETB in „Führung“, Kategorie „Betroffene & Schäden“ (LLH-1805)

ETB bekommt `kategorie: 'fuehrung'` und steht direkt hinter „Überblick“; die Marke
„Entscheidungen“ folgt ihm, weil eine Marke in der Kategorie ihres Ziels steht. `MODUL_KEYS` in
`src/einsatz/modul.rs` zieht die Reihenfolge nach. Die Kategorie mit dem Schlüssel `erfassung`
heißt „Betroffene & Schäden“; der Schlüssel bleibt, damit `lfh:nav:kategorie-modul` gültig
bleibt. Das Kurzetikett ist „Betroff.“: „BETROFFENE“ ist in 9 px Versalien breiter als die Rail
(gemessen in `e2e/rail-etikett.spec.ts`).
Ein für `erfassung` gemerktes ETB wird ignoriert, weil es nicht mehr zur Kategorie gehört (neues
Szenario in `seiten-orientierung`).

Am Checkpoint war „Betroffene“ gewählt. Beim Bauen zeigte sich, dass Kategorie und Modul dann
gleich hießen: zwei Ziele mit demselben Namen in Rail und Modulpanel, für Screenreader nicht zu
unterscheiden. Am 15.11.2026 entschieden: „Betroffene & Schäden“, nach dem Muster „Kräfte &
Mittel“.

### D11 Hilfe folgt den Kategorien

`BEREICHE` wird: Einstieg, Führung, Kräfte & Mittel, Betroffene & Schäden, Lage, Kommunikation,
Einstellungen und Verwaltung, Gekoppelte Geräte. Jedes Kapitel bekommt eine neue `reihenfolge`
in seinem Block, innerhalb des Blocks in der Folge der Registry. Kapitel ohne Modul: Drucken und
Export → Führung, Vorplanung → Kräfte & Mittel, Neuigkeiten und Rückmeldung → Einstieg; Chat kommt
als Modul nach Kommunikation. Die Adressen hängen am Dateinamen und bleiben.

Wächter `hilfe/bereiche.guard.test.ts`: eine Tabelle Modulschlüssel → Kapitel. Er prüft, dass
jedes Registry-Modul eine Zeile hat, dass das Kapitel existiert und dass `bereichVon(reihenfolge)`
der Name der Kategorie des Moduls ist. Damit braucht ein neues Modul eine Zuordnung, und eine
Umsortierung in der App ohne die Hilfe wird rot. `docs/anwender/AGENTS.md` (Kapitelpakete),
`website/src/daten/bereiche.ts` und `docs/anwender/README.md` ziehen nach.

## Risks / Trade-offs

- **Großer Diff, viele gepinnte Tests.** Der neue Abgleich ändert Ranglisten in `fuzzy.test.ts`,
  `befehle.test.ts` und den Palette-Tests, die Umbenennung etwa 25 e2e-Locatoren. Abhilfe: Arbeit
  in der Reihenfolge 1804 → 1803 → 1802 → 1805, je Abschnitt eigene Commits; Pins nur dort
  ändern, wo die Spec es verlangt.
- **Unruhige Reihenfolge.** Gemessene Nutzung verschiebt Zeilen über die Zeit, das stört das
  Muskelgedächtnis. Abgeschwächt durch die Gruppe „Zuletzt ausgeführt“ und die stehende Folge bei
  offener Palette. Ist es zu unruhig, ist ein Schwellwert der nächste Schritt (nicht jetzt).
- **Teilwort ab drei Zeichen** kann bei kurzen Wörtern weiter rauschen („bet“ trifft
  „Betreuung“ und „Betroffene“). Gewollt: das sind echte Wortbestandteile, keine Buchstabenfolge.
- **Hilfe-Bilder:** Die Kräfteübersicht und die Rail (Kapitel Oberfläche) müssen neu aufgenommen
  werden; das braucht einen Backend-Build und den Bildlauf.
- **Rail-Etikett:** „Betroffene“ passt nicht, es bleibt die Kurzform „Betroff.“. Das ist ein Rest des
  Befunds „ERFASS.“, aber mit einem Wort, das man erkennt.
