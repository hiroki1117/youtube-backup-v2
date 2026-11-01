FROM python:3.12-slim-bookworm

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

RUN chmod 111 main.sh
