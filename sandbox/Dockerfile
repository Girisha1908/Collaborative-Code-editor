# Multi-language sandbox image used for every room's isolated container.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        bash coreutils procps nano less \
        python3 \
        nodejs \
        gcc g++ libc6-dev \
        default-jdk-headless \
        golang-go \
    && rm -rf /var/lib/apt/lists/*

# Prompt for interactive terminal sessions (home is a tmpfs, so set it system-wide).
COPY bash.bashrc /etc/bash.bashrc.d-coco
RUN cat /etc/bash.bashrc.d-coco >> /etc/bash.bashrc && rm /etc/bash.bashrc.d-coco

# Unprivileged user that owns the workspace.
RUN useradd --create-home --uid 1000 --shell /bin/bash coder \
    && mkdir -p /workspace && chown coder:coder /workspace

ENV HOME=/home/coder GOCACHE=/tmp/go-cache GOPATH=/tmp/go
USER coder
WORKDIR /workspace

# Keep the container alive; work happens through `docker exec`.
CMD ["sleep", "infinity"]
