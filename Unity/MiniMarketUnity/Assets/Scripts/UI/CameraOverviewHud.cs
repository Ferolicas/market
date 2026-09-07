using System;
using System.Collections.Generic;
using MiniMarket.Audio;
using MiniMarket.Core;
using MiniMarket.Player;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace MiniMarket.UI
{
    /// Live management layer for the full-world camera. It keeps the real scene
    /// visible, places factual stock/queue badges over their fixtures, and draws
    /// the live owner in a dedicated portrait so clothes, hair and hats remain
    /// legible while the world itself is shown at management scale.
    public sealed class CameraOverviewHud : MonoBehaviour
    {
        sealed class Zone
        {
            public string Id;
            public string Title;
            public string[] Products;
            public Vector2 Offset;
            public RectTransform Badge;
            public Image Background;
            public Text Caption;
        }

        const int AvatarLayer = 8;
        static Color Html(string value, float alpha = 1f)
        {
            ColorUtility.TryParseHtmlString($"#{value}", out var color);color.a=alpha;return color;
        }
        static readonly Color Ink=Html("323524",.98f);
        static readonly Color Cream=Html("FDFAF6",.98f);
        static readonly Color Green=Html("4E5536",.96f);
        static readonly Color Orange=Html("CF8946",.97f);
        static readonly Color Red=Html("C1705A",.97f);
        static readonly Color Muted=Html("8A8670");

        readonly List<Zone> zones = new();
        readonly List<Vector2> occupied = new();
        MiniMarketRuntime runtime;
        AudioManager audioService;
        Canvas canvas;
        Font font;
        Sprite rounded;
        RectTransform quickMenu;
        RectTransform drawer;
        ResponsiveHudLayout responsive;
        RectTransform chrome;
        RectTransform markers;
        RectTransform titleCard;
        RectTransform avatarCard;
        RawImage avatarImage;
        Camera worldCamera;
        Camera avatarCamera;
        RenderTexture avatarTexture;
        IsometricCamera rig;
        bool open;
        bool narrow;
        int screenWidth;
        int screenHeight;
        float nextRefresh;

        public bool Opened => open;

        public void Bind(MiniMarketRuntime game, Canvas uiCanvas, Font uiFont, Sprite roundedSprite,
            RectTransform actionMenu, RectTransform managementDrawer, ResponsiveHudLayout layout, AudioManager audio)
        {
            runtime=game;canvas=uiCanvas;font=uiFont;rounded=roundedSprite;quickMenu=actionMenu;drawer=managementDrawer;responsive=layout;audioService=audio;
            worldCamera=Camera.main;rig=worldCamera?worldCamera.GetComponent<IsometricCamera>():null;
            Build();CreateZones();ApplyLayout();Refresh(true);
        }

        public void Toggle() => SetOpen(!open);
        public void Close() { if(open)SetOpen(false); }

        void SetOpen(bool value)
        {
            open=value;
            if(!rig&&Camera.main)rig=Camera.main.GetComponent<IsometricCamera>();
            rig?.SetOverview(value);
            if(runtime&&runtime.Player)runtime.Player.InputEnabled=!value&&!runtime.CompanySetup.Required;
            if(chrome)chrome.gameObject.SetActive(value);
            if(avatarCamera)avatarCamera.enabled=value;
            if(narrow&&quickMenu)quickMenu.gameObject.SetActive(!value);
            if(value)
            {
                chrome.SetAsLastSibling();markers.SetAsLastSibling();FrameAvatar();
            }
            audioService?.UiConfirm();
            Refresh(true);
        }

        void Build()
        {
            chrome=Rect("CameraOverviewChrome",canvas.transform);
            Stretch(chrome);
            chrome.gameObject.SetActive(false);

            titleCard=Panel("CameraTitle",chrome,Cream);
            var heading=Label(titleCard,"VISTA GENERAL",15,TextAnchor.UpperLeft);heading.fontStyle=FontStyle.Bold;
            Anchor(heading.rectTransform,Vector2.zero,Vector2.one,new Vector2(18,25),new Vector2(-126,-8));
            var hint=Label(titleCard,"Toca una zona para acercarte",11,TextAnchor.LowerLeft);hint.color=Muted;
            Anchor(hint.rectTransform,Vector2.zero,Vector2.one,new Vector2(18,8),new Vector2(-126,-29));
            var close=Button(titleCard,"CÁMARA",Close,Green,Cream);
            close.anchorMin=close.anchorMax=new Vector2(1,.5f);close.pivot=new Vector2(1,.5f);close.sizeDelta=new Vector2(108,38);close.anchoredPosition=new Vector2(-12,0);

            avatarCard=Panel("CameraAvatar",chrome,Cream);
            var live=Label(avatarCard,"TU PERSONAJE · EN VIVO",11,TextAnchor.UpperCenter);live.fontStyle=FontStyle.Bold;live.color=Green;
            Anchor(live.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(8,-24),new Vector2(-8,-6));
            var view=Rect("Preview",avatarCard);Anchor(view,Vector2.zero,Vector2.one,new Vector2(8,8),new Vector2(-8,-30));
            avatarImage=view.gameObject.AddComponent<RawImage>();avatarImage.raycastTarget=false;

            markers=Rect("CameraZoneMarkers",canvas.transform);Stretch(markers);markers.SetAsLastSibling();
        }

        void CreateZones()
        {
            AddZone("bread","PAN",new[]{"bread"},new Vector2(-18,42));
            AddZone("produce","FRESCOS",new[]{"tomatoes","apples","corn"},new Vector2(-30,-42));
            AddZone("dairy","LÁCTEOS",new[]{"milk","cheese"},new Vector2(18,46));
            AddZone("drinks","BEBIDAS",new[]{"juice"},new Vector2(18,-44));
            AddZone("checkout","CAJA",Array.Empty<string>(),new Vector2(42,0));
            AddZone("entrance","ENTRADA",Array.Empty<string>(),new Vector2(0,-48));
            AddZone("farm","GRANJA",Array.Empty<string>(),new Vector2(-22,16));
        }

        void AddZone(string id,string title,string[] products,Vector2 offset)
        {
            var zone=new Zone{Id=id,Title=title,Products=products,Offset=offset};
            zone.Badge=Panel($"CameraZone_{id}",markers,Green);
            zone.Badge.sizeDelta=new Vector2(174,50);
            zone.Background=zone.Badge.GetComponent<Image>();
            zone.Caption=Label(zone.Badge,title,11,TextAnchor.MiddleCenter);zone.Caption.color=Cream;zone.Caption.fontStyle=FontStyle.Bold;
            Anchor(zone.Caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(7,3),new Vector2(-7,-3));
            var button=zone.Badge.gameObject.AddComponent<Button>();button.targetGraphic=zone.Background;button.onClick.AddListener(()=>Focus(zone));
            zone.Badge.gameObject.SetActive(false);zones.Add(zone);
        }

        void Focus(Zone zone)
        {
            var point=Position(zone);
            SetOpen(false);
            rig?.PeekAt(point,2.8f);
            runtime?.Signals?.PublishNotification($"Cámara · {zone.Title}");
        }

        void Update()
        {
            if(!runtime||!runtime.Ready)return;
            if(Screen.width!=screenWidth||Screen.height!=screenHeight)ApplyLayout();
            if(Time.unscaledTime<nextRefresh)return;
            nextRefresh=Time.unscaledTime+.2f;
            Refresh(false);
            if(open)FrameAvatar();
        }

        void Refresh(bool force)
        {
            if(!runtime||!markers)return;
            if(!worldCamera)worldCamera=Camera.main;
            var blocked=drawer&&drawer.gameObject.activeSelf;
            occupied.Clear();
            foreach(var zone in zones)
            {
                var status=Status(zone,out var urgent,out var warning);
                var point=Position(zone)+Vector3.up*2f;
                var screen=worldCamera?worldCamera.WorldToScreenPoint(point):Vector3.zero;
                if(screen.z<=0){screen.x=Screen.width-screen.x;screen.y=Screen.height-screen.y;}
                var safelyVisible=screen.z>0&&screen.x>125&&screen.x<Screen.width-205&&screen.y>105&&screen.y<Screen.height-175;
                var show=!blocked&&(open||(urgent&&!safelyVisible));
                zone.Badge.gameObject.SetActive(show);
                if(!show)continue;
                zone.Caption.text=status;
                zone.Background.color=warning?Red:urgent?Orange:Green;
                RectTransformUtility.ScreenPointToLocalPointInRectangle(markers,screen,null,out var local);
                local+=zone.Offset;
                var minX=-markers.rect.width*.5f+(narrow?62f:96f);
                // Reserve the right edge for the persistent desktop menu and
                // objective card, including half of the badge's own width.
                var maxX=markers.rect.width*.5f-(narrow?62f:370f);
                var minY=-markers.rect.height*.5f+(narrow?96f:96f);
                var maxY=markers.rect.height*.5f-(narrow?176f:176f);
                local.x=Mathf.Clamp(local.x,minX,maxX);
                local.y=Mathf.Clamp(local.y,minY,maxY);
                for(var tries=0;tries<occupied.Count*2+2;tries++)
                {
                    var overlap=false;foreach(var used in occupied)if(Vector2.Distance(used,local)<(narrow?45f:58f)){overlap=true;break;}
                    if(!overlap)break;local.y=Mathf.Clamp(local.y+(narrow?45f:54f),minY,maxY);
                }
                occupied.Add(local);zone.Badge.anchoredPosition=local;
            }
        }

        string Status(Zone zone,out bool urgent,out bool warning)
        {
            urgent=false;warning=false;
            if(zone.Id=="checkout")
            {
                var queue=runtime.Customers?.CheckoutQueueCount??0;urgent=queue>0;warning=queue>=4;
                return $"CAJA · {queue} EN FILA\n{runtime.Customers?.ActiveCount??0} clientes activos";
            }
            if(zone.Id=="entrance")return $"ENTRADA\n{runtime.Customers?.ActiveCount??0} clientes dentro";
            if(zone.Id=="farm")
            {
                var ready=0;foreach(var token in runtime.State.Array("crops"))if(token.Value<string>("status")=="READY")ready++;
                urgent=ready>0;return $"GRANJA · {ready} {(ready==1?"LISTO":"LISTOS")}\nToca para revisar";
            }

            var unlocked=0;var stock=0;var visitors=0;var nextLevel=int.MaxValue;
            foreach(var product in zone.Products)
            {
                var level=runtime.ProductPolicy.ProductUnlockLevel(product);nextLevel=Math.Min(nextLevel,level);
                if(!runtime.ProductPolicy.IsProductUnlocked(product,runtime.State.Level))continue;
                unlocked++;stock+=runtime.State.Quantity("shelves",product);visitors+=runtime.Customers?.ActivityAt(product)??0;
            }
            if(unlocked==0)return $"{zone.Title} · NIVEL {nextLevel}\nTodavía bloqueado";
            warning=stock==0;urgent=warning||visitors>0;
            var stockText=stock==0?"VACÍO":$"{stock} UDS";
            return $"{zone.Title} · {stockText}\n{visitors} cliente{(visitors==1?"":"s")} en la zona";
        }

        Vector3 Position(Zone zone)
        {
            if(runtime?.World==null)return Vector3.zero;
            if(zone.Id=="checkout")
            {
                // Frame the counters themselves. Customer interaction points
                // sit in front of both lanes; averaging those framed only the
                // nearest lane sign and left the actual checkout out of view.
                var points=runtime.World.CheckoutScanPoints;
                return points.Count>0?points[0].position:runtime.World.CheckoutScanPoint?runtime.World.CheckoutScanPoint.position:Vector3.zero;
            }
            if(zone.Id=="entrance")return runtime.World.EntranceOutside?runtime.World.EntranceOutside.position:Vector3.zero;
            if(zone.Id=="farm")
            {
                var sum=Vector3.zero;var count=0;foreach(var point in runtime.World.CropPoints.Values){sum+=point.position;count++;}
                return count>0?sum/count:new Vector3(0,0,-85);
            }
            foreach(var product in zone.Products)if(runtime.World.ProductServicePoints.TryGetValue(product,out var point))return point.position;
            return runtime.World.EntranceInside?runtime.World.EntranceInside.position:Vector3.zero;
        }

        void FrameAvatar()
        {
            var actor=runtime?.PlayerActor;if(!actor||!avatarImage)return;
            if(!avatarTexture)
            {
                avatarTexture=new RenderTexture(300,450,16,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB){name="CameraOverviewAvatar"};
                avatarImage.texture=avatarTexture;
            }
            if(!avatarCamera)
            {
                avatarCamera=new GameObject("CameraOverviewAvatarCamera",typeof(Camera)).GetComponent<Camera>();
                avatarCamera.transform.SetParent(transform,false);avatarCamera.clearFlags=CameraClearFlags.SolidColor;avatarCamera.backgroundColor=Html("EFE8DE");
                avatarCamera.targetTexture=avatarTexture;avatarCamera.fieldOfView=30f;avatarCamera.nearClipPlane=.05f;avatarCamera.farClipPlane=50f;avatarCamera.cullingMask=1<<AvatarLayer;
            }
            foreach(var piece in actor.GetComponentsInChildren<Transform>(true))piece.gameObject.layer=AvatarLayer;
            var renderers=actor.GetComponentsInChildren<Renderer>();if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var reach=Mathf.Max(bounds.extents.y,bounds.extents.x*1.55f);
            var distance=reach/Mathf.Tan(avatarCamera.fieldOfView*.5f*Mathf.Deg2Rad)+reach*.5f;
            var front=actor.transform.forward;front.y=0;if(front.sqrMagnitude<1e-4f)front=Vector3.forward;front.Normalize();
            avatarCamera.transform.position=bounds.center+front*distance+Vector3.up*reach*.10f;avatarCamera.transform.LookAt(bounds.center+Vector3.up*reach*.06f);
            avatarCamera.enabled=open;
        }

        void ApplyLayout()
        {
            screenWidth=Screen.width;screenHeight=Screen.height;narrow=screenHeight>screenWidth&&screenWidth<=720;
            if(!titleCard||!avatarCard)return;
            titleCard.anchorMin=titleCard.anchorMax=new Vector2(.5f,1);titleCard.pivot=new Vector2(.5f,1);
            titleCard.sizeDelta=narrow?new Vector2(376,62):new Vector2(500,64);titleCard.anchoredPosition=narrow?new Vector2(0,-104):new Vector2(0,-96);
            avatarCard.anchorMin=avatarCard.anchorMax=new Vector2(0,0);avatarCard.pivot=new Vector2(0,0);
            avatarCard.sizeDelta=narrow?new Vector2(124,196):new Vector2(226,330);avatarCard.anchoredPosition=narrow?new Vector2(12,14):new Vector2(18,18);
            foreach(var zone in zones)if(zone.Badge)zone.Badge.sizeDelta=narrow?new Vector2(116,44):new Vector2(174,50);
        }

        RectTransform Rect(string name,Transform parent)
        {
            var value=new GameObject(name,typeof(RectTransform)).GetComponent<RectTransform>();value.SetParent(parent,false);return value;
        }
        RectTransform Panel(string name,Transform parent,Color color)
        {
            var value=Rect(name,parent);var image=value.gameObject.AddComponent<Image>();image.color=color;if(rounded){image.sprite=rounded;image.type=Image.Type.Sliced;}return value;
        }
        Text Label(Transform parent,string value,int size,TextAnchor alignment)
        {
            var rect=Rect("Text",parent);var text=rect.gameObject.AddComponent<Text>();text.font=font;text.text=value;text.fontSize=size;text.resizeTextForBestFit=true;text.resizeTextMinSize=8;text.resizeTextMaxSize=size;text.alignment=alignment;text.color=Ink;return text;
        }
        RectTransform Button(Transform parent,string value,UnityEngine.Events.UnityAction action,Color fill,Color ink)
        {
            var rect=Panel(value,parent,fill);var button=rect.gameObject.AddComponent<Button>();button.targetGraphic=rect.GetComponent<Image>();button.onClick.AddListener(action);
            var caption=Label(rect,value,12,TextAnchor.MiddleCenter);caption.color=ink;caption.fontStyle=FontStyle.Bold;Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(6,2),new Vector2(-6,-2));return rect;
        }
        static void Stretch(RectTransform rect)=>Anchor(rect,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
        static void Anchor(RectTransform rect,Vector2 min,Vector2 max,Vector2 offsetMin,Vector2 offsetMax){rect.anchorMin=min;rect.anchorMax=max;rect.offsetMin=offsetMin;rect.offsetMax=offsetMax;}

        void OnDestroy()
        {
            if(rig)rig.SetOverview(false);
            if(avatarCamera)Destroy(avatarCamera.gameObject);
            if(avatarTexture)avatarTexture.Release();
        }
    }
}
