# Builds the low-poly penguin and exports assets/models/penguin.glb
# Run:  blender --background --python tools/penguin.py
import bpy, bmesh, math, os
from mathutils import Vector

# LEISURE_OUT overrides the output folder (defaults to ../assets)
OUT = os.path.join(os.environ.get("LEISURE_OUT") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets")), "models")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
col = bpy.context.scene.collection


def material(name, hexcol):
    rgb = [(((hexcol >> s) & 255) / 255) ** 2.2 for s in (16, 8, 0)]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = .9
    return m


MATS = [material("Blue", 0x1c24d6), material("White", 0xf6f6ff), material("Yellow", 0xf6a90c),
        material("Pupil", 0x140c26), material("BlueDark", 0x141aa8)]
BLUE, WHITE, YELLOW, PUPIL, DARK = range(5)


def orient(faces, center):
    """Make face normals point away from center (fine for these convex-ish parts)."""
    for f in faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - center) < 0:
            f.normal_flip()


def ico(bm, sub, scale, loc, mi, fn=None):
    vs = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)["verts"]
    for v in vs:
        p = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
        v.co = (fn(p) if fn else p) + Vector(loc)
    fs = {f for v in vs for f in v.link_faces}
    for f in fs:
        f.material_index = mi
    return fs


def finish(name, bm, parent=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in MATS:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.parent = parent
    col.objects.link(ob)
    return ob


root = bpy.data.objects.new("Penguin", None)
col.objects.link(root)

# ---- body + head (one mesh, front is -Y) ----
bm = bmesh.new()
BC = Vector((0, 0, .6))


def pear(p):
    s = 1 - .22 * (p.z / .6)          # wider at the bottom
    return Vector((p.x * s, p.y * s, max(p.z, -.56)))


body = ico(bm, 3, (.56, .5, .6), BC, BLUE, pear)
for f in body:                        # white belly patch
    c = f.calc_center_median() - BC
    if c.y < -.12 and (c.x / .40) ** 2 + ((c.z + .1) / .46) ** 2 < 1:
        f.material_index = WHITE

HC, HS = Vector((0, -.02, 1.3)), (.5, .45, .43)
ico(bm, 2, HS, HC, BLUE)


def head_surface(d):
    t = 1 / math.sqrt((d.x / HS[0]) ** 2 + (d.y / HS[1]) ** 2 + (d.z / HS[2]) ** 2)
    return d * t


def eye_disc(az, el, rx, rz, lift, mi, seg=10):
    d0 = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    right = Vector((0, 0, 1)).cross(d0).normalized()
    up = d0.cross(right).normalized()
    pts = [d0] + [d0 + right * (rx * math.cos(2 * math.pi * i / seg)) + up * (rz * math.sin(2 * math.pi * i / seg))
                  for i in range(seg)]
    vs = [bm.verts.new(head_surface(p.normalized()) * (1 + lift) + HC) for p in pts]
    fs = [bm.faces.new((vs[0], vs[1 + i], vs[1 + (i + 1) % seg])) for i in range(seg)]
    for f in fs:
        f.material_index = mi
    orient(fs, HC)


for s in (-1, 1):
    eye_disc(s * .62, .12, .42, .48, .02, WHITE)
    eye_disc(s * .58, .12, .26, .31, .045, PUPIL)
    eye_disc(s * .68, .30, .08, .09, .07, WHITE, 6)

# beak: flat wedge
bv = [bm.verts.new(p) for p in [(-.2, -.38, 1.2), (.2, -.38, 1.2), (0, -.4, 1.29), (0, -.38, 1.13), (0, -.86, 1.16)]]
L, R, T, B, TIP = bv
beak = [bm.faces.new(f) for f in [(L, T, TIP), (T, R, TIP), (R, B, TIP), (B, L, TIP), (L, B, R, T)]]
for f in beak:
    f.material_index = YELLOW
orient(beak, Vector((0, -.5, 1.2)))

# tail nub
tv = [bm.verts.new(p) for p in [(-.13, .4, .2), (.13, .4, .2), (0, .42, .36), (0, .4, .1), (0, .68, .12)]]
L, R, T, B, TIP = tv
tail = [bm.faces.new(f) for f in [(L, T, TIP), (T, R, TIP), (R, B, TIP), (B, L, TIP)]]
for f in tail:
    f.material_index = DARK
orient(tail, Vector((0, .45, .2)))

body_ob = finish("Body", bm, root)

# ---- flippers (pivot at the shoulder, parented to the body so they waddle with it) ----
for s, name in ((-1, "Wing_L"), (1, "Wing_R")):
    bm = bmesh.new()
    a = s * .35

    def flipper(p, a=a):
        p = Vector((p.x, p.y, p.z - .30))
        t = 1 + .5 * (p.z / .64)      # taper toward the tip
        p.x *= t
        p.y *= t
        return Vector((p.x * math.cos(a) - p.z * math.sin(a), p.y, p.x * math.sin(a) + p.z * math.cos(a)))

    ico(bm, 1, (.06, .2, .34), (0, 0, 0), DARK, flipper)
    finish(name, bm, body_ob, (s * .38, 0, 1.0))

# ---- webbed feet ----
OUTLINE = [(-.09, .1), (-.2, -.22), (-.09, -.17), (0, -.3), (.09, -.17), (.2, -.22), (.09, .1)]
for s, name in ((-1, "Foot_L"), (1, "Foot_R")):
    bm = bmesh.new()
    th = s * .25
    rot = lambda x, y: (x * math.cos(th) - y * math.sin(th), x * math.sin(th) + y * math.cos(th))
    bot = [bm.verts.new((*rot(x, y), 0)) for x, y in OUTLINE]
    top = [bm.verts.new((*rot(x * .88, y * .88), .07)) for x, y in OUTLINE]
    n = len(OUTLINE)
    fs = [bm.faces.new(top), bm.faces.new(bot[::-1])]
    fs += [bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i])) for i in range(n)]
    for f in fs:
        f.material_index = YELLOW
    orient(fs, Vector((0, -.08, .035)))
    finish(name, bm, root, (s * .25, -.1, 0))

path = os.path.join(OUT, "penguin.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
print("PENGUIN_OK", path, os.path.getsize(path), "bytes,",
      sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'), "faces")
