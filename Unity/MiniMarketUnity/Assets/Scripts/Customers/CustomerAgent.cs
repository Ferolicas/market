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
        float arrivalRadius=.4f;
        Vector3 progressPosition;
        float progressAt;
        int recoveryAttempt;
        bool recovering;
        public bool PushingCart { get; set; }
        public string CustomerId { get; private set; }
        public bool Arrived => !moving || FlatSqr(transform.position,target)<=arrivalRadius*arrivalRadius;

        public void Bind(string id, CharacterActor character)
        {
            CustomerId = id;
            actor = character;
            controller = GetComponent<CharacterController>();
            if(controller)controller.enabled=false;
            nav=GetComponent<NavMeshAgent>();if(!nav)nav=gameObject.AddComponent<NavMeshAgent>();
            nav.enabled=true;nav.radius=1.1f;nav.height=10.85f;nav.baseOffset=0;nav.angularSpeed=540;nav.acceleration=64;nav.stoppingDistance=.28f;nav.avoidancePriority=UnityEngine.Random.Range(35,75);nav.obstacleAvoidanceType=ObstacleAvoidanceType.HighQualityObstacleAvoidance;nav.autoRepath=true;
            if(NavMesh.SamplePosition(transform.position,out var hit,4f,NavMesh.AllAreas))nav.Warp(hit.position);
            target=transform.position;moving=false;speed=0;recovering=false;recoveryAttempt=0;progressPosition=transform.position;progressAt=Time.time;
        }

        public void PrepareForPool(){moving=false;PushingCart=false;if(nav&&nav.isOnNavMesh)nav.ResetPath();if(nav)nav.enabled=false;}

        public void GoTo(Vector3 destination, float movementSpeed = Core.Pace.Cast,float acceptableDistance=.4f)
        {
            target = destination;
            target.y = transform.position.y;
            if(nav&&nav.isOnNavMesh&&NavMesh.SamplePosition(target,out var reachable,Mathf.Max(1.2f,acceptableDistance),NavMesh.AllAreas))target=reachable.position;
            speed=movementSpeed;arrivalRadius=Mathf.Max(.3f,acceptableDistance);
            moving=FlatSqr(target,transform.position)>arrivalRadius*arrivalRadius;
            recovering=false;recoveryAttempt=0;progressPosition=transform.position;progressAt=Time.time;
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
                if(recovering&&!nav.pathPending&&nav.remainingDistance<=nav.stoppingDistance+.12f)
                {
                    recovering=false;nav.SetDestination(target);progressPosition=transform.position;progressAt=Time.time;
                }
                RecoverIfBlocked();
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

        void RecoverIfBlocked()
        {
            if(FlatSqr(transform.position,progressPosition)>.04f){progressPosition=transform.position;progressAt=Time.time;return;}
            if(Time.time-progressAt<1.35f)return;
            progressAt=Time.time;recoveryAttempt++;
            var forward=target-transform.position;forward.y=0;if(forward.sqrMagnitude<.01f)return;forward.Normalize();
            var side=Vector3.Cross(Vector3.up,forward)*((recoveryAttempt&1)==0?1f:-1f);
            var probe=transform.position+side*(1.25f+.35f*(recoveryAttempt%3))+forward*.55f;
            nav.avoidancePriority=Mathf.Clamp(nav.avoidancePriority+((recoveryAttempt&1)==0?9:-11),8,92);
            if(NavMesh.SamplePosition(probe,out var detour,1.8f,NavMesh.AllAreas)&&FlatSqr(detour.position,transform.position)>.16f)
            {
                recovering=true;nav.ResetPath();nav.SetDestination(detour.position);
            }
            else{recovering=false;nav.ResetPath();nav.SetDestination(target);}
        }

        static float FlatSqr(Vector3 a,Vector3 b){var delta=a-b;delta.y=0;return delta.sqrMagnitude;}
    }
}
