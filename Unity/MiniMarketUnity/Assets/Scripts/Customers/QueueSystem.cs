using System;
using System.Collections.Generic;

namespace MiniMarket.Customers
{
    public sealed class QueueSystem
    {
        readonly string[] slots;
        public QueueSystem(int count) => slots = new string[Math.Max(1, count)];
        public int Capacity => slots.Length;
        public int Count { get { var count=0;foreach(var value in slots)if(!string.IsNullOrEmpty(value))count++;return count; } }

        public int Reserve(string customerId)
        {
            var existing = PositionOf(customerId);
            if (existing >= 0) return existing;
            for (var i = 0; i < slots.Length; i++)
                if (string.IsNullOrEmpty(slots[i])) { slots[i] = customerId; return i; }
            return -1;
        }

        public bool Release(string customerId)
        {
            var index = PositionOf(customerId);
            if (index < 0) return false;
            slots[index] = null;
            Advance();
            return true;
        }

        public int PositionOf(string id)
        {
            for (var i = 0; i < slots.Length; i++) if (slots[i] == id) return i;
            return -1;
        }

        public string First => slots[0];
        public IReadOnlyList<string> Snapshot => slots;

        void Advance()
        {
            var write = 0;
            for (var read = 0; read < slots.Length; read++)
            {
                if (string.IsNullOrEmpty(slots[read])) continue;
                var value = slots[read]; slots[read] = null; slots[write++] = value;
            }
        }
    }
}
