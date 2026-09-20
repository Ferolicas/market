class_name MarketViewportComposite
extends RefCounted
## Match a browser's premultiplied sRGB canvas in both Godot renderers.
static func create() -> Material:
	if RenderingServer.get_current_rendering_method() == "gl_compatibility":
		var material := CanvasItemMaterial.new()
		material.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
		return material
	var material := ShaderMaterial.new()
	material.shader = preload("res://game/ui/viewport_composite.gdshader")
	return material
