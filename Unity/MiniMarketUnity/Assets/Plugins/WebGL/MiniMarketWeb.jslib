mergeInto(LibraryManager.library,{
  MiniMarketLogout:function(){if(window.miniMarketLogout)window.miniMarketLogout();},
  MiniMarketLoadingPhase:function(message,progress){
    if(window.miniMarketLoadingPhase)window.miniMarketLoadingPhase(UTF8ToString(message),progress);
  },
  MiniMarketLoadingReady:function(){if(window.miniMarketLoadingReady)window.miniMarketLoadingReady();}
});
