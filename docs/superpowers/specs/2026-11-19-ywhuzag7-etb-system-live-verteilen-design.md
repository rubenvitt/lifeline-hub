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
- Dasselbe gilt für die Hintergrundläufe des Löschlaufs (`einsatz/purge_scheduler.rs`), nach
  denen der Einsatz lesbar bleibt. Läufe, die den Einsatz aus dem Betrieb nehmen, sind eine
  benannte Ausnahme (Entscheidung Ruben, 19.11.2026, s. Tabelle).
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
  Versuche fallen damit von selbst heraus. (Archiv und Schwärzen löschen **keine** ETB-Zeilen;
  Zeilen verschwinden nur mit dem harten Löschen des Einsatzes per `ON DELETE CASCADE`.) Bleibt etwas übrig, folgt ein Panic mit Einsatz-ID, ETB-ID und Inhalt des
  Eintrags. Damit ist im Test sofort zu sehen, welcher Schreibweg fehlt.
- **Wo die Klammer sitzt:** als äußerste Schicht in `app::build_router_mit` (eine
  `axum::middleware::from_fn_with_state`, die den Handler-Future umschließt) und um den Rumpf von
  `purge_scheduler::tick_mit_rueckschrieb`. Die Router-Schicht muss **außerhalb** von
  `CatchPanicLayer` (`app.rs`) liegen, sonst wird der Panic zu einer 500 statt zu einem roten Test.
  Bei SSE-Strömen endet die Prüfung mit dem Aufbau der Antwort, nicht mit dem Strom.
- **Verschachtelte Router-Aufrufe** (Instanz-Abgleich und Spiegel-Takt schicken Anfragen per
  `oneshot` erneut durch den ganzen Router, `RouterPlatz`): Ist schon ein Sammler aktiv, öffnet
  die Klammer **keinen** neuen. Die innere Anfrage schreibt in den äußeren Sammler, geprüft wird
  einmal außen. Ein `ohne_verteilung` außen deckt damit auch die inneren Anfragen. *(Entscheidung
  des Entwurfs.)*
- **Benannte Ausnahme:** `nachlauf::ohne_verteilung(grund, fut)` markiert alle in `fut`
  geschriebenen IDs als ausgenommen. `grund` ist ein `&'static str` und steht im Code. Benutzt von:
  Demo-Import (Route `demo_daten`), Instanz-Spiegel (`handle_abgleich` und Spiegel-Takt,
  `instanz/spiegel/takt.rs`) und den Läufen, die einen Einsatz aus dem Betrieb nehmen (Tabelle
  unten). Der Dev-Seed läuft ohne Sammler und braucht keine. Eine neue Ausnahme ist eine
  bewusste Entscheidung im Diff.
- **Release-Build:** `pruefe` und `ohne_verteilung` sind dort ein durchgereichtes `fut.await`,
  die Erfassung ist leer. Kein task-local, keine Abfrage.

**Warum ein Panic und nicht nur ein Log:** Integrationstests treiben den Router über `oneshot`
(`tests/common/mod.rs` baut ihn über `build_router` → `build_router_mit`). Ein Panic im
Middleware-Future schlägt bis in den Test durch und macht ihn rot, ein Log nicht. Im lokalen
`cargo run` (Debug) bricht dieselbe Anfrage laut ab. Gewollt: Das ist ein Programmierfehler.

**Im Scheduler** gibt die Klammer die Lücke als Ergebnis zurück, statt selbst zu paniken.
`tick_einmal`, den die Tests aufrufen, panict damit. Die gespawnte Schleife
(`starte_purge_scheduler`) loggt per `tracing::error!` und läuft weiter, sonst stünde der
Löschlauf im lokalen Debug-Stack still, ohne dass es jemand merkt. *(Entscheidung des Entwurfs.)*

**Bekannte Grenzen:** Unit-Tests unter `src/`, die eigene Teil-Router bauen oder Handler direkt
rufen, laufen ohne Klammer; die Mutationsprobe braucht deshalb einen Integrationstest. Bricht
das 60-s-Budget (`zulassung`) eine Anfrage zwischen Commit und Verteilung ab, panict der Wächter
in Debug. Das ist hinnehmbar. Was ein Handler per `tokio::spawn` in einen eigenen Task auslagert, sieht der
Sammler nicht, weder beim Schreiben noch beim Verteilen. Das bleibt still und erzeugt keine
falschen Treffer. Ein künftiger Schreibweg nur in einem gespawnten Task fiele dem Wächter also
nicht auf. Heute gibt es laut Inventar keinen solchen Weg.

## Was nachgezogen wird

Muster aus LLH-1952: die IDs innerhalb der `write_retry!`-Closure sammeln (nie außerhalb, weil die
Closure bei `SQLITE_BUSY` wiederholt wird), per `Ok(…)` herausgeben, nach dem Commit
`state.live.publiziere(einsatz_id, id)` je ID.

**Routen (laut Inventar 29 Stellen in 24 Handlern; der Wächter-Lauf findet ggf. weitere, etwa in
`routes/einsatzakte.rs` oder `routes/infotelefon.rs`):**
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
| `kategorie::schwaerzen` | verwirft (Wrapper `einsatz::repo::system_audit_tx` → `()`) | gibt sie heraus, verteilt |
| `archiv::abgelaufene_bloecke_loeschen` | verwirft, Schleife je Block | gibt die IDs heraus, verteilt |
| `archiv::archivieren` (Phase N) → `schwaerze_nach_archiv_tx` | verwirft | **Ausnahme**: Einsatz verlässt den Betrieb, `kopf_melden` meldet es |
| `repo::soft_delete_einsatz` | verwirft | **Ausnahme**, wie oben |
| `repo::schwaerze_einsatz` (`schwaerze_einsatz_atomar`) | verwirft | **Ausnahme**, wie oben |

Die Ausnahme wählt Ruben am 19.11.2026: Ein `etb`-Ereignis für einen Einsatz, der gerade gesperrt
oder entfernt wurde, löst nur einen Refetch aus, der mit 403 oder 404 endet. Der Wrapper
`einsatz::repo::system_audit_tx` gibt künftig die ID zurück statt `()`.

**Weitere Archiv-Pfade** (`loeschersuchen::ablegen` → `im_archiv_vollzogen_tx`,
`archiv/einspielen`, `abraeumen`, Phase R im Tick): Sie arbeiten an einem Einsatz, der im Archiv
liegt. Laufen sie unter einer Klammer und meldet der Wächter sie, gilt dieselbe Regel: bleibt der
Einsatz lesbar, wird verteilt, sonst gilt die Ausnahme „verlässt den Betrieb“. Das entscheidet der
Builder je Treffer.

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
  `nachlauf::ohne_verteilung` mit Grund; heute gilt sie für Demo-Import, Instanz-Spiegel und
  Läufe, die einen Einsatz aus dem Betrieb nehmen (Archivieren, Löschen, Schwärzen des ganzen
  Einsatzes).
- Ein neuer Scheduler-Lauf, der ETB schreibt, kommt unter die Klammer.

## Dem Builder überlassen

- Der genaue Zuschnitt der Rückgabetypen je Repo-Funktion (`i64`, `Option<i64>`, `Vec<i64>` oder
  ein Feld in einer vorhandenen Ergebnis-Struktur), passend zum Stil der Datei.
- Ob ein Modul einen kleinen lokalen Schleifenhelfer bekommt wie `routes/betreuung.rs`
  `publiziere`.
- Die Reihenfolge: zuerst den Wächter, dann den vollen Testlauf als Liste der Lücken, dann je
  Moduldatei nachziehen.
