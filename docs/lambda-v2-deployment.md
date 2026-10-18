# v2 Lambda の初回配布（Issue #43・第1段階）

対象は `hiroki1117/youtube-backup-v2`。[PR #40](https://github.com/hiroki1117/youtube-backup-v2/pull/40) では独立したv2専用5関数への配布を準備する。
実deploy/invoke、IAM/OIDC/credential設定、GitHub Environment設定、main mergeは別承認。この作業では実行しない。
実account ID・ARN・秘密・環境固有の識別値をsourceや例へコミットしない。以下の名前はダミー。

## 責任の境界

- private `hiroki1117/infra`: 関数・API Gateway等の土台、handler/runtime/architecture、環境変数、実行ロール・ログ・IAM・trigger設定。
  初回は最小bootstrap ZIPで関数を作成し `publish=false`。コード関連属性を `ignore_changes` とし、app配布後のZIPをTerraformで戻さない。
  `filename` / `source_code_hash` / 必要なS3 code属性など、実際に使用するcode属性をinfraで整理する。設定の二重管理はしない。
- app: source・依存・ZIP作成、`UpdateFunctionCode`、更新待機、CodeSha256照合、version発行、初回の限定invoke。
  env/handler/runtime/architecture/role/alias/triggerは更新しない。infra CIへのapp artifact搬送や、infra applyごとのapp buildは不要。
- bootstrapの作成成功は実アプリ配布・疎通の成功を意味しない。app ZIPのhashと発行versionの応答を確認して初めて初回疎通成功とする。

旧Lambda/API/S3通知/定期イベントを移管・上書き・再接続しない。Batch・frontend配布もこのworkflowから起動しない。
main mergeは既存frontend deployを起動し得るため、merge自体は別承認のまま。

## 初回5関数

全てZIP / `python3.14` / `x86_64` / Layersなし。FastAPI/Pydantic/Mangum/boto3/httpx等をruntime lockから同梱する。
実関数名はinfra outputから確認し、Environment Secretへ設定する。bootstrap時点から以下のhandlerをinfraで設定する。

| 論理キー・ZIP stem | handler | 通常モードの役割 |
| --- | --- | --- |
| video | `api.app.video_handler` | 動画一覧・登録・取得・更新・削除・再生URL |
| backup | `api.app.backup_handler` | backup取得・投入 |
| s3_complete | `events.handlers.s3_complete` | S3完了通知 |
| scrapbox_scan | `events.handlers.scrapbox_scan` | Scrapbox巡回・登録 |
| retry | `events.handlers.retry` | 追跡済み失敗job再投入 |

初期architectureはinfraで `x86_64` を設定する。infraがarchitecturesをignore_changesに含める場合も、appへの通常変更の委譲を意味しない。
両者の通常CIはarchitectureを変更せず、appはx86_64との一致だけを確認する。architecture変更は互換ZIPの再build・再配布を伴う両者の協調計画として別承認する。

初回infra設定: timeout 15秒、memory 256 MiB、reserved concurrency未設定（-1）、triggerなし。
環境変数は明示的な `BACKEND_EXECUTION_MODE=validation` のみ。共有DB/S3/SSM/Batch参照やlocal tokenを渡さない。
実行ロールは専用ログへのCreateLogStream/PutLogEventsに限定し、業務AWS APIはDeny。app CIの配布ロールとは別ロールとする。

## 手動workflowと必要設定

[deploy-backend.yml](../.github/workflows/deploy-backend.yml) は `workflow_dispatch` のみ。main以外ではdeploy jobを実行しない。
既存 `production` Environmentを使用し、同時実行を止めて5関数を逐次処理する。push/PRから自動deployせず、既存frontend workflowとBatchを呼び出さない。

事前にユーザー承認の上で以下を設定する（このPRでは設定変更しない）:

| 場所 | 設定名 | 値 |
| --- | --- | --- |
| production Environment Secret | AWS_LAMBDA_DEPLOY_ROLE_ARN | 承認した専用OIDC配布ロールARN |
| production Environment Secret | LAMBDA_FUNCTION_NAMES | 下記形式の、実在する専用5関数名へのJSON map |
| production Environment Variable | AWS_REGION | 対象region |

```json
{"video":"example-v2-video","backup":"example-v2-backup","s3_complete":"example-v2-s3-complete","scrapbox_scan":"example-v2-scrapbox-scan","retry":"example-v2-retry"}
```

5つのキーが揃い、値が重複しない関数名であることを検査する。ARN・alias・任意の追加キーは受け付けない。
Secret/regionが未設定なら明示的に停止。ZIP/manifest/対象mapを検証してからAWS credentialを取得する。

OIDC trustの承認案:

- 対象repo: `hiroki1117/youtube-backup-v2`、Environment: `production`。
- `aud`: `sts.amazonaws.com`。
- `sub`: `repo:hiroki1117/youtube-backup-v2:environment:production` の完全一致。
- このsubjectでは `deploy-backend.yml` 単体に限定できず、同じproduction Environmentを利用する他workflowもtrustの対象になる。専用roleでもこの範囲は変わらない。
- environment型subjectにはbranchが含まれないため、main限定にはEnvironmentのdeployment branch制限の**実設定**が必要。workflowのmain条件だけではtrustの代わりにならない。必要なreviewer承認も含め、設定変更は別承認とし今回は実施しない。
- 旧repo用trustやfrontend配布ロールを流用・拡張しない。専用role/trust/policyの追加は別承認。

必要な配布ロール権限案（実ARNはprivate infra設定で限定する）:

- 専用5関数だけ: `lambda:GetFunctionConfiguration`, `lambda:UpdateFunctionCode`, `lambda:PublishVersion`, `lambda:ListVersionsByFunction`。
- 同じ5関数のqualified ARN範囲: `lambda:GetFunctionConfiguration`, `lambda:InvokeFunction`。数値versionだけを呼ぶ検査はappでも行う。qualified ARN末尾を `:*` で許可する場合、IAM上はalias/`$LATEST`も範囲に入る点を承認時に確認する。alias管理権限は付けない。
- GitHub jobは `contents:read` / `id-token:write`。OIDC経由のAssumeRoleWithWebIdentityに限定する。
- 待機は採用botocoreの `function_active` / `function_updated` / `published_version_active` を使い、全てGetFunctionConfigurationで実施する。GetFunction権限は不要。SDK定義とStubberでこのAPI契約を検査する。
- CreateFunction / UpdateFunctionConfiguration / PassRole / IAM変更 / alias変更 / S3 / Batch / Terraform権限は不要。

従来のfrontendロールのS3/CloudFront権限や旧repoのtrustとは用途・対象・actionが異なる。この承認案は設定変更の実施許可ではない。

## 配布と初回検証の流れ

1. mainのsourceからテスト、5 ZIP作成、manifestとsource SHA・runtime lock・hash・clean状態を照合。
2. **全5関数**のActive状態、handler/runtime/architecture/Layers、環境変数が上記初回契約と一致することを確認してから最初の書込みへ進む。不一致はappで修正せずinfra側へ戻す。
3. `RevisionId`を指定してコードだけを更新（`Publish=false`）、更新完了を待機。CodeSha256をmanifestと照合する。env/handler等は上書きしない。
4. `PublishVersion`をhashとRevisionId付きで実行し、発行済み数値versionの設定・CodeSha256を再確認する。`$LATEST`やaliasはinvokeしない。
   同じcodeとinfra設定の発行versionが既にある再実行では、それを再利用して不要な更新・発行を避ける。
5. 初回だけ、手動入力 `initial_validation=true` を明示すると、同じ数値versionに各2回、全5関数で計10回を逐次invokeする。通常の手動配布ではfalse（invokeなし）。
6. logical function/version/hash/検証有無を `deployment-result.json` に保存し、ZIP/manifestと同じCI artifactへ保存する。実関数名やARNは結果へ書き出さない。

初回の疎通入力は [check.json](../backend/deployment/check.json) と完全一致する `{"operation":"deployment_check"}`。
応答は以下と完全一致、StatusCode=200、FunctionErrorなし、ExecutedVersionが指定versionと一致することを検査する。

```json
{"status":"ok","function":"video","execution_mode":"validation","aws_access":false}
```

`function` はそれぞれの論理キー。続く空入力 `{}` はFunctionError=Unhandled、errorType=RuntimeError、errorMessage=`Application invocation is disabled in validation mode` が必須。
任意の例外やbootstrap応答を成功扱いしない。invokeの自動再試行はせず、SDK書込み/発行の自動再試行も無効にする。

失敗したらそこで停止する。5関数の更新はトランザクションではなく、途中まで反映済みの場合がある。完了した論理キー/versionをログへ記録する。失敗時のresultは空/未生成の場合があるため、ログ・保存済みartifactとAWS上の各version/hashを確認してから再実行する。
切戻しもappの承認済みZIPで行い、未照合の旧Lambdaコードやbootstrapを代用しない。実配布・初回invokeの成功はAWS上ではまだ未検証。

## ローカル検証と成果物

```bash
make -C backend install
make -C backend check
make -C backend export
git diff --exit-code -- contracts/openapi.json
for function in video backup s3_complete scrapbox_scan retry; do
  make -C backend package FUNCTION="$function"
done
make -C backend verify FUNCTION=video
```

`backend/build/<function>.zip` と `<function>.manifest.json` を組で扱う。実配布にはcleanな承認済みsource revisionを使う。
appの手動配布はそのrunでbuildしたZIPを直接APIへ送るので、新しいS3 artifact保管や共通tfactionの搬送処理は不要。
GitHub artifactの7日保持は配布結果・切戻し候補の確認用。再配布時にもhash/sourceを検証する。

wheel/ZIPの時刻・順序・権限を固定し、不要CLI/local provenanceを除去する。build Pythonは3.14.7、PEP517依存は固定版。
runtime wheel hash/取得元とhost pip/build/zlibは完全固定ではなく、将来の別toolchainまで同hashを保証しない。infraの無関係なPRから再buildする仕組みは持たない。

配布処理のテストはfake Lambdaで実施し、コード以外を更新しないこと、全対象の事前検査、hash不一致停止、version再利用、初回応答・拒否判定を検査する。
実AWSのdeploy/invokeは別承認待ち。旧API/通知/定期イベント、DB/S3/Batch/API認証の業務連携成功とは区別する。
通常処理を有効にする環境設定・権限・隔離資源は次段階でinfraと合わせて確認する。
