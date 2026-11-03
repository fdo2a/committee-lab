import { build } from "esbuild";
import { mkdir, readdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import {requireCodeApproval} from './code-review.mjs';
const codeDigest=await requireCodeApproval();
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await cp("web", "dist/client", { recursive: true });
const assets = {};
for (const name of (await readdir("web",{withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.name))
  assets["/" + name] = await readFile("web/" + name, "utf8");
await writeFile(
  "worker/assets.generated.mjs",
  "export default " + JSON.stringify(assets) + ";\n",
);
await build({
  entryPoints: ["worker/index.mjs"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  define:{__COMMITTEE_CODE_DIGEST__:JSON.stringify(codeDigest)},
});
await rm("worker/assets.generated.mjs");
console.log("Worker and website built.");
