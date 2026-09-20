class_name MarketWorldText
extends RefCounted
## Same bundled face as MarketText.tsx, with distance fields for projected 3D text.
static var _font: FontFile
static func font() -> FontFile:
	if _font == null:
		_font = load("res://assets/fonts/OpenSans-SemiBold.ttf").duplicate()
		_font.multichannel_signed_distance_field = true
		_font.msdf_size = 64
		_font.msdf_pixel_range = 8
		_font.generate_mipmaps = true
	return _font
