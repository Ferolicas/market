export interface LevelDefinition { level: number; costMinor: number; objective: string; unlock: string; }

const levelData: [number, string, string][] = [
  [0, "Cosecha 3 tomates, surte 3 y cobra 1 cliente", "Tomate, mesa y caja"], [4_000, "Completa el tutorial", "Segundo cultivo y +2 sockets"], [8_000, "Atiende 4 clientes", "Capacidad 5 y cola 4"],
  [14_000, "Surte 12 productos", "Ampliación y trigo"], [22_000, "Cosecha 6 trigos", "Molino y harina"], [32_000, "Vende 4 panes", "Horno y panadería"],
  [48_000, "Atiende 12 clientes", "Caja 0,34 s"], [65_000, "Vende 8 huevos", "Gallinero y huevos"], [85_000, "Mantén stock 80 %", "Reponedor"], [110_000, "Completa 20 ventas", "Ampliación lateral y rango 2"],
  [140_000, "Cosecha 20 maíces", "Maíz y mesa"], [180_000, "Camina 500 m", "Velocidad +8 %"], [230_000, "Vende 12 leches", "Vaca y refrigerador"], [290_000, "Atiende 30 clientes", "Cajero"], [370_000, "Transporta 40 unidades", "Capacidad 8"],
  [460_000, "Produce 10 quesos", "Quesera"], [580_000, "Reduce espera bajo 30 s", "Segunda caja"], [720_000, "Recibe 5 entregas", "Almacén y muelle"], [890_000, "Completa 8 pedidos", "Proveedores"], [1_100_000, "Atiende 50 clientes", "Ampliación trasera y rango 3"],
  [1_350_000, "Vende 15 zumos", "Máquina de zumo"], [1_650_000, "Cosecha 60 productos", "Granjero"], [2_000_000, "Mantén satisfacción 85 %", "Luces y fachada"], [2_400_000, "Surte 100 unidades", "Capacidad 12 y estantes tier 3"], [2_900_000, "Completa listas de 5 productos", "Listas y gestos"],
  [3_500_000, "Produce 50 lotes", "Operador"], [4_200_000, "Vende 150 unidades", "Tercera zona y endcap"], [5_000_000, "Mejora todas las estaciones", "Fríos, puertas y caja premium"], [6_000_000, "50 ventas con disponibilidad ≥90 %", "Objetivo de satisfacción"], [7_500_000, "Completa todos los hitos", "Rango 4, fachada y franquicia"],
];

export const LEVELS: LevelDefinition[] = levelData.map(([costMinor, objective, unlock], index) => ({ level: index + 1, costMinor, objective, unlock }));

export function stationTierModifiers(tierInput: number) {
  const tier = Math.max(1, Math.min(10, Math.floor(tierInput)));
  let capacity = 1; let speed = 1; let value = 1;
  if (tier >= 2) capacity += 0.25; if (tier >= 3) speed += 0.15; if (tier >= 4) capacity += 0.25; if (tier >= 5) speed += 0.2;
  if (tier >= 6) value += 0.08; if (tier >= 7) capacity += 0.3; if (tier >= 8) speed += 0.2; if (tier >= 9) value += 0.1;
  if (tier >= 10) { capacity += 0.4; speed += 0.15; }
  const exact = (valueToRound: number) => Math.round(valueToRound * 10_000) / 10_000;
  return { capacity: exact(capacity), speed: exact(speed), value: exact(value) };
}
