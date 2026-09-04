using MiniMarket.Animations;
using UnityEngine;
using UnityEngine.AI;

namespace MiniMarket.Employees
{
    public sealed class EmployeeAgent : MonoBehaviour
    {
        CharacterActor actor; NavMeshAgent nav; Vector3 target; bool moving;
        public bool Arrived => !moving || (nav&&nav.isOnNavMesh&&!nav.pathPending&&nav.remainingDistance<=nav.stoppingDistance+.08f);

        public void Bind(CharacterActor character)
        {
            actor=character;
            var controller=GetComponent<CharacterController>();if(controller)controller.enabled=false;
            nav=gameObject.AddComponent<NavMeshAgent>();nav.radius=.3f;nav.height=1.72f;nav.baseOffset=0;nav.angularSpeed=500;nav.acceleration=7;nav.stoppingDistance=.22f;nav.avoidancePriority=UnityEngine.Random.Range(10,24);
            if(NavMesh.SamplePosition(transform.position,out var hit,5f,NavMesh.AllAreas))nav.Warp(hit.position);
            target=transform.position;
        }

        public void GoTo(Vector3 destination,float speed=1.5f,bool carrying=false)
        {
            target=destination;target.y=transform.position.y;moving=Vector3.SqrMagnitude(target-transform.position)>.06f;
            if(nav&&nav.isOnNavMesh){nav.speed=speed;nav.SetDestination(target);}
            if(moving)actor.Play(carrying?"CarryWalk":"Walk");
        }

        public void Play(string animation)=>actor.Play(animation,.18f);

        void Update()
        {
            if(!moving||!nav||!nav.isOnNavMesh)return;
            if(Arrived){moving=false;nav.ResetPath();actor.Play("Idle");return;}
            var velocity=nav.desiredVelocity;
            if(velocity.sqrMagnitude>.02f)transform.rotation=Quaternion.Slerp(transform.rotation,Quaternion.LookRotation(velocity.normalized),1f-Mathf.Exp(-8f*Time.deltaTime));
        }
    }
}
