using UnityEngine;
using UnityEngine.UI;

namespace MiniMarket.UI
{
    public sealed class ResponsiveHudLayout : MonoBehaviour
    {
        RectTransform actions;RectTransform drawer;GridLayoutGroup grid;int width,height;
        public void Bind(RectTransform actionBar,RectTransform drawerPanel,GridLayoutGroup actionGrid){actions=actionBar;drawer=drawerPanel;grid=actionGrid;Apply();}
        void Update(){if(Screen.width!=width||Screen.height!=height)Apply();}
        void Apply()
        {
            if(!actions||!drawer||!grid)return;width=Screen.width;height=Screen.height;var portrait=height>width;
            actions.anchorMin=actions.anchorMax=new Vector2(.5f,0);actions.pivot=new Vector2(.5f,0);
            if(portrait){actions.offsetMin=new Vector2(-182,6);actions.offsetMax=new Vector2(182,56);drawer.anchorMin=new Vector2(.035f,.09f);drawer.anchorMax=new Vector2(.965f,.91f);grid.cellSize=new Vector2(41,40);grid.spacing=new Vector2(3,0);}
            else{actions.offsetMin=new Vector2(-211,10);actions.offsetMax=new Vector2(211,66);drawer.anchorMin=new Vector2(.12f,.09f);drawer.anchorMax=new Vector2(.88f,.91f);grid.cellSize=new Vector2(48,46);grid.spacing=new Vector2(3,0);}
            grid.constraint=GridLayoutGroup.Constraint.FixedColumnCount;grid.constraintCount=8;
        }
    }
}
