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
# daliegt — dort, wo Cargo es hinlegt (lib/backend-binaer.sh) —, sonst laut übersprungen: die
# Suite kann es nicht selbst bauen. Im vollen Lauf baut
# Schritt 4 es ohnehin mit; der Guard schützt verkürzte Läufe und Einzelaufrufe. Schritt 7
# stellt außerdem `frontend/dist` bereit — den Service Worker für
# `e2e/lagekarte-offline-precache.spec.ts` gibt es nur im Prod-Bundle.
#
# Schritt 3, 4 und 7 prüfen vorab, dass das Cargo-Build-Ziel diesem Checkout gehört
# (`.cargo/config.toml`, lib/bauziel.sh, LFH-520): In einem mit anderen Worktrees geteilten Ziel
# liefen Tests und Backend still gegen einen fremden Stand.
set -euo pipefail

# Bündel-Auswahl für die parallele CI. OHNE Argument läuft alles — der Weg vor dem Merge.
#   --nur schnell    rustfmt, Lint, Typ-Drift, Advisories,
#                    Selbsttests der Gate-Skripte,
#                    Migrationsnummern gegen origin/alpha,
#                    Werkzeugversionen aus mise.toml,
#                    fertige OpenSpec-Changes archiviert     (Sekunden bis ~1:30)
#   --nur rust       cargo test (Workspace, Hülle getrennt)   (~17 min)
#   --nur frontend   Vitest                                  (~16 min, shardbar)
#   --nur e2e        Playwright                              (~18 min, shardbar)
# Unabhängig vom Bündel:
#   --abbrechen      nach dem ersten roten Schritt keinen weiteren starten (Vorgabe:
#                    alle fahren und am Ende einmal rot melden)
# Geteilt wird über die Umgebung, nicht über weitere Flags:
#   VITEST_SHARD=1/3   PW_SHARD=2/4
# Playwright-Projekte (Vorgabe: alle, so auch die CI; Firefox/WebKit fahren nur die Druck-Specs):
#   PW_PROJEKTE=chromium   PW_PROJEKTE=firefox,webkit
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
    -h|--help) sed -n '/^# Bündel-Auswahl/,/^#   PW_PROJEKTE/p' "$0"; exit 0 ;;
    *) echo "FEHLER: unbekanntes Argument '$1'." >&2; exit 2 ;;
  esac
done
VITEST_SHARD="${VITEST_SHARD:-}"
PW_SHARD="${PW_SHARD:-}"
PW_PROJEKTE="${PW_PROJEKTE:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/dev-env.sh
. "$ROOT/scripts/lib/dev-env.sh"
# shellcheck source=lib/schritte.sh
. "$ROOT/scripts/lib/schritte.sh"
# shellcheck source=lib/backend-binaer.sh
. "$ROOT/scripts/lib/backend-binaer.sh"
# shellcheck source=lib/bauziel.sh
. "$ROOT/scripts/lib/bauziel.sh"

FE="$ROOT/frontend"
# Node und pnpm kommen aus `[tools]` in mise.toml (LFH-773) — dort steht auch, warum die
# Nachbarn der gepinnten Node-Version ausfallen. Hier steht bewusst KEINE Zahl.
PNPM="mise exec -- pnpm"
SCHRITTE=13

# ZEITZONE FESTNAGELN: ohne sie hängt das Ergebnis der Suite an der Zone des Rechners
# (`EtbFilterleiste` prüft einen UTC-Wire-String als Ortszeit mit festem Wert). Europe/Berlin
# ist die Zielumgebung, die Anzeigezone ist Ortszeit (anzeige/zeitEingabe.ts). Ein alleinstehendes
# `pnpm test`/`pnpm e2e` läuft nicht durch diesen Wrapper.
export TZ="${TZ_ERZWUNGEN:-Europe/Berlin}"
echo "==> Zeitzone für den Lauf: $TZ"

geraeumt="$(dev_env_liste | tr '\n' ' ')"
if [ -n "${geraeumt// /}" ]; then
  echo "==> Dev-Variablen werden für die Testläufe geräumt: $geraeumt"
fi

# ── Die dreizehn Schritte, je als Funktion ───────────────────────────────────────────
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
  # Baut und startet `openapi_spec_aktuell`, das seinen Pfad per CARGO_MANIFEST_DIR einkompiliert:
  # ein fremdes Testbinary prüfte die openapi.json des anderen Worktrees.
  bauziel_pruefen "$ROOT"
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

# Sind die Browser der gewählten Playwright-Projekte installiert? Ohne diese Prüfung scheiterte
# JEDER Fall eines fehlenden Browsers einzeln an „Executable doesn't exist" — eine Wand roter
# Tests, die nach kaputtem Frontend aussieht. Lieber vorher laut und mit der Anweisung abbrechen.
# Fehlende Browser werden NICHT still übersprungen: dann gäbe das Gate je Maschine eine andere
# Antwort (LFH-729, design.md D2). Projektname = Browsername (`frontend/playwright.config.ts`).
pw_browser_pruefen() {
  local projekte="${PW_PROJEKTE:-chromium,firefox,webkit}" fehlend
  fehlend="$(PW_PRUEF_PROJEKTE="$projekte" $PNPM -C "$FE" exec node --input-type=module -e "
    import * as pw from '@playwright/test';
    import { existsSync } from 'node:fs';
    const fehlt = [];
    for (const name of process.env.PW_PRUEF_PROJEKTE.split(',')) {
      if (!['chromium', 'firefox', 'webkit'].includes(name)) {
        console.error('Unbekanntes Playwright-Projekt in PW_PROJEKTE: ' + name);
        process.exit(2);
      }
      if (!existsSync(pw[name].executablePath())) fehlt.push(name);
    }
    console.log(fehlt.join(' '));
  ")"
  if [ -n "$fehlend" ]; then
    echo "FEHLER: Playwright-Browser fehlen: $fehlend" >&2
    echo "        Installieren: mise exec -- pnpm -C frontend exec playwright install $fehlend" >&2
    echo "        Oder eine Teilmenge prüfen, z. B. PW_PROJEKTE=chromium (die CI fährt alle)." >&2
    return 1
  fi
}

schritt_7() {
  echo "==> [7/$SCHRITTE] e2e-Suite (Playwright, LFH-309)${PW_SHARD:+ (Anteil $PW_SHARD)}${PW_PROJEKTE:+ (Projekte $PW_PROJEKTE)}"
  # Pfad und Bereitschaft des Binarys: lib/backend-binaer.sh (LFH-518). Cargo baut nicht
  # zwingend nach ./target (CARGO_TARGET_DIR, build.target-dir), deshalb wird Cargo gefragt;
  # PW_BINAER übersteuert (ein e2e-Shard der CI lädt das Binary als Artefakt). Der Präfix `PW_`
  # ist Absicht — `LIFELINE_`/`KS_`/`AWS_` räumt lib/dev-env.sh als Dev-Variablen weg.
  local binaer
  # Ein vorgegebenes Binary (PW_BINAER, CI-Shard ohne Cargo) hat kein Build-Ziel zu prüfen.
  if [ -z "${PW_BINAER:-}" ]; then
    bauziel_pruefen "$ROOT"
  fi
  binaer="$(backend_binaer_pfad "$ROOT")"
  # Fehlt es ungefragt, meldet der Schritt „übersprungen" (Gesamtstatus „OK mit Lücke"), nie
  # grün; fehlt es trotz PW_BINAER oder ohne Ausführbar-Bit, ist er rot.
  backend_binaer_pruefen "$binaer"
  echo "    Backend-Binary: $binaer"
  # Die Suite startet Backend und Vite selbst auf freien Ports (auch je Shard); ein laufender
  # Dev-Stack stört nicht. Die Env-Hygiene macht die Playwright-Config selbst, damit `pnpm e2e`
  # auch ohne diesen Wrapper sauber läuft. Der Prod-Bundle wird erst hier gebaut: ohne Binary
  # liefe keine Suite.
  pw_browser_pruefen
  prod_bundle_bereitstellen
  local projekt_args=() projekte=() projekt
  if [ -n "$PW_PROJEKTE" ]; then
    IFS=',' read -ra projekte <<< "$PW_PROJEKTE"
    for projekt in "${projekte[@]}"; do projekt_args+=("--project=$projekt"); done
  fi
  # Den ermittelten Pfad weitergeben: die Suite nimmt genau das Binary, das hier geprüft wurde,
  # statt Cargo ein zweites Mal (unter `mise exec`, womöglich mit anderer Umgebung) zu fragen.
  # `${a[@]+…}`: ein leeres Array unter `set -u` bricht in Bash 3.2 (macOS) sonst ab.
  PW_BINAER="$binaer" $PNPM -C "$FE" exec playwright test ${PW_SHARD:+--shard="$PW_SHARD"} \
    ${projekt_args[@]+"${projekt_args[@]}"}
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
  echo "==> [10/$SCHRITTE] Migrationsnummern gegen den Ziel-Branch, Autofix-Selbsttest (LFH-658/1014)"
  # Erst der Selbsttest: das Prüfskript bemerkt als einzige Stelle eine eingeschobene Nummer
  # (sqlx spielt sie still nach) und irrt in beide Richtungen still.
  "$ROOT/scripts/check-migrationen.test.sh"
  # Der Autofix (LFH-1014) pusht mit einem Token, das auf `alpha` Bypass-Rechte hat; seine
  # Grenzen (nie Ziel-Branch, nur Fast-Forward, Schleifenbremse) stehen nur in diesem Test.
  "$ROOT/scripts/migrationen-autofix.test.sh"
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
  echo "==> [11/$SCHRITTE] Selbsttests des Sammel-Gates: Schrittläufer, Binary-Suche, Build-Ziel (LFH-386/518/520)"
  # Der Läufer entscheidet, ob ein roter Schritt die folgenden mitnimmt und ob ein Schritt, dessen
  # erstes Kommando scheitert, grün meldet — beides wäre still.
  "$ROOT/scripts/check-all.test.sh"
  # Die Binary-Suche entscheidet, ob Schritt 7 die Browsertests fährt oder überspringt — sucht
  # sie am falschen Ort, meldet das Gate OK mit Lücke, wo es hätte prüfen können.
  "$ROOT/scripts/backend-binaer.test.sh"
  # Die Vorbedingung von Schritt 3, 4 und 7: das Build-Ziel je Checkout (LFH-520). Sie irrt
  # ebenfalls still — ein geteiltes Ziel färbt kein Ergebnis rot, nur das falsche grün.
  "$ROOT/scripts/bauziel.test.sh"
}

schritt_12() {
  echo "==> [12/$SCHRITTE] Node und pnpm aus einer Quelle: mise.toml [tools] (LFH-773)"
  # Erst der Selbsttest, dann die Prüfung: der Guard irrt in beide Richtungen still.
  "$ROOT/scripts/check-toolversionen.test.sh"
  "$ROOT/scripts/check-toolversionen.sh"
}

schritt_13() {
  echo "==> [13/$SCHRITTE] Fertige OpenSpec-Changes sind vor dem Merge archiviert"
  # Erst der Selbsttest, dann die Prüfung: der Wächter irrt in beide Richtungen still (ließe er
  # eine fertige Change durch, bliebe ihr Spec-Sync aus; schlüge er auf eine laufende an, würde
  # er abgeschaltet).
  "$ROOT/scripts/check-openspec-archiv.test.sh"
  "$ROOT/scripts/check-openspec-archiv.sh"
}

# ── Bündel für die parallele CI ─────────────────────────────────────────────────────
# `schnell` trägt alles, was in Sekunden bis gut einer Minute fertig ist, und scheitert
# deshalb früh; die drei teuren Schritte bekommen je einen eigenen Runner.
BUENDEL_schnell="1 2 3 6 8 9 10 11 12 13"
BUENDEL_rust="4"
BUENDEL_frontend="5"
BUENDEL_e2e="7"
BUENDEL_alle="1 2 3 4 5 6 7 8 9 10 11 12 13"

# SELBSTPRÜFUNG: die vier Bündel ergeben zusammen genau die dreizehn Schritte, jeden einmal —
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
