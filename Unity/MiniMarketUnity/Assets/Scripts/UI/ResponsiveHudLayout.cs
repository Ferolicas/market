using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace MiniMarket.UI
{
    /// <summary>
    /// Keeps the management controls aligned with the delivered interface kit:
    /// a compact column on desktop and a two-column mobile sheet in portrait.
    /// </summary>
    public sealed class ResponsiveHudLayout : MonoBehaviour
    {
        RectTransform actions;RectTransform drawer;GridLayoutGroup grid;List<RectTransform> buttons;RectTransform handle;RectTransform sheetClose;RectTransform launcher;RectTransform topBar;RectTransform guide;CanvasScaler scaler;bool drawerOpen;bool menuOpen;bool ready;bool narrowNow;readonly List<(LayoutElement element,float width)> topCells=new();readonly List<(Text label,int size)> topLabels=new();LayoutElement statusCell;int width,height;

        public void Bind(RectTransform actionBar,RectTransform drawerPanel,GridLayoutGroup actionGrid,List<RectTransform> quickButtons,RectTransform dragHandle=null,RectTransform closeRow=null,RectTransform launcherButton=null,RectTransform top=null,RectTransform guideCard=null)
        {
            actions=actionBar;drawer=drawerPanel;grid=actionGrid;buttons=quickButtons;handle=dragHandle;sheetClose=closeRow;launcher=launcherButton;topBar=top;guide=guideCard;scaler=GetComponentInChildren<CanvasScaler>();
            if(topBar)
            {
                foreach(var element in topBar.GetComponentsInChildren<LayoutElement>())
                    topCells.Add((element,element.preferredWidth));
                foreach(var label in topBar.GetComponentsInChildren<Text>())
                    topLabels.Add((label,label.fontSize));
                var status=topBar.Find("CERRADO");
                if(status)statusCell=status.GetComponent<LayoutElement>();
            }
            Apply();
        }

        void Update(){if(Screen.width!=width||Screen.height!=height)Apply();}

        void Apply()
        {
            if(!actions||!drawer||!grid)return;
            width=Screen.width;height=Screen.height;
            // Screen.width is the physical back-buffer width in WebGL. Modern
            // phones commonly report 750-1290 pixels, so a desktop-style pixel
            // cutoff misclassified portrait iPhones and rendered the tiny
            // desktop HUD. Portrait itself is the reliable mobile layout signal.
            var narrow=height>width;
            narrowNow=narrow;
            // A 1440x900 reference on a portrait phone scales the whole HUD to
            // about half size, which leaves 12pt captions at seven physical
            // pixels. The phone sheet is drawn at phone size, so is this.
            if(scaler)
            {
                scaler.referenceResolution=narrow?new Vector2(430,932):new Vector2(1440,900);
                scaler.matchWidthOrHeight=.5f;
            }
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
            RefreshVisibility();
            // every entry stays reachable on a phone: the sheet holds all eight
            if(buttons==null)return;
            foreach(var button in buttons)
            {
                if(!button)continue;
                button.gameObject.SetActive(true);
                button.GetComponent<QuickMenuEntry>()?.Arrange(narrow);
            }
        }

        /// On a phone the drawer covers the screen, so the quick sheet under it
        /// only pokes out along the bottom edge.
        public bool Narrow=>narrowNow;

        public void DrawerOpened(bool open)
        {
            drawerOpen=open;if(open)menuOpen=false;RefreshVisibility();
        }

        public void SetReady(bool value){ready=value;if(!ready)menuOpen=false;RefreshVisibility();}
        public void SetMenuOpen(bool value){menuOpen=value&&ready&&!drawerOpen;RefreshVisibility();}

        void RefreshVisibility()
        {
            if(actions)actions.gameObject.SetActive(ready&&menuOpen&&!drawerOpen);
            if(launcher)launcher.gameObject.SetActive(ready&&!menuOpen&&!drawerOpen);
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
                topBar.offsetMin=new Vector2(12,-92);topBar.offsetMax=new Vector2(-12,-12);
                // Taken from the scaler's own reference width: the bar's rect has
                // not been rebuilt yet at the moment the layout switches, so its
                // width still reports the desktop figure.
                var available=(scaler?scaler.referenceResolution.x:topBar.rect.width)-84f;
                // The store pill keeps its width: it is one indivisible word beside
                // a chevron, and at the uniform scale its caption wraps to CERR/ADO.
                const float statusFloor=104f;
                var total=0f;foreach(var (element,cell) in topCells)if(element!=statusCell)total+=cell;
                var room=available-(statusCell?statusFloor:0f);
                var scale=total>0f?Mathf.Clamp(room/total,.4f,1f):1f;
                foreach(var (element,cell) in topCells)
                {
                    if(!element)continue;
                    var width=element==statusCell?statusFloor:cell*scale;
                    element.preferredWidth=width;element.minWidth=width;
                }
                // The captions shrink with their cells; left at desktop size they
                // simply spill past the narrower columns.
                foreach(var (label,size) in topLabels)
                {
                    if(!label)continue;
                    var keep=statusCell&&label.transform.parent==statusCell.transform;
                    label.fontSize=keep?size:Mathf.Max(8,Mathf.RoundToInt(size*scale));
                    label.resizeTextMaxSize=label.fontSize;
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
                foreach(var (label,size) in topLabels)
                {
                    if(!label)continue;
                    label.fontSize=size;label.resizeTextMaxSize=size;
                }
            }
        }
    }
}
