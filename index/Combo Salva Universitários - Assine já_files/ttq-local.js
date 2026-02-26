(function(window){
  // Minimal local ttq shim for offline/testing when events.js is blocked.
  window.ttq = window.ttq || [];
  var ttq = window.ttq;
  /* ttq-local.js: small silent fallback shim for TikTok Pixel.
     Purpose: if the official events.js is blocked (ERR_BLOCKED_BY_ORB / COEP/COOP),
     this shim defines a minimal `ttq` API and sends a lightweight Image GET to
     analytics.tiktok.com/i18n/pixel/pixel.gif as a fallback for PageView/track calls.
     It only defines `ttq` if not already present, and is intentionally silent (no UI).
  */
  (function(){
    if(typeof window === 'undefined') return;
    if(window.ttq && window.ttq._isTtqShim) return; // don't override real SDK

    var SDK_ID = 'D470KQRC77U2U4VHN6A0';
    var ttq = window.ttq = window.ttq || [];
    ttq._isTtqShim = true;
    ttq._localFallback = true;

    var methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group"];
    function noop(){}
    function sendFallbackImage(eventName, payload){
      try{
        var img = new Image();
        var q = 'sdkid=' + encodeURIComponent(SDK_ID) + '&event=' + encodeURIComponent(eventName);
        if(payload){
          try{ q += '&d=' + encodeURIComponent(JSON.stringify(payload).slice(0,512)); }catch(e){}
        }
        img.src = 'https://analytics.tiktok.com/i18n/pixel/pixel.gif?' + q + '&_ts=' + Date.now();
        // no onload/onerror needed; fire-and-forget
      }catch(e){ /* ignore */ }
    }

    methods.forEach(function(m){
      ttq[m] = function(){
        var args = Array.prototype.slice.call(arguments);
        try{
          if(m === 'page'){
            sendFallbackImage('PageView');
          } else if(m === 'track' && args.length){
            var ev = args[0] || 'track';
            var data = args[1] || null;
            sendFallbackImage(ev, data);
          }
        }catch(e){}
        // queue the call so a real SDK (if it loads later) can pick it up
        ttq.push([m].concat(args));
      };
    });

    // minimal load/instance helpers (no-op but keep shape)
    ttq.load = function(id, opts){
      // intentionally no-op; real SDK will override if it loads
      ttq._i = ttq._i || {};
      ttq._i[id] = ttq._i[id] || [];
      ttq._t = ttq._t || {}; ttq._t[id] = +new Date();
      ttq._o = ttq._o || {}; ttq._o[id] = opts || {};
    };
    ttq.instance = function(id){ ttq._i = ttq._i || {}; ttq._i[id] = ttq._i[id] || []; return ttq._i[id]; };

    // expose a small debug helper (no UI)
    ttq._shimVersion = '1';

  })();
})(window);
