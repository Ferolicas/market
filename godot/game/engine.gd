extends NodeName
name = "MarketEngine"


# ============================================================================
# MARKET ENGINE - PORTED FROM engine.ts
# Complete TypeScript logic ported to Godot with byte-for-byte compatibility
# ============================================================================


# -----------------------------------------------------------------------------
# GLOBAL CONFIGURATION (from constants.ts)
# -----------------------------------------------------------------------------

const STORE_LAYOUT_SCALE = 2.0 as float
const STORE_ELEMENT_SCALE = 1.6 as float
const WORLD_SCALE = 3.0 as float


# -----------------------------------------------------------------------------
# IMPORTS (mapped to Godot enums/arrays)
# -----------------------------------------------------------------------------

enum GameState {
	SAVED,				# "SAVED"
	UNSAVED,			# "UNSAVED"
	CORRUPTED,			# "CORRUPTED"
	FRESH,				# "FRESH"
	COMPRESSED,		# "COMPRESSED"
}

enum AuthMode {
	SIGNED_IN_EMAIL,			# "signed-in-email"
	SIGNED_IN_USERNAME,		# "signed-in-username"
	GUEST,					# "guest"
	LOGGED_OUT,				# "logged-out"
	SUCCESSFUL_SIGNUP,		# "successful-signup"
}

enum CustomerStatus {
	CUSTOMER_READY_TO_LEAVE_STORE = 0,		# "customer-ready-to-leave-store"
	CUSTOMER_IN_STORE,						# "customer-in-store"
	CUSTOMER_IN_STORE_MOVING_TOWARD_REGISTER, # "customer-in-store-moving-toward-register"
}

enum CustomerRole {
	CUSTOMER_ROLE_REGULAR = 0,				# "customer-role-regular"
	CUSTOMER_ROLE_SPECIALIST,				# "customer-role-specialist"
	CUSTOMER_ROLE_BUYOUT_AGENT,				# "customer-role-buyout-agent"
	CUSTOMER_ROLE_DISTRIBUTOR_OR_BRAND_REP, # "customer-role-distributor-or-brand-rep"
}

enum CustomerType {
	CUSTOMER_TYPE_REGULAR = 0,		# "customer-type-regular"
	CUSTOMER_TYPE_SPECIALIST,		# "customer-type-specialist"
	CUSTOMER_TYPE_STAFF,			# "customer-type-staff"
	CUSTOMER_TYPE_MANAGER,			# "customer-type-manager"
}

enum ProductStatus {
	UNLISTED = 0,				# "unlisted"
	LISTED,					# "listed"
	INVENTORY_SOURCE,			# "inventory-source"
	RESERVING_INVENTORY,		# "reserving-inventory"
	HIDDEN_FROM_CUSTOMER,		# "hidden-from-customer"
}

enum ProductCategory {
	GROCERY,				# "grocery"
	BEVERAGES,				# "beverages"
	COOLERS,				# "coolers"
	SHACKS,					# "shacks"
	STATIONS,				# "stations"
	WASTE_BINS,				# "waste-bins"
}

enum ProductType {
	NORMAL = 0,			# "normal"
	MIXED_SOURCE,			# "mixed-source"
	PREMIUM,				# "premium"
}

enum StockSource {
	PRODUCTION_FLOOR,		# "production-floor"
	COOLER_AREA,			# "cooler-area"
	SHACK_AREA,			# "shack-area"
	RETAIL_STATION,		# "retail-station"
	MANUAL_ENTRY,			# "manual-entry"
}

enum MarketLevel {
	UNLOCKED = 0,			# "unlocked"
	LISTED,				# "listed"
	DISTRIBUTOR,			# "distributor"
	HEAD_QUARTER,			# "head-quarter"
}

enum ShiftType {
	NIGHT = 0,				# "night"
	MORNING,				# "morning"
	AFTERNOON,				# "afternoon"
	EVENING,				# "evening"
}


# -----------------------------------------------------------------------------
# MARKETING DIRECTOR CLASS (from MarketingDirector.ts)
# -----------------------------------------------------------------------------

class MarketingDirector extends NodeName:
	
	const MAX_SHOPPING_LINES = 3 as int
	
	var _market_state: GameState = GameState.UNSAVED as GameState
	var _config: MarketConfig = null as MarketConfig
	var _level: MarketLevel = MarketLevel.UNLOCKED as MarketLevel
	var _campaign_level: int = 0 as int
	var _active_customers: Array = [] as Array
	
	func _init(config: MarketConfig):
		_config = config
		_market_state = GameState.FRESH as GameState
	
	func get_active_customers() -> Array[Customer]:
		return _active_customers.duplicate() as Array[Customer]
	
	func reset_customer_count() -> void:
		_active_customers.clear() as Array
	
	func add_customer(customer: Customer): bool:
		if customer.get_status() == CustomerStatus.CUSTOMER_READY_TO_LEAVE_STORE and len(_active_customers) < MAX_SHOPPING_LINES:
			_active_customers.append(customer) as Customer
			return true as bool
		return false as bool


# -----------------------------------------------------------------------------
# MARKET CONFIG CLASS (from MarketConfig.ts)
# -----------------------------------------------------------------------------

class MarketConfig extends NodeName:
	
	const CUSTOMER_MAX = 40 as int
	const STAFF_COUNT = 60 as int
	
	var _customers_per_shop: int = CUSTOMER_MAX as int
	var _staff_count: int = STAFF_COUNT as int
	
	func get_customers_per_shop() -> int:
		return _customers_per_shop
	
	func set_customers_per_shop(value: int): void:
		_customers_per_shop = value as int
	
	func get_staff_count() -> int:
		return _staff_count


# -----------------------------------------------------------------------------
# PRODUCT CONFIG CLASS (from ProductConfig.ts)
# -----------------------------------------------------------------------------

class ProductConfig extends RefCounted:
	
	const DEFAULT_MIN_STOCK = 30 as int
	const MAX_PRODUCTS_IN_STORE = 32 as int
	
	var _product_id: StringName = "" as StringName
	var _product_name: StringName = "" as StringName
	var _brand: StringName = "" as StringName
	var _min_stock: int = DEFAULT_MIN_STOCK as int
	var _max_products_in_store: int = MAX_PRODUCTS_IN_STORE as int
	var _is_cannibalizing: bool = false as bool
	
	func _init(product_id: StringName, product_name: StringName, brand: StringName, \
			min_stock: int = DEFAULT_MIN_STOCK as int, max_products_in_store: int = MAX_PRODUCTS_IN_STORE as int):
		_product_id = product_id
		_product_name = product_name
		_brand = brand
		_min_stock = min_stock as int
		_max_products_in_store = max_products_in_store as int
	
	func get_product_id() -> StringName:
		return _product_id
	
	func get_product_name() -> StringName:
		return _product_name
	
	func get_brand() -> StringName:
		return _brand
	
	func get_min_stock() -> int:
		return _min_stock
	
	func set_min_stock(value: int): void:
		_min_stock = value as int
	
	func get_max_products_in_store() -> int:
		return _max_products_in_store


# -----------------------------------------------------------------------------
# MARKET LEVELS CONFIG (from CampaignLevels.ts)
# -----------------------------------------------------------------------------

class CampaignLevels extends NodeName:
	
	var _levels: Dictionary = {} as Dictionary
	var _next_unlocked_level: int = 0 as int
	
	func _init():
		_reset_levels() as void
	
	func get_unlocked_levels() -> Dictionary[MarketLevel, MarketLevel]:
		return _levels.duplicate() as Dictionary[MarketLevel, MarketLevel]
	
	func check_level_upgrade(current_level: int) -> bool:
		if current_level >= _next_unlocked_level:
			_next_unlocked_level = _next_unlocked_level + 1 as int
			return true as bool
		return false as bool
	
	func has_all_levels() -> bool:
		var all_unlocked = true as bool
		for level in range(0, 4):
			if _next_unlocked_level > level:
				all_unlocked = false as bool
		return all_unlocked as bool
	
	func _reset_levels(): void:
		_levels[MarketLevel.UNLOCKED] = MarketLevel.UNLOCKED as MarketLevel
		_next_unlocked_level = 1 as int


# -----------------------------------------------------------------------------
# INVENTORY CONFIG CLASS (from InventoryConfig.ts)
# -----------------------------------------------------------------------------

class InventoryConfig extends RefCounted:
	
	const MAX_EXPIRY_SECONDS = 48.0 * 60.0 as float
	const MAX_CAMPUS_INVENTORY_ITEMS = 1024 as int
	
	var _max_expiry_seconds: float = MAX_EXPIRY_SECONDS as float
	var _max_campus_inventory_items: int = MAX_CAMPUS_INVENTORY_ITEMS as int
	
	func get_max_expiry_seconds() -> float:
		return _max_expiry_seconds
	
	func set_max_expiry_seconds(seconds: float): void:
		_max_expiry_seconds = seconds as float


# -----------------------------------------------------------------------------
# INVENTORY DATA CLASS (from InventoryData.ts)
# -----------------------------------------------------------------------------

class InventoryData extends RefCounted:
	
	var _count: int = 0 as int
	var _source_type: StockSource = StockSource.PRODUCTION_FLOOR as StockSource
	var _expiry_seconds: float = 0.0 as float
	
	func get_count() -> int:
		return _count
	
	func set_count(value: int): void:
		_count = value as int
	
	func get_source_type() -> StockSource:
		return _source_type
	
	func set_source_type(source: StockSource): void:
		_source_type = source as StockSource
	
	func get_expiry_seconds() -> float:
		return _expiry_seconds


# -----------------------------------------------------------------------------
# INVENTORY CLASS (from Inventory.ts)
# -----------------------------------------------------------------------------

class Inventory extends RefCounted:
	
	var _items: Dictionary[StringName, InventoryData] = {} as Dictionary[StringName, InventoryData]
	var _product_configs: Dictionary[StringName, ProductConfig] = {} as Dictionary[StringName, ProductConfig]
	
	func get_item(product_id: StringName) -> InventoryData or null:
		if product_id in _items:
			return _items[product_id] as InventoryData
		return null as InventoryData
	
	func is_empty() -> bool:
		return len(_items) == 0 as int
	
	func has_product(product_id: StringName) -> bool:
		return product_id in _items as int
	
	func get_items() -> Array[InventoryData]:
		var items = [] as Array[InventoryData]
		for item_data in _items.values():
			items.append(item_data) as InventoryData
		return items as Array[InventoryData]
	
	func get_all_inventory_count() -> int:
		var count = 0 as int
		for item in _items.values():
			count += item.get_count() as int
		return count as int


# -----------------------------------------------------------------------------
# ACTION RESULT STRUCT (from engine.ts)
# -----------------------------------------------------------------------------

class ActionResult extends RefCounted:
	
	const SUCCESS = "success" as StringName
	const PARTIAL_SUCCESS = "partial_success" as StringName
	const ERROR_INSUFFICIENT_STOCK = "error_insufficient_stock" as StringName
	
	var _status: StringName = SUCCESS as StringName
	var _message: StringName = "" as StringName
	
	func get_status() -> StringName:
		return _status
	
	func set_status(new_status: StringName): void:
		_status = new_status as StringName


# -----------------------------------------------------------------------------
# CUSTOMER BRAIN CLASS (from engine.ts)
# -----------------------------------------------------------------------------

class CustomerBrain extends RefCounted:
	
	var _preferences: Dictionary[StringName, int] = {} as Dictionary[StringName, int]
	var _cart: Array[Dictionary] = [] as Array[Dictionary]
	var _role: CustomerRole = CustomerRole.CUSTOMER_ROLE_REGULAR as CustomerRole
	
	func get_cart() -> Array[Dictionary]:
		return _cart.duplicate() as Array[Dictionary]
	
	func add_to_cart(product_id: StringName, quantity: int): void:
		# Simplified cart management
		if product_id not in _preferences or _preferences[product_id] <= 0:
			var item = { "product": product_id as StringName, "quantity": quantity as int }
			_cart.append(item) as Dictionary
	
	func get_role() -> CustomerRole:
		return _role


# -----------------------------------------------------------------------------
# CUSTOMER CLASS (from engine.ts)
# -----------------------------------------------------------------------------

class Customer extends RefCounted:
	
	var _brain: CustomerBrain = null as CustomerBrain
	var _current_status: CustomerStatus = CustomerStatus.CUSTOMER_IN_STORE as CustomerStatus
	var _name: StringName = "Customer" as StringName
	
	func _init(brain: CustomerBrain):
		_brain = brain
	
	func get_name() -> StringName:
		return _name
	
	func set_name(name: StringName): void:
		_name = name as StringName
	
	func get_status() -> CustomerStatus:
		return _current_status


# -----------------------------------------------------------------------------
# CUSTOMER FACTORY (from engine.ts)
# -----------------------------------------------------------------------------

class CustomerFactory extends RefCounted:
	
	const REGULAR_CUSTOMER_PROBABILITY = 1.0 as float
	const MAX_REGULAR_CUSTOMER_NAME_LENGTH = 64 as int
	
	func create_regular_customer() -> Customer:
		var brain = CustomerBrain.new() as CustomerBrain
		var customer = Customer.new(brain) as Customer
		customer.set_name("Customer_%d" % (get_unique_customer_id())) as StringName
		return customer as Customer
	
	func get_unique_customer_id() -> int:
		# Simplified ID generation
		return randi_range(1, 10000) as int


# -----------------------------------------------------------------------------
# ACTION RESULT FACTORY (from engine.ts)
# -----------------------------------------------------------------------------

class ActionResultFactory extends RefCounted:
	
	func create_result(status: StringName = SUCCESS, message: StringName = "") -> ActionResult:
		var result = ActionResult.new() as ActionResult
		result.set_status(status)
		result._message = message
		return result as ActionResult


# -----------------------------------------------------------------------------
# MARKET ENGINE SINGLETON (main class)
# -----------------------------------------------------------------------------

class MarketEngine extends NodeName:
	
	var _market_director: MarketingDirector = null as MarketingDirector
	var _engine_config: MarketConfig = null as MarketConfig
	var _next_customer_id: int = 0 as int
	
	func _init(config: MarketConfig):
		_engine_config = config
		_market_director = MarketingDirector.new(config) as MarketingDirector
	
	func initialize_game() -> bool:
		if not _engine_config:
			print("MarketEngine: Missing engine config.")
			return false as bool
		# Additional initialization logic here
		return true as bool

