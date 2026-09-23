#!/usr/bin/env bash
# Selbsttest für scripts/check-migrationen.sh (LFH-658).
#
# WARUM DIESES GATE EXISTIERT: das Prüfskript ist die einzige Stelle, die eine eingeschobene
# Migrationsnummer bemerkt — sqlx spielt sie still nach (`db::tests::
# sqlx_spielt_eingeschobene_kleinere_version_still_nach`). Irrt es in die eine Richtung,
# sperrt es jeden PR mit Migration; irrt es in die andere, ist `alpha` wieder rot wie am
# 22.09.2026, und die Prüfung sah dabei grün aus. Beides fiele erst beim nächsten Merge auf.
#
# Gefahren wird gegen echte Git-Repositories im Temp-Verzeichnis: die Aussagen hängen an
# Merge-Base, Diff-Status und Umbenennungen, genau da liegen die Fallen (Fall 2 und 11).
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-migrationen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# Ein Repository mit `alpha` als Ziel-Branch und zwei Bestands-Migrationen.
repo_neu() {
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad/migrations"
  git -C "$pfad" init -q -b alpha
  git -C "$pfad" config user.email test@example.invalid
  git -C "$pfad" config user.name Test
  git -C "$pfad" config commit.gpgsign false
  echo "CREATE TABLE a (id INTEGER);" > "$pfad/migrations/0001_a.sql"
  echo "CREATE TABLE b (id INTEGER);" > "$pfad/migrations/0002_b.sql"
  git -C "$pfad" add -A
  git -C "$pfad" commit -q -m basis
  git -C "$pfad" branch feature
  printf '%s\n' "$pfad"
}

# Legt auf <branch> eine Datei an (Inhalt eindeutig) und committet. Der Inhalt nennt den
# eigenen Dateinamen bewusst NICHT: `--umnummerieren` schreibt jeden Verweis auf den alten
# Namen um, auch einen in der Migration selbst, und Fall 12 vergleicht den Inhalt.
datei() { # <repo> <branch> <pfad>
  git -C "$1" checkout -q "$2"
  mkdir -p "$(dirname "$1/$3")"
  echo "-- inhalt $RANDOM$RANDOM" > "$1/$3"
  git -C "$1" add -A
  git -C "$1" commit -q -m "$3"
}

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

# Behauptet, dass die Ausgabe des letzten Laufs <text> enthält.
enthaelt() { # <name> <text>
  if grep -qF -- "$2" "$ARBEIT/ausgabe"; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — '$2' fehlt in der Ausgabe:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}

# Prüft den Stand von `feature` gegen `alpha`; gibt den Exit-Code aus.
lauf() { # <repo> [weitere Argumente...]
  local pfad="$1"; shift
  git -C "$pfad" checkout -q feature
  local code=0
  ( cd "$pfad" && "$SKRIPT_UNTER_TEST" "$@" alpha feature ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
  printf '%s\n' "$code"
}

echo "==> Migrationsnummern-Selbsttest"

# 1 — Kein eigener Schema-Beitrag. Dass `alpha` inzwischen 0003 hat und `feature` nicht,
# ist KEIN Löschen: Maßstab für „geändert/gelöscht" ist die Abzweigung, nicht der Ziel-Stand.
r="$(repo_neu ohne)"
datei "$r" feature src/lib.rs
datei "$r" alpha migrations/0003_fremd.sql
pruefe "ohne eigene Migration grün, obwohl alpha vorausläuft" 0 "$(lauf "$r")"

# 2 — Der Normalfall: angehängt hinter alles auf alpha.
r="$(repo_neu anhaengen)"
datei "$r" feature migrations/0003_eigen.sql
pruefe "angehängte Migration grün" 0 "$(lauf "$r")"

# 3 — Die Kollision vom 22.09.: beide Branches nahmen dieselbe nächste freie Nummer.
r="$(repo_neu kollision)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
pruefe "Kollision rot" 1 "$(lauf "$r")"
enthaelt "Kollision nennt die eigene Datei" "0003_eigen.sql"
enthaelt "Kollision schlägt die nächste freie Nummer vor" "0004"

# 4 — Der stille Fall: keine Kollision, aber eine Nummer UNTER dem, was alpha schon hat. Eine
# DB mit 0004 spielte 0003 still nach (sqlx), eine frische DB in anderer Reihenfolge.
r="$(repo_neu einschub)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0004_fremd.sql
pruefe "Einschub unter eine gemergte Nummer rot" 1 "$(lauf "$r")"
enthaelt "Einschub schlägt 0005 vor" "0005"

# 5 — Zwei eigene Migrationen mit derselben Nummer.
r="$(repo_neu dublette)"
datei "$r" feature migrations/0003_x.sql
datei "$r" feature migrations/0003_y.sql
pruefe "Dublette im Branch rot" 1 "$(lauf "$r")"
enthaelt "Dublette nennt die erste Datei" "0003_x.sql"
enthaelt "Dublette nennt die zweite Datei" "0003_y.sql"

# 6 — Eine eingespielte Migration wird geändert: Prüfsummenbruch auf jeder Bestands-DB.
r="$(repo_neu geaendert)"
git -C "$r" checkout -q feature
echo "ALTER TABLE b ADD COLUMN c TEXT;" >> "$r/migrations/0002_b.sql"
git -C "$r" commit -q -am aendern
pruefe "geänderte Bestands-Migration rot" 1 "$(lauf "$r")"
enthaelt "geänderte Migration wird genannt" "0002_b.sql"

# 7 — Umbenannt: die alte Version fehlt danach in der Quelle („VersionMissing").
r="$(repo_neu umbenannt)"
git -C "$r" checkout -q feature
git -C "$r" mv migrations/0002_b.sql migrations/0003_b.sql
git -C "$r" commit -q -m umbenennen
pruefe "umbenannte Bestands-Migration rot" 1 "$(lauf "$r")"
enthaelt "umbenannte Migration wird genannt" "0002_b.sql"

# 8 — Gelöscht.
r="$(repo_neu geloescht)"
git -C "$r" checkout -q feature
git -C "$r" rm -q migrations/0001_a.sql
git -C "$r" commit -q -m loeschen
pruefe "gelöschte Bestands-Migration rot" 1 "$(lauf "$r")"

# 9 — Ohne vierstelliges Präfix gibt es keine Nummer, gegen die sich prüfen ließe.
r="$(repo_neu format)"
datei "$r" feature migrations/17_kurz.sql
pruefe "Dateiname ohne vierstellige Nummer rot" 1 "$(lauf "$r")"

# 10 — Nicht-SQL-Dateien im Verzeichnis sind keine Migrationen.
r="$(repo_neu kein_sql)"
datei "$r" feature migrations/README.md
pruefe "Nicht-SQL-Datei unter migrations/ grün" 0 "$(lauf "$r")"

# 11 — DIE FALLE der Merge-Base: hat der Branch alpha schon hereingemergt, ist die
# Abzweigung die alpha-Spitze. Die Kollision muss trotzdem rot bleiben — ein Skript, das
# „neu" gegen die Merge-Base und „frei" ebenfalls gegen die Merge-Base prüfte, sähe sie hier
# nicht mehr, weil 0003_fremd dann zum Bestand zählt.
r="$(repo_neu nachgezogen)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
git -C "$r" checkout -q feature
git -C "$r" merge -q --no-edit alpha
pruefe "Kollision nach Hereinmergen von alpha rot" 1 "$(lauf "$r")"

# 12 — Umnummerieren: zwei eigene Migrationen ziehen hinter alpha, die Verweise ziehen mit,
# die Folgeprüfung ist grün. Die FALLE dabei: das Ziel der ersten (0004) ist der heutige Platz
# der zweiten. Ohne Zwischenschritt scheitert `git mv` daran oder überschreibt die Datei —
# deshalb wird auch der Inhalt verglichen, nicht nur der Name.
r="$(repo_neu umnummerieren)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" feature migrations/0004_zweite.sql
git -C "$r" checkout -q feature
inhalt_eigen="$(cat "$r/migrations/0003_eigen.sql")"
inhalt_zweite="$(cat "$r/migrations/0004_zweite.sql")"
mkdir -p "$r/src"
printf 'const M: &str = include_str!("../migrations/0003_eigen.sql");\n' > "$r/src/db.rs"
printf 'const N: &str = include_str!("../migrations/0004_zweite.sql");\n' >> "$r/src/db.rs"
git -C "$r" add -A && git -C "$r" commit -q -m verweis
datei "$r" alpha migrations/0003_fremd.sql
pruefe "umnummerieren läuft durch" 0 "$(lauf "$r" --umnummerieren)"
pruefe "erste Migration liegt auf 0004, mit ihrem Inhalt" "$inhalt_eigen" \
  "$(cat "$r/migrations/0004_eigen.sql" 2>/dev/null || echo fehlt)"
pruefe "zweite Migration liegt auf 0005, mit ihrem Inhalt" "$inhalt_zweite" \
  "$(cat "$r/migrations/0005_zweite.sql" 2>/dev/null || echo fehlt)"
pruefe "alte Namen sind weg" "nein" \
  "$([ -e "$r/migrations/0003_eigen.sql" ] || [ -e "$r/migrations/0004_zweite.sql" ] && echo ja || echo nein)"
pruefe "Verweise sind nachgezogen" \
  "$(printf '%s\n%s' 'const M: &str = include_str!("../migrations/0004_eigen.sql");' \
                    'const N: &str = include_str!("../migrations/0005_zweite.sql");')" \
  "$(cat "$r/src/db.rs")"
git -C "$r" add -A && { git -C "$r" commit -q -m umnummeriert || true; }
pruefe "nach dem Umnummerieren grün" 0 "$(lauf "$r")"

# 13 — Umnummerieren fasst Bestands-Migrationen nicht an: eine geänderte eingespielte
# Migration lässt sich nicht wegnummerieren, das Skript bricht ab statt umzubenennen.
r="$(repo_neu umnummerieren_bestand)"
git -C "$r" checkout -q feature
echo "-- geändert" >> "$r/migrations/0002_b.sql"
git -C "$r" commit -q -am aendern
pruefe "umnummerieren verweigert bei geänderter Bestands-Migration" 1 \
  "$(lauf "$r" --umnummerieren)"
pruefe "Bestands-Migration bleibt liegen" "ja" \
  "$([ -f "$r/migrations/0002_b.sql" ] && echo ja || echo nein)"

# 14 — Eine unbekannte Basis ist ein Aufruffehler, kein Befund.
r="$(repo_neu basis_fehlt)"
code=0
( cd "$r" && "$SKRIPT_UNTER_TEST" gibtsnicht feature ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "unbekannte Basis ist Exit 2" 2 "$code"

echo
if [ "$fehler" -eq 0 ]; then
  echo "==> OK: Migrationsnummern-Prüfung grün."
else
  echo "==> FEHLER: $fehler Zusicherung(en) verletzt." >&2
  exit 1
fi
