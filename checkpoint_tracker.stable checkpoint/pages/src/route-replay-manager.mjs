// route-replay-manager.mjs - Enhanced Route Replay with Personal Best Racing (COMPLETE FIXED VERSION)

import * as locale from '/shared/sauce/locale.mjs';
import * as common from '/pages/src/common.mjs';

const H = locale.human;

export class RouteReplayManager {
    constructor(zwiftMap, checkpointManager) {
        this.zwiftMap = zwiftMap;
        this.checkpointManager = checkpointManager;
        this.historicalData = null;
        this.replayMode = false;
        this.replayPosition = 0;
        this.replaySpeed = 1; // 1x speed
        this.replayInterval = null;
        this.ghostRider = null;
        this.progressLine = null;
        this.personalBestData = null;
        this.comparisonMode = false;
        this.timeOffsets = [];
        this.settings = {
            showGhostRider: true,
            showProgressLine: true,
            showComparison: true,
            ghostOpacity: 0.8,
            updateInterval: 100 // ms
        };
    }

    /**
     * Load historical route data from the JSON
     */
    loadHistoricalData(routeData) {
        console.log('Loading historical data for Ghost Rider...');
        
        if (!routeData) {
            console.warn('No route data provided');
            return false;
        }

        if (!routeData.telemetry) {
            console.warn('No telemetry data available for replay');
            return false;
        }

        // Log what telemetry fields we have
        console.log('Available telemetry fields:', Object.keys(routeData.telemetry));
        console.log('Telemetry data lengths:', {
            time: routeData.telemetry.time?.length,
            timeInS: routeData.telemetry.timeInS?.length,
            distance: routeData.telemetry.distance?.length,
            distanceInCm: routeData.telemetry.distanceInCm?.length,
            speed: routeData.telemetry.speed?.length,
            speedInCmPerSec: routeData.telemetry.speedInCmPerSec?.length,
            power: routeData.telemetry.power?.length,
            watts: routeData.telemetry.watts?.length,
            heartRate: routeData.telemetry.heartRate?.length,
            heartrate: routeData.telemetry.heartrate?.length,
            altitude: routeData.telemetry.altitude?.length,
            altitudeInCm: routeData.telemetry.altitudeInCm?.length
        });

        // Normalize telemetry field names (Zwift uses different field names sometimes)
        const normalizedTelemetry = { ...routeData.telemetry };
        
        // Handle different time field names
        if (!normalizedTelemetry.time && normalizedTelemetry.timeInS) {
            normalizedTelemetry.time = normalizedTelemetry.timeInS;
        }
        
        // Handle different distance field names
        if (!normalizedTelemetry.distance && normalizedTelemetry.distanceInCm) {
            normalizedTelemetry.distance = normalizedTelemetry.distanceInCm;
        }
        
        // Handle different speed field names
        if (!normalizedTelemetry.speed && normalizedTelemetry.speedInCmPerSec) {
            normalizedTelemetry.speed = normalizedTelemetry.speedInCmPerSec;
        }
        
        // Handle different power field names
        if (!normalizedTelemetry.power && normalizedTelemetry.watts) {
            normalizedTelemetry.power = normalizedTelemetry.watts;
        }
        
        // Handle different altitude field names
        if (!normalizedTelemetry.altitude && normalizedTelemetry.altitudeInCm) {
            normalizedTelemetry.altitude = normalizedTelemetry.altitudeInCm;
        }
        
        // Handle different heart rate field names
        if (!normalizedTelemetry.heartRate && normalizedTelemetry.heartrate) {
            normalizedTelemetry.heartRate = normalizedTelemetry.heartrate;
        }

        // Process and validate telemetry data
        const timePoints = this.processTimePoints(normalizedTelemetry, routeData.coordinates);
        if (!timePoints || timePoints.length === 0) {
            console.warn('Could not process time points from telemetry');
            
            // Try creating a simple fallback for routes without proper telemetry
            if (routeData.coordinates && routeData.coordinates.length > 0) {
                console.log('Creating fallback time points for static route display...');
                const fallbackPoints = [];
                const coordsLength = Math.min(routeData.coordinates.length, 1000);
                
                for (let i = 0; i < coordsLength; i++) {
                    const coord = routeData.coordinates[i];
                    if (coord && Array.isArray(coord) && coord.length >= 2) {
                        fallbackPoints.push({
                            index: i,
                            time: i * 3, // 3 seconds between points
                            absoluteTime: i * 3,
                            distance: i * 50, // 50m between points
                            speed: 20, // 20 km/h default
                            power: 200, // 200w default
                            heartRate: 140, // 140 bpm default
                            cadence: 90, // 90 rpm default
                            altitude: 0,
                            coordinates: coord
                        });
                    }
                }
                
                if (fallbackPoints.length > 0) {
                    console.log(`Created ${fallbackPoints.length} fallback time points for static route`);
                    
                    this.historicalData = {
                        coordinates: routeData.coordinates,
                        telemetry: normalizedTelemetry,
                        checkpoints: routeData.checkpoints || [],
                        metadata: { ...routeData.metadata, fallbackData: true },
                        timePoints: fallbackPoints,
                        totalDuration: fallbackPoints[fallbackPoints.length - 1]?.time || 0,
                        totalDistance: fallbackPoints[fallbackPoints.length - 1]?.distance || 0
                    };
                    
                    // Don't set as personal best if it's fallback data
                    console.log('Static route loaded (no telemetry timing available)');
                    return true;
                }
            }
            
            return false;
        }

        this.historicalData = {
            coordinates: routeData.coordinates,
            telemetry: normalizedTelemetry,
            checkpoints: routeData.checkpoints || [],
            metadata: routeData.metadata || {},
            timePoints: timePoints,
            totalDuration: timePoints[timePoints.length - 1]?.time || 0,
            totalDistance: timePoints[timePoints.length - 1]?.distance || 0
        };

        // Set as personal best if it's the first or better time
        if (!this.personalBestData || 
            (this.historicalData.totalDuration > 0 && 
             this.historicalData.totalDuration < this.personalBestData.totalDuration)) {
            this.personalBestData = { ...this.historicalData };
            console.log('🏆 New personal best loaded!', {
                duration: H.timer(this.personalBestData.totalDuration),
                distance: H.distance(this.personalBestData.totalDistance, {suffix: true})
            });
        }

        console.log('✅ Historical data loaded:', {
            points: this.historicalData.coordinates.length,
            timePoints: this.historicalData.timePoints.length,
            duration: H.timer(this.historicalData.totalDuration),
            distance: H.distance(this.historicalData.totalDistance, {suffix: true}),
            checkpoints: this.historicalData.checkpoints.length,
            isPersonalBest: this.historicalData === this.personalBestData,
            hasTelemetry: !this.historicalData.metadata.fallbackData
        });

        return true;
    }

    /**
     * Process telemetry data into usable time points
     */
    processTimePoints(telemetry, coordinates) {
        console.log('Processing telemetry data:', {
            hasTime: !!telemetry.time,
            timeLength: telemetry.time?.length,
            hasDistance: !!telemetry.distance,
            distanceLength: telemetry.distance?.length,
            coordinatesLength: coordinates?.length,
            telemetryKeys: Object.keys(telemetry || {})
        });

        // Try different time field names that might exist in Zwift data
        let timeArray = null;
        if (telemetry.time && Array.isArray(telemetry.time) && telemetry.time.length > 0) {
            timeArray = telemetry.time;
        } else if (telemetry.timeInS && Array.isArray(telemetry.timeInS) && telemetry.timeInS.length > 0) {
            timeArray = telemetry.timeInS;
        } else if (telemetry.timestamp && Array.isArray(telemetry.timestamp) && telemetry.timestamp.length > 0) {
            timeArray = telemetry.timestamp;
        }

        // If no time data, try to estimate from distance and speed
        if (!timeArray && telemetry.distance && Array.isArray(telemetry.distance) && telemetry.distance.length > 0) {
            console.log('No time data found, estimating from distance...');
            timeArray = [];
            let currentTime = 0;
            
            for (let i = 0; i < telemetry.distance.length; i++) {
                timeArray.push(currentTime);
                if (i < telemetry.distance.length - 1) {
                    const distanceDelta = (telemetry.distance[i + 1] - telemetry.distance[i]) / 100; // cm to meters
                    const speed = telemetry.speed?.[i] ? (telemetry.speed[i] / 100) : 10; // cm/s to m/s, default 10 m/s
                    const timeDelta = speed > 0 ? distanceDelta / speed : 1; // seconds
                    currentTime += Math.max(0.1, timeDelta); // minimum 0.1s between points
                }
            }
            console.log('Generated time array from distance data:', timeArray.length, 'points');
        }

        if (!timeArray || timeArray.length === 0) {
            console.warn('No valid time data found in telemetry - trying fallback');
            // Last resort: create a simple time array
            const numPoints = Math.min(coordinates?.length || 0, 1000);
            if (numPoints > 0) {
                timeArray = Array.from({length: numPoints}, (_, i) => i * 2); // 2 seconds between points
                console.log('Created fallback time array:', timeArray.length, 'points');
            } else {
                return null;
            }
        }

        const timePoints = [];
        const startTime = timeArray[0] || 0;
        const maxPoints = Math.min(timeArray.length, coordinates?.length || 0, 5000); // Limit to 5000 points max

        console.log(`Processing ${maxPoints} time points...`);

        for (let i = 0; i < maxPoints; i++) {
            // Ensure we have coordinates for this point
            const coord = coordinates?.[i];
            if (!coord || !Array.isArray(coord) || coord.length < 2) {
                continue; // Skip invalid coordinates
            }

            // Convert coordinates - handle both [lat,lng] and [x,y] formats
            let finalCoords = coord;
            
            // Check if these look like GPS coordinates (lat/lng)
            const [first, second] = coord;
            const isGPS = Math.abs(first) <= 90 && Math.abs(second) <= 180;
            
            if (isGPS) {
                // Convert GPS to Zwift coordinates using the coordinate converter
                try {
                    // Import the conversion function (this would need to be available)
                    // For now, use a simple conversion - you may need to adjust this
                    finalCoords = [
                        (second + 165.802) * 500000, // lng to x
                        (first + 10.384) * 500000    // lat to y
                    ];
                    console.log(`Converted GPS [${first}, ${second}] to Zwift [${finalCoords[0].toFixed(2)}, ${finalCoords[1].toFixed(2)}]`);
                } catch (error) {
                    console.warn('GPS conversion failed, using original coordinates:', error);
                    finalCoords = coord;
                }
            }

            const point = {
                index: i,
                time: (timeArray[i] || 0) - startTime, // Relative time from start
                absoluteTime: timeArray[i] || 0,
                distance: telemetry.distance?.[i] ? (telemetry.distance[i] / 100) : (i * 20), // Convert cm to meters, or estimate
                speed: telemetry.speed?.[i] ? (telemetry.speed[i] / 100 * 3.6) : 15, // Convert cm/s to km/h, or default
                power: telemetry.power?.[i] || telemetry.watts?.[i] || 0,
                heartRate: telemetry.heartRate?.[i] || telemetry.heartrate?.[i] || 0,
                cadence: telemetry.cadence?.[i] || 0,
                altitude: telemetry.altitude?.[i] ? (telemetry.altitude[i] / 100) : 0, // Convert cm to meters
                coordinates: finalCoords // Use converted coordinates
            };

            // Validate the point has minimum required data
            if (point.time >= 0 && point.coordinates && point.coordinates.length >= 2) {
                timePoints.push(point);
            }
        }

        console.log(`Processed ${timePoints.length} valid time points from ${maxPoints} input points`);
        
        if (timePoints.length === 0) {
            console.warn('No valid time points could be created');
            return null;
        }

        // Sort by time to ensure proper ordering
        timePoints.sort((a, b) => a.time - b.time);

        console.log('Time points processing complete:', {
            totalPoints: timePoints.length,
            firstTime: timePoints[0]?.time,
            lastTime: timePoints[timePoints.length - 1]?.time,
            duration: timePoints[timePoints.length - 1]?.time - timePoints[0]?.time,
            hasValidCoordinates: timePoints.every(p => p.coordinates?.length >= 2),
            sampleCoordinates: timePoints.slice(0, 3).map(p => p.coordinates)
        });

        return timePoints;
    }

    /**
     * Toggle replay mode
     */
    toggleReplay() {
        if (!this.historicalData) {
            this.showNotification('Load a route with telemetry data first', 'error');
            return false;
        }

        this.replayMode = !this.replayMode;

        if (this.replayMode) {
            this.startReplay();
        } else {
            this.stopReplay();
        }

        return this.replayMode;
    }

    /**
     * Start the replay with ghost rider
     */
    startReplay() {
        console.log('🚀 Starting route replay with ghost rider...');
        this.replayPosition = 0;
        this.timeOffsets = [];

        // Add ghost rider to map
        if (this.zwiftMap && this.settings.showGhostRider && this.historicalData.coordinates[0]) {
            console.log('👻 Creating ghost rider at:', this.historicalData.coordinates[0]);
            
            this.ghostRider = this.zwiftMap.addPoint(
                this.historicalData.coordinates[0], 
                'ghost-rider'
            );
            
            // Style the ghost rider
            if (this.ghostRider && this.ghostRider.el) {
                this.ghostRider.el.style.background = 'rgba(255, 107, 53, 0.9)';
                this.ghostRider.el.style.border = '3px solid #ff6b35';
                this.ghostRider.el.style.boxShadow = '0 0 20px rgba(255, 107, 53, 0.8)';
                this.ghostRider.el.style.width = '16px';
                this.ghostRider.el.style.height = '16px';
                this.ghostRider.el.style.borderRadius = '50%';
                this.ghostRider.el.style.opacity = this.settings.ghostOpacity;
                this.ghostRider.el.style.zIndex = '200';
                this.ghostRider.el.classList.add('ghost-rider');
                
                // Add pulsing animation
                const style = document.createElement('style');
                style.textContent = `
                    .ghost-rider {
                        animation: ghostPulse 1.5s infinite ease-in-out !important;
                    }
                    @keyframes ghostPulse {
                        0%, 100% { 
                            transform: scale(1);
                            opacity: 0.9;
                        }
                        50% { 
                            transform: scale(1.2);
                            opacity: 1;
                        }
                    }
                `;
                document.head.appendChild(style);
                
                console.log('✅ Ghost rider styled and ready');
            } else {
                console.warn('❌ Failed to create ghost rider map entity');
            }
        }

        // Start replay animation with better timing
        this.replayInterval = setInterval(() => {
            this.updateReplayPosition();
        }, Math.max(50, this.settings.updateInterval)); // Minimum 50ms for smooth movement

        // Update UI
        this.updateReplayUI();
        this.showNotification('👻 Ghost Rider started! Racing against your personal best!', 'success');
        
        console.log(`👻 Ghost Rider replay started with ${this.historicalData.timePoints.length} time points`);
    }

    /**
     * Stop the replay
     */
    stopReplay() {
        console.log('Stopping route replay...');
        
        if (this.replayInterval) {
            clearInterval(this.replayInterval);
            this.replayInterval = null;
        }

        // Remove ghost rider
        if (this.ghostRider && this.zwiftMap) {
            this.zwiftMap.removeEntity(this.ghostRider);
            this.ghostRider = null;
        }

        // Remove progress line
        if (this.progressLine && this.zwiftMap) {
            this.progressLine.elements.forEach(el => el.remove());
            this.progressLine = null;
        }

        this.updateReplayUI();
    }

    /**
     * Update replay position and ghost rider
     */
    updateReplayPosition() {
        if (!this.historicalData || !this.replayMode) return;

        const maxPosition = this.historicalData.timePoints.length - 1;
        
        if (this.replayPosition >= maxPosition) {
            // Replay finished
            this.stopReplay();
            this.showReplayComplete();
            return;
        }

        const currentPoint = this.historicalData.timePoints[Math.floor(this.replayPosition)];
        if (!currentPoint || !currentPoint.coordinates) {
            console.warn('Invalid current point for ghost rider:', currentPoint);
            this.replayPosition += this.replaySpeed;
            return;
        }

        // Update ghost rider position - convert coordinates if needed
        if (this.ghostRider) {
            try {
                // Ensure coordinates are in the right format [x, y]
                const coords = Array.isArray(currentPoint.coordinates) ? 
                    [currentPoint.coordinates[0], currentPoint.coordinates[1]] : 
                    currentPoint.coordinates;
                
                if (coords && coords.length >= 2 && 
                    coords[0] !== null && coords[0] !== undefined &&
                    coords[1] !== null && coords[1] !== undefined &&
                    !isNaN(coords[0]) && !isNaN(coords[1])) {
                    
                    this.ghostRider.setPosition(coords);
                    console.log(`👻 Ghost moved to: [${coords[0].toFixed(2)}, ${coords[1].toFixed(2)}] at time ${currentPoint.time.toFixed(1)}s`);
                } else {
                    console.warn('Invalid coordinates for ghost rider:', coords);
                }
            } catch (error) {
                console.warn('Error updating ghost rider position:', error);
            }
        }

        // Update progress line
        if (this.settings.showProgressLine) {
            this.updateProgressLine();
        }

        // Update historical timing display
        this.updateHistoricalTiming(currentPoint);

        // Check for checkpoint passages
        this.checkHistoricalCheckpoints(currentPoint);

        // Advance position based on speed - make it more responsive
        const timeStep = this.settings.updateInterval / 1000; // Convert ms to seconds
        const expectedAdvance = timeStep * this.replaySpeed;
        this.replayPosition += Math.max(0.1, expectedAdvance); // Minimum advance of 0.1
    }

    /**
     * Update progress line showing completed route
     */
    updateProgressLine() {
        if (!this.zwiftMap) return;

        // Remove old progress line
        if (this.progressLine) {
            this.progressLine.elements.forEach(el => el.remove());
        }

        // Create new progress line up to current position
        const currentIndex = Math.floor(this.replayPosition);
        const completedCoords = this.historicalData.coordinates.slice(0, currentIndex + 1);
        
        if (completedCoords.length > 1) {
            this.progressLine = this.zwiftMap.addHighlightLine(completedCoords, 'replay-progress', {
                color: '#ff6b35',
                width: 3,
                extraClass: 'replay-progress-line'
            });
        }
    }

    /**
     * Update historical timing display
     */
    updateHistoricalTiming(currentPoint) {
        // Update historical timing display
        const historicalTimeEl = document.querySelector('.historical-time');
        const historicalDistanceEl = document.querySelector('.historical-distance');
        const historicalSpeedEl = document.querySelector('.historical-speed');
        const historicalPowerEl = document.querySelector('.historical-power');

        if (historicalTimeEl) {
            historicalTimeEl.textContent = H.timer(currentPoint.time);
        }
        if (historicalDistanceEl) {
            historicalDistanceEl.textContent = H.distance(currentPoint.distance, {suffix: true});
        }
        if (historicalSpeedEl) {
            historicalSpeedEl.textContent = H.pace(currentPoint.speed, {suffix: true});
        }
        if (historicalPowerEl) {
            historicalPowerEl.textContent = H.power(currentPoint.power, {suffix: true});
        }
    }

    /**
     * Check if ghost rider passed historical checkpoints
     */
    checkHistoricalCheckpoints(currentPoint) {
        if (!this.historicalData.checkpoints) return;

        for (const checkpoint of this.historicalData.checkpoints) {
            if (checkpoint.historicalPassed) continue; // Already passed

            // Check if we're close to this checkpoint
            if (!checkpoint.coordinates || !currentPoint.coordinates) continue;

            const distance = Math.sqrt(
                Math.pow(currentPoint.coordinates[0] - checkpoint.coordinates[0], 2) +
                Math.pow(currentPoint.coordinates[1] - checkpoint.coordinates[1], 2)
            );

            if (distance <= 50) { // Within 50m
                checkpoint.historicalPassed = true;
                checkpoint.historicalTime = currentPoint.time;
                
                this.showNotification(
                    `Ghost reached ${checkpoint.name} at ${H.timer(currentPoint.time)}`, 
                    'info'
                );
                
                // Update checkpoint display with historical time
                this.updateCheckpointHistoricalTime(checkpoint);
            }
        }
    }

    /**
     * Update checkpoint display with historical time
     */
    updateCheckpointHistoricalTime(checkpoint) {
        const checkpointEl = document.querySelector(`[data-checkpoint-id="${checkpoint.id}"]`);
        if (checkpointEl) {
            const timeEl = checkpointEl.querySelector('.checkpoint-time');
            if (timeEl) {
                timeEl.innerHTML = `
                    <div class="historical-time" style="font-size: 10px; color: #ff6b35;">
                        👻 ${H.timer(checkpoint.historicalTime)}
                    </div>
                    <div class="current-time">${timeEl.textContent}</div>
                `;
            }
        }
    }

    /**
     * Compare current athlete performance with ghost
     */
    compareWithGhost(currentAthleteState) {
        if (!this.replayMode || !this.historicalData || !currentAthleteState) return null;

        const currentPoint = this.historicalData.timePoints[Math.floor(this.replayPosition)];
        if (!currentPoint) return null;

        // Calculate distance difference
        const athletePos = [currentAthleteState.x, currentAthleteState.y];
        const ghostPos = currentPoint.coordinates;
        
        const distance = Math.sqrt(
            Math.pow(athletePos[0] - ghostPos[0], 2) +
            Math.pow(athletePos[1] - ghostPos[1], 2)
        );

        // Determine if athlete is ahead or behind
        // This is a simplified comparison - in reality you'd want to compare route progress
        const isAhead = currentAthleteState.distance > currentPoint.distance;
        const timeDiff = Math.abs(currentAthleteState.time - currentPoint.time);

        return {
            distance: distance,
            isAhead: isAhead,
            timeDifference: timeDiff,
            ghostSpeed: currentPoint.speed,
            ghostPower: currentPoint.power,
            athleteSpeed: currentAthleteState.speed * 3.6, // Convert m/s to km/h
            athletePower: currentAthleteState.power
        };
    }

    /**
     * Show replay completion summary
     */
    showReplayComplete() {
        const duration = H.timer(this.historicalData.totalDuration);
        const distance = H.distance(this.historicalData.totalDistance, {suffix: true});
        
        this.showNotification(
            `Ghost rider finished!\nTime: ${duration}\nDistance: ${distance}\nRace against yourself!`, 
            'success'
        );
    }

    /**
     * Control replay speed
     */
    setReplaySpeed(speed) {
        this.replaySpeed = Math.max(0.1, Math.min(10, speed));
        const speedEl = document.querySelector('.replay-speed-value');
        if (speedEl) {
            speedEl.textContent = `${this.replaySpeed}x`;
        }
        console.log(`Replay speed set to ${this.replaySpeed}x`);
    }

    /**
     * Seek to specific position in replay
     */
    seekTo(position) {
        if (!this.historicalData) return;
        
        this.replayPosition = Math.max(0, Math.min(this.historicalData.timePoints.length - 1, position));
        
        if (this.replayMode) {
            this.updateReplayPosition();
        }
    }

    /**
     * Seek to specific time in replay
     */
    seekToTime(timeInSeconds) {
        if (!this.historicalData) return;
        
        // Find the closest time point
        const targetPoint = this.historicalData.timePoints.find(point => point.time >= timeInSeconds);
        if (targetPoint) {
            this.seekTo(targetPoint.index);
        }
    }

    /**
     * Update replay UI controls
     */
    updateReplayUI() {
        const replayBtn = document.querySelector('.toggle-replay');
        const replayControls = document.querySelector('.replay-controls');
        
        if (replayBtn) {
            replayBtn.classList.toggle('active', this.replayMode);
            replayBtn.innerHTML = this.replayMode ? 
                '⏸️ Stop Ghost' : 
                '👻 Start Ghost Rider';
        }
        
        if (replayControls) {
            replayControls.style.display = this.replayMode ? 'flex' : 'none';
        }

        // Update progress bar
        const progressBar = document.querySelector('.replay-progress-bar');
        if (progressBar && this.historicalData) {
            const progress = (this.replayPosition / this.historicalData.timePoints.length) * 100;
            progressBar.style.width = `${progress}%`;
        }
    }

    /**
     * Show notification (helper method)
     */
    showNotification(message, type = 'info') {
        // This should be implemented to match your notification system
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Try to use existing notification system
        if (window.showNotification) {
            window.showNotification(message, type);
        }
    }

    /**
     * Get replay statistics
     */
    getReplayStats() {
        if (!this.historicalData) return null;

        return {
            totalDuration: this.historicalData.totalDuration,
            totalDistance: this.historicalData.totalDistance,
            averageSpeed: this.historicalData.totalDistance / (this.historicalData.totalDuration / 3600), // km/h
            averagePower: this.calculateAveragePower(),
            maxSpeed: this.calculateMaxSpeed(),
            maxPower: this.calculateMaxPower(),
            checkpoints: this.historicalData.checkpoints.length,
            isPersonalBest: this.historicalData === this.personalBestData
        };
    }

    calculateAveragePower() {
        if (!this.historicalData.timePoints) return 0;
        const powers = this.historicalData.timePoints.map(p => p.power).filter(p => p > 0);
        return powers.length > 0 ? powers.reduce((a, b) => a + b) / powers.length : 0;
    }

    calculateMaxSpeed() {
        if (!this.historicalData.timePoints) return 0;
        return Math.max(...this.historicalData.timePoints.map(p => p.speed));
    }

    calculateMaxPower() {
        if (!this.historicalData.timePoints) return 0;
        return Math.max(...this.historicalData.timePoints.map(p => p.power));
    }

    /**
     * Export replay data
     */
    exportReplayData() {
        if (!this.historicalData) return null;

        return {
            metadata: this.historicalData.metadata,
            stats: this.getReplayStats(),
            timePoints: this.historicalData.timePoints.map(point => ({
                time: point.time,
                distance: point.distance,
                speed: point.speed,
                power: point.power,
                heartRate: point.heartRate,
                cadence: point.cadence,
                altitude: point.altitude,
                coordinates: point.coordinates
            })),
            checkpoints: this.historicalData.checkpoints,
            personalBest: this.historicalData === this.personalBestData
        };
    }

    /**
     * Import replay data (for loading saved sessions)
     */
    importReplayData(exportedData) {
        if (!exportedData || !exportedData.timePoints) {
            console.warn('Invalid replay data for import');
            return false;
        }

        this.historicalData = {
            coordinates: exportedData.timePoints.map(p => p.coordinates),
            telemetry: {
                time: exportedData.timePoints.map(p => p.time),
                distance: exportedData.timePoints.map(p => p.distance * 100), // Convert back to cm
                speed: exportedData.timePoints.map(p => p.speed / 3.6 * 100), // Convert back to cm/s
                power: exportedData.timePoints.map(p => p.power),
                heartRate: exportedData.timePoints.map(p => p.heartRate),
                cadence: exportedData.timePoints.map(p => p.cadence),
                altitude: exportedData.timePoints.map(p => p.altitude * 100) // Convert back to cm
            },
            checkpoints: exportedData.checkpoints || [],
            metadata: exportedData.metadata || {},
            timePoints: exportedData.timePoints,
            totalDuration: exportedData.timePoints[exportedData.timePoints.length - 1]?.time || 0,
            totalDistance: exportedData.timePoints[exportedData.timePoints.length - 1]?.distance || 0
        };

        if (exportedData.personalBest) {
            this.personalBestData = { ...this.historicalData };
        }

        console.log('Replay data imported successfully');
        return true;
    }

    /**
     * Reset replay manager
     */
    reset() {
        this.stopReplay();
        this.historicalData = null;
        this.personalBestData = null;
        this.replayPosition = 0;
        this.timeOffsets = [];
        console.log('Replay manager reset');
    }

    /**
     * Debug function to get current state
     */
    getDebugInfo() {
        return {
            hasHistoricalData: !!this.historicalData,
            hasPersonalBest: !!this.personalBestData,
            replayMode: this.replayMode,
            replayPosition: this.replayPosition,
            replaySpeed: this.replaySpeed,
            ghostRiderActive: !!this.ghostRider,
            progressLineActive: !!this.progressLine,
            timePointsCount: this.historicalData?.timePoints?.length || 0,
            totalDuration: this.historicalData?.totalDuration || 0,
            totalDistance: this.historicalData?.totalDistance || 0,
            settings: this.settings
        };
    }
}