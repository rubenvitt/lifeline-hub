# Lesen von Architekturentscheidungen (LLH-1435) — geteilt von scripts/check-architektur.sh und
# scripts/adr-fuer.sh. Form der Dateien: docs/architektur/AGENTS.md, Abschnitt „Entscheidungen“.
#
# Der Kopf ist ein kleines YAML zwischen zwei `---`-Zeilen: skalare Schlüssel (`id: ADR-0001`)
# und Listen (eingerückte `- `-Zeilen unter dem Schlüssel oder `[a, b]` in einer Zeile). Mehr
# liest dieser Parser nicht; mehr erlaubt die Form auch nicht. awk statt yq: läuft ohne
# Zusatzwerkzeug unter Linux und macOS (BSD-awk).

# Skalarer Wert eines Kopfschlüssels, ohne umschließende Anführungszeichen; leer, wenn er fehlt.
adr_kopf_wert() { # <datei> <schluessel>
  awk -v k="$2" '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && $0 == "---" { exit }
    NR > 1 && index($0, k ":") == 1 {
      v = substr($0, length(k) + 2)
      sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
      print v
      exit
    }
  ' "$1"
}

# Listeneinträge eines Kopfschlüssels, einer je Zeile.
adr_kopf_liste() { # <datei> <schluessel>
  awk -v k="$2" '
    function ausgeben(x) {
      sub(/^[ \t]+/, "", x); sub(/[ \t]+$/, "", x)
      if (x ~ /^".*"$/ || x ~ /^\047.*\047$/) x = substr(x, 2, length(x) - 2)
      if (x != "") print x
    }
    NR == 1 && $0 != "---" { exit }
    NR > 1 && $0 == "---" { exit }
    NR > 1 {
      if (index($0, k ":") == 1) {
        drin = 1
        v = substr($0, length(k) + 2)
        sub(/^[ \t]+/, "", v)
        if (v ~ /^\[/) {
          gsub(/[][]/, "", v)
          n = split(v, teile, ",")
          for (i = 1; i <= n; i++) ausgeben(teile[i])
        } else if (v != "") {
          ausgeben(v)
        }
        next
      }
      if (drin && $0 ~ /^[ \t]+- /) { x = $0; sub(/^[ \t]+- /, "", x); ausgeben(x); next }
      if ($0 !~ /^[ \t]/) drin = 0
    }
  ' "$1"
}

# Inhalt des ersten ```sh-Blocks im Abschnitt `## Prüfung`.
adr_pruefung() { # <datei>
  awk '
    /^## / { abschnitt = $0; if (an) exit; next }
    abschnitt == "## Prüfung" && !an && /^```sh[ \t]*$/ { an = 1; next }
    an && /^```[ \t]*$/ { exit }
    an { print }
  ' "$1"
}

# Die Zeile `manuell: …` im Abschnitt `## Prüfung`, falls die Entscheidung keine Maschinenprüfung hat.
adr_manuell() { # <datei>
  awk '
    /^## / { abschnitt = $0; next }
    abschnitt == "## Prüfung" && /^manuell: / { print; exit }
  ' "$1"
}

# Trifft ein Git-Pfadmuster (`src/live/**`, `frontend/src/**/*.ts`) den Pfad? Für Pfade, die
# Git noch nicht kennt; der Wächter fragt versionierte Dateien über `git ls-files ':(glob)…'`.
# Semantik wie dort: `*` und `?` bleiben in einem Pfadteil, `**/` steht für null oder mehr
# Verzeichnisse, ein abschließendes `/**` für alles darunter. Ein Muster ohne Platzhalter trifft
# sich selbst und alles darunter. Umgesetzt als ERE, weil `[[ == ]]` mit `*` über `/` hinwegliest.
adr_muster_trifft() { # <muster> <pfad>
  local muster="$1" pfad="${2#./}"
  case "$muster" in
    *'*'* | *'?'* | *'['*) ;;
    *)
      [ "$pfad" = "$muster" ] && return 0
      case "$pfad" in "${muster%/}"/*) return 0 ;; esac
      return 1
      ;;
  esac
  local re
  re="$(printf '%s' "$muster" | awk '{
    s = $0; out = ""
    while (length(s) > 0) {
      if (substr(s, 1, 3) == "**/") { out = out "(.*/)?"; s = substr(s, 4) }
      else if (substr(s, 1, 2) == "**") { out = out ".*"; s = substr(s, 3) }
      else {
        c = substr(s, 1, 1); s = substr(s, 2)
        if (c == "*") out = out "[^/]*"
        else if (c == "?") out = out "[^/]"
        else if (index(".+()|{}^$\\", c)) out = out "\\" c
        else out = out c
      }
    }
    print "^" out "$"
  }')"
  [[ "$pfad" =~ $re ]]
}

# Hilfen für die Prüfblöcke (werden jedem Block vorangestellt): ERE über `git grep`, Pfade als
# Git-Pfadmuster mit derselben Semantik wie `gilt_fuer` (ohne `:(glob)` läse Git `src/**/*.rs`
# anders und träfe `src/main.rs` nicht). `verbiete` scheitert bei einem Treffer und zeigt ihn,
# `verlange` ohne Treffer. `--untracked`: eine neue, noch nicht hinzugefügte Datei zählt schon
# lokal mit (wie im Wächter). Bash 3.2 (macOS): kein `mapfile`, Pfade sind Pflicht.
ADR_PRUEF_HILFEN='
_adr_pfade() { _adr_p=(); local x; for x in "$@"; do case "$x" in :*) _adr_p+=("$x") ;; *) _adr_p+=(":(glob)$x") ;; esac; done; }
verbiete() { local m="$1"; shift; _adr_pfade "$@"; if git grep --untracked -nE -e "$m" -- "${_adr_p[@]}"; then echo "verboten: $m" >&2; return 1; fi; }
verlange() { local m="$1"; shift; _adr_pfade "$@"; git grep --untracked -qE -e "$m" -- "${_adr_p[@]}" || { echo "fehlt: $m in $*" >&2; return 1; }; }
'
