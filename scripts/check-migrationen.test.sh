#!/usr/bin/env bash
# Selbsttest für scripts/check-migrationen.sh. Das Prüfskript bemerkt als einzige Stelle eine
# eingeschobene Migrationsnummer (sqlx spielt sie still nach) und irrt in beide Richtungen
# still: es sperrte jeden PR mit Migration oder ließe `alpha` wieder rot werden.
#
# Gefahren gegen echte Repositories im Temp-Verzeichnis: die Aussagen hängen an Merge-Base,
# Diff-Status und Umbenennungen, dort liegen die Fallen (Fall 2 und 11).
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

# 3 — Die Kollision: beide Branches nahmen dieselbe nächste freie Nummer.
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

# 11 — Der übliche Weg nach einer Kollision: alpha wird hereingemergt. Dann IST die
# Abzweigung die alpha-Spitze, und 0003_fremd zählt zum Bestand. Die eigene 0003 muss trotzdem
# als neu erkannt und rot bleiben — erst das Umnummerieren löst es.
r="$(repo_neu nachgezogen)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
git -C "$r" checkout -q feature
git -C "$r" merge -q --no-edit alpha
pruefe "Kollision nach Hereinmergen von alpha rot" 1 "$(lauf "$r")"

# 12 — Umnummerieren: zwei eigene Migrationen ziehen hinter alpha, die Verweise ziehen mit, die
# Folgeprüfung ist grün. Die FALLE: beide tragen dieselbe Beschreibung, das Ziel der ersten
# (0004_x) ist der heutige Name der zweiten. Einphasig schlüge das Verschieben fehl, und die
# Ersetzung `0003_x -> 0004_x` verbände den Verweis mit der falschen Datei — deshalb wird auch
# der Inhalt verglichen.
r="$(repo_neu umnummerieren)"
datei "$r" feature migrations/0003_x.sql
datei "$r" feature migrations/0004_x.sql
git -C "$r" checkout -q feature
inhalt_erste="$(cat "$r/migrations/0003_x.sql")"
inhalt_zweite="$(cat "$r/migrations/0004_x.sql")"
mkdir -p "$r/src"
printf 'const M: &str = include_str!("../migrations/0003_x.sql");\n' > "$r/src/db.rs"
printf 'const N: &str = include_str!("../migrations/0004_x.sql");\n' >> "$r/src/db.rs"
git -C "$r" add -A && git -C "$r" commit -q -m verweis
datei "$r" alpha migrations/0003_fremd.sql
pruefe "umnummerieren läuft durch" 0 "$(lauf "$r" --umnummerieren)"
pruefe "erste Migration liegt auf 0004, mit ihrem Inhalt" "$inhalt_erste" \
  "$(cat "$r/migrations/0004_x.sql" 2>/dev/null || echo fehlt)"
pruefe "zweite Migration liegt auf 0005, mit ihrem Inhalt" "$inhalt_zweite" \
  "$(cat "$r/migrations/0005_x.sql" 2>/dev/null || echo fehlt)"
pruefe "alter Name der ersten ist weg" "nein" \
  "$([ -e "$r/migrations/0003_x.sql" ] && echo ja || echo nein)"
pruefe "Verweise sind nachgezogen" \
  "$(printf '%s\n%s' 'const M: &str = include_str!("../migrations/0004_x.sql");' \
                    'const N: &str = include_str!("../migrations/0005_x.sql");')" \
  "$(cat "$r/src/db.rs")"
git -C "$r" add -A && { git -C "$r" commit -q -m umnummeriert || true; }
pruefe "nach dem Umnummerieren grün" 0 "$(lauf "$r")"

# 13 — Umnummerieren fasst Bestands-Migrationen nicht an: eine geänderte eingespielte
# Migration lässt sich nicht wegnummerieren, das Skript bricht ab statt umzubenennen.
# Die kollidierende neue Migration im Fixture ist nötig: ohne sie gäbe es nichts
# umzunummerieren, und „nichts wurde umbenannt" wäre trivial wahr.
r="$(repo_neu umnummerieren_bestand)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
git -C "$r" checkout -q feature
echo "-- geändert" >> "$r/migrations/0002_b.sql"
git -C "$r" commit -q -am aendern
pruefe "umnummerieren verweigert bei geänderter Bestands-Migration" 1 \
  "$(lauf "$r" --umnummerieren)"
pruefe "nichts wurde umbenannt" "ja ja" \
  "$([ -f "$r/migrations/0002_b.sql" ] && echo ja || echo nein) $([ -f "$r/migrations/0003_eigen.sql" ] && echo ja || echo nein)"

# 15 — Nicht-ASCII im Namen: mit der Git-Vorgabe core.quotePath=true kämen solche Pfade
# in Anführungszeichen zurück, endeten auf `.sql"` und fielen still aus jeder Prüfung.
r="$(repo_neu umlaut)"
datei "$r" feature migrations/0003_größe.sql
datei "$r" alpha migrations/0003_fremd.sql
pruefe "Kollision mit Umlaut im Namen rot" 1 "$(lauf "$r")"
enthaelt "Umlaut-Datei wird im Klartext genannt" "0003_größe.sql"

# 16 — Reparatur einer Doppelung auf alpha (LLH-2030-Fenster, 25.11.2026 zweimal 0381): zwei
# PRs mergten kurz nacheinander dieselbe Nummer. Der Reparatur-Branch legt EINE der beiden
# hinter alpha; das ist kein Umbenennen einer eingespielten Migration, denn mit doppelter
# Nummer startet kein Server, und ohne diese Ausnahme bliebe der Pflicht-Status rot.
doppelt_auf_alpha() { # <name> — alpha mit 0003_x und 0003_y, feature zweigt danach ab
  local r
  r="$(repo_neu "$1")"
  datei "$r" alpha migrations/0003_x.sql > /dev/null
  datei "$r" alpha migrations/0003_y.sql > /dev/null
  git -C "$r" branch -f feature alpha
  printf '%s\n' "$r"
}
r="$(doppelt_auf_alpha doppel_reparatur)"
git -C "$r" checkout -q feature
git -C "$r" mv migrations/0003_y.sql migrations/0004_y.sql
git -C "$r" commit -q -m umlegen
pruefe "Doppelung auf alpha aufgelöst grün" 0 "$(lauf "$r")"
enthaelt "Auflösung nennt die umgelegte Datei" "0003_y.sql"

# 17 — Die Ausnahme gilt nur, solange die Nummer danach genau einmal bleibt: beide Dateien
# wegzunehmen löscht eine Migration, die eine DB schon eingespielt haben kann.
r="$(doppelt_auf_alpha doppel_beide)"
git -C "$r" checkout -q feature
git -C "$r" mv migrations/0003_x.sql migrations/0004_x.sql
git -C "$r" mv migrations/0003_y.sql migrations/0005_y.sql
git -C "$r" commit -q -m beide
pruefe "beide Dateien einer Doppelung umgelegt rot" 1 "$(lauf "$r")"

# 18 — Bleibt die Nummer danach doppelt (hier lag sie dreifach), ist das Umlegen keine
# Auflösung.
r="$(doppelt_auf_alpha doppel_bleibt)"
datei "$r" alpha migrations/0003_z.sql > /dev/null
git -C "$r" branch -f feature alpha
git -C "$r" checkout -q feature
git -C "$r" mv migrations/0003_y.sql migrations/0004_y.sql
git -C "$r" commit -q -m bleibt
pruefe "Doppelung nicht aufgelöst rot" 1 "$(lauf "$r")"

# 19 — Eine einmalige Bestands-Nummer bleibt unantastbar, auch neben einer Doppelung.
r="$(doppelt_auf_alpha doppel_fremd)"
git -C "$r" checkout -q feature
git -C "$r" mv migrations/0002_b.sql migrations/0004_b.sql
git -C "$r" commit -q -m fremd
pruefe "einmalige Bestands-Migration umgelegt rot" 1 "$(lauf "$r")"

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
