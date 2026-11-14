#!/usr/bin/env bash
# LLH-1849: Auswahl und Meldung des Pflicht-Checks „Baut mit Ziel-Branch“. Kompiliert selbst
# nichts und führt keinen PR-Code aus: das tut der Job `kompilieren` in
# .github/workflows/ziel-branch-build.yml, ohne Schreibrechte.
#
#   scripts/ziel-branch-build.sh verteilen <ziel-branch> <ziel-sha>
#       Nach einem Push auf den Ziel-Branch, OHNE selbst zu kompilieren: Jeder fertige offene PR
#       (Auto-Merge an oder Label `e2e`, kein Entwurf, kein Fork) bekommt den Check auf „läuft“
#       und einen eigenen Lauf des Workflows auf seinem Branch (workflow_dispatch). Jeder übrige,
#       der den Check trägt (auch ein Entwurf), bekommt ihn auf „wartet“.
#   scripts/ziel-branch-build.sh auswahl <ziel-branch> <ziel-sha> <pr-nr>
#       Bei einem PR-Ereignis: ist der PR fertig, Check auf „läuft“; sonst, wenn er den Check
#       trägt, auf „wartet“. Gibt den PR als JSON aus, wenn er rechnet, sonst []:
#       [{"nr": <nr>, "kopf": "<sha>", "check_id": <id>}]
#   scripts/ziel-branch-build.sh einzellauf <pr-nr> <ref> <check-id> <kopf-sha> <ziel-branch> <ziel-sha>
#       Im Einzellauf: rechnet nur, wenn <ref> der Kopf-Branch des PRs ist, der PR in diesem
#       Repository liegt und <ref> kein Kanal-Branch ist (ein von Hand ohne --ref gestarteter Lauf
#       liefe sonst auf alpha). Arbeitet dann wie `auswahl`: ein frischer Check. Den Check
#       <check-id> von `verteilen` (auf <kopf-sha>) lässt er offen. Ist <ziel-sha> auf dem
#       aktuellen Kopf schon gerechnet (der wartende Lauf las den Stand, bevor `verteilen` dafür
#       dispatchte), rechnet er nicht noch einmal: <check-id> übernimmt das Ergebnis.
#   scripts/ziel-branch-build.sh melden <pr-nr> <kopf-sha> <check-id> <ziel-branch> <ziel-sha> \
#       <ergebnis> <ausgabe-datei>
#       Schließt den Check <check-id>: ergebnis `gruen` → grün; `rot`, `konflikt`, `veraltet`,
#       leer oder unbekannt → rot. Ältere offene Checks des Kopfes bleiben: GitHub wertet je Name
#       den jüngsten. Steht der PR-Kopf weiter oder der
#       Ziel-Branch um mehr als Release-Commits (die mit `[skip ci]` keinen Lauf starten) weiter,
#       ist das Ergebnis überholt: der Check bleibt auf „läuft“, und ein jüngerer Check zum neuen
#       Stand löst ihn ab (LLH-1889: nie „abgebrochen“, das zeigt den PR rot). Erscheint binnen
#       ZBB_WARTEN Sekunden keiner, wird er rot mit dem Rat, neu zu starten.
#   Exit 0 = gelaufen · 1 = an mindestens einem PR gescheitert (die übrigen sind bearbeitet) ·
#   2 = Aufruf- oder Umgebungsfehler
#   Umgebung: ZBB_GH  Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#             ZBB_WARTEN, ZBB_TAKT  Sekunden: wie lange und wie oft `melden` bei „überholt“ auf
#                       einen jüngeren Check wartet (Vorgabe 300 und 20)
#
# WARUM: Die CI eines PRs prüft den Stand des Ziel-Branches beim letzten Push. Am 12.11.2026 waren
# #1319 und #1315 einzeln grün und brachen `alpha` zusammen. Bewegt sich der Ziel-Branch, muss der
# Check an jedem fertigen PR neu rechnen, und bis dahin soll kein altes Grün stehen bleiben: daher
# „läuft“ sofort beim Verteilen (ein Restfenster bis dahin bleibt, design.md). Ein überholter oder
# ersetzter Lauf schließt keinen Check als abgebrochen (LLH-1889): am 14.11.2026 standen so zehn
# PRs ohne Fehler rot, und Auto-Merge mergte nichts. Gerechnet wird nie im
# Push-Lauf selbst: der hat den Cache-Bereich des Kanal-Branches, und PR-Code dort könnte einen
# Cache anlegen, den der Release-Build liest. Der eigene Lauf auf dem PR-Branch hat dessen Bereich. Ein PR in Arbeit rechnet erst, wenn er fertig ist (wie die
# zweite Stufe, LLH-1662); bis dahin fehlt oder wartet der Check, und er ist nicht mergebar.
#
# Regeln: scripts/AGENTS.md, „Baut mit Ziel-Branch“. Spec: openspec/specs/pr-pruefstufen/.
set -euo pipefail

NAME="Baut mit Ziel-Branch"
REPO="${GITHUB_REPOSITORY:-}"
gh_api() { "${ZBB_GH:-gh}" api "$@"; }
kurz() { printf '%s' "${1:0:8}"; }

# Neuer Check-Run auf <sha> mit <status>; gibt seine ID aus. <ziel-sha> kommt in `external_id`:
# daran erkennt `einzellauf` einen Stand, der auf diesem Kopf schon gerechnet ist.
check_neu() { # <sha> <status> <titel> <text> [<ziel-sha>]
  gh_api -X POST "repos/$REPO/check-runs" -f name="$NAME" -f head_sha="$1" -f status="$2" \
    -f external_id="${5:-}" -f "output[title]=$3" -f "output[summary]=$4" --jq .id
}

# Abfrage der Check-Runs dieses Namens auf <sha>. Ohne `filter=all` liefert GitHub je Check-Suite
# nur den jüngsten, und alle Runs der Checks-API liegen in einer Suite.
check_runs_pfad() { # <sha> [all]
  printf 'repos/%s/commits/%s/check-runs?check_name=%s&per_page=100%s' "$REPO" "$1" \
    "$(jq -rn --arg n "$NAME" '$n | @uri')" "${2:+&filter=$2}"
}

# Status des jüngsten Checks dieses Namens auf <sha>, leer, wenn es keinen gibt.
check_status() { # <sha>
  gh_api "$(check_runs_pfad "$1")" --jq '[.check_runs[]] | sort_by(.id) | last | .status // ""'
}

# Die offenen PRs als TSV: nr, kopf, kopf-branch, fertig, entwurf, fork.
pr_zeilen() { # <prs-json>
  jq -r --arg repo "$REPO" 'sort_by(.number)[]
      | [.number, .head.sha, .head.ref,
         ((.auto_merge != null) or any((.labels // [])[]; .name == "e2e")),
         (.draft == true), ((.head.repo.full_name // "") != $repo)] | @tsv' <<< "$1"
}

# Ein nicht fertiger PR, der den Check trägt, bekommt ihn auf „wartet“ (nicht noch einmal).
# Exit ≠ 0, wenn das nicht gelingt; jeder Aufruf ist einzeln geprüft, denn wer `warten` mit `||`
# aufruft, schaltet `set -e` hier ab.
warten() { # <nr> <kopf> <ziel> <ziel-sha>
  local st
  st="$(check_status "$2")" || return 1
  case "$st" in
    "") echo "PR #$1: nicht fertig, ohne Check" >&2 ;;
    queued) echo "PR #$1: nicht fertig, wartet schon" >&2 ;;
    *)
      check_neu "$2" queued "Wartet: $3 hat sich bewegt" \
        "\`$3\` steht jetzt auf $(kurz "$4"). Der Check rechnet neu, sobald der PR fertig ist (Auto-Merge an oder Label \`e2e\`, kein Entwurf)." > /dev/null \
        || return 1
      echo "PR #$1: nicht fertig, Check wartet" >&2 ;;
  esac
}

verteilen() { # <ziel-branch> <ziel-sha>
  local ziel="$1" ziel_sha="$2" prs nr kopf zweig fertig entwurf fork id antwort fehler=0
  prs="$(gh_api "repos/$REPO/pulls?state=open&base=$ziel&per_page=100" --paginate --jq '.' | jq -s 'add // []')"
  while IFS=$'\t' read -r nr kopf zweig fertig entwurf fork; do
    [ -n "$nr" ] || continue
    [ "$fork" = false ] || { echo "PR #$nr: Fork, kein Check" >&2; continue; }
    if [ "$fertig" = true ] && [ "$entwurf" = false ]; then
      id="$(check_neu "$kopf" in_progress "Rechnet gegen $ziel $(kurz "$ziel_sha")" \
        "Der PR wird mit dem aktuellen Stand von \`$ziel\` zusammengeführt und kompiliert." "$ziel_sha")" \
        || { echo "::warning::PR #$nr: Check nicht gesetzt"; fehler=1; continue; }
      if antwort="$(gh_api -X POST "repos/$REPO/actions/workflows/ziel-branch-build.yml/dispatches" -f ref="$zweig" \
        -f "inputs[nr]=$nr" -f "inputs[kopf]=$kopf" -f "inputs[check_id]=$id" \
        -f "inputs[ziel]=$ziel" -f "inputs[ziel_sha]=$ziel_sha" 2>&1)"; then
        echo "PR #$nr: fertig, eigener Lauf auf $zweig (Check $id)" >&2
      else
        echo "::warning::PR #$nr: eigener Lauf auf $zweig nicht startbar: $antwort"
        case "$antwort" in
          *"HTTP 422"* | *"HTTP 404"*)
            # Der Branch kennt den Workflow (noch) nicht, oder es gibt ihn nicht mehr.
            gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=completed -f conclusion=failure \
              -f "output[title]=Kann nicht neu rechnen" \
              -f "output[summary]=Auf \`$zweig\` ließ sich der Workflow „$NAME“ nicht starten, meist weil der Branch ihn noch nicht kennt. \`$ziel\` in den Branch hineinmergen und pushen; dann rechnet der Check." > /dev/null \
              || fehler=1 ;;
          *)
            # Vorübergehend (5xx, Drosselung): kein falscher Rat; der Lauf wird rot und lässt
            # sich neu starten, jedes PR-Ereignis rechnet ebenso.
            fehler=1
            gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=completed -f conclusion=cancelled \
              -f "output[title]=Neu rechnen gescheitert" \
              -f "output[summary]=Der eigene Lauf auf \`$zweig\` ließ sich gerade nicht starten. Den Lauf „$NAME“ auf \`$ziel\` neu starten oder einen Commit pushen." > /dev/null \
              || true ;;
        esac
      fi
    else
      warten "$nr" "$kopf" "$ziel" "$ziel_sha" || { echo "::warning::PR #$nr: Check nicht gesetzt"; fehler=1; }
    fi
  done < <(pr_zeilen "$prs")
  return "$fehler"
}

auswahl() { # <ziel-branch> <ziel-sha> <pr-nr>
  auswahl_aus "$1" "$2" "$(gh_api "repos/$REPO/pulls/$3" --jq '[.]')"
}

auswahl_aus() { # <ziel-branch> <ziel-sha> <prs-json mit einem PR>
  local ziel="$1" ziel_sha="$2" prs="$3" nr kopf zweig fertig entwurf fork id liste="[]"
  while IFS=$'\t' read -r nr kopf zweig fertig entwurf fork; do
    [ -n "$nr" ] || continue
    if [ "$fork" = true ]; then
      echo "PR #$nr: Fork, kein Check" >&2
    elif [ "$fertig" = true ] && [ "$entwurf" = false ]; then
      id="$(check_neu "$kopf" in_progress "Rechnet gegen $ziel $(kurz "$ziel_sha")" \
        "Der PR wird mit dem aktuellen Stand von \`$ziel\` zusammengeführt und kompiliert." "$ziel_sha")"
      echo "PR #$nr: fertig, rechnet (Check $id)" >&2
      liste="$(jq -c --argjson nr "$nr" --arg kopf "$kopf" --argjson id "$id" \
        '. + [{nr: $nr, kopf: $kopf, check_id: $id}]' <<< "$liste")"
    else
      warten "$nr" "$kopf" "$ziel" "$ziel_sha"
    fi
  done < <(pr_zeilen "$prs")
  printf '%s\n' "$liste"
}

einzellauf() { # <pr-nr> <ref> <check-id> <kopf-sha> <ziel-branch> <ziel-sha>
  local nr="$1" ref="$2" alt_id="$3" alt_kopf="$4" ziel="$5" ziel_sha="$6" prs grund="" kopf frueher
  prs="$(gh_api "repos/$REPO/pulls/$nr" --jq '[.]')"
  case " alpha beta main " in *" $ref "*) grund="läuft auf dem Kanal-Branch $ref" ;; esac
  if [ -z "$grund" ] && [ "$(jq -r '.[0].head.repo.full_name // ""' <<< "$prs")" != "$REPO" ]; then
    grund="PR liegt nicht in diesem Repository"
  fi
  if [ -z "$grund" ] && [ "$(jq -r '.[0].head.ref' <<< "$prs")" != "$ref" ]; then
    grund="läuft nicht auf dem Branch des PRs"
  fi
  if [ -n "$grund" ]; then
    echo "Einzellauf für PR #$nr rechnet nicht: $grund" >&2
    printf '[]\n'
    return 0
  fi
  kopf="$(jq -r '.[0].head.sha' <<< "$prs")"
  if [ "$kopf" = "$alt_kopf" ]; then
    # Schon gerechnet: ein abgeschlossenes Ergebnis (grün oder rot) zu genau diesem Stand. Nicht
    # lesbar: rechnen wie immer.
    # `gh --jq` kennt kein --arg; der Stand ist ein Commit-Hash und steht als JSON-String im Filter.
    frueher="$(gh_api "$(check_runs_pfad "$kopf" all)" --paginate --jq \
      ".check_runs[] | select(.status == \"completed\" and .external_id == $(jq -rn --arg z "$ziel_sha" '$z | @json')
        and (.conclusion == \"success\" or .conclusion == \"failure\"))
      | [.id, .conclusion, .output.title, .output.summary] | @json" 2> /dev/null \
      | jq -s -c 'sort_by(.[0]) | last // empty' 2> /dev/null || true)"
    if [ -n "$frueher" ] && gh_api -X PATCH "repos/$REPO/check-runs/$alt_id" -f status=completed \
      -f conclusion="$(jq -r '.[1]' <<< "$frueher")" -f "output[title]=$(jq -r '.[2] // ""' <<< "$frueher")" \
      -f "output[summary]=$(jq -r '.[3] // ""' <<< "$frueher") (Übernommen aus Check $(jq -r '.[0]' <<< "$frueher"), gerechnet gegen denselben Stand.)" > /dev/null; then
      echo "PR #$nr: $(kurz "$ziel_sha") ist auf $(kurz "$kopf") schon gerechnet, Check $alt_id übernimmt das Ergebnis" >&2
      printf '[]\n'
      return 0
    fi
  fi
  echo "PR #$nr: Check $alt_id von verteilen bleibt offen, ein frischer rechnet" >&2
  auswahl_aus "$ziel" "$ziel_sha" "$prs"
}

# Ist <neu> nur um Release-Commits weiter als <alt>? Die tragen `[skip ci]` und starten keinen
# Lauf; ohne diese Ausnahme hinge ein fertiger PR nach jedem Release bis zum nächsten Merge.
nur_release_weiter() { # <alt> <neu>
  gh_api "repos/$REPO/compare/$1...$2" --jq '.status == "ahead" and (.commits | length) > 0
      and all(.commits[]; .commit.message | startswith("chore(release):"))' 2> /dev/null | grep -qx true
}

# Erscheint auf <kopf> ein jüngerer Check dieses Namens als <id>? Wartet bis zu ZBB_WARTEN Sekunden
# (Vorgabe 300; `verteilen` braucht nach einem Merge eine knappe Minute, steht aber in einer
# Warteschlange), sieht alle ZBB_TAKT Sekunden nach. Nicht lesbar zählt wie „noch keiner“.
nachfolger_da() { # <kopf> <id>
  local ende juengster
  ende=$(( $(date +%s) + ${ZBB_WARTEN:-300} ))
  while :; do
    juengster="$(gh_api "$(check_runs_pfad "$1")" --jq '[.check_runs[].id] | max // 0' 2> /dev/null || echo 0)"
    [ "${juengster:-0}" -gt "$2" ] && return 0
    [ "$(date +%s)" -lt "$ende" ] || return 1
    sleep "${ZBB_TAKT:-20}"
  done
}

melden() { # <pr-nr> <kopf-sha> <check-id> <ziel-branch> <ziel-sha> <ergebnis> <ausgabe-datei>
  local nr="$1" kopf="$2" id="$3" ziel="$4" ziel_sha="$5" ergebnis="$6" datei="$7"
  local jetzt_kopf jetzt_ziel fazit titel text ausgabe=""
  jetzt_kopf="$(gh_api "repos/$REPO/pulls/$nr" --jq .head.sha)"
  jetzt_ziel="$(gh_api "repos/$REPO/git/ref/heads/$ziel" --jq .object.sha)"
  if [ "$jetzt_kopf" != "$kopf" ] || { [ "$jetzt_ziel" != "$ziel_sha" ] && ! nur_release_weiter "$ziel_sha" "$jetzt_ziel"; }; then
    # Am neuen Kopf zeigt der PR diesen Check nicht mehr. Bewegte sich nur der Ziel-Branch, löst
    # ihn ein jüngerer Check ab (GitHub wertet je Name den jüngsten); kommt keiner, hinge der PR
    # still auf „läuft“, also rot mit Rat (Review LLH-1889).
    if [ "$jetzt_kopf" != "$kopf" ] || nachfolger_da "$kopf" "$id"; then
      echo "PR #$nr: überholt (PR $(kurz "$jetzt_kopf"), $ziel $(kurz "$jetzt_ziel")), Check bleibt auf „läuft“" >&2
      gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=in_progress \
        -f "output[title]=Überholt, rechnet neu" \
        -f "output[summary]=Gerechnet gegen PR $(kurz "$kopf") und \`$ziel\` $(kurz "$ziel_sha"); inzwischen steht einer davon weiter. Das Ergebnis zum neuen Stand meldet ein jüngerer Check dieses Namens." > /dev/null
      return 0
    fi
    echo "PR #$nr: überholt, aber kein jüngerer Check erschienen → rot" >&2
    schliessen "$id" failure "Überholt, kein neuer Lauf" \
      "Gerechnet gegen \`$ziel\` $(kurz "$ziel_sha"); inzwischen steht einer davon weiter, aber kein neuer Lauf hat sich gemeldet. Den Lauf „$NAME“ neu starten oder einen Commit pushen." ""
    return 0
  fi
  [ -f "$datei" ] && ausgabe="$(tail -c 60000 "$datei")"
  case "$ergebnis" in
    gruen) fazit=success titel="Baut mit $ziel $(kurz "$ziel_sha")"
      text="Der PR kompiliert zusammen mit dem aktuellen Stand von \`$ziel\` (Backend mit allen Zielen, Frontend-Typprüfung)." ;;
    konflikt) fazit=failure titel="Konflikt mit $ziel"
      text="Der PR lässt sich nicht konfliktfrei mit \`$ziel\` $(kurz "$ziel_sha") zusammenführen. \`$ziel\` in den Branch mergen, den Konflikt lösen, pushen." ;;
    rot) fazit=failure titel="Baut nicht mit $ziel $(kurz "$ziel_sha")"
      text="Zusammen mit dem aktuellen Stand von \`$ziel\` kompiliert der PR nicht. Meist hat ein inzwischen gemergter PR etwas geändert, das dieser PR noch alt benutzt: \`$ziel\` hineinmergen und anpassen. Die Fehlerausgabe steht unten." ;;
    *) fazit=failure titel="Kein Ergebnis"
      text="Der Kompilierlauf hat kein Ergebnis geliefert (\`${ergebnis:-leer}\`). Der Check gilt als rot, bis ein Lauf grün meldet." ;;
  esac
  echo "PR #$nr: $ergebnis → $fazit" >&2
  schliessen "$id" "$fazit" "$titel" "$text" "$ausgabe"
}

schliessen() { # <check-id> <conclusion> <titel> <text> <ausgabe>
  gh_api -X PATCH "repos/$REPO/check-runs/$1" -f status=completed -f conclusion="$2" \
    -f "output[title]=$3" -f "output[summary]=$4" \
    -f "output[text]=${5:+$(printf '```\n%s\n```' "$5")}" > /dev/null
}

aufruf() { sed -n '6,/^#   Umgebung/p' "$0" >&2; exit 2; }
[ -n "$REPO" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
case "${1:-}" in
  verteilen) [ $# -eq 3 ] || aufruf; shift; verteilen "$@" ;;
  auswahl) [ $# -eq 4 ] || aufruf; shift; auswahl "$@" ;;
  einzellauf) [ $# -eq 7 ] || aufruf; shift; einzellauf "$@" ;;
  melden) [ $# -eq 8 ] || aufruf; shift; melden "$@" ;;
  *) aufruf ;;
esac
