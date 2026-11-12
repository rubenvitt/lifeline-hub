#!/usr/bin/env bash
# Selbsttest für scripts/nur-umnummeriert.sh (LLH-1660). Das Skript entscheidet, ob ein PR ohne
# Rust-, Frontend- und e2e-Suite mergen darf. Irrt es zur einen Seite, mergt Ungeprüftes; zur
# anderen kostet jede Umnummerierung wieder eine Stunde. Beide Richtungen stehen hier.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
SKRIPT_UNTER_TEST="$SKRIPTE/nur-umnummeriert.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
TRAILER="Migrationsnummern-Autofix: LFH-1014"

repo_neu() {
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad/migrations" "$pfad/src"
  git -C "$pfad" init -q -b feature
  git -C "$pfad" config user.email test@example.invalid
  git -C "$pfad" config user.name Test
  git -C "$pfad" config commit.gpgsign false
  echo "CREATE TABLE a (id INTEGER);" > "$pfad/migrations/0001_a.sql"
  echo "CREATE TABLE b (id INTEGER, name TEXT);" > "$pfad/migrations/0002_b.sql"
  echo 'const M: &str = include_str!("../migrations/0002_b.sql");' > "$pfad/src/x.rs"
  git -C "$pfad" add -A
  git -C "$pfad" commit -q -m arbeit
  printf '%s\n' "$pfad"
}

commit() { # <repo> <nachricht> [trailer]
  git -C "$1" add -A
  if [ -n "${3:-}" ]; then
    git -C "$1" commit -q -m "$2" -m "$3"
  else
    git -C "$1" commit -q -m "$2"
  fi
}

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

vorg() { ( cd "$1" && "$SKRIPT_UNTER_TEST" vorgaenger HEAD ); }
kurz() { git -C "$1" rev-parse "$2"; }

echo "==> nur-umnummeriert: Vorgänger"

# 1 — Ein Autofix-Commit, der nur umbenennt: der Commit davor gilt.
r="$(repo_neu einer)"
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
commit "$r" "fix(migrationen): Nummern über alpha legen" "$TRAILER"
pruefe "1 ein Autofix nennt den Commit davor" "$(kurz "$r" HEAD~1)" "$(vorg "$r")"

# 2 — Zwei Autofixes nacheinander: der Commit vor beiden gilt.
git -C "$r" mv migrations/0005_b.sql migrations/0007_b.sql
commit "$r" "fix(migrationen): Nummern über alpha legen" "$TRAILER"
pruefe "2 zwei Autofixes nennen den Commit davor" "$(kurz "$r" HEAD~2)" "$(vorg "$r")"

# 3 — Kopf ohne Trailer: nichts.
r="$(repo_neu ohnetrailer)"
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
commit "$r" "von Hand umbenannt"
pruefe "3 ohne Trailer nichts" "" "$(vorg "$r")"

# 4 — Autofix zieht einen Verweis im Code mit: den liest die Rust-Suite, also nichts.
r="$(repo_neu verweis)"
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
echo 'const M: &str = include_str!("../migrations/0005_b.sql");' > "$r/src/x.rs"
commit "$r" "fix(migrationen): Nummern über alpha legen" "$TRAILER"
pruefe "4 mitgezogener Verweis im Code nichts" "" "$(vorg "$r")"

# 4b — Autofix zieht einen Verweis in der Doku mit: keine Suite liest ihn, der Vorgänger gilt
# (so geschehen an #1286 am 12.11.2026: Glossar nennt den Dateinamen).
r="$(repo_neu doku)"
mkdir -p "$r/docs/architektur"
echo "siehe migrations/0002_b.sql" > "$r/docs/architektur/12-glossar.md"
commit "$r" doku
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
echo "siehe migrations/0005_b.sql" > "$r/docs/architektur/12-glossar.md"
commit "$r" "fix(migrationen): Nummern über alpha legen" "$TRAILER"
pruefe "4b mitgezogener Verweis in der Doku gilt" "$(kurz "$r" HEAD~1)" "$(vorg "$r")"

# 4c — Trailer gefälscht, nur Doku geändert, keine Migration umbenannt: nichts.
r="$(repo_neu nurdoku)"
echo "text" > "$r/NOTIZ.md"
commit "$r" "harmlos" "$TRAILER"
pruefe "4c nur Doku ohne Umbenennung nichts" "" "$(vorg "$r")"

# 5 — Trailer gefälscht, Inhalt geändert: nichts.
r="$(repo_neu gefaelscht)"
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
echo "DROP TABLE b;" >> "$r/migrations/0005_b.sql"
commit "$r" "harmlos" "$TRAILER"
pruefe "5 Umbenennung mit Inhaltsänderung nichts" "" "$(vorg "$r")"

# 6 — Trailer gefälscht, Code geändert, keine Migration berührt: nichts.
r="$(repo_neu code)"
echo "fn boese() {}" >> "$r/src/x.rs"
commit "$r" "harmlos" "$TRAILER"
pruefe "6 Codeänderung mit Trailer nichts" "" "$(vorg "$r")"

# 7 — Umbenennung aus `migrations/` heraus: nichts.
r="$(repo_neu heraus)"
git -C "$r" mv migrations/0002_b.sql src/0002_b.sql
commit "$r" "verschoben" "$TRAILER"
pruefe "7 Umbenennung aus migrations heraus nichts" "" "$(vorg "$r")"

# 8 — Merge-Commit mit Trailer, dessen Diff zum ersten Elternteil nur eine Umbenennung ist: nichts.
# Was der zweite Elternteil sonst mitbringt, zeigte nur ein Blick auf beide Eltern.
r="$(repo_neu merge)"
git -C "$r" checkout -q -b seite
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
commit "$r" seite
git -C "$r" checkout -q feature
git -C "$r" merge -q --no-ff seite -m "merge" -m "$TRAILER"
pruefe "8 Merge-Commit nichts" "" "$(vorg "$r")"

# 9 — Kette länger als erlaubt: nichts.
r="$(repo_neu kette)"
alt=0002
for neu in 0011 0012 0013 0014 0015 0016; do
  git -C "$r" mv "migrations/${alt}_b.sql" "migrations/${neu}_b.sql"
  commit "$r" "fix(migrationen): $neu" "$TRAILER"
  alt="$neu"
done
pruefe "9 sechs Autofixes nacheinander nichts" "" "$(vorg "$r")"

# 10 — Neue Datei unter migrations/ mit Trailer (kein Rename): nichts.
r="$(repo_neu neu)"
echo "CREATE TABLE c (id INTEGER);" > "$r/migrations/0003_c.sql"
commit "$r" "neu" "$TRAILER"
pruefe "10 neue Migration mit Trailer nichts" "" "$(vorg "$r")"

echo "==> nur-umnummeriert: grün am Vorgänger"

laeufe() { # Zeilen "<name>|<status>|<conclusion>" → JSON wie von der API
  local id=100
  printf '{"check_runs":['
  local erst=1 name status ergebnis
  while IFS='|' read -r name status ergebnis; do
    [ -n "$name" ] || continue
    [ "$erst" = 1 ] || printf ','
    erst=0
    id=$((id + 1))
    if [ "$ergebnis" = null ]; then
      printf '{"id":%d,"name":"%s","status":"%s","conclusion":null}' "$id" "$name" "$status"
    else
      printf '{"id":%d,"name":"%s","status":"%s","conclusion":"%s"}' "$id" "$name" "$status" "$ergebnis"
    fi
  done
  printf ']}\n'
}
alle_gruen() {
  "$SKRIPT_UNTER_TEST" checks | sed 's/$/|completed|success/'
  echo "Schnellprüfungen|completed|failure" # zählt nicht zu den schweren
}
gruen_code() { local code=0; "$SKRIPT_UNTER_TEST" gruen > /dev/null 2>&1 || code=$?; printf '%s\n' "$code"; }

pruefe "11 alle grün" 0 "$(alle_gruen | laeufe | gruen_code)"
pruefe "12 einer rot" 1 "$(alle_gruen | sed 's#^e2e 3/4|completed|success#e2e 3/4|completed|failure#' | laeufe | gruen_code)"
pruefe "13 einer fehlt" 1 "$(alle_gruen | grep -v '^Frontend-Suite 2/4' | laeufe | gruen_code)"
pruefe "14 einer übersprungen gilt" 0 "$(alle_gruen | sed 's#^Rust-Suite|completed|success#Rust-Suite|completed|skipped#' | laeufe | gruen_code)"
pruefe "15 einer läuft noch" 1 "$(alle_gruen | sed 's#^e2e 1/4|completed|success#e2e 1/4|in_progress|null#' | laeufe | gruen_code)"
pruefe "16 einer abgebrochen" 1 "$(alle_gruen | sed 's#^Rust-Suite|completed|success#Rust-Suite|completed|cancelled#' | laeufe | gruen_code)"
# Der jüngste Lauf je Name zählt: erst rot, dann neu gestartet und grün.
pruefe "17 neu gestartet und grün gilt" 0 "$( { echo 'e2e 2/4|completed|failure'; alle_gruen; } | laeufe | gruen_code)"
pruefe "18 erst grün, dann rot gilt nicht" 1 "$( { alle_gruen; echo 'e2e 2/4|completed|failure'; } | laeufe | gruen_code)"
# Zwei Seiten der API hintereinander (`--paginate`).
pruefe "19 zwei Seiten" 0 "$( { alle_gruen | head -4 | laeufe; alle_gruen | tail -n +5 | laeufe; } | gruen_code)"
pruefe "20 leere Antwort" 1 "$(echo '{"check_runs":[]}' | gruen_code)"

echo "==> nur-umnummeriert: Namen passen zu ci.yml"
# Jeder schwere Check muss als Jobname in ci.yml stehen (Matrix-Namen mit ihrem Platzhalter).
ci="$SKRIPTE/../.github/workflows/ci.yml"
while IFS= read -r name; do
  muster="$(printf '%s' "$name" | sed -E 's#[0-9]+/4$#${{ matrix.shard }}/4#')"
  if grep -qF -- "name: $muster" "$ci"; then
    echo "  ok   ci.yml kennt '$name'"
  else
    echo "  FEHL ci.yml kennt keinen Job 'name: $muster'" >&2
    fehler=$((fehler + 1))
  fi
done < <("$SKRIPT_UNTER_TEST" checks)
# Und umgekehrt: die Anteile in ci.yml sind vier, wie die Liste annimmt.
anteile="$(grep -c 'shard: \[1, 2, 3, 4\]' "$ci" || true)"
pruefe "ci.yml teilt Frontend und e2e in je vier Anteile" 2 "$anteile"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest nur-umnummeriert." >&2
  exit 1
fi
echo "==> OK: Selbsttest nur-umnummeriert."
