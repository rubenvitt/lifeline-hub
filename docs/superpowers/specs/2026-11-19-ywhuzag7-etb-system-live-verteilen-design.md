# System-ETB-Einträge live verteilen — Entwurf

Stand: 19.11.2026 · Zunder: LLH-1976 (`ywhuzag78bi3k31glbjlfjzs`) · Folge aus LLH-1952
Weg und Zuschnitt abgestimmt mit Ruben am 19.11.2026 (Phase-1-Checkpoint).

## Absicht

Ein Modul, das einen System-Eintrag ins Einsatztagebuch schreibt (Einheit aufgelöst, Material
disponiert, Tier angelegt …), soll ihn **sofort** auf jedem anderen Schirm zeigen. Heute verwerfen
viele Schreibwege die `etb_id` und senden kein Ereignis `etb`. Der zweite Schirm sieht den Eintrag
deshalb erst nach `staleTime` oder Neuladen. Für ein Tagebuch, das die Führung live mitliest, ist
das ein Fehler.

LLH-1952 hat Personal und Fahrzeuge nachgezogen. Dieser Task zieht den Rest nach und sorgt dafür,
dass ein neuer Schreibweg ohne Verteilung in den Tests rot wird.

## Ziele

- Jeder System-ETB-Eintrag einer Route geht nach dem Commit als Ereignis `etb` (ID-only,
  `LiveHub::publiziere`) hinaus. Das ist das Akzeptanzkriterium.
- Dasselbe gilt für die Hintergrundläufe des Löschlaufs (`einsatz/purge_scheduler.rs`), soweit
  der Eintrag danach noch existiert.
- **Wächter:** In Debug- und Test-Builds prüft eine Laufzeit-Klammer je Anfrage und je
  Scheduler-Tick, dass jeder dabei committete ETB-Eintrag auch verteilt wurde. Fehlt einer, gibt
  es einen Panic, und der Test wird rot. Alle bestehenden Routen-Tests prüfen damit automatisch mit.
- Die Regel steht in `src/AGENTS.md` (E2).

## Nicht-Ziele

- Instanz-Spiegel (`instanz/spiegel/fuehrung.rs`, `lebensende.rs`), Demo-Import (`demo/import.rs`
  samt Route `demo_daten`) und Dev-Seed verteilen nicht. Sie bekommen eine **benannte Ausnahme**
  im Wächter (s. u.).
- Keine Änderung am Wire-Format des Ereignisses `etb` und keine am Frontend. Das Frontend reagiert
  schon heute auf `etb` mit einem Refetch.
- Keine Sammelvariante `publiziere_alle` auf `LiveHub`. Die vorhandenen Schleifenhelfer der Module
  bleiben, wie sie sind.

## Anti-Ziele

- Ein Ereignis für einen Eintrag, der nie committet wurde, etwa aus einem zurückgerollten
  `write_retry!`-Versuch.
- Ein Ereignis **vor** dem Commit, sodass der Refetch des Clients den Eintrag noch nicht findet.
- Kosten oder Panics im Release-Build. Der Wächter existiert dort nicht.
- Die Verteilung wird unsichtbar: Sie bleibt ein expliziter Aufruf im Handler oder Ablauf.

## Ansätze

- **A — Pro Stelle verteilen + Laufzeit-Wächter (gewählt).** Jede Route gibt ihre ETB-IDs aus
  der Transaktion zurück und verteilt sie nach dem Commit selbst, wie in LLH-1952. Eine
  Debug-Klammer merkt sich geschriebene und verteilte IDs und schlägt bei einer Lücke an. Die
  Verteilung bleibt im Handler lesbar. Künftige Routen fallen in jedem Test auf, der sie berührt,
  und der Release-Build kostet nichts.
- B — Automatisch zentral: Eine Middleware verteilt nach der Antwort alle committeten, noch nicht
  verteilten IDs. Das braucht kaum Änderungen an Routen, dafür passiert die Verteilung unsichtbar,
  braucht eine Doppelt-Sperre neben den bestehenden expliziten Aufrufen und ändert das Verhalten
  im Release-Build. Verworfen.
- C — Nur pro Stelle, ohne Wächter: am kleinsten, aber die nächste Route ohne Verteilung bliebe
  wieder unbemerkt. Das widerspricht dem Auftrag. Verworfen.

## Der Wächter (`src/etb/nachlauf.rs`, nur `cfg(debug_assertions)`)

**Mechanik:**

- Ein `tokio::task_local!` hält einen Sammler `{ geschrieben: Vec<(einsatz_id, etb_id)>,
  verteilt: HashSet<etb_id>, ausgenommen: HashSet<etb_id> }` hinter einem `RefCell`.
- **Erfassen beim Schreiben:** `etb::repo::einfuegen`, der eine INSERT in `etb_eintrag`, über den
  alle Schreibwege laufen, trägt die neue ID ein, sofern ein Sammler aktiv ist (`try_with`). Ohne
  Sammler passiert nichts.
- **Erfassen beim Verteilen:** `LiveHub::publiziere`, der einzige Emitter von `etb`, trägt die
  ID als verteilt ein.
- **Prüfen:** Die Klammer `nachlauf::pruefe(pool, fut)` führt `fut` im Scope des Sammlers aus.
  Danach liest sie aus der Datenbank, welche der geschriebenen und weder verteilten noch
  ausgenommenen IDs **existieren** (`SELECT id FROM etb_eintrag WHERE id IN (…)`). Zurückgerollte
  Versuche und inzwischen gelöschte Einträge (Archiv, Schwärzen mit Löschen) fallen damit von
  selbst heraus. Bleibt etwas übrig, folgt ein Panic mit Einsatz-ID, ETB-ID und Inhalt des
  Eintrags. Damit ist im Test sofort zu sehen, welcher Schreibweg fehlt.
- **Wo die Klammer sitzt:** als äußerste Schicht in `app::build_router_mit` (eine
  `axum::middleware::from_fn_with_state`, die den Handler-Future umschließt) und um den Rumpf von
  `purge_scheduler::tick_mit_rueckschrieb`. Bei SSE-Strömen endet die Prüfung mit dem Aufbau der
  Antwort, nicht mit dem Strom.
- **Benannte Ausnahme:** `nachlauf::ohne_verteilung(grund, fut)` markiert alle in `fut`
  geschriebenen IDs als ausgenommen. `grund` ist ein `&'static str` und steht im Code. Benutzt von:
  Demo-Import (Route `demo_daten`), Instanz-Abgleich (`instanz/spiegel/abgleich.rs`,
  `handle_abgleich`) und Dev-Seed. Eine neue Ausnahme ist eine bewusste Entscheidung im Diff.
- **Release-Build:** `pruefe` und `ohne_verteilung` sind dort ein durchgereichtes `fut.await`,
  die Erfassung ist leer. Kein task-local, keine Abfrage.

**Warum ein Panic und nicht nur ein Log:** Integrationstests treiben den Router über `oneshot`.
Ein Panic im Middleware-Future schlägt bis in den Test durch und macht ihn rot, ein Log nicht.
Im lokalen `cargo run` (Debug) bricht dieselbe Anfrage laut ab. Gewollt: Das ist ein
Programmierfehler.

**Bekannte Grenze:** Was ein Handler per `tokio::spawn` in einen eigenen Task auslagert, sieht der
Sammler nicht, weder beim Schreiben noch beim Verteilen. Das bleibt still und erzeugt keine
falschen Treffer. Ein künftiger Schreibweg nur in einem gespawnten Task fiele dem Wächter also
nicht auf. Heute gibt es laut Inventar keinen solchen Weg.

## Was nachgezogen wird

Muster aus LLH-1952: die IDs innerhalb der `write_retry!`-Closure sammeln (nie außerhalb, weil die
Closure bei `SQLITE_BUSY` wiederholt wird), per `Ok(…)` herausgeben, nach dem Commit
`state.live.publiziere(einsatz_id, id)` je ID.

**Routen (29 Stellen in 24 Handlern):**
`einsatzabschnitt::aufloesen` (Abschnitt + je widerrufenem Gerät), `einsatz_bereitstellungsraum::
status_wechsel`, `gefahr::bewerten`, `einsatz_einheit::{end_einheit (Auflöse-Eintrag, heute über
link_einheit_tx nur verknüpft), personal_zuordnen, personal_freigeben, fahrzeug_zuordnen,
fahrzeug_freigeben, status_setzen}`, `einsatz_person::anlegen` (Erfasst/Kontakt und Sichtung;
heute nur UHS und Verbleib), `lage_zone::{anlegen, aufloesen}`, `einsatz_fahrzeug::
status_zuruecknehmen`, `einsatz_tier::{anlegen, status_wechsel, stornieren}`,
`einsatz_material::{disponieren, update (Schleife), aufteilen, verknuepfen, loesen, entlassen,
zuruecknehmen, stornieren, reaktivieren}`.

**Aufbewahrung:** `aufbewahrung/antrag.rs` `stellen` und `zuruecknehmen` geben die ID heraus,
die Routen `antrag_stellen` und `antrag_zuruecknehmen` verteilen. `einsatz/aufbewahrung_kategorie
::frist_setzen`: Die Route verteilt zusätzlich zur Listenauffrischung die Eintrags-ID.

**Hintergrundläufe im Löschlauf** (`tick_mit_rueckschrieb` hat `live`):

| Lauf | Heute | Neu |
|---|---|---|
| `antrag::vollziehe_faellige` → `vollziehen_ergebnis` | verwirft die ID | gibt sie heraus, verteilt |
| `kategorie::vormerken` | `publiziere_einsatz(Etb)` | zusätzlich die ID |
| `kategorie::schwaerzen` | verwirft (Wrapper `einsatz::repo::system_audit_tx` → `()`) | gibt sie heraus, verteilt, falls der Eintrag noch existiert |
| `repo::soft_delete_einsatz` | verwirft | gibt sie heraus, verteilt (der Einsatz ist danach weg, das Ereignis ist harmlos; der Wächter verlangt es, weil der Eintrag existiert) |
| `repo::schwaerze_einsatz` (`schwaerze_einsatz_atomar`) | verwirft | gibt sie heraus, verteilt |
| `archiv::abgelaufene_bloecke_loeschen` | verwirft, Schleife je Block | gibt die IDs heraus, verteilt |

Der Wrapper `einsatz::repo::system_audit_tx` gibt dafür künftig die ID zurück statt `()`.

**Archiv-Pfade außerhalb des Ticks** (`archiv::archivieren` → `schwaerze_nach_archiv_tx`,
`loeschersuchen::ablegen` → `im_archiv_vollzogen_tx`, `archiv/einspielen`, `abraeumen`): Sie laufen
gegen einen Einsatz, der ins Archiv geht oder schon dort liegt, und dessen Zeilen danach aus
`etb_eintrag` verschwinden. Die Existenzprüfung des Wächters verlangt dort nichts. Wo ein Eintrag
doch stehen bleibt und ein `live` erreichbar ist, wird verteilt. Sonst geht die Stelle mit Grund in
`ohne_verteilung`. Das entscheidet der Builder je Stelle anhand des Wächters (siehe unten).

## Tests

- **Je nachgezogenem Handler** ein Test mit `EtbLive` (`tests/common/mod.rs`): Abonnement, Aktion,
  `pruefe`. Gruppiert je Moduldatei, wie in `tests/einsatz_personal.rs:2174`.
- **Hintergrund:** Tests über `purge_scheduler::tick_einmal` mit `live.abonniere`, je Lauf aus der
  Tabelle, der einen Eintrag stehen lässt.
- **Wächter selbst** (`tests/etb_nachlauf_waechter.rs`): eine Testroute bzw. ein direkter Aufruf
  von `pruefe` um einen Schreibvorgang ohne Verteilung panict (`#[should_panic]`); mit Verteilung
  läuft er durch; ein zurückgerollter Schreibvorgang panict nicht; `ohne_verteilung` panict nicht.
- **Mutationsprobe** (`AGENTS.md`: Testgüte belegen Mutationsproben): Wird in einer nachgezogenen
  Route der `publiziere`-Aufruf entfernt, wird der bestehende Routen-Test rot, auch ohne `EtbLive`.
  Einmal für den PR nachweisen und unter „Geprüft“ nennen.
- Der volle Rust-Lauf zeigt außerdem jede Stelle, die das Inventar übersehen hat. Jeder Treffer wird
  nachgezogen oder bekommt eine begründete Ausnahme. **Das ist der eigentliche Nutzen des Wächters
  in diesem Task.**

## Regel (`src/AGENTS.md`, neuer Abschnitt „Backend — ETB live verteilen (LLH-1976)“)

- Ein ETB-Eintrag, den eine Route oder ein Hintergrundlauf schreibt, geht nach dem Commit per
  `LiveHub::publiziere` hinaus, je ID, außerhalb der `write_retry!`-Closure, mit den IDs, die die
  Closure zurückgibt.
- Der Wächter `etb::nachlauf` prüft das in Debug und Test. Eine Ausnahme nur über
  `nachlauf::ohne_verteilung` mit Grund; heute gilt sie für Demo-Import, Instanz-Abgleich und
  Dev-Seed.
- Ein neuer Scheduler-Lauf, der ETB schreibt, kommt unter die Klammer.

## Dem Builder überlassen

- Der genaue Zuschnitt der Rückgabetypen je Repo-Funktion (`i64`, `Option<i64>`, `Vec<i64>` oder
  ein Feld in einer vorhandenen Ergebnis-Struktur), passend zum Stil der Datei.
- Ob ein Modul einen kleinen lokalen Schleifenhelfer bekommt wie `routes/betreuung.rs`
  `publiziere`.
- Die Reihenfolge: zuerst den Wächter, dann den vollen Testlauf als Liste der Lücken, dann je
  Moduldatei nachziehen.
