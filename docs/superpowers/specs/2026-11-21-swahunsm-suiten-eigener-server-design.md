# Schwere Suiten auf Kanal-Branches auf dem eigenen Server (LLH-2014)

Stand: 21.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/swahunsmnykcti17q6g4ah5v ·
Freigabe: Ruben im Chat, 21.11.2026 („dein entwurf passt. go“)

## Absicht

Die Läufe auf `alpha`, `beta` und `main` sollen schneller fertig sein. Der eigene Server
(r-server, Label `lifeline-e2e`) ist kaum ausgelastet. Bisher durften dort nur `e2e-Binary` und
die e2e-Anteile laufen (ADR-0025). Künftig sollen auch die anderen schweren Suiten dorthin.
Abgelöste Commits brechen weiter ab, wie heute über die Concurrency-Gruppen in `suiten.yml`.

Anlass am Rand: Im Runner-Verzeichnis von GitHub liegen Offline-Runner, die nie verschwinden.
Das sind Einmal-Registrierungen, deren Platz gestoppt wurde, bevor sie einen Job hatten.

## Ziele

- Bei **Push** auf einen Kanal-Branch laufen Rust-Suite, die vier Frontend-Anteile,
  `e2e-Binary` und die vier e2e-Anteile auf dem eigenen Server, wenn `E2E_RUNNER` ein Label
  nennt.
- **PR-Läufe nie auf dem Server**, auch nicht mit dem Label `voll` (Entscheidung Ruben). Das
  ändert heutiges Verhalten: bisher liefen `voll`-PRs aus dem eigenen Repo mit e2e dort.
- Ein gestoppter Platz meldet seinen Runner bei GitHub ab. Beim Start räumt ein Platz Offline-Runner
  ab, die sein eigener Vorgänger hinterlassen hat (Absturz, Stromausfall).

## Nicht-Ziele

- Schnellprüfungen, iOS-Kern (Container-Job, braucht den Docker-Socket), die Berichte und
  Release samt Artefakten bleiben bei GitHub.
- Kein neuer Schalter: `E2E_RUNNER` bleibt der eine Schalter (gespeicherter Name, nicht
  umbenennen). Leer heißt alles bei GitHub.
- Keine Änderung an der Isolation der Container (ADR-0025 gilt darin fort).

## Ansätze

1. **Eine Weiche in `suiten.yml` für alle Suiten (gewählt).** Der Job, der heute in `e2e.yml`
   den Runner wählt, zieht nach `suiten.yml`. Rust, Frontend und der Aufruf von `e2e.yml` lesen
   seine Ausgabe, `e2e.yml` bekommt sie als Eingabe. Eine Stelle, ein Test.
2. Je Workflow eine eigene Weiche. Doppelt, und die beiden könnten auseinanderlaufen.
3. Labels fest in `runs-on`. Ohne Rückfall auf GitHub, wenn der Server ausfällt; von ADR-0025
   verboten.

## Entwurf

- **Weiche** `scripts/runner/select-runner.sh <ereignis> <label>`: das Label nur bei `push` und
  gültigem Label, sonst `ubuntu-latest`. Das Kopf-Repo entfällt, weil kein PR mehr auf den Server
  geht. Bei einem PR liest der Job die Weiche weiter aus dem Ziel-Branch (`HEAD^1`), damit ein
  PR sie nicht für sich selbst umstellt. Eine alte Weiche mit vier Argumenten bricht mit dem
  neuen Aufruf ab, und der Lauf fällt auf GitHub zurück, also in die sichere Richtung.
- **`suiten.yml`**: neuer erster Job `runner` (Anzeige „Suiten-Runner“). `rust` und `frontend`
  hängen an ihm (`needs: runner`), `runs-on: ${{ needs.runner.outputs.runner || 'ubuntu-latest' }}`.
  Der Job `e2e` reicht die Wahl als `with: runner:` an `e2e.yml`. Dort entfällt der Job
  `aenderungen`, `binaer` und `e2e` nehmen `inputs.runner || 'ubuntu-latest'`.
- **Rust-Suite auf dem Server**: Plattenplatz, apt-Pakete und `rust-cache` nur gehostet. Das Image
  bringt die GTK/WebKit-Pakete mit (dieselbe Liste wie in `suiten.yml`). Ein Schritt nur auf dem
  Server prüft per `pkg-config`, ob das Image sie hat, und nennt sonst den Neubau.
- **Cargo-Cache bei GitHub**: bisher pflegte ihn die Rust-Suite, PR-Läufe leben davon. Läuft sie
  auf dem Server, speichern die Schnellprüfungen bei Push den Eintrag (`save-if` mit
  `github.event_name == 'push' && vars.E2E_RUNNER != ''`, wortgleich in `ci.yml` und `pr.yml`, im
  PR also nie). Fällt alles auf GitHub zurück, speichert die Rust-Suite wie bisher.
- **Wächter** `scripts/runner/ci-schritte.test.sh` prüft außer `binaer`/`e2e` in `e2e.yml` auch
  `rust`/`frontend` in `suiten.yml`. `select-runner.test.sh` deckt „PR nie“ ab,
  `ci-stufen.test.sh` die neue Job-Liste.
- **Abmelden** in `runner-loop.sh`: die Runner-ID kommt aus der Antwort von `generate-jitconfig`.
  Nach jedem Container und beim Stopp: `DELETE /actions/runners/<id>`; 404 (schon von GitHub
  entfernt) ist kein Fehler. Beim Start: Offline-Runner mit dem Namen `<host>-p<platz>-*` löschen.
  Das Token bleibt aus jeder Kommandozeile (curl `--config -`).
- **ADR-0075** ersetzt ADR-0025: dieselben Regeln zur Isolation, die Weiche in `suiten.yml`, „PR
  nie“, Abmelden. ADR-0025 bekommt `status: ersetzt`.
- **Doku**: `scripts/runner/README.md` (Zweck, Betrieb nach dem Merge), Köpfe von `ci.yml`,
  `pr.yml`, `suiten.yml`, `e2e.yml`.

## Einschränkungen und Risiken

- Bis zu 10 Jobs je Push treffen auf die Plätze (heute 6 sichtbar), der Rest wartet. Mehr Plätze
  sind eine Frage der Server-Größe (`runner.env`, systemd-Instanzen), keine Repo-Änderung.
- Die Rust-Suite bekommt je Container `RUNNER_MEMORY` (Vorgabe 6g). Reicht das beim Linken nicht,
  zeigt es der erste Lauf; dann den Wert in `runner.env` heben.
- Nach dem Merge: Image neu bauen und die Plätze neu starten (README), sonst fehlt der Rust-Suite
  WebKit und den Plätzen das Abmelden.

## Dem Bauenden überlassen

Wortlaut der Kommentare und Testfälle, die genaue JSON-Zerlegung beim Aufräumen (ohne `jq`, der
Host verlangt nur `git`, `curl`, Docker), die Form der Prüfung in ADR-0075.
