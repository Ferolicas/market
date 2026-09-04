using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace MiniMarket.UI
{
    /// <summary>
    /// Keeps the quick menu where the stylesheet puts it: a column down the right
    /// edge on a wide screen, and a four-up strip across the top on a narrow one,
    /// where the sheet also hides everything past the fourth entry.
    /// </summary>
    public sealed class ResponsiveHudLayout : MonoBehaviour
    {
        RectTransform actions;RectTransform drawer;GridLayoutGroup grid;List<RectTransform> buttons;int width,height;

        public void Bind(RectTransform actionBar,RectTransform drawerPanel,GridLayoutGroup actionGrid,List<RectTransform> quickButtons)
        {
            actions=actionBar;drawer=drawerPanel;grid=actionGrid;buttons=quickButtons;Apply();
        }

        void Update(){if(Screen.width!=width||Screen.height!=height)Apply();}

        void Apply()
        {
            if(!actions||!drawer||!grid)return;
            width=Screen.width;height=Screen.height;
            var narrow=height>width&&width<=580;
            actions.anchorMin=actions.anchorMax=new Vector2(1,1);actions.pivot=new Vector2(1,1);
            if(narrow)
            {
                // four across the top, the rest hidden, as the media query does
                actions.anchorMin=actions.anchorMax=new Vector2(.5f,1);actions.pivot=new Vector2(.5f,1);
                actions.offsetMin=new Vector2(-176,-116);actions.offsetMax=new Vector2(176,-70);
                grid.padding=new RectOffset(4,4,4,4);grid.spacing=new Vector2(4,4);
                grid.constraintCount=4;grid.cellSize=new Vector2(80,38);
                drawer.anchorMin=new Vector2(.035f,.09f);drawer.anchorMax=new Vector2(.965f,.91f);
            }
            else
            {
                actions.offsetMin=new Vector2(-90,-581);actions.offsetMax=new Vector2(-14,-100);
                grid.padding=new RectOffset(7,7,7,7);grid.spacing=new Vector2(5,5);
                grid.constraintCount=1;grid.cellSize=new Vector2(62,54);
                drawer.anchorMin=new Vector2(.12f,.09f);drawer.anchorMax=new Vector2(.88f,.91f);
            }
            grid.constraint=GridLayoutGroup.Constraint.FixedColumnCount;
            if(buttons==null)return;
            for(var i=0;i<buttons.Count;i++)
                if(buttons[i])buttons[i].gameObject.SetActive(!narrow||i<4);
        }
    }
}
