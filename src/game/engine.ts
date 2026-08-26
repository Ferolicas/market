import { COUNTRIES, EMPLOYEE_NAMES, FRANCHISE_TEMPLATES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "./catalog";
import type { ActionResult, AvatarConfig, CountryCode, Employee, FranchiseState, GameAction, GameEvent, GameState, Inventory, Mission, ProductId } from "./types";

const EMPTY_INVENTORY = (): Inventory => ({ wheat: 0, flour: 0, bread: 0, milk: 0, eggs: 0, apples: 0, tomatoes: 0, coffee: 0, juice: 0 });
export const DEFAULT_AVATAR: AvatarConfig = { body: "adult-man", hair: "side-part", hairColor: "#332b27", skin: "#bd815f", shirt: "#76aee5", hat: "red-panda" };

export function createInitialGame(countryCode: CountryCode = "ES"): GameState {
  const country = COUNTRIES[countryCode];
  const moneyScale = countryMoneyScale(countryCode);
  const franchises = FRANCHISE_TEMPLATES.map((template, index): FranchiseState => ({
    ...template,
    purchaseCostMinor: Math.round(template.purchaseCostMinor * moneyScale),
    owned: index === 0,
    open: false,
    licenseActive: index === 0,
    licenseDaysLeft: index === 0 ? 7 : 0,
    expansionLevel: 1,
    shelvesLevel: 1,
    checkoutLevel: 1,
    warehouse: { ...EMPTY_INVENTORY(), milk: index === 0 ? 8 : 0, eggs: index === 0 ? 6 : 0, apples: index === 0 ? 8 : 0 },
    shelves: EMPTY_INVENTORY(),
    machines: { flourMillLevel: 1, bakeryLevel: 1, flourQueue: 0, breadQueue: 0 },
    employees: [],
    revenueTodayMinor: 0,
    expensesTodayMinor: 0,
    customersToday: 0,
    rating: 3.5,
  }));

  return {
    schemaVersion: 2,
    revision: 0,
    countryCode,
    currency: country.currency,
    balanceMinor: country.startingCapitalMinor,
    level: 1,
    xp: 0,
    reputation: 0,
    day: 1,
    minuteOfDay: 7 * 60 + 30,
    currentFranchiseId: franchises[0].id,
    avatar: { ...DEFAULT_AVATAR },
    franchises,
    missions: missionsForDay(1, moneyScale),
    pendingOrders: [],
    finances: { grossRevenueMinor: 0, costOfGoodsMinor: 0, payrollMinor: 0, operatingCostsMinor: 0, taxesMinor: 0, netProfitMinor: 0 },
    tutorialStep: 0,
    lastSavedAt: new Date(0).toISOString(),
  };
}

export function normalizeGameState(input: unknown): GameState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return createInitialGame();
  const state = structuredClone(input) as Omit<GameState, "schemaVersion" | "avatar"> & {
    schemaVersion?: number;
    avatar?: Partial<AvatarConfig>;
  };
  state.schemaVersion = 2;
  state.avatar = { ...DEFAULT_AVATAR, ...state.avatar };
  return state as GameState;
}

export function applyGameAction(input: GameState, action: GameAction): ActionResult {
  const state = structuredClone(input);
  const events: GameEvent[] = [];
  const franchise = currentFranchise(state);
  const fail = (message: string): ActionResult => ({ state: input, ok: false, message, events: [] });
  const success = (message: string): ActionResult => {
    state.revision += 1;
    normalizeLevel(state);
    return { state, ok: true, message, events };
  };

  switch (action.type) {
    case "SET_COUNTRY": {
      if (state.day > 1 || state.finances.grossRevenueMinor > 0) return fail("El país fiscal queda fijado al iniciar la empresa.");
      const oldStart = COUNTRIES[state.countryCode].startingCapitalMinor;
      const country = COUNTRIES[action.countryCode];
      const ratio = country.startingCapitalMinor / oldStart;
      state.countryCode = country.code;
      state.currency = country.currency;
      state.balanceMinor = Math.round(state.balanceMinor * ratio);
      state.franchises.forEach((item) => { item.purchaseCostMinor = Math.round(item.purchaseCostMinor * ratio); });
      state.missions.forEach((item) => { item.rewardMinor = Math.round(item.rewardMinor * ratio); });
      state.tutorialStep = 1;
      return success(`Empresa registrada en ${country.name}.`);
    }
    case "SET_AVATAR": {
      if (action.body !== undefined) state.avatar.body = action.body;
      if (action.hair !== undefined) state.avatar.hair = action.hair;
      if (action.hairColor !== undefined) state.avatar.hairColor = action.hairColor;
      if (action.skin !== undefined) state.avatar.skin = action.skin;
      if (action.shirt !== undefined) state.avatar.shirt = action.shirt;
      if (action.hat !== undefined) state.avatar.hat = action.hat;
      return success("Avatar actualizado.");
    }
    case "TOGGLE_STORE":
      if (!franchise.licenseActive) return fail("Necesitas una licencia comercial activa.");
      franchise.open = !franchise.open;
      return success(franchise.open ? "Tienda abierta: ¡a trabajar!" : "Tienda cerrada al público.");
    case "HARVEST":
      franchise.warehouse.wheat += 3 + franchise.expansionLevel;
      gain(state, 18, "harvest", 1);
      return success("Cosechaste trigo fresco.");
    case "LOAD_FLOUR_MILL":
      if (franchise.warehouse.wheat < 2) return fail("Faltan 2 unidades de trigo.");
      franchise.warehouse.wheat -= 2;
      franchise.machines.flourQueue += 2 * franchise.machines.flourMillLevel;
      franchise.warehouse.flour += franchise.machines.flourMillLevel;
      gain(state, 24, "production", 1);
      return success("El molino produjo harina.");
    case "BAKE_BREAD":
      if (franchise.warehouse.flour < 2) return fail("Faltan 2 unidades de harina.");
      franchise.warehouse.flour -= 2;
      franchise.warehouse.bread += 2 * franchise.machines.bakeryLevel;
      gain(state, 30, "production", 1);
      return success("Horneaste pan para la tienda.");
    case "STOCK": {
      const quantity = Math.max(1, Math.min(action.quantity ?? 3, franchise.warehouse[action.productId]));
      if (quantity <= 0) return fail(`No queda ${PRODUCTS[action.productId].name.toLowerCase()} en almacén.`);
      franchise.warehouse[action.productId] -= quantity;
      franchise.shelves[action.productId] += quantity;
      gain(state, 12 * quantity, "stock", quantity);
      return success(`Colocaste ${quantity} × ${PRODUCTS[action.productId].name}.`);
    }
    case "CHECKOUT": {
      if (!franchise.open) return fail("Abre la tienda antes de cobrar.");
      const productId = firstStocked(franchise.shelves);
      if (!productId) return fail("Las estanterías están vacías.");
      sellOne(state, franchise, productId, events);
      gain(state, 20, "customers", 1);
      return success(`Venta cobrada: ${PRODUCTS[productId].name}.`);
    }
    case "ORDER": {
      const product = PRODUCTS[action.productId];
      const supplier = SUPPLIERS.find((item) => item.id === action.supplierId);
      if (!supplier || supplier.unlockLevel > state.level || product.supplier !== supplier.id) return fail("Proveedor no disponible para ese producto.");
      const quantity = Math.max(1, Math.min(100, Math.floor(action.quantity)));
      const total = Math.round(product.wholesaleMinor * countryMoneyScale(state.countryCode) * quantity * (1 - supplier.discount));
      if (state.balanceMinor < total) return fail("No hay caja suficiente para este pedido.");
      state.balanceMinor -= total;
      franchise.expensesTodayMinor += total;
      state.finances.costOfGoodsMinor += total;
      state.pendingOrders.push({ id: crypto.randomUUID(), franchiseId: franchise.id, supplierId: supplier.id, productId: action.productId, quantity, totalMinor: total, arrivesAtMinute: state.minuteOfDay + supplier.leadMinutes });
      events.push({ category: "inventory", description: `Pedido de ${product.name}`, amountMinor: -total });
      return success(`Pedido confirmado. Entrega en ${supplier.leadMinutes} min del juego.`);
    }
    case "HIRE": {
      const info = ROLE_INFO[action.role];
      if (state.level < info.unlockLevel) return fail(`Se desbloquea en nivel ${info.unlockLevel}.`);
      const scaledSalary = Math.round(info.salaryMinor * countryMoneyScale(state.countryCode));
      const signingCost = scaledSalary * 2;
      if (state.balanceMinor < signingCost) return fail("Falta caja para contratación y alta.");
      state.balanceMinor -= signingCost;
      franchise.expensesTodayMinor += signingCost;
      const employee: Employee = { id: crypto.randomUUID(), name: EMPLOYEE_NAMES[franchise.employees.length % EMPLOYEE_NAMES.length], role: action.role, level: 1, salaryMinor: scaledSalary, energy: 100, hat: HATS[(franchise.employees.length + 1) % HATS.length].id };
      franchise.employees.push(employee);
      events.push({ category: "payroll", description: `Alta de ${employee.name} (${info.name})`, amountMinor: -signingCost });
      gain(state, 55, "stock", 0);
      return success(`${employee.name} se incorporó como ${info.name.toLowerCase()}.`);
    }
    case "UPGRADE": {
      const levels = { shelves: franchise.shelvesLevel, checkout: franchise.checkoutLevel, expansion: franchise.expansionLevel, mill: franchise.machines.flourMillLevel, bakery: franchise.machines.bakeryLevel };
      const current = levels[action.upgrade];
      const hasBuilder = franchise.employees.some((employee) => employee.role === "builder");
      const cost = Math.round(55000 * countryMoneyScale(state.countryCode) * current ** 1.65 * (hasBuilder ? 0.82 : 1));
      if (state.balanceMinor < cost) return fail("Caja insuficiente para constructores y mobiliario.");
      state.balanceMinor -= cost;
      franchise.expensesTodayMinor += cost;
      if (action.upgrade === "shelves") franchise.shelvesLevel++;
      if (action.upgrade === "checkout") franchise.checkoutLevel++;
      if (action.upgrade === "expansion") franchise.expansionLevel++;
      if (action.upgrade === "mill") franchise.machines.flourMillLevel++;
      if (action.upgrade === "bakery") franchise.machines.bakeryLevel++;
      events.push({ category: "capital", description: `Obra y mejora: ${action.upgrade}`, amountMinor: -cost });
      gain(state, 80, "production", 0);
      return success("Constructores terminaron la mejora.");
    }
    case "BUY_LICENSE": {
      const cost = Math.round(24000 * countryMoneyScale(state.countryCode) * (1 + franchise.expansionLevel));
      if (state.balanceMinor < cost) return fail("No hay caja para renovar la licencia.");
      state.balanceMinor -= cost;
      franchise.licenseActive = true;
      franchise.licenseDaysLeft += 14;
      events.push({ category: "license", description: "Licencia comercial (14 días)", amountMinor: -cost });
      return success("Licencia comercial renovada.");
    }
    case "BUY_FRANCHISE": {
      const target = state.franchises.find((item) => item.id === action.franchiseId);
      if (!target || target.owned) return fail("Franquicia no disponible.");
      if (state.level < target.unlockLevel) return fail(`Requiere nivel ${target.unlockLevel}.`);
      if (state.balanceMinor < target.purchaseCostMinor) return fail("Capital global insuficiente.");
      state.balanceMinor -= target.purchaseCostMinor;
      target.owned = true;
      target.licenseActive = true;
      target.licenseDaysLeft = 7;
      events.push({ category: "capital", description: `Apertura de ${target.name}`, amountMinor: -target.purchaseCostMinor });
      return success(`${target.name} ya forma parte de tu empresa.`);
    }
    case "TRAVEL": {
      const target = state.franchises.find((item) => item.id === action.franchiseId && item.owned);
      if (!target) return fail("Aún no eres dueño de esa franquicia.");
      state.currentFranchiseId = target.id;
      return success(`Viaje instantáneo a ${target.name}.`);
    }
    case "CLAIM_MISSION": {
      const mission = state.missions.find((item) => item.id === action.missionId);
      if (!mission?.completed || mission.claimed) return fail("La misión todavía no se puede cobrar.");
      mission.claimed = true;
      state.balanceMinor += mission.rewardMinor;
      events.push({ category: "mission", description: mission.label, amountMinor: mission.rewardMinor });
      return success("Recompensa ingresada en la caja global.");
    }
    case "CLOSE_DAY":
      return closeBusinessDay(state, events);
  }
}

export function advanceSimulation(input: GameState, minutes = 10): ActionResult {
  const state = structuredClone(input);
  const events: GameEvent[] = [];
  state.minuteOfDay += minutes;
  deliverOrders(state);

  for (const franchise of state.franchises.filter((item) => item.owned && item.open)) {
    const roles = new Set(franchise.employees.filter((employee) => employee.energy > 0).map((employee) => employee.role));
    if (roles.has("farmer")) franchise.warehouse.wheat += 1;
    if (roles.has("operator") && franchise.warehouse.wheat >= 2) {
      franchise.warehouse.wheat -= 2;
      franchise.warehouse.flour += franchise.machines.flourMillLevel;
    }
    if (roles.has("operator") && franchise.warehouse.flour >= 2) {
      franchise.warehouse.flour -= 2;
      franchise.warehouse.bread += franchise.machines.bakeryLevel;
    }
    if (roles.has("stocker")) {
      for (const productId of Object.keys(franchise.warehouse) as ProductId[]) {
        if (franchise.warehouse[productId] > 0 && franchise.shelves[productId] < 4 * franchise.shelvesLevel) {
          franchise.warehouse[productId]--;
          franchise.shelves[productId]++;
        }
      }
    }
    if (roles.has("cashier")) {
      const throughput = Math.max(1, Math.min(franchise.checkoutLevel, Math.ceil(minutes / 5)));
      for (let index = 0; index < throughput; index++) {
        const productId = firstStocked(franchise.shelves);
        if (!productId) break;
        sellOne(state, franchise, productId, events);
      }
    }
    franchise.employees.forEach((employee) => { employee.energy = Math.max(15, employee.energy - 0.15 * minutes); });
  }
  state.revision += 1;
  normalizeLevel(state);
  return { state, ok: true, message: "Simulación actualizada.", events };
}

function closeBusinessDay(state: GameState, events: GameEvent[]): ActionResult {
  const country = COUNTRIES[state.countryCode];
  const moneyScale = countryMoneyScale(state.countryCode);
  let payroll = 0;
  let operating = 0;
  let taxableProfit = 0;
  for (const franchise of state.franchises.filter((item) => item.owned)) {
    franchise.open = false;
    const basePayroll = franchise.employees.reduce((total, employee) => total + employee.salaryMinor, 0);
    const payrollCost = Math.round(basePayroll * (1 + country.payrollBurdenRate));
    const dailyOperating = Math.round((1900 * franchise.expansionLevel + 700 * franchise.checkoutLevel) * moneyScale);
    payroll += payrollCost;
    operating += dailyOperating;
    taxableProfit += franchise.revenueTodayMinor - franchise.expensesTodayMinor - payrollCost - dailyOperating;
    franchise.expensesTodayMinor = 0;
    franchise.revenueTodayMinor = 0;
    franchise.customersToday = 0;
    franchise.licenseDaysLeft = Math.max(0, franchise.licenseDaysLeft - 1);
    franchise.licenseActive = franchise.licenseDaysLeft > 0;
    franchise.employees.forEach((employee) => { employee.energy = 100; });
  }
  const tax = Math.max(0, Math.round(taxableProfit * country.corporateTaxRate));
  const total = payroll + operating + tax;
  state.balanceMinor -= total;
  state.finances.payrollMinor += payroll;
  state.finances.operatingCostsMinor += operating;
  state.finances.taxesMinor += tax;
  state.finances.netProfitMinor = state.finances.grossRevenueMinor - state.finances.costOfGoodsMinor - state.finances.payrollMinor - state.finances.operatingCostsMinor - state.finances.taxesMinor;
  events.push({ category: "payroll", description: "Nóminas y cargas laborales", amountMinor: -payroll });
  events.push({ category: "operations", description: "Alquileres, energía y mantenimiento", amountMinor: -operating });
  if (tax > 0) events.push({ category: "tax", description: `Provisión fiscal ${Math.round(country.corporateTaxRate * 100)}%`, amountMinor: -tax });
  state.day++;
  state.minuteOfDay = 7 * 60 + 30;
  state.missions = missionsForDay(state.day, moneyScale);
  state.revision++;
  return { state, ok: true, message: `Día ${state.day - 1} cerrado. Nóminas, operación e impuestos contabilizados.`, events };
}

function currentFranchise(state: GameState) {
  return state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
}

function firstStocked(inventory: Inventory): ProductId | undefined {
  return (Object.keys(inventory) as ProductId[]).find((productId) => inventory[productId] > 0);
}

function sellOne(state: GameState, franchise: FranchiseState, productId: ProductId, events: GameEvent[]) {
  const product = PRODUCTS[productId];
  const salePrice = Math.round(product.saleMinor * countryMoneyScale(state.countryCode));
  const salesTax = Math.round(salePrice * COUNTRIES[state.countryCode].salesTaxRate);
  const gross = salePrice + salesTax;
  franchise.shelves[productId]--;
  franchise.revenueTodayMinor += salePrice;
  franchise.customersToday++;
  state.balanceMinor += gross;
  state.finances.grossRevenueMinor += salePrice;
  state.reputation += 1;
  gain(state, 8, "sales", salePrice);
  events.push({ category: "sales", description: `Venta de ${product.name}`, amountMinor: gross });
}

function deliverOrders(state: GameState) {
  const delivered = state.pendingOrders.filter((order) => order.arrivesAtMinute <= state.minuteOfDay);
  for (const order of delivered) {
    const franchise = state.franchises.find((item) => item.id === order.franchiseId);
    if (franchise) franchise.warehouse[order.productId] += order.quantity;
  }
  state.pendingOrders = state.pendingOrders.filter((order) => order.arrivesAtMinute > state.minuteOfDay);
}

function gain(state: GameState, xp: number, missionKind: Mission["kind"], amount: number) {
  state.xp += xp;
  for (const mission of state.missions.filter((item) => item.kind === missionKind && !item.completed)) {
    mission.progress = Math.min(mission.target, mission.progress + amount);
    mission.completed = mission.progress >= mission.target;
  }
}

function normalizeLevel(state: GameState) {
  const calculated = Math.min(40, 1 + Math.floor(Math.sqrt(state.xp / 120)));
  state.level = Math.max(state.level, calculated);
}

function missionsForDay(day: number, moneyScale = 1): Mission[] {
  const scale = 1 + Math.floor(day / 3);
  return [
    { id: `d${day}-stock`, label: `Repón ${5 + scale * 2} productos`, kind: "stock", target: 5 + scale * 2, progress: 0, rewardMinor: Math.round(12000 * scale * moneyScale), completed: false, claimed: false },
    { id: `d${day}-customers`, label: `Atiende ${3 + scale} clientes`, kind: "customers", target: 3 + scale, progress: 0, rewardMinor: Math.round(16000 * scale * moneyScale), completed: false, claimed: false },
    { id: `d${day}-produce`, label: `Completa ${2 + scale} ciclos de producción`, kind: "production", target: 2 + scale, progress: 0, rewardMinor: Math.round(19000 * scale * moneyScale), completed: false, claimed: false },
  ];
}

export function formatMoney(amountMinor: number, state: Pick<GameState, "countryCode" | "currency">) {
  return new Intl.NumberFormat(COUNTRIES[state.countryCode].locale, { style: "currency", currency: state.currency, maximumFractionDigits: state.currency === "COP" || state.currency === "CLP" ? 0 : 2 }).format(amountMinor / 100);
}

export function countryMoneyScale(countryCode: CountryCode) {
  return COUNTRIES[countryCode].startingCapitalMinor / COUNTRIES.ES.startingCapitalMinor;
}
