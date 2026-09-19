class_name CampaignTasks
extends RefCounted
## Port of src/game/progression/CampaignTasks.ts.

## Original balance: personal work, not employee totals, unlocks expansion.
const CAMPAIGN_TASKS := {
	"player:harvest:tomatoes": { "label": "Cosecha tú 8 tomates", "target": 8 },
	"player:stock:tomatoes": { "label": "Repón tú 8 tomates", "target": 8 },
	"player:feed:chicken": { "label": "Alimenta tú las gallinas con 4 tomates", "target": 4 },
	"player:stock:eggs": { "label": "Repón tú 4 huevos", "target": 4 },
	"player:harvest:wheat": { "label": "Cosecha tú 6 trigos", "target": 6 },
	"player:collect:flour": { "label": "Recoge tú 3 harinas del molino", "target": 3 },
	"player:stock:bread": { "label": "Repón tú 4 panes", "target": 4 },
	"player:feed:cow": { "label": "Alimenta tú la vaca con 2 trigos", "target": 2 },
	"player:stock:milk": { "label": "Repón tú 4 leches", "target": 4 },
	"player:stock:cheese": { "label": "Repón tú 4 quesos", "target": 4 },
	"player:harvest:apples": { "label": "Cosecha tú 4 manzanas", "target": 4 },
	"player:stock:corn": { "label": "Repón tú 4 maíces", "target": 4 },
	"player:harvest:coffee": { "label": "Cosecha tú 4 cafés", "target": 4 },
	"player:stock:coffee": { "label": "Repón tú 4 cafés", "target": 4 },
	"player:harvest:oranges": { "label": "Cosecha tú 4 naranjas", "target": 4 },
	"player:stock:juice": { "label": "Repón tú 4 zumos", "target": 4 },
	"player:stock:cannedCorn": { "label": "Repón tú 4 conservas de maíz", "target": 4 },
	"player:collect:cannedCorn": { "label": "Recoge tú 3 conservas de la enlatadora", "target": 3 },
}
static var CAMPAIGN_TASK_IDS: Array = CAMPAIGN_TASKS.keys()
## CampaignTaskProgress: Dictionary<CampaignTaskId, int> (partial)

const PURCHASE_TASK_REQUIREMENTS := {
	"expansion-1": ["player:harvest:tomatoes", "player:stock:tomatoes", "player:feed:chicken", "player:stock:eggs"],
	"flour-mill-1": ["player:harvest:wheat"],
	"bread-oven-1": ["player:collect:flour"],
	"dairy-display-1": ["player:stock:bread"],
	"cheese-maker-1": ["player:feed:cow", "player:stock:milk"],
	"orange-1": ["player:harvest:apples"],
	"juice-machine-1": ["player:harvest:oranges"],
}

static var _digits := _compile_digits()

static func _compile_digits() -> RegEx:
	var re := RegEx.new()
	re.compile("\\d+")
	return re

static func _progress_dict(progress: Variant) -> Dictionary:
	return progress if progress is Dictionary else {}

static func campaign_task_target(id: String, location_id: Variant = "barrio") -> int:
	var profile := CampaignLocations.campaign_location(location_id if location_id is String else "barrio")
	var product: String
	if id == "player:feed:chicken": product = "eggs"
	elif id == "player:feed:cow": product = "milk"
	else: product = JS.at(id.split(":"), -1)
	return CAMPAIGN_TASKS[id]["target"] * (profile["focusMultiplier"] if profile["focus"].has(product) else profile["masteryMultiplier"])

static func campaign_task_status(id: String, progress: Variant = {}, location_id: Variant = "barrio") -> Dictionary:
	var task: Dictionary = CAMPAIGN_TASKS[id]
	var target := campaign_task_target(id, location_id)
	var label: String = _digits.sub(task["label"], str(target))
	var count: int = mini(target, maxi(0, JS.get_or(_progress_dict(progress), id, 0)))
	return { "id": id, "label": label, "target": target, "progress": count, "completed": count >= target, "unit": "count" }

static func purchase_tasks(id: String, progress: Variant = {}) -> Array:
	return JS.map(JS.get_or(PURCHASE_TASK_REQUIREMENTS, id, []), func(task): return campaign_task_status(task, progress))

## Capped deltas bound save/event volume; repeats after mastery add nothing.
static func add_campaign_task_progress(progress: Variant, deltas: Dictionary, location_id: Variant = "barrio") -> Dictionary:
	var base := _progress_dict(progress)
	var result := base.duplicate()
	for id in CAMPAIGN_TASK_IDS:
		var delta = JS.get_or(deltas, id, 0)
		if JS.is_safe_integer(delta) and delta > 0: result[id] = mini(campaign_task_target(id, location_id), JS.get_or(base, id, 0) + int(delta))
	return result
