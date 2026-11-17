# Design

## Context

Den Anlass beschreibt proposal.md unter „Why“. Heute gilt:

- Browser: `lage/ausfallJeEinheit.ts` baut das Meldebild-Raster (`baueMeldebildRaster`) und liest
  je Einheitenzeile die Gründe der Tönung (`toenungsGruende`): `ausfall` (eigene Mittel in der
  Kategorie „nicht verfügbar“, entfällt bei eigenem Einheitenstatus „nicht verfügbar“) und
  `ausfall_material` (eigene Posten und Beladung der eigenen Fahrzeuge mit Rolle Alarm oder
  Achtung, oder aufgebraucht). `useWasBrennt` macht daraus die Liste der Einheiten in Baumfolge.
- Server: `routes::lagemonitor::alarm` liefert den Block `alarm` nur an den gekoppelten
  Lagemonitor. Die Ausfall-Regel gibt es dort nicht, `alarmAusMonitor` setzt `ausfall: null`.

Die Prüfung am 17.11.2026 hat ergeben, dass die Regel keinen Kräftebaum braucht. Jede Einheit
zählt nur ihre eigenen Mittel (Spec `kraeftebaum`). Abgestellte Untereinheiten und die
Verschachtelung ändern nur die Folge, nie die Zahl einer Zeile.

## Goals / Non-Goals

**Goals:**
- Der Server berechnet für jede Einheit dieselbe Ja/Nein-Aussage „hat Ausfall“ wie der Browser,
  und beide nennen die Einheiten in derselben Folge.
- Das Fixture `regeln.json` bindet beide Seiten. Eine Änderung nur auf einer Seite macht einen
  Test rot.

**Non-Goals:**
- Die Anzahl je Einheit („2 Ausfall“) bleibt beim Meldebild und beim Überblick. Der Monitor
  nennt nur Namen, wie bei der Rückmeldung.
- Meldebild und Abschnittskarte im Überblick lesen weiterhin aus dem Browser. Das Meldebild
  filtert, eine Server-Zahl passt dort nicht.
- Keine weiteren Arten für den Monitor und kein Umbau der Monitor-Kacheln (LLH-1746).

## Decisions

### D1 Flache Zählung am Server, ohne Baum (abgestimmt 17.11.2026, Variante A)

Eingaben sind die aktiven Zeilen des Einsatzes: Einheiten ohne `aufgeloest_at`, Personal und
Fahrzeuge ohne `beendet_at`, Material ohne `beendet_at`. Zuordnung wie `kraeftebaum` im Browser:

- Personal und Fahrzeuge gehören zu ihrer `einheit_id`, wenn diese Einheit aktiv ist, sonst zu
  „Ohne Einheit“.
- Material mit Ort Einheit gehört zu dieser Einheit (unbekannt oder aufgelöst: „Ohne Einheit“).
  Material mit Ort Fahrzeug gehört als Beladung zur Einheit dieses Fahrzeugs, aber nur, wenn das
  Fahrzeug aktiv ist; sonst fällt es weg. Material ohne Ort gehört zu „Ohne Einheit“, Material an
  UHS oder Bereitstellungsraum fällt weg.
- Ausfall der Mittel: Personal oder Fahrzeug mit Statuskategorie `nicht_verfuegbar`. Er zählt
  nicht, wenn der abgeleitete Status der Einheit selbst die Kategorie `nicht_verfuegbar` trägt.
  „Ohne Einheit“ hat keinen Status.
- Ausfall des Materials: Status `defekt`, `verbraucht` oder `desinfektion_noetig` (Rollen Alarm
  und Achtung im Vertrag `materialStatus`), oder aufgebraucht (Verbrauchsgut, `ausgegeben >= menge`).
- Eine Einheit hat Ausfall, wenn Mittel- oder Material-Ausfall größer als null ist.

Verworfen: Variante „Browser liest vom Server“. Das Meldebild tönt aus gefilterten Listen im
Browser, es bliebe also bei zwei Umsetzungen, und ein Fixture wäre trotzdem nötig.

### D2 Lage der Regel im Server: `src/einsatz/ausfall.rs`

Ein reiner Kern `einheiten_mit_ausfall(&AusfallEingabe) -> Vec<String>` auf schlichten Merkmalen
(wie `einsatz::zaehler`), dazu ein Lader `load_einheiten_mit_ausfall(pool, einsatz_id)`.

- Einheiten mit Name, `sortier` und abgeleitetem Status liest der Lader über
  `einheit::repo::liste`. So gibt es genau eine Ableitung des Einheitenstatus
  (`leite_status_ab`), und die Liste ist schon nach `sortier, id` geordnet. Der Aufwand ist
  vertretbar, weil der Monitor alle 30 s abruft.
- Personal, Fahrzeuge und Material liest er mit je einer schmalen Abfrage: nur Fremdschlüssel,
  Statuskategorie (über `personal_status` bzw. `fahrzeug_status`) und die Materialspalten. Namen
  von Personen liest er nicht.
- Die Materialregel bekommt in `material` eine Methode `MaterialStatus::ist_ausfall()` und eine
  freie Funktion für „aufgebraucht“. Das Fixture pinnt alle fünf Status und den Fall
  „aufgebraucht“.

Verworfen: den Kern in `routes/lagemonitor.rs` legen. Der Fixture-Test liest nur die
Bibliothek, und die Route soll schlank bleiben.

### D3 Fixture-Abschnitt `ausfall`

`regeln.json` bekommt `ausfall` mit `einheiten` (id, name, sortier, aufgeloest,
status_kategorie), `personal` (einheit_id, status_kategorie, beendet), `fahrzeuge` (id,
einheit_id, status_kategorie, beendet), `material` (Ort als einheit_id / fahrzeug_id / uhs_id /
br_id, status, art, menge, ausgegeben, beendet) und `erwartet`, die Namensliste in Folge. Die
Fälle decken ab: eigener Einheitenstatus „nicht verfügbar“ mit und ohne Material, Beladung eines
eigenen Fahrzeugs, Beladung eines beendeten Fahrzeugs, Material an UHS und BR, aufgelöste Einheit
→ „Ohne Einheit“, entlassenes Personal, aufgebrauchtes Verbrauchsgut und eine Folge, in der
`sortier` von der Anlage abweicht.

- Rust (`tests/verdichtung_fixture.rs`) ruft den Kern aus D2 auf.
- Vitest (`lage/verdichtungFixture.test.ts`) baut aus denselben Zeilen `Rohdaten` und ruft
  `einheitenMitAusfall` aus `lage/ausfallJeEinheit.ts` auf. Das ist dieselbe Funktion, die
  `useWasBrennt` nutzt. Getestet wird also der echte Weg über `toenungsGruende`, kein Nachbau.

### D4 Folge der Einheitenliste (abgestimmt 17.11.2026)

Beide Seiten ordnen nach `sortier`, dann `id`, „Ohne Einheit“ zuletzt. Der Browser sortiert
dafür ausdrücklich in `einheitenMitAusfall` und verlässt sich nicht auf die Folge der Abfrage.
Der Server übernimmt die Folge von `einheit::repo::liste` (`ORDER BY e.sortier, e.id`). Das
Fixture prüft sie mit einem Fall, in dem `sortier` von der Anlage abweicht.

Verworfen: die Baumfolge am Server nachbauen (zweite Umsetzung von Abschnittsrang und
Abstellung, das Risiko aus D6 der Vorgänger-Change) oder flach nach Abschnittsrang (braucht den
Rang am Server und bringt kaum mehr).

### D5 Antwort und Monitor

`LagemonitorAlarm` bekommt `ausfall: Vec<String>`. Das Feld ist immer gesetzt, bei keinem Ausfall
als leere Liste. `alarmAusMonitor` macht daraus
`{ zustand: 'daten', wert: [{ id: null, name }] }`. Fehlt das Feld (älterer Server), bleibt die
Quelle `null`. Der Monitor meldet sich dann nicht als unvollständig, wie bisher.

Rechte: Der Block prüft wie bisher keine Modulrechte (Change `kcjecn9e`, D12). Er trägt nur
Einheitsbezeichnungen, wie schon bei der Rückmeldung. Auch die Modulfreigaben des Einsatzes
beachtet er nicht, wie bei allen übrigen Arten des Blocks: Ist etwa das Modul Material im
Einsatz ausgeblendet, fehlt der Material-Ausfall in Überblick und Lagebild, auf dem Monitor
steht er (Review 17.11.2026). „Gleiche Einheiten wie im Überblick“ gilt deshalb bei voller
Freigabe. Ob der ganze Block ausgeblendete Module weglassen soll, ist eine eigene Aufgabe. Lagebild für Externe und API v1 nutzen
`verdichte` ohne `alarm` und bleiben unverändert.

## Risks / Trade-offs

- [Zwei Umsetzungen derselben Regel] → Das Fixture bindet sie. Die Fälle in D3 decken jeden Zweig
  der Zuordnung ab, und `materialVerdichtungKern.test.ts` meldet schon jetzt, wenn ein
  Materialstatus eine neue Rolle bekommt.
- [Abweichung innerhalb einer Minute] Browser und Monitor fragen zu verschiedenen Zeitpunkten
  ab → Das ist dieselbe Lage wie bei allen übrigen Arten. Die Akzeptanz „zur selben Minute“
  meint denselben Datenstand.
- [Folge im Überblick ändert sich] Bisher galt die Baumfolge → Nur bei mehreren Einheiten mit
  Ausfall sichtbar, mit dem Menschen abgestimmt.
- [Last] `einheit::repo::liste` je Monitor-Abruf → Der Abruf läuft alle 30 s und je Sofortmeldung
  auf einem einzigen Gerät; die Liste bedient auch die Kräfte-Seiten.

## Migration Plan

Keine Migration. Das neue Feld ist additiv, ein alter Monitor-Client ignoriert es.
