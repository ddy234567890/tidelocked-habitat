"""USD -> GLB 변환 (NVIDIA SimReady 처럼 .usd 로만 받은 모델용).

모양과 재질 기본색만 옮기고 텍스처는 버린다. 결과는 Y 위, 미터 단위.
만든 .glb 를 public/models/raw 에 넣고 npm run normalize:models 를 돌리면 다른 모델과 같은 기준이 된다.

    pip install usd-core numpy
    python scripts/usd-to-glb.py <받은 폴더>/simready_usd/sm_xxx.usd public/models/raw/<이름>.glb
"""
import json, struct, sys
import numpy as np
from pxr import Usd, UsdGeom, UsdShade, Gf

def base_color(prim):
    try:
        mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    except Exception:
        mat = None
    if not mat:
        return (0.6, 0.6, 0.6)
    for p in Usd.PrimRange(mat.GetPrim()):
        sh = UsdShade.Shader(p)
        if not sh:
            continue
        for name in ("diffuse_color_constant", "diffuseColor", "base_color", "albedo_tint"):
            i = sh.GetInput(name)
            if i and i.Get() is not None:
                v = i.Get()
                return tuple(float(x) for x in v)[:3]
    return (0.6, 0.6, 0.6)

def convert(src, dst):
    stage = Usd.Stage.Open(src)
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 0.01
    cache = UsdGeom.XformCache()
    groups = {}
    for prim in Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()):
        if not prim.IsA(UsdGeom.Mesh):
            continue
        img = UsdGeom.Imageable(prim)
        if img.ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        purpose = img.ComputePurpose()
        if purpose in (UsdGeom.Tokens.guide, UsdGeom.Tokens.proxy):
            continue
        path = str(prim.GetPath()).lower()
        if "collision" in path or "collider" in path:
            continue
        m = UsdGeom.Mesh(prim)
        pts = m.GetPointsAttr().Get()
        cnt = m.GetFaceVertexCountsAttr().Get()
        idx = m.GetFaceVertexIndicesAttr().Get()
        if not pts or not cnt:
            continue
        P = np.array(pts, dtype=np.float64)
        M = np.array(cache.GetLocalToWorldTransform(prim), dtype=np.float64)
        P = np.c_[P, np.ones(len(P))] @ M
        P = P[:, :3] * mpu
        if up == UsdGeom.Tokens.z:
            P = np.c_[P[:, 0], P[:, 2], -P[:, 1]]
        tris = []
        o = 0
        idx = list(idx)
        for c in cnt:
            for k in range(1, c - 1):
                tris.append((idx[o], idx[o + k], idx[o + k + 1]))
            o += c
        col = base_color(prim)
        g = groups.setdefault(col, ([], []))
        base = sum(len(a) for a in g[0])
        g[0].append(P.astype(np.float32))
        g[1].append(np.array(tris, dtype=np.uint32) + base)
    write_glb(groups, dst)
    return sum(sum(len(t) for t in g[1]) for g in groups.values())

def write_glb(groups, dst):
    buf = bytearray()
    views, accs, meshes_prims, mats = [], [], [], []
    for col, (ps, ts) in groups.items():
        P = np.concatenate(ps); T = np.concatenate(ts).reshape(-1)
        off = len(buf); buf += P.tobytes()
        views.append({"buffer": 0, "byteOffset": off, "byteLength": P.nbytes, "target": 34962})
        accs.append({"bufferView": len(views) - 1, "componentType": 5126, "count": len(P), "type": "VEC3",
                     "min": P.min(0).tolist(), "max": P.max(0).tolist()})
        pa = len(accs) - 1
        while len(buf) % 4: buf += b"\0"
        off = len(buf); buf += T.tobytes()
        views.append({"buffer": 0, "byteOffset": off, "byteLength": T.nbytes, "target": 34963})
        accs.append({"bufferView": len(views) - 1, "componentType": 5125, "count": len(T), "type": "SCALAR"})
        mats.append({"pbrMetallicRoughness": {"baseColorFactor": [*col, 1.0], "metallicFactor": 0, "roughnessFactor": 1}})
        meshes_prims.append({"attributes": {"POSITION": pa}, "indices": len(accs) - 1, "material": len(mats) - 1})
    gl = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
          "meshes": [{"primitives": meshes_prims}], "materials": mats, "accessors": accs, "bufferViews": views,
          "buffers": [{"byteLength": len(buf)}]}
    js = json.dumps(gl).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    while len(buf) % 4: buf += b"\0"
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(buf), 0x004E4942)); f.write(buf)

if __name__ == "__main__":
    print(sys.argv[2], convert(sys.argv[1], sys.argv[2]), "tris")
