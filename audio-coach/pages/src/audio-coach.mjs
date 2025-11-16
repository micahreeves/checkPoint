/**
 * Audio Coach - Voice-guided coaching for Zwift
 * Provides audio alerts for power zones, intervals, climbs, and pacing
 */

import * as common from '/pages/src/common.mjs';

// Audio utility class for text-to-speech and sound effects
export class AudioEngine {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.currentUtterance = null;
        this.enabled = true;
        this.volume = 0.8;
        this.rate = 1.0;
        this.pitch = 1.0;
        this.preferredVoice = null;

        // Queue for managing multiple audio alerts
        this.queue = [];
        this.isPlaying = false;

        // Load voices when available
        this.loadVoices();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }

        // Sound effect audio elements
        this.sounds = {
            beep: this.createBeep(440, 0.1),      // 440Hz beep
            alert: this.createBeep(880, 0.15),    // Higher alert
            success: this.createBeep(523, 0.2),   // Success tone
            warning: this.createBeep(220, 0.3),   // Warning tone
        };
    }

    loadVoices() {
        this.voices = this.synth.getVoices();
        // Prefer English voices
        this.preferredVoice = this.voices.find(v => v.lang.startsWith('en-')) || this.voices[0];
    }

    // Create a beep tone using Web Audio API
    createBeep(frequency, duration) {
        return () => {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(this.volume, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
        };
    }

    // Play a sound effect
    playSound(soundName) {
        if (!this.enabled) return;
        if (this.sounds[soundName]) {
            this.sounds[soundName]();
        }
    }

    // Speak text using text-to-speech
    speak(text, options = {}) {
        if (!this.enabled) return Promise.resolve();

        return new Promise((resolve, reject) => {
            // Cancel current speech if interrupting
            if (options.interrupt) {
                this.synth.cancel();
                this.queue = [];
            }

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = this.preferredVoice;
            utterance.volume = options.volume ?? this.volume;
            utterance.rate = options.rate ?? this.rate;
            utterance.pitch = options.pitch ?? this.pitch;

            utterance.onend = () => {
                this.isPlaying = false;
                resolve();
                this.processQueue();
            };

            utterance.onerror = (event) => {
                this.isPlaying = false;
                console.error('Speech synthesis error:', event);
                reject(event);
                this.processQueue();
            };

            // Add to queue or speak immediately
            if (this.isPlaying && !options.interrupt) {
                this.queue.push(utterance);
            } else {
                this.isPlaying = true;
                this.synth.speak(utterance);
                this.currentUtterance = utterance;
            }
        });
    }

    processQueue() {
        if (this.queue.length > 0 && !this.isPlaying) {
            const utterance = this.queue.shift();
            this.isPlaying = true;
            this.synth.speak(utterance);
            this.currentUtterance = utterance;
        }
    }

    // Stop all audio
    stop() {
        this.synth.cancel();
        this.queue = [];
        this.isPlaying = false;
    }

    // Test speech
    test(text = "Audio coach is working correctly") {
        this.speak(text, { interrupt: true });
    }
}

// Power Zone Monitor - alerts when leaving target zones
export class PowerZoneMonitor {
    constructor(audioEngine, settings) {
        this.audio = audioEngine;
        this.settings = settings;
        this.currentZone = null;
        this.timeInZone = 0;
        this.lastAlert = 0;
        this.alertCooldown = 10000; // 10 seconds between alerts
    }

    update(power, ftp, timestamp) {
        if (!this.settings.powerZoneAlerts || !ftp) return;

        const zone = this.getPowerZone(power, ftp);

        // Zone changed
        if (zone !== this.currentZone) {
            this.currentZone = zone;
            this.timeInZone = 0;

            if (this.settings.announceZoneChanges) {
                this.announceZone(zone);
            }
        } else {
            this.timeInZone += 1;
        }

        // Check if outside target zone
        if (this.settings.targetZone && zone !== this.settings.targetZone) {
            const now = Date.now();
            if (now - this.lastAlert > this.alertCooldown) {
                this.alertOutOfZone(zone, this.settings.targetZone);
                this.lastAlert = now;
            }
        }
    }

    getPowerZone(power, ftp) {
        const percent = (power / ftp) * 100;
        if (percent < 55) return 1;
        if (percent < 75) return 2;
        if (percent < 90) return 3;
        if (percent < 105) return 4;
        if (percent < 120) return 5;
        return 6;
    }

    announceZone(zone) {
        const zoneNames = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2 Max', 'Anaerobic'];
        this.audio.speak(`Zone ${zone}`);
    }

    alertOutOfZone(currentZone, targetZone) {
        if (currentZone < targetZone) {
            this.audio.speak("Power too low", { interrupt: false });
        } else {
            this.audio.speak("Power too high", { interrupt: false });
        }
    }
}

// Interval Timer - audio cues for structured workouts
export class IntervalTimer {
    constructor(audioEngine, settings) {
        this.audio = audioEngine;
        this.settings = settings;
        this.intervals = [];
        this.currentInterval = -1;
        this.intervalStartTime = 0;
        this.isActive = false;
    }

    // Define intervals: [{duration: 300, power: 250, name: "Warmup"}, ...]
    setIntervals(intervals) {
        this.intervals = intervals;
        this.currentInterval = -1;
        this.isActive = false;
    }

    start(timestamp) {
        if (this.intervals.length === 0) return;
        this.currentInterval = 0;
        this.intervalStartTime = timestamp;
        this.isActive = true;
        this.announceInterval(this.intervals[0]);
    }

    update(timestamp) {
        if (!this.isActive || this.currentInterval < 0) return null;

        const elapsed = (timestamp - this.intervalStartTime) / 1000;
        const current = this.intervals[this.currentInterval];

        if (!current) {
            this.isActive = false;
            this.audio.speak("Workout complete!");
            this.audio.playSound('success');
            return null;
        }

        const remaining = current.duration - elapsed;

        // Countdown alerts
        if (this.settings.countdownAlerts) {
            if (Math.abs(remaining - 10) < 0.5) {
                this.audio.speak("10 seconds");
            } else if (Math.abs(remaining - 5) < 0.5) {
                this.audio.playSound('beep');
            } else if (Math.abs(remaining - 3) < 0.5) {
                this.audio.playSound('beep');
            }
        }

        // Move to next interval
        if (remaining <= 0) {
            this.currentInterval++;
            this.intervalStartTime = timestamp;
            if (this.currentInterval < this.intervals.length) {
                this.announceInterval(this.intervals[this.currentInterval]);
            }
        }

        return {
            interval: current,
            elapsed,
            remaining: Math.max(0, remaining),
            index: this.currentInterval,
            total: this.intervals.length
        };
    }

    announceInterval(interval) {
        const minutes = Math.floor(interval.duration / 60);
        const seconds = interval.duration % 60;
        let announcement = interval.name || "Interval";

        if (interval.power) {
            announcement += ` at ${interval.power} watts`;
        }

        announcement += ` for ${minutes} minutes`;
        if (seconds > 0) {
            announcement += ` ${seconds} seconds`;
        }

        this.audio.speak(announcement, { interrupt: true });
        this.audio.playSound('alert');
    }

    stop() {
        this.isActive = false;
        this.currentInterval = -1;
    }
}

// Climb Detector - alerts when climbs start/end
export class ClimbDetector {
    constructor(audioEngine, settings) {
        this.audio = audioEngine;
        this.settings = settings;
        this.isClimbing = false;
        this.climbStartAltitude = 0;
        this.climbStartTime = 0;
        this.altitudeHistory = [];
        this.historySize = 10; // Track last 10 readings
    }

    update(altitude, timestamp) {
        if (!this.settings.climbAlerts) return;

        this.altitudeHistory.push(altitude);
        if (this.altitudeHistory.length > this.historySize) {
            this.altitudeHistory.shift();
        }

        if (this.altitudeHistory.length < this.historySize) return;

        // Calculate gradient
        const gradient = this.calculateGradient();
        const threshold = this.settings.climbGradientThreshold || 3.0;

        if (!this.isClimbing && gradient > threshold) {
            // Climb started
            this.isClimbing = true;
            this.climbStartAltitude = altitude;
            this.climbStartTime = timestamp;
            this.announceClimbStart(gradient);
        } else if (this.isClimbing && gradient < threshold * 0.5) {
            // Climb ended
            const elevation = altitude - this.climbStartAltitude;
            const duration = (timestamp - this.climbStartTime) / 1000;
            this.announceClimbEnd(elevation, duration);
            this.isClimbing = false;
        }
    }

    calculateGradient() {
        if (this.altitudeHistory.length < 2) return 0;
        const altChange = this.altitudeHistory[this.altitudeHistory.length - 1] - this.altitudeHistory[0];
        // Assuming ~1 reading per second and ~5 m/s average speed = ~50m distance
        const distance = this.historySize * 5;
        return (altChange / distance) * 100;
    }

    announceClimbStart(gradient) {
        this.audio.speak(`Climb detected, ${gradient.toFixed(1)} percent gradient`, { interrupt: false });
        this.audio.playSound('alert');
    }

    announceClimbEnd(elevation, duration) {
        const elevationMeters = Math.round(elevation);
        const minutes = Math.floor(duration / 60);
        const seconds = Math.round(duration % 60);

        let announcement = `Climb complete, ${elevationMeters} meters`;
        if (minutes > 0) {
            announcement += ` in ${minutes} minutes`;
            if (seconds > 0) announcement += ` ${seconds} seconds`;
        } else {
            announcement += ` in ${seconds} seconds`;
        }

        this.audio.speak(announcement, { interrupt: false });
        this.audio.playSound('success');
    }
}

// Pacing Monitor - alerts when pace is too fast/slow
export class PacingMonitor {
    constructor(audioEngine, settings) {
        this.audio = audioEngine;
        this.settings = settings;
        this.lastAlert = 0;
        this.alertCooldown = 15000; // 15 seconds between alerts
    }

    update(currentPower, targetPower, timestamp) {
        if (!this.settings.pacingAlerts || !targetPower) return;

        const deviation = ((currentPower - targetPower) / targetPower) * 100;
        const threshold = this.settings.pacingThreshold || 10; // 10% default

        const now = Date.now();
        if (now - this.lastAlert < this.alertCooldown) return;

        if (deviation > threshold) {
            this.audio.speak("Ease up, power too high", { interrupt: false });
            this.audio.playSound('warning');
            this.lastAlert = now;
        } else if (deviation < -threshold) {
            this.audio.speak("Pick it up, power too low", { interrupt: false });
            this.audio.playSound('warning');
            this.lastAlert = now;
        }
    }
}

// Main Audio Coach Controller
export class AudioCoach {
    constructor() {
        this.audio = new AudioEngine();
        this.settings = this.loadSettings();

        this.powerZoneMonitor = new PowerZoneMonitor(this.audio, this.settings);
        this.intervalTimer = new IntervalTimer(this.audio, this.settings);
        this.climbDetector = new ClimbDetector(this.audio, this.settings);
        this.pacingMonitor = new PacingMonitor(this.audio, this.settings);

        this.ftp = this.settings.ftp || 200; // Default FTP
        this.isActive = false;
    }

    loadSettings() {
        const store = common.settingsStore;
        return {
            enabled: store.get('enabled', true),
            volume: store.get('volume', 0.8),
            powerZoneAlerts: store.get('powerZoneAlerts', true),
            announceZoneChanges: store.get('announceZoneChanges', true),
            targetZone: store.get('targetZone', null),
            climbAlerts: store.get('climbAlerts', true),
            climbGradientThreshold: store.get('climbGradientThreshold', 3.0),
            pacingAlerts: store.get('pacingAlerts', true),
            pacingThreshold: store.get('pacingThreshold', 10),
            countdownAlerts: store.get('countdownAlerts', true),
            ftp: store.get('ftp', 200),
        };
    }

    saveSettings() {
        const store = common.settingsStore;
        for (const [key, value] of Object.entries(this.settings)) {
            store.set(key, value);
        }
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.audio.enabled = this.settings.enabled;
        this.audio.volume = this.settings.volume;
        this.saveSettings();
    }

    start() {
        this.isActive = true;
        this.audio.speak("Audio coach activated", { interrupt: true });
    }

    stop() {
        this.isActive = false;
        this.audio.stop();
    }

    // Main update loop - called from game state subscription
    update(states) {
        if (!this.isActive || !this.settings.enabled) return;

        const athlete = states.watching || states.self;
        if (!athlete) return;

        const timestamp = Date.now();

        // Update all monitors
        if (athlete.power !== undefined) {
            this.powerZoneMonitor.update(athlete.power, this.ftp, timestamp);

            // Update pacing if we have a target (from interval or manual setting)
            const intervalState = this.intervalTimer.update(timestamp);
            if (intervalState && intervalState.interval.power) {
                this.pacingMonitor.update(athlete.power, intervalState.interval.power, timestamp);
            }
        }

        if (athlete.altitude !== undefined) {
            this.climbDetector.update(athlete.altitude, timestamp);
        }
    }

    // Utility methods for UI
    testAudio() {
        this.audio.test();
    }

    testBeep() {
        this.audio.playSound('beep');
    }

    testAlert() {
        this.audio.playSound('alert');
    }

    setIntervals(intervals) {
        this.intervalTimer.setIntervals(intervals);
    }

    startInterval() {
        this.intervalTimer.start(Date.now());
    }

    stopInterval() {
        this.intervalTimer.stop();
    }
}

// Export singleton instance
export const audioCoach = new AudioCoach();

// Main entry point
export async function main() {
    console.log('Audio Coach MOD loading...');

    // Initialize interaction listeners
    common.initInteractionListeners();

    // Subscribe to game state updates
    common.subscribe('states', (states) => {
        audioCoach.update(states);
    });

    console.log('Audio Coach MOD loaded successfully');
}
