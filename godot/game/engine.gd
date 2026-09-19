extends MarketEngineBase

const WorldScale = preload("res://game/world_scale.gd")
const JS = preload("res://game/util/js.gd")

class_name MarketEngine

var _simulation_time_ms: int = 0
var _engine_initialized := false

func _ready():
    if Engine.get_singleton("MarketEngine") != null:
        return
    Engine.register_singleton("MarketEngine", self)

func _initialize_engine():
    if _engine_initialized:
        return
    _engine_initialized = true

func create_initial_game(country_code: String = "ES") -> Dictionary:
    var country = COUNTRIES[country_code]
    var money_scale = get_country_money_scale(country_code)
    
    var franchises = []
    var franchise_template = FRANCHISE_TEMPLATES[0]
    
    var franchise = {
        "id": franchise_template.id,
        "name": franchise_template.name,
        "purchaseCostMinor": round(franchise_template.purchaseCostMinor * money_scale),
        "owned": true,
        "open": false,
        "licenseActive": true,
        "licenseDaysLeft": 7,
        "expansionLevel": 1,
        "shelvesLevel": 1,
        "checkoutLevel": 1,
        "warehouse": create_empty_inventory(),
        "shelves": create_shelves_with_starting_items(money_scale),
        "machines": {
            "flourMillLevel": 1,
            "bakeryLevel": 1,
            "flourQueue": 0,
            "breadQueue": 0
        },
        "carry": {"capacity": 3, "items": {}},
        "crops": create_initial_crops(),
        "productionMachines": create_initial_production_machines(),
        "buildProjects": [
            {
                "id": "level-2",
                "level": 2,
                "costMinor": 2000,
                "contributedMinor": 0,
                "completed": false
            }
        ],
        "checkoutTransactions": [],
        "registerCashMinor": [0, 0, 0],
        "returnsBin": create_empty_inventory(),
        "returnedCartCount": 6,
        "customers": [],
        "nextCustomerSequence": 1,
        "lastCustomerSpawnAt": -3000,
        "queueCustomerIds": [],
        "unlockedAreas": ["store-floor", "farm-tomato", "checkout-1"],
        "stationTiers": {"crop-tomato-1": 1, "shelves-1": 1, "checkout-1": 1},
        "upgradeContributions": {},
        "playerSpeedTier": 1,
        "playerCapacityTier": 1,
        "storeRank": 1,
        "structureRevision": 1,
        "doorState": "CLOSED",
        "doorProgress": 0,
        "doorPlayerPresent": false,
        "doorEmptySince": null,
        "lightsOn": false,
        "employees": [],
        "revenueTodayMinor": 0,
        "expensesTodayMinor": 0,
        "customersToday": 0,
        "rating": 3.5,
    }
    
    franchises.append(franchise)
    
    return {
        "schemaVersion": 4,
        "revision": 0,
        "countryCode": country_code,
        "currency": country.currency,
        "balanceMinor": country.startingCapitalMinor,
        "level": 1,
        "xp": 0,
        "reputation": 0,
        "day": 1,
        "minuteOfDay": BUSINESS_DAY_OPEN_MINUTE,
        "currentFranchiseId": franchise.id,
        "avatar": {
            "body": "adult-man",
            "hair": "side-part",
            "hairColor": "#332b27",
            "skin": "#bd815f",
            "shirt": "#76aee5",
            "hat": "none"
        },
        "franchises": franchises,
        "missions": create_missions_for_day(1, money_scale, 1),
        "pendingOrders": [],
        "finances": {
            "grossRevenueMinor": 0,
            "costOfGoodsMinor": 0,
            "payrollMinor": 0,
            "operatingCostsMinor": 0,
            "taxesMinor": 0,
            "netProfitMinor": 0
        },
        "tutorialStep": 0,
        "progression": {
            "completedLevels": [],
            "counters": {},
            "levelStartedCounters": {},
            "playerActionCount": 0,
            "levelStartedPlayerActionCount": 0,
            "objectiveComplete": false,
            "lastUnlockAt": 0
        },
        "eventSequence": 0,
        "processedEventIds": [],
        "lastServerTime": 0,
        "simulationTimeMs": 0,
        "lastSavedAt": str(OS.get_datetime_from_unix_time(OS.get_unix_time()).get_date_string()),
    }

func create_empty_inventory() -> Dictionary:
    return {}

func create_shelves_with_starting_items(money_scale: float) -> Dictionary:
    var shelves = create_empty_inventory()
    shelves["milk"] = 8
    shelves["eggs"] = 6
    shelves["apples"] = 8
    return shelves

func create_initial_crops() -> Array:
    var crops = []
    crops.append(create_crop("crop-tomato-1", "tomatoes", 0, 1, 1))
    
    var empty_apples = create_empty_crop("crop-apple-1", "apples")
    empty_apples["status"] = "LOCKED"
    crops.append(empty_apples)
    
    var empty_wheat = create_empty_crop("crop-wheat-1", "wheat")
    empty_wheat["status"] = "LOCKED"
    crops.append(empty_wheat)
    
    var empty_corn = create_empty_crop("crop-corn-1", "corn")
    empty_corn["status"] = "LOCKED"
    crops.append(empty_corn)
    
    var empty_oranges = create_empty_crop("crop-orange-1", "oranges")
    empty_oranges["status"] = "LOCKED"
    crops.append(empty_oranges)
    
    var empty_coffee = create_empty_crop("crop-coffee-1", "coffee")
    empty_coffee["status"] = "LOCKED"
    crops.append(empty_coffee)
    
    return crops

func create_initial_production_machines() -> Array:
    var machines = []
    
    var flour_mill = create_machine("flour-mill-1", "flour")
    flour_mill["status"] = "LOCKED"
    machines.append(flour_mill)
    
    var bread_oven = create_machine("bread-oven-1", "bread")
    bread_oven["status"] = "LOCKED"
    machines.append(bread_oven)
    
    var cheese_maker = create_machine("cheese-maker-1", "cheese")
    cheese_maker["status"] = "LOCKED"
    machines.append(cheese_maker)
    
    var juice_machine = create_machine("juice-machine-1", "juice")
    juice_machine["status"] = "LOCKED"
    machines.append(juice_machine)
    
    var chicken_coop = create_machine("chicken-coop-1", "eggs")
    chicken_coop["status"] = "LOCKED"
    machines.append(chicken_coop)
    
    var cow_station = create_machine("cow-station-1", "milk")
    cow_station["status"] = "LOCKED"
    machines.append(cow_station)
    
    return machines

func get_country_money_scale(country_code: String) -> float:
    return COUNTRIES[country_code].moneyScale

func get_country_starting_capital(country_code: String) -> int:
    return COUNTRIES[country_code].startingCapitalMinor

func get_currency(country_code: String) -> String:
    return COUNTRIES[country_code].currency

func normalize(crop: Dictionary) -> Dictionary:
    return crop