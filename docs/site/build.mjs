import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

// Only these inputs enter the Pages artifact. Never copy .env, dist, or backend files.
const root = fileURLToPath(new URL("../../", import.meta.url));
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
const page = (title, content) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>
body{font:16px/1.65 system-ui,sans-serif;max-width:72rem;margin:3rem auto;padding:0 1.5rem;color:#17263a;background:#f8fafc}
a{color:#1258a6}h1,h2,h3{line-height:1.3}section{background:white;border:1px solid #d7e0eb;border-radius:.6rem;padding:1.4rem;margin:1.5rem 0}
pre{overflow:auto;padding:1rem;background:#edf2f7;font-size:.85rem}code{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}
nav ul{display:flex;flex-wrap:wrap;gap:1rem;list-style:none;padding:0}dt{font-weight:600}dd{margin:0 0 1rem}
</style></head><body>${content}</body></html>\n`;

const require = createRequire(import.meta.url);
const redocRoot = path.dirname(require.resolve("redoc/package.json"));
const redocPackage = JSON.parse(await readFile(path.join(redocRoot, "package.json"), "utf8"));
const sitePackage = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
if (redocPackage.version !== sitePackage.dependencies.redoc || redocPackage.license !== "MIT") {
  throw new Error("Expected the pinned MIT Redoc CE package");
}
let redocBundle = await readFile(path.join(redocRoot, "bundles/redoc.standalone.js"), "utf8");
// Redoc CE 3.0.1 hardcodes these branding URLs. Mirror the unchanged official SVGs
// locally, retaining the attribution instead of requiring the CDN at runtime.
const logos = ["logo-mini.svg", "logo-mini-full.svg"];
for (const logo of logos) {
  const remote = `https://cdn.redoc.ly/redoc/${logo}`;
  if (!redocBundle.includes(remote)) throw new Error(`Redoc branding URL changed: ${logo}`);
  redocBundle = redocBundle.replaceAll(remote, `./assets/${logo}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "openapi/assets"), { recursive: true });
await cp(path.join(root, "frontend/storybook-static"), path.join(output, "storybook"), {
  recursive: true,
});
await cp(path.join(root, "openapi/openapi.json"), path.join(output, "openapi/openapi.json"));
await writeFile(path.join(output, "openapi/assets/redoc.standalone.js"), redocBundle);
await cp(path.join(redocRoot, "LICENSE"), path.join(output, "openapi/assets/redoc-LICENSE.txt"));
for (const logo of [...logos, "NOTICE.txt"]) {
  await cp(new URL(`./assets/${logo}`, import.meta.url), path.join(output, "openapi/assets", logo));
}
await writeFile(
  path.join(output, "openapi/init.js"),
  `import { init } from "./assets/redoc.standalone.js";
// Embed the unchanged specification: no network access, proxy, or credentials.
init(${JSON.stringify(spec).replaceAll("<", "\\u003c")}, {
  disableTelemetry: true,
  skipBundle: true,
  hideDownloadButtons: true,
  schemaDefinitionsTagName: "Schemas",
  jsonSamplesExpandLevel: 1,
  sortRequiredPropsFirst: true,
  router: "hash"
}, document.getElementById("redoc"));
`,
);
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
  `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; base-uri 'none'; form-action 'none'">
<title>${escape(spec.info.title)}</title><style>
body{margin:0;font-family:system-ui,sans-serif}
header{padding:12px 24px;border-bottom:1px solid #d7e0eb;background:#fff;color:#17263a}
nav{display:flex;flex-wrap:wrap;gap:1rem}a{color:#1258a6}header p{margin:.5rem 0 0;font-size:.85rem}
</style></head><body><header><nav aria-label="ドキュメント">
<a href="../">ドキュメントへ戻る</a><a href="./openapi.json">OpenAPI JSON</a>
<a href="./assets/redoc-LICENSE.txt">Redoc CE ${escape(redocPackage.version)} · MIT</a>
</nav><p>読取専用 API リファレンス。API の実行や認証情報の入力はありません。</p></header>
<div id="redoc"></div><noscript><p>表示には JavaScript が必要です。<a href="./openapi.json">JSON 定義</a>も参照できます。</p></noscript>
<script type="module" src="./init.js"></script></body></html>\n`,
);
console.log(`Built Redoc CE ${redocPackage.version} and Storybook in build/docs`);
