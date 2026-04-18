// ===== Global State =====
let workbookData = {};       // { sectionName: [ { name, scores: {colId: value}, rowIndex, nameCol } ] }
let originalWorkbook = null;
let currentStudent = null;
let searchResults = [];
let fileFormat = 'multi-sheet';

// ===== Score Columns State =====
// Each column: { id, label }
let scoreColumns = [];

// ===== GROUP FEATURE =====
let groupMode = false;
let selectedGroupMembers = [];
let groups = {};
let showAllGroups = false;

// ===== DOM Elements =====
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const fileName = document.getElementById('fileName');
const uploadStats = document.getElementById('uploadStats');
const sectionCount = document.getElementById('sectionCount');
const studentCount = document.getElementById('studentCount');
const gradedCount = document.getElementById('gradedCount');
const searchSection = document.getElementById('searchSection');
const searchInput = document.getElementById('searchInput');
const matchesSection = document.getElementById('matchesSection');
const matchCount = document.getElementById('matchCount');
const matchesBody = document.getElementById('matchesBody');
const matchesTableHead = document.getElementById('matchesTableHead');
const resultSection = document.getElementById('resultSection');
const studentName = document.getElementById('studentName');
const studentSection = document.getElementById('studentSection');
const scoreInputsContainer = document.getElementById('scoreInputsContainer');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const exportSection = document.getElementById('exportSection');
const exportBtn = document.getElementById('exportBtn');
const statusMessage = document.getElementById('statusMessage');
const panelsWrapper = document.getElementById('panelsWrapper');
const groupListSection = document.getElementById('groupListSection');
const groupList = document.getElementById('groupList');
const scoreColumnsSection = document.getElementById('scoreColumnsSection');
const scoreColumnsList = document.getElementById('scoreColumnsList');
const addColumnBtn = document.getElementById('addColumnBtn');
const persistSection = document.getElementById('persistSection');
const saveDataBtn = document.getElementById('saveDataBtn');
const resetDataBtn = document.getElementById('resetDataBtn');
const groupToggleWrapper = document.getElementById('groupToggleWrapper');

// ===== GROUP ELEMENTS =====
const groupToggle = document.getElementById('groupToggle');
const saveGroupBtn = document.getElementById('saveGroupBtn');

// ===== Upload Button =====
uploadBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
});

// ===========================
// ===== SCORE COLUMNS =====
// ===========================

function generateColId() {
    return 'col_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function addScoreColumn(label = '') {
    const id = generateColId();
    scoreColumns.push({ id, label: label || `Score ${scoreColumns.length + 1}` });
    renderScoreColumnsList();
    updateMatchesTableHeaders();
    updateScoreInputsUI();
    autoSaveData();
}

function removeScoreColumn(id) {
    if (scoreColumns.length <= 1) {
        showStatus('You must have at least one score column.', 'error');
        return;
    }
    openModal(
        { title: 'Remove Column', message: `Remove this score column? All entered scores for it will be lost.` },
        () => {
            scoreColumns = scoreColumns.filter(c => c.id !== id);
            // Remove scores for that column from all students
            for (const section of Object.values(workbookData)) {
                for (const student of section) {
                    if (student.scores) delete student.scores[id];
                }
            }
            renderScoreColumnsList();
            updateMatchesTableHeaders();
            updateScoreInputsUI();
            autoSaveData();
        }
    );
}

function renameScoreColumn(id, newLabel) {
    const col = scoreColumns.find(c => c.id === id);
    if (col) {
        col.label = newLabel || col.label;
        updateMatchesTableHeaders();
        updateScoreInputsUI();
        autoSaveData();
    }
}

function renderScoreColumnsList() {
    scoreColumnsList.innerHTML = '';
    scoreColumns.forEach((col) => {
        const row = document.createElement('div');
        row.className = 'score-col-row';
        row.innerHTML = `
            <input type="text" class="score-col-label-input" value="${escapeHtml(col.label)}" placeholder="Column label..." data-col-id="${col.id}">
            <button class="btn-remove-col" title="Remove column" data-col-id="${col.id}">
                <i class="fas fa-times"></i>
            </button>
        `;
        row.querySelector('.score-col-label-input').addEventListener('input', (e) => {
            renameScoreColumn(col.id, e.target.value);
        });
        row.querySelector('.btn-remove-col').addEventListener('click', () => {
            removeScoreColumn(col.id);
        });
        scoreColumnsList.appendChild(row);
    });
}

function updateMatchesTableHeaders() {
    // Rebuild the fixed columns + score columns
    matchesTableHead.innerHTML = `
        <th>#</th>
        <th>Student Name</th>
        <th>Section</th>
        ${scoreColumns.map(col => `<th class="score-th">${escapeHtml(col.label)}</th>`).join('')}
    `;
}

function updateScoreInputsUI() {
    if (!currentStudent) return;
    renderScoreInputs(currentStudent);
}

function renderScoreInputs(student) {
    scoreInputsContainer.innerHTML = '';
    const studentData = workbookData[student.section]?.[student.index];
    if (!studentData) return;

    scoreColumns.forEach(col => {
        const currentVal = studentData.scores?.[col.id];
        const wrapper = document.createElement('div');
        wrapper.className = 'score-input-row';
        wrapper.innerHTML = `
            <label class="score-row-label">${escapeHtml(col.label)}</label>
            <input 
                type="number" 
                class="score-row-input" 
                id="score_${col.id}" 
                placeholder="Enter score..." 
                min="0" max="100"
                value="${currentVal !== null && currentVal !== undefined ? currentVal : ''}"
                data-col-id="${col.id}"
            >
        `;
        const inputEl = wrapper.querySelector('input');
        inputEl.addEventListener('input', () => {
            handleSaveScore(true);
        });
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveScore();
            }
        });
        scoreInputsContainer.appendChild(wrapper);
    });

    // Focus the first input
    const firstInput = scoreInputsContainer.querySelector('input');
    if (firstInput) firstInput.focus();
}

addColumnBtn.addEventListener('click', () => {
    addScoreColumn();
    showStatus('New score column added!', 'info');
});

// ===========================
// ===== SAVE / RESET =====
// ===========================

function autoSaveData() {
    if (Object.keys(workbookData).length === 0) return;
    const payload = {
        workbookData,
        fileFormat,
        scoreColumns,
        groups,
        savedFileName: fileName.textContent
    };
    localStorage.setItem('studentScoreData', JSON.stringify(payload));
    updateGradedStats();
}

function updateGradedStats() {
    if (!gradedCount) return;
    let graded = 0;
    for (const section in workbookData) {
        workbookData[section].forEach(student => {
            if (student.scores && Object.keys(student.scores).length > 0) {
                const hasScore = Object.values(student.scores).some(v => v !== '' && v !== null && v !== undefined);
                if (hasScore) graded++;
            }
        });
    }
    gradedCount.textContent = graded;
}

saveDataBtn.addEventListener('click', () => {
    if (Object.keys(workbookData).length === 0) {
        showStatus('No data to save. Please upload a file first.', 'error');
        return;
    }
    autoSaveData();
    showStatus('Data saved to local storage!', 'success');
});

resetDataBtn.addEventListener('click', () => {
    openModal(
        { title: 'Reset All Data', message: 'This will clear all student data, scores, and groups from local storage and the current session. Are you sure?' },
        () => {
            localStorage.removeItem('studentScoreData');
            localStorage.removeItem('studentGroups');
            resetAppState();
            showStatus('All data has been reset.', 'info');
        }
    );
});

function resetAppState() {
    workbookData = {};
    originalWorkbook = null;
    currentStudent = null;
    searchResults = [];
    fileFormat = 'multi-sheet';
    groups = {};
    scoreColumns = [{ id: generateColId(), label: 'Score 1' }];

    fileName.textContent = 'No file selected';
    uploadStats.style.display = 'none';
    searchSection.style.display = 'none';
    matchesSection.style.display = 'none';
    resultSection.style.display = 'none';
    exportSection.style.display = 'none';
    scoreColumnsSection.style.display = 'none';
    persistSection.style.display = 'none';
    groupListSection.style.display = 'none';
    groupToggleWrapper.style.display = 'none';
    saveGroupBtn.style.display = 'none';
    groupToggle.checked = false;
    groupMode = false;
    selectedGroupMembers = [];
    searchInput.value = '';
    scoreInputsContainer.innerHTML = '';

    renderScoreColumnsList();
    updateMatchesTableHeaders();
    renderGroupList();
    collapseLayout();
}

function loadSavedData() {
    const raw = localStorage.getItem('studentScoreData');
    if (!raw) return false;

    try {
        const payload = JSON.parse(raw);
        workbookData = payload.workbookData || {};
        fileFormat = payload.fileFormat || 'multi-sheet';
        scoreColumns = payload.scoreColumns || [{ id: generateColId(), label: 'Score 1' }];
        groups = payload.groups || {};
        fileName.textContent = payload.savedFileName || 'Restored from local storage';

        const sections = Object.keys(workbookData).length;
        let total = 0;
        for (const s of Object.values(workbookData)) total += s.length;

        sectionCount.textContent = sections;
        studentCount.textContent = total;
        updateGradedStats();
        uploadStats.style.display = 'flex';

        showElement(searchSection);
        showElement(exportSection);
        showElement(scoreColumnsSection);
        showElement(persistSection);
        groupToggleWrapper.style.display = 'flex';
        matchesSection.style.display = 'none';
        resultSection.style.display = 'none';

        renderScoreColumnsList();
        updateMatchesTableHeaders();
        renderGroupList();

        showStatus(`Restored saved data: ${sections} section(s), ${total} student(s).`, 'success');
        return true;
    } catch (e) {
        console.error('Error loading saved data:', e);
        return false;
    }
}

// ===== GROUP FEATURE =====
groupToggle.addEventListener('change', () => {
    groupMode = groupToggle.checked;
    selectedGroupMembers = [];
    if (groupMode) {
        saveGroupBtn.style.display = 'block';
        showStatus('Group mode enabled. Select multiple students.', 'info');
    } else {
        saveGroupBtn.style.display = 'none';
        showStatus('Group mode disabled.', 'info');
    }
});

// ===== SAVE GROUP =====
saveGroupBtn.addEventListener('click', () => {
    if (selectedGroupMembers.length < 2) {
        showStatus('Select at least 2 students to form a group.', 'error');
        return;
    }

    openModal(
        {
            title: "Group Name",
            message: "Enter group name",
            input: true,
            defaultValue: `Group ${Object.keys(groups).length + 1}`
        },
        (groupName) => {
            if (!groupName) return;

            const groupId = `group_${Date.now()}`;

            groups[groupId] = {
                name: groupName,
                members: [...selectedGroupMembers]
            };

            saveGroupsToStorage();
            renderGroupList();

            showStatus(`"${groupName}" created!`, 'success');

            selectedGroupMembers = [];
            matchesBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
        }
    );
});

function saveGroupsToStorage() {
    localStorage.setItem('studentGroups', JSON.stringify(groups));
    autoSaveData();
}

function loadGroupsFromStorage() {
    const saved = localStorage.getItem('studentGroups');
    if (saved) {
        try {
            groups = JSON.parse(saved);
            renderGroupList();
        } catch (e) {
            groups = {};
        }
    }
}

function renderGroupList() {
    const keys = Object.keys(groups);
    if (keys.length === 0) {
        groupListSection.style.display = 'none';
        return;
    }

    groupListSection.style.display = 'block';
    groupList.innerHTML = '';

    const displayKeys = showAllGroups ? keys : keys.slice(0, 3);

    displayKeys.forEach((groupId) => {
        const group = groups[groupId];
        const div = document.createElement('div');
        div.className = 'group-item';

        div.innerHTML = `
            <strong>${escapeHtml(group.name)}</strong><br>
            <small>${group.members.map(m => escapeHtml(m.name)).join(', ')}</small>
            <div style="margin-top:8px; display:flex; gap:6px;">
                <button class="btn-load">Load</button>
                <button class="btn-apply">Apply Score</button>
                <button class="btn-delete">Delete</button>
            </div>
        `;

        // LOAD GROUP
        div.querySelector('.btn-load').addEventListener('click', () => {
            loadGroupMembers(group.members);
        });

        // APPLY SCORE TO GROUP
        div.querySelector('.btn-apply').addEventListener('click', () => {
            // Build inputs per score column
            if (scoreColumns.length === 1) {
                openModal(
                    {
                        title: "Apply Score",
                        message: `Enter score (${scoreColumns[0].label}) for "${group.name}"`,
                        input: true
                    },
                    (value) => {
                        if (!value) return;
                        const scoreMap = {};
                        scoreMap[scoreColumns[0].id] = parseFloat(value);
                        applyScoresToGroup(group.members, scoreMap);
                    }
                );
            } else {
                // Show a chained modal for each column
                applyGroupScoresChained(group, 0, {});
            }
        });

        // DELETE GROUP
        div.querySelector('.btn-delete').addEventListener('click', () => {
            openModal(
                {
                    title: "Delete Group",
                    message: `Delete "${group.name}"?`
                },
                () => {
                    delete groups[groupId];
                    saveGroupsToStorage();
                    renderGroupList();
                    showStatus('Group deleted.', 'info');
                }
            );
        });

        groupList.appendChild(div);
    });

    if (keys.length > 3) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'action-btn btn-template';
        toggleBtn.style.marginTop = '10px';
        toggleBtn.style.width = '100%';
        toggleBtn.innerHTML = showAllGroups ? '<i class="fas fa-chevron-up"></i> Show Less' : `<i class="fas fa-chevron-down"></i> See ${keys.length - 3} More Group(s)`;
        toggleBtn.onclick = () => {
            showAllGroups = !showAllGroups;
            renderGroupList();
        };
        groupList.appendChild(toggleBtn);
    }
}

function applyGroupScoresChained(group, colIndex, scoreMap) {
    if (colIndex >= scoreColumns.length) {
        applyScoresToGroup(group.members, scoreMap);
        return;
    }
    const col = scoreColumns[colIndex];
    openModal(
        {
            title: `Apply Score to "${group.name}"`,
            message: `Enter value for: ${col.label} (leave blank to skip)`,
            input: true
        },
        (value) => {
            if (value !== '' && value !== null && value !== undefined) {
                const parsed = parseFloat(value);
                if (!isNaN(parsed)) scoreMap[col.id] = parsed;
            }
            applyGroupScoresChained(group, colIndex + 1, scoreMap);
        }
    );
}

function loadGroupMembers(members) {
    searchResults = members.map(member => {
        const studentData = workbookData[member.section]?.[member.index] || {};
        return {
            name: member.name,
            section: member.section,
            index: member.index,
            scores: studentData.scores || {},
            exact: true
        };
    });

    renderMatchesTable(searchResults);
    expandLayout();
    showElement(matchesSection);
    resultSection.style.display = 'none';
    currentStudent = null;
    showStatus('Group loaded.', 'info');
}

function applyScoresToGroup(members, scoreMap) {
    members.forEach(member => {
        const { section, index } = member;
        if (!workbookData[section]?.[index]) return;
        if (!workbookData[section][index].scores) workbookData[section][index].scores = {};
        for (const [colId, val] of Object.entries(scoreMap)) {
            workbookData[section][index].scores[colId] = val;
        }
    });

    if (matchesSection.style.display !== 'none') {
        renderMatchesTable(searchResults);
    }

    showStatus(`Scores applied to group!`, 'success');
    autoSaveData();
}

// ===== FILE UPLOAD =====
fileInput.addEventListener('change', handleFileUpload);

// ===== Drag and Drop =====
const uploadArea = document.getElementById('uploadArea');

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.outline = '2px dashed #667eea';
    uploadArea.style.outlineOffset = '-4px';
    uploadArea.style.borderRadius = '10px';
});

uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.outline = 'none';
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.outline = 'none';
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        handleFileUpload({ target: { files } });
    }
});

// ===== SEARCH INPUT =====
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
    }
});

// ===== SAVE SCORES BUTTON =====
saveScoreBtn.addEventListener('click', handleSaveScore);

// ===== EXPORT & TEMPLATE BUTTONS =====
exportBtn.addEventListener('click', handleExport);

const templateBtn = document.getElementById('templateBtn');
templateBtn.addEventListener('click', handleDownloadTemplate);

// ===== FILE UPLOAD HANDLER =====
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!validTypes.includes(file.type) && !['xlsx', 'xls'].includes(ext)) {
        showStatus('Please upload a valid Excel file (.xlsx or .xls)', 'error');
        return;
    }

    fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            originalWorkbook = XLSX.read(data, { type: 'array' });
            workbookData = {};
            let totalStudents = 0;

            const isSideBySide = detectSideBySideFormat(originalWorkbook);

            if (isSideBySide) {
                fileFormat = 'side-by-side';
                totalStudents = parseSideBySideFormat(originalWorkbook);
            } else {
                fileFormat = 'multi-sheet';
                totalStudents = parseMultiSheetFormat(originalWorkbook);
            }

            const sections = Object.keys(workbookData).length;

            if (sections === 0 || totalStudents === 0) {
                showStatus('No student data found in the uploaded file.', 'error');
                return;
            }

            // scoreColumns is already set by the parse functions from file headers
            renderScoreColumnsList();
            updateMatchesTableHeaders();

            sectionCount.textContent = sections;
            studentCount.textContent = totalStudents;
            uploadStats.style.display = 'flex';

            showElement(searchSection);
            showElement(exportSection);
            showElement(scoreColumnsSection);
            showElement(persistSection);
            groupToggleWrapper.style.display = 'flex';
            matchesSection.style.display = 'none';
            resultSection.style.display = 'none';

            currentStudent = null;
            searchResults = [];
            searchInput.value = '';
            searchInput.focus();

            showStatus(`File loaded! ${sections} section(s), ${totalStudents} student(s).`, 'success');
            autoSaveData();
        } catch (err) {
            console.error('Error parsing Excel file:', err);
            showStatus('Error reading the Excel file. Please check the format.', 'error');
        }
    };

    reader.onerror = () => {
        showStatus('Error reading the file.', 'error');
    };

    reader.readAsArrayBuffer(file);
}

// ===== Format Detection =====
function detectSideBySideFormat(workbook) {
    if (workbook.SheetNames.length > 1) {
        let sheetsWithData = 0;
        workbook.SheetNames.forEach((name) => {
            const ws = workbook.Sheets[name];
            const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (json.length > 1) sheetsWithData++;
        });
        if (sheetsWithData > 1) return false;
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    if (jsonData.length < 2) return false;

    const firstRow = jsonData[0];
    let classCount = 0;

    if (Array.isArray(firstRow)) {
        for (let i = 0; i < firstRow.length; i++) {
            const cellVal = String(firstRow[i] || '').trim();
            if (cellVal.match(/^(class|section|group)\s*\d+$/i)) {
                classCount++;
            }
        }
    }

    return classCount >= 2;
}

// ===== Parse Side-by-Side Format =====
function parseSideBySideFormat(workbook) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    let totalStudents = 0;

    if (jsonData.length < 2) return 0;

    const titleRow = jsonData[0];
    const classColumns = [];

    // Find each section's starting column
    for (let col = 0; col < titleRow.length; col++) {
        const cellVal = String(titleRow[col] || '').trim();
        if (cellVal && cellVal.match(/^(class|section|group)\s*\d+$/i)) {
            classColumns.push({ title: cellVal, nameCol: col });
        }
    }

    if (classColumns.length === 0) return 0;

    // Detect sub-header row and extract score column labels
    let dataStartRow = 1;
    const subHeaderRow = jsonData[1];
    let scoreColLabels = [];

    if (subHeaderRow) {
        const firstNameColVal = String(subHeaderRow[classColumns[0].nameCol] || '').trim().toLowerCase();
        const isSubHeader = ['name', 'student', 'student name', 'students'].includes(firstNameColVal);

        if (isSubHeader) {
            dataStartRow = 2;
            // Extract score column labels for first section (assume same across all sections)
            const firstCls = classColumns[0];
            const nextClsNameCol = classColumns[1]?.nameCol ?? titleRow.length;
            for (let c = firstCls.nameCol + 1; c < nextClsNameCol; c++) {
                const label = String(subHeaderRow[c] || '').trim();
                if (label) scoreColLabels.push(label);
            }
        } else {
            // No sub-header: count score columns between first and second section
            const firstCls = classColumns[0];
            const nextClsNameCol = classColumns[1]?.nameCol ?? (firstCls.nameCol + 4);
            const numScoreCols = nextClsNameCol - firstCls.nameCol - 2; // -1 for name, -1 for spacer
            for (let i = 0; i < Math.max(1, numScoreCols); i++) {
                scoreColLabels.push(`Score ${i + 1}`);
            }
        }
    }

    // Build scoreColumns from detected labels
    if (scoreColLabels.length > 0) {
        scoreColumns = scoreColLabels.map((label, i) => ({
            id: generateColId(),
            label: label || `Score ${i + 1}`
        }));
    } else if (scoreColumns.length === 0) {
        scoreColumns = [{ id: generateColId(), label: 'Score 1' }];
    }

    // Parse each section's students
    for (const cls of classColumns) {
        const students = [];
        for (let rowIdx = dataStartRow; rowIdx < jsonData.length; rowIdx++) {
            const row = jsonData[rowIdx];
            if (!row) continue;

            const nameVal = row[cls.nameCol];
            if (nameVal !== undefined && nameVal !== null && String(nameVal).trim() !== '') {
                const name = String(nameVal).trim();
                const scores = {};
                scoreColumns.forEach((col, ci) => {
                    const val = row[cls.nameCol + 1 + ci];
                    if (val !== undefined && val !== null && val !== '') {
                        scores[col.id] = val;
                    }
                });
                students.push({ name, scores, rowIndex: rowIdx, nameCol: cls.nameCol });
            }
        }

        if (students.length > 0) {
            workbookData[cls.title] = students;
            totalStudents += students.length;
        }
    }

    return totalStudents;
}

// ===== Parse Multi-Sheet Format =====
function parseMultiSheetFormat(workbook) {
    let totalStudents = 0;
    let scoreColsDetected = false;

    workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonData.length === 0) return;

        let dataStartRow = 0;

        // Detect header row from the first row
        if (!scoreColsDetected) {
            const firstRow = jsonData[0];
            if (firstRow && firstRow.length > 0) {
                const firstCellLower = String(firstRow[0] || '').trim().toLowerCase();
                const isHeaderRow = ['name', 'student', 'student name', 'students'].includes(firstCellLower);

                if (isHeaderRow) {
                    dataStartRow = 1;
                    // Extract score column labels from columns 1 onwards
                    const newCols = [];
                    for (let c = 1; c < firstRow.length; c++) {
                        const label = String(firstRow[c] || '').trim();
                        if (label) newCols.push({ id: generateColId(), label });
                    }
                    if (newCols.length > 0) {
                        scoreColumns = newCols;
                        scoreColsDetected = true;
                    }
                } else {
                    // No header row: detect column count from widest data row
                    let maxCols = 0;
                    for (const row of jsonData) {
                        if (Array.isArray(row) && row.length > maxCols) maxCols = row.length;
                    }
                    const numScoreCols = Math.max(1, maxCols - 1);
                    scoreColumns = Array.from({ length: numScoreCols }, (_, i) => ({
                        id: generateColId(),
                        label: `Score ${i + 1}`
                    }));
                    scoreColsDetected = true;
                }
            }
        } else {
            // For subsequent sheets, still detect if there's a header row to skip
            const firstRow = jsonData[0];
            if (firstRow) {
                const firstCellLower = String(firstRow[0] || '').trim().toLowerCase();
                if (['name', 'student', 'student name', 'students'].includes(firstCellLower)) {
                    dataStartRow = 1;
                }
            }
        }

        const students = [];
        for (let i = dataStartRow; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row[0] === undefined || row[0] === null || String(row[0]).trim() === '') continue;

            const name = String(row[0]).trim();
            const scores = {};
            scoreColumns.forEach((col, ci) => {
                const val = row[ci + 1];
                if (val !== undefined && val !== null && val !== '') {
                    scores[col.id] = val;
                }
            });

            students.push({ name, scores, rowIndex: i, nameCol: 0 });
        }

        if (students.length > 0) {
            workbookData[sheetName] = students;
            totalStudents += students.length;
        }
    });

    // Fallback if nothing was detected
    if (!scoreColsDetected && scoreColumns.length === 0) {
        scoreColumns = [{ id: generateColId(), label: 'Score 1' }];
    }

    return totalStudents;
}

// ===== Search Handler =====
function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) {
        showStatus('Please enter a student name to search.', 'info');
        return;
    }

    if (Object.keys(workbookData).length === 0) {
        showStatus('Please upload an Excel file first.', 'error');
        return;
    }

    searchResults = [];
    const queryLower = query.toLowerCase();

    // CHECK GROUP FIRST
    let groupFound = false;
    for (const groupId in groups) {
        const groupData = groups[groupId];
        const groupMembers = groupData.members;
        const foundByName = groupData.name.toLowerCase().includes(queryLower);
        const foundByMember = groupMembers.find(member => member.name.toLowerCase().includes(queryLower));
        if (foundByName || foundByMember) {
            searchResults = groupMembers.map(member => {
                const studentData = workbookData[member.section]?.[member.index] || {};
                return {
                    name: member.name,
                    section: member.section,
                    index: member.index,
                    scores: studentData.scores || {},
                    exact: true
                };
            });
            groupFound = true;
            break;
        }
    }

    if (groupFound) {
        renderMatchesTable(searchResults);
        expandLayout();
        showElement(matchesSection);
        resultSection.style.display = 'none';
        currentStudent = null;
        showStatus('Group found! Showing all members.', 'success');
        return;
    }

    // SEARCH INDIVIDUALS
    for (const [section, students] of Object.entries(workbookData)) {
        for (let i = 0; i < students.length; i++) {
            const student = students[i];
            const nameLower = student.name.toLowerCase();

            if (nameLower === queryLower) {
                searchResults.unshift({
                    name: student.name,
                    section,
                    index: i,
                    scores: student.scores || {},
                    exact: true
                });
            } else if (nameLower.includes(queryLower)) {
                searchResults.push({
                    name: student.name,
                    section,
                    index: i,
                    scores: student.scores || {},
                    exact: false
                });
            }
        }
    }

    if (searchResults.length === 0) {
        matchesSection.style.display = 'none';
        collapseLayout();
        resultSection.style.display = 'none';
        currentStudent = null;
        showStatus(`Student "${query}" not found.`, 'error');
        return;
    }

    if (searchResults.length === 1) {
        if (groupMode) {
            // In group mode, show the table so the user can click to add them
            renderMatchesTable(searchResults);
            expandLayout();
            showElement(matchesSection);
            resultSection.style.display = 'none';
            currentStudent = null;
            showStatus(`Student found. Click to add to group.`, 'info');
        } else {
            matchesSection.style.display = 'none';
            expandLayout();
            selectStudent(searchResults[0]);
            showStatus(`Student found: "${searchResults[0].name}" in ${searchResults[0].section}.`, 'success');
        }
        return;
    }

    renderMatchesTable(searchResults);
    expandLayout();
    showElement(matchesSection);
    resultSection.style.display = 'none';
    currentStudent = null;
    showStatus(`Found ${searchResults.length} match(es) for "${query}". Click to select.`, 'info');
}

// ===== Render Matches Table =====
function renderMatchesTable(results) {
    matchCount.textContent = `${results.length} found`;
    matchesBody.innerHTML = '';
    updateMatchesTableHeaders();

    results.forEach((match, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.matchIndex = idx;

        const tdNum = document.createElement('td');
        tdNum.textContent = idx + 1;

        const tdName = document.createElement('td');
        tdName.textContent = match.name;

        const tdSection = document.createElement('td');
        tdSection.textContent = match.section;

        tr.appendChild(tdNum);
        tr.appendChild(tdName);
        tr.appendChild(tdSection);

        // Score columns
        scoreColumns.forEach(col => {
            const tdScore = document.createElement('td');
            const val = match.scores?.[col.id];
            if (val !== null && val !== undefined) {
                tdScore.textContent = val;
                tdScore.className = 'score-cell';
            } else {
                tdScore.textContent = '—';
                tdScore.className = 'score-cell empty';
            }
            tr.appendChild(tdScore);
        });

        tr.addEventListener('click', () => {
            if (groupMode) {
                const member = { name: match.name, section: match.section, index: match.index };
                const exists = selectedGroupMembers.find(
                    m => m.name === member.name && m.section === member.section
                );

                if (!exists) {
                    selectedGroupMembers.push(member);
                    tr.classList.add('selected');
                } else {
                    selectedGroupMembers = selectedGroupMembers.filter(
                        m => !(m.name === member.name && m.section === member.section)
                    );
                    tr.classList.remove('selected');
                }

                showStatus(`${selectedGroupMembers.length} member(s) selected.`, 'info');
            } else {
                matchesBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');
                selectStudent(match);
            }
        });

        matchesBody.appendChild(tr);
    });
}

// ===== Modal Elements =====
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalInput = document.getElementById('modalInput');
const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');

let modalCallback = null;

function openModal({ title, message, input = false, defaultValue = '' }, callback) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalInput.style.display = input ? 'block' : 'none';
    modalInput.value = defaultValue;
    modalOverlay.classList.add('show');
    modalCallback = callback;
    if (input) setTimeout(() => modalInput.focus(), 50);
}

modalConfirm.onclick = () => {
    modalOverlay.classList.remove('show');
    if (modalCallback) {
        modalCallback(modalInput.value);
    }
};

modalCancel.onclick = () => {
    modalOverlay.classList.remove('show');
};

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        modalOverlay.classList.remove('show');
    }
});

// Handle Enter key in modal
modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        modalConfirm.click();
    }
});

// ===== Select Student =====
function selectStudent(match) {
    currentStudent = {
        name: match.name,
        section: match.section,
        index: match.index
    };

    studentName.textContent = match.name;
    studentSection.textContent = match.section;

    renderScoreInputs(currentStudent);
    showElement(resultSection);
}

// ===== Save Score Handler =====
function handleSaveScore(quiet = false) {
    if (typeof quiet !== 'boolean') quiet = false;

    if (!currentStudent) {
        if (!quiet) showStatus('No student selected. Please search for a student first.', 'error');
        return;
    }

    const { section, index } = currentStudent;

    if (!workbookData[section]?.[index]) {
        if (!quiet) showStatus('Student data not found.', 'error');
        return;
    }

    if (!workbookData[section][index].scores) {
        workbookData[section][index].scores = {};
    }

    let anyFilled = false;
    const inputs = scoreInputsContainer.querySelectorAll('input[data-col-id]');
    inputs.forEach(input => {
        const colId = input.dataset.colId;
        const val = input.value.trim();
        if (val !== '') {
            const parsed = parseFloat(val);
            if (!isNaN(parsed)) {
                workbookData[section][index].scores[colId] = parsed;
                anyFilled = true;
            }
        }
    });

    if (!anyFilled) {
        if (!quiet) showStatus('Please enter at least one score.', 'error');
        return;
    }

    if (matchesSection.style.display !== 'none') {
        const rows = matchesBody.querySelectorAll('tr');
        rows.forEach((row) => {
            const matchIdx = parseInt(row.dataset.matchIndex);
            const match = searchResults[matchIdx];
            if (match && match.section === section && match.index === index) {
                match.scores = { ...workbookData[section][index].scores };
                const scoreCells = row.querySelectorAll('.score-cell');
                scoreColumns.forEach((col, ci) => {
                    if (scoreCells[ci]) {
                        const val = match.scores[col.id];
                        if (val !== null && val !== undefined) {
                            scoreCells[ci].textContent = val;
                            scoreCells[ci].className = 'score-cell';
                        }
                    }
                });
            }
        });
    }

    autoSaveData();

    if (!quiet) {
        showStatus(`Scores saved for "${currentStudent.name}"!`, 'success');

        setTimeout(() => {
            searchInput.value = '';
            searchInput.focus();
        }, 500);
    }
}

// ===== Blob-based Download (avoids Live Server permission errors) =====
function downloadWorkbook(workbook, fileName) {
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ===== Export Handler =====
function handleExport() {
    if (Object.keys(workbookData).length === 0) {
        showStatus('No data to export. Please upload a file first.', 'error');
        return;
    }

    try {
        if (fileFormat === 'side-by-side') {
            exportSideBySide();
        } else {
            exportMultiSheet();
        }
    } catch (err) {
        console.error('Error exporting file:', err);
        showStatus('Error exporting the file. Please try again.', 'error');
    }
}

// ===== Export: Side-by-Side Format =====
function exportSideBySide() {
    const newWorkbook = XLSX.utils.book_new();
    const sections = Object.entries(workbookData);
    const COLS_PER_CLASS = 2 + scoreColumns.length; // Name + scores + spacer

    let maxStudents = 0;
    sections.forEach(([, students]) => {
        if (students.length > maxStudents) maxStudents = students.length;
    });

    const sheetData = [];

    // Title row
    const titleRow = [];
    sections.forEach(([sectionName], idx) => {
        const colStart = idx * COLS_PER_CLASS;
        titleRow[colStart] = sectionName;
        for (let i = 1; i < COLS_PER_CLASS; i++) titleRow[colStart + i] = '';
    });
    sheetData.push(titleRow);

    // Header row (Name, Score 1, Score 2, ...)
    const headerRow = [];
    sections.forEach((_, idx) => {
        const colStart = idx * COLS_PER_CLASS;
        headerRow[colStart] = 'Name';
        scoreColumns.forEach((col, ci) => {
            headerRow[colStart + 1 + ci] = col.label;
        });
        headerRow[colStart + COLS_PER_CLASS - 1] = '';
    });
    sheetData.push(headerRow);

    // Data rows
    for (let row = 0; row < maxStudents; row++) {
        const dataRow = [];
        sections.forEach(([, students], idx) => {
            const colStart = idx * COLS_PER_CLASS;
            if (row < students.length) {
                dataRow[colStart] = students[row].name;
                scoreColumns.forEach((col, ci) => {
                    const val = students[row].scores?.[col.id];
                    dataRow[colStart + 1 + ci] = (val !== null && val !== undefined) ? val : '';
                });
            } else {
                for (let i = 0; i < COLS_PER_CLASS; i++) dataRow[colStart + i] = '';
            }
            dataRow[colStart + COLS_PER_CLASS - 1] = '';
        });
        sheetData.push(dataRow);
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    ws['!merges'] = [];
    sections.forEach(([,], idx) => {
        const colStart = idx * COLS_PER_CLASS;
        ws['!merges'].push({ s: { r: 0, c: colStart }, e: { r: 0, c: colStart + scoreColumns.length } });
    });

    ws['!cols'] = [];
    sections.forEach(([,], idx) => {
        const colStart = idx * COLS_PER_CLASS;
        ws['!cols'][colStart] = { wch: 28 };
        scoreColumns.forEach((_, ci) => {
            ws['!cols'][colStart + 1 + ci] = { wch: 12 };
        });
        ws['!cols'][colStart + COLS_PER_CLASS - 1] = { wch: 3 };
    });

    ws['!rows'] = [{ hpt: 30 }, { hpt: 20 }];

    XLSX.utils.book_append_sheet(newWorkbook, ws, 'Student Scores');

    const timestamp = new Date().toISOString().slice(0, 10);
    const outputFileName = `Student_Scores_Updated_${timestamp}.xlsx`;
    downloadWorkbook(newWorkbook, outputFileName);
    showStatus(`File "${outputFileName}" downloaded successfully!`, 'success');
}

// ===== Export: Multi-Sheet Format =====
function exportMultiSheet() {
    const newWorkbook = XLSX.utils.book_new();

    for (const [sheetName, students] of Object.entries(workbookData)) {
        // Header row
        const headerRow = ['Name', ...scoreColumns.map(c => c.label)];
        const sheetData = [headerRow];

        students.forEach((student) => {
            const row = [student.name];
            scoreColumns.forEach(col => {
                const val = student.scores?.[col.id];
                row.push((val !== null && val !== undefined) ? val : '');
            });
            sheetData.push(row);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
        const colWidths = [{ wch: 30 }, ...scoreColumns.map(() => ({ wch: 12 }))];
        worksheet['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(newWorkbook, worksheet, sheetName);
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const outputFileName = `Student_Scores_Updated_${timestamp}.xlsx`;
    downloadWorkbook(newWorkbook, outputFileName);
    showStatus(`File "${outputFileName}" downloaded successfully!`, 'success');
}

// ===== Download Template Handler =====
function handleDownloadTemplate() {
    try {
        const NUM_CLASSES = 14;
        const COLS_PER_CLASS = 3;
        const sheetData = [];
        const titleRow = [];

        for (let c = 0; c < NUM_CLASSES; c++) {
            const colStart = c * COLS_PER_CLASS;
            titleRow[colStart] = `Section ${c + 1}`;
            titleRow[colStart + 1] = '';
            titleRow[colStart + 2] = '';
        }
        sheetData.push(titleRow);

        for (let row = 0; row < 50; row++) {
            const dataRow = [];
            for (let c = 0; c < NUM_CLASSES; c++) {
                const colStart = c * COLS_PER_CLASS;
                dataRow[colStart] = '';
                dataRow[colStart + 1] = '';
                dataRow[colStart + 2] = '';
            }
            sheetData.push(dataRow);
        }

        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        ws['!merges'] = [];
        for (let c = 0; c < NUM_CLASSES; c++) {
            const colStart = c * COLS_PER_CLASS;
            ws['!merges'].push({ s: { r: 0, c: colStart }, e: { r: 0, c: colStart + 1 } });
        }

        ws['!cols'] = [];
        for (let c = 0; c < NUM_CLASSES; c++) {
            const colStart = c * COLS_PER_CLASS;
            ws['!cols'][colStart] = { wch: 28 };
            ws['!cols'][colStart + 1] = { wch: 10 };
            ws['!cols'][colStart + 2] = { wch: 3 };
        }

        ws['!rows'] = [{ hpt: 30 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Student Scores');

        downloadWorkbook(wb, 'student_scores_template.xlsx');
        showStatus('Template downloaded! Paste your student names under each section title.', 'success');
    } catch (err) {
        console.error('Error generating template:', err);
        showStatus('Error generating template.', 'error');
    }
}

// ===== Layout Toggle Functions =====
function expandLayout() {
    panelsWrapper.classList.add('expanded');
}

function collapseLayout() {
    panelsWrapper.classList.remove('expanded');
}

// ===== Utility Functions =====
function showElement(element) {
    element.style.display = 'block';
    element.classList.remove('show');
    void element.offsetWidth;
    element.classList.add('show');
}

let statusTimeout = null;
function showStatus(message, type = 'info') {
    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }

    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    statusMessage.classList.add(type);

    requestAnimationFrame(() => {
        statusMessage.classList.add('show');
    });

    statusTimeout = setTimeout(() => {
        statusMessage.classList.remove('show');
    }, 4000);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ===== Initialize =====
(function init() {
    // Default score columns
    scoreColumns = [{ id: generateColId(), label: 'Score 1' }];
    updateMatchesTableHeaders();

    // Try to restore saved data
    const restored = loadSavedData();
    if (!restored) {
        // Try to load groups only
        loadGroupsFromStorage();
    }
})();