# Direct Google Sheets Scheduler (No Admin UI)

## Status
✅ **Complete** - Pure client booking, direct Sheets control.

## Quick Setup
1. **Sheet**: https://docs.google.com/spreadsheets/d/17cKxYPpqYT5AzzynZ4fdmx-bmtYNKwpn6R6dfb-GAQU/edit (tabs: Schedule, Bookings)
2. **GAS**: https://script.google.com/macros/s/AKfycbwXjJNP2EDhIRwrvmEsdfRzcA5NyIlkeR3IG7KhHJXiFdo_TlJDTNCvFwRW8gIpKW43/exec
3. Open `index.html` - **Live sync** to Sheets + local fallback.

## Usage
**Manage Schedule Directly in Sheets:**
```
Schedule tab → A1: ["9:00 AM", "10:30 AM", "2:00 PM"]
```
- Available slots show immediately on refresh
- Client bookings auto-save to Bookings tab A1 (JSON object)

**Features:**
- 🔄 Live Google Sheets sync (Schedule/Bookings tabs)
- 💾 Offline fallback (localStorage)
- ⏳ Loading states & error toasts
- 📱 Fully responsive

## Test
```
start index.html
```
Add times to Sheet → refresh → book → watch bookings update!

## Backend
- **Code.gs**: Deployed GAS proxy (handles CORS)
- Data stored as JSON in Sheet A1 cells

**No admin UI** - Pure Sheets control as requested!

Live & ready.
