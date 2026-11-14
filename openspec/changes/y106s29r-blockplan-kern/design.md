# Design

## Context

Siehe `proposal.md` für den Anlass. Bestandsaufnahme vom 14.11.2026, mit Belegen in Datei:Zeile im
Kommentar an LLH-1684.

**Schon geteilt:** `pruefung`, `zerlegung`, `PlanPerson`, `Posten`, `PlanHelferAnzeige`,
`HelferEingabe/Patch` und die Feldprüfungen der Routen (`routes/abloesung_schichtplan.rs:89-161`).
Im Frontend teilen beide Pläne Raster, Block- und Erzeugen-Dialog, Liste, Personen und Schleuse über
den Adapter `planung/planungZeilen.ts`.

**Noch doppelt:**
- die Schreibwege im Repo (E = `abloesung/schichtplan/repo.rs`, P = `planung/repo.rs`)
- die Handler für Blöcke und Helfer
- die Hülle der Planansicht samt Mutationen und Ansagen
- der gemeinsame Teil der Druckseiten

**Tabellen** (bleiben):

| Rolle | Einsatz | Planung |
|---|---|---|
| Schichten | `einsatz_planschicht`, Scope `einsatz_id`; Posten über `posten_art`, `einheit_id`, `uhs_id` | `planung_schicht`, Scope `planung_id`; Posten über `posten_id` |
| Personen je Schicht | `einsatz_planschicht_person`, Fremdschlüssel `planschicht_id`; zusätzlich `einsatz_personal_id` für Ad-hoc-Kräfte | `planung_schicht_person`, Fremdschlüssel `schicht_id` |
| Helfer | `einsatz_plan_helfer`, zusätzlich `kennung`, `herkunft`, `einsatz_personal_id` | `planung_helfer` |

**Echte Unterschiede, die erhalten bleiben müssen:**
- **Posten-Prüfung und Soll-Vorgabe:**
  - Einsatz: Einheit oder UHS des Einsatzes, nicht aufgelöst.
  - Planung: Posten der Planung, Soll und Schichtlänge am Posten.
- **Zeitzone im Konflikttext:**
  - Einsatz: Zeitstil des Einsatzes.
  - Planung: Zeitstil der Organisation.
- **Personen:**
  - Einsatz: mit Ad-hoc-Kräften.
  - Planung: 422 „Eine Planung kennt nur Stamm-Personal und Helfer“.
- **Schreibrahmen:**
  - Planung: `schreibbar_tx` zuerst (409 nach der Übernahme, `stand` steigt).
  - Einsatz: `org_von`; danach `nachziehen_plan_tx`.
- **Nur Einsatz:**
  - 409 `PAUSE_OFFEN` beim Ändern und Löschen.
  - 403 beim Löschen eines belegten Blocks ohne Personal.
  - ETB-Satz beim Erzeugen.
  - Teilung nach dem Schichtmodell.
  - Ist-Abgleich, Wechselpunkte, Grenzwerte, nächste Prüfung.
- **Sortierung der Blöcke:**
  - Einsatz: Art, Sortierung der Einheit, Name.
  - Planung: Posten-Sortierung.
- **Laden:**
  - Einsatz: `personen: null`/`helfer: null` ohne Personal.
  - Planung: immer Listen.
- **Antwort-DTOs:**
  - Einsatz: `SchichtplanAnzeige`/`PlanBlockAnzeige`.
  - Planung: `PlanungAnzeige`/`PlanungBlockAnzeige`.
  - Beide sind Wire-Typen und bleiben, wie sie sind.

## Goals / Non-Goals

**Goals:**
- Jede Regel, die beide Pläne teilen, steht an genau einer Stelle: Raster, Dauer, Überschneidung, Soll, Pause ohne Soll, Personen- und Qualifikationsprüfung, Höchstzahlen, Helferwege, Konfliktschleife beim Erzeugen, Abbildung der Personen, Ansagen, Mutationsfluss der Ansicht.
- Unveränderte Wire-Form, Statuscodes, Fehlertexte, SSE-Ereignisse und ETB-Einträge beider Pläne. Belegt wird das durch Tests, die vor dem Umbau ergänzt werden.
- Die Helferliste im Einsatz-Schichtplan (Spec-Delta `kraefte-schichtplan`).

**Non-Goals:**
- Keine gemeinsame Tabelle und keine Migration.
- Keine Vereinheitlichung der Antwort-DTOs: eine Wire-Änderung bräuchte eine eigene Change mit Übergangsweg.
- Kein Umbau von Wechsel, Import/Export, Grenzwerten, Übernahme der Planung, Kopf und Posten.
- Keine Umbenennung von ToSchema-Typen, Feldern, Routen, Ereignissen, `data-lfh`, gespeicherten Schlüsseln oder Eingabegrenzen-Namen (LFH-1312, „Grenzwerte bleiben“).

## Decisions

### D1 Kern als Trait mit Konstanten, generisch statt `dyn`

`plan_repo.rs` in `src/abloesung/schichtplan/` definiert `trait Planart` mit `&'static str`-Konstanten:
- Tabellen: Schicht, Person, Helfer
- Spalten: Fremdschlüssel der Person, Scope-Spalte
- Wortlaute: „je Einsatz/Planung“, „zu diesem Einsatz/dieser Planung“
- `MIT_ADHOC`

Dazu zwei Marker. `Einsatzplan { einsatz_id }` steht im Einsatz-Repo, `Vorplanung { org_id, planung_id }` im Planungs-Repo. Die Methoden nehmen `&self`; so kennt der Kern keine der beiden Seiten. SQL entsteht über `sqlx::AssertSqlSafe(format!(…))` wie in `vorlagendokument::repo`. Eingesetzt werden nur die Konstanten; Werte bleiben gebunden.

*Alternativen:*
- Ein Struct mit Feldern als Wert: erlaubt einen Wert zur Laufzeit und damit falsche Kombinationen.
- Ein Makro, das zwei Repos erzeugt: schwer zu lesen, und Abweichungen verschwinden im Makro.
- `dyn`-Trait: async-Methoden gingen nur mit Boxen.

Den Ort `abloesung/schichtplan/` wählen wir, weil der Einsatz-Schichtplan die führende Seite ist und die Vorplanung schon `pruefung`/`zerlegung` von dort nutzt. Der Name `core` scheidet aus, er überdeckt die Crate.

### D2 Posten-Spalten und Seiten-Hooks bleiben Methoden der Art

*Umgesetzt (14.11.2026):* Die Posten-SQL steht doch einmal im Kern. Sie läuft über die Konstante `POSTEN_SPALTEN` und die Art-Methoden `bind_posten`, `posten_from_row` und `is_pause`, die Vorlage unten bleibt nur als Skizze stehen. Einfügen, Überschneidung, Update-SQL und das Lesen des Stands gibt es so nur einmal. Die Überschneidungsabfrage vergleicht mit `IS ?` statt `= ?`; für Werte ungleich NULL ist das gleichwertig, denn die Pause kehrt vorher zurück. `PAUSE_OFFEN` prüft `check_update_tx` an der bisherigen Stelle. Das Nachziehen der Ablösung läuft über `after_write_tx`, Personen laden über die Konstanten `PERSONEN` und `UEBER_EINHEIT`. Die Schalter `MIT_ADHOC`/`MIT_IST` sind zu einem zusammengelegt.

Die Posten-Spalten (drei gegen eine) passen nicht in Konstanten. Deshalb trägt der Trait je Art eigene Methoden:
- `check_posten_tx` → liefert Soll-Vorgabe, Qualifikation und Länge
- `insert_block_tx`
- `ueberschneidungen_tx`
- `before_write_tx` (Planung: Schreibschutz und `stand`; Einsatz: Org-Bezug)
- `after_write_tx` (Einsatz: Nachziehen der Ablösung)
- `zone_tx`
- `check_delete_tx` (Einsatz: `PAUSE_OFFEN`, belegter Block ohne Personal)

Der Kern ruft sie in der heutigen Reihenfolge der Prüfungen auf (Schreibschutz zuerst, Posten-422 vor Anzahl-422).

*Alternative:* Posten generisch über eine Aufzählung im Kern. Verworfen, weil Einheit/UHS gegen Planungsposten fachlich verschieden sind und eine Aufzählung beide Seiten koppelt.

### D3 Der Kern liefert eine neutrale Struktur, die Abbildung auf Wire bleibt je Seite

`load` im Kern baut Blöcke mit Personen und Prüfbefunden (`pruefung::pruefe`) als interne Struktur.
- Einsatz bildet sie auf `PlanBlockAnzeige` ab, Planung auf `PlanungBlockAnzeige`.
- `jetzt` wird übergeben; die Planung nutzt heute `Utc::now()` im Repo (P:498) und wird damit deterministisch testbar.
- Ist-Abgleich (`personen_daten`) und Wechselpunkte bleiben beim Einsatz.

### D4 `_tx`-Funktionen auf `&mut SqliteConnection`

Demo (`demo/planung.rs`) und Übernahme rufen Block- und Helferwege in fremden Transaktionen. Der Kern bietet daher `_tx`-Varianten an; die öffentlichen Wege rahmen sie mit `write_retry!` wie heute.

### D5 Routen teilen Request-DTOs und Personen-Übersetzung, nicht die Handler

- `HelferAnlegen`/`HelferAendern`, `VersionParams` und die Personen-Übersetzung gibt es nur noch einmal (`pub(crate)` in `routes/abloesung_schichtplan.rs`).
- Die Handler bleiben je Seite: Extraktor (`EinsatzSchreibzugriff<Abloesung>` gegen `PlanungsZugriff`), Modulsperren und Ereignis (`LiveEvent::Abloesung` gegen Org-Ereignis `planung`) unterscheiden sich, und ein gemeinsamer Handler bräuchte dafür Schalter.

Die Request-DTOs sind nur `Deserialize` und liegen nicht im OpenAPI-Schema, deshalb ist ihre Umbenennung wire-neutral.

### D6 Frontend: ein Editor mit Adapter

- `abloesung/schichtplan/SchichtplanEditor.tsx` trägt Dialog-Zustand, Mutationen, Zug und Ablage, Kopieren, Löschen, Block-Menü, Ansagen, Raster/Liste und Dialoge.
- `SchichtplanAnsicht` und `PlanungSchichtplan` bauen nur den Adapter: Daten, Zeilen, Personen, Vorgaben, Cache-Übernahme (Einsatz `setQueryData`, Planung zusätzlich `invalidate`), API-Aufrufe, Texte, Spannenleiste, Werkzeuge, optionaler Wechsel-Teil.
- `data-lfh` bleibt je Hülle („schichtplan-ansicht“, „planung-plan“).
- Der gemeinsame Druckinhalt kommt nach `abloesung/schichtplan/ausgabe/SchichtplanDruckInhalt.tsx`; Seitenhülle und Laden bleiben je Seite.

*Alternative:* Hooks statt Komponente (`useSchichtplanEditor`). Verworfen, weil das JSX (Grid, DnD, Dialoge) der größte doppelte Teil ist.

### D7 Helferliste allgemein, im Einsatz als Reiter der Werkzeugzeile

- `PlanungHelferListe` wird `abloesung/schichtplan/HelferListe.tsx` mit Props für Helfer, Blöcke, Lese-/Sperrzustand, API und Cache-Übernahme.
- Kennung und Herkunft zeigt die Liste nur lesend, wenn vorhanden.
- Ohne Personal (`helfer: null`) steht ein Sperrhinweis statt der Liste.
- Im Einsatz steht ein Umschaltknopf „Helfer“ mit Zahl vorn in der Werkzeugzeile. Ist er gedrückt, zeigt der Editor die Helferliste statt Wechsel-Leiste und Raster (Adapterfeld `alternative`); das entspricht dem Reiter der Planung. `data-lfh="schichtplan-helfer"`.

### D8 LFH-1312 als eigener Commit am Ende

*Stand nach dem Schlankheitspass:* Die Block- und Helferwege beider Repos, `schreibe_personen_tx` und `org_von` gibt es nicht mehr. Die Routen rufen die Kernfunktionen direkt (`create/update/delete_block_tx`, `create/update/delete_helfer_tx`). Umbenannt wird, was danach noch deklariert ist; die Liste unten ist die Ausgangslage.

- Umbenennungen:
  - Rust: `laden→load`, `block_anlegen/aendern/loeschen→create/update/delete_block`, `helfer_*→create/update/delete_helfer`, `pruefe_*_tx→check_*_tx`, `schreibe_personen_tx→write_personen_tx`, `grenzwerte_setzen→update_grenzwerte`, `org_von→load_org_id`, `posten_von→load_posten`.
  - Frontend: `lege…An/aendere…/loesche…→create…/update…/delete…`.
- Bleiben unverändert: „erzeugen“ (Oberflächenwort), alle Wire-Namen und die TS-Aliase in `api/types.ts`.
- Der Commit kommt am Ende, damit die Umbau-Commits im Diff lesbar bleiben.

## Risks / Trade-offs

- **[Ein Text oder Statuscode verschiebt sich unbemerkt]** → Vor dem Umbau Tests mit exakten Texten und Codes je Seite ergänzen. Abzudecken sind:
  - Überschneidung mit Zeitzone (Einsatz-Zone ungleich Org-Zone), CAS-Text
  - Höchstzahl Schichten und Helfer, Pause ohne Soll
  - fremder Helfer, fremde Person, fremde Qualifikation
  - Posten-Texte, beide Texte von „erzeugen ohne Länge“
  - Planung schreibgeschützt (409) auf allen Block- und Helferwegen
  - Ad-hoc-Text
- **[Reihenfolge der Blöcke/Personen ändert sich]** → Test je Seite auf die Reihenfolge; die Sortierung bleibt Methode der Art.
- **[SQL über `format!`]** → Nur `&'static str`-Konstanten, niemals Eingaben; Muster `vorlagendokument` mit `AssertSqlSafe`.
- **[Frontend-Verhalten ohne Komponententest]** → Vor dem Editor-Schnitt einen gemeinsamen Testsatz gegen beide Hüllen schreiben, der danach unverändert grün bleibt:
  - Zug ergibt den PATCH-Body
  - Kopie mit und ohne Personen
  - Löschen schließt nur den eigenen Dialog
  - Meldung beim Erzeugen
  - Ansagen
- **[Großer Diff]** → Aufgabengruppen sind je für sich grün und als eigene Commits geschnitten.
- **[Zeilenziel verfehlt]** Ziel war −900 bis −1 100 Zeilen; erreicht sind nach dem Schlankheitspass (von Ruben freigegeben) etwa Backend −362 und Frontend −173 ohne die neue Helferliste. Der Rest liegt in Code, der je Seite bleiben muss: verschiedene Wire-DTOs mit ihrer Abbildung, Posten-Fehlercodes (Internal beim Laden, NotFound beim Schreiben), die Testform `planung::repo::BlockEingabe`, Teilung beim Erzeugen.

## Migration Plan

Keine Datenmigration. Rückweg: Revert des Branches. Die Wire-Form bleibt, also gibt es weder für alte Clients noch für den Offline-Spiegel einen Übergang.
