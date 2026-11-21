#!/usr/bin/env bash
# Ein Platz des eigenen Runners für die schweren Suiten (LLH-1666, LLH-2014, ADR-0075).
#
#   runner-loop.sh <platz>
#
# Läuft als systemd-Dienst `lifeline-runner@<platz>` (`scripts/runner/README.md`). Je Durchlauf:
# eine Einmal-Registrierung (JIT) bei GitHub holen, einen frischen Container aus dem Runner-Image
# starten, der genau EINEN Job nimmt, und ihn danach von Docker löschen lassen (`--rm`). So
# beginnt jeder Job auf leerem Stand: kein Arbeitsverzeichnis, kein `/tmp`, keine Prozesse eines
# früheren Jobs. Geteilt ist nur der Compiler-Cache (Volume). Die Cargo-Registry nicht: ihre Sperre
# und ihre Aufräumdaten liegen in `CARGO_HOME` selbst, also je Container, und zwei Container, die
# dieselbe Crate entpacken, zerstörten sich das Verzeichnis gegenseitig.
#
# Geheimnisse bleiben aus jeder Kommandozeile (`ps` zeigt sie allen Nutzern): das Token geht über
# stdin an curl, die JIT-Konfiguration über eine Env-Datei mit Modus 600 an Docker. Der Container
# bekommt weder Docker-Socket noch Privilegien noch das Host-Netz, und im eigenen Docker-Netz
# erreichen sich gleichzeitige Jobs nicht (`enable_icc=false`).
#
# ABMELDEN (LLH-2014): Eine JIT-Registrierung, die nie einen Job bekam (Platz gestoppt, Host neu
# gestartet), bliebe als Offline-Runner im Repo stehen. Deshalb meldet der Platz seinen Runner nach
# jedem Container und beim Stopp ab (404 heißt: GitHub hat ihn nach dem Job schon entfernt), und
# beim Start löscht er Offline-Runner, die ein früherer Lauf DIESES Platzes hinterließ
# (`<host>-p<platz>-*`). Andere Plätze fasst er nicht an: deren frische Registrierung steht bis
# zum Verbinden ebenfalls auf „offline“.
#
# Konfiguration aus der Umgebung (systemd: `EnvironmentFile=/etc/lifeline-runner/runner.env`):
#   RUNNER_REPO          owner/repo                         (Pflicht)
#   RUNNER_TOKEN_FILE    Fine-grained Token, Modus 600      (/etc/lifeline-runner/token)
#   RUNNER_LABEL         Label, das `E2E_RUNNER` nennt      (lifeline-e2e)
#   RUNNER_IMAGE         Image aus build-image.sh           (lifeline-runner:latest)
#   RUNNER_CPUS          Kerne je Container                 (3)
#   RUNNER_MEMORY        Speicher je Container              (6g)
#   RUNNER_SCCACHE_SIZE  Obergrenze des Compiler-Caches     (20G)
#   RUNNER_NETWORK       Docker-Netz der Runner             (lifeline-runner)
#   RUNNER_MIN_JOB_SEK   kürzer endende Container gelten als Fehler (60); der Runner gibt auch
#                        bei einem eigenen Fehler Exit 0, die Schleife hämmerte sonst
#   RUNNER_MAX_RUNS      nur für den Selbsttest: nach so vielen Durchläufen enden
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "Aufruf: $0 <platz>" >&2
  exit 2
fi
PLATZ="$1"
: "${RUNNER_REPO:?RUNNER_REPO fehlt (owner/repo, /etc/lifeline-runner/runner.env)}"
TOKEN_FILE="${RUNNER_TOKEN_FILE:-/etc/lifeline-runner/token}"
LABEL="${RUNNER_LABEL:-lifeline-e2e}"
IMAGE="${RUNNER_IMAGE:-lifeline-runner:latest}"
CPUS="${RUNNER_CPUS:-3}"
MEMORY="${RUNNER_MEMORY:-6g}"
SCCACHE_SIZE="${RUNNER_SCCACHE_SIZE:-20G}"
NETWORK="${RUNNER_NETWORK:-lifeline-runner}"
MAX_RUNS="${RUNNER_MAX_RUNS:-0}"
MIN_JOB_SEK="${RUNNER_MIN_JOB_SEK:-60}"
CONTAINER="lifeline-runner-$PLATZ"

# Pause nach einem Fehler: 30 s, verdoppelt bis 5 min, nach einem guten Job wieder 30 s.
PAUSE_START=30
PAUSE_MAX=300

if [ ! -r "$TOKEN_FILE" ]; then
  echo "FEHLER: Token-Datei $TOKEN_FILE fehlt oder ist nicht lesbar (README, „Token“)." >&2
  exit 1
fi
if [ -n "$(find "$TOKEN_FILE" -perm /077)" ]; then
  echo "FEHLER: $TOKEN_FILE ist für andere lesbar; chmod 600 $TOKEN_FILE" >&2
  exit 1
fi

envdatei=""
container_pid=""
pause_pid=""
aufraeumen() {
  [ -z "$envdatei" ] || rm -f "$envdatei"
  envdatei=""
}
beenden() {
  echo "Platz $PLATZ: Stopp angefordert, beende $CONTAINER."
  [ -z "$pause_pid" ] || kill "$pause_pid" 2> /dev/null || true
  docker stop --time 60 "$CONTAINER" > /dev/null 2>&1 || true
  [ -z "$container_pid" ] || wait "$container_pid" 2> /dev/null || true
  runner_delete "$runner_id"
  aufraeumen
  exit 0
}
trap beenden TERM INT
trap aufraeumen EXIT

# Ruft die REST-API des Repos; das Token geht über stdin an curl, nie in die Kommandozeile.
#   github_api <methode> <pfad unter /repos/<repo>/> [<json-daten>]
github_api() {
  local methode="$1" pfad="$2"
  local daten=()
  [ "$#" -lt 3 ] || daten=(--data "$3")
  printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" |
    curl --config - --fail --silent --show-error --max-time 30 \
      --request "$methode" \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      ${daten[@]+"${daten[@]}"} \
      "https://api.github.com/repos/$RUNNER_REPO/$pfad"
}

# Präfix der Runner-Namen dieses Platzes; das Ende ist die Startzeit (`jit_holen`).
PRAEFIX="$(hostname -s 2> /dev/null || echo server)-p$PLATZ-"

# Holt eine JIT-Registrierung und setzt `jit` (leer bei jedem Fehler) und `runner_id` (für das
# Abmelden). Kein `$(jit_holen)`: in der Subshell gingen beide Werte verloren.
jit=""
runner_id=""
jit_holen() {
  local name antwort
  jit=""
  runner_id=""
  name="$PRAEFIX$(date +%s)"
  antwort="$(github_api POST actions/runners/generate-jitconfig \
    "{\"name\":\"$name\",\"runner_group_id\":1,\"labels\":[\"self-hosted\",\"$LABEL\"],\"work_folder\":\"_work\"}")" || return 0
  runner_id="$(printf '%s' "$antwort" | tr -d '[:space:]' | sed -nE 's/.*"runner":\{"id":([0-9]+).*/\1/p')"
  jit="$(printf '%s' "$antwort" | sed -nE 's/.*"encoded_jit_config"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
}

# Meldet einen Runner ab. Scheitern ist kein Fehler: meist hat GitHub ihn schon entfernt (404).
runner_delete() { # <id>
  [ -n "$1" ] || return 0
  github_api DELETE "actions/runners/$1" > /dev/null 2>&1 || true
}

# Löscht beim Start die Offline-Runner, die ein früherer Lauf dieses Platzes hinterließ. Die Liste
# ohne Leerraum, dann je Runner `id`, `name`, `status` (Reihenfolge der API-Antwort); die Labels
# tragen `os` nicht und fallen so heraus.
stale_runners_delete() {
  local liste id name status
  liste="$(github_api GET 'actions/runners?per_page=100' 2> /dev/null)" || return 0
  printf '%s' "$liste" | tr -d '[:space:]' |
    { grep -oE '"id":[0-9]+,"name":"[^"]*","os":"[^"]*","status":"[a-z]+"' || true; } |
    sed -E 's/"id":([0-9]+),"name":"([^"]*)","os":"[^"]*","status":"([a-z]+)"/\1 \2 \3/' |
    while read -r id name status; do
      # Der Bindestrich im Präfix hält `srv-p1-` von `srv-p10-…` fern.
      case "$name" in "$PRAEFIX"*) ;; *) continue ;; esac
      [ "$status" = offline ] || continue
      echo "Platz $PLATZ: lösche liegengebliebenen Runner $name ($id)."
      runner_delete "$id"
    done
}

# Ein Job in einem frischen Container. Im Hintergrund plus `wait`, damit SIGTERM sofort greift
# (bash führt einen Trap erst nach einem Vordergrund-Kommando aus).
job_ausfuehren() {
  local jit="$1"
  envdatei="$(umask 077 && mktemp)"
  printf 'ACTIONS_RUNNER_INPUT_JITCONFIG=%s\n' "$jit" > "$envdatei"
  docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
  docker run --rm --name "$CONTAINER" \
    --network "$NETWORK" \
    --cpus "$CPUS" --memory "$MEMORY" --pids-limit 4096 --shm-size 2g \
    --security-opt no-new-privileges \
    -v lifeline-sccache:/home/runner/.cache/sccache \
    -e "SCCACHE_CACHE_SIZE=$SCCACHE_SIZE" \
    --env-file "$envdatei" \
    "$IMAGE" &
  container_pid=$!
  local status=0 start=$SECONDS
  wait "$container_pid" || status=$?
  container_pid=""
  aufraeumen
  if [ "$status" -eq 0 ] && [ $((SECONDS - start)) -lt "$MIN_JOB_SEK" ]; then
    echo "Platz $PLATZ: Container nach $((SECONDS - start))s ohne Fehlercode beendet, werte als Fehler." >&2
    status=1
  fi
  return "$status"
}

# Pause, die SIGTERM sofort unterbricht (wie oben: Hintergrund plus `wait`).
pausieren() {
  sleep "$1" &
  pause_pid=$!
  wait "$pause_pid" || true
  pause_pid=""
}

# Beim ersten Start legen alle Plätze zugleich an; wer verliert, findet das Netz danach vor.
docker network inspect "$NETWORK" > /dev/null 2>&1 \
  || docker network create -o com.docker.network.bridge.enable_icc=false "$NETWORK" > /dev/null 2>&1 \
  || docker network inspect "$NETWORK" > /dev/null

stale_runners_delete

pause="$PAUSE_START"
laeufe=0
while :; do
  laeufe=$((laeufe + 1))
  jit_holen
  if [ -z "$jit" ]; then
    echo "Platz $PLATZ: keine JIT-Konfiguration von GitHub, nächster Versuch in ${pause}s." >&2
    pausieren "$pause"
    pause=$((pause * 2 > PAUSE_MAX ? PAUSE_MAX : pause * 2))
  elif job_ausfuehren "$jit"; then
    runner_delete "$runner_id"
    pause="$PAUSE_START"
  else
    runner_delete "$runner_id"
    echo "Platz $PLATZ: Container endete mit Fehler, nächster Versuch in ${pause}s." >&2
    pausieren "$pause"
    pause=$((pause * 2 > PAUSE_MAX ? PAUSE_MAX : pause * 2))
  fi
  if [ "$MAX_RUNS" -gt 0 ] && [ "$laeufe" -ge "$MAX_RUNS" ]; then
    break
  fi
done
