#!/usr/bin/env bash
# Zertifikate für den https-Testserver der App-Tests (LLH-1980, ios/AppTests/OhneServerTests.swift).
#
#   scripts/ios/testserver-zertifikat.sh <ziel-verzeichnis>
#
# Erzeugt bei jedem Lauf eine Wegwerf-CA (`ca.pem`) und ein damit signiertes Serverzertifikat für
# localhost und 127.0.0.1, als `testserver.p12` (Passwort `lifeline-test`). Nichts davon wird
# committet (.gitignore). scripts/ios/simulator-pruefung.sh legt die Dateien vor `xcodegen`
# nach ios/AppTests/Testserver (Ressource des Test-Targets) und trägt `ca.pem` in den Simulatoren
# als Wurzel ein: so vertraut die App dem Testserver wie einem echten Server, ohne Ausnahme im
# App-Code (Zertifikate prüft das System, Entwurf D2a). Gültig 30 Tage (Apple nimmt für
# TLS-Serverzertifikate höchstens 825).
set -euo pipefail

ZIEL="${1:?Ziel-Verzeichnis fehlt}"
mkdir -p "$ZIEL"
arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT

cat > "$arbeit/ca.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = Lifeline Testserver CA (nur Tests)
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
CNF

cat > "$arbeit/server.cnf" <<'CNF'
[v3_server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, IP:127.0.0.1
CNF

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
  -keyout "$arbeit/ca.key" -out "$ZIEL/ca.pem" -config "$arbeit/ca.cnf" 2> /dev/null
openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -keyout "$arbeit/server.key" -out "$arbeit/server.csr" -subj "/CN=localhost" 2> /dev/null
openssl x509 -req -sha256 -days 30 -in "$arbeit/server.csr" \
  -CA "$ZIEL/ca.pem" -CAkey "$arbeit/ca.key" -CAcreateserial -CAserial "$arbeit/ca.srl" \
  -extfile "$arbeit/server.cnf" -extensions v3_server -out "$arbeit/server.pem" 2> /dev/null

# SecPKCS12Import liest sicher die alten Verfahren (3DES, SHA-1-MAC); OpenSSL 3 braucht dafür
# -legacy, LibreSSL (macOS) nimmt sie ohne.
alt=()
if openssl version | grep -q '^OpenSSL 3'; then alt=(-legacy); fi
# `${alt[@]+…}`: ein leeres Array gilt unter `set -u` in Bash 3.2 (macOS) als ungesetzt.
openssl pkcs12 -export ${alt[@]+"${alt[@]}"} -inkey "$arbeit/server.key" -in "$arbeit/server.pem" \
  -certfile "$ZIEL/ca.pem" -name testserver -out "$ZIEL/testserver.p12" \
  -passout pass:lifeline-test -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1

echo "Testserver-Zertifikate in $ZIEL (ca.pem, testserver.p12)"
