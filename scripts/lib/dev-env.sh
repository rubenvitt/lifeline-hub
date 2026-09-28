#!/usr/bin/env bash
# Gemeinsame Env-Hygiene für alle Gates. Zum Sourcen gedacht, nicht zum Ausführen.
#
# `mise.local.toml` lädt per `[env] _.file = ".env"` alle Dev-Variablen in JEDEN Prozess, der
# im Repo startet — auch in frische Worktrees, weil mise die Elternverzeichnisse mitliest. Ein
# Gate, das diese Umgebung erbt, prüft die Maschine statt des Codes. Die Isolation gehört
# zuerst in den Test selbst; dies ist die zweite Verteidigungslinie.
#
# Bewusst KEINE handgepflegte Liste (eine solche driftete schon einmal von drei auf dreizehn
# gesetzte Variablen), sondern Räumung nach Präfix.

# Präfixe aller Variablen, die aus der lokalen Dev-Umgebung stammen können:
# LIFELINE_* (Backend), KS_*/AWS_* (karten-service + dessen S3-Anbindung).
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

  # macOS-Bash 3.2 wirft bei der Expansion eines leeren Arrays unter `set -u` „unbound
  # variable" — ohne Treffer deshalb gar nicht erst expandieren.
  if [ "${#unset_args[@]}" -eq 0 ]; then
    env "$@"
  else
    env "${unset_args[@]}" "$@"
  fi
}

# Listet die Variablen, die geräumt würden (für Diagnose-Ausgaben).
dev_env_liste() {
  env | sed -E 's/=.*//' | grep -E "$DEV_ENV_PRAEFIXE" | sort || true
}
