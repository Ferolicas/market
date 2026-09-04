using System;
using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Data
{
    public abstract class IdentifiedDefinition : ScriptableObject
    {
        public string id;
        public string displayName;
    }

    [CreateAssetMenu(menuName = "Mini Market/Product")]
    public sealed class ProductDefinition : IdentifiedDefinition
    {
        public long wholesaleMinor;
        public long saleMinor;
        public int shelfCapacity;
        public string supplierId;
        public string runtimeAssetId;
    }

    [CreateAssetMenu(menuName = "Mini Market/Furniture")]
    public sealed class FurnitureDefinition : IdentifiedDefinition
    {
        public string runtimeAssetId;
        public Vector3 dimensions;
        public Vector3 colliderCenter;
        public Vector3 colliderSize;
        public List<Vector3> productSlots = new();
    }

    [CreateAssetMenu(menuName = "Mini Market/Upgrade")]
    public sealed class UpgradeDefinition : IdentifiedDefinition
    {
        public int unlockLevel;
        public long baseCostMinor;
        public string unlockedArea;
    }

    [CreateAssetMenu(menuName = "Mini Market/Customer")]
    public sealed class CustomerDefinition : IdentifiedDefinition
    {
        public string characterId;
        public float basePatienceSeconds = 20f;
        public int maximumProductTypes = 3;
    }

    [Serializable]
    public struct RecipeIngredient { public string productId; public int quantity; }

    [CreateAssetMenu(menuName = "Mini Market/Production Recipe")]
    public sealed class ProductionRecipe : IdentifiedDefinition
    {
        public List<RecipeIngredient> ingredients = new();
        public string outputProductId;
        public int outputQuantity = 1;
        public float seconds = 5f;
    }

    [CreateAssetMenu(menuName = "Mini Market/Farm Crop")]
    public sealed class FarmCropDefinition : IdentifiedDefinition
    {
        public float growthSeconds = 6f;
        public int baseYield = 3;
        public string runtimeAssetId;
    }
}

