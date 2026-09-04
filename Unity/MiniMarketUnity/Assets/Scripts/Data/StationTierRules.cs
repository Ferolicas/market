using System;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Data
{
    /// <summary>Exact port of src/game/progression/levels.ts stationTierModifiers.</summary>
    public static class StationTierRules
    {
        public static double Capacity(int tierInput)
        {
            var tier=Math.Clamp(tierInput,1,10);var value=1d;
            if(tier>=2)value+=.25;if(tier>=4)value+=.25;if(tier>=7)value+=.3;if(tier>=10)value+=.4;return value;
        }
        public static double Speed(int tierInput)
        {
            var tier=Math.Clamp(tierInput,1,10);var value=1d;
            if(tier>=3)value+=.15;if(tier>=5)value+=.2;if(tier>=8)value+=.2;if(tier>=10)value+=.15;return value;
        }
        public static double Value(int tierInput)
        {
            var tier=Math.Clamp(tierInput,1,10);var value=1d;if(tier>=6)value+=.08;if(tier>=9)value+=.1;return value;
        }
        public static int Tier(GameStateDocument state,string stationId,int fallback=1)
            =>Math.Clamp(state.CurrentFranchise["stationTiers"]?[stationId]?.Value<int?>()??fallback,1,10);
    }
}
