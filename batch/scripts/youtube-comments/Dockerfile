FROM python:3.15-slim-bookworm

COPY requirements.txt /tmp/requirements.txt

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /tmp/requirements.txt

RUN apt-get update \
    && apt-get install -y curl unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JavaScript runtime for YouTube.
RUN curl -fsSL https://deno.land/install.sh | sh \
    && mv /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /work

COPY ./main.sh /work

COPY ./smoke.py /work/smoke.py

# Validate the exact image built by CI and deployment without external access.
RUN --network=none BATCH_SCRIPT=youtube-comments python /work/smoke.py

RUN chmod 111 main.sh
