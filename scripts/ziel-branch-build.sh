#!/usr/bin/env bash
# LLH-1849: Auswahl und Meldung des Pflicht-Checks „Baut mit Ziel-Branch“. Kompiliert selbst
# nichts und führt keinen PR-Code aus: das tut der Job `kompilieren` in
# .github/workflows/ziel-branch-build.yml, ohne Schreibrechte.
#
#   scripts/ziel-branch-build.sh auswahl <ziel-branch> <ziel-sha> [<pr-nr>]
#       Ohne <pr-nr> (Push auf den Ziel-Branch): jeder offene PR gegen <ziel-branch>. Mit <pr-nr>
#       (PR-Ereignis): nur dieser. Ein fertiger PR (Auto-Merge an oder Label `e2e`, kein Entwurf,
#       kein Fork) bekommt den Check auf „läuft“; ein nicht fertiger, der den Check schon trägt,
#       bekommt ihn ohne <pr-nr> auf „wartet“. Gibt die fertigen PRs als JSON aus:
#       [{"nr": <nr>, "kopf": "<sha>", "check_id": <id>}, …]
#   scripts/ziel-branch-build.sh melden <pr-nr> <kopf-sha> <check-id> <ziel-branch> <ziel-sha> \
#       <ergebnis> <ausgabe-datei>
#       Schließt den Check <check-id>: ergebnis `gruen` → grün; `rot`, `konflikt`, `veraltet`,
#       leer oder unbekannt → rot. Stehen PR-Kopf oder Ziel-Branch nicht mehr auf dem gerechneten
#       Stand, ist das Ergebnis überholt (abgebrochen); den neuen Stand meldet sein eigener Lauf.
#   Exit 0 = gelaufen · 2 = Aufruf- oder Umgebungsfehler
#   Umgebung: ZBB_GH  Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#
# WARUM: Die CI eines PRs prüft den Stand des Ziel-Branches beim letzten Push. Am 12.11.2026 waren
# #1319 und #1315 einzeln grün und brachen `alpha` zusammen. Bewegt sich der Ziel-Branch, muss der
# Check an jedem fertigen PR neu rechnen, und bis dahin darf kein altes Grün stehen bleiben: daher
# „läuft“ sofort bei der Auswahl. Ein PR in Arbeit rechnet erst, wenn er fertig ist (wie die
# zweite Stufe, LLH-1662); bis dahin fehlt oder wartet der Check, und er ist nicht mergebar.
#
# Regeln: scripts/AGENTS.md, „Baut mit Ziel-Branch“. Spec: openspec/specs/pr-pruefstufen/.
set -euo pipefail

NAME="Baut mit Ziel-Branch"
REPO="${GITHUB_REPOSITORY:-}"
gh_api() { "${ZBB_GH:-gh}" api "$@"; }
kurz() { printf '%s' "${1:0:8}"; }

# Neuer Check-Run auf <sha> mit <status>; gibt seine ID aus.
check_neu() { # <sha> <status> <titel> <text>
  gh_api -X POST "repos/$REPO/check-runs" -f name="$NAME" -f head_sha="$1" -f status="$2" \
    -f "output[title]=$3" -f "output[summary]=$4" --jq .id
}

# Status des jüngsten Checks dieses Namens auf <sha>, leer, wenn es keinen gibt.
check_status() { # <sha>
  gh_api "repos/$REPO/commits/$1/check-runs?check_name=$(jq -rn --arg n "$NAME" '$n | @uri')&per_page=100" \
    --jq '[.check_runs[]] | sort_by(.id) | last | .status // ""'
}

auswahl() { # <ziel-branch> <ziel-sha> [<pr-nr>]
  local ziel="$1" ziel_sha="$2" nur="${3:-}" prs zeile nr kopf fertig id liste="[]"
  if [ -n "$nur" ]; then
    prs="$(gh_api "repos/$REPO/pulls/$nur" --jq '[.]')"
  else
    prs="$(gh_api "repos/$REPO/pulls?state=open&base=$ziel&per_page=100" --paginate --jq '.' | jq -s 'add // []')"
  fi
  while IFS=$'\t' read -r nr kopf fertig; do
    [ -n "$nr" ] || continue
    if [ "$fertig" = true ]; then
      id="$(check_neu "$kopf" in_progress "Rechnet gegen $ziel $(kurz "$ziel_sha")" \
        "Der PR wird mit dem aktuellen Stand von \`$ziel\` zusammengeführt und kompiliert.")"
      echo "PR #$nr: fertig, rechnet (Check $id)" >&2
      liste="$(jq -c --argjson nr "$nr" --arg kopf "$kopf" --argjson id "$id" \
        '. + [{nr: $nr, kopf: $kopf, check_id: $id}]' <<< "$liste")"
    elif [ -z "$nur" ]; then
      case "$(check_status "$kopf")" in
        "" ) echo "PR #$nr: nicht fertig, ohne Check" >&2 ;;
        queued) echo "PR #$nr: nicht fertig, wartet schon" >&2 ;;
        *)
          check_neu "$kopf" queued "Wartet: $ziel hat sich bewegt" \
            "\`$ziel\` steht jetzt auf $(kurz "$ziel_sha"). Der Check rechnet neu, sobald der PR fertig ist (Auto-Merge an oder Label \`e2e\`)." > /dev/null
          echo "PR #$nr: nicht fertig, Check wartet" >&2 ;;
      esac
    else
      echo "PR #$nr: nicht fertig oder Fork/Entwurf, kein Check" >&2
    fi
  done < <(jq -r --arg repo "$REPO" 'sort_by(.number)[]
      | select(.draft | not) | select((.head.repo.full_name // "") == $repo)
      | [.number, .head.sha,
         ((.auto_merge != null) or any((.labels // [])[]; .name == "e2e"))] | @tsv' <<< "$prs")
  printf '%s\n' "$liste"
}

melden() { # <pr-nr> <kopf-sha> <check-id> <ziel-branch> <ziel-sha> <ergebnis> <ausgabe-datei>
  local nr="$1" kopf="$2" id="$3" ziel="$4" ziel_sha="$5" ergebnis="$6" datei="$7"
  local jetzt_kopf jetzt_ziel fazit titel text ausgabe=""
  jetzt_kopf="$(gh_api "repos/$REPO/pulls/$nr" --jq .head.sha)"
  jetzt_ziel="$(gh_api "repos/$REPO/git/ref/heads/$ziel" --jq .object.sha)"
  if [ "$jetzt_kopf" != "$kopf" ] || [ "$jetzt_ziel" != "$ziel_sha" ]; then
    echo "PR #$nr: überholt (PR $(kurz "$jetzt_kopf"), $ziel $(kurz "$jetzt_ziel"))" >&2
    gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=completed -f conclusion=cancelled \
      -f "output[title]=Überholt" \
      -f "output[summary]=Gerechnet gegen PR $(kurz "$kopf") und \`$ziel\` $(kurz "$ziel_sha"); inzwischen steht einer davon weiter. Das Ergebnis zum neuen Stand meldet dessen eigener Lauf." > /dev/null
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
  gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=completed -f conclusion="$fazit" \
    -f "output[title]=$titel" -f "output[summary]=$text" \
    -f "output[text]=${ausgabe:+$(printf '```\n%s\n```' "$ausgabe")}" > /dev/null
}

aufruf() { sed -n '6,/^#   Umgebung/p' "$0" >&2; exit 2; }
[ -n "$REPO" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
case "${1:-}" in
  auswahl) [ $# -eq 3 ] || [ $# -eq 4 ] || aufruf; shift; auswahl "$@" ;;
  melden) [ $# -eq 8 ] || aufruf; shift; melden "$@" ;;
  *) aufruf ;;
esac
