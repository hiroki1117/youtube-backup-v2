IMAGE ?= yt-dlp-script
TAG ?= youtube-backup-candidate:local
.PHONY: check build
check:
	@for file in scripts/yt-dlp-script/main.sh; do sh -n "$$file" || exit; done
# Local build only; no login, tag publication, or push.
build:
	docker build -t $(TAG) scripts/$(IMAGE)
