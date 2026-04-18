function doGet(e) {
  return handleRequest(e || {});
}

function doPost(e) {
  let jsonData = {};
  try {
    jsonData = JSON.parse(e.postData.contents || '{}');
  } catch (err) {}
  return handleRequest(jsonData);
}

function handleRequest(params) {
  const action = params.action || (params.parameter && params.parameter.action);
  const sheetName = params.sheet || (params.parameter && params.parameter.sheet);
  
  let data = params.data;
  // If data came through a GET request query parameter, it will be a string that needs parsing
  if (!data && params.parameter && params.parameter.data) {
    try {
      data = JSON.parse(params.parameter.data);
    } catch(e) {
      data = params.parameter.data;
    }
  }
  
  try {
    const sheetId = '17cKxYPpqYT5AzzynZ4fdmx-bmtYNKwpn6R6dfb-GAQU';
    const ss = SpreadsheetApp.openById(sheetId);
    
    // ========== ATOMIC BOOK (Race-condition safe) ==========
    if (action === 'ATOMIC_BOOK') {
      var slot = (params.parameter && params.parameter.slot) || (data && data.slot);
      var name = (params.parameter && params.parameter.name) || (data && data.name);
      
      if (!slot || !name) {
        return jsonResponse({success: false, error: 'Missing slot or name'});
      }
      
      // Use LockService to prevent concurrent writes
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(10000); // Wait up to 10 seconds for the lock
      } catch (e) {
        return jsonResponse({success: false, error: 'Server busy, please try again'});
      }
      
      try {
        var bookingsSheet = ss.getSheetByName('Bookings');
        var raw = bookingsSheet.getRange('A1').getValue();
        var bookings = {};
        if (raw) {
          try { bookings = JSON.parse(raw); } catch(e) { bookings = {}; }
        }
        
        // Check if already booked
        if (bookings[slot]) {
          lock.releaseLock();
          return jsonResponse({success: false, error: 'already_booked', bookedBy: bookings[slot]});
        }
        
        // Book it atomically
        bookings[slot] = name;
        bookingsSheet.getRange('A1').setValue(JSON.stringify(bookings));
        lock.releaseLock();
        
        return jsonResponse({success: true, data: bookings});
      } catch (err) {
        lock.releaseLock();
        return jsonResponse({success: false, error: err.toString()});
      }
    }
    
    // ========== ATOMIC UNBOOK (Race-condition safe) ==========
    if (action === 'ATOMIC_UNBOOK') {
      var slot = (params.parameter && params.parameter.slot) || (data && data.slot);
      
      if (!slot) {
        return jsonResponse({success: false, error: 'Missing slot'});
      }
      
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(10000);
      } catch (e) {
        return jsonResponse({success: false, error: 'Server busy, please try again'});
      }
      
      try {
        var bookingsSheet = ss.getSheetByName('Bookings');
        var raw = bookingsSheet.getRange('A1').getValue();
        var bookings = {};
        if (raw) {
          try { bookings = JSON.parse(raw); } catch(e) { bookings = {}; }
        }
        
        delete bookings[slot];
        bookingsSheet.getRange('A1').setValue(JSON.stringify(bookings));
        lock.releaseLock();
        
        return jsonResponse({success: true, data: bookings});
      } catch (err) {
        lock.releaseLock();
        return jsonResponse({success: false, error: err.toString()});
      }
    }
    
    // ========== Standard GET ==========
    var sheet = ss.getSheetByName(sheetName);
    
    if (action === 'GET') {
      var value = sheet.getRange('A1').getValue();
      var defaultValue = sheetName === 'Schedule' ? [] : {};
      var result = value || defaultValue;
      return jsonResponse({success: true, data: result});
    } 
    
    // ========== Standard POST ==========
    if (action === 'POST' && data !== undefined) {
      var dataToSave = typeof data === 'string' ? data : JSON.stringify(data);
      sheet.getRange('A1').setValue(dataToSave);
      return jsonResponse({success: true});
    }
  } catch (error) {
    return jsonResponse({success: false, error: error.toString()});
  }
  
  return jsonResponse({success: false, error: 'Invalid action or missing data'});
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}
