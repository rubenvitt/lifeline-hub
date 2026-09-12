#!/usr/bin/env bash
# Selbsttest für scripts/check-deps.sh (LFH-316).
#
# WARUM DIESES GATE EIN GATE BRAUCHT: check-deps.sh ist die einzige Stelle, an der ein
# neues Advisory überhaupt ein Signal erzeugt — und sein Fehlerbild ist STILL. Liest es
# eine Teilmenge, meldet es „OK: keine bekannten Schwachstellen" und sieht dabei exakt aus
# wie ein vollständiger Lauf. Genau das war der Befund von LFH-316: derselbe Commit, zwei
# Arbeitsbäume, zwei Antworten — der lang gewachsene Checkout gab Entwarnung.
#
# Gemessen wird deshalb nicht, WAS der Audit findet (das hängt an der Advisory-Datenbank
# und ändert sich über Nacht), sondern WORAUF er schaut und OB sein Urteil durchschlägt.
# Beides ohne Netz: `mise`/`cargo` sind Attrappen, die aufzeichnen statt zu prüfen.
#
# DIE SCHÄRFEREN HÄLFTEN SIND DIE NEGATIVEN. „Der Audit sieht das Lockfile" wäre auch dann
# grün, wenn er nebenher den halben Arbeitsbaum sähe; erst „er sieht node_modules NICHT"
# und „ein Fund bricht" schließen das falsche Grün aus, für das dieses Ticket existiert.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-deps.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# HASHWERKZEUG: `shasum -a 256` ist die Konvention des Repos (build-offline-karten.sh,
# artefakte.yml), `sha256sum` fehlt auf macOS. Die Wahl steht HIER und wird an die Attrappe
# durchgereicht, damit beide Seiten desselben Vergleichs dasselbe Werkzeug nehmen.
#
# UND SEIN FEHLEN IST EIN ABBRUCH, KEIN LEERSTRING. Ohne diesen Riegel kollabieren beide
# Seiten von Fall 2 zu "" und die Aussage „das Lockfile kam unverändert mit" ist trivial
# grün, ohne dass je etwas gehasht wurde — nachgestellt, indem `sha256sum` aus dem PATH
# genommen wurde: der Fall meldete „ok". Ein Test, der nicht rot werden kann, behauptet
# eine Deckung, die er nicht hat.
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

# PATH-Einträge fallenlassen, die ein echtes cargo-audit führen. Fall 8 braucht das:
# `check-deps.sh` fragt zuerst `command -v cargo-audit` und erreicht die Attrappe gar
# nicht, wenn das Werkzeug wirklich installiert ist — in der CI ist es das
# (ci.yml installiert cargo-audit 0.22.2 vor den Schnellprüfungen).
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
# Bewusst KEIN echtes Frontend — der Lockfile-Inhalt ist für die Aussagen egal, seine
# Bytes sind es nicht (Fall 3).
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

# 1 — DER KERN DES TICKETS: ein stale node_modules im Arbeitsbaum darf den Audit nicht
# erreichen. Gebaut wird genau der beschriebene Zustand — ein node_modules, das Versionen
# führt, die im Lockfile gar nicht stehen.
r="$(repo_neu stale)"
mkdir -p "$r/frontend/node_modules/.pnpm/linke-tuete@9.9.9/node_modules/linke-tuete"
printf '{"name":"linke-tuete","version":"9.9.9"}\n' \
  > "$r/frontend/node_modules/.pnpm/linke-tuete@9.9.9/node_modules/linke-tuete/package.json"
rc="$(lauf "$r")"
pruefe "stale node_modules: Gate bleibt grün, wenn der Audit grün ist" "0" "$rc"
pruefe "stale node_modules: der Audit sieht es NICHT" "WEG" "$(befund "$r" node_modules)"
pruefe "der Audit läuft ausserhalb des Arbeitsbaums" "NEIN" "$(befund "$r" im_repo)"

# 2 — Das Lockfile kommt BYTE-IDENTISCH mit. Ohne diese Hälfte wäre Fall 1 auch dann grün,
# wenn gar nichts kopiert würde und der Audit ein leeres Verzeichnis sähe.
pruefe "das Lockfile kommt unverändert mit" \
  "$(hashe "$r/frontend/pnpm-lock.yaml")" "$(befund "$r" lockfile)"

# 3 — pnpm-workspace.yaml MUSS mit: dort stehen die Overrides. Fehlte sie, liefe das Gate
# nicht falsch grün, sondern falsch ROT — das andere Fehlerbild, das ein Gate abschaltet.
pruefe "die Overrides kommen mit" "DA" "$(befund "$r" workspace)"

# 4 — Das Wegwerf-Verzeichnis bleibt nicht liegen. Ein Gate, das je Lauf ein Verzeichnis
# hinterlässt, wird auf einer Entwicklungsmaschine zum Dauerläufer.
verz="$(befund "$r" dir)"
pruefe "das Wegwerf-Verzeichnis ist danach weg" "WEG" \
  "$([ -e "$verz" ] && echo DA || echo WEG)"

# 5 — Die Schwelle wird durchgereicht. Sie entscheidet, welcher Fund bricht; fiele sie weg,
# wäre das Gate durch moderate-Rauschen dauerrot und würde abgeschaltet.
pruefe "--audit-level=high wird übergeben" "ja" \
  "$(grep -q -- '--audit-level=high' "$r/protokoll/pnpm-aufrufe" && echo ja || echo nein)"

# 6 — DIE ZWEITE SCHÄRFERE HÄLFTE: ein Fund schlägt durch. Ohne diesen Fall belegt die
# ganze Datei nur, dass der Audit an der richtigen Stelle steht — nicht, dass sein Urteil
# irgendwen erreicht. Mit stale node_modules gefahren, weil genau diese Kombination der
# gemeldete Defekt war.
rc="$(lauf "$r" STUB_PNPM_RC=1)"
pruefe "ein Frontend-Fund bricht das Gate (trotz stale node_modules)" "1" "$rc"

# 7 — Derselbe Durchschlag auf der Rust-Hälfte.
rc="$(lauf "$r" STUB_CARGO_RC=1)"
pruefe "ein cargo-audit-Fund bricht das Gate" "1" "$rc"

# 8 — Ein unvollständiger Scan darf einen echten Fund nicht schlucken. Die Kombination ist
# real: cargo-audit fehlt auf vielen Maschinen, und das Skript beendet sich in dem Fall
# bewusst mit 0. Läge dieser Zweig VOR dem Frontend-Audit, ginge der Fund verloren.
#
# DER PATH MUSS DAFÜR GEFILTERT WERDEN, und das ist gemessen statt vermutet: `check-deps.sh`
# fragt zuerst `command -v cargo-audit`. Ist das Werkzeug echt installiert — in der CI ist es
# das —, wird die Attrappe nie gefragt, der Zweig nie betreten, und dieser Fall wäre eine
# Dublette von Fall 6. Deshalb wird zusätzlich BELEGT, dass der Zweig lief: ohne diese
# Zeile ist „grün" von „gar nicht ausgeführt" nicht zu unterscheiden.
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

# 10 — DER RIEGEL GEGEN DAS NÄCHSTE FALSCHE GRÜN: bekommt das Frontend echte
# Workspace-Pakete, fehlen deren package.json im Wegwerf-Verzeichnis und der Audit-Baum
# wäre still unvollständig. Dann ist die Kopierliste zu erweitern — und bis dahin bricht es.
#
# DAS LOCKFILE WIRD GESCHRIEBEN, NICHT NACHTRÄGLICH VERÄNDERT. Ein Ersetzen von Hand
# brauchte ein Werkzeug, das dieses Projekt nicht voraussetzt — die README nennt Rust,
# Node/pnpm über mise, Perl, einen C-Compiler und nasm, kein Python, und kein anderes
# Skript unter scripts/ ruft eines. Ein Selbsttest, der auf einer Maschine ohne dieses
# Werkzeug abbricht, reisst unter `set -e` das GANZE check-all.sh mit: aus einem Gate,
# das eine Lücke schliessen soll, würde eines, das grundlos rot ist — und ein grundlos
# rotes Gate wird abgeschaltet statt befolgt.
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
