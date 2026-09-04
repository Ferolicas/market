using MiniMarket.Animations;
using UnityEngine;
using UnityEngine.AI;

namespace MiniMarket.Customers
{
    public sealed class CustomerAgent : MonoBehaviour
    {
        CharacterController controller;
        CharacterActor actor;
        NavMeshAgent nav;
        Vector3 target;
        float speed;
        bool moving;
        public string CustomerId { get; private set; }
        public bool Arrived => !moving || (nav && nav.isOnNavMesh && !nav.pathPending && nav.remainingDistance <= nav.stoppingDistance + .08f);

        public void Bind(string id, CharacterActor character)
        {
            CustomerId = id;
            actor = character;
            controller = GetComponent<CharacterController>();
            if(controller)controller.enabled=false;
            nav=GetComponent<NavMeshAgent>();if(!nav)nav=gameObject.AddComponent<NavMeshAgent>();
            nav.enabled=true;nav.radius=.3f;nav.height=1.72f;nav.baseOffset=0;nav.angularSpeed=540;nav.acceleration=8;nav.stoppingDistance=.18f;nav.avoidancePriority=UnityEngine.Random.Range(25,75);
            if(NavMesh.SamplePosition(transform.position,out var hit,4f,NavMesh.AllAreas))nav.Warp(hit.position);
            target = transform.position;moving=false;speed=0;
        }

        public void PrepareForPool(){moving=false;if(nav&&nav.isOnNavMesh)nav.ResetPath();if(nav)nav.enabled=false;}

        public void GoTo(Vector3 destination, float movementSpeed = 1.45f)
        {
            target = destination;
            target.y = transform.position.y;
            speed = movementSpeed;
            moving = Vector3.SqrMagnitude(target - transform.position) > .05f;
            if(nav&&nav.isOnNavMesh){nav.speed=speed;nav.SetDestination(target);}
            if (moving) actor.Play("Walk");
        }

        public void Play(string animation, float fade = .18f) => actor.Play(animation, fade);
        public void Expression(string shape, float weight) => actor.SetExpression(shape, weight);

        void Update()
        {
            if(!moving)return;
            if(nav&&nav.isOnNavMesh)
            {
                if(Arrived){moving=false;nav.ResetPath();actor.Play("Idle");return;}
                var velocity=nav.desiredVelocity;if(velocity.sqrMagnitude>.02f)transform.rotation=Quaternion.Slerp(transform.rotation,Quaternion.LookRotation(velocity.normalized),1f-Mathf.Exp(-8f*Time.deltaTime));
                return;
            }
            if (!controller) return;
            var delta = target - transform.position;
            delta.y = 0;
            if (delta.sqrMagnitude < .055f)
            {
                moving = false;
                actor.Play("Idle");
                return;
            }
            var direction = delta.normalized;
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(direction), 1f - Mathf.Exp(-8f * Time.deltaTime));
            controller.enabled=true;controller.Move(direction * Mathf.Min(speed * Time.deltaTime, delta.magnitude));controller.enabled=false;
        }
    }
}
