/* ═══════════════════════════════════════════════════
   School Tools Dashboard — Application Logic
   Auth · Routing · Sidebar · Tool Loader
   ═══════════════════════════════════════════════════ */

// ── Tool Registry ──
const TOOLS = [
  {
    id: 'attendance',
    name: 'Attendance System',
    description: 'Upload Excel rosters, mark attendance, track check-ins in real time, and download updated files.',
    icon: 'fas fa-calendar-check',
    iconClass: 'tool-icon-emerald',
    path: 'tools/attendance/attendance.html',
    category: 'tracking'
  },
  {
    id: 'failed-report',
    name: 'Failed Report',
    description: 'Generate comprehensive narrative reports for failed students with intervention tracking.',
    icon: 'fas fa-triangle-exclamation',
    iconClass: 'tool-icon-amber',
    path: 'tools/failed-report/index.html',
    category: 'reports'
  },
  {
    id: 'grade-viewer',
    name: 'Grade Viewer',
    description: 'Upload Excel grade sheets and instantly search and view individual student grades.',
    icon: 'fas fa-graduation-cap',
    iconClass: 'tool-icon-blue',
    path: 'tools/grade-viewer/grade-viewer.html',
    category: 'grades'
  },
  {
    id: 'online-quiz',
    name: 'Online Quiz',
    description: 'Create quizzes with real-time monitoring, anti-cheat detection, and Excel export.',
    icon: 'fas fa-circle-question',
    iconClass: 'tool-icon-purple',
    path: 'http://localhost:3000',
    category: 'assessment',
    isExternal: true
  },
  {
    id: 'schedule-admin',
    name: 'Schedule Manager',
    description: 'Admin panel for generating time slots, managing bookings, and auto-cleanup of expired schedules.',
    icon: 'fas fa-clock',
    iconClass: 'tool-icon-cyan',
    path: 'scheduler/index.html',
    category: 'scheduling',
    isScheduleAdmin: true
  },
  {
    id: 'student-score',
    name: 'Student Score',
    description: 'Upload rosters, create score columns, record and export student scores by section.',
    icon: 'fas fa-chart-column',
    iconClass: 'tool-icon-rose',
    path: 'tools/student-score/student-score.html',
    category: 'grades'
  }
];

// ── Credentials (SHA-256 hashed — plaintext never stored) ──
const INITIAL_USERS = [
  {
    usernameHash: 'c3b09db2eb5a5d3af2f7c9753621616316c31a8bcd3ee6b0b035c01204da26d7',
    passwordHash: '3af1465c4bf99543fdd252a3d1efa742edb5009a32a808a57e26743e57d8c6c8',
    role: 'admin',
    displayName: 'Administrawr',
    avatar: null
  }
];

const AUTH_KEY = 'schooltools_auth';
const USERS_KEY = 'schooltools_users';
const SIDEBAR_KEY = 'schooltools_sidebar';
const LAST_TOOL_KEY = 'schooltools_last_tool';
const THEME_KEY = 'schooltools_theme';

// ── State ──
let currentUser = null;
let currentTool = null;
let sidebarCollapsed = false;

// ══════════════════════════════════════════════════
// AUTHENTICATION
// ══════════════════════════════════════════════════

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getUsers() {
  const saved = localStorage.getItem(USERS_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  // First run: seed with initial users
  localStorage.setItem(USERS_KEY, JSON.stringify(INITIAL_USERS));
  return [...INITIAL_USERS];
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function initAuth() {
  const saved = localStorage.getItem(AUTH_KEY);
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showDashboard();
      return;
    } catch (e) {
      localStorage.removeItem(AUTH_KEY);
    }
  }
  showLogin();
}

async function login(username, password) {
  const userHash = await sha256(username);
  const passHash = await sha256(password);

  const users = getUsers();
  const user = users.find(
    u => u.usernameHash === userHash && u.passwordHash === passHash
  );

  if (!user) {
    return false;
  }

  currentUser = {
    usernameHash: userHash,
    username: userHash.substring(0, 8),
    role: user.role,
    displayName: user.displayName,
    avatar: user.avatar || null,
    loginTime: Date.now()
  };

  localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
  return true;
}

function logout() {
  currentUser = null;
  currentTool = null;
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(LAST_TOOL_KEY);
  showLogin();
}

// ══════════════════════════════════════════════════
// VIEW SWITCHING
// ══════════════════════════════════════════════════

function showLogin() {
  const loginScreen = document.getElementById('loginScreen');
  const dashboard = document.getElementById('dashboard');

  loginScreen.classList.remove('hidden');
  dashboard.classList.remove('active');

  // Reset form
  const form = document.getElementById('loginForm');
  if (form) form.reset();
  hideLoginError();

  // Focus username
  setTimeout(() => {
    const input = document.getElementById('loginUsername');
    if (input) input.focus();
  }, 300);
}

function showDashboard() {
  const loginScreen = document.getElementById('loginScreen');
  const dashboard = document.getElementById('dashboard');

  loginScreen.classList.add('hidden');
  dashboard.classList.add('active');

  // Render
  renderNavbar();
  renderSidebar();

  // Restore the last view from the URL hash (or fall back to home)
  const hash = location.hash.replace('#', '');
  const savedTool = hash || localStorage.getItem(LAST_TOOL_KEY);
  if (savedTool && TOOLS.find(t => t.id === savedTool)) {
    loadTool(savedTool);
  } else {
    renderHome();
  }

  // Restore sidebar state
  const savedSidebar = localStorage.getItem(SIDEBAR_KEY);
  if (savedSidebar === 'collapsed') {
    sidebarCollapsed = true;
    document.body.classList.add('sidebar-collapsed');
  }
}

// ══════════════════════════════════════════════════
// LOGIN UI
// ══════════════════════════════════════════════════

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showLoginError('Please enter both username and password.');
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  // Small delay for UX, then authenticate with hashed comparison
  await new Promise(r => setTimeout(r, 400));

  const success = await login(username, password);
  if (success) {
    showDashboard();
  } else {
    showLoginError('Invalid username or password.');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.add('show');
}

function hideLoginError() {
  const el = document.getElementById('loginError');
  if (el) {
    el.classList.remove('show');
  }
}

// ══════════════════════════════════════════════════
// NAVBAR
// ══════════════════════════════════════════════════

function renderNavbar() {
  if (!currentUser) return;

  const initials = currentUser.displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const avatarEl = document.getElementById('navAvatar');
  if (currentUser.avatar) {
    avatarEl.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } else {
    avatarEl.textContent = initials;
  }
  document.getElementById('navUsername').textContent = currentUser.displayName;
  document.getElementById('navRole').textContent = currentUser.role;
}

function updateBreadcrumb(toolName) {
  const breadcrumb = document.getElementById('navBreadcrumb');
  if (!toolName) {
    breadcrumb.innerHTML = '<span class="navbar-breadcrumb-current">Dashboard</span>';
  } else {
    breadcrumb.innerHTML = `
      <span class="navbar-breadcrumb-home" style="cursor:pointer" onclick="navigateHome()">Dashboard</span>
      <span class="navbar-breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>
      <span class="navbar-breadcrumb-current">${toolName}</span>
    `;
  }
}

// ══════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════

function renderSidebar() {
  const nav = document.getElementById('sidebarNav');

  let html = '';

  // Home item
  html += `
    <div class="sidebar-item active" data-tool="home" data-tooltip="Dashboard" onclick="navigateHome()">
      <div class="sidebar-item-icon" style="color: var(--primary-light);">
        <i class="fas fa-house"></i>
      </div>
      <span class="sidebar-item-text">Dashboard</span>
    </div>
  `;

  html += '<div class="sidebar-section-label">Tools</div>';

  TOOLS.forEach(tool => {
    html += `
      <div class="sidebar-item" data-tool="${tool.id}" data-tooltip="${tool.name}" onclick="loadTool('${tool.id}')">
        <div class="sidebar-item-icon ${tool.iconClass}">
          <i class="${tool.icon}"></i>
        </div>
        <span class="sidebar-item-text">${tool.name}</span>
      </div>
    `;
  });

  nav.innerHTML = html;
}

function setActiveSidebarItem(toolId) {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.tool === toolId) {
      item.classList.add('active');
    }
  });
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? 'collapsed' : 'expanded');
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('mobile-open');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('mobile-open');
}

// ══════════════════════════════════════════════════
// HOME VIEW
// ══════════════════════════════════════════════════

function renderHome() {
  currentTool = null;
  setActiveSidebarItem('home');
  updateBreadcrumb(null);

  // Clear hash and last tool when navigating home
  history.replaceState(null, '', location.pathname + location.search);
  localStorage.removeItem(LAST_TOOL_KEY);

  const homeView = document.getElementById('homeView');
  const toolView = document.getElementById('toolView');
  const settingsView = document.getElementById('settingsView');

  homeView.style.display = 'block';
  toolView.classList.remove('active');
  if (settingsView) settingsView.style.display = 'none';

  // Destroy previous iframe
  const iframe = document.getElementById('toolIframe');
  if (iframe) iframe.src = 'about:blank';

  // Greeting
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';

  document.getElementById('homeGreeting').textContent =
    `${greeting}, ${currentUser.displayName}`;

  // Render cards
  renderToolCards();
}

function renderToolCards(filter = '') {
  const grid = document.getElementById('toolsGrid');
  const filtered = TOOLS.filter(t =>
    t.name.toLowerCase().includes(filter.toLowerCase()) ||
    t.description.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
        <p>No tools found matching "${filter}"</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(tool => `
    <div class="tool-card" onclick="loadTool('${tool.id}')" id="card-${tool.id}">
      <div class="tool-card-icon ${tool.iconClass}">
        <i class="${tool.icon}"></i>
      </div>
      <h3>${tool.name}</h3>
      <p>${tool.description}</p>
      <div class="tool-card-arrow">
        <i class="fas fa-arrow-right"></i>
      </div>
    </div>
  `).join('');
}

function navigateHome() {
  renderHome();
  closeMobileSidebar();
}

// ══════════════════════════════════════════════════
// TOOL LOADING
// ══════════════════════════════════════════════════

function loadTool(toolId) {
  const tool = TOOLS.find(t => t.id === toolId);
  if (!tool) return;

  currentTool = tool;
  setActiveSidebarItem(toolId);
  updateBreadcrumb(tool.name);
  closeMobileSidebar();

  const homeView = document.getElementById('homeView');
  const toolView = document.getElementById('toolView');
  const settingsView = document.getElementById('settingsView');
  const loader = document.getElementById('toolLoader');
  const iframe = document.getElementById('toolIframe');

  // Switch views
  homeView.style.display = 'none';
  if (settingsView) settingsView.style.display = 'none';
  toolView.classList.add('active');

  // Show loader
  loader.classList.remove('hidden');
  document.getElementById('toolLoaderText').textContent = `Loading ${tool.name}...`;

  // Load iframe
  iframe.src = tool.path;

  iframe.onload = () => {
    // Hide loader after a tiny delay for smooth transition
    setTimeout(() => {
      loader.classList.add('hidden');
    }, 300);

    // If this is the schedule admin tool, auto-switch to admin panel
    if (tool.isScheduleAdmin) {
      autoSwitchScheduleAdmin(iframe);
    }

    // Try to hide "Back to Portfolio" links inside iframe
    hideBackLinks(iframe);

    // Inject dashboard theme into iframe
    injectThemeStyles(iframe);
  };

  iframe.onerror = () => {
    loader.classList.add('hidden');
    document.getElementById('toolLoaderText').textContent = 'Failed to load tool.';
  };

  // Save last tool and update URL hash
  localStorage.setItem(LAST_TOOL_KEY, toolId);
  history.replaceState(null, '', '#' + toolId);
}

async function autoSwitchScheduleAdmin(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

    // Hide the client view
    const clientView = iframeDoc.getElementById('view-client');
    if (clientView) clientView.classList.remove('active');

    // Hide the login view
    const loginView = iframeDoc.getElementById('view-admin-login');
    if (loginView) loginView.classList.remove('active');

    // Show the admin panel
    const adminPanel = iframeDoc.getElementById('view-admin-panel');
    if (adminPanel) adminPanel.classList.add('active');

    // Set admin as logged in within the iframe's context
    if (iframe.contentWindow) {
      iframe.contentWindow.isAdminLoggedIn = true;
    }

    // Hide the admin toggle button (not needed in dashboard)
    const toggleBtn = iframeDoc.getElementById('admin-toggle-btn');
    if (toggleBtn) toggleBtn.style.display = 'none';

    // Hide the back button
    const backBtn = iframeDoc.querySelector('.back-btn');
    if (backBtn) backBtn.style.display = 'none';

    // Update auto-cleanup toggle state
    const cleanupToggle = iframeDoc.getElementById('auto-cleanup-toggle');
    if (cleanupToggle && iframe.contentWindow.autoCleanupEnabled !== undefined) {
      cleanupToggle.checked = iframe.contentWindow.autoCleanupEnabled;
    }

    // Wait for schedule data to be loaded before populating preview
    if (iframe.contentWindow.scheduleReady) {
      await iframe.contentWindow.scheduleReady;
    }

    // Trigger admin preview population
    if (iframe.contentWindow.populateAdminPreview) {
      iframe.contentWindow.populateAdminPreview();
    }
  } catch (e) {
    // Cross-origin restriction — will happen if served from different origins
    console.warn('Could not auto-switch scheduler to admin view (cross-origin):', e.message);
  }
}

function hideBackLinks(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const backLinks = iframeDoc.querySelectorAll('.back-btn, a[href*="index.html"]');
    backLinks.forEach(link => {
      // Only hide links that look like "Back to Portfolio" navigation
      const text = (link.textContent || '').toLowerCase();
      if (text.includes('back') || text.includes('portfolio')) {
        link.style.display = 'none';
      }
    });
  } catch (e) {
    // Cross-origin — silently ignore
  }
}

// ══════════════════════════════════════════════════
// IFRAME THEME INJECTION
// ══════════════════════════════════════════════════

function getThemeCSS() {
  const isLight = document.body.classList.contains('light');

  // ── Shared base: layout, containers, structure ──
  const base = `
    /* ═══ FONT ═══ */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

    /* ═══ REMOVE TOOL CONTAINERS ═══ */
    .tool-container {
      max-width: 100% !important;
      width: 100% !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: transparent !important;
      margin: 0 !important;
      padding: 28px 32px !important;
    }

    /* ═══ BODY FILLS SPACE ═══ */
    html, body {
      font-family: 'Inter', 'Segoe UI', sans-serif !important;
      min-height: 100vh !important;
      display: block !important;
      align-items: initial !important;
      justify-content: initial !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow-x: hidden !important;
    }

    /* ═══ BACKGROUND GRADIENT ORBS ═══ */
    body::before, body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
    }
    body::before {
      width: 500px; height: 500px;
      top: -150px; right: -80px;
      filter: blur(80px);
    }
    body::after {
      width: 400px; height: 400px;
      bottom: -120px; left: -60px;
      filter: blur(80px);
    }
    body > * { position: relative; z-index: 1; }

    /* ═══ HIDE BACK-TO-PORTFOLIO LINKS ═══ */
    .back-btn, a[href*="index.html"] {
      display: none !important;
    }

    /* ═══ HEADER ═══ */
    .tool-header {
      text-align: center !important;
      margin-bottom: 24px !important;
      padding-bottom: 16px !important;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .tool-header h1 {
      font-size: 1.6rem !important;
      font-weight: 800 !important;
      letter-spacing: -0.02em !important;
    }
    .tool-header p {
      font-size: 0.88rem !important;
      margin-top: 4px !important;
    }

    /* ═══ SECTION BOXES → GLASS CARDS ═══ */
    .section-box, .auth-card, .card, .section, .admin-panel {
      border-radius: 14px !important;
      padding: 22px !important;
      margin-bottom: 16px !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      transition: border-color 0.25s ease !important;
    }

    /* ═══ INPUTS ═══ */
    input, select, textarea {
      border-radius: 10px !important;
      padding: 12px 14px !important;
      font-family: 'Inter', sans-serif !important;
      font-size: 0.92rem !important;
      outline: none !important;
      transition: all 0.25s ease !important;
    }
    input:focus, select:focus, textarea:focus {
      border-color: #6366f1 !important;
      box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
    }
    input::placeholder, textarea::placeholder {
      opacity: 0.5 !important;
    }

    /* ═══ BUTTONS → INDIGO/VIOLET ═══ */
    .action-btn, button {
      border-radius: 10px !important;
      font-family: 'Inter', sans-serif !important;
      font-weight: 600 !important;
      transition: all 0.25s ease !important;
      cursor: pointer !important;
    }

    /* Primary gradient buttons */
    .upload-btn, .btn-upload, .btn-primary, .btn-primary-full,
    .save-btn, .copy-btn, .btn-persist-save, 
    button.bg-primary, button#btnUpdate {
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      color: white !important;
      border: none !important;
    }
    .upload-btn:hover, .btn-upload:hover, .btn-primary:hover,
    .btn-primary-full:hover, .save-btn:hover, .copy-btn:hover,
    .btn-persist-save:hover, button.bg-primary:hover, button#btnUpdate:hover {
      box-shadow: 0 6px 24px rgba(99,102,241,0.35) !important;
      transform: translateY(-2px) !important;
    }

    /* Green/success buttons */
    .download-btn, .btn-save, .btn-template {
      background: linear-gradient(135deg, #22c55e, #16a34a) !important;
      color: white !important;
      border: none !important;
    }
    .download-btn:hover, .btn-save:hover, .btn-template:hover {
      box-shadow: 0 6px 24px rgba(34,197,94,0.3) !important;
    }

    /* Red/danger buttons */
    .clear-btn, .btn-danger, .btn-persist-reset {
      background: linear-gradient(135deg, #ef4444, #dc2626) !important;
      color: white !important;
      border: none !important;
    }

    /* Export buttons */
    .btn-export, .download-file-btn {
      background: linear-gradient(135deg, #8b5cf6, #a78bfa) !important;
      color: white !important;
      border: none !important;
    }

    /* Secondary / Transparent buttons */
    button.bg-surface-container, button.bg-transparent:not(.result-btn) {
      background: rgba(128, 128, 128, 0.1) !important;
      border: 1px solid rgba(128, 128, 128, 0.2) !important;
    }
    button.bg-surface-container:hover, button.bg-transparent:not(.result-btn):hover {
      background: rgba(128, 128, 128, 0.2) !important;
      transform: translateY(-2px) !important;
    }

    /* ═══ TABLES ═══ */
    .matches-table, table {
      border-collapse: collapse !important;
      width: 100% !important;
    }

    /* ═══ STUDENT CARDS ═══ */
    .student-card {
      border-radius: 10px !important;
      transition: all 0.2s ease !important;
    }
    .student-card:hover {
      border-color: #6366f1 !important;
    }
    .student-card.active {
      border-color: #22c55e !important;
      background: rgba(34,197,94,0.12) !important;
    }

    /* ═══ SECTION BUTTONS ═══ */
    .section-btn.active {
      border-color: #6366f1 !important;
      background: rgba(99,102,241,0.12) !important;
      color: #818cf8 !important;
    }

    /* ═══ SEARCH ═══ */
    .search-input {
      backdrop-filter: blur(8px) !important;
    }
    .search-input:focus {
      border-color: #6366f1 !important;
    }

    /* ═══ TIME SLOTS (Scheduler) ═══ */
    .time-slot {
      border-radius: 12px !important;
      transition: all 0.25s ease !important;
    }

    /* ═══ TOGGLE SWITCH ═══ */
    .toggle-switch input:checked + .toggle-slider {
      background-color: #6366f1 !important;
    }

    /* ═══ STATUS DOTS ═══ */
    .status-dot.on { background: #22c55e !important; }
    .status-dot.error { background: #ef4444 !important; }

    /* ═══ SCORE BADGE ═══ */
    .score-badge {
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      color: white !important;
    }

    /* ═══ SCROLLBAR ═══ */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }

    /* ═══ HIDE HEADER CONTROLS DEBUG ═══ */
    #backendDebugContainer { display: none !important; }

    /* ═══ TOAST NOTIFICATIONS ═══ */
    .toast { border-radius: 12px !important; }
    .toast-success { background: linear-gradient(135deg, #22c55e, #16a34a) !important; }
    .toast-error { background: linear-gradient(135deg, #ef4444, #dc2626) !important; }

    /* ═══ FAILED REPORT (Tailwind overrides) ═══ */
    [class*="bg-primary-container"] { background-color: rgba(99,102,241,0.15) !important; }
    [class*="bg-surface"], [class*="bg-background"] { background: transparent !important; }
    [class*="border-outline-variant"] { border-color: rgba(255,255,255,0.08) !important; }
    [class*="text-on-primary-container"] { color: #818cf8 !important; }
  `;

  // ── Dark mode specifics ──
  if (!isLight) {
    return base + `
      html, body {
        background: #0a0a1a !important;
        color: #f1f5f9 !important;
      }
      body::before {
        background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%) !important;
      }
      body::after {
        background: radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%) !important;
      }

      /* Tool container bg */
      .tool-container {
        background: transparent !important;
      }

      /* Header */
      .tool-header { border-bottom-color: rgba(255,255,255,0.06) !important; }
      .tool-header h1 { color: #f1f5f9 !important; }
      .tool-header h1 i { color: #818cf8 !important; }
      .tool-header p { color: #94a3b8 !important; }

      /* Glass sections */
      .section-box, .auth-card, .card, .section, .admin-panel {
        background: rgba(255,255,255,0.04) !important;
        border: 1px solid rgba(255,255,255,0.08) !important;
      }
      .section-box:hover, .card:hover {
        border-color: rgba(255,255,255,0.14) !important;
      }
      .section-box h2, .section-box h3, .auth-card h2 { color: #f1f5f9 !important; }
      .section-box h2 i, .section-box h3 i, .auth-card h2 i { color: #818cf8 !important; }
      .hint { color: #64748b !important; }

      /* Text */
      h1, h2, h3, h4, h5, h6 { color: #f1f5f9 !important; }
      p, span, label, li, div { color: #cbd5e1 !important; }
      a { color: #818cf8 !important; }

      /* Inputs */
      html body input, html body select, html body textarea,
      html body input[class], html body select[class], html body textarea[class] {
        background: rgba(255,255,255,0.05) !important;
        color: #f1f5f9 !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
      }
      html body input::placeholder, html body textarea::placeholder,
      html body input[class]::placeholder, html body textarea[class]::placeholder { color: #475569 !important; }

      /* Generic action buttons (non-gradient fallback) */
      .action-btn {
        background: rgba(255,255,255,0.06) !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        color: #e2e8f0 !important;
      }
      .action-btn:hover {
        background: rgba(255,255,255,0.1) !important;
        border-color: rgba(255,255,255,0.15) !important;
      }

      /* Student cards */
      .student-card {
        background: rgba(255,255,255,0.04) !important;
        border-color: rgba(255,255,255,0.08) !important;
        color: #e2e8f0 !important;
      }

      /* Section buttons */
      .section-btn, .section-buttons button {
        background: rgba(255,255,255,0.04) !important;
        border: 1px solid rgba(255,255,255,0.08) !important;
        color: #cbd5e1 !important;
      }

      /* Search */
      html body .search-input, html body .search-input[class] {
        background: rgba(255,255,255,0.05) !important;
        border-color: rgba(255,255,255,0.1) !important;
        color: #f1f5f9 !important;
      }
      .search-results, .search-result-item, .live-item {
        background: rgba(255,255,255,0.04) !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      .search-result-item:hover, .live-item:hover {
        background: rgba(99,102,241,0.08) !important;
        border-color: #6366f1 !important;
      }

      /* Tables */
      table, th, td { border-color: rgba(255,255,255,0.06) !important; }
      th { background: rgba(99,102,241,0.08) !important; color: #818cf8 !important; }
      td { color: #cbd5e1 !important; }
      tbody tr:hover { background: rgba(99,102,241,0.06) !important; }
      tbody tr.selected { background: rgba(99,102,241,0.1) !important; border-left-color: #6366f1 !important; }

      /* Score inputs */
      .score-input-row, .score-col-row, .student-info, .group-item {
        background: rgba(255,255,255,0.04) !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      .score-row-input, .score-col-label-input {
        background: rgba(255,255,255,0.04) !important;
        color: #f1f5f9 !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      .stat-value, .info-value.highlight, .search-result-section {
        color: #818cf8 !important;
      }

      /* Time slots */
      .time-slot {
        background: rgba(255,255,255,0.04) !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      .time-slot.available {
        border-color: rgba(34,197,94,0.4) !important;
        background: rgba(34,197,94,0.06) !important;
      }
      .time-slot.booked {
        border-color: rgba(239,68,68,0.3) !important;
        background: rgba(239,68,68,0.06) !important;
      }

      /* Scrollbar */
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }

      /* Upload stats border */
      .upload-stats { border-top-color: rgba(255,255,255,0.06) !important; }
      .info-row + .info-row { border-top-color: rgba(255,255,255,0.06) !important; }

      /* Status messages */
      .save-indicator.has-date {
        background: rgba(34,197,94,0.1) !important;
        border-color: rgba(34,197,94,0.2) !important;
      }
      .save-indicator.no-date {
        background: rgba(239,68,68,0.1) !important;
        border-color: rgba(239,68,68,0.2) !important;
      }

      /* Error messages */
      .error-msg {
        background: rgba(239,68,68,0.08) !important;
        border-color: rgba(239,68,68,0.2) !important;
        color: #fca5a5 !important;
      }

      /* Selected slot display */
      .selected-slot-display {
        background: rgba(99,102,241,0.08) !important;
        border-color: rgba(99,102,241,0.2) !important;
        color: #818cf8 !important;
      }

      /* Feature cards */
      .feature-card {
        background: rgba(255,255,255,0.04) !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      .feature-card:hover { border-color: #6366f1 !important; }
      .feature-card i { color: #818cf8 !important; }

      /* Panels scrollbar track */
      .matches-table-wrapper::-webkit-scrollbar-track,
      .left-panel::-webkit-scrollbar-track,
      .right-panel::-webkit-scrollbar-track {
        background: transparent !important;
      }
      .matches-table-wrapper::-webkit-scrollbar-thumb,
      .left-panel::-webkit-scrollbar-thumb,
      .right-panel::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.08) !important;
      }

      /* Global loader */
      #global-loader { background-color: rgba(10,10,26,0.7) !important; }
      #global-loader i { color: #6366f1 !important; }

      /* Form group labels */
      .form-group label { color: #94a3b8 !important; }

      /* Failed Report Tailwind overrides */
      div[class*="bg-surface-container"], section[class*="bg-surface-container"],
      div[class*="bg-surface-bright"], section[class*="bg-surface-bright"],
      div[class*="bg-background"], div[class*="bg-surface "] {
        background: transparent !important;
      }
      [class*="text-on-surface"], [class*="text-on-background"] { color: #e2e8f0 !important; }
      [class*="border-outline"] { border-color: rgba(255,255,255,0.08) !important; }
    `;
  }

  // ── Light mode specifics ──
  return base + `
    html, body {
      background: #f0f2f8 !important;
      color: #1e293b !important;
    }
    body::before {
      background: radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%) !important;
    }
    body::after {
      background: radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%) !important;
    }

    .tool-container {
      background: transparent !important;
    }

    /* Header */
    .tool-header { border-bottom-color: rgba(0,0,0,0.06) !important; }
    .tool-header h1 { color: #1e293b !important; }
    .tool-header h1 i { color: #6366f1 !important; }
    .tool-header p { color: #64748b !important; }

    /* Glass sections */
    .section-box, .auth-card, .card, .section, .admin-panel {
      background: rgba(255,255,255,0.6) !important;
      border: 1px solid rgba(0,0,0,0.06) !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04) !important;
    }
    .section-box h2, .section-box h3, .auth-card h2 { color: #1e293b !important; }
    .section-box h2 i, .section-box h3 i, .auth-card h2 i { color: #6366f1 !important; }
    .hint { color: #94a3b8 !important; }

    /* Text */
    h1, h2, h3, h4, h5, h6 { color: #1e293b !important; }
    p, span, label, li, div { color: #475569 !important; }
    a { color: #6366f1 !important; }

    /* Inputs */
    html body input, html body select, html body textarea,
    html body input[class], html body select[class], html body textarea[class] {
      background: rgba(0,0,0,0.03) !important;
      color: #1e293b !important;
      border: 1px solid rgba(0,0,0,0.1) !important;
    }
    html body input::placeholder, html body textarea::placeholder,
    html body input[class]::placeholder, html body textarea[class]::placeholder { color: #94a3b8 !important; }

    /* Generic action buttons */
    .action-btn {
      background: rgba(0,0,0,0.03) !important;
      border: 1px solid rgba(0,0,0,0.08) !important;
      color: #1e293b !important;
    }

    /* Student cards */
    .student-card {
      background: rgba(255,255,255,0.7) !important;
      border-color: rgba(0,0,0,0.08) !important;
      color: #1e293b !important;
    }

    /* Section buttons */
    .section-btn, .section-buttons button {
      background: rgba(255,255,255,0.6) !important;
      border: 1px solid rgba(0,0,0,0.08) !important;
      color: #475569 !important;
    }
    .section-btn.active {
      background: rgba(99,102,241,0.08) !important;
      color: #6366f1 !important;
    }

    /* Search */
    html body .search-input, html body .search-input[class] {
      background: rgba(255,255,255,0.7) !important;
      border-color: rgba(0,0,0,0.1) !important;
      color: #1e293b !important;
    }
    .search-results, .search-result-item, .live-item {
      background: rgba(255,255,255,0.7) !important;
      border-color: rgba(0,0,0,0.06) !important;
    }

    /* Tables */
    table, th, td { border-color: rgba(0,0,0,0.06) !important; }
    th { background: rgba(99,102,241,0.05) !important; color: #6366f1 !important; }
    td { color: #475569 !important; }
    tbody tr:hover { background: rgba(99,102,241,0.04) !important; }

    /* Score inputs */
    .score-input-row, .score-col-row, .student-info, .group-item {
      background: rgba(255,255,255,0.6) !important;
      border-color: rgba(0,0,0,0.06) !important;
    }
    .score-row-input, .score-col-label-input {
      background: rgba(0,0,0,0.03) !important;
      color: #1e293b !important;
    }
    .stat-value, .info-value.highlight { color: #6366f1 !important; }

    /* Time slots */
    .time-slot {
      background: rgba(255,255,255,0.6) !important;
      border-color: rgba(0,0,0,0.06) !important;
    }

    /* Scrollbar */
    ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 4px; }

    /* Feature cards */
    .feature-card {
      background: rgba(255,255,255,0.6) !important;
      border-color: rgba(0,0,0,0.06) !important;
    }
    .feature-card i { color: #6366f1 !important; }

    /* Global loader */
    #global-loader { background-color: rgba(240,242,248,0.7) !important; }
    #global-loader i { color: #6366f1 !important; }

    /* Form group labels */
    .form-group label { color: #64748b !important; }

    /* Upload stats */
    .upload-stats { border-top-color: rgba(0,0,0,0.06) !important; }
    .info-row + .info-row { border-top-color: rgba(0,0,0,0.06) !important; }

    /* Failed Report Tailwind overrides */
    div[class*="bg-surface-container"], section[class*="bg-surface-container"],
    div[class*="bg-surface-bright"], section[class*="bg-surface-bright"],
    div[class*="bg-background"], div[class*="bg-surface "] {
      background: transparent !important;
    }
    [class*="text-on-surface"], [class*="text-on-background"] { color: #1e293b !important; }
    [class*="border-outline"] { border-color: rgba(0,0,0,0.08) !important; }
  `;
}

function injectThemeStyles(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    if (!iframeDoc) return;

    // Remove a previously injected style if any
    const existing = iframeDoc.getElementById('dashboard-theme-inject');
    if (existing) existing.remove();

    const style = iframeDoc.createElement('style');
    style.id = 'dashboard-theme-inject';
    style.textContent = getThemeCSS();
    iframeDoc.head.appendChild(style);
  } catch (e) {
    // Cross-origin — silently ignore
  }
}

// ══════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════

function handleSearch(e) {
  const query = e.target.value.trim();
  if (currentTool) {
    // If currently viewing a tool, go home first
    navigateHome();
  }
  renderToolCards(query);
}

// ══════════════════════════════════════════════════
// LOGIN PARTICLES
// ══════════════════════════════════════════════════

function createParticles() {
  const container = document.getElementById('loginParticles');
  if (!container) return;

  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'login-particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDuration = (8 + Math.random() * 12) + 's';
    particle.style.animationDelay = (Math.random() * 10) + 's';
    particle.style.width = (2 + Math.random() * 4) + 'px';
    particle.style.height = particle.style.width;
    particle.style.opacity = 0.2 + Math.random() * 0.4;
    container.appendChild(particle);
  }
}

// ══════════════════════════════════════════════════
// THEME TOGGLE
// ══════════════════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light') {
    document.body.classList.add('light');
  }
}

function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');

  // Re-inject theme into active tool iframe
  const iframe = document.getElementById('toolIframe');
  if (iframe && currentTool) {
    injectThemeStyles(iframe);
  }
}

// ══════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════
// SETTINGS PANEL
// ══════════════════════════════════════════════════

function showSettings() {
  if (!currentUser) return;

  // Hide other views
  document.getElementById('homeView').style.display = 'none';
  const toolView = document.getElementById('toolView');
  toolView.style.display = ''; // Clear inline styles
  toolView.classList.remove('active');
  document.getElementById('settingsView').style.display = 'block';

  currentTool = null;
  updateBreadcrumb('Settings');
  history.replaceState(null, '', '#settings');

  // Populate current values
  document.getElementById('settingsDisplayName').value = currentUser.displayName || '';

  // Render avatar
  const avatarEl = document.getElementById('settingsAvatar');
  if (currentUser.avatar) {
    avatarEl.innerHTML = `<img src="${currentUser.avatar}">`;
  } else {
    const initials = currentUser.displayName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }

  // Clear credential fields
  document.getElementById('settingsNewUsername').value = '';
  document.getElementById('settingsNewPassword').value = '';
  document.getElementById('settingsCurrentPassword').value = '';

  // Clear add user fields
  document.getElementById('newUserUsername').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserDisplayName').value = '';

  // Render users list (admin only)
  renderUsersList();

  // Close mobile sidebar
  closeMobileSidebar();
}

function saveProfile() {
  const newName = document.getElementById('settingsDisplayName').value.trim();
  if (!newName) {
    showToast('Display name cannot be empty.', 'error');
    return;
  }

  // Update currentUser
  currentUser.displayName = newName;
  localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));

  // Update in users list
  const users = getUsers();
  const userIdx = users.findIndex(u => u.usernameHash === currentUser.usernameHash);
  if (userIdx !== -1) {
    users[userIdx].displayName = newName;
    saveUsers(users);
  }

  // Refresh navbar
  renderNavbar();
  showToast('Profile saved!', 'success');
}

function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 500000) {
    showToast('Image too large. Please use an image under 500KB.', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;

    // Update avatar in settings view
    const avatarEl = document.getElementById('settingsAvatar');
    avatarEl.innerHTML = `<img src="${base64}">`;

    // Update currentUser
    currentUser.avatar = base64;
    localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));

    // Update in users list
    const users = getUsers();
    const userIdx = users.findIndex(u => u.usernameHash === currentUser.usernameHash);
    if (userIdx !== -1) {
      users[userIdx].avatar = base64;
      saveUsers(users);
    }

    // Refresh navbar
    renderNavbar();
  };
  reader.readAsDataURL(file);
}

async function saveCredentials() {
  const currentPwd = document.getElementById('settingsCurrentPassword').value;
  const newUsername = document.getElementById('settingsNewUsername').value.trim();
  const newPassword = document.getElementById('settingsNewPassword').value;

  if (!currentPwd) {
    showToast('Please enter your current password to confirm changes.', 'warning');
    return;
  }

  if (!newUsername && !newPassword) {
    showToast('Enter a new username, new password, or both.', 'warning');
    return;
  }

  // Verify current password
  const currentPwdHash = await sha256(currentPwd);
  const users = getUsers();
  const userIdx = users.findIndex(u => u.usernameHash === currentUser.usernameHash);

  if (userIdx === -1 || users[userIdx].passwordHash !== currentPwdHash) {
    showToast('Current password is incorrect.', 'error');
    return;
  }

  // Update username hash
  if (newUsername) {
    const newUsernameHash = await sha256(newUsername);
    users[userIdx].usernameHash = newUsernameHash;
    currentUser.usernameHash = newUsernameHash;
    currentUser.username = newUsernameHash.substring(0, 8);
  }

  // Update password hash
  if (newPassword) {
    const newPasswordHash = await sha256(newPassword);
    users[userIdx].passwordHash = newPasswordHash;
  }

  saveUsers(users);
  localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));

  // Clear fields
  document.getElementById('settingsNewUsername').value = '';
  document.getElementById('settingsNewPassword').value = '';
  document.getElementById('settingsCurrentPassword').value = '';

  showToast('Credentials updated successfully!', 'success');
}

async function addUser() {
  const username = document.getElementById('newUserUsername').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const displayName = document.getElementById('newUserDisplayName').value.trim();

  if (!username || !password || !displayName) {
    showToast('Please fill in all fields (username, password, display name).', 'warning');
    return;
  }

  const usernameHash = await sha256(username);
  const passwordHash = await sha256(password);

  const users = getUsers();

  // Check for duplicate username
  if (users.find(u => u.usernameHash === usernameHash)) {
    showToast('A user with this username already exists.', 'error');
    return;
  }

  users.push({
    usernameHash,
    passwordHash,
    role: 'user',
    displayName,
    avatar: null
  });

  saveUsers(users);

  // Clear fields
  document.getElementById('newUserUsername').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserDisplayName').value = '';

  renderUsersList();
  showToast(`Teacher "${displayName}" added successfully!`, 'success');
}

function removeUser(usernameHash) {
  if (!confirm('Are you sure you want to remove this user?')) return;

  const users = getUsers().filter(u => u.usernameHash !== usernameHash);
  saveUsers(users);
  renderUsersList();
}

function renderUsersList() {
  const container = document.getElementById('usersListContainer');
  if (!container) return;

  const users = getUsers();

  if (users.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No users yet.</p>';
    return;
  }

  let html = '<h4>All Accounts</h4>';
  users.forEach(user => {
    const initials = user.displayName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const isCurrentUser = user.usernameHash === currentUser.usernameHash;
    const avatarStyle = user.role === 'admin'
      ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);'
      : 'background:linear-gradient(135deg,#22c55e,#16a34a);';

    html += `
      <div class="settings-user-item">
        <div class="settings-user-info">
          <div class="settings-user-avatar" style="${avatarStyle}">
            ${user.avatar ? `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : initials}
          </div>
          <div>
            <div class="settings-user-name">${user.displayName}${isCurrentUser ? ' (You)' : ''}</div>
            <div class="settings-user-role">${user.role}</div>
          </div>
        </div>
        ${!isCurrentUser ? `<button class="settings-user-remove" onclick="removeUser('${user.usernameHash}')"><i class="fas fa-trash"></i> Remove</button>` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
}

// ══════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-check-circle';
  if (type === 'error') icon = 'fa-circle-xmark';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  if (type === 'info') icon = 'fa-circle-info';

  toast.innerHTML = `
    <i class="fas ${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove after 3s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  createParticles();
  initAuth();

  // Login form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Search
  const searchInput = document.getElementById('navSearch');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }

  // Keyboard shortcut: Escape to go home
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentTool && currentUser) {
      navigateHome();
    }
  });

  // Handle browser back/forward navigation via hash changes
  window.addEventListener('hashchange', () => {
    if (!currentUser) return;
    const hash = location.hash.replace('#', '');
    if (hash && TOOLS.find(t => t.id === hash)) {
      loadTool(hash);
    } else {
      renderHome();
    }
  });

  // Enter key on login password field
  const pwdInput = document.getElementById('loginPassword');
  if (pwdInput) {
    pwdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleLogin(e);
      }
    });
  }
});
