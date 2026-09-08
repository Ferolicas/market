using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace MiniMarket.Interactions
{
    [RequireComponent(typeof(SphereCollider))]
    public sealed class InteractionPoint : MonoBehaviour
    {
        public string interactionId;
        public string label;
        public float range = 1.8f;
        public bool automatic = true;
        public bool repeatAutomatically = true;
        public float dwellSeconds = .08f;
        public float repeatSeconds = .22f;
        public event Action<InteractionPoint> Activated;
        Vector2 areaHalfExtents;
        bool area;
        readonly List<Vector3> approachOffsets=new();
        readonly Dictionary<int,int> approachClaims=new();

        public bool HasArea => area;
        public Vector2 AreaHalfExtents => areaHalfExtents;

        public void Configure(string id, string displayLabel, float radius = 1.8f, bool activateAutomatically = true, float dwell = .08f, float repeat = .22f)
        {
            interactionId = id; label = displayLabel; range = radius;automatic=activateAutomatically;dwellSeconds=Mathf.Max(0,dwell);repeatSeconds=Mathf.Max(.05f,repeat);
            var trigger = GetComponent<SphereCollider>();
            trigger.isTrigger = true; trigger.radius = radius;
        }

        /// A rounded rectangle in world X/Z. Large fixtures and farm plots need
        /// reach measured outwards from their visible edge; a small sphere at
        /// the pivot can sit inside the solid collider and never be reachable.
        public void ConfigureArea(string id, string displayLabel, Vector2 halfExtents, float reach,
            bool activateAutomatically = true, float dwell = .08f, float repeat = .22f)
        {
            area = true;
            areaHalfExtents = new Vector2(Mathf.Max(0, halfExtents.x), Mathf.Max(0, halfExtents.y));
            Configure(id, displayLabel, Mathf.Max(.05f, reach), activateAutomatically, dwell, repeat);
            var trigger = GetComponent<SphereCollider>();
            trigger.radius = areaHalfExtents.magnitude + range;
            BuildApproachSlots();
        }

        public float DistanceSquared(Vector3 worldPosition)
        {
            var delta = worldPosition - transform.position;
            if (!area) return delta.sqrMagnitude;
            var x = Mathf.Max(0, Mathf.Abs(delta.x) - areaHalfExtents.x);
            var z = Mathf.Max(0, Mathf.Abs(delta.z) - areaHalfExtents.y);
            return x * x + delta.y * delta.y + z * z;
        }

        public void Activate() => Activated?.Invoke(this);

        /// Claims the nearest free place around the complete four-sided
        /// perimeter. Customers and workers therefore spread along a fixture
        /// instead of all walking into one authored service-point transform.
        public Vector3 ClaimApproach(int actorId,Vector3 from)
        {
            if(!area||approachOffsets.Count==0)return transform.position;
            if(approachClaims.TryGetValue(actorId,out var held)&&held>=0&&held<approachOffsets.Count)
            {
                var heldCandidate=transform.position+approachOffsets[held];
                return NavMesh.SamplePosition(heldCandidate,out var heldPoint,1.2f,NavMesh.AllAreas)?heldPoint.position:heldCandidate;
            }
            var best=-1;var score=float.MaxValue;var bestPosition=from;
            var pathStart=NavMesh.SamplePosition(from,out var startPoint,1.2f,NavMesh.AllAreas)?startPoint.position:from;
            var path=new NavMeshPath();
            for(var slot=0;slot<approachOffsets.Count;slot++)
            {
                var occupied=false;foreach(var claim in approachClaims)if(claim.Value==slot){occupied=true;break;}
                if(occupied)continue;
                var candidate=transform.position+approachOffsets[slot];
                if(!NavMesh.SamplePosition(candidate,out var reachable,1.2f,NavMesh.AllAreas))continue;
                if(!NavMesh.CalculatePath(pathStart,reachable.position,NavMesh.AllAreas,path)||path.status!=NavMeshPathStatus.PathComplete)continue;
                var distance=0f;for(var corner=1;corner<path.corners.Length;corner++)distance+=Vector3.Distance(path.corners[corner-1],path.corners[corner]);
                if(distance<score){score=distance;best=slot;bestPosition=reachable.position;}
            }
            // Two concentric rings supply more places than the maximum mobile
            // crowd. This fallback is only for malformed zero-sized fixtures.
            if(best<0)return from;
            approachClaims[actorId]=best;
            return bestPosition;
        }

        public void ReleaseApproach(int actorId)=>approachClaims.Remove(actorId);

        void BuildApproachSlots()
        {
            approachOffsets.Clear();approachClaims.Clear();
            var inner=Mathf.Clamp(range*.42f,1.2f,3f);
            AddApproachRing(inner,2.4f);
            var outer=Mathf.Min(range*.82f,inner+2.5f);
            if(outer-inner>.8f)AddApproachRing(outer,2.4f);
        }

        void AddApproachRing(float clearance,float spacing)
        {
            var horizontal=Mathf.Max(2,Mathf.CeilToInt(areaHalfExtents.x*2f/spacing)+1);
            for(var i=0;i<horizontal;i++)
            {
                var x=Mathf.Lerp(-areaHalfExtents.x,areaHalfExtents.x,horizontal==1?.5f:i/(float)(horizontal-1));
                approachOffsets.Add(new Vector3(x,0,-areaHalfExtents.y-clearance));
                approachOffsets.Add(new Vector3(x,0, areaHalfExtents.y+clearance));
            }
            var vertical=Mathf.Max(2,Mathf.CeilToInt(areaHalfExtents.y*2f/spacing));
            for(var i=0;i<vertical;i++)
            {
                var z=Mathf.Lerp(-areaHalfExtents.y,areaHalfExtents.y,(i+.5f)/vertical);
                approachOffsets.Add(new Vector3(-areaHalfExtents.x-clearance,0,z));
                approachOffsets.Add(new Vector3( areaHalfExtents.x+clearance,0,z));
            }
        }
    }
}
