const TEMPLATE_SHEET_NAME = "Template";

const FIELD_MAP = {
  college: "C8",
  reportPeriod: "C9",
  academicYearSemester: "C10",
  studentName: "C12",
  courseYear: "G12",
  subjects: "B16",
  howFailed: "C17",
  studentAwareness: "D17",
  failedPassed: "F17",
  whatHappened: "C19",
  parentAcknowledgment: "D19",
  ifFailedReasons: "F19",
  whenStarted: "C21",
  remedialTeaching: "D21",
  whyHappened: "C23",
  performanceAssessment: "D23",
  stoppedWithdrawDropout: "C25",
  activitiesExercisesRemoval: "D25",
  preparedBy: "C28",
  notedBy: "E28",
  approvedBy: "G28"
};

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, message: "API is active. Please use POST." }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const rawData = e.postData.contents;
    const request = JSON.parse(rawData);
    const action = request.action;
    const payload = request.payload || {};
    let result = null;

    if (action === "getAllStudents") {
      result = getAllStudents();
    } else if (action === "getStudent") {
      result = getStudent(payload.sheetName);
    } else if (action === "addStudent") {
      result = addStudent(payload.data);
    } else if (action === "updateStudent") {
      result = updateStudent(payload.originalSheetName, payload.data);
    } else if (action === "deleteStudent") {
      result = deleteStudent(payload.sheetName);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getAllStudents() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error("Could not access spreadsheet. Make sure you have permission.");
    }

    const sheets = ss.getSheets();
    if (!sheets || sheets.length === 0) {
      throw new Error("No sheets found in spreadsheet.");
    }

    const students = [];
    
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      
      // Skip Template sheet
      if (sh.getName() === TEMPLATE_SHEET_NAME) {
        continue;
      }

      try {
        students.push({
          sheetName: sh.getName(),
          studentName: sh.getRange(FIELD_MAP.studentName).getDisplayValue() || "",
          courseYear: sh.getRange(FIELD_MAP.courseYear).getDisplayValue() || "",
          college: sh.getRange(FIELD_MAP.college).getDisplayValue() || "",
          status: sh.getRange(FIELD_MAP.failedPassed).getDisplayValue() || ""
        });
      } catch (e) {
        // Skip sheets with errors, continue with others
        Logger.log("Error reading sheet " + sh.getName() + ": " + e);
      }
    }

    return students.sort((a, b) => a.sheetName.localeCompare(b.sheetName));
  } catch (error) {
    Logger.log("getAllStudents error: " + error);
    throw new Error("Failed to load students: " + error.message);
  }
}

function getStudent(sheetName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(sheetName);
    if (!sh) throw new Error("Student sheet '" + sheetName + "' not found.");

    return readStudentFromSheet_(sh);
  } catch (error) {
    Logger.log("getStudent error: " + error);
    throw error;
  }
}

function addStudent(data) {
  try {
    validateStudentData_(data);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const template = ss.getSheetByName(TEMPLATE_SHEET_NAME);
    if (!template) throw new Error("Template sheet '" + TEMPLATE_SHEET_NAME + "' not found. Create a sheet named 'Template' first.");

    const cleanName = sanitizeSheetName_(data.studentName);
    let finalName = cleanName;

    if (ss.getSheetByName(finalName)) {
      finalName = generateUniqueSheetName_(cleanName, ss);
    }

    const copiedSheet = template.copyTo(ss).setName(finalName);
    ss.setActiveSheet(copiedSheet);
    ss.moveActiveSheet(ss.getNumSheets());

    writeStudentToSheet_(copiedSheet, data);

    return {
      success: true,
      message: "Student report created successfully.",
      sheetName: finalName
    };
  } catch (error) {
    Logger.log("addStudent error: " + error);
    throw error;
  }
}

function updateStudent(originalSheetName, data) {
  validateStudentData_(data);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(originalSheetName);
  if (!sh) throw new Error("Student sheet not found.");

  const newName = sanitizeSheetName_(data.studentName);

  if (newName !== originalSheetName) {
    const existing = ss.getSheetByName(newName);
    if (existing && existing.getName() !== originalSheetName) {
      throw new Error("Another sheet with this student name already exists.");
    }
    sh.setName(newName);
  }

  writeStudentToSheet_(sh, data);

  return {
    success: true,
    message: "Student report updated successfully.",
    sheetName: sh.getName()
  };
}

function deleteStudent(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Student sheet not found.");
  if (sheetName === TEMPLATE_SHEET_NAME) throw new Error("Template sheet cannot be deleted.");

  ss.deleteSheet(sh);

  return {
    success: true,
    message: "Student report deleted successfully."
  };
}

function readStudentFromSheet_(sh) {
  try {
    return {
      sheetName: sh.getName(),
      college: sh.getRange(FIELD_MAP.college).getDisplayValue() || "",
      reportPeriod: sh.getRange(FIELD_MAP.reportPeriod).getDisplayValue() || "",
      academicYearSemester: sh.getRange(FIELD_MAP.academicYearSemester).getDisplayValue() || "",
      studentName: sh.getRange(FIELD_MAP.studentName).getDisplayValue() || "",
      courseYear: sh.getRange(FIELD_MAP.courseYear).getDisplayValue() || "",
      subjects: sh.getRange(FIELD_MAP.subjects).getDisplayValue() || "",
      howFailed: sh.getRange(FIELD_MAP.howFailed).getDisplayValue() || "",
      studentAwareness: sh.getRange(FIELD_MAP.studentAwareness).getDisplayValue() || "",
      failedPassed: sh.getRange(FIELD_MAP.failedPassed).getDisplayValue() || "",
      whatHappened: sh.getRange(FIELD_MAP.whatHappened).getDisplayValue() || "",
      parentAcknowledgment: sh.getRange(FIELD_MAP.parentAcknowledgment).getDisplayValue() || "",
      ifFailedReasons: sh.getRange(FIELD_MAP.ifFailedReasons).getDisplayValue() || "",
      whenStarted: sh.getRange(FIELD_MAP.whenStarted).getDisplayValue() || "",
      remedialTeaching: sh.getRange(FIELD_MAP.remedialTeaching).getDisplayValue() || "",
      whyHappened: sh.getRange(FIELD_MAP.whyHappened).getDisplayValue() || "",
      performanceAssessment: sh.getRange(FIELD_MAP.performanceAssessment).getDisplayValue() || "",
      stoppedWithdrawDropout: sh.getRange(FIELD_MAP.stoppedWithdrawDropout).getDisplayValue() || "",
      activitiesExercisesRemoval: sh.getRange(FIELD_MAP.activitiesExercisesRemoval).getDisplayValue() || "",
      preparedBy: sh.getRange(FIELD_MAP.preparedBy).getDisplayValue() || "",
      notedBy: sh.getRange(FIELD_MAP.notedBy).getDisplayValue() || "",
      approvedBy: sh.getRange(FIELD_MAP.approvedBy).getDisplayValue() || ""
    };
  } catch (error) {
    Logger.log("readStudentFromSheet_ error: " + error);
    throw new Error("Failed to read student data: " + error.message);
  }
}

function writeStudentToSheet_(sh, data) {
  try {
    sh.getRange(FIELD_MAP.college).setValue(data.college || "");
    sh.getRange(FIELD_MAP.reportPeriod).setValue(data.reportPeriod || "");
    sh.getRange(FIELD_MAP.academicYearSemester).setValue(data.academicYearSemester || "");
    sh.getRange(FIELD_MAP.studentName).setValue(data.studentName || "");
    sh.getRange(FIELD_MAP.courseYear).setValue(data.courseYear || "");
    sh.getRange(FIELD_MAP.subjects).setValue(data.subjects || "");
    sh.getRange(FIELD_MAP.howFailed).setValue(data.howFailed || "");
    sh.getRange(FIELD_MAP.studentAwareness).setValue(data.studentAwareness || "");
    sh.getRange(FIELD_MAP.failedPassed).setValue(data.failedPassed || "");
    sh.getRange(FIELD_MAP.whatHappened).setValue(data.whatHappened || "");
    sh.getRange(FIELD_MAP.parentAcknowledgment).setValue(data.parentAcknowledgment || "");
    sh.getRange(FIELD_MAP.ifFailedReasons).setValue(data.ifFailedReasons || "");
    sh.getRange(FIELD_MAP.whenStarted).setValue(data.whenStarted || "");
    sh.getRange(FIELD_MAP.remedialTeaching).setValue(data.remedialTeaching || "");
    sh.getRange(FIELD_MAP.whyHappened).setValue(data.whyHappened || "");
    sh.getRange(FIELD_MAP.performanceAssessment).setValue(data.performanceAssessment || "");
    sh.getRange(FIELD_MAP.stoppedWithdrawDropout).setValue(data.stoppedWithdrawDropout || "");
    sh.getRange(FIELD_MAP.activitiesExercisesRemoval).setValue(data.activitiesExercisesRemoval || "");
    sh.getRange(FIELD_MAP.preparedBy).setValue(data.preparedBy || "");
    sh.getRange(FIELD_MAP.notedBy).setValue(data.notedBy || "");
    sh.getRange(FIELD_MAP.approvedBy).setValue(data.approvedBy || "");
  } catch (error) {
    Logger.log("writeStudentToSheet_ error: " + error);
    throw new Error("Failed to write student data: " + error.message);
  }
}

function validateStudentData_(data) {
  if (!data.studentName || String(data.studentName).trim() === "") {
    throw new Error("Student name is required.");
  }
}

function sanitizeSheetName_(name) {
  return String(name)
    .replace(/[\\\/\?\*\[\]\:]/g, "")
    .trim()
    .substring(0, 99);
}

function generateUniqueSheetName_(baseName, ss) {
  let counter = 2;
  let newName = `${baseName} (${counter})`;

  while (ss.getSheetByName(newName)) {
    counter++;
    newName = `${baseName} (${counter})`;
  }

  return newName;
}
