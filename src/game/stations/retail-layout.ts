import type { ProductId } from "../types";

export type RetailDepartmentId = "bakery" | "pantry" | "eggs" | "produce" | "dairy" | "drinks";

export interface RetailDepartment {
  id: RetailDepartmentId;
  label: string;
  color: string;
  display: readonly [number, number, number];
  service: readonly [number, number];
  products: readonly ProductId[];
}

export const RETAIL_DEPARTMENTS: Record<RetailDepartmentId, RetailDepartment> = {
  // Service points stay on a generated NavMesh cell, outside the padded
  // furniture footprint. The interaction radius reaches the display from
  // that walkable lane; moving the sensor closer can make it unreachable.
  bakery: { id: "bakery", label: "PAN Y HARINAS", color: "#b96d39", display: [-4, 0, -2.2], service: [-4, -0.88], products: ["bread", "flour", "wheat"] },
  pantry: { id: "pantry", label: "DESPENSA", color: "#6f4938", display: [0, 0, -2.2], service: [0, -0.88], products: ["coffee"] },
  eggs: { id: "eggs", label: "HUEVOS", color: "#d49a34", display: [4, 0, -2.2], service: [4, -0.88], products: ["eggs"] },
  produce: { id: "produce", label: "FRUTAS Y VERDURAS", color: "#3f7b4c", display: [-4.1, 0, 2.45], service: [-4.1, 1.08], products: ["tomatoes", "apples", "corn"] },
  dairy: { id: "dairy", label: "LÁCTEOS", color: "#4382a1", display: [0, 0, 2.45], service: [0, 3.82], products: ["milk", "cheese"] },
  drinks: { id: "drinks", label: "BEBIDAS", color: "#cc6841", display: [4.05, 0, 2.45], service: [4.05, 3.82], products: ["juice"] },
};

export const PRODUCT_RETAIL_DEPARTMENT: Record<ProductId, RetailDepartmentId> = {
  tomatoes: "produce",
  apples: "produce",
  corn: "produce",
  eggs: "eggs",
  milk: "dairy",
  cheese: "dairy",
  juice: "drinks",
  bread: "bakery",
  flour: "bakery",
  wheat: "bakery",
  coffee: "pantry",
};

export function retailServicePoint(productId: ProductId): [number, number] {
  return [...RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]].service];
}

export function retailDisplayPosition(departmentId: RetailDepartmentId): [number, number, number] {
  return [...RETAIL_DEPARTMENTS[departmentId].display];
}
