import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Only these inputs enter the Pages artifact. Never copy .env, dist, or backend files.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "build/docs");
const spec = JSON.parse(await readFile(path.join(root, "openapi/openapi.json"), "utf8"));
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
const json = (value) => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
const page = (title, content) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>
body{font:16px/1.65 system-ui,sans-serif;max-width:72rem;margin:3rem auto;padding:0 1.5rem;color:#17263a;background:#f8fafc}
a{color:#1258a6}h1,h2,h3{line-height:1.3}section{background:white;border:1px solid #d7e0eb;border-radius:.6rem;padding:1.4rem;margin:1.5rem 0}
pre{overflow:auto;padding:1rem;background:#edf2f7;font-size:.85rem}code{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}
nav ul{display:flex;flex-wrap:wrap;gap:1rem;list-style:none;padding:0}dt{font-weight:600}dd{margin:0 0 1rem}
</style></head><body>${content}</body></html>\n`;

const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
let count = 0;
const operations = Object.entries(spec.paths).flatMap(([route, item]) =>
  Object.entries(item)
    .filter(([method]) => methods.has(method))
    .map(([method, operation]) => {
      const id = `operation-${++count}`;
      return {
        id,
        label: `${method.toUpperCase()} ${route}`,
        html: `<section id="${id}">
<h2><code>${escape(method.toUpperCase())} ${escape(route)}</code></h2>
<p>${escape(operation.summary ?? "")}</p>${operation.description ? `<p>${escape(operation.description)}</p>` : ""}
<h3>認証</h3>${json(operation.security ?? spec.security ?? [])}
${item.parameters || operation.parameters ? `<h3>パラメータ</h3>${json([...(item.parameters ?? []), ...(operation.parameters ?? [])])}` : ""}
${operation.requestBody ? `<h3>リクエスト</h3>${json(operation.requestBody)}` : ""}
<h3>レスポンス</h3>${Object.entries(operation.responses)
          .map(
            ([status, response]) =>
              `<details><summary>${escape(status)} — ${escape(response.description ?? "")}</summary>${json(response)}</details>`,
          )
          .join("\n")}
</section>`,
      };
    }),
);

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "openapi"), { recursive: true });
await cp(path.join(root, "frontend/storybook-static"), path.join(output, "storybook"), {
  recursive: true,
});
await cp(path.join(root, "openapi/openapi.json"), path.join(output, "openapi/openapi.json"));
await writeFile(path.join(output, ".nojekyll"), "");
await writeFile(
  path.join(output, "index.html"),
  page(
    "YouTube Backup — 開発ドキュメント",
    `
<h1>YouTube Backup</h1><p>開発用の画面カタログと API リファレンス。</p>
<section><h2><a href="./storybook/">Storybook</a></h2><p>合成データによる画面・状態のカタログ。本番 AWS や実ユーザーのデータを使いません。</p></section>
<section><h2><a href="./openapi/">OpenAPI</a></h2><p>backend から生成した読取専用リファレンス。API の実行機能はありません。</p></section>`,
  ),
);
await writeFile(
  path.join(output, "openapi/index.html"),
  page(
    spec.info.title,
    `
<a href="../">ドキュメントへ戻る</a><h1>${escape(spec.info.title)}</h1>
<p>API ${escape(spec.info.version)} / OpenAPI ${escape(spec.openapi)} · <a href="./openapi.json">JSON 定義</a></p>
<p>認証は API Gateway の Cognito JWT。ここでは API を実行できません。<code>$ref</code> の参照先は下部のスキーマを参照してください。</p>
<nav aria-label="エンドポイント"><ul>${operations.map(({ id, label }) => `<li><a href="#${id}">${escape(label)}</a></li>`).join("")}</ul></nav>
${operations.map(({ html }) => html).join("\n")}
<section><h2>スキーマ</h2>${Object.entries(spec.components?.schemas ?? {})
      .map(
        ([name, schema]) =>
          `<details id="schema-${escape(name)}"><summary>${escape(name)}</summary>${json(schema)}</details>`,
      )
      .join("\n")}
<h2>認証方式</h2>${json(spec.components?.securitySchemes ?? {})}</section>`,
  ),
);
console.log(`Built ${count} API operations and Storybook in build/docs`);
