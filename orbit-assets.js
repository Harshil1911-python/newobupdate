/**
 * OrbitBills permanent asset cache
 * - Logo loads once, then served from IndexedDB for the lifetime of the install
 * - Prevents logo flash / re-download on every page
 */
(function () {
  if (window.__orbitAssetsLoaded) return;
  window.__orbitAssetsLoaded = true;

  var DB_NAME = "orbit_asset_cache";
  var STORE = "blobs";
  var LOGO_KEY = "logo_v4_orbit";
  var LOGO_SRC = "orbit-bills-logo.png";

  function openDb() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function fetchAndCacheLogo() {
    try {
      var res = await fetch(LOGO_SRC, { cache: "no-cache" });
      if (!res.ok) throw new Error("logo fetch " + res.status);
      var blob = await res.blob();
      var dataUrl = await blobToDataUrl(blob);
      try { await idbSet(LOGO_KEY, dataUrl); } catch (e) {}
      try { localStorage.setItem(LOGO_KEY, dataUrl.length < 4000000 ? dataUrl : ""); } catch (e) {}
      return dataUrl;
    } catch (e) {
      return LOGO_SRC;
    }
  }

  async function getLogoUrl() {
    // Purge legacy logo cache keys (old brand)
    try {
      localStorage.removeItem("logo_v1");
      localStorage.removeItem("logo_v2");
    } catch (e) {}
    // 1) memory
    if (window.__orbitLogoDataUrl) return window.__orbitLogoDataUrl;
    // 2) localStorage (fast path) — only logo_v3
    try {
      var ls = localStorage.getItem(LOGO_KEY);
      if (ls && ls.indexOf("data:") === 0) {
        window.__orbitLogoDataUrl = ls;
        return ls;
      }
    } catch (e) {}
    // 3) IndexedDB
    try {
      var idb = await idbGet(LOGO_KEY);
      if (idb && typeof idb === "string" && idb.indexOf("data:") === 0) {
        window.__orbitLogoDataUrl = idb;
        try { localStorage.setItem(LOGO_KEY, idb.length < 4000000 ? idb : ""); } catch (e) {}
        return idb;
      }
    } catch (e) {}
    // 4) network once, then cache
    var url = await fetchAndCacheLogo();
    window.__orbitLogoDataUrl = url;
    return url;
  }

  function applyLogoToImgs(url) {
    if (!url) return;
    // OrbitBills logo only on marked images (login / splash). In-app logo.png stays TechSerenia.
    var imgs = document.querySelectorAll('img[data-orbit-logo], img.orbit-logo, img[src="orbit-bills-logo.png"], img[src="./orbit-bills-logo.png"]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute("data-orbit-logo-applied") === "1") continue;
      img.setAttribute("data-orbit-logo-applied", "1");
      img.src = url;
      img.decoding = "async";
    }
  }

  window.__orbitGetLogoUrl = getLogoUrl;
  window.__orbitApplyLogos = function () {
    getLogoUrl().then(applyLogoToImgs).catch(function () {});
  };

  // Auto-apply as early as possible
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.__orbitApplyLogos();
    });
  } else {
    window.__orbitApplyLogos();
  }
  // Re-apply when new images appear (menus, etc.)
  setTimeout(function () { window.__orbitApplyLogos(); }, 400);
  setTimeout(function () { window.__orbitApplyLogos(); }, 1200);
})();
