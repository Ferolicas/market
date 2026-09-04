import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root=resolve(process.argv[2]??new URL("../Builds/WebGL",import.meta.url).pathname);
const port=Number(process.argv[3]??4173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".wasm":"application/wasm",".data":"application/octet-stream",".glb":"model/gltf-binary",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".css":"text/css; charset=utf-8",".webmanifest":"application/manifest+json"};
createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);let relative=normalize(pathname).replace(/^([.][.][/\\])+/,"").replace(/^[/\\]+/,"");if(!relative)relative="index.html";
  let file=join(root,relative);if(!file.startsWith(root)||!existsSync(file)){response.writeHead(404);response.end("Not found");return;}if(statSync(file).isDirectory())file=join(file,"index.html");
  const compressed=file.endsWith(".br");const logical=compressed?file.slice(0,-3):file;const headers={"Content-Type":types[extname(logical)]??"application/octet-stream","Content-Length":String(statSync(file).size),"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp","Cache-Control":"no-store, max-age=0","Pragma":"no-cache","Expires":"0"};if(compressed)headers["Content-Encoding"]="br";
  response.writeHead(200,headers);createReadStream(file).pipe(response);
}).listen(port,"127.0.0.1",()=>console.log(`Mini Market Unity: http://127.0.0.1:${port} (${root})`));
