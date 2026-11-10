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
 EYEWHITE, NOSE, EARS, SOLE, BROWS, MOUTH) = range(20)
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

    # Head: a separate smooth egg, slightly larger at the back.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=18, radius=0.118, location=(0, 0.008, 1.7))
    head = bpy.context.active_object
    head.scale = (0.95, 1.0, 1.12)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()

    def head_region(v):
        # Eye band in front (ninja mask opening).
        if v.y < -0.05 and 1.66 < v.z < 1.745:
            return FACE
        if v.z < 1.6:
            return NECK
        return HEAD

    set_region_uv(head, head_region)

    # Face: eyes (white + pupil), brows, nose, ears and mouth.
    def blob(loc, radius, scale, region, segments=14, rings=9):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=loc)
        o = bpy.context.active_object
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.shade_smooth()
        set_region_uv(o, lambda v: region)
        return o

    eyes = []
    for sx in (-1, 1):
        eyes.append(blob((sx * 0.042, -0.097, 1.706), 0.022, (1.0, 0.5, 0.78), EYEWHITE))
        eyes.append(blob((sx * 0.042, -0.106, 1.705), 0.0115, (1.0, 0.5, 1.0), EYES, 10, 7))
        eyes.append(blob((sx * 0.044, -0.104, 1.737), 0.022, (1.05, 0.28, 0.22), BROWS, 10, 6))
        eyes.append(blob((sx * 0.112, 0.008, 1.69), 0.03, (0.35, 0.75, 1.15), EARS, 12, 8))
    eyes.append(blob((0, -0.113, 1.674), 0.015, (0.8, 0.9, 1.3), NOSE, 12, 8))
    eyes.append(blob((0, -0.101, 1.632), 0.018, (1.2, 0.25, 0.14), MOUTH, 10, 6))

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
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=0.127, location=(0, 0.012, 1.722))
        o = bpy.context.active_object
        o.scale = (0.97, 1.02, 1.0)
        bpy.ops.object.transform_apply(scale=True)
        # Cut away the face side.
        bm = bmesh.new()
        bm.from_mesh(o.data)
        # Keep the face free: cut away everything in front below the forehead.
        # (Coordinates relative to the sphere centre, wherever Blender put the vertices.)
        c = Vector((0, 0.012, 1.722)) - o.location
        cut = [v for v in bm.verts if ((v.co.z - c.z) < 0.045 and (v.co.y - c.y) < -0.03) or ((v.co.z - c.z) < -0.01 and (v.co.y - c.y) < 0.03) or (v.co.z - c.z) < -0.045]
        bmesh.ops.delete(bm, geom=cut, context='VERTS')
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
    }[kind]
    L, W, ride, r = spec['L'], spec['W'], spec['ride'], spec['r']
    hl = L / 2
    hw = W / 2
    zb = ride
    zt = ride + spec['body']
    # Lower body: a hull with a sloped nose and tail (front is -Y).
    nose = 0.25 if kind != 'van' else 0.08
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
    assign(lower, m['white'] if kind == 'police' else m['paint'])
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
    slope = 0.45 if kind != 'van' else 0.15
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
    assign(roof, m['white'] if kind == 'police' else m['paint'])
    bevel(roof, 0.03, 2)
    parts.append(roof)
    if kind == 'van':
        # Van: the back is a closed box, not glass.
        box = box_obj('cargo', (W * 0.95, (c1 + 0.2) - (c0 + 1.1), top - zt + 0.05), (0, (c1 + 0.2 + c0 + 1.1) / 2, (top + zt) / 2), m['paint'])
        bevel(box, 0.06, 2)
        parts.append(box)

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


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    build_character()
    for kind in ('sedan', 'taxi', 'police', 'van', 'sports'):
        build_car(kind)
    print('Models written to', os.path.abspath(OUT))
