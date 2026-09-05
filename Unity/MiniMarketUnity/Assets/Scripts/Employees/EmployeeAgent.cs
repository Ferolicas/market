using MiniMarket.Animations;
using UnityEngine;
using UnityEngine.AI;

namespace MiniMarket.Employees
{
    public sealed class EmployeeAgent : MonoBehaviour
    {
        CharacterActor actor; NavMeshAgent nav; Vector3 target; bool moving;
        float lastRate=-1f; bool loaded;   // loaded: carries a box or a basket, which changes the clip
        public bool Arrived => !moving || (nav&&nav.isOnNavMesh&&!nav.pathPending&&nav.remainingDistance<=nav.stoppingDistance+.08f);

        public void Bind(CharacterActor character)
        {
            actor=character;
            var controller=GetComponent<CharacterController>();if(controller)controller.enabled=false;
            nav=gameObject.AddComponent<NavMeshAgent>();nav.radius=.3f;nav.height=1.72f;nav.baseOffset=0;nav.angularSpeed=500;nav.acceleration=64;nav.stoppingDistance=.22f;nav.avoidancePriority=UnityEngine.Random.Range(10,24);
            if(NavMesh.SamplePosition(transform.position,out var hit,5f,NavMesh.AllAreas))nav.Warp(hit.position);
            target=transform.position;
        }

        public void GoTo(Vector3 destination,float speed=Core.Pace.Staff,bool carrying=false)
        {
            loaded=carrying;target=destination;target.y=transform.position.y;moving=Vector3.SqrMagnitude(target-transform.position)>.06f;
            if(nav&&nav.isOnNavMesh){nav.speed=speed;nav.SetDestination(target);}
            // Clip and rate both come from the pace, so the stride covers the
            // ground the agent actually crosses instead of sliding over it.
            if(moving)Stride(speed);
        }

        public void Play(string animation)=>actor.Play(animation,.18f);

        void Stride(float worldSpeed)
        {
            if(worldSpeed<=.12f)return;
            var(clip,rate)=CharacterActor.Locomotion(worldSpeed,loaded,actor.StrideScale);
            if(Mathf.Abs(rate-lastRate)<.05f&&actor.Playing==clip)return;
            lastRate=rate;actor.Play(clip,.18f,rate);
        }


        void Update()
        {
            if(!moving||!nav||!nav.isOnNavMesh)return;
            if(Arrived){moving=false;nav.ResetPath();lastRate=-1f;actor.Play("Idle");return;}
            Stride(nav.velocity.magnitude);   // el paso sigue a la velocidad real, no a la pedida
            var velocity=nav.desiredVelocity;
            if(velocity.sqrMagnitude>.02f)transform.rotation=Quaternion.Slerp(transform.rotation,Quaternion.LookRotation(velocity.normalized),1f-Mathf.Exp(-8f*Time.deltaTime));
        }
    }
}
