#!/usr/bin/env bash
# Selbsttest für scripts/release/kanal-nachziehen.sh (LLH-1545).
#
# Das Nachziehen schreibt auf `beta`, und ein Fehler fiele erst beim nächsten Beta-Release auf:
# ein Konflikt, der still aufgelöst wird, eine Abhängigkeit aus Cargo.toml, die unterwegs
# verloren geht, oder eine Alpha-Version, die auf `beta` landet. Gefahren gegen echte
# Repositories im Temp-Verzeichnis; die Versions-Commits von semantic-release werden von Hand
# nachgestellt (gleiche Dateien, gleiche Zeilen wie `prepareCmd` in release.config.mjs).
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/kanal-nachziehen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# Unabhängig von der Git-Konfiguration des Rechners (Signatur, Push-Aushandlung).
export GIT_CONFIG_COUNT=3
export GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false
export GIT_CONFIG_KEY_1=tag.gpgsign GIT_CONFIG_VALUE_1=false
export GIT_CONFIG_KEY_2=push.negotiate GIT_CONFIG_VALUE_2=false
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.invalid
unset GITHUB_OUTPUT

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

# Ein Remote (bare) und ein Arbeitsklon mit den Dateien, die der Versions-Commit anfasst.
REMOTE="$ARBEIT/remote.git"
KLON="$ARBEIT/klon"
git init -q --bare -b alpha "$REMOTE"
git init -q -b alpha "$KLON"
git -C "$KLON" remote add origin "$REMOTE"
mkdir -p "$KLON/frontend" "$KLON/src"
cat > "$KLON/Cargo.toml" <<'EOF'
[package]
name = "lifeline-hub"
version.workspace = true

[dependencies]
foo = "1"

[workspace.package]
version = "0.0.0"
EOF
cat > "$KLON/Cargo.lock" <<'EOF'
[[package]]
name = "foo"
version = "1.0.0"

[[package]]
name = "lifeline-desktop"
version = "0.0.0"

[[package]]
name = "lifeline-hub"
version = "0.0.0"
EOF
cat > "$KLON/frontend/package.json" <<'EOF'
{
  "name": "frontend",
  "version": "0.0.0",
  "private": true
}
EOF
printf '# Changelog\n' > "$KLON/CHANGELOG.md"
printf 'zeile eins\nzeile zwei\n' > "$KLON/src/code.txt"
git -C "$KLON" add -A
git -C "$KLON" commit -q -m "chore: anfang"

# Stellt den Versions-Commit von semantic-release nach: Version in den drei Dateien, Eintrag
# oben im CHANGELOG, Tag, Push. Arbeitet auf dem ausgecheckten Branch.
release() { # <version>
  local v="$1" alt
  alt="$(awk '/^\[workspace.package\]/{im=1} im && /^version/{gsub(/.*= "|"/,""); print; exit}' "$KLON/Cargo.toml")"
  sed -i "s/^version = \"$alt\"$/version = \"$v\"/" "$KLON/Cargo.toml" "$KLON/Cargo.lock"
  sed -i "s/^  \"version\": \"$alt\",$/  \"version\": \"$v\",/" "$KLON/frontend/package.json"
  { printf '# Changelog\n\n## %s\n' "$v"; tail -n +2 "$KLON/CHANGELOG.md"; } > "$KLON/CHANGELOG.neu"
  mv "$KLON/CHANGELOG.neu" "$KLON/CHANGELOG.md"
  git -C "$KLON" commit -q -am "chore(release): $v [skip ci]"
  git -C "$KLON" tag "v$v"
  git -C "$KLON" push -q origin HEAD "v$v"
}

lauf() { # <tag> [weitere Angaben] → Ausgabe; Exit-Code nach $LAUF_RC
  LAUF_RC=0
  git -C "$KLON" fetch -q --tags origin
  ( cd "$KLON" && "$SKRIPT_UNTER_TEST" --tag "$@" 2>/dev/null ) || LAUF_RC=$?
}

remote_datei() { git --git-dir="$REMOTE" show "beta:$1"; }
remote_beta() { git --git-dir="$REMOTE" rev-parse -q --verify refs/heads/beta || echo keiner; }

echo "==> Kanal-nachziehen-Selbsttest"

release 1.0.0-alpha.1
printf 'zeile eins\nzeile zwei geändert\n' > "$KLON/src/code.txt"
git -C "$KLON" commit -q -am "fix: zwei"
release 1.0.0-alpha.2

# 1 — Unzulässige Angaben brechen ab, bevor irgendetwas geschrieben wird.
lauf v1.0.0-beta.1 > /dev/null; pruefe "Beta-Tag als Quelle abgelehnt" 1 "$LAUF_RC"
lauf 'v1.0.0-alpha.2; rm -rf /' > /dev/null; pruefe "freie Eingabe abgelehnt" 1 "$LAUF_RC"
lauf v1.0.0-alpha.99 > /dev/null; pruefe "unbekannter Tag abgelehnt" 1 "$LAUF_RC"
lauf v1.0.0-alpha.2 --ziel main > /dev/null; pruefe "Ziel main abgelehnt" 1 "$LAUF_RC"
pruefe "nichts geschrieben" keiner "$(remote_beta)"

# 2 — Erstes Mal: beta entsteht genau auf dem Tag.
pruefe "beta angelegt" "ergebnis=angelegt" "$(lauf v1.0.0-alpha.2)"
pruefe "beta steht auf alpha.2" "$(git -C "$KLON" rev-parse 'v1.0.0-alpha.2^{commit}')" "$(remote_beta)"

# 3 — Derselbe Tag noch einmal: nichts zu tun.
pruefe "derselbe Tag ist aktuell" "ergebnis=aktuell" "$(lauf v1.0.0-alpha.2)"

# Die erste Beta (Versions-Commit auf beta), danach geht alpha weiter: Code, eine Abhängigkeit
# in Cargo.toml und ein Alpha-Release.
git -C "$KLON" fetch -q origin
git -C "$KLON" checkout -q -b beta origin/beta
release 1.0.0-beta.1
git -C "$KLON" checkout -q alpha
printf 'zeile eins neu\nzeile zwei geändert\n' > "$KLON/src/code.txt"
sed -i 's/^foo = "1"$/foo = "2"/' "$KLON/Cargo.toml"
git -C "$KLON" commit -q -am "feat: eins, foo 2"
release 1.0.0-alpha.3

# 4 — Ohne Angleich-Commit hätte der Merge Konflikte (das ist der Grund für das Skript).
git -C "$KLON" fetch -q origin
naiv="$(git -C "$KLON" merge-tree --write-tree origin/beta v1.0.0-alpha.3 > /dev/null 2>&1 && echo sauber || echo konflikt)"
pruefe "naiver Merge alpha.3 → beta hätte Konflikte" konflikt "$naiv"

# 5 — --ohne-push schreibt nichts.
vorher="$(remote_beta)"
lauf v1.0.0-alpha.3 --ohne-push > /dev/null
pruefe "--ohne-push lässt beta stehen" "$vorher" "$(remote_beta)"

# 6 — Nachziehen: Code und Abhängigkeit kommen an, Version und CHANGELOG bleiben die der Beta.
pruefe "alpha.3 nachgezogen" "ergebnis=nachgezogen" "$(lauf v1.0.0-alpha.3)"
pruefe "Code aus alpha.3 ist auf beta" "zeile eins neu" "$(remote_datei src/code.txt | head -1)"
pruefe "Abhängigkeit aus alpha.3 ist auf beta" 'foo = "2"' "$(remote_datei Cargo.toml | grep '^foo')"
pruefe "Workspace-Version bleibt beta.1" 1 "$(remote_datei Cargo.toml | grep -c '^version = "1.0.0-beta.1"$')"
pruefe "Lockfile trägt beta.1 für beide Crates" 2 "$(remote_datei Cargo.lock | grep -c '^version = "1.0.0-beta.1"$')"
pruefe "Fremde Crate im Lockfile unberührt" 1 "$(remote_datei Cargo.lock | grep -c '^version = "1.0.0"$')"
pruefe "Frontend-Version bleibt beta.1" 1 "$(remote_datei frontend/package.json | grep -c '"version": "1.0.0-beta.1"')"
pruefe "keine Alpha-Version auf beta" 0 "$(remote_datei Cargo.toml | grep -c alpha || true)"
pruefe "CHANGELOG von beta" "## 1.0.0-beta.1" "$(remote_datei CHANGELOG.md | sed -n 3p)"
pruefe "Merge-Commit mit zwei Eltern" 2 "$(git --git-dir="$REMOTE" log -1 --format=%p beta | wc -w)"
pruefe "alpha.3 ist jetzt in beta enthalten" ja \
  "$(git --git-dir="$REMOTE" merge-base --is-ancestor v1.0.0-alpha.3 beta && echo ja || echo nein)"

# 7 — Ein älterer Tag nach einem neueren: nichts zu tun.
pruefe "älterer Tag ist aktuell" "ergebnis=aktuell" "$(lauf v1.0.0-alpha.2)"

# 8 — Zweite Runde nach einer weiteren Beta: wieder ohne Konflikt.
git -C "$KLON" checkout -q beta
git -C "$KLON" pull -q --ff-only origin beta
release 1.0.0-beta.2
git -C "$KLON" checkout -q alpha
echo "zeile drei" >> "$KLON/src/code.txt"
git -C "$KLON" commit -q -am "feat: drei"
release 1.0.0-alpha.4
pruefe "alpha.4 nachgezogen" "ergebnis=nachgezogen" "$(lauf v1.0.0-alpha.4)"
pruefe "Version bleibt beta.2" 1 "$(remote_datei Cargo.toml | grep -c '^version = "1.0.0-beta.2"$')"

# 9 — Direkt auf beta gearbeitet und dieselbe Zeile auf alpha geändert: echter Konflikt,
# Abbruch, beta bleibt unverändert.
git -C "$KLON" checkout -q beta
git -C "$KLON" pull -q --ff-only origin beta
sed -i 's/^zeile drei$/zeile drei auf beta/' "$KLON/src/code.txt"
git -C "$KLON" commit -q -am "fix: direkt auf beta"
git -C "$KLON" push -q origin beta
git -C "$KLON" checkout -q alpha
sed -i 's/^zeile drei$/zeile drei auf alpha/' "$KLON/src/code.txt"
git -C "$KLON" commit -q -am "fix: drei"
release 1.0.0-alpha.5
vorher="$(remote_beta)"
lauf v1.0.0-alpha.5 > /dev/null
pruefe "echter Konflikt bricht ab" 1 "$LAUF_RC"
pruefe "beta bleibt nach dem Konflikt stehen" "$vorher" "$(remote_beta)"
pruefe "kein Arbeitsverzeichnis bleibt hängen" 1 "$(git -C "$KLON" worktree list | wc -l)"

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fall/Fälle rot." >&2
  exit 1
fi
echo "==> alle Fälle grün."
