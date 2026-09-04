using System.Runtime.InteropServices;
using UnityEngine;

namespace MiniMarket.Networking
{
    public static class WebSessionBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void MiniMarketLogout();
#endif
        public static void Logout()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            MiniMarketLogout();
#else
            Debug.Log("MINIMARKET_LOGOUT disponible en la build Web");
#endif
        }
    }
}
