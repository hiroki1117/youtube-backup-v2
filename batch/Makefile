IMAGE ?= yt-dlp-script
TAG ?= youtube-backup-ytdlp:local
.PHONY: check build
check:
	@for file in scripts/yt-dlp-script/main.sh scripts/youtube-comments/main.sh; do sh -n "$$file" || exit; done
# Local build only; no login, tag publication, or push.
build:
	docker build -t $(TAG) scripts/$(IMAGE)
