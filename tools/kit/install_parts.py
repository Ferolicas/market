"""Install projected parts into the Unity runtime art and refresh the catalog.

    python3 tools/kit/install_parts.py <projdir>:<Folder> [...] [--alias Name=Folder/Other.glb ...]

Every <projdir>/<Name>.glb whose Name is a catalog entry under Art/<Folder>/
is copied over the entry's path and the entry's bytes and sha256 are
refreshed; an alias sends a piece to another entry. Locked assets are never
touched.
"""
import sys, os, json, shutil, hashlib
root = "Unity/MiniMarketUnity/Assets/StreamingAssets"
cat_path = os.path.join(root, "Data/runtime-asset-catalog.json")
cat = json.load(open(cat_path))
# The entrance and the floor are shielded from the projector, which has
# ruined them before. --forzar lifts it for a piece rebuilt on purpose.
locked = {"StoreEntrance", "FloorTileBeige", "FloorTileWhite"}
forzar = "--forzar" in sys.argv
by_path = {e["path"]: e for e in cat["entries"]}
args = [a for a in sys.argv[1:] if a != "--forzar"]; aliases = {}
while "--alias" in args:
    i = args.index("--alias"); n, p = args[i + 1].split("=", 1); aliases[n] = "Art/" + p; args = args[:i] + args[i + 2:]
done = []; skipped = []; created = []
def put(src, path):
    e = by_path.get(path)
    if e is None:
        # A piece that did not exist before, such as one split off another:
        # it gets its own entry rather than being dropped on the floor.
        e = {"id": os.path.basename(path)[:-4], "kind": "environment", "path": path,
             "source": f"separada de otra pieza del kit ({os.path.basename(src)})", "bytes": 0, "sha256": ""}
        cat["entries"].append(e); by_path[path] = e; created.append(path)
    if os.path.basename(path)[:-4] in locked and not forzar: skipped.append(path + " (bloqueado)"); return
    data = open(src, "rb").read(); dst = os.path.join(root, path)
    os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copyfile(src, dst)
    e["bytes"] = len(data); e["sha256"] = hashlib.sha256(data).hexdigest(); done.append(path)
for spec in args:
    d, folder = spec.split(":")
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".glb") or fn.startswith("_"): continue
        name = fn[:-4]
        put(os.path.join(d, fn), aliases.get(name, f"Art/{folder}/{name}.glb"))
json.dump(cat, open(cat_path, "w"), indent=2); open(cat_path, "a").write("\n")
print("instaladas", len(done), "| entradas nuevas:", len(created)); [print("  " + p) for p in done]
if skipped: print("omitidas:", "; ".join(skipped))
