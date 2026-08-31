export type AssetCategory = "character" | "hair" | "hat" | "customer" | "furniture" | "equipment" | "crop";
export type AssetStatus = "missing" | "temporary" | "needs-rework" | "approved";

export interface MarketAssetDefinition {
  id: string;
  referenceImages: string[];
  asset: string;
  category: AssetCategory;
  status: AssetStatus;
  scaleMeters: [number, number, number];
  pivot: string;
  attachmentBone: "Head" | null;
  materials: string[];
  animations: string[];
  collider: string;
  interaction: string;
  referenceNotes: string;
  compatibleHeads?: string[];
  compatibleHair?: string[];
  hidesHairParts?: string[];
  socket?: string;
  boundingVolume?: string;
}

const referenceRoot = "/home/ferney_oliveros/Descargas/KIT MARKET";
const ref = (name: string) => `${referenceRoot}/${name}`;
const characterClips = [
  "Idle", "Walk", "Run", "TurnLeft", "TurnRight", "CarryIdle", "CarryWalk",
  "HarvestLow", "HarvestHigh", "PickupLow", "PickupHigh", "StockLow", "StockMid", "StockHigh",
  "CheckoutScan", "CheckoutBag", "Pay", "ReceiveBag", "Happy", "Confused", "Impatient", "Talk",
  "LookAround", "Phone", "Enter", "Exit", "Wave", "ReceiveOrder", "LiftBox", "CarryBox", "ScanItem",
  "Plant", "Harvest", "Wait", "Browse", "ReachShelf", "CarryBasket", "Queue", "CheckoutItem",
];

const characters: MarketAssetDefinition[] = [
  ["owner_man", "character", "characters/owner_man.glb", ["PERSONAJES.png", "VENDEDOR HOMBRE.png", "POSES DUEÑO.png", "ANIMACIONES.png"]],
  ["owner_woman", "character", "characters/owner_woman.glb", ["PERSONAJES.png", "POSES DUEÑO.png", "ANIMACIONES.png"]],
  ["owner_boy", "character", "characters/owner_boy.glb", ["PERSONAJES.png", "POSES DUEÑO.png", "ANIMACIONES.png"]],
  ["owner_girl", "character", "characters/owner_girl.glb", ["PERSONAJES.png", "POSES DUEÑO.png", "ANIMACIONES.png"]],
  ["customer_man_young", "customer", "customers/customer_01_man_young.glb", ["cliente1.png", "ANIMACIONES.png"]],
  ["customer_man_senior", "customer", "customers/customer_02_man_senior.glb", ["cliente2.png", "ANIMACIONES.png"]],
  ["customer_woman_young", "customer", "customers/customer_03_woman_young.glb", ["cliente3.png", "ANIMACIONES.png"]],
  ["customer_woman_adult", "customer", "customers/customer_04_woman_adult.glb", ["cliente4.png", "ANIMACIONES.png"]],
  ["customer_woman_mature", "customer", "customers/customer_05_woman_mature.glb", ["cliente5.png", "ANIMACIONES.png"]],
  ["customer_woman_senior", "customer", "customers/customer_06_woman_senior.glb", ["cliente6.png", "ANIMACIONES.png"]],
].map(([id, category, asset, images]) => ({
  id: id as string, category: category as AssetCategory, asset: `/models/market/${asset}`, referenceImages: (images as string[]).map(ref), status: "approved",
  scaleMeters: [0.65, category === "customer" ? 1.72 : 1.78, 0.42], pivot: "centro entre plantas de los pies, Y=0", attachmentBone: null,
  materials: ["Skin", "SkinBlush", "Shirt", "SecondaryCloth", "Eyes", "Mouth"], animations: characterClips,
  collider: "cápsula cinemática por cuerpo", interaction: category === "customer" ? "CustomerBrain/QueueManager" : "PlayerController/InteractionDirector", referenceNotes: "Silueta, rostro, ropa y proporciones provienen únicamente de las láminas propias.",
}));

const hairNames = ["short_side_part", "fade", "waves", "swept", "bob", "ponytail", "long_wavy", "bun", "messy", "curls", "short_fringe", "quiff", "blunt_bob", "pigtails", "braid", "high_ponytail"];
const hairFiles = ["side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun", "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail"];
const hair: MarketAssetDefinition[] = hairNames.map((name, index) => ({
  id: `hair_${String(index + 1).padStart(2, "0")}_${name}`, referenceImages: [ref("PEINADOS.png")], asset: `/models/market/hair/adult-man/${hairFiles[index]}.glb`, category: "hair", status: "approved",
  scaleMeters: [0.42, 0.42, 0.42], pivot: "HairSocket en centro de cráneo", attachmentBone: "Head", materials: ["Hair"], animations: [], collider: "sin collider", interaction: "personalización",
  referenceNotes: "Volumen, raya, flequillo y silueta trasera siguen PEINADOS.png.", compatibleHeads: ["owner_man", "owner_woman", "owner_boy", "owner_girl"], compatibleHair: [], hidesHairParts: [], socket: "HairSocket", boundingVolume: "esfera r=0.34 m",
}));

const hatFiles = ["red-panda", "red-fox", "chicken", "owl", "elephant", "rhino", "giraffe", "panda", "frog", "cow", "rabbit", "capybara"];
const hats: MarketAssetDefinition[] = hatFiles.map((name) => ({
  id: `hat_${name.replace("rhino", "rhinoceros").replace("rabbit", "bunny")}`, referenceImages: [ref("GORROS.png")], asset: `/models/market/hats/adult-man/${name}.glb`, category: "hat", status: "approved",
  scaleMeters: [0.5, 0.48, 0.5], pivot: "HatSocket en centro de cráneo", attachmentBone: "Head", materials: ["HatPrimary", "HatSecondary", "HatDetails"], animations: [], collider: "sin collider", interaction: "personalización",
  referenceNotes: "Animal, rasgos faciales, orejas, trompa/cuerno y paleta coinciden con GORROS.png.", compatibleHeads: ["owner_man", "owner_woman", "owner_boy", "owner_girl"], compatibleHair: [], hidesHairParts: ["all"], socket: "HatSocket", boundingVolume: "caja 0.55×0.55×0.55 m",
}));

export const EXPOSURE_ASSET_IDS = ["shelf_gondola_single", "shelf_gondola_double", "shelf_wall_low", "shelf_wall_tall", "shelf_endcap", "display_produce_tomato", "display_produce_mixed", "display_bakery", "display_eggs", "display_refrigerated_open", "display_refrigerated_doors", "display_freezer_chest", "display_promo_basket", "rack_stockroom"] as const;
export const EQUIPMENT_ASSET_IDS = ["build_floor_tile", "build_wall_straight", "build_wall_corner", "build_storefront_window", "build_entrance_frame", "equipment_auto_door", "equipment_ceiling_light", "equipment_checkout_counter", "equipment_cash_register", "equipment_conveyor", "equipment_scanner", "equipment_cash_drawer", "equipment_card_terminal", "equipment_bagging_area", "equipment_basket_stack", "equipment_bread_oven", "equipment_flour_mill", "equipment_juice_machine", "equipment_cheese_maker", "equipment_delivery_dock", "equipment_upgrade_pad", "equipment_hire_pad"] as const;
export const FARM_ASSET_IDS = ["farm_plot_empty", "farm_plot_seeded", "farm_plot_watered", "tomato_sprout", "tomato_small", "tomato_growing", "tomato_ripe", "tomato_harvest_item", "wheat_sprout", "wheat_small", "wheat_growing", "wheat_ripe", "wheat_harvest_item", "corn_sprout", "corn_small", "corn_growing", "corn_ripe", "corn_harvest_item", "chicken_coop", "chicken_character", "egg_output_tray", "cow_station", "cow_character", "milk_output_can", "farm_tool_set"] as const;

function environmentAsset(id: string, category: AssetCategory, referenceImage: string): MarketAssetDefinition {
  const equipment = id.startsWith("equipment_");
  const interactive = equipment || id.includes("display") || id.includes("plot") || id.includes("station") || id.includes("coop") || id.includes("rack");
  return { id, referenceImages: [ref(referenceImage)], asset: `/models/market/environment/${id}.glb`, category, status: "approved", scaleMeters: [1, 1, 1], pivot: "centro de base en Y=0", attachmentBone: null,
    materials: ["cream", "ivory", "green", "dark", "metal", "glass", "wood", "soil"], animations: [], collider: interactive ? "cuboid compuesto documentado en StoreColliders" : "cuboid simple o sin collider", interaction: interactive ? "estado derivado de estación/InteractionZone" : "estructura o decoración",
    referenceNotes: `Modelo original reconstruido desde ${referenceImage}; conserva formas redondeadas y paleta crema, carbón y verde.`, };
}

const environment = [
  ...EXPOSURE_ASSET_IDS.map((id) => environmentAsset(id, "furniture", "MOBILIARIO2.png")),
  ...EQUIPMENT_ASSET_IDS.map((id) => environmentAsset(id, "equipment", "MOBILIARIO.png")),
  ...FARM_ASSET_IDS.map((id) => environmentAsset(id, "crop", "HUERTA.png")),
];

export const MARKET_ASSETS: readonly MarketAssetDefinition[] = [...characters, ...hair, ...hats, ...environment];
export const ASSET_REGISTRY = new Map(MARKET_ASSETS.map((asset) => [asset.id, asset]));

export function marketAsset(id: string) {
  const asset = ASSET_REGISTRY.get(id);
  if (!asset) throw new Error(`UNKNOWN_MARKET_ASSET:${id}`);
  return asset;
}
