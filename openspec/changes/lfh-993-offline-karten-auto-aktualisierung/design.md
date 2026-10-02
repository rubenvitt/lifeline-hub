# Design

## Context

Motivation: proposal.md. Ausgangslage im Code (Stand 02.10.2026):

- **karten-service.** `scheduler::starte` legt einen Job mit `Job::new_async` an. Der Cron läuft
  deshalb in **UTC** (`new_async` ruft `new_async_tz(…, Utc, …)`, tokio-cron-scheduler 0.15.1).
  Das Runbook (`docs/ops/lfh-204-karten-service-ops-runbook.md`, Tabelle `--schedule` und
  Abschnitt zum In-Service-Cron) behauptet die Zeitzone des Prozesses, das ist falsch. Die
  Job-UUID geht verloren, den nächsten Tick fragt niemand ab
  (`JobScheduler::next_tick_for_job(uuid)` gibt es). Die Job-Registry (`jobs.rs`) liegt nur im
  Speicher. `POST /builds` reiht einen Bau ein, auch wenn für den Slug schon einer läuft.
  Dateinamen tragen nur das Datum (`manifest::datei_key`): Ein zweiter Bau am selben Tag behält
  die URL, nur Größe und SHA256 ändern sich.
- **Hub, Katalog.** `karte::katalog` hält den Katalog prozessweit, mit 5 Minuten TTL und
  `effektiver_katalog_frisch` zum Umgehen. `offline_liste` gleicht ohne Netz gegen den Cache ab
  (`finde_update_eintrag`: gleicher Name, andere URL, lieferbar).
- **Hub, Laden.** `offline_neu_laden` (In-Place-Tausch) prüft `pfad == karte-{id}.mbtiles`,
  reserviert den Fortschritts-Slot atomar (`download::reserviere_fortschritt`) und lädt im
  `tokio::spawn`. `verarbeite_in_place_ergebnis` tauscht oder räumt auf. Ein Fehler wird nur
  geloggt, die alte Karte bleibt aktiv. `offline_download` mit `ersetzt_karte_id` ist der
  zweite, ältere Update-Weg (neue Zeile).
- **Hub, karten-service.** `offline_bauen` und `service_get_liste` (`/builds`, `/regions`) laufen
  über `KARTEN_SERVICE_CLIENT` (10 s). Ohne URL und Token ist das Feature aus
  (`karten_bau_verfuegbar`).
- **Vorbild für einen Hintergrundlauf:** `karte::kritis::scheduler` (Startverzögerung, fester
  Prüftakt, `tick_einmal` ohne laufenden Scheduler testbar, Konfiguration aus `config.rs`).
- **Frontend.** `OfflineKartenVerwaltung.tsx` pollt die Liste alle 2 s, solange ein Download
  läuft, und den Bau-Status nur, wenn Bauten aktiv sind. „Stand“ parst es aus der URL
  (`standAusUrl`). `download_at` (SQLite-UTC ohne Zone) kommt schon mit, wird aber nicht gezeigt.

## Goals / Non-Goals

**Goals:**
- Heruntergeladene Karten folgen dem Katalog ohne Klick, ohne Ausfall und ohne zwei
  Mehr-GB-Downloads zur selben Zeit.
- „Jetzt aktualisieren“ ist ein Klick vom Anstoß bis zur getauschten Karte.
- Die Verwaltung beantwortet: Läuft gerade etwas? Seit wann gilt der Stand? Wann ist der nächste
  Lauf?

**Non-Goals:**
- Kein persistenter Laufzustand des Wächters. Gespeichert wird nur die Einstellung (D10). Nach
  einem Neustart sind „zuletzt geprüft“ und „letzter Fehler“ leer. Die nächste Prüfung holt jeden verpassten Stand nach, weil sie gegen
  den Katalog vergleicht.
- Der Cron-Ausdruck des karten-service wird aus dem Hub weder geändert noch angezeigt, außer als
  Text.
- Der Weg `ersetzt_karte_id` (neue Zeile) wird nicht entfernt (Folgetask).
- Kein eigenes Zeitfenster für automatische Downloads, etwa nur nachts.
- Kein Push (SSE) für den Status. Gepollt wird wie bisher.

## Decisions

**D1: Der Hub-Wächter ist ein eigener Tokio-Task nach dem Vorbild `kritis::scheduler`.**
Neues Modul `src/karte/auto_aktualisierung.rs`. Gestartet in `main.rs` (nur im Server-Lauf),
mit 60 s Startverzögerung. Der Takt ist der eingestellte Prüfabstand (D10), zusätzlich gilt:
- Solange ein Neubau aussteht, prüft er alle 30 s.
- Ein `tokio::sync::Notify` weckt ihn sofort, wenn „Jetzt aktualisieren“ einen Bau anstößt oder
  die Einstellung sich ändert (D10).
- Die Logik steckt in `tick_einmal(&Kontext) -> TickErgebnis`, ohne laufenden Task testbar.

Der Zustand liegt in `Arc<Mutex<WaechterZustand>>` im `AppState`:
- `letzte_pruefung_at` und `naechste_pruefung_at`
- `ausstehende_bauten: HashMap<karte_id, AusstehenderBau { slug, job_id, seit }>`
- `fehler: HashMap<karte_id, String>`
- `auto_laeuft: Option<karte_id>`

- *Verworfen: Cron im Hub (tokio-cron-scheduler).* Ein fester Abstand reicht, und der Neubau-Fall
  braucht ohnehin einen kurzen Takt.
- *Verworfen: Der karten-service ruft den Hub nach dem Bau zurück (Webhook).* Mehrere Hubs teilen
  sich einen Dienst, und der Hub ist oft nicht von außen erreichbar.

**D2: Ein Tick in festen Schritten.**
1. **Ausstehende Bauten auflösen.** `GET /builds` und je ausstehendem Eintrag den Job mit
   passender ID suchen:
   - `done`: Der Eintrag wechselt auf „wartet auf Katalog“ und erzwingt Schritt 2 frisch.
   - `failed`: Der Fehler wird an der Karte vermerkt, der Eintrag entfällt.
   - Job unbekannt (karten-service neu gestartet): wie `failed`, mit dem Text „Bau-Auftrag beim
     Kartenbau-Dienst nicht mehr bekannt“.
2. **Katalog prüfen.** Wenn fällig oder durch Schritt 1 erzwungen: `effektiver_katalog_frisch`.
   `letzte_pruefung_at` wird nur fortgeschrieben, wenn dieser Schritt lief.
3. **Laden.** Läuft kein automatischer Download (`auto_laeuft` leer, Fortschritts-Slot frei), wird
   die erste fällige Karte nach `sortier, id` geladen. Fällig ist eine gemanagte, bereite Karte
   mit neuerem Stand (D4). Gestartet wird über die gemeinsame Startfunktion (D3), nach dem
   Plattenplatz-Check gegen die Katalog-Größe. Die übrigen fälligen Karten kommen in den nächsten
   Ticks dran: Solange eine weitere wartet, gilt der kurze Takt.
4. **Warten auf den Katalog.** Eine Karte bleibt nach einem fertigen Bau höchstens 15 Minuten in
   „wartet auf Katalog“. Erscheint in der Zeit kein neuerer Stand (CDN-Cache des Manifests), wird
   der Fehler „Neubau fertig, Katalog zeigt noch keinen neuen Stand“ vermerkt.

Die Einstellung (D10) liest jeder Tick frisch aus der DB, eine Änderung braucht keinen Neustart.
Fällig ist die reguläre Prüfung, wenn `letzte_pruefung_at + intervall <= jetzt` oder noch nie
geprüft wurde. Ist die Automatik aus, entfallen die regulären Schritte 2 und 3. Sie laufen nur
für Karten, die „Jetzt aktualisieren“ ausgelöst hat, und `naechste_pruefung_at` bleibt leer.
Schritt 1 läuft immer. Ein Erfolg (Tausch fertig) löscht den Fehler der Karte.

**D3: Der In-Place-Start wird eine gemeinsame Funktion.**
`starte_in_place_reload(state, karte, url, sha256, groesse) -> Result<(), AppError>` übernimmt
den Körper von `offline_neu_laden` ab der Pfadprüfung. Pfadprüfung, URL-Validierung,
Plattenplatz, Slot-Reservierung und Spawn bleiben gleich. Neu meldet der Spawn sein Ergebnis an
den Wächterzustand: Er setzt oder löscht `fehler[id]` und räumt `auto_laeuft`. Dazu gibt
`verarbeite_in_place_ergebnis` ein `Result<(), String>` zurück, statt nur zu loggen. Handler,
„Jetzt aktualisieren“ und Wächter rufen dieselbe Funktion.
- *Warum In-Place auch für inaktive Karten:* Die Kennung bleibt stabil, die alte Datei wird bis
  zum Tausch ausgeliefert, und es gibt nur einen Fehlerpfad. Die Unterscheidung „aktiv → Neu
  laden, inaktiv → Aktualisieren“ im Frontend stammt aus der Zeit vor dem Multi-Vektor-Style (alle
  bereiten Regionen werden angezeigt). Der Server ließ In-Place schon immer für jede gemanagte
  Karte zu.

**D4: Update-Erkennung mit SHA256.**
`finde_update_eintrag(name, quell_url, sha256_installiert, katalog)` trifft, wenn:
- der Eintrag lieferbar ist und denselben Namen trägt, und
- eine andere URL führt, **oder** `e.sha256` und `sha256_installiert` beide gesetzt sind und
  voneinander abweichen.

Die Liste und der Wächter nutzen dieselbe Funktion.
- *Alternative: Zeitstempel mit Uhrzeit in `datei_key`.* Das ändert das Dateischema im Bucket und
  die Retention-Annahmen im Runbook, und das nur wegen eines Sonderfalls. Der SHA-Vergleich ist
  lokal und deckt auch einen manuell überschriebenen Mirror ab.
- *Risiko:* Ein Katalogeintrag, dessen Pin nicht zur ausgelieferten Datei passt, böte sich bei
  jeder Prüfung erneut an. Der Download scheitert dann an der Prüfsumme, und der Fehler steht an
  der Karte. Damit nicht alle 6 h mehrere GB fließen, sperrt ein Prüfsummenfehler die Karte für
  dieselbe (URL, Pin)-Kombination: `gesperrt[id] = (url, sha256)` im Speicher, bis der Katalog
  etwas anderes führt oder ein Admin „Jetzt aktualisieren“ wählt.

**D5: Karte ↔ Region über den Dateinamen der Quell-URL.**
Der Slug ist das Präfix des Dateinamens vor dem ersten Punkt. Das ist dieselbe Regel wie
`manifest::published_aus_eintrag` im karten-service, gebaut wird `bayern.20260705.shortbread.mbtiles`.
Der Hub prüft den Slug gegen `GET /regions`. Ist er dort nicht bekannt, ist die Region nicht
baubar (D6, letzter Zweig). Die Regel wandert als `slug_aus_url` nach `crates/karten-katalog`,
damit beide Seiten dieselbe Funktion nutzen.

**D6: `POST /api/karte/offline-karten/{id}/jetzt-aktualisieren` (Admin).**
Ablauf:
1. Die Karte muss gemanagt sein und eine Quell-URL tragen, sonst 422 (Zusammenhang).
2. Läuft schon etwas (Fortschritts-Slot belegt oder Bau ausstehend), ebenfalls 422 (Zustand).
3. Frischer Katalog.
4. Gibt es einen neueren Stand (D4, eine Sperre aus D4 wird aufgehoben), startet D3. Antwort
   `202 {"phase":"laedt"}`.
5. Sonst, wenn der karten-service konfiguriert ist und den Slug kennt: `GET /builds`. Gibt es
   einen aktiven Job für den Slug, hängt sich der Hub daran. Sonst ruft er `POST /builds`. Danach
   `ausstehende_bauten[id]` setzen, den Wächter wecken und mit `202 {"phase":"bau_wartet"}` oder
   `{"phase":"baut"}` antworten.
6. Sonst `200 {"phase":"aktuell"}`.

Ist der karten-service nicht erreichbar, antwortet der Server mit 502 wie `offline_bauen`.
Antwort-DTO: `JetztAktualisierenAntwort { phase: JetztPhase }`. `JetztPhase` ist ein feldloses
Enum `laedt | bau_wartet | baut | aktuell`, gepinnt in `tests/enum_wire_kontrakt.rs`.
- *Warum 422 und nicht 409 für „läuft schon“:* Das ist Zustand, keine Nebenläufigkeit im
  CAS-Sinn (`src/AGENTS.md`, Statuscode-Konvention). `offline_neu_laden` antwortet im gleichen
  Fall schon mit 422.

**D7: `GET /api/karte/offline-karten/aktualisierung` (Lesen wie die Liste: `darf_admin_bereich`).**
Antwort `AktualisierungsStatus`:
- `automatisch: bool` und `intervall_stunden: u64`, die effektive Einstellung nach D10
- `letzte_pruefung_at` und `naechste_pruefung_at`, beide `Option<String>`, RFC 3339 UTC
- `bau_dienst: BauDienst` mit den Werten `nicht_konfiguriert | erreichbar | unerreichbar`
- `naechster_bau_at: Option<String>`
- `karten: Vec<KarteAktualisierung { karte_id, phase: Option<AktualisierungsPhase>, fehler: Option<String> }>`

`AktualisierungsPhase` hat die Werte `bau_wartet | baut | wartet_auf_katalog | laedt`.

Die Phase je Karte ergibt sich so, Vorrang von oben nach unten:
1. Fortschritts-Slot belegt → `laedt`
2. Ausstehender Bau nach Job-Status → `bau_wartet` (queued), `baut` (building, uploading,
   publishing) oder `wartet_auf_katalog`
3. Sonst ein aktiver Job in `/builds`, dessen Slug zur Karte passt (D5). Das sind auch die
   Cron-Bauten → `bau_wartet` oder `baut`

Der Handler ruft `/builds` und `/zeitplan` live mit 3 s Timeout. Schlägt einer fehl, gilt
`unerreichbar`: Es kommt keine 502, die Antwort bleibt 200, damit die Verwaltung bedienbar
bleibt (Spec). Die Liste (`offline_liste`) bleibt ohne Netz.
- *Verworfen: Phase und Fehler in `OfflineKarteAntwort`.* Die Liste pollt alle 2 s und dürfte
  dann nicht mehr ohne Netz bleiben. Ein eigener Endpunkt pollt seltener (D9) und trägt die
  globale Zeile ohnehin.

**D8: karten-service `GET /zeitplan`.**
`scheduler::starte` gibt `(JobScheduler, Uuid)` zurück. Der `AppState` des karten-service bekommt
`zeitplan: Option<(JobScheduler, Uuid, String)>`: `None` im Modus `build`, in Tests ein Fake.
Antwort `Zeitplan { naechster_lauf: Option<String>, cron: String }` als geteilter Typ in
`crates/karten-katalog`, damit er durch den Typ-Codegen läuft. Bearer wie die übrigen Routen.
Das Runbook wird korrigiert: Der Cron läuft in UTC. `KS_SCHEDULE` bleibt unverändert, das
Verhalten ändert sich nicht.

**D9: Frontend.**
- Neuer Seam `ladeAktualisierungsStatus` und `starteJetztAktualisieren` in
  `api/offlineKarten.ts`, Key `globalKeys.adminKarteBereich('aktualisierung')` (vom
  Bereichs-Prefix erfasst, `invalidiereKarte` zieht ihn mit).
- Polling: alle 2 s, solange eine Karte eine Phase trägt, sonst alle 60 s.
- Die Liste pollt zusätzlich, solange eine Phase `laedt` meldet. Ein vom Wächter gestarteter
  Download soll seinen Fortschritt zeigen, obwohl ihn kein Klick ausgelöst hat.
- **Zeile über der Tabelle** (keine Alert-Fläche, es ist Auskunft und keine Warnung). Für Admins
  steht vorn ein Schalter „Automatisch aktualisieren“ (`Switch`, klein), dahinter ein Auswahlfeld
  „alle {n}“ mit 1 h, 3 h, 6 h, 12 h, 24 h und 7 Tagen. Ein gespeicherter Wert außerhalb dieser
  Liste erscheint als eigene Option. Jede Änderung speichert sofort (`PUT`, Rückmeldung per
  `message`), bei einem Fehler springt die Anzeige zurück. Für Nicht-Admins steht derselbe Inhalt
  als Text: „Automatisch aktualisieren: an, alle 6 h“.
  Dahinter als Sekundärtext: „zuletzt geprüft {t} · nächste Prüfung {t} · nächster Kartenbau {t}“.
  Bei `unerreichbar` steht statt des letzten Teils „Kartenbau-Dienst nicht erreichbar“, bei
  `nicht_konfiguriert` entfällt er. Ist die Automatik aus, entfällt „nächste Prüfung“.
- **Spalte Name:** „Stand {JJJJ-MM-TT} · auf dem Gerät seit {t}“ (`download_at` über
  `anzeige/zeitEingabe.ts`/`anzeige/format.ts`, UTC → Ortszeit).
- **Spalte Status:**
  - `laedt` behält den Fortschritt („aktualisiert“).
  - `bau_wartet` → Tag „Neubau wartet“, `baut` → „wird neu gebaut“, `wartet_auf_katalog` →
    „wird veröffentlicht“, jeweils mit `IkoneLadekreis`.
  - Ein Fehler zeigt Tag „Update fehlgeschlagen“ mit Tooltip.
- **Spalte Aktionen:**
  - „Jetzt aktualisieren“ ersetzt „Aktualisieren“ und „Neu laden“. Er erscheint für gemanagte
    Karten mit Quell-URL ohne laufende Phase.
  - Rückmeldung je Phase: „Update lädt …“, „Neubau angestoßen – die Karte wird danach
    automatisch getauscht“ oder „Die Karte ist aktuell“.
  - „Gemanagt“ entscheidet das neue Listenfeld `aktualisierbar: bool` (`pfad == karte-{id}.mbtiles`
    und `quell_url` gesetzt). Das Frontend leitet es nicht selbst aus dem Pfad ab.
- Zeit- und Leseformen halten sich an `frontend/AGENTS.md`. Wie sie beim Umsetzen geprüft
  werden, steht in tasks.md.

**D10: Einstellung in der Verwaltung, Env nur als Vorgabe (Entscheidung 02.10.2026).**
- **Speicher:** Migration `0134_karte_auto_aktualisierung.sql` legt die Tabelle
  `karte_auto_aktualisierung (id INTEGER PRIMARY KEY, automatisch INTEGER NOT NULL,
  intervall_stunden INTEGER NOT NULL, geaendert_at TEXT NOT NULL, geaendert_von INTEGER
  REFERENCES benutzer(id))` an. Es gibt höchstens eine Zeile mit `id = 1`, das Repo schreibt per
  `INSERT … ON CONFLICT(id) DO UPDATE`. Es gibt keinen DB-CHECK, validiert wird in Rust wie bei
  `org_einstellungen`. Die Einstellung gilt serverweit, nicht je Organisation: Auch die
  Offline-Karten sind serverweit (`karte_offline_karte` hat kein `org_id`). Die Nummer 0134 liegt
  über der höchsten auf `origin/alpha` (0133, Stand 02.10.2026). Vor dem Merge prüft das
  `scripts/check-migrationen.sh`.
- **Effektivwert:** gespeicherte Zeile, sonst Env-Vorgabe. `--karten-auto-aktualisierung` /
  `LIFELINE_KARTEN_AUTO_AKTUALISIERUNG` (bool, Vorgabe `true`, `ArgAction::Set` wie
  `kritis_extrakt`) und `--karten-auto-aktualisierung-intervall-stunden` /
  `LIFELINE_KARTEN_AUTO_AKTUALISIERUNG_INTERVALL_STUNDEN` (Vorgabe 6). Den Rahmen setzt
  `tests/env_config_guard.rs`. Ins Startup-Log kommen beide Vorgaben, die Hilfe nennt sie
  ausdrücklich „Vorgabe, solange in der Verwaltung nichts gespeichert ist“.
- **Schreiben:** `PUT /api/karte/offline-karten/aktualisierung/einstellung` (`AdminUser`,
  Body `{automatisch: bool, intervall_stunden: u64}`). Ein `intervall_stunden` außerhalb
  1…168 ergibt 400 (Feld für sich, `src/AGENTS.md`). Die Antwort ist der aktuelle
  `AktualisierungsStatus` (D7), damit die Oberfläche ihn direkt übernimmt. Danach wird der Wächter
  geweckt (`Notify`). Er berechnet `naechste_pruefung_at` neu und prüft sofort, wenn die neue
  Fälligkeit schon erreicht ist.
- *Verworfen: Feld in `org_einstellungen`.* Die Karten gehören nicht zu einer Organisation. Zwei
  Organisationen mit verschiedener Einstellung hätten keinen eindeutigen Wächtertakt.
- *Verworfen: nur Env.* Das widerspricht der Entscheidung, und eine Änderung bräuchte einen
  Neustart.

## Risks / Trade-offs

- **[Mehrere GB ohne Klick]** → Es läuft immer nur ein automatischer Download, mit
  Plattenplatz-Check davor. Die Automatik ist abschaltbar, und ein Prüfsummenfehler sperrt die
  Kombination (D4).
- **[Manifest-CDN liefert nach dem Bau noch den alten Stand]** → Bis zu 15 Minuten „wartet auf
  Katalog“ mit kurzem Takt, danach ein sichtbarer Fehler (D2.4). Die reguläre Prüfung holt den
  Stand später ohnehin.
- **[Gleicher Dateiname am selben Tag, CDN liefert noch die alte Datei]** → Der Download scheitert
  an der Prüfsumme. Fehler und Sperre (D4) verhindern eine Endlosschleife, der nächste Bau oder
  „Jetzt aktualisieren“ löst sie.
- **[Neustart des karten-service verliert Jobs]** → Ein unbekannter Job gilt als gescheitert (D2.1).
  Ist der Bau doch veröffentlicht worden, holt ihn die reguläre Prüfung.
- **[Neustart des Hubs verliert ausstehende Bauten]** → Der Bau läuft weiter. Die nächste reguläre
  Prüfung lädt das Ergebnis, nur verspätet, im schlimmsten Fall nach einem Intervall.
- **[Live-Aufrufe im Status-Endpunkt]** → 3 s Timeout. Polling alle 60 s im Ruhezustand. Ein
  Fehler wird zu `unerreichbar`, nie zu einem Fehler der Seite.
- **[Zwei Schreiber auf denselben Fortschritts-Slot (Admin und Wächter)]** → Die bestehende atomare
  Reservierung (`reserviere_fortschritt`) entscheidet. Der Verlierer bekommt 422 oder überspringt
  die Karte im Tick.

## Migration Plan

Die Migration 0134 legt nur die leere Tabelle an, es gibt keine Datenübernahme. Nach dem Deploy
prüft der Wächter 60 s nach dem Start zum ersten Mal und lädt dann, was der Katalog Neueres führt.
Wer das beim Rollout nicht will, setzt vorher `LIFELINE_KARTEN_AUTO_AKTUALISIERUNG=false`. Danach
schaltet ein Admin die Automatik in der Verwaltung ein, wann es passt. Der karten-service ist unabhängig deploybar: Ein
älterer Dienst ohne `/zeitplan` liefert 404, der Hub zeigt dann keinen nächsten Kartenbau
(`naechster_bau_at: null`, `bau_dienst` bleibt `erreichbar`, wenn `/builds` antwortet). Rückweg: Automatik in der Verwaltung ausschalten. Ein Rollback des Codes lässt die Tabelle
ungenutzt stehen. Der Code bleibt rückwärtskompatibel, die alten Endpunkte bleiben.
