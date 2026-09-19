class_name Catalog

const PRODUCTS = {
    "tomatoes": {
        "id": "tomatoes",
        "name": "Tomates",
        "description": "Jugosos tomates rojos.",
        "icon": "🍅",
        "category": "vegetable",
        "color": "#ef4444",
        "priceMinor": 200,
        "costMinor": 120,
        "weight": 0.5,
        "expirationDays": 7,
        "maxStack": 48,
        "supplyLimit": 1000,
        "supplier": "farmer",
        "recipe": {}
    },
    "wheat": {
        "id": "wheat",
        "name": "Trigo",
        "description": "Granos de trigo para hacer pan.",
        "icon": "🌾",
        "category": "grain",
        "color": "#f59e0b",
        "priceMinor": 300,
        "costMinor": 180,
        "weight": 0.3,
        "expirationDays": 30,
        "maxStack": 72,
        "supplyLimit": 800,
        "supplier": "farmer",
        "recipe": {}
    },
    "corn": {
        "id": "corn",
        "name": "Maíz",
        "description": "Mazorcas de maíz fresco.",
        "icon": "🌽",
        "category": "grain",
        "color": "#84cc16",
        "priceMinor": 250,
        "costMinor": 150,
        "weight": 0.4,
        "expirationDays": 14,
        "maxStack": 60,
        "supplyLimit": 900,
        "supplier": "farmer",
        "recipe": {}
    },
    "apples": {
        "id": "apples",
        "name": "Manzanas",
        "description": "Manzanas crujientes y frescas.",
        "icon": "🍎",
        "category": "fruit",
        "color": "#ef4444",
        "priceMinor": 350,
        "costMinor": 200,
        "weight": 0.3,
        "expirationDays": 10,
        "maxStack": 48,
        "supplyLimit": 700,
        "supplier": "farmer",
        "recipe": {}
    },
    "oranges": {
        "id": "oranges",
        "name": "Naranjas",
        "description": "Naranjas dulces y jugosas.",
        "icon": "🍊",
        "category": "fruit",
        "color": "#fbbf24",
        "priceMinor": 400,
        "costMinor": 250,
        "weight": 0.3,
        "expirationDays": 12,
        "maxStack": 48,
        "supplyLimit": 600,
        "supplier": "farmer",
        "recipe": {}
    },
    "coffee": {
        "id": "coffee",
        "name": "Café",
        "description": "Granos de café frescos.",
        "icon": "☕",
        "category": "beverage",
        "color": "#92400e",
        "priceMinor": 500,
        "costMinor": 300,
        "weight": 0.2,
        "expirationDays": 180,
        "maxStack": 36,
        "supplyLimit": 400,
        "supplier": "supplier-andes",
        "recipe": {}
    },
    "flour": {
        "id": "flour",
        "name": "Harina",
        "description": "Harina de trigo molida.",
        "icon": "🌾",
        "category": "ingredient",
        "color": "#fbbf24",
        "priceMinor": 150,
        "costMinor": 80,
        "weight": 0.25,
        "expirationDays": 90,
        "maxStack": 72,
        "supplyLimit": 1200,
        "supplier": "farmer",
        "recipe": {"wheat": 2}
    },
    "bread": {
        "id": "bread",
        "name": "Pan",
        "description": "Pan recién horneada.",
        "icon": "🍞",
        "category": "bakery",
        "color": "#fbbf24",
        "priceMinor": 450,
        "costMinor": 220,
        "weight": 0.3,
        "expirationDays": 5,
        "maxStack": 36,
        "supplyLimit": 500,
        "supplier": "farmer",
        "recipe": {"flour": 3, "water": 2}
    },
    "cheese": {
        "id": "cheese",
        "name": "Queso",
               "description": "Queso fresco.",
        "icon": "🧀",
        "category": "dairy",
        "color": "#fbbf24",
        "priceMinor": 600,
        "costMinor": 350,
        "weight": 0.2,
        "expirationDays": 8,
        "maxStack": 24,
        "supplyLimit": 300,
        "supplier": "farmer",
        "recipe": {"milk": 5}
    },
    "juice": {
        "id": "juice",
        "name": "Jugo",
        "description": "Jugo natural.",
        "icon": "🧊",
        "category": "beverage",
        "color": "#84cc16",
        "priceMinor": 350,
        "costMinor": 180,
        "weight": 0.2,
        "expirationDays": 6,
        "maxStack": 36,
        "supplyLimit": 400,
        "supplier": "farmer",
        "recipe": {"corn": 3, "sugar": 1}
    },
    "eggs": {
        "id": "eggs",
        "name": "Huevos",
        "description": "Huevos frescos.",
        "icon": "🥚",
        "category": "dairy",
        "color": "#fbbf24",
        "priceMinor": 400,
        "costMinor": 200,
        "weight": 0.1,
        "expirationDays": 30,
        "maxStack": 60,
        "supplyLimit": 800,
        "supplier": "supplier-chicken",
        "recipe": {}
    },
    "milk": {
        "id": "milk",
        "name": "Leche",
        "description": "Leche fresca.",
        "icon": "🥛",
        "category": "dairy",
        "color": "#fbbf24",
        "priceMinor": 300,
        "costMinor": 150,
        "weight": 0.2,
        "expirationDays": 10,
        "maxStack": 48,
        "supplyLimit": 600,
        "supplier": "supplier-cow",
        "recipe": {}
    },
    "cannedCorn": {
        "id": "cannedCorn",
        "name": "Maíz Enlatado",
        "description": "Maíz enlatado.",
        "icon": "🥫",
        "category": "preserved",
        "color": "#fbbf24",
        "priceMinor": 800,
        "costMinor": 400,
        "weight": 0.5,
        "expirationDays": 365,
        "maxStack": 24,
        "supplyLimit": 200,
        "supplier": "farmer",
        "recipe": {"corn": 2, "salt": 1}
    }
}

const SUPPLIERS = {
    "farmer": {
        "id": "farmer",
        "name": "Granjero",
        "unlockLevel": 1,
        "discount": 0.0
    },
    "supplier-andes": {
        "id": "supplier-andes",
        "name": "Andes Coffee",
        "unlockLevel": 9,
        "discount": 0.1
    },
    "supplier-chicken": {
        "id": "supplier-chicken",
        "name": "Pollos Frescos",
        "unlockLevel": 8,
        "discount": 0.0
    },
    "supplier-cow": {
        "id": "supplier-cow",
        "name": "Lechería",
        "unlockLevel": 13,
        "unlockLevel": 13,
        "discount": 0.0
    }
}

const COUNTRIES = {
    "ES": {
        "code": "ES",
        "name": "España",
        "currency": "EUR",
        "startingCapitalMinor": 20000,
        "moneyScale": 1.0
    },
    "US": {
        "code": "US",
        "name": "Estados Unidos",
        "currency": "USD",
        "startingCapitalMinor": 25000,
        "moneyScale": 1.0
    },
    "GB": {
        "code": "GB",
        "name": "Reino Unido",
        "currency": "GBP",
        "startingCapitalMinor": 20000,
        "moneyScale": 1.0
    },
    "DE": {
        "code": "DE",
        "name": "Alemania",
        "currency": "EUR",
        "startingCapitalMinor": 18000,
        "moneyScale": 1.0
    }
}

const ROLE_INFO = {
    "cashier": {
        "id": "cashier",
        "name": "Cajero",
        "unlockLevel": 1,
        "description": "Atender clientes en caja."
    },
    "farmer": {
        "id": "farmer",
        "name": "Granjero",
        "unlockLevel": 1,
        "description": "Cuidar cultivos en granjas."
    },
    "feeder": {
        "id": "feeder",
        "name": "Alimentador",
        "unlockLevel": 5,
        "description": "Alimentar animales."
    },
    "operator": {
        "id": "operator",
        "name": "Operador",
        "unlockLevel": 8,
        "description": "Operar máquinas y equipos."
    },
    "builder": {
        "id": "builder",
        "name": "Constructor",
        "unlockLevel": 12,
        "description": "Construir mejoras de la tienda."
    }
}

const FRANCHISE_TEMPLATES = [
    {
        "id": "franchise-0",
        "name": "Mi Tienda",
        "purchaseCostMinor": 5000,
        "unlockLevel": 1
    }
]

const HATS = [
    {"id": "red-panda", "name": "Red Panda", "emoji": "🐼"},
    {"id": "blue-cap", "name": "Blue Cap", "emoji": "👕"},
    {"id": "chef-hat", "name": "Chef Hat", "emoji": "👨‍🍳"},
    {"id": "fire-hat", "name": "Fire Hat", "emoji": "👒"},
    {"id": "none", "name": "None", "emoji": "👤"}
]

const EMPLOYEE_NAMES = [
    "Juan",
    "María", 
    "Pedro",
    "Ana",
    "Carlos",
    "Laura",
    "Diego",
    "Sofia",
    "Miguel",
    "Isabella",
    "Javier",
    "Valentina",
    "Rafael",
    "Gabriela",
    "Luis",
    "Camila"
]

const PRODUCTS = PRODUCTS