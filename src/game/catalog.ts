import type { CountryCode, CountryDefinition, EmployeeRole, HatId, ProductId } from "./types";

export const COUNTRIES: Record<CountryCode, CountryDefinition> = {
  ES: { code: "ES", name: "España", currency: "EUR", locale: "es-ES", corporateTaxRate: 0.25, salesTaxRate: 0.21, payrollBurdenRate: 0.31, startingCapitalMinor: 220000 },
  US: { code: "US", name: "Estados Unidos", currency: "USD", locale: "en-US", corporateTaxRate: 0.21, salesTaxRate: 0.07, payrollBurdenRate: 0.153, startingCapitalMinor: 250000 },
  CO: { code: "CO", name: "Colombia", currency: "COP", locale: "es-CO", corporateTaxRate: 0.35, salesTaxRate: 0.19, payrollBurdenRate: 0.30, startingCapitalMinor: 900000000 },
  MX: { code: "MX", name: "México", currency: "MXN", locale: "es-MX", corporateTaxRate: 0.30, salesTaxRate: 0.16, payrollBurdenRate: 0.28, startingCapitalMinor: 4200000 },
  AR: { code: "AR", name: "Argentina", currency: "ARS", locale: "es-AR", corporateTaxRate: 0.35, salesTaxRate: 0.21, payrollBurdenRate: 0.29, startingCapitalMinor: 380000000 },
  CL: { code: "CL", name: "Chile", currency: "CLP", locale: "es-CL", corporateTaxRate: 0.27, salesTaxRate: 0.19, payrollBurdenRate: 0.24, startingCapitalMinor: 180000000 },
  PE: { code: "PE", name: "Perú", currency: "PEN", locale: "es-PE", corporateTaxRate: 0.295, salesTaxRate: 0.18, payrollBurdenRate: 0.23, startingCapitalMinor: 780000 },
};

export const PRODUCTS: Record<ProductId, { name: string; emoji: string; wholesaleMinor: number; saleMinor: number; supplier: string }> = {
  wheat: { name: "Trigo", emoji: "🌾", wholesaleMinor: 70, saleMinor: 110, supplier: "campo" },
  flour: { name: "Harina", emoji: "🥣", wholesaleMinor: 120, saleMinor: 210, supplier: "campo" },
  bread: { name: "Pan", emoji: "🥖", wholesaleMinor: 180, saleMinor: 350, supplier: "panal" },
  milk: { name: "Leche", emoji: "🥛", wholesaleMinor: 130, saleMinor: 260, supplier: "fresco" },
  eggs: { name: "Huevos", emoji: "🥚", wholesaleMinor: 160, saleMinor: 310, supplier: "fresco" },
  apples: { name: "Manzanas", emoji: "🍎", wholesaleMinor: 90, saleMinor: 190, supplier: "fresco" },
  tomatoes: { name: "Tomates", emoji: "🍅", wholesaleMinor: 80, saleMinor: 175, supplier: "fresco" },
  coffee: { name: "Café", emoji: "☕", wholesaleMinor: 280, saleMinor: 540, supplier: "andes" },
  juice: { name: "Zumo", emoji: "🧃", wholesaleMinor: 170, saleMinor: 330, supplier: "fresco" },
};

export const SUPPLIERS = [
  { id: "campo", name: "Campo Cercano", leadMinutes: 80, discount: 0, unlockLevel: 1 },
  { id: "fresco", name: "Ruta Fresca", leadMinutes: 110, discount: 0.04, unlockLevel: 2 },
  { id: "panal", name: "Panal Mayorista", leadMinutes: 65, discount: 0.07, unlockLevel: 5 },
  { id: "andes", name: "Origen Andes", leadMinutes: 140, discount: 0.11, unlockLevel: 9 },
] as const;

export const ROLE_INFO: Record<EmployeeRole, { name: string; salaryMinor: number; unlockLevel: number; description: string }> = {
  farmer: { name: "Granjero", salaryMinor: 2800, unlockLevel: 2, description: "Cultiva trigo y lleva materia prima." },
  operator: { name: "Operario", salaryMinor: 3200, unlockLevel: 4, description: "Carga molinos y hornos." },
  stocker: { name: "Reponedor", salaryMinor: 3000, unlockLevel: 3, description: "Surte todas las estanterías." },
  cashier: { name: "Cajero", salaryMinor: 3400, unlockLevel: 5, description: "Atiende cobros y métodos de pago." },
  builder: { name: "Constructor", salaryMinor: 4200, unlockLevel: 7, description: "Reduce el coste de ampliaciones." },
  manager: { name: "Gerente", salaryMinor: 5600, unlockLevel: 12, description: "Coordina el negocio cuando viajas." },
};

export const HATS: { id: HatId; name: string; emoji: string; color: string }[] = [
  { id: "red-panda", name: "Panda rojo", emoji: "🦊", color: "#b84f2f" },
  { id: "red-fox", name: "Zorro rojo", emoji: "🦊", color: "#e26436" },
  { id: "chicken", name: "Gallina", emoji: "🐔", color: "#fff1c9" },
  { id: "frog", name: "Sapo", emoji: "🐸", color: "#70b85d" },
  { id: "mouse", name: "Ratón", emoji: "🐭", color: "#9c91a8" },
  { id: "elephant", name: "Elefante", emoji: "🐘", color: "#84a2ad" },
  { id: "giraffe", name: "Jirafa", emoji: "🦒", color: "#e3a945" },
  { id: "owl", name: "Búho", emoji: "🦉", color: "#7d5d42" },
  { id: "axolotl", name: "Ajolote", emoji: "🩷", color: "#f18eb6" },
  { id: "capybara", name: "Capibara", emoji: "🤎", color: "#9a6d4d" },
];

export const FRANCHISE_TEMPLATES = [
  { id: "barrio", name: "Mercado del Barrio", city: "Distrito inicial", unlockLevel: 1, purchaseCostMinor: 0 },
  { id: "estacion", name: "Market Estación", city: "Centro", unlockLevel: 5, purchaseCostMinor: 850000 },
  { id: "marina", name: "Market Marina", city: "Zona costera", unlockLevel: 10, purchaseCostMinor: 2200000 },
  { id: "aeropuerto", name: "Market Terminal", city: "Aeropuerto", unlockLevel: 16, purchaseCostMinor: 5800000 },
  { id: "campus", name: "Market Campus", city: "Ciudad universitaria", unlockLevel: 24, purchaseCostMinor: 14500000 },
  { id: "megastore", name: "Olcas Mega Market", city: "Distrito financiero", unlockLevel: 32, purchaseCostMinor: 42000000 },
] as const;

export const EMPLOYEE_NAMES = ["Luna", "Mateo", "Sofía", "Leo", "Emma", "Nico", "Vera", "Bruno", "Mía", "Teo", "Alma", "Gael"];
