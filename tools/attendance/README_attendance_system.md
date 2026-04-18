# Attendance System — Setup & Notes

Quick starter instructions for the provided Student UI and Apps Script backend.

1) Create a Google Spreadsheet to act as the database
   - Create a new Google Sheet and note its spreadsheet ID (in the URL).
   - Optional: create sheets named: `Roster`, `Attendance`, `DeviceBlocks`, `Config` (Apps Script will create them if missing).

2) Configure the Apps Script
   - Open the Apps Script editor (https://script.google.com) and create a new project.
   - Copy the contents of `apps_script/Code.gs` into the project.
   - Replace `SPREADSHEET_ID` with your spreadsheet ID and set `ADMIN_SECRET` to a strong secret.
   - Save and deploy the script as a Web App (Execute as: Me, Who has access: Anyone, even anonymous) — note the deployment URL.

3) Configure the Student UI
   - Open `student.js` and set `BACKEND_URL` to the deployed Apps Script web app URL.
   - Serve `student.html` (static file) e.g., upload to your web server or open locally on the student's phone.

4) Admin / Teacher flow
   - Use your existing `attendance.html` admin page for UI; it can be extended to POST a roster JSON to the Apps Script `upload_roster` action.
   - To upload/update roster programmatically: POST JSON { action: 'upload_roster', adminSecret: 'YOUR_SECRET', roster: [ {section:'Section A', name:'Lastname, First M'}, ... ] } to the Apps Script URL.
   - Use `set_active_section` to mark which section is currently accepting check-ins: POST { action:'set_active_section', adminSecret:'YOUR_SECRET', section:'Section A' }.

5) Notes & limitations
   - Apps Script cannot reliably surface the client's public IP for every environment; this starter uses a browser fingerprint (SHA-256 of UA + device info) for cooldown/blocking. For IP-based checks use a server you control.
   - Geofence is enforced server-side (100 meters from school center). The client also checks location for quick feedback.
   - Name matching uses normalization + token checks + a small edit-distance fallback (levenshtein<=1). This reduces false positives, but may need tuning for your dataset.

6) Next steps you may want
   - Add an Admin endpoint to return roster + live attendance for the admin UI (Apps Script `get_attendance` and `get_roster` are provided).
   - Tighten security: require OAuth for admin operations, or host a small Node/Express server to gain access to request IP addresses.
   - Improve fingerprinting (use fingerprintjs2 or similar) and add more robust rate-limiting.

Files added:
- [student.html](student.html)
- [student.js](student.js)
- [apps_script/Code.gs](apps_script/Code.gs)
