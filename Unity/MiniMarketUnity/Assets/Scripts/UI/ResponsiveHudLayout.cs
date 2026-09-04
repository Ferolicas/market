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
                // the mobile sheet shows the eight entries as a 2x4 grid pinned
                // to the bottom, not as a strip across the top
                actions.anchorMin=actions.anchorMax=new Vector2(.5f,0);actions.pivot=new Vector2(.5f,0);
                actions.offsetMin=new Vector2(-176,16);actions.offsetMax=new Vector2(176,222);
                grid.padding=new RectOffset(10,10,10,10);grid.spacing=new Vector2(8,8);
                grid.constraintCount=2;grid.cellSize=new Vector2(162,44);
                drawer.anchorMin=new Vector2(.035f,.09f);drawer.anchorMax=new Vector2(.965f,.91f);
            }
            else
            {
                actions.offsetMin=new Vector2(-186,-452);actions.offsetMax=new Vector2(-14,-100);
                grid.padding=new RectOffset(7,7,7,7);grid.spacing=new Vector2(5,5);
                grid.constraintCount=1;grid.cellSize=new Vector2(158,38);
                drawer.anchorMin=new Vector2(.12f,.09f);drawer.anchorMax=new Vector2(.88f,.91f);
            }
            grid.constraint=GridLayoutGroup.Constraint.FixedColumnCount;
            // every entry stays reachable on a phone: the sheet holds all eight
            if(buttons==null)return;
            foreach(var button in buttons)if(button)button.gameObject.SetActive(true);
        }
    }
}
