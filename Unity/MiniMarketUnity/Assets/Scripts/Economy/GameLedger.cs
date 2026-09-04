using MiniMarket.Data;
using MiniMarket.Persistence;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Economy
{
    /// <summary>
    /// Single ledger boundary for the Unity client. Domain systems mutate the
    /// local snapshot and enqueue the matching idempotent server event.
    /// </summary>
    public sealed class GameLedger
    {
        readonly GameStateDocument state;
        readonly SaveCoordinator saves;

        public GameLedger(GameStateDocument document, SaveCoordinator coordinator)
        { state = document; saves = coordinator; }

        public void Record(string category, string description, long amountMinor,
            JObject franchise = null, string scope = "franchise")
        {
            var franchiseId = franchise?.Value<string>("id") ?? state.CurrentFranchise.Value<string>("id");
            saves?.QueueEvent(category, description, amountMinor, franchiseId, scope);
        }
    }
}
