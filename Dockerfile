# Container-Abbild (LFH-522/LFH-527).
#
# BEWUSST KEIN BUILD AUS QUELLE. Das Abbild nimmt die im Artefakt-Workflow fertig gebauten
# Linux-Binaries entgegen. Ein Multi-Stage-Build mit `cargo build` würde unter QEMU je
# Architektur einen kompletten Rust-Build fahren (arm64-Emulation auf amd64-Runnern), und
# das Ergebnis wäre dasselbe Binary, das der Matrix-Job nativ in einem Bruchteil der Zeit
# erzeugt. Der Kontext muss deshalb so aussehen:
#
#   dist/linux-amd64/lifeline-hub
#   dist/linux-arm64/lifeline-hub
#
# Gebaut wird ausschließlich über .github/workflows/artefakte.yml. Ein `docker build .` von
# Hand schlägt fehl, solange dieser Kontext fehlt — das ist Absicht und kein Mangel.

# Legt /data an, damit das Verzeichnis mit den Rechten des nonroot-Nutzers ins Abbild kommt.
# Distroless hat keine Shell, kann also weder `mkdir` noch `chown`. Ohne diesen Umweg gehört
# ein frisch angelegtes Docker-Volume root, und der nonroot-Prozess kann die Datenbank nicht
# anlegen — Docker übernimmt die Rechte des Abbild-Verzeichnisses beim ersten Mount.
FROM busybox:1.37.0-uclibc AS vorbereitung
RUN mkdir -p /data

# cc-debian12: glibc + libgcc, keine Shell, kein Paketmanager. Reicht, weil die Binary seit
# LFH-522 sowohl SQLite als auch OpenSSL statisch eingebacken hat — ohne `vendored` bräuchte
# es hier ein Debian-Slim mit libssl3.
FROM gcr.io/distroless/cc-debian12:nonroot

ARG TARGETARCH
COPY --from=vorbereitung --chown=nonroot:nonroot /data /data
COPY --chmod=755 dist/linux-${TARGETARCH}/lifeline-hub /usr/local/bin/lifeline-hub

ENV LIFELINE_DB_PATH=/data/lifeline.db \
    LIFELINE_BIND=0.0.0.0:8080

# Das Datenverzeichnis trägt die SQLite-Datei UND das daraus abgeleitete karten/-Verzeichnis
# (Offline-Karten, Tile-Cache) — beides muss denselben Mount teilen.
VOLUME ["/data"]
EXPOSE 8080
USER nonroot

ENTRYPOINT ["/usr/local/bin/lifeline-hub"]
