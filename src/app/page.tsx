"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { LoadingCurtain } from "@/components/game/LoadingCurtain";
import { authClient } from "@/lib/auth-client";
import { hasRecoverySnapshotHint } from "@/game/persistence/RecoveryStorage";

const OFFLINE_PLAYER_KEY = "mini-market-offline-player-v1";

// One opening card from the first paint to the store: the session check, the
// engine download and the game shell's own sync all show the same curtain, so
// the player never sees a placeholder screen replaced by a second design.
const LOADING_TITLE = "Preparando la tienda…";

const GameShell = dynamic(
  () => import("@/components/game/GameShell").then((module) => module.GameShell),
  {
    ssr: false,
    loading: () => <LoadingCurtain title={LOADING_TITLE} detail="Cargando el motor 3D" />,
  },
);

export default function Home() {
  const { data, isPending } = authClient.useSession();
  const [offlinePlayer, setOfflinePlayer] = useState<string | null>(null);
  const [offlineChecked, setOfflineChecked] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!navigator.onLine) {
        setOfflinePlayer(hasRecoverySnapshotHint() ? localStorage.getItem(OFFLINE_PLAYER_KEY) : null);
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

  if (isPending && !offlinePlayer) return <LoadingCurtain title={LOADING_TITLE} detail="Comprobando tu sesión" />;
  if (!data?.user && offlinePlayer) return <GameShell playerName={offlinePlayer} />;
  if (!data?.user && !offlineChecked) return <LoadingCurtain title={LOADING_TITLE} detail="Comprobando tu partida local" />;
  if (!data?.user) return <AuthScreen />;
  return <GameShell playerName={data.user.name || data.user.email.split("@")[0]} />;
}
