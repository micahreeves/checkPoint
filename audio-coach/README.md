# Audio Coach - Zwift MOD

Voice-guided coaching for Zwift with real-time audio alerts for power zones, intervals, climbs, and pacing.

## Features

### 🎯 Power Zone Alerts
- Announces when you change power zones
- Alerts when you drift outside your target zone
- Customizable zone targets based on your FTP
- Supports all 6 power zones (Recovery through Anaerobic)

### ⏱️ Interval Timer
- Pre-built workout templates (warmup, FTP test, VO2 max, threshold)
- Custom interval creation
- Audio countdown alerts (10s, 5s, 3s)
- Automatic progression through workout steps
- Power target announcements for each interval

### ⛰️ Climb Detection
- Automatically detects when climbs start
- Announces climb statistics when complete
- Customizable gradient threshold
- Real-time elevation tracking

### 📊 Pacing Monitor
- Alerts when power deviates from target
- Customizable deviation threshold
- Helps maintain consistent effort
- Perfect for time trials and steady-state training

### 🔊 Audio Features
- Text-to-speech using Web Speech API
- Multiple voice options
- Sound effects (beeps, alerts, success tones)
- Volume control
- Smart queuing system prevents overlapping announcements

## Installation

1. Copy the `audio-coach` folder to your Sauce4Zwift MODs directory:
   - **Windows**: `%USERPROFILE%\Documents\SauceMods\`
   - **macOS**: `~/Documents/SauceMods/`
   - **Linux**: `~/Documents/SauceMods/`

2. Restart Sauce4Zwift or reload MODs

3. Enable the Audio Coach MOD from the Sauce4Zwift MODs menu

4. Open the Audio Coach window

## Usage

### Quick Start

1. **Set your FTP** in the Settings tab
2. Click **"Start Coaching"** to activate audio alerts
3. Start riding in Zwift - the coach will automatically provide feedback

### Power Zone Training

1. Go to **Settings** tab
2. Enable **Power Zone Alerts**
3. Optionally set a **Target Zone** for your workout
4. The coach will alert you when you leave your target zone

### Interval Workouts

1. Go to **Intervals** tab
2. Select a pre-built workout template OR create custom intervals
3. Click **"Start Workout"** when ready to begin your ride
4. The coach will guide you through each interval with audio cues

**Pre-built Workouts:**
- **5min Warmup** - Easy warmup at low power
- **20min FTP Test** - Warmup + 20min all-out test + cooldown
- **5x3min VO2 Max** - High-intensity intervals with recovery
- **3x10min Threshold** - Sustained threshold intervals

### Climb Alerts

1. Enable **Climb Detection** in Settings
2. Adjust **Gradient Threshold** (default 3%)
3. Coach announces when climbs start and provides stats when complete

### Live Stats

View real-time data in the **Live Stats** tab:
- Current power and power zone
- Heart rate and cadence
- Altitude and speed
- Activity log of all announcements

### Testing Audio

Use the **Test Audio** tab to:
- Test speech synthesis
- Try different sound effects
- Test zone announcements
- Select preferred voice
- Speak custom messages

## Settings Reference

### General Settings
- **Enable Audio Alerts** - Master on/off switch
- **Volume** - Adjust audio volume (0-100%)
- **FTP** - Your Functional Threshold Power in watts

### Power Zone Alerts
- **Enable Power Zone Alerts** - Turn zone monitoring on/off
- **Announce Zone Changes** - Speak when entering new zone
- **Target Zone** - Set specific zone to maintain (optional)

### Climb Alerts
- **Enable Climb Detection** - Auto-detect climbs
- **Gradient Threshold** - Minimum gradient % to trigger (default 3%)

### Pacing Alerts
- **Enable Pacing Alerts** - Monitor deviation from target power
- **Deviation Threshold** - % variance allowed before alert (default 10%)

### Interval Settings
- **Enable Countdown Alerts** - Audio countdown at end of intervals

## Technical Details

### Audio System
- Uses **Web Speech API** for text-to-speech
- **Web Audio API** for sound effects
- Smart queuing prevents overlapping announcements
- Interrupt mode for urgent alerts

### Power Zones (% of FTP)
1. **Recovery**: <55%
2. **Endurance**: 55-75%
3. **Tempo**: 75-90%
4. **Threshold**: 90-105%
5. **VO2 Max**: 105-120%
6. **Anaerobic**: >120%

### Alert Cooldowns
- Power zone alerts: 10 seconds between repeats
- Pacing alerts: 15 seconds between repeats
- Prevents alert spam during transitional efforts

## Tips

1. **Adjust Volume**: Set lower volume if alerts are distracting during hard efforts
2. **Target Zones**: Use Zone 2 target for endurance rides, Zone 4 for threshold work
3. **Climb Threshold**: Reduce to 2% for detecting gradual climbs, increase to 5% for only steep climbs
4. **Voice Selection**: Choose a voice that's clear and easy to understand at different effort levels
5. **Intervals**: Test your workout with "Test Audio" before starting your ride

## Browser Compatibility

The Audio Coach MOD requires:
- **Web Speech API** support (Chrome, Edge, Safari)
- **Web Audio API** support (all modern browsers)

Note: Firefox has limited speech synthesis voice support.

## Troubleshooting

### No audio output
1. Check system volume and browser permissions
2. Test audio in the "Test Audio" tab
3. Ensure "Enable Audio Alerts" is checked
4. Try a different voice in voice selection

### Voices not loading
1. Wait a few seconds after opening the MOD
2. Refresh the page
3. Check browser console for errors

### Alerts not triggering
1. Verify you've clicked "Start Coaching"
2. Check that specific alert type is enabled in Settings
3. Ensure you're actually in an activity in Zwift
4. Check the Live Stats tab to confirm data is flowing

### Interval timer not working
1. Select a workout template or create custom intervals
2. Click "Start Workout" AFTER starting your Zwift activity
3. Check countdown alerts are enabled

## Development

The Audio Coach MOD consists of:

- `manifest.json` - MOD configuration
- `pages/audio-coach.html` - Main UI
- `pages/css/audio-coach.css` - Styling
- `pages/src/audio-coach.mjs` - Core logic

### Key Classes

- **AudioEngine** - TTS and sound effect management
- **PowerZoneMonitor** - Power zone tracking and alerts
- **IntervalTimer** - Structured workout management
- **ClimbDetector** - Gradient-based climb detection
- **PacingMonitor** - Target power deviation alerts
- **AudioCoach** - Main controller orchestrating all features

## Future Enhancements

Potential additions:
- Heart rate zone monitoring
- Cadence optimization alerts
- Custom audio files for alerts
- Multi-language support
- Export/import workout files
- Integration with TrainingPeaks or similar platforms
- Group ride coordination alerts

## License

Part of the Sauce4Zwift MOD ecosystem.

## Credits

Built for the Zwift MOD Framework (Sauce4Zwift)

---

Enjoy your rides with Audio Coach! 🚴‍♂️🔊
