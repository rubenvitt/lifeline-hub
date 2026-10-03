# Design

## Context

Anlass: siehe `proposal.md`. Anforderungen: `specs/einsatz-fuehrungsstelle/spec.md` und die Deltas
zu `stab-funkplan`, `stab-fernmeldeskizze` und `einsatzkopf-live`.

Stand im Code (03.10.2026):

- **Funkplan** (`frontend/src/stab/funkplan.ts`, `pages/FunkplanPage.tsx`) leitet alles im Client
  aus fünf Listen ab (`FunkplanQuellen`, je mit `AbrufZustand`). Der Hinweis steht als feste
  `PaneelZeile` mit `GEGENSTELLE_HINWEIS` im Lücken-Paneel und als feste Zeile im Markdown.
- **Fernmeldeskizze** (`stab/fernmeldeskizze.ts`, `stab/FernmeldeskizzeBild.tsx`): die Wurzel
  „Einsatzleitung“ ist kein Modellknoten. Sie wird im Bild gezeichnet, mit „Gegenstelle nicht
  erfasst“; die Wurzelknoten bekommen `ohne-urteil`.
- **Lücken** (`stab/luecken.ts`): `verbindungsurteil(oben, unten)` ist die eine Regel für Kante
  und Lücke; `verbindungenOhneGemeinsameSprechgruppe` kennt nur Abschnitt- und Einheitspaare.
- **Sprechgruppen** (Migration 0073): M:N über `einsatzabschnitt_sprechgruppe` und
  `einsatz_einheit_sprechgruppe`, Prüfung `sprechgruppe::repo::pruefe_zuordenbar` (422),
  `SprechgruppenPicker` als antd-Form-Control (`value`/`onChange`).
- **Kopfdaten** (`routes/einsatz.rs::aktualisieren`, Gate `EinsatzVerwaltungszugriff`): Teil-Patch,
  danach `kopf_geaendert` (Ereignis `einsatz` + `einsatzliste`). `EinsatzAnzeige` geht auch in die
  Einsatzliste.
- **Einsatzdaten** (`pages/EinsatzdatenPage.tsx`): Paneel „Lagedaten“ aus `InlineAngabe`-Zeilen,
  „eine Zeile, ein Feld“ (`feldMutation`, Fehler an der Zeile).
- **Schwärzung** (`einsatz/schwaerzung_registry.rs`): jede Spalte jeder einsatz-scoped Tabelle
  klassifiziert, Guard entdeckt neue Tabellen selbst. `erreichbarkeit` an Abschnitt und Einheit ist
  `scrub(NullSetzen, Z_EINSATZ)`, `kommunikationsmittel` Retain.

## Goals / Non-Goals

**Goals:**
- Die Führungsstelle ist ein eigenes Datum des Einsatzes, mit derselben Sprechgruppen-Mechanik wie
  Abschnitt und Einheit.
- Funkplan-Tabelle, Druck, Lagebericht und Skizze lesen sie aus EINER Quelle über dieselben
  Funktionen wie die übrigen Stellen.

**Non-Goals:**
- Kein Leiter/Führer in der Zeile der Führungsstelle. Die Einsatzleitung ist eine App-Rolle und
  nicht dasselbe wie der Einsatzleiter nach FwDV; die Zelle bleibt „—“.
- Keine Übernahme in Organigramm, Einsatzbericht, Einsatzliste oder Akte der Aufbewahrung.
- Kein Offline-Lesen: der Funkplan steht nicht in `LAGEBILD_OFFLINE`, der neue Key auch nicht.
- Kein ETB-Eintrag beim Ändern (wie Kopfdaten und Sprechgruppen an Abschnitt und Einheit).
- `einsatz_mitgliedschaft.fuehrungsstelle` (je Person, LFH-461) bleibt unverändert.

## Decisions

### D1 · Ort der Bearbeitung: Paneel „Eigene Führungsstelle“ auf Einsatzdaten

Die Führungsstelle gehört dem Einsatz, nicht einem Sachgebiet. Die Seite Einsatzdaten ist für jede
Person mit Lesezugriff offen, trägt die Kopfdaten mit demselben Schreibrecht und hat das
Zeilenmuster schon (`InlineAngabe`, ein Feld je Speichern, Fehler an der Zeile). Das Paneel steht
unter „Lagedaten“, vier Zeilen:

| Zeile | Eingabe | Anzeige |
|---|---|---|
| Rufname | `Input` | Mono |
| Sprechgruppen | `SprechgruppenPicker` (Mehrfachauswahl, lokal anlegen) | TMO/DMO getrennt, Mono |
| Kommunikationsmittel | `Select` über `KOMMUNIKATIONSMITTEL` | Label (`kommunikationsmittelLabel`) |
| Erreichbarkeit | `Input` | Text |

Das Vollformular „Bearbeiten“ bleibt bei den Kopfdaten und nimmt die Führungsstelle nicht auf.

Verworfen:
- **Stab-Seite (S6-Zeile):** hängt an der Stab-Freigabe; in kleinen Einsätzen ohne Stab wäre die
  Führungsstelle nicht pflegbar, obwohl ein ELW funkt.
- **Im Funkplan selbst:** widerspricht „Der Funkplan MUST keine Bearbeitungsmöglichkeit bieten“
  (Spec `stab-funkplan`). Der Funkplan verweist stattdessen per Deeplink auf Einsatzdaten.
- **Vollformular:** der Picker legt lokale Sprechgruppen an und würde das Formular unnötig
  verlängern; die Zeile genügt.

### D2 · Datenhaltung: eigene Tabelle `einsatz_fuehrungsstelle`, eigener Endpunkt

Neue Migration (nächste freie Nummer über `alpha`, Prüfung mit `scripts/check-migrationen.sh`):

```sql
CREATE TABLE einsatz_fuehrungsstelle (
    einsatz_id           INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    rufname              TEXT,
    kommunikationsmittel TEXT,
    erreichbarkeit       TEXT
);
CREATE TABLE einsatz_fuehrungsstelle_sprechgruppe (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id)       ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)  ON DELETE CASCADE,
    PRIMARY KEY (einsatz_id, sprechgruppe_id)
);
```

- Die Zeile entsteht lazy beim ersten PATCH, der etwas ändert (`INSERT OR IGNORE`, dann ein
  `UPDATE` je gesendeter Angabe); ein leerer Patch legt nichts an und meldet nichts. Fehlt sie,
  liefert der GET alle Angaben leer.
- `GET /api/einsaetze/{id}/fuehrungsstelle` (`EinsatzLesezugriff`, kein Modul) →
  `FuehrungsstelleAnzeige { rufname?, sprechgruppen: Sprechgruppe[], kommunikationsmittel?,
  erreichbarkeit? }`, Sprechgruppen sortiert wie an Abschnitt und Einheit.
- `PATCH` derselbe Pfad (`EinsatzVerwaltungszugriff`, wie die Kopfdaten): Tri-State je Feld über
  `deserialize_optional_field` und `trimme_tri`, `sprechgruppe_ids` (Tri-State, `null` wie `[]`) ersetzt
  vollständig. `pruefe_kommunikationsmittel` (400) und `pruefe_zuordenbar` (422) laufen vor dem
  Schreiben; Upsert und Ersetzen der Zuordnung stehen in EINER Transaktion (`write_retry!`), damit
  ein 422 nichts teilweise speichert. Danach `kopf_geaendert`.
- Request-DTO handgepflegt (`FuehrungsstellePatch`), Response-DTO über Codegen.

Verworfen:
- **Spalten am `einsatz` und Felder im Kopf-PATCH:** `EinsatzAnzeige` geht in die Einsatzliste
  und an jede Stelle, die den Kopf liest; die Erreichbarkeit stünde dort, und die Sprechgruppen
  bräuchten einen Join je Listenzeile. Der Kopf-PATCH hätte zudem eine zweite Art Feld (Liste mit
  Fremdprüfung).
- **Ein Sonder-Abschnitt „Einsatzleitung“:** hinge an der Modulfreigabe der Abschnitte und
  verfälschte Abschnittszählung, Organigramm und Lagekarte.

### D3 · Live über `einsatz`, eigener Query-Key

`einsatzKeys.fuehrungsstelle(id)` kommt in `EINSATZ_KEYS` und in die Live-Liste des Ereignisses
`einsatz` (`EINSATZ_STREAM_EVENTS.einsatz`). Der PATCH ruft `kopf_geaendert`, wie jeder andere
`einsatz`-Emitter (Regel in `src/AGENTS.md`, Org-Ereignisse). Das Paneel setzt nach dem Speichern
die Antwort direkt in den Cache (wie `feldMutation`), damit die Fokusrückgabe den frischen Wert
trifft.

Verworfen: ein eigenes Ereignis `fuehrungsstelle`. Es bräuchte eine Modulzuordnung (Spec
`einsatzkopf-live`: außer `einsatz` gehört jedes Einsatz-Ereignis einem Modul), und die
Führungsstelle hat keines.

### D4 · Funkplan: sechste Quelle, Zeile `fs` vor den Wurzeln

- `FunkplanQuellen.fuehrungsstelle: { zustand: AbrufZustand; daten: Fuehrungsstelle | null }`.
- Die Erfasst-Regel steht EINMAL (`fuehrungsstelleErfasst`): Rufname, Kommunikationsmittel oder
  Erreichbarkeit nicht leer, oder mindestens eine Sprechgruppe.
- `baueFunkplan` stellt bei erfasster Führungsstelle eine Zeile `{ key: 'fs', art:
  'fuehrungsstelle', stelle: 'Führungsstelle', … }` vor die Wurzeln, ohne Kinder; TMO/DMO über
  `funk()`, Kommunikationsmittel über `kommunikationsmittelLabel` wie die übrigen Zeilen.
  `leitung: { art: 'leer' }`.
- Lücken-Paneel: die feste Zeile wird zu „nicht erfasst“ (Daten, nicht erfasst), „Grund“
  (gesperrt, nicht geladen, lädt) oder entfällt (erfasst). Der Hinweis steht weiter als letzte
  Zeile des Paneels, damit das erste Bild unverändert bleibt.
- Markdown: die Zeile steht als erste Zeile der Gliederung (über `zeileMarkdown`, also ohne
  Erreichbarkeit); die Lücken-Zeile „Eigene Gegenstelle“ folgt derselben Fallunterscheidung.
- Deeplink: `einsatzdatenPfad(einsatzId)`.
- Die Seite lädt die Führungsstelle mit eigener Weiche (`abrufZustand`). Die Übernahme bleibt
  gesperrt, solange auch diese Quelle lädt.

### D5 · Verbindung Führungsstelle → oberste Abschnitte über `verbindungsurteil`

- `verbindungenOhneGemeinsameSprechgruppe(abschnitte, einheiten, fuehrungsstelle)` urteilt
  zusätzlich jeden obersten Abschnitt (ohne bekannten Oberabschnitt) gegen die Sprechgruppen der
  Führungsstelle. `Stelle.art` bekommt `'fuehrungsstelle'` für `oben`. Fehlt der Führungsstelle
  jede Sprechgruppe, ergibt `verbindungsurteil` schon `ohne-urteil`, also keine Zählung.
- Zustand: schlechtester aus Abschnitten, Einheiten und Führungsstelle.
- `lokaleSprechgruppenOhneZuordnung` zählt die Zuordnungen der Führungsstelle mit (sonst wäre eine
  nur dort verwendete lokale Sprechgruppe eine falsche Lücke).
- Skizze: `baueFernmeldeskizze` nimmt die Sprechgruppen der Führungsstelle als `oben` der
  Wurzelknoten (vorher `null`). Die Wurzel bekommt ein kleines Modell `{ erfasst, rufname, tmo,
  dmo, kommunikationsmittel }`; `FernmeldeskizzeBild` zeichnet es statt „Gegenstelle nicht
  erfasst“ und verweist auf Einsatzdaten. Die Zahl der Kanten-Lücken bleibt gleich der des
  Paneels, weil beide aus `verbindungsurteil` kommen.

Verworfen: die Abschnitte im Funkplan als Kinder der Führungsstelle einhängen. Der Baum würde eine
Ebene tiefer, die Schlüssel und das Aufklappen änderten sich, und die Tabelle verlöre ihre
Gleichheit mit Organigramm und Meldebild. Die Verbindung steht in der Lücke und in der Skizze.

### D6 · Schwärzung

Registereintrag für beide Tabellen: `einsatz_fuehrungsstelle.erreichbarkeit` →
`scrub(NullSetzen, Z_EINSATZ)`, `rufname` und `kommunikationsmittel` Retain (Führungsstruktur,
Begründung wie bei Abschnitt und Einheit), Join-Tabelle ganz Retain (Struktur). Der Guard des
Registers wird ohne die Einträge rot; ein Schwärzungstest pinnt Nullen und Erhalt.

## Risks / Trade-offs

- [Paralleler Thread vergibt dieselbe Migrationsnummer] → vor dem Push `git fetch` +
  `scripts/check-migrationen.sh`; ein reiner Nummernkonflikt wird auf dem PR-Branch per Autofix
  umgelegt (LFH-1014).
- [Lücke „Verbindungen“ springt nach dem Erfassen der Führungsstelle an] → gewollt: das ist genau
  die Funkverbindung EL ↔ EA. Ohne Sprechgruppe an der Führungsstelle zählt nichts.
- [Erreichbarkeit im Ausdruck] → wie bei Abschnitt und Einheit (Entscheidung 30.09.2026): der
  Funkplan hängt im ELW aus; im Lagebericht und in der Skizze steht sie nie.
- [`einsatz`-Ereignis meldet auch `einsatzliste`] → harmlos, nur ein Neuabruf der Liste; der Weg
  über `kopf_geaendert` ist Projektregel.

## Migration Plan

- Neue Migration, nur additiv; bestehende Einsätze haben keine Zeile und gelten als nicht erfasst.
- Rollback: Commit zurücknehmen. Die Tabellen bleiben dann ungenutzt stehen (Migrationen werden nie
  gelöscht).
