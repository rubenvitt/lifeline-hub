# Design

## Context

Warum die Lagebesprechung ein eigenes Modul werden soll, steht in proposal.md. Den Bestand hat
ein Scope-Lauf am 12.10.2026 erhoben.

**Backend**
- `src/routes/stab.rs:199-268`: `GET` und `POST …/stab/lagebesprechungen` mit
  `EinsatzLesezugriff<Stab>` bzw. `EinsatzSchreibzugriff<Stab>`.
- Abschluss-Transaktion in `src/stab/repo.rs:195-315` (`write_retry!`):
  1. `lfd_nr`
  2. ETB `TYP_ENTSCHEIDUNG`
  3. Insert in `einsatz_lagebesprechung`
  4. `fordere_aktiv_in_tx` als Rollback-Riegel
  5. Termin mit `IS NOT ?1`, daraus `termin_geaendert`
- `StabAnzeige` (`src/stab/mod.rs:137`) mischt die Besetzung mit `letzte_lagebesprechung`,
  `anzahl_lagebesprechungen` und `naechste_lagebesprechung_at`.
- Der Termin ohne Abschluss geht heute nur über `PATCH /api/einsaetze/{id}`
  (`KopfdatenPatch.naechste_lagebesprechung_at`, Gate `EinsatzVerwaltungszugriff`, ohne Modul).
  Dieser Weg schreibt kein ETB und ruft `kopf_geaendert` immer.
- Modulfreigaben liegen relational in `einsatz_modul_override` (`sichtbar`, `benoetigte_rolle`)
  und `org_modul_einstellung` (nur `benoetigte_rolle`). Ein neuer Key ohne Zeile ist frei.

**Frontend**
- Die Bausteine liegen in `frontend/src/stab/`: `LagebesprechungStand`, `LagebesprechungHistorie`,
  `LagebesprechungModal`, `lagebesprechungAbschluss`, `lagebesprechungZustand`, `abschlussToast`,
  `VorbereitungPaneel`, `vorbereitung`.
- Seite `pages/StabPage.tsx:159-203`. Die Einsatzdaten-Zeile steht in
  `pages/EinsatzdatenPage.tsx:1336-1350`; ihr Kommentar „bis die Lagebesprechung eine eigene
  Verwaltung hat (LFH-1251)“ meint dieses Ticket.
- Überblick-Marke `UeberblickPage.tsx:540-554`, Schnellaktion `command-palette/befehle.ts:126-134`.
- Die Keys `einsatzKeys.stab` und `stabLagebesprechungen` liegen unter dem Prefix `einsatz-stab`
  und laufen live über `stab`.
- Lagebericht-Übernahme (`lageberichte/lageentwicklungUebernahme.ts`) und Einsatzbericht
  (`druck/einsatzbericht/quellen.ts:67-69`) lesen die Lagebesprechung über `ladeStab` mit der
  Freigabe `stab`.

**Bezüge**
- LLH-1116 („Stab abwählbar“) empfiehlt genau diesen Schnitt, setzt ihn aber nicht voraus.
- LLH-1124 (Stab-Seite neu) und LLH-1127 (Stab-Sprungmarken) warten auf diese Change.

## Goals / Non-Goals

**Goals:**
- Ein Modul mit eigener Freigabe, eigenen Endpunkten und eigenem Live-Ereignis, das nichts vom
  Stab erbt.
- Eine Heimat für Termin, Vorbereitung, Abschluss und Verlauf. Die Stab-Seite und die
  Einsatzdaten tragen nichts davon mehr selbst.
- Kein Bestandsnutzer sieht nach der Einführung mehr als vorher.

**Non-Goals:**
- Teilnehmerliste, „Folgeauftrag aus Entschluss“ und Rhythmus-Automatik (eigenes Ticket, wie
  vorgeschlagen).
- Neugestaltung der Stab-Seite (LLH-1124). Diese Change ersetzt nur zwei Paneele durch eine
  Zeile.
- Sichtbarkeits-Vorgabe je Organisation (LLH-1116).
- Modulzähler (Spec `modul-zaehler`: nur mit festgelegter Bedeutung).
- Offline-Lesbarkeit: Die Lagebesprechungen bleiben wie heute außerhalb von `LAGEBILD_OFFLINE`.

## Decisions

### D1 Ort: eigenes Modul `lagebesprechung` unter Führung

- Registry-Eintrag `lagebesprechung` mit `kategorie: 'fuehrung'`, `label: 'Lagebesprechung'` und
  `beschreibung: 'Termin, Vorbereitung, Entschluss'`, zwischen `auftraege` und `stab`.
  `MODUL_KEYS` wird gleich gespiegelt.
- Route `/einsaetze/:einsatzId/lagebesprechung`, Seite `pages/LagebesprechungPage.tsx`. Der Name
  ist durch den Guard `schnellaktionen.guard.test.ts` gebunden, weil die Seite den Leser `neu`
  trägt.
- Ausblendbar wie jedes Fachmodul.

*Verworfen:*
- B, eine Unterroute `…/stab/lagebesprechung`. Sie bleibt an der Stab-Freigabe hängen und löst
  Rubens Punkt nicht.
- C, nur ein Paneel im Überblick. Dort fehlt der Platz für Vorbereitung und Verlauf, und der
  Überblick soll so bleiben.

### D2 Endpunkte: neu unter dem Modul, alte Stab-Pfade fallen im selben PR

| Methode und Pfad | Gate | Antwort |
| --- | --- | --- |
| `GET /api/einsaetze/{id}/lagebesprechung` | `EinsatzLesezugriff<Lagebesprechung>` | `LagebesprechungStand` (nächster Termin, Anzahl, letzte Besprechung) |
| `PUT /api/einsaetze/{id}/lagebesprechung/termin` | `EinsatzSchreibzugriff<Lagebesprechung>` | `LagebesprechungStand`; Body `{ "naechste_at": "<Zeitpunkt>" \| null }`, beide Werte Pflicht |
| `GET /api/einsaetze/{id}/lagebesprechungen` | `EinsatzLesezugriff<Lagebesprechung>` | Verlauf, neueste zuerst |
| `POST /api/einsaetze/{id}/lagebesprechungen` | `EinsatzSchreibzugriff<Lagebesprechung>` | 201 und `LagebesprechungStand`; Body wie bisher `LagebesprechungAbschluss` |

- `…/stab/lagebesprechungen` entfällt. `StabAnzeige` verliert die drei Lagebesprechungsfelder.
- Code und Tests ziehen von `src/stab/` nach `src/lagebesprechung/` (`mod.rs`, `repo.rs`) und
  `src/routes/lagebesprechung.rs`. Die Abschluss-Transaktion zieht unverändert mit.
- `PFAD_KEY` bekommt `…/lagebesprechung` und `…/lagebesprechungen` auf den neuen Key.

*Verworfen:*
- Die alten Pfade behalten und per längerem Präfix in `PFAD_KEY` umhängen. Dann hätte ein Pfad
  `stab/…` nicht die Stab-Freigabe, und das liest sich falsch.
- Eine Weiterleitung. Einziger Abnehmer ist das eigene Frontend im selben Build.

### D3 Termin: eigener Schreibweg, Kopf-PATCH lehnt das Feld ab (Entscheidung Ruben, 12.10.2026)

- `PUT …/lagebesprechung/termin` schreibt die Spalte `einsatz.naechste_lagebesprechung_at` mit
  `WHERE … IS NOT ?1` und prüft den aktiven Einsatz (409).
- Nach dem Commit verteilt der Endpunkt `LiveEvent::Lagebesprechung`. `kopf_geaendert` ruft er
  nur, wenn eine Zeile betroffen war (Spec `einsatzkopf-live`).
- Kein ETB-Eintrag (Entscheidung Ruben, 12.10.2026). Der Termin ist eine Wiedervorlage, keine
  Entscheidung.
- Ein Termin in der Vergangenheit wird angenommen und zeigt dann „überfällig“, wie heute in den
  Einsatzdaten.
- `KopfdatenPatch` behält das Feld nur noch, um es abzulehnen: Ist es gesetzt, auch auf `null`,
  gibt der PATCH 400 mit dem Hinweis auf das Modul Lagebesprechung, bevor er etwas schreibt.
  Begründung: Ohne `deny_unknown_fields` würde serde ein entferntes Feld still verwerfen. Ein
  veralteter Tab oder ein Eintrag der Schreib-Warteschlange (LFH-705) bekäme dann 200 und hielte
  den Termin für gesetzt.
- Lesbar bleibt der Termin in `EinsatzAnzeige` für alle Mitglieder (LFH-555, D3). Überblick-Marke
  und ETB-Wiedervorlage lesen ihn weiter dort.

*Verworfen:* Den Kopf-PATCH als Schreibweg behalten. Er hängt am Verwaltungsrecht statt am Modul,
lässt einen System-Admin ohne Rolle schreiben und feuert `einsatz` auch ohne Änderung.

### D4 Rechte

- Lesen: `EinsatzLesezugriff<Lagebesprechung>`.
- Schreiben: `EinsatzSchreibzugriff<Lagebesprechung>`, also Einsatzleitung und Führungspersonal
  allein nach Einsatzrolle (LFH-1118).
- Der Abschluss fordert wie heute keine ETB-Freigabe, denn der ETB-Eintrag ist Nachweis und keine
  Bedienung des ETB.
- Gesperrtes Modul heißt 403, fremder oder unbekannter Einsatz 404.

### D5 Freigaben: nur die Rolle wandert (Entscheidung Ruben, 12.10.2026)

Migration `0182_lagebesprechung_modul.sql`, die Nummer zum Merge per
`scripts/check-migrationen.sh` geprüft:

```sql
INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at)
SELECT einsatz_id, 'lagebesprechung', 1, benoetigte_rolle, datetime('now')
FROM einsatz_modul_override
WHERE modul_key = 'stab' AND benoetigte_rolle IS NOT NULL;

INSERT INTO org_modul_einstellung (org_id, modul_key, benoetigte_rolle, geaendert_at)
SELECT org_id, 'lagebesprechung', benoetigte_rolle, datetime('now')
FROM org_modul_einstellung
WHERE modul_key = 'stab' AND benoetigte_rolle IS NOT NULL;
```

- `geaendert_von` bleibt `NULL`, als Systemänderung.
- Wer Stab ausgeblendet hat, bekommt die Lagebesprechung sichtbar. Das ist der Zweck des Tickets.
- Wer Stab auf eine Rolle beschränkt hat, behält dieselbe Grenze. Deshalb sieht niemand mehr als
  heute.

*Verworfen:*
- Nichts übernehmen. Dann sähen Beobachter die Entschlüsse, wo Stab beschränkt war.
- Alles übernehmen. Wer Stab ausblendet, verlöre dann die Lagebesprechung.

### D6 Live: eigenes Ereignis `lagebesprechung`

- `LiveEvent::Lagebesprechung` mit Wire-Namen `lagebesprechung` und Gate `["lagebesprechung"]`.
  Abschluss und Termin verteilen es.
- `LiveEvent::Stab` bleibt für Besetzung und Checkliste und verliert die Lagebesprechung.
- Frontend:
  - neuer Prefix `einsatz-lagebesprechung` mit den Keys `lagebesprechung(id)` und
    `lagebesprechungen(id)`
  - live über `lagebesprechung` (dazu der Modulzähler nicht, es gibt keinen)
  - `einsatz` invalidiert künftig Kopf, Führungsstelle und `lagebesprechung(id)` statt
    `stab(id)`
  - `stabLagebesprechungen` entfällt
  - Nicht in `LAGEBILD_OFFLINE`; Begründung im Guard (`lagebildOffline.guard.test.ts`) wie bisher
- Wire-Kontrakt `tests/enum_wire_kontrakt.rs` und `EINSATZ_STREAM_EVENTS` ziehen mit.

*Verworfen:* `Stab` zusätzlich auf den neuen Key öffnen. Dann erführen Lagebesprechungs-Leser von
jeder Besetzungsänderung.

### D7 Seite Lagebesprechung

**Seitenkopf `EinsatzSeite`**
- Titel „Lagebesprechung“.
- Primäraktion „Lagebesprechung abschließen“: öffnet `LagebesprechungModal` wie bisher, ohne
  Schreibrecht gesperrt mit `RechteHinweis`.
- Leser `?neu=1` öffnet das Modal und wird dann geräumt.

**Paneel „Termin“ (Instrumententafel, Zahl führt)**
- Termin groß als taktische Zeit (`ZeitAnzeige`).
- Zustand aus `lagebesprechungZustand` bzw. `lagebesprechungUeberfaellig`.
- Schnellwahl „+30 min“, „+1 h“, „+2 h“ ab `serverJetzt()` und „kein Termin“, dazu „Termin wählen“
  über `ZeitpunktEingabe`.
- „kein Termin“ fragt nicht nach, weil er mit einem Griff zurückzunehmen ist.

**Paneel „Vorbereitung“**: `VorbereitungPaneel` unverändert.

**Paneel „Verlauf“**
- Alle Besprechungen als `Liste`, neueste zuerst, Titel „Nr. n · Zeit“ als `h3`.
- Entschluss gekürzt, mit Aufklappen ganz.
- Dazu der Termin, der beim Abschluss gesetzt wurde, und der ETB-Sprung.
- Die Begrenzung auf drei Einträge mit Expander fällt. Die Seite gehört dem Verlauf.

**Bausteine**
- Sie ziehen per `git mv` von `frontend/src/stab/` nach `frontend/src/lagebesprechung/`.
- Neue Bezeichner sind englisch-technisch nach LFH-1312, etwa `fetchLagebesprechung`,
  `setLagebesprechungTermin`, `LagebesprechungPage`.
- Bestehende Bezeichner werden umgestellt, wo der Diff sie ohnehin anfasst. Das geschieht als
  eigener `refactor`-Commit.

**Pflichten**
- Prüfliste Einsatztauglichkeit (15 Kriterien) als `pruefliste.md` in dieser Change.
- Dichte-Staffel 30/48/72.
- Handy 390 px ohne Querlauf.
- Bedienziele in `trefflaeche-pruefflaechen`.

**Icon**: Icons8 iOS 27 Outlined über `icons/index.ts`. Die Auswahl steht unter Open Questions.

### D8 Einstiege

**Stab-Seite**
- Paneele „Lagebesprechung“ und „Vorbereitung“, die Kopfaktion, der Leser `neu` und `neueZeile`
  entfallen.
- Stattdessen kommt eine Zeile „Nächste Lagebesprechung <Zeit> · <Zustand>“ als Sprung, gesperrt
  mit `KEINE_BERECHTIGUNG`, wenn `istSprungGesperrt('lagebesprechung')`.
- Die Zeit liest die Zeile aus dem Einsatzkopf, nicht aus einem Lagebesprechungs-GET. So sieht
  auch ein Stab-Leser ohne Lagebesprechungs-Recht den Termin, wie im Überblick.

**Überblick**: `markenZiel` der Art `lagebesprechung` führt auf `lagebesprechungPfad`, mit
`istSprungGesperrt('lagebesprechung')`.

**Palette**
- `SCHNELLAKTIONEN`: Der Eintrag „Lagebesprechung abschließen“ bekommt den Träger
  `lagebesprechung` und das Ziel `lagebesprechungPfad(id, { neu: true })`.
- `kennung: 'stab'` hält die Befehls-Id `aktion:stab` stabil, sodass „Zuletzt ausgeführt“ seinen
  Eintrag behält. Das ist ein Kommentar wert, weil es von „Bestandszeilen ohne `kennung`“
  abweicht.
- Die Schlagworte bleiben.

**Einsatzdaten**: Die Zeile und `naechste_lagebesprechung_at` in `patcheEinsatz` entfallen.

**Lagebericht-Übernahme und Einsatzbericht**
- Sie lesen Stand bzw. Verlauf über die neuen Endpunkte mit der Freigabe `lagebesprechung`.
- `vorbereitung.ts` führt die Quelle der Zeilen „Letzte Lagebesprechung“ und „Nächster Termin“ als
  `lagebesprechung`.

### D9 Regeln wandern in eine eigene Bereichsdatei

- Neue `frontend/src/lagebesprechung/AGENTS.md` mit Geltungsbereich `frontend/src/lagebesprechung/`,
  `pages/LagebesprechungPage.tsx` und `src/lagebesprechung/` (Client und Server, wie
  `betreuung`).
- Inhalt: „Vorbereitung der Lagebesprechung“ und „Überfälliger Besprechungstermin“ aus
  `frontend/src/stab/AGENTS.md`, mit neuem Ort. Dazu eine kurze Regel „Termin hat eine Spalte
  und einen Schreibweg“ (D3).
- Wurzel-`AGENTS.md`: neue Tabellenzeile, und die Stab-Zeile verliert „Vorbereitung der
  Lagebesprechung“. `frontend/AGENTS.md` zieht nach:
  - Verweisblock Stab
  - LFH-463 Wiedervorlage
  - „Der Einsatzkopf ist live“
- Alle Code-Kommentare mit Verweis auf die alten Abschnitte werden per `grep -rn "stab/AGENTS.md"`
  nachgezogen.

### D10 Entschluss bekommt die ETB-Grenze

Bisher fehlt eine Längengrenze, obwohl `src/AGENTS.md` sie für Text verlangt, der ins ETB geht.
`entschluss` bekommt die Grenze `etb::INHALT_MAX` (20 000 Zeichen). Der Client nutzt
`ETB_INHALT_MAX` aus `api/eingabegrenzen.ts`, und das Modal zeigt den Zähler.

### D11 Anwenderdoku

- Neues Kapitel `docs/anwender/kapitel/lagebesprechung.md` mit `reihenfolge: 470`, der nächsten
  freien Zehnerstelle im Führungsblock.
- Bilder-Spec `frontend/e2e/doku-bilder/lagebesprechung.bilder.ts`. Die Bilder `vorbereitung` und
  `lagebesprechung` ziehen aus `bilder/stab/` dorthin (Wächter gegen verwaiste Bilder), dazu ein
  neues Bild `termin`.
- `stab.md` verliert die Abläufe „vorbereiten“ und „abschließen“ und verweist auf das Kapitel.
- Zeile in `einsatzdaten.md`, Marke in `ueberblick.md` und `ohne-netz.md` werden nachgezogen.
- Zeile in `README.md`.
- Das Bild `einsatzdaten.png` wird neu erzeugt.

### D12 Abstimmung mit LFH-852 (Feldbefund Stab, Entscheidung 17)

- Die Rückbau-Option „wird nach der ersten Übung keine Lagebesprechung über das Modul
  abgeschlossen, wandert der Abschluss ins ETB-Modul“ bleibt gültig.
- Ihr Gegenstand ist künftig das Modul Lagebesprechung statt des Stabs.
- `docs/superpowers/` ist eingefrorenes Archiv und wird nicht geändert. Der Vermerk steht hier und
  an der Zunder-Aufgabe.

## Risks / Trade-offs

- **API-Bruch zwischen Deploys.** Ein offener Tab mit altem Bundle ruft `…/stab/lagebesprechungen`
  und bekommt 404 bis zum Neuladen. → Das Frontend ist eingebettet und lädt nach einem Update
  neu. Der Kopf-PATCH lehnt das Altfeld laut mit 400 ab statt still (D3).
- **Schreib-Warteschlange (LFH-705)** mit einem gespeicherten Kopf-PATCH samt Termin. → 400
  erscheint als Fehler an der Warteschlange und geht nicht still verloren.
- **Parallel laufende Changes** (LLH-1116, LLH-1127) können `frontend/src/stab/AGENTS.md`,
  `befehle.ts` und `modulRegistry.ts` berühren. → Den Branch vor dem PR auf `alpha` mergen und
  Konflikte von Hand lösen.
- **Migrationsnummer 0182** kann durch einen früheren Merge belegt werden. → Prüfen per
  `scripts/check-migrationen.sh`, Autofix auf dem PR-Branch (LFH-1014).
- **Bildlauf in der Cloud-Sitzung**: Plattenkontingent und Playwright-Browser sind ungeprüft. →
  Früh versuchen. Scheitert der Lauf, wird das im PR benannt und die Bilder lokal nachgezogen,
  ohne Platzhalter einzuchecken.

## Migration Plan

1. Migration 0182 läuft beim Start (sqlx). Sie fügt nur Zeilen hinzu, und ein Rollback ist ein
   `DELETE … WHERE modul_key = 'lagebesprechung'`.
2. Backend und Frontend kommen in einem Binary. Ein Übergangsweg für die alten Pfade ist nicht
   nötig.

## Open Questions

- **Icon des Moduls.** Kandidaten aus Icons8 iOS 27 Outlined (etwa „Meeting“, „Conference“,
  „Calendar Clock“) werden während der Umsetzung als PNG vorgelegt. Das SVG kommt erst nach
  Rubens Wahl. Specs und Aufgabenschnitt hängen nicht davon ab.
