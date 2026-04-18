let attendanceData = {};
let currentSection = null;
const ADMIN_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbyeW0sn-UwAxkK_7kztXLAFiDku3IAJs1qCcsmrTGYnIyCOEbvEv4faSIVBuMiw1RPTDw/exec'; // Apps Script Web App URL
let activeAcceptingSection = null;
let attendancePollTimer = null;
let lastFailUrl = null;
let lastAttendanceTimestamp = null;
let attendancePollConsecutiveFails = 0;
let lastAttendanceRow = null;
let backendHealthTimer = null;
let backendHealthy = null;
// restore last poll timestamp/row across reloads
try { const savedLast = localStorage.getItem('attendance_last_ts'); if (savedLast) lastAttendanceTimestamp = savedLast; } catch (e) { }
try { const savedRow = localStorage.getItem('attendance_last_row'); if (savedRow) lastAttendanceRow = parseInt(savedRow, 10); } catch (e) { }

document.getElementById("fileInput").addEventListener("change", handleFile);

/* =========================
   ON PAGE LOAD — RESTORE FROM LOCALSTORAGE
========================= */
(function init() {
    const saved = localStorage.getItem("attendance_students");
    if (saved) {
        attendanceData = JSON.parse(saved);

        // Load saved attendance values into each section
        for (let section in attendanceData) {
            loadSavedAttendance(section);
        }

        renderSections();
        document.getElementById("downloadBtn").style.display = "block";
        // Try fetching current accepting section (if backend URL set)
        if (ADMIN_BACKEND_URL && !ADMIN_BACKEND_URL.includes('PASTE')) {
            fetchActiveSection();
        }
    }

    // Start polling attendance if backend configured
    if (ADMIN_BACKEND_URL && !ADMIN_BACKEND_URL.includes('PASTE')) {
        fetchActiveSection();

        // Wire polling UI controls once DOM elements are available
        setTimeout(() => {
            const auto = document.getElementById('autoPollCheckbox');
            const clearBtn = document.getElementById('clearLiveBtn');

            // Debug wiring
            const copyBtn = document.getElementById('copyBackendUrlBtn');
            if (copyBtn) copyBtn.addEventListener('click', () => {
                if (!lastFailUrl) { alert('No failing URL to copy'); return; }
                navigator.clipboard.writeText(lastFailUrl).then(() => { alert('Copied failing URL to clipboard'); }).catch(() => { alert('Copy failed'); });
            });

            if (auto) {
                if (auto.checked) startAttendancePolling(12000);
                auto.addEventListener('change', () => {
                    if (auto.checked) startAttendancePolling(12000);
                    else stopAttendancePolling();
                    updatePollToggleUI();
                });
            } else {
                // fallback: start polling by default
                startAttendancePolling(12000);
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    const live = document.getElementById('liveList');
                    if (live) live.innerHTML = '';
                });
            }

            updatePollToggleUI();
        }, 150);
    }
})();

/* =========================
   GLOBAL STUDENT SEARCH
========================= */
let searchHighlightTimer = null;

(function initSearch() {
    // Wait for DOM to be ready
    setTimeout(() => {
        const searchInput = document.getElementById('studentSearchInput');
        const searchClearBtn = document.getElementById('searchClearBtn');
        const searchResults = document.getElementById('searchResults');

        if (!searchInput) return;

        // Debounce search as user types
        let searchDebounce = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const query = searchInput.value.trim();

            // Show/hide clear button
            searchClearBtn.style.display = query.length > 0 ? 'flex' : 'none';

            if (query.length < 2) {
                searchResults.style.display = 'none';
                searchResults.innerHTML = '';
                return;
            }

            searchDebounce = setTimeout(() => {
                performStudentSearch(query);
            }, 200);
        });

        // Clear button
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            searchResults.style.display = 'none';
            searchResults.innerHTML = '';
            clearSearchHighlight();
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                searchResults.style.display = 'none';
            }
        });

        // Reopen results on focus if there's a query
        searchInput.addEventListener('focus', () => {
            const query = searchInput.value.trim();
            if (query.length >= 2 && searchResults.innerHTML !== '') {
                searchResults.style.display = 'block';
            }
        });
    }, 200);
})();

function performStudentSearch(query) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;

    const normalizedQuery = query.toLowerCase();
    const matches = [];

    // Search across all sections
    for (let section in attendanceData) {
        attendanceData[section].forEach((student, index) => {
            const normalizedName = student.name.toLowerCase();
            if (normalizedName.includes(normalizedQuery)) {
                matches.push({
                    name: student.name,
                    section: section,
                    index: index,
                    attendance: student.attendance
                });
            }
        });
    }

    // Render results
    searchResults.innerHTML = '';

    if (matches.length === 0) {
        searchResults.style.display = 'block';
        searchResults.innerHTML = '<div class="search-no-results"><i class="fas fa-user-slash"></i>No students found matching "' + escapeHtml(query) + '"</div>';
        return;
    }

    searchResults.style.display = 'block';

    // Header
    const header = document.createElement('div');
    header.className = 'search-results-header';
    header.innerHTML = '<i class="fas fa-users"></i> ' + matches.length + ' student' + (matches.length > 1 ? 's' : '') + ' found';
    searchResults.appendChild(header);

    // Result items
    matches.forEach(match => {
        const item = document.createElement('div');
        item.className = 'search-result-item';

        // Highlight matching text in name
        const highlightedName = highlightMatch(match.name, query);

        // Attendance status icon
        const statusIcon = match.attendance === 1
            ? '<i class="fas fa-check-circle" style="color:#28a745;margin-right:6px;"></i>'
            : '<i class="fas fa-circle" style="color:#555580;margin-right:6px;font-size:0.7rem;"></i>';

        item.innerHTML =
            '<div class="search-result-name">' + statusIcon + highlightedName + '</div>' +
            '<span class="search-result-section">' + escapeHtml(match.section) + '</span>';

        item.onclick = () => {
            navigateToStudent(match.section, match.index);
            searchResults.style.display = 'none';
        };

        searchResults.appendChild(item);
    });
}

function highlightMatch(text, query) {
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp('(' + escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function navigateToStudent(section, studentIndex) {
    // Clear any existing highlight timer
    if (searchHighlightTimer) {
        clearTimeout(searchHighlightTimer);
        searchHighlightTimer = null;
    }

    // Switch to the target section
    currentSection = section;

    // Update section button states
    document.querySelectorAll('.section-btn').forEach(b => {
        b.classList.remove('active');
        if (b.textContent === section) {
            b.classList.add('active');
        }
    });

    // Render that section's students
    renderStudents(section);

    // Now highlight the specific student card
    setTimeout(() => {
        const grid = document.querySelector('.student-grid');
        if (!grid) return;

        const cards = grid.querySelectorAll('.student-card');
        const targetCard = cards[studentIndex];

        if (targetCard) {
            // Clear any previous highlights
            clearSearchHighlight();

            // Add highlight class
            targetCard.classList.add('search-highlight');

            // Scroll the card into view smoothly
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Remove highlight after the animation plays (3 pulses × 1.8s = ~5.4s)
            searchHighlightTimer = setTimeout(() => {
                targetCard.classList.remove('search-highlight');
            }, 6000);
        }
    }, 100);
}

function clearSearchHighlight() {
    document.querySelectorAll('.student-card.search-highlight').forEach(card => {
        card.classList.remove('search-highlight');
    });
    if (searchHighlightTimer) {
        clearTimeout(searchHighlightTimer);
        searchHighlightTimer = null;
    }
}

/* =========================
   LOAD SAVED ATTENDANCE FOR A SECTION
========================= */
function loadSavedAttendance(section) {
    const savedData = localStorage.getItem("attendance_record_" + section);
    if (savedData) {
        const record = JSON.parse(savedData);
        const savedValues = record.values; // array of 0/1

        attendanceData[section].forEach((student, i) => {
            student.attendance = savedValues[i] !== undefined ? savedValues[i] : 0;
        });
    } else {
        // No saved data — reset to 0
        attendanceData[section].forEach(student => {
            student.attendance = 0;
        });
    }
}

/* =========================
   SAVE STUDENTS STRUCTURE TO LOCALSTORAGE
========================= */
function saveStudentsToStorage() {
    localStorage.setItem("attendance_students", JSON.stringify(attendanceData));
}

/* =========================
   RESET ALL LOCAL DATA
========================= */
function resetAllData() {
    if (!confirm("Are you sure you want to delete ALL saved data?\n\nThis will clear:\n• All uploaded student lists\n• All saved attendance records\n• Polling state\n\nThis cannot be undone.")) return;

    // Remove all attendance-related localStorage keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('attendance_') || key === 'attendance_students')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Reset in-memory state
    attendanceData = {};
    currentSection = null;
    activeAcceptingSection = null;
    lastAttendanceTimestamp = null;
    lastAttendanceRow = null;

    // Clear UI
    document.getElementById("sectionsContainer").innerHTML = "";
    document.getElementById("downloadBtn").style.display = "none";
    const pubBtn = document.getElementById("publishRosterBtn");
    if (pubBtn) pubBtn.style.display = "none";
    const liveList = document.getElementById("liveList");
    if (liveList) liveList.innerHTML = "";

    alert("All local data has been cleared.");
}

/* =========================
   HANDLE FILE UPLOAD
========================= */
function handleFile(e) {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = function (evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        attendanceData = {};

        const headers = rows[0]; // FIRST ROW = sections (e.g. ['Section 1', '', 'Section 2', ''])
        const subHeaders = rows[1] || []; // SECOND ROW = ['Name', 'Att', 'Name', 'Att']

        // Map column indices to sections
        const colToSection = {};
        for (let c = 0; c < headers.length; c++) {
            let val = headers[c];
            if (val && val.toString().trim() !== "") {
                let sectionName = val.toString().trim();
                if (sectionName !== "Name" && sectionName !== "Attendance" && sectionName !== "Att") {
                    colToSection[c] = sectionName;
                    attendanceData[sectionName] = [];
                }
            }
        }

        // If no sections found on row 0, it might be the old format without "Name/Att", 
        // but if we do find them, we start reading students from row 2
        let startRow = 1;
        if (subHeaders.length > 0 && (subHeaders[0] === "Name" || subHeaders[0] === "Att" || subHeaders[0] === "Attendance")) {
            startRow = 2;
        }

        // READ STUDENTS
        for (let i = startRow; i < rows.length; i++) {
            let row = rows[i];
            if (!row || row.length === 0) continue;

            for (let c in colToSection) {
                let colIndex = parseInt(c);
                let sectionName = colToSection[colIndex];

                // Name should be at colIndex, Att (optional) at colIndex + 1
                let studentName = row[colIndex];
                let attVal = row[colIndex + 1];

                if (studentName && studentName.toString().trim() !== "") {
                    // Try to restore previous attendance state from file if any exists
                    let attStatus = 0;
                    if (attVal !== undefined && attVal !== null && attVal.toString().trim() !== "") {
                        attStatus = 1; // if there's any value (e.g. 1), mark present
                    }

                    attendanceData[sectionName].push({
                        name: studentName.toString().trim(),
                        attendance: attStatus
                    });
                }
            }
        }

        // Save structure to localStorage
        saveStudentsToStorage();

        // Load any previously saved attendance
        for (let section in attendanceData) {
            loadSavedAttendance(section);
        }

        console.log("Parsed Data:", attendanceData);

        // Show roster in UI
        renderSections();
        // Show Publish button once roster parsed
        const pubBtn = document.getElementById('publishRosterBtn');
        if (pubBtn) pubBtn.style.display = 'inline-block';

        if (ADMIN_BACKEND_URL && !ADMIN_BACKEND_URL.includes('PASTE')) {
            fetchActiveSection();
        }
    };

    reader.readAsArrayBuffer(file);
}

/* =========================
   SHOW SECTION BUTTONS
========================= */
function renderSections() {
    const container = document.getElementById("sectionsContainer");
    container.innerHTML = "";

    let sectionWrapper = document.createElement("div");
    sectionWrapper.className = "section-buttons";

    for (let section in attendanceData) {
        let btn = document.createElement("button");
        btn.className = "action-btn section-btn";
        btn.textContent = section;

        // Mark active if this was the current section
        if (section === currentSection) {
            btn.classList.add("active");
        }

        // Mark accepting (currently accepting check-ins)
        if (section === activeAcceptingSection) {
            btn.classList.add("accepting");
        }

        btn.onclick = () => {
            currentSection = section;

            // REMOVE OLD ACTIVE
            document.querySelectorAll(".section-btn").forEach(b => {
                b.classList.remove("active");
            });

            // ADD ACTIVE
            btn.classList.add("active");

            renderStudents(section);
        };

        sectionWrapper.appendChild(btn);
    }

    container.appendChild(sectionWrapper);

    // If a section was previously active, re-render it
    if (currentSection && attendanceData[currentSection]) {
        renderStudents(currentSection);
    }
}

/* =========================
   GET SAVED TIMESTAMP FOR A SECTION
========================= */
function getSavedTimestamp(section) {
    const savedData = localStorage.getItem("attendance_record_" + section);
    if (savedData) {
        const record = JSON.parse(savedData);
        return record.timestamp || null;
    }
    return null;
}

/* =========================
   FORMAT DATE NICELY
========================= */
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const options = {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };
    return date.toLocaleDateString('en-US', options);
}

/* =========================
   SHOW STUDENTS GRID
========================= */
function renderStudents(section) {
    const container = document.getElementById("sectionsContainer");

    // Remove old section display
    let oldSection = document.querySelector(".section");
    if (oldSection) oldSection.remove();

    let sectionDiv = document.createElement("div");
    sectionDiv.className = "section";

    let title = document.createElement("h2");
    title.textContent = section;
    sectionDiv.appendChild(title);

    // LAST SAVED DATE INDICATOR
    let dateIndicator = document.createElement("div");
    dateIndicator.className = "save-indicator";
    dateIndicator.id = "saveIndicator_" + section.replace(/\s+/g, '_');

    const timestamp = getSavedTimestamp(section);
    if (timestamp) {
        dateIndicator.innerHTML = '<i class="fas fa-clock"></i> Last saved: ' + formatDate(timestamp);
        dateIndicator.classList.add("has-date");
    } else {
        dateIndicator.innerHTML = '<i class="fas fa-exclamation-circle"></i> Not yet saved';
        dateIndicator.classList.add("no-date");
    }
    sectionDiv.appendChild(dateIndicator);

    // Show acceptance badge if this section is currently accepting check-ins
    if (activeAcceptingSection && activeAcceptingSection === section) {
        let acceptBadge = document.createElement('div');
        acceptBadge.className = 'save-indicator has-date';
        acceptBadge.style.marginTop = '8px';
        acceptBadge.innerHTML = '<i class="fas fa-bullseye"></i> Accepting check-ins';
        sectionDiv.appendChild(acceptBadge);
    }

    let grid = document.createElement("div");
    grid.className = "student-grid";

    attendanceData[section].forEach(student => {
        let card = document.createElement("div");
        card.className = "student-card";
        card.textContent = student.name;

        if (student.attendance === 1) {
            card.classList.add("active");
        }

        card.onclick = () => {
            student.attendance = student.attendance === 1 ? 0 : 1;
            card.classList.toggle("active");
        };

        grid.appendChild(card);
    });

    sectionDiv.appendChild(grid);

    // BUTTON ROW
    let btnRow = document.createElement("div");
    btnRow.className = "attendance-btn-row";

    // SAVE BUTTON
    let saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Attendance';

    saveBtn.onclick = () => {
        // Save attendance values + timestamp to localStorage
        const values = attendanceData[section].map(s => s.attendance);
        const record = {
            values: values,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem("attendance_record_" + section, JSON.stringify(record));

        // Also update the main data store
        saveStudentsToStorage();

        // Update the date indicator
        const indicator = document.getElementById("saveIndicator_" + section.replace(/\s+/g, '_'));
        if (indicator) {
            indicator.innerHTML = '<i class="fas fa-clock"></i> Last saved: ' + formatDate(record.timestamp);
            indicator.className = "save-indicator has-date";
        }

        // Visual feedback on button
        let original = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
        saveBtn.classList.add("saved-feedback");

        setTimeout(() => {
            saveBtn.innerHTML = original;
            saveBtn.classList.remove("saved-feedback");
        }, 2000);
    };

    // COPY BUTTON
    let copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy Attendance';

    copyBtn.onclick = () => {
        copyAttendance(section, copyBtn);
    };

    // CLEAR BUTTON
    let clearBtn = document.createElement("button");
    clearBtn.className = "clear-btn";
    clearBtn.innerHTML = '<i class="fas fa-eraser"></i> Clear';

    clearBtn.onclick = () => {
        if (!confirm("Clear saved attendance for " + section + "?")) return;

        // Reset attendance to 0
        attendanceData[section].forEach(student => {
            student.attendance = 0;
        });

        // Remove from localStorage
        localStorage.removeItem("attendance_record_" + section);
        saveStudentsToStorage();

        // Re-render
        renderStudents(section);
    };

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(clearBtn);
    // SET ACTIVE BUTTON (admin only)
    let setActiveBtn = document.createElement("button");
    setActiveBtn.className = "copy-btn";
    setActiveBtn.innerHTML = '<i class="fas fa-bullseye"></i> Set Active Section';

    setActiveBtn.onclick = () => {
        if (!confirm("Set " + section + " as the active section for check-ins?")) return;
        const secret = prompt("Enter admin secret:");
        if (!secret) return;
        setActiveSection(section, secret);
    };

    btnRow.appendChild(setActiveBtn);

    // DISABLE ACTIVE SECTION BUTTON (admin only)
    let disableActiveBtn = document.createElement("button");
    disableActiveBtn.className = "clear-btn";
    disableActiveBtn.innerHTML = '<i class="fas fa-ban"></i> Disable Active';

    // Only show if this section is currently the active one
    if (activeAcceptingSection !== section) {
        disableActiveBtn.style.display = "none";
    }

    disableActiveBtn.onclick = () => {
        if (!confirm("Disable active section (" + activeAcceptingSection + ")? Students will no longer be able to check in.")) return;
        const secret = prompt("Enter admin secret:");
        if (!secret) return;
        disableActiveSection(secret);
    };

    btnRow.appendChild(disableActiveBtn);
    sectionDiv.appendChild(btnRow);

    container.appendChild(sectionDiv);

    document.getElementById("downloadBtn").style.display = "block";
}

/* =========================
   DOWNLOAD UPDATED FILE
========================= */
function downloadFile() {
    let wb = XLSX.utils.book_new();

    const sections = Object.keys(attendanceData);

    // Find max students in any section
    let maxRows = 0;
    sections.forEach(section => {
        if (attendanceData[section].length > maxRows) {
            maxRows = attendanceData[section].length;
        }
    });

    let ws_data = [];

    // HEADER ROW (Section names)
    let headerRow = [];
    sections.forEach(section => {
        headerRow.push(section);
        headerRow.push(""); // empty for spacing
    });
    ws_data.push(headerRow);

    // SUB HEADER ROW (Name | Attendance)
    let subHeader = [];
    sections.forEach(() => {
        subHeader.push("Name");
        subHeader.push("Attendance");
    });
    ws_data.push(subHeader);

    // DATA ROWS
    for (let i = 0; i < maxRows; i++) {
        let row = [];

        sections.forEach(section => {
            let student = attendanceData[section][i];

            if (student) {
                row.push(student.name);
                row.push(student.attendance === 1 ? 1 : "");
            } else {
                row.push("");
                row.push("");
            }
        });

        ws_data.push(row);
    }

    let ws = XLSX.utils.aoa_to_sheet(ws_data);

    XLSX.utils.book_append_sheet(wb, ws, "Attendance");

    // --- Generate dynamic filename ---
    const now = new Date();

    const monthNames = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december"
    ];

    let month = monthNames[now.getMonth()];
    let day = now.getDate();
    let year = now.getFullYear();

    let hours = now.getHours();
    let minutes = now.getMinutes();
    let ampm = hours >= 12 ? 'pm' : 'am';

    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;

    let filename = `attendance_${month}-${day}-${year}_${hours}:${minutes}${ampm}.xlsx`;

    XLSX.writeFile(wb, filename);
}

/* =========================
   COPY ATTENDANCE TO CLIPBOARD
========================= */
function copyAttendance(section, btn) {
    const students = attendanceData[section];
    if (!students || students.length === 0) {
        alert("No students to copy!");
        return;
    }

    // Build text: attendance values only (one per line)
    let lines = [];
    students.forEach(student => {
        lines.push(student.attendance === 1 ? "1" : "");
    });

    let text = lines.join("\n");

    navigator.clipboard.writeText(text).then(() => {
        // Visual feedback
        let original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.classList.add("copied");

        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove("copied");
        }, 2000);
    }).catch(() => {
        alert("Failed to copy. Try again.");
    });
}

/* =========================
   UPLOAD ROSTER VIA FETCH (text/plain to bypass CORS preflight)
   Sends JSON body as text/plain (a "simple" content type),
   so no CORS preflight is needed. doPost receives it in
   e.postData.contents and parses it as JSON.
   Response is opaque (no-cors), so we verify via JSONP get_roster.
========================= */
function fetchUploadRoster(roster, secret, callback) {
    const jsonBody = JSON.stringify({
        action: 'upload_roster',
        adminSecret: secret,
        roster: roster
    });

    // Send via fetch with no-cors mode + text/plain content type
    // This is a "simple request" — no preflight, data reaches the server
    fetch(ADMIN_BACKEND_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: jsonBody
    }).then(function () {
        // Response is opaque in no-cors mode, so we verify via JSONP
        setTimeout(function () {
            jsonpRetry('get_roster', {}, 3, 1500, function (res) {
                if (res && res.success && res.roster && res.roster.length > 0) {
                    callback({ success: true, count: res.roster.length, message: 'Student list uploaded (' + res.roster.length + ' students verified in sheet)' });
                } else {
                    callback({ success: false, message: 'Student list was sent but verification failed — check Google Sheet manually.' });
                }
            });
        }, 2000);
    }).catch(function (err) {
        console.error('fetchUploadRoster error', err);
        callback({ success: false, message: 'Network error: ' + (err.message || err) });
    });
}

/* =========================
   ADMIN: PUBLISH ROSTER TO BACKEND
   Builds roster array from attendanceData and POSTs via hidden form
========================= */
async function publishRoster() {
    if (!attendanceData || Object.keys(attendanceData).length === 0) { alert('No student list loaded'); return; }
    const roster = [];
    for (let section in attendanceData) {
        attendanceData[section].forEach(student => {
            roster.push({ section: section, name: student.name });
        });
    }
    const secret = prompt('Enter admin secret to upload student list:');
    if (!secret) return;
    const btn = document.getElementById('publishRosterBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
    try {
        fetchUploadRoster(roster, secret, function (json) {
            if (json && json.success) {
                alert('Student list uploaded! ' + (json.message || json.count + ' entries'));
                fetchActiveSection();
            } else {
                alert('Upload may have failed: ' + (json?.message || 'unknown'));
            }
            if (btn) { btn.disabled = false; btn.innerHTML = 'Upload list to Sheets'; }
        });
    } catch (err) {
        console.error('publishRoster error', err);
        alert('Upload error: ' + (err && err.message ? err.message : err));
        if (btn) { btn.disabled = false; btn.innerHTML = 'Upload list to Sheets'; }
    }
}


/* =========================
   ADMIN: SET ACTIVE SECTION
========================= */
async function setActiveSection(section, secret) {
    // Try JSONP first to avoid CORS issues
    if (ADMIN_BACKEND_URL && !ADMIN_BACKEND_URL.includes('PASTE')) {
        // Try JSONP with retries; no POST fallback to avoid CORS failures in browser
        jsonpRetry('set_active_section', { adminSecret: secret, section: section }, 3, 700, function (json) {
            if (json && json.success) {
                activeAcceptingSection = section;
                renderSections();
                if (currentSection) renderStudents(currentSection);
                alert('Active section set to: ' + section);
            } else {
                console.error('setActiveSection JSONP error', json);
                alert('Failed to set active section via JSONP.\n' + (json && json.message ? json.message : 'No response') + '\n\nUse "Test Backend" to inspect the failing URL and ensure the Apps Script is deployed with access: Anyone and Execute as: Me.');
            }
        });
        return;
    }
    alert('ADMIN_BACKEND_URL is not configured in attendance.js');
}

/* =========================
   ADMIN: DISABLE (CLEAR) ACTIVE SECTION
========================= */
async function disableActiveSection(secret) {
    if (ADMIN_BACKEND_URL && !ADMIN_BACKEND_URL.includes('PASTE')) {
        jsonpRetry('set_active_section', { adminSecret: secret, section: '' }, 3, 700, function (json) {
            if (json && json.success) {
                activeAcceptingSection = null;
                renderSections();
                if (currentSection) renderStudents(currentSection);
                alert('Active section disabled. Students can no longer check in.');
            } else {
                console.error('disableActiveSection JSONP error', json);
                alert('Failed to disable active section.\n' + (json && json.message ? json.message : 'No response'));
            }
        });
        return;
    }
    alert('ADMIN_BACKEND_URL is not configured in attendance.js');
}

/* =========================
   ADMIN: FETCH ACTIVE SECTION
========================= */
function fetchActiveSection() {
    // Use JSONP GET with retry to avoid CORS issues and transient failures
    jsonpRetry('get_active_section', {}, 2, 500, function (json) {
        if (json && json.success) {
            activeAcceptingSection = json.active || json.section || null;
        } else {
            activeAcceptingSection = null;
        }
        renderSections();
        if (currentSection) renderStudents(currentSection);
    });
}

/* =========================
   LIVE POLLING: fetch attendance & update UI
========================= */
function normalizeName(s) {
    if (!s) return '';
    let t = s.toString().toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.replace(/[^a-z0-9\s,]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

function applyAttendanceUpdates(attList) {
    if (!attList || !Array.isArray(attList)) return;
    const presentBySection = {};
    attList.forEach(a => {
        if (!a || !a.section) return;
        const sec = a.section.toString();
        const raw = (a.rosterName || a.submittedName || '').toString();
        const norm = normalizeName(raw);
        presentBySection[sec] = presentBySection[sec] || {};
        presentBySection[sec][norm] = true;
    });

    let changed = false;
    for (let section in attendanceData) {
        const students = attendanceData[section];
        for (let i = 0; i < students.length; i++) {
            const s = students[i];
            const normS = normalizeName(s.name);
            if (presentBySection[section] && presentBySection[section][normS]) {
                if (s.attendance !== 1) {
                    s.attendance = 1;
                    changed = true;
                }
            }
        }
    }

    if (changed) {
        saveStudentsToStorage();
        renderSections();
        if (currentSection) renderStudents(currentSection);
    }
}

function updateSectionTimestampsFromAttendance(attList) {
    const latestBySection = {};
    attList.forEach(a => {
        if (!a || !a.section) return;
        const sec = a.section.toString();
        const t = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        if (!latestBySection[sec] || t > latestBySection[sec]) latestBySection[sec] = t;
    });

    for (let section in latestBySection) {
        const indicator = document.getElementById("saveIndicator_" + section.replace(/\s+/g, '_'));
        if (indicator) {
            indicator.innerHTML = '<i class="fas fa-clock"></i> Last check-in: ' + formatDate(latestBySection[section]);
            indicator.className = 'save-indicator has-date';
        }
    }
}

async function pollAttendanceOnce() {
    // Use JSONP request to avoid CORS/preflight failures when calling Apps Script web apps
    setPollStatus('busy', 'Polling...');
    const params = {};
    if (lastAttendanceRow) params.sinceRow = lastAttendanceRow;
    else if (lastAttendanceTimestamp) params.since = lastAttendanceTimestamp;
    jsonpRetry('get_attendance', params, 4, 800, function (json) {
        try {
            if (json && json.success && Array.isArray(json.attendance)) {
                // success — reset failure counter
                attendancePollConsecutiveFails = 0;
                // update lastAttendanceRow if backend provided it
                if (json.lastRow) {
                    lastAttendanceRow = parseInt(json.lastRow, 10) || lastAttendanceRow;
                    try { localStorage.setItem('attendance_last_row', lastAttendanceRow); } catch (e) { }
                }
                // update lastAttendanceTimestamp to newest returned timestamp
                var latest = 0;
                json.attendance.forEach(function (a) { if (a && a.timestamp) { var t = new Date(a.timestamp).getTime(); if (!isNaN(t) && t > latest) latest = t; } });
                if (latest > 0) {
                    lastAttendanceTimestamp = new Date(latest).toISOString();
                    try { localStorage.setItem('attendance_last_ts', lastAttendanceTimestamp); } catch (e) { }
                }

                applyAttendanceUpdates(json.attendance);
                updateSectionTimestampsFromAttendance(json.attendance);
                renderLivePanel(json.attendance);
                setPollStatus('ok', 'Last: ' + new Date().toLocaleTimeString());
            } else {
                // transient failure handling — avoid immediate red flicker
                attendancePollConsecutiveFails++;
                if (attendancePollConsecutiveFails < 3) {
                    setPollStatus('busy', 'Retrying... (' + attendancePollConsecutiveFails + ')');
                } else {
                    setPollStatus('error', (json && json.message) ? json.message : 'No attendance data');
                    try { if (json && json.url) { lastFailUrl = json.url; const dbg = document.getElementById('backendDebug'); if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'JSONP error for: ' + json.url + '\n\n' + ((json && json.message) ? json.message : 'No callback returned'); const copyBtn = document.getElementById('copyBackendUrlBtn'); if (copyBtn) copyBtn.style.display = 'inline-block'; } } } catch (e) { }
                }
            }
        } catch (err) {
            attendancePollConsecutiveFails++;
            if (attendancePollConsecutiveFails < 3) {
                setPollStatus('busy', 'Retrying... (' + attendancePollConsecutiveFails + ')');
            } else {
                setPollStatus('error', err.message || 'Polling error');
                console.log('pollAttendanceOnce callback error', err);
            }
        } finally {
            updatePollToggleUI();
        }
    });
}

function startAttendancePolling(intervalMs = 12000) {
    if (!ADMIN_BACKEND_URL || ADMIN_BACKEND_URL.includes('PASTE')) return;
    if (attendancePollTimer) clearInterval(attendancePollTimer);
    pollAttendanceOnce();
    attendancePollTimer = setInterval(pollAttendanceOnce, intervalMs);
    updatePollToggleUI();
    // start backend health checks
    try { checkBackendHealth(); } catch (e) { }
    if (backendHealthTimer) clearInterval(backendHealthTimer);
    backendHealthTimer = setInterval(checkBackendHealth, 20000);
}

function stopAttendancePolling() {
    if (attendancePollTimer) {
        clearInterval(attendancePollTimer);
        attendancePollTimer = null;
    }
    setPollStatus('off', 'Auto-poll: off');
    // stop backend health checks when polling stops
    if (backendHealthTimer) { clearInterval(backendHealthTimer); backendHealthTimer = null; }
    updatePollToggleUI();
}

/* UI helpers for polling status and live panel */
function setPollStatus(state, message) {
    const dot = document.getElementById('pollDot');
    const text = document.getElementById('pollText');
    if (!dot || !text) return;
    dot.classList.remove('on', 'off', 'error');
    if (state === 'ok') dot.classList.add('on');
    else if (state === 'error') dot.classList.add('error');
    else dot.classList.add('off');
    text.textContent = message || (state === 'ok' ? 'Polling: OK' : (state === 'error' ? 'Polling: Error' : 'Auto-poll: off'));
}

function updatePollToggleUI() {
    const btn = document.getElementById('pollToggleBtn');
    const auto = document.getElementById('autoPollCheckbox');
    if (btn) {
        btn.textContent = attendancePollTimer ? 'Stop Polling' : 'Start Polling';
    }
    if (auto) {
        auto.checked = !!attendancePollTimer;
    }
}

/* =========================
   BACKEND HEALTH CHECK
========================= */
function setHealthStatus(state, message) {
    const dot = document.getElementById('healthDot');
    const text = document.getElementById('healthText');
    if (!dot || !text) return;
    dot.classList.remove('on', 'off', 'error');
    if (state === 'ok') dot.classList.add('on');
    else if (state === 'error') dot.classList.add('error');
    else dot.classList.add('off');
    text.textContent = message || (state === 'ok' ? 'Backend OK' : (state === 'error' ? 'Backend Error' : 'Backend unknown'));
    backendHealthy = (state === 'ok');
}

function checkBackendHealth() {
    if (!ADMIN_BACKEND_URL || ADMIN_BACKEND_URL.includes('PASTE')) { setHealthStatus('off', 'No backend'); return; }
    // use silent retry so transient failures don't spam UI
    jsonpRetry('ping', {}, 2, 1000, function (res) {
        if (res && res.success) setHealthStatus('ok', 'Backend OK');
        else setHealthStatus('error', (res && res.message) ? res.message : 'Unreachable');
    });
}

function renderLivePanel(attList) {
    const live = document.getElementById('liveList');
    if (!live) return;
    live.innerHTML = '';
    if (!attList || attList.length === 0) {
        live.innerHTML = '<div class="empty">No check-ins yet</div>';
        return;
    }
    const sorted = attList.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    sorted.slice(0, 50).forEach(a => {
        const item = document.createElement('div');
        item.className = 'live-item';
        const name = a.rosterName || a.submittedName || 'Unknown';
        const section = a.section || '';
        const time = a.timestamp ? formatDate(a.timestamp) : '';
        item.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>' + name + '</strong> <span class="li-section">' + section + '</span></div><div style="color:#9aa0b4;font-size:0.85rem;">' + time + '</div></div>';
        live.appendChild(item);
    });
}

/* =========================
   JSONP helper for GET endpoints (avoids CORS)
========================= */
function jsonpRequest(action, params, callback, options) {
    options = options || {};
    var silent = !!options.silent;
    var timeoutMs = (typeof options.timeoutMs === 'number') ? options.timeoutMs : 10000;

    if (!ADMIN_BACKEND_URL || ADMIN_BACKEND_URL.includes('PASTE')) {
        if (callback) callback({ success: false, message: 'Backend URL not configured' });
        return;
    }

    const cbName = '__attcb_' + Math.random().toString(36).slice(2, 9);
    let timeoutId = null;
    let called = false;
    let script = null;

    window[cbName] = function (data) {
        called = true;
        try { if (timeoutId) clearTimeout(timeoutId); if (callback) callback(data); } finally { try { delete window[cbName]; } catch (e) { } if (script && script.parentNode) script.parentNode.removeChild(script); }
    };

    const url = new URL(ADMIN_BACKEND_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('callback', cbName);
    if (params) {
        Object.keys(params).forEach(k => { url.searchParams.set(k, params[k]); });
    }
    url.searchParams.set('_', Date.now());

    script = document.createElement('script');
    script.src = url.toString();
    script.onerror = function () {
        var errObj = { success: false, message: 'JSONP load error', url: url.toString() };
        console.error('JSONP load failed for', url.toString());
        try { if (callback) callback(errObj); } catch (e) { }
        if (!silent) {
            setPollStatus('error', 'JSONP load error — check Apps Script URL & deployment');
            try { lastFailUrl = url.toString(); const dbg = document.getElementById('backendDebug'); if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'JSONP load error for: ' + url.toString() + "\n\nCheck that the Apps Script Web App is deployed (use the /exec URL) and set to 'Anyone, even anonymous'."; const copyBtn = document.getElementById('copyBackendUrlBtn'); if (copyBtn) copyBtn.style.display = 'inline-block'; } } catch (e) { }
        } else {
            console.warn('JSONP load failed (silent) for', url.toString());
        }
        try { delete window[cbName]; } catch (e) { }
        if (script && script.parentNode) script.parentNode.removeChild(script);
    };
    // timeout: if callback isn't called within timeoutMs, treat as failure (often HTML sign-in page or non-JS response)
    timeoutId = setTimeout(function () {
        if (!called) {
            const toErr = { success: false, message: 'JSONP timeout / no callback', url: url.toString() };
            console.error('JSONP timeout for', url.toString());
            try { if (callback) callback(toErr); } catch (e) { }
            if (!silent) {
                setPollStatus('error', 'JSONP timeout — backend not returning JS callback');
                try { lastFailUrl = url.toString(); const dbg = document.getElementById('backendDebug'); if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'JSONP timeout for: ' + url.toString() + "\n\nResponse may be an HTML sign-in page or the Web App is not accessible anonymously."; const copyBtn = document.getElementById('copyBackendUrlBtn'); if (copyBtn) copyBtn.style.display = 'inline-block'; } } catch (e) { }
            } else {
                console.warn('JSONP timeout (silent) for', url.toString());
            }
            try { delete window[cbName]; } catch (e) { }
            if (script && script.parentNode) script.parentNode.removeChild(script);
        }
    }, timeoutMs);
    document.body.appendChild(script);
}

/**
 * JSONP retry helper: attempts `attempts` times before returning final result.
 */
function jsonpRetry(action, params, attempts, delayMs, callback) {
    attempts = attempts || 2;
    delayMs = typeof delayMs === 'number' ? delayMs : 800;
    function attempt(remaining) {
        const silent = remaining > 1;
        jsonpRequest(action, params, function (res) {
            if (res && res.success) return callback(res);
            if (remaining > 1) {
                console.warn('jsonpRetry: attempt failed for', action, 'remaining', remaining - 1, res && res.message);
                setTimeout(() => attempt(remaining - 1), delayMs);
            } else {
                // final failure
                return callback(res);
            }
        }, { silent: silent });
    }
    attempt(attempts);
}
