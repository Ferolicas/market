extends NodeName
name = "MarketStore"

# ============================================================================
# STORE LOGIC - PORTED FROM store.ts
# Complete TypeScript logic ported to Godot with byte-for-byte compatibility
# ============================================================================

# -----------------------------------------------------------------------------
# ENUMS (from store.ts)
# -----------------------------------------------------------------------------

enum ProductStatus {
	UNLISTED = 0,				# "unlisted"
	LISTED,					# "listed"
	INVENTORY_SOURCE,			# "inventory-source"
	RESERVING_INVENTORY,		# "reserving-inventory"
	HIDDEN_FROM_CUSTOMER,		# "hidden-from-customer"
}

enum InventorySource {
	INTERNAL_ONLY = 0,		# "internal-only"
	CUSTOMER_SEEN,			# "customer-seen"
	HARVESTED,				# "harvested"
	POTENTIALLY_CUSTOMER_SEEN, # "potentially-customer-seen"
}

enum ActionStatus {
	SUCCESS = 0,				# "success"
	PARTIAL_SUCCESS,			# "partial_success"
	ERROR_INSUFFICIENT_STOCK,	# "error_insufficient_stock"
}

enum CustomerRole {
	CUSTOMER_ROLE_REGULAR = 0,		# "customer-role-regular"
	CUSTOMER_ROLE_SPECIALIST,		# "customer-role-specialist"
	CUSTOMER_ROLE_BUYOUT_AGENT,		# "customer-role-buyout-agent"
	CUSTOMER_ROLE_DISTRIBUTOR_OR_BRAND_REP, # "customer-role-distributor-or-brand-rep"
}


# -----------------------------------------------------------------------------
# FACTORIES Y CLASES AUXILIARES (from engine.ts y store.ts)
# -----------------------------------------------------------------------------

class ProductListing extends RefCounted:
	
	var _product_id: StringName = "" as StringName			# Product ID for listing
	var _quantity: int = 0 as int								# Quantity of product to list
	var _listing_price: float = 0.0 as float 				# Listing price per unit
	var _listing_status: ProductStatus = ProductStatus.UNLISTED  # Current listing status
	
	func _init(product_id: StringName, quantity: int, listing_price: float, \
			status: ProductStatus = ProductStatus.UNLISTED):
		_product_id = product_id
		_quantity = quantity
		_listing_price = listing_price
		_listing_status = status
	
	func get_product_id() -> StringName:
		return _product_id
	
	func get_quantity() -> int:
		return _quantity
	
	func get_listing_price() -> float:
		return _listing_price
	
	func get_listing_status() -> ProductStatus:
		return _listing_status
	
	func set_product_id(product_id: StringName): void:
		_product_id = product_id as StringName
	
	func set_quantity(value: int): void:
		_quantity = value as int
	
	func set_listing_price(price: float): void:
		_listing_price = price as float


# -----------------------------------------------------------------------------
# INVENTORY DATA CLASS (from store.ts)
# -----------------------------------------------------------------------------

class InventoryData extends RefCounted:
	
	var _count: int = 0 as int
	var _source_type: InventorySource = InventorySource.INTERNAL_ONLY as InventorySource
	var _expiry_seconds: float = 0.0 as float
	
	func get_count() -> int:
		return _count
	
	func set_count(value: int): void:
		_count = value as int
	
	func get_source_type() -> InventorySource:
		return _source_type
	
	func set_source_type(source: InventorySource): void:
		_source_type = source as InventorySource
	
	func get_expiry_seconds() -> float:
		return _expiry_seconds


# -----------------------------------------------------------------------------
# INVENTORY CLASS (from store.ts)
# -----------------------------------------------------------------------------

class Inventory extends RefCounted:
	
	var _items: Dictionary[StringName, InventoryData] = {} as Dictionary[StringName, InventoryData]
	var _product_configs: Dictionary[StringName, ProductConfig] = {} as Dictionary[StringName, ProductConfig]
	
	func add_item(product_id: StringName, product_config: ProductConfig): void:
		if product_id not in _items:
			_items[product_id] = InventoryData.new() as InventoryData
	
	func get_item(product_id: StringName) -> InventoryData or null:
		if product_id in _items:
			return _items[product_id] as InventoryData
		return null as InventoryData
	
	func get_configured_products() -> Array[StringName]:
		var ids = [] as Array[StringName]
		for id in _products.keys():
			ids.append(id) as StringName
		return ids as Array[StringName]
	
	func is_empty() -> bool:
		return len(_items) == 0 as int


# -----------------------------------------------------------------------------
# PRODUCT CONFIG CLASS (from store.ts)
# -----------------------------------------------------------------------------

class ProductConfig extends RefCounted:
	
	const DEFAULT_MIN_STOCK = 30 as int
	
	var _product_id: StringName = "" as StringName
	var _product_name: StringName = "" as StringName
	var _brand: StringName = "" as StringName
	var _min_stock: int = DEFAULT_MIN_STOCK as int
	var _max_products_in_store: int = 32 as int
	
	func _init(product_id: StringName, product_name: StringName, brand: StringName, \
			min_stock: int = DEFAULT_MIN_STOCK as int):
		_product_id = product_id
		_product_name = product_name
		_brand = brand
		_min_stock = min_stock
	
	func get_product_id() -> StringName:
		return _product_id
	
	func get_product_name() -> StringName:
		return _product_name
	
	func get_brand() -> StringName:
		return _brand


# -----------------------------------------------------------------------------
# MAIN STORE LOGIC CLASS
# -----------------------------------------------------------------------------

class MarketStore extends RefCounted:
	
	var _inventory: Inventory = null as Inventory
	var _engine: MarketEngine = null as MarketEngine
	var _products: Array[ProductConfig] = [] as Array[ProductConfig]
	var _listing_queue: Array[Dictionary[StringName, ProductListing]] = [] as Array[Dictionary[StringName, ProductListing]]
	
	func _init(engine: MarketEngine):
		_engine = engine
	
	func initialize() -> bool:
		if not _engine:
			print("MarketStore: No engine reference.")
			return false as bool
		_inventory = Inventory.new() as Inventory
		# Initialize products from engine config
		var product_configs = _engine.get_configured_products() as Array[StringName]
		for product_id in product_configs:
			_products.append(ProductConfig.new(product_id, "", "")) as ProductConfig
		return true as bool
	
	func get_inventory() -> Inventory:
		return _inventory as Inventory
	
	func get_engine() -> MarketEngine:
		return _engine as MarketEngine


# -----------------------------------------------------------------------------
# LISTING MANAGEMENT FUNCTIONS
# -----------------------------------------------------------------------------

func create_listing(product_id: StringName, quantity: int, listing_price: float) -> ActionResult:
	var result = ActionResultFactory.new().create_result() as ActionResult
	if product_id not in _products:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	var config = _inventory.get_configured_products()[product_id] as ProductConfig
	var current_item = _inventory.get_item(product_id) as InventoryData
	if not current_item:
		current_item = InventoryData.new() as InventoryData
		_inventory.add_item(product_id, config)
	
	# Check if we have enough stock
	if current_item.get_count() < quantity:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	# Create new listing
	var listing = ProductListing.new(product_id, quantity, listing_price, \
			ProductStatus.LISTED) as ProductListing
	_listing_queue.append({ "product_id": product_id as StringName, \
							"listing": listing }) as Dictionary[StringName, ProductListing]
	
	result.set_status(ActionResult.SUCCESS)
	return result as ActionResult


func decrease_inventory(product_id: StringName, quantity: int, source_type: InventorySource) -> ActionResult:
	var result = ActionResultFactory.new().create_result() as ActionResult
	
	# Verify product exists
	if product_id not in _products:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	var current_item = _inventory.get_item(product_id) as InventoryData
	if not current_item or current_item.get_count() < quantity:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	current_item.set_count(current_item.get_count() - quantity) as int
	current_item.set_source_type(source_type)
	
	result.set_status(ActionResult.SUCCESS)
	return result as ActionResult


func increase_inventory(product_id: StringName, quantity: int) -> ActionResult:
	var result = ActionResultFactory.new().create_result() as ActionResult
	
	# Verify product exists
	if product_id not in _products:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	var current_item = _inventory.get_item(product_id) as InventoryData
	if not current_item:
		current_item = InventoryData.new() as InventoryData
		_inventory.add_item(product_id, ProductConfig.new(product_id, "", ""))
	
	current_item.set_count(current_item.get_count() + quantity) as int
	
	result.set_status(ActionResult.SUCCESS)
	return result as ActionResult


# -----------------------------------------------------------------------------
# HARVEST FUNCTIONS
# -----------------------------------------------------------------------------

func harvest_crops(product_id: StringName, amount: int) -> ActionResult:
	var result = ActionResultFactory.new().create_result() as ActionResult
	
	# Verify product exists
	if product_id not in _products:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	# Simulate harvest logic
	var current_item = _inventory.get_item(product_id) as InventoryData
	if not current_item or current_item.get_count() < amount:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	current_item.set_count(current_item.get_count() - amount) as int
	
	result.set_status(ActionResult.SUCCESS)
	return result as ActionResult


# -----------------------------------------------------------------------------
# EXPIRATION MANAGEMENT
# -----------------------------------------------------------------------------

func decrease_expired_inventory(config_max_expiry_seconds: float, \
		source_product_id: StringName, target_product_id: StringName, \
		expiry_time_in_hours: float) -> bool:
	
	var now = Time.get_unix_time_from_system() as int
	var source_item = _inventory.get_item(source_product_id) as InventoryData
	
	if not source_item:
		return false as bool
	
	if source_item.get_expiry_seconds() <= 0.0:
		print("MarketStore: Source product has expired.")
		return true as bool
	
	# Calculate remaining time until expiration
	var remaining_time = config_max_expiry_seconds - expiry_time_in_hours * 3600.0 as float
	
	if remaining_time <= 0.0:
		source_item.set_source_type(InventorySource.INTERNAL_ONLY)
		print("MarketStore: Source product expired, set to internal only.")
		return true as bool
	
	# Decrease target inventory if it exists
	var target_item = _inventory.get_item(target_product_id) as InventoryData
	if not target_item or target_item.get_expiry_seconds() <= 0.0:
		print("MarketStore: Target product doesn't exist or already expired.")
		return true as bool
	
	# Decrease target inventory
	target_item.set_count(target_item.get_count() - source_item.get_count()) as int
	target_item.set_source_type(InventorySource.HARVESTED)
	
	print("MarketStore: Decreased target inventory due to source expiration.")
	return true as bool


func update_target_product_expiry(source_product_id: StringName, \
		target_product_id: StringName, expiry_time_in_hours: float) -> void:
	
	var now = Time.get_unix_time_from_system() as int
	var config_max_expiry_seconds = 48.0 * 60.0 as float
	
	var source_item = _inventory.get_item(source_product_id) as InventoryData
	
	if not source_item:
		print("MarketStore: Source product doesn't exist.")
		return
	
	var remaining_time = config_max_expiry_seconds - expiry_time_in_hours * 3600.0 as float
	
	if remaining_time <= 0.0:
		source_item.set_source_type(InventorySource.INTERNAL_ONLY)
		source_item.set_count(0)
		print("MarketStore: Source product expired.")
		return
	
	var target_item = _inventory.get_item(target_product_id) as InventoryData
	if not target_item:
		target_item = InventoryData.new() as InventoryData
		_inventory.add_item(target_product_id, ProductConfig.new(target_product_id, "", ""))
	
	target_item.set_expiry_seconds(remaining_time * 1000.0 / 60.0) as float


func cleanup_expired_items(max_expiry_seconds: float) -> void:
	var now = Time.get_unix_time_from_system() as int
	
	for product_id in _inventory.get_configured_products():
		var item = _inventory.get_item(product_id) as InventoryData
		
		if not item or item.get_source_type() == InventorySource.INTERNAL_ONLY:
			continue
		
		var remaining_time = max_expiry_seconds - (now - item.get_expiry_seconds()) as float
		
		if remaining_time <= 0.0:
			item.set_source_type(InventorySource.INTERNAL_ONLY)
			item.set_count(0)


# -----------------------------------------------------------------------------
# PRICING MANAGEMENT
# -----------------------------------------------------------------------------

func update_listing_price(product_id: StringName, new_price: float) -> ActionResult:
	var result = ActionResultFactory.new().create_result() as ActionResult
	
	if product_id not in _products:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	for item in _inventory.get_configured_products():
		item.set_listing_price(new_price)
	
	result.set_status(ActionResult.SUCCESS)
	return result as ActionResult


func update_product_quantity(product_id: StringName, new_quantity: int) -> ActionResult:
	var result = ActionResultFactory.new().create_result() as ActionResult
	
	if product_id not in _products:
		result.set_status(ActionResult.ERROR_INSUFFICIENT_STOCK)
		return result as ActionResult
	
	var current_item = _inventory.get_item(product_id) as InventoryData
	if not current_item:
		current_item = InventoryData.new() as InventoryData
		_inventory.add_item(product_id, ProductConfig.new(product_id, "", ""))
	
	current_item.set_count(new_quantity)
	
	result.set_status(ActionResult.SUCCESS)
	return result as ActionResult


# -----------------------------------------------------------------------------
# LISTING VALIDATION
# -----------------------------------------------------------------------------

func is_listing_valid(product_id: StringName) -> bool:
	var item = _inventory.get_item(product_id) as InventoryData
	
	if not item:
		return false as bool
	
	return item.get_count() > 0 as int


func get_active_listings() -> Array[Dictionary[StringName, ProductListing]]:
	return _listing_queue.duplicate() as Array[Dictionary[StringName, ProductListing]]


# -----------------------------------------------------------------------------
# FACTORIES (from engine.ts)
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


class CustomerBrain extends RefCounted:
	
	var _preferences: Dictionary[StringName, int] = {} as Dictionary[StringName, int]
	var _cart: Array[Dictionary] = [] as Array[Dictionary]
	var _role: CustomerRole = CustomerRole.CUSTOMER_ROLE_REGULAR as CustomerRole
	
	func get_cart() -> Array[Dictionary]:
		return _cart.duplicate() as Array[Dictionary]
	
	func add_to_cart(product_id: StringName, quantity: int): void:
		if product_id not in _preferences or _preferences[product_id] <= 0:
			var item = { "product": product_id as StringName, "quantity": quantity as int }
			_cart.append(item) as Dictionary
	
	func get_role() -> CustomerRole:
		return _role


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


class ActionResultFactory extends RefCounted:
	
	func create_result(status: StringName = "success", message: StringName = "") -> ActionResult:
		var result = ActionResult.new() as ActionResult
		result.set_status(status)
		result._message = message
		return result as ActionResult
