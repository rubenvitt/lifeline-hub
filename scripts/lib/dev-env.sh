#!/usr/bin/env bash
# LFH-235/F17: gemeinsame Env-Hygiene für alle Gates. Zum Sourcen gedacht, nicht zum Ausführen.
#
# `mise.local.toml` lädt per `[env] _.file = ".env"` alle Dev-Variablen in JEDEN Prozess,
# der im Repo startet — auch in frische Worktrees ohne eigene .env, weil mise die
# Elternverzeichnisse mitliest. Ein Gate, das diese Umgebung erbt, prüft nicht den Code,
# sondern die Maschine des Entwicklers.
#
# Das ist zweimal schiefgegangen: LIFELINE_DOWNLOAD_ALLOW_LOOPBACK kippte den SSRF-Test,
# LIFELINE_OIDC_* die Config-Default-Tests. Beide Fehlerklassen sind inzwischen im Code
# selbst geschlossen (OnceLock bzw. `parse_hermetisch`) — die Hygiene hier ist die zweite
# Verteidigungslinie für alles, was noch kommt.
#
# Bewusst KEINE handgepflegte Liste: die frühere `env -u`-Aufzählung in
# check-typ-codegen.sh kannte drei Variablen, während die .env dreizehn setzte. Genau
# diese Drift hat den OIDC-Ausfall verursacht. Stattdessen wird nach Präfix geräumt.

# Präfixe aller Variablen, die aus der lokalen Dev-Umgebung stammen können:
# LIFELINE_* (Backend), KS_*/AWS_* (karten-service + dessen S3-/MinIO-Anbindung).
DEV_ENV_PRAEFIXE='^(LIFELINE|KS|AWS)_'

# Führt das übergebene Kommando ohne die lokalen Dev-Variablen aus.
#
# Beispiel:  ohne_dev_env cargo test --workspace
ohne_dev_env() {
  local unset_args=()
  local name
  # `env` statt `compgen -v`: liefert nur exportierte Variablen — genau die, die ein
  # Kindprozess erben würde.
  while IFS= read -r name; do
    [ -n "$name" ] && unset_args+=(-u "$name")
  done < <(env | sed -E 's/=.*//' | grep -E "$DEV_ENV_PRAEFIXE" || true)

  env "${unset_args[@]}" "$@"
}

# Listet die Variablen, die geräumt würden (für Diagnose-Ausgaben).
dev_env_liste() {
  env | sed -E 's/=.*//' | grep -E "$DEV_ENV_PRAEFIXE" | sort || true
}
