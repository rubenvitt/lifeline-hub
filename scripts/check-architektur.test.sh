#!/usr/bin/env bash
# Selbsttest für scripts/check-architektur.sh und den Musterabgleich in scripts/lib/adr.sh
# (LLH-1435). Der Wächter irrt in beide Richtungen still: ließe er ein fehlendes Modul, eine
# gebrochene Entscheidung oder einen toten Link durch, veraltete die Doku unbemerkt; schlüge er
# auf eine gültige Doku an, würde er abgeschaltet. `adr-fuer.sh` nennt mit einem falschen
# Abgleich einem Agenten die falschen Regeln.
#
# Gefahren gegen ein Wegwerf-Git-Repo im Temp-Verzeichnis, je Fall frisch aufgebaut.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
SKRIPT_UNTER_TEST="$SKRIPTE/check-architektur.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

schreibe() { # <pfad> <inhalt>
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" > "$1"
}

adr_text() { # <id> <status> <muster> <pruefung> [<regel>]
  printf -- '---\nid: %s\ntitel: Beispiel\nstatus: %s\ndatum: 2026-10-23\ngilt_fuer:\n  - %s\n---\n\n# %s: Beispiel\n\n## Regeln\n\n%s\n\n## Prüfung\n\n%s\n\n## Kontext\n\nKurz.\n\n## Konsequenzen\n\nKurz.\n' \
    "$1" "$2" "$3" "$1" "${5:-- MUST über src/live gehen.}" "$4"
}

PRUEF_GRUEN='```sh
verlange "^pub fn senden" "src/live/**"
verbiete "WebSocket" "src/**/*.rs"
```'

baum_neu() { # <name> → Pfad eines grünen Repos
  local b="$ARBEIT/$1"
  mkdir -p "$b"
  (
    cd "$b"
    git init -q
    schreibe src/live/mod.rs 'pub fn senden() {}'
    schreibe src/config.rs '// Konfiguration'
    schreibe src/etb/mod.rs '// ETB'
    schreibe src/AGENTS.md '# Regeln'
    schreibe frontend/src/offline/queue.ts 'export {};'
    schreibe frontend/src/App.tsx 'export {};'
    schreibe crates/katalog/Cargo.toml '[package]'
    schreibe website/package.json '{}'
    local nr
    for nr in 01 02 03 04 06 07 08 10 11 12; do
      schreibe "docs/architektur/$nr-kapitel.md" "# $nr"
    done
    schreibe docs/architektur/05-bausteinsicht.md '# 5. Bausteinsicht

| `src/live` | Live-Kanal |
| `src/config.rs` | Konfiguration |
| `src/etb` | ETB |
| `frontend/src/offline` | ohne Netz |
| `crates/katalog`, `website` | Teilprojekte |

[Zurück](README.md) · [extern](https://example.org/x) · [Anker](#oben)

```text
[im Codeblock](gibt-es-nicht.md)
```'
    schreibe docs/architektur/README.md '# Architektur'
    schreibe docs/architektur/09-entscheidungen.md '# 9.

- [ADR-0001](entscheidungen/ADR-0001-live.md)'
    schreibe docs/architektur/entscheidungen/ADR-0001-live.md "$(adr_text ADR-0001 akzeptiert 'src/live/**' "$PRUEF_GRUEN")"
    schreibe docs/architektur/entscheidungen/VORLAGE.md 'keine ADR'
    git add -A
  )
  printf '%s\n' "$b"
}

fall() { # <name> <erwartet: gruen|rot> <befehl, der das Repo $B verändert> [<muster>…]
  local B name="$1" soll="$2" befehl="$3"
  shift 3
  B="$(baum_neu "$(printf '%s' "$name" | tr -c '[:alnum:]' '_')")"
  (cd "$B" && eval "$befehl")
  local ist=gruen
  "$SKRIPT_UNTER_TEST" "$B" > "$ARBEIT/ausgabe" 2>&1 || ist=rot
  if [ "$ist" != "$soll" ]; then
    echo "  FEHL $name — erwartet $soll, gemessen $ist:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
    return 0
  fi
  local muster
  for muster in "$@"; do
    if ! grep -qF -- "$muster" "$ARBEIT/ausgabe"; then
      echo "  FEHL $name — '$muster' fehlt in der Ausgabe:" >&2
      sed 's/^/         /' "$ARBEIT/ausgabe" >&2
      fehler=$((fehler + 1))
      return 0
    fi
  done
  echo "  ok   $name"
}

ADR=docs/architektur/entscheidungen/ADR-0001-live.md

echo "==> check-architektur.sh"
fall 'gültige Doku' gruen ':' 'OK:' '1 ADR-Prüfungen grün'
fall 'Kapitel fehlt' rot 'git rm -qf docs/architektur/07-kapitel.md' '07-*.md: 0 Dateien'
fall 'Kapitel doppelt' rot 'schreibe docs/architektur/07-zweites.md x' '07-*.md: 2 Dateien'
fall 'neues Backend-Modul ohne Zeile in Kapitel 5' rot 'schreibe src/neu/mod.rs x' 'nennt `src/neu` nicht'
fall 'neue Rust-Datei ohne Zeile in Kapitel 5' rot 'schreibe src/zeit.rs x' 'nennt `src/zeit.rs` nicht'
fall 'Namensvorsilbe zählt nicht (src/etb_baustein nennt src/etb nicht)' rot 'schreibe src/etb_baustein/mod.rs x; sed -i.bak "s#\`src/etb\` | ETB#\`src/etb_baustein\` | Bausteine#" docs/architektur/05-bausteinsicht.md' 'nennt `src/etb` nicht'
fall 'Namenszusatz zählt nicht (src/etb nennt src/etb_baustein nicht)' rot 'schreibe src/etb_baustein/mod.rs x' 'nennt `src/etb_baustein` nicht'
fall 'Frontend-Pfad zählt nicht fürs Backend' rot 'schreibe src/offline/mod.rs x' 'nennt `src/offline` nicht'
fall 'neues Frontend-Verzeichnis ohne Zeile' rot 'schreibe frontend/src/druck/a.ts x' 'nennt `frontend/src/druck` nicht'
fall 'neues Crate ohne Zeile' rot 'schreibe crates/neu/Cargo.toml x' 'nennt `crates/neu` nicht'
fall 'Teilprojekt ohne Zeile' rot 'schreibe karten-service/Cargo.toml x' 'nennt `karten-service` nicht'
fall 'Dateien im Wurzelverzeichnis des Frontends brauchen keine Zeile' gruen 'schreibe frontend/src/main.tsx x'
fall 'ignorierte Dateien zählen nicht' gruen 'schreibe .gitignore "src/tmp/"; schreibe src/tmp/a.rs x'
fall 'ADR: Prüfung scheitert' rot 'schreibe src/live/ws.rs "use WebSocket;"' 'ADR-0001-live.md: Prüfung scheitert' 'verboten: WebSocket'
fall 'ADR: Prüfung scheitert, wenn Verlangtes fehlt' rot 'schreibe src/live/mod.rs "pub fn anders() {}"' 'fehlt: ^pub fn senden'
fall 'ADR vorgeschlagen: Prüfung läuft nicht' gruen "schreibe $ADR \"\$(adr_text ADR-0001 vorgeschlagen 'src/live/**' '\`\`\`sh
false
\`\`\`')\"" '0 ADR-Prüfungen'
fall 'ADR: manuell statt Prüfblock' gruen "schreibe $ADR \"\$(adr_text ADR-0001 akzeptiert 'src/live/**' 'manuell: Entwurfsregel ohne Code-Muster.')\"" '1 manuell'
fall 'ADR: Prüfung fehlt' rot "schreibe $ADR \"\$(adr_text ADR-0001 akzeptiert 'src/live/**' 'Später.')\"" 'braucht einen ```sh-Block'
fall 'ADR: id passt nicht zum Dateinamen' rot "schreibe $ADR \"\$(adr_text ADR-0002 akzeptiert 'src/live/**' \"\$PRUEF_GRUEN\")\"" "id 'ADR-0002' passt nicht"
fall 'ADR: id doppelt' rot "cp $ADR docs/architektur/entscheidungen/ADR-0001-zwei.md" "ist doppelt vergeben"
fall 'ADR: Status unbekannt' rot "schreibe $ADR \"\$(adr_text ADR-0001 gilt 'src/live/**' \"\$PRUEF_GRUEN\")\"" "status 'gilt' unbekannt"
fall 'ADR: ersetzt ohne Nachfolger' rot "schreibe $ADR \"\$(adr_text ADR-0001 ersetzt 'src/live/**' \"\$PRUEF_GRUEN\")\"" "braucht ersetzt_durch"
fall 'ADR: Muster trifft keine Datei' rot "schreibe $ADR \"\$(adr_text ADR-0001 akzeptiert 'src/weg/**' \"\$PRUEF_GRUEN\")\"" "gilt_fuer 'src/weg/**' trifft keine Datei"
fall 'ADR: Regeln ohne MUST/SHOULD' rot "schreibe $ADR \"\$(adr_text ADR-0001 akzeptiert 'src/live/**' \"\$PRUEF_GRUEN\" '- Man sollte.')\"" "keine Zeile '- MUST"
fall 'ADR: zu lang' rot "for i in \$(seq 1 80); do echo 'Zeile' >> $ADR; done" 'höchstens 80'
fall 'ADR: Kopf fehlt' rot "sed -i.bak 1d $ADR" 'Kopf fehlt'
fall 'ADR fehlt in Kapitel 9' rot 'schreibe docs/architektur/09-entscheidungen.md "# 9."' 'nennt ADR-0001 nicht'
fall 'toter Link' rot 'echo "[weg](gibt-es-nicht.md)" >> docs/architektur/README.md' "Link 'gibt-es-nicht.md' löst nicht auf"
fall 'Link mit Anker auf bestehende Datei' gruen 'echo "[fünf](05-bausteinsicht.md#ebene-1)" >> docs/architektur/README.md'

echo "==> adr_muster_trifft (scripts/lib/adr.sh)"
# shellcheck source=lib/adr.sh
. "$SKRIPTE/lib/adr.sh"
muster() { # <ja|nein> <muster> <pfad>
  local ist=nein
  adr_muster_trifft "$2" "$3" && ist=ja
  if [ "$ist" = "$1" ]; then
    echo "  ok   '$2' ~ '$3' → $1"
  else
    echo "  FEHL '$2' ~ '$3' — erwartet $1, gemessen $ist" >&2
    fehler=$((fehler + 1))
  fi
}
muster ja 'src/**/*.rs' 'src/main.rs'
muster ja 'src/**/*.rs' 'src/live/hub/mod.rs'
muster nein 'src/**/*.rs' 'frontend/src/a.rs'
muster ja 'src/live/**' 'src/live/mod.rs'
muster nein 'src/live/**' 'src/livehub.rs'
muster ja '**/AGENTS.md' 'AGENTS.md'
muster ja '**/AGENTS.md' 'frontend/src/etb/AGENTS.md'
muster nein 'frontend/src/*.ts' 'frontend/src/offline/queue.ts'
muster ja 'frontend/src/*.ts' 'frontend/src/main.ts'
muster nein 'src/a.b/*.rs' 'src/aXb/c.rs'
muster ja 'src/[ab].rs' 'src/a.rs'
muster ja 'frontend/src/offline' 'frontend/src/offline/queue.ts'
muster ja 'src/config.rs' './src/config.rs'
muster nein 'src/config.rs' 'src/config.rs.bak'

if [ "$fehler" -gt 0 ]; then
  echo "Selbsttest check-architektur: $fehler Fehler." >&2
  exit 1
fi
echo "OK: Selbsttest check-architektur grün."
