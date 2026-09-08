namespace MiniMarket.Interactions
{
    /// Port of Next's WorkstationController. Only genuinely stationary jobs
    /// consume movement. Shelves, crops and production machines are automatic
    /// magnets: crossing their sensor must never stop or slow the player.
    public sealed class WorkstationController
    {
        string zoneId;
        bool waitingForNeutral;
        bool cancelledUntilExit;

        public void Sync(string zone, float inputMagnitude)
        {
            if (zone == zoneId) return;
            zoneId = zone;
            cancelledUntilExit = false;
            waitingForNeutral = zone != null && inputMagnitude > .08f;
        }

        public bool UpdateInput(float inputMagnitude)
        {
            if (zoneId == null || cancelledUntilExit) return false;
            if (waitingForNeutral)
            {
                if (inputMagnitude <= .08f) waitingForNeutral = false;
                return true;
            }
            if (inputMagnitude >= .16f) { cancelledUntilExit = true; return false; }
            return true;
        }

        public bool CanPerform(string zone) => zoneId == zone && !cancelledUntilExit;
        public string PerformingZoneId() => zoneId != null && !cancelledUntilExit ? zoneId : null;
        public void Cancel(){zoneId=null;waitingForNeutral=false;cancelledUntilExit=false;}

        /// Mirrors Next's highestPriorityWorkstation: checkout and animal work
        /// are stationary; shelf and production/farm sensors remain pass-through.
        public static string ZoneOf(string interactionId)
        {
            if (string.IsNullOrEmpty(interactionId)) return null;
            if(interactionId.StartsWith("checkout:",System.StringComparison.Ordinal))return "checkout";
            if(interactionId=="animal:chicken")return "chicken";
            if(interactionId=="animal:cow")return "cow";
            return null;
        }
    }
}
