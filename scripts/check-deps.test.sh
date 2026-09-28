#!/usr/bin/env bash
# Selbsttest für scripts/check-deps.sh. Dessen Fehlerbild ist STILL: liest es eine
# Teilmenge, meldet es „OK" wie ein vollständiger Lauf. Gemessen wird deshalb nicht, WAS der
# Audit findet (ändert sich über Nacht), sondern WORAUF er schaut und OB sein Urteil
# durchschlägt — ohne Netz, `mise`/`cargo` sind aufzeichnende Attrappen.
#
# Die schärferen Hälften sind die NEGATIVEN: „der Audit sieht node_modules NICHT" und „ein
# Fund bricht". „Er sieht das Lockfile" allein wäre auch grün, wenn er nebenher den halben
# Arbeitsbaum sähe.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-deps.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# HASHWERKZEUG: `shasum -a 256` wie im übrigen Repo, `sha256sum` fehlt auf macOS; die Wahl
# wird an die Attrappe durchgereicht, damit beide Seiten dasselbe Werkzeug nehmen. Fehlt
# beides, wird abgebrochen — sonst kollabierten beide Seiten von Fall 2 zu "" und der
# Vergleich wäre trivial grün.
if command -v shasum >/dev/null 2>&1; then
  HASHBEFEHL="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  HASHBEFEHL="sha256sum"
else
  echo "FEHLER: weder shasum noch sha256sum gefunden — der Lockfile-Vergleich" >&2
  echo "        wäre ohne Hashwerkzeug still wirkungslos." >&2
  exit 1
fi
export HASHBEFEHL

hashe() { # <datei> -> gekürzter Hash
  $HASHBEFEHL < "$1" | cut -c1-16
}

# PATH-Einträge fallenlassen, die ein echtes cargo-audit führen: `check-deps.sh` fragt
# zuerst `command -v cargo-audit` und erreichte die Attrappe in der CI (dort installiert)
# sonst nie (Fall 8).
pfad_ohne_cargo_audit() {
  local neu="" eintrag
  local IFS=:
  for eintrag in $PATH; do
    if [ -n "$eintrag" ] && [ ! -x "$eintrag/cargo-audit" ]; then
      neu="${neu:+$neu:}$eintrag"
    fi
  done
  printf '%s\n' "$neu"
}

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

# Ein Repo-Skelett: das Skript unter Test plus die drei Manifest-Dateien, die es kopiert.
# Der Lockfile-Inhalt ist für die Aussagen egal, seine Bytes nicht (Fall 2).
repo_neu() { # <name> -> pfad
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad/scripts" "$pfad/frontend" "$pfad/bin"
  cp "$SKRIPT_UNTER_TEST" "$pfad/scripts/check-deps.sh"
  printf '{"name":"frontend","version":"0.0.0","private":true}\n' > "$pfad/frontend/package.json"
  cat > "$pfad/frontend/pnpm-lock.yaml" <<'LOCK'
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      linke-tuete:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  linke-tuete@1.0.0: {}
LOCK
  printf 'overrides:\n  linke-tuete@<1.0.0: ^1.0.0\n' > "$pfad/frontend/pnpm-workspace.yaml"

  # Attrappe für `mise exec <tools...> -- pnpm -C <dir> audit …`: schneidet alles bis zum
  # `--` ab und protokolliert, WO der Audit landet und was dort liegt.
  cat > "$pfad/bin/mise" <<'MISE'
#!/usr/bin/env bash
[ "${1:-}" = exec ] && shift
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift || true
printf '%s\n' "$*" >> "$PROTOKOLL/pnpm-aufrufe"
dir=""; vorher=""
for a in "$@"; do [ "$vorher" = "-C" ] && dir="$a"; vorher="$a"; done
{
  echo "dir=$dir"
  if [ -f "$dir/pnpm-lock.yaml" ]; then
    echo "lockfile=$(${HASHBEFEHL:?} < "$dir/pnpm-lock.yaml" | cut -c1-16)"
  else
    echo "lockfile=FEHLT"
  fi
  if [ -e "$dir/node_modules" ]; then echo "node_modules=DA"; else echo "node_modules=WEG"; fi
  if [ -f "$dir/pnpm-workspace.yaml" ]; then echo "workspace=DA"; else echo "workspace=WEG"; fi
  case "$dir" in "$REPO_UNTER_TEST"/*) echo "im_repo=JA" ;; *) echo "im_repo=NEIN" ;; esac
} > "$PROTOKOLL/pnpm-befund"
exit "${STUB_PNPM_RC:-0}"
MISE

  # Attrappe für cargo: `cargo audit --version` beantwortet die Vorhandenseins-Frage,
  # `cargo audit` ist der Lauf selbst.
  cat > "$pfad/bin/cargo" <<'CARGO'
#!/usr/bin/env bash
if [ "${1:-}" = audit ]; then
  shift
  if [ "${1:-}" = --version ]; then
    echo "cargo-audit ${STUB_CARGO_AUDIT_DA:-0}-attrappe"
    exit "$(( ${STUB_CARGO_AUDIT_DA:-1} == 1 ? 0 : 1 ))"
  fi
  printf 'cargo audit %s\n' "$*" >> "$PROTOKOLL/cargo-aufrufe"
  exit "${STUB_CARGO_RC:-0}"
fi
exit 0
CARGO
  chmod +x "$pfad/bin/mise" "$pfad/bin/cargo"
  printf '%s\n' "$pfad"
}

# Führt das Skript im Skelett aus und gibt seinen Exit-Code aus. Der Befund landet in
# $PROTOKOLL und wird von den Fällen danach gelesen.
lauf() { # [--ohne-cargo-audit] <repo> [env-zuweisungen...] -> gibt den Exit-Code aus
  local basis="$PATH"
  if [ "${1:-}" = --ohne-cargo-audit ]; then basis="$(pfad_ohne_cargo_audit)"; shift; fi
  local pfad="$1"; shift
  PROTOKOLL="$pfad/protokoll"
  rm -rf "$PROTOKOLL"; mkdir -p "$PROTOKOLL"
  local rc=0
  env PATH="$pfad/bin:$basis" PROTOKOLL="$PROTOKOLL" REPO_UNTER_TEST="$pfad" \
      STUB_CARGO_AUDIT_DA=1 "$@" "$pfad/scripts/check-deps.sh" \
      > "$PROTOKOLL/ausgabe" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

befund() { # <repo> <schluessel>
  sed -n "s/^$2=//p" "$1/protokoll/pnpm-befund" 2>/dev/null || true
}

echo "==> Selbsttest check-deps.sh"

# 1 — Ein stale node_modules im Arbeitsbaum, das Versionen führt, die im Lockfile nicht
# stehen, darf den Audit nicht erreichen.
r="$(repo_neu stale)"
mkdir -p "$r/frontend/node_modules/.pnpm/linke-tuete@9.9.9/node_modules/linke-tuete"
printf '{"name":"linke-tuete","version":"9.9.9"}\n' \
  > "$r/frontend/node_modules/.pnpm/linke-tuete@9.9.9/node_modules/linke-tuete/package.json"
rc="$(lauf "$r")"
pruefe "stale node_modules: Gate bleibt grün, wenn der Audit grün ist" "0" "$rc"
pruefe "stale node_modules: der Audit sieht es NICHT" "WEG" "$(befund "$r" node_modules)"
pruefe "der Audit läuft ausserhalb des Arbeitsbaums" "NEIN" "$(befund "$r" im_repo)"

# 2 — Das Lockfile kommt BYTE-IDENTISCH mit — sonst wäre Fall 1 auch grün, wenn der Audit ein
# leeres Verzeichnis sähe.
pruefe "das Lockfile kommt unverändert mit" \
  "$(hashe "$r/frontend/pnpm-lock.yaml")" "$(befund "$r" lockfile)"

# 3 — pnpm-workspace.yaml MUSS mit (Overrides); fehlte sie, liefe das Gate falsch ROT.
pruefe "die Overrides kommen mit" "DA" "$(befund "$r" workspace)"

# 4 — Das Wegwerf-Verzeichnis bleibt nicht liegen.
verz="$(befund "$r" dir)"
pruefe "das Wegwerf-Verzeichnis ist danach weg" "WEG" \
  "$([ -e "$verz" ] && echo DA || echo WEG)"

# 5 — Die Schwelle wird durchgereicht; fiele sie weg, wäre das Gate durch moderate-Rauschen
# dauerrot.
pruefe "--audit-level=high wird übergeben" "ja" \
  "$(grep -q -- '--audit-level=high' "$r/protokoll/pnpm-aufrufe" && echo ja || echo nein)"

# 6 — Ein Fund schlägt durch, mit stale node_modules gefahren — sonst belegte die Datei nur,
# dass der Audit an der richtigen Stelle steht.
rc="$(lauf "$r" STUB_PNPM_RC=1)"
pruefe "ein Frontend-Fund bricht das Gate (trotz stale node_modules)" "1" "$rc"

# 7 — Derselbe Durchschlag auf der Rust-Hälfte.
rc="$(lauf "$r" STUB_CARGO_RC=1)"
pruefe "ein cargo-audit-Fund bricht das Gate" "1" "$rc"

# 8 — Ein unvollständiger Scan (cargo-audit fehlt, das Skript endet dann bewusst mit 0) darf
# einen echten Frontend-Fund nicht schlucken. Der PATH wird gefiltert (s. o.), und belegt wird
# zusätzlich, dass der Zweig wirklich lief — sonst wäre der Fall eine Dublette von Fall 6.
rc="$(lauf --ohne-cargo-audit "$r" STUB_CARGO_AUDIT_DA=0 STUB_PNPM_RC=1)"
pruefe "fehlendes cargo-audit schluckt den Frontend-Fund nicht" "1" "$rc"
pruefe "fehlendes cargo-audit: der Zweig wurde wirklich betreten" "ja" \
  "$(grep -q 'ÜBERSPRUNGEN: cargo-audit' "$r/protokoll/ausgabe" && echo ja || echo nein)"

# 9 — Fehlt eine Manifest-Datei, wird laut abgebrochen statt eine Teilmenge zu prüfen.
r="$(repo_neu ohne_lockfile)"; rm "$r/frontend/pnpm-lock.yaml"
rc="$(lauf "$r")"
pruefe "fehlendes Lockfile bricht laut ab" "1" "$rc"
pruefe "fehlendes Lockfile: der Audit läuft gar nicht erst" "nein" \
  "$([ -e "$r/protokoll/pnpm-aufrufe" ] && echo ja || echo nein)"

# 10 — Bekommt das Frontend echte Workspace-Pakete, fehlten deren package.json im
# Wegwerf-Verzeichnis; bis die Kopierliste erweitert ist, bricht es. Das Lockfile wird
# GESCHRIEBEN statt nachträglich verändert: dafür bräuchte es ein Werkzeug (etwa Python),
# das das Projekt nicht voraussetzt, und ein Abbruch risse unter `set -e` das ganze
# check-all.sh mit.
r="$(repo_neu fremder_importer)"
cat > "$r/frontend/pnpm-lock.yaml" <<'LOCK'
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      linke-tuete:
        specifier: ^1.0.0
        version: 1.0.0

  pakete/a:
    dependencies: {}

packages:

  linke-tuete@1.0.0: {}
LOCK
rc="$(lauf "$r")"
pruefe "ein zweiter Importer bricht laut ab" "1" "$rc"
pruefe "zweiter Importer: der Audit läuft gar nicht erst" "nein" \
  "$([ -e "$r/protokoll/pnpm-aufrufe" ] && echo ja || echo nein)"

echo
if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fehler im Selbsttest von check-deps.sh." >&2
  exit 1
fi
echo "==> OK: check-deps.sh prüft das Lockfile, nicht den lokalen Installationszustand."
