# Design

## Context

Motivation: `proposal.md`, „Why“. Stand nach LFH-1208
(`openspec/changes/archive/2026-10-11-lfh-1208-abschnitt-bearbeiten-in-ansicht/design.md`, D7):

- Die Spalte `einsatzabschnitt.fortschritt` (`0109_einsatzabschnitt_lage.sql:7`, `INTEGER`,
  `CHECK (fortschritt BETWEEN 0 AND 100)`) ist der einzige Bezug im Schema; kein Index, kein
  Trigger, keine spätere Migration nennt sie.
- Server: `EinsatzabschnittAnzeige.fortschritt` (`skip_serializing_if = "Option::is_none"`), Repo
  liest und schreibt ihn, POST und PATCH nehmen ihn an und prüfen 0–100 (`pruefe_fortschritt`,
  400). Die Bodies (`AbschnittBody`, `AbschnittPatchBody`) haben kein `deny_unknown_fields`.
- Mitläufer: Demo-Szenario (drei Werte), Demo-Import, Schwärzungsregister
  (`retain("fortschritt", G_ZAEHLER)`), Integrationstests `tests/einsatzabschnitt_lage.rs`.
- Lage-Rückblicke (`src/lage_snapshot/repo.rs`) serialisieren `EinsatzabschnittAnzeige` beim
  Erfassen als JSON und liefern den gespeicherten Stand beim Lesen als rohes `Value` aus, ohne
  ihn in Typen zurückzulesen.
- Frontend: nur noch der Typ (`AbschnittEingabe.fortschritt`, Vermerk „nur Altdaten“), die
  generierten Typen und Test-Fixtures, die Abwesenheit belegen. Export, Einsatzbericht und Druck
  lesen den Wert nicht.

## Goals / Non-Goals

**Goals:**

- Nach der Change trifft `grep -rni fortschritt` im Abschnittskontext nichts mehr außer in
  Migrationen, Archiv-Changes und eingefrorenen Herleitungen.
- Kein Pfad, über den ein Fortschritt wieder entstehen kann (Schreibweg, Demo, Typ).

**Non-Goals:**

- **Upload- und Download-Fortschritt** (Karten, Dokumente, Anhänge, Chat) — andere Dinge,
  gleiches Wort.
- **Auftragsbilanz** im Überblick (`ueberblickDaten.ts`, „erledigt / gesamt“): eine Zählung
  der Aufträge, kein gespeicherter Abschnittswert. Bleibt.
- **Historische Texte** in `openspec/changes/archive/` und `docs/superpowers/` sowie
  `0109_einsatzabschnitt_lage.sql` selbst bleiben, wie sie sind.

## Decisions

### D1 · Spalte per `ALTER TABLE … DROP COLUMN` entfernen

Neue Migration mit der nächsten freien Nummer über `origin/alpha` (heute `0188`, vor dem Push
mit `scripts/check-migrationen.sh` prüfen):
`ALTER TABLE einsatzabschnitt DROP COLUMN fortschritt;`

SQLite (≥ 3.35) erlaubt das, weil die Spalte weder Index noch Fremdschlüssel noch einen
fremden CHECK trägt; ihr eigener CHECK fällt mit ihr. Das Projekt hat das Muster schon
(`0041_gefahrengebiet.sql`). Ein Test belegt, dass die Spalte nach den Migrationen fehlt.

*Alternative:* Spalte stehen lassen und nur Code entfernen. Verworfen: Die Spalte bliebe ein
stiller Datenrest, den das Schwärzungsregister weiter führen müsste (dessen Wächter verlangt
eine Klassifikation je Spalte), und sie lüde ein, das Feld wieder anzubinden. Das Ticket
verlangt das Entfernen ausdrücklich.

*Alternative:* Tabelle neu bauen (Kopieren, Umbenennen). Verworfen: unnötig, solange
`DROP COLUMN` greift, und riskanter wegen Fremdschlüsseln anderer Tabellen auf
`einsatzabschnitt`.

### D2 · Altwerte gehen verloren, ohne Sicherung

Gespeicherte Werte aus älteren Einsätzen werden nicht in eine Bemerkung, das ETB oder eine
Sicherungstabelle gerettet. Seit LFH-1208 sieht sie niemand mehr; eine geschätzte Prozentzahl
ist im Einsatz nicht belastbar (Begründung LFH-1208). Ein Archiv, das sie retten wollte, hätte
keinen Leser.

### D3 · Ein mitgeschicktes `fortschritt` wird still verworfen, nicht abgelehnt

Das Feld fällt aus `AbschnittBody` und `AbschnittPatchBody`. Weil die Bodies unbekannte Felder
nicht ablehnen, verwirft serde ein `fortschritt` eines veralteten Clients (alter Tab,
Offline-Warteschlange mit einer Schreibung von vor LFH-1208) ohne Fehler; die übrigen Angaben
werden gespeichert. Ein Test belegt das (Spec, Szenario „Veralteter Client schickt noch einen
Fortschritt“).

*Alternative:* 400 auf ein unbekanntes Feld (`deny_unknown_fields`). Verworfen: Es würde eine
ältere Schreibung aus der Offline-Warteschlange ganz scheitern lassen, obwohl ihr übriger Inhalt
gültig ist, und wiche von allen anderen Bodies des Projekts ab.

### D4 · Eingefrorene Lage-Rückblicke bleiben unverändert

Rückblicke, die vor der Migration erfasst wurden, tragen im gespeicherten JSON weiter
`"fortschritt": …` an Abschnitten. Sie bleiben so: Ein Rückblick ist eingefroren, und das
Frontend liest das Feld nicht mehr (der Typ kennt es nach der Change nicht). Neue Rückblicke
enthalten es nicht, weil das DTO es nicht mehr hat. Eine Migration, die JSON in
`lage_snapshot.daten` umschreibt, wäre teurer als der Nutzen und verletzte die Eingefrorenheit.

### D5 · Typ-Codegen und Frontend ziehen nach

`scripts/check-typ-codegen.sh` erzeugt `openapi.json` und `types.generated.ts` neu, beide
werden mitcommittet. `AbschnittEingabe` verliert das Feld samt Vermerk. Die Tests, die die
Abwesenheit des Fortschritts in Detail, Vorschau, Gliederung und Überblick belegen, bleiben als
Absicherung stehen; nur ihre Fixtures verlieren den Wert `fortschritt: 72/40`, den es im Typ
nicht mehr gibt. Kommentare in `UeberblickPage.tsx`, die den Fortschritt noch als Bestandteil der
Abschnittszeile nennen, werden berichtigt.

### D6 · Anwenderdoku nennt den Fortschritt nicht mehr

`geraet-einsatzabschnitt.md` (Funktionsansicht) und `ueberblick.md` (Abschnittspaneel) nennen
„Fortschritt“ noch als sichtbare Angabe, obwohl LFH-1208 ihn schon entfernt hat. Die Sätze
werden berichtigt; die Bilder zeigen ihn nicht (vor LFH-1208 erfasste Bilder werden geprüft).
Mitänderungsregel: `docs/anwender/AGENTS.md`.

## Risks / Trade-offs

- [Ein Hub, der die Migration einspielt, verliert Altwerte unwiderruflich] → gewollt (D2); eine
  sichtbare Funktion fällt dabei nicht weg, sie ist seit LFH-1208 fort.
- [Ein externer Client wertet `fortschritt` aus der API aus] → Es gibt keinen bekannten; das Feld
  fehlte schon bisher, wenn nicht gepflegt (`skip_serializing_if`), Leser mussten mit seinem
  Fehlen rechnen.
- [Die SQLite-Version eines Zielsystems kann kein `DROP COLUMN`] → entfällt: SQLite ist über
  `libsqlite3-sys` (`bundled`) ins Binary kompiliert und weit jünger als 3.35; `0041` nutzt das
  Muster bereits.

## Migration Plan

Ausrollen mit dem nächsten Release, die Migration läuft beim Start. Zurück geht es nur über eine
Sicherung der Datenbank von vor dem Update; eine Rückwärtsmigration gibt es im Projekt nicht.
