extends TestCase
const Widgets = preload("res://game/ui/widgets.gd")
var root: Control

func before_each() -> void:
	root = Control.new()
	Engine.get_main_loop().root.add_child(root)

func after_each() -> void:
	root.free()

## PanelContainer defaults to MOUSE_FILTER_STOP; a card built inside a panel's
## ScrollContainer used to swallow every touch-drag/wheel gesture that
## started on its own background, before it ever reached the
## ScrollContainer — scroll looked "locked" on stock/team/map/finance.
func test_card_passes_scroll_through_when_inside_a_scroll_container() -> void:
	var scroll := ScrollContainer.new()
	root.add_child(scroll)
	var content := Widgets.card(scroll)
	var panel: PanelContainer = content.get_parent()
	assert_eq(panel.mouse_filter, Control.MOUSE_FILTER_PASS)

func test_card_keeps_the_default_filter_outside_a_scroll_container() -> void:
	var content := Widgets.card(root)
	var panel: PanelContainer = content.get_parent()
	assert_eq(panel.mouse_filter, Control.MOUSE_FILTER_STOP)
