extends TestCase
## Port of src/game/player/CarrySystem.test.ts

func _inventory() -> Dictionary:
	return ProductRegistry.create_empty_inventory()

func test_combines_product_types_while_enforcing_total_basket_capacity() -> void:
	var initial := CarrySystem.create_carry_container()
	var tomatoes := CarrySystem.add_to_carry(initial, "tomatoes", 8, 8)
	assert_eq(tomatoes.moved, 3)
	assert_eq(CarrySystem.add_to_carry(tomatoes.container, "wheat", 2).moved, 0)
	var one_tomato_removed := CarrySystem.remove_from_carry(tomatoes.container, "tomatoes", 1)
	var mixed := CarrySystem.add_to_carry(one_tomato_removed.container, "wheat", 2)
	assert_eq(mixed.moved, 1)
	assert_eq(mixed.container.items, { "tomatoes": 2, "wheat": 1 })
	assert_eq(CarrySystem.carry_total(mixed.container), 3)
	assert_eq(CarrySystem.carry_quantity(mixed.container, "tomatoes"), 2)
	assert_eq(CarrySystem.carried_product_ids(mixed.container), ["tomatoes", "wheat"])
	assert_eq(CarrySystem.primary_carry_product(mixed.container), "tomatoes")
	assert_eq(CarrySystem.remove_from_carry(mixed.container, "tomatoes", 2).container.items, { "wheat": 1 })

func test_leaves_the_source_immutable_while_products_enter_and_leave_the_basket() -> void:
	var source := { "capacity": 4, "items": { "tomatoes": 1, "corn": 1 } }
	var added := CarrySystem.add_to_carry(source, "wheat", 2, 2)
	var removed := CarrySystem.remove_from_carry(added.container, "corn", 1)

	assert_eq(source.items, { "tomatoes": 1, "corn": 1 })
	assert_eq(added.container.items, { "tomatoes": 1, "corn": 1, "wheat": 2 })
	assert_eq(removed.container.items, { "tomatoes": 1, "wheat": 2 })

func test_selects_a_stockable_carried_product_instead_of_being_blocked_by_the_first_full_shelf() -> void:
	var carry := { "items": { "tomatoes": 2, "bread": 2, "apples": 1 } }
	var shelves := { "tomatoes": 12, "bread": 7, "apples": 1 }

	assert_eq(CarrySystem.primary_carry_product(carry), "tomatoes")
	assert_eq(CarrySystem.preferred_stocking_product(carry, shelves), "apples")
	assert_null(CarrySystem.preferred_stocking_product({ "items": {} }, shelves))
	# Tier 1 holds every physical front slot (30 tomatoes over two tables,
	# 24 loaves over three shelves); tier 2 opens a deeper row.
	assert_null(CarrySystem.preferred_stocking_product({ "items": { "tomatoes": 1, "bread": 1 } }, { "tomatoes": 30, "bread": 24 }, 1))
	assert_eq(CarrySystem.preferred_stocking_product({ "items": { "tomatoes": 1, "bread": 1 } }, { "tomatoes": 30, "bread": 24 }, 2), "tomatoes")
	assert_null(CarrySystem.preferred_stocking_product({ "items": { "tomatoes": 1, "bread": 1 } }, { "tomatoes": 38, "bread": 30 }, 2))

func test_creates_one_exact_visual_and_engine_batch_capped_by_remaining_shelf_space() -> void:
	var carry := { "items": { "tomatoes": 8, "apples": 2 } }

	assert_eq(CarrySystem.next_stocking_pulse(carry, { "tomatoes": 29, "apples": 30 }, 1), { "productId": "tomatoes", "quantity": 1 })
	assert_eq(CarrySystem.next_stocking_pulse(carry, { "tomatoes": 4, "apples": 30 }, 1), { "productId": "tomatoes", "quantity": 8 })
	assert_null(CarrySystem.next_stocking_pulse(carry, { "tomatoes": 30, "apples": 30 }, 1))
	assert_null(CarrySystem.next_stocking_pulse({ "items": {} }, { "tomatoes": 0 }, 1))

func test_only_pulses_products_accepted_by_the_department_magnet() -> void:
	var carry := { "items": { "tomatoes": 2, "eggs": 2, "milk": 2, "cheese": 1 } }
	var shelves := { "tomatoes": 0, "eggs": 0, "milk": 0, "cheese": 0 }

	assert_eq(CarrySystem.next_stocking_pulse(carry, shelves, 1, ["eggs"]), { "productId": "eggs", "quantity": 2 })
	assert_eq(CarrySystem.next_stocking_pulse(carry, shelves, 1, ["milk", "cheese"]), { "productId": "milk", "quantity": 2 })
	assert_null(CarrySystem.next_stocking_pulse(carry, shelves, 1, ["bread", "flour", "wheat"]))

func test_plans_every_compatible_product_from_one_department_approach() -> void:
	var carry := { "items": { "tomatoes": 3, "apples": 2, "corn": 1, "eggs": 4 } }
	var shelves := { "tomatoes": 28, "apples": 30, "corn": 0, "eggs": 0 }

	assert_eq(CarrySystem.department_stocking_pulses(carry, shelves, 1, ["tomatoes", "apples", "corn"]), [
		{ "productId": "corn", "quantity": 1 },
		{ "productId": "tomatoes", "quantity": 2 },
	])
	assert_eq(CarrySystem.department_stocking_pulses({ "items": {} }, shelves, 1, ["tomatoes"]), [])
	assert_eq(carry.items, { "tomatoes": 3, "apples": 2, "corn": 1, "eggs": 4 })
	assert_eq(shelves, { "tomatoes": 28, "apples": 30, "corn": 0, "eggs": 0 })

func test_adds_exactly_the_amount_removed_from_the_basket_and_empties_it_on_the_final_shelf_pulse() -> void:
	var carry := { "capacity": 3, "items": { "tomatoes": 2 } }
	var first := CarrySystem.transfer_carry_to_shelf(carry, "tomatoes", 10, 12, 1)
	var final := CarrySystem.transfer_carry_to_shelf(first.container, "tomatoes", first.shelfQuantity, 12, 5)

	assert_eq(first, { "container": { "capacity": 3, "items": { "tomatoes": 1 } }, "shelfQuantity": 11, "moved": 1 })
	assert_eq(final, { "container": { "capacity": 3, "items": {} }, "shelfQuantity": 12, "moved": 1 })
	assert_eq(carry.items, { "tomatoes": 2 })

func test_cannot_create_stock_from_a_full_shelf_or_an_invalid_requested_quantity() -> void:
	var carry := { "capacity": 3, "items": { "tomatoes": 2 } }

	assert_eq(CarrySystem.transfer_carry_to_shelf(carry, "tomatoes", 12, 12, 1), { "container": carry, "shelfQuantity": 12, "moved": 0 })
	assert_eq(CarrySystem.transfer_carry_to_shelf(carry, "tomatoes", 0, 12, NAN), { "container": carry, "shelfQuantity": 0, "moved": 0 })

func test_loads_one_deterministic_mixed_stockroom_batch_without_mutating_its_sources() -> void:
	var warehouse := JS.spread(_inventory(), { "milk": 2, "eggs": 2, "apples": 2 })
	var carry := { "capacity": 5, "items": { "tomatoes": 1 } }

	var result := CarrySystem.transfer_warehouse_to_carry(warehouse, carry)

	assert_eq(result, {
		"warehouse": JS.spread(_inventory(), { "milk": 0, "eggs": 1, "apples": 1 }),
		"container": { "capacity": 5, "items": { "tomatoes": 1, "milk": 2, "eggs": 1, "apples": 1 } },
		"moved": 4,
		"movedByProduct": { "milk": 2, "eggs": 1, "apples": 1 },
	})
	assert_eq(warehouse, JS.spread(_inventory(), { "milk": 2, "eggs": 2, "apples": 2 }))
	assert_eq(carry, { "capacity": 5, "items": { "tomatoes": 1 } })

func test_only_enables_physical_warehouse_pickup_when_stock_and_free_carry_capacity_coexist() -> void:
	var warehouse := JS.spread(_inventory(), { "wheat": 2 })

	assert_true(CarrySystem.can_pickup_warehouse(warehouse, { "capacity": 3, "items": {} }))
	assert_false(CarrySystem.can_pickup_warehouse(warehouse, { "capacity": 3, "items": {} }, "milk"))
	assert_false(CarrySystem.can_pickup_warehouse(warehouse, { "capacity": 3, "items": { "eggs": 3 } }))
	assert_false(CarrySystem.can_pickup_warehouse(_inventory(), { "capacity": 3, "items": {} }))
	assert_false(CarrySystem.can_pickup_warehouse(JS.spread(_inventory(), { "wheat": NAN }), { "capacity": 3, "items": {} }))

func test_honours_a_requested_sku_remaining_capacity_and_the_hard_manual_batch_bound() -> void:
	var warehouse := JS.spread(_inventory(), { "apples": 50, "wheat": 50 })
	var almost_full := CarrySystem.transfer_warehouse_to_carry(warehouse, { "capacity": 3, "items": { "eggs": 1 } }, 99, "apples")
	var defensive_bound := CarrySystem.transfer_warehouse_to_carry(warehouse, { "capacity": 100, "items": {} }, 50, "wheat")

	assert_eq(almost_full.container, { "capacity": 3, "items": { "eggs": 1, "apples": 2 } })
	assert_eq(almost_full.warehouse.apples, 48)
	assert_eq(defensive_bound.moved, CarrySystem.MAX_WAREHOUSE_PICKUP_BATCH)
	assert_eq(defensive_bound.container.items.wheat, CarrySystem.MAX_WAREHOUSE_PICKUP_BATCH)
	assert_eq(defensive_bound.warehouse.wheat, 50 - CarrySystem.MAX_WAREHOUSE_PICKUP_BATCH)
	assert_eq(CarrySystem.transfer_warehouse_to_carry(warehouse, { "capacity": 3, "items": {} }, NAN).moved, 0)
