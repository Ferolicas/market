namespace MiniMarket.Interactions
{
    /// Port of Next's WorkstationController. Entering a workstation consumes
    /// the movement that brought the player there; once the input returns to
    /// neutral, a new deliberate movement cancels the activity and lets them
    /// leave. Zone ids are Unity's own interaction prefixes; only "checkout"
    /// is guaranteed to read the same as Next's WorkstationId vocabulary so
    /// far, which is all the camera rig consumes today.
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

        /// "checkout:1" and "stock:tomatoes" collapse to the station they act
        /// on, matching how Next keys zones by workstation rather than target.
        public static string ZoneOf(string interactionId)
        {
            if (string.IsNullOrEmpty(interactionId)) return null;
            var separator = interactionId.IndexOf(':');
            return separator < 0 ? interactionId : interactionId[..separator];
        }
    }
}
