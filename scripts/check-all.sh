#!/usr/bin/env bash
# Sammel-Gate — die eine Durchsetzungsinstanz vor dem Merge (LFH-235). Die CI ruft dieses
# Skript unverändert auf; wer einen Schritt ergänzt, ergänzt ihn hier.
#
# Reihenfolge ist Absicht: erst die billigen, schnell scheiternden Prüfungen, dann die teuren
# Suiten. Ein roter Schritt hält die folgenden NICHT auf: jeder Schritt läuft, am Ende steht
# der Gesamtstatus je Schritt und EIN Exit-Code (Schrittläufer: lib/schritte.sh, LFH-386).
#
# Bewusst NICHT enthalten: `cargo clippy -D warnings` — der Bestand hat noch Warnungen, und
# ein rot geborenes Gate wird abgeschaltet statt befolgt.
#
# Schritt 7 (`pnpm e2e`, startet Backend und Vite selbst) läuft nur, wenn das Debug-Binary
# daliegt, sonst laut übersprungen: die Suite kann es nicht selbst bauen. Im vollen Lauf baut
# Schritt 4 es ohnehin mit; der Guard schützt verkürzte Läufe und Einzelaufrufe. Schritt 7
# stellt außerdem `frontend/dist` bereit — den Service Worker für
# `e2e/lagekarte-offline-precache.spec.ts` gibt es nur im Prod-Bundle.
#
# Schritt 4 und 7 prüfen vorab, dass das Cargo-Build-Ziel diesem Checkout gehört
# (`.cargo/config.toml`, lib/bauziel.sh, LFH-520): In einem mit anderen Worktrees geteilten Ziel
# liefen Tests und Backend still gegen einen fremden Stand.
set -euo pipefail

# Bündel-Auswahl für die parallele CI. OHNE Argument läuft alles — der Weg vor dem Merge.
#   --nur schnell    rustfmt, Lint, Typ-Drift, Advisories,
#                    Selbsttests der Gate-Skripte,
#                    Migrationsnummern gegen origin/alpha,
#                    Werkzeugversionen aus mise.toml         (Sekunden bis ~1:30)
#   --nur rust       cargo test (Workspace, Hülle getrennt)   (~17 min)
#   --nur frontend   Vitest                                  (~16 min, shardbar)
#   --nur e2e        Playwright                              (~18 min, shardbar)
# Unabhängig vom Bündel:
#   --abbrechen      nach dem ersten roten Schritt keinen weiteren starten (Vorgabe:
#                    alle fahren und am Ende einmal rot melden)
# Geteilt wird über die Umgebung, nicht über weitere Flags:
#   VITEST_SHARD=1/3   PW_SHARD=2/4
NUR="alle"
ABBRECHEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --nur)
      NUR="${2:-}"
      [ -n "$NUR" ] || { echo "FEHLER: --nur braucht ein Bündel." >&2; exit 2; }
      shift 2
      ;;
    --nur=*) NUR="${1#--nur=}"; shift ;;
    --abbrechen) ABBRECHEN=1; shift ;;
    -h|--help) sed -n '/^# Bündel-Auswahl/,/^#   VITEST_SHARD/p' "$0"; exit 0 ;;
    *) echo "FEHLER: unbekanntes Argument '$1'." >&2; exit 2 ;;
  esac
done
VITEST_SHARD="${VITEST_SHARD:-}"
PW_SHARD="${PW_SHARD:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/dev-env.sh
. "$ROOT/scripts/lib/dev-env.sh"
# shellcheck source=lib/schritte.sh
. "$ROOT/scripts/lib/schritte.sh"
# shellcheck source=lib/bauziel.sh
. "$ROOT/scripts/lib/bauziel.sh"

FE="$ROOT/frontend"
# Node und pnpm kommen aus `[tools]` in mise.toml (LFH-773) — dort steht auch, warum die
# Nachbarn der gepinnten Node-Version ausfallen. Hier steht bewusst KEINE Zahl.
PNPM="mise exec -- pnpm"
SCHRITTE=12

# ZEITZONE FESTNAGELN: ohne sie hängt das Ergebnis der Suite an der Zone des Rechners
# (`EtbFilterleiste` prüft einen UTC-Wire-String als Ortszeit mit festem Wert). Europe/Berlin
# ist die Zielumgebung, die Anzeigezone ist Ortszeit (etb/filterZeit.ts). Ein alleinstehendes
# `pnpm test`/`pnpm e2e` läuft nicht durch diesen Wrapper.
export TZ="${TZ_ERZWUNGEN:-Europe/Berlin}"
echo "==> Zeitzone für den Lauf: $TZ"

geraeumt="$(dev_env_liste | tr '\n' ' ')"
if [ -n "${geraeumt// /}" ]; then
  echo "==> Dev-Variablen werden für die Testläufe geräumt: $geraeumt"
fi

# ── Die zwölf Schritte, je als Funktion ──────────────────────────────────────────────
# Funktionen, damit die CI sie auf mehreren Runnern einzeln ansprechen kann. Die Nummer in
# der Ausgabe ist die Position im GESAMTgate, nicht im laufenden Teilstück.

schritt_1() {
  echo "==> [1/$SCHRITTE] rustfmt-Baseline"
  "$ROOT/scripts/check-fmt.sh"
}

schritt_2() {
  echo "==> [2/$SCHRITTE] Frontend-Lint (--max-warnings 0)"
  $PNPM -C "$FE" lint
}

schritt_3() {
  echo "==> [3/$SCHRITTE] Typ-Drift Backend↔Frontend (enthält den Frontend-Typecheck)"
  "$ROOT/scripts/check-typ-codegen.sh"
}

schritt_4() {
  echo "==> [4/$SCHRITTE] Rust-Suite (Workspace, Desktop-Hülle getrennt)"
  # Getrennt, nicht `--workspace` in einem Zug: Cargo vereinigte sonst die Features von Server
  # und Hülle (LFH-721) — der Server würde mit einem Feature-Satz getestet, den sein Binary nie
  # hat (u. a. zwei rustls-Provider, woran `tls::tests::rcgen_pem_ist_per_rustls_ladbar` als
  # Stolperdraht absichtlich bricht). Jedes Produkt läuft mit seinem eigenen Feature-Satz.
  bauziel_pruefen "$ROOT"
  ohne_dev_env cargo test --workspace --exclude lifeline-desktop
  ohne_dev_env cargo test -p lifeline-desktop
}

schritt_5() {
  echo "==> [5/$SCHRITTE] Frontend-Suite${VITEST_SHARD:+ (Anteil $VITEST_SHARD)}"
  # --no-file-parallelism BLEIBT auch im Shard-Betrieb: Sharding verteilt Dateien über
  # Maschinen, das Flag steuert die Nebenläufigkeit innerhalb eines Prozesses. Ohne es
  # startete jeder Shard so viele Worker wie der Runner Kerne hat — die Kontention, die als
  # Flakiness auftrat.
  local bericht=()
  if [ -n "${VITEST_SHARD:-}" ]; then
    # Im Shard-Betrieb zusätzlich ein Blob-Bericht, damit die Teilläufe zu EINEM Ergebnis
    # zusammengeführt werden können (`vitest run --merge-reports`). Ablage unter
    # `frontend/.vitest/blob/`.
    bericht=(--reporter=default --reporter=blob)
  fi
  $PNPM -C "$FE" exec vitest run --no-file-parallelism "${bericht[@]}" ${VITEST_SHARD:+--shard="$VITEST_SHARD"}
}

schritt_6() {
  echo "==> [6/$SCHRITTE] Abhängigkeiten auf bekannte Schwachstellen prüfen"
  "$ROOT/scripts/check-deps.sh"
}

# Stellt frontend/dist bereit — den Prod-Bundle für e2e/lagekarte-offline-precache.spec.ts
# (Service Worker und Precache-Manifest gibt es nur im Build). Ausgeliefert wird er vom
# e2e-Backend selbst (rust-embed liest `frontend/dist` im Debug-Build vom Dateisystem).
#
# Gebaut wird nur bei Bedarf, bewusst grob-konservativ: irgendeine Quelle neuer als sw.js →
# neu bauen. Lieber einmal zu oft bauen als eine gebrochene Precache-Konfiguration übersehen.
# In der CI baut jeder e2e-Shard (welcher den Spec fährt, steht vorher nicht fest); ein
# dist-Artefakt zwischen den Jobs wäre ein Schritt, den nur die CI kennt.
prod_bundle_bereitstellen() {
  local sw="$FE/dist/sw.js" grund="" neuer
  if [ ! -f "$sw" ]; then
    grund="fehlt"
  else
    # Kein `-quit`/`head` (Portabilität bzw. SIGPIPE unter pipefail): die Liste wird ganz
    # gelesen und nur auf „leer oder nicht" geprüft. Fehlende Pfade sind unschädlich, die
    # Liste darf vorauseilend vollständig sein.
    neuer="$(find "$FE/src" "$FE/public" "$FE/index.html" "$FE/vite.config.ts" \
      "$FE/tsconfig.json" "$FE/tsconfig.node.json" "$FE/package.json" "$FE/pnpm-lock.yaml" \
      -newer "$sw" 2>/dev/null || true)"
    [ -z "$neuer" ] || grund="älter als die Quellen"
  fi
  if [ -z "$grund" ]; then
    echo "    Prod-Bundle aktuell — kein Neubau (Offline-Precache-Nachweis, LFH-356)."
    return 0
  fi
  echo "    Prod-Bundle $grund → 'pnpm run build' (für den Offline-Precache-Nachweis, LFH-356)"
  # `run build` ausgeschrieben: `pnpm build` hinge daran, dass pnpm keinen eigenen
  # Unterbefehl dieses Namens hat.
  $PNPM -C "$FE" run build
}

schritt_7() {
  echo "==> [7/$SCHRITTE] e2e-Suite (Playwright, LFH-309)${PW_SHARD:+ (Anteil $PW_SHARD)}"
  # Den Pfad von Cargo erfragen, nicht ./target annehmen: CARGO_TARGET_DIR darf ihn verlegen.
  # Das JSON mit Node lesen (jq ist keine Voraussetzung).
  local target_dir binaer
  # PW_BINAER übersteuert die Abfrage (dieselbe Variable liest playwright.config.ts): ein
  # e2e-Shard der CI lädt das Binary als Artefakt und hat kein Cargo-Target. Der Präfix `PW_`
  # ist Absicht — `LIFELINE_`/`KS_`/`AWS_` räumt lib/dev-env.sh als Dev-Variablen weg.
  if [ -n "${PW_BINAER:-}" ]; then
    binaer="$PW_BINAER"
  else
    bauziel_pruefen "$ROOT"
    target_dir="$(cargo metadata --format-version 1 --no-deps | mise exec -- node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')"
    binaer="$target_dir/debug/lifeline-hub"
  fi
  echo "    Backend-Binary: $binaer"
  if [ -x "$binaer" ]; then
    # Die Suite startet Backend und Vite selbst auf freien Ports (auch je Shard); ein
    # laufender Dev-Stack stört nicht. Die Env-Hygiene macht die Playwright-Config selbst,
    # damit `pnpm e2e` auch ohne diesen Wrapper sauber läuft. Der Prod-Bundle wird erst hier
    # gebaut: ohne Binary liefe keine Suite.
    prod_bundle_bereitstellen
    $PNPM -C "$FE" exec playwright test ${PW_SHARD:+--shard="$PW_SHARD"}
  elif [ -n "${PW_BINAER:-}" ]; then
    # Wer den Pfad ausdrücklich setzt, erwartet dort ein lauffähiges Binary — still zu
    # überspringen meldete einen grünen e2e-Schritt, der nie lief. actions/upload-artifact
    # verliert das Ausführbar-Bit.
    echo "FEHLER: '$binaer' ist nicht ausführbar (PW_BINAER ist gesetzt)." >&2
    if [ -e "$binaer" ]; then
      echo "        Die Datei existiert, hat aber kein Ausführbar-Bit — nach einem" >&2
      echo "        Artefakt-Download fehlt es immer. Abhilfe: chmod +x." >&2
    else
      echo "        Die Datei existiert nicht. Pfad prüfen." >&2
    fi
    exit 1
  else
    echo "    ÜBERSPRUNGEN: $binaer fehlt." >&2
    echo "    Die e2e-Suite startet das Backend selbst und setzt einen Debug-Build voraus." >&2
    echo "    Einmal 'cargo build' laufen lassen, dann deckt dieses Gate auch die Fehler-" >&2
    echo "    klassen ab, die nur der echte Browser sieht (Layout, WebGL, StrictMode)." >&2
    echo "    (Bewusst kein harter Fehler: auf einem frischen Checkout wäre das Gate sonst" >&2
    echo "     von Tag eins rot — und ein rotes Gate wird abgeschaltet statt befolgt.)" >&2
    return "$UEBERSPRUNGEN_RC"
  fi
}

schritt_8() {
  echo "==> [8/$SCHRITTE] Release-Werkzeug: Ruhefenster, KI-Notizen, Desktop-Manifest (Selbsttests)"
  # Im `schnell`-Bündel: prüft nicht das Release, sondern die Entscheidung, ob ein Lauf
  # releasen darf — die ist in beide Richtungen still.
  "$ROOT/scripts/release-ruhefenster.test.sh"
  # Dasselbe Werkzeug für die Release-Notizen: ein Fehlschlag fällt auf die konventionellen
  # Notizen zurück, CHANGELOG und GitHub-Release tragen denselben Text. Braucht nur Node.
  mise exec -- node --test "$ROOT/scripts/release/ki-notizen.test.mjs"
  # Das Update-Manifest der Desktop-Hülle (LFH-721): ein falscher Eintrag lässt jede installierte
  # Hülle ins Leere laden oder bietet ein Update an, das keins ist — beides still.
  mise exec -- node --test "$ROOT/scripts/release/desktop-manifest.test.mjs"
}

schritt_9() {
  echo "==> [9/$SCHRITTE] Advisory-Gate liest das Lockfile (Selbsttest, LFH-316)"
  # Schritt 6 fragt die Advisory-Datenbank (netzabhängig); dieser Selbsttest fragt ohne Netz,
  # WORAUF Schritt 6 schaut — ein Gate, das eine Teilmenge prüft, meldet „OK" wie eines, das
  # alles geprüft hat.
  "$ROOT/scripts/check-deps.test.sh"
}

schritt_10() {
  echo "==> [10/$SCHRITTE] Migrationsnummern gegen den Ziel-Branch (LFH-658)"
  # Erst der Selbsttest: das Prüfskript bemerkt als einzige Stelle eine eingeschobene Nummer
  # (sqlx spielt sie still nach) und irrt in beide Richtungen still.
  "$ROOT/scripts/check-migrationen.test.sh"
  # Dann die Prüfung gegen `origin/alpha`, so frisch wie der letzte `fetch` — eine
  # Frühwarnung; durchgesetzt wird über den Workflow `migrationen.yml`. Ohne den Ref (flacher
  # PR-Checkout) laut übersprungen.
  if git -C "$ROOT" rev-parse --verify --quiet 'origin/alpha^{commit}' > /dev/null; then
    "$ROOT/scripts/check-migrationen.sh" origin/alpha
  else
    echo "    ÜBERSPRUNGEN: origin/alpha fehlt in diesem Checkout." >&2
    echo "    Im PR prüft das der Workflow 'Migrationsnummern'; lokal hilft 'git fetch origin alpha'." >&2
  fi
}

schritt_11() {
  echo "==> [11/$SCHRITTE] Selbsttests des Sammel-Gates: Schrittläufer (LFH-386), Build-Ziel (LFH-520)"
  # Der Läufer entscheidet, ob ein roter Schritt die folgenden mitnimmt und ob ein Schritt, dessen
  # erstes Kommando scheitert, grün meldet — beides wäre still.
  "$ROOT/scripts/check-all.test.sh"
  # Daneben die Vorbedingung, die Schritt 4 und 7 prüfen: das Build-Ziel je Checkout (LFH-520).
  # Sie irrt ebenfalls still — ein geteiltes Ziel färbt kein Ergebnis rot, nur das falsche grün.
  "$ROOT/scripts/bauziel.test.sh"
}

schritt_12() {
  echo "==> [12/$SCHRITTE] Node und pnpm aus einer Quelle: mise.toml [tools] (LFH-773)"
  # Erst der Selbsttest, dann die Prüfung: der Guard irrt in beide Richtungen still.
  "$ROOT/scripts/check-toolversionen.test.sh"
  "$ROOT/scripts/check-toolversionen.sh"
}

# ── Bündel für die parallele CI ─────────────────────────────────────────────────────
# `schnell` trägt alles, was in Sekunden bis gut einer Minute fertig ist, und scheitert
# deshalb früh; die drei teuren Schritte bekommen je einen eigenen Runner.
BUENDEL_schnell="1 2 3 6 8 9 10 11 12"
BUENDEL_rust="4"
BUENDEL_frontend="5"
BUENDEL_e2e="7"
BUENDEL_alle="1 2 3 4 5 6 7 8 9 10 11 12"

# SELBSTPRÜFUNG: die vier Bündel ergeben zusammen genau die zwölf Schritte, jeden einmal —
# sonst fiele beim Umsortieren still ein Schritt aus der CI.
_summe="$(printf '%s\n' $BUENDEL_schnell $BUENDEL_rust $BUENDEL_frontend $BUENDEL_e2e | sort -n | tr '\n' ' ')"
_soll="$(printf '%s\n' $BUENDEL_alle | sort -n | tr '\n' ' ')"
if [ "$_summe" != "$_soll" ]; then
  echo "FEHLER: die Bündel decken nicht genau die $SCHRITTE Schritte ab." >&2
  echo "        gebündelt: $_summe" >&2
  echo "        erwartet:  $_soll" >&2
  exit 2
fi

case "$NUR" in
  alle)     lauf="$BUENDEL_alle" ;;
  schnell)  lauf="$BUENDEL_schnell" ;;
  rust)     lauf="$BUENDEL_rust" ;;
  frontend) lauf="$BUENDEL_frontend" ;;
  e2e)      lauf="$BUENDEL_e2e" ;;
  *)
    echo "FEHLER: unbekanntes Bündel '$NUR'." >&2
    echo "        Erlaubt: alle (Vorgabe), schnell, rust, frontend, e2e" >&2
    exit 2
    ;;
esac

# $lauf unquotiert: die Schrittnummern sollen als einzelne Argumente ankommen. Nicht in einer
# Bedingung aufrufen (s. lib/schritte.sh).
# shellcheck disable=SC2086
schritte_fahren "$ABBRECHEN" $lauf
gesamt=0
schritte_bericht || gesamt=$?
if [ "$NUR" != alle ]; then
  echo "    Bündel '$NUR' (Schritte: $lauf von $SCHRITTE) ist ein TEILSTÜCK."
  echo "    Vor dem Merge gilt der volle Lauf ohne --nur."
fi
exit "$gesamt"
