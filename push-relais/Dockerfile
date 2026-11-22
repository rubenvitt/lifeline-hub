# Container-Abbild des push-relais (LLH-2040, iOS-Push über APNs).
#
# Wie beim Hauptabbild (../Dockerfile) und beim karten-service KEIN Build aus Quelle:
# artefakte.yml baut die Linux-Binaries nativ in der Matrix, dieses Abbild nimmt sie nur
# entgegen. Kontext ist die Repo-Wurzel, erwartet werden:
#
#   dist/linux-amd64/push-relais
#   dist/linux-arm64/push-relais
#
# distroless/cc wie das Hauptabbild und NICHT debian wie beim karten-service: das Relais ruft
# weder Shell noch make noch Docker auf. SQLite (sqlx) und OpenSSL (`vendored`) sind statisch
# eingebacken, TLS zu APNs macht rustls mit eingebauten Wurzeln; es braucht nur glibc und libgcc.
# debian13, nicht debian12: die Binary kommt von ubuntu-latest und verlangt GLIBC_2.38/2.39.
#
# /data wird mit den Rechten des nonroot-Nutzers angelegt (distroless kann weder `mkdir` noch
# `chown`); Docker übernimmt sie beim ersten Mount eines frischen Volumes.
FROM busybox:1.37.0-uclibc AS vorbereitung
RUN mkdir -p /data

FROM gcr.io/distroless/cc-debian13:nonroot

ARG TARGETARCH
COPY --from=vorbereitung --chown=nonroot:nonroot /data /data
COPY --chmod=755 dist/linux-${TARGETARCH}/push-relais /usr/local/bin/push-relais

# Die .p8-Datei gehört NICHT ins Abbild: der Betrieb mountet sie schreibgeschützt nach
# /geheimnisse/AuthKey.p8.
ENV PUSH_RELAIS_DATENBANK=/data/push-relais.sqlite \
    PUSH_RELAIS_APNS_SCHLUESSEL=/geheimnisse/AuthKey.p8 \
    PUSH_RELAIS_BIND=0.0.0.0:8089

VOLUME ["/data"]
EXPOSE 8089
USER nonroot

ENTRYPOINT ["/usr/local/bin/push-relais"]
CMD ["serve"]
