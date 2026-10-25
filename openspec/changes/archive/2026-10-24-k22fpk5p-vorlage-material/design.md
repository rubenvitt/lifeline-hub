# Design

## Context

Das Bilden aus einer Vorlage (`src/einheit/aus_vorlage.rs`) rechnet einen Plan (`plan_tx`), gleicht
die Anfrage rein dagegen ab (`check_against_plan`, 422 mit Gründen je Zeile vor dem ersten
Schreiben) und schreibt dann in einer Transaktion: Einheiten top-down, Fahrzeuge, Personen. Der
Handler (`routes/einsatz_einheit.rs`, `aus_vorlage_bilden`) prüft vorher die Rechte je Modul,
schreibt den einen ETB-Sammeleintrag und sendet die Live-Ereignisse nach dem Commit.

Material steht seit LLH-1224 als Posten (`einsatz_material`) mit Art, Menge und genau einem Ort:
Einheit, Fahrzeug, UHS, Bereitstellungsraum oder keiner. Disponiert wird Stamm-Material über
`disposition_repo::disponiere_stamm_tx`. Diese Funktion prüft Org und Dienststatus, friert den
Snapshot ein, setzt die Art aus dem Stamm, hält ein Gerät bei Menge 1 und ein Gerät mit
Bestandsnummer einmal im Einsatz (409). Den Ort setzt `ort::set_ort_tx`.

Die Vorlage (`src/einheit_vorlage/`) führt Fahrzeuge und Stammbesetzung in zwei Kindtabellen der
Migration 0190. Jede Liste wird per PUT als Ganzes ersetzt.

## Goals / Non-Goals

**Goals:**

- Material-Positionen in der Vorlage pflegen und beim Bilden in derselben Transaktion an Einheit
  oder Fahrzeug disponieren.
- Dieselbe Form wie bei Fahrzeugen und Personen: Vorschau mit Zustand je Zeile, Häkchen, Gründe je
  Zeile, ein ETB-Eintrag, Rechte je Modul.

**Non-Goals:**

- Kein „umhängen“ für Material. Ein Gerät mit Bestandsnummer, das schon im Einsatz steht, ist
  gesperrt (D4).
- Kein „auch in“ für Material-Positionen. Dasselbe Material in mehreren Vorlagen ist der Normalfall
  bei Verbrauchsgut.
- Kein Ad-hoc-Material in der Vorlage, nur Stamm-Material.
- Keine Material-Positionen in den Demo-Vorlagen.
- Kein Ausgeben, Status oder Aufteilen beim Bilden. Jeder Posten beginnt einsatzbereit ohne
  Ausgabe.

## Decisions

### D1 Eigene Tabelle mit Ersatzschlüssel

`einheit_vorlage_material (id INTEGER PRIMARY KEY, vorlage_id … ON DELETE CASCADE, material_id
REFERENCES material(id), menge INTEGER NOT NULL CHECK (menge >= 1), fahrzeug_id REFERENCES
fahrzeug(id), sortier INTEGER NOT NULL)`, dazu je ein Index auf `vorlage_id` und `material_id`.
Die Migration bekommt die nächste freie Nummer über der höchsten auf `alpha`.

Ein Ersatzschlüssel statt `(vorlage_id, material_id)`, weil dasselbe Material in einer Vorlage
mehrfach stehen darf, etwa ein Rucksack auf RTW 1 und einer auf RTW 2. Die Anfrage des Bildens
nennt deshalb die Position (`vorlage_material_id`), nicht das Material.

`material_id` und `fahrzeug_id` bleiben NO ACTION wie in 0190. Das Entfernen der Demo-Daten löscht
erst die Demo-Vorlagen (Kaskade auf die Positionen) und versucht dann das Material. Verweist eine
echte Vorlage auf Demo-Material, scheitert dessen Löschen am Fremdschlüssel, und es bleibt stehen
(`demo/entfernen.rs`, „behalten“). Code muss sich dafür nicht ändern; ein Test belegt es.

*Alternative:* Material als JSON-Spalte an der Vorlage. Verworfen: Kein Fremdschlüssel hielte das
Material, und die Prüfung „einmal im Baum“ bräuchte `json_each` über alle Vorlagen.

### D2 Ersetzen der Liste und ihre Regeln

`PUT /api/einheit-vorlagen/{id}/material` mit `[{material_id, menge, fahrzeug_id?}]`, nur für
Admins, wie die Personal-Liste. Reihenfolge der Liste ist `sortier`. Geprüft wird in dieser
Reihenfolge:

1. Mehr als 50 Positionen oder eine Menge unter 1 ergeben 400, vor jeder Abfrage.
2. Material fremd oder unbekannt ergibt 422 (Verweis). Ein Fahrzeug, das nicht in der Vorlage
   steht, ergibt ebenfalls 422.
3. Neu außer Dienst ergibt 422. „Neu“ heißt: Die `material_id` stand vorher nicht in dieser
   Vorlage. So bleibt ein später außer Dienst gestelltes Material speicherbar, wie bei
   Fahrzeugen.
4. Art des Stamms: Ein Gerät mit Menge über 10 ergibt 422 (`GERAET_JE_POSITION_MAX`), ein Gerät
   mit Bestandsnummer und Menge über 1 ebenfalls.
5. Ein Gerät mit Bestandsnummer, das in einer anderen Vorlage desselben Baums steht oder zweimal
   in der Liste, ergibt 422.

Beim Ersetzen der Fahrzeugliste fällt `fahrzeug_id` der Positionen auf entfernten Fahrzeugen auf
NULL, also an die Einheit. Das ist dieselbe Regel wie für die Fahrzeugbindung der Personen.

Die Antwort ist die Vorlage mit `material: [{id, material_id, bezeichnung, art, bestandsnummer?,
menge, fahrzeug_id?, dienststatus, ist_demo}]`, live aus dem Stamm gelesen.

### D3 Ort beim Bilden: Fahrzeug, sonst Einheit

Kommt das Fahrzeug der Position mit (es steht in der Wahl), ist der Ort sein `einsatz_fahrzeug`.
Sonst ist der Ort die neue Einheit der Position. Das gilt auch für eine Position ohne Fahrzeug.
Die Seite zeigt im zweiten Fall „an der Einheit“, wie „ohne Fahrzeug“ bei der Person.

*Alternative:* Material eines abgewählten Fahrzeugs weglassen. Verworfen: Die Führung kann die
Position selbst abwählen, ein stilles Weglassen fiele erst im Einsatz auf.

### D4 Zustände: neu, außer Dienst, schon im Einsatz

Eigenes Enum `VorschauMaterialZustand` (`wire_enum!`, Werte `neu`, `ausser_dienst`,
`im_einsatz`) statt neuer Werte in `VorschauZustand`. „Frei“, „gebunden“ und „entlassen“ ergeben
für Material keinen Sinn, weil jedes Bilden neue Posten anlegt. Nur ein Gerät mit Bestandsnummer
kann „im Einsatz“ sein, denn Verbrauchsgut und Gerät ohne Nummer bleiben mehrfach disponierbar
(Spec `material-modell`). Gesperrt sind `ausser_dienst` und `im_einsatz`. Der Grund „schon im
Einsatz“ entspricht dem Wort der Auswahl „Material disponieren“.

*Alternative:* „gebunden“ mit Umhängen, das den Ort des laufenden Postens auf die neue Einheit
setzt. Zurückgestellt (Non-Goal): Es braucht einen zweiten Schreibweg für bestehende Posten samt
ETB-Text, und den Fall gibt es nur bei nummerierten Geräten. Ein Nachzug ist möglich, ohne den Wire
zu brechen: Das Enum bekäme einen Wert dazu.

### D5 Plan liest gesammelt, Bilden schreibt je Posten

`plan_tx` liest mit `Lesen.material` alle Positionen des Baums in **einer** Abfrage über
`json_each` der Vorlagen-IDs. Die Abfrage joint den Stamm (Art, Bestandsnummer, Dienststatus,
Bezeichnung) und prüft per `EXISTS`, ob ein aktiver Posten desselben Materials im Einsatz steht.
So bleibt die Zahl der Anweisungen unabhängig von der Zahl der Positionen (Spec, „gedeckelt“).
`check_against_plan` bekommt die Material-Wahl dazu und liefert Gründe mit `ZeilenArt::Material`
(Wire `material`, `id` = `vorlage_material_id`).

`bilde_tx` disponiert nach den Personen, je gewählter Position in Vorlagenreihenfolge. Je Posten
ruft es `disponiere_stamm_tx` (Menge 1 je Stück beim Gerät, sonst die Menge) und danach
`set_ort_tx` mit dem Ort aus D3. Beide schreiben kein ETB. Das 409 von `disponiere_stamm_tx` bleibt
als Netz. Der Abgleich hat den Fall vorher als 422 an der Zeile gemeldet, weil er unter
`BEGIN IMMEDIATE` dieselbe Lage sieht.

*Alternative:* Ein INSERT mit Ort in einem Zug, an `disponiere_stamm_tx` vorbei. Verworfen: Die
Prüfungen des Material-Modells (Art, Snapshot, Stück frei) gäbe es dann zweimal.

### D6 ETB-Text mit Budget

`etb_text_aus_vorlage` bekommt den Teil `Material: 50× Wolldecke, 1× Sanitätsrucksack`, je
Position Menge und Bezeichnung des Snapshots, nach den Kräften und vor „umgehängt“. Ein Gerät mit
Menge 3 erscheint als „3× Sanitätsrucksack“, nicht dreimal. Der Höchstfall ohne Material liegt
schon über 12 000 Zeichen (Test `aus_vorlage_hoechstfall_bleibt_unter_der_etb_grenze`). 50
Bezeichnungen zu je 200 Zeichen sprengten `etb::INHALT_MAX`. Deshalb nimmt der Material-Teil
Positionen nur bis zu einem Budget auf, das den Rest des Texts frei lässt, und schließt dann mit
„und N weitere“. Der Höchstfall-Test wächst um 50 lange Positionen.

### D7 Rechte und Live

Nennt die Anfrage Material, verlangt der Handler `fordere_zielmodul::<Material>` (403 vor jedem
Schreiben). Die Vorschau meldet `material_gesperrt`, wie bei Fahrzeugen und Personal. Nach dem
Commit sendet der Handler `sse_material` je neuem Posten. Dazu kommt das Einheiten-Ereignis, das
ohnehin für jede neue Einheit läuft. Die Antwort `AusVorlageErgebnis` nennt `material` (die neuen
`einsatz_material.id`).

### D8 Frontend

- **Verwaltung:** `MaterialSection` neben `FahrzeugeSection` und `StammbesetzungSection`. Eine
  Tabelle zeigt Bezeichnung (mit Bestandsnummer), Art, Menge, Ort (Auswahl „Einheit“ oder ein
  Fahrzeug der Vorlage) und „außer Dienst“ als Wort. Hinzufügen läuft über eine Auswahl aus dem
  Stamm, nur Material in Dienst. Ein Gerät mit Bestandsnummer hat die Menge fest auf 1. Gespeichert
  wird die ganze Liste. Ein 422 steht an der Sektion.
- **Bilden:** `ausVorlageKern.ts` erweitert `Wahl` um `material` (Vorgabe an, außer bei
  gesperrtem Zustand), `reconcileWahl`, `gewaehlteZeilen`, `zusammenfassung` (nur mit Material in
  der Vorlage: „…, 2 Material“), `buildAnfrage` und `gruendeJeZeile` (Schlüssel `material:<id>`).
  Dazu kommt `anDerEinheit(position, wahl)`. Die Seite zeigt die Positionen je Einheit unter
  Fahrzeugen und Personen, mit Häkchen, Zustandswort, Menge und Ort.

## Risks / Trade-offs

- [Viele Posten beim Bilden: bis 50 Positionen × 10 Geräte = 500 Posten und ebenso viele
  Live-Ereignisse] → Das Schreiben je Posten ist in SQLite billig. Die Ereignisse laufen über den
  gebündelten Live-Kanal, der Client entwertet je Bereich. Die Deckel aus D2 halten den Fall
  begrenzt.
- [Stamm-Art ändert sich nach der Pflege, etwa ein Gerät bekommt eine Bestandsnummer bei Menge 3] →
  Vorschau und Bilden lesen den Stamm von jetzt, und ein Gerät mit Bestandsnummer ergibt genau
  einen Posten (Spec). Die Vorlage selbst bleibt stehen, bis der Admin sie speichert. Dann greift
  die Prüfung aus D2; der Client schickt ein Stück dabei mit Menge 1, sonst sperrte die alte Menge
  jedes Speichern. Nachtrag aus dem Review:
  - Ein Verbrauchsgut mit großer Menge, das im Stamm zum Gerät wird, ergäbe einen Posten je Stück.
    Deshalb deckelt das Bilden Geräte auf `GERAET_JE_POSITION_MAX` (die Vorschau zeigt die
    gedeckelte Menge), und der PUT nimmt höchstens 100 000 je Position (400).
  - Dasselbe Gerät in zwei Vorlagen eines Baums, das erst später eine Bestandsnummer bekommt, ließ
    das Bilden mit 409 scheitern. Die zweite Position gilt jetzt im Plan als „im Einsatz“, der
    Grund steht an der Zeile.
- [Die Positions-ID ändert sich mit jedem Ersetzen der Liste] → Wird die Vorlage zwischen Vorschau
  und Bilden gespeichert, meldet das Bilden „nicht in der Vorlage“ an der Zeile, wie bei
  Fahrzeugen und Personen. Die Seite lädt die Vorschau neu.

## Migration Plan

Eine neue, rein additive Migration (neue Tabelle, keine Datenänderung). Rückweg: Die Tabelle
bleibt ungenutzt, wenn der Code zurückgerollt wird.
