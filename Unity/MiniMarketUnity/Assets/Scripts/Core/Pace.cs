namespace MiniMarket.Core
{
    /// The pace of the cast. Before this a customer crossed the ground at 1.45
    /// while the owner did 14.26, and the shop looked asleep around him.
    public static class Pace
    {
        /// The owner walking: two fifths above the 14.26 tuned for the small shop.
        public const float Walk = 19.964f;
        /// The owner running, a fifth above his walk. His alone.
        public const float Run = Walk * 1.2f;
        /// Customers and staff. It is the fastest the walk clip carries a body
        /// of this size without the feet slipping -- at the owner's own pace
        /// they crossed the crossover into the run clip and read as sprinting,
        /// which is not what a shopper does. Eight times what they did before,
        /// and a good half under the owner, who stays the quickest on the floor.
        public const float Cast = 11f;
    }
}
