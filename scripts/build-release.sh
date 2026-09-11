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
# fände nichts vor. Der prüft seit LFH-527 auf INHALT statt auf das bloße Vorhandensein des
# Verzeichnisses; die frühere `[ -d … ]`-Zeile ließ ein leeres SBOM still durchgehen.
# BEIDE WERKZEUGAUFRUFE UNTEN SIND TOLERANT, BEWERTET WIRD AM GUARD.
# Das sieht aus wie das `|| true`, das der Cargo-Zweig gerade LOSGEWORDEN ist, ist aber das
# Gegenteil: dort verschluckte es einen Fehlschlag, ohne dass irgendwer danach nachsah. Hier
# folgt unmittelbar eine Prüfung auf die erzeugte Datei, und sie ist die einzige Instanz, die
# über vollständig/unvollständig entscheidet.
# Ohne die Toleranz räumt `set -e` den ganzen Build ab, sobald ein Werkzeug zwar im PATH liegt,
# aber nicht läuft (gemessen mit einem mise-Shim ohne gesetzte Version). Genau der Fall, den
# der else-Zweig auffangen soll — nur dass `command -v` ihn nicht sieht, weil die Datei ja da
# ist. Ein lokaler Build sähe dann statt einer Warnung einen Abbruch.
# Die Fehlerausgabe der Werkzeuge bleibt sichtbar (nur stdout geht nach /dev/null): der Guard
# nennt WAS fehlt, die Werkzeugmeldung darüber WARUM.
SBOM_DIR="$AUSGABE_DIR/sbom"
# ERST LEEREN, DANN FÜLLEN — wie beim Embed-Inhalt oben, und aus demselben Grund.
# Gemessen bei der Mutationsprobe zu LFH-527: mit bloßem `mkdir -p` überleben die Dateien
# des vorigen Laufs. Der Inhalts-Guard unten sieht sie, wird grün — und das Zip trägt eine
# Stückliste, die zu einem ANDEREN Stand gehört als das ausgelieferte Binary. Genau die
# Aussage, für die ein SBOM im Advisory-Fall existiert, wäre dann falsch. Auf einem frischen
# CI-Runner fällt das nie auf; lokal ist es der Normalfall.
rm -rf "$SBOM_DIR"
mkdir -p "$SBOM_DIR"
sbom_fehlend=()

if command -v cargo-cyclonedx >/dev/null 2>&1; then
  cargo cyclonedx --format json --all >/dev/null || true
  # cargo-cyclonedx legt die Dateien neben den Manifesten ab — einsammeln.
  #
  # DAS MUSTER IST `*.cdx.json`, NICHT `bom.json`. Gemessen an 0.5.7 (der Version, die
  # artefakte.yml pinnt): das Werkzeug benennt seine Ausgabe nach dem Crate und legt bei
  # `--all` je Workspace-Member eine Datei an — `lifeline-hub.cdx.json`,
  # `karten-katalog.cdx.json`, `karten-service.cdx.json`. Der frühere `find` auf `bom.json`
  # fand deshalb NICHTS, und zwar ohne Fehler und ohne roten Build: `cargo cyclonedx` endet
  # mit 0, `find` ohne Treffer ebenso, und `|| true` hätte auch einen echten Fehlschlag
  # verschluckt. Im Release v1.0.0-alpha.2 lag statt der Stückliste nur die SQLite-Version
  # im Zip (Lauf 34513044748).
  #
  # Kein `2>/dev/null || true` mehr: ein fehlschlagendes `mv` soll auffallen. Und
  # `node_modules` ist ausgeschlossen — ein Paket, das seine eigene Stammliste mitliefert,
  # hätte sonst eine fremde Datei in unsere Stückliste geschoben.
  find . -name '*.cdx.json' \
    -not -path './target/*' \
    -not -path './frontend/node_modules/*' \
    -exec mv {} "$SBOM_DIR"/ \;
  # Das Werkzeug lief — lieferte es auch? Begründung beim Guard unten.
  [ -n "$(find "$SBOM_DIR" -name '*.cdx.json' -print -quit)" ] \
    || sbom_fehlend+=("Cargo-Stückliste: cargo-cyclonedx lief, legte aber keine *.cdx.json ab")
else
  sbom_fehlend+=("cargo-cyclonedx  →  cargo install cargo-cyclonedx")
fi

# cdxgen, NICHT @cyclonedx/cyclonedx-npm — gemessen, nicht Geschmack (LFH-527).
# Der frühere Zweig hier verlangte `cyclonedx-npm`, und dessen Remediation-Zeile schickte
# jeden Leser in eine Sackgasse: das Werkzeug ermittelt den Abhängigkeitsbaum über `npm ls`
# und bricht in einem pnpm-Baum mit „missing: …, required by …" ab, ohne eine Datei zu
# schreiben. Es war also nie bloß nicht installiert — es hätte hier auch installiert nichts
# geliefert. cdxgen liest `pnpm-lock.yaml` und kennt den Paketmanager (`-t pnpm`).
#
# MIT PFADARGUMENT, OHNE `cd`: der Kopf dieses Skripts setzt mit `cd "$(dirname "$0")/.."`
# den Bezugspunkt, an dem jeder Pfad darunter hängt (`frontend/dist`, das `find .` oben).
# Ein `cd frontend` hier verschöbe ihn für alles Folgende.
#
# `--no-recurse`: gefragt ist die Stückliste DIESES Pakets samt seiner transitiven
# Abhängigkeiten (gemessen 848 Komponenten, CycloneDX 1.6) — nicht ein Streifzug durch
# verschachtelte Projekte unterhalb von frontend/, der die Ausgabe mit Fremdbäumen füllte.
if command -v cdxgen >/dev/null 2>&1; then
  cdxgen -t pnpm --no-recurse -o "$SBOM_DIR/bom-frontend.json" frontend >/dev/null || true
  [ -s "$SBOM_DIR/bom-frontend.json" ] \
    || sbom_fehlend+=("Frontend-Stückliste: cdxgen lief, schrieb aber keine bom-frontend.json")
else
  sbom_fehlend+=("@cyclonedx/cdxgen  →  npm install -g @cyclonedx/cdxgen")
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

# ZUSICHERUNG AUF INHALT, NICHT AUF EXISTENZ (LFH-527).
#
# Der frühere Aufbau konnte nicht rot werden: die fehlende Frontend-Stückliste war eine
# bloße Warnung, der verfehlte Cargo-`find` wurde gar nicht bemerkt, und der Einsammelschritt
# in .github/workflows/artefakte.yml prüfte danach nur `[ -d … ]` — das Verzeichnis legt
# `mkdir -p` oben ja selbst an. Drei Prüfungen hintereinander, von denen keine den
# tatsächlichen Mangel sehen konnte; genau so ist ein hohles SBOM-Zip ins Release gegangen.
#
# Hart bricht es nur mit SBOM_PFLICHT=1. Den setzt artefakte.yml für den EINEN Matrix-Eintrag,
# der die Stückliste ausliefert. Auf den anderen drei Runnern ist cargo-cyclonedx nicht
# installiert — dort zu brechen nähme dem Release seine Binaries für ein Artefakt, das jener
# Lauf gar nicht beisteuert. Lokale Builds bleiben aus demselben Grund bei der Warnung: wer
# eine Testbinary baut, soll nicht an einer fehlenden Stückliste scheitern.
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
