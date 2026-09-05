namespace MiniMarket.Core
{
    /// The pace of the cast, in world units a second. Before this work a
    /// customer crossed the ground at 1.45 while the owner did 14.26, and the
    /// shop looked asleep around him.
    public static class Pace
    {
        /// The owner walking.
        public const float Walk = 25f;
        /// The owner running. His alone: nobody else on the floor can.
        public const float Run = 29f;
        /// Shoppers.
        public const float Cast = 9f;
        /// Staff, who are working and move a little brisker than a shopper.
        public const float Staff = 11f;
    }
}
