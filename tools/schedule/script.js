const SHEET_ID = '17cKxYPpqYT5AzzynZ4fdmx-bmtYNKwpn6R6dfb-GAQU';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxGN9_u26s-O-goZuB34pdKb1Adv0Nghv_Zts6dSLlKXEqvYGHLJfNHNo2YNGKQLzH-6w/exec';

const SCHEDULE_SHEET = 'Schedule';
const BOOKINGS_SHEET = 'Bookings';

const SCHEDULE_KEY = 'scheduler_slots';
const BOOKINGS_KEY = 'scheduler_bookings';
const SELECTED_DATE_KEY = 'scheduler_selected_date';

let selectedSlot = null;
let scheduleByDate = {};
let uniqueDates = [];
let selectedDate = null;
let bookings = {}; // holds current bookings data
let rawScheduleGlobal = []; // Keeps track of all slots
let isAdminLoggedIn = false;
let autoCleanupEnabled = JSON.parse(localStorage.getItem('auto_cleanup') || 'false');

// ================= API =================
const FETCH_TIMEOUT_MS = 5000; // 5-second timeout for GAS requests

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
        )
    ]);
}

async function fetchProxy(action, sheetName, data = null, silent = false) {
    let url = `${GAS_URL}?action=${action}&sheet=${sheetName}`;
    if (data) {
        url += `&data=${encodeURIComponent(JSON.stringify(data))}`;
    }

    try {
        const res = await fetchWithTimeout(url, { method: 'GET' });
        const json = await res.json();

        if (!json.success) throw new Error(json.error || 'Failed API');
        return json.data !== undefined ? json.data : true;
    } catch (err) {
        console.error('API ERROR:', err);
        if (!silent) {
            showToast('⚠️ Online sync failed - using offline mode', 'warning');
        }
        return null;
    }
}

// ================= UI =================
function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

function showLoader(text = 'Processing...') {
    const loader = document.getElementById('global-loader');
    const label = document.getElementById('global-loader-text');
    if (label) label.textContent = text;
    if (loader) loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
}

// ================= DATE HELPERS =================
function parseSlot(slot) {
    // Expects "MM/DD/YYYY h:mm AM/PM" or "h:mm AM/PM"
    if (typeof slot === 'string' && slot.includes(' ')) {
        const idx = slot.indexOf(' ');
        const datePart = slot.substring(0, idx);
        const timePart = slot.substring(idx + 1);
        if (datePart.includes('/')) {
            return { date: datePart, time: timePart, full: slot };
        }
    }
    return { date: 'all', time: slot, full: slot };
}

function parseDateString(dateStr) {
    if (dateStr === 'all') return 0;
    const parts = dateStr.split('/').map(p => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(isNaN)) return 0;
    const [month, day, year] = parts;
    return new Date(year, month - 1, day).getTime();
}

function formatDateForDisplay(dateStr) {
    if (dateStr === 'all') return 'All Slots';
    const parts = dateStr.split('/').map(p => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
    const [month, day, year] = parts;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function groupSchedule(schedule) {
    scheduleByDate = {};
    uniqueDates = [];
    schedule.forEach(slot => {
        const { date, time, full } = parseSlot(slot);
        if (!scheduleByDate[date]) {
            scheduleByDate[date] = [];
            uniqueDates.push(date);
        }
        scheduleByDate[date].push({ time, full });
    });
    uniqueDates.sort((a, b) => {
        if (a === 'all' && b === 'all') return 0;
        if (a === 'all') return -1;
        if (b === 'all') return 1;
        return parseDateString(a) - parseDateString(b);
    });
}

// ================= LOAD SCHEDULE =================
// Promise that resolves when schedule data is ready (used by parent dashboard)
let _scheduleReadyResolve;
let scheduleReady = new Promise(resolve => { _scheduleReadyResolve = resolve; });

function renderScheduleUI(rawSchedule, rawBookings) {
    const container = document.getElementById('schedule-container');

    // Update globals
    bookings = rawBookings;
    rawScheduleGlobal = rawSchedule;

    document.getElementById('booking-form').style.display = 'none';
    document.getElementById('confirmation').style.display = 'none';

    if (rawSchedule.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-clock"></i>
            <p>No available schedule</p>
          </div>
        `;
        const dropdown = document.getElementById('date-dropdown');
        dropdown.innerHTML = '<option value="">No dates available</option>';
        dropdown.disabled = true;
        return;
    }

    // Group schedule by date
    groupSchedule(rawSchedule);

    // If current selectedDate is no longer valid, try saved date first, then reset to first
    const savedDate = localStorage.getItem(SELECTED_DATE_KEY);
    if (savedDate && uniqueDates.includes(savedDate)) {
        selectedDate = savedDate;
    } else if (!uniqueDates.includes(selectedDate)) {
        selectedDate = uniqueDates[0];
    }

    // Populate date dropdown
    const dropdown = document.getElementById('date-dropdown');
    dropdown.innerHTML = '';
    dropdown.disabled = false;
    uniqueDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDateForDisplay(date);
        dropdown.appendChild(option);
    });
    dropdown.value = selectedDate;

    // Set up change listener
    dropdown.onchange = (e) => {
        selectedDate = e.target.value;
        displaySlotsForDate(selectedDate);
    };

    // Display slots for selected date
    displaySlotsForDate(selectedDate);
    updateSlotStats();
}

async function loadSchedule() {
    const container = document.getElementById('schedule-container');

    // ── Step 1: Instantly render from localStorage cache (no waiting) ──
    let cachedSchedule = [];
    let cachedBookings = {};
    try { cachedSchedule = JSON.parse(localStorage.getItem(SCHEDULE_KEY)) || []; } catch (e) {}
    try { cachedBookings = JSON.parse(localStorage.getItem(BOOKINGS_KEY)) || {}; } catch (e) {}

    if (cachedSchedule.length > 0) {
        renderScheduleUI(cachedSchedule, cachedBookings);
        // Signal that data is ready for the admin preview
        _scheduleReadyResolve();
    } else {
        container.innerHTML = `
          <div class="loading">
            <i class="fas fa-spinner fa-spin"></i> Loading schedule...
          </div>
        `;
    }

    // ── Step 2: Fetch from server in background to sync (silent — no toast) ──
    let rawSchedule = await fetchProxy('GET', SCHEDULE_SHEET, null, true);
    let rawBookings = await fetchProxy('GET', BOOKINGS_SHEET, null, true);

    // Normalize: parse if returned as JSON string
    if (typeof rawSchedule === 'string') {
        try { rawSchedule = JSON.parse(rawSchedule); } catch (e) { rawSchedule = null; }
    }
    if (typeof rawBookings === 'string') {
        try { rawBookings = JSON.parse(rawBookings); } catch (e) { rawBookings = null; }
    }

    // Use server data if valid, otherwise keep cached data
    if (!Array.isArray(rawSchedule)) rawSchedule = cachedSchedule;
    if (typeof rawBookings !== 'object' || rawBookings === null) rawBookings = cachedBookings;

    // Cache locally
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawSchedule));
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(rawBookings));

    // Re-render with fresh server data (if it changed)
    renderScheduleUI(rawSchedule, rawBookings);
    hideLoader();

    // Signal ready (in case cache was empty and this is the first data)
    _scheduleReadyResolve();
}

// ================= DISPLAY SLOTS =================
function displaySlotsForDate(date) {
    selectedDate = date;
    // Persist selected date
    localStorage.setItem(SELECTED_DATE_KEY, date);
    const container = document.getElementById('schedule-container');
    const slots = scheduleByDate[date] || [];
    if (slots.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-clock"></i>
            <p>No slots available for this date</p>
          </div>
        `;
        return;
    }
    let html = '';
    slots.forEach(slot => {
        const bookedBy = bookings[slot.full];
        const isBooked = !!bookedBy;
        const canClick = !isBooked;
        html += `
          <div class="time-slot ${isBooked ? 'booked' : 'available'}"
               style="cursor:${canClick ? 'pointer' : 'not-allowed'}"
               onclick="${canClick ? `selectSlot('${slot.full}')` : ''}">
            <span>🕒 ${slot.time}</span>
            <span>${isBooked ? 'Booked by ' + bookedBy : 'Available'}</span>
          </div>
        `;
    });
    container.innerHTML = html;
    updateSlotStats();
}

// ================= SELECT SLOT =================
function selectSlot(fullSlot) {
    selectedSlot = fullSlot;
    const { date, time } = parseSlot(fullSlot);
    let displayText;
    if (date === 'all') {
        displayText = `Selected: ${time}`;
    } else {
        const prettyDate = formatDateForDisplay(date);
        displayText = `Selected: ${prettyDate} at ${time}`;
    }
    document.getElementById('selected-slot-display').textContent = displayText;
    document.getElementById('booking-form').style.display = 'block';
    document.getElementById('booking-form').scrollIntoView({ behavior: 'smooth' });
}

// ================= SUBMIT BOOKING =================
async function submitBooking() {
    const name = document.getElementById('client-name').value.trim();
    if (!name) {
        showToast('Enter your name', 'error');
        return;
    }
    if (!selectedSlot) {
        showToast('Select a slot first', 'error');
        return;
    }

    // Quick local check (not authoritative, just UX)
    if (bookings[selectedSlot]) {
        showToast('This slot was just taken! Refreshing...', 'error');
        await loadSchedule();
        return;
    }

    showLoader('Saving your booking...');

    // Use ATOMIC_BOOK to prevent race conditions
    try {
        const url = `${GAS_URL}?action=ATOMIC_BOOK&slot=${encodeURIComponent(selectedSlot)}&name=${encodeURIComponent(name)}`;
        const res = await fetch(url, { method: 'GET' });
        const json = await res.json();

        hideLoader();

        if (!json.success) {
            if (json.error === 'already_booked') {
                showToast(`Sorry! This slot was just booked by ${json.bookedBy}. Refreshing...`, 'error');
                await loadSchedule();
                return;
            }
            showToast('Booking failed: ' + (json.error || 'Unknown error'), 'error');
            return;
        }

        // Success! Update local cache with server's authoritative data
        bookings = json.data || {};
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
        localStorage.setItem('client_name', name);
        showToast('Schedule confirmed successfully!');

        document.getElementById('client-name').value = '';
        const { date, time } = parseSlot(selectedSlot);
        const dateTimeDisplay = date === 'all' ? time : `${formatDateForDisplay(date)} at ${time}`;
        document.getElementById('confirm-msg').textContent = `Booked ${dateTimeDisplay} for ${name}!`;
        document.getElementById('confirmation').style.display = 'block';
        document.getElementById('booking-form').style.display = 'none';
        await loadSchedule();
    } catch (err) {
        hideLoader();
        console.error('ATOMIC_BOOK ERROR:', err);
        showToast('⚠️ Booking failed - please try again', 'error');
    }
}

// ================= ADMIN LOGIC =================
function toggleAdminMode() {
    const btn = document.getElementById('admin-toggle-btn');
    if (document.getElementById('view-client').classList.contains('active')) {
        document.getElementById('view-client').classList.remove('active');
        if (isAdminLoggedIn) {
            document.getElementById('view-admin-panel').classList.add('active');
            populateAdminPreview();
        } else {
            document.getElementById('view-admin-login').classList.add('active');
        }
        btn.innerHTML = '<i class="fas fa-calendar-check"></i> Client View';
    } else {
        document.getElementById('view-admin-login').classList.remove('active');
        document.getElementById('view-admin-panel').classList.remove('active');
        document.getElementById('view-client').classList.add('active');
        btn.innerHTML = '<i class="fas fa-user-shield"></i> Admin Login';
    }
}

async function loginAdmin() {
    const pwd = document.getElementById('admin-pwd').value;
    // SHA-256 hash comparison (plaintext never stored)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pwd));
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (hashHex === '3af1465c4bf99543fdd252a3d1efa742edb5009a32a808a57e26743e57d8c6c8') {
        isAdminLoggedIn = true;
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('view-admin-login').classList.remove('active');
        document.getElementById('view-admin-panel').classList.add('active');
        document.getElementById('admin-pwd').value = '';
        document.getElementById('auto-cleanup-toggle').checked = autoCleanupEnabled;
        populateAdminPreview();
    } else {
        document.getElementById('login-error').style.display = 'block';
    }
}

function tConvert(time24) {
    let [hours, minutes] = time24.split(':');
    let ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    return `${hours}:${minutes} ${ampm}`;
}

function parseUserTime(timeText, ampm) {
    if (!timeText) return null;
    let parts = timeText.trim().split(':');
    let hours = parseInt(parts[0], 10);
    let minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;

    if (isNaN(hours) || isNaN(minutes) || hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    return `${hStr}:${mStr}`;
}


async function generateAndSaveSlots() {
    const dateVal = document.getElementById('admin-date').value;

    const startText = document.getElementById('admin-start-time-text').value;
    const startAmPm = document.getElementById('admin-start-time-ampm').value;
    const endText = document.getElementById('admin-end-time-text').value;
    const endAmPm = document.getElementById('admin-end-time-ampm').value;

    const startVal = parseUserTime(startText, startAmPm);
    const endVal = parseUserTime(endText, endAmPm);

    const intervalMins = parseInt(document.getElementById('admin-interval').value);
    const msgBox = document.getElementById('admin-generate-msg');

    if (!dateVal || !startVal || !endVal) {
        msgBox.textContent = 'Please enter a valid Date, Start Time (e.g. 8:00 or 8), and End Time.';
        msgBox.style.color = '#ef4444';
        msgBox.style.display = 'block';
        return;
    }

    // Format Date from YYYY-MM-DD to M/D/YYYY
    const dateObj = new Date(dateVal + 'T00:00:00');
    const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;

    // Parse times
    const startObj = new Date(`1970-01-01T${startVal}:00`);
    const endObj = new Date(`1970-01-01T${endVal}:00`);

    if (startObj >= endObj) {
        msgBox.textContent = 'End time must be after start time.';
        msgBox.style.color = '#ef4444';
        msgBox.style.display = 'block';
        return;
    }

    let currentObj = new Date(startObj);
    let newSlots = [];

    while (currentObj < endObj) {
        // Start time of the slot
        const timeStr = currentObj.toTimeString().substring(0, 5); // HH:MM
        const ampmStr = tConvert(timeStr);

        // End time of the slot based on interval
        const nextObj = new Date(currentObj.getTime() + intervalMins * 60000);
        // Let's cap the slot generation end time to the overarching user-selected end time
        const actualNextObj = nextObj > endObj ? endObj : nextObj;

        const nextTimeStr = actualNextObj.toTimeString().substring(0, 5);
        const nextAmpmStr = tConvert(nextTimeStr);

        const rangeStr = `${ampmStr} - ${nextAmpmStr}`;
        const fullStr = `${formattedDate} ${rangeStr}`;
        newSlots.push(fullStr);

        currentObj = nextObj;
    }

    // Append to existing, avoid duplicates
    let addedCount = 0;
    newSlots.forEach(slot => {
        if (!rawScheduleGlobal.includes(slot)) {
            rawScheduleGlobal.push(slot);
            addedCount++;
        }
    });

    if (addedCount === 0) {
        msgBox.textContent = 'No new slots were added (they already exist).';
        msgBox.style.color = '#f59e0b'; // warning color
        msgBox.style.display = 'block';
        return;
    }

    showLoader('Saving schedule to server...');

    msgBox.textContent = `Generated ${addedCount} new slot(s). Saving to server...`;
    msgBox.style.color = '#3b82f6';
    msgBox.style.display = 'block';

    // Locally cache
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawScheduleGlobal));

    // Upload to GAS
    const res = await fetchProxy('POST', SCHEDULE_SHEET, rawScheduleGlobal);

    if (res === null) {
        msgBox.textContent = `Saved ${addedCount} slots locally (Offline Mode).`;
        msgBox.style.color = '#f59e0b';
    } else {
        msgBox.textContent = `Successfully saved ${addedCount} slots to Google Sheets!`;
        msgBox.style.color = '#22c55e';
    }

    // Refresh UI
    await loadSchedule();
    populateAdminPreview();
    hideLoader();
}

function populateAdminPreview() {
    // If not grouped, group it
    if (Object.keys(scheduleByDate).length === 0 && rawScheduleGlobal.length > 0) {
        groupSchedule(rawScheduleGlobal);
    }

    const dropdown = document.getElementById('admin-preview-date-dropdown');
    dropdown.innerHTML = '';

    if (uniqueDates.length === 0) {
        dropdown.innerHTML = '<option value="">No dates available</option>';
        document.getElementById('slot-list').innerHTML = '<li style="justify-content:center;color:gray;">No slots generated yet</li>';
        return;
    }

    uniqueDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDateForDisplay(date);
        dropdown.appendChild(option);
    });

    dropdown.onchange = (e) => {
        renderAdminSlotList(e.target.value);
    };

    // Restore saved date if valid
    const savedDate = localStorage.getItem(SELECTED_DATE_KEY);
    if (savedDate && uniqueDates.includes(savedDate)) {
        dropdown.value = savedDate;
        renderAdminSlotList(savedDate);
    } else {
        dropdown.value = uniqueDates[0];
        renderAdminSlotList(uniqueDates[0]);
    }
}

function renderAdminSlotList(date) {
    const list = document.getElementById('slot-list');
    const slots = scheduleByDate[date] || [];
    let html = '';

    // Reset bulk selection UI
    updateBulkUI();

    if (slots.length === 0) {
        list.innerHTML = '<li style="justify-content:center;color:#64748b;">No slots for this date</li>';
        return;
    }

    slots.forEach((slot, idx) => {
        const bookedBy = bookings[slot.full];
        const isBooked = !!bookedBy;

        // Escape quotes to prevent HTML breaking
        const safeSlot = slot.full.replace(/'/g, "\\'");

        html += `
          <li class="${isBooked ? 'booked' : 'available'}">
            <div class="slot-left">
                <input type="checkbox" class="slot-checkbox" data-slot="${safeSlot}" onchange="onSlotCheckChange()">
                <span>🕒 ${slot.time}</span>
            </div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span>${isBooked ? 'Booked by ' + bookedBy : 'Available'}</span>
                ${isBooked ? `<button onclick="unbookSlot('${safeSlot}')" style="background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding: 5px 8px; color:#f59e0b; cursor:pointer; transition: 0.25s;" title="Cancel Booking"><i class="fas fa-user-times"></i></button>` : ''}
                <button onclick="deleteSlot('${safeSlot}')" style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; padding: 5px 8px; color:#ef4444; cursor:pointer; transition: 0.25s;" title="Delete Slot">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
          </li>
        `;
    });
    list.innerHTML = html;
    updateAdminSlotStats(date);
}

// ================= BULK DELETE =================
function getCheckedSlots() {
    return Array.from(document.querySelectorAll('.slot-checkbox:checked')).map(cb => cb.dataset.slot);
}

function getAllSlotCheckboxes() {
    return Array.from(document.querySelectorAll('.slot-checkbox'));
}

function onSlotCheckChange() {
    updateBulkUI();
}

function updateBulkUI() {
    const checked = getCheckedSlots();
    const all = getAllSlotCheckboxes();
    const deleteBtn = document.getElementById('btnDeleteSelected');
    const cancelBtn = document.getElementById('btnCancelSelected');
    const countLabel = document.getElementById('selectedCount');
    const selectAllLabel = document.getElementById('selectAllLabel');

    // Check if any checked slots are booked
    const hasBookedSelected = checked.some(slot => !!bookings[slot]);

    if (checked.length > 0) {
        deleteBtn.classList.add('active');
        countLabel.textContent = `${checked.length} selected`;
    } else {
        deleteBtn.classList.remove('active');
        countLabel.textContent = '';
    }

    // Cancel button only active if booked slots are selected
    if (cancelBtn) {
        if (hasBookedSelected) {
            cancelBtn.classList.add('active');
        } else {
            cancelBtn.classList.remove('active');
        }
    }

    // Update select all label
    if (all.length > 0 && checked.length === all.length) {
        selectAllLabel.textContent = 'Deselect All';
    } else {
        selectAllLabel.textContent = 'Select All';
    }
}

function toggleSelectAll() {
    const all = getAllSlotCheckboxes();
    const checked = getCheckedSlots();
    const shouldSelect = checked.length < all.length;

    all.forEach(cb => { cb.checked = shouldSelect; });
    updateBulkUI();
}

// Helper: safely unbook a slot via server's atomic endpoint
async function safeUnbookSlot(slotStr) {
    try {
        const url = `${GAS_URL}?action=ATOMIC_UNBOOK&slot=${encodeURIComponent(slotStr)}`;
        const res = await fetchWithTimeout(url, { method: 'GET' });
        const json = await res.json();
        if (json.success && json.data) {
            bookings = json.data;
            localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
        }
    } catch (e) {
        // Offline fallback: just remove locally
        delete bookings[slotStr];
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
    }
}

async function deleteSelectedSlots() {
    const selectedSlots = getCheckedSlots();
    if (selectedSlots.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedSlots.length} slot(s)?\n\nAny associated bookings will also be removed.`)) return;

    showLoader(`Deleting ${selectedSlots.length} slot(s)...`);

    // Remove from schedule array
    rawScheduleGlobal = rawScheduleGlobal.filter(s => !selectedSlots.includes(s));

    // Use ATOMIC_UNBOOK for each booked slot (safe, no overwrite)
    for (const slot of selectedSlots) {
        if (bookings[slot]) {
            await safeUnbookSlot(slot);
        }
    }

    // Sync schedule to backend
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawScheduleGlobal));
    const res = await fetchProxy('POST', SCHEDULE_SHEET, rawScheduleGlobal);

    if (res === null) {
        showToast(`Deleted ${selectedSlots.length} slot(s) locally (Offline Mode)`, 'warning');
    } else {
        showToast(`Successfully deleted ${selectedSlots.length} slot(s)!`, 'success');
    }

    // Refresh UI directly from local state
    groupSchedule(rawScheduleGlobal);
    renderScheduleUI(rawScheduleGlobal, bookings);
    populateAdminPreview();
    hideLoader();
}

// ================= BULK CANCEL BOOKINGS =================
async function cancelSelectedBookings() {
    const selectedSlots = getCheckedSlots();
    const bookedSlots = selectedSlots.filter(slot => !!bookings[slot]);

    if (bookedSlots.length === 0) {
        showToast('No booked slots selected', 'warning');
        return;
    }

    if (!confirm(`Cancel bookings for ${bookedSlots.length} slot(s)?\n\nThe slots will become available again.`)) return;

    showLoader(`Cancelling ${bookedSlots.length} booking(s)...`);

    // Use ATOMIC_UNBOOK for each (safe)
    for (const slot of bookedSlots) {
        await safeUnbookSlot(slot);
    }

    showToast(`Cancelled ${bookedSlots.length} booking(s)!`, 'success');

    // Refresh UI from local state
    groupSchedule(rawScheduleGlobal);
    renderScheduleUI(rawScheduleGlobal, bookings);
    populateAdminPreview();
    hideLoader();
}

// ================= SLOT STATS =================
function updateSlotStats() {
    const statsEl = document.getElementById('slot-stats');
    if (!statsEl) return;

    const currentSlots = scheduleByDate[selectedDate] || [];
    const total = currentSlots.length;
    const booked = currentSlots.filter(s => !!bookings[s.full]).length;
    const available = total - booked;

    statsEl.innerHTML = `
        <span class="stat-pill total"><i class="fas fa-clock"></i> ${total} Total</span>
        <span class="stat-pill available"><i class="fas fa-check-circle"></i> ${available} Available</span>
        <span class="stat-pill booked"><i class="fas fa-user"></i> ${booked} Booked</span>
    `;
}

function updateAdminSlotStats(date) {
    const statsEl = document.getElementById('admin-slot-stats');
    if (!statsEl) return;

    const currentSlots = scheduleByDate[date] || [];
    const total = currentSlots.length;
    const booked = currentSlots.filter(s => !!bookings[s.full]).length;
    const available = total - booked;

    statsEl.innerHTML = `
        <span class="stat-pill total"><i class="fas fa-clock"></i> ${total} Total</span>
        <span class="stat-pill available"><i class="fas fa-check-circle"></i> ${available} Available</span>
        <span class="stat-pill booked"><i class="fas fa-user"></i> ${booked} Booked</span>
    `;
}

async function unbookSlot(fullSlot) {
    if (!confirm(`Are you sure you want to cancel the booking for: ${fullSlot}? \nThe time slot will become available again.`)) return;

    showLoader('Cancelling booking...');

    try {
        const url = `${GAS_URL}?action=ATOMIC_UNBOOK&slot=${encodeURIComponent(fullSlot)}`;
        const res = await fetch(url, { method: 'GET' });
        const json = await res.json();

        if (!json.success) {
            showToast('Failed to cancel: ' + (json.error || 'Unknown error'), 'error');
            hideLoader();
            return;
        }

        // Update local cache with server's authoritative data
        bookings = json.data || {};
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
        showToast('Booking successfully cancelled!', 'success');

        // Refresh UI directly from local state
        groupSchedule(rawScheduleGlobal);
        renderScheduleUI(rawScheduleGlobal, bookings);
        populateAdminPreview();
    } catch (err) {
        console.error('ATOMIC_UNBOOK ERROR:', err);
        showToast('⚠️ Cancel failed - please try again', 'error');
    }
    hideLoader();
}

async function deleteSlot(fullSlot) {
    if (!confirm(`Are you sure you want to delete this slot: ${fullSlot}? \n(If it is booked, the booking will also be removed)`)) return;

    showLoader('Deleting slot...');
    // Remove from array
    rawScheduleGlobal = rawScheduleGlobal.filter(s => s !== fullSlot);

    // If booked, use ATOMIC_UNBOOK (safe, won't overwrite other bookings)
    let bookingRemoved = false;
    if (bookings[fullSlot]) {
        await safeUnbookSlot(fullSlot);
        bookingRemoved = true;
    }

    // Sync schedule to backend
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawScheduleGlobal));
    const res = await fetchProxy('POST', SCHEDULE_SHEET, rawScheduleGlobal);

    if (res === null) {
        showToast('Deleted locally (Offline Mode)', 'warning');
    } else {
        showToast(`Slot deleted!${bookingRemoved ? ' Associated booking also removed.' : ''}`, 'success');
    }

    // Refresh UI directly from local state
    groupSchedule(rawScheduleGlobal);
    renderScheduleUI(rawScheduleGlobal, bookings);
    populateAdminPreview();
    hideLoader();
}

// ================= AUTO-POLLING (Real-time updates) =================
let pollInterval = null;

async function pollForUpdates() {
    try {
        let needsRerender = false;

        // Silently fetch latest bookings from server (no toast)
        let rawBookings = await fetchProxy('GET', BOOKINGS_SHEET, null, true);
        if (typeof rawBookings === 'string') {
            try { rawBookings = JSON.parse(rawBookings); } catch (e) { rawBookings = null; }
        }
        if (rawBookings && typeof rawBookings === 'object') {
            const newHash = JSON.stringify(rawBookings);
            const oldHash = JSON.stringify(bookings);
            if (newHash !== oldHash) {
                bookings = rawBookings;
                localStorage.setItem(BOOKINGS_KEY, newHash);
                needsRerender = true;
            }
        }

        // Also fetch latest schedule (so students see added/removed slots)
        let rawSchedule = await fetchProxy('GET', SCHEDULE_SHEET, null, true);
        if (typeof rawSchedule === 'string') {
            try { rawSchedule = JSON.parse(rawSchedule); } catch (e) { rawSchedule = null; }
        }
        if (Array.isArray(rawSchedule)) {
            const newSchedHash = JSON.stringify(rawSchedule);
            const oldSchedHash = JSON.stringify(rawScheduleGlobal);
            if (newSchedHash !== oldSchedHash) {
                rawScheduleGlobal = rawSchedule;
                localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawScheduleGlobal));
                groupSchedule(rawScheduleGlobal);
                needsRerender = true;
            }
        }

        // Re-render if anything changed
        if (needsRerender) {
            if (selectedDate) displaySlotsForDate(selectedDate);
            if (isAdminLoggedIn) populateAdminPreview();
        }

        // Run auto-cleanup if enabled
        if (autoCleanupEnabled) {
            await runAutoCleanup();
        }
    } catch (e) {
        // Silently fail - don't bother the user
    }
}

// ================= AUTO-CLEANUP =================
function toggleAutoCleanup() {
    autoCleanupEnabled = document.getElementById('auto-cleanup-toggle').checked;
    localStorage.setItem('auto_cleanup', JSON.stringify(autoCleanupEnabled));
    if (autoCleanupEnabled) {
        showToast('Auto-cleanup enabled', 'success');
        runAutoCleanup();
    } else {
        showToast('Auto-cleanup disabled', 'warning');
    }
}

function getSlotEndTime(fullSlot) {
    // Parses "M/D/YYYY H:MM AM - H:MM PM" format
    // Returns a Date object for the END time, or null if unparseable
    const parsed = parseSlot(fullSlot);
    if (parsed.date === 'all') return null;

    const timeStr = parsed.time; // e.g. "8:00 AM - 8:30 AM"
    let endTimePart = timeStr;

    // Check if it has a range with " - "
    if (timeStr.includes(' - ')) {
        endTimePart = timeStr.split(' - ')[1].trim(); // e.g. "8:30 AM"
    }

    // Parse "H:MM AM/PM"
    const match = endTimePart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();

    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    // Parse date part
    const dateParts = parsed.date.split('/').map(p => parseInt(p, 10));
    if (dateParts.length !== 3) return null;
    const [month, day, year] = dateParts;

    return new Date(year, month - 1, day, hours, minutes, 0);
}

async function runAutoCleanup() {
    const now = new Date();
    let expiredSlots = [];

    rawScheduleGlobal.forEach(slot => {
        const endTime = getSlotEndTime(slot);
        if (endTime && endTime <= now) {
            expiredSlots.push(slot);
        }
    });

    if (expiredSlots.length === 0) return;

    // Remove expired slots from schedule
    rawScheduleGlobal = rawScheduleGlobal.filter(s => !expiredSlots.includes(s));

    // Use ATOMIC_UNBOOK for each booked expired slot (safe, no overwrite)
    for (const slot of expiredSlots) {
        if (bookings[slot]) {
            await safeUnbookSlot(slot);
        }
    }

    // Sync schedule to server
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawScheduleGlobal));
    await fetchProxy('POST', SCHEDULE_SHEET, rawScheduleGlobal);

    // Re-group and re-render
    groupSchedule(rawScheduleGlobal);
    if (selectedDate) displaySlotsForDate(selectedDate);
    if (isAdminLoggedIn) populateAdminPreview();

    console.log(`Auto-cleanup: removed ${expiredSlots.length} expired slot(s)`);
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollForUpdates, 5000); // Every 5 seconds
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// ================= COPY STUDENT LINK =================
function copyStudentLink() {
    // Build the clean student URL: origin + /scheduler/
    const origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
    const studentUrl = origin + '/scheduler/';
    navigator.clipboard.writeText(studentUrl).then(() => {
        showToast('Student link copied!', 'success');
    }).catch(() => {
        // Fallback
        prompt('Copy this link:', studentUrl);
    });
}

// ================= INIT =================
document.addEventListener('DOMContentLoaded', () => {
    loadSchedule();
    startPolling();
});

// Stop polling if user navigates away (saves resources)
window.addEventListener('beforeunload', stopPolling);

// Pause polling when tab is hidden, resume when visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopPolling();
    } else {
        pollForUpdates(); // Immediately check for updates
        startPolling();
    }
});
