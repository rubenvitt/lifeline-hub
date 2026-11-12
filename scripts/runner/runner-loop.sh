#!/usr/bin/env bash
# Ein Platz des eigenen e2e-Runners (LLH-1666, Spec `ci-eigener-runner`, ADR-0025).
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
  aufraeumen
  exit 0
}
trap beenden TERM INT
trap aufraeumen EXIT

# Holt die JIT-Konfiguration; leer bei jedem Fehler.
jit_holen() {
  local name antwort
  name="$(hostname -s 2> /dev/null || echo server)-p$PLATZ-$(date +%s)"
  antwort="$(
    printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" |
      curl --config - --fail --silent --show-error --max-time 30 \
        --request POST \
        --header 'Accept: application/vnd.github+json' \
        --header 'X-GitHub-Api-Version: 2022-11-28' \
        --data "{\"name\":\"$name\",\"runner_group_id\":1,\"labels\":[\"self-hosted\",\"$LABEL\"],\"work_folder\":\"_work\"}" \
        "https://api.github.com/repos/$RUNNER_REPO/actions/runners/generate-jitconfig"
  )" || return 0
  printf '%s' "$antwort" | sed -nE 's/.*"encoded_jit_config"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p'
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

pause="$PAUSE_START"
laeufe=0
while :; do
  laeufe=$((laeufe + 1))
  jit="$(jit_holen)"
  if [ -z "$jit" ]; then
    echo "Platz $PLATZ: keine JIT-Konfiguration von GitHub, nächster Versuch in ${pause}s." >&2
    pausieren "$pause"
    pause=$((pause * 2 > PAUSE_MAX ? PAUSE_MAX : pause * 2))
  elif job_ausfuehren "$jit"; then
    pause="$PAUSE_START"
  else
    echo "Platz $PLATZ: Container endete mit Fehler, nächster Versuch in ${pause}s." >&2
    pausieren "$pause"
    pause=$((pause * 2 > PAUSE_MAX ? PAUSE_MAX : pause * 2))
  fi
  if [ "$MAX_RUNS" -gt 0 ] && [ "$laeufe" -ge "$MAX_RUNS" ]; then
    break
  fi
done
