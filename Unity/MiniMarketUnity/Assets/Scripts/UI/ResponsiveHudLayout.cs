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
        RectTransform actions;RectTransform drawer;GridLayoutGroup grid;List<RectTransform> buttons;RectTransform handle;RectTransform sheetClose;RectTransform topBar;RectTransform guide;readonly List<(LayoutElement element,float width)> topCells=new();int width,height;

        public void Bind(RectTransform actionBar,RectTransform drawerPanel,GridLayoutGroup actionGrid,List<RectTransform> quickButtons,RectTransform dragHandle=null,RectTransform closeRow=null,RectTransform top=null,RectTransform guideCard=null)
        {
            actions=actionBar;drawer=drawerPanel;grid=actionGrid;buttons=quickButtons;handle=dragHandle;sheetClose=closeRow;topBar=top;guide=guideCard;
            if(topBar)foreach(var element in topBar.GetComponentsInChildren<LayoutElement>())
                topCells.Add((element,element.preferredWidth));
            Apply();
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
                // A bottom sheet: drag handle on top, two columns of stacked
                // entries, and the close row under them, as the mobile sheet draws it.
                actions.offsetMin=new Vector2(-186,14);actions.offsetMax=new Vector2(186,418);
                grid.padding=new RectOffset(12,12,22,44);grid.spacing=new Vector2(10,10);
                grid.constraintCount=2;grid.cellSize=new Vector2(169,76);
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
            ArrangeTopBar(narrow);
            if(guide)
            {
                // The corner level badge owns the top right on a phone, so the
                // guide drops below it instead of sharing the same rows.
                guide.offsetMin=narrow?new Vector2(-300,-244):new Vector2(-284,-152);
                guide.offsetMax=narrow?new Vector2(-14,-176):new Vector2(-88,-84);
            }
            if(handle)handle.gameObject.SetActive(narrow);
            if(sheetClose)sheetClose.gameObject.SetActive(narrow);
            // every entry stays reachable on a phone: the sheet holds all eight
            if(buttons==null)return;
            foreach(var button in buttons)
            {
                if(!button)continue;
                button.gameObject.SetActive(true);
                button.GetComponent<QuickMenuEntry>()?.Arrange(narrow);
            }
        }

        /// The top bar carries fixed cell widths tuned for the desktop sheet. On a
        /// phone the canvas is narrower than their sum, so the bar hangs off both
        /// edges; here it stretches to the screen and its cells shrink to fit.
        void ArrangeTopBar(bool narrow)
        {
            if(!topBar)return;
            if(narrow)
            {
                topBar.anchorMin=new Vector2(0,1);topBar.anchorMax=new Vector2(1,1);topBar.pivot=new Vector2(.5f,1);
                topBar.offsetMin=new Vector2(10,-92);topBar.offsetMax=new Vector2(-10,-12);
                var available=topBar.rect.width-40f;
                var total=0f;foreach(var (element,cell) in topCells)total+=cell;
                var scale=total>0f?Mathf.Clamp(available/total,.5f,1f):1f;
                foreach(var (element,cell) in topCells)
                {
                    if(!element)continue;
                    element.preferredWidth=cell*scale;element.minWidth=cell*scale;
                }
            }
            else
            {
                topBar.anchorMin=topBar.anchorMax=new Vector2(.5f,1);topBar.pivot=new Vector2(.5f,.5f);
                topBar.offsetMin=new Vector2(-460,-82);topBar.offsetMax=new Vector2(460,-14);
                foreach(var (element,cell) in topCells)
                {
                    if(!element)continue;
                    element.preferredWidth=cell;element.minWidth=cell;
                }
            }
        }
    }
}
