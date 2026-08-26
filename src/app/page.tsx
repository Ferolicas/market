"use client";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { GameShell } from "@/components/game/GameShell";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <div className="game-loading"><div className="loading-shop">🏪</div><strong>Cargando Mini Market…</strong></div>;
  if (!data?.user) return <AuthScreen />;
  return <GameShell playerName={data.user.name || data.user.email.split("@")[0]} />;
}
