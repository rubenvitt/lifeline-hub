#!/usr/bin/env bash
# Karenzzeit der npm-Abhängigkeiten (LLH-1884). pnpm 11 lehnt beim Install jedes Lockfile ab, das
# ein Paket führt, das jünger als `minimumReleaseAge` ist. Cloudflare baut die Website mit genau
# dieser Regel; die PR-CI installiert aber nur `frontend/`, und so mergte am 13.11.2026 ein
# Dependabot-Bump, an dem danach jeder Vorschau-Bau scheiterte. Dieser Schritt stellt dieselbe
# Frage für alle drei Pakete (`website/`, `frontend/`, Wurzelpaket) an jedem PR.
#
# Das Urteil fällt pnpm selbst (`install --frozen-lockfile --lockfile-only`: prüft das Lockfile
# gegen die Regeln, lädt kein Paket, braucht aber Netz für die Veröffentlichungszeiten). Keine
# nachgebaute Zeitprüfung: sie wiche bei `minimumReleaseAgeExclude` oder einem pnpm-Update von
# der Regel ab, die Cloudflare anwendet.
#
# Geprüft wird der committete Stand, nicht der installierte Baum (dasselbe Muster wie
# scripts/check-deps.sh): je Paket eine Kopie von Manifest, Lockfile und pnpm-workspace.yaml in
# einem Wegwerf-Verzeichnis außerhalb des Arbeitsbaums.
#
# Zeitabhängig wie die Advisories: derselbe Commit ist rot, solange ein Paket zu jung ist, und
# wird danach von selbst grün. Die Karenzzeit wird dafür NICHT gelockert und es kommt keine
# Ausnahme dazu; der Lauf wird neu gestartet (scripts/AGENTS.md, „Karenzzeit“).
# Selbsttest ohne Netz: scripts/check-karenzzeit.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Node und pnpm aus `[tools]` in mise.toml (LFH-773). pnpm läuft mit `-C` in der Kopie, mise
# selbst aber hier im Repo — sonst fände es die mise.toml nicht.
PNPM="mise exec -- pnpm"

# Die Karenzzeit in Minuten; dieselbe Zahl steht in jeder pnpm-workspace.yaml.
KARENZ_MINUTEN=1440

# Paketverzeichnis relativ zur Wurzel („." ist das Wurzelpaket mit semantic-release).
PAKETE=(website frontend .)
DATEIEN=(package.json pnpm-lock.yaml pnpm-workspace.yaml)

anzeige() { # <paket> <datei> -> Pfad relativ zur Wurzel
  if [ "$1" = . ]; then printf '%s\n' "$2"; else printf '%s/%s\n' "$1" "$2"; fi
}

# Veröffentlichung (ISO 8601, UTC) plus Karenzzeit, als ISO 8601 ohne Sekundenbruchteil.
# GNU date und BSD date (macOS) verstehen verschiedene Optionen; gelingt beides nicht, bleibt
# die Zeile ohne Zeitpunkt.
alt_genug_ab() { # <zeitstempel>
  local ts="${1%%.*}" sek
  ts="${ts%Z}"
  if sek="$(date -u -d "${ts}Z" +%s 2>/dev/null)"; then :
  elif sek="$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s 2>/dev/null)"; then :
  else return 1
  fi
  sek=$((sek + KARENZ_MINUTEN * 60))
  date -u -d "@$sek" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$sek" +%Y-%m-%dT%H:%M:%SZ
}

# Vorab: jede Datei da und die Karenzzeit ausdrücklich gesetzt. Fehlt die Einstellung, gilt
# still die Vorgabe der pnpm-Version, und ein pnpm-Update änderte die Regel ohne Diff. Fehlt
# eine Datei, prüfte der Schritt eine Teilmenge und meldete trotzdem „OK".
vorab=0
for paket in "${PAKETE[@]}"; do
  for datei in "${DATEIEN[@]}"; do
    if [ ! -f "$ROOT/$paket/$datei" ]; then
      echo "FEHLER: $(anzeige "$paket" "$datei") fehlt — die Karenzzeit lässt sich nicht prüfen." >&2
      vorab=1
    fi
  done
  ws="$ROOT/$paket/pnpm-workspace.yaml"
  if [ -f "$ws" ] && ! grep -Eq "^minimumReleaseAge:[[:space:]]*${KARENZ_MINUTEN}[[:space:]]*(#.*)?$" "$ws"; then
    echo "FEHLER: $(anzeige "$paket" pnpm-workspace.yaml) setzt nicht 'minimumReleaseAge: $KARENZ_MINUTEN'." >&2
    echo "        Die Karenzzeit steht in jedem Paket ausdrücklich und wird nicht gesenkt." >&2
    vorab=1
  fi
done
if [ "$vorab" -ne 0 ]; then
  exit 1
fi

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

rot=0
for paket in "${PAKETE[@]}"; do
  lockfile="$(anzeige "$paket" pnpm-lock.yaml)"
  echo "    → $lockfile"
  kopie="$ARBEIT/$(printf '%s' "$paket" | tr './' '_-')"
  mkdir -p "$kopie"
  for datei in "${DATEIEN[@]}"; do
    cp "$ROOT/$paket/$datei" "$kopie/$datei"
  done

  rc=0
  $PNPM -C "$kopie" install --frozen-lockfile --lockfile-only > "$kopie.log" 2>&1 || rc=$?
  sed 's/^/      /' "$kopie.log"
  [ "$rc" -eq 0 ] && continue

  rot=1
  # Die Zeilen von pnpm 11: „  <paket>@<version> was published at <zeit>, within the …".
  verstoesse="$(sed -n 's/^[[:space:]]*\([^[:space:]]*@[^[:space:]]*\) was published at \([^,]*\),.*/\1 \2/p' "$kopie.log")"
  if [ -z "$verstoesse" ]; then
    echo "FEHLER: pnpm lehnt $lockfile ab (Exit $rc), ohne ein zu junges Paket zu nennen." >&2
    echo "        Ausgabe oben; bei einem Netzfehler den Lauf neu starten." >&2
    continue
  fi
  echo >&2
  echo "FEHLER: $lockfile führt Pakete, die jünger als die Karenzzeit ($KARENZ_MINUTEN min) sind:" >&2
  while read -r name zeit; do
    if ab="$(alt_genug_ab "$zeit")"; then
      echo "        - $name, veröffentlicht $zeit, alt genug ab $ab" >&2
    else
      echo "        - $name, veröffentlicht $zeit (+ $KARENZ_MINUTEN min)" >&2
    fi
  done <<< "$verstoesse"
  echo "        Den Lauf danach neu starten. Die Karenzzeit nicht lockern und keine Ausnahme" >&2
  echo "        eintragen: Cloudflare baut die Website mit derselben Regel." >&2
done

if [ "$rot" -ne 0 ]; then
  exit 1
fi
echo "==> OK: kein Lockfile führt ein Paket, das jünger als $KARENZ_MINUTEN Minuten ist."
