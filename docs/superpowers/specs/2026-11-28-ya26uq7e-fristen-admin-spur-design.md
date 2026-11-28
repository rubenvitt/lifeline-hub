# Aufbewahrungsfristen der Org in der Admin-Spur (LLH-2140)

Zunder: https://zunder.rubeen.dev/#/aufgabe/ya26uq7eqg0ori83c8l2r2ik

## Ziel

`PUT /api/org-settings` ändert drei Fristen, die über das Löschen von Einsatzdaten entscheiden:
die Aufbewahrungs-Dauer (`retention_dauer_tage`), die Skelett-Frist (`skelett_dauer_tage`) und
die Nachbereitung (`nachbereitung_tage`). Am heikelsten ist die Skelett-Frist: wird sie
verkürzt, löscht der nächste Purge-Lauf unumkehrbar. Heute verlangt das Verkürzen eine
Bestätigung (409 ohne `skelett_dauer_bestaetigt`), aber niemand kann später nachlesen, wer
verkürzt hat. Künftig steht jeder echte Wechsel einer dieser Fristen in der Admin-Spur, mit
Person, Zeitpunkt, altem und neuem Wert.

## Bediensicht

Unter „Zugangsprotokoll“, Reiter „Zugangsänderungen“, erscheinen drei neue Aktionen:

- „Aufbewahrungs-Dauer geändert“
- „Skelett-Frist geändert“
- „Nachbereitung geändert“

„Detail“ zeigt den Wechsel in Tagen, etwa „3650 → 365 Tage“. Eine leere Frist heißt „keine“,
also „keine → 365 Tage“ beim ersten Setzen und „365 Tage → keine“ beim Leeren. Wer das Formular
„Einsatz-Vorgaben“ mit unveränderter Frist speichert, hinterlässt keine Zeile. Ändert eine
Anfrage zwei Fristen, entstehen zwei Zeilen.

## Ansätze

1. **Drei Aktionen, je Frist eine (gewählt).** Folgt dem Muster der Ortungsschalter (LLH-2120):
   eigene Aktion, eigenes Ziel (`aufbewahrung_frist`, `skelett_frist`, `nachbereitung_frist`).
   Der Aktionsfilter des Zugangsprotokolls trennt die heikle Skelett-Frist von den übrigen.
2. **Eine Aktion `frist_geaendert`, die Frist in den Angaben (verworfen).** Kompakter, aber nicht
   filterbar, und die Angaben bekämen ein drittes Feld nur zur Unterscheidung.
3. **Zusätzlich ein Hinweis „verkürzt“ (verworfen).** Die beiden Zahlen zeigen es schon.

## Entwurf

### Backend

- `AdminAktion` (`src/auth/admin_audit.rs`) bekommt `AufbewahrungFristGeaendert`,
  `SkelettFristGeaendert` und `NachbereitungFristGeaendert` mit den Wire-Werten
  `aufbewahrung_frist_geaendert`, `skelett_frist_geaendert`, `nachbereitung_frist_geaendert`.
- `ZugangsAngaben` bekommt `tage_vorher: Option<i64>` und `tage: Option<i64>`. Fehlt ein Feld,
  war bzw. ist die Frist leer. Mindestens eins steht immer, denn es wird nur bei einem Wechsel
  geschrieben; `aus_detail` erkennt die Angaben also wieder.
- `org::einstellungen::speichern` liest die drei Fristen vor dem Schreiben in derselben
  `BEGIN IMMEDIATE`-Transaktion und gibt sie als `Gespeichert::fristen_vorher` zurück (Muster
  `ortung_vorher`). Der Handler `routes::org_einstellungen::setzen` vergleicht sie mit dem
  Endstand aus `Gespeichert::einstellungen` und schreibt je echtem Wechsel eine Zeile.
- Migration `0392_admin_audit_fristen.sql`: Neuaufbau von `admin_audit` mit erweitertem
  aktion-CHECK nach Muster `0386_admin_audit_ortung.sql` (Blatt-Umbau, ohne
  `-- no-transaction`).
- Typ-Codegen neu erzeugen (`scripts/check-typ-codegen.sh`), beide Dateien mitcommitten.

### Frontend

- `AKTION_TEXT` (`frontend/src/zugangsprotokoll/zugangsprotokollText.ts`) mit den drei Texten.
- Neue Funktion `fristText(a)`: „<vorher> → <neu>“ mit „N Tage“, „1 Tag“ oder „keine“;
  `undefined`, wenn weder `tage` noch `tage_vorher` steht. `AngabenAnzeige` zeigt sie vor
  `instanzText`.

### Doku

`docs/anwender/kapitel/zugangsprotokoll.md`, Liste der Zugangsänderungen: ein Eintrag für die
drei Fristen (wo man sie ändert, dass nur ein echter Wechsel zählt).

## Nicht im Umfang

- Die Kategorie-Vorgaben (`aufbewahrung_kategorien`, Fristen je Kategorie) bleiben ohne Spur.
  Bei Bedarf eine eigene Aufgabe.
- Die 409-Prüfung der Skelett-Frist liest den alten Wert weiter außerhalb der Transaktion. Die
  Spur hängt nicht daran.

## Tests

- Integration (`tests/org_einstellungen.rs`): Wechsel jeder Frist schreibt eine Zeile mit
  Akteur, Ziel und Angaben; dieselben Werte erneut speichern schreibt nichts; Leeren schreibt
  `tage_vorher` ohne `tage`; ein 409 ohne Bestätigung schreibt nichts; eine Führungskraft (403)
  schreibt nichts.
- Unit (`src/org/einstellungen.rs`): `fristen_vorher` kommt aus der Speicher-Transaktion.
- `jede_aktion_passiert_den_db_check` deckt die neuen Werte gegen die Migration ab.
- Frontend (`zugangsprotokollText.test.ts`): Texte der Aktionen und `fristText` für Setzen,
  Ändern, Leeren und Einzahl.
