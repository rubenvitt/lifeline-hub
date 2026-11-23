#!/usr/bin/env bash
# Selbsttest für scripts/lib/schritte.sh, den Schrittläufer des Sammel-Gates (LFH-386).
#
# Der Läufer irrt in beide Richtungen still: bricht er beim ersten roten Schritt ab, laufen die
# Schritte dahinter nie (so fielen Advisories und e2e aus dem Vollauf, solange Vitest rot war);
# verliert er dabei `set -e` innerhalb eines Schritts, meldet ein Schritt grün, dessen erstes
# Kommando scheiterte. Gefahren mit Attrappen-Schritten statt der echten Suiten.
set -euo pipefail

LIB="$(cd "$(dirname "$0")" && pwd)/lib/schritte.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# Fährt <schritte…> mit den Attrappen aus <definitionen> in einer frischen Shell unter
# `set -euo pipefail`, wie check-all.sh. Ausgabe nach $ARBEIT/aus, Exit-Code als Rückgabe.
fahren() { # <definitionen> <abbrechen:0|1> <schritte…>
  local defs="$1" abbrechen="$2"
  shift 2
  set +e
  bash -c '
    set -euo pipefail
    . "$1"
    eval "$2"
    SCHRITTE=9
    abbrechen="$3"
    shift 3
    schritte_fahren "$abbrechen" "$@"
    schritte_bericht
  ' _ "$LIB" "$defs" "$abbrechen" "$@" > "$ARBEIT/aus" 2>&1
  local rc=$?
  set -e
  return "$rc"
}

pruefe() { # <name> <soll-exit> <ist-exit>
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1: Exit $3, erwartet $2" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
    fehler=1
  fi
}

enthaelt() { # <name> <muster>
  if grep -qE -- "$2" "$ARBEIT/aus"; then
    echo "ok   $1"
  else
    echo "FAIL $1: '$2' fehlt in der Ausgabe" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
    fehler=1
  fi
}

fehlt() { # <name> <muster>
  if grep -qE -- "$2" "$ARBEIT/aus"; then
    echo "FAIL $1: '$2' steht in der Ausgabe" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
    fehler=1
  else
    echo "ok   $1"
  fi
}

GRUEN='schritt_1() { echo lief-1; }; schritt_2() { echo lief-2; }'

# 1 — alles grün: Exit 0, Gesamtstatus grün.
rc=0; fahren "$GRUEN" 0 1 2 || rc=$?
pruefe "1 alles grün → Exit 0" 0 "$rc"
enthaelt "1 Gesamtstatus nennt grün" '^==> OK'

# 2 — der Kern von LFH-386: ein roter Schritt hält die folgenden NICHT auf.
rc=0; fahren 'schritt_1() { echo lief-1; false; }; schritt_2() { echo lief-2; }' 0 1 2 || rc=$?
pruefe "2 roter Schritt → Exit 1" 1 "$rc"
enthaelt "2 Schritt 2 läuft nach rotem Schritt 1" '^lief-2$'
enthaelt "2 Bericht nennt Schritt 1 rot" '\[1/9\] +ROT'
enthaelt "2 Bericht nennt Schritt 2 grün" '\[2/9\] +grün'
enthaelt "2 Schlusszeile rot" '^==> ROT'

# 3 — `set -e` gilt INNERHALB eines Schritts weiter: das erste scheiternde Kommando beendet
# ihn, das zweite läuft nicht und überschreibt den Status nicht mit grün. (Die Falle: ein
# Funktionsaufruf in `if`/`||` schaltet errexit für den ganzen Körper ab.)
rc=0; fahren 'schritt_1() { false; echo zweites-kommando; }' 0 1 || rc=$?
pruefe "3 erstes Kommando rot → Schritt rot" 1 "$rc"
fehlt "3 zweites Kommando läuft nicht" '^zweites-kommando$'

# 4 — pipefail gilt im Schritt.
rc=0; fahren 'schritt_1() { false | true; }' 0 1 || rc=$?
pruefe "4 rote Pipe-Stufe → Schritt rot" 1 "$rc"

# 5 — `exit` im Schritt beendet nur den Schritt.
rc=0; fahren 'schritt_1() { exit 3; }; schritt_2() { echo lief-2; }' 0 1 2 || rc=$?
pruefe "5 exit im Schritt → Exit 1" 1 "$rc"
enthaelt "5 Läufer überlebt exit, Schritt 2 läuft" '^lief-2$'
enthaelt "5 Bericht nennt den Exit-Code" '\[1/9\] +ROT \(Exit 3\)'

# 6 — übersprungen ist weder grün noch rot: Exit 0, aber ausdrücklich als Lücke benannt.
rc=0; fahren 'schritt_1() { return "$UEBERSPRUNGEN_RC"; }; schritt_2() { :; }' 0 1 2 || rc=$?
pruefe "6 übersprungen → Exit 0" 0 "$rc"
enthaelt "6 Bericht nennt übersprungen" '\[1/9\] +übersprungen'
enthaelt "6 Schlusszeile nennt die Lücke" '^==> OK mit Lücke'
fehlt "6 kein vorbehaltloses OK" '^==> OK: '

# 7 — --abbrechen: nach dem ersten roten Schritt läuft keiner mehr, und der Bericht sagt es.
rc=0; fahren 'schritt_1() { false; }; schritt_2() { echo lief-2; }' 1 1 2 || rc=$?
pruefe "7 abbrechen → Exit 1" 1 "$rc"
fehlt "7 Schritt 2 läuft nach Abbruch nicht" '^lief-2$'
enthaelt "7 Bericht nennt Schritt 2 nicht gelaufen" '\[2/9\] +nicht gelaufen'

# 8 — rot schlägt übersprungen: ein roter und ein übersprungener Schritt ergeben rot.
rc=0; fahren 'schritt_1() { return "$UEBERSPRUNGEN_RC"; }; schritt_2() { false; }' 0 1 2 || rc=$?
pruefe "8 rot + übersprungen → Exit 1" 1 "$rc"
enthaelt "8 Schlusszeile rot" '^==> ROT'

# 9 — die Meldung eines roten Schritts steht sofort da, nicht erst im Schlussbericht: wer den
# Vollauf abbrechen will, sieht den Grund, bevor die nächste Suite startet.
rc=0; fahren 'schritt_1() { false; }; schritt_2() { echo lief-2; }' 0 1 2 || rc=$?
if [ "$(grep -nE '^==> Schritt 1 ROT' "$ARBEIT/aus" | cut -d: -f1)" \
  -lt "$(grep -n '^lief-2$' "$ARBEIT/aus" | cut -d: -f1)" ] 2> /dev/null; then
  echo "ok   9 rote Meldung steht vor dem nächsten Schritt"
else
  echo "FAIL 9 rote Meldung fehlt oder steht erst nach dem nächsten Schritt" >&2
  sed 's/^/     | /' "$ARBEIT/aus" >&2
  fehler=1
fi

# Bündel `baut` (LLH-1849): der schnelle lokale Kompilierlauf. Er fährt NUR den Kompilierschritt,
# und der volle Lauf fährt ihn nicht mit (Schritt 3, 4 und 15 bauen dasselbe samt Tests).
CHECK_ALL="$(cd "$(dirname "$0")" && pwd)/check-all.sh"
rc=0; "$CHECK_ALL" --nur baut --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "10 Bündel baut ist bekannt" 0 "$rc"
enthaelt "10 Bündel baut fährt nur den Kompilierschritt" '^Schritte: 17$'
rc=0; "$CHECK_ALL" --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "11 voller Lauf wählt aus" 0 "$rc"
fehlt "11 voller Lauf fährt den Kompilierschritt nicht mit" '^Schritte: .*\b17\b'
enthaelt "11 voller Lauf fährt die e2e-Suite" '^Schritte: .*\b7\b'

# 13 — `--ohne-e2e` (LLH-1889): Agenten fahren vor dem PR die betroffenen Suiten lokal, aber ohne
# e2e; die läuft auf alpha. Fehlte die Option, liefe lokal eine Stunde Playwright mit.
rc=0; "$CHECK_ALL" --ohne-e2e --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "13 --ohne-e2e ist bekannt" 0 "$rc"
fehlt "13 --ohne-e2e lässt Schritt 7 aus" '^Schritte: .*\b7\b'
enthaelt "13 --ohne-e2e fährt den Rest" '^Schritte: 1 2 3 4 5 6 8 '
# Ein Lauf ohne e2e darf nicht wie ein voller aussehen (Review LLH-1889): die Auswahl sagt es.
enthaelt "13 --ohne-e2e sagt, dass Schritt 7 fehlt" '^Ohne e2e: Schritt 7 ausgelassen'
rc=0; "$CHECK_ALL" --geaendert=HEAD --ohne-e2e --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "13 --ohne-e2e geht mit --geaendert" 0 "$rc"
fehlt "13 --geaendert --ohne-e2e lässt Schritt 7 aus" '^Schritte: .*\b7\b'
rc=0; "$CHECK_ALL" --nur e2e --ohne-e2e --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "13 --nur e2e mit --ohne-e2e ist ein Widerspruch" 2 "$rc"

# 12 — Schritt 6 fährt Advisory-Scan UND Karenz-Prüfung, auch wenn der Scan rot ist (LLH-1884):
# sonst käme ein zu junges Paket neben einem Advisory erst im nächsten Lauf ans Licht. Gefahren
# wird der echte Schritt aus check-all.sh gegen Attrappen der beiden Skripte.
mkdir -p "$ARBEIT/s6/scripts"
printf '#!/bin/sh\necho deps-rot; exit 1\n' > "$ARBEIT/s6/scripts/check-deps.sh"
printf '#!/bin/sh\necho karenz-lief; exit 0\n' > "$ARBEIT/s6/scripts/check-karenzzeit.sh"
chmod +x "$ARBEIT/s6/scripts/"*.sh
schritt_6_def="$(sed -n '/^schritt_6() {/,/^}/p' "$CHECK_ALL")"
rc=0; fahren "ROOT='$ARBEIT/s6'; $schritt_6_def" 0 6 || rc=$?
pruefe "12 Schritt 6 bleibt rot, wenn der Advisory-Scan rot ist" 1 "$rc"
enthaelt "12 Schritt 6 fährt die Karenz-Prüfung trotz rotem Scan" '^karenz-lief$'
# Gegenrichtung: ein Karenz-Verstoß bei grünem Scan macht Schritt 6 rot; ein verschluckter
# Exit-Code der Karenz-Prüfung bliebe sonst von Fall 12 unbemerkt.
printf '#!/bin/sh\necho deps-gruen; exit 0\n' > "$ARBEIT/s6/scripts/check-deps.sh"
printf '#!/bin/sh\necho karenz-rot; exit 1\n' > "$ARBEIT/s6/scripts/check-karenzzeit.sh"
rc=0; fahren "ROOT='$ARBEIT/s6'; $schritt_6_def" 0 6 || rc=$?
pruefe "12b Karenz-Verstoß bei grünem Scan macht Schritt 6 rot" 1 "$rc"
printf '#!/bin/sh\necho deps-rot; exit 1\n' > "$ARBEIT/s6/scripts/check-deps.sh"
rc=0; fahren "ROOT='$ARBEIT/s6'; $schritt_6_def" 0 6 || rc=$?
pruefe "12c beide rot: Schritt 6 rot" 1 "$rc"
enthaelt "12c beide rot: die Karenz-Prüfung lief" '^karenz-rot$'

# 14 — Schritt 18, der Swift-Kern der iOS-Hülle (LLH-1978): eigenes Bündel `ios`, Teil des vollen
# Laufs und von `--geaendert`, wenn ios/ oder die gemeinsamen Fälle sich ändern.
rc=0; "$CHECK_ALL" --nur ios --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "14 Bündel ios ist bekannt" 0 "$rc"
enthaelt "14 Bündel ios fährt nur den Swift-Schritt" '^Schritte: 18$'
rc=0; "$CHECK_ALL" --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
enthaelt "14 voller Lauf fährt den Swift-Schritt" '^Schritte: .*\b18\b'
rc=0; "$CHECK_ALL" --nur schnell --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
fehlt "14 schnell fährt den Swift-Schritt nicht" '^Schritte: .*\b18\b'

# 15 — Schritt 18 ohne Toolchain: lokal eine Lücke (nie grün), in der CI mit IOS_SWIFT_PFLICHT=1
# rot; mit Toolchain fährt er `swift test` im Paket und übernimmt dessen Ergebnis. Gefahren wird
# der echte Schritt gegen eine Attrappe von `swift`; PATH zeigt nur auf deren Verzeichnis, damit
# eine installierte Toolchain den Fall „fehlt“ nicht verdeckt (der Schritt nutzt sonst nur
# Builtins). Der Fall „lokal“ setzt IOS_SWIFT_PFLICHT=0 selbst: ein Aufrufer mit der Variable
# (`IOS_SWIFT_PFLICHT=1 check-all.sh`) machte ihn sonst rot.
mkdir -p "$ARBEIT/s18/ios/LifelineKern" "$ARBEIT/s18/leer" "$ARBEIT/s18/gruen" "$ARBEIT/s18/rot"
printf '#!/bin/sh\necho "swift-lief $* in $(pwd)"\n' > "$ARBEIT/s18/gruen/swift"
printf '#!/bin/sh\necho swift-rot; exit 1\n' > "$ARBEIT/s18/rot/swift"
chmod +x "$ARBEIT/s18/gruen/swift" "$ARBEIT/s18/rot/swift"
schritt_18_def="$(sed -n '/^schritt_18() {/,/^}/p' "$CHECK_ALL")"
[ -n "$schritt_18_def" ] || { echo "FAIL 15 schritt_18 fehlt in check-all.sh" >&2; fehler=1; }
rc=0; fahren "ROOT='$ARBEIT/s18'; PATH='$ARBEIT/s18/leer'; IOS_SWIFT_PFLICHT=0; $schritt_18_def" 0 18 || rc=$?
pruefe "15 ohne swift → Exit 0" 0 "$rc"
enthaelt "15 ohne swift → übersprungen, nicht grün" '\[18/9\] +übersprungen'
enthaelt "15 ohne swift → OK mit Lücke" '^==> OK mit Lücke'
rc=0; fahren "ROOT='$ARBEIT/s18'; PATH='$ARBEIT/s18/leer'; IOS_SWIFT_PFLICHT=1; $schritt_18_def" 0 18 || rc=$?
pruefe "15 ohne swift mit IOS_SWIFT_PFLICHT=1 → rot" 1 "$rc"
enthaelt "15 IOS_SWIFT_PFLICHT nennt den Grund" 'IOS_SWIFT_PFLICHT'
rc=0; fahren "ROOT='$ARBEIT/s18'; PATH='$ARBEIT/s18/gruen'; $schritt_18_def" 0 18 || rc=$?
pruefe "15 mit swift → grün" 0 "$rc"
enthaelt "15 mit swift → swift test im Paket" "^swift-lief test in $ARBEIT/s18/ios/LifelineKern\$"
rc=0; fahren "ROOT='$ARBEIT/s18'; PATH='$ARBEIT/s18/rot'; $schritt_18_def" 0 18 || rc=$?
pruefe "15 rotes swift test → rot" 1 "$rc"

# 16 — Schritt 19, das Server-Binary wie im Release (LLH-2033): eigenes Bündel `binaer` für den
# Pflicht-Check im PR, Teil von `rust` (also vom vollen Lauf und von `--geaendert` bei Rust),
# nicht von `schnell` (der Check läuft daneben, nicht darin).
rc=0; "$CHECK_ALL" --nur binaer --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "16 Bündel binaer ist bekannt" 0 "$rc"
enthaelt "16 Bündel binaer fährt nur das Server-Binary" '^Schritte: 19$'
rc=0; "$CHECK_ALL" --nur rust --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
enthaelt "16 rust fährt das Server-Binary mit" '^Schritte: 4 15 19$'
rc=0; "$CHECK_ALL" --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
enthaelt "16 voller Lauf fährt das Server-Binary" '^Schritte: .*\b19\b'
rc=0; "$CHECK_ALL" --nur schnell --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
fehlt "16 schnell fährt das Server-Binary nicht" '^Schritte: .*\b19\b'

# 17 — Schritt 19 übersetzt OHNE Dev-Abhängigkeiten: nur das Binary, kein Testziel. Mit
# `--all-targets`, `--tests` oder `cargo test` vereinigte Cargo die Features der
# Dev-Abhängigkeiten, und der Bruch aus #1561 bliebe grün. Gefahren wird der echte Schritt gegen
# eine Attrappe von `cargo`, die ihre Argumente meldet.
mkdir -p "$ARBEIT/s19/bin"
printf '#!/bin/sh\necho "cargo-lief $*"\n' > "$ARBEIT/s19/bin/cargo"
chmod +x "$ARBEIT/s19/bin/cargo"
schritt_19_def="$(sed -n '/^schritt_19() {/,/^}/p' "$CHECK_ALL")"
[ -n "$schritt_19_def" ] || { echo "FAIL 17 schritt_19 fehlt in check-all.sh" >&2; fehler=1; }
attrappen="bauziel_pruefen() { :; }; ohne_dev_env() { \"\$@\"; }"
rc=0; fahren "ROOT='$ARBEIT/s19'; PATH='$ARBEIT/s19/bin':\"\$PATH\"; $attrappen; $schritt_19_def" 0 19 || rc=$?
pruefe "17 Schritt 19 grün, wenn cargo grün ist" 0 "$rc"
enthaelt "17 Schritt 19 baut das Server-Binary" '^cargo-lief build --bin lifeline-hub$'
fehlt "17 Schritt 19 baut kein Testziel" 'cargo-lief .*(test|--all-targets|--tests|--benches|--examples)'
printf '#!/bin/sh\necho cargo-rot; exit 101\n' > "$ARBEIT/s19/bin/cargo"
rc=0; fahren "ROOT='$ARBEIT/s19'; PATH='$ARBEIT/s19/bin':\"\$PATH\"; $attrappen; $schritt_19_def" 0 19 || rc=$?
pruefe "17 Schritt 19 rot, wenn das Binary nicht übersetzt" 1 "$rc"

# 18 — Schritt 19 prüft auch den karten-service ohne Dev-Abhängigkeiten (LLH-2038): er hat
# `tokio/test-util` und `tower/util` nur über sie und wird sonst erst im Release ohne Testziele
# gebaut. In EIGENEM Aufruf: mit dem Hauptpaket zusammen vereinigte Cargo die Features beider.
printf '#!/bin/sh\necho "cargo-lief $*"\n' > "$ARBEIT/s19/bin/cargo"
rc=0; fahren "ROOT='$ARBEIT/s19'; PATH='$ARBEIT/s19/bin':\"\$PATH\"; $attrappen; $schritt_19_def" 0 19 || rc=$?
pruefe "18 Schritt 19 grün mit karten-service" 0 "$rc"
enthaelt "18 Schritt 19 prüft den karten-service" '^cargo-lief check -p karten-service$'
fehlt "18 karten-service nicht im selben Aufruf wie das Binary" 'cargo-lief .*lifeline-hub.*karten-service|cargo-lief .*karten-service.*lifeline-hub'
printf '#!/bin/sh\ncase "$*" in *karten-service*) echo karten-rot; exit 101 ;; esac\necho "cargo-lief $*"\n' > "$ARBEIT/s19/bin/cargo"
rc=0; fahren "ROOT='$ARBEIT/s19'; PATH='$ARBEIT/s19/bin':\"\$PATH\"; $attrappen; $schritt_19_def" 0 19 || rc=$?
pruefe "18 Schritt 19 rot, wenn der karten-service nicht übersetzt" 1 "$rc"

# 19 — Schritt 20, der Kotlin-Kern der Android-Hülle (LLH-1989): eigenes Bündel `android`, Teil des
# vollen Laufs und von `--geaendert`, nicht von `schnell`; ohne Java lokal eine Lücke, in der CI
# mit ANDROID_KERN_PFLICHT=1 rot; mit Java fährt er den Gradle-Wrapper im Kern.
rc=0; "$CHECK_ALL" --nur android --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "19 Bündel android ist bekannt" 0 "$rc"
enthaelt "19 Bündel android fährt nur den Kotlin-Schritt" '^Schritte: 20$'
rc=0; "$CHECK_ALL" --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
enthaelt "19 voller Lauf fährt den Kotlin-Schritt" '^Schritte: .*\b20\b'
rc=0; "$CHECK_ALL" --nur schnell --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
fehlt "19 schnell fährt den Kotlin-Schritt nicht" '^Schritte: .*\b20\b'
mkdir -p "$ARBEIT/s20/android" "$ARBEIT/s20/leer" "$ARBEIT/s20/gruen"
printf '#!/bin/sh\necho "gradlew-lief $* "\n' > "$ARBEIT/s20/android/gradlew"
printf '#!/bin/sh\necho "openjdk version \\"21.0.1\\" 2026-01-01" >&2\n' > "$ARBEIT/s20/gruen/java"
chmod +x "$ARBEIT/s20/android/gradlew" "$ARBEIT/s20/gruen/java"
schritt_20_def="$(sed -n '/^schritt_20() {/,/^}/p' "$CHECK_ALL")"
[ -n "$schritt_20_def" ] || { echo "FAIL 19 schritt_20 fehlt in check-all.sh" >&2; fehler=1; }
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/leer'; JAVA_HOME=; ANDROID_KERN_PFLICHT=0; $schritt_20_def" 0 20 || rc=$?
pruefe "19 ohne java → Exit 0" 0 "$rc"
enthaelt "19 ohne java → übersprungen, nicht grün" '\[20/9\] +übersprungen'
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/leer'; JAVA_HOME=; ANDROID_KERN_PFLICHT=1; $schritt_20_def" 0 20 || rc=$?
pruefe "19 ohne java mit ANDROID_KERN_PFLICHT=1 → rot" 1 "$rc"
enthaelt "19 ANDROID_KERN_PFLICHT nennt den Grund" 'ANDROID_KERN_PFLICHT'
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/gruen':\"\$PATH\"; JAVA_HOME=; $schritt_20_def" 0 20 || rc=$?
pruefe "19 mit java → grün" 0 "$rc"
enthaelt "19 mit java → gradlew testet den Kern" "^gradlew-lief -p $ARBEIT/s20/android/kern test"
# Ein `java`, das nicht läuft (macOS legt `/usr/bin/java` als Platzhalter an, der ohne JDK mit 1
# endet), zählt wie keins: Lücke bzw. rot mit Grund, nie ein Abbruch ohne Meldung unter pipefail.
mkdir -p "$ARBEIT/s20/platzhalter" "$ARBEIT/s20/jdk11/bin" "$ARBEIT/s20/jdk21/bin"
printf '#!/bin/sh\necho "The operation couldn’t be completed. Unable to locate a Java Runtime." >&2\nexit 1\n' > "$ARBEIT/s20/platzhalter/java"
printf '#!/bin/sh\necho "openjdk version \\"11.0.2\\" 2019-01-15" >&2\n' > "$ARBEIT/s20/jdk11/bin/java"
cp "$ARBEIT/s20/gruen/java" "$ARBEIT/s20/jdk21/bin/java"
chmod +x "$ARBEIT/s20/platzhalter/java" "$ARBEIT/s20/jdk11/bin/java" "$ARBEIT/s20/jdk21/bin/java"
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/platzhalter'; JAVA_HOME=; ANDROID_KERN_PFLICHT=0; $schritt_20_def" 0 20 || rc=$?
pruefe "19 java-Platzhalter ohne JDK → Exit 0" 0 "$rc"
enthaelt "19 java-Platzhalter ohne JDK → übersprungen, nicht rot" '\[20/9\] +übersprungen'
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/platzhalter'; JAVA_HOME=; ANDROID_KERN_PFLICHT=1; $schritt_20_def" 0 20 || rc=$?
pruefe "19 java-Platzhalter mit ANDROID_KERN_PFLICHT=1 → rot" 1 "$rc"
enthaelt "19 java-Platzhalter: rot mit Grund" 'ANDROID_KERN_PFLICHT'
# Gradle nimmt `JAVA_HOME`, also fragt der Schritt dasselbe JDK: JAVA_HOME auf 11 und 21 im PATH
# ist eine Lücke, JAVA_HOME auf 21 ohne java im PATH baut.
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/gruen'; JAVA_HOME='$ARBEIT/s20/jdk11'; ANDROID_KERN_PFLICHT=0; $schritt_20_def" 0 20 || rc=$?
enthaelt "19 JAVA_HOME auf JDK 11 → übersprungen, auch mit 21 im PATH" '\[20/9\] +übersprungen'
fehlt "19 JAVA_HOME auf JDK 11 → kein Gradle" '^gradlew-lief'
rc=0; fahren "ROOT='$ARBEIT/s20'; PATH='$ARBEIT/s20/leer'; JAVA_HOME='$ARBEIT/s20/jdk21'; ANDROID_KERN_PFLICHT=1; $schritt_20_def" 0 20 || rc=$?
pruefe "19 JAVA_HOME auf JDK 21 ohne java im PATH → grün" 0 "$rc"
enthaelt "19 JAVA_HOME auf JDK 21 → gradlew testet den Kern" "^gradlew-lief -p $ARBEIT/s20/android/kern test"

if [ "$fehler" -ne 0 ]; then
  echo "check-all.test.sh: ROT" >&2
  exit 1
fi
echo "check-all.test.sh: alle Fälle grün"
