#!/usr/bin/env bash
# LLH-1660: Stau-Wächter. Findet offene PRs, die ohne Zutun nicht mergen, und macht das sichtbar.
#
#   scripts/stau-waechter.sh [--nur-zeigen] alle
#       Bewertet jeden offenen PR des Repositories ($GITHUB_REPOSITORY), danach den Zustand von
#       `alpha` (wie `alpha`).
#   scripts/stau-waechter.sh [--nur-zeigen] alpha
#       Nur den Zustand von `alpha`: Hinweise „alpha rot“ an allen offenen PRs gegen `alpha`.
#   scripts/stau-waechter.sh [--nur-zeigen] bewerte <nr> <kopf-branch> <kopf-sha> <basis-branch> \
#       <entwurf> <fork> <auto-merge> <geaendert>
#       (entwurf, fork, auto-merge: true|false; geaendert: `updated_at` des PRs in Unix-Sekunden)
#       Bewertet einen PR; Kopf und Basis müssen lokal vorliegen (`alle` holt sie).
#   Exit 0 = gelaufen (auch mit Befunden) · 2 = Aufruf- oder Umgebungsfehler
#   --nur-zeigen: nennt Befund und geplante Aktion, schreibt nichts (kein Kommentar, kein Push).
#   Umgebung: STAU_SCHREIBEN  1 = darf auf PR-Branches pushen (Release-App eingerichtet)
#             STAU_REMOTE     Remote für Fetch und Push (Vorgabe origin)
#             STAU_GH         Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#             STAU_AUTOR      Konto, dessen Kommentare als Hinweise zählen (Vorgabe github-actions[bot])
#             STAU_JETZT      Uhrzeit als Unix-Sekunden (nur für den Selbsttest)
#
# WARUM: Eine Merge Queue gibt es für Repositories eines Benutzerkontos nicht, und Auto-Merge
# wartet still. Am 12.11.2026 lagen fünf PRs, aus Gründen, die sich wiederholen:
#   konflikt  Ein fremder Merge macht den PR konfliktbehaftet. Dann startet keine CI.
#   ohne-ci   Der Kopf-Commit trägt nach der Wartezeit keinen CI-Lauf (#1282, zehn Stunden).
#   haengt    Alles ist grün, Auto-Merge ist an, gemergt wird trotzdem nicht (#1283).
#
# WAS ER TUT:
#   konflikt  Ein Hinweis am PR mit den betroffenen Dateien. Der Kommentar weckt die Sitzung,
#             die den PR betreut; gelöst wird der Konflikt dort, nie hier.
#   ohne-ci   Er mergt den Ziel-Branch in den PR-Branch und pusht, damit die CI anläuft. Wo das
#             nicht geht (Fork, nichts zu mergen, keine Release-App, schon versucht): Hinweis.
#   haengt    Ein Hinweis am PR.
# Je PR gibt es höchstens EINEN Hinweis. Gleicher Befund (Art, Kopf-Commit, Dateien): nichts
# tun. Neuer Befund: alten Hinweis löschen, neuen anlegen (nur ein neuer Kommentar
# benachrichtigt). Kein Befund mehr: den Hinweis auf „behoben“ ändern. Das gilt auch für einen
# Hinweis einer Art, die es nicht mehr gibt (`ohne-e2e`, bis LLH-1889 die zweite Stufe im PR).
#
# ALPHA ROT (LLH-1849): Am 12.11.2026 waren #1319 und #1315 einzeln grün und brachen `alpha`
# zusammen; danach bauten vier Sitzungen denselben Fix, und ihre Varianten kollidierten. Ist der
# jüngste abgeschlossene CI-Lauf auf `alpha` rot (ein Fehler allein im Release zählt nicht; ein
# abgebrochener Lauf, dessen Tests ein neuer Push abbrach, wird übersprungen, es zählt der davor),
# bestimmt der Wächter HÖCHSTENS EINEN Zuständigen und schreibt an jeden offenen PR gegen `alpha`
# einen eigenen Hinweis (Marke `stau-waechter-alpha`, neben dem Hinweis zum PR, gleiche Regeln):
#   fix        der PR trägt das Label `alpha-rot` und ist der Fix (bei mehreren die kleinste
#              Nummer; auch ein Entwurf, damit der Zuständige den Fix sofort belegen kann)
#   doppelt    ein weiterer PR mit `alpha-rot`
#   zustaendig ohne Fix-PR: wer den Auftrag hat, behält ihn eine volle Stunde ab seinem Hinweis
#              (der Hinweis ist der Zustand); dann der nächste Kandidat mit größerer Nummer, nach
#              dem letzten der erste. Kandidaten: PRs ohne Entwurf, Fork, Dependabot
#   wartet     alle übrigen; sie nennen den Fix-PR erst, wenn es einen gibt, damit ein Wechsel des
#              Auftrags nicht jede wartende Sitzung weckt
# Das Label legt er an, wenn es fehlt. Ein neu gestarteter roter Lauf, der noch läuft, oder nicht
# lesbare Jobs machen den Zustand unbestimmt: dann schreibt er nichts (sonst gälte das ältere Grün).
# Ist `alpha` wieder grün und der jüngste Lauf eines Checks auf dem Kopf des PRs rot, mergt der
# Wächter `alpha` hinein, sofern der PR kein Entwurf, konfliktfrei und ohne den grünen Stand ist,
# und setzt den Hinweis auf „angestossen“, sonst auf „behoben“. Sind die Checks nicht lesbar, läuft
# die CI noch oder scheitert der Push, bleibt der Hinweis offen. Den Zustand liest er aus den
# Push-Läufen von ci.yml (Actions-API).
#
# DIE GRENZEN beim Schreiben auf einen PR-Branch (wie migrationen-autofix.sh):
#   1. Nie auf `alpha`, `beta`, `main`; nur PRs, deren Kopf in diesem Repository liegt.
#   2. Nur Fast-Forward auf GENAU den bewerteten Kopf (`--force-with-lease` als Bedingung, der
#      Merge-Commit sitzt direkt darauf). Hat sich der Branch inzwischen bewegt, wurde er
#      zurückgesetzt oder gelöscht, weist das Remote den Push ab.
#   3. Schleifenbremse bei `ohne-ci`: ist der Kopf schon ein Merge des Wächters, pusht er nicht
#      noch einmal. Bei „alpha rot“ ist die Bremse, dass der Branch den grünen Stand von `alpha`
#      schon enthält; danach ist der Hinweis abgeschlossen.
# PR-Code wird nie ausgeführt: gerechnet wird mit `git merge-tree`, gemergt mit `git merge`.
#
# Regeln: scripts/AGENTS.md, „Stau-Wächter“. Spec: openspec/specs/merge-stau/.
set -euo pipefail

MARKE="stau-waechter"
MARKE_ALPHA="stau-waechter-alpha"
ALPHA_LABEL="alpha-rot"
TRAILER_SCHLUESSEL="Stau-Waechter"
TRAILER_WERT="LLH-1660"
WARTEZEIT=1200 # Sekunden, bis ein fehlender CI-Lauf oder ein ausbleibender Merge als Befund gilt
CI_CHECK="Schnellprüfungen" # läuft in ci.yml bei jedem PR-Lauf, unabhängig von den Bereichen
ZIEL_BRANCHES=" alpha beta main "

NUR_ZEIGEN=0
if [ "${1:-}" = --nur-zeigen ]; then NUR_ZEIGEN=1; shift; fi
REMOTE="${STAU_REMOTE:-origin}"
REPO="${GITHUB_REPOSITORY:-}"

git() { command git -c core.quotePath=false "$@"; }
gh_api() { "${STAU_GH:-gh}" api "$@"; }
jetzt() { printf '%s\n' "${STAU_JETZT:-$(date +%s)}"; }
kurz() { printf '%s' "${1:0:8}"; }
sag() { printf '    %s\n' "$*"; }

# ── Befund ──────────────────────────────────────────────────────────────────────────

# Dateien, in denen <basis> und <kopf> kollidieren, eine je Zeile. Exit 0 = Konflikt (Dateien
# auf stdout), 1 = konfliktfrei, 2 = nicht bestimmbar.
konflikt_dateien() { # <basis-commit> <kopf-commit>
  local aus code=0
  aus="$(git merge-tree --write-tree --name-only --no-messages "$1" "$2" 2> /dev/null)" || code=$?
  case "$code" in
    0) return 1 ;;
    1) printf '%s\n' "$aus" | tail -n +2 | sed '/^$/d' | sort -u; return 0 ;;
    *) return 2 ;;
  esac
}

# Kennzahlen der Check-Runs eines Commits als eine Zeile:
#   <hat-ci 0|1> <frühester Start, Unix> <alle fertig und grün 0|1> <spätestes Ende, Unix>
#   <einer rot 0|1> <einer läuft noch 0|1>
# (0 statt einer Zeit, wenn es keine gibt.) „Grün“, „rot“ und „läuft“ werten je Name den JÜNGSTEN
# Check-Run, wie GitHub bei den Required Checks: ein abgebrochener erster Lauf auf demselben Kopf
# bleibt in der Liste stehen, zählt aber nicht mehr.
check_kennzahlen() { # <sha>
  gh_api "repos/$REPO/commits/$1/check-runs?per_page=100" --paginate \
    | jq -r -s --arg ci "$CI_CHECK" '
        [.[] | (.check_runs // [])[]] as $alle
        | [$alle | group_by(.name)[] | sort_by(.id // 0, .started_at // "") | last] as $juengste
        | def zeit: if . == null then empty else (sub("\\.[0-9]+"; "") | fromdateiso8601) end;
        [ (if any($alle[]; .name == $ci) then 1 else 0 end),
          ([$alle[] | .started_at | zeit] | min // 0),
          (if ($juengste | length) > 0 and all($juengste[]; .status == "completed"
              and (.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral"))
            then 1 else 0 end),
          ([$alle[] | .completed_at | zeit] | max // 0),
          (if any($juengste[]; .conclusion == "failure" or .conclusion == "timed_out")
            then 1 else 0 end),
          (if any($juengste[]; .status != "completed") then 1 else 0 end)
        ] | map(tostring) | join(" ")'
}

# ── Hinweis am PR ───────────────────────────────────────────────────────────────────

# Der bestehende Hinweis eines PRs als "<kommentar-id> <art> <kennung> <angelegt, Unix>", leer, wenn es keinen
# gibt. Exit ≠ 0, wenn die Kommentare nicht lesbar sind: das ist NICHT „kein Hinweis“, sonst
# entstünde bei jedem Aussetzer der API ein zweiter. Nur Kommentare des Wächters selbst zählen
# (STAU_AUTOR); eine von Hand veränderte Marke gilt als Art `unbekannt` und wird ersetzt.
# Die Marke steht in HINWEIS_MARKE (Vorgabe MARKE): der Befund „alpha rot“ führt seinen eigenen
# Hinweis neben dem zum PR (LLH-1849); die Funktion, die ihn schreibt, setzt sie lokal.
hinweis_lesen() { # <nr>
  local seiten
  seiten="$(gh_api "repos/$REPO/issues/$1/comments?per_page=100" --paginate)" || return 1
  printf '%s' "$seiten" | jq -r -s --arg marke "${HINWEIS_MARKE:-$MARKE}" --arg autor "${STAU_AUTOR:-github-actions[bot]}" '
      [.[][] | select((.user.login // "") == $autor)
             | select((.body // "") | startswith("<!-- " + $marke + ":"))] | last
      | select(. != null)
      | ((.body | capture("^<!-- " + $marke + ":(?<art>[a-z0-9-]+):(?<kennung>[0-9a-f]+) -->"))
          // {art: "unbekannt", kennung: "0"}) as $m
      | "\(.id) \($m.art) \($m.kennung) \((.created_at // "1970-01-01T00:00:00Z") | sub("\\.[0-9]+"; "") | fromdateiso8601)"'
}

kennung() { printf '%s' "$*" | sha256sum | cut -c1-16; }

# Setzt den Hinweis eines PRs auf <art> mit <text>. Leere Art = kein Befund.
hinweis_setzen() { # <nr> <art> <kennung> <text>
  local nr="$1" art="$2" kenn="$3" text="$4" alt alt_id="" alt_art="" alt_kenn=""
  local marke="${HINWEIS_MARKE:-$MARKE}"
  alt="$(hinweis_lesen "$nr")" || { sag "Kommentare nicht lesbar, Hinweis bleibt, wie er ist"; return 0; }
  if [ -n "$alt" ]; then read -r alt_id alt_art alt_kenn _ <<< "$alt"; fi

  if [ -z "$art" ]; then
    # Kein Befund: einen offenen Hinweis auf „behoben“ ändern. `angestossen` und `behoben`
    # sind schon Abschlüsse und bleiben stehen.
    case "$alt_art" in
      "" | behoben | angestossen) return 0 ;;
    esac
    sag "Hinweis ($alt_art) ist behoben"
    [ "$NUR_ZEIGEN" = 1 ] && return 0
    gh_api -X PATCH "repos/$REPO/issues/comments/$alt_id" -f body="<!-- $marke:behoben:$alt_kenn -->
${HINWEIS_BEHOBEN:-**Behoben** (Stau-Wächter): Der gemeldete Befund besteht nicht mehr.}" > /dev/null
    return 0
  fi

  if [ "$alt_art" = "$art" ] && [ "$alt_kenn" = "$kenn" ]; then
    sag "Hinweis ($art) steht schon, Befund unverändert"
    return 0
  fi
  sag "Hinweis ($art) wird geschrieben"
  [ "$NUR_ZEIGEN" = 1 ] && return 0
  # Löschen und neu anlegen statt ändern: nur ein neuer Kommentar benachrichtigt.
  if [ -n "$alt_id" ]; then
    gh_api -X DELETE "repos/$REPO/issues/comments/$alt_id" > /dev/null || true
  fi
  gh_api -X POST "repos/$REPO/issues/$nr/comments" -f body="<!-- $marke:$art:$kenn -->
$text" > /dev/null
}

# ── Ein PR ──────────────────────────────────────────────────────────────────────────

# Mergt <basis> in <kopf-sha> und pusht per Fast-Forward auf <kopf-branch>.
# Exit 0 = gepusht (neuer Commit auf stdout) · 4 = Branch hat sich bewegt · 2 = Fehler
# [grund]: der Absatz der Commit-Nachricht, der sagt, warum (Vorgabe: der fehlende CI-Lauf).
basis_hineinmergen() { # <kopf-branch> <kopf-sha> <basis-branch> <basis-commit> [grund]
  local branch="$1" k="$2" basis="$3" b="$4" grund="${5:-}" tmp wt neu jetzt_sha code=0
  tmp="$(mktemp -d)"
  wt="$tmp/arbeitsbaum"
  git worktree add -q --detach "$wt" "$k"
  if [ -z "$grund" ]; then
    grund="$(printf 'Der Kopf-Commit %s trug nach %s Minuten keinen CI-Lauf. Der Stau-Wächter\nmergt %s hinein, damit die CI anläuft (scripts/stau-waechter.sh).' \
      "$(kurz "$k")" "$((WARTEZEIT / 60))" "$basis")"
  fi
  {
    printf "Merge branch '%s' into %s\n\n" "$basis" "$branch"
    printf '%s\n' "$grund"
    printf '\n%s: %s\n' "$TRAILER_SCHLUESSEL" "$TRAILER_WERT"
  } > "$tmp/nachricht"
  if ! git -C "$wt" merge -q --no-ff -F "$tmp/nachricht" "$b" > "$tmp/ausgabe" 2>&1; then
    cat "$tmp/ausgabe" >&2
    code=2
  else
    neu="$(git -C "$wt" rev-parse HEAD)"
    # Ohne Force: nur ein Fast-Forward vom bewerteten Kopf wird angenommen (Grenze 2).
    # Der Lease bindet den Push an GENAU den bewerteten Kopf. Ein einfacher Push prüfte nur
    # Fast-Forward gegen das, was gerade im Remote steht: ein inzwischen gelöschter Branch
    # entstünde neu, ein per Force zurückgesetzter bekäme die entfernten Commits zurück.
    if git -C "$wt" push -q --force-with-lease="refs/heads/$branch:$k" "$REMOTE" \
      "$neu:refs/heads/$branch" 2> "$tmp/ausgabe"; then
      printf '%s\n' "$neu"
    else
      # Bewegt oder verweigert? Nur ein bewegter Branch ist der erwartete Fall.
      jetzt_sha="$(git -C "$wt" ls-remote "$REMOTE" "refs/heads/$branch" | cut -f1)" || jetzt_sha=""
      if [ "$jetzt_sha" != "$k" ]; then # bewegt, zurückgesetzt oder gelöscht
        code=4
      else
        cat "$tmp/ausgabe" >&2
        code=2
      fi
    fi
  fi
  git worktree remove --force "$wt" > /dev/null 2>&1 || true
  rm -rf "$tmp"
  return "$code"
}

bewerte() { # <nr> <kopf-branch> <kopf-sha> <basis-branch> <entwurf> <fork> <auto-merge> <geaendert>
  local nr="$1" branch="$2" kopf="$3" basis="$4" entwurf="$5" fork="$6" automerge="$7" geaendert="$8"
  local k b dateien code kenn liste text zahlen hat_ci start gruen ende alter grund neu
  echo "==> PR #$nr ($branch → $basis, $(kurz "$kopf"))"

  if [ "$entwurf" = true ]; then sag "Entwurf, übersprungen"; return 0; fi
  case "$ZIEL_BRANCHES" in *" $basis "*) ;; *) sag "Ziel '$basis' ist kein Kanal-Branch, übersprungen"; return 0 ;; esac
  k="$(git rev-parse --verify --quiet "$kopf^{commit}")" || { sag "Kopf fehlt lokal, übersprungen"; return 0; }
  b="$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/$basis^{commit}")" \
    || { sag "Basis $REMOTE/$basis fehlt lokal, übersprungen"; return 0; }

  # ── Konflikt ──
  code=0
  dateien="$(konflikt_dateien "$b" "$k")" || code=$?
  if [ "$code" = 2 ]; then sag "Konflikt nicht bestimmbar, übersprungen"; return 0; fi
  if [ "$code" = 0 ]; then
    sag "Befund: Konflikt mit $basis in $(printf '%s\n' "$dateien" | wc -l | tr -d ' ') Datei(en)"
    kenn="$(kennung "konflikt $k $dateien")"
    liste="$(printf '%s\n' "$dateien" | sed 's/^/- `/; s/$/`/')"
    text="**Konflikt mit \`$basis\`** (Stau-Wächter)

Dieser PR lässt sich nicht mehr konfliktfrei mit \`$basis\` zusammenführen. Solange der Konflikt besteht, startet keine CI, und Auto-Merge wartet.

Betroffene Dateien (PR \`$(kurz "$k")\`, \`$basis\` \`$(kurz "$b")\`):

$liste

So geht es weiter: \`$basis\` in den Branch mergen (kein Rebase, kein Force-Push), den Konflikt lösen, pushen.

\`\`\`sh
git fetch origin $basis && git merge origin/$basis
\`\`\`"
    hinweis_setzen "$nr" konflikt "$kenn" "$text"
    return 0
  fi

  # ── CI-Lauf vorhanden? ──
  zahlen="$(check_kennzahlen "$k")" || { sag "Check-Runs nicht lesbar, übersprungen"; return 0; }
  read -r hat_ci start gruen ende _ _ <<< "$zahlen"
  if [ "$hat_ci" = 0 ]; then
    # Ohne jeden Check-Run zählt die letzte Änderung am PR (`updated_at`): sie liegt nie vor
    # dem Push. Das Commit-Datum taugt nicht, ein alter Commit kann eben erst gepusht sein.
    [ "$start" != 0 ] || start="$geaendert"
    alter=$(( $(jetzt) - start ))
    if [ "$alter" -lt "$WARTEZEIT" ]; then
      sag "kein CI-Lauf, aber erst $((alter / 60)) min alt: abwarten"
      return 0
    fi
    sag "Befund: seit $((alter / 60)) min kein CI-Lauf auf $(kurz "$k")"
    grund=""
    if [ "$fork" = true ]; then grund="Der Branch liegt in einem Fork, dorthin schreibt der Wächter nicht."
    elif case "$ZIEL_BRANCHES" in *" $branch "*) true ;; *) false ;; esac; then
      grund="Der Branch heißt wie ein Ziel-Branch, dorthin schreibt der Wächter nie."
    elif [ -n "$(git log -1 --format="%(trailers:key=$TRAILER_SCHLUESSEL,valueonly)" "$k")" ]; then
      grund="Der Wächter hat \`$basis\` schon hineingemergt, die CI lief trotzdem nicht an."
    elif git merge-base --is-ancestor "$b" "$k"; then
      grund="\`$basis\` ist schon vollständig im Branch, es gibt nichts hineinzumergen."
    elif [ "${STAU_SCHREIBEN:-0}" != 1 ]; then
      grund="Die Release-App ist nicht eingerichtet, der Wächter kann nicht pushen."
    fi
    if [ -z "$grund" ]; then
      sag "Aktion: $basis in $branch mergen und pushen"
      [ "$NUR_ZEIGEN" = 1 ] && return 0
      code=0
      neu="$(basis_hineinmergen "$branch" "$k" "$basis" "$b")" || code=$?
      case "$code" in
        0)
          sag "gepusht: $(kurz "$k") → $(kurz "$neu")"
          hinweis_setzen "$nr" angestossen "$(kennung "angestossen $neu")" "**CI angestoßen** (Stau-Wächter)

Der Kopf-Commit \`$(kurz "$k")\` trug nach $((alter / 60)) Minuten keinen CI-Lauf. Commit \`$(kurz "$neu")\` mergt \`$basis\` in den Branch, damit die CI anläuft.

Wer lokal auf diesem Branch weiterarbeitet: vor dem nächsten Push \`git pull\`."
          return 0 ;;
        4) sag "Push abgewiesen: der Branch hat sich bewegt, der neue Stand wird neu bewertet"; return 0 ;;
        *) grund="Der Versuch, \`$basis\` hineinzumergen und zu pushen, ist gescheitert (siehe Lauf des Wächters)." ;;
      esac
    fi
    hinweis_setzen "$nr" ohne-ci "$(kennung "ohne-ci $k $grund")" "**Kein CI-Lauf** (Stau-Wächter)

Der Kopf-Commit \`$(kurz "$k")\` trägt seit $((alter / 60)) Minuten keinen CI-Lauf (\`$CI_CHECK\` fehlt). Ohne ihn fehlen die Pflicht-Checks, und Auto-Merge wartet.

$grund

So geht es weiter: einen neuen Commit pushen, etwa \`$basis\` in den Branch mergen, sobald es dort Neues gibt."
    return 0
  fi

  # ── Grün, Auto-Merge an, aber nicht gemergt ──
  if [ "$automerge" = true ] && [ "$gruen" = 1 ] && [ "$ende" != 0 ] \
    && [ $(( $(jetzt) - ende )) -ge "$WARTEZEIT" ] \
    && [ "$(gh_api "repos/$REPO/commits/$k/status" | jq -r '.state // ""')" = success ]; then
    sag "Befund: seit $(( ($(jetzt) - ende) / 60 )) min grün, Auto-Merge an, nicht gemergt"
    hinweis_setzen "$nr" haengt "$(kennung "haengt $k")" "**Grün, aber nicht gemergt** (Stau-Wächter)

Alle Checks auf \`$(kurz "$k")\` sind seit $(( ($(jetzt) - ende) / 60 )) Minuten grün, Auto-Merge ist eingeschaltet, gemergt wurde trotzdem nicht.

So geht es weiter: den PR von Hand mergen, oder Auto-Merge aus- und wieder einschalten."
    return 0
  fi

  sag "kein Befund"
  hinweis_setzen "$nr" "" "" ""
}

# ── alpha rot (LLH-1849) ────────────────────────────────────────────────────────────

# Wie ist ein abgeschlossener CI-Lauf auf alpha ausgegangen? Setzt LAUF_ART auf gruen, rot,
# unklar (abgebrochen, übersprungen: diesen Lauf überspringen) oder fehler (Jobs nicht lesbar:
# der Zustand ist nicht bestimmbar, NICHT „weitersuchen“, sonst gälte ein älteres Grün). Rot heißt:
# ein Job außer dem Release ist fehlgeschlagen (der Release ist ein wiederverwendbarer Workflow,
# seine Jobs heißen „Release / …“); deren Namen kommen in LAUF_JOBS. Nicht in `$( )` aufrufen: die
# Variablen gingen mit der Subshell verloren.
lauf_art() { # <lauf-id> <conclusion>
  local jobs
  LAUF_ART=unklar LAUF_JOBS=""
  case "$2" in
    success) LAUF_ART=gruen; return 0 ;;
    failure | timed_out) ;;
    *) return 0 ;;
  esac
  jobs="$(gh_api "repos/$REPO/actions/runs/$1/jobs?filter=latest&per_page=100")" || { LAUF_ART=fehler; return 0; }
  LAUF_JOBS="$(printf '%s' "$jobs" | jq -r '[.jobs[]
      | select(.conclusion == "failure" or .conclusion == "timed_out")
      | select(.name | test("^Release( |$)") | not) | .name] | join(", ")')" || { LAUF_ART=fehler; return 0; }
  if [ -n "$LAUF_JOBS" ]; then LAUF_ART=rot; else LAUF_ART=gruen; fi
}

# Zustand von alpha aus den Push-Läufen von ci.yml, neuester zuerst. Setzt:
#   ALPHA_ZUSTAND  gruen | rot | unklar
#   ALPHA_GRUEN    Kopf des jüngsten grünen Laufs (gruen) bzw. des letzten grünen vor dem Rot
#   ALPHA_ROT_ID   Lauf-ID des ERSTEN roten Laufs seit dem letzten Grün (Kennung des Befunds)
#   ALPHA_ROT_URL  der jüngste rote Lauf; ALPHA_FEHLER seine roten Jobs
#   ALPHA_URSACHE  die PRs, die zwischen letztem Grün und erstem Rot gemergt wurden („#1 #2“)
# Ein Lauf, der noch läuft, zählt nicht, außer er ist ein neu gestarteter (Versuch > 1): dessen
# altes Ergebnis ist überschrieben, und bis er fertig ist, ist der Zustand unklar. Sonst gälte
# während des Neustarts, den der Auftrag bei einem wackligen Test selbst empfiehlt, das ältere
# Grün, und der Wächter mergte das noch rote alpha in die PRs.
# Exit ≠ 0, wenn die Läufe nicht lesbar sind.
alpha_zustand() {
  local laeufe id sha status fazit url versuch art rot_sha="" erster=1
  ALPHA_ZUSTAND=unklar ALPHA_GRUEN="" ALPHA_ROT_ID="" ALPHA_ROT_URL="" ALPHA_FEHLER="" ALPHA_URSACHE=""
  laeufe="$(gh_api "repos/$REPO/actions/workflows/ci.yml/runs?branch=alpha&event=push&per_page=30")" || return 1
  while IFS=$'\t' read -r id sha status fazit url versuch; do
    if [ "$status" != completed ]; then
      [ "${versuch:-1}" -le 1 ] || { ALPHA_ZUSTAND=unklar; return 0; }
      continue
    fi
    lauf_art "$id" "$fazit"
    art="$LAUF_ART"
    [ "$art" != fehler ] || { ALPHA_ZUSTAND=unklar; return 0; }
    [ "$art" != unklar ] || continue
    if [ "$erster" = 1 ]; then
      erster=0
      if [ "$art" = gruen ]; then
        ALPHA_ZUSTAND=gruen ALPHA_GRUEN="$sha"
        return 0
      fi
      ALPHA_ZUSTAND=rot ALPHA_ROT_URL="$url" ALPHA_FEHLER="$LAUF_JOBS"
    fi
    if [ "$art" = rot ]; then
      ALPHA_ROT_ID="$id" rot_sha="$sha"
      continue
    fi
    ALPHA_GRUEN="$sha" # der letzte grüne Lauf vor dem Rot
    break
  done < <(printf '%s' "$laeufe" | jq -r '.workflow_runs[]
      | [.id, .head_sha, .status, (.conclusion // "-"), (.html_url // "-"), (.run_attempt // 1)] | @tsv')
  if [ "$ALPHA_ZUSTAND" = rot ] && [ -n "$ALPHA_GRUEN" ]; then
    ALPHA_URSACHE="$(git log --first-parent --reverse --format=%s "$ALPHA_GRUEN..$rot_sha" 2> /dev/null \
      | sed -n -E -e 's/^Merge pull request #([0-9]+) .*/#\1/p' -e 's/.*\(#([0-9]+)\)$/#\1/p' | tr '\n' ' ')"
    ALPHA_URSACHE="${ALPHA_URSACHE% }"
  fi
  return 0
}

# Das Label, an dem der Fix-PR erkennbar ist. Fehlt es im Repository, scheitert `gh pr create
# --label alpha-rot`, und der Fix bliebe unerkannt: also anlegen.
alpha_label_sichern() {
  gh_api "repos/$REPO/labels/$ALPHA_LABEL" > /dev/null 2>&1 && return 0
  sag "Label $ALPHA_LABEL fehlt, wird angelegt"
  [ "$NUR_ZEIGEN" = 1 ] && return 0
  gh_api -X POST "repos/$REPO/labels" -f name="$ALPHA_LABEL" -f color=d73a4a \
    -f description="Fix für ein rotes alpha (Stau-Wächter, LLH-1849)" > /dev/null \
    || sag "Label $ALPHA_LABEL ließ sich nicht anlegen"
}

# Der Absatz über den Bruch, gleich in jedem Hinweis zu „alpha rot“.
alpha_lage() {
  local ursache="${ALPHA_URSACHE:-nicht bestimmbar (kein grüner Lauf in Reichweite)}"
  printf 'Der jüngste CI-Lauf auf `alpha` ist rot ([Lauf](%s)), fehlgeschlagen: %s. Vermutliche Ursache, seit dem letzten grünen Lauf gemergt: %s.' \
    "$ALPHA_ROT_URL" "$ALPHA_FEHLER" "$(printf '%s' "$ursache" | sed 's/ /, /g')"
}

# Schreibt den Hinweis zu „alpha rot“ an PR <nr> in der Rolle <rolle>. <zust>: der Fix-PR (bei
# fix/doppelt/wartet mit Fix) oder leer; <niemand>=1, wenn kein PR den Auftrag übernehmen kann.
alpha_hinweis() { # <nr> <rolle> <zust> [niemand]
  local nr="$1" rolle="$2" fix="$3" niemand="${4:-0}" HINWEIS_MARKE="$MARKE_ALPHA" text kenn wer lage
  lage="$(alpha_lage)"
  case "$rolle" in
    fix)
      kenn="$(kennung "fix $ALPHA_ROT_ID")"
      text="**Fix für \`alpha\`** (Stau-Wächter)

$lage

Dieser PR trägt das Label \`$ALPHA_LABEL\` und gilt als der Fix. Die übrigen offenen PRs warten auf ihn und reparieren nichts selbst. Ist \`alpha\` wieder grün, mergt der Wächter \`alpha\` in die PRs, deren CI rot ist." ;;
    doppelt)
      kenn="$(kennung "doppelt $ALPHA_ROT_ID $fix")"
      text="**Doppelter Fix für \`alpha\`** (Stau-Wächter)

$lage

Mehrere offene PRs tragen das Label \`$ALPHA_LABEL\`; als Fix gilt der mit der kleinsten Nummer, #$fix. Diesen PR schließen, oder das Label entfernen, wenn er etwas anderes repariert." ;;
    zustaendig)
      # Ohne Ursache und rote Jobs: ein weiterer roter Lauf erneuert den Auftrag nicht. Er haftet
      # ab seiner Erteilung; sonst behielte ein untätiger Halter ihn bei wechselnden Fehlern.
      kenn="$(kennung "zustaendig $ALPHA_ROT_ID")"
      text="**\`alpha\` ist rot: dieser PR ist zuständig** (Stau-Wächter)

$lage

Damit nicht mehrere Sitzungen denselben Fix bauen, ist genau ein PR beauftragt, und das ist dieser:

1. Liegt der Fehler nicht im Code (Ausfall, wackliger Test), den fehlgeschlagenen Job neu starten. Ein grüner Lauf beendet den Befund.
2. Sonst **sofort** einen PR von \`alpha\` mit dem Label \`$ALPHA_LABEL\` öffnen (als Entwurf genügt), nicht in diesem PR reparieren. Das Label belegt den Fix: die übrigen PRs erkennen ihn daran, und der Auftrag wandert nicht weiter. Erst dann den Fix bauen und abstimmen.

Gibt es eine volle Stunde nach diesem Auftrag keinen PR mit dem Label, geht der Auftrag an den nächsten offenen PR." ;;
    wartet)
      kenn="$(kennung "wartet $ALPHA_ROT_ID $fix $niemand")"
      if [ -n "$fix" ]; then
        wer="#$fix ist der Fix (Label \`$ALPHA_LABEL\`)."
      elif [ "$niemand" = 1 ]; then
        wer="Kein offener PR kann den Auftrag übernehmen (es gibt nur Entwürfe, Forks oder Dependabot-PRs); den Fix muss ein Mensch anstoßen, mit einem PR von \`alpha\` und dem Label \`$ALPHA_LABEL\`."
      else
        wer="Ein anderer offener PR ist beauftragt, den Fix zu bauen; sobald es einen PR mit dem Label \`$ALPHA_LABEL\` gibt, nennt ihn dieser Hinweis."
      fi
      text="**\`alpha\` ist rot** (Stau-Wächter)

$lage

$wer **Diesen Bruch hier nicht selbst reparieren:** mehrere Fixe für dieselbe Stelle kollidieren danach in jedem PR. Ist \`alpha\` wieder grün, mergt der Wächter \`alpha\` in diesen PR, falls seine CI rot ist." ;;
  esac
  hinweis_setzen "$nr" "$rolle" "$kenn" "$text"
}

# alpha ist wieder grün: offenen Hinweis schließen, roten PR mit alpha nachziehen. Der Hinweis
# bleibt offen, solange die Lage nicht bestimmbar ist (Checks nicht lesbar, CI des PRs läuft noch,
# Push gescheitert): ein „behoben“ wäre endgültig, der nächste Lauf sähe den PR nicht mehr an.
alpha_nach_fix() { # <nr> <kopf-branch> <kopf-sha> <fork> <entwurf>
  local nr="$1" branch="$2" k="$3" fork="$4" entwurf="$5" HINWEIS_MARKE="$MARKE_ALPHA" alt alt_art="" b
  local HINWEIS_BEHOBEN="**Behoben** (Stau-Wächter): \`alpha\` ist wieder grün."
  local zahlen rot laeuft code=0 neu grund
  alt="$(hinweis_lesen "$nr")" || { sag "Kommentare nicht lesbar, Hinweis bleibt, wie er ist"; return 0; }
  [ -n "$alt" ] && read -r _ alt_art _ _ <<< "$alt"
  case "$alt_art" in fix | doppelt | zustaendig | wartet) ;; *) return 0 ;; esac
  zahlen="$(check_kennzahlen "$k")" || { sag "Checks nicht lesbar, Hinweis bleibt offen"; return 0; }
  read -r _ _ _ _ rot laeuft <<< "$zahlen"
  # Läuft noch ein Check und ist keiner rot, abwarten. Abgebrochene oder fehlende Checks laufen
  # nicht: dann ist nichts rot, und der Hinweis wird behoben.
  if [ "$rot" != 1 ] && [ "$laeuft" = 1 ]; then sag "CI des PRs läuft noch, abwarten"; return 0; fi
  b="$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/alpha^{commit}")" || b=""
  grund=""
  if [ "$rot" != 1 ]; then grund="CI nicht rot"
  elif [ "$entwurf" = true ]; then grund="Entwurf"
  elif [ -z "$b" ]; then grund="alpha fehlt lokal"
  elif [ "$fork" = true ]; then grund="Fork"
  elif case "$ZIEL_BRANCHES" in *" $branch "*) true ;; *) false ;; esac; then grund="Kopf-Branch heißt wie ein Ziel-Branch"
  elif [ -n "$ALPHA_GRUEN" ] && git merge-base --is-ancestor "$ALPHA_GRUEN" "$k" 2> /dev/null; then grund="grüner Stand schon enthalten"
  elif konflikt_dateien "$b" "$k" > /dev/null; then grund="Konflikt mit alpha"
  elif [ "${STAU_SCHREIBEN:-0}" != 1 ]; then grund="Release-App fehlt"
  fi
  if [ -n "$grund" ]; then
    sag "alpha wieder grün, nichts zu mergen ($grund)"
    hinweis_setzen "$nr" "" "" ""
    return 0
  fi
  sag "Aktion: alpha ist wieder grün, die CI des PRs rot: alpha in $branch mergen und pushen"
  [ "$NUR_ZEIGEN" = 1 ] && return 0
  neu="$(basis_hineinmergen "$branch" "$k" alpha "$b" "$(printf '`alpha` war rot und ist wieder grün, die CI auf %s war rot. Der Stau-Wächter\nmergt alpha hinein, damit die CI mit dem Fix neu läuft (scripts/stau-waechter.sh).' "$(kurz "$k")")")" \
    || code=$?
  case "$code" in
    0)
      sag "gepusht: $(kurz "$k") → $(kurz "$neu")"
      hinweis_setzen "$nr" angestossen "$(kennung "alpha-angestossen $neu")" "**\`alpha\` ist wieder grün, CI angestoßen** (Stau-Wächter)

Commit \`$(kurz "$neu")\` mergt \`alpha\` mit dem Fix in diesen PR, damit seine CI neu läuft.

Wer lokal auf diesem Branch weiterarbeitet: vor dem nächsten Push \`git pull\`." ;;
    4) sag "Push abgewiesen: der Branch hat sich bewegt, Hinweis bleibt offen" ;;
    *) sag "Merge oder Push gescheitert, Hinweis bleibt offen" ;;
  esac
}

# Wer hält den Auftrag gerade? Gibt "<nr> <angelegt, Unix>" des jüngsten Hinweises der Art
# `zustaendig` unter den PRs auf stdin (eine Nummer je Zeile) aus, leer ohne. Exit ≠ 0, wenn ein
# PR nicht lesbar ist: dann ist der Halter unbekannt, nicht „keiner“, sonst spränge der Auftrag.
alpha_halter() {
  local nr alt art angelegt halter="" seit=0 HINWEIS_MARKE="$MARKE_ALPHA"
  while read -r nr; do
    [ -n "$nr" ] || continue
    alt="$(hinweis_lesen "$nr")" || return 1
    [ -n "$alt" ] || continue
    read -r _ art _ angelegt <<< "$alt"
    if [ "$art" = zustaendig ] && [ "${angelegt:-0}" -ge "$seit" ]; then halter="$nr" seit="${angelegt:-0}"; fi
  done
  [ -z "$halter" ] || printf '%s %s\n' "$halter" "$seit"
}

# Eine Runde über alle offenen PRs gegen alpha.
alpha_runde() {
  [ -n "$REPO" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
  local liste nr branch kopf entwurf fork dependabot fix k fixe="" kandidaten="" zust="" niemand=0
  local halter="" seit=0 HINWEIS_MARKE alt art
  echo "==> alpha (LLH-1849)"
  git fetch --no-tags --quiet "$REMOTE" "+refs/heads/alpha:refs/remotes/$REMOTE/alpha" || true
  if ! alpha_zustand; then sag "CI-Läufe auf alpha nicht lesbar, übersprungen"; return 0; fi
  sag "Zustand: $ALPHA_ZUSTAND${ALPHA_URSACHE:+, Ursache $ALPHA_URSACHE}${ALPHA_FEHLER:+, rot: $ALPHA_FEHLER}"
  [ "$ALPHA_ZUSTAND" != unklar ] || return 0
  liste="$(gh_api "repos/$REPO/pulls?state=open&base=alpha&per_page=100" --paginate \
    | jq -r -s --arg repo "$REPO" --arg label "$ALPHA_LABEL" '[.[][] | select(.base.ref == "alpha")]
        | sort_by(.number)[] | [.number, .head.ref, .head.sha, .draft,
          ((.head.repo.full_name // "") != $repo),
          ((.user.login // "") == "dependabot[bot]" or (.head.ref | startswith("dependabot/"))),
          any((.labels // [])[]; .name == $label)] | @tsv')" \
    || { sag "PR-Liste nicht lesbar, übersprungen"; return 0; }

  if [ "$ALPHA_ZUSTAND" = rot ]; then
    alpha_label_sichern
    while IFS=$'\t' read -r nr branch kopf entwurf fork dependabot fix; do
      [ -n "$nr" ] || continue
      if [ "$fix" = true ] && [ "$fork" = false ]; then fixe="$fixe $nr"
      elif [ "$entwurf" = false ] && [ "$fork" = false ] && [ "$dependabot" = false ]; then
        kandidaten="$kandidaten $nr"
      fi
    done <<< "$liste"
    fixe="${fixe# }" kandidaten="${kandidaten# }"
    if [ -n "$fixe" ]; then
      zust="${fixe%% *}"
    elif [ -n "$kandidaten" ]; then
      # Der Auftrag haftet eine volle Stunde ab seiner Erteilung an dem PR, der ihn trägt; erst
      # dann (oder wenn dieser PR kein Kandidat mehr ist) geht er an den nächsten mit größerer
      # Nummer, nach dem letzten wieder an den ersten. Eine Änderung der Liste verschiebt ihn nicht.
      if ! halter="$(cut -f1 <<< "$liste" | alpha_halter)"; then
        sag "Hinweise nicht lesbar, Halter unbekannt: alpha-Runde übersprungen"
        return 0
      fi
      read -r halter seit <<< "$halter" || true
      if [ -n "$halter" ] && [ $(( $(jetzt) - ${seit:-0} )) -lt 3600 ] \
        && case " $kandidaten " in *" $halter "*) true ;; *) false ;; esac; then
        zust="$halter"
      elif [ -n "$halter" ]; then
        zust="$(printf '%s\n' $kandidaten | awk -v h="$halter" '$1 > h { print; exit }')"
        [ -n "$zust" ] || zust="${kandidaten%% *}"
      else
        zust="${kandidaten%% *}"
      fi
    else
      niemand=1
    fi
    if [ -n "$zust" ]; then sag "zuständig: #$zust${fixe:+ (Fix-PR)}"; else sag "zuständig: niemand"; fi
  fi

  while IFS=$'\t' read -r nr branch kopf entwurf fork dependabot fix; do
    [ -n "$nr" ] || continue
    echo "==> PR #$nr ($branch, alpha $ALPHA_ZUSTAND)"
    if [ "$ALPHA_ZUSTAND" = rot ]; then
      # Ein Entwurf mit Label ist ein Fix-PR (der Auftrag empfiehlt den Entwurf) und läuft unten mit.
      if [ "$entwurf" = true ] && ! { [ "$fix" = true ] && [ "$fork" = false ]; }; then
        # Ein Entwurf bekommt keinen neuen Hinweis; trägt er noch einen Auftrag, wird der zu
        # „wartet“, sonst trügen zwei PRs den Auftrag.
        HINWEIS_MARKE="$MARKE_ALPHA"
        alt="$(hinweis_lesen "$nr")" || alt=""
        art=""; [ -z "$alt" ] || read -r _ art _ _ <<< "$alt"
        unset HINWEIS_MARKE
        if [ "$art" = zustaendig ]; then alpha_hinweis "$nr" wartet "${fixe:+$zust}" "$niemand"
        else sag "Entwurf, übersprungen"; fi
        continue
      fi
      if [ -n "$fixe" ] && [ "$nr" = "$zust" ]; then alpha_hinweis "$nr" fix ""
      elif [ "$fix" = true ] && [ "$fork" = false ]; then alpha_hinweis "$nr" doppelt "$zust"
      elif [ -z "$fixe" ] && [ "$nr" = "$zust" ]; then alpha_hinweis "$nr" zustaendig ""
      elif [ -n "$fixe" ]; then alpha_hinweis "$nr" wartet "$zust"
      else alpha_hinweis "$nr" wartet "" "$niemand"
      fi
    else
      git fetch --no-tags --quiet "$REMOTE" "+refs/pull/$nr/head:refs/remotes/pr/$nr" 2> /dev/null || true
      k="$(git rev-parse --verify --quiet "$kopf^{commit}")" || { sag "Kopf fehlt lokal, übersprungen"; continue; }
      alpha_nach_fix "$nr" "$branch" "$k" "$fork" "$entwurf" \
        || echo "::warning::PR #$nr: alpha-Nachzug gescheitert (Exit $?)"
    fi
  done <<< "$liste"
}

# ── Alle offenen PRs ────────────────────────────────────────────────────────────────

alle() {
  [ -n "$REPO" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
  local nr branch kopf basis entwurf fork automerge geaendert geholt=" "
  gh_api "repos/$REPO/pulls?state=open&per_page=100" --paginate \
    | jq -r -s --arg repo "$REPO" '.[][] | [.number, .head.ref, .head.sha, .base.ref, .draft,
        ((.head.repo.full_name // "") != $repo), (.auto_merge != null),
        (.updated_at | fromdateiso8601)] | @tsv' > "${TMPDIR:-/tmp}/stau-prs.$$"
  echo "Offene PRs: $(wc -l < "${TMPDIR:-/tmp}/stau-prs.$$" | tr -d ' ')"
  while IFS=$'\t' read -r nr branch kopf basis entwurf fork automerge geaendert; do
    case "$geholt" in
      *" $basis "*) ;;
      *) git fetch --no-tags --quiet "$REMOTE" "+refs/heads/$basis:refs/remotes/$REMOTE/$basis" || true
         geholt="$geholt$basis " ;;
    esac
    # Ein PR, der zwischen Liste und Abruf geschlossen wurde, bricht die Runde nicht ab.
    git fetch --no-tags --quiet "$REMOTE" "+refs/pull/$nr/head:refs/remotes/pr/$nr" || {
      echo "==> PR #$nr: Kopf nicht abrufbar, übersprungen"; continue; }
    # Ein Fehler an einem PR hält die übrigen nicht auf.
    bewerte "$nr" "$branch" "$kopf" "$basis" "$entwurf" "$fork" "$automerge" "$geaendert" \
      || echo "::warning::PR #$nr: Bewertung gescheitert (Exit $?)"
  done < "${TMPDIR:-/tmp}/stau-prs.$$"
  rm -f "${TMPDIR:-/tmp}/stau-prs.$$"
  # Ein Fehler hier hält den Lauf nicht auf: die Hinweise zu den PRs stehen schon.
  alpha_runde || echo "::warning::alpha: Bewertung gescheitert (Exit $?)"
}

aufruf() { sed -n '4,/^#   Exit/p' "$0" >&2; exit 2; }
case "${1:-}" in
  alle) [ $# -eq 1 ] || aufruf; alle ;;
  # Wie in `alle`: ein Fehler an einem PR hält die übrigen nicht auf.
  alpha) [ $# -eq 1 ] || aufruf; alpha_runde || echo "::warning::alpha: Bewertung gescheitert (Exit $?)" ;;
  bewerte)
    [ $# -eq 9 ] || aufruf
    [ -n "$REPO" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
    shift; bewerte "$@" ;;
  *) aufruf ;;
esac
