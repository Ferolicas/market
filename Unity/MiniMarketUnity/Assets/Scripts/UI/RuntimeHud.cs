using System;
using System.Collections;
using MiniMarket.Audio;
using MiniMarket.Core;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;
using MiniMarket.Player;
using MiniMarket.Networking;
using System.Globalization;

namespace MiniMarket.UI
{
    public sealed class RuntimeHud : MonoBehaviour
    {
        /// Canvas colours are taken as they are, so converting to linear here
        /// applies the sRGB decode a second time and everything renders dark:
        /// #4E5536 was reaching the screen as (22,22,13) instead of (78,85,54).
        /// Materials in the 3D scene are the opposite case and keep .linear.
        static Color Linear(string value){ColorUtility.TryParseHtmlString($"#{value}",out var color);return color;}
        static Color Alpha(Color color,float alpha){color.a=alpha;return color;}
        // globals.css tokens verbatim: --ink, --cream, --mint, --coral, --forest
        // plus .glass-panel's #ffffffe3 and the .positive/.negative ledger pair.
        // Palette measured from the delivered interface sheets, not carried over from
        // the web build: those are teal on white, these are olive on warm cream.
        static readonly Color Ink=Alpha(Linear("323524"),.98f);            // texto principal
        static readonly Color Cream=Alpha(Linear("FDFAF6"),.99f);          // texto sobre verde
        static readonly Color Green=Linear("4E5536");                      // accion primaria
        static readonly Color Orange=Linear("CF8946");                     // acento
        static readonly Color Glass=Alpha(Linear("F8F2EC"),.97f);          // panel
        static readonly Color Muted=Linear("8A8670");                      // texto secundario
        static readonly Color Border=Linear("E9E1D8");                     // separadores
        static readonly Color Sage=Linear("676E4A");                       // verde medio
        static readonly Color Forest=Alpha(Linear("323524"),.96f);
        static readonly Color Positive=Linear("676E4A");static readonly Color Negative=Linear("C1705A");
        Canvas canvas;Font font;Sprite roundedSprite;RectTransform loading;Text loadingText;Text money;Text clock;Text level;Text carry;Text save;Text prompt;Text toast;Text player;Text missionSummary;Text tutorialSummary;Text storeStatusText;Image storeStatusImage;RectTransform storeStatus;RectTransform carryChip;RectTransform saveChip;RectTransform promptPanel;RectTransform toastPanel;RectTransform tutorialCard;RectTransform drawer;RectTransform drawerContent;RectTransform drawerClose;RectTransform actions;readonly System.Collections.Generic.List<RectTransform> quickButtons=new();RectTransform levelBadge;Text levelBadgeText;RectTransform levelFill;RectTransform carrySlots;RectTransform toastRail;Image toastIconImage;Image saveIconImage;Image drawerIcon;Text drawerCountry;string currentPanel="inventory";int inventoryTab;int avatarTab;string setupCountry="ES";RectTransform loadingFill;Text loadingPercent;int loadingSteps;RectTransform qaPanel;Text qaText;float qaTimer;int qaFrames;int qaTriangles=-1;int qaRenderers;RenderTexture avatarTexture;Camera avatarCamera;ResponsiveHudLayout responsiveLayout;Text saveStamp;Text brandLabel;Image statusChevronImage;Image missionIconImage;readonly System.Collections.Generic.List<Image> tutorialSteps=new();readonly System.Collections.Generic.List<RectTransform> carryThumbs=new();Text drawerTitle;
        // Unused by the project; the main camera still draws it, so the world view
        // is unchanged while the preview camera can cull down to the player alone.
        const int AvatarLayer=8;
        MiniMarketRuntime runtime;AudioManager audioService;Coroutine toastRoutine;VirtualJoystick joystick;

        void Awake()=>Build();
        public void Bind(MiniMarketRuntime value,AudioManager audioManager)
        {
            runtime=value;audioService=audioManager;runtime.Signals.StateChanged+=Refresh;runtime.Signals.Notification+=Notify;runtime.Interactions.NearestChanged+=NearestChanged;
            BuildNavigation();BuildJoystick();Refresh();if(runtime.CompanySetup.Required)OpenPanel("setup");
        }

        public void ShowLoading(string message){if(!loading)Build();loading.gameObject.SetActive(true);loadingText.text=message;loadingSteps++;
            var progress=Mathf.Clamp01(loadingSteps/9f);SetMeter(loadingFill,progress);loadingPercent.text=$"{Mathf.RoundToInt(progress*100)}%";}
        public void HideLoading(){if(loading)loading.gameObject.SetActive(false);}
        public void ShowFatal(string message){ShowLoading(message);loadingText.color=new Color(1,.55f,.45f);}

        void Build()
        {
            font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            roundedSprite=CreateRoundedSprite();
            var root=new GameObject("GameUI",typeof(Canvas),typeof(CanvasScaler),typeof(GraphicRaycaster));root.transform.SetParent(transform,false);canvas=root.GetComponent<Canvas>();canvas.renderMode=RenderMode.ScreenSpaceOverlay;canvas.sortingOrder=30;
            var scaler=root.GetComponent<CanvasScaler>();scaler.uiScaleMode=CanvasScaler.ScaleMode.ScaleWithScreenSize;scaler.referenceResolution=new Vector2(1440,900);scaler.matchWidthOrHeight=.5f;
            var top=Panel("HudTop",root.transform,Glass);Anchor(top,new Vector2(.5f,1),new Vector2(.5f,1),new Vector2(-460,-82),new Vector2(460,-14));var layout=top.gameObject.AddComponent<HorizontalLayoutGroup>();layout.padding=new RectOffset(8,8,6,6);layout.spacing=0;layout.childForceExpandWidth=false;layout.childForceExpandHeight=true;
            var brandCell=Panel("Brand",top,new Color(0,0,0,0));SizeForLayout(brandCell,208);
            BrandMark(brandCell);
            var brand=brandLabel=Label(brandCell,"Mercado del Barrio\nDistrito inicial",13,TextAnchor.MiddleLeft);
            brand.color=Ink;brand.resizeTextForBestFit=false;
            Anchor(brand.rectTransform,new Vector2(0,0),new Vector2(1,1),new Vector2(52,0),new Vector2(-4,0));
            Divider(top);
            money=Label(top,"CAJA GLOBAL\n—",14,TextAnchor.MiddleCenter);SizeForLayout(money.rectTransform,132);money.resizeTextForBestFit=false;
            Divider(top);
            clock=Label(top,"VENTAS HOY\n—",13,TextAnchor.MiddleCenter);SizeForLayout(clock.rectTransform,136);clock.resizeTextForBestFit=false;
            level=Label(top,"NIVEL —\nPROGRESO",12,TextAnchor.MiddleCenter);SizeForLayout(level.rectTransform,80);var progressTrack=Panel("LevelProgress",level.transform,Alpha(Linear("D5E6DF"),.95f));Anchor(progressTrack,new Vector2(.12f,0),new Vector2(.88f,0),new Vector2(0,5),new Vector2(0,10));levelFill=Panel("Fill",progressTrack,Linear("F2A34D"));Anchor(levelFill,Vector2.zero,new Vector2(.22f,1),Vector2.zero,Vector2.zero);
            Divider(top);
            storeStatus=Pill(top,"CERRADO",()=>{runtime?.ToggleStore();audioService?.UiConfirm();},Green,Cream);
            SizeForLayout(storeStatus,124);
            storeStatusText=storeStatus.GetComponentInChildren<Text>();storeStatusImage=storeStatus.GetComponent<Image>();
            // Room for the chevron: on a narrowed cell the caption ran under it.
            storeStatusText.rectTransform.offsetMax=new Vector2(-26,0);
            var statusChevron=new GameObject("Chevron",typeof(RectTransform),typeof(Image));statusChevron.transform.SetParent(storeStatus,false);
            statusChevronImage=statusChevron.GetComponent<Image>();statusChevronImage.sprite=Icon("chevron");statusChevronImage.preserveAspect=true;statusChevronImage.raycastTarget=false;
            var statusChevronRect=statusChevron.GetComponent<RectTransform>();statusChevronRect.anchorMin=statusChevronRect.anchorMax=new Vector2(1,.5f);statusChevronRect.pivot=new Vector2(1,.5f);statusChevronRect.sizeDelta=new Vector2(13,13);statusChevronRect.anchoredPosition=new Vector2(-11,0);
            CornerBadge(root.transform);

            var mission=Panel("MissionCard",root.transform,Glass);Anchor(mission,new Vector2(0,1),new Vector2(0,1),new Vector2(14,-146),new Vector2(258,-84));
            var missionButton=mission.gameObject.AddComponent<Button>();missionButton.onClick.AddListener(()=>{OpenPanel("missions");audioService?.UiConfirm();});
            var missionIcon=new GameObject("Icon",typeof(RectTransform),typeof(Image));missionIcon.transform.SetParent(mission,false);
            missionIconImage=missionIcon.GetComponent<Image>();missionIconImage.sprite=Icon("target");missionIconImage.color=Green;missionIconImage.preserveAspect=true;missionIconImage.raycastTarget=false;
            var missionIconRect=missionIcon.GetComponent<RectTransform>();missionIconRect.anchorMin=missionIconRect.anchorMax=new Vector2(0,.5f);missionIconRect.pivot=new Vector2(0,.5f);missionIconRect.sizeDelta=new Vector2(22,22);missionIconRect.anchoredPosition=new Vector2(14,0);
            var missionChevron=new GameObject("Chevron",typeof(RectTransform),typeof(Image));missionChevron.transform.SetParent(mission,false);
            var missionChevronImage=missionChevron.GetComponent<Image>();missionChevronImage.sprite=Icon("chevron");missionChevronImage.color=Muted;missionChevronImage.preserveAspect=true;missionChevronImage.raycastTarget=false;
            var missionChevronRect=missionChevron.GetComponent<RectTransform>();missionChevronRect.anchorMin=missionChevronRect.anchorMax=new Vector2(1,.5f);missionChevronRect.pivot=new Vector2(1,.5f);missionChevronRect.sizeDelta=new Vector2(15,15);missionChevronRect.anchoredPosition=new Vector2(-12,0);
            missionSummary=Label(mission,"PROGRESO AL NIVEL 2\nObjetivos del día 0/0",13,TextAnchor.MiddleLeft);missionSummary.resizeTextForBestFit=false;Anchor(missionSummary.rectTransform,Vector2.zero,Vector2.one,new Vector2(44,4),new Vector2(-30,-4));


            tutorialCard=Panel("LevelOneGuide",root.transform,Glass);Anchor(tutorialCard,new Vector2(1,1),new Vector2(1,1),new Vector2(-284,-152),new Vector2(-88,-84));
            var guideIcon=new GameObject("Icon",typeof(RectTransform),typeof(Image));guideIcon.transform.SetParent(tutorialCard,false);
            var guideIconImage=guideIcon.GetComponent<Image>();guideIconImage.sprite=Icon("help");guideIconImage.color=Orange;guideIconImage.preserveAspect=true;guideIconImage.raycastTarget=false;
            var guideIconRect=guideIcon.GetComponent<RectTransform>();guideIconRect.anchorMin=guideIconRect.anchorMax=new Vector2(0,1);guideIconRect.pivot=new Vector2(0,1);guideIconRect.sizeDelta=new Vector2(20,20);guideIconRect.anchoredPosition=new Vector2(13,-11);
            tutorialSummary=Label(tutorialCard,"PASO 1 DE 5\nCultiva los primeros tomates",12,TextAnchor.UpperLeft);tutorialSummary.resizeTextForBestFit=false;tutorialSummary.color=Ink;Anchor(tutorialSummary.rectTransform,Vector2.zero,Vector2.one,new Vector2(40,20),new Vector2(-10,-8));
            var guideRail=Panel("Rail",tutorialCard,Border);
            guideRail.anchorMin=guideRail.anchorMax=new Vector2(0,0);guideRail.pivot=new Vector2(0,.5f);
            guideRail.sizeDelta=new Vector2(132,3);guideRail.anchoredPosition=new Vector2(44,15);
            for(var i=0;i<5;i++)
            {
                // Five dots threaded on a rail, so the step reads without the caption.
                var dot=Panel($"Step{i}",tutorialCard,Border);
                dot.anchorMin=dot.anchorMax=new Vector2(0,0);dot.pivot=new Vector2(.5f,.5f);
                dot.sizeDelta=new Vector2(11,11);dot.anchoredPosition=new Vector2(46+i*31,15);
                tutorialSteps.Add(dot.GetComponent<Image>());
            }
            tutorialCard.gameObject.SetActive(false);

            promptPanel=Panel("ProximityPrompt",root.transform,Forest);promptPanel.GetComponent<Image>().raycastTarget=false;Anchor(promptPanel,new Vector2(.5f,0),new Vector2(.5f,0),new Vector2(-132,92),new Vector2(132,144));
            var promptIcon=new GameObject("Icon",typeof(RectTransform),typeof(Image));promptIcon.transform.SetParent(promptPanel,false);
            var promptIconImage=promptIcon.GetComponent<Image>();promptIconImage.sprite=Icon("circle");promptIconImage.color=Alpha(Cream,.92f);promptIconImage.preserveAspect=true;promptIconImage.raycastTarget=false;
            var promptIconRect=promptIcon.GetComponent<RectTransform>();promptIconRect.anchorMin=promptIconRect.anchorMax=new Vector2(0,.5f);promptIconRect.pivot=new Vector2(0,.5f);promptIconRect.sizeDelta=new Vector2(18,18);promptIconRect.anchoredPosition=new Vector2(16,0);
            prompt=Label(promptPanel,"",14,TextAnchor.MiddleLeft);prompt.resizeTextForBestFit=false;Anchor(prompt.rectTransform,Vector2.zero,Vector2.one,new Vector2(42,2),new Vector2(-12,-2));prompt.color=Cream;promptPanel.gameObject.SetActive(false);
            toastPanel=Panel("Toast",root.transform,Alpha(Cream,.98f));Anchor(toastPanel,new Vector2(.5f,0),new Vector2(.5f,0),new Vector2(-236,158),new Vector2(236,214));
            toastRail=Panel("Rail",toastPanel,Green);Anchor(toastRail,new Vector2(0,0),new Vector2(0,1),new Vector2(0,6),new Vector2(5,-6));
            var toastIcon=new GameObject("Icon",typeof(RectTransform),typeof(Image));toastIcon.transform.SetParent(toastPanel,false);
            toastIconImage=toastIcon.GetComponent<Image>();toastIconImage.sprite=Icon("check");toastIconImage.color=Green;toastIconImage.preserveAspect=true;toastIconImage.raycastTarget=false;
            var toastIconRect=toastIcon.GetComponent<RectTransform>();toastIconRect.anchorMin=toastIconRect.anchorMax=new Vector2(0,.5f);toastIconRect.pivot=new Vector2(0,.5f);toastIconRect.sizeDelta=new Vector2(21,21);toastIconRect.anchoredPosition=new Vector2(20,0);
            toast=Label(toastPanel,"",15,TextAnchor.MiddleLeft);toast.resizeTextForBestFit=false;Anchor(toast.rectTransform,Vector2.zero,Vector2.one,new Vector2(50,4),new Vector2(-38,-4));toast.color=Ink;
            var toastClose=CloseGlyph(toastPanel,Muted,HideToast,28);
            toastClose.anchorMin=toastClose.anchorMax=new Vector2(1,.5f);toastClose.pivot=new Vector2(1,.5f);
            toastClose.anchoredPosition=new Vector2(-14,0);
            var group=toastPanel.gameObject.AddComponent<CanvasGroup>();group.alpha=0;group.blocksRaycasts=false;

            saveChip=Panel("SaveChip",root.transform,Linear("F5EEE3"));Anchor(saveChip,new Vector2(0,0),new Vector2(0,0),new Vector2(14,14),new Vector2(196,58));
            var saveIcon=new GameObject("Icon",typeof(RectTransform),typeof(Image));saveIcon.transform.SetParent(saveChip,false);
            saveIconImage=saveIcon.GetComponent<Image>();saveIconImage.sprite=Icon("check");saveIconImage.color=Green;saveIconImage.preserveAspect=true;saveIconImage.raycastTarget=false;
            var saveIconRect=saveIcon.GetComponent<RectTransform>();saveIconRect.anchorMin=saveIconRect.anchorMax=new Vector2(0,.5f);saveIconRect.pivot=new Vector2(0,.5f);saveIconRect.sizeDelta=new Vector2(19,19);saveIconRect.anchoredPosition=new Vector2(14,0);
            save=Label(saveChip,"GUARDADO",12,TextAnchor.MiddleLeft);save.resizeTextForBestFit=false;save.fontStyle=FontStyle.Bold;Anchor(save.rectTransform,new Vector2(0,.5f),new Vector2(1,1),new Vector2(42,0),new Vector2(-10,-6));save.color=Ink;saveStamp=Label(saveChip,"",11,TextAnchor.LowerLeft);saveStamp.resizeTextForBestFit=false;Anchor(saveStamp.rectTransform,new Vector2(0,0),new Vector2(1,.5f),new Vector2(42,6),new Vector2(-10,0));saveStamp.color=Muted;saveChip.gameObject.SetActive(false);
            carryChip=Panel("CarryChip",root.transform,Linear("F4ECE2"));Anchor(carryChip,new Vector2(1,0),new Vector2(1,0),new Vector2(-244,74),new Vector2(-14,166));
            var carryTag=Panel("Tag",carryChip,Cream);Anchor(carryTag,new Vector2(0,1),new Vector2(0,1),new Vector2(12,-36),new Vector2(78,-10));
            var carryTagText=Label(carryTag,"CESTA",11,TextAnchor.MiddleCenter);carryTagText.resizeTextForBestFit=false;carryTagText.fontStyle=FontStyle.Bold;carryTagText.color=Ink;Anchor(carryTagText.rectTransform,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
            var carryCount=Panel("Count",carryChip,Cream);Anchor(carryCount,new Vector2(0,1),new Vector2(0,1),new Vector2(84,-36),new Vector2(140,-10));
            carry=Label(carryCount,"0/0",11,TextAnchor.MiddleCenter);carry.resizeTextForBestFit=false;carry.color=Sage;Anchor(carry.rectTransform,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
            carrySlots=Panel("Slots",carryChip,new Color(0,0,0,0));Anchor(carrySlots,new Vector2(0,0),new Vector2(1,0),new Vector2(12,12),new Vector2(-12,86));
            var carryLayout=carrySlots.gameObject.AddComponent<HorizontalLayoutGroup>();carryLayout.spacing=6;carryLayout.childForceExpandWidth=false;carryLayout.childForceExpandHeight=true;carryLayout.childAlignment=TextAnchor.MiddleLeft;
            carryChip.gameObject.SetActive(false);
            var playerChip=Panel("PlayerChip",root.transform,Green);
            Anchor(playerChip,new Vector2(1,0),new Vector2(1,0),new Vector2(-234,14),new Vector2(-14,112));
            var avatarMark=Panel("Portrait",playerChip,Alpha(Cream,.22f));
            avatarMark.anchorMin=avatarMark.anchorMax=new Vector2(0,1);avatarMark.pivot=new Vector2(0,1);
            avatarMark.sizeDelta=new Vector2(38,38);avatarMark.anchoredPosition=new Vector2(10,-10);
            var face=new GameObject("Icon",typeof(RectTransform),typeof(Image));
            face.transform.SetParent(avatarMark,false);
            var faceImage=face.GetComponent<Image>();faceImage.sprite=Icon("avatar");faceImage.color=Cream;
            faceImage.preserveAspect=true;faceImage.raycastTarget=false;
            Anchor(face.GetComponent<RectTransform>(),Vector2.zero,Vector2.one,new Vector2(8,8),new Vector2(-8,-8));
            player=Label(playerChip,"PROPIETARIO\nReputacion —",13,TextAnchor.UpperLeft);
            player.resizeTextForBestFit=false;
            Anchor(player.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(56,-40),new Vector2(-10,-8));
            var repTrack=Panel("Reputation",playerChip,Alpha(Cream,.30f));
            Anchor(repTrack,new Vector2(0,1),new Vector2(1,1),new Vector2(56,-52),new Vector2(-10,-44));
            var repFill=Panel("Fill",repTrack,Cream);
            Anchor(repFill,Vector2.zero,new Vector2(.34f,1),Vector2.zero,Vector2.zero);
            var saveButton=Pill(playerChip,"GUARDAR",()=>{ if(runtime)_ = runtime.SyncNow(); audioService?.UiConfirm(); },Alpha(Cream,.20f),Cream);
            Anchor(saveButton,new Vector2(0,0),new Vector2(1,0),new Vector2(10,9),new Vector2(-10,37));

            drawer=Panel("ManagementPanel",root.transform,Glass);
            Anchor(drawer,new Vector2(.12f,.09f),new Vector2(.88f,.91f),Vector2.zero,Vector2.zero);

            // Header: icon badge, uppercase title, plain close glyph on the right.
            var header=Panel("Header",drawer,new Color(0,0,0,0));
            Anchor(header,new Vector2(0,1),new Vector2(1,1),new Vector2(0,-64),new Vector2(0,0));
            var badge=Panel("Badge",header,Alpha(Green,.12f));
            badge.anchorMin=badge.anchorMax=new Vector2(0,.5f);badge.pivot=new Vector2(0,.5f);
            badge.sizeDelta=new Vector2(34,34);badge.anchoredPosition=new Vector2(22,0);
            var badgeGlyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
            badgeGlyph.transform.SetParent(badge,false);
            drawerIcon=badgeGlyph.GetComponent<Image>();drawerIcon.sprite=Icon("inventory");drawerIcon.color=Green;
            drawerIcon.preserveAspect=true;drawerIcon.raycastTarget=false;
            Anchor(badgeGlyph.GetComponent<RectTransform>(),Vector2.zero,Vector2.one,new Vector2(8,8),new Vector2(-8,-8));
            drawerTitle=Label(header,"INVENTARIO",17,TextAnchor.MiddleLeft);drawerTitle.color=Ink;
            drawerTitle.fontStyle=FontStyle.Bold;drawerTitle.resizeTextForBestFit=false;
            Anchor(drawerTitle.rectTransform,Vector2.zero,Vector2.one,new Vector2(66,0),new Vector2(-56,0));
            drawerClose=CloseGlyph(header,Muted,()=>{CloseDrawer();audioService?.UiConfirm();},34);
            drawerClose.anchorMin=drawerClose.anchorMax=new Vector2(1,.5f);drawerClose.pivot=new Vector2(1,.5f);
            drawerClose.anchoredPosition=new Vector2(-18,0);
            Divider(header);

            // Footer: fiscal country and currency on the left, the two session
            // actions on the right, exactly as every panel on the sheet repeats it.
            var footer=Panel("Footer",drawer,new Color(0,0,0,0));
            Anchor(footer,new Vector2(0,0),new Vector2(1,0),new Vector2(0,0),new Vector2(0,56));
            drawerCountry=Label(footer,"—  |  —",12,TextAnchor.MiddleLeft);drawerCountry.color=Muted;drawerCountry.resizeTextForBestFit=false;
            Anchor(drawerCountry.rectTransform,new Vector2(0,0),new Vector2(.5f,1),new Vector2(24,0),new Vector2(0,0));
            var signOut=Pill(footer,"Cerrar sesión",()=>{_ = runtime.SyncNow();MiniMarket.Networking.WebSessionBridge.Logout();audioService?.UiConfirm();},Green,Cream);
            signOut.anchorMin=signOut.anchorMax=new Vector2(1,.5f);signOut.pivot=new Vector2(1,.5f);
            signOut.sizeDelta=new Vector2(124,34);signOut.anchoredPosition=new Vector2(-22,0);
            var endDay=Pill(footer,"Cerrar jornada",()=>{runtime.CloseDay();audioService?.UiConfirm();RefreshPanel(currentPanel);},Cream,Ink);
            endDay.anchorMin=endDay.anchorMax=new Vector2(1,.5f);endDay.pivot=new Vector2(1,.5f);
            endDay.sizeDelta=new Vector2(124,34);endDay.anchoredPosition=new Vector2(-154,0);

            var viewport=Panel("Viewport",drawer,new Color(0,0,0,0));
            Anchor(viewport,new Vector2(0,0),new Vector2(1,1),new Vector2(22,58),new Vector2(-22,-66));
            viewport.gameObject.AddComponent<RectMask2D>();
            var scroll=viewport.gameObject.AddComponent<ScrollRect>();scroll.horizontal=false;scroll.movementType=ScrollRect.MovementType.Clamped;scroll.scrollSensitivity=34;
            drawerContent=new GameObject("Content",typeof(RectTransform),typeof(VerticalLayoutGroup),typeof(ContentSizeFitter)).GetComponent<RectTransform>();
            drawerContent.SetParent(viewport,false);drawerContent.anchorMin=new Vector2(0,1);drawerContent.anchorMax=new Vector2(1,1);drawerContent.pivot=new Vector2(.5f,1);
            drawerContent.anchoredPosition=Vector2.zero;drawerContent.sizeDelta=Vector2.zero;
            var vertical=drawerContent.GetComponent<VerticalLayoutGroup>();vertical.spacing=10;vertical.childForceExpandHeight=false;vertical.childForceExpandWidth=true;vertical.padding=new RectOffset(4,4,6,6);
            drawerContent.GetComponent<ContentSizeFitter>().verticalFit=ContentSizeFitter.FitMode.PreferredSize;
            scroll.content=drawerContent;scroll.viewport=viewport;drawer.gameObject.SetActive(false);
            loading=Panel("Loading",root.transform,Linear("F2ECE4"));
            Anchor(loading,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
            var loadingCard=Card(loading,Cream);
            loadingCard.parent.GetComponent<RectTransform>().anchorMin=new Vector2(.5f,.5f);
            loadingCard.parent.GetComponent<RectTransform>().anchorMax=new Vector2(.5f,.5f);
            (loadingCard.parent as RectTransform).pivot=new Vector2(.5f,.5f);
            (loadingCard.parent as RectTransform).sizeDelta=new Vector2(420,180);
            (loadingCard.parent as RectTransform).anchoredPosition=Vector2.zero;
            var loadingMark=Panel("Mark",loadingCard,Alpha(Green,.12f));
            loadingMark.anchorMin=loadingMark.anchorMax=new Vector2(0,1);loadingMark.pivot=new Vector2(0,1);
            loadingMark.sizeDelta=new Vector2(46,46);loadingMark.anchoredPosition=new Vector2(24,-24);
            var loadingGlyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
            loadingGlyph.transform.SetParent(loadingMark,false);
            var loadingGlyphImage=loadingGlyph.GetComponent<Image>();loadingGlyphImage.sprite=Icon("store");
            loadingGlyphImage.color=Green;loadingGlyphImage.preserveAspect=true;loadingGlyphImage.raycastTarget=false;
            Anchor(loadingGlyph.GetComponent<RectTransform>(),Vector2.zero,Vector2.one,new Vector2(11,11),new Vector2(-11,-11));
            loadingText=Label(loadingCard,"Preparando la tienda…",20,TextAnchor.UpperLeft);
            loadingText.color=Ink;loadingText.fontStyle=FontStyle.Bold;loadingText.resizeTextForBestFit=false;
            Anchor(loadingText.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(84,-60),new Vector2(-24,-24));
            var loadingTrack=Panel("Track",loadingCard,Border);
            Anchor(loadingTrack,new Vector2(0,0),new Vector2(1,0),new Vector2(24,42),new Vector2(-84,52));
            loadingFill=Panel("Fill",loadingTrack,Green);
            Anchor(loadingFill,Vector2.zero,new Vector2(.08f,1),Vector2.zero,Vector2.zero);
            loadingPercent=Label(loadingCard,"8%",13,TextAnchor.MiddleRight);
            loadingPercent.color=Sage;loadingPercent.resizeTextForBestFit=false;
            Anchor(loadingPercent.rectTransform,new Vector2(1,0),new Vector2(1,0),new Vector2(-74,36),new Vector2(-24,58));

            // QA readout: hidden unless the build asks for it, dark card top right.
            qaPanel=Panel("QaPanel",root.transform,Linear("2E3325"));
            Anchor(qaPanel,new Vector2(1,1),new Vector2(1,1),new Vector2(-186,-206),new Vector2(-14,-92));
            qaText=Label(qaPanel,"QA",12,TextAnchor.UpperLeft);
            qaText.color=Alpha(Cream,.92f);qaText.resizeTextForBestFit=false;
            Anchor(qaText.rectTransform,Vector2.zero,Vector2.one,new Vector2(14,10),new Vector2(-12,-10));
            var qaDot=Panel("Dot",qaPanel,Linear("7FB069"));
            qaDot.anchorMin=qaDot.anchorMax=new Vector2(1,1);qaDot.pivot=new Vector2(1,1);
            qaDot.sizeDelta=new Vector2(9,9);qaDot.anchoredPosition=new Vector2(-14,-14);
            qaPanel.gameObject.SetActive(false);
        }

        void BuildNavigation()
        {
            actions=Panel("QuickMenu",canvas.transform,Glass);
            // The stylesheet puts this menu in a 76px column down the right edge,
            // 100px from the top -- not as a bar across the bottom.
            Anchor(actions,new Vector2(1,1),new Vector2(1,1),new Vector2(-186,-452),new Vector2(-14,-100));
            var row=actions.gameObject.AddComponent<GridLayoutGroup>();row.padding=new RectOffset(7,7,7,7);row.spacing=new Vector2(5,5);row.constraint=GridLayoutGroup.Constraint.FixedColumnCount;row.constraintCount=1;row.cellSize=new Vector2(158,38);
            QuickButton(row.transform,"inventory",()=>OpenPanel("inventory"),"Inventario");
            QuickButton(row.transform,"suppliers",()=>OpenPanel("supplier"),"Proveedores");
            QuickButton(row.transform,"team",()=>OpenPanel("hiring"),"Equipo");
            QuickButton(row.transform,"map",()=>OpenPanel("map"),"Franquicias");
            QuickButton(row.transform,"finance",()=>OpenPanel("finance"),"Finanzas");
            QuickButton(row.transform,"build",()=>OpenPanel("upgrade"),"Construir");
            QuickButton(row.transform,"avatar",()=>OpenPanel("closet"),"Avatar");
            QuickButton(row.transform,"help",()=>OpenPanel("help"),"Cómo jugar");
            // Both sit inside the sheet but outside its grid: without this the
            // layout hands each of them a cell and they become a ninth and tenth
            // entry in the menu.
            var handle=Panel("Handle",actions,Muted);
            handle.gameObject.AddComponent<LayoutElement>().ignoreLayout=true;
            handle.anchorMin=handle.anchorMax=new Vector2(.5f,1);handle.pivot=new Vector2(.5f,1);
            handle.sizeDelta=new Vector2(46,5);handle.anchoredPosition=new Vector2(0,-7);
            var sheetClose=CloseGlyph(actions,Muted,()=>{actions.gameObject.SetActive(false);audioService?.UiConfirm();},34);
            sheetClose.gameObject.AddComponent<LayoutElement>().ignoreLayout=true;
            sheetClose.anchorMin=sheetClose.anchorMax=new Vector2(.5f,0);sheetClose.pivot=new Vector2(.5f,0);
            sheetClose.anchoredPosition=new Vector2(0,6);
            responsiveLayout=gameObject.AddComponent<ResponsiveHudLayout>();responsiveLayout.Bind(actions,drawer,row,quickButtons,handle,sheetClose,canvas.transform.Find("HudTop") as RectTransform,tutorialCard);
        }

        void BuildJoystick()
        {
            // The complete screen remains draggable, but portrait players also
            // get the exact visual control supplied in the mobile interface kit.
            // It is non-blocking, so dragging outside the drawing still works.
            var area=Panel("GameInputSurface",canvas.transform,new Color(0,0,0,0));Anchor(area,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);area.SetAsFirstSibling();
            joystick=area.gameObject.AddComponent<VirtualJoystick>();joystick.Bind(area,runtime.Player,canvas);
            var visualObject=new GameObject("JoystickVisual",typeof(RectTransform),typeof(RawImage));
            visualObject.transform.SetParent(canvas.transform,false);
            var visual=visualObject.GetComponent<RectTransform>();
            visual.anchorMin=visual.anchorMax=new Vector2(0,0);visual.pivot=new Vector2(0,0);
            visual.sizeDelta=new Vector2(126,115);visual.anchoredPosition=new Vector2(14,70);
            var image=visualObject.GetComponent<RawImage>();image.texture=Resources.Load<Texture2D>("UI/Joystick");image.raycastTarget=false;
            visual.SetSiblingIndex(Mathf.Min(1,canvas.transform.childCount-1));
            responsiveLayout?.BindJoystick(visual);
        }

        bool Narrow=>responsiveLayout&&responsiveLayout.Narrow;

        void CloseDrawer()
        {
            drawer.gameObject.SetActive(false);
            if(avatarCamera)avatarCamera.enabled=false;
            responsiveLayout?.DrawerOpened(false);
        }

        public void OpenPanel(string id)
        {
            if(!runtime)return;Clear(drawerContent);drawerTitle.text=id switch{"supplier"=>"PROVEEDORES","hiring"=>"EQUIPO","upgrade"=>"CONSTRUIR","closet"=>"AVATAR","map"=>"FRANQUICIAS","finance"=>"FINANZAS","help"=>"CÓMO JUGAR","missions"=>"PROGRESO Y OBJETIVOS","setup"=>"CREA TU EMPRESA",_=>"INVENTARIO"};
            currentPanel=id;
            drawerIcon.sprite=Icon(id switch{"supplier"=>"suppliers","hiring"=>"team","upgrade"=>"build","closet"=>"avatar","map"=>"map","finance"=>"finance","help"=>"help","missions"=>"target","setup"=>"store",_=>"inventory"});
            if(id=="supplier")BuildSuppliers();else if(id=="inventory")BuildInventory();else if(id=="hiring")BuildTeam();else if(id=="closet")BuildCloset();else if(id=="map")BuildFranchises();else if(id=="finance")BuildFinance();else if(id=="help")BuildHelp();else if(id=="missions")BuildMissions();else if(id=="setup")BuildSetup();else BuildUpgrades();
            var country=runtime.Spec.Root["catalog"]?["COUNTRIES"]?[runtime.State.CountryCode] as JObject;
            drawerCountry.text=$"{country?.Value<string>("name")??runtime.State.CountryCode}  ·  {country?.Value<string>("currency")??""}";
            var setup=id=="setup";if(drawerClose)drawerClose.gameObject.SetActive(!setup);if(actions)actions.gameObject.SetActive(!setup);
            if(avatarCamera)avatarCamera.enabled=id=="closet";
            responsiveLayout?.DrawerOpened(true);
            drawer.SetAsLastSibling();
            drawer.gameObject.SetActive(true);
        }
        void BuildSetup()
        {
            var countries=runtime.Spec.Root["catalog"]?["COUNTRIES"] as JObject;
            var selected=countries?[setupCountry] as JObject;

            SectionHeader("CREAR EMPRESA");
            var intro=Label(drawerContent,"El país fija moneda, impuestos y capital inicial, y no podrá cambiarse después de empezar a vender.",12,TextAnchor.UpperLeft);
            intro.color=Muted;intro.resizeTextForBestFit=false;
            var introElement=intro.gameObject.AddComponent<LayoutElement>();introElement.preferredHeight=34;introElement.minHeight=34;

            SectionHeader("PAÍS");
            if(countries!=null)
            {
                var codes=new System.Collections.Generic.List<string>();
                foreach(var property in countries.Properties())codes.Add(property.Name);
                for(var start=0;start<codes.Count;start+=4)
                {
                    var row=Row(52,4);
                    for(var i=start;i<Mathf.Min(start+4,codes.Count);i++)
                    {
                        var code=codes[i];var country=(JObject)countries[code];
                        var chosen=code==setupCountry;
                        var card=Card(row,chosen?Alpha(Green,.14f):Cream);
                        var caption=Label(card,country.Value<string>("name"),12,TextAnchor.MiddleCenter);
                        caption.color=chosen?Green:Ink;caption.resizeTextForBestFit=false;
                        if(chosen)caption.fontStyle=FontStyle.Bold;
                        Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(6,4),new Vector2(-6,-4));
                        var button=card.gameObject.AddComponent<Button>();
                        button.targetGraphic=card.GetComponent<Image>();
                        button.onClick.AddListener(()=>{setupCountry=code;audioService?.UiConfirm();RefreshPanel("setup");});
                    }
                    for(var i=codes.Count;i<start+4;i++)Panel("Empty",row,new Color(0,0,0,0));
                }
            }

            var summary=Row(70,3);
            StatCard(summary,"MONEDA",selected?.Value<string>("currency")??"—",Ink);
            StatCard(summary,"IMPUESTOS (IVA)",$"{selected?.Value<double?>("salesTaxRate")??0:P0}",Ink);
            StatCard(summary,"CAPITAL INICIAL",Money(selected?.Value<long?>("startingCapitalMinor")??0),Green);

            SectionHeader("PERSONAJE INICIAL");
            var bodies=new[]{("adult-man","Hombre adulto"),("adult-woman","Mujer adulta"),("boy","Niño"),("girl","Niña")};
            var picker=Row(84,4);
            foreach(var (id,label) in bodies)SwatchTile(picker,label,Linear("E2D6C6"),()=>_ = runtime.ChangePlayerBody(id));

            var launch=Row(40,3);
            Panel("Spacer",launch,new Color(0,0,0,0));
            Panel("Spacer",launch,new Color(0,0,0,0));
            PrimaryButton(launch,"COMENZAR",()=>CompleteSetup(setupCountry),40);
        }
        void CompleteSetup(string countryCode)
        {
            if(!runtime.CompleteCompanySetup(countryCode)){Notify("No se pudo registrar la empresa");return;}
            DismissSetup();audioService.UiConfirm();
        }
        public void DismissSetup(){CloseDrawer();if(drawerClose)drawerClose.gameObject.SetActive(true);if(actions)actions.gameObject.SetActive(true);}




        // ---- the eight drawer panels, section C of the sheet -------------------

        void BuildInventory()
        {
            var scopes=new[]{"Carga","Almacén","Estante"};
            var head=Row(38);
            var tabHost=Panel("Tabs",head,new Color(0,0,0,0));
            // On a phone the tabs take the row; at the desktop fraction the three
            // captions wrap onto two lines inside 56 units each.
            Anchor(tabHost,new Vector2(0,0),new Vector2(Narrow?.62f:.42f,1),Vector2.zero,Vector2.zero);
            Tabs(scopes,inventoryTab,index=>{inventoryTab=index;RefreshPanel("inventory");},38,tabHost);
            if(inventoryTab==0)
            {
                var giveBack=SecondaryButton(head,"Devolver carga",()=>{runtime.ReturnCarriedItems();RefreshPanel("inventory");},32);
                giveBack.anchorMin=giveBack.anchorMax=new Vector2(1,.5f);giveBack.pivot=new Vector2(1,.5f);
                giveBack.sizeDelta=new Vector2(168,32);giveBack.anchoredPosition=new Vector2(-4,0);
            }
            var entries=new System.Collections.Generic.List<(string id,string name,int quantity)>();
            foreach(var property in runtime.Spec.Products.Properties())
            {
                var id=property.Name;
                var quantity=inventoryTab switch
                {
                    0=>runtime.Carry.Quantity(id),
                    1=>runtime.State.Quantity("warehouse",id),
                    _=>runtime.State.Quantity("shelves",id)
                };
                if(quantity<=0&&!runtime.ProductPolicy.IsProductUnlocked(id,runtime.State.Level))continue;
                entries.Add((id,property.Value.Value<string>("name")??id,quantity));
            }
            if(entries.Count==0){SectionHeader("SIN EXISTENCIAS EN ESTA VISTA");return;}
            var columns=Narrow?3:5;
            for(var start=0;start<entries.Count;start+=columns)
            {
                var row=Row(96,columns);
                for(var i=start;i<Mathf.Min(start+columns,entries.Count);i++)
                    ProductTile(row,entries[i].id,entries[i].name,entries[i].quantity);
                for(var i=entries.Count;i<start+columns;i++)Panel("Empty",row,Alpha(Cream,.35f));
            }
        }

        void BuildSuppliers()
        {
            if(runtime.Spec.Root["catalog"]?["SUPPLIERS"] is not JArray suppliers)return;
            foreach(var token in suppliers)
            {
                if(token is not JObject supplier)continue;
                var id=supplier.Value<string>("id");
                var unlockLevel=supplier.Value<int?>("unlockLevel")??1;
                var available=runtime.State.Level>=unlockLevel;
                var offered=false;
                foreach(var property in runtime.Spec.Products.Properties())
                    if(property.Value.Value<string>("supplier")==id
                       &&runtime.ProductPolicy.IsProductUnlocked(property.Name,runtime.State.Level))
                    { offered=true;break; }
                // A supplier whose whole catalogue is still locked printed a bare
                // heading with nothing under it.
                if(!offered)continue;
                SectionHeader(supplier.Value<string>("name")?.ToUpperInvariant()??id);
                foreach(var property in runtime.Spec.Products.Properties())
                {
                    var productId=property.Name;
                    if(property.Value.Value<string>("supplier")!=id)continue;
                    if(!runtime.ProductPolicy.IsProductUnlocked(productId,runtime.State.Level))continue;
                    var name=property.Value.Value<string>("name")??productId;
                    var price=runtime.Spec.ScaleMoney(property.Value.Value<long>("wholesaleMinor")*10,runtime.State.CountryCode);
                    var row=Card(drawerContent,null,46);
                    var swatch=Panel("Swatch",row,SupplierTint(id));
                    swatch.anchorMin=swatch.anchorMax=new Vector2(0,.5f);swatch.pivot=new Vector2(0,.5f);
                    swatch.sizeDelta=new Vector2(30,30);swatch.anchoredPosition=new Vector2(10,0);
                    var mark=Label(swatch,Initials(name),12,TextAnchor.MiddleCenter);
                    mark.color=Alpha(Ink,.6f);mark.resizeTextForBestFit=false;
                    Anchor(mark.rectTransform,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
                    var caption=Label(row,name,13,TextAnchor.MiddleLeft);caption.color=Ink;caption.resizeTextForBestFit=false;
                    caption.fontStyle=FontStyle.Bold;
                    Anchor(caption.rectTransform,new Vector2(0,0),new Vector2(.44f,1),new Vector2(50,0),new Vector2(0,0));
                    Stars(row,4.9-(supplier.Value<double?>("discount")??0)*3,.46f);
                    if(available)
                    {
                        var order=PrimaryButton(row,$"Pedir 10 · {Money(price)}",()=>
                        {
                            if(!runtime.Orders.Order(productId,10))Notify("Pedido no disponible o caja insuficiente");
                            else audioService?.UiConfirm();
                            RefreshPanel("supplier");
                        },30);
                        order.anchorMin=order.anchorMax=new Vector2(1,.5f);order.pivot=new Vector2(1,.5f);
                        order.sizeDelta=new Vector2(158,30);order.anchoredPosition=new Vector2(-10,0);
                    }
                    else
                    {
                        var locked=Label(row,$"Nivel {unlockLevel}",12,TextAnchor.MiddleRight);
                        locked.color=Muted;locked.resizeTextForBestFit=false;
                        Anchor(locked.rectTransform,new Vector2(.7f,0),new Vector2(1,1),new Vector2(0,0),new Vector2(-14,0));
                    }
                }
            }
        }

        void BuildTeam()
        {
            var roster=runtime.State.CurrentFranchise["employees"] as JArray??new JArray();
            var roles=runtime.Spec.Root["catalog"]?["ROLE_INFO"] as JObject;
            if(roster.Count>0)
            {
                SectionHeader("PLANTILLA");
                for(var start=0;start<roster.Count;start+=3)
                {
                    var row=Row(112,3);
                    for(var i=start;i<Mathf.Min(start+3,roster.Count);i++)
                    {
                        if(roster[i] is not JObject employee)continue;
                        var role=employee.Value<string>("role")??"";
                        var info=roles?[role] as JObject;
                        var salary=runtime.Spec.ScaleMoney(info?.Value<long>("salaryMinor")??0,runtime.State.CountryCode);
                        var card=Card(row);
                        var portrait=Panel("Portrait",card,Alpha(Green,.14f));
                        portrait.anchorMin=portrait.anchorMax=new Vector2(0,1);portrait.pivot=new Vector2(0,1);
                        portrait.sizeDelta=new Vector2(34,34);portrait.anchoredPosition=new Vector2(10,-10);
                        var glyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
                        glyph.transform.SetParent(portrait,false);
                        var glyphImage=glyph.GetComponent<Image>();glyphImage.sprite=Icon("avatar");glyphImage.color=Green;
                        glyphImage.preserveAspect=true;glyphImage.raycastTarget=false;
                        Anchor(glyph.GetComponent<RectTransform>(),Vector2.zero,Vector2.one,new Vector2(7,7),new Vector2(-7,-7));
                        var name=Label(card,info?.Value<string>("name")??role,12,TextAnchor.UpperLeft);
                        name.color=Ink;name.fontStyle=FontStyle.Bold;name.resizeTextForBestFit=false;
                        Anchor(name.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(52,-26),new Vector2(-8,-8));
                        var tier=Label(card,$"Nivel {employee.Value<int?>("level")??1}",11,TextAnchor.UpperLeft);
                        tier.color=Muted;tier.resizeTextForBestFit=false;
                        Anchor(tier.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(52,-44),new Vector2(-8,-26));
                        var (track,fill)=Meter(card,Border,Orange,Mathf.Clamp01((employee.Value<float?>("morale")??.8f)));
                        Anchor(track,new Vector2(0,0),new Vector2(1,0),new Vector2(10,34),new Vector2(-10,39));
                        var wage=Label(card,$"{Money(salary)}/día",11,TextAnchor.LowerLeft);
                        wage.color=Sage;wage.resizeTextForBestFit=false;
                        Anchor(wage.rectTransform,new Vector2(0,0),new Vector2(1,0),new Vector2(10,10),new Vector2(-10,30));
                    }
                    for(var i=roster.Count;i<start+3;i++)Panel("Empty",row,new Color(0,0,0,0));
                }
            }
            SectionHeader("CONTRATAR");
            if(roles!=null)foreach(var property in roles.Properties())
            {
                var role=property.Name;var info=(JObject)property.Value;
                var unlockLevel=info.Value<int>("unlockLevel");
                var salary=runtime.Spec.ScaleMoney(info.Value<long>("salaryMinor"),runtime.State.CountryCode);
                var row=Card(drawerContent,null,44);
                var caption=Label(row,info.Value<string>("name"),13,TextAnchor.MiddleLeft);
                caption.color=Ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
                Anchor(caption.rectTransform,new Vector2(0,0),new Vector2(.35f,1),new Vector2(14,0),Vector2.zero);
                var detail=Label(row,info.Value<string>("description"),11,TextAnchor.MiddleLeft);
                detail.color=Muted;detail.resizeTextForBestFit=false;
                Anchor(detail.rectTransform,new Vector2(.35f,0),new Vector2(.72f,1),Vector2.zero,Vector2.zero);
                if(runtime.State.Level>=unlockLevel)
                {
                    var hire=PrimaryButton(row,$"+ Contratar · {Money(salary*2)}",()=>
                    {
                        if(!runtime.Hiring.Hire(role))Notify("Contratación bloqueada o caja insuficiente");
                        else audioService?.UiConfirm();
                        RefreshPanel("hiring");
                    },30);
                    hire.anchorMin=hire.anchorMax=new Vector2(1,.5f);hire.pivot=new Vector2(1,.5f);
                    hire.sizeDelta=new Vector2(176,30);hire.anchoredPosition=new Vector2(-10,0);
                }
                else
                {
                    var locked=Label(row,$"Nivel {unlockLevel}",12,TextAnchor.MiddleRight);
                    locked.color=Muted;locked.resizeTextForBestFit=false;
                    Anchor(locked.rectTransform,new Vector2(.72f,0),new Vector2(1,1),Vector2.zero,new Vector2(-14,0));
                }
            }
        }

        void BuildFranchises()
        {
            if(runtime.State.Root["franchises"] is not JArray franchises)return;
            var owned=0;var building=0;long revenue=0;
            foreach(var token in franchises)
            {
                if(token is not JObject franchise)continue;
                if(franchise.Value<bool>("owned")){owned++;revenue+=franchise.Value<long?>("lifetimeRevenueMinor")??0;}
                else if(franchise.Value<int?>("unlockLevel")<=runtime.State.Level)building++;
            }

            var head=Row(Narrow?398:214,Narrow?1:2,12f);
            var map=Card(head,Linear("DCE4CE"));
            for(var edge=0;edge<franchises.Count;edge++)
            {
                var a=Mathf.PI*2f*edge/Mathf.Max(1,franchises.Count)-Mathf.PI*.5f;
                var b=Mathf.PI*2f*(edge+1)/Mathf.Max(1,franchises.Count)-Mathf.PI*.5f;
                var from=new Vector2(.5f+Mathf.Cos(a)*.31f,.5f+Mathf.Sin(a)*.29f);
                var to=new Vector2(.5f+Mathf.Cos(b)*.31f,.5f+Mathf.Sin(b)*.29f);
                var link=Panel("Link",map,Alpha(Cream,.85f));
                link.anchorMin=link.anchorMax=(from+to)*.5f;link.pivot=new Vector2(.5f,.5f);
                var span=new Vector2((to.x-from.x)*map.rect.width,(to.y-from.y)*map.rect.height);
                link.sizeDelta=new Vector2(span.magnitude,2);
                link.localRotation=Quaternion.Euler(0,0,Mathf.Atan2(span.y,span.x)*Mathf.Rad2Deg);
                link.GetComponent<Image>().sprite=null;
            }
            var index=0;
            foreach(var token in franchises)
            {
                if(token is not JObject franchise)continue;
                // The nodes sit on a ring so the map reads as a network without
                // shipping cartography the catalogue does not carry.
                var angle=Mathf.PI*2f*index/Mathf.Max(1,franchises.Count)-Mathf.PI*.5f;
                var node=Panel("Node",map,franchise.Value<bool>("owned")?Negative:Orange);
                node.anchorMin=node.anchorMax=new Vector2(.5f+Mathf.Cos(angle)*.31f,.5f+Mathf.Sin(angle)*.29f);
                node.pivot=new Vector2(.5f,.5f);node.sizeDelta=new Vector2(15,15);
                index++;
            }
            var stats=Panel("Stats",head,new Color(0,0,0,0));
            var statsLayout=stats.gameObject.AddComponent<VerticalLayoutGroup>();
            statsLayout.spacing=6;statsLayout.childForceExpandHeight=true;statsLayout.childControlHeight=true;statsLayout.childControlWidth=true;
            foreach(var (caption,value,tint) in new (string,string,Color)[]
            {
                ("SUCURSALES",franchises.Count.ToString(),Ink),
                ("EN OPERACIÓN",owned.ToString(),Ink),
                ("EN CONSTRUCCIÓN",building.ToString(),Ink),
                ("INGRESOS TOTALES",Money(revenue),Green)
            })
            {
                var card=StatCard(stats,caption,value,tint);
                var element=card.parent.gameObject.AddComponent<LayoutElement>();
                element.preferredHeight=50;element.minHeight=50;
            }

            SectionHeader("RED DE FRANQUICIAS");
            foreach(var token in franchises)
            {
                if(token is not JObject franchise)continue;
                var id=franchise.Value<string>("id");
                var isOwned=franchise.Value<bool>("owned");
                var here=id==runtime.State.Root.Value<string>("currentFranchiseId");
                var row=Card(drawerContent,null,44);
                var caption=Label(row,$"{franchise.Value<string>("name")}",13,TextAnchor.MiddleLeft);
                caption.color=Ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
                Anchor(caption.rectTransform,new Vector2(0,0),new Vector2(.4f,1),new Vector2(14,0),Vector2.zero);
                var city=Label(row,franchise.Value<string>("city"),11,TextAnchor.MiddleLeft);
                city.color=Muted;city.resizeTextForBestFit=false;
                Anchor(city.rectTransform,new Vector2(.4f,0),new Vector2(.72f,1),Vector2.zero,Vector2.zero);
                if(here)
                {
                    var mark=Label(row,"ESTÁS AQUÍ",11,TextAnchor.MiddleRight);
                    mark.color=Green;mark.fontStyle=FontStyle.Bold;mark.resizeTextForBestFit=false;
                    Anchor(mark.rectTransform,new Vector2(.72f,0),new Vector2(1,1),Vector2.zero,new Vector2(-14,0));
                }
                else
                {
                    var action=isOwned
                        ? PrimaryButton(row,"Viajar",()=>
                          {
                              if(runtime.TravelFranchise(id)){audioService?.UiConfirm();CloseDrawer();}
                              else Notify("No se pudo viajar");
                          },30)
                        : Pill(row,$"Comprar · {Money(franchise.Value<long>("purchaseCostMinor"))}",()=>
                          {
                              if(!runtime.BuyFranchise(id))Notify("Franquicia bloqueada o caja insuficiente");
                              else audioService?.UiConfirm();
                              RefreshPanel("map");
                          },Orange,Cream);
                    action.anchorMin=action.anchorMax=new Vector2(1,.5f);action.pivot=new Vector2(1,.5f);
                    action.sizeDelta=new Vector2(isOwned?96:186,30);action.anchoredPosition=new Vector2(-10,0);
                }
            }
        }

        void BuildFinance()
        {
            var finances=runtime.State.Root["finances"] as JObject??new JObject();
            var franchise=runtime.State.CurrentFranchise;
            var income=franchise.Value<long?>("revenueTodayMinor")??0;
            var spend=franchise.Value<long?>("expensesTodayMinor")??0;

            var head=Row(Narrow?146:70,Narrow?2:4);
            StatCard(head,"Ingresos hoy",Money(income),Ink);
            StatCard(head,"Gastos hoy",Money(spend),Ink);
            StatCard(head,"Beneficio hoy",Money(income-spend),income-spend<0?Negative:Green);
            var taxRate=(runtime.Spec.Root["catalog"]?["COUNTRIES"]?[runtime.State.CountryCode] as JObject)?.Value<double?>("salesTaxRate")??0;
            var tax=StatCard(head,$"Impuestos ({taxRate:P0})",Money(finances.Value<long?>("taxesMinor")??0),Ink);
            var pending=Label(tax,"A pagar",10,TextAnchor.LowerRight);
            pending.color=Muted;pending.resizeTextForBestFit=false;
            Anchor(pending.rectTransform,new Vector2(0,0),new Vector2(1,.4f),new Vector2(0,6),new Vector2(-10,0));

            SectionHeader("LIBRO MAYOR");
            var weights=new[]{1.1f,2.4f,1f,1f,1.1f};
            TableRow(drawerContent,new[]{"Fecha","Concepto","Ingreso","Gasto","Saldo"},weights,true,26);
            var ledger=runtime.State.Root["ledger"] as JArray;
            var shown=0;long balance=runtime.State.BalanceMinor;
            if(ledger!=null)for(var i=ledger.Count-1;i>=0&&shown<12;i--,shown++)
            {
                if(ledger[i] is not JObject entry)continue;
                var amount=entry.Value<long?>("amountMinor")??0;
                TableRow(drawerContent,new[]
                {
                    $"Día {entry.Value<int?>("day")??runtime.State.Day}",
                    entry.Value<string>("label")??entry.Value<string>("kind")??"—",
                    amount>0?Money(amount):"-",
                    amount<0?Money(-amount):"-",
                    Money(balance)
                },weights,false);
                balance-=amount;
            }
            if(shown==0)TableRow(drawerContent,new[]{$"Día {runtime.State.Day}","Sin movimientos","-","-",Money(balance)},weights,false);

            SectionHeader("BALANCE ACUMULADO");
            var totals=new[]
            {
                ("Ingresos brutos",finances.Value<long?>("grossRevenueMinor")??0),
                ("Coste de mercancía",-(finances.Value<long?>("costOfGoodsMinor")??0)),
                ("Nóminas",-(finances.Value<long?>("payrollMinor")??0)),
                ("Operación",-(finances.Value<long?>("operatingCostsMinor")??0)),
                ("Beneficio neto",finances.Value<long?>("netProfitMinor")??0)
            };
            foreach(var (label,value) in totals)
            {
                var row=TableRow(drawerContent,new[]{label,value>=0?Money(value):$"-{Money(-value)}"},new[]{2.6f,1f},false,28);
                if(value<0)row.GetComponentsInChildren<Text>()[1].color=Negative;
            }
            var sync=Row(34,2);
            SecondaryButton(sync,"Sincronizar progreso",async ()=>
            {
                var ok=await runtime.SyncNow();
                Notify(ok?"Progreso sincronizado":"Guardado local; sincronización remota aplazada");
                RefreshPanel("finance");
            });
            Panel("Spacer",sync,new Color(0,0,0,0));
        }

        void BuildUpgrades()
        {
            var project=NextProject();
            if(project!=null)
            {
                SectionHeader($"AMPLIACIÓN AL NIVEL {runtime.State.Level+1}");
                var card=Card(drawerContent,null,64);
                var cost=project.Value<long>("costMinor");var paid=project.Value<long>("contributedMinor");
                var caption=Label(card,$"{Money(paid)} / {Money(cost)}",14,TextAnchor.UpperLeft);
                caption.color=Ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
                Anchor(caption.rectTransform,new Vector2(0,.5f),new Vector2(1,1),new Vector2(14,0),new Vector2(-150,-10));
                var (track,fill)=Meter(card,Border,Green,cost>0?(float)paid/cost:0f);
                Anchor(track,new Vector2(0,0),new Vector2(1,0),new Vector2(14,20),new Vector2(-150,26));
                var contribute=PrimaryButton(card,"Aportar",()=>
                {
                    if(!runtime.Progression.ContributeToNextLevel())Notify("No se pudo financiar o falta el objetivo");
                    else audioService?.UiConfirm();
                    RefreshPanel("upgrade");
                },32);
                contribute.anchorMin=contribute.anchorMax=new Vector2(1,.5f);contribute.pivot=new Vector2(1,.5f);
                contribute.sizeDelta=new Vector2(126,32);contribute.anchoredPosition=new Vector2(-12,0);
            }

            SectionHeader("MEJORAS DE LA TIENDA");
            var kinds=new[]
            {
                ("station","Estación prioritaria","build"),
                ("player-speed","Velocidad del vendedor","avatar"),
                ("player-capacity","Capacidad de carga","inventory"),
                ("employee","Formación del equipo","team")
            };
            for(var start=0;start<kinds.Length;start+=2)
            {
                var row=Row(88,2);
                for(var i=start;i<Mathf.Min(start+2,kinds.Length);i++)
                {
                    var (kind,title,icon)=kinds[i];
                    var quote=runtime.Upgrades.Quote(kind);
                    var card=Card(row);
                    var swatch=Panel("Swatch",card,Alpha(Green,.12f));
                    swatch.anchorMin=swatch.anchorMax=new Vector2(0,1);swatch.pivot=new Vector2(0,1);
                    swatch.sizeDelta=new Vector2(46,46);swatch.anchoredPosition=new Vector2(10,-10);
                    var glyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
                    glyph.transform.SetParent(swatch,false);
                    var glyphImage=glyph.GetComponent<Image>();glyphImage.sprite=Icon(icon);glyphImage.color=Green;
                    glyphImage.preserveAspect=true;glyphImage.raycastTarget=false;
                    Anchor(glyph.GetComponent<RectTransform>(),Vector2.zero,Vector2.one,new Vector2(11,11),new Vector2(-11,-11));
                    var caption=Label(card,title,12,TextAnchor.UpperLeft);
                    caption.color=Ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
                    Anchor(caption.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(64,-30),new Vector2(-10,-10));
                    var price=Label(card,quote==null?"Al máximo":$"Nivel {quote.NextTier} · {Money(quote.RemainingMinor)}",11,TextAnchor.UpperLeft);
                    price.color=Sage;price.resizeTextForBestFit=false;
                    Anchor(price.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(64,-50),new Vector2(-10,-30));
                    if(quote!=null)
                    {
                        var capturedKind=kind;
                        var contribute=PrimaryButton(card,"Aportar",()=>
                        {
                            var current=runtime.Upgrades.Quote(capturedKind);
                            if(current==null||!runtime.Upgrades.Contribute(capturedKind,current.RemainingMinor))Notify("Caja insuficiente o mejora no disponible");
                            else audioService?.UiConfirm();
                            RefreshPanel("upgrade");
                        },28);
                        contribute.anchorMin=contribute.anchorMax=new Vector2(1,0);contribute.pivot=new Vector2(1,0);
                        contribute.sizeDelta=new Vector2(104,28);contribute.anchoredPosition=new Vector2(-10,10);
                    }
                }
            }

            SectionHeader("EQUIPAMIENTO");
            var fixtures=new[]{("shelves","Estante adicional","inventory"),("checkout","Caja rápida","store"),("expansion","Depósito mediano","build")};
            for(var start=0;start<fixtures.Length;start+=2)
            {
                var row=Row(88,2);
                for(var i=start;i<Mathf.Min(start+2,fixtures.Length);i++)
                {
                    var (id,title,icon)=fixtures[i];
                    var card=Card(row);
                    var swatch=Panel("Swatch",card,Alpha(Orange,.16f));
                    swatch.anchorMin=swatch.anchorMax=new Vector2(0,1);swatch.pivot=new Vector2(0,1);
                    swatch.sizeDelta=new Vector2(46,46);swatch.anchoredPosition=new Vector2(10,-10);
                    var glyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
                    glyph.transform.SetParent(swatch,false);
                    var glyphImage=glyph.GetComponent<Image>();glyphImage.sprite=Icon(icon);glyphImage.color=Orange;
                    glyphImage.preserveAspect=true;glyphImage.raycastTarget=false;
                    Anchor(glyph.GetComponent<RectTransform>(),Vector2.zero,Vector2.one,new Vector2(11,11),new Vector2(-11,-11));
                    var caption=Label(card,title,12,TextAnchor.UpperLeft);
                    caption.color=Ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
                    Anchor(caption.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(64,-32),new Vector2(-10,-10));
                    var capturedId=id;
                    var buy=PrimaryButton(card,"Aportar",()=>{Upgrade(capturedId);},28);
                    buy.anchorMin=buy.anchorMax=new Vector2(1,0);buy.pivot=new Vector2(1,0);
                    buy.sizeDelta=new Vector2(104,28);buy.anchoredPosition=new Vector2(-10,10);
                }
                for(var i=fixtures.Length;i<start+2;i++)Panel("Empty",row,new Color(0,0,0,0));
            }

            SectionHeader("LICENCIA");
            var licenseDays=runtime.State.CurrentFranchise.Value<int?>("licenseDaysLeft")??0;
            var licenseRow=Card(drawerContent,null,44);
            var licenseText=Label(licenseRow,$"Quedan {licenseDays} días",13,TextAnchor.MiddleLeft);
            licenseText.color=licenseDays<=3?Negative:Ink;licenseText.resizeTextForBestFit=false;
            Anchor(licenseText.rectTransform,new Vector2(0,0),new Vector2(.6f,1),new Vector2(14,0),Vector2.zero);
            var renew=PrimaryButton(licenseRow,$"Renovar 14 días · {Money(runtime.Licenses.RenewalCost)}",()=>
            {
                if(!runtime.Licenses.Renew())Notify("Caja insuficiente para renovar la licencia");
                else audioService?.UiConfirm();
                RefreshPanel("upgrade");
            },30);
            renew.anchorMin=renew.anchorMax=new Vector2(1,.5f);renew.pivot=new Vector2(1,.5f);
            renew.sizeDelta=new Vector2(226,30);renew.anchoredPosition=new Vector2(-10,0);
        }

        void BuildCloset()
        {
            AvatarPreview();
            var avatarHead=Row(38);
            var avatarTabs=Panel("Tabs",avatarHead,new Color(0,0,0,0));
            Anchor(avatarTabs,new Vector2(0,0),new Vector2(Narrow?1f:.42f,1),Vector2.zero,Vector2.zero);
            Tabs(new[]{"Cuerpo","Sombreros","Peinados"},avatarTab,index=>{avatarTab=index;RefreshPanel("closet");},38,avatarTabs);
            if(avatarTab==0)
            {
                var bodies=new[]{("adult-man","Hombre adulto"),("adult-woman","Mujer adulta"),("boy","Niño"),("girl","Niña")};
                var row=Row(84,4);
                foreach(var (id,label) in bodies)SwatchTile(row,label,Linear("E2D6C6"),()=>_ = runtime.ChangePlayerBody(id));
            }
            else if(avatarTab==1)
            {
                var hats=new[]{("none","Sin gorro"),("red-panda","Panda rojo"),("red-fox","Zorro"),("chicken","Gallina"),("owl","Búho"),("elephant","Elefante"),("rhino","Rinoceronte"),("giraffe","Jirafa"),("panda","Panda"),("frog","Rana"),("cow","Vaca"),("rabbit","Conejo"),("capybara","Capibara")};
                var assets=new[]{"none","Hat_01_RedPanda","Hat_02_Fox","Hat_03_Chicken","Hat_04_Owl","Hat_05_Elephant","Hat_06_Rhino","Hat_07_Giraffe","Hat_08_Panda","Hat_09_Frog","Hat_10_Cow","Hat_11_Rabbit","Hat_12_Capybara"};
                var columns=Narrow?3:5;
                for(var start=0;start<hats.Length;start+=columns)
                {
                    var row=Row(78,columns);
                    for(var i=start;i<Mathf.Min(start+columns,hats.Length);i++)
                    {
                        var asset=assets[i];var id=hats[i].Item1;
                        SwatchTile(row,hats[i].Item2,Linear("DFD3C3"),()=>_ = runtime.SelectAccessory("Hats",asset,id));
                    }
                    for(var i=hats.Length;i<start+columns;i++)Panel("Empty",row,new Color(0,0,0,0));
                }
            }
            else
            {
                var hairIds=new[]{"side-part","fade","waves","swept","bob","ponytail","long-wavy","bun","messy","curls","short-fringe","quiff","blunt-bob","pigtails","braid","high-ponytail"};
                var hairAssets=new[]{"Hair_01_SidePart","Hair_02_Fade","Hair_03_Wavy","Hair_04_SlickBack","Hair_05_Bob","Hair_06_Ponytail","Hair_07_LongWavy","Hair_08_Bun","Hair_09_MessyMale","Hair_10_CurlyMale","Hair_11_SideSweepMale","Hair_12_SpikyMale","Hair_13_BobBangs","Hair_14_Pigtails","Hair_15_SideBraid","Hair_16_HighPonytail"};
                var columns=Narrow?3:5;
                for(var start=0;start<hairAssets.Length;start+=columns)
                {
                    var row=Row(78,columns);
                    for(var i=start;i<Mathf.Min(start+columns,hairAssets.Length);i++)
                    {
                        var asset=hairAssets[i];var id=hairIds[i];
                        SwatchTile(row,id.Replace('-',' '),Linear("D2C4B4"),()=>_ = runtime.SelectAccessory("Hair",asset,id));
                    }
                    for(var i=hairAssets.Length;i<start+columns;i++)Panel("Empty",row,new Color(0,0,0,0));
                }
            }
        }

        /// The sheet shows the character beside the picker. A small camera framed
        /// on the live actor renders into the panel, so a change of body, hat or
        /// hair is visible in the same view that changed it.
        void AvatarPreview()
        {
            var stage=Card(drawerContent,Linear("EFE8DE"),190);
            var view=new GameObject("Preview",typeof(RectTransform),typeof(RawImage)).GetComponent<RectTransform>();
            view.SetParent(stage,false);
            // The target texture is 2:3; a fractional width stretched the character into
            // a column, so the slot is pinned to that ratio.
            view.anchorMin=new Vector2(0,0);view.anchorMax=new Vector2(0,1);view.pivot=new Vector2(0,.5f);
            view.offsetMin=new Vector2(8,8);view.offsetMax=new Vector2(8+(190-16)*2f/3f,-8);
            var raw=view.GetComponent<RawImage>();raw.raycastTarget=false;
            var caption=Label(stage,"Personaje inicial",12,TextAnchor.UpperLeft);
            caption.color=Muted;caption.resizeTextForBestFit=false;
            Anchor(caption.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(140,-30),new Vector2(-14,-12));
            var hint=Label(stage,"El cuerpo, el gorro y el peinado que elijas se ven aquí al instante.",11,TextAnchor.UpperLeft);
            hint.color=Sage;hint.resizeTextForBestFit=false;
            Anchor(hint.rectTransform,new Vector2(0,0),new Vector2(1,1),new Vector2(140,12),new Vector2(-14,-34));

            var actor=runtime?.PlayerActor;
            if(!actor){raw.color=new Color(1,1,1,0);return;}
            if(!avatarTexture)avatarTexture=new RenderTexture(360,540,16,RenderTextureFormat.ARGB32,RenderTextureReadWrite.sRGB){name="AvatarPreview"};
            raw.texture=avatarTexture;
            if(!avatarCamera)
            {
                avatarCamera=new GameObject("AvatarCamera",typeof(Camera)).GetComponent<Camera>();
                avatarCamera.transform.SetParent(transform,false);
                avatarCamera.clearFlags=CameraClearFlags.SolidColor;
                avatarCamera.backgroundColor=Linear("EFE8DE");
                avatarCamera.targetTexture=avatarTexture;
                avatarCamera.fieldOfView=32f;
                avatarCamera.nearClipPlane=.05f;avatarCamera.farClipPlane=40f;
                // Only the player's own layer. Framed inside the store, any camera
                // angle has a wall or a shelf between it and the character.
                avatarCamera.cullingMask=1<<AvatarLayer;
            }
            // Framed from the actor's own renderer bounds. A fixed offset put the
            // camera inside the shelving and the panel rendered a flat clear colour.
            foreach(var piece in actor.GetComponentsInChildren<Transform>(true))piece.gameObject.layer=AvatarLayer;
            var renderers=actor.GetComponentsInChildren<Renderer>();
            if(renderers.Length==0){raw.color=new Color(1,1,1,0);return;}
            var bounds=renderers[0].bounds;
            for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var reach=Mathf.Max(bounds.extents.y,bounds.extents.x*1.6f);
            var distance=reach/Mathf.Tan(avatarCamera.fieldOfView*.5f*Mathf.Deg2Rad)+reach*.55f;
            // Viewed from where the sun comes from, so the lit side faces the panel;
            // framed head on, the character rendered as a silhouette.
            var sun=RenderSettings.sun;
            var facing=sun?-sun.transform.forward:actor.transform.forward;
            facing.y=0f;
            if(facing.sqrMagnitude<1e-4f)facing=actor.transform.forward;
            facing.Normalize();
            avatarCamera.transform.position=bounds.center+facing*distance+Vector3.up*reach*.12f;
            avatarCamera.transform.LookAt(bounds.center);
            avatarCamera.enabled=true;
        }

        /// Square swatch with a caption under it, the avatar panel's picker cell.
        void SwatchTile(Transform parent,string label,Color tint,UnityEngine.Events.UnityAction action)
        {
            var card=Card(parent);
            var swatch=Panel("Swatch",card,tint);
            Anchor(swatch,new Vector2(0,0),new Vector2(1,1),new Vector2(8,22),new Vector2(-8,-8));
            var caption=Label(card,label,10,TextAnchor.LowerCenter);
            caption.color=Sage;caption.resizeTextForBestFit=false;
            Anchor(caption.rectTransform,new Vector2(0,0),new Vector2(1,0),new Vector2(4,4),new Vector2(-4,20));
            var button=card.gameObject.AddComponent<Button>();
            button.targetGraphic=card.GetComponent<Image>();
            button.onClick.AddListener(()=>{action();audioService?.UiConfirm();});
        }

        void BuildHelp()
        {
            var topics=new[]
            {
                ("store","Primeros pasos","WASD, flechas o arrastra en cualquier zona libre para moverte."),
                ("build","Gestión de la tienda","Abre la tienda; sólo compran productos desbloqueados y disponibles."),
                ("inventory","Productos y estantes","Recoge mercancía en el almacén y llévala al expositor compatible."),
                ("team","Empleados","Contrata para que cultiven, produzcan, repongan y cobren por ti."),
                ("suppliers","Proveedores y pedidos","Pide diez unidades; llegan al almacén tras el plazo de entrega."),
                ("build","Construcciones","Financia la ampliación del nivel y las mejoras de la tienda."),
                ("finance","Finanzas","El libro mayor recoge ventas, compras, nóminas e impuestos."),
                ("map","Franquicias","Compra sucursales y viaja entre ellas cuando estén operativas.")
            };
            var columns=Narrow?2:3;
            for(var start=0;start<topics.Length;start+=columns)
            {
                var row=Row(Narrow?108:96,columns);
                for(var i=start;i<Mathf.Min(start+columns,topics.Length);i++)
                {
                    var (icon,title,detail)=topics[i];
                    var card=Card(row);
                    var glyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
                    glyph.transform.SetParent(card,false);
                    var glyphImage=glyph.GetComponent<Image>();glyphImage.sprite=Icon(icon);glyphImage.color=Green;
                    glyphImage.preserveAspect=true;glyphImage.raycastTarget=false;
                    var rect=glyph.GetComponent<RectTransform>();
                    rect.anchorMin=rect.anchorMax=new Vector2(.5f,1);rect.pivot=new Vector2(.5f,1);
                    rect.sizeDelta=new Vector2(24,24);rect.anchoredPosition=new Vector2(0,-12);
                    var caption=Label(card,title,12,TextAnchor.UpperCenter);
                    caption.color=Ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
                    Anchor(caption.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(8,-58),new Vector2(-8,-40));
                    var detailText=Label(card,detail,10,TextAnchor.UpperCenter);
                    detailText.color=Muted;detailText.resizeTextForBestFit=false;
                    Anchor(detailText.rectTransform,new Vector2(0,0),new Vector2(1,1),new Vector2(8,8),new Vector2(-8,-58));
                }
                for(var i=topics.Length;i<start+columns;i++)Panel("Empty",row,new Color(0,0,0,0));
            }
        }

        void BuildMissions()
        {
            var missions=runtime.State.Array("missions");
            var days=Row(38,5,6f);
            for(var offset=0;offset<5;offset++)
            {
                var day=runtime.State.Day+offset;
                var current=offset==0;
                var chip=Card(days,current?Green:Cream);
                var caption=Label(chip,$"Día {day}",12,TextAnchor.MiddleCenter);
                caption.color=current?Cream:offset==1?Ink:Muted;caption.resizeTextForBestFit=false;
                if(current)caption.fontStyle=FontStyle.Bold;
                Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(4,2),new Vector2(-4,-2));
                if(offset>1)
                {
                    // Days past tomorrow are not seeded yet; the sheet locks them.
                    var lockGlyph=new GameObject("Lock",typeof(RectTransform),typeof(Image));
                    lockGlyph.transform.SetParent(chip,false);
                    var lockImage=lockGlyph.GetComponent<Image>();lockImage.sprite=Icon("warning");
                    lockImage.color=Alpha(Muted,.7f);lockImage.preserveAspect=true;lockImage.raycastTarget=false;
                    var lockRect=lockGlyph.GetComponent<RectTransform>();
                    lockRect.anchorMin=lockRect.anchorMax=new Vector2(1,.5f);lockRect.pivot=new Vector2(1,.5f);
                    lockRect.sizeDelta=new Vector2(13,13);lockRect.anchoredPosition=new Vector2(-9,0);
                }
            }
            SectionHeader($"DÍA {runtime.State.Day} · OBJETIVOS DEL DÍA");
            if(missions.Count==0)
            {
                var empty=Card(drawerContent,null,44);
                var caption=Label(empty,"Los objetivos del día aparecen al abrir la tienda.",12,TextAnchor.MiddleLeft);
                caption.color=Muted;caption.resizeTextForBestFit=false;
                Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(16,0),new Vector2(-16,0));
            }
            long reward=0;var claimableId=(string)null;
            foreach(var token in missions)
            {
                if(token is not JObject mission)continue;
                var id=mission.Value<string>("id");
                var progress=mission.Value<int?>("progress")??0;
                var target=Math.Max(1,mission.Value<int?>("target")??1);
                var completed=mission.Value<bool>("completed");
                var claimed=mission.Value<bool>("claimed");
                if(completed&&!claimed){reward+=mission.Value<long?>("rewardMinor")??0;claimableId??=id;}
                var card=Card(drawerContent,null,52);
                var caption=Label(card,mission.Value<string>("label"),13,TextAnchor.UpperLeft);
                caption.color=Ink;caption.resizeTextForBestFit=false;
                Anchor(caption.rectTransform,new Vector2(0,.5f),new Vector2(1,1),new Vector2(14,0),new Vector2(-110,-8));
                var (track,fill)=Meter(card,Border,completed?Green:Orange,Mathf.Clamp01((float)progress/target));
                Anchor(track,new Vector2(0,0),new Vector2(1,0),new Vector2(14,16),new Vector2(-110,22));
                var counter=Label(card,$"{Math.Min(progress,target)}/{target}",12,TextAnchor.MiddleRight);
                counter.color=Muted;counter.resizeTextForBestFit=false;
                Anchor(counter.rectTransform,new Vector2(1,0),new Vector2(1,1),new Vector2(-96,0),new Vector2(-42,0));
                var mark=new GameObject("Mark",typeof(RectTransform),typeof(Image));
                mark.transform.SetParent(card,false);
                var markImage=mark.GetComponent<Image>();markImage.sprite=Icon("check");
                markImage.color=claimed?Green:completed?Orange:Border;
                markImage.preserveAspect=true;markImage.raycastTarget=false;
                var markRect=mark.GetComponent<RectTransform>();
                markRect.anchorMin=markRect.anchorMax=new Vector2(1,.5f);markRect.pivot=new Vector2(1,.5f);
                markRect.sizeDelta=new Vector2(19,19);markRect.anchoredPosition=new Vector2(-14,0);
            }

            SectionHeader("RECOMPENSA");
            var rewardCard=Card(drawerContent,null,56);
            var rewardText=Label(rewardCard,reward>0?$"+ {Money(reward)}   ·   + {missions.Count*10} XP":"Completa los objetivos para cobrar",14,TextAnchor.MiddleLeft);
            rewardText.color=reward>0?Ink:Muted;rewardText.fontStyle=FontStyle.Bold;rewardText.resizeTextForBestFit=false;
            Anchor(rewardText.rectTransform,new Vector2(0,0),new Vector2(.6f,1),new Vector2(16,0),Vector2.zero);
            if(claimableId!=null)
            {
                var claim=PrimaryButton(rewardCard,"COBRAR RECOMPENSA",()=>
                {
                    foreach(var token in runtime.State.Array("missions"))
                        if(token is JObject mission&&mission.Value<bool>("completed")&&!mission.Value<bool>("claimed"))
                            runtime.Progression.ClaimMission(mission.Value<string>("id"));
                    audioService?.UiConfirm();RefreshPanel("missions");
                },34);
                claim.anchorMin=claim.anchorMax=new Vector2(1,.5f);claim.pivot=new Vector2(1,.5f);
                claim.sizeDelta=new Vector2(216,34);claim.anchoredPosition=new Vector2(-12,0);
            }

            var project=NextProject();
            SectionHeader(runtime.State.Level>=30?"PROGRESIÓN COMPLETADA":$"PARA SUBIR AL NIVEL {runtime.State.Level+1}");
            if(project!=null)
            {
                var card=Card(drawerContent,null,58);
                var cost=project.Value<long>("costMinor");var paid=project.Value<long>("contributedMinor");
                var caption=Label(card,$"Financiación {Money(paid)} / {Money(cost)}",13,TextAnchor.UpperLeft);
                caption.color=Ink;caption.resizeTextForBestFit=false;
                Anchor(caption.rectTransform,new Vector2(0,.5f),new Vector2(1,1),new Vector2(14,0),new Vector2(-140,-8));
                var (track,fill)=Meter(card,Border,Green,cost>0?(float)paid/cost:0f);
                Anchor(track,new Vector2(0,0),new Vector2(1,0),new Vector2(14,16),new Vector2(-140,22));
                if(!project.Value<bool>("completed"))
                {
                    var contribute=PrimaryButton(card,"Aportar",()=>
                    {
                        runtime.Progression.ContributeToNextLevel();audioService?.UiConfirm();RefreshPanel("missions");
                    },32);
                    contribute.anchorMin=contribute.anchorMax=new Vector2(1,.5f);contribute.pivot=new Vector2(1,.5f);
                    contribute.sizeDelta=new Vector2(118,32);contribute.anchoredPosition=new Vector2(-12,0);
                }
            }
        }

        public void BindPlayer(PlayerController playerController){if(joystick)joystick.Bind(joystick.GetComponent<RectTransform>(),playerController,canvas);}
        void Upgrade(string id){if(!runtime.Upgrades.Upgrade(id))Notify("Caja insuficiente");else audioService.UiConfirm();RefreshPanel("upgrade");}
        JObject NextProject(){foreach(var token in runtime.State.Array("buildProjects"))if(token.Value<int>("level")==runtime.State.Level+1)return token as JObject;return null;}
        void RefreshPanel(string id){if(drawer.gameObject.activeSelf)OpenPanel(id);}

        void Refresh()
        {
            if(runtime==null||runtime.State==null||runtime.State.Root==null||!runtime.State.Root.HasValues)return;
            var franchise=runtime.State.CurrentFranchise;var open=franchise.Value<bool?>("open")??false;var status=runtime.Saves?.Status?.ToLowerInvariant()??"local";
            var franchiseName=franchise.Value<string>("name")??"Mini Market";var franchiseCity=franchise.Value<string>("city")??"Distrito inicial";
// The shrunken narrow cell fits one line; the city pushes the name onto three.
            if(brandLabel)brandLabel.text=Narrow?franchiseName:$"{franchiseName}\n{franchiseCity}";
            money.text=$"CAJA GLOBAL\n{Money(runtime.State.BalanceMinor)}";
            clock.text=$"VENTAS HOY\n{Money(franchise.Value<long?>("revenueTodayMinor")??0)} · Día {runtime.State.Day} {runtime.State.MinuteOfDay/60:00}:{runtime.State.MinuteOfDay%60:00}";
            level.text=Narrow?$"NIVEL {runtime.State.Level}":$"NIVEL {runtime.State.Level}\nPROGRESO";
            var project=NextProject();var cost=project?.Value<long>("costMinor")??0;
            SetMeter(levelFill,cost>0?Mathf.Clamp01((float)project.Value<long>("contributedMinor")/cost):0f);
            if(levelBadgeText)levelBadgeText.text=runtime.State.Level.ToString();
            carry.text=$"{runtime.Carry.Total}/{runtime.Carry.Capacity}";carryChip.gameObject.SetActive(runtime.Carry.Total>0);
            RefreshCarrySlots();
            save.text=status switch{"saving"=>"GUARDANDO…","offline"=>"COPIA LOCAL","dirty"=>"CAMBIOS PENDIENTES","conflict"=>"CONFLICTO","error"=>"ERROR AL GUARDAR",_=>"GUARDADO"};
            saveIconImage.sprite=Icon(status switch{"saving"=>"cloud","offline"=>"cloud","conflict"=>"warning","error"=>"warning",_=>"check"});
            saveIconImage.color=status is "conflict" or "error"?Negative:Green;
            saveStamp.text=System.DateTime.Now.ToString("HH:mm:ss");
            saveChip.gameObject.SetActive(status is "offline" or "conflict" or "error");
            player.text=$"PROPIETARIO\n    Reputación {runtime.State.Root.Value<int?>("reputation")??0}";
            // The sheet draws this as a solid green pill when open and a muted one when
            // closed; the pale pink came from the web build's palette.
            storeStatusText.text=open?"ABIERTO":"CERRADO";
            storeStatusImage.color=open?Linear("E8E6D5"):Alpha(Linear("EDEAE2"),.98f);
            storeStatusText.color=open?Green:Muted;storeStatusText.fontStyle=FontStyle.Bold;
            statusChevronImage.color=open?Green:Muted;
            var completed=0;var claimable=0;var total=runtime.State.Array("missions").Count;foreach(var token in runtime.State.Array("missions")){if(token.Value<bool>("completed"))completed++;if(token.Value<bool>("completed")&&!token.Value<bool>("claimed"))claimable++;}
            missionSummary.text=$"PROGRESO AL NIVEL {Math.Min(30,runtime.State.Level+1)}\nObjetivos del día {completed}/{total}{(claimable>0?$" · {claimable} por cobrar":"")}";
            missionIconImage.color=claimable>0?Orange:Green;
            RefreshTutorial(franchise,open);
        }

        /// The sheet shows what is being carried as a row of tiles rather than a
        /// sentence. Products have no artwork in the catalogue, so a tile is tinted
        /// by its supplier and carries the product's initials and quantity.
        void RefreshCarrySlots()
        {
            if(!carrySlots)return;
            var index=0;
            foreach(var item in runtime.Carry.Contents())
            {
                RectTransform tile;
                if(index<carryThumbs.Count)tile=carryThumbs[index];
                else
                {
                    tile=Panel($"Slot{index}",carrySlots,Cream);
                    var element=tile.gameObject.AddComponent<LayoutElement>();element.preferredWidth=42;element.minWidth=42;
                    var initials=Label(tile,"",13,TextAnchor.UpperCenter);initials.resizeTextForBestFit=false;initials.fontStyle=FontStyle.Bold;initials.name="Initials";
                    Anchor(initials.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(0,-22),new Vector2(0,-4));
                    var count=Label(tile,"",12,TextAnchor.LowerCenter);count.resizeTextForBestFit=false;count.name="Count";
                    Anchor(count.rectTransform,new Vector2(0,0),new Vector2(1,0),new Vector2(0,3),new Vector2(0,20));
                    carryThumbs.Add(tile);
                }
                var product=runtime.Spec.Products[item.Key] as JObject;
                var label=product?.Value<string>("name")??item.Key;
                var supplier=product?.Value<string>("supplier")??"";
                tile.GetComponent<Image>().color=supplier switch
                {
                    "campo"=>Linear("CFE0C0"),"fresco"=>Linear("F3D9C4"),
                    "panal"=>Linear("EBDCA8"),"andes"=>Linear("D9C7B4"),_=>Linear("E4E0D4")
                };
                var initialsText=tile.Find("Initials").GetComponent<Text>();
                initialsText.text=label.Length>=2?label.Substring(0,2).ToUpperInvariant():label.ToUpperInvariant();
                initialsText.color=Ink;
                var countText=tile.Find("Count").GetComponent<Text>();
                countText.text=$"×{item.Value}";countText.color=Sage;
                tile.gameObject.SetActive(true);
                index++;
            }
            for(var i=index;i<carryThumbs.Count;i++)carryThumbs[i].gameObject.SetActive(false);
        }

        void RefreshTutorial(JObject franchise,bool open)
        {
            var tutorial=runtime.State.Root.Value<int?>("tutorialStep")??0;var visible=runtime.State.Level==1&&tutorial>0;tutorialCard.gameObject.SetActive(visible);if(!visible)return;
            var counters=runtime.State.Root["progression"]?["counters"] as JObject;long Counter(string id)=>counters?.Value<long?>(id)??0;
            var harvested=Counter("harvest:tomatoes");var stocked=Counter("stock:tomatoes");var sales=Counter("customers");var carried=runtime.Carry.Quantity("tomatoes");
            var step=1;var title="Cultiva los primeros tomates";
            if(carried>0||(harvested>=3&&stocked<3)){step=2;title="Surte frutas y verduras";}
            else if(harvested>=3&&!open){step=3;title="Abre el supermercado";}
            else if(open&&sales<1){var waiting=runtime.Customers?.ActiveCount>0;step=waiting?5:4;title=waiting?"Atiende la caja":"Recibe al primer comprador";}
            else if(sales>=1){step=5;title="Tu primera venta está lista";}
            tutorialSummary.text=$"PASO {step} DE 5\n{title}";
            for(var i=0;i<tutorialSteps.Count;i++)tutorialSteps[i].color=i<step?Green:Border;
        }
        string Money(long minor)
        {
            if(runtime==null)return minor.ToString();var code=runtime.State.Root.Value<string>("currency")??"EUR";var symbol=code switch{"EUR"=>"€","USD"=>"$","COP"=>"$","MXN"=>"$","ARS"=>"$",_=>code};
            return $"{(minor/100d).ToString("N2",CultureInfo.GetCultureInfo("es-ES"))} {symbol}";
        }
        void NearestChanged(MiniMarket.Interactions.InteractionPoint point){promptPanel.gameObject.SetActive(point);prompt.text=point?point.label:"";}
        void Notify(string message){if(toastRoutine!=null)StopCoroutine(toastRoutine);toastRoutine=StartCoroutine(Toast(message));}
        /// The sheet gives a toast a colour rail and an icon by kind. The runtime
        /// signal carries only a message, so the kind is read off the wording the
        /// callers above already use for refusals.
        static bool IsRefusal(string message)
        {
            if(string.IsNullOrEmpty(message))return false;
            var text=message.ToLowerInvariant();
            return text.Contains("no se pudo")||text.Contains("insuficiente")||text.Contains("bloquead")
                 ||text.Contains("no disponible")||text.Contains("error")||text.Contains("aplazad");
        }

        void HideToast()
        {
            if(toastRoutine!=null){StopCoroutine(toastRoutine);toastRoutine=null;}
            var group=toastPanel.GetComponent<CanvasGroup>();group.alpha=0;group.blocksRaycasts=false;
        }

        IEnumerator Toast(string message)
        {
            var refusal=IsRefusal(message);
            var accent=refusal?Negative:Green;
            toastRail.GetComponent<Image>().color=accent;
            toastIconImage.sprite=Icon(refusal?"warning":"check");toastIconImage.color=accent;
            toast.text=message;
            var group=toastPanel.GetComponent<CanvasGroup>();group.alpha=1;group.blocksRaycasts=true;
            yield return new WaitForSecondsRealtime(2.8f);
            for(var t=0f;t<.35f;t+=Time.unscaledDeltaTime){group.alpha=1-t/.35f;yield return null;}
            group.alpha=0;group.blocksRaycasts=false;toastRoutine=null;
        }

        readonly System.Collections.Generic.Dictionary<string,Sprite> iconCache=new();
        Sprite Icon(string name)
        {
            if(iconCache.TryGetValue(name,out var cached))return cached;
            var texture=Resources.Load<Texture2D>($"Icons/{name}");
            // Built from the same SVG paths Next draws, by tools/ui/render_game_icons.py.
            // Sprite.Create at runtime avoids depending on the PNG being imported
            // with sprite settings, which cannot be authored without the editor.
            var sprite=texture?Sprite.Create(texture,new Rect(0,0,texture.width,texture.height),new Vector2(.5f,.5f),100f,0,SpriteMeshType.FullRect):null;
            iconCache[name]=sprite;
            return sprite;
        }

        Sprite CreateRoundedSprite()
        {
            const int size=64;const float radius=15f;var texture=new Texture2D(size,size,TextureFormat.RGBA32,false,true){name="RuntimeHud_RoundedRect",filterMode=FilterMode.Bilinear,wrapMode=TextureWrapMode.Clamp};var pixels=new Color32[size*size];
            for(var y=0;y<size;y++)for(var x=0;x<size;x++)
            {
                var qx=Mathf.Abs(x-(size-1)*.5f)-((size-1)*.5f-radius);var qy=Mathf.Abs(y-(size-1)*.5f)-((size-1)*.5f-radius);var outside=Mathf.Sqrt(Mathf.Max(qx,0)*Mathf.Max(qx,0)+Mathf.Max(qy,0)*Mathf.Max(qy,0))+Mathf.Min(Mathf.Max(qx,qy),0)-radius;var alpha=(byte)Mathf.RoundToInt(255*Mathf.Clamp01(.5f-outside));pixels[y*size+x]=new Color32(255,255,255,alpha);
            }
            texture.SetPixels32(pixels);texture.Apply(false,true);return Sprite.Create(texture,new Rect(0,0,size,size),new Vector2(.5f,.5f),100,0,SpriteMeshType.FullRect,new Vector4(16,16,16,16));
        }
        RectTransform Panel(string name,Transform parent,Color color){var go=new GameObject(name,typeof(RectTransform),typeof(Image));go.transform.SetParent(parent,false);var image=go.GetComponent<Image>();image.color=color;if(roundedSprite){image.sprite=roundedSprite;image.type=Image.Type.Sliced;}return go.GetComponent<RectTransform>();}
        Text Label(Transform parent,string value,int size,TextAnchor anchor){var go=new GameObject("Text",typeof(RectTransform),typeof(Text));go.transform.SetParent(parent,false);var text=go.GetComponent<Text>();text.font=font;text.text=value;text.fontSize=size;text.color=Ink;text.alignment=anchor;text.resizeTextForBestFit=true;text.resizeTextMinSize=9;text.resizeTextMaxSize=size;return text;}
        RectTransform Button(Transform parent,string label,UnityEngine.Events.UnityAction action,Color color){var go=new GameObject(label,typeof(RectTransform),typeof(Image),typeof(Button),typeof(LayoutElement));go.transform.SetParent(parent,false);go.GetComponent<Image>().color=color;var button=go.GetComponent<Button>();button.onClick.AddListener(action);var element=go.GetComponent<LayoutElement>();element.preferredHeight=58;element.minHeight=46;var text=Label(go.transform,label,19,TextAnchor.MiddleCenter);text.color=color.grayscale<.42f?Cream:Ink;Anchor(text.rectTransform,Vector2.zero,Vector2.one,new Vector2(8,4),new Vector2(-8,-4));return go.GetComponent<RectTransform>();}
        void QuickButton(Transform parent,string icon,UnityEngine.Events.UnityAction action,string tooltip)
        {
            // The sheet lays each entry out as a row: a 20px stroke icon on the
            // left, the name beside it, left aligned. Stacking the label under a
            // centred icon reads as a toolbar, not as this menu.
            var go=new GameObject(tooltip,typeof(RectTransform),typeof(Image),typeof(Button),typeof(LayoutElement));
            go.transform.SetParent(parent,false);
            var background=go.GetComponent<Image>();background.color=new Color(0,0,0,0);
            if(roundedSprite){background.sprite=roundedSprite;background.type=Image.Type.Sliced;}
            var shadow=go.AddComponent<Shadow>();shadow.effectColor=Alpha(Ink,.10f);shadow.effectDistance=new Vector2(0,-2);shadow.useGraphicAlpha=true;shadow.enabled=false;
            var outline=go.AddComponent<Outline>();outline.effectColor=Border;outline.effectDistance=new Vector2(1,-1);outline.useGraphicAlpha=true;outline.enabled=false;
            go.GetComponent<Button>().onClick.AddListener(action);
            var element=go.GetComponent<LayoutElement>();element.preferredHeight=38;element.minHeight=32;
            var glyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
            glyph.transform.SetParent(go.transform,false);
            var image=glyph.GetComponent<Image>();image.sprite=Icon(icon);image.color=Ink;
            image.preserveAspect=true;image.raycastTarget=false;
            var rect=glyph.GetComponent<RectTransform>();
            rect.anchorMin=rect.anchorMax=new Vector2(0,.5f);rect.pivot=new Vector2(0,.5f);
            rect.sizeDelta=new Vector2(19,19);rect.anchoredPosition=new Vector2(11,0);
            var caption=Label(go.transform,tooltip.ToUpperInvariant(),11,TextAnchor.MiddleLeft);
            caption.color=Ink;caption.fontStyle=FontStyle.Bold;
            caption.resizeTextForBestFit=false;caption.horizontalOverflow=HorizontalWrapMode.Overflow;
            Anchor(caption.rectTransform,new Vector2(0,0),new Vector2(1,1),new Vector2(38,0),new Vector2(-6,0));
            var entry=go.AddComponent<QuickMenuEntry>();entry.Glyph=rect;entry.Caption=caption;entry.Background=background;entry.Border=outline;entry.DropShadow=shadow;
            quickButtons.Add(go.GetComponent<RectTransform>());
        }

        // ---- panel building blocks, section E of the sheet ---------------------

        /// A row container the vertical drawer layout can size, used to place
        /// several cards side by side inside a scrolling column.
        RectTransform Row(float height,int columns=0,float spacing=10f)
        {
            var row=Panel("Row",drawerContent,new Color(0,0,0,0));
            var element=row.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
            if(columns>0)
            {
                var grid=row.gameObject.AddComponent<HorizontalLayoutGroup>();
                grid.spacing=spacing;grid.childForceExpandWidth=true;grid.childForceExpandHeight=true;
                grid.childControlWidth=true;grid.childControlHeight=true;
            }
            return row;
        }

        /// Small uppercase caption that separates groups inside a panel body.
        void SectionHeader(string caption,float height=30f)
        {
            var text=Label(drawerContent,caption,12,TextAnchor.LowerLeft);
            text.color=Muted;text.resizeTextForBestFit=false;text.fontStyle=FontStyle.Bold;
            var element=text.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
        }

        /// Cream card with a hairline border, the container every panel body uses.
        RectTransform Card(Transform parent,Color? fill=null,float height=0f)
        {
            // The fill alone separates a card from the panel ground by six levels,
            // which does not read; the sheet outlines every card, so this does too.
            var outline=Panel("Card",parent,Border);
            var card=Panel("Fill",outline,fill??Cream);
            Anchor(card,Vector2.zero,Vector2.one,new Vector2(1,1),new Vector2(-1,-1));
            // The height belongs on the outline: that is the transform the parent
            // layout measures, and a LayoutElement on the inner fill is ignored.
            if(height>0f)
            {
                var element=outline.gameObject.AddComponent<LayoutElement>();
                element.preferredHeight=height;element.minHeight=height;
            }
            return card;
        }

        /// Label over a figure: the finance panel's three headline cards.
        RectTransform StatCard(Transform parent,string caption,string value,Color valueColor)
        {
            // The bands are measured from the top edge rather than split at the
            // half: a proportional split leaves a short card with a box smaller
            // than its own line height, and Unity then draws no glyphs at all.
            var card=Card(parent);
            var label=Label(card,caption,11,TextAnchor.UpperLeft);label.color=Muted;
            Anchor(label.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(12,-24),new Vector2(-10,-7));
            var figure=Label(card,value,18,TextAnchor.LowerLeft);figure.color=valueColor;figure.fontStyle=FontStyle.Bold;
            Anchor(figure.rectTransform,new Vector2(0,0),new Vector2(1,1),new Vector2(12,7),new Vector2(-10,-24));
            return card;
        }

        /// One line of a table, with the column widths given as weights.
        RectTransform TableRow(Transform parent,string[] cells,float[] weights,bool head,float height=30f)
        {
            var row=Panel(head?"Head":"Row",parent,head?new Color(0,0,0,0):Alpha(Cream,.7f));
            var element=row.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
            var total=0f;foreach(var weight in weights)total+=weight;
            var cursor=0f;
            for(var i=0;i<cells.Length;i++)
            {
                var share=weights[Mathf.Min(i,weights.Length-1)]/total;
                var cell=Label(row,cells[i],head?10:12,i<=1&&cells.Length>2?TextAnchor.MiddleLeft:i==0?TextAnchor.MiddleLeft:TextAnchor.MiddleRight);
                cell.color=head?Muted:Ink;cell.resizeTextForBestFit=false;
                if(head)cell.fontStyle=FontStyle.Bold;
                Anchor(cell.rectTransform,new Vector2(cursor,0),new Vector2(cursor+share,1),new Vector2(10,0),new Vector2(-10,0));
                cursor+=share;
            }
            return row;
        }

        /// The tab strip the inventory and avatar panels head their body with.
        void Tabs(string[] labels,int active,System.Action<int> pick,float height=38f,RectTransform host=null)
        {
            var row=host;
            if(!row)
            {
                row=Row(height,labels.Length,4f);
            }
            else
            {
                var layout=row.gameObject.AddComponent<HorizontalLayoutGroup>();
                layout.spacing=4f;layout.childForceExpandWidth=true;layout.childForceExpandHeight=true;
                layout.childControlWidth=true;layout.childControlHeight=true;
            }
            for(var i=0;i<labels.Length;i++)
            {
                var index=i;
                var tab=Panel(labels[i],row,index==active?Cream:new Color(0,0,0,0));
                var caption=Label(tab,labels[i],13,TextAnchor.MiddleCenter);
                caption.color=index==active?Ink:Muted;caption.resizeTextForBestFit=false;
                if(index==active)caption.fontStyle=FontStyle.Bold;
                Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(4,2),new Vector2(-4,-6));
                if(index==active)
                {
                    var underline=Panel("Underline",tab,Green);
                    Anchor(underline,new Vector2(0,0),new Vector2(1,0),new Vector2(10,4),new Vector2(-10,7));
                }
                var button=tab.gameObject.AddComponent<Button>();
                button.targetGraphic=tab.GetComponent<Image>();
                button.onClick.AddListener(()=>{pick(index);audioService?.UiConfirm();});
            }
        }

        /// Solid green call to action, the sheet's primary button.
        RectTransform PrimaryButton(Transform parent,string label,UnityEngine.Events.UnityAction action,float height=34f)
        {
            var button=Pill(parent,label,action,Green,Cream);
            var element=button.gameObject.GetComponent<LayoutElement>()??button.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
            return button;
        }

        /// Outlined button on the cream ground, the sheet's secondary action.
        RectTransform SecondaryButton(Transform parent,string label,UnityEngine.Events.UnityAction action,float height=34f)
        {
            var button=Pill(parent,label,action,Cream,Ink);
            var element=button.gameObject.GetComponent<LayoutElement>()??button.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
            return button;
        }

        /// Pale red button for the soft-danger action.
        RectTransform DangerButton(Transform parent,string label,UnityEngine.Events.UnityAction action,float height=34f)
        {
            var button=Pill(parent,label,action,Linear("F7E2DC"),Negative);
            var element=button.gameObject.GetComponent<LayoutElement>()??button.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
            return button;
        }

        /// Product tile: supplier-tinted swatch, name, and a quantity chip. The
        /// catalogue ships no artwork, so the swatch carries the initials.
        RectTransform ProductTile(Transform parent,string productId,string caption,int quantity)
        {
            var tile=Card(parent);
            var product=runtime.Spec.Products[productId] as JObject;
            var swatch=Panel("Swatch",tile,SupplierTint(product?.Value<string>("supplier")));
            Anchor(swatch,new Vector2(0,0),new Vector2(1,1),new Vector2(8,26),new Vector2(-8,-8));
            var initials=Label(swatch,Initials(caption),20,TextAnchor.MiddleCenter);
            initials.color=Alpha(Ink,.65f);initials.fontStyle=FontStyle.Bold;initials.resizeTextForBestFit=false;
            Anchor(initials.rectTransform,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
            var name=Label(tile,caption,10,TextAnchor.MiddleLeft);
            name.color=Ink;name.resizeTextForBestFit=false;
            Anchor(name.rectTransform,new Vector2(0,0),new Vector2(1,0),new Vector2(8,5),new Vector2(-34,24));
            var chip=Panel("Count",tile,Green);
            chip.anchorMin=chip.anchorMax=new Vector2(1,0);chip.pivot=new Vector2(1,0);
            chip.sizeDelta=new Vector2(30,17);chip.anchoredPosition=new Vector2(-8,6);
            var count=Label(chip,quantity.ToString(),10,TextAnchor.MiddleCenter);
            count.color=Cream;count.resizeTextForBestFit=false;
            Anchor(count.rectTransform,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
            return tile;
        }

        static string Initials(string label)=>string.IsNullOrEmpty(label)?"?":
            (label.Length>=2?label.Substring(0,2):label).ToUpperInvariant();

        Color SupplierTint(string supplier)=>supplier switch
        {
            "campo"=>Linear("CFE0C0"),"fresco"=>Linear("F3D9C4"),
            "panal"=>Linear("EBDCA8"),"andes"=>Linear("D9C7B4"),_=>Linear("E4E0D4")
        };

        /// Star rating rendered as a figure beside a filled star, as on the sheet.
        /// Positioned by anchor fraction, not by pixel offset: the row has no
        /// width yet while it is being built, so a computed x lands on zero and
        /// the rating prints on top of the name.
        void Stars(Transform parent,double rating,float fraction)
        {
            var star=new GameObject("Star",typeof(RectTransform),typeof(Image));
            star.transform.SetParent(parent,false);
            var image=star.GetComponent<Image>();image.sprite=Icon("target");image.color=Orange;
            image.preserveAspect=true;image.raycastTarget=false;
            var rect=star.GetComponent<RectTransform>();
            rect.anchorMin=rect.anchorMax=new Vector2(fraction,.5f);rect.pivot=new Vector2(0,.5f);
            rect.sizeDelta=new Vector2(13,13);rect.anchoredPosition=Vector2.zero;
            var value=Label(parent,rating.ToString("0.0"),12,TextAnchor.MiddleLeft);
            value.color=Ink;value.resizeTextForBestFit=false;
            Anchor(value.rectTransform,new Vector2(fraction,0),new Vector2(fraction,1),new Vector2(17,0),new Vector2(56,0));
        }

        /// Two crossed bars rather than a glyph: the runtime font carries no
        /// multiplication-X, so a text close button drew nothing at all.
        RectTransform CloseGlyph(Transform parent,Color tint,UnityEngine.Events.UnityAction action,float size=32f)
        {
            var hit=Panel("Close",parent,new Color(0,0,0,0));
            hit.sizeDelta=new Vector2(size,size);
            foreach(var angle in new[]{45f,-45f})
            {
                var bar=Panel("Bar",hit,tint);
                bar.anchorMin=bar.anchorMax=new Vector2(.5f,.5f);bar.pivot=new Vector2(.5f,.5f);
                bar.sizeDelta=new Vector2(size*.44f,1.6f);bar.anchoredPosition=Vector2.zero;
                bar.localRotation=Quaternion.Euler(0,0,angle);
                var image=bar.GetComponent<Image>();image.sprite=null;image.raycastTarget=false;
            }
            var button=hit.gameObject.AddComponent<Button>();
            button.targetGraphic=hit.GetComponent<Image>();
            button.onClick.AddListener(action);
            return hit;
        }

        /// Track with a fill, the shape every progress readout on the sheet uses.
        (RectTransform track,RectTransform fill) Meter(Transform parent,Color trackColor,Color fillColor,float value=0f)
        {
            var track=Panel("Track",parent,trackColor);
            var fill=Panel("Fill",track,fillColor);
            Anchor(fill,Vector2.zero,new Vector2(Mathf.Clamp01(value),1),Vector2.zero,Vector2.zero);
            return (track,fill);
        }

        static void SetMeter(RectTransform fill,float value)
        {
            if(fill)fill.anchorMax=new Vector2(Mathf.Clamp01(value),1);
        }

        /// Icon plus caption on one line: the sheet's list rows and card headers
        /// are all this shape.
        RectTransform IconRow(Transform parent,string icon,string caption,int size,Color tint,float height=34f)
        {
            var row=Panel("Row",parent,new Color(0,0,0,0));
            var element=row.gameObject.AddComponent<LayoutElement>();
            element.preferredHeight=height;element.minHeight=height;
            if(!string.IsNullOrEmpty(icon))
            {
                var glyph=new GameObject("Icon",typeof(RectTransform),typeof(Image));
                glyph.transform.SetParent(row,false);
                var image=glyph.GetComponent<Image>();
                image.sprite=Icon(icon);image.color=tint;image.preserveAspect=true;image.raycastTarget=false;
                var rect=glyph.GetComponent<RectTransform>();
                rect.anchorMin=rect.anchorMax=new Vector2(0,.5f);rect.pivot=new Vector2(0,.5f);
                rect.sizeDelta=new Vector2(size,size);rect.anchoredPosition=new Vector2(10,0);
            }
            var text=Label(row,caption,14,TextAnchor.MiddleLeft);
            text.color=tint;text.resizeTextForBestFit=false;
            Anchor(text.rectTransform,Vector2.zero,Vector2.one,
                   new Vector2(string.IsNullOrEmpty(icon)?12:size+18,0),new Vector2(-10,0));
            return row;
        }

        /// Small uppercase tag: NUEVO, OFERTA, POPULAR.
        RectTransform Tag(Transform parent,string text,Color fill,Color ink)
        {
            var tag=Panel("Tag",parent,fill);
            var caption=Label(tag,text,11,TextAnchor.MiddleCenter);
            caption.color=ink;caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
            Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(6,2),new Vector2(-6,-2));
            return tag;
        }

        /// Level shield pinned to the corner.
        void CornerBadge(Transform parent)
        {
            levelBadge=Panel("CornerBadge",parent,Green);
            levelBadge.anchorMin=levelBadge.anchorMax=new Vector2(1,1);levelBadge.pivot=new Vector2(1,1);
            levelBadge.sizeDelta=new Vector2(64,74);levelBadge.anchoredPosition=new Vector2(-14,-92);
            var caption=Label(levelBadge,"NIVEL",9,TextAnchor.UpperCenter);
            caption.color=Alpha(Cream,.82f);caption.fontStyle=FontStyle.Bold;caption.resizeTextForBestFit=false;
            Anchor(caption.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(0,-16),new Vector2(0,-4));
            levelBadgeText=Label(levelBadge,"1",26,TextAnchor.MiddleCenter);
            levelBadgeText.color=Cream;levelBadgeText.fontStyle=FontStyle.Bold;levelBadgeText.resizeTextForBestFit=false;
            Anchor(levelBadgeText.rectTransform,new Vector2(0,0),new Vector2(1,1),new Vector2(0,18),new Vector2(0,-16));
            var star=new GameObject("Star",typeof(RectTransform),typeof(Image));
            star.transform.SetParent(levelBadge,false);
            var image=star.GetComponent<Image>();image.sprite=Icon("target");image.color=Orange;
            image.preserveAspect=true;image.raycastTarget=false;
            var rect=star.GetComponent<RectTransform>();
            rect.anchorMin=rect.anchorMax=new Vector2(.5f,0);rect.pivot=new Vector2(.5f,0);
            rect.sizeDelta=new Vector2(15,15);rect.anchoredPosition=new Vector2(0,6);
        }

        /// A thin rule between the top bar's columns, as the sheet draws them.
        void Divider(Transform parent)
        {
            var rule=Panel("Divider",parent,Border);
            var element=rule.gameObject.AddComponent<LayoutElement>();
            element.preferredWidth=1;element.minWidth=1;
            rule.GetComponent<Image>().sprite=null;
            var group=rule.gameObject.AddComponent<CanvasGroup>();group.alpha=.75f;
        }

        /// Small square badge holding the shop's initial, top left of the bar.
        void BrandMark(Transform parent)
        {
            var mark=Panel("BrandMark",parent,Green);
            mark.anchorMin=mark.anchorMax=new Vector2(0,.5f);mark.pivot=new Vector2(0,.5f);
            mark.sizeDelta=new Vector2(34,34);mark.anchoredPosition=new Vector2(10,0);
            var initial=Label(mark,"M",19,TextAnchor.MiddleCenter);
            initial.color=Cream;initial.fontStyle=FontStyle.Bold;initial.resizeTextForBestFit=false;
            Anchor(initial.rectTransform,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);
        }

        /// Rounded pill, used for the open/closed switch and the status tags.
        RectTransform Pill(Transform parent,string label,UnityEngine.Events.UnityAction action,Color fill,Color text)
        {
            var go=new GameObject(label,typeof(RectTransform),typeof(Image),typeof(LayoutElement));
            go.transform.SetParent(parent,false);
            var image=go.GetComponent<Image>();image.color=fill;
            if(roundedSprite){image.sprite=roundedSprite;image.type=Image.Type.Sliced;}
            if(action!=null)go.AddComponent<Button>().onClick.AddListener(action);
            var element=go.GetComponent<LayoutElement>();element.preferredHeight=38;element.minHeight=30;
            var caption=Label(go.transform,label,15,TextAnchor.MiddleCenter);
            caption.color=text;caption.fontStyle=FontStyle.Bold;
            caption.resizeTextForBestFit=true;caption.resizeTextMinSize=8;caption.resizeTextMaxSize=15;
            Anchor(caption.rectTransform,Vector2.zero,Vector2.one,new Vector2(10,0),new Vector2(-10,0));
            return go.GetComponent<RectTransform>();
        }

        static void SizeForLayout(RectTransform rect,float width){var element=rect.GetComponent<LayoutElement>()??rect.gameObject.AddComponent<LayoutElement>();element.preferredWidth=width;element.minWidth=width;}
        static void Anchor(RectTransform rect,Vector2 min,Vector2 max,Vector2 offsetMin,Vector2 offsetMax){rect.anchorMin=min;rect.anchorMax=max;rect.offsetMin=offsetMin;rect.offsetMax=offsetMax;}
        static void Clear(Transform root){for(var i=root.childCount-1;i>=0;i--)Destroy(root.GetChild(i).gameObject);}

        /// The QA card is opened with F8; it stays off in a normal session so it
        /// never covers the quick menu it sits beside.
        void Update()
        {
            if(Input.GetKeyDown(KeyCode.F8)&&qaPanel)qaPanel.gameObject.SetActive(!qaPanel.gameObject.activeSelf);
            if(!qaPanel||!qaPanel.gameObject.activeSelf)return;
            qaFrames++;qaTimer+=Time.unscaledDeltaTime;
            if(qaTimer<.5f)return;
            var fps=Mathf.RoundToInt(qaFrames/qaTimer);qaFrames=0;qaTimer=0;
            // Draw calls are an editor-only statistic; the runtime can honestly
            // report how many renderers and triangles the scene is carrying.
            if(qaTriangles<0)
            {
                qaTriangles=0;qaRenderers=0;
                foreach(var filter in FindObjectsByType<MeshFilter>(FindObjectsSortMode.None))
                {
                    var mesh=filter.sharedMesh;if(!mesh)continue;
                    qaTriangles+=mesh.triangles.Length/3;qaRenderers++;
                }
            }
            qaText.text=$"QA\n\nFPS                    {fps}\nMallas            {qaRenderers}\nTriángulos    {qaTriangles/1000}K";
        }

        void OnDestroy(){if(avatarCamera)Destroy(avatarCamera.gameObject);if(avatarTexture)avatarTexture.Release();if(runtime?.Signals!=null){runtime.Signals.StateChanged-=Refresh;runtime.Signals.Notification-=Notify;}if(runtime?.Interactions!=null)runtime.Interactions.NearestChanged-=NearestChanged;}
    }
}
