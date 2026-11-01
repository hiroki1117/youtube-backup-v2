#!/bin/sh
# YouTube のコメントだけを取得し、yt-dlp のコメント JSON を加工せず gzip して S3 へ置く。
# 動画・字幕・フォーマット一覧は取得も出力もしない。置いたオブジェクトの S3 通知で取り込み Lambda が
# DynamoDB へ反映する。
#
# 環境変数（Lambda が SubmitJob で渡す）:
#   URL            動画 URL
#   S3PATH         置き先（s3://<bucket>/youtube/<video_id>/<attempt_id>.json.gz）
#   COOKIE_S3_PATH bot 判定回避用 cookie の置き場所
#   MAX_COMMENTS   取得上限（yt-dlp の max_comments。未指定なら 10000）
set -eu

echo "$URL"
echo "$S3PATH"

aws s3 cp "$COOKIE_S3_PATH" ./cookies.txt

# --write-comments は info.json の書き出しも有効にするため --no-write-info-json で止め、
# 出力テンプレートで id・comment_count・comments の 3 キーだけを JSON にして書き出す。
yt-dlp --cookies ./cookies.txt --skip-download --write-comments --no-write-info-json \
  --extractor-args "youtube:max_comments=${MAX_COMMENTS:-10000},all,all,all" \
  --print-to-file "%(.{id,comment_count,comments})j" comments.json "$URL"

gzip -c comments.json > comments.json.gz
aws s3 cp comments.json.gz "$S3PATH" --content-type application/gzip
