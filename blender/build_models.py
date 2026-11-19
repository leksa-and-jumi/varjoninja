# Builds the game's 3D models in Blender and exports them as glTF (.glb) into public/models/.
#   npm run models
# Everything is made with code, so a model can be changed by editing this file and re-running it.
#
# Characters: one smooth body (skin modifier + subdivision) rigged with named bones. The colours
# are not in the model: every vertex stores a "region" number in its UV x (skin, top, trousers,
# shoes, belt…), and the game paints each region (ninja suit, civilian clothes, police uniform).
# Animation is done in the game code by turning the bones.
#
# Cars: low-poly bodies with separate wheels (wheel_fl, wheel_fr, wheel_rl, wheel_rr) and named
# materials (paint, glass, trim, tire, rim, headlight, taillight, siren_red, siren_blue, sign).

import math
import os

import bmesh
import bpy
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')

# Region numbers (must match REGION in src/render/characters.ts).
(SKIN, TOP, BOTTOM, SHOES, BELT, HEAD, EYES, HANDS, FOREARM, NECK, FACE, HAIR, HAT, ACCENT,
 EYEWHITE, NOSE, EARS, SOLE, BROWS, MOUTH, IRIS) = range(21)
# Body: the region comes from the rest position in the shader (see characters.ts).
BODY_AUTO = 30


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, roughness=0.6, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    return m


def set_region_uv(obj, region_of):
    """Store region numbers in UV x. One region per face (from the face centre), so the
    edges between clothes follow the mesh instead of zig-zagging."""
    me = obj.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='region')
    uv = me.uv_layers['region'].data
    for poly in me.polygons:
        r = region_of(poly.center)
        for li in poly.loop_indices:
            uv[li].uv = (r + 0.5, 0.5)


def export(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_skins=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
    )


# --------------------------------------------------------------------------------------------
# Character
# --------------------------------------------------------------------------------------------

# Joint positions (Blender: Z up, character faces -Y). Left = +X.
J = {
    'pelvis': (0, 0, 0.98),
    'spine': (0, 0, 1.13),
    'chest': (0, 0.005, 1.33),
    'neck': (0, 0.01, 1.52),
    'head': (0, 0, 1.6),
    'hip.L': (0.1, 0, 0.94),
    'knee.L': (0.105, -0.015, 0.52),
    'ankle.L': (0.11, 0.02, 0.1),
    'toe.L': (0.11, -0.14, 0.035),
    'collar.L': (0.11, 0.015, 1.465),
    'shoulder.L': (0.205, 0.01, 1.43),
    'elbow.L': (0.37, 0.02, 1.2),
    'wrist.L': (0.52, 0.0, 1.0),
    'hand.L': (0.57, -0.01, 0.92),
    'fingers.L': (0.605, -0.015, 0.865),
    'thumb.L': (0.535, -0.05, 0.945),
}
for k in list(J):
    if k.endswith('.L'):
        x, y, z = J[k]
        J[k[:-2] + '.R'] = (-x, y, z)

# Skin radii (x, y) per joint.
RADII = {
    'pelvis': (0.165, 0.12),
    'spine': (0.15, 0.105),
    'chest': (0.19, 0.125),
    'neck': (0.06, 0.06),
    'hip': (0.095, 0.095),
    'knee': (0.068, 0.072),
    'ankle': (0.05, 0.055),
    'toe': (0.05, 0.034),
    'shoulder': (0.068, 0.068),
    'elbow': (0.052, 0.052),
    'wrist': (0.038, 0.034),
    'hand': (0.047, 0.026),
    'collar': (0.075, 0.065),
    'fingers': (0.04, 0.018),
    'thumb': (0.017, 0.017),
}

EDGES = [
    ('pelvis', 'spine'),
    ('spine', 'chest'),
    ('chest', 'neck'),
    ('pelvis', 'hip.L'), ('hip.L', 'knee.L'), ('knee.L', 'ankle.L'), ('ankle.L', 'toe.L'),
    ('pelvis', 'hip.R'), ('hip.R', 'knee.R'), ('knee.R', 'ankle.R'), ('ankle.R', 'toe.R'),
    ('chest', 'collar.L'), ('collar.L', 'shoulder.L'), ('shoulder.L', 'elbow.L'), ('elbow.L', 'wrist.L'),
    ('wrist.L', 'hand.L'), ('hand.L', 'fingers.L'), ('wrist.L', 'thumb.L'),
    ('chest', 'collar.R'), ('collar.R', 'shoulder.R'), ('shoulder.R', 'elbow.R'), ('elbow.R', 'wrist.R'),
    ('wrist.R', 'hand.R'), ('hand.R', 'fingers.R'), ('wrist.R', 'thumb.R'),
]

# Bones: name, head joint, tail joint, parent.
BONES = [
    ('hips', 'pelvis', 'spine', None),
    ('spine', 'spine', 'chest', 'hips'),
    ('chest', 'chest', 'neck', 'spine'),
    ('neck', 'neck', 'head', 'chest'),
    ('head', 'head', None, 'neck'),
]
for s in ('L', 'R'):
    BONES += [
        (f'upperArm.{s}', f'shoulder.{s}', f'elbow.{s}', 'chest'),
        (f'forearm.{s}', f'elbow.{s}', f'wrist.{s}', f'upperArm.{s}'),
        (f'hand.{s}', f'wrist.{s}', f'hand.{s}', f'forearm.{s}'),
        (f'thigh.{s}', f'hip.{s}', f'knee.{s}', 'hips'),
        (f'shin.{s}', f'knee.{s}', f'ankle.{s}', f'thigh.{s}'),
        (f'foot.{s}', f'ankle.{s}', f'toe.{s}', f'shin.{s}'),
    ]


def body_region(v):
    x, y, z = v.x, v.y, v.z
    ax = abs(x)
    if z > 1.5 and ax < 0.09:
        return NECK
    if z < 0.035:
        return SOLE
    if z < 0.14:
        return SHOES
    if ax > 0.47:
        return HANDS
    if ax > 0.3 and z < 1.27:
        return FOREARM
    if z < 0.9 or (z < 0.99 and ax > 0.05 and ax < 0.22 and z < 0.93):
        return BOTTOM
    if z < 1.0:
        return BELT
    return TOP



# --------------------------------------------------------------------------------------------
# Head and face
# --------------------------------------------------------------------------------------------

HEAD_C = Vector((0, 0.008, 1.70))


def _g(d, sigma):
    return math.exp(-(d * d) / (2 * sigma * sigma))


def _smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _nose_weight(l):
    front = _smooth(0.0, -0.08, l.y)
    w = _g(l.x, 0.0095) * _smooth(0.036, 0.0, l.z) * _smooth(-0.052, -0.026, l.z) * front
    amt = 0.004 + 0.022 * max(0.0, min(1.0, (0.03 - l.z) / 0.058))
    return w, amt


def _lip_weight(l):
    front = _smooth(0.0, -0.08, l.y)
    upper = _g(l.x, 0.017) * _g(l.z + 0.058, 0.0045)
    lower = _g(l.x, 0.016) * _g(l.z + 0.072, 0.005)
    return max(upper, lower) * front


def shape_head(co):
    """Turn a round egg into a face: jaw and chin, cheekbones, eye sockets, brow, nose, lips."""
    l = co - HEAD_C
    front = _smooth(0.0, -0.08, l.y)
    x, y, z = l.x, l.y, l.z
    # Narrower jaw and a little chin.
    if z < 0:
        x *= 1 - 0.2 * _smooth(-0.02, -0.13, z)
        y -= 0.012 * front * _smooth(-0.085, -0.13, z)
    for side in (-1, 1):
        # Cheekbones.
        w = _g((Vector((x, y, z)) - Vector((side * 0.066, -0.08, -0.014))).length, 0.022)
        x += side * 0.006 * w
        y -= 0.004 * w
        # Eye sockets.
        w = _g((Vector((x, y, z)) - Vector((side * 0.041, -0.105, 0.006))).length, 0.016)
        y += 0.012 * w
        # Nostril wings.
        w = _g((Vector((x, y, z)) - Vector((side * 0.012, -0.11, -0.034))).length, 0.008)
        y -= 0.006 * w
    # Brow ridge.
    w = _g(z - 0.033, 0.011) * front * _smooth(0.075, 0.035, abs(x))
    y -= 0.006 * w
    # Nose.
    nw, amt = _nose_weight(Vector((x, y, z)))
    y -= amt * nw
    # Lips, with the mouth corners tucked in.
    y -= 0.006 * _lip_weight(Vector((x, y, z)))
    for side in (-1, 1):
        y += 0.003 * _g((Vector((x, y, z)) - Vector((side * 0.025, -0.1, -0.065))).length, 0.007)
    return HEAD_C + Vector((x, y, z))


def build_head():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=0.118, location=HEAD_C)
    head = bpy.context.active_object
    head.scale = (0.95, 1.0, 1.12)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for v in head.data.vertices:
        v.co = shape_head(v.co)
    head.data.update()
    bpy.ops.object.shade_smooth()

    def head_region(v):
        l = v - HEAD_C
        nw, amt = _nose_weight(l)
        if nw * amt > 0.004:
            return NOSE
        # Eye band in front (the ninja mask opening).
        if v.y < -0.05 and 1.66 < v.z < 1.745:
            return FACE
        if v.z < 1.6:
            return NECK
        return HEAD

    set_region_uv(head, head_region)

    def blob(loc, radius, scale, region, segments=16, rings=10, keep=None):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=loc)
        o = bpy.context.active_object
        o.scale = scale
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if keep:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[vv for vv in bm.verts if not keep(vv.co - Vector(loc))], context='VERTS')
            bm.to_mesh(o.data)
            bm.free()
        bpy.ops.object.shade_smooth()
        set_region_uv(o, lambda v: region)
        return o

    parts = []
    for sx in (-1, 1):
        ex, ey, ez = sx * 0.041, -0.093, 1.706
        # Eyeball, coloured iris, dark pupil.
        parts.append(blob((ex, ey, ez), 0.0145, (1, 1, 1), EYEWHITE, 20, 14))
        # (Iris and pupil sit a couple of millimetres in front of the eyeball, so they still
        # win the depth test when seen from far away.)
        parts.append(blob((ex, ey - 0.0146, ez), 0.0076, (1, 0.55, 1), IRIS, 16, 10))
        parts.append(blob((ex, ey - 0.0172, ez), 0.0038, (1, 0.55, 1), EYES, 10, 6))
        # Upper eyelid: a skin cap over the top of the eye.
        parts.append(blob((ex, ey, ez), 0.0158, (1.05, 1, 1), FACE, 20, 14,
                          keep=lambda c: c.z > 0.0035 and c.y < 0.004))
        # Eyebrow: a gently curved row of overlapping flat lumps (thicker on the inside).
        for k in range(9):
            t = k / 8
            bx = sx * (0.022 + 0.042 * t)
            bz = 1.735 + 0.006 * math.sin(t * math.pi * 0.85) - 0.002 * t
            r = 0.0062 - 0.0018 * t
            parts.append(blob((bx, -0.1 + 0.013 * t * t, bz), r, (1.5, 0.5, 0.5), BROWS, 10, 6))
        # Ears (lips are added once, after the loop).
        parts.append(blob((sx * 0.106, 0.012, 1.69), 0.028, (0.38, 0.72, 1.15), EARS, 14, 10))
    # Lips: soft upper and lower lip.
    parts.append(blob((0, -0.1015, 1.6415), 0.016, (1.1, 0.32, 0.22), MOUTH, 16, 10))
    parts.append(blob((0, -0.1, 1.6325), 0.0155, (1.0, 0.36, 0.27), MOUTH, 16, 10))
    return head, parts


def build_body():
    me = bpy.data.meshes.new('body')
    names = [n for n in J if n != 'head']
    me.from_pydata([J[n] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    obj = bpy.data.objects.new('body', me)
    bpy.context.collection.objects.link(obj)
    skin = obj.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for i, n in enumerate(names):
        key = n.split('.')[0]
        sv[i].radius = RADII[key]
        sv[i].use_root = n == 'pelvis'
    sub = obj.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier='skin')
    bpy.ops.object.modifier_apply(modifier='sub')
    bpy.ops.object.shade_smooth()

    head, face_parts = build_head()
    eyes = face_parts

    # The body's clothes are worked out per pixel in the game shader (crisp hems and sleeves),
    # so the body mesh only says "body" here.
    set_region_uv(obj, lambda v: BODY_AUTO)

    bpy.ops.object.select_all(action='DESELECT')
    for o in [obj, head, *eyes]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    return obj


def build_armature():
    arm_data = bpy.data.armatures.new('rig')
    rig = bpy.data.objects.new('rig', arm_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    for name, a, b, parent in BONES:
        bone = eb.new(name)
        bone.head = Vector(J[a])
        bone.tail = Vector(J[b]) if b else Vector(J[a]) + Vector((0, 0, 0.2))
        if parent:
            bone.parent = eb[parent]
            bone.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def bind(body, rig):
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def accessory(name, bone, build, rig):
    """A rigid accessory mesh parented to one bone (hair, hats, belt knot, sword)."""
    obj = build()
    obj.name = name
    obj.data.name = name
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    obj.matrix_world = mw
    return obj


def mesh_from(fn, region):
    fn()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    set_region_uv(o, lambda v: region)
    return o


def joined(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def build_character():
    reset()
    body = build_body()
    rig = build_armature()
    bind(body, rig)
    body.data.materials.append(material('character', (1, 1, 1), roughness=0.7))

    acc = []

    def hair_short():
        bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=0.129, location=(0, 0.012, 1.722))
        o = bpy.context.active_object
        o.scale = (0.97, 1.02, 1.0)
        bpy.ops.object.transform_apply(scale=True)
        # Cut away the face side.
        bm = bmesh.new()
        bm.from_mesh(o.data)
        # Keep the face free: cut away everything in front below the forehead.
        # (Coordinates relative to the sphere centre, wherever Blender put the vertices.)
        c = Vector((0, 0.012, 1.722)) - o.location
        def hairline(v):
            # Hairline: a little lower at the temples than in the middle.
            return 0.045 - 0.012 * min(1.0, abs(v.co.x - c.x) / 0.1)

        cut = [v for v in bm.verts if ((v.co.z - c.z) < hairline(v) and (v.co.y - c.y) < -0.03) or ((v.co.z - c.z) < -0.01 and (v.co.y - c.y) < 0.03) or (v.co.z - c.z) < -0.045]
        bmesh.ops.delete(bm, geom=cut, context='VERTS')
        # Tuck the front edge in against the forehead, so it is not a hard shelf.
        for v in bm.verts:
            rel = v.co - c
            if rel.y < 0:
                k = 1 - min(1.0, max(0.0, (rel.z - 0.045) / 0.05))
                v.co = c + rel * (1 - 0.07 * k * k)
        bm.to_mesh(o.data)
        bm.free()
        bpy.ops.object.shade_smooth()
        set_region_uv(o, lambda v: HAIR)
        return o

    def hair_long():
        base = hair_short()
        # Hair falling down the back (narrow, so it doesn't show beside the chin).
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.1, location=(0, 0.1, 1.58))
        tail = bpy.context.active_object
        tail.scale = (0.85, 0.55, 1.55)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.shade_smooth()
        set_region_uv(tail, lambda v: HAIR)
        return joined([base, tail], 'hairLong')

    def hair_bun():
        base = hair_short()
        # A round bun on the back of the head.
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.048, location=(0, 0.13, 1.79))
        bun = bpy.context.active_object
        bun.scale = (1.0, 0.9, 0.9)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.shade_smooth()
        set_region_uv(bun, lambda v: HAIR)
        return joined([base, bun], 'hairBun')

    def hair_curly():
        base = hair_short()
        # Curls: small round lumps all over the top and back.
        curls = [base]
        rng_state = [12345]

        def rnd():
            rng_state[0] = (rng_state[0] * 1103515245 + 12345) % 2147483648
            return rng_state[0] / 2147483648

        for k in range(70):
            # Even spread over the upper back half of a sphere.
            u = rnd()
            phi = math.acos(1 - u * 1.1)
            theta = rnd() * math.pi * 2
            d = Vector((math.sin(phi) * math.cos(theta), math.sin(phi) * math.sin(theta), math.cos(phi)))
            if d.y < -0.25 and d.z < 0.55:
                continue  # keep the forehead free
            loc = Vector((0, 0.012, 1.722)) + Vector((d.x * 0.124, d.y * 0.13, d.z * 0.128))
            bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.017 + rnd() * 0.008, location=loc)
            c = bpy.context.active_object
            bpy.ops.object.shade_smooth()
            set_region_uv(c, lambda v: HAIR)
            curls.append(c)
        return joined(curls, 'hairCurly')

    def cap():
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.13, location=(0, 0.01, 1.73))
        dome = bpy.context.active_object
        bm = bmesh.new()
        bm.from_mesh(dome.data)
        cz = 1.73 - dome.location.z
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z - cz < -0.005], context='VERTS')
        bm.to_mesh(dome.data)
        bm.free()
        bpy.ops.object.shade_smooth()
        set_region_uv(dome, lambda v: HAT)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.1, depth=0.012, location=(0, -0.11, 1.735))
        visor = bpy.context.active_object
        visor.scale = (1.05, 0.8, 1)
        bpy.ops.object.transform_apply(scale=True)
        set_region_uv(visor, lambda v: ACCENT)
        return joined([dome, visor], 'cap')

    def police_hat():
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.135, depth=0.09, location=(0, 0.01, 1.79))
        crown = bpy.context.active_object
        crown.scale = (1.05, 1.15, 1)
        bpy.ops.object.transform_apply(scale=True)
        set_region_uv(crown, lambda v: HAT)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.125, depth=0.03, location=(0, 0.0, 1.745))
        band = bpy.context.active_object
        set_region_uv(band, lambda v: ACCENT)
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.08, depth=0.01, location=(0, -0.12, 1.74))
        visor = bpy.context.active_object
        visor.rotation_euler = (math.radians(-12), 0, 0)
        set_region_uv(visor, lambda v: ACCENT)
        return joined([crown, band, visor], 'policeHat')

    def headband():
        bpy.ops.mesh.primitive_torus_add(major_radius=0.118, minor_radius=0.014, major_segments=32, minor_segments=8, location=(0, 0.006, 1.765))
        band = bpy.context.active_object
        band.scale = (0.98, 1.05, 1)
        bpy.ops.object.transform_apply(scale=True)
        set_region_uv(band, lambda v: ACCENT)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.03, location=(0, 0.13, 1.765))
        knot = bpy.context.active_object
        set_region_uv(knot, lambda v: ACCENT)
        return joined([band, knot], 'headband')

    def belt():
        bpy.ops.mesh.primitive_torus_add(major_radius=0.148, minor_radius=0.022, major_segments=32, minor_segments=8, location=(0, 0.0, 0.97))
        b = bpy.context.active_object
        b.scale = (1.0, 0.76, 1)
        bpy.ops.object.transform_apply(scale=True)
        set_region_uv(b, lambda v: ACCENT)
        return b

    def sword():
        # Katana on the back, diagonal.
        parts = []
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.022, depth=0.62, location=(0, 0, 0))
        sheath = bpy.context.active_object
        set_region_uv(sheath, lambda v: BOTTOM)
        parts.append(sheath)
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.017, depth=0.24, location=(0, 0, 0.43))
        grip = bpy.context.active_object
        set_region_uv(grip, lambda v: ACCENT)
        parts.append(grip)
        bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.05, depth=0.015, location=(0, 0, 0.31))
        guard = bpy.context.active_object
        set_region_uv(guard, lambda v: EYES)
        parts.append(guard)
        s = joined(parts, 'sword')
        s.rotation_euler = (0, math.radians(38), 0)
        s.location = (0.0, 0.135, 1.27)
        bpy.ops.object.transform_apply(location=True, rotation=True)
        bpy.ops.object.shade_smooth()
        return s

    acc.append(accessory('hairShort', 'head', hair_short, rig))
    acc.append(accessory('hairLong', 'head', hair_long, rig))
    acc.append(accessory('hairBun', 'head', hair_bun, rig))
    acc.append(accessory('hairCurly', 'head', hair_curly, rig))
    acc.append(accessory('cap', 'head', cap, rig))
    acc.append(accessory('policeHat', 'head', police_hat, rig))
    acc.append(accessory('headband', 'head', headband, rig))
    acc.append(accessory('belt', 'hips', belt, rig))
    acc.append(accessory('sword', 'chest', sword, rig))
    for a in acc:
        a.data.materials.append(body.data.materials[0])

    export(os.path.join(OUT, 'character.glb'), [rig, body, *acc])


# --------------------------------------------------------------------------------------------
# Cars
# --------------------------------------------------------------------------------------------


def car_materials():
    return {
        'paint': material('paint', (0.8, 0.1, 0.1), metallic=0.5, roughness=0.3),
        'glass': material('glass', (0.05, 0.07, 0.09), metallic=0.6, roughness=0.08),
        'trim': material('trim', (0.05, 0.05, 0.055), roughness=0.6),
        'tire': material('tire', (0.03, 0.03, 0.03), roughness=0.9),
        'rim': material('rim', (0.75, 0.76, 0.78), metallic=0.9, roughness=0.3),
        'headlight': material('headlight', (1, 1, 0.9), emission=(1, 0.95, 0.8)),
        'taillight': material('taillight', (0.6, 0.02, 0.02), emission=(1, 0.05, 0.05)),
        'siren_red': material('siren_red', (0.8, 0.05, 0.05), emission=(1, 0.05, 0.05)),
        'siren_blue': material('siren_blue', (0.05, 0.2, 0.9), emission=(0.1, 0.3, 1)),
        'sign': material('sign', (1, 0.85, 0.2), emission=(1, 0.8, 0.3)),
        'white': material('white', (0.92, 0.93, 0.95), metallic=0.4, roughness=0.3),
    }


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def hull(points, name):
    """Convex hull mesh through the given points."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def bevel(obj, width=0.08, segments=3):
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier='bevel')
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))


def box_obj(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    assign(o, mat)
    return o


def wheel(name, x, y, r, w, mats):
    # Car faces -Y; wheel axis along X.
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=w, location=(x, y, r), rotation=(0, math.radians(90), 0))
    tire = bpy.context.active_object
    assign(tire, mats['tire'])
    bevel(tire, 0.04, 2)
    side = 1 if x > 0 else -1
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r * 0.62, depth=0.02, location=(x + side * w / 2, y, r), rotation=(0, math.radians(90), 0))
    rim = bpy.context.active_object
    assign(rim, mats['rim'])
    o = joined([tire, rim], name)
    # Origin at the wheel centre so the game can spin it.
    bpy.context.scene.cursor.location = (x, y, r)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return o


def build_car(kind):
    reset()
    m = car_materials()
    parts = []
    # Dimensions per kind: length, width, body height, cabin top, cabin start/end along length.
    spec = {
        'sedan': dict(L=4.5, W=1.86, body=0.78, top=1.48, c0=-0.35, c1=0.95, ride=0.28, r=0.34),
        'taxi': dict(L=4.6, W=1.86, body=0.78, top=1.5, c0=-0.4, c1=0.95, ride=0.28, r=0.34),
        'police': dict(L=4.7, W=1.9, body=0.8, top=1.5, c0=-0.4, c1=0.95, ride=0.29, r=0.35),
        'van': dict(L=5.0, W=2.0, body=1.05, top=2.25, c0=-1.6, c1=1.85, ride=0.32, r=0.37),
        'sports': dict(L=4.4, W=1.94, body=0.62, top=1.18, c0=-0.2, c1=1.1, ride=0.2, r=0.34),
        'ambulance': dict(L=5.8, W=2.1, body=1.0, top=2.3, c0=-2.1, c1=-1.0, ride=0.34, r=0.38),
        'suv': dict(L=4.85, W=2.0, body=0.98, top=1.98, c0=-0.85, c1=1.7, ride=0.44, r=0.41),
        'pickup': dict(L=5.4, W=2.02, body=0.95, top=1.95, c0=-0.95, c1=0.3, ride=0.44, r=0.42),
        'mini': dict(L=3.3, W=1.66, body=0.72, top=1.56, c0=-0.55, c1=1.12, ride=0.24, r=0.3),
    }[kind]
    boxy = kind in ('van', 'ambulance')
    # SUVs and pickups: upright but not quite van-boxy.
    tall = kind in ('suv', 'pickup')
    white_body = kind in ('police', 'ambulance')
    L, W, ride, r = spec['L'], spec['W'], spec['ride'], spec['r']
    hl = L / 2
    hw = W / 2
    zb = ride
    zt = ride + spec['body']
    # Lower body: a hull with a sloped nose and tail (front is -Y).
    nose = 0.08 if boxy else 0.16 if tall else 0.25
    lower = hull(
        [
            (sx * hw, sy * hl, z)
            for sx in (-1, 1)
            for sy, z in ((-1, zb + 0.05), (1, zb + 0.05))
        ]
        + [(sx * hw * 0.98, -hl + nose, zt) for sx in (-1, 1)]
        + [(sx * hw * 0.98, hl - nose * 0.6, zt) for sx in (-1, 1)]
        + [(sx * hw * 0.9, -hl, zt - 0.22) for sx in (-1, 1)]
        + [(sx * hw * 0.9, hl, zt - 0.18) for sx in (-1, 1)],
        'body',
    )
    assign(lower, m['white'] if white_body else m['paint'])
    bevel(lower, 0.1, 3)
    parts.append(lower)
    if kind == 'police':
        # Painted doors (the paint is blue for police; the body is white).
        stripe = hull(
            [(sx * (hw + 0.005), y, z) for sx in (-1, 1) for y in (-0.9, 1.0) for z in (zb + 0.25, zt - 0.08)],
            'stripe',
        )
        assign(stripe, m['paint'])
        parts.append(stripe)

    # Cabin: glass hull with a painted roof on top.
    c0, c1, top = spec['c0'], spec['c1'], spec['top'] + ride - 0.28
    slope = 0.15 if boxy else 0.25 if tall else 0.45
    cabin = hull(
        [(sx * hw * 0.94, c0 - slope, zt) for sx in (-1, 1)]
        + [(sx * hw * 0.94, c1 + slope * 0.6, zt) for sx in (-1, 1)]
        + [(sx * hw * 0.8, c0 + 0.25, top) for sx in (-1, 1)]
        + [(sx * hw * 0.8, c1 - 0.15, top) for sx in (-1, 1)],
        'cabin',
    )
    assign(cabin, m['glass'])
    bevel(cabin, 0.05, 2)
    parts.append(cabin)
    roof = hull(
        [(sx * hw * 0.81, y, z) for sx in (-1, 1) for y in (c0 + 0.27, c1 - 0.17) for z in (top - 0.01, top + 0.05)],
        'roof',
    )
    assign(roof, m['white'] if white_body else m['paint'])
    bevel(roof, 0.03, 2)
    parts.append(roof)
    if kind == 'ambulance':
        # Ambulance: tall box behind the cab, red stripe and red crosses (paint is red).
        y0, y1 = c1 + 0.15, hl - 0.05
        zt2 = top + 0.45
        box = box_obj('cargo', (W * 0.98, y1 - y0, zt2 - zt + 0.05), (0, (y0 + y1) / 2, (zt2 + zt) / 2), m['white'])
        bevel(box, 0.06, 2)
        parts.append(box)
        for sx in (-1, 1):
            parts.append(box_obj('stripe', (0.02, L - 0.3, 0.16), (sx * (hw - 0.0), 0.05, zt - 0.05), m['paint']))
            cy = (y0 + y1) / 2
            cz = (zt + zt2) / 2 + 0.15
            parts.append(box_obj('cross', (0.02, 0.6, 0.18), (sx * (W * 0.49 + 0.01), cy, cz), m['paint']))
            parts.append(box_obj('cross', (0.02, 0.18, 0.6), (sx * (W * 0.49 + 0.01), cy, cz), m['paint']))
        parts.append(box_obj('cross', (0.5, 0.02, 0.16), (0, y1 + 0.005, zt2 - 0.45), m['paint']))
        parts.append(box_obj('cross', (0.16, 0.02, 0.5), (0, y1 + 0.005, zt2 - 0.45), m['paint']))
        parts.append(box_obj('siren_red', (0.5, 0.2, 0.14), (-0.3, c0 + 0.5, top + 0.1), m['siren_red']))
        parts.append(box_obj('siren_blue', (0.5, 0.2, 0.14), (0.3, c0 + 0.5, top + 0.1), m['siren_blue']))
        for sx in (-1, 1):
            parts.append(box_obj('siren_red' if sx < 0 else 'siren_blue', (0.18, 0.18, 0.14), (sx * (hw - 0.15), y1 - 0.15, zt2 + 0.07), m['siren_red'] if sx < 0 else m['siren_blue']))
    if kind == 'van':
        # Van: the back is a closed box, not glass.
        box = box_obj('cargo', (W * 0.95, (c1 + 0.2) - (c0 + 1.1), top - zt + 0.05), (0, (c1 + 0.2 + c0 + 1.1) / 2, (top + zt) / 2), m['paint'])
        bevel(box, 0.06, 2)
        parts.append(box)

    if kind == 'suv':
        # Roof rails and a spare wheel on the back.
        for sx in (-1, 1):
            parts.append(box_obj('rail', (0.06, (c1 - 0.17) - (c0 + 0.27) - 0.2, 0.06), (sx * hw * 0.7, (c0 + c1 + 0.1) / 2, top + 0.11), m['trim']))
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.36, depth=0.22, location=(0, hl + 0.12, zt - 0.15), rotation=(math.radians(90), 0, 0))
        spare = bpy.context.active_object
        assign(spare, m['tire'])
        parts.append(spare)
    if kind == 'pickup':
        # Open bed behind the cab: side walls, tailgate and a dark floor.
        y0, y1 = c1 + slope * 0.6 + 0.12, hl - 0.04
        bh = 0.42
        for sx in (-1, 1):
            parts.append(box_obj('bedwall', (0.08, y1 - y0, bh), (sx * (hw * 0.98 - 0.04), (y0 + y1) / 2, zt + bh / 2 - 0.02), m['paint']))
        parts.append(box_obj('bedfront', (W * 0.96, 0.08, bh), (0, y0 + 0.04, zt + bh / 2 - 0.02), m['paint']))
        parts.append(box_obj('tailgate', (W * 0.96, 0.08, bh), (0, y1 - 0.04, zt + bh / 2 - 0.02), m['paint']))
        parts.append(box_obj('bedfloor', (W * 0.86, y1 - y0 - 0.12, 0.03), (0, (y0 + y1) / 2, zt + 0.01), m['trim']))
    if kind in ('suv', 'pickup'):
        # Chunky black wheel arches and a bull bar look.
        for sx in (-1, 1):
            for wy in (-L * 0.32, L * 0.32):
                parts.append(box_obj('arch', (0.08, r * 2.6, 0.14), (sx * (hw + 0.02), wy, zb + r * 2 + 0.02), m['trim']))

    # Bumpers, lights, mirrors.
    parts.append(box_obj('bumperF', (W * 0.96, 0.16, 0.2), (0, -hl - 0.02, zb + 0.18), m['trim']))
    parts.append(box_obj('bumperR', (W * 0.96, 0.16, 0.2), (0, hl + 0.02, zb + 0.18), m['trim']))
    for sx in (-1, 1):
        parts.append(box_obj('headlight', (0.38, 0.06, 0.12), (sx * hw * 0.68, -hl + 0.02, zt - 0.3), m['headlight']))
        parts.append(box_obj('taillight', (0.34, 0.06, 0.12), (sx * hw * 0.7, hl + 0.0, zt - 0.26), m['taillight']))
        parts.append(box_obj('mirror', (0.18, 0.08, 0.1), (sx * (hw + 0.08), c0 - slope * 0.4, zt + 0.12), m['trim']))
    parts.append(box_obj('grille', (W * 0.4, 0.05, 0.16), (0, -hl - 0.0, zt - 0.32), m['trim']))

    if kind == 'taxi':
        parts.append(box_obj('sign', (0.6, 0.25, 0.2), (0, (c0 + c1) / 2, top + 0.15), m['sign']))
    if kind == 'police':
        parts.append(box_obj('siren_bar', (1.1, 0.26, 0.08), (0, (c0 + c1) / 2, top + 0.09), m['trim']))
        parts.append(box_obj('siren_red', (0.48, 0.22, 0.14), (-0.28, (c0 + c1) / 2, top + 0.18), m['siren_red']))
        parts.append(box_obj('siren_blue', (0.48, 0.22, 0.14), (0.28, (c0 + c1) / 2, top + 0.18), m['siren_blue']))

    body = joined(parts, 'body')
    wb = L * 0.32
    wheels = [
        wheel('wheel_fl', hw - 0.12, -wb, r, 0.24, m),
        wheel('wheel_fr', -hw + 0.12, -wb, r, 0.24, m),
        wheel('wheel_rl', hw - 0.12, wb, r, 0.24, m),
        wheel('wheel_rr', -hw + 0.12, wb, r, 0.24, m),
    ]
    root = bpy.data.objects.new(kind, None)
    bpy.context.collection.objects.link(root)
    for o in [body, *wheels]:
        o.parent = root
    export(os.path.join(OUT, f'car_{kind}.glb'), [root, body, *wheels])


def cut_arches(obj, ys, r, width):
    """Cut round wheel arches through a body (boolean difference)."""
    for y in ys:
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=width, location=(0, y, r * 0.9), rotation=(0, math.radians(90), 0))
        c = bpy.context.active_object
        mod = obj.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier='arch')
        bpy.data.objects.remove(c, do_unlink=True)


def build_bus():
    reset()
    m = car_materials()
    parts = []
    L, W, ride, r = 11.6, 2.5, 0.32, 0.5
    hl, hw = L / 2, W / 2
    fy, ry = -hl + 2.5, hl - 3.0  # axles (front is -Y)
    z0 = ride
    z1 = ride + 1.05  # top of the painted skirt
    z2 = ride + 2.5  # top of the window band
    z3 = ride + 2.95  # roof
    lower = box_obj('lower', (W, L, z1 - z0), (0, 0, (z0 + z1) / 2), m['paint'])
    cut_arches(lower, (fy, ry), r + 0.1, W + 0.4)
    bevel(lower, 0.08, 2)
    parts.append(lower)
    band = box_obj('windows', (W * 0.985, L * 0.995, z2 - z1), (0, 0, (z1 + z2) / 2), m['glass'])
    bevel(band, 0.05, 2)
    parts.append(band)
    roof = box_obj('roof', (W, L, z3 - z2), (0, 0, (z2 + z3) / 2), m['white'])
    bevel(roof, 0.14, 3)
    parts.append(roof)
    # Window pillars along both sides.
    n = 8
    for i in range(n + 1):
        y = -hl + 0.9 + i * (L - 1.5) / n
        for sx in (-1, 1):
            parts.append(box_obj('pillar', (0.03, 0.14, z2 - z1), (sx * (hw - 0.0), y, (z1 + z2) / 2), m['white']))
    # Doors on the right side (-X): front and middle.
    for dy in (-hl + 1.05, 0.6):
        parts.append(box_obj('door', (0.03, 1.15, z2 - z0 - 0.25), (-hw - 0.005, dy, (z0 + 0.15 + z2 - 0.1) / 2), m['glass']))
        parts.append(box_obj('doorline', (0.035, 0.04, z2 - z0 - 0.25), (-hw - 0.006, dy, (z0 + 0.15 + z2 - 0.1) / 2), m['trim']))
    # Big front window, destination sign, mirrors.
    parts.append(box_obj('windscreen', (W * 0.9, 0.03, z2 - z1 + 0.35), (0, -hl - 0.005, (z1 - 0.35 + z2) / 2), m['glass']))
    parts.append(box_obj('sign', (W * 0.7, 0.03, 0.26), (0, -hl - 0.01, z2 + 0.2), m['sign']))
    parts.append(box_obj('sign', (W * 0.5, 0.03, 0.22), (0, hl + 0.01, z2 + 0.18), m['sign']))
    for sx in (-1, 1):
        parts.append(box_obj('mirror', (0.08, 0.1, 0.3), (sx * (hw + 0.25), -hl - 0.15, z2 - 0.3), m['trim']))
        parts.append(box_obj('mirrorarm', (0.3, 0.05, 0.05), (sx * (hw + 0.12), -hl - 0.1, z2 - 0.1), m['trim']))
        parts.append(box_obj('headlight', (0.4, 0.06, 0.16), (sx * hw * 0.7, -hl - 0.01, z0 + 0.55), m['headlight']))
        parts.append(box_obj('taillight', (0.2, 0.06, 0.45), (sx * hw * 0.85, hl + 0.01, z0 + 0.75), m['taillight']))
    parts.append(box_obj('bumperF', (W * 1.0, 0.18, 0.28), (0, -hl - 0.04, z0 + 0.2), m['trim']))
    parts.append(box_obj('bumperR', (W * 1.0, 0.18, 0.28), (0, hl + 0.04, z0 + 0.2), m['trim']))
    parts.append(box_obj('grille', (W * 0.5, 0.04, 0.3), (0, hl + 0.01, z1 - 0.3), m['trim']))
    body = joined(parts, 'body')
    wheels = [
        wheel('wheel_fl', hw - 0.2, fy, r, 0.32, m),
        wheel('wheel_fr', -hw + 0.2, fy, r, 0.32, m),
        wheel('wheel_rl', hw - 0.2, ry, r, 0.32, m),
        wheel('wheel_rr', -hw + 0.2, ry, r, 0.32, m),
    ]
    root = bpy.data.objects.new('bus', None)
    bpy.context.collection.objects.link(root)
    for o in [body, *wheels]:
        o.parent = root
    export(os.path.join(OUT, 'car_bus.glb'), [root, body, *wheels])


def moped_wheel(name, y, r, w, mats):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=w, location=(0, y, r), rotation=(0, math.radians(90), 0))
    tire = bpy.context.active_object
    assign(tire, mats['tire'])
    bevel(tire, 0.035, 2)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r * 0.6, depth=w + 0.02, location=(0, y, r), rotation=(0, math.radians(90), 0))
    rim = bpy.context.active_object
    assign(rim, mats['rim'])
    o = joined([tire, rim], name)
    bpy.context.scene.cursor.location = (0, y, r)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return o


def build_moped():
    """A step-through scooter. Faces -Y like the cars; the rider sits at y≈+0.3."""
    reset()
    m = car_materials()
    parts = []
    r, fy, ry = 0.24, -0.66, 0.6
    # Rear body over the back wheel.
    rear = hull(
        [(sx * 0.2, y, z) for sx in (-1, 1) for y in (0.02, 0.62) for z in (0.34, 0.74)]
        + [(sx * 0.13, 0.92, z) for sx in (-1, 1) for z in (0.5, 0.7)]
        + [(sx * 0.12, -0.05, 0.3) for sx in (-1, 1)],
        'rear',
    )
    assign(rear, m['paint'])
    bevel(rear, 0.07, 3)
    parts.append(rear)
    # Seat.
    seat = box_obj('seat', (0.32, 0.66, 0.1), (0, 0.36, 0.8), m['trim'])
    bevel(seat, 0.045, 3)
    parts.append(seat)
    # Floorboard and the tunnel under it.
    floor = box_obj('floor', (0.34, 0.6, 0.07), (0, -0.16, 0.31), m['trim'])
    bevel(floor, 0.02, 2)
    parts.append(floor)
    tunnel = hull([(sx * 0.15, y, z) for sx in (-1, 1) for y in (-0.42, 0.1) for z in (0.2, 0.28)], 'tunnel')
    assign(tunnel, m['paint'])
    parts.append(tunnel)
    # Leg shield in front of the knees.
    shield = hull(
        [(sx * 0.22, y, 0.28) for sx in (-1, 1) for y in (-0.44, -0.52)]
        + [(sx * 0.13, y, 1.0) for sx in (-1, 1) for y in (-0.52, -0.6)],
        'shield',
    )
    assign(shield, m['paint'])
    bevel(shield, 0.04, 2)
    parts.append(shield)
    # Steering column, front fender, handlebar with a headlight cowl.
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.03, depth=0.86, location=(0, fy + 0.04, 0.66), rotation=(math.radians(-14), 0, 0))
    col = bpy.context.active_object
    assign(col, m['rim'])
    parts.append(col)
    fender = hull(
        [(sx * 0.09, y, z) for sx in (-1, 1) for y, z in ((fy - 0.2, 0.42), (fy, 0.53), (fy + 0.2, 0.44))]
        + [(sx * 0.09, y, z - 0.04) for sx in (-1, 1) for y, z in ((fy - 0.2, 0.42), (fy, 0.53), (fy + 0.2, 0.44))],
        'fender',
    )
    assign(fender, m['paint'])
    parts.append(fender)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.022, depth=0.66, location=(0, -0.54, 1.08), rotation=(0, math.radians(90), 0))
    bar = bpy.context.active_object
    assign(bar, m['trim'])
    parts.append(bar)
    cowl = box_obj('cowl', (0.26, 0.16, 0.15), (0, -0.6, 1.06), m['paint'])
    bevel(cowl, 0.05, 3)
    parts.append(cowl)
    parts.append(box_obj('headlight', (0.13, 0.04, 0.09), (0, -0.685, 1.06), m['headlight']))
    parts.append(box_obj('taillight', (0.14, 0.04, 0.06), (0, 0.93, 0.62), m['taillight']))
    for sx in (-1, 1):
        parts.append(box_obj('grip', (0.1, 0.045, 0.045), (sx * 0.31, -0.54, 1.08), m['tire']))
        parts.append(box_obj('mirrorarm', (0.02, 0.02, 0.18), (sx * 0.24, -0.56, 1.18), m['rim']))
        parts.append(box_obj('mirror', (0.1, 0.03, 0.07), (sx * 0.25, -0.56, 1.29), m['trim']))
    # Exhaust on the right.
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.045, depth=0.42, location=(-0.17, 0.62, 0.26), rotation=(math.radians(90), 0, 0))
    ex = bpy.context.active_object
    assign(ex, m['rim'])
    parts.append(ex)
    body = joined(parts, 'body')
    wheels = [moped_wheel('wheel_f', fy, r, 0.11, m), moped_wheel('wheel_r', ry, r, 0.12, m)]
    root = bpy.data.objects.new('moped', None)
    bpy.context.collection.objects.link(root)
    for o in [body, *wheels]:
        o.parent = root
    export(os.path.join(OUT, 'car_moped.glb'), [root, body, *wheels])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    build_character()
    for kind in ('sedan', 'taxi', 'police', 'van', 'sports', 'ambulance', 'suv', 'pickup', 'mini'):
        build_car(kind)
    build_bus()
    build_moped()
    print('Models written to', os.path.abspath(OUT))
