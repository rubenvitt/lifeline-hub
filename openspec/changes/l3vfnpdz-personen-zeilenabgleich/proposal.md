# Proposal

## Why

Jedes `person`-Ereignis lässt heute jeden offenen Tab die ganze Personenliste (`GET …/personen`)
und die Personenauswahl neu laden. Gemessen am 13.11.2026 (SQLite mit allen Migrationen, 2 000
Personen mit gefüllten Freitexten): Die Abfrage selbst kostet 12,4 ms, die Antwort aber rund
3,1 MiB JSON. Bei einem MANV oder einer Evakuierung mit 1–2 Änderungen pro Sekunde lädt jeder Tab
also je Sammelfenster (300 ms) einige MiB, parst sie und zeichnet die Liste neu. Eine einzelne
Zeile wiegt rund 1,6 KB. Für Schäden gibt es den Zeilenabgleich schon (LFH-931); Personen sind die
Liste, die im Großschadensfall am schnellsten wächst (Zunder LLH-1682, Audit vom 12.11.2026).

## What Changes

- Neue Route `GET /api/einsaetze/{id}/personen/{pid}/zeile`: genau die Zeile, die die Liste dieser
  Sitzung zeigen würde (`PersonAnzeige`), **ohne** Eintrag im Zugriffsprotokoll, mit denselben
  Regeln wie die Liste (Modulrecht Personen, Stellenbindung der Geräte, Einheitengerät ohne
  Personalien). Eine stornierte oder für die Sitzung unsichtbare Person ist 404; der Tab nimmt
  sie dann aus seinen Listen. Die Detail-Route taugt nicht als Quelle: Jeder Abruf schreibt eine
  Audit-Zeile.
- Frontend: Der Zeilenabgleich bekommt das Ziel `personen`. Ein `person`-Ereignis mit
  `person_id` lädt nur diese Zeile und sortiert sie in die geladene Personenliste, die
  Personenauswahl und die Betroffenen je Betreuungsstelle ein. Die übrigen Abfragen, die das
  Ereignis heute abgleicht (Modulzähler, Betreuung, Registrierliste, Transportmittel), gleicht
  es weiter ab; die Anhangliste nur noch für diese eine Person.
- Eine Nachforderung mit Personenbezug sendet ihr `person`-Ereignis künftig mit `person_id`.
- Die Zeile trägt Name und Abschnitt der versorgenden Einheit per Join. Bisher hat jedes
  `person`-Ereignis die ganze Liste neu geladen und diese Angaben nebenbei aufgefrischt. Künftig
  sendet der Server `person` je versorgter Person, wenn eine Einheit umbenannt oder einem anderen
  Abschnitt zugeordnet wird (auch per Abruf aus dem Bereitstellungsraum oder Ablösung) und wenn
  ein Abschnitt umbenannt oder aufgelöst wird; über zehn Personen einmal ohne Kennung.
- Ändert sich eine Zeile im Tab, während ihr Abruf läuft (optimistische Änderung), wartet sie aufs
  nächste Fenster, statt überschrieben zu werden; auch für Schäden.
- Ohne Kennung, bei gescheitertem Zeilenabruf, nicht geladener Liste oder mehr als
  `ZEILEN_GRENZE` Personen je Fenster bleibt es beim vollen Abgleich, wie bei Schäden.

Für Anwender ändert sich nichts Sichtbares: Die Listen zeigen dieselben Daten, nur schneller und
mit weniger Last am Server.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `live-abgleich`: drei neue Requirements. „Ereignisse zu Personen gleichen zeilenweise ab“
  (Einsortieren, Storno, Betroffene einer Betreuungsstelle, Nachforderung, Grenze je Fenster),
  „Der Zeilenabruf einer Person ist nicht protokolliert“ und „Der Zeilenabgleich überschreibt
  keine lokale Änderung“ (gilt auch für Schäden). Das bestehende Requirement zu Entwürfen und
  Schäden bleibt unverändert.

## Impact

- Backend: `src/routes/einsatz_person.rs` (neuer Handler), `src/app.rs` (Route),
  `src/geraet/mod.rs` (Routenlisten der Geräte, die die Liste lesen),
  `src/routes/nachforderung.rs` (`person_id` im Ereignis), `src/routes/einsatz_einheit.rs` und
  `src/routes/einsatzabschnitt.rs` mit `src/einsatzabschnitt/repo.rs`,
  `src/routes/einsatz_bereitstellungsraum.rs`, `src/routes/abloesung.rs` mit
  `src/abloesung/repo.rs` (`person` je versorgter Person), Tests in `tests/einsatz_person.rs`,
  `tests/geraet_kopplung.rs`, `tests/nachforderung_person.rs`, `tests/abschnitt_namenstraeger.rs`,
  `tests/einsatz_bereitstellungsraum.rs` und `tests/abloesung.rs`.
- Frontend: `frontend/src/api/queryKeys.ts` (`ZeilenZiel`, `EINSATZ_STREAM_ZIELE.person`),
  `frontend/src/live/zeilenAbgleich.ts` (Ziel `personen`), `frontend/src/api/einsatzPerson.ts`
  (Zeilenabruf, Vergleich, Form der Auswahl), Tests daneben.
- Keine Migration, kein neues Antwort-DTO (die Route liefert das vorhandene `PersonAnzeige`),
  also auch kein Typ-Codegen-Lauf nötig.
