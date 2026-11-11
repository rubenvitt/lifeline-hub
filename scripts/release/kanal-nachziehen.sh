#!/usr/bin/env bash
# Kanal nachziehen (LLH-1545): bringt einen veröffentlichten Alpha-Stand nach `beta`.
#
#   scripts/release/kanal-nachziehen.sh --tag v1.0.0-alpha.180 [--ziel beta] [--remote origin]
#                                       [--ohne-push]
#
# Aufgerufen vom Workflow `.github/workflows/kanal-nachziehen.yml`; der Selbsttest
# (`kanal-nachziehen.test.sh`) läuft in Schritt 8 von `scripts/check-all.sh`. Erwartet einen
# Checkout mit voller Historie, den Tags und dem aktuellen Stand von `<remote>/<ziel>`.
#
# WARUM KEIN EINFACHER MERGE: semantic-release legt auf jedem Kanal einen eigenen
# Versions-Commit an (`Cargo.toml`, `Cargo.lock`, `frontend/package.json`, `CHANGELOG.md`). Nach
# der ersten Beta haben `alpha` und `beta` diese Zeilen also beide geändert, und jeder Merge
# `alpha → beta` hätte dort Konflikte; ein Push von `alpha` auf `beta` ist kein Fast-Forward
# mehr. Deshalb entsteht zuerst ein Hilfs-Commit auf dem Alpha-Tag, der genau diese Stellen auf
# den Stand des Ziels setzt (Version und CHANGELOG des Ziels), und erst dieser wird in das Ziel
# gemergt. Beide Seiten tragen dann dieselben Zeilen, Git sieht keinen Konflikt, und alles andere
# (Code, Abhängigkeiten in denselben Dateien) kommt unverändert an. Die Version setzt danach
# semantic-release beim Release auf dem Ziel (`1.0.0-beta.N`).
#
# CHANGELOG des Ziels: führt die Releases des Ziels. Die Notizen jeder Beta zählen ohnehin alle
# Alpha-Commits seit der vorigen Beta auf.
#
# Auf `beta` wird nicht entwickelt: ein Fehler wird auf `alpha` behoben und mit dem nächsten
# Alpha-Tag nachgezogen. Deshalb muss nie etwas von `beta` zurück nach `alpha`.
#
# Ausgabe auf stdout: `ergebnis=angelegt|nachgezogen|aktuell`, zusätzlich nach $GITHUB_OUTPUT,
# wenn gesetzt. Exit 1 bei einem unzulässigen Tag oder einem echten Konflikt (dann bleibt das
# Ziel unverändert).
set -euo pipefail

TAG=""
ZIEL="beta"
REMOTE="origin"
PUSHEN=true

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    --ziel) ZIEL="${2:-}"; shift 2 ;;
    --remote) REMOTE="${2:-}"; shift 2 ;;
    --ohne-push) PUSHEN=false; shift ;;
    *) echo "FEHLER: unbekannte Angabe '$1'." >&2; exit 2 ;;
  esac
done

melde() { echo "$*" >&2; }

ergebnis() {
  echo "ergebnis=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "ergebnis=$1" >> "$GITHUB_OUTPUT"; fi
}

# Nur `beta` heute. `main` (stabil) hat dasselbe Versions-Commit-Problem und kommt mit eigener
# Aufgabe dazu; dann wird hier die zulässige Quelle je Ziel festgelegt.
if [ "$ZIEL" != "beta" ]; then
  melde "FEHLER: Ziel '$ZIEL' wird nicht unterstützt (nur 'beta')."
  exit 1
fi

# Quelle ist immer ein Alpha-Tag: ein erprobter, veröffentlichter Stand, nicht „was gerade auf
# alpha liegt“. Muster vor jeder Verwendung prüfen, der Tag ist im Workflow freie Eingabe.
if ! printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+$'; then
  melde "FEHLER: '$TAG' ist kein Alpha-Tag (erwartet: vX.Y.Z-alpha.N)."
  exit 1
fi
if ! QUELLE="$(git rev-parse -q --verify "refs/tags/$TAG^{commit}")"; then
  melde "FEHLER: Tag '$TAG' gibt es in diesem Checkout nicht."
  exit 1
fi
ALPHA_VERSION="${TAG#v}"
ZIEL_REF="refs/remotes/$REMOTE/$ZIEL"

pushe() { # <commit>
  if [ "$PUSHEN" = true ]; then
    # Ohne Force: ist das Ziel inzwischen weitergewandert, scheitert der Push, statt etwas zu
    # überschreiben. Dann den Workflow einfach erneut starten.
    git push "$REMOTE" "$1:refs/heads/$ZIEL"
  else
    melde "(--ohne-push) $ZIEL würde auf $(git rev-parse --short "$1") gesetzt."
  fi
}

# Erstes Mal: das Ziel entsteht genau auf dem Tag. Noch kein Versions-Commit, nichts anzugleichen.
if ! git rev-parse -q --verify "$ZIEL_REF" > /dev/null; then
  melde "$ZIEL gibt es noch nicht, es entsteht auf $TAG."
  pushe "$QUELLE"
  ergebnis angelegt
  exit 0
fi

if git merge-base --is-ancestor "$QUELLE" "$ZIEL_REF"; then
  melde "$TAG ist schon in $ZIEL enthalten, nichts zu tun."
  ergebnis aktuell
  exit 0
fi

# Version des Ziels aus `[workspace.package]`, der einzigen Stelle der Anwendungsversion.
ZIEL_VERSION="$(git show "$ZIEL_REF:Cargo.toml" | awk '
  /^\[/ { im = ($0 == "[workspace.package]") }
  im && /^version[[:space:]]*=/ { gsub(/^version[[:space:]]*=[[:space:]]*"|".*$/, ""); print; exit }')"
if [ -z "$ZIEL_VERSION" ]; then
  melde "FEHLER: keine Version in [workspace.package] von $ZIEL gefunden."
  exit 1
fi

ARBEIT="$(mktemp -d)"
trap 'git worktree remove --force "$ARBEIT" > /dev/null 2>&1 || true; rm -rf "$ARBEIT"' EXIT
git worktree add -q --detach "$ARBEIT" "$QUELLE"

(
  cd "$ARBEIT"
  # Genau die Zeilen, die der Versions-Commit von semantic-release schreibt (`prepareCmd` in
  # release.config.mjs): die Workspace-Version, die Einträge der Workspace-Crates im Lockfile,
  # die Version des Frontends. Nur die exakte Alpha-Version wird ersetzt; keine fremde Crate trägt
  # eine Version wie `1.0.0-alpha.180`.
  alt="version = \"$ALPHA_VERSION\""
  neu="version = \"$ZIEL_VERSION\""
  for datei in Cargo.toml Cargo.lock; do
    if ! grep -qxF "$alt" "$datei"; then
      melde "FEHLER: $datei an $TAG trägt nicht die Version $ALPHA_VERSION."
      exit 1
    fi
    awk -v alt="$alt" -v neu="$neu" '$0 == alt { $0 = neu } { print }' "$datei" > "$datei.neu"
    mv "$datei.neu" "$datei"
  done
  alt_fe="  \"version\": \"$ALPHA_VERSION\","
  neu_fe="  \"version\": \"$ZIEL_VERSION\","
  if ! grep -qxF "$alt_fe" frontend/package.json; then
    melde "FEHLER: frontend/package.json an $TAG trägt nicht die Version $ALPHA_VERSION."
    exit 1
  fi
  awk -v alt="$alt_fe" -v neu="$neu_fe" '$0 == alt { $0 = neu } { print }' frontend/package.json \
    > frontend/package.json.neu
  mv frontend/package.json.neu frontend/package.json
  git show "$ZIEL_REF:CHANGELOG.md" > CHANGELOG.md

  git add Cargo.toml Cargo.lock frontend/package.json CHANGELOG.md
  # Kein `[skip ci]` nötig: der Commit wird nie allein gepusht, nur als Elternteil des Merges.
  git commit -q --no-verify -m "chore($ZIEL): Versionsdateien von $TAG an $ZIEL angleichen" \
    -m "Version $ZIEL_VERSION und CHANGELOG.md von $ZIEL, damit der Merge keine Konflikte hat (LLH-1545)."
  angleich="$(git rev-parse HEAD)"
  git checkout -q --detach "$ZIEL_REF"
  if ! git merge -q --no-ff --no-verify -m "chore($ZIEL): $TAG nach $ZIEL nachziehen" \
      -m "Quelle $QUELLE, Kanal-Nachzug (scripts/release/kanal-nachziehen.sh, LLH-1545)." \
      "$angleich" > /dev/null 2>&1; then
    melde "FEHLER: Konflikt beim Nachziehen von $TAG nach $ZIEL in:"
    git diff --name-only --diff-filter=U >&2
    melde "Wurde auf $ZIEL direkt gearbeitet? Fehler auf alpha beheben und einen neueren Tag nachziehen."
    git merge --abort
    exit 1
  fi
  # Gegenprobe: die Versionsdateien sind die des Ziels, nicht die der Alpha.
  if ! git diff --quiet "$ZIEL_REF" HEAD -- CHANGELOG.md \
      || git grep -q -F "$ALPHA_VERSION" HEAD -- Cargo.toml Cargo.lock frontend/package.json; then
    melde "FEHLER: Nach dem Merge tragen die Versionsdateien nicht den Stand von $ZIEL."
    exit 1
  fi
)

ERGEBNIS="$(git -C "$ARBEIT" rev-parse HEAD)"
melde "$TAG → $ZIEL: Merge $(git rev-parse --short "$ERGEBNIS") (Version bleibt $ZIEL_VERSION bis zum Release)."
pushe "$ERGEBNIS"
ergebnis nachgezogen
