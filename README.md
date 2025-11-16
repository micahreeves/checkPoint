# Zwift Checkpoint Tracker with FIT File Comparison

A Sauce4Zwift mod that displays checkpoint times from uploaded .fit files and allows comparing multiple attempts.

## Features

### 🎯 Core Features
- **FIT File Upload** - Upload your Zwift .fit files to see checkpoint times on the map
- **Automatic Checkpoints** - Generates checkpoints every 1km along your route
- **Time Display** - Shows elapsed time at each checkpoint coordinate
- **Multiple Attempts** - Upload multiple .fit files to compare performances
- **Side-by-Side Comparison** - Compare checkpoint times between two attempts
- **Map Visualization** - See your route and checkpoints on the Zwift map

### 📂 What You Can Do

1. **Upload a .fit file** → See your route with checkpoint times
2. **Upload multiple files** → Compare different attempts
3. **View times** → Click checkpoints to see exact times at each coordinate
4. **Compare performances** → Delta times show where you gained/lost time

## How to Use

### Step 1: Upload a .fit File

1. Open the Checkpoint Tracker window in Sauce4Zwift
2. Click the **📂** button in the title bar
3. Select a .fit file from your computer
4. The route will load on the map with checkpoints every 1km

### Step 2: View Checkpoint Times

- Checkpoints appear as markers on the map
- The right panel shows all checkpoints with times:
  - **Green** = Start
  - **Blue** = Intermediate (1km, 2km, 3km, etc.)
  - **Red** = Finish
- Each checkpoint shows:
  - Distance
  - Altitude
  - **Time** (elapsed time from start)

### Step 3: Compare Multiple Attempts

1. Upload 2 or more .fit files (each upload adds an attempt)
2. Click the **📊** button to open the comparison panel
3. Select two attempts from the dropdowns
4. Click **Compare**
5. View the comparison table showing:
   - Checkpoint-by-checkpoint times
   - Delta (time difference)
   - Green rows = ahead, Red rows = behind

## File Structure

```
checkPoint/
├── checkpoint_tracker.stable checkpoint/
│   ├── manifest.json
│   └── pages/
│       ├── checkpoint_tracker.html        # Main UI
│       ├── css/checkpoint_tracker.css      # Styles + comparison panel
│       └── src/
│           ├── checkpoint_tracker.mjs      # Main logic
│           ├── fit-to-map-adapter.mjs      # FIT file converter (NEW)
│           ├── fit.parser.entry.js         # FIT parser library
│           ├── checkpoint-manager.mjs      # Checkpoint logic
│           ├── route-parser.mjs            # Route parsing
│           ├── coordinate-converter.mjs    # GPS → Zwift coords
│           ├── route-replay-manager.mjs    # Ghost rider
│           └── replay-ui-integration.mjs   # UI integration
│
├── elevationCheckpointv2/                   # Elevation profile (separate tool)
└── sauce4zwift-main/                        # Core framework
```

## Technical Details

### FIT File Processing

1. **Parse FIT file** - Extracts GPS coordinates, timestamps, power, heart rate, etc.
2. **Auto-detect route** - Identifies Zwift world from GPS coordinates
3. **Convert coordinates** - GPS (lat/lng) → Zwift map coordinates (x,y)
4. **Generate checkpoints** - Creates markers every 1km with telemetry data
5. **Display on map** - Shows route polyline and checkpoint markers

### Checkpoint Data Structure

Each checkpoint contains:
```javascript
{
  name: "2.5km",
  coordinates: [x, y],        // Zwift coordinates
  gpsCoordinates: [lat, lng], // Original GPS
  distance: 2500,              // meters from start
  time: 450,                   // seconds from start
  altitude: 125,               // meters
  power: 245,                  // watts (average)
  heartRate: 165,              // bpm
  type: "checkpoint"           // start | checkpoint | finish
}
```

### Comparison Algorithm

The comparison system:
1. Stores each uploaded .fit file as an "attempt"
2. Matches checkpoints by distance
3. Calculates delta: `attempt1.time - attempt2.time`
4. Displays results:
   - Negative delta (green) = faster
   - Positive delta (red) = slower

## Supported FIT Files

- ✅ Zwift .fit files (activity exports)
- ✅ Garmin/Wahoo .fit files (if on Zwift routes)
- ✅ Any .fit file with GPS + timestamp data

## Zwift Worlds Supported

- Watopia
- France
- Yorkshire
- London
- New York
- Innsbruck
- Bologna
- Richmond
- Makuri Islands
- Paris
- Scotland

## Known Limitations

1. **GPS matching** - FIT files must be from Zwift (or have matching GPS coordinates)
2. **Checkpoint alignment** - Comparison works best when routes are similar length
3. **1km intervals** - Checkpoints are fixed at 1km spacing (not customizable yet)
4. **World detection** - Auto-detection works for major worlds; may default to Watopia

## Future Enhancements

Potential improvements:
- [ ] Custom checkpoint intervals (500m, 2km, etc.)
- [ ] Segment-specific comparisons
- [ ] Personal best tracking with persistent storage
- [ ] Export comparison reports
- [ ] Telemetry charts (power/HR over time)
- [ ] Leaderboard for multiple attempts

## Troubleshooting

### FIT file won't upload
- Check the file is a valid .fit file
- Verify it contains GPS coordinate data
- Try re-exporting from Zwift/Garmin Connect

### Checkpoints not showing times
- Ensure the .fit file has timestamp data
- Check browser console for parsing errors

### Comparison panel empty
- Upload at least 2 .fit files first
- Select different attempts in both dropdowns

### Map not showing route
- Verify GPS coordinates are valid
- Check if world was auto-detected correctly
- Try manually selecting the world (future feature)

## Debug Console Functions

Available in browser console:
```javascript
// View current route and checkpoint data
debugRouteData()

// Clear all routes and attempts
fitAdapter.clearAttempts()

// View all stored attempts
fitAdapter.getAllAttempts()
```

## Credits

- **Sauce4Zwift** - Core framework and map system
- **fit-file-parser** - FIT file parsing library
- **Zwift** - Route data and coordinates

## License

Part of the Sauce4Zwift ecosystem. See main Sauce license for details.

---

**Version:** 1.0.0
**Last Updated:** 2024
**Author:** Enhanced with FIT comparison features
