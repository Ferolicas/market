using MiniMarket.Animations;
using UnityEngine;
using UnityEngine.AI;

namespace MiniMarket.Employees
{
    public sealed class EmployeeAgent : MonoBehaviour
    {
        CharacterActor actor; NavMeshAgent nav; Vector3 target; bool moving;bool cashierPose;
        Transform hips,leftLeg,rightLeg,leftShin,rightShin,leftFoot,rightFoot;
        Vector3 hipsRestPosition;Quaternion leftLegRest,rightLegRest,leftShinRest,rightShinRest,leftFootRest,rightFootRest;
        float lastRate=-1f; bool loaded;   // loaded: carries a box or a basket, which changes the clip
        float arrivalRadius=.4f;Vector3 progressPosition;float progressAt;int recoveryAttempt;bool recovering;
        public bool Arrived => !moving || FlatSqr(transform.position,target)<=arrivalRadius*arrivalRadius;

        public void Bind(CharacterActor character)
        {
            actor=character;
            foreach(var bone in actor.GetComponentsInChildren<Transform>(true))
            {
                if(bone.name=="Hips")hips=bone;else if(bone.name=="Rig_Leg_L")leftLeg=bone;else if(bone.name=="Rig_Leg_R")rightLeg=bone;
                else if(bone.name=="Shin_L")leftShin=bone;else if(bone.name=="Shin_R")rightShin=bone;else if(bone.name=="Foot_L")leftFoot=bone;else if(bone.name=="Foot_R")rightFoot=bone;
            }
            if(hips)hipsRestPosition=hips.localPosition;if(leftLeg)leftLegRest=leftLeg.localRotation;if(rightLeg)rightLegRest=rightLeg.localRotation;
            if(leftShin)leftShinRest=leftShin.localRotation;if(rightShin)rightShinRest=rightShin.localRotation;if(leftFoot)leftFootRest=leftFoot.localRotation;if(rightFoot)rightFootRest=rightFoot.localRotation;
            var controller=GetComponent<CharacterController>();if(controller)controller.enabled=false;
            nav=gameObject.AddComponent<NavMeshAgent>();nav.radius=.3f;nav.height=1.72f;nav.baseOffset=0;nav.angularSpeed=500;nav.acceleration=64;nav.stoppingDistance=.22f;nav.avoidancePriority=UnityEngine.Random.Range(10,24);nav.obstacleAvoidanceType=ObstacleAvoidanceType.HighQualityObstacleAvoidance;nav.autoRepath=true;
            if(NavMesh.SamplePosition(transform.position,out var hit,5f,NavMesh.AllAreas))nav.Warp(hit.position);
            target=transform.position;progressPosition=transform.position;progressAt=Time.time;
        }

        public void GoTo(Vector3 destination,float speed=Core.Pace.Staff,bool carrying=false,float acceptableDistance=.4f)
        {
            loaded=carrying;target=destination;target.y=transform.position.y;
            if(nav&&nav.isOnNavMesh&&NavMesh.SamplePosition(target,out var reachable,Mathf.Max(1.2f,acceptableDistance),NavMesh.AllAreas))target=reachable.position;
            arrivalRadius=Mathf.Max(.3f,acceptableDistance);moving=FlatSqr(target,transform.position)>arrivalRadius*arrivalRadius;
            recovering=false;recoveryAttempt=0;progressPosition=transform.position;progressAt=Time.time;
            if(nav&&nav.isOnNavMesh){nav.speed=speed;nav.SetDestination(target);}
            // Clip and rate both come from the pace, so the stride covers the
            // ground the agent actually crosses instead of sliding over it.
            if(moving)Stride(speed);
        }

        public void Play(string animation)=>actor.Play(animation,.18f);
        public void Face(Vector3 position)
        {
            var direction=position-transform.position;direction.y=0;if(direction.sqrMagnitude>.001f)transform.rotation=Quaternion.LookRotation(direction.normalized);
        }
        public void SetCashierPose(bool active)
        {
            cashierPose=active;
            if(!active&&hips)hips.localPosition=hipsRestPosition;
        }

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
            if(recovering&&!nav.pathPending&&nav.remainingDistance<=nav.stoppingDistance+.12f)
            {
                recovering=false;nav.SetDestination(target);progressPosition=transform.position;progressAt=Time.time;
            }
            RecoverIfBlocked();
            Stride(nav.velocity.magnitude);   // el paso sigue a la velocidad real, no a la pedida
            var velocity=nav.desiredVelocity;
            if(velocity.sqrMagnitude>.02f)transform.rotation=Quaternion.Slerp(transform.rotation,Quaternion.LookRotation(velocity.normalized),1f-Mathf.Exp(-8f*Time.deltaTime));
        }

        void LateUpdate()
        {
            if(!cashierPose)return;
            // A 72-degree high-stool posture is 20% shallower than a full
            // seated bend. The root stays on the floor and the feet remain down,
            // while the hips rise slightly instead of sinking through the seat.
            if(hips)hips.localPosition=hipsRestPosition+Vector3.up*.10f;
            if(leftLeg)leftLeg.localRotation=leftLegRest*Quaternion.Euler(-72f,0,-3f);
            if(rightLeg)rightLeg.localRotation=rightLegRest*Quaternion.Euler(-72f,0,3f);
            if(leftShin)leftShin.localRotation=leftShinRest*Quaternion.Euler(78f,0,0);
            if(rightShin)rightShin.localRotation=rightShinRest*Quaternion.Euler(78f,0,0);
            if(leftFoot)leftFoot.localRotation=leftFootRest*Quaternion.Euler(-18f,0,0);
            if(rightFoot)rightFoot.localRotation=rightFootRest*Quaternion.Euler(-18f,0,0);
        }

        void RecoverIfBlocked()
        {
            if(FlatSqr(transform.position,progressPosition)>.04f){progressPosition=transform.position;progressAt=Time.time;return;}
            if(Time.time-progressAt<1.35f)return;
            progressAt=Time.time;recoveryAttempt++;
            var forward=target-transform.position;forward.y=0;if(forward.sqrMagnitude<.01f)return;forward.Normalize();
            var side=Vector3.Cross(Vector3.up,forward)*((recoveryAttempt&1)==0?1f:-1f);
            var probe=transform.position+side*(.85f+.3f*(recoveryAttempt%3))+forward*.45f;
            nav.avoidancePriority=Mathf.Clamp(nav.avoidancePriority+((recoveryAttempt&1)==0?5:-7),2,32);
            if(NavMesh.SamplePosition(probe,out var detour,1.4f,NavMesh.AllAreas)&&FlatSqr(detour.position,transform.position)>.12f)
            {
                recovering=true;nav.ResetPath();nav.SetDestination(detour.position);
            }
            else{recovering=false;nav.ResetPath();nav.SetDestination(target);}
        }

        static float FlatSqr(Vector3 a,Vector3 b){var delta=a-b;delta.y=0;return delta.sqrMagnitude;}
    }
}
