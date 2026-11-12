# Runner-Image für die e2e-Jobs auf dem eigenen Server (LLH-1666, ADR-0025).
#
# Ein Container aus diesem Image nimmt genau einen Job und wird danach gelöscht
# (`runner-loop.sh`). Darum steckt hier alles, wofür der Job auf einem gehosteten Runner `sudo`
# braucht: die Playwright-Browser samt Systempaketen, nasm und die Build-Werkzeuge für das
# Debug-Binary, dazu `sccache` für einen warmen Build über Jobs hinweg. `sudo` selbst fliegt raus.
#
# Bauen nur über `build-image.sh`: es liest die Playwright-Version aus dem Lockfile. Anleitung:
# `scripts/runner/README.md`.

# Tag und Digest gepinnt, Dependabot hebt beide (`.github/dependabot.yml`, Ökosystem docker).
FROM ghcr.io/actions/actions-runner:2.338.2@sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300

# Pflicht, kommt aus `frontend/pnpm-lock.yaml` (`build-image.sh`).
ARG PLAYWRIGHT_VERSION
# Nur für `playwright install` beim Bau; im Job installiert `mise` die Version aus `mise.toml`.
ARG NODE_VERSION=26.7.0
ARG SCCACHE_VERSION=0.19.0
# Fest eingetragen, nicht vom Release-Server geladen: eine Prüfsumme vom selben Ursprung schützte
# nur gegen Übertragungsfehler. Bei einem Versionswechsel beide neu eintragen.
ARG SCCACHE_SHA256_AMD64=aa73c7270c997894038c0d8f0d297865f57569e1687883322bc431713d4bb9dd
ARG SCCACHE_SHA256_ARM64=3e47fc4a71b1ddd1b4294a0de9d34498922fdf41e3cd0bda5df3954e3d6deb9d
ARG TARGETARCH

LABEL de.lifeline-hub.runner="1"

USER root
ENV DEBIAN_FRONTEND=noninteractive

# Build-Werkzeuge für die nativen Crates des Backends (aws-lc braucht cmake und nasm, das
# vendorte OpenSSL perl und make), dazu was Actions und Caches erwarten. DejaVu, weil die App für
# Text auf die Systemschrift zurückfällt (kein `@font-face`, `frontend/src/theme/schriften.test.ts`)
# und `ubuntu-latest` dafür DejaVu Sans nimmt: sonst wichen Textbreiten in den Layout-Gates ab.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake curl fonts-dejavu-core git nasm perl pkg-config tzdata \
    unzip xz-utils zstd \
  && rm -rf /var/lib/apt/lists/*

# Playwright-Browser und ihre Systempakete, in genau der Version des Lockfiles. Node nur für diesen
# Schritt, geprüft gegen die Prüfsummen von nodejs.org und danach wieder entfernt.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN set -eu; \
  test -n "${PLAYWRIGHT_VERSION}" || { echo "PLAYWRIGHT_VERSION fehlt (build-image.sh)" >&2; exit 1; }; \
  case "${TARGETARCH:-amd64}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) exit 1 ;; esac; \
  datei="node-v${NODE_VERSION}-linux-${arch}.tar.xz"; \
  cd /tmp; \
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${datei}"; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " ${datei}\$" | sha256sum -c -; \
  tar -xJf "${datei}"; \
  PATH="/tmp/node-v${NODE_VERSION}-linux-${arch}/bin:${PATH}" \
    npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium firefox webkit; \
  rm -rf /tmp/node-v* "/tmp/${datei}" /root/.npm /var/lib/apt/lists/*; \
  chown -R runner:runner /ms-playwright
ENV LIFELINE_RUNNER_PLAYWRIGHT=${PLAYWRIGHT_VERSION}

# sccache: inhaltsadressierter Compiler-Cache auf einem Volume (`runner-loop.sh`), mit fester
# Obergrenze (`SCCACHE_CACHE_SIZE`). Geprüft gegen die oben fest eingetragene Prüfsumme.
RUN set -eu; \
  case "${TARGETARCH:-amd64}" in \
    amd64) arch=x86_64 summe="${SCCACHE_SHA256_AMD64}" ;; \
    arm64) arch=aarch64 summe="${SCCACHE_SHA256_ARM64}" ;; \
    *) exit 1 ;; \
  esac; \
  name="sccache-v${SCCACHE_VERSION}-${arch}-unknown-linux-musl"; \
  basis="https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}"; \
  cd /tmp; \
  curl -fsSLO "${basis}/${name}.tar.gz"; \
  echo "${summe}  ${name}.tar.gz" | sha256sum -c -; \
  tar -xzf "${name}.tar.gz"; \
  install -m 0755 "${name}/sccache" /usr/local/bin/sccache; \
  rm -rf "/tmp/${name}" "/tmp/${name}.tar.gz"

# Kein `sudo` im Job (Spec `ci-eigener-runner`): das Basisimage gibt dem Nutzer `runner`
# passwortloses `sudo`. Das Paket fliegt ganz raus, statt nur die Regel zu streichen.
RUN SUDO_FORCE_REMOVE=yes apt-get purge -y sudo \
  && rm -f /etc/sudoers /etc/sudoers.d/* \
  && (gpasswd -d runner sudo || true)

USER runner
ENV RUSTUP_HOME=/home/runner/.rustup \
  CARGO_HOME=/home/runner/.cargo \
  PATH=/home/runner/.cargo/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path \
  && mkdir -p /home/runner/.cache/sccache

# Das Volume für den Compiler-Cache hängt `runner-loop.sh` ein; ohne Volume bleibt der Cache im
# Container und stirbt mit ihm.
ENV RUSTC_WRAPPER=sccache \
  SCCACHE_DIR=/home/runner/.cache/sccache \
  SCCACHE_CACHE_SIZE=20G

WORKDIR /home/runner
CMD ["/home/runner/run.sh"]
