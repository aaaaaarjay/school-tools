const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbyeW0sn-UwAxkK_7kztXLAFiDku3IAJs1qCcsmrTGYnIyCOEbvEv4faSIVBuMiw1RPTDw/exec';

// SCHOOL coordinates (must match Code.gs)
const SCHOOL_LAT = 10.2943724;
const SCHOOL_LON = 123.8960114;
const GEOFENCE_M = 100;

function show(msg, ok) { const el = document.getElementById('message'); el.textContent = msg; el.style.color = ok ? '#5dde82' : '#ff8a9e'; }

async function sha256Hex(str) { const enc = new TextEncoder(); const buf = await crypto.subtle.digest('SHA-256', enc.encode(str)); return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }

async function getFingerprint() { try { const nav = navigator; const data = [nav.userAgent, nav.language, nav.platform, nav.hardwareConcurrency || '', screen.width, screen.height, screen.colorDepth || '', Intl.DateTimeFormat().resolvedOptions().timeZone || ''].join('||'); return await sha256Hex(data); } catch (e) { return 'unknown'; } }

function haversine(lat1, lon1, lat2, lon2) { function toRad(d) { return d * Math.PI / 180; } const R = 6371000; const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1); const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c; }

/* =========================
   PC BLOCKER & COOLDOWN LOGIC
========================= */

// Block Desktop PCs based on window dimensions and user agent hints
function checkPCBlocker() {
  const isMobileSize = window.innerWidth <= 768; // standard tablet/mobile max width
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileString = /android|webos|iphone|ipad|ipod|blackberry|windows phone/.test(userAgent);
  
  // If it's a large screen and not a touch device, or fails mobile string checks, block it
  if (!isMobileSize && !isTouch && !isMobileString) {
    document.getElementById('desktopBlocker').style.display = 'flex';
  } else {
    document.getElementById('desktopBlocker').style.display = 'none';
  }
}

// Lock the UI physically with the cooldown overlay
let countdownInterval = null;
function lockDeviceScreen(name, expireTimeMs) {
  const overlay = document.getElementById('cooldownOverlay');
  const nameEl = document.getElementById('cooldownName');
  const timerEl = document.getElementById('cooldownTimer');
  
  overlay.style.display = 'flex';
  if (name) nameEl.textContent = name;
  
  if (countdownInterval) clearInterval(countdownInterval);
  
  countdownInterval = setInterval(() => {
    const now = Date.now();
    const remaining = expireTimeMs - now;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      overlay.style.display = 'none';
      localStorage.removeItem('attendance_lock_expire');
      localStorage.removeItem('attendance_lock_name');
    } else {
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      timerEl.textContent = minutes + "m " + seconds + "s remaining";
    }
  }, 1000);
}

// Check local storage for an existing active lock on startup
function checkCooldown() {
  const expire = localStorage.getItem('attendance_lock_expire');
  const name = localStorage.getItem('attendance_lock_name');
  if (expire) {
    const expireTime = parseInt(expire, 10);
    if (Date.now() < expireTime) {
      lockDeviceScreen(name, expireTime);
    } else {
      localStorage.removeItem('attendance_lock_expire');
      localStorage.removeItem('attendance_lock_name');
    }
  }
}

// Initialize checks
window.addEventListener('load', () => {
    checkPCBlocker();
    checkCooldown();
});
window.addEventListener('resize', checkPCBlocker);

// Map state (Leaflet)
let map = null;
let userMarker = null;
let schoolMarker = null;
let geofenceCircle = null;
let coordsEl = null;
let distanceEl = null;

function createMap() {
  try {
    if (typeof L === 'undefined') return;
    if (map) return;
    map = L.map('map', { center: [SCHOOL_LAT, SCHOOL_LON], zoom: 16, preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    schoolMarker = L.marker([SCHOOL_LAT, SCHOOL_LON]).addTo(map).bindPopup('School').openPopup();
    geofenceCircle = L.circle([SCHOOL_LAT, SCHOOL_LON], { radius: GEOFENCE_M, color: '#38bdf8', weight: 1, fill: false }).addTo(map);
    coordsEl = document.getElementById('coords');
    distanceEl = document.getElementById('distance');

    const locateBtn = document.getElementById('locateBtn');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
        locateBtn.disabled = true;
        navigator.geolocation.getCurrentPosition((p) => {
          updateUserLocation(p.coords.latitude, p.coords.longitude);
          locateBtn.disabled = false;
        }, (err) => { alert('Location error: ' + (err.message || err.code)); locateBtn.disabled = false; }, { enableHighAccuracy: true, timeout: 10000 });
      });
    }
  } catch (e) {
    console.warn('createMap error', e);
  }
}

function updateUserLocation(lat, lon) {
  try {
    if (typeof L === 'undefined') return;
    if (!map) createMap();
    if (!map) return;
    if (!userMarker) {
      userMarker = L.marker([lat, lon]).addTo(map).bindPopup('You');
    } else {
      userMarker.setLatLng([lat, lon]);
    }
    if (coordsEl) coordsEl.textContent = 'Lat: ' + lat.toFixed(6) + ', Lon: ' + lon.toFixed(6);
    const d = Math.round(haversine(lat, lon, SCHOOL_LAT, SCHOOL_LON));
    if (distanceEl) {
      distanceEl.textContent = 'Distance: ' + d + ' m';
      distanceEl.style.color = d <= GEOFENCE_M ? '#5dde82' : '#ff8a9e';
    }
    try {
      const bounds = L.latLngBounds([[lat, lon], [SCHOOL_LAT, SCHOOL_LON]]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
    } catch (e) { }
  } catch (err) {
    console.warn('updateUserLocation error', err);
  }
}

document.getElementById('submitBtn').addEventListener('click', async function (ev) {
  ev.preventDefault(); const btn = ev.target; const name = document.getElementById('fullName').value.trim(); if (!name) { show('Enter your full name'); return; } btn.disabled = true; show('Getting location...');
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
    const lat = pos.coords.latitude; const lon = pos.coords.longitude;
    try { updateUserLocation(lat, lon); } catch (e) { }
    const dist = haversine(lat, lon, SCHOOL_LAT, SCHOOL_LON);
    console.log('Computed distance (m):', dist, 'GEOFENCE_M:', GEOFENCE_M, 'SCHOOL_LAT/LON:', SCHOOL_LAT, SCHOOL_LON);
    const rounded = Math.round(dist);
    if (dist > GEOFENCE_M) { show('Outside School — ' + rounded + ' m away'); btn.disabled = false; return; }
    const fingerprint = await getFingerprint(); show('Submitting...');
    // Prefer JSONP submission (works reliably with Apps Script deployments). If it fails, try POST as a fallback.
    try {
      const json = await tryJsonpSubmit(name, lat, lon, fingerprint);
      if (json && json.success) {
        show('Confirmed: ' + (json.student || name), true);
        
        // 1 Hour Lockout
        const expireTime = Date.now() + (60 * 60 * 1000); 
        localStorage.setItem('attendance_lock_expire', expireTime.toString());
        localStorage.setItem('attendance_lock_name', json.student || name);
        lockDeviceScreen(json.student || name, expireTime);

      } else if (json && json.message) {
        show(json.message);
        
        // If backend returned Device Blocked, enforce block on frontend too
        if (json.message.includes('Blocked')) {
            const expireTime = Date.now() + (60 * 60 * 1000);
            localStorage.setItem('attendance_lock_expire', expireTime.toString());
            localStorage.setItem('attendance_lock_name', name);
            lockDeviceScreen(name, expireTime);
        }
      } else {
        show('Submission failed');
      }
    } catch (err) {
      console.warn('JSONP submit failed, attempting POST fallback', err);
      show('JSONP submit failed; attempting direct POST (may still fail due to CORS).');
      try {
        const backendUrl = localStorage.getItem('attendance_backend_url') || BACKEND_URL;
        const form = new URLSearchParams();
        form.set('action', 'submit_attendance');
        form.set('name', name);
        form.set('lat', lat);
        form.set('lon', lon);
        form.set('fingerprint', fingerprint);
        const res = await fetch(backendUrl, { method: 'POST', body: form });
        let json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        
        if (json && json.success) {
            show('Confirmed: ' + (json.student || name), true);
            const expireTime = Date.now() + (60 * 60 * 1000); 
            localStorage.setItem('attendance_lock_expire', expireTime.toString());
            localStorage.setItem('attendance_lock_name', json.student || name);
            lockDeviceScreen(json.student || name, expireTime);
        } else if (json && json.message) {
            show(json.message);
            if (json.message.includes('Blocked')) {
                const expireTime = Date.now() + (60 * 60 * 1000);
                localStorage.setItem('attendance_lock_expire', expireTime.toString());
                localStorage.setItem('attendance_lock_name', name);
                lockDeviceScreen(name, expireTime);
            }
        } else {
            show('Submission failed (POST)');
        }
      } catch (postErr) {
        console.error('POST fallback failed', postErr);
        show('Failed to reach backend; attendance not submitted. Ask admin to verify deployment and backend URL.');
      }
    }
  } catch (err) { show('Error: ' + (err.message || err)); }
  finally { btn.disabled = false; }
});

/* JSONP fallback for student submit */
function tryJsonpSubmit(name, lat, lon, fingerprint) {
  return new Promise((resolve, reject) => {
    const backendUrl = localStorage.getItem('attendance_backend_url') || BACKEND_URL;
    if (!backendUrl || backendUrl.includes('PASTE')) { return reject(new Error('Backend URL not configured')); }

    const attempts = 3;
    const delay = 700;
    let attemptNum = 0;

    function doAttempt() {
      attemptNum++;
      const cb = '__stu_cb_' + Math.random().toString(36).slice(2, 9);
      let called = false;
      let timeoutId = null;
      let script = null;

      window[cb] = function (data) {
        called = true;
        try { if (timeoutId) clearTimeout(timeoutId); resolve(data); } finally { try { delete window[cb]; } catch (e) { } if (script && script.parentNode) script.parentNode.removeChild(script); }
      };

      const url = new URL(backendUrl);
      url.searchParams.set('action', 'submit_attendance');
      url.searchParams.set('name', name);
      url.searchParams.set('lat', lat);
      url.searchParams.set('lon', lon);
      url.searchParams.set('fingerprint', fingerprint);
      url.searchParams.set('callback', cb);

      script = document.createElement('script');
      script.src = url.toString();
      script.onerror = function () {
        try { delete window[cb]; } catch (e) { }
        if (script && script.parentNode) script.parentNode.removeChild(script);
        if (attemptNum < attempts) setTimeout(doAttempt, delay);
        else reject(new Error('JSONP load error'));
      };

      // timeout if no callback invoked (likely HTML sign-in page or not accessible anonymously)
      timeoutId = setTimeout(() => {
        if (!called) {
          try { delete window[cb]; } catch (e) { }
          if (script && script.parentNode) script.parentNode.removeChild(script);
          if (attemptNum < attempts) setTimeout(doAttempt, delay);
          else reject(new Error('JSONP timeout'));
        }
      }, 10000);

      document.body.appendChild(script);
    }

    doAttempt();
  });
}

// per-device backend input removed from UI (clients use built-in placeholder or admin-configured URL)

// initialize map after script loads — wait for Leaflet to be available
(function initMapWhenReady() {
  if (typeof L !== 'undefined') { try { createMap(); } catch (e) { console.warn('createMap init failed', e); } return; }
  var checks = 0;
  var iv = setInterval(function () {
    if (typeof L !== 'undefined') { clearInterval(iv); try { createMap(); } catch (e) { console.warn('createMap init failed', e); } return; }
    checks++;
    if (checks > 50) { clearInterval(iv); console.warn('Leaflet not available after wait'); }
  }, 200);
})();
