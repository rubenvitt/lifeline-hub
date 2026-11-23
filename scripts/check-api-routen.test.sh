#!/usr/bin/env bash
# Selbsttest für scripts/check-api-routen.sh (LLH-1979, ADR-0095). Der Wächter irrt in beide
# Richtungen still: ließe er eine deutsche Route durch, wüchse der Bestand wieder, den die
# Pakete von LLH-1979 abbauen; schlüge er auf Testcode oder eine englische Route an, würde er
# abgeschaltet.
#
# Gefahren gegen ein Wegwerf-Git-Repo im Temp-Verzeichnis, je Fall frisch aufgebaut, mit einem
# Ref `origin/alpha` auf dem Ausgangsstand.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-api-routen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
TAB="$(printf '\t')"

glossar() { # <zeile>… → schreibt scripts/api-routen-woerter.tsv neu
  printf '%s\n' "$@" > scripts/api-routen-woerter.tsv
}

route_dazu() { # <pfad> → registriert eine Route einzeilig nach `/api/health`
  awk -v p="$1" '{ print } /"\/api\/health"/ { print "        .route(\"" p "\", get(h))" }' \
    src/app.rs > src/app.rs.neu && mv src/app.rs.neu src/app.rs
}

viele_deutsche_routen() { # <anzahl> → so viele deutsche Routen samt Bestand, ohne origin/alpha
  awk -v n="$1" '{ print } /"\/api\/health"/ {
      for (i = 1; i <= n; i++) print "        .route(\"/api/deutsch" i "/zaehler\", get(h))"
    }' src/app.rs > src/app.rs.neu && mv src/app.rs.neu src/app.rs
  {
    printf '%s\n' '/api/einsaetze/{id}'
    awk -v n="$1" 'BEGIN { for (i = 1; i <= n; i++) print "/api/deutsch" i "/zaehler" }'
  } | LC_ALL=C sort > scripts/api-routen-bestand.txt
  git update-ref -d refs/remotes/origin/alpha
}

baum_neu() { # <name> → Pfad eines grünen Repos, alles versioniert, origin/alpha = HEAD
  local b="$ARBEIT/$1"
  # Läuft als Befehlsersetzung, dort greift `set -e` nicht (LLH-1892).
  mkdir -p "$b" || exit 1
  (
    cd "$b" || exit 1
    set -e
    git init -q
    git config user.email test@example.invalid
    git config user.name Test
    mkdir -p src/public_api src/instanz scripts
    cat > src/app.rs << 'EOF'
pub fn router() -> Router {
    Router::new()
        .route("/api/health", get(h))
        .route(
            "/api/auth/login",
            post(h),
        )
        .route(MELDEN_PFAD, post(h))
        .route("/api/einsaetze/{id}", get(h))
}

#[cfg(test)]
mod tests {
    #[test]
    fn pfad() {
        assert_eq!(f("/api/gibtsnicht"), "/api/gibtsnicht");
        let p = format!("/api/xyz/{a}");
        let q = [
            "/api/nurimtest",
        ];
    }
}
EOF
    cat > src/public_api/routen.rs << 'EOF'
#[utoipa::path(get, path = "/api/v1/me", tag = "zugang")]
pub async fn me() {}
EOF
    cat > src/instanz/extractor.rs << 'EOF'
pub const MELDEN_PFAD: &str = "/api/auth/me";
EOF
    glossar "api${TAB}-" "auth${TAB}Anmeldung" "health${TAB}-" "login${TAB}-" "me${TAB}-" "v1${TAB}-"
    printf '%s\n' '/api/einsaetze/{id}' > scripts/api-routen-bestand.txt
    git add -A
    git commit -qm start
    git update-ref refs/remotes/origin/alpha HEAD
  ) || exit 1
  printf '%s\n' "$b"
}

fall() { # <name> <erwartet: gruen|rot> <befehl, der das Repo $B verändert> [<muster>…]
  local B name="$1" soll="$2" befehl="$3" ARGS=""
  shift 3
  B="$(baum_neu "$(printf '%s' "$name" | tr -c '[:alnum:]' '_')")"
  # Der Befehl darf ARGS setzen (zusätzliche Argumente für den Wächter); deshalb nicht in einer
  # Subshell, sondern mit cd hin und zurück.
  local vorher="$PWD"
  cd "$B" && eval "$befehl"
  cd "$vorher"
  local ist=gruen
  # shellcheck disable=SC2086 # ARGS sind bewusst mehrere Wörter
  "$SKRIPT_UNTER_TEST" "$B" $ARGS > "$ARBEIT/ausgabe" 2>&1 || ist=rot
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

echo "==> Selbsttest check-api-routen.sh"
fall "Ausgangsbaum: einzeilig, mehrzeilig, Konstante, v1, Bestand" gruen ":" "OK"
fall "Testcode in src/app.rs zählt nicht" gruen \
  "printf '%s\n' '        \"/api/nochmal/test\",' >> src/app.rs"
fall "neue deutsche Route einzeilig" rot \
  "route_dazu /api/neu-deutsch" "/api/neu-deutsch" "neu-deutsch"
fall "neue deutsche Route mehrzeilig" rot \
  "awk '{ print } /\"\\/api\\/auth\\/login\",/ { print \"            \\\"/api/auth/zaehler\\\",\" }' src/app.rs > x && mv x src/app.rs" \
  "/api/auth/zaehler" "zaehler"
fall "deutsche Route mitten in der Zeile (router.route)" rot \
  "awk '{ print } /\"\\/api\\/health\"/ { print \"    let router = router.route(\\\"/api/nur-mit-feature\\\", get(h));\" }' src/app.rs > x && mv x src/app.rs" \
  "/api/nur-mit-feature"
fall "Bestand gegen die Merge-Base, nicht gegen die Spitze von origin/alpha" gruen \
  "route_dazu /api/alt-deutsch && printf '%s\n' '/api/alt-deutsch' '/api/einsaetze/{id}' > scripts/api-routen-bestand.txt && git commit -qam alt && git update-ref refs/remotes/origin/alpha HEAD && git checkout -q -b paket && grep -v alt-deutsch src/app.rs > x && mv x src/app.rs && printf '%s\n' '/api/einsaetze/{id}' > scripts/api-routen-bestand.txt && git commit -qam paket && git update-ref refs/remotes/origin/alpha HEAD && git checkout -q - && printf '%s\n' '# eigene Änderung' >> src/public_api/routen.rs" \
  "OK"
fall "Basis wählbar (--basis origin/beta)" rot \
  "git update-ref refs/remotes/origin/beta HEAD && git update-ref -d refs/remotes/origin/alpha && route_dazu /api/neu-deutsch && printf '%s\n' '/api/einsaetze/{id}' '/api/neu-deutsch' > scripts/api-routen-bestand.txt; ARGS='--basis origin/beta'" \
  "origin/beta"
fall "Glossarzeile ohne zweite Spalte" rot \
  "glossar \"api${TAB}-\" \"auth${TAB}Anmeldung\" 'health' \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\"" \
  "zwei Spalten"
fall "deutscher v1-Pfad" rot \
  "printf '%s\n' '#[utoipa::path(get, path = \"/api/v1/lage\")]' >> src/public_api/routen.rs" \
  "/api/v1/lage" "lage"
fall "deutscher Pfad als Konstante" rot \
  "printf '%s\n' 'pub const SPIEGEL_PFAD: &str = \"/api/spiegelung\";' >> src/instanz/extractor.rs" \
  "/api/spiegelung"
fall "Bestand mit nicht registriertem Pfad" rot \
  "printf '%s\n' '/api/einsaetze/{id}' '/api/weg' > scripts/api-routen-bestand.txt" \
  "/api/weg" "veraltet"
fall "Bestand mit englisch gewordenem Pfad" rot \
  "printf '%s\n' '/api/einsaetze/{id}' '/api/health' > scripts/api-routen-bestand.txt" \
  "/api/health" "veraltet"
fall "Bestand wächst gegenüber origin/alpha" rot \
  "route_dazu /api/neu-deutsch && printf '%s\n' '/api/einsaetze/{id}' '/api/neu-deutsch' > scripts/api-routen-bestand.txt" \
  "/api/neu-deutsch" "origin/alpha"
fall "Bestand wächst nur in der Zahl (neue Route unter deutschem Präfix)" rot \
  "route_dazu '/api/einsaetze/{id}/close' && glossar \"api${TAB}-\" \"auth${TAB}Anmeldung\" \"close${TAB}abschließen\" \"health${TAB}-\" \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\" && printf '%s\n' '/api/einsaetze/{id}' '/api/einsaetze/{id}/close' > scripts/api-routen-bestand.txt" \
  "/api/einsaetze/{id}/close" "2 statt 1"
# Ein Paket übersetzt Segmente unter einem Präfix, das erst ein späteres Paket umstellt: der Pfad
# bleibt im Bestand, nur seine Zeile ändert sich (LLH-2060).
fall "Segment unter deutschem Präfix übersetzt" gruen \
  "route_dazu '/api/einsaetze/{id}/abschliessen' && printf '%s\n' '/api/einsaetze/{id}' '/api/einsaetze/{id}/abschliessen' > scripts/api-routen-bestand.txt && git commit -qam alt && git update-ref refs/remotes/origin/alpha HEAD && sed 's#/abschliessen#/close#' src/app.rs > x && mv x src/app.rs && glossar \"api${TAB}-\" \"auth${TAB}Anmeldung\" \"close${TAB}abschließen\" \"health${TAB}-\" \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\" && printf '%s\n' '/api/einsaetze/{id}' '/api/einsaetze/{id}/close' > scripts/api-routen-bestand.txt" \
  "OK"
fall "Segment unter deutschem Präfix in ein neues deutsches Wort umbenannt" rot \
  "route_dazu '/api/einsaetze/{id}/abschliessen' && printf '%s\n' '/api/einsaetze/{id}' '/api/einsaetze/{id}/abschliessen' > scripts/api-routen-bestand.txt && git commit -qam alt && git update-ref refs/remotes/origin/alpha HEAD && sed 's#/abschliessen#/beenden#' src/app.rs > x && mv x src/app.rs && printf '%s\n' '/api/einsaetze/{id}' '/api/einsaetze/{id}/beenden' > scripts/api-routen-bestand.txt" \
  "/api/einsaetze/{id}/beenden" "beenden" "origin/alpha"
fall "neue deutsche Route bei gleicher Zeilenzahl, aus bekannten Wörtern" rot \
  "route_dazu /api/alt-deutsch && printf '%s\n' '/api/alt-deutsch' '/api/einsaetze/{id}' > scripts/api-routen-bestand.txt && git commit -qam alt && git update-ref refs/remotes/origin/alpha HEAD && grep -v '\"/api/alt-deutsch\"' src/app.rs > x && mv x src/app.rs && route_dazu '/api/einsaetze/{id}/alt-deutsch' && printf '%s\n' '/api/einsaetze/{id}' '/api/einsaetze/{id}/alt-deutsch' > scripts/api-routen-bestand.txt" \
  "/api/einsaetze/{id}/alt-deutsch" "origin/alpha"
fall "Bestand wächst, origin/alpha fehlt" gruen \
  "git update-ref -d refs/remotes/origin/alpha && route_dazu /api/neu-deutsch && printf '%s\n' '/api/einsaetze/{id}' '/api/neu-deutsch' > scripts/api-routen-bestand.txt" \
  "übersprungen"
fall "Bestand auf origin/alpha noch ohne Datei" gruen \
  "git rm -q scripts/api-routen-bestand.txt && git commit -qm weg && git update-ref refs/remotes/origin/alpha HEAD && printf '%s\n' '/api/einsaetze/{id}' > scripts/api-routen-bestand.txt"
fall "Glossar unsortiert" rot \
  "glossar \"auth${TAB}Anmeldung\" \"api${TAB}-\" \"health${TAB}-\" \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\"" \
  "sortiert"
fall "Segment doppelt im Glossar" rot \
  "glossar \"api${TAB}-\" \"auth${TAB}Anmeldung\" \"auth${TAB}Authentifizierung\" \"health${TAB}-\" \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\"" \
  "auth"
fall "deutscher Begriff doppelt im Glossar" rot \
  "glossar \"api${TAB}-\" \"auth${TAB}Anmeldung\" \"health${TAB}-\" \"login${TAB}Anmeldung\" \"me${TAB}-\" \"v1${TAB}-\"" \
  "Anmeldung"
fall "Segment mit Großbuchstabe" rot \
  "glossar \"Api${TAB}-\" \"auth${TAB}Anmeldung\" \"health${TAB}-\" \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\"" \
  "Api"
fall "Kommentarzeile im Glossar" gruen \
  "glossar '# Glossar' \"api${TAB}-\" \"auth${TAB}Anmeldung\" \"health${TAB}-\" \"login${TAB}-\" \"me${TAB}-\" \"v1${TAB}-\""

fall "großer Bestand (Vergleich bricht nicht an SIGPIPE)" gruen \
  "viele_deutsche_routen 3000" "OK"

# --bestand nennt genau die Pfade mit unbekanntem Segment.
B="$(baum_neu bestand_ausgabe)"
if [ "$("$SKRIPT_UNTER_TEST" "$B" --bestand)" = '/api/einsaetze/{id}' ]; then
  echo "  ok   --bestand gibt genau den deutschen Pfad aus"
else
  echo "  FEHL --bestand: $("$SKRIPT_UNTER_TEST" "$B" --bestand | tr '\n' ' ')" >&2
  fehler=$((fehler + 1))
fi

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fall/Fälle falsch." >&2
  exit 1
fi
echo "==> OK: der Wächter trennt alle Fälle."
