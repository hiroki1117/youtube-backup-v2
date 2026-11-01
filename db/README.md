# Database

検索用の Neon（Postgres）のスキーマ。[Atlas](https://atlasgo.io) の Community Edition（Apache 2.0）で、SQL のマイグレーションファイルを順に適用する。データの原本は DynamoDB で、ここにあるのは検索用の複製。Neon の branch・compute・database は [infra](https://github.com/hiroki1117/infra/blob/main/youtube-backup/prod/neon.tf) が管理する。

## マイグレーションを追加する

```bash
atlas migrate new <name> --dir file://db/migrations   # 空のファイルを作る
# 作られた .sql に SQL を書く
atlas migrate hash --dir file://db/migrations         # atlas.sum を更新する
```

- 適用済みのファイルは編集しない。`atlas.sum` は改ざん検知用で、手で編集しない。
- CI が空の Postgres へ全ファイルを適用し、[backend のテスト](../backend/tests/test_search_database.py)を実行する。
- main に merge すると [deploy-db.yml](../.github/workflows/deploy-db.yml) が本番へ適用する。
- Atlas の更新は [setup-atlas](../.github/actions/setup-atlas/action.yml) の version と checksum を変える。Dependabot の対象外。

Community Edition は extension・view・function などをスキーマ差分の対象にしないため、`migrate diff` は使わず SQL を手で書く。適用に使う `migrate apply` は SQL をそのまま実行するので、これらも問題なく扱える。

## role

| role | 権限 | 使う場所 | 接続情報 |
|---|---|---|---|
| `neondb_owner` | 所有者 | deploy-db.yml のみ | GitHub の production Environment の secret `NEON_MIGRATION_DATABASE_URL` |
| `search_reader` | `videos` の SELECT | `youtube-backup-api-search` | SSM `/youtube-backup-neon/search-reader-url` |
| `search_writer` | `videos` の読み書き | `youtube-backup-search-sync` | SSM `/youtube-backup-neon/search-writer-url` |

`search_reader` と `search_writer` はマイグレーションが `NOLOGIN` で作る。ログインの有効化とパスワードは、パスワードを git に残さないよう手で行う。

### 初回の設定

1. `neondb_owner` の接続文字列を secret `NEON_MIGRATION_DATABASE_URL` に登録する。マイグレーション用なので `-pooler` のないホストを使う。
2. main に merge して deploy-db.yml を完了させる。
3. Neon の SQL Editor で、生成したパスワードを設定する。

   ```sql
   ALTER ROLE search_reader LOGIN PASSWORD '<生成した値>';
   ALTER ROLE search_writer LOGIN PASSWORD '<生成した値>';
   ```

4. 接続文字列を SSM の SecureString に登録する。Lambda から接続するので `-pooler` のあるホストを使う。`search_writer` も同様に登録する。

   ```text
   postgresql://search_reader:<値>@<endpoint>-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&sslrootcert=/etc/pki/tls/certs/ca-bundle.crt
   ```

5. `youtube-backup-search-sync` を手動で 1 回実行し、全件を同期する。
