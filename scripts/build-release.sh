#!/usr/bin/env bash
# Baut das Frontend, bettet es in die Rust-Binary ein und erzeugt die Single-Binary.
#
# Aufruf:
#   ./scripts/build-release.sh                                  # für den Build-Rechner
#   ./scripts/build-release.sh --target x86_64-pc-windows-gnu   # Cross-Build (LFH-522)
#
# Der Cross-Build braucht Linker und C-Compiler der Zielplattform in der Umgebung, z. B.
#   CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
#   CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
#   AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar
# Bewusst NICHT in einer committeten .cargo/config.toml: die gälte für jeden lokalen Build
# und bräche ihn auf jedem Rechner ohne MinGW. Die Zuweisung gehört dorthin, wo cross
# gebaut wird — in .github/workflows/artefakte.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      [ -n "$TARGET" ] || { echo "FEHLER: --target braucht ein Ziel-Triple." >&2; exit 2; }
      shift 2
      ;;
    --target=*) TARGET="${1#--target=}"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "FEHLER: unbekanntes Argument '$1'." >&2; exit 2 ;;
  esac
done

echo "==> 1/3 Alten Embed-Inhalt entfernen"
# Der Platzhalter .gitkeep bleibt stehen: rust-embed braucht den Ordner zur Compile-Zeit,
# und ohne ihn ist der Arbeitsbaum hinterher dirty.
find frontend/dist -mindepth 1 ! -name '.gitkeep' -delete

echo "==> 2/3 Frontend bauen (frontend/dist)"
( cd frontend && pnpm install --frozen-lockfile && pnpm run build )

# Fail-closed: lieber hier abbrechen als eine Binary mit leerem Frontend ausliefern.
if [ ! -f frontend/dist/index.html ]; then
  echo "FEHLER: frontend/dist/index.html fehlt nach dem Frontend-Build." >&2
  echo "Ohne sie entstünde eine Binary ohne eingebettetes Frontend." >&2
  exit 1
fi

echo "==> 3/3 Backend im Release-Modus bauen${TARGET:+ (Ziel: $TARGET)} (bettet frontend/dist ein)"
# Cargo kennt die Dateien unter frontend/dist NICHT als Abhängigkeit (rust-embed taucht in
# der Dep-Info nicht auf) und bettete nach einer reinen Frontend-Änderung still den alten
# Stand ein. Das touch erzwingt die Neuübersetzung.
touch src/static_files.rs
cargo build --release ${TARGET:+--target "$TARGET"}

# Cargo baut nicht zwingend nach ./target (CARGO_TARGET_DIR darf es verlegen) — den Pfad deshalb von
# Cargo erfragen; das JSON liest Node (jq ist keine Projektvoraussetzung).
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps | mise exec -- node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')"

# Mit --target schiebt Cargo eine Ebene ein (target/<triple>/release/), und Windows-Binaries
# tragen .exe.
AUSGABE_DIR="$TARGET_DIR${TARGET:+/$TARGET}/release"
case "$TARGET" in
  *windows*) BINARY="$AUSGABE_DIR/lifeline-hub.exe" ;;
  *)         BINARY="$AUSGABE_DIR/lifeline-hub" ;;
esac

# Läuft das Gebaute auf DIESEM Rechner? Nur dann dürfen die Schritte unten es starten — ein
# Cross-Build-Artefakt endet sonst in „Exec format error" oder einem stillen Fehlschlag.
HOST_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TARGET" ] || [ "$TARGET" = "$HOST_TRIPLE" ]; then
  AUF_HOST_LAUFFAEHIG=1
else
  AUF_HOST_LAUFFAEHIG=0
fi

echo "==> SBOM erzeugen (LFH-253/G01)"
# Ohne Inventar des ausgelieferten Artefakts lässt sich im Advisory-Fall nicht beantworten,
# ob man betroffen ist. Deterministisch und offline — anders als der netzabhängige
# Advisory-Scan (scripts/check-deps.sh), der bewusst nicht im Release-Pfad steht. Das SBOM
# liegt neben dem Binary (mit --target eine Ebene tiefer), dort sammelt artefakte.yml es ein.
#
# Die Werkzeugaufrufe unten sind tolerant (`|| true`), BEWERTET WIRD AM GUARD: unmittelbar
# danach folgt die Prüfung auf die erzeugte Datei. Ohne Toleranz räumte `set -e` den Build ab,
# wenn ein Werkzeug im PATH liegt, aber nicht läuft (mise-Shim ohne Version). stderr bleibt
# sichtbar: der Guard nennt WAS fehlt, die Werkzeugmeldung WARUM.
SBOM_DIR="$AUSGABE_DIR/sbom"
# ERST LEEREN, DANN FÜLLEN: mit bloßem `mkdir -p` überlebten Dateien des vorigen Laufs, der
# Guard würde grün, und das Zip trüge eine Stückliste zu einem anderen Stand.
rm -rf "$SBOM_DIR"
mkdir -p "$SBOM_DIR"
sbom_fehlend=()

if command -v cargo-cyclonedx >/dev/null 2>&1; then
  cargo cyclonedx --format json --all >/dev/null || true
  # cargo-cyclonedx legt die Dateien neben den Manifesten ab — einsammeln.
  #
  # Das Muster ist `*.cdx.json`, nicht `bom.json`: cargo-cyclonedx benennt seine Ausgabe nach
  # dem Crate und legt bei `--all` je Workspace-Member eine Datei an. `node_modules` ist
  # ausgeschlossen, sonst schöbe ein Paket seine eigene Stückliste in unsere.
  find . -name '*.cdx.json' \
    -not -path './target/*' \
    -not -path './frontend/node_modules/*' \
    -exec mv {} "$SBOM_DIR"/ \;
  # Das Werkzeug lief — lieferte es auch?
  [ -n "$(find "$SBOM_DIR" -name '*.cdx.json' -print -quit)" ] \
    || sbom_fehlend+=("Cargo-Stückliste: cargo-cyclonedx lief, legte aber keine *.cdx.json ab")
else
  sbom_fehlend+=("cargo-cyclonedx  →  cargo install cargo-cyclonedx")
fi

# cdxgen, NICHT @cyclonedx/cyclonedx-npm: letzteres ermittelt den Baum über `npm ls` und
# bricht in einem pnpm-Baum ab, ohne eine Datei zu schreiben. cdxgen liest `pnpm-lock.yaml`.
#
# Mit Pfadargument, ohne `cd`: jeder Pfad darunter hängt am `cd` im Kopf dieses Skripts.
# `--no-recurse`: gefragt ist die Stückliste DIESES Pakets samt transitiver Abhängigkeiten,
# nicht verschachtelter Projekte unterhalb von frontend/.
if command -v cdxgen >/dev/null 2>&1; then
  cdxgen -t pnpm --no-recurse -o "$SBOM_DIR/bom-frontend.json" frontend >/dev/null || true
  [ -s "$SBOM_DIR/bom-frontend.json" ] \
    || sbom_fehlend+=("Frontend-Stückliste: cdxgen lief, schrieb aber keine bom-frontend.json")
else
  sbom_fehlend+=("@cyclonedx/cdxgen  →  npm install -g @cyclonedx/cdxgen")
fi

# Die eingebackene SQLite-Version: sie steckt als C-Amalgamation im Binary und erreicht kein
# System-Update — im Advisory-Fall die Zahl, die man braucht. Aus dem Binary gelesen.
if [ "$AUF_HOST_LAUFFAEHIG" = 1 ]; then
  if SQLITE_VERSION="$("$BINARY" sqlite-version 2>/dev/null)"; then
    echo "$SQLITE_VERSION" > "$SBOM_DIR/eingebettete-sqlite-version.txt"
    echo "    eingebettetes SQLite: $SQLITE_VERSION"
  fi
else
  echo "    eingebettete SQLite-Version: übersprungen (Cross-Build für $TARGET)."
  echo "    Sie wird vom Smoke-Test auf der Zielplattform gelesen — siehe"
  echo "    .github/workflows/artefakte.yml, Job 'windows-smoke'."
fi

# ZUSICHERUNG AUF INHALT, NICHT AUF EXISTENZ: das Verzeichnis legt `mkdir -p` oben selbst an.
#
# Hart bricht es nur mit SBOM_PFLICHT=1 — gesetzt von artefakte.yml für den EINEN
# Matrix-Eintrag, der die Stückliste ausliefert. Auf den übrigen Runnern und lokal bleibt es
# bei der Warnung: dort fehlt cargo-cyclonedx, und das Release verlöre sonst seine Binaries.
if [ ${#sbom_fehlend[@]} -gt 0 ]; then
  if [ -n "${SBOM_PFLICHT:-}" ]; then
    echo "    FEHLER: SBOM unvollständig — dieser Lauf liefert die Stückliste aus:" >&2
  else
    echo "    WARNUNG: SBOM unvollständig, folgendes fehlt:" >&2
  fi
  for w in "${sbom_fehlend[@]}"; do echo "      - $w" >&2; done
  [ -z "${SBOM_PFLICHT:-}" ] || exit 1
else
  echo "    SBOM: $SBOM_DIR"
  ls -1 "$SBOM_DIR"
fi

echo "==> Fertig: $BINARY"
ls -lh "$BINARY"
if [ "$AUF_HOST_LAUFFAEHIG" = 1 ]; then
  echo "Start mit: $BINARY --db-path lifeline.db --bind 0.0.0.0:8080"
else
  echo "Cross-Build für $TARGET — auf der Zielplattform starten mit:"
  echo "  lifeline-hub --db-path lifeline.db --bind 0.0.0.0:8080"
fi
