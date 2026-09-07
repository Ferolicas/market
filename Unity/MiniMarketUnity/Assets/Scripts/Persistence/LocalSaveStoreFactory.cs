namespace MiniMarket.Persistence
{
    public static class LocalSaveStoreFactory
    {
        public static ILocalSaveStore Create()
        {
#if UNITY_WEBGL || UNITY_EDITOR
            return new PlayerPrefsLocalSaveStore();
#else
            return new NativeAtomicFileSaveStore();
#endif
        }
    }
}
