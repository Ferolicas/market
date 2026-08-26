import { z } from "zod";
import type { GameEvent, GameState } from "@/game/types";

export const savePayloadSchema = z.object({
  expectedRevision: z.number().int().min(0),
  state: z.object({
    schemaVersion: z.literal(2),
    revision: z.number().int().min(0),
    countryCode: z.enum(["ES", "US", "CO", "MX", "AR", "CL", "PE"]),
    currency: z.string().min(3).max(3),
    balanceMinor: z.number().int().finite(),
    level: z.number().int().min(1).max(40),
    xp: z.number().int().min(0),
    avatar: z.object({
      body: z.enum(["adult-man", "adult-woman", "boy", "girl"]),
      hair: z.enum(["side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun", "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail"]),
      hairColor: z.string().regex(/^#[0-9a-f]{6}$/i),
      skin: z.string().regex(/^#[0-9a-f]{6}$/i),
      shirt: z.string().regex(/^#[0-9a-f]{6}$/i),
      hat: z.enum(["none", "red-panda", "red-fox", "chicken", "frog", "mouse", "elephant", "rhino", "giraffe", "panda", "owl", "cow", "rabbit", "axolotl", "capybara"]),
    }),
    franchises: z.array(z.unknown()).min(1).max(20),
    pendingOrders: z.array(z.unknown()).max(200),
  }).passthrough(),
  events: z.array(z.object({
    category: z.string().min(1).max(40),
    description: z.string().min(1).max(160),
    amountMinor: z.number().int().finite(),
  })).max(100).default([]),
});

export type ValidSavePayload = Omit<z.infer<typeof savePayloadSchema>, "state" | "events"> & {
  state: GameState;
  events: GameEvent[];
};
