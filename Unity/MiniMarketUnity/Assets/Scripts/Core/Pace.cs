namespace MiniMarket.Core
{
    /// One pace for the whole cast. Customers and staff walk at exactly the
    /// speed the owner walks; only the owner can break into a run. Before this
    /// a customer crossed the ground at 1.45 while the owner did 14.26, which
    /// is why the shop looked asleep around a sprinting player.
    public static class Pace
    {
        /// Two fifths above the 14.26 that was tuned for the smaller shop.
        public const float Walk = 19.964f;
        /// A fifth above walking, and the owner's alone.
        public const float Run = Walk * 1.2f;
    }
}
