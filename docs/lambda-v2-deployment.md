# v2 Lambda の初回配布契約（Issue #43・第1段階）

対象: `hiroki1117/youtube-backup-v2`。2026-10-18 時点の main は `21ef27e`（PR #28 取込済み）。
旧 `chore/app-repository-foundation` を再配布元にしない。開始時の作業ツリーは clean、既存 open PR は依存更新のみ。
既存 deploy run `38232841272` は OIDC credential 設定で失敗しており、v2 配布成功の根拠ではない。

今回の成果は **旧環境に接続しない v2 専用5関数の配布候補と、安全な直接 invoke 契約**。
実 AWS の作成・更新・invoke、IAM/OIDC変更、PR/main merge は別承認。Batch・frontend のコードや配布経路は変更しない。
この文書・manifest・ZIP に実アカウントID、ARN、環境識別値、秘密を入れない。ZIP は Git へコミットしない。

## app / infra の唯一の所有者

- app: source、固定 runtime 依存、ZIP build、SHA256付き manifest、AWSへ接続しない検証、CI artifact。
- private `hiroki1117/infra`: 専用関数・実行ロール・ログ・環境変数・コード参照・version、後続段階のAPI/通知/定期イベント。
- **初回も以後も Lambda code の反映は infra のみ**とする提案。backend の app CI に `UpdateFunctionCode` や AWS credential を与えない。
  infra はレビューした source revision の成果物を取得し、manifest/hash を検証して、Terraform の filename/source_code_hash または既存の承認済み成果物保管経路で同じZIPを参照する。
  build を apply ごとにやり直さず、成果物を保管する。Terraform と app CI から同じ code を二重管理しない。
- 新しい有料サービスは導入しない。既存 GitHub artifact は7日保持のため、配布対象に採用したZIP/manifestは既存の承認済み保管先へ保存する。

親の infra コード監査（main `db2a3d8`）では v2 Lambda/API/認証/frontend 定義はまだない。旧9関数・REST API・通知等は旧 state のまま。
ECR/Batch/DynamoDB/S3 は infra 管理。実AWSは未照合。旧ソースと稼働Lambdaの一致を仮定せず、旧関数や既存stateの移管・上書きをしない。

## 初回5関数

全て ZIP / `python3.14` / `x86_64`、Layersなし。FastAPI/Pydantic/Mangum/boto3/httpx等を `backend/requirements.lock` から各ZIPへ同梱。
新規の専用関数名と実ARNは infra 側で管理する。表の名前はアプリ内の論理キー。

| ZIP / manifest の共通stem | handler | application モードでの役割 | 初回 trigger |
| --- | --- | --- | --- |
| video | `api.app.video_handler` | 動画一覧・登録・取得・更新・削除・再生URL | なし |
| backup | `api.app.backup_handler` | backup取得・投入 | なし |
| s3_complete | `events.handlers.s3_complete` | S3 ObjectCreated 通知による完了更新 | なし |
| scrapbox_scan | `events.handlers.scrapbox_scan` | Scrapbox巡回・登録・Batch投入 | なし |
| retry | `events.handlers.retry` | 追跡済み失敗job再投入（最大1ページ） | なし |

初回設定案: timeout 30秒、memory 256 MiB、reserved concurrency 1、既存環境の関数を参照しない。
これは疎通確認用の提案値で、業務運用・外部API巡回に必要なtimeout等は次段階で計測する。
Function URL、API Gateway integration、S3 notification、EventBridge schedule、DLQ等の既存接続は作成・切替しない。

## 初回の環境・権限と直接 invoke

環境変数は `BACKEND_EXECUTION_MODE=validation` のみ。resource/SSM名や `BACKEND_LOCAL_TOKEN` は渡さない。
未設定も validation。未知のmode値は拒否。イベントの値で application モードへ昇格できない。

全入口で、`backend/deployment/check.json` と完全一致する入力だけを受理する。AWS repository の生成・ネットワーク接続前に以下を返す。

```json
{"status":"ok","function":"video","execution_mode":"validation","aws_access":false}
```

他の4関数では `function` がそれぞれの論理キー。通常のHTTP/S3/定期イベントや空イベントは RuntimeError で拒否する。
この成功は **ZIP import と v2 専用関数の疎通**のみを意味し、業務API/Batch/S3連携の成功を意味しない。

infra の初回実行ロールは事前作成した専用ログgroup/streamへの `logs:CreateLogStream` / `logs:PutLogEvents` のみ。
DynamoDB/S3/SSM/KMS/BatchやAssumeRoleの許可を付けず、既存の広い実行ロールも流用しない。
検証中の副作用を防ぐため、既存業務リソースへのDynamoDB書込み・S3更新/削除・Batch SubmitJob等の明示Denyも検討する。
アプリのgateに加えてIAMでも分離する。ログ以外のAWSアクセスは初回検証に不要。

直接invoke担当には **5つの専用関数/指定versionだけ**の `lambda:InvokeFunction` と、必要なメタデータ読取り権限を与える。
HTTP入口の通常処理はGateway claimsを信頼するため、直接invoke権限は将来も管理者に限定する（偽claimsの入力を認証済みリクエストとして扱えるため）。

承認後、infraが作成した各関数について以下を実施する（この作業では実行しない）。実値はprivateな環境設定から渡す。

1. `GetFunctionConfiguration` の限定queryで runtime/architecture/handler/State/LastUpdateStatus/CodeSha256 と modeだけを確認し、全envや秘密をログへ出さない。
2. CodeSha256 を対応manifestの `code_sha256` と照合。State=Active、LastUpdateStatus=Successful を確認。発行したversionを指定する。
3. 対応関数名・versionを設定してinvoke:

```bash
# V2_FUNCTION_NAME / V2_FUNCTION_VERSION / AWS_REGION は承認済みprivate設定。
aws lambda invoke \
  --function-name "$V2_FUNCTION_NAME" --qualifier "$V2_FUNCTION_VERSION" \
  --cli-binary-format raw-in-base64-out \
  --payload fileb://backend/deployment/check.json \
  /tmp/v2-lambda-check.json
```

4. CLI exit codeだけで判定しない。metadata の StatusCode=200、FunctionErrorなし、ExecutedVersionが指定versionと一致、payloadが上記と完全一致することを5関数ごとに確認。
5. 空の `{}` を専用関数へinvokeし、FunctionErrorが返ることも確認。共有DB/S3/Batchへの許可がないことと、旧関数・API・通知・scheduleが無変更であることをinfra差分で確認。
6. 失敗時は通常処理へ切り替えず、専用関数だけを修正する。旧本番sourceをrollback用として上書きしない。

## 成果物を作る・照合する

```bash
make -C backend install
make -C backend check
make -C backend export
git diff --exit-code -- contracts/openapi.json
for function in video backup s3_complete scrapbox_scan retry; do
  make -C backend package FUNCTION="$function"
done
# 受け渡したZIPにも同じ検証を実行（Python 3.14が必要）
make -C backend verify FUNCTION=video
backend/.venv/bin/python backend/verify_lambda.py --require-clean backend/build/video.manifest.json
```

各 `backend/build/<function>.zip` と `<function>.manifest.json` を組で保管。
manifest は source revision、dirtyフラグ、handler/runtime/architecture、lockfile hash、ZIPのhex SHA256とbase64 CodeSha256を記録する。
配布には `source_tree_dirty=false` のものを採用し、承認したcommitと照合する。
SHAは内容の照合用で、署名による出所証明ではない。信頼するCI run/source revisionから取得する。
ZIPを再buildしたら、同じsourceでもhashが変わり得るため再検証・再採番して扱う。

package は展開したZIPだけをimportしてhandlerを検査し、同じ展開物で固定入力成功・通常入力拒否を検査する。
boto3と外向きnetwork socketの利用を禁止して検査するため、hostのAWS権限に依存しない。`verify` は受領ZIPとmanifestのhash照合も実施する。
CIの既存backend-package jobも同じ検証を行い、ZIPとmanifestを組でuploadする。CIへの手動実行入口を追加したが、この作業でdispatchはしない。

## 次段階でのみ使う契約（初回は設定しない）

通常処理を許可する場合は infra 管理の `BACKEND_EXECUTION_MODE=application` が必要。
まず隔離したtable/bucket/queue/job definition/SSM値で検証し、共有本番へは接続しない。envに偽名だけを入れて広いIAMを与える構成にしない。

| 設定名 | 使用箇所 / 資源 |
| --- | --- |
| AWS_REGION | boto3の接続先region（Lambda側の標準環境も使用） |
| DYNAMO_TABLE_NAME | 全通常処理のVideoRepository。PK video_id / GSI upload_status-backupdate-index |
| BACKUP_BACKET | video登録・Scrapbox登録時の出力bucket。綴りは既存契約を維持 |
| JOB_QUEUE_NAME | video登録 / backup / scrapbox_scan / retry のBatch投入先 |
| YTDLP_JOB_DEFINITION_NAME / YTDLP_JOB_REVISION | 同Batch job definitionの名前とrevision |
| SSM_YOUTUBE_API_KEY_PARAMETER | YouTube metadata API key参照（video / scrapbox_scan登録） |
| SSM_PROXY_PATH_PARAMETER / SSM_COOKIE_S3_PATH_PARAMETER | Batch投入パラメータ参照 |
| SSM_SCRAPBOX_CREDENTIALS_PARAMETER / SSM_SCRAPBOX_PROJECTS_PARAMETER | scrapbox_scanのSSM参照 |

必要権限案（すべて対象資源へ限定しinfraで管理。初回ロールには追加しない）:

- video: DynamoDB GetItem/Query/PutItem/UpdateItem/DeleteItem、S3 GetObject署名に必要な権限・DeleteObject、Batch SubmitJob/DescribeJobs、対応SSM GetParameter/GetParameters。
- backup / retry: DynamoDB GetItem/Query/UpdateItem、Batch SubmitJob/DescribeJobs、対応SSM GetParameters。
- s3_complete: DynamoDB GetItem/UpdateItem。イベントからbucket/keyを読むだけで、S3 APIは呼ばない。
- scrapbox_scan: DynamoDB GetItem/PutItem/UpdateItem、Batch SubmitJob/DescribeJobs、対応SSM GetParameter/GetParameters。
- SecureStringがカスタムKMS鍵なら対応key/contextに限るDecrypt、ログ権限。S3のKMS条件等は隔離bucketの構成に従い追加レビュー。
  上記は現コードからの最小権限案で、実AWSでの動作確認済みpolicyではない。

HTTP routeは `contracts/openapi.json` の `/videos` と `/videos/{video_id}`、`/playback_url`、`/backup`。
videoとbackupはリソース別router。API Gateway authorizerが検証したsub必須（REST claims / HTTP API jwt.claims両方に対応）。
Bearer headerだけではLambdaを認可しない。自動docs/OpenAPIのHTTP公開は無効。CORSとCognito pool/client、integration mapping、認証付きfrontend接続は後続段階。

通知: s3_complete はS3の `Records[].eventName=ObjectCreated:*`、eventTime、s3.bucket.name、URL encoded s3.object.keyを受信する。
video ID・attempt固有path・request時刻と照合して現在のinitだけを完了させる。旧通知の再接続や旧完了Lambdaとの二重更新をしない。
retry/scrapbox_scanは通常モードではpayloadを使わず即処理するため、テスト目的で空イベントをapplication関数へ送らない。

後続のBatch: infraの現job definitionはmutable `latest`参照のため、同じlatestへのpushは実ジョブを変え得る。
旧CIの唯一のwriter切替を確認し、commit SHA tag / digestをinfraの新job revisionへ明示反映する案を優先する。今回はimage pushを行わない。
後続のfrontend: `environment: production` のOIDC subは `repo:<owner>/<repo>:environment:production`。
main ref型trustの説明は切替時に修正し、environmentの許可branchも制限する。既存旧repo用ロールを無確認で流用しない。
main mergeは既存frontend deployを起動し得るため別承認。新role作成・trust拡張はこのアプリ作業で行わない。

## この変更の検証（2026-10-18）

- Python 3.14.7: backend pytest 37件、Ruff lint/format、旧9ソースのAST、pip checkが成功。TestClient由来の既存deprecation warningが1件。
- OpenAPI再生成は既存contractと同一。通常applicationモードの認証・router分割・業務テストも維持。
- 5 ZIP全ての依存同梱build、SHA256照合、展開物だけのhandler import、疎通応答、通常イベント拒否が成功。破損hash/dirty sourceの拒否テストも成功。
- 公式 `public.ecr.aws/lambda/python:3.14` コンテナで5 ZIPの展開物を各々import・疎通invokeし、通常イベント拒否を確認。network=none、AWS認証情報なし。
  使用image digest: `sha256:27483b5d8a13e85d0f8207706759a30d6a7c89e60aa9d48ec926b445bdc518d2`。
- CI YAMLのparseとartifactのZIP/manifestパス確認、git diff --check、変更ファイルのaccount ID/ARN/credential定型パターン検査は成功。これは秘密の完全監査を意味しない。
- 実AWSの関数作成/更新/直接invoke、IAM/OIDC変更、CI dispatch、PR/main merge、ECR push、frontend公開は未実施。
- frontend・batch・既存frontend deploy workflowは無変更。これらの機能検証は今回の対象外。
