#!/usr/bin/env bash
# Selbsttest für scripts/release/drittanbieter-quellen.sh (LFH-1000), ohne Netz: die Liste zeigt
# auf ein lokales Repository. Geprüft wird, dass das Paket Hinweis, Lizenztexte und Quelle trägt
# und dass ein umgehängter Tag den Lauf abbricht, statt still eine fremde Quelle zu packen.
set -euo pipefail

SKRIPT="$(cd "$(dirname "$0")" && pwd)/drittanbieter-quellen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

pruefe() { # <name> <bedingung als Exit-Code>
  if [ "$2" = 0 ]; then echo "  ok   $1"; else echo "  FEHL $1" >&2; fehler=1; fi
}

repo="$ARBEIT/bibliothek"
git init -q -b main "$repo"
git -C "$repo" config user.email test@example.invalid
git -C "$repo" config user.name Test
git -C "$repo" config commit.gpgsign false
echo 'int main(void) { return 0; }' > "$repo/quelle.c"
git -C "$repo" add -A
git -C "$repo" commit -q -m eins
git -C "$repo" tag v1.0.0
commit="$(git -C "$repo" rev-parse HEAD)"

# 1 · Gepinnter Stand → Hinweis und Paket mit Lizenzen und Quelle.
printf '# Kommentar\n\nbib file://%s v1.0.0 %s\n' "$repo" "$commit" > "$ARBEIT/liste.txt"
DRITTANBIETER_LISTE="$ARBEIT/liste.txt" "$SKRIPT" "$ARBEIT/aus" 9.9.9 > /dev/null
pruefe "Hinweis liegt neben den Binaries" "$([ -s "$ARBEIT/aus/lifeline-hub-9.9.9-DRITTANBIETER.txt" ]; echo $?)"
inhalt="$(unzip -Z1 "$ARBEIT/aus/lifeline-hub-9.9.9-drittanbieter.zip")"
pruefe "Paket trägt die Quelle" "$(grep -qx 'quellen/bib-v1.0.0.tar.gz' <<<"$inhalt"; echo $?)"
pruefe "Paket trägt die LGPL" "$(grep -qx 'lizenzen/libheif-LGPL-3.0.txt' <<<"$inhalt"; echo $?)"
unzip -q "$ARBEIT/aus/lifeline-hub-9.9.9-drittanbieter.zip" -d "$ARBEIT/ausgepackt"
pruefe "Archiv enthält den Quelltext" \
  "$(tar -xzOf "$ARBEIT/ausgepackt/quellen/bib-v1.0.0.tar.gz" bib-v1.0.0/quelle.c | grep -q main; echo $?)"

# 2 · Tag umgehängt → Abbruch.
echo '// neu' >> "$repo/quelle.c"
git -C "$repo" commit -qam zwei
git -C "$repo" tag -f v1.0.0 > /dev/null
rc=0
DRITTANBIETER_LISTE="$ARBEIT/liste.txt" "$SKRIPT" "$ARBEIT/aus2" 9.9.9 > /dev/null 2>&1 || rc=$?
pruefe "umgehängter Tag bricht ab" "$([ "$rc" -ne 0 ]; echo $?)"

# 3 · Leere Liste → Abbruch.
printf '# nur Kommentar\n' > "$ARBEIT/leer.txt"
rc=0
DRITTANBIETER_LISTE="$ARBEIT/leer.txt" "$SKRIPT" "$ARBEIT/aus3" 9.9.9 > /dev/null 2>&1 || rc=$?
pruefe "leere Liste bricht ab" "$([ "$rc" -ne 0 ]; echo $?)"

exit "$fehler"
