# Container-Abbild des karten-service (LFH-602).
#
# Wie beim Hauptabbild (../Dockerfile) KEIN Build aus Quelle: artefakte.yml baut die
# Linux-Binaries nativ in der Matrix, dieses Abbild nimmt sie nur entgegen. Kontext ist die
# Repo-Wurzel, erwartet werden:
#
#   dist/linux-amd64/karten-service
#   dist/linux-arm64/karten-service
#   karten-build/                      (Makefile — kommt aus dem Checkout)
#
# WARUM KEIN DISTROLESS wie beim Hauptabbild: der Service baut nicht selbst, er ruft
# `make -C karten-build tiles`, das Makefile ruft `docker run versatiles/…`, und nach dem Bau
# liest der Runner die Bounds per `sqlite3`-CLI (karten-service/src/build/make_runner.rs).
# Er braucht also eine Shell für make, GNU make, die sqlite3-CLI und die Docker-CLI.
#
# Der Docker-DAEMON ist nicht im Abbild. Der Betrieb mountet den Socket des Hosts
# (`/var/run/docker.sock`) — das ist root-äquivalenter Zugriff auf den Host und der Grund,
# warum dieser Service nie öffentlich erreichbar sein darf, sondern nur im internen Netz
# neben lifeline-hub hängt. Mit dem Socket des Hosts löst der Daemon Mount-Pfade auf dem
# HOST auf; dafür gibt es HOST_OUT im Makefile, das der Betrieb auf den Host-Pfad des
# gemounteten out/-Ordners setzt.
#
# trixie statt bookworm: die Binaries kommen von ubuntu-latest (glibc 2.39), bookworm bringt
# nur 2.36 mit.

# Nur als Quelle der statisch gelinkten Docker-CLI; der Daemon aus diesem Abbild läuft nie.
FROM docker:28-cli AS docker-cli

FROM debian:13-slim

ARG TARGETARCH

RUN apt-get update \
 && apt-get install --no-install-recommends -y make sqlite3 ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --chmod=755 dist/linux-${TARGETARCH}/karten-service /usr/local/bin/karten-service
COPY karten-build/Makefile /opt/karten-build/Makefile

# out/ trägt den Quelldaten-Cache (Wasser-Polygone, ~880 MB) und die Ergebnisse — er gehört
# auf ein Volume, sonst lädt jeder Neustart alles neu.
VOLUME ["/opt/karten-build/out"]

ENV KS_KARTEN_BUILD_DIR=/opt/karten-build \
    KS_BIND=0.0.0.0:8088

EXPOSE 8088
# Bewusst root: der Zugriff auf den gemounteten Docker-Socket ist ohnehin root-äquivalent,
# ein anderer Nutzer würde nur die GID-Zuordnung des Hosts ins Abbild ziehen.
ENTRYPOINT ["/usr/local/bin/karten-service"]
CMD ["serve"]
