using UnityEngine;

namespace MiniMarket.Store
{
    /// <summary>
    /// Keeps the supplied solid facade visible from the street, but removes it
    /// from the isometric sightline while the controlled character is inside.
    /// Physics is authored separately, so navigation and the automatic-door
    /// trigger never change with the presentation cutaway.
    /// </summary>
    public sealed class StorefrontCameraCutaway : MonoBehaviour
    {
        [SerializeField] float exteriorThresholdZ=15.3f;
        Renderer[] renderers;
        Transform player;
        bool? visible;

        void Awake()=>renderers=GetComponentsInChildren<Renderer>(true);

        void LateUpdate()
        {
            if(!player)
            {
                var candidate=GameObject.FindWithTag("Player");
                if(candidate)player=candidate.transform;
            }
            var shouldBeVisible=player&&player.position.z>=exteriorThresholdZ;
            if(visible==shouldBeVisible)return;
            visible=shouldBeVisible;
            foreach(var renderer in renderers)if(renderer)renderer.enabled=shouldBeVisible;
        }
    }
}
