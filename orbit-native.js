(function(){
  if(window.__orbitNativeLoaded) return;
  window.__orbitNativeLoaded = true;

  function hasCap(){
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function plugin(n){
    try{ return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[n]; }catch(e){ return null; }
  }

  var LIVE_URL = "https://orbitbillsphone.onrender.com";
  var PREFER_LIVE = false;
  var SYNC_PATH = "OrbitBills/orbit-sync-backup.json";
  var _syncBusy = false;
  var _lastOnline = null;

  function isOnLiveHost(){
    try{
      var h = (location.hostname||"").toLowerCase();
      if(!h) return false;
      return h.indexOf("onrender.com") >= 0 || h === "orbitbillsphone.onrender.com" || h === "orbitbillsdemo2.onrender.com";
    }catch(e){ return false; }
  }
  function isLocalCapOrigin(){
    try{
      var h = (location.hostname||"").toLowerCase();
      var proto = (location.protocol||"").toLowerCase();
      if(proto === "capacitor:" || proto === "ionic:") return true;
      if(h === "localhost" || h === "127.0.0.1") return true;
      return false;
    }catch(e){ return false; }
  }
  function localBaseUrl(){
    try{
      if(location.protocol === "capacitor:" || location.protocol === "ionic:") return location.protocol + "//localhost";
    }catch(e){}
    return "https://localhost";
  }
  function currentAppPath(){
    try{
      var p = location.pathname || "/";
      var parts = p.split("/").filter(Boolean);
      var file = parts.length ? parts[parts.length - 1] : "index.html";
      if(!/\.html$/i.test(file)) file = "index.html";
      var allowed = {"billing.html":1,"admin-dashboard.html":1,"accountant-dashboard.html":1,"signin.html":1,"index.html":1,"home.html":1,"offline.html":1};
      if(!allowed[file]) file = "index.html";
      return "/" + file;
    }catch(e){ return "/index.html"; }
  }
  function waitForDb(maxMs){
    maxMs = maxMs || 4000;
    return new Promise(function(resolve){
      var start = Date.now();
      (function tick(){
        if(typeof window.tsBuildBackupPayload === "function" && typeof window.tsRestoreBackupPayload === "function"){ resolve(true); return; }
        if(Date.now() - start > maxMs){ resolve(false); return; }
        setTimeout(tick, 80);
      })();
    });
  }
  function showSwitchOverlay(msg){
    try{
      var el = document.getElementById("orbitSwitchOverlay");
      if(!el){
        el = document.createElement("div");
        el.id = "orbitSwitchOverlay";
        el.style.cssText = "position:fixed;inset:0;z-index:200000;background:#0b3d91;color:#fff;display:flex;align-items:center;justify-content:center;font:600 15px system-ui,sans-serif;padding:24px;text-align:center;";
        el.innerHTML = "<div id=\"orbitSwitchMsg\"></div>";
        (document.body||document.documentElement).appendChild(el);
      }
      var m = document.getElementById("orbitSwitchMsg");
      if(m) m.textContent = msg || "Switching to offline mode...";
      el.style.display = "flex";
    }catch(e){}
  }
  async function writeSyncBackup(payload){
    var Filesystem = plugin("Filesystem");
    if(!Filesystem || !Filesystem.writeFile) return false;
    try{
      var json = JSON.stringify(payload);
      await Filesystem.writeFile({ path: SYNC_PATH, data: btoa(unescape(encodeURIComponent(json))), directory: "DATA", recursive: true });
      return true;
    }catch(e){ return false; }
  }
  async function readSyncBackup(){
    var Filesystem = plugin("Filesystem");
    if(!Filesystem || !Filesystem.readFile) return null;
    try{
      var res = await Filesystem.readFile({ path: SYNC_PATH, directory: "DATA" });
      var raw = res && res.data; if(!raw) return null;
      var text;
      try{ text = decodeURIComponent(escape(atob(raw))); }catch(e1){ try{ text = atob(raw); }catch(e2){ text = String(raw); } }
      var payload = JSON.parse(text);
      if(!payload || payload.format !== "orbitbills-local-backup") return null;
      return payload;
    }catch(e){ return null; }
  }
  async function exportDbToNative(){
    if(!hasCap() || _syncBusy) return false;
    _syncBusy = true;
    try{
      if(!(await waitForDb(3000))) return false;
      var payload = await window.tsBuildBackupPayload();
      if(!payload) return false;
      payload.syncSource = isOnLiveHost() ? "live" : "local";
      payload.syncPath = currentAppPath();
      return await writeSyncBackup(payload);
    }catch(e){ return false; }
    finally{ _syncBusy = false; }
  }
  async function importDbFromNative(opts){
    opts = opts || {};
    if(!hasCap() || _syncBusy) return false;
    _syncBusy = true;
    try{
      if(!(await waitForDb(4000))) return false;
      var payload = await readSyncBackup();
      if(!payload || !payload.stores) return false;
      try{ var applied = localStorage.getItem("orbit_sync_applied_at"); if(applied && payload.exportedAt && applied === payload.exportedAt) return false; }catch(e){}
      var mode = "merge";
      try{
        if(opts.force) mode = "replace";
        else if(typeof window.tsCount === "function"){
          var ic = await window.tsCount("invoices");
          var pc = await window.tsCount("products");
          if((ic||0)===0 && (pc||0)===0) mode = "replace";
        }
      }catch(e){}
      await window.tsRestoreBackupPayload(payload, { mode: mode });
      try{ if(typeof window.tsSetSetting === "function" && payload.exportedAt) await window.tsSetSetting("orbit_last_export_at", payload.exportedAt); }catch(e){}
      try{ localStorage.setItem("orbit_sync_applied_at", payload.exportedAt || ""); }catch(e){}
      try{ window.dispatchEvent(new CustomEvent("orbitbills-sync", { detail: { type: "restore", from: "native-sync" } })); }catch(e){}
      return true;
    }catch(e){ return false; }
    finally{ _syncBusy = false; }
  }
  window.__orbitExportSync = exportDbToNative;
  window.__orbitImportSync = importDbFromNative;

  async function switchToOfflineLocal(){
    if(!hasCap() || !isOnLiveHost()) return false;
    try{ showSwitchOverlay("Saving data and switching to offline..."); }catch(e){}
    try{ sessionStorage.setItem("orbit_skip_live_redirect", "1"); }catch(e){}
    try{ sessionStorage.removeItem("orbit_live_redirected"); }catch(e){}
    try{ await exportDbToNative(); }catch(e){}
    await new Promise(function(r){ setTimeout(r, 150); });
    var target = localBaseUrl().replace(/\/$/, "") + currentAppPath();
    try{ window.location.replace(target); }catch(e){ try{ window.location.href = target; }catch(e2){} }
    return true;
  }

  async function tryHybridLiveRedirect(){
    if(!hasCap() || !PREFER_LIVE) return false;
    return false;
  }

  async function setChromeColors(){
    var brand = "#ffffff";
    try{ var StatusBar=plugin("StatusBar"); if(StatusBar){ if(StatusBar.setBackgroundColor) await StatusBar.setBackgroundColor({color:brand}); if(StatusBar.setStyle) await StatusBar.setStyle({style:"LIGHT"}); /* white battery/time on blue */ if(StatusBar.setOverlaysWebView) await StatusBar.setOverlaysWebView({overlay:false}); } }catch(e){}
    try{ var meta = document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute("content", brand); else { meta = document.createElement("meta"); meta.name = "theme-color"; meta.content = brand; document.head.appendChild(meta); } ensureNavFill(brand); }catch(e){}
  }
  function ensureNavFill(brand){
    if(document.getElementById("orbitNavFill")) return;
    var fill = document.createElement("div");
    fill.id = "orbitNavFill"; fill.setAttribute("aria-hidden","true");
    fill.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:max(env(safe-area-inset-bottom,0px),1px);min-height:env(safe-area-inset-bottom,0px);background:#ffffff;z-index:99998;pointer-events:none;";
    (document.body||document.documentElement).appendChild(fill);
  }

  function ensureOfflineModal(){
    if(document.getElementById("orbitOfflineModal")) return;
    var wrap = document.createElement("div");
    wrap.id = "orbitOfflineModal"; wrap.setAttribute("aria-hidden","true");
    wrap.style.cssText = "display:none;position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.45);align-items:center;justify-content:center;padding:20px;box-sizing:border-box;";
    wrap.innerHTML = '<div role="dialog" style="width:100%;max-width:340px;background:#fff;border-radius:16px;padding:22px 18px 16px;box-shadow:0 20px 50px rgba(15,23,42,.25);font-family:system-ui,sans-serif;"><div style="font-size:22px;margin-bottom:12px;">📡</div><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#101a2b;">You are offline</h3><p style="margin:0 0 14px;font-size:14px;line-height:1.45;color:#5b6b82;">Keep billing as usual. All data is saved on this phone.</p><button type="button" id="orbitOffOk" style="width:100%;min-height:44px;border:0;background:#0b3d91;color:#fff;font-weight:700;font-size:14px;border-radius:11px;cursor:pointer;">OK</button></div>';
    (document.body||document.documentElement).appendChild(wrap);
    wrap.addEventListener("click", function(e){ if(e.target === wrap) hideOfflineModal(); });
    var ok = document.getElementById("orbitOffOk"); if(ok) ok.addEventListener("click", hideOfflineModal);
  }
  function showOfflineModal(){ try{ if(sessionStorage.getItem("orbit_offline_modal_dismissed") === "1") return; }catch(e){} ensureOfflineModal(); var wrap = document.getElementById("orbitOfflineModal"); if(wrap){ wrap.style.display = "flex"; } }
  function hideOfflineModal(){ var wrap = document.getElementById("orbitOfflineModal"); if(wrap){ wrap.style.display = "none"; } try{ sessionStorage.setItem("orbit_offline_modal_dismissed","1"); }catch(e){} }

  var NOTIF_CHANNEL_ID = "orbitbills_alerts"; var _notifReady = false;
  async function ensureNotifChannel(){
    var LN = plugin("LocalNotifications"); if(!LN) return false;
    try{
      if(LN.requestPermissions){ var perm = await LN.requestPermissions(); if(perm && perm.display === "denied") return false; }
      if(LN.createChannel){ await LN.createChannel({ id: NOTIF_CHANNEL_ID, name: "OrbitBills alerts", description: "Bills, low stock, expiring products", importance: 5, visibility: 1, sound: "default", vibration: true }); }
      _notifReady = true; return true;
    }catch(e){ return false; }
  }
  window.__orbitEnableNotifications = async function(){
    try{
      if(hasCap()){
        var ok = await ensureNotifChannel();
        try{ localStorage.setItem("orbit_notif_on","1"); }catch(e){}
        return !!ok;
      }
      if(typeof Notification === "undefined") return false;
      if(Notification.permission === "granted"){ try{ localStorage.setItem("orbit_notif_on","1"); }catch(e){} return true; }
      if(Notification.permission === "denied") return false;
      var perm = await Notification.requestPermission();
      var ok = perm === "granted";
      try{ localStorage.setItem("orbit_notif_on", ok ? "1" : "0"); }catch(e){}
      return ok;
    }catch(e){ return false; }
  };
  window.__orbitNotify = async function(opts){
    opts = opts || {};
    var title = opts.title || "OrbitBills";
    var body = opts.body || "";
    var id = opts.id != null ? Number(opts.id) : (Math.floor(Date.now() % 1000000) + Math.floor(Math.random()*900));
    try{
      if(hasCap()){
        var LN = plugin("LocalNotifications");
        if(!LN || !LN.schedule) return false;
        if(!_notifReady) await ensureNotifChannel();
        if(!_notifReady) return false;
        await LN.schedule({ notifications: [{ id: id, title: title, body: body, channelId: NOTIF_CHANNEL_ID, sound: "default", schedule: { at: new Date(Date.now() + 200) }, extra: opts.extra || {} }] });
        return true;
      }
      if(typeof Notification === "undefined") return false;
      if(Notification.permission !== "granted") return false;
      try{
        if(navigator.serviceWorker){
          var reg = await navigator.serviceWorker.ready;
          if(reg && reg.showNotification){
            await reg.showNotification(title, { body: body, icon: "./app-icon-192.png", badge: "./app-icon-96.png", tag: "orbit-" + id });
            return true;
          }
        }
      }catch(e){}
      new Notification(title, { body: body, icon: "./app-icon-192.png", tag: "orbit-" + id });
      return true;
    }catch(e){ return false; }
  };
  window.__orbitNotifyInvoice = function(invNo, totalText){ var n = invNo || "Invoice"; var t = totalText || ""; return window.__orbitNotify({ title: "Bill created · " + n, body: t ? ("Total " + t + " · OrbitBills") : "Invoice saved on this device", id: Math.abs(String(n).split("").reduce(function(a,c){ return ((a<<5)-a)+c.charCodeAt(0)|0; },0)) % 900000 + 100 }); };
  window.__orbitNotifyLowStock = function(names){ var list = Array.isArray(names) ? names.filter(Boolean) : [names]; if(!list.length) return Promise.resolve(false); var body = list.slice(0, 4).join(", "); if(list.length > 4) body += " +" + (list.length - 4) + " more"; return window.__orbitNotify({ title: "Low stock alert", body: body, id: 42001 }); };
  window.__orbitNotifyExpiring = function(names){ var list = Array.isArray(names) ? names.filter(Boolean) : [names]; if(!list.length) return Promise.resolve(false); var body = list.slice(0, 4).join(", "); if(list.length > 4) body += " +" + (list.length - 4) + " more"; return window.__orbitNotify({ title: "Stock expiring soon", body: body, id: 42002 }); };

  function blobToBase64(blob){ return new Promise(function(resolve, reject){ var r = new FileReader(); r.onload = function(){ var s = String(r.result || ""); var i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : s); }; r.onerror = reject; r.readAsDataURL(blob); }); }
  window.__orbitNativeShare = async function(opts){
    opts = opts || {}; var title = opts.title || "Invoice · TechSerenia"; var text = opts.text || "Invoice from TechSerenia"; var filename = opts.filename || ("invoice-" + Date.now() + ".png"); var blob = opts.blob; var Share = plugin("Share"); var Filesystem = plugin("Filesystem");
    if(hasCap() && Share && Share.share && Filesystem && Filesystem.writeFile && blob){
      try{
        var b64 = await blobToBase64(blob);
        var attempts = [{ path: "TechSerenia/" + filename, directory: "CACHE" }, { path: "TechSerenia/" + filename, directory: "DATA" }, { path: filename, directory: "CACHE" }];
        var uri = null;
        for(var i = 0; i < attempts.length && !uri; i++){
          try{ await Filesystem.writeFile({ path: attempts[i].path, data: b64, directory: attempts[i].directory, recursive: true }); var uriRes = await Filesystem.getUri({ path: attempts[i].path, directory: attempts[i].directory }); uri = uriRes && (uriRes.uri || uriRes); }catch(eWrite){}
        }
        if(uri){ try{ await Share.share({ title: title, text: text, dialogTitle: "Share invoice", files: [uri], url: uri }); return true; }catch(eFiles){ try{ await Share.share({ title: title, text: text, dialogTitle: "Share invoice", url: uri }); return true; }catch(eUrl){} } }
      }catch(eCap){}
    }
    if(navigator.share && blob && filename){ try{ var file = new File([blob], filename, { type: blob.type || (/\.pdf$/i.test(filename) ? "application/pdf" : "image/png") }); var data = { title: title, text: text, files: [file] }; if(navigator.canShare && !navigator.canShare(data)){ await navigator.share({ title: title, text: text }); return true; } await navigator.share(data); return true; }catch(e){ if(e && e.name === "AbortError") return true; } }
    if(navigator.share){ try{ await navigator.share({ title: title, text: text, url: opts.url }); return true; }catch(e){ if(e && e.name === "AbortError") return true; } }
    return false;
  };
  window.__orbitHaptic = async function(style){ try{ if(!hasCap()){ if(navigator.vibrate) navigator.vibrate(style === "error" ? 30 : 12); return; } var H = plugin("Haptics"); if(!H) return; if(style === "success" && H.notification) await H.notification({ type: "SUCCESS" }); else if(style === "error" && H.notification) await H.notification({ type: "ERROR" }); else if(H.impact) await H.impact({ style: "LIGHT" }); }catch(e){} };
  window.__orbitPlaySuccessTone = function(){ try{ if(typeof window.playInvoiceSuccessSound === "function"){ window.playInvoiceSuccessSound(); return; } var Ctx = window.AudioContext || window.webkitAudioContext; if(!Ctx) return; var ctx = window.__orbitToneCtx || (window.__orbitToneCtx = new Ctx()); if(ctx.state === "suspended") ctx.resume(); var now = ctx.currentTime; function tone(freq, start, dur, gain){ var o = ctx.createOscillator(); var g = ctx.createGain(); o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(gain, start + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, start + dur); o.connect(g); g.connect(ctx.destination); o.start(start); o.stop(start + dur + 0.02); } tone(880, now, 0.12, 0.09); tone(1174.66, now + 0.09, 0.16, 0.07); }catch(e){} };

  async function ready(){
    try{ if(hasCap() && isOnLiveHost() && !navigator.onLine){ await switchToOfflineLocal(); return true; } }catch(e){}
    try{ if(await tryHybridLiveRedirect()) return true; }catch(e){}
    try{ if(hasCap() && isLocalCapOrigin()) setTimeout(function(){ importDbFromNative({}); }, 600); }catch(e){}
    if(!hasCap()){ setupNetwork(); setupBackButton(); try{ ensureNavFill("#ffffff"); }catch(e){} return false; }
    await setChromeColors();
    try{ var Splash = plugin("SplashScreen"); if(Splash && Splash.hide) await Splash.hide({ fadeOutDuration: 250 }); }catch(e){}
    try{ var Keyboard = plugin("Keyboard"); if(Keyboard && Keyboard.setResizeMode) await Keyboard.setResizeMode({ mode: "body" }); }catch(e){}
    setupNetwork(); setupBackButton();
    try{ await ensureNotifChannel(); }catch(e){}
    try{ if(/billing\.html/i.test(location.pathname || "") && navigator.wakeLock && navigator.wakeLock.request){ try{ window.__orbitWake = await navigator.wakeLock.request("screen"); }catch(e){} } }catch(e){}
    try{ if(hasCap() && isLocalCapOrigin()) setInterval(function(){ exportDbToNative(); }, 60000); }catch(e){}
    return true;
  }

  function setupNetwork(){
    var Network = plugin("Network");
    var bar = document.getElementById("orbitOfflineBanner");
    if(!bar){
      bar = document.createElement("div"); bar.id = "orbitOfflineBanner";
      bar.style.cssText = "display:none;position:fixed;left:0;right:0;top:0;z-index:99999;background:#b91c1c;color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:8px 40px 8px 12px;padding-top:max(8px,env(safe-area-inset-top));text-align:center;box-sizing:border-box;";
      var msg = document.createElement("span"); msg.id = "orbitOfflineBannerText"; msg.textContent = "You are offline - data stays on this device"; bar.appendChild(msg);
      var x = document.createElement("button"); x.type = "button"; x.id = "orbitOfflineBannerClose"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "\u00d7";
      x.style.cssText = "position:absolute;right:8px;top:50%;transform:translateY(-50%);width:32px;height:32px;border:0;background:transparent;color:#fff;font:700 22px/1 system-ui,sans-serif;cursor:pointer;";
      x.addEventListener("click", function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(err){} try{ sessionStorage.setItem("orbit_offline_banner_dismissed", "1"); }catch(err){} bar.style.display = "none"; bar.setAttribute("data-dismissed", "1"); });
      bar.appendChild(x); bar.style.display = "none"; (document.body || document.documentElement).appendChild(bar);
    }
    function isDismissed(){ if(bar.getAttribute("data-dismissed") === "1") return true; try{ return sessionStorage.getItem("orbit_offline_banner_dismissed") === "1"; }catch(e){ return false; } }
    function setOnline(ok){
      if(_lastOnline === ok) return; _lastOnline = ok;
      /* Never show the red top banner — popup only */
      try{ bar.style.display = "none"; }catch(e){}
      if(ok){
        try{ sessionStorage.removeItem("orbit_offline_banner_dismissed"); }catch(e){}
        try{ bar.removeAttribute("data-dismissed"); }catch(e){}
        try{ if(hasCap() && isLocalCapOrigin()) exportDbToNative(); }catch(e){}
        return;
      }
      try{ showOfflineModal(); }catch(e){}
      if(hasCap() && isOnLiveHost()){ switchToOfflineLocal(); return; }
      if(hasCap() && isLocalCapOrigin()){ try{ exportDbToNative(); }catch(e){} }
    }
    if(Network && Network.getStatus){
      Network.getStatus().then(function(s){ setOnline(!!s.connected); }).catch(function(){});
      if(Network.addListener) Network.addListener("networkStatusChange", function(s){ setOnline(!!s.connected); });
    } else {
      setOnline(navigator.onLine);
    }
    try{ window.addEventListener("online", function(){ setOnline(true); }); window.addEventListener("offline", function(){ setOnline(false); }); }catch(e){}
  }

  function setupBackButton(){
    var App = plugin("App");
    window.__orbitAndroidBack = function(){
      if(document.body && document.body.classList.contains("m-cart-open")){ if(window.__orbitCloseMobileCart) window.__orbitCloseMobileCart(); else document.body.classList.remove("m-cart-open"); return true; }
      var menu = document.getElementById("mobileMenu"); if(menu && menu.classList.contains("open")){ if(window.__orbitCloseMobileMenu) window.__orbitCloseMobileMenu(); else menu.classList.remove("open"); return true; }
      var openModalEl = document.querySelector(".modal-bg.open"); if(openModalEl){ openModalEl.classList.remove("open"); return true; }
      var offModal = document.getElementById("orbitOfflineModal"); if(offModal && offModal.style.display === "flex"){ hideOfflineModal(); return true; }
      if(window.history.length > 1){ history.back(); return true; }
      return false;
    };
    if(App && App.addListener){ App.addListener("backButton", function(){ var handled = false; try{ handled = !!window.__orbitAndroidBack(); }catch(e){} if(!handled && App.exitApp) App.exitApp(); }); }
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  window.addEventListener("load", ready);
  try{
    if(!hasCap() && "serviceWorker" in navigator){
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function(){});
    }
  }catch(e){}
})();
