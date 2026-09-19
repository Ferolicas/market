extends TestCase
## Port of src/game/ai/CustomerBrain.test.ts

func test_builds_deterministic_lists_and_only_picks_real_shelf_stock() -> void:
	var first := CustomerBrain.create_customer_mind("c1", ["tomatoes", "bread", "milk"], 42, 3)
	var second := CustomerBrain.create_customer_mind("c1", ["tomatoes", "bread", "milk"], 42, 3)
	assert_eq(first["shoppingList"], second["shoppingList"])
	var inventory := ProductRegistry.create_empty_inventory(); inventory[first["shoppingList"][0]["productId"]] = 1
	var picked := CustomerBrain.commit_picked_product(first, inventory)
	assert_true(picked["picked"])
	assert_eq(picked["stock"][first["shoppingList"][0]["productId"]], 0)
	assert_false(CustomerBrain.commit_picked_product(picked["mind"], picked["stock"])["picked"])

func test_crea_listas_reales_de_cinco_tipos_cuando_el_objetivo_del_nivel_25_las_exige() -> void:
	var unlocked := ["tomatoes", "apples", "bread", "eggs", "coffee", "corn", "milk"]
	var mind := CustomerBrain.create_customer_mind("level-25", unlocked, 25, 25)
	assert_eq(mind["shoppingList"].size(), 5)
	assert_eq(JS.unique(JS.map(mind["shoppingList"], func(line): return line["productId"])).size(), 5)

func test_covers_the_mandatory_entrance_and_restock_branches() -> void:
	var mind := CustomerBrain.create_customer_mind("c2", ["tomatoes"], 7, 1)
	mind = CustomerBrain.transition_customer(mind, "spawned", 0)
	mind = CustomerBrain.transition_customer(mind, "entered", 10)
	mind = CustomerBrain.transition_customer(mind, "basket-ready", 20)
	mind = CustomerBrain.transition_customer(mind, "list-ready", 30)
	mind = CustomerBrain.transition_customer(mind, "arrived-product", 40)
	mind = CustomerBrain.transition_customer(mind, "product-empty", 50)
	assert_eq(mind["state"], "WAIT_RESTOCK")
	assert_eq(mind["waitingSince"], 50)
	assert_eq(CustomerBrain.transition_customer(mind, "restocked", 100)["state"], "NAVIGATE_TO_PRODUCT")
	assert_null(CustomerBrain.transition_customer(mind, "restocked", 100)["waitingSince"])

func test_reserves_distinct_queue_positions_and_advances_without_overlap() -> void:
	var queue := QueueManager.new(3)
	assert_eq(queue.reserve("a"), 2)
	assert_eq(queue.reserve("b"), 1)
	assert_eq(queue.reserve("c"), 0)
	queue.advance()
	assert_eq(JS.map(queue.snapshot(), func(slot): return slot["customerId"]), ["c", "b", "a"])
	queue.release("c")
	assert_eq(JS.map(queue.snapshot(), func(slot): return slot["customerId"]), ["b", "a", null])
	assert_eq(queue.first(), "b")
	assert_eq(queue.position_of("a"), 1)
	assert_null(queue.position_of("c"))
	assert_null(QueueManager.new(1).reserve("x") if QueueManager.new(1).reserve("y") == null else null)
