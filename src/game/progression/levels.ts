export interface LevelDefinition { level: number; costMinor: number; unlock: string; }

// Objective copy and progress live exclusively in objectives.ts. Keeping a
// second copy here previously allowed the level list and the real gate to
// describe different work.
const levelData: [number, string][] = [
  [0, "Tomate, mesa y caja"], [4_000, "Segundo tomate, manzano y demanda de manzanas"], [8_000, "Capacidad 5 y hasta 4 clientes"],
  [14_000, "Ampliación y trigo"], [22_000, "Molino y harina"], [32_000, "Horno y panadería"],
  [48_000, "Caja más rápida"], [65_000, "Gallinero y huevos"], [85_000, "Reponedor"], [110_000, "Ampliación lateral y rango 2"],
  [140_000, "Maíz y mesa"], [180_000, "Velocidad +8 %"], [230_000, "Vaca y refrigerador"], [290_000, "Cajero"], [370_000, "Capacidad 8"],
  [460_000, "Quesera"], [580_000, "Segunda caja"], [720_000, "Almacén y muelle"], [890_000, "Hito de proveedores"], [1_100_000, "Ampliación trasera y rango 3"],
  [1_350_000, "Máquina de zumo"], [1_650_000, "Granjero"], [2_000_000, "Luces y fachada"], [2_400_000, "Capacidad 12 y estantes T3"], [2_900_000, "Listas y gestos"],
  [3_500_000, "Operador"], [4_200_000, "Tercera zona y endcap"], [5_000_000, "Fríos, puertas y caja premium"], [6_000_000, "Último hito operativo"], [7_500_000, "Rango 4, fachada y franquicia"],
];

export const LEVELS: LevelDefinition[] = levelData.map(([costMinor, unlock], index) => ({ level: index + 1, costMinor, unlock }));

export function buildFundingQuote(
  balanceMinor: number,
  project: { costMinor: number; contributedMinor: number; completed: boolean },
) {
  const costMinor = Math.max(0, Math.floor(Number.isFinite(project.costMinor) ? project.costMinor : 0));
  const contributedMinor = Math.min(costMinor, Math.max(0, Math.floor(Number.isFinite(project.contributedMinor) ? project.contributedMinor : 0)));
  const remainingMinor = project.completed ? 0 : Math.max(0, costMinor - contributedMinor);
  const availableMinor = Math.max(0, Math.floor(Number.isFinite(balanceMinor) ? balanceMinor : 0));
  return {
    costMinor,
    contributedMinor,
    remainingMinor,
    contributionMinor: Math.min(availableMinor, remainingMinor),
    completed: project.completed || remainingMinor === 0,
  };
}

export function stationTierModifiers(tierInput: number) {
  const tier = Math.max(1, Math.min(5, Math.floor(Number.isFinite(tierInput) ? tierInput : 1)));
  const multiplier = 1 + (tier - 1) * 0.25;
  return { capacity: multiplier, speed: multiplier, value: 1 };
}
