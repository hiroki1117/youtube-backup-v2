# Database

検索用の Neon（Postgres）のスキーマ。[dbmate](https://github.com/amacneil/dbmate) で、SQL のマイグレーションファイルを順に適用する。データの原本は DynamoDB で、ここにあるのは検索用の複製。Neon の branch・compute・database は [infra](https://github.com/hiroki1117/infra/blob/main/youtube-backup/prod/neon.tf) が管理する。

## マイグレーションを追加する

```bash
dbmate new <name>   # db/migrations に空のファイルを作る
# 作られた .sql の migrate:up と migrate:down に SQL を書く
```

- 適用済みのファイルは編集しない。dbmate は適用済みファイルの変更を検知しない。
- CI が空の Postgres で適用、全件の取り消し、再適用を行い、[backend のテスト](../backend/tests/test_search_database.py)を実行する。
- main に merge すると [deploy-db.yml](../.github/workflows/deploy-db.yml) が本番へ適用する。
- dbmate の更新は [setup-dbmate](../.github/actions/setup-dbmate/action.yml) の version と checksum を変える。Dependabot の対象外。
- `db/schema.sql` は作らない（`--no-dump-schema`）。`pg_dump` の用意が必要になるため。現在のスキーマはマイグレーションから読む。
- 適用履歴は `schema_migrations` テーブルにある。
- テーブルと role はファイルを分けているので、`rollback` でテーブルを取り消しても role とパスワードは残る。`create_search_roles` まで取り消した場合は、初回の設定からやり直す。
- 新しいテーブルの `GRANT` は、そのテーブルを作るファイルに書く。

## role

| role | 権限 | 使う場所 | 接続情報 |
|---|---|---|---|
| `neondb_owner` | 所有者 | deploy-db.yml のみ | GitHub の production Environment の secret `NEON_MIGRATION_DATABASE_URL` |
| `search_reader` | `videos` の SELECT | `youtube-backup-api-search` | SSM `/youtube-backup-neon/search-reader-url` |
| `search_writer` | `videos` の読み書き | `youtube-backup-search-sync` | SSM `/youtube-backup-neon/search-writer-url` |

`search_reader` と `search_writer` はマイグレーションが `NOLOGIN` で作る。ログインの有効化とパスワードは、パスワードを git に残さないよう手で行う。

### 初回の設定

1. `neondb_owner` の接続文字列を secret `NEON_MIGRATION_DATABASE_URL` に登録する。マイグレーション用なので `-pooler` のないホストを使う。dbmate のドライバーは `channel_binding` に対応していないので、Neon の接続文字列から `&channel_binding=require` を取り除く。
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
