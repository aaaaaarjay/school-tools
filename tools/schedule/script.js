const SHEET_ID = '17cKxYPpqYT5AzzynZ4fdmx-bmtYNKwpn6R6dfb-GAQU';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxGN9_u26s-O-goZuB34pdKb1Adv0Nghv_Zts6dSLlKXEqvYGHLJfNHNo2YNGKQLzH-6w/exec';

const SCHEDULE_SHEET = 'Schedule';
const BOOKINGS_SHEET = 'Bookings';

const SCHEDULE_KEY = 'scheduler_slots';
const BOOKINGS_KEY = 'scheduler_bookings';

let selectedSlot = null;
let scheduleByDate = {};
let uniqueDates = [];
let selectedDate = null;
let bookings = {}; // holds current bookings data
let rawScheduleGlobal = []; // Keeps track of all slots
let isAdminLoggedIn = false;
let autoCleanupEnabled = JSON.parse(localStorage.getItem('auto_cleanup') || 'false');

// ================= API =================
async function fetchProxy(action, sheetName, data = null) {
    let url = `${GAS_URL}?action=${action}&sheet=${sheetName}`;
    if (data) {
        url += `&data=${encodeURIComponent(JSON.stringify(data))}`;
    }

    try {
        const res = await fetch(url, { method: 'GET' });
        const json = await res.json();

        if (!json.success) throw new Error(json.error || 'Failed API');
        return json.data !== undefined ? json.data : true;
    } catch (err) {
        console.error('API ERROR:', err);
        showToast('⚠️ Online sync failed - using offline mode', 'warning');
        return null; // Signals failure so offline mode kicks in
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
async function loadSchedule() {
    const container = document.getElementById('schedule-container');
    showLoader('Loading schedule...');

    container.innerHTML = `
      <div class="loading">
        <i class="fas fa-spinner fa-spin"></i> Loading schedule...
      </div>
    `;

    // Fetch schedule and bookings
    let rawSchedule = await fetchProxy('GET', SCHEDULE_SHEET);
    let rawBookings = await fetchProxy('GET', BOOKINGS_SHEET);

    // Normalize: parse if returned as JSON string
    if (typeof rawSchedule === 'string') {
        try { rawSchedule = JSON.parse(rawSchedule); } catch (e) { rawSchedule = []; }
    }
    if (typeof rawBookings === 'string') {
        try { rawBookings = JSON.parse(rawBookings); } catch (e) { rawBookings = {}; }
    }

    // Fallback to localStorage if not proper type
    if (!Array.isArray(rawSchedule)) rawSchedule = JSON.parse(localStorage.getItem(SCHEDULE_KEY)) || [];
    if (typeof rawBookings !== 'object' || rawBookings === null) rawBookings = JSON.parse(localStorage.getItem(BOOKINGS_KEY)) || {};

    // Cache locally
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawSchedule));
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(rawBookings));

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

    // If current selectedDate is no longer valid, reset to first
    if (!uniqueDates.includes(selectedDate)) {
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
    hideLoader();
}

// ================= DISPLAY SLOTS =================
function displaySlotsForDate(date) {
    selectedDate = date;
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

function loginAdmin() {
    const pwd = document.getElementById('admin-pwd').value;
    if (pwd === '120823') {
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

    // Render first
    dropdown.value = uniqueDates[0];
    renderAdminSlotList(uniqueDates[0]);
}

function renderAdminSlotList(date) {
    const list = document.getElementById('slot-list');
    const slots = scheduleByDate[date] || [];
    let html = '';

    if (slots.length === 0) {
        list.innerHTML = '<li style="justify-content:center;color:gray;">No slots for this date</li>';
        return;
    }

    slots.forEach(slot => {
        const bookedBy = bookings[slot.full];
        const isBooked = !!bookedBy;

        // Escape quotes to prevent HTML breaking
        const safeSlot = slot.full.replace(/'/g, "\\'");

        html += `
          <li class="${isBooked ? 'booked' : 'available'}">
            <span>🕒 ${slot.time}</span>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span>${isBooked ? 'Booked by ' + bookedBy : 'Available'}</span>
                ${isBooked ? `<button onclick="unbookSlot('${safeSlot}')" style="background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.3); border-radius:5px; padding: 5px 8px; color:#f59e0b; cursor:pointer;" title="Cancel Booking"><i class="fas fa-user-times"></i></button>` : ''}
                <button onclick="deleteSlot('${safeSlot}')" style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:5px; padding: 5px 8px; color:#ef4444; cursor:pointer; transition: 0.3s;" title="Delete Slot">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
          </li>
        `;
    });
    list.innerHTML = html;
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

        await loadSchedule();
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

    // If booked, remove from bookings
    let bookingRemoved = false;
    if (bookings[fullSlot]) {
        delete bookings[fullSlot];
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
        await fetchProxy('POST', BOOKINGS_SHEET, bookings);
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

    await loadSchedule();
    populateAdminPreview();
    hideLoader();
}

// ================= AUTO-POLLING (Real-time updates) =================
let pollInterval = null;

async function pollForUpdates() {
    try {
        // Silently fetch latest bookings from server
        let rawBookings = await fetchProxy('GET', BOOKINGS_SHEET);
        if (typeof rawBookings === 'string') {
            try { rawBookings = JSON.parse(rawBookings); } catch (e) { rawBookings = null; }
        }
        if (rawBookings && typeof rawBookings === 'object') {
            const newHash = JSON.stringify(rawBookings);
            const oldHash = JSON.stringify(bookings);
            if (newHash !== oldHash) {
                bookings = rawBookings;
                localStorage.setItem(BOOKINGS_KEY, newHash);
                // Re-render the current view silently
                if (selectedDate) displaySlotsForDate(selectedDate);
                if (isAdminLoggedIn) populateAdminPreview();
            }
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

    // Remove any bookings for expired slots
    let bookingsChanged = false;
    expiredSlots.forEach(slot => {
        if (bookings[slot]) {
            delete bookings[slot];
            bookingsChanged = true;
        }
    });

    // Sync to server
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rawScheduleGlobal));
    await fetchProxy('POST', SCHEDULE_SHEET, rawScheduleGlobal);

    if (bookingsChanged) {
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
        await fetchProxy('POST', BOOKINGS_SHEET, bookings);
    }

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
