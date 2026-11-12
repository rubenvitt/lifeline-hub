#!/usr/bin/env bash
# Selbsttest für scripts/runner/runner-loop.sh (LLH-1666, Spec `ci-eigener-runner`, ADR-0025).
#
# `curl`, `docker` und `sleep` sind gefälscht und schreiben mit, was sie bekommen. Geprüft wird,
# was auf dem Server still schiefginge: ein Container mit Docker-Socket oder Privilegien, ein Token
# oder eine JIT-Konfiguration in einer Kommandozeile (sichtbar in `ps`), ein Container, der nicht
# mit `--rm` endet, eine Schleife, die bei einer gestörten API im Sekundentakt hämmert, und ein
# Stopp, der den laufenden Container stehen lässt.
set -euo pipefail

SKRIPT="$(cd "$(dirname "$0")" && pwd)/runner-loop.sh"
fehler=0
ok() { echo "ok   $1"; }
rot() {
  echo "ROT  $1" >&2
  fehler=1
}
pruefe() { # <beschreibung> <befehl…>
  local text="$1"
  shift
  if "$@"; then ok "$text"; else rot "$text"; fi
}

WERK="$(mktemp -d)"
trap 'rm -rf "$WERK"' EXIT

# ── Fälschungen ──────────────────────────────────────────────────────────────────────────
mkdir -p "$WERK/bin"
# curl: Antworten der Reihe nach aus $WERK/antworten (ok|fehler), Aufrufe und stdin mitschreiben.
cat > "$WERK/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$WERK/curl.args"
cat >> "$WERK/curl.stdin"
antwort="$(head -n 1 "$WERK/antworten")"
sed -i '1d' "$WERK/antworten"
if [ "$antwort" = ok ]; then
  printf '{"runner":{"id":7},"encoded_jit_config":"GEHEIMJIT"}'
else
  exit 22
fi
EOF
# docker: Aufrufe mitschreiben; bei `run` Inhalt und Rechte der Env-Datei festhalten.
cat > "$WERK/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$WERK/docker.args"
if [ "$1" = run ]; then
  vorher=""
  for a in "$@"; do
    if [ "$vorher" = --env-file ]; then
      stat -c '%a' "$a" >> "$WERK/envfile.mode"
      cat "$a" >> "$WERK/envfile.inhalt"
      echo "$a" >> "$WERK/envfile.pfad"
    fi
    vorher="$a"
  done
  [ -z "${FAKE_DOCKER_BLOCKIEREN:-}" ] || /bin/sleep 30
  exit "${FAKE_DOCKER_EXIT:-0}"
fi
exit 0
EOF
cat > "$WERK/bin/sleep" <<'EOF'
#!/usr/bin/env bash
echo "$1" >> "$WERK/sleep.args"
EOF
chmod +x "$WERK/bin/"*
printf 'ghp_GEHEIMTOKEN\n' > "$WERK/token"
chmod 600 "$WERK/token"

lauf() { # <max_läufe> <antworten…> — startet die Schleife mit frischen Mitschriften
  local max="$1"
  shift
  rm -f "$WERK"/*.args "$WERK"/*.stdin "$WERK"/envfile.*
  printf '%s\n' "$@" > "$WERK/antworten"
  WERK="$WERK" PATH="$WERK/bin:$PATH" \
    RUNNER_REPO=rubenvitt/lifeline-hub RUNNER_TOKEN_FILE="$WERK/token" RUNNER_MAX_RUNS="$max" \
    "$SKRIPT" 1 > "$WERK/ausgabe" 2>&1
}

# ── Ein erfolgreicher Durchlauf ────────────────────────────────────────────────────────
lauf 1 ok
run_zeile="$(grep '^run ' "$WERK/docker.args")"
pruefe "JIT-Abruf geht an die API des Repos" \
  grep -q 'https://api.github.com/repos/rubenvitt/lifeline-hub/actions/runners/generate-jitconfig' "$WERK/curl.args"
pruefe "JIT-Abruf mit Label und Standard-Gruppe" \
  grep -q '"labels":\["self-hosted","lifeline-e2e"\]' "$WERK/curl.args"
pruefe "Token nie in der Kommandozeile von curl" \
  bash -c "! grep -q GEHEIMTOKEN '$WERK/curl.args'"
pruefe "Token kommt über stdin an curl" grep -q 'Authorization: Bearer ghp_GEHEIMTOKEN' "$WERK/curl.stdin"
pruefe "Container mit --rm" grep -q -- '--rm' <<< "$run_zeile"
pruefe "Container mit festem Namen je Platz" grep -q -- '--name lifeline-runner-1' <<< "$run_zeile"
pruefe "Container im eigenen Netz" grep -q -- '--network lifeline-runner' <<< "$run_zeile"
pruefe "Container mit CPU- und Speichergrenze (Vorgabe)" \
  grep -q -- '--cpus 3 .*--memory 6g' <<< "$run_zeile"
pruefe "Container ohne neue Privilegien" grep -q -- '--security-opt no-new-privileges' <<< "$run_zeile"
pruefe "Container hängt Compiler-Cache und Registry als Volume ein" \
  grep -q -- '-v lifeline-sccache:/home/runner/.cache/sccache -v lifeline-cargo-registry:/home/runner/.cargo/registry' <<< "$run_zeile"
pruefe "Container aus dem Runner-Image" grep -q 'lifeline-runner:latest' <<< "$run_zeile"
pruefe "kein Docker-Socket im Container" bash -c "! grep -q docker.sock <<< '$run_zeile'"
pruefe "kein --privileged" bash -c "! grep -q -- --privileged <<< '$run_zeile'"
pruefe "kein Host-Netz" bash -c "! grep -q -- '--network host' <<< '$run_zeile'"
pruefe "weder Token noch JIT in der Kommandozeile von docker" \
  bash -c "! grep -qE 'GEHEIMTOKEN|GEHEIMJIT' '$WERK/docker.args'"
pruefe "JIT kommt über eine Env-Datei" \
  grep -q '^ACTIONS_RUNNER_INPUT_JITCONFIG=GEHEIMJIT$' "$WERK/envfile.inhalt"
pruefe "Env-Datei nur für den Dienstnutzer lesbar" grep -qx 600 "$WERK/envfile.mode"
pruefe "Env-Datei ist nach dem Lauf gelöscht" bash -c "[ ! -e \"\$(cat '$WERK/envfile.pfad')\" ]"
pruefe "Reste eines gleichnamigen Containers werden vorher entfernt" \
  grep -q '^rm -f lifeline-runner-1$' "$WERK/docker.args"
pruefe "ohne Pause nach einem guten Job" bash -c "[ ! -s '$WERK/sleep.args' ]"

# ── Gestörte API: Pause wächst bis 5 min, ein Erfolg setzt sie zurück ─────────────────
lauf 9 fehler fehler fehler fehler fehler fehler ok fehler ok
pruefe "Pausen 30, 60, 120, 240, 300, 300, dann nach Erfolg wieder 30" \
  bash -c "[ \"\$(tr '\n' ' ' < '$WERK/sleep.args')\" = '30 60 120 240 300 300 30 ' ]"
pruefe "kein Container ohne JIT-Konfiguration" bash -c "[ \"\$(grep -c '^run ' '$WERK/docker.args')\" = 2 ]"

# ── Container scheitert: auch dann Pause statt Hämmern ─────────────────────────────────
rm -f "$WERK"/*.args
printf 'ok\nok\n' > "$WERK/antworten"
WERK="$WERK" PATH="$WERK/bin:$PATH" FAKE_DOCKER_EXIT=125 \
  RUNNER_REPO=rubenvitt/lifeline-hub RUNNER_TOKEN_FILE="$WERK/token" RUNNER_MAX_RUNS=2 \
  "$SKRIPT" 1 > "$WERK/ausgabe" 2>&1 || true
pruefe "gescheiterter Container führt zur Pause" grep -qx 30 "$WERK/sleep.args"

# ── Eigene Werte aus runner.env ────────────────────────────────────────────────────────
rm -f "$WERK"/*.args
printf 'ok\n' > "$WERK/antworten"
WERK="$WERK" PATH="$WERK/bin:$PATH" RUNNER_CPUS=2 RUNNER_MEMORY=4g RUNNER_LABEL=anders \
  RUNNER_SCCACHE_SIZE=5G RUNNER_REPO=rubenvitt/lifeline-hub RUNNER_TOKEN_FILE="$WERK/token" \
  RUNNER_MAX_RUNS=1 "$SKRIPT" 2 > "$WERK/ausgabe" 2>&1
pruefe "eigene Grenzen, Label und Cache-Größe greifen" \
  bash -c "grep -q -- '--cpus 2 .*--memory 4g' '$WERK/docker.args' \
    && grep -q -- '-e SCCACHE_CACHE_SIZE=5G' '$WERK/docker.args' \
    && grep -q '\"labels\":\[\"self-hosted\",\"anders\"\]' '$WERK/curl.args' \
    && grep -q -- '--name lifeline-runner-2' '$WERK/docker.args'"

# ── Falsche Aufrufe ─────────────────────────────────────────────────────────────────────
if WERK="$WERK" PATH="$WERK/bin:$PATH" RUNNER_REPO=x/y RUNNER_TOKEN_FILE="$WERK/token" "$SKRIPT" \
  > /dev/null 2>&1; then
  rot "ohne Platz → Exit 0 (Soll ≠ 0)"
else
  ok "ohne Platz → Abbruch"
fi
if WERK="$WERK" PATH="$WERK/bin:$PATH" RUNNER_REPO=x/y RUNNER_TOKEN_FILE="$WERK/fehlt" \
  RUNNER_MAX_RUNS=1 "$SKRIPT" 1 > "$WERK/ausgabe" 2>&1; then
  rot "ohne Token-Datei → Exit 0 (Soll ≠ 0)"
else
  pruefe "ohne Token-Datei → Abbruch mit Hinweis" grep -q 'Token-Datei' "$WERK/ausgabe"
fi
chmod 644 "$WERK/token"
if WERK="$WERK" PATH="$WERK/bin:$PATH" RUNNER_REPO=x/y RUNNER_TOKEN_FILE="$WERK/token" \
  RUNNER_MAX_RUNS=1 "$SKRIPT" 1 > "$WERK/ausgabe" 2>&1; then
  rot "Token-Datei für andere lesbar → Exit 0 (Soll ≠ 0)"
else
  pruefe "Token-Datei für andere lesbar → Abbruch mit Hinweis" grep -q 'chmod 600' "$WERK/ausgabe"
fi
chmod 600 "$WERK/token"

# ── Stopp durch systemd: der laufende Container wird mit beendet ──────────────────────
rm -f "$WERK"/*.args
printf 'ok\n' > "$WERK/antworten"
WERK="$WERK" PATH="$WERK/bin:$PATH" FAKE_DOCKER_BLOCKIEREN=1 \
  RUNNER_REPO=rubenvitt/lifeline-hub RUNNER_TOKEN_FILE="$WERK/token" \
  "$SKRIPT" 1 > "$WERK/ausgabe" 2>&1 &
pid=$!
for _ in $(seq 50); do
  grep -q '^run ' "$WERK/docker.args" 2>/dev/null && break
  /bin/sleep 0.1
done
kill -TERM "$pid"
if wait "$pid"; then status=0; else status=$?; fi
pruefe "SIGTERM stoppt den Container" grep -q '^stop .*lifeline-runner-1' "$WERK/docker.args"
pruefe "SIGTERM beendet die Schleife sauber" test "$status" -eq 0
pruefe "Env-Datei auch nach SIGTERM gelöscht" bash -c "[ ! -e \"\$(cat '$WERK/envfile.pfad')\" ]"
pkill -f "$WERK/bin/docker" 2>/dev/null || true

exit "$fehler"
