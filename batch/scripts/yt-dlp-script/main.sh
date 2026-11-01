#!/bin/sh
set -eux

echo $URL
echo $FILENAME
echo ${S3PATH}
echo ${COOKIE_S3_PATH}


# データセンタープロキシを使ってもbot判定されるようになったためcookie指定

aws s3 cp "${COOKIE_S3_PATH}" ./cookies.txt

yt-dlp --cookies ./cookies.txt -o "$FILENAME.%(ext)s" "$URL"

FULLFILENAME=`find $FILENAME.*`

aws s3 cp "${FULLFILENAME}" "${S3PATH}"
