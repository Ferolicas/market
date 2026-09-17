import { describe, expect, it } from "vitest";
import { newCustomerPayments } from "./PaymentCue";

describe("cobro de clientes", () => {
  it("cuenta los clientes que pagaron en la tienda visitada", () => {
    expect(newCustomerPayments({ franchiseId: "madrid", customersToday: 4 }, { franchiseId: "madrid", customersToday: 6 })).toBe(2);
  });
  it("no suena al cargar, al viajar ni cuando el nuevo día pone el contador a cero", () => {
    expect(newCustomerPayments(null, { franchiseId: "madrid", customersToday: 9 })).toBe(0);
    expect(newCustomerPayments({ franchiseId: "madrid", customersToday: 2 }, { franchiseId: "sevilla", customersToday: 7 })).toBe(0);
    expect(newCustomerPayments({ franchiseId: "madrid", customersToday: 12 }, { franchiseId: "madrid", customersToday: 0 })).toBe(0);
    expect(newCustomerPayments({ franchiseId: "madrid", customersToday: 5 }, { franchiseId: "madrid", customersToday: 5 })).toBe(0);
  });
});
