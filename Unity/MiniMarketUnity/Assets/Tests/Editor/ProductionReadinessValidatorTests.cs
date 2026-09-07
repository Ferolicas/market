using NUnit.Framework;
using MiniMarket.Editor;

namespace MiniMarket.EditorTests
{
    public sealed class ProductionReadinessValidatorTests
    {
        [Test]
        public void ProjectCatalogAndMobileSettingsPassProductionValidator()
            =>Assert.DoesNotThrow(ProductionReadinessValidator.ValidateForCi);
    }
}
