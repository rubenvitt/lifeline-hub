#!/usr/bin/env bash
# Schrittläufer des Sammel-Gates (LFH-386). Zum Sourcen gedacht, nicht zum Ausführen.
# Selbsttest: scripts/check-all.test.sh.
#
# SAMMELN IST DIE VORGABE, ABBRECHEN DAS OPT-IN. Unter einem nackten `set -e` beendete der
# erste rote Schritt den Lauf, und jeder Schritt dahinter fiel still aus: solange drei
# Vitest-Fälle rot waren, liefen Advisories und e2e im Vollauf nie, und die Ausgabe sah aus wie
# ein gewöhnlicher Testfehler. Ein Gate, das eine Teilmenge prüft, meldet dasselbe Rot wie
# eines, das alles geprüft hat. Der Preis: ein früh roter Vollauf läuft trotzdem zu Ende.
# Deshalb steht die rote Meldung sofort da (wer will, bricht ab), und `--abbrechen` gibt das
# alte Verhalten ausdrücklich zurück.

# Rückgabewert, mit dem ein Schritt „übersprungen" meldet (weder grün noch rot). 75 ist
# EX_TEMPFAIL aus sysexits.h, kein Kommando des Gates liefert es von sich aus.
UEBERSPRUNGEN_RC=75

SCHRITTE_ERGEBNIS=""

# Fährt die Funktionen schritt_<n> für jedes übergebene <n> nacheinander.
#   <abbrechen>  1 = nach dem ersten roten Schritt keinen weiteren starten, 0 = alle fahren
# Ergebnis je Schritt in SCHRITTE_ERGEBNIS, auszuwerten mit schritte_bericht.
#
# NIE in einer Bedingung aufrufen (`if`, `&&`, `||`, `!`): dort schaltet Bash errexit für den
# ganzen Körper ab, auch ein `set -e` in der Subshell wirkt dann nicht, und ein Schritt, dessen
# erstes Kommando scheitert, meldete grün. Aus demselben Grund läuft jeder Schritt als eigenes
# Kommando in einer Subshell mit `set -e` statt als `if schritt_n; then`. Die Subshell fängt
# außerdem ein `exit` im Schritt ab.
schritte_fahren() { # <abbrechen:0|1> <n>…
  local abbrechen="$1" n rc rot=0
  shift
  SCHRITTE_ERGEBNIS=""
  for n in "$@"; do
    if [ "$rot" -eq 1 ] && [ "$abbrechen" -eq 1 ]; then
      SCHRITTE_ERGEBNIS="$SCHRITTE_ERGEBNIS $n:nicht"
      continue
    fi
    set +e
    (
      set -e
      "schritt_$n"
    )
    rc=$?
    set -e
    case "$rc" in
      0) SCHRITTE_ERGEBNIS="$SCHRITTE_ERGEBNIS $n:gruen" ;;
      "$UEBERSPRUNGEN_RC") SCHRITTE_ERGEBNIS="$SCHRITTE_ERGEBNIS $n:uebersprungen" ;;
      *)
        rot=1
        SCHRITTE_ERGEBNIS="$SCHRITTE_ERGEBNIS $n:rot$rc"
        echo "==> Schritt $n ROT (Exit $rc)" >&2
        if [ "$abbrechen" -eq 1 ]; then
          echo "    --abbrechen: kein weiterer Schritt startet." >&2
        else
          echo "    Der Lauf geht weiter; der Gesamtstatus steht am Ende." >&2
        fi
        ;;
    esac
  done
}

# Gibt den Gesamtstatus aus und liefert 0 (grün, auch mit übersprungenen Schritten) oder 1.
# Rot schlägt übersprungen. Liest SCHRITTE (Gesamtzahl) für die Anzeige „[n/SCHRITTE]".
schritte_bericht() {
  local eintrag n st rote="" luecken="" nicht=""
  echo
  echo "==> Gesamtstatus je Schritt (Ausgabe oben unter ==> [n/$SCHRITTE]):"
  for eintrag in $SCHRITTE_ERGEBNIS; do
    n="${eintrag%%:*}"
    st="${eintrag#*:}"
    case "$st" in
      gruen) echo "    [$n/$SCHRITTE] grün" ;;
      uebersprungen)
        echo "    [$n/$SCHRITTE] übersprungen"
        luecken="$luecken $n"
        ;;
      nicht)
        echo "    [$n/$SCHRITTE] nicht gelaufen (--abbrechen)"
        nicht="$nicht $n"
        ;;
      rot*)
        echo "    [$n/$SCHRITTE] ROT (Exit ${st#rot})"
        rote="$rote $n"
        ;;
    esac
  done
  if [ -n "$rote" ]; then
    echo "==> ROT: Schritt(e)${rote}.${nicht:+ Nicht gelaufen:${nicht}.}${luecken:+ Übersprungen:${luecken}.}"
    return 1
  fi
  if [ -n "$luecken" ]; then
    echo "==> OK mit Lücke: übersprungen${luecken} — das ist kein voller Nachweis."
    return 0
  fi
  echo "==> OK: alle gefahrenen Schritte grün."
}
