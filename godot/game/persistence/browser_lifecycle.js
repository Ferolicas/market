// GameRuntime.tsx lifecycle, delivered synchronously even while RAF is suspended.
window.__marketInstallLifecycle = callback => {
  window.__marketRemoveLifecycle?.();
  const visibility = () => callback(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
  const pagehide = () => callback('pagehide');
  const online = () => callback('online');
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('online', online);
  window.__marketRemoveLifecycle = () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('online', online);
    delete window.__marketRemoveLifecycle;
  };
  visibility();
};
