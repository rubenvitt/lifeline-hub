# Design

## Context

Siehe `proposal.md` (Why). Der Ist-Stand, der den Entwurf trägt:

- `LiveHub` (`src/live/mod.rs`) hält `HashMap<einsatz_id, Kanal>` mit Broadcast-Sender, monotoner
  Id `"{epoch}-{n}"` und Replay-Ring. `GET /api/einsaetze/{id}/live` (`routes/live.rs`) öffnet ihn
  hinter `EinsatzLesezugriff` und filtert je Ereignis über `LiveEvent::modul_keys` gegen einen
  Rechte-Schnappschuss vom Verbindungsaufbau. Außerhalb von `/einsaetze/:id` ist im Frontend keine
  Live-Verbindung offen (`EinsatzLayout.tsx` hostet `useEinsatzLiveStream`).
- `GET /api/einsaetze` (`einsatz::repo::liste_fuer`) filtert je Zeile über `darf_lesen`:
  org-weite Leser (`darf_fremdeinsatz_lesen`: System-Admin aller Orgs, Führungskraft der eigenen
  Org) sehen alles, sonst nur Mitglieder (Nichtleitung nur aktiv und 24 h Nachlauf). Die Zeile
  trägt Kopfspalten (auch `naechste_lagebesprechung_at`), `org_name`, Führungsfunktions-Labels
  und benutzerbezogene `meine_*`-Felder.
- Die Katalog-Routen (`src/app.rs`, Block Stammdaten) lesen mit `CurrentUser` je `org_id` und
  schreiben mit `AdminUser`. Keine von ihnen publiziert. Ihre Listen joinen keine Einsatzdaten.
- Frontend: `EINSATZ_STREAM_EVENTS` bildet Wire-Namen auf zweistellige Keys `[prefix, einsatzId]`
  ab. `GLOBAL_KEYS` ist bisher nur dokumentarisch gegliedert. Der Kommentar dort verlangt eine
  XOR-Partition, sobald ein Konsument kommt. Die globale `staleTime` liegt bei 10 s.
- HTTP/1.1 erlaubt sechs Verbindungen je Origin über alle Tabs. Deshalb hält ein Tab heute genau
  eine SSE-Verbindung (`useEinsatzLiveStream.ts`, Kopfkommentar). Tab-übergreifendes Teilen ist
  offen (LFH-264).

## Goals / Non-Goals

**Goals:**

- Liste und Kataloge ohne Fokuswechsel frisch, auf jedem angemeldeten Schirm.
- Kein Metadaten-Leck: Wer einen Einsatz nicht sehen darf, erfährt nicht, dass sich an ihm etwas
  ändert (Linie von F01/LFH-227).
- Keine zusätzliche Verbindung je Tab.
- Die Gate-Semantik von `LiveEvent` (Modul-Bindung, zwei gepinnte Ausnahmen) bleibt unberührt.

**Non-Goals:**

- Tab-übergreifendes Teilen einer Verbindung (LFH-264).
- `meine_*`-Felder im Einsatzkopf live (LFH-854) und Lagekennzahlen live (LFH-855). Die
  Einsatzliste wird bei einer Mitgliedschaftsänderung zwar frisch, der Kopf eines offenen
  Einsatzes aber nicht.
- Zeitgesteuerte Sichtbarkeitswechsel (Nachlauf 24 h, Ablauf der Aufbewahrungsfrist): Sie haben
  keinen Schreibvorgang und damit keinen Auslöser. Sie bleiben beim Refetch.
- Org-Einstellungen und Org-Modul-Einstellungen (enger Lesekreis, Modulwechsel wirkt auf den
  Rechte-Schnappschuss der Einsatz-Ströme, eigenes Thema), Benutzerverwaltung, instanzweite
  Kartenkonfiguration.
- Replay verpasster Org-Ereignisse (D4).

## Decisions

### D1 Transport: Einsatz-Strom trägt mit, Org-Strom nur außerhalb des Einsatzes

Innerhalb eines Einsatzes führt `GET /api/einsaetze/{id}/live` die Org-Ereignisse mit: Die Route
abonniert zusätzlich den Org-Kanal und verschmilzt beide Ströme (`StreamExt::merge`). Außerhalb
öffnet das Frontend `GET /api/live` (Tür: `CurrentUser`, kein Einsatz). Ein Tab hat damit immer
höchstens eine SSE-Verbindung.

Verworfen:
- **Eigener, immer offener Org-Strom:** Im Einsatz wären es zwei Verbindungen je Tab. Drei Tabs
  füllen dann die sechs HTTP/1.1-Plätze, und jeder weitere Request hängt. Genau davor warnt der
  Kopf von `useEinsatzLiveStream.ts`.
- **Ein einziger Strom `/api/live?einsatz=…` für alles:** Er ersetzt die Tür des Einsatz-Stroms
  (`EinsatzLesezugriff`) und verschiebt Replay, Zulassung und Kontext-Guards. Das ist ein Umbau
  ohne Mehrwert für dieses Ticket.
- **Kürzere `staleTime` oder `refetchInterval`:** Das ist kein Kanal. Es kostet Last bei jedem
  Client und bleibt trotzdem verzögert.

### D2 Eigene Ereignisfamilie `OrgLiveEvent` mit zwei groben Ereignissen

`OrgLiveEvent` ist ein eigenes `wire_enum!` mit `Einsatzliste => "einsatzliste"` und
`Stammdaten => "stammdaten"`. Es bekommt einen eigenen Wire-Kontrakt (Rust
`tests/enum_wire_kontrakt.rs`, FE-Kontrakttest gegen `ORG_STREAM_EVENTS`) und einen
Disjunktheits-Guard gegen `LiveEvent`, weil beide auf derselben Verbindung laufen.

Verworfen:
- **Varianten in `LiveEvent`:** Ihre Gate-Menge wäre leer. Damit brauchte es eine dritte Ausnahme
  in `ungegatet_sind_nur_lagged_und_einsatz`, und die Füll-Regel („Modul des Datenobjekts")
  passte nicht. Außerdem landeten sie im Einsatz-Ring und in dessen Id-Folge.
- **Ein Ereignis je Katalog:** Das wären 13 Wire-Namen, darunter Kollisionen mit `personal`,
  `material` und `fahrzeug` der Einsatz-Familie. `invalidateQueries` ruft nur Abfragen mit aktivem
  Beobachter neu ab, die übrigen werden nur als veraltet markiert. Das grobe Ereignis kostet also
  einige wenige GETs auf einem Katalog-Schirm, und dafür reicht ein Emitter-Pfad.

### D3 Empfängerfilter: Org-Kanal mit Empfängerangabe, Rollen-Schnappschuss beim Aufbau

Der `LiveHub` bekommt **einen** prozessweiten Broadcast-Kanal für Org-Nachrichten
(`OrgNachricht { org_id, event, empfaenger }`, Kapazität 256). `empfaenger` ist entweder
- `Organisation`: jeder Abonnent mit derselben `org_id` (für `stammdaten`), oder
- `Einsatzleser { benutzer_ids }`: org-weite Leser der Org, System-Admins jeder Org und die
  genannten Benutzer (für `einsatzliste`).

Der Abonnent hält einen Schnappschuss vom Verbindungsaufbau: `benutzer_id`, `org_id`,
`ist_admin`, `darf_fremdeinsatz_lesen(org_id)`. Wie bei den Modulrechten wirkt ein Rollenwechsel
erst beim Wiederaufbau (`routes/live.rs`, „Revokation = Snapshot"). Die Nutzlast ist leer, das
Restfenster verrät also nichts als „etwas hat sich geändert".

`benutzer_ids` ermittelt der Emitter **nach** dem Commit mit einer Abfrage auf
`einsatz_mitgliedschaft`. Bei einer Mitgliedschaftsänderung kommt die betroffene Person hinzu, auch
eine entfernte. Beim Demo-Entfernen (harter `DELETE`) liest die Transaktion die Mitglieder vor dem
Löschen und gibt sie mit zurück.

Die Mitgliedermenge ist eine Überdeckung von `darf_lesen`: Ein Mitglied ohne Leitung, dessen
Nachlauf abgelaufen ist, bekommt noch das Ereignis, sieht in der neu geladenen Liste aber nichts.
Es erfährt nur, dass sich an einem Einsatz etwas geändert hat, in dem es Mitglied ist. Das ist
hinnehmbar und billiger als eine zweite `darf_lesen`-Auswertung je Ereignis.

Verworfen:
- **Leeres Ereignis an alle der Org:** Jeder sähe den Takt fremder Einsätze, etwa jedes
  Kopf-PATCH. Das ist der Metadaten-Kanal, den F01 geschlossen hat.
- **`darf_lesen` je Abonnent und Ereignis:** Das kostet einen DB-Read je Abonnent und erreicht
  eine gerade entfernte Person nicht mehr.
- **Kanal je Org (`HashMap<org_id, …>`):** System-Admins müssten jeden Org-Kanal abonnieren. Bei
  dem geringen Aufkommen (Admin-Schreibvorgänge, Einsatz-Lebenszyklus) ist ein gefilterter Kanal
  einfacher.

### D4 Kein Replay für Org-Ereignisse, Vollabgleich beim Wiederaufbau

Org-Ereignisse gehen **ohne** `id:` hinaus und nicht in den Replay-Ring des Einsatzes. Die
`Last-Event-ID` des Browsers bleibt damit die des letzten Einsatz-Ereignisses, und die Replay-Logik
des Einsatz-Kanals bleibt unverändert. Verpasste Org-Ereignisse fängt das Frontend ab: Jeder
Wiederaufbau (`onopen` nach dem ersten) und jedes `lagged` ruft auch die live geführten globalen
Keys neu ab. Der Org-Strom ruft sie bei **jedem** `onopen` ab, auch beim ersten. So schließt er
die Lücke beim Wechsel vom Einsatz-Strom in die Liste. Ein Überlauf des Org-Kanals erzeugt wie beim
Einsatz `lagged`.

Verworfen: **eigener Ring und Id-Raum:** Zwei Id-Räume auf einer Verbindung vertragen sich nicht
mit einer einzigen `Last-Event-ID`. Der Gewinn wäre klein, denn das Ereignis bedeutet nur
„neu laden", und das Neuladen ist billig.

### D5 Emitter: `einsatzliste` explizit, `stammdaten` per Middleware

- **`einsatzliste`:** Ein Helfer `live::einsatzliste_melden(pool, live, einsatz_id, extra)`
  ermittelt Org und Mitglieder und publiziert. Jeder bestehende `einsatz`-Emitter (über
  `kopf_geaendert` in `routes/einsatz.rs` und in `routes/stab.rs`) ruft ihn mit auf, denn die Liste
  zeigt dieselben Kopfspalten. Dazu kommen Anlage, Mitglied setzen und entfernen, Wiederherstellen
  (`routes/aufbewahrung.rs`), Demo-Routen und der Purge-Scheduler. `starte_purge_scheduler`
  bekommt den `LiveHub`, wie der Erinnerungs-Scheduler.
- **`stammdaten`:** Eine Middleware am Router (`routes::live::stammdaten_live`) publiziert
  nach jeder schreibenden Anfrage mit 2xx an die Org des angemeldeten Benutzers, wenn das
  `MatchedPath`-Muster unter einem Präfix aus `STAMMDATEN_PFADE` liegt (Muster der
  Ausnahmeliste in `zulassung.rs`). Der Handler hat dann schon committet. Ein Guard
  (`tests/stammdaten_live_guard.rs`) liest `src/app.rs`: Jede schreibende Route eines
  Katalog-Moduls außerhalb von `/api/einsaetze/` muss unter einem Präfix liegen, und jeder Präfix
  braucht eine schreibende Route. Eine neue Route unter einem bestehenden Katalogpfad ist damit
  ohne eigenes Zutun live, ein neuer Pfad fällt im Guard auf. Demo-Import, -Neuimport und
  -Entfernen publizieren `stammdaten` explizit.

  Umgesetzt mit Präfixliste statt eines eigenen Teil-Routers: Das Ergebnis ist dasselbe, aber
  rund 60 Routen in `src/app.rs` müssen nicht umziehen, und es bleibt kein Raum für Konflikte
  zwischen zwei Routern mit demselben Pfad (GET und POST getrennt registriert).

Verworfen: **Aufruf in jedem Katalog-Handler.** Das wären rund 35 Stellen, und eine vergessene
fällt keinem Test auf.

### D6 Frontend: Registry, XOR-Partition, gemeinsamer Verbindungsbau

- `api/queryKeys.ts`: `ORG_STREAM_EVENTS = { einsatzliste: [einsaetze, demoDaten, aufbewahrung],
  stammdaten: [alle Katalog-Prefixe, organisation, einsaetze] }` und `NICHT_LIVE_GLOBAL_KEYS`
  (`benutzer`, `orgEinstellungen`, `orgModulEinstellungen`, `authProvider`,
  `benutzerEinstellungen`, `adminKarte`, `karteConfig`, `fachebene`). Der Guard verlangt: Jeder
  `GLOBAL_KEYS`-Eintrag steht in genau einer der beiden Klassen. Die Invalidierung nutzt den
  einstelligen Prefix (`[key]`), trifft also auch Sub-Keys wie `personalListe('alle')`.
  `demoDaten` und `aufbewahrung` sind Admin-Listen. Ihre Invalidierung bei jedem Empfänger verrät
  nichts, denn der GET bleibt gegatet, und ohne aktiven Beobachter ruft sie nichts ab.
- `live/liveVerbindung.ts` (neu): Der Verbindungsbau aus `useEinsatzLiveStream` wird ausgelagert
  (Backoff, `/api/auth/me`-Probe, Status-Ereignis, Listener-Anbau, Wiederaufbau-Rückruf). Vorher
  sichern Charakterisierungstests das Verhalten. `orgListener(qc)` liefert die Listener aus
  `ORG_STREAM_EVENTS`. Der Einsatz-Hook hängt sie zusätzlich an und nimmt die Org-Keys in
  `lagged` und den Wiederaufbau auf.
- `live/useOrgLiveStream.ts` (neu), gehostet in `BetriebsLayout`: aktiv nur mit angemeldetem
  Benutzer und nur, wenn keine Route `/einsaetze/:id/*` passt. Die Bedingung kommt aus derselben
  Pfadangabe wie die Route in `App.tsx`, damit beide nicht auseinanderlaufen. Statusmeldungen
  laufen über dasselbe `lfh:live-status`, denn es ist immer nur ein Strom aktiv.

### D7 Zulassung und Route

`("GET", "/api/live")` kommt in `OHNE_ZULASSUNGSGRENZE`. Der Pfad liegt bewusst nicht unter
`/api/einsaetze/`, damit er weder mit `{id}` kollidiert noch in `PFAD_KEY` oder die
Kontext-Guards fällt. Das erste Byte ist wie beim Einsatz-Strom der Kommentar `verbunden`.

## Risks / Trade-offs

- [Mehr Refetches: Jede Kopfänderung lädt bei Mitgliedern mit offener Liste die Liste neu] → Das
  Aufkommen ist gering (Kopfänderungen sind selten). Ohne aktiven Beobachter wird nur markiert,
  nicht abgerufen.
- [Überdeckung der Empfänger (D3, abgelaufener Nachlauf)] → Die Nutzlast ist leer. Die Lücke ist
  dokumentiert und auf eigene Mitgliedschaften begrenzt.
- [Rollen-Schnappschuss: Wer zur Führungskraft wird, bekommt Listen-Ereignisse fremder Einsätze
  erst nach dem Wiederaufbau] → Das ist dieselbe Regel wie bei den Modulrechten. Der Fokus-Refetch
  bleibt als Netz.
- [Wechsel zwischen Einsatz- und Org-Strom erzeugt kurz zwei Verbindungen oder keine] → Effekte
  räumen synchron auf. Der Org-Strom lädt bei jedem `onopen` nach (D4).
- [Middleware publiziert auch bei 2xx ohne echte Änderung, etwa einem idempotenten PUT] → Das
  kostet nur einen Refetch. Es verrät nichts, was der Katalog-GET nicht ohnehin zeigt.
- [Neuer Emitter-Pfad für `einsatzliste` wird vergessen] → Je Auslöser gibt es einen
  Integrationstest. Der Kopf-Pfad hängt am gemeinsamen Helfer, also folgt jeder künftige
  `einsatz`-Emitter mit.

## Migration Plan

Ein PR, Reihenfolge wie bei LFH-555: Backend (Hub, Route, Emitter, Middleware) → Codegen →
Frontend. Die Wire-Kontrakte beider Seiten stehen im selben Commit wie das Enum. Keine Migration.
Rückweg ist ein Revert. Ohne Frontend-Teil bleibt das Backend kompatibel, denn unbekannte
SSE-Ereignisse ignoriert `EventSource`.
