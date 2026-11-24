# Fahrzeugortung: Positionen aus dem Einwurf auf gekoppelte Einsatzfahrzeuge (LLH-2091)

**Status:** Entwurf, wartet auf Freigabe · **Datum:** 2026-11-24 · **Zunder:**
https://zunder.rubeen.dev/#/aufgabe/fjftaovqeaj6eztbtnjt9bpy · **Route:** `entwurf` (E1 Vorrang,
E2 Regel „Ortung nur Ehrenamt“, E3 Backend, Frontend, Doku)

## Absicht

Ruben hat das Gate aus LLH-1199 am 24.11.2026 geöffnet, beschränkt auf Ehrenamt: Das BetrVG gilt
für Ehrenamtliche nicht (§ 5 Abs. 2 Nr. 3), die DSGVO immer. Erster Prüfstein ist ein FüKw, dessen
Gerät (Traccar Client oder OsmAnd) seine Position an einen Einwurf-Zugang mit Scope
`positionen:write` meldet. Diese Position soll den Marker des Fahrzeugs auf der Lagekarte live
bewegen, solange das Gerät im laufenden Einsatz an das Fahrzeug gekoppelt ist. Ohne Kopplung oder
nach dem Einsatzende ändert ein Einwurf kein Fahrzeug. Es gibt keinen Verlauf.

Die Machbarkeit steht in `2026-06-27-lage-live-fahrzeug-tracking-machbarkeit.md`. Den Quellpfad
gibt es seit LLH-1654: `position_letzte` hält je Zugang und Kennung die letzte Position und löscht
sie 24 Stunden nach dem Empfang. Der Einwurf-Entwurf
(`openspec/changes/archive/2026-11-13-s1i56dpt-einwurf-zugang/design.md`, D5) hat „Zugang je
Fahrzeug direkt nach `einsatz_fahrzeug.lat/lon`“ verworfen und „nur im Einsatz“ der Ortung
überlassen.

## Ziele

- Eine Kennung eines Einwurf-Zugangs lässt sich im Einsatz an ein disponiertes Einsatzfahrzeug
  koppeln und wieder trennen.
- Eine neue Position einer gekoppelten Kennung schreibt `einsatz_fahrzeug.lat/lon` und geht über
  das vorhandene Live-Ereignis `fahrzeug` an alle Clients.
- Der Marker zeigt, woher die Position stammt (GPS oder manuell) und wie alt eine GPS-Position
  ist; über 10 Minuten heißt sie „veraltet“.
- Ohne Freischaltung der Org wird nur mit der Bestätigung „Besatzung ist ehrenamtlich“ gekoppelt.
- Eine DSFA-Vorlage liegt im Anwenderkapitel „Anbindungen“.

## Nicht-Ziele

- Personenortung, Pager, eigene Besatzungs-App.
- Positionsverlauf, Spur auf der Karte, Geofencing, Ankunftserkennung.
- Ortung in gespiegelten Einsätzen und Weiterleitung von Positionen an das führende ELW
  (Folgeaufgabe, s. „Offen für später“).
- Ein dauerhaftes Merkmal „ehrenamtlich“ an Personen oder Stammfahrzeugen.
- Kopplung am Stammfahrzeug oder vorab in der Verwaltung.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Irgendeine Tabelle hält mehr als den aktuellen Wert je Fahrzeug bzw. je Kennung.
- Eine Position erreicht ein Fahrzeug außerhalb eines laufenden Einsatzes oder ohne Kopplung.
- Die Antwort an das Gerät verrät, ob eine Kennung gekoppelt ist oder die Übernahme scheiterte.
- Ein Hauptamtlicher wird geortet, ohne dass die Org es bewusst freigeschaltet hat.
- Die Karte bewegt die Kamera von selbst, weil ein Fahrzeug weitergefahren ist.

## Rahmen

- **ADR-0023** bleibt in Kraft: der Einwurf schreibt nur in seine Ablage, ändert keinen Einsatz,
  liest nichts, antwortet ohne Daten. Die Übernahme ist ein **eigener Schritt außerhalb des
  Einwurfs** und braucht eine neue ADR (ADR-0098, ergänzend, kein `ersetzt`).
- **ADR-0005:** die neuen Einsatzrouten nutzen genau einen Gate-Extraktor
  (`EinsatzSchreibzugriff<Fahrzeuge>` bzw. Lesezugriff).
- **ADR-0006:** die Positionsquelle ist ein `wire_enum!` mit Eintrag in
  `tests/enum_wire_kontrakt.rs`. **ADR-0012:** Zeitstempel in UTC `zeit::FORMAT`.
- **ADR-0097:** Routen englisch (Glossar `scripts/api-routen-woerter.tsv`), neue Request- und
  Response-Typen mit englischen Wire-Feldern; neue Felder in `EinsatzFahrzeugAnzeige` folgen dessen
  Sprache (deutsch).
- Live-Verteilung nach dem Commit, außerhalb von `write_retry!` (`src/AGENTS.md`).
- Gespiegelte Einsätze sind schreibgeschützt (Trigger `einsatz_fahrzeug_spiegelschutz_u`); ein an
  einen Hub gekoppeltes ELW nimmt keinen Einwurf an.
- `einsatz_aenderung` hält nur Schlüssel, keine Werte; sie ist kein Verlauf. `einsatz_fahrzeug`
  steht nicht in `public_api::lage::QUELLEN`, Positionen gehen also nicht in die API v1.
- Der Einsatzabschluss (`einsatz::repo::abschliessen`) setzt `einsatz_fahrzeug.beendet_at` nicht;
  die Ortung muss den Einsatzstatus selbst prüfen und die Kopplungen beim Abschluss lösen.

## Ansätze

Am Checkpoint (24.11.2026) lagen drei Wege für die Übernahme vor:

1. **Eigener Ortungsschritt nach dem Commit des Einwurfs (gewählt).** Der Einwurf bleibt
   unverändert. Liefert `position_ablegen` `Uebernommen`, stößt die Route nach dem Commit die
   Übernahme an; sie läuft in eigener Transaktion, ihr Ergebnis und ihre Fehler wirken nicht auf
   die Antwort. Hält ADR-0023 wörtlich, macht die Grenze in einer neuen ADR prüfbar.
2. **Im selben Schreibvorgang.** Einfacher, aber ADR-0023 müsste abgelöst werden, und ein Fehler am
   Fahrzeug (Spiegel, Konflikt) ließe den Einwurf scheitern und wäre von außen sichtbar.
3. **Nur beim Lesen.** `einsatz_fahrzeug` bliebe unberührt, die Lagekarte läse über die Kopplung
   aus `position_letzte`. Am reinsten für ADR-0023, aber Live-Anstoß, Schnappschuss, Lagebild ohne
   Netz und Druck bräuchten eigene Wege; die Position verschwände nach 24 h aus dem Einsatz.

Weitere Entscheidungen am Checkpoint:

- **Vorrang:** die jüngste Messzeit gewinnt. Manuelles Platzieren bleibt möglich; die nächste
  GPS-Meldung, die jünger ist, setzt den Marker zurück. Verworfen: „manuell pausiert die Ortung“
  (vergessener Zustand) und „gekoppelt sperrt manuell“ (bei ungenauem GPS hilflos).
- **Ehrenamt:** Org-Schalter „Ortung auch bei hauptamtlicher Besatzung“ (aus) plus Pflicht-
  bestätigung beim Koppeln, im ETB vermerkt. Verworfen: Merkmal am Stammfahrzeug (Pflegeaufwand,
  neues Stammdatum) und „nur Schalter“ (schützt das Ehrenamt-Ziel nicht).
- **Koppeln:** im Einsatz, mit Schreibrecht im Modul Fahrzeuge. Verworfen: Kopplung in der
  Verwaltung am Stammfahrzeug (dauerhafte Zuordnung, von der Aufgabe ausgeschlossen).

## Entwurf

### Daten (eine Migration, nächste freie Nummer)

- **`ortung_kopplung`**: eine Zeile je gekoppeltem Einsatzfahrzeug.
  - `einsatz_fahrzeug_id INTEGER PRIMARY KEY REFERENCES einsatz_fahrzeug(id) ON DELETE CASCADE`
  - `einsatz_id INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE`
  - `org_id INTEGER NOT NULL`
  - `zugang_id TEXT NOT NULL REFERENCES einwurf_zugang(id) ON DELETE CASCADE`
  - `kennung TEXT NOT NULL`
  - `ehrenamt_bestaetigt INTEGER NOT NULL CHECK (ehrenamt_bestaetigt IN (0, 1))`
  - `gekoppelt_at TEXT NOT NULL`, `gekoppelt_von INTEGER NOT NULL`
  - `UNIQUE (zugang_id, kennung)`: eine Kennung hängt zur selben Zeit an höchstens einem
    Einsatzfahrzeug, über alle Einsätze.
  - Trennen löscht die Zeile. Es gibt keine Spalte `getrennt_at` und keine Historie; die Spur
    steht im ETB.
- **`einsatz_fahrzeug`** bekommt `position_quelle TEXT` (`manuell` | `ortung`, NULL ohne Position)
  und `position_gemessen_at TEXT` (UTC). Bestand: Zeilen mit `lat` bekommen `manuell`, Messzeit
  NULL.
- **`org_einstellungen`** bekommt `ortung_hauptamt INTEGER` (NULL/0 = aus, 1 = an). Die Spalte
  kommt in die Liste der Stammdaten-Synchronisation (`src/instanz/stammdaten/art.rs`, `spalten`).
- `ortung_kopplung` wird nicht gespiegelt und nicht in die API v1 geliefert; sie bekommt keine
  Spiegel- und keine Outbox-Trigger (Begründung in ADR-0098: Kopplung ist lokale Betriebsangabe
  der leitenden Instanz, gespiegelte Einsätze sind ohnehin ausgenommen).

### Übernahme (`src/ortung/`, neues Modul)

1. `public_api/einwurf/routen.rs`: nach dem `write_retry!` von `position_ablegen`, nur bei
   `Uebernommen`, `ortung::anstossen(state, zugang_id, kennung)` aufrufen. Das startet die
   Übernahme per `tokio::spawn` und kehrt sofort zurück; die Antwort bleibt 204. Kein Logfeld trägt
   Kennung, Schlüssel oder Koordinaten (ADR-0023-Prüfung gilt weiter für `routen.rs`).
2. `ortung::uebernehmen` in eigenem `write_retry!`:
   - Kopplung zu `(zugang_id, kennung)` laden, verbunden mit `einsatz_fahrzeug`
     (`beendet_at IS NULL`) und `einsatz` (`status = 'aktiv'`, `spiegel = 0`). Keine Zeile: nichts.
   - Position aus `position_letzte` lesen.
   - **Vorrang:** nur übernehmen, wenn `gemessen_at` jünger ist als
     `einsatz_fahrzeug.position_gemessen_at` (oder diese NULL ist).
   - **Drossel:** nicht schreiben, wenn die vorhandene Position aus `ortung` stammt und weniger als
     15 Sekunden älter ist als die neue Messzeit.
   - `UPDATE einsatz_fahrzeug SET lat, lon, position_quelle = 'ortung', position_gemessen_at`.
   - Kein ETB-Eintrag.
3. Nach dem Commit `sse_fahrzeug(state, einsatz_id, ef_id)`. Fehler werden als Sammelzeile
   gezählt, nicht einzeln protokolliert.

Die manuelle Route `PATCH …/vehicles/{ef_id}/position` setzt `position_quelle = 'manuell'` und
`position_gemessen_at = jetzt`; Löschen der Position setzt beide auf NULL. Sie bleibt für
gekoppelte Fahrzeuge offen.

### Koppeln und Trennen (Einsatzrouten)

Unter `/api/einsaetze/{einsatz_id}/vehicles/{ef_id}/tracking` (Segment „tracking“ ins Glossar):

- `GET …/tracking/candidates`: Kennungen der letzten 24 h aus allen nicht widerrufenen Zugängen
  mit `positionen:write` der eigenen Org. Je Eintrag `access_id`, `access_name`, `device_id`,
  `received_at` (Alter), `coupled` (bool, ob anderweitig gekoppelt). **Keine Koordinaten.** Gate:
  `EinsatzSchreibzugriff<Fahrzeuge>`. Das ist der erste lesende Zugriff auf `position_letzte`.
- `PUT …/tracking` mit `{ access_id, device_id, volunteer_crew_confirmed }`:
  - Fahrzeug aktiv, Einsatz aktiv und nicht gespiegelt, sonst 409.
  - Zugang gehört zur Org und hat `positionen:write`, sonst 422.
  - Org-Schalter aus und `volunteer_crew_confirmed` nicht `true`: 422 mit eigenem Code.
  - Kennung schon an ein anderes Fahrzeug gekoppelt: 409. Ein erneutes PUT am selben Fahrzeug
    ersetzt dessen Kopplung.
  - ETB-Systemeintrag „Ortung gekoppelt: <Funkrufname> (<Zugangsname> / <Kennung>)“, bei
    Bestätigung mit Zusatz „Besatzung ehrenamtlich bestätigt“.
  - Im selben Vorgang die vorhandene Position aus `position_letzte` nach den Regeln oben
    übernehmen, danach `sse_fahrzeug`.
- `DELETE …/tracking`: Kopplung löschen, ETB „Ortung getrennt: <Funkrufname>“. Die Position bleibt
  als letzter Stand mit Quelle `ortung` stehen und wird mit der Zeit veraltet.
- **Automatisches Ende**, jeweils mit ETB-Eintrag „Ortung getrennt“ in derselben Transaktion:
  `entlassen_tx`, `stornieren_tx` und `einsatz::repo::abschliessen` (alle Kopplungen des Einsatzes).
  Reaktivieren und Wiedereröffnen stellen keine Kopplung wieder her.

`EinsatzFahrzeugAnzeige` bekommt `position_quelle`, `position_gemessen_at` und `ortung`
(`{ zugang_name, kennung } | null`). Danach `scripts/check-typ-codegen.sh`.

### Org-Schalter

`GET/PUT /api/org-settings` führt `ortung_hauptamt`; Ändern nur `AdminUser`, in `admin_audit`. UI
unter Verwaltung → Einstellungen → Anbindungen, beim Einwurf: Schalter „Ortung auch bei
hauptamtlicher Besatzung“, Zustandszeile „Nur mit Betriebs- oder Dienstvereinbarung
(§ 87 Abs. 1 Nr. 6 BetrVG).“

### Oberfläche

- **Fahrzeuge-Seite, Zeilenmenü:** „Ortung koppeln …“ bzw. „Ortung trennen“, nur mit
  Schreibrecht und bei aktivem, nicht gespiegeltem Einsatz. Dialog: Auswahl der Kennungen
  („Zugang · Kennung · vor 2 min“, gekoppelte ausgegraut), Kontrollkästchen „Besatzung ist
  ehrenamtlich“ (Pflicht, solange der Org-Schalter aus ist; sonst nicht gezeigt). Ohne Kennungen:
  Zustandssatz „Keine Position in den letzten 24 Stunden eingegangen.“ Die Zeile zeigt eine Marke
  „GPS“, solange gekoppelt.
- **Lagekarte:** Marker mit Quelle `ortung` tragen eine kleine Marke „GPS“. Über 10 Minuten
  (strikt darüber, Konstante `ORTUNG_VERALTET_NACH_MIN = 10`) die Marke „veraltet“ in Worten nach
  dem Muster `FachebeneStand`. Inspector-Raster: Zeile „Position“ mit „GPS · vor 3 min“,
  „GPS · veraltet · vor 14 min“ oder „manuell“. Alter über `anzeige/dauer.ts`, Takt über
  `useMinutenTakt`. Keine Kamerafahrt bei Live-Updates.
- Query-Keys: keine neuen einsatzweiten Keys außer den Kandidaten (`NICHT_LIVE_KEYS`, Abruf beim
  Öffnen des Dialogs). Die neuen Felder reisen mit `einsatzKeys.fahrzeuge`, das schon im Lagebild
  ohne Netz steht; das Alter rechnet offline aus der Messzeit.

### Doku

- **ADR-0098** „Die Ortung übernimmt eingeworfene Positionen nur für gekoppelte Fahrzeuge
  laufender Einsätze“. Regeln: eigener Schritt nach dem Einwurf, ohne Wirkung auf die Antwort; nur
  aktive Kopplung, aktives Fahrzeug, aktiver ungespiegelter Einsatz; jüngste Messzeit gewinnt;
  kein Verlauf; Kopplung endet mit Trennen, Entlassen, Stornieren, Abschluss; ohne Org-Schalter
  Bestätigung Ehrenamt; Kandidatenliste nur mit Einsatzschreibrecht und ohne Koordinaten. Prüfung
  per `verbiete`/`verlange`.
- **Architektur:** Kapitel 5 (Modul `ortung`), 6 (neuer Ablauf neben §6.6e Einwurf), 8
  (Datenschutz der Ortung), 11 (Risiko Hauptamt), 12 (Glossar „Ortung“, „Kopplung“).
- **Anwender:** `anbindungen.md` (Ortung einrichten, Org-Schalter, **DSFA-Vorlage**: Zweck,
  Rechtsgrundlage Art. 6 Abs. 1 lit. e bzw. f DSGVO für das Ehrenamt, Betriebsvereinbarung für das
  Hauptamt, Speicherdauer letzte Position 24 h in der Ablage, Position am Fahrzeug bis zur
  Löschung des Einsatzes, kein Verlauf, Empfänger, TOM), `lagekarte.md` (Marke GPS, veraltet),
  `fahrzeuge.md` (koppeln, trennen, automatisches Ende). Bilder nach `docs/anwender/AGENTS.md`.

### Tests (Akzeptanzkriterien)

- Einwurf mit gekoppelter Kennung ändert `lat/lon`, Quelle `ortung`, und sendet `fahrzeug`.
- Ohne Kopplung, nach Trennen, Entlassen, Stornieren, Abschluss oder in einem gespiegelten Einsatz
  ändert ein Einwurf kein Fahrzeug; die Antwort ist in allen Fällen 204.
- Manuelle Position nach einem GPS-Fix bleibt, bis ein jüngerer Fix kommt.
- Drossel: zwei Fixe binnen 15 s schreiben einmal.
- Koppeln ohne Bestätigung bei ausgeschaltetem Schalter: 422; mit eingeschaltetem: 204.
- Doppelte Kennung: 409. Kandidatenliste enthält keine Koordinaten, keine fremde Org.
- Schema-Test: keine Tabelle mit mehreren Positionen je Fahrzeug oder Kennung.
- Frontend: Marke „veraltet“ strikt über 10 min; Koppeldialog mit und ohne Pflichtbestätigung.

## Dem Bauenden überlassen

- Name und genaue Gestalt der Funktionen in `src/ortung/`, Fehlercodes im Detail.
- Ob die Übernahme beim Koppeln die Funktion aus dem Anstoß wiederverwendet.
- Platz und Gestalt der Marke „GPS“ am Marker, solange Trefferzone und Status-Ring bleiben.
- Bildlauf und Bildauswahl der Anwenderkapitel.

## Offen für später

- Ortung in gespiegelten Einsätzen (Position am Hub an das führende ELW weiterleiten).
- Rechtliche Klärung „Ortung von Hauptamtlichen“ (Jurist, Schnittstellen-Ausbau).
- Gezielte Zeilen-Aktualisierung statt breiter Invalidierung, falls die Drossel nicht reicht.
