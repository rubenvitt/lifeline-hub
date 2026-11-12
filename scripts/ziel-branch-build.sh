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
#   scripts/ziel-branch-build.sh melden <pr-nr> <kopf-sha> <check-id> <ziel-branch> <ziel-sha> \
#       <ergebnis> <ausgabe-datei>
#       Schließt den Check <check-id>: ergebnis `gruen` → grün; `rot`, `konflikt`, `veraltet`,
#       leer oder unbekannt → rot. Steht der PR-Kopf weiter oder der Ziel-Branch um mehr als
#       Release-Commits (die mit `[skip ci]` keinen Lauf starten) weiter, ist das Ergebnis
#       überholt (abgebrochen); den neuen Stand rechnet dessen eigener Lauf.
#   Exit 0 = gelaufen · 1 = an mindestens einem PR gescheitert (die übrigen sind bearbeitet) ·
#   2 = Aufruf- oder Umgebungsfehler
#   Umgebung: ZBB_GH  Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#
# WARUM: Die CI eines PRs prüft den Stand des Ziel-Branches beim letzten Push. Am 12.11.2026 waren
# #1319 und #1315 einzeln grün und brachen `alpha` zusammen. Bewegt sich der Ziel-Branch, muss der
# Check an jedem fertigen PR neu rechnen, und bis dahin soll kein altes Grün stehen bleiben: daher
# „läuft“ sofort beim Verteilen (ein Restfenster bis dahin bleibt, design.md). Gerechnet wird nie im
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

# Die offenen PRs als TSV: nr, kopf, kopf-branch, fertig, entwurf, fork.
pr_zeilen() { # <prs-json>
  jq -r --arg repo "$REPO" 'sort_by(.number)[]
      | [.number, .head.sha, .head.ref,
         ((.auto_merge != null) or any((.labels // [])[]; .name == "e2e")),
         (.draft == true), ((.head.repo.full_name // "") != $repo)] | @tsv' <<< "$1"
}

# Ein nicht fertiger PR, der den Check trägt, bekommt ihn auf „wartet“ (nicht noch einmal).
warten() { # <nr> <kopf> <ziel> <ziel-sha>
  case "$(check_status "$2")" in
    "") echo "PR #$1: nicht fertig, ohne Check" >&2 ;;
    queued) echo "PR #$1: nicht fertig, wartet schon" >&2 ;;
    *)
      check_neu "$2" queued "Wartet: $3 hat sich bewegt" \
        "\`$3\` steht jetzt auf $(kurz "$4"). Der Check rechnet neu, sobald der PR fertig ist (Auto-Merge an oder Label \`e2e\`, kein Entwurf)." > /dev/null
      echo "PR #$1: nicht fertig, Check wartet" >&2 ;;
  esac
}

verteilen() { # <ziel-branch> <ziel-sha>
  local ziel="$1" ziel_sha="$2" prs nr kopf zweig fertig entwurf fork id fehler=0
  prs="$(gh_api "repos/$REPO/pulls?state=open&base=$ziel&per_page=100" --paginate --jq '.' | jq -s 'add // []')"
  while IFS=$'\t' read -r nr kopf zweig fertig entwurf fork; do
    [ -n "$nr" ] || continue
    [ "$fork" = false ] || { echo "PR #$nr: Fork, kein Check" >&2; continue; }
    if [ "$fertig" = true ] && [ "$entwurf" = false ]; then
      id="$(check_neu "$kopf" in_progress "Rechnet gegen $ziel $(kurz "$ziel_sha")" \
        "Der PR wird mit dem aktuellen Stand von \`$ziel\` zusammengeführt und kompiliert.")" \
        || { echo "::warning::PR #$nr: Check nicht gesetzt"; fehler=1; continue; }
      if gh_api -X POST "repos/$REPO/actions/workflows/ziel-branch-build.yml/dispatches" -f ref="$zweig" \
        -f "inputs[nr]=$nr" -f "inputs[kopf]=$kopf" -f "inputs[check_id]=$id" \
        -f "inputs[ziel]=$ziel" -f "inputs[ziel_sha]=$ziel_sha" > /dev/null; then
        echo "PR #$nr: fertig, eigener Lauf auf $zweig (Check $id)" >&2
      else
        echo "::warning::PR #$nr: eigener Lauf auf $zweig nicht startbar"
        gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=completed -f conclusion=failure \
          -f "output[title]=Kann nicht neu rechnen" \
          -f "output[summary]=Auf \`$zweig\` ließ sich der Workflow „$NAME“ nicht starten, meist weil der Branch ihn noch nicht kennt. \`$ziel\` in den Branch hineinmergen und pushen; dann rechnet der Check." > /dev/null \
          || fehler=1
      fi
    else
      warten "$nr" "$kopf" "$ziel" "$ziel_sha" || { echo "::warning::PR #$nr: Check nicht gesetzt"; fehler=1; }
    fi
  done < <(pr_zeilen "$prs")
  return "$fehler"
}

auswahl() { # <ziel-branch> <ziel-sha> <pr-nr>
  local ziel="$1" ziel_sha="$2" prs nr kopf zweig fertig entwurf fork id liste="[]"
  prs="$(gh_api "repos/$REPO/pulls/$3" --jq '[.]')"
  while IFS=$'\t' read -r nr kopf zweig fertig entwurf fork; do
    [ -n "$nr" ] || continue
    if [ "$fork" = true ]; then
      echo "PR #$nr: Fork, kein Check" >&2
    elif [ "$fertig" = true ] && [ "$entwurf" = false ]; then
      id="$(check_neu "$kopf" in_progress "Rechnet gegen $ziel $(kurz "$ziel_sha")" \
        "Der PR wird mit dem aktuellen Stand von \`$ziel\` zusammengeführt und kompiliert.")"
      echo "PR #$nr: fertig, rechnet (Check $id)" >&2
      liste="$(jq -c --argjson nr "$nr" --arg kopf "$kopf" --argjson id "$id" \
        '. + [{nr: $nr, kopf: $kopf, check_id: $id}]' <<< "$liste")"
    else
      warten "$nr" "$kopf" "$ziel" "$ziel_sha"
    fi
  done < <(pr_zeilen "$prs")
  printf '%s\n' "$liste"
}

# Ist <neu> nur um Release-Commits weiter als <alt>? Die tragen `[skip ci]` und starten keinen
# Lauf; ohne diese Ausnahme hinge ein fertiger PR nach jedem Release bis zum nächsten Merge.
nur_release_weiter() { # <alt> <neu>
  gh_api "repos/$REPO/compare/$1...$2" --jq '.status == "ahead" and (.commits | length) > 0
      and all(.commits[]; .commit.message | startswith("chore(release):"))' 2> /dev/null | grep -qx true
}

melden() { # <pr-nr> <kopf-sha> <check-id> <ziel-branch> <ziel-sha> <ergebnis> <ausgabe-datei>
  local nr="$1" kopf="$2" id="$3" ziel="$4" ziel_sha="$5" ergebnis="$6" datei="$7"
  local jetzt_kopf jetzt_ziel fazit titel text ausgabe=""
  jetzt_kopf="$(gh_api "repos/$REPO/pulls/$nr" --jq .head.sha)"
  jetzt_ziel="$(gh_api "repos/$REPO/git/ref/heads/$ziel" --jq .object.sha)"
  if [ "$jetzt_kopf" != "$kopf" ] || { [ "$jetzt_ziel" != "$ziel_sha" ] && ! nur_release_weiter "$ziel_sha" "$jetzt_ziel"; }; then
    echo "PR #$nr: überholt (PR $(kurz "$jetzt_kopf"), $ziel $(kurz "$jetzt_ziel"))" >&2
    gh_api -X PATCH "repos/$REPO/check-runs/$id" -f status=completed -f conclusion=cancelled \
      -f "output[title]=Überholt" \
      -f "output[summary]=Gerechnet gegen PR $(kurz "$kopf") und \`$ziel\` $(kurz "$ziel_sha"); inzwischen steht einer davon weiter. Das Ergebnis zum neuen Stand meldet dessen eigener Lauf (ein neuer Commit am PR oder ein Merge auf \`$ziel\` startet ihn)." > /dev/null
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
  verteilen) [ $# -eq 3 ] || aufruf; shift; verteilen "$@" ;;
  auswahl) [ $# -eq 4 ] || aufruf; shift; auswahl "$@" ;;
  melden) [ $# -eq 8 ] || aufruf; shift; melden "$@" ;;
  *) aufruf ;;
esac
