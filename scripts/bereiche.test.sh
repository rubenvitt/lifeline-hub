#!/usr/bin/env bash
# Selbsttest für scripts/bereiche.sh (LFH-1115).
#
# Die Bereichs-Erkennung irrt in eine Richtung still: ordnet sie eine Datei einer Suite nicht
# zu, die sie liest, bleibt deren Rot im PR unsichtbar und fällt erst auf `alpha` auf. Deshalb
# prüft der Test neben festen Fällen den Quelltext selbst: Jeder Pfad, den eine Suite als
# Zeichenkette nennt und der im Repo liegt, muss diese Suite auslösen.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SKRIPTE/.." && pwd)"
# shellcheck source=bereiche.sh
. "$SKRIPTE/bereiche.sh"
fehler=0

ok() { echo "ok   $1"; }
rot() {
  echo "ROT  $1" >&2
  fehler=1
}

# ── Feste Fälle ─────────────────────────────────────────────────────────────────────────
fall() { # <pfad> <erwartete Wörter>
  local ist
  ist="$(bereiche_von "$1")"
  [ "$ist" = "$2" ] && ok "$1 → ${2:-keine}" || rot "$1 → '${ist}' (Soll '$2')"
}
fall website/src/pages/index.astro ""
fall docs/betrieb.md ""
fall docs/anwender/kapitel/x.md "frontend e2e"
fall openspec/specs/x/spec.md ""
fall .claude/skills/x/SKILL.md ""
fall frontend/AGENTS.md ""
fall README.md ""
fall frontend/src/etb/EtbZeitachse.tsx "frontend e2e"
fall frontend/e2e/etb.spec.ts "frontend e2e"
fall frontend/package.json "frontend e2e"
fall frontend/src/api/openapi.json "rust frontend e2e"
fall frontend/src/heic/__fixtures__/hochkant.heic "rust frontend e2e"
fall frontend/src/einsatz/modulRegistry.ts "rust frontend e2e"
fall src/karte/quellen.rs "rust frontend e2e"
fall tests/fixtures/verdichtung/regeln.json "rust frontend e2e"
fall src/app.rs "rust e2e"
fall tests/geraet_kopplung.rs "rust e2e"
fall migrations/0170_x.sql "rust e2e"
fall Cargo.lock "rust e2e"
fall src-tauri/src/main.rs "rust frontend"
fall scripts/check-all.sh "rust frontend e2e"
fall .github/workflows/ci.yml "rust frontend e2e"
fall mise.toml "rust frontend e2e"
fall gibt-es-noch-nicht/datei "rust frontend e2e"

ausgabe() { # <name> <erwartet> <pfade…>
  local name="$1" soll="$2" ist
  shift 2
  ist="$(printf '%s\n' "$@" | bereiche_ausgeben | tr '\n' ' ')"
  [ "$ist" = "$soll" ] && ok "$name" || rot "$name: '$ist' (Soll '$soll')"
}
ausgabe "nur Website und Doku → keine Suite" "rust=false frontend=false e2e=false " \
  website/package.json docs/x.md
ausgabe "Frontend und Doku → Frontend und e2e" "rust=false frontend=true e2e=true " \
  frontend/src/a.tsx openspec/x.md
ausgabe "Backend und Hülle → alle" "rust=true frontend=true e2e=true " src/a.rs src-tauri/b.rs
ausgabe "leere Liste → alle (im Zweifel prüfen)" "rust=true frontend=true e2e=true " ""
rc=0
"$SKRIPTE/bereiche.sh" x < /dev/null > /dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] && ok "Argument statt stdin → Exit 2" || rot "Argument statt stdin → Exit $rc"

# ── Querbezüge im Quelltext ─────────────────────────────────────────────────────────────
# Ein `git grep` je Suite liefert `datei:literal`; ohne Subshell je Literal, sonst dauerte der
# Test bei einigen tausend Literalen eine Minute.

# `a/b/../c` → `a/c` in NORM; leer, wenn der Pfad die Repo-Wurzel verlässt.
normalisieren() {
  local rest="$1/" teil
  NORM=""
  while [ -n "$rest" ]; do
    teil="${rest%%/*}"
    rest="${rest#*/}"
    case "$teil" in
      "" | .) ;;
      ..)
        [ -n "$NORM" ] || { NORM=""; return; }
        case "$NORM" in */*) NORM="${NORM%/*}" ;; *) NORM="" ;; esac
        ;;
      *) NORM="${NORM:+$NORM/}$teil" ;;
    esac
  done
}

# Ausnahmen: Pfade, die eine Suite nennt, aber nicht liest.
#   frontend/dist   Build-Ausgabe (rust-embed), im Repo nur `.gitkeep`.
#   openspec/…/stilprobe   Ablage der Stilprobe (e2e schreibt, nur mit PW_STILPROBE=1).
ausnahme() {
  case "$1" in
    frontend/dist | frontend/dist/*) return 0 ;;
    openspec/changes/archive/2026-09-30-lfh-595-ein-ikonensatz/stilprobe*) return 0 ;;
  esac
  return 1
}

verweise_rot=0
# Prüft die Kandidaten eines Literals: jeder, der im Repo liegt, muss <suite> auslösen.
# Verzeichnisse werden über eine gedachte Datei darin eingeordnet. Basis `@` steht für das
# Verzeichnis der nennenden Datei, `@crate` für ihr Cargo-Paket.
pruefe_literal() { # <suite> <datei> <literal> <basis…>
  local suite="$1" datei="$2" lit="$3" basis kandidat gesehen=""
  shift 3
  for basis in "$@"; do
    case "$basis" in
      @) basis="${datei%/*}" ;;
      @crate) case "$datei" in src-tauri/*) basis=src-tauri ;; *) basis=. ;; esac ;;
    esac
    normalisieren "$basis/$lit"
    kandidat="$NORM"
    [ -n "$kandidat" ] && [ -e "$ROOT/$kandidat" ] || continue
    case " $gesehen " in *" $kandidat "*) continue ;; esac
    gesehen="$gesehen $kandidat"
    ausnahme "$kandidat" && continue
    [ -d "$ROOT/$kandidat" ] && kandidat="$kandidat/x"
    case " $(bereiche_von "$kandidat") " in
      *" $suite "*) ;;
      *)
        rot "$datei nennt '$lit' ($kandidat), das löst '$suite' nicht aus — Querbezug in bereiche.sh nachtragen"
        verweise_rot=1
        ;;
    esac
  done
}

# Pfadähnliche Zeichenketten in <quotes>: mindestens ein Schrägstrich, keine Leerzeichen. Backticks
# zählen nicht: im Bestand stehen sie in Kommentaren („`frontend/AGENTS.md`") und nennen Regeln,
# keine gelesenen Dateien.
quellen_pruefen() { # <suite> <quote> <basis…> -- <git-pathspec…>
  local suite="$1" q="$2" basen=() treffer datei lit
  shift 2
  while [ "$1" != -- ]; do basen+=("$1"); shift; done
  shift
  while IFS= read -r treffer; do
    datei="${treffer%%:*}"
    lit="${treffer#*:}"
    lit="${lit#"$q"}"
    lit="${lit%"$q"}"
    case "$lit" in http*:* | *://*) continue ;; esac
    pruefe_literal "$suite" "$datei" "$lit" "${basen[@]}"
  done < <(cd "$ROOT" && git grep -oE "$q(\.{0,2}/)*[A-Za-z0-9_.@-]+(/[A-Za-z0-9_.@-]+)+/?$q" -- "$@" \
    | sort -u || true)
}

anzahl() { (cd "$ROOT" && git ls-files -- "$@" | wc -l | tr -d ' '); }

# Rust: relativ zur Wurzel (cargo test im Haupt-Crate), zur Datei (include_*!) und zum Crate der
# Hülle (cargo test -p lifeline-desktop läuft in src-tauri/).
RUST_DATEIEN=('src/*.rs' 'tests/*.rs' 'crates/*.rs' 'src-tauri/*.rs' build.rs)
quellen_pruefen rust '"' . @ @crate -- "${RUST_DATEIEN[@]}"

# Vitest: relativ zur Datei (import.meta.url), zu frontend/ (process.cwd()) und zur Vite-Wurzel
# (`/e2e/**` in import.meta.glob).
VITEST_DATEIEN=('frontend/src/*.ts' 'frontend/src/*.tsx' frontend/vite.config.ts)
quellen_pruefen frontend "'" @ frontend -- "${VITEST_DATEIEN[@]}"
quellen_pruefen frontend '"' @ frontend -- "${VITEST_DATEIEN[@]}"

# `join(repo, 'a', 'b')` (marke.guard.test.ts): die Teile ergeben den Pfad ab der Wurzel.
while IFS= read -r treffer; do
  pfad="$(printf '%s' "${treffer#*:}" | sed -E "s/^join\(repo, //; s/\)\$//; s/'//g; s/, /\//g")"
  pruefe_literal frontend "${treffer%%:*}" "$pfad" .
done < <(cd "$ROOT" && git grep -oE "join\(repo(, '[^']+')+\)" -- 'frontend/src/*.ts' || true)

# e2e: relativ zur Spec-Datei und zu frontend/ (Playwright-Wurzel).
E2E_DATEIEN=('frontend/e2e/*.ts' frontend/playwright.config.ts)
quellen_pruefen e2e "'" @ frontend -- "${E2E_DATEIEN[@]}"
quellen_pruefen e2e '"' @ frontend -- "${E2E_DATEIEN[@]}"

# Ein Glob, der nichts trifft, wäre sonst grün.
gesamt="$(($(anzahl "${RUST_DATEIEN[@]}") + $(anzahl "${VITEST_DATEIEN[@]}") + $(anzahl "${E2E_DATEIEN[@]}")))"
if [ "$gesamt" -lt 500 ]; then
  rot "Querbezüge: nur $gesamt Quelldateien gefunden — Suche verschoben?"
elif [ "$verweise_rot" -eq 0 ]; then
  ok "Querbezüge: jeder Pfad, den eine Suite nennt, löst sie aus ($gesamt Dateien)"
fi

# Der Wächter selbst: ein Rust-Literal auf eine Doku-Datei muss rot werden (Subshell: der
# erwartete Fund färbt den Test nicht).
if [ "$(verweise_rot=0; pruefe_literal rust probe docs . > /dev/null 2>&1; echo "$verweise_rot")" = 1 ]; then
  ok "Wächter schlägt an: Rust nennt docs/ → rot"
else
  rot "Wächter schlägt nicht an: Rust nennt docs/, blieb grün"
fi
normalisieren "frontend/src/lage/../../../tests/fixtures/x.json"
[ "$NORM" = tests/fixtures/x.json ] && ok "Normalisieren löst ../ auf" || rot "Normalisieren: '$NORM'"
normalisieren "../ausserhalb"
[ -z "$NORM" ] && ok "Normalisieren verwirft Pfade außerhalb der Wurzel" || rot "Normalisieren: '$NORM'"

exit "$fehler"
