using UnityEngine;
using UnityEngine.UI;

namespace MiniMarket.UI
{
    /// <summary>
    /// Holds the two parts of a quick-menu entry so the responsive layout can
    /// rearrange them. The desktop sheet reads the icon beside the name; the
    /// mobile sheet stacks the name under a centred icon.
    /// </summary>
    public sealed class QuickMenuEntry : MonoBehaviour
    {
        public RectTransform Glyph;
        public Text Caption;
        public Image Background;
        public Outline Border;
        public Shadow DropShadow;

        public void Arrange(bool stacked)
        {
            if(!Glyph||!Caption)return;
            if(stacked)
            {
                if(Background)Background.color=new Color32(253,250,246,250);
                if(Border)Border.enabled=true;
                if(DropShadow)DropShadow.enabled=true;
                Glyph.anchorMin=Glyph.anchorMax=new Vector2(.5f,1);Glyph.pivot=new Vector2(.5f,1);
                Glyph.sizeDelta=new Vector2(24,24);Glyph.anchoredPosition=new Vector2(0,-14);
                Caption.alignment=TextAnchor.LowerCenter;
                var text=Caption.rectTransform;
                text.anchorMin=new Vector2(0,0);text.anchorMax=new Vector2(1,1);
                text.offsetMin=new Vector2(4,8);text.offsetMax=new Vector2(-4,-44);
            }
            else
            {
                if(Background)Background.color=new Color(0,0,0,0);
                if(Border)Border.enabled=false;
                if(DropShadow)DropShadow.enabled=false;
                Glyph.anchorMin=Glyph.anchorMax=new Vector2(0,.5f);Glyph.pivot=new Vector2(0,.5f);
                Glyph.sizeDelta=new Vector2(19,19);Glyph.anchoredPosition=new Vector2(11,0);
                Caption.alignment=TextAnchor.MiddleLeft;
                var text=Caption.rectTransform;
                text.anchorMin=new Vector2(0,0);text.anchorMax=new Vector2(1,1);
                text.offsetMin=new Vector2(38,0);text.offsetMax=new Vector2(-6,0);
            }
        }
    }
}
