# Lagebesprechung — Regeln

Gilt für `frontend/src/lagebesprechung/`, `pages/LagebesprechungPage.tsx` und das
Server-Gegenstück `src/lagebesprechung/`, `src/routes/lagebesprechung.rs`; ergänzt
`frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`, sofern nicht `src/…` (Server).

**Eigenes Modul** (LLH-1111,
`openspec/changes/archive/2026-10-13-llj8s2rt-lagebesprechung-eigenes-modul/design.md`): Key
`lagebesprechung` unter Führung, eigene Freigabe, eigenes Live-Ereignis `lagebesprechung` (Gate nur dieses Modul).
Überblick-Marke und Palette-Schnellaktion sind nur Einstiege und prüfen
`istSprungGesperrt('lagebesprechung')`; die alte Adresse `…/stab` führt in den Einsatz (i6k6mzed,
design.md D8).

**Ein Termin, ein Schreibweg** (LLH-1111, D3): Wahrheit ist die Spalte
`einsatz.naechste_lagebesprechung_at`; der Einsatzkopf liest sie für alle Mitglieder (LFH-555).
Geschrieben wird sie nur über `PUT …/lagebesprechung/termin` (Schnellwahl, freie Wahl, „kein
Termin“, ohne ETB-Eintrag) und den Abschluss. Der Kopf-PATCH der Einsatzdaten lehnt das Feld mit
400 ab, laut statt still. Das Kopf-Ereignis `einsatz` geht nur bei einer echten Änderung.
Beide Wege setzen den Termin über `SQL_TERMIN_SETZEN` in `src/lagebesprechung/repo.rs`; die
Anweisung leert bei einer echten Änderung auch die Merker der Ankündigung
(`lagebesprechung_angekuendigt_*_at`, LLH-1215). Ein neuer Schreibweg nimmt sie mit, sonst gilt
die Ankündigung dem alten Termin. Angekündigt wird nur im Erinnerungs-Scheduler
(`src/lagebesprechung/ankuendigung.rs`), je Termin einmal und nur im Zeitfenster, an die Nutzer
der Funktionen EL und S1–S7. Wer sie trägt, sagt allein die Mitgliedschaft (EL zuerst der
Einsatzleiter der Führungsstelle; `frontend/src/fuehrung/AGENTS.md`, i6k6mzed D2), nie das Modul
Stab.

**Vorbereitung der Lagebesprechung** (LFH-550, `lagebesprechung/VorbereitungPaneel.tsx`,
`lagebesprechung/vorbereitung.ts`): Paneel der Seite Lagebesprechung, rechnet keine Zahl selbst
(Lagebild wie das Dashboard, Aufträge/Meldungen/Nachforderungen vom Modulzähler), Quelle je Zeile, Rechteweiche je
Quelle („—“ mit Grund, nie 0). Reihenfolge wie das Dashboard, **kein Vortragsschema** (LFH-46
§2.3), nichts wird eingefroren; ein fester Stand nur über „In Lagebericht übernehmen“ (EIN Aufruf,
Freitext).

**Überfälliger Besprechungstermin** (LFH-859,
`openspec/changes/archive/2026-10-04-lfh-859-lagebesprechung-ein-warnton/design.md`): ein erreichter
oder verstrichener Termin trägt `achtung`, nie `alarm` (keine Gefahr, Alarmbudget EEMUA 191), mit
dem Wort „jetzt fällig“ bzw. „seit 5 min überfällig“. Ton und Wort nur aus
`lagebesprechung/lagebesprechungZustand.ts:lagebesprechungUeberfaellig`; die Seite
Lagebesprechung und die Marke „Lagebesprechung“ der Fristenliste im Überblick (`markenBewertung`)
lesen beide dort. Überfällige Aufträge und Erinnerungen dort
bleiben `alarm`, das „knapp“ unter 30 min bleibt der Fristenliste.
