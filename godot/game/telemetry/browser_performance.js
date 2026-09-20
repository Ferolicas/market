// Browser timing only; game simulation remains native GDScript.
(() => {
  window.__marketFieldPerformance?.close();
  const sample = {frames: [], longTasks: [], previous: 0, request: 0, observer: null};
  const frame = now => {
    if (sample.previous > 0) sample.frames.push(now - sample.previous);
    sample.previous = now;
    sample.request = requestAnimationFrame(frame);
  };
  sample.request = requestAnimationFrame(frame);
  if (typeof PerformanceObserver !== 'undefined') {
    sample.observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) sample.longTasks.push(entry.duration);
    });
    try { sample.observer.observe({type: 'longtask', buffered: true}); } catch { /* Not exposed by every browser. */ }
  }
  sample.take = () => {
    const data = {frames: sample.frames, longTasks: sample.longTasks};
    sample.frames = []; sample.longTasks = [];
    return JSON.stringify(data);
  };
  sample.canvas = document.querySelector('canvas');
  const reportContext = (name,severity,keepalive) => {
    if(!sample.telemetry)return;
    fetch('/api/game/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',keepalive,body:JSON.stringify({...sample.telemetry,name,severity})}).catch(()=>{});
  };
  sample.lost = () => reportContext('context-lost','error',true);
  sample.restored = () => reportContext('context-restored','warning',false);
  sample.canvas?.addEventListener('marketwebgllost',sample.lost);
  sample.canvas?.addEventListener('marketwebglrestored',sample.restored);
  sample.close = () => {
    cancelAnimationFrame(sample.request); sample.observer?.disconnect();
    sample.canvas?.removeEventListener('marketwebgllost',sample.lost);
    sample.canvas?.removeEventListener('marketwebglrestored',sample.restored);
  };
  window.__marketFieldPerformance = sample;
})();
