namespace MiniMarket.Core
{
    /// The pace of the cast, in world units a second. Before this work a
    /// customer crossed the ground at 1.45 while the owner did 14.26, and the
    /// shop looked asleep around him.
    public static class Pace
    {
        // Raised with the cast on 6-9-2026, by the same 1.6725 the bodies grew:
        // the stride keeps the cadence that was tuned by eye, and the floor is
        // crossed in the same time as before.
        /// The owner walking.
        public const float Walk = 41.8f;
        /// The owner running. His alone: nobody else on the floor can.
        public const float Run = 48.5f;
        /// Shoppers.
        public const float Cast = 15.1f;
        /// Staff, who are working and move a little brisker than a shopper.
        public const float Staff = 18.4f;
    }
}
