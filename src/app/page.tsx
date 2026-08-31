"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { authClient } from "@/lib/auth-client";

const OFFLINE_PLAYER_KEY = "mini-market-offline-player-v1";

const GameShell = dynamic(
  () => import("@/components/game/GameShell").then((module) => module.GameShell),
  {
    ssr: false,
    loading: () => <GameLoading label="Preparando el motor 3D…" />,
  },
);

export default function Home() {
  const { data, isPending } = authClient.useSession();
  const [offlinePlayer, setOfflinePlayer] = useState<string | null>(null);
  const [offlineChecked, setOfflineChecked] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!navigator.onLine) {
        const recovery = localStorage.getItem("mini-market-recovery-v1");
        setOfflinePlayer(recovery ? localStorage.getItem(OFFLINE_PLAYER_KEY) : null);
        setOfflineChecked(true);
        return;
      }
      if (data?.user) {
        const playerName = data.user.name || data.user.email.split("@")[0];
        localStorage.setItem(OFFLINE_PLAYER_KEY, playerName);
        setOfflinePlayer(null);
        setOfflineChecked(true);
        return;
      }
      if (!isPending) {
        setOfflinePlayer(null);
        setOfflineChecked(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [data?.user, isPending]);

  if (isPending && !offlinePlayer) return <GameLoading label="Cargando Mini Market…" />;
  if (!data?.user && offlinePlayer) return <GameShell playerName={offlinePlayer} />;
  if (!data?.user && !offlineChecked) return <GameLoading label="Comprobando tu partida local…" />;
  if (!data?.user) return <AuthScreen />;
  return <GameShell playerName={data.user.name || data.user.email.split("@")[0]} />;
}

function GameLoading({ label }: { label: string }) {
  return <div className="game-loading"><div className="loading-shop">🏪</div><strong>{label}</strong></div>;
}
