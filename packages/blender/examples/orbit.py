"""A two-second product-style shot with keyframes and a reusable Geometry Nodes asset.
The worker sets frame range/render settings and saves scene.blend. No network/add-ons.
"""
import math
import bpy
from mathutils import Vector

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.world = bpy.data.worlds.new("Studio World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.10, 0.15, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4
scene.view_settings.view_transform = "AgX"

material = bpy.data.materials.new("Copper")
material.diffuse_color = (0.55, 0.16, 0.05, 1)
material.use_nodes = True
bsdf = material.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = material.diffuse_color
bsdf.inputs["Metallic"].default_value = 0.75
bsdf.inputs["Roughness"].default_value = 0.27
material.asset_mark()
material.asset_data.description = "Warm copper for product shots"

bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.28, location=(0, 0, 1.3))
hero = bpy.context.object
hero.name = "Hero"
hero.data.materials.append(material)
for polygon in hero.data.polygons:
    polygon.use_smooth = True
hero.rotation_euler = (0.25, 0, 0)
hero.keyframe_insert(data_path="rotation_euler", frame=1)
hero.rotation_euler = (0.25 + math.tau, 0, math.tau)
hero.keyframe_insert(data_path="rotation_euler", frame=49)
# Inclusive frames 1–48: do not duplicate frame 49 at the loop seam.
# Blender 5 removes Action.fcurves. Traverse the animated object's slot for
# layered actions (4.4+); retain legacy actions for 4.2/4.3 compatibility.
action = hero.animation_data.action
if bpy.app.version >= (4, 4, 0):
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            bag = strip.channelbag(hero.animation_data.action_slot)
            if bag:
                curves.extend(bag.fcurves)
else:
    curves = action.fcurves
for curve in curves:
    for key in curve.keyframe_points:
        key.interpolation = "LINEAR"

# An actual node graph, not a destructive mesh bake: a ring of small spheres.
bpy.ops.mesh.primitive_plane_add()
ring = bpy.context.object
ring.name = "Procedural Ring"
group = bpy.data.node_groups.new("Accent Ring", "GeometryNodeTree")
group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
group.asset_mark()
group.asset_data.description = "Procedural accent ring; edit radius/count in Geometry Nodes"
nodes, links = group.nodes, group.links
output = nodes.new("NodeGroupOutput")
circle = nodes.new("GeometryNodeCurvePrimitiveCircle")
circle.inputs["Resolution"].default_value = 16
circle.inputs["Radius"].default_value = 2.1
sphere = nodes.new("GeometryNodeMeshIcoSphere")
sphere.inputs["Radius"].default_value = 0.08
sphere.inputs["Subdivisions"].default_value = 2
instances = nodes.new("GeometryNodeInstanceOnPoints")
links.new(circle.outputs["Curve"], instances.inputs["Points"])
links.new(sphere.outputs["Mesh"], instances.inputs["Instance"])
links.new(instances.outputs["Instances"], output.inputs["Geometry"])
ring.modifiers.new("Accent Ring", "NODES").node_group = group

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.3))
floor = bpy.context.object
floor.name = "Floor"
mat = bpy.data.materials.new("Floor matte")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.04, 0.06, 0.1, 1)
floor.data.materials.append(mat)

for name, pos, power, size in [
    ("Key", (3, -4, 6), 1500, 5), ("Rim", (-4, 2, 4), 1800, 3),
]:
    light = bpy.data.lights.new(name, "AREA")
    light.energy, light.shape, light.size = power, "DISK", size
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat("-Z", "Y").to_euler()

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (5, -7, 4)
camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 50
