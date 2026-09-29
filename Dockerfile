# Container-Abbild.
#
# BEWUSST KEIN BUILD AUS QUELLE: unter QEMU liefe je Architektur ein kompletter Rust-Build für
# dasselbe Binary, das der Matrix-Job in .github/workflows/artefakte.yml nativ erzeugt. Nur dort
# wird gebaut; der Kontext muss so aussehen:
#
#   dist/linux-amd64/lifeline-hub
#   dist/linux-arm64/lifeline-hub

# Legt /data mit den Rechten des nonroot-Nutzers an (distroless kann weder `mkdir` noch
# `chown`). Docker übernimmt diese Rechte beim ersten Mount eines frischen Volumes; sonst gehörte
# es root und die Datenbank ließe sich nicht anlegen.
FROM busybox:1.37.0-uclibc AS vorbereitung
RUN mkdir -p /data

# cc-debian13: glibc + libgcc, keine Shell. Reicht, weil SQLite und OpenSSL statisch eingebacken
# sind.
#
# debian13, NICHT debian12: die Binary kommt von ubuntu-latest und verlangt GLIBC_2.38/2.39,
# cc-debian12 hat nur 2.36. Wer den Runner in artefakte.yml hebt, prüft hier die glibc mit; der
# Starttest dort fängt einen Rückfall ab.
FROM gcr.io/distroless/cc-debian13:nonroot

ARG TARGETARCH
COPY --from=vorbereitung --chown=nonroot:nonroot /data /data
COPY --chmod=755 dist/linux-${TARGETARCH}/lifeline-hub /usr/local/bin/lifeline-hub

ENV LIFELINE_DB_PATH=/data/lifeline.db \
    LIFELINE_BIND=0.0.0.0:8080

# Trägt die SQLite-Datei UND das daraus abgeleitete karten/-Verzeichnis — beide müssen denselben
# Mount teilen.
VOLUME ["/data"]
EXPOSE 8080
USER nonroot

ENTRYPOINT ["/usr/local/bin/lifeline-hub"]
