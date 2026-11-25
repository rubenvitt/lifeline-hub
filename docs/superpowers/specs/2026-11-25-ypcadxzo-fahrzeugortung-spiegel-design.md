# Fahrzeugortung in gespiegelten Einsätzen: der Hub liefert Positionen an das führende ELW (LLH-2119)

**Status:** Entwurf, wartet auf Freigabe (nach Gegenlese) · **Datum:** 2026-11-25 · **Zunder:**
https://zunder.rubeen.dev/#/aufgabe/ypcadxzog8lomshl4wapmybc · **Route:** `entwurf` (E1 Weg der
Weiterleitung, E2 neue ADR neben ADR-0103, E3 `src/instanz/spiegel`, `src/ortung`, Frontend, Doku)

## Absicht

LLH-2091 hat die Fahrzeugortung gebaut: Ein Gerät meldet seine Position an einen Einwurf-Zugang,
und ein im Einsatz gekoppeltes Fahrzeug bewegt sich auf der Lagekarte (ADR-0103). Gespiegelte
Einsätze blieben ausgenommen. In der Standardkopplung Hub ↔ ELW gibt es deshalb eine Lücke:

- Ein ELW, das an einen Hub gekoppelt ist, nimmt keinen Einwurf an (`hub_fuer_org`, Konzept D8).
  Die Geräte melden also an den Hub.
- Führt das ELW den Einsatz, ist er am Hub ein Spiegel und schreibgeschützt. Die Position am Hub
  erreicht das Fahrzeug nie.

Ziel: Auch ein vom ELW geführter Einsatz zeigt seine Fahrzeuge live, wenn die Geräte an den Hub
melden. Führt der Hub, geht es schon heute: Die Position steht am Fahrzeug und reist mit dem
Spiegel ans ELW.

## Ziele

- Am führenden ELW lässt sich ein Fahrzeug an eine Kennung eines Einwurf-Zugangs **des Hubs**
  koppeln und wieder trennen, im selben Dialog wie heute.
- Neue Positionen dieser Kennung erreichen das Fahrzeug am ELW im Takt des Spiegelabgleichs
  (5 s, solange ein Einsatz aktiv ist). Am ELW gelten dieselben Regeln wie bei der lokalen
  Ortung: Baustein, Vorrang, Drossel, Org-Schalter, Ende.
- Über den bestehenden Spiegel sieht auch der Hub die Position.
- Gibt das ELW die Führung ab, enden seine Kopplungen still, ohne ETB-Eintrag. Das gilt auch für
  lokale Kopplungen eines Hubs, der die Führung abgibt.

## Nicht-Ziele

- Die Direktkopplung zweier ELW (LLH-1868). Dafür kommt eine Folgeaufgabe (Ruben, 25.11.2026).
- Die Kopplung geht bei einem Führungswechsel nicht an den neuen Führer mit (Ruben, 25.11.2026).
- Am Spiegel (Hub) wird nicht gekoppelt, und es gibt keinen Antragsweg für Positionen.
- Ein ELW, das an einen Hub gekoppelt ist, nimmt auch weiter keinen Einwurf an.
- Kein Verlauf und keine neue Ablage am Hub.

## Anti-Ziele

- Eine Koordinate verlässt den Hub für eine Kennung, die am ELW nicht gekoppelt ist.
- Der Hub merkt sich, welche Kennungen ein ELW gekoppelt hat (neuer Zustand am Hub).
- Eine Position wird an einem Spiegel geschrieben, oder ein Antrag trägt Positionen.
- Ein Protokoll trägt Kennung, Schlüssel oder Koordinaten, auf keiner der beiden Seiten.
- Ein älterer Hub oder ein älteres ELW bricht den Abgleich wegen der neuen Felder.

## Rahmen

- **Spiegelabgleich** (`src/instanz/spiegel/abgleich.rs`, `paket.rs`): Die meldende Seite (ELW)
  ruft `POST /api/instance/mirror`, die erreichte Seite (Hub) antwortet, beide mit
  `SpiegelPaket`. Neue Felder kommen mit `#[serde(default)]`, damit eine ältere Gegenseite sie
  überliest, wie `hinweise` und `mitarbeit_nachtraege`. `PROTOKOLL_SPIEGEL` bleibt.
- **ADR-0018:** Ein Spiegel schreibt nur über Anträge aus `BEANTRAGBAR`. Dieser Weg schreibt nie
  am Spiegel: Das ELW führt und schreibt lokal.
- **ADR-0039:** Lieferungen gehen nur über eine Abbildung der eigenen Org
  (`instanz_kopplung_org`). Der Hub liefert nur Zugänge der abgebildeten Org.
- **ADR-0023:** Der Einwurf bleibt unverändert. Der Hub liest `position_letzte` beim Abgleich,
  so wie die Kandidatenliste das schon tut.
- **ADR-0103** (akzeptiert, unveränderlich) gilt weiter: Geschrieben wird nur an einem aktiven
  Fahrzeug eines aktiven, nicht gespiegelten Einsatzes, über `schreibe_position` mit Quelle
  `einwurf`. Am ELW ist der Einsatz nicht gespiegelt. Die Erweiterung steht in einer **neuen,
  ergänzenden ADR-0104** (nächste freie Nummer auf `alpha`, vor dem Commit prüfen).
- **Org-Schalter** `ortung_im_einsatz` reist schon mit den Stammdaten vom Hub ans ELW
  (`src/instanz/stammdaten/art.rs`). Beide Seiten prüfen ihn.
- **Führungswechsel:** `fuehrung::werde_spiegel` beendet schon die Helfer-Kopplungen, bevor der
  Einsatz zum Spiegel wird. Danach schreibt kein Weg mehr. Die Ortung hängt sich dort ein.
- Live-Meldung nach dem Commit, außerhalb von `write_retry!` (`src/AGENTS.md`).

## Ansätze

Am Checkpoint (25.11.2026) lagen drei Wege vor. Ruben hat A gewählt.

1. **A: Das ELW holt die Positionen im Abgleich ab (gewählt).** Gekoppelt wird am führenden ELW.
   Es nennt dem Hub in jeder Abgleichsanfrage seine gekoppelten Hub-Kennungen und bekommt in der
   Antwort deren letzte Position. Gewählt, weil:
   - kein neuer Kanal und kein neuer Zustand am Hub entsteht;
   - Koordinaten nur für gekoppelte Kennungen reisen;
   - ADR-0018 und ADR-0023 bleiben, wie sie sind.
2. **B: Antragsweg.** Jede Position würde ein Antrag an den Führer. Verworfen, weil:
   - einem Einwurf kein Nutzer zugeordnet ist;
   - ADR-0018 nur POST-Fachrouten zulässt;
   - `spiegel_antrag` alle 15 s je Fahrzeug eine Position sammeln würde, also praktisch einen
     Verlauf.
3. **C: Einwurf am ELW trotz Kopplung.** Verworfen, weil:
   - das Gerät die führende Instanz kennen müsste;
   - ein ELW meist nicht von außen erreichbar ist (es ruft, es wird nicht gerufen);
   - der Weg Konzept D8 widerspricht.

## Entwurf

### Daten (eine Migration, Tabellenumbau nach `migrations/AGENTS.md`)

`ortung_kopplung` bekommt eine zweite Art von Zugang. Es bleibt **eine** Tabelle, weil alle
Endstellen (Trennen, Entlassen, Stornieren, Ablehnen, Abschluss, Rückgängig, Führungswechsel)
auf ihr arbeiten. Zwei Tabellen hießen, jede Endstelle doppelt zu führen.

- `zugang_id` wird **nullbar** (FK auf `einwurf_zugang` bleibt): Das ist ein lokaler Zugang.
- `instanz_kopplung_id INTEGER NULL REFERENCES instanz_kopplung(id) ON DELETE CASCADE`,
  `fremder_zugang_id TEXT NULL`, `zugang_name TEXT NULL`: Das ist ein Zugang am Hub. Den Namen hält
  das ELW beim Koppeln fest, für ETB und Anzeige, weil es den Zugang selbst nicht kennt.
- `CHECK`: Genau eine Art ist gesetzt. Entweder `zugang_id`, oder alle drei Hub-Spalten, sonst
  nichts.
- Eindeutigkeit der Kennung, aufgeteilt in zwei Teilindizes:
  - `UNIQUE (zugang_id, kennung) WHERE zugang_id IS NOT NULL`;
  - `UNIQUE (instanz_kopplung_id, fremder_zugang_id, kennung) WHERE instanz_kopplung_id IS NOT NULL`.
- Bestand: alle Zeilen lokal. Spiegel-, Outbox- und API-Ausschluss bleiben wie heute.

Am Hub entsteht nichts Neues.

### Abgleich: neue Felder im `SpiegelPaket`

Die Wire-Felder sind englisch und neu (ADR-0097). Das Paket selbst ist deutsch, die Felder neuer
Typen sind es nicht. Die Wahl der Feldnamen liegt beim Bauenden, solange sie englisch sind.

- **Anfrage des ELW: `tracking_requests: Vec<TrackingRequest { org, access_id, device_id }>`**
  - Je gekoppelter Hub-Kennung einer aktiven Kopplung, ohne Stand. Es sind wenige Einträge, und
    am ELW verwirft der Baustein, was nicht neuer ist.
  - Nur wenn der Org-Schalter am ELW an ist.
  - `org` ist die Org-Kennung des Abgleichs (`org_wire`).
- **Anfrage des ELW: `tracking_candidates_wanted: Vec<String>`** (Org-Kennungen)
  - Ein Org-Eintrag, solange am ELW ein Koppeldialog Kandidaten braucht (s. „Kandidaten“).
- **Antwort des Hubs: `tracking_positions: Vec<TrackingPosition { org, access_id, device_id,
  lat, lon, measured_at }>`**
  - Je Anfrage höchstens ein Eintrag, und nur wenn alles gilt:
    - die Org ist über diese Kopplung abgebildet und nicht widerrufen;
    - der Zugang gehört zu ihr, hat `positionen:write`, ist nicht widerrufen und nicht abgelaufen;
    - der Org-Schalter am Hub ist an;
    - `position_letzte` hat einen Eintrag.
  - Sonst entfällt der Eintrag stumm. Das ELW erfährt nicht, warum.
- **Antwort des Hubs: `tracking_candidates: Vec<TrackingCandidates { org, tracking_enabled,
  items: Vec<{ access_id, access_name, device_id, received_at }> }>`**
  - Inhalt wie die heutige Kandidatenliste, **ohne Koordinaten**, für jede gewünschte Org.
- Grenzen:
  - höchstens 200 Anfragen je Paket, Überzählige überliest der Hub;
  - die Kandidaten zählen gegen `SPIEGEL_MAX` wie die übrigen Felder.

Der Hub stellt seine Antwortfelder **außerhalb** der `write_retry!`-Transaktion von
`handle_abgleich` zusammen (danach, rein lesend). Ein SQL-Fehler dort rollt so den Abgleich nicht
zurück. Ebenso übernimmt das ELW die Positionen nach dem Commit des Abgleichs, in eigener
Transaktion.

Den Hub-Teil baut ein eigenes Modul `src/ortung/fern.rs` (Name dem Bauenden überlassen). `abgleich.rs` ruft
es auf beiden Seiten nur auf. Ein Fehler in diesem Teil darf den übrigen Abgleich nicht
scheitern lassen: Er wird als Sammelzeile gezählt und das Feld bleibt leer.

### Übernahme am ELW

- Nach dem Abgleich, in eigener Transaktion: Für jede gelieferte Position die Kopplung zu
  `(instanz_kopplung_id, access_id, device_id)` suchen. Danach gilt die Logik von
  `uebernahme.rs`, also aktives Fahrzeug, aktiver nicht gespiegelter Einsatz, Org-Schalter,
  `klemme_zeitpunkt` und `schreibe_position`.
- `uebernahme.rs` bekommt dafür einen zweiten Einstieg, der die Kopplung über den Hub-Schlüssel
  findet und die Position aus dem Paket statt aus `position_letzte` nimmt.
- Die Drossel von 15 s gilt unverändert. Einen Nachlauf gibt es auf diesem Weg **nicht**: Der
  Nachlauf liest `position_letzte`, und die liegt am Hub. Der nächste Abgleich liefert dieselbe
  oder eine jüngere Position ohnehin erneut. ADR-0104 nennt diese Ausnahme ausdrücklich, weil
  ADR-0103 „genau einen Nachlauf“ verlangt.
- Nach dem Commit `ortung::publiziere`. Der Spiegel am Hub bekommt die Position über die
  bestehenden Trigger.
- Endet die Instanzkopplung oder wird die Org-Abbildung widerrufen, bleiben die Kopplungen
  bestehen. Es kommt nur nichts mehr, und die Position wird nach 5 min als „veraltet“ markiert.
  Die Kopplung löscht erst `ON DELETE CASCADE` beim Löschen der Instanzkopplung.
  (Entscheidung beim Entwurf: kein eigener Endpfad für einen Zustand, der ohnehin selten ist und
  sich von selbst zeigt.)

### Kandidaten am ELW

- `GET …/tracking/candidates` am ELW: Hat die Org einen Hub (`hub_fuer_org`), liefert die Route
  den zuletzt vom Hub bekommenen Stand aus einem Speicher-Puffer je Org. Der Puffer ist flüchtig
  und lebt 60 s.
  - Ist er älter als 10 s oder fehlt er, merkt die Route den Wunsch vor (60 s lang im Speicher),
    weckt den Takt (`takt::wecken`) und antwortet mit `pending: true` und dem alten Stand.
  - Der Dialog fragt nach, solange `pending` gilt, alle 2 s bis höchstens 15 s. Danach zeigt er
    „Der Hub antwortet gerade nicht.“
  - Lokale Kandidaten gibt es in diesem Fall nicht, weil das ELW keinen Einwurf annimmt.
- Jeder Eintrag trägt zusätzlich `remote: true` (bzw. eine Herkunft). Damit kann der Dialog
  „über den Hub“ anzeigen. `coupled` bestimmt das ELW aus seinen eigenen Kopplungen.
- `tracking_enabled` kommt vom Hub. Am ELW gilt zusätzlich der eigene Schalter: Beim Koppeln
  verlangen beide Seiten `ortung_im_einsatz`, eingeschaltet wird er aber am Hub (Stammdaten).

### Koppeln und Trennen am ELW

- `PUT …/tracking` nimmt dieselbe Form an. Hat die Org einen Hub, wird `access_id` als Hub-Zugang
  gelesen:
  - Er muss im aktuellen Kandidaten-Puffer stehen, sonst 422 „Kennung nicht mehr verfügbar“.
  - `zugang_name` wird aus dem Puffer übernommen.
  - Alle übrigen Prüfungen bleiben: Org-Schalter, aktiver nicht gespiegelter Einsatz, die Kennung
    ist nicht anderswo gekoppelt (409).
  - Der ETB-Eintrag lautet wie bisher: „Ortung gekoppelt: <Funkrufname> (<Zugangsname> /
    <Kennung>)“.
  - Der Hub prüft bei jeder Lieferung ohnehin selbst.
- Die vorhandene Position wird beim Koppeln **nicht** sofort übernommen (sie liegt nicht lokal).
  Sie kommt mit dem nächsten Abgleich. Nach dem PUT wird der Takt geweckt.
- `DELETE`, Entlassen, Stornieren, Ablehnen, Abschluss und Rückgängig nach Entlassen arbeiten auf
  der Zeile, egal welche Art.
  - Zum Rückgängig: `OrtungVorzustand` (`src/fahrzeug/mod.rs`) bekommt die Hub-Spalten
    (`instanz_kopplung_id`, `fremder_zugang_id`, `zugang_name`) als optionale Felder dazu. Die
    Rücknahme stellt eine Hub-Kopplung **ohne** Pufferprüfung her. Geprüft wird nur:
    - die Instanzkopplung besteht noch;
    - die Org hat noch eine Abbildung dorthin;
    - die Kennung ist nicht anderswo gekoppelt.
    Der Hub prüft den Zugang bei jeder Lieferung selbst; ein falscher Wert liefert schlicht nichts.
    (Entscheidung beim Entwurf nach der Gegenlese.)
- **Bestehende Abfragen umbauen** (eigene Plan-Schritte):
  - `SELECT_KOPPLUNG` verbindet heute per INNER JOIN mit `einwurf_zugang` (`src/ortung/kopplung.rs`)
    und würde Hub-Kopplungen still verlieren, samt ETB beim Trennen und beim Abschluss. Es braucht
    einen LEFT JOIN, den Namen aus `COALESCE(z.name, k.zugang_name)` und ein optionales
    `zugang_id` im Typ `Kopplung`.
  - `run_nachlauf` (`uebernahme.rs`) überspringt Hub-Kopplungen.
- `GET …/tracking` nennt bei einer Hub-Kopplung `access_name` aus `zugang_name`.

### Führungswechsel

- In `fuehrung::werde_spiegel`, direkt neben `helfer::ende::beende_alle_im_einsatz` und noch vor
  dem Spiegel: `ortung::kopplung::beende_bei_fuehrungsabgabe_tx(conn, einsatz_id)` löscht alle
  Kopplungen des Einsatzes, egal welcher Art.
- **Kein ETB-Eintrag** (Ruben, 25.11.2026, nach der Gegenlese). Ein Eintrag in diesem Moment käme
  nach `bekannt_bis`, würde zur Bruchstelle (`sichere_bruchstelle`), und der neue Führer baute den
  Spiegel ohne ihn neu auf. Jede Abgabe mit Kopplung würde zum Bruchfall. Die Kopplung endet also
  still, wie die Helfer-Kopplungen. Die Marke „Ortung“ verschwindet, die Position wird veraltet.
  `ortung_kopplung` schreibt keinen Spiegel-Log, das Löschen ist deshalb kein Bruch.
- Positionen bleiben als letzter Stand stehen. Sie gehören zum Einsatz und reisen ohnehin schon
  mit dem Spiegel. Gelöscht werden sie erst beim Abschluss durch den neuen Führer, wie heute
  (Quelle `einwurf`).
- Das gilt für beide Richtungen: Am Hub endet so auch eine lokale Kopplung, wenn der Hub an ein
  ELW abgibt. Heute bleibt sie dort als tote Zeile stehen.
- Wechselt die Führung zurück, wird neu gekoppelt.

### Oberfläche

- **Koppeldialog am ELW:**
  - Zeilen „Zugang · Kennung · vor 2 min“ mit dem Zusatz „über den Hub“.
  - Während `pending` ein Ladezustand „Kennungen werden vom Hub geholt …“.
  - Nach 15 s ohne Antwort der Zustandssatz „Der Hub antwortet gerade nicht. Später erneut
    versuchen.“
  - Sonst wie heute.
- **Fahrzeugzeile am Hub (Spiegel):** Das Menü „Ortung koppeln“ bleibt aus. Die Marke „Ortung“
  hängt heute an `ortung_gekoppelt`, das am Spiegel `false` ist. Neu:
  - Am Spiegel zeigt die Zeile die Marke, wenn `position_quelle = 'einwurf'` und die Position
    nicht veraltet ist.
  - Die Lagekarte zeigt über `positionsHinweis` ohnehin „Ortung · vor 3 min“.
  - Der Bauende darf das auf „Lagekarte genügt“ zurückschneiden, wenn die Marke am Spiegel mehr
    als eine Bedingung kostet.
- Query-Keys: Die Kandidaten bleiben in `NICHT_LIVE_KEYS`. Das Nachfragen bei `pending` ist ein
  `refetchInterval` nur im offenen Dialog.

### Doku

- **ADR-0104** „Der Hub liefert eingeworfene Positionen nur für Kennungen, die das führende ELW
  gekoppelt hat“ (ergänzt ADR-0103, kein `ersetzt`). Regeln:
  - nur im Abgleich, nur auf Anfrage, nur abgebildete Org, nur gültiger Zugang mit
    `positionen:write`, nur bei eingeschaltetem Schalter;
  - Kandidaten ohne Koordinaten;
  - kein Zustand am Hub;
  - geschrieben wird am ELW nur über `schreibe_position`;
  - Kopplungen enden bei Abgabe der Führung still, vor dem Anlegen des Spiegels;
  - Ausnahme von ADR-0103 „genau ein Nachlauf“: Auf dem Weg über den Hub ersetzt der nächste
    Abgleich den Nachlauf. Der Nachlauf liest `position_letzte`, und die liegt am Hub.
  - kein Protokoll mit Kennung, Schlüssel oder Koordinaten.
  - Prüfung per `verlange`/`verbiete`, etwa: kein `tracing::` mit Kennung in `src/ortung/fern.rs`,
    `beende_bei_fuehrungsabgabe_tx` in `fuehrung.rs`, `serde(default)` an den neuen Feldern.
- **Architektur:**
  - Kapitel 6: Ablauf „Ortung über den Hub“ neben dem Einwurf-Ablauf.
  - Kapitel 8: Datenschutz, also welche Koordinaten die Instanz verlassen.
  - Mitänderungsregel nach `docs/architektur/AGENTS.md`.
- **Anwender:**
  - `fahrzeuge.md`: Ortung über den Hub koppeln, Führungsabgabe trennt.
  - `anbindungen.md`: Ortung im Verbund Hub ↔ ELW, DSFA-Vorlage um den Empfänger „führendes ELW“
    ergänzen.
  - Bilder nach `docs/anwender/AGENTS.md`.
- Spec LLH-2091 (`2026-11-24-fjftaovq-…`, „Offen für später“): Verweis auf diese Spec ergänzen.

### Tests (Akzeptanzkriterien)

- **Zwei Instanzen im Test**, Muster der bestehenden Spiegeltests:
  - ein Hub mit Einwurf-Zugang und Position;
  - ein ELW führt einen Einsatz, koppelt die Kennung;
  - nach einem Abgleich steht die Position am Fahrzeug am ELW (Quelle `einwurf`) und am Spiegel
    des Hubs.
- Der Hub liefert nichts für:
  - eine nicht angefragte Kennung;
  - einen fremden oder nicht abgebildeten Org-Zugang;
  - einen widerrufenen oder abgelaufenen Zugang;
  - einen Zugang ohne `positionen:write`;
  - einen ausgeschalteten Schalter.
- Die Kandidaten tragen keine Koordinaten (Schema-Prüfung des Wire-Typs).
- Ein ELW ohne die neuen Felder (alter Stand) und ein Hub ohne sie: Der Abgleich läuft, die Felder
  bleiben leer.
- Koppeln mit einer Kennung, die nicht im Puffer steht: 422. Doppelt gekoppelt: 409.
- Führungsabgabe am ELW beendet Hub-Kopplungen ohne ETB-Eintrag und ohne Bruchstelle
  (`bruch_offen` bleibt falsch). Ebenso bei lokalen Kopplungen am Hub, der abgibt.
- Drossel: zwei Lieferungen binnen 15 s schreiben einmal.
- Entlassen, Stornieren, Abschluss und Rückgängig wirken auf Hub-Kopplungen wie auf lokale
  (vorhandene Tests mit einer Hub-Kopplung parametrisieren, wo es billig ist).
- `keine_tabelle_haelt_einen_positionsverlauf` bleibt grün. Der CHECK der Tabelle lehnt gemischte
  Zeilen ab.
- Frontend: Dialog mit `pending`, Zeitüberschreitung, Zusatz „über den Hub“.

## Nach der Gegenlese

Ein Gegenleser hat den Entwurf als Bauender gelesen. Ruben hat entschieden, dass die Führungsabgabe
still trennt. Beim Entwurf festgelegt und oben eingetragen sind:

- kein Nachlauf auf dem Hub-Weg, als Ausnahme in ADR-0104;
- der Hub liest außerhalb der Abgleichstransaktion;
- Rückgängig ohne Pufferprüfung;
- Umbau von `SELECT_KOPPLUNG` und `run_nachlauf`.

Außerdem:

- **Dieselbe Kennung an mehreren Instanzen:** Zwei ELW an einem Hub oder der Hub selbst können
  dieselbe Hub-Kennung zugleich koppeln. Der Hub hält bewusst keinen Zustand dafür (Anti-Ziel).
  Hingenommen: Ein Gerät sitzt in genau einem Fahrzeug, und Doppelkopplungen sind Bedienfehler,
  die sich auf der Karte zeigen. `coupled` in den Kandidaten bezieht sich nur auf die eigene
  Instanz; der Dialog sagt das nicht eigens.
- **Mehrere Hubs:** Anfragen gehen über die `instanz_kopplung_id`, die an der Kopplung steht, und
  Kandidaten kommen vom Hub aus `hub_fuer_org`. Wandert die Abbildung zu einer anderen Kopplung,
  liefert der alte Hub nichts mehr. Die Zeilen bleiben, bis jemand trennt oder `ON DELETE CASCADE`
  sie mitnimmt.

## Dem Bauenden überlassen

- Namen von Modul, Funktionen und Wire-Typen, solange die Felder englisch sind und
  `#[serde(default)]` tragen.
- Die genaue Form der Puffer- und Wunsch-Zeiten (10 s, 60 s), solange der Dialog binnen eines
  Abgleichs Kandidaten bekommt.
- Ob der zweite Übernahme-Einstieg die Nachlauf-Logik teilt oder umgeht.
- Ob die Marke „Ortung“ am Spiegel kommt oder die Lagekarte genügt.

## Offen für später

- Direktkopplung zweier ELW (Folgeaufgabe anlegen).
- Kopplung bei Führungswechsel an den neuen Führer übergeben, falls sich das Trennen im Betrieb
  als lästig erweist.
