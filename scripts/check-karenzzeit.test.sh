#!/usr/bin/env bash
# Selbsttest für scripts/check-karenzzeit.sh (LLH-1884). Dessen Fehlerbild ist STILL: lässt es
# ein Paket aus oder verschluckt es den Exit-Code von pnpm, meldet es „OK", und das zu junge
# Paket fällt wieder erst bei Cloudflare auf. Gemessen wird deshalb ohne Netz, WAS geprüft wird
# und OB das Urteil von pnpm durchschlägt; `mise` ist eine aufzeichnende Attrappe.
#
# Die schärferen Hälften sind die NEGATIVEN: „die Kopie sieht node_modules NICHT", „ein
# Verstoß bricht" und „ohne Einstellung läuft pnpm gar nicht erst".
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-karenzzeit.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

enthaelt() { # <datei> <text> -> ja|nein
  if grep -qF -- "$2" "$1" 2>/dev/null; then echo ja; else echo nein; fi
}

# Ein Repo-Skelett: das Skript unter Test plus die drei Pakete mit je Manifest, Lockfile und
# pnpm-workspace.yaml. Der Paketname in package.json sagt der Attrappe, welches Paket sie prüft.
repo_neu() { # <name> -> pfad
  local pfad="$ARBEIT/$1" paket name
  mkdir -p "$pfad/scripts" "$pfad/bin"
  cp "$SKRIPT_UNTER_TEST" "$pfad/scripts/check-karenzzeit.sh"
  for paket in . frontend website; do
    case "$paket" in .) name=wurzel ;; *) name="$paket" ;; esac
    mkdir -p "$pfad/$paket"
    printf '{"name":"%s","version":"0.0.0","private":true}\n' "$name" > "$pfad/$paket/package.json"
    printf "lockfileVersion: '9.0'\n" > "$pfad/$paket/pnpm-lock.yaml"
    printf 'allowBuilds:\n  esbuild: true\n\nminimumReleaseAge: 1440\n' > "$pfad/$paket/pnpm-workspace.yaml"
  done
  # Ein lokales node_modules, das die Prüfung nicht sehen darf.
  mkdir -p "$pfad/website/node_modules/.pnpm"

  # Attrappe für `mise exec -- pnpm -C <dir> install …`: protokolliert Paket, Argumente und
  # den Inhalt der Kopie. Für das Paket in STUB_ZU_JUNG gibt sie die Meldung von pnpm 11 aus und
  # endet mit 1; für das Paket in STUB_NETZ endet sie mit 1 ohne Paketzeile.
  cat > "$pfad/bin/mise" <<'MISE'
#!/usr/bin/env bash
[ "${1:-}" = exec ] && shift
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift || true
dir=""; vorher=""
for a in "$@"; do [ "$vorher" = "-C" ] && dir="$a"; vorher="$a"; done
name="$(sed -n 's/.*"name":"\([^"]*\)".*/\1/p' "$dir/package.json" 2>/dev/null)"
printf '%s|%s\n' "$name" "$*" >> "$PROTOKOLL/aufrufe"
{
  echo "dir=$dir"
  echo "inhalt=$(ls -A "$dir" | sort | tr '\n' ' ')"
  case "$dir" in "$REPO_UNTER_TEST"/*) echo "im_repo=JA" ;; *) echo "im_repo=NEIN" ;; esac
} > "$PROTOKOLL/befund-$name"
if [ "$name" = "${STUB_ZU_JUNG:-}" ]; then
  echo "✗ Lockfile failed supply-chain policy check (425 entries in 734ms)"
  echo "[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:"
  echo "  mdast-util-to-hast@13.2.2 was published at 2026-11-13T12:35:32.398Z, within the minimumReleaseAge cutoff (2026-11-13T09:20:56.888Z)"
  exit 1
fi
if [ "$name" = "${STUB_NETZ:-}" ]; then
  echo "[ERR_PNPM_META_FETCH_FAIL] GET https://registry.npmjs.org/astro: request failed"
  exit 1
fi
echo "✓ Lockfile passes supply-chain policies (407 entries in 870ms)"
exit 0
MISE
  chmod +x "$pfad/bin/mise"
  printf '%s\n' "$pfad"
}

# Führt das Skript im Skelett aus und gibt seinen Exit-Code aus. Der Befund landet in
# $PROTOKOLL und wird von den Fällen danach gelesen.
lauf() { # <repo> [env-zuweisungen...] -> gibt den Exit-Code aus
  local pfad="$1"; shift
  PROTOKOLL="$pfad/protokoll"
  rm -rf "$PROTOKOLL"; mkdir -p "$PROTOKOLL"
  local rc=0
  env PATH="$pfad/bin:$PATH" PROTOKOLL="$PROTOKOLL" REPO_UNTER_TEST="$pfad" "$@" \
      "$pfad/scripts/check-karenzzeit.sh" > "$PROTOKOLL/ausgabe" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

befund() { # <repo> <paket> <schluessel>
  sed -n "s/^$3=//p" "$1/protokoll/befund-$2" 2>/dev/null || true
}

aufruf() { # <repo> <paket> -> Argumente des pnpm-Aufrufs für dieses Paket
  sed -n "s/^$2|//p" "$1/protokoll/aufrufe" 2>/dev/null || true
}

echo "==> Selbsttest check-karenzzeit.sh"

# 1 — Alle drei Pakete werden geprüft, jedes mit der Install-Prüfung ohne Download. Fehlt eines,
# fiele ein zu junges Paket dort erst bei Cloudflare (Website) oder im Release (Wurzel) auf.
r="$(repo_neu gruen)"
rc="$(lauf "$r")"
pruefe "alle alt genug: grün" "0" "$rc"
for paket in wurzel frontend website; do
  args="$(aufruf "$r" "$paket")"
  pruefe "$paket wird geprüft" "ja" "$([ -n "$args" ] && echo ja || echo nein)"
  pruefe "$paket: install --frozen-lockfile --lockfile-only" "ja" \
    "$(case "$args" in *"install --frozen-lockfile --lockfile-only"*) echo ja ;; *) echo nein ;; esac)"
  pruefe "$paket: geprüft wird außerhalb des Arbeitsbaums" "NEIN" "$(befund "$r" "$paket" im_repo)"
  pruefe "$paket: die Kopie enthält genau die drei Dateien" \
    "package.json pnpm-lock.yaml pnpm-workspace.yaml " "$(befund "$r" "$paket" inhalt)"
done

# 2 — Das Wegwerf-Verzeichnis bleibt nicht liegen.
verz="$(befund "$r" website dir)"
pruefe "das Wegwerf-Verzeichnis ist danach weg" "WEG" "$([ -e "$verz" ] && echo DA || echo WEG)"

# 3 — Ein Verstoß schlägt durch, und die übrigen Pakete werden trotzdem geprüft.
r="$(repo_neu zu_jung)"
rc="$(lauf "$r" STUB_ZU_JUNG=website)"
pruefe "zu junges Paket in der Website: rot" "1" "$rc"
pruefe "zu junges Paket: das Frontend wird trotzdem geprüft" "ja" \
  "$([ -n "$(aufruf "$r" frontend)" ] && echo ja || echo nein)"
rc="$(lauf "$r" STUB_ZU_JUNG=wurzel)"
pruefe "zu junges Paket im Wurzelpaket: rot" "1" "$rc"

# 4 — Die Meldung sagt, was zu tun ist: Paket, Lockfile, ab wann, neu starten, nicht lockern.
rc="$(lauf "$r" STUB_ZU_JUNG=website)"
aus="$r/protokoll/ausgabe"
pruefe "Meldung nennt das Paket" "ja" "$(enthaelt "$aus" 'mdast-util-to-hast@13.2.2')"
# Die Fortschrittszeile „→ website/pnpm-lock.yaml" steht in jedem Lauf; geprüft wird die
# FEHLER-Zeile selbst.
pruefe "Meldung nennt das Lockfile" "ja" "$(enthaelt "$aus" 'FEHLER: website/pnpm-lock.yaml führt')"
pruefe "Meldung nennt den Zeitpunkt, ab dem es alt genug ist" "ja" \
  "$(enthaelt "$aus" '2026-11-14T12:35:32Z')"
pruefe "Meldung sagt: Lauf neu starten" "ja" "$(enthaelt "$aus" 'neu starten')"
pruefe "Meldung sagt: Karenzzeit nicht lockern" "ja" "$(enthaelt "$aus" 'nicht lockern')"

# 5 — Ein Fehler ohne Paketzeile (Netz) bleibt rot und wird nicht als Verstoß ausgegeben.
r="$(repo_neu netz)"
rc="$(lauf "$r" STUB_NETZ=frontend)"
pruefe "Netzfehler: rot" "1" "$rc"
pruefe "Netzfehler: kein erfundener Zeitpunkt" "nein" "$(enthaelt "$r/protokoll/ausgabe" 'alt genug ab')"
pruefe "Netzfehler: die Ausgabe von pnpm steht da" "ja" \
  "$(enthaelt "$r/protokoll/ausgabe" 'ERR_PNPM_META_FETCH_FAIL')"

# 6 — Fehlt eine Datei, wird laut abgebrochen, bevor pnpm läuft.
r="$(repo_neu ohne_lockfile)"; rm "$r/website/pnpm-lock.yaml"
rc="$(lauf "$r")"
pruefe "fehlendes Lockfile: rot" "1" "$rc"
pruefe "fehlendes Lockfile: pnpm läuft gar nicht erst" "nein" \
  "$([ -e "$r/protokoll/aufrufe" ] && echo ja || echo nein)"
pruefe "fehlendes Lockfile: Meldung nennt die Datei" "ja" \
  "$(enthaelt "$r/protokoll/ausgabe" 'website/pnpm-lock.yaml')"

# 7 — Fehlt die Einstellung oder ist sie kleiner, gälte still die Vorgabe der pnpm-Version.
r="$(repo_neu ohne_einstellung)"
printf 'allowBuilds:\n  esbuild: true\n' > "$r/frontend/pnpm-workspace.yaml"
rc="$(lauf "$r")"
pruefe "fehlende Einstellung: rot" "1" "$rc"
pruefe "fehlende Einstellung: pnpm läuft gar nicht erst" "nein" \
  "$([ -e "$r/protokoll/aufrufe" ] && echo ja || echo nein)"
pruefe "fehlende Einstellung: Meldung nennt die Datei" "ja" \
  "$(enthaelt "$r/protokoll/ausgabe" 'frontend/pnpm-workspace.yaml')"
printf 'minimumReleaseAge: 720\n' > "$r/frontend/pnpm-workspace.yaml"
rc="$(lauf "$r")"
pruefe "gesenkte Einstellung (720): rot" "1" "$rc"
printf '# minimumReleaseAge: 1440\n' > "$r/frontend/pnpm-workspace.yaml"
rc="$(lauf "$r")"
pruefe "auskommentierte Einstellung: rot" "1" "$rc"

echo
if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fehler im Selbsttest von check-karenzzeit.sh." >&2
  exit 1
fi
echo "==> OK: check-karenzzeit.sh prüft alle drei Lockfiles, und ein Verstoß bricht."
