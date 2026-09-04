using System.Collections.Generic;
using MiniMarket.Animations;
using UnityEngine;

namespace MiniMarket.Store
{
    /// <summary>Exact automatic sliding-door presentation used by Next.</summary>
    public sealed class StorefrontDoorPresenter : MonoBehaviour
    {
        readonly HashSet<CharacterActor> occupants=new();
        Transform left;Transform right;float closedLeft;float closedRight;

        public void Bind(Transform leftLeaf,Transform rightLeaf)
        {
            left=leftLeaf;right=rightLeaf;closedLeft=left.localPosition.x;closedRight=right.localPosition.x;
        }

        void OnTriggerEnter(Collider other)
        {
            var actor=other.GetComponentInParent<CharacterActor>();if(actor)occupants.Add(actor);
        }

        void OnTriggerExit(Collider other)
        {
            var actor=other.GetComponentInParent<CharacterActor>();if(actor)occupants.Remove(actor);
        }

        void Update()
        {
            occupants.RemoveWhere(actor=>!actor||!actor.gameObject.activeInHierarchy);
            if(!left||!right)return;var open=occupants.Count>0;var leftTarget=open?-5.4f:closedLeft;var rightTarget=open?5.4f:closedRight;var speed=open?11.9f:10.2f;
            var leftPosition=left.localPosition;leftPosition.x=Mathf.MoveTowards(leftPosition.x,leftTarget,speed*Time.deltaTime);left.localPosition=leftPosition;
            var rightPosition=right.localPosition;rightPosition.x=Mathf.MoveTowards(rightPosition.x,rightTarget,speed*Time.deltaTime);right.localPosition=rightPosition;
        }
    }
}
