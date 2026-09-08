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
        float lastRate=-1f;
        public bool PushingCart { get; set; }
        public string CustomerId { get; private set; }
        public bool Arrived => !moving || (nav && nav.isOnNavMesh && !nav.pathPending && nav.remainingDistance <= nav.stoppingDistance + .08f);

        public void Bind(string id, CharacterActor character)
        {
            CustomerId = id;
            actor = character;
            controller = GetComponent<CharacterController>();
            if(controller)controller.enabled=false;
            nav=GetComponent<NavMeshAgent>();if(!nav)nav=gameObject.AddComponent<NavMeshAgent>();
            nav.enabled=true;nav.radius=1.1f;nav.height=10.85f;nav.baseOffset=0;nav.angularSpeed=540;nav.acceleration=64;nav.stoppingDistance=.28f;nav.avoidancePriority=UnityEngine.Random.Range(35,75);nav.obstacleAvoidanceType=ObstacleAvoidanceType.GoodQualityObstacleAvoidance;
            if(NavMesh.SamplePosition(transform.position,out var hit,4f,NavMesh.AllAreas))nav.Warp(hit.position);
            target = transform.position;moving=false;speed=0;
        }

        public void PrepareForPool(){moving=false;PushingCart=false;if(nav&&nav.isOnNavMesh)nav.ResetPath();if(nav)nav.enabled=false;}

        public void GoTo(Vector3 destination, float movementSpeed = Core.Pace.Cast)
        {
            target = destination;
            target.y = transform.position.y;
            speed = movementSpeed;
            moving = Vector3.SqrMagnitude(target - transform.position) > .05f;
            if(nav&&nav.isOnNavMesh){nav.speed=speed;nav.SetDestination(target);}
            if (moving) Stride(speed);
        }

        void Stride(float worldSpeed)
        {
            if (worldSpeed <= .12f) return;
            // Shoppers push the cart during every walking leg. CarryRun uses
            // the real running legs with the stable two-hand CarryBox pose, so
            // neither arm swings through the rigid handle at higher speeds.
            var (clip, rate) = CharacterActor.Locomotion(worldSpeed, PushingCart, actor.StrideScale);
            if (Mathf.Abs(rate - lastRate) < .05f && actor.Playing == clip) return;
            lastRate = rate; actor.Play(clip, .18f, rate);
        }

        public void Play(string animation, float fade = .18f) => actor.Play(animation, fade);
        public void SetQueueOrder(int slot)
        {
            // Lower values have priority. The customer closest to the register
            // advances first, so followers yield instead of walking through it.
            if(nav)nav.avoidancePriority=Mathf.Clamp(12+Mathf.Max(0,slot)*8,0,99);
        }
        public void Expression(string shape, float weight) => actor.SetExpression(shape, weight);
        public void Face(Vector3 worldTarget)
        {
            var direction=worldTarget-transform.position;direction.y=0;
            if(direction.sqrMagnitude>.001f)transform.rotation=Quaternion.LookRotation(direction.normalized);
        }

        void Update()
        {
            if(!moving)return;
            if(nav&&nav.isOnNavMesh)
            {
                if(Arrived){moving=false;nav.ResetPath();lastRate=-1f;actor.Play("Idle");return;}
                // The stride follows the speed the body actually has, not the
                // one it was asked for: an agent slows into corners, around
                // other shoppers and as it arrives, and a stride left at the
                // requested pace is a foot sliding over the floor.
                Stride(nav.velocity.magnitude);
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
