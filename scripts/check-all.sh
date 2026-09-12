#!/usr/bin/env bash
# LFH-235/F17: Sammel-Gate — die eine Durchsetzungsinstanz vor dem Merge.
#
# Vorher lagen alle Gates einzeln herum (check-fmt.sh, check-typ-codegen.sh, pnpm lint,
# pnpm typecheck, cargo test, pnpm test) und mussten von Hand einzeln aufgerufen werden.
# Bei paralleler Multi-Session-Entwicklung ist jedes Vergessen unsichtbar — Code landet
# auf main, ohne dass irgendein Gate maschinell gelaufen ist.
#
# Reihenfolge ist Absicht: erst die billigen, schnell scheiternden Prüfungen (Sekunden),
# dann die teuren Suiten (Minuten). Wer einen Formatierungsfehler hat, soll das nicht erst
# nach der Rust-Suite erfahren.
#
# Bewusst NICHT enthalten:
#  - `cargo clippy -D warnings`: der Bestand hat ~27 Warnungen (~10 distinkte Lints). Ein
#    Gate, das rot geboren wird, wird abgeschaltet statt befolgt. Erst aufräumen, dann
#    verdrahten — additiv nachrüstbar.
#
# `pnpm e2e` ist seit LFH-309 selbsttragend (startet Backend und Vite selbst) und läuft als
# Schritt 7 mit — aber NUR, wenn target/debug/lifeline-hub daliegt, sonst übersprungen mit
# lautem Hinweis statt eines harten Fehlers (Muster wie check-deps.sh bei fehlendem
# cargo-audit): die Suite kann das Binary nicht selbst bauen, ohne jeden Lauf um Minuten
# zu verlängern, und ein Gate, das auf frischem Checkout rot ist, wird abgeschaltet.
#
# In der Praxis greift der Guard hier fast nie, und das ist Absicht, kein Widerspruch:
# `cargo test --workspace` in Schritt 4 baut das bin-Target ohnehin mit (gemessen — das
# beiseitegeschobene Binary lag nach dem Lauf wieder da und e2e lief). Innerhalb dieses
# Skripts ist e2e damit faktisch immer dabei (+~30 s). Der Guard ist das Netz für alles
# andere: verkürzte Läufe, umgebaute Reihenfolge, Aufruf einzelner Schritte von Hand.
#
# Schritt 7 stellt außerdem `frontend/dist` bereit (LFH-356, `prod_bundle_bereitstellen`):
# `e2e/lagekarte-offline-precache.spec.ts` prüft, dass der maplibre-Tile-Worker offline aus dem
# Service-Worker-Precache kommt — und einen Service Worker gibt es nur im PROD-Bundle. Ohne
# diesen Build überspringt sich der Spec laut, und ein Nachweis, der nie läuft, ist keiner.
# Gebaut wird nur, wenn der Bundle fehlt oder älter ist als die Quellen (~26 s lokal).
set -euo pipefail

# Bündel-Auswahl für die parallele CI (LFH-534). OHNE Argument läuft alles wie bisher —
# das ist der Weg vor dem Merge und die Vorgabe, an der sich nichts geändert hat.
#   --nur schnell    rustfmt, Lint, Typ-Drift, Advisories,
#                    Selbsttests der Gate-Skripte            (Sekunden bis ~1:20)
#   --nur rust       cargo test --workspace                  (~17 min)
#   --nur frontend   Vitest                                  (~16 min, shardbar)
#   --nur e2e        Playwright                              (~18 min, shardbar)
# Geteilt wird über die Umgebung, nicht über weitere Flags:
#   VITEST_SHARD=1/3   PW_SHARD=2/4
NUR="alle"
while [ $# -gt 0 ]; do
  case "$1" in
    --nur)
      NUR="${2:-}"
      [ -n "$NUR" ] || { echo "FEHLER: --nur braucht ein Bündel." >&2; exit 2; }
      shift 2
      ;;
    --nur=*) NUR="${1#--nur=}"; shift ;;
    -h|--help) sed -n '31,39p' "$0"; exit 0 ;;
    *) echo "FEHLER: unbekanntes Argument '$1'." >&2; exit 2 ;;
  esac
done
VITEST_SHARD="${VITEST_SHARD:-}"
PW_SHARD="${PW_SHARD:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/dev-env.sh
. "$ROOT/scripts/lib/dev-env.sh"

FE="$ROOT/frontend"
# NODE IST GEPINNT WIE pnpm — und das ist eine Messung, keine Vorliebe (2026-09-03).
# Vorher stand hier nur die pnpm-Version; Node kam aus der globalen mise-Konfiguration
# des jeweiligen Rechners, das Gate war also je Maschine ein anderes. Beide Nachbarn
# dieser Version fallen aus, jeder auf eigene Weise:
#
#   26.8.1  Der Vite-Dev-Server stirbt mitten in Schritt 7 an einem V8-Abbruch
#           („Lazy deopt after a fast API call with return value is unsupported",
#           Stack: Buffer.byteLength ← _http_outgoing.end beim Ausliefern einer
#           ~7-MB-Antwort). Danach laufen ALLE Folgetests in ERR_CONNECTION_REFUSED
#           — gemessen 72 von 93 in einem Lauf, 3 von 93 in einem anderen, je nachdem
#           wann es ihn erwischt. Das sieht aus wie eine wandernde Flakiness und ist
#           in Wahrheit ein toter Server.
#   22.23.0 e2e läuft sauber durch, aber `src/api/kartenbilder.test.ts` bricht
#           deterministisch mit „object.stream is not a function" (@mswjs/interceptors
#           ruft .stream() auf einem Blob, den Node 22 nicht so liefert).
#
# 26.7.0 trägt beides: Vitest 3666/3666 und e2e 93/93, ohne Absturz. Wer die Zahl
# ändert, prüft BEIDE Schritte (5 und 7) — eine Version, die nur einen davon grün
# macht, ist keine.
PNPM="mise exec node@26.7.0 pnpm@11.10.0 -- pnpm"
SCHRITTE=9

# ZEITZONE FESTNAGELN (LFH-522, gemessen im ersten CI-Lauf).
# Ohne diese Zeile hängt das Ergebnis der Suite an der Zone des Rechners: `EtbFilterleiste`
# prüft, dass ein UTC-Wire-String als ORTSZEIT im Feld steht, und schreibt dafür einen festen
# Wert hin (08:00 zu 06:00Z). Auf einem UTC-Runner ist die Umrechnung die Identität, der Test
# wird rot — und zwar ohne dass sich eine Zeile Code geändert hätte. Dasselbe träfe jede
# Entwicklerin außerhalb von Mitteleuropa.
#
# Europe/Berlin ist dabei keine willkürliche Wahl, sondern die Zielumgebung: das System läuft
# auf einem Rechner im deutschen Einsatzdienst, und die Anzeigezone IST Ortszeit
# (etb/filterZeit.ts). Der harte Wert im Test bleibt damit eine echte Aussage, statt aus der
# Funktion zurückgelesen zu werden, die er prüft.
#
# Bekannte Lücke: ein alleinstehendes `pnpm test` oder `pnpm e2e` läuft nicht durch diesen
# Wrapper. Wer dort eine Zeitverschiebung sieht, sucht sie zuerst hier.
export TZ="${TZ_ERZWUNGEN:-Europe/Berlin}"
echo "==> Zeitzone für den Lauf: $TZ"

geraeumt="$(dev_env_liste | tr '\n' ' ')"
if [ -n "${geraeumt// /}" ]; then
  echo "==> Dev-Variablen werden für die Testläufe geräumt: $geraeumt"
fi

# ── Die neun Schritte, je als Funktion ──────────────────────────────────────────────
# Warum Funktionen statt einer geraden Abfolge: die CI fährt sie seit LFH-534 auf MEHREREN
# Runnern parallel und muss sie deshalb einzeln ansprechen können. Der Aufruf ohne Argument
# ist davon unberührt — er fährt weiterhin alle neun der Reihe nach, und das bleibt der
# Weg vor dem Merge.
#
# Die Nummer in der Ausgabe ist die Position im GESAMTgate, nicht im gerade laufenden
# Teilstück: wer im CI-Log „[4/7]" liest, weiß sofort, welcher Schritt das ist.

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
  echo "==> [4/$SCHRITTE] Rust-Suite (Workspace)"
  ohne_dev_env cargo test --workspace
}

schritt_5() {
  echo "==> [5/$SCHRITTE] Frontend-Suite${VITEST_SHARD:+ (Anteil $VITEST_SHARD)}"
  # --no-file-parallelism BLEIBT auch im Shard-Betrieb, und das ist kein Versehen: Sharding
  # verteilt DATEIEN über Maschinen, das Flag steuert die Nebenläufigkeit INNERHALB eines
  # Prozesses. Ohne das Flag startete jeder Shard wieder so viele Worker, wie der Runner
  # Kerne meldet — also genau die Kontention, die hier als Flakiness gemessen wurde. Die Zeit
  # kommt aus mehr Maschinen, nicht aus mehr Last je Maschine.
  local bericht=()
  if [ -n "${VITEST_SHARD:-}" ]; then
    # Im Shard-Betrieb zusätzlich ein Blob-Bericht: nur daraus lassen sich die Teilläufe
    # hinterher zu EINEM Ergebnis zusammenführen (`vitest run --merge-reports`). Ohne ihn
    # hätte man vier getrennte Ausgaben und keine Gesamtaussage.
    # ACHTUNG BEIM NACHSCHLAGEN: Vitest 4 legt die Blobs in `frontend/.vitest-reports/` ab.
    # Die aktuelle Doku auf vitest.dev zeigt bereits Vitest 5 mit `.vitest/blob/` — wer das
    # abschreibt, lädt in der CI ein leeres Verzeichnis hoch.
    bericht=(--reporter=default --reporter=blob)
  fi
  $PNPM -C "$FE" exec vitest run --no-file-parallelism "${bericht[@]}" ${VITEST_SHARD:+--shard="$VITEST_SHARD"}
}

schritt_6() {
  echo "==> [6/$SCHRITTE] Abhängigkeiten auf bekannte Schwachstellen prüfen"
  "$ROOT/scripts/check-deps.sh"
}

# Stellt frontend/dist bereit — den PROD-Bundle, den e2e/lagekarte-offline-precache.spec.ts
# braucht (LFH-356). Begründung dort im Kopf: den Service Worker und sein Precache-Manifest gibt
# es nur im Build, der Dev-Server hat beides nicht. Ausgeliefert wird der Bundle vom e2e-Backend
# selbst (rust-embed liest `frontend/dist` im Debug-Build zur Laufzeit vom Dateisystem), es
# braucht also keinen zweiten Webserver — nur die gebauten Dateien.
#
# GEBAUT WIRD NUR BEI BEDARF. Ein Bundle, das älter ist als die Quellen, prüft die Mechanik
# weiterhin ehrlich (er wird als Ganzes ausgeliefert, ist also in sich schlüssig) — was er nicht
# mehr fängt, ist eine FRISCHE Änderung, die das Precachen bricht. Genau deshalb ist die
# Veraltungsprüfung bewusst grob-konservativ: irgendeine Quelle neuer als sw.js → neu bauen.
# Lieber einmal zu oft 26 s (gemessen lokal; auf einem 2-vCPU-Runner ~1 min) als ein Gate, das
# eine gebrochene Precache-Konfiguration übersieht.
#
# Der Preis in der geteilten CI: jeder der vier e2e-Shards baut, obwohl nur einer den Spec
# fährt — welcher, steht vorher nicht fest. Sie laufen parallel, der Aufschlag auf die Laufzeit
# ist also einmal ~1 min, nicht viermal. Bewusst KEIN dist-Artefakt zwischen den Jobs: das wäre
# ein Schritt, den nur die CI kennt, und damit genau die Drift, gegen die LFH-522 den Workflow
# auf dieses Skript zurückgeführt hat.
prod_bundle_bereitstellen() {
  local sw="$FE/dist/sw.js" grund="" neuer
  if [ ! -f "$sw" ]; then
    grund="fehlt"
  else
    # Kein `-quit`/`head` (Portabilität bzw. SIGPIPE unter pipefail): die Liste wird ganz
    # gelesen und nur auf „leer oder nicht" geprüft.
    # Alles, was in den Bundle eingeht: Quellen, statische Dateien, Bau- und Typkonfiguration,
    # Abhängigkeiten. Ein fehlender Pfad ist unschädlich (stderr verworfen, `|| true`), die
    # übrigen werden weiter gelesen — die Liste darf also vorauseilend vollständig sein.
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
  # `run build` ausgeschrieben, nicht `pnpm build`: der Kurzweg hängt daran, dass pnpm keinen
  # eigenen Unterbefehl dieses Namens hat — eine Zusicherung, die von der pnpm-Version kommt.
  $PNPM -C "$FE" run build
}

schritt_7() {
  echo "==> [7/$SCHRITTE] e2e-Suite (Playwright, LFH-309)${PW_SHARD:+ (Anteil $PW_SHARD)}"
  # Cargo baut nicht zwingend nach ./target (globales build.target-dir, siehe
  # ~/.cargo/config.toml) — den Pfad deshalb von Cargo selbst erfragen.
  # JSON mit dem ohnehin benötigten Node lesen; jq ist keine Projektvoraussetzung.
  local target_dir binaer
  # PW_BINAER übersteuert die Cargo-Abfrage (LFH-534) — dieselbe Variable, die auch
  # playwright.config.ts liest. In der geteilten CI lädt ein e2e-Shard das Binary als Artefakt
  # und hat gar kein Cargo-Target-Verzeichnis; ohne die Übersteuerung müsste er die
  # Rust-Toolchain nur für diese eine Abfrage mitschleppen.
  #
  # DER NAME IST NICHT BELIEBIG, und der erste Anlauf hieß falsch: `PW_BINAER`
  # fiel unter `DEV_ENV_PRAEFIXE` in lib/dev-env.sh (^(LIFELINE|KS|AWS)_) und wurde als
  # Dev-Variable GERÄUMT — der eigene Testlauf meldete sie brav in der Räumliste. Das hätte
  # in der CI genau dann zugeschlagen, wenn ein Schritt durch `ohne_dev_env` läuft. `PW_`
  # gehört zur Playwright-Familie (PW_WORKERS, PW_SHARD) und wird nicht angefasst.
  if [ -n "${PW_BINAER:-}" ]; then
    binaer="$PW_BINAER"
  else
    target_dir="$(cargo metadata --format-version 1 --no-deps | mise exec node@26.7.0 -- node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')"
    binaer="$target_dir/debug/lifeline-hub"
  fi
  if [ -x "$binaer" ]; then
    # Die Suite startet Backend und Vite selbst auf freien Ports — ein parallel laufender
    # Dev-Stack auf 8080/5173 stört sie nicht und wird nicht gekapert. Das gilt auch je
    # Shard: jeder bringt seinen eigenen Stack auf eigenen Ports mit.
    # Env-Hygiene macht hier die Playwright-Config selbst (gleiche Präfixe wie
    # lib/dev-env.sh): Playwright merged webServer.env mit process.env, das e2e-Backend
    # erbte sonst die Dev-Umgebung. Bewusst dort statt hier, weil `pnpm e2e` laut LFH-309
    # auch alleinstehend sauber laufen muss — ohne diesen Wrapper.
    #
    # Der Prod-Bundle wird erst HIER bereitgestellt, innerhalb des Binary-Zweigs: ohne Binary
    # läuft keine Suite, und dann wäre der Build 26 s für nichts.
    prod_bundle_bereitstellen
    $PNPM -C "$FE" exec playwright test ${PW_SHARD:+--shard="$PW_SHARD"}
  elif [ -n "${PW_BINAER:-}" ]; then
    # Wer den Pfad ausdrücklich setzt, erwartet dort ein lauffähiges Binary. Hier still zu
    # überspringen hieße: die CI meldet einen grünen e2e-Schritt, der nie gelaufen ist —
    # und genau das passiert, wenn actions/upload-artifact das Ausführbar-Bit verliert
    # (es zippt ohne Dateirechte, alles kommt als 644 zurück).
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
  fi
}

schritt_8() {
  echo "==> [8/$SCHRITTE] Ruhefenster vor dem Release (Selbsttest)"
  # Im `schnell`-Bündel und nicht bei den teuren Suiten: der Test baut ein paar
  # Temp-Repositories und ist in rund vier Sekunden durch. Er prüft NICHT das Release
  # selbst, sondern die Entscheidung, ob ein Lauf releasen darf — und die ist in beide
  # Richtungen still (Begründung im Kopf des Testskripts).
  "$ROOT/scripts/release-ruhefenster.test.sh"
}

schritt_9() {
  echo "==> [9/$SCHRITTE] Advisory-Gate liest das Lockfile (Selbsttest, LFH-316)"
  # Neben Schritt 6, nicht in ihm: Schritt 6 fragt die Advisory-Datenbank und ist damit
  # netzabhängig und über die Zeit veränderlich. Dieser hier fragt, WORAUF Schritt 6
  # schaut — ohne Netz, in rund einer Sekunde. Er gehört ins `schnell`-Bündel, weil sein
  # Fehlerbild still ist: ein Gate, das eine Teilmenge prüft, meldet „OK" wie eines, das
  # alles geprüft hat.
  "$ROOT/scripts/check-deps.test.sh"
}

# ── Bündel für die parallele CI ─────────────────────────────────────────────────────
# `schnell` trägt alles, was in Sekunden bis gut einer Minute fertig ist, und scheitert
# deshalb früh; die drei teuren Schritte bekommen je einen eigenen Runner.
BUENDEL_schnell="1 2 3 6 8 9"
BUENDEL_rust="4"
BUENDEL_frontend="5"
BUENDEL_e2e="7"
BUENDEL_alle="1 2 3 4 5 6 7 8 9"

# SELBSTPRÜFUNG: die vier Bündel müssen ZUSAMMEN genau die neun Schritte ergeben — jeden
# genau einmal. Ohne diese Zeile fiele beim Umsortieren still ein Schritt aus der CI heraus,
# und niemand sähe es: die Jobs blieben grün, nur geprüft würde weniger. Das ist teurer als
# ein roter Lauf.
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

for n in $lauf; do
  "schritt_$n"
done

echo
if [ "$NUR" = alle ]; then
  echo "==> OK: alle Gates grün."
else
  echo "==> OK: Bündel '$NUR' grün (Schritte: $lauf von $SCHRITTE)."
  echo "    Das ist ein TEILSTÜCK. Vor dem Merge gilt der volle Lauf ohne --nur."
fi
