using System.Collections.Generic;
using MiniMarket.Animations;
using UnityEngine;

namespace MiniMarket.Store
{
    /// <summary>Exact automatic sliding-door presentation used by Next.</summary>
    public sealed class StorefrontDoorPresenter : MonoBehaviour
    {
        readonly HashSet<CharacterActor> occupants=new();
        Transform left;Transform right;float closedLeft;float closedRight;float travel=5.4f;

        /// <param name="slide">How far each leaf runs, in the leaves' own local
        /// units. The entrance is fitted to the doorway, so its children live in
        /// a scaled space and a world-space distance would tear them apart.</param>
        public void Bind(Transform leftLeaf,Transform rightLeaf,float slide=5.4f)
        {
            left=leftLeaf;right=rightLeaf;
            closedLeft=left.localPosition.x;closedRight=right.localPosition.x;
            travel=Mathf.Abs(slide);
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
            if(!left||!right)return;var open=occupants.Count>0;var leftTarget=open?closedLeft-travel:closedLeft;var rightTarget=open?closedRight+travel:closedRight;var speed=(open?11.9f:10.2f)*Mathf.Max(travel/5.4f,.2f);
            var leftPosition=left.localPosition;leftPosition.x=Mathf.MoveTowards(leftPosition.x,leftTarget,speed*Time.deltaTime);left.localPosition=leftPosition;
            var rightPosition=right.localPosition;rightPosition.x=Mathf.MoveTowards(rightPosition.x,rightTarget,speed*Time.deltaTime);right.localPosition=rightPosition;
        }
    }
}
