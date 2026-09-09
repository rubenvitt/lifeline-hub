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
# Der Platzhalter .gitkeep bleibt stehen (LFH-242/F19): rust-embed braucht den
# Ordner zur Compile-Zeit, und ohne ihn ist der Arbeitsbaum hinterher dirty.
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
# Cargo kennt die Dateien unter frontend/dist NICHT als Abhängigkeit (rust-embed
# taucht in der Dep-Info nicht auf). Nach einer reinen Frontend-Änderung würde
# cargo das Modul deshalb gar nicht neu übersetzen und still den alten Stand
# einbetten — genau der Versions-Skew aus LFH-242/F19. Das touch erzwingt es.
touch src/static_files.rs
cargo build --release ${TARGET:+--target "$TARGET"}

# Cargo baut nicht zwingend nach ./target — ein globales build.target-dir (z. B. ein
# gemeinsames Verzeichnis über alle Worktrees, ~/.cargo/config.toml) verschiebt es.
# Deshalb den Pfad von Cargo selbst erfragen statt ihn zu raten.
# JSON mit dem ohnehin benötigten Node lesen; jq ist keine Projektvoraussetzung.
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps | mise exec node@26.7.0 -- node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')"

# Mit --target schiebt Cargo eine Ebene ein: target/<triple>/release/ statt target/release/.
# Und Windows-Binaries tragen .exe — ohne das Suffix zeigt der Pfad ins Leere und die
# Erfolgsmeldung am Ende log eine Datei, die es nicht gibt.
AUSGABE_DIR="$TARGET_DIR${TARGET:+/$TARGET}/release"
case "$TARGET" in
  *windows*) BINARY="$AUSGABE_DIR/lifeline-hub.exe" ;;
  *)         BINARY="$AUSGABE_DIR/lifeline-hub" ;;
esac

# Läuft das Gebaute auf DIESEM Rechner? Nur dann dürfen die Schritte unten es starten.
# Ein Cross-Build-Artefakt auszuführen endet je nach Plattform in „Exec format error" oder
# — schlimmer — in einem stillen Fehlschlag, der als fehlende SQLite-Version durchginge.
HOST_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TARGET" ] || [ "$TARGET" = "$HOST_TRIPLE" ]; then
  AUF_HOST_LAUFFAEHIG=1
else
  AUF_HOST_LAUFFAEHIG=0
fi

echo "==> SBOM erzeugen (LFH-253/G01)"
# Wozu: ohne Inventar des ausgelieferten Artefakts lässt sich im Advisory-Fall nicht
# beantworten, ob und wo man betroffen ist. Deterministisch und offline — deshalb darf
# das hier am Release hängen, anders als der netzabhängige Advisory-Scan
# (scripts/check-deps.sh), der bewusst NICHT im Release-Pfad steht.
# Neben dem Binary, nicht neben dem Host-Build: mit --target liegt die Ausgabe eine Ebene
# tiefer. Stünde hier weiter $TARGET_DIR/release, schriebe der Cross-Build sein SBOM an eine
# Stelle, an der es niemand sucht — und der Einsammelschritt in .github/workflows/artefakte.yml
# überspränge es STILL (er prüft mit `if [ -d … ]`), das Release käme ohne Stückliste heraus.
SBOM_DIR="$AUSGABE_DIR/sbom"
mkdir -p "$SBOM_DIR"
sbom_fehlend=()

if command -v cargo-cyclonedx >/dev/null 2>&1; then
  cargo cyclonedx --format json --all >/dev/null
  # cargo-cyclonedx legt die Dateien neben den Manifesten ab — einsammeln.
  find . -name 'bom.json' -not -path './target/*' -exec mv {} "$SBOM_DIR"/ \; 2>/dev/null || true
else
  sbom_fehlend+=("cargo-cyclonedx  →  cargo install cargo-cyclonedx")
fi

if mise exec pnpm@11.10.0 -- pnpm -C frontend exec cyclonedx-npm --version >/dev/null 2>&1; then
  mise exec pnpm@11.10.0 -- pnpm -C frontend exec cyclonedx-npm \
    --output-file "$SBOM_DIR/bom-frontend.json"
else
  sbom_fehlend+=("@cyclonedx/cyclonedx-npm  →  pnpm -C frontend add -D @cyclonedx/cyclonedx-npm")
fi

# Die eingebackene SQLite-Version (LFH-233/G02): sie steckt als C-Amalgamation im Binary
# und wird von KEINEM System-Update erreicht — im Advisory-Fall ist sie die Zahl, die man
# braucht. Aus dem laufenden Binary gelesen, nicht aus einer gepflegten Konstante.
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

if [ ${#sbom_fehlend[@]} -gt 0 ]; then
  echo "    WARNUNG: SBOM unvollständig, folgende Werkzeuge fehlen:" >&2
  for w in "${sbom_fehlend[@]}"; do echo "      - $w" >&2; done
else
  echo "    SBOM: $SBOM_DIR"
fi

echo "==> Fertig: $BINARY"
ls -lh "$BINARY"
if [ "$AUF_HOST_LAUFFAEHIG" = 1 ]; then
  echo "Start mit: $BINARY --db-path lifeline.db --bind 0.0.0.0:8080"
else
  echo "Cross-Build für $TARGET — auf der Zielplattform starten mit:"
  echo "  lifeline-hub --db-path lifeline.db --bind 0.0.0.0:8080"
fi
