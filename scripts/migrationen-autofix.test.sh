#!/usr/bin/env bash
# Selbsttest für scripts/migrationen-autofix.sh (LFH-1014). Der Autofix pusht mit einem Token,
# das auf `alpha` Bypass-Rechte hat. Irrt er, überschreibt er fremde Commits oder schreibt auf
# einen Ziel-Branch; irrt er in die andere Richtung, bleibt jeder kollidierende PR rot.
#
# Gefahren gegen echte Repositories im Temp-Verzeichnis, mit einem Bare-Repo als `origin`:
# die Aussagen hängen am Push (Fast-Forward oder nicht), dort liegen die Fallen (Fall 4).
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/migrationen-autofix.sh"
PRUEFER="$(cd "$(dirname "$0")" && pwd)/check-migrationen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
TRAILER="Migrationsnummern-Autofix: LFH-1014"

# Ein Remote (bare) mit `alpha` und `feature` und ein Klon davon, wie ihn der Workflow hat.
# Ausgabe: Pfad des Klons; das Remote liegt daneben unter <name>.git.
repo_neu() {
  local quelle="$ARBEIT/$1-quelle" klon="$ARBEIT/$1"
  mkdir -p "$quelle/migrations"
  git -C "$quelle" init -q -b alpha
  einrichten "$quelle"
  echo "CREATE TABLE a (id INTEGER);" > "$quelle/migrations/0001_a.sql"
  echo "CREATE TABLE b (id INTEGER);" > "$quelle/migrations/0002_b.sql"
  git -C "$quelle" add -A
  git -C "$quelle" commit -q -m basis
  git -C "$quelle" branch feature
  git clone -q --bare "$quelle" "$ARBEIT/$1.git"
  git clone -q "$ARBEIT/$1.git" "$klon"
  einrichten "$klon"
  git -C "$klon" checkout -q alpha
  printf '%s\n' "$klon"
}

einrichten() {
  git -C "$1" config user.email test@example.invalid
  git -C "$1" config user.name Test
  git -C "$1" config commit.gpgsign false
}

# Legt im Klon auf <branch> eine Datei an, committet und pusht den Branch ins Remote.
datei() { # <klon> <branch> <pfad> [<inhalt>]
  local klon="$1" branch="$2" pfad="$3" inhalt="${4:--- inhalt $RANDOM$RANDOM}"
  local vorher
  vorher="$(git -C "$klon" rev-parse --abbrev-ref HEAD)"
  git -C "$klon" checkout -q -B "$branch" "origin/$branch"
  mkdir -p "$(dirname "$klon/$pfad")"
  printf '%s\n' "$inhalt" >> "$klon/$pfad"
  git -C "$klon" add -A
  git -C "$klon" commit -q -m "$pfad"
  git -C "$klon" push -q origin "$branch"
  git -C "$klon" checkout -q "$vorher"
}

# Ein Commit auf <branch>, der wie ein früherer Autofix aussieht.
autofix_commit() { # <klon> <branch> <nr>
  local klon="$1" branch="$2"
  git -C "$klon" checkout -q -B "$branch" "origin/$branch"
  echo "-- $3" >> "$klon/notiz.txt"
  git -C "$klon" add -A
  git -C "$klon" commit -q -m "fix(migrationen): früher $3" -m "$TRAILER"
  git -C "$klon" push -q origin "$branch"
  git -C "$klon" checkout -q alpha
}

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

enthaelt() { # <name> <datei> <text>
  if grep -qF -- "$3" "$2" 2> /dev/null; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — '$3' fehlt in $2:" >&2
    sed 's/^/         /' "$2" >&2 2> /dev/null || true
    sed 's/^/   out   /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}

remote_kopf() { git -C "$ARBEIT/$1.git" rev-parse "refs/heads/$2"; }

# Ruft den Autofix wie der Workflow: frisch geholt, Basis `origin/alpha`, Kopf als SHA.
lauf() { # <klon> <kopf-branch> <kopf-sha>
  local code=0
  git -C "$1" fetch -q origin
  ( cd "$1" && AUTOFIX_BERICHT="$ARBEIT/bericht.md" \
      "$SKRIPT_UNTER_TEST" origin/alpha "$2" "$3" ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
  printf '%s\n' "$code"
}

echo "==> Migrationsnummern-Autofix-Selbsttest"

# 1 — Der Normalfall: auf alpha ist inzwischen dieselbe Nummer gemergt. Der Autofix legt die
# eigene Migration dahinter, zieht den Verweis mit und pusht als Fast-Forward.
r="$(repo_neu kollision)"
datei "$r" feature migrations/0003_eigen.sql "CREATE TABLE eigen (id INTEGER);"
datei "$r" feature src/db.rs 'const M: &str = include_str!("../migrations/0003_eigen.sql");
fn migration_0003_eigen() {}'
datei "$r" alpha migrations/0003_fremd.sql
vorher="$(remote_kopf kollision feature)"
rm -f "$ARBEIT/bericht.md"
pruefe "Kollision wird behoben (Exit 0)" 0 "$(lauf "$r" feature "$vorher")"
nachher="$(remote_kopf kollision feature)"
pruefe "Autofix-Commit sitzt direkt auf dem geprüften Kopf" "$vorher" \
  "$(git -C "$ARBEIT/kollision.git" rev-parse "$nachher^" 2> /dev/null || echo keiner)"
pruefe "Autofix-Commit trägt den Trailer" "LFH-1014" \
  "$(git -C "$ARBEIT/kollision.git" log -1 --format='%(trailers:key=Migrationsnummern-Autofix,valueonly)' "$nachher" | tr -d '\n')"
pruefe "Migration liegt auf 0004, mit ihrem Inhalt" "CREATE TABLE eigen (id INTEGER);" \
  "$(git -C "$ARBEIT/kollision.git" show "$nachher:migrations/0004_eigen.sql" 2> /dev/null || echo fehlt)"
pruefe "Verweis ist nachgezogen" 'const M: &str = include_str!("../migrations/0004_eigen.sql");' \
  "$(git -C "$ARBEIT/kollision.git" show "$nachher:src/db.rs" | head -1)"
code=0
git -C "$r" fetch -q origin
( cd "$r" && "$PRUEFER" origin/alpha "$nachher" ) > /dev/null 2>&1 || code=$?
pruefe "Folgeprüfung auf dem neuen Kopf grün" 0 "$code"
enthaelt "Bericht nennt die Umbenennung" "$ARBEIT/bericht.md" "0003_eigen.sql\` → \`0004_eigen.sql"
enthaelt "Bericht nennt den Bezeichner mit alter Nummer" "$ARBEIT/bericht.md" "migration_0003_eigen"
enthaelt "Bericht erinnert ans Pullen" "$ARBEIT/bericht.md" "git pull"
pruefe "Arbeitsbaum des Aufrufers unberührt" "alpha sauber" \
  "$(git -C "$r" rev-parse --abbrev-ref HEAD) $([ -z "$(git -C "$r" status --porcelain)" ] && echo sauber || echo schmutzig)"
pruefe "kein Arbeitsbaum bleibt zurück" 1 "$(git -C "$r" worktree list | wc -l | tr -d ' ')"

# 2 — Nichts zu tun: die eigene Migration liegt schon hinter alpha.
r="$(repo_neu nichts)"
datei "$r" feature migrations/0003_eigen.sql
vorher="$(remote_kopf nichts feature)"
pruefe "ohne Kollision Exit 5" 5 "$(lauf "$r" feature "$vorher")"
pruefe "ohne Kollision kein Push" "$vorher" "$(remote_kopf nichts feature)"

# 3 — Eine geänderte Bestands-Migration lässt sich nicht wegnummerieren.
r="$(repo_neu bestand)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" feature migrations/0002_b.sql "-- geändert"
datei "$r" alpha migrations/0003_fremd.sql
vorher="$(remote_kopf bestand feature)"
pruefe "geänderte Bestands-Migration Exit 1" 1 "$(lauf "$r" feature "$vorher")"
pruefe "geänderte Bestands-Migration kein Push" "$vorher" "$(remote_kopf bestand feature)"

# 4 — Die FALLE: zwischen Prüfung und Push kommt ein fremder Commit auf den Branch. Der Autofix
# darf ihn nicht überschreiben; der neue Commit wird von seinem eigenen Lauf bewertet.
r="$(repo_neu bewegt)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
geprueft="$(remote_kopf bewegt feature)"
datei "$r" feature src/neu.rs
fremd="$(remote_kopf bewegt feature)"
pruefe "bewegter Branch Exit 4" 4 "$(lauf "$r" feature "$geprueft")"
pruefe "bewegter Branch bleibt auf dem fremden Commit" "$fremd" "$(remote_kopf bewegt feature)"

# 5 — Nie auf einen Ziel-Branch, gleich was der Aufrufer übergibt.
for ziel in alpha beta main; do
  r="$(repo_neu "ziel-$ziel")"
  datei "$r" feature migrations/0003_eigen.sql
  datei "$r" alpha migrations/0003_fremd.sql
  vorher="$(remote_kopf "ziel-$ziel" alpha)"
  pruefe "Kopf-Branch '$ziel' Exit 3" 3 "$(lauf "$r" "$ziel" "$(remote_kopf "ziel-$ziel" feature)")"
  pruefe "Kopf-Branch '$ziel': alpha unverändert" "$vorher" "$(remote_kopf "ziel-$ziel" alpha)"
done

# 6 — Schleifenbremse: drei Autofix-Commits in Folge an der Spitze, dann setzt er aus.
r="$(repo_neu schleife)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
autofix_commit "$r" feature 1
autofix_commit "$r" feature 2
autofix_commit "$r" feature 3
vorher="$(remote_kopf schleife feature)"
pruefe "drei Autofixes in Folge Exit 3" 3 "$(lauf "$r" feature "$vorher")"
pruefe "drei Autofixes in Folge kein Push" "$vorher" "$(remote_kopf schleife feature)"

# 7 — Die Grenze darunter: zwei Autofixes in Folge halten ihn nicht auf.
r="$(repo_neu zwei)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
autofix_commit "$r" feature 1
autofix_commit "$r" feature 2
pruefe "zwei Autofixes in Folge: dritter läuft (Exit 0)" 0 \
  "$(lauf "$r" feature "$(remote_kopf zwei feature)")"

# 8 — Das Remote lehnt ab, obwohl der Branch noch steht (etwa 403, weil der falsche Token
# pushte; so geschehen an der Probe #409). Das ist kein bewegter Branch, sondern ein Fehler,
# und die Meldung darf nicht auf „bewegt" lenken.
r="$(repo_neu verweigert)"
datei "$r" feature migrations/0003_eigen.sql
datei "$r" alpha migrations/0003_fremd.sql
printf '#!/bin/sh\necho "Zugriff verweigert" >&2\nexit 1\n' > "$ARBEIT/verweigert.git/hooks/pre-receive"
chmod +x "$ARBEIT/verweigert.git/hooks/pre-receive"
vorher="$(remote_kopf verweigert feature)"
pruefe "abgelehnter Push bei stehendem Branch Exit 2" 2 "$(lauf "$r" feature "$vorher")"
pruefe "abgelehnter Push: Branch unverändert" "$vorher" "$(remote_kopf verweigert feature)"
enthaelt "abgelehnter Push wird als Fehler gemeldet" "$ARBEIT/ausgabe" "Push fehlgeschlagen"

# 9 — Ein Kopf-SHA, den es nicht gibt, ist ein Aufruffehler.
r="$(repo_neu aufruf)"
pruefe "unbekannter Kopf Exit 2" 2 "$(lauf "$r" feature 0123456789abcdef0123456789abcdef01234567)"

echo
if [ "$fehler" -eq 0 ]; then
  echo "==> OK: Migrationsnummern-Autofix grün."
else
  echo "==> FEHLER: $fehler Zusicherung(en) verletzt." >&2
  exit 1
fi
