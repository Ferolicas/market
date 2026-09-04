using System;

namespace MiniMarket.Core
{
    public sealed class GameSignals
    {
        public event Action StateChanged;
        public event Action<string> Notification;
        public event Action<string, int> InventoryChanged;
        public event Action<long> BalanceChanged;
        public event Action<int> DayChanged;

        public void PublishStateChanged() => StateChanged?.Invoke();
        public void PublishNotification(string message) => Notification?.Invoke(message);
        public void PublishInventory(string productId, int quantity) => InventoryChanged?.Invoke(productId, quantity);
        public void PublishBalance(long balanceMinor) => BalanceChanged?.Invoke(balanceMinor);
        public void PublishDay(int day) => DayChanged?.Invoke(day);
    }
}

