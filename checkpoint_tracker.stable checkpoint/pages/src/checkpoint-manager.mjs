// checkpoint-manager.mjs - Enhanced Checkpoint Management Module
// Inspired by Sauce4Zwift's segment/route tracking architecture

import * as locale from '/shared/sauce/locale.mjs';
import * as common from '/pages/src/common.mjs';

const H = locale.human;

// Constants for distance calculations (matching Sauce patterns)
const DEFAULT_EPSILON = 0.004; // 1/250 precision for curve sampling
const CHECKPOINT_COLORS = {
    start: '#00ff00',
    finish: '#ff0000',
    split: '#ffaa00',
    lap: '#00aaff',
    checkpoint: '#ffffff',
    segment_start: '#ff00ff',
    segment_end: '#ff00ff'
};

/**
 * Simple LRU Cache for distance calculations (from Sauce)
 */
class LRUCache extends Map {
    constructor(capacity = 1000) {
        super();
        this._capacity = capacity;
    }

    get(key) {
        const value = super.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            super.delete(key);
            super.set(key, value);
        }
        return value;
    }

    set(key, value) {
        if (this.size >= this._capacity) {
            // Delete oldest entry
            const firstKey = this.keys().next().value;
            super.delete(firstKey);
        }
        super.set(key, value);
    }
}

/**
 * Vector math utilities (from Sauce curves.mjs)
 */
function vecDist2d(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function vecDist3d(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = (b[2] || 0) - (a[2] || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Haversine distance for real GPS coordinates
 * Returns distance in meters
 */
function haversineDistance(a, b) {
    const R = 6371000; // Earth's radius in meters
    const lat1 = a[0] * Math.PI / 180;
    const lat2 = b[0] * Math.PI / 180;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLng = (b[1] - a[1]) * Math.PI / 180;

    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Detect if coordinates are real GPS (lat/lng in degrees)
 * Real GPS: lat typically -90 to 90, lng -180 to 180
 * Zwift virtual: much larger values (thousands)
 */
function isRealGpsCoordinates(coordinates) {
    if (!coordinates || coordinates.length === 0) return false;
    const sample = coordinates[0];
    if (!sample || sample.length < 2) return false;
    // Real GPS lat is -90 to 90, lng is -180 to 180
    return Math.abs(sample[0]) <= 90 && Math.abs(sample[1]) <= 180;
}

function lerp(t, a, b) {
    const s = 1 - t;
    return [
        a[0] * s + b[0] * t,
        a[1] * s + b[1] * t,
        (a[2] || 0) * s + (b[2] || 0) * t
    ];
}

/**
 * CurvePath - Simplified curve-based path for distance calculations
 * Based on Sauce4Zwift's CurvePath class
 */
export class CurvePath {
    constructor(coordinates, telemetry = null) {
        this.coordinates = coordinates || [];
        this.telemetry = telemetry;
        this._distanceCache = new LRUCache(500);
        this._cumulativeDistances = null;
        this._totalDistance = null;
        this._isRealGps = isRealGpsCoordinates(coordinates);

        // Pre-compute cumulative distances
        if (this.coordinates.length > 0) {
            this._computeCumulativeDistances();
        }
    }

    /**
     * Pre-compute cumulative distances for O(1) lookups
     */
    _computeCumulativeDistances() {
        const distances = [0];
        let totalDist = 0;

        // Choose distance function based on coordinate type
        const distFn = this._isRealGps ? haversineDistance : vecDist2d;
        console.log(`CurvePath: Using ${this._isRealGps ? 'haversine (GPS)' : 'euclidean (Zwift)'} distance`);

        for (let i = 1; i < this.coordinates.length; i++) {
            const prev = this.coordinates[i - 1];
            const curr = this.coordinates[i];

            if (prev && curr) {
                const segmentDist = distFn(prev, curr);
                totalDist += segmentDist;
            }
            distances.push(totalDist);
        }

        this._cumulativeDistances = distances;
        this._totalDistance = totalDist;

        console.log(`CurvePath: Computed ${distances.length} cumulative distances, total: ${(totalDist / 1000).toFixed(2)} km`);
    }

    /**
     * Get total path distance
     */
    get totalDistance() {
        if (this._totalDistance === null) {
            this._computeCumulativeDistances();
        }
        return this._totalDistance || 0;
    }

    /**
     * Get cumulative distances array
     */
    get cumulativeDistances() {
        if (this._cumulativeDistances === null) {
            this._computeCumulativeDistances();
        }
        return this._cumulativeDistances || [];
    }

    /**
     * Get distance at a specific coordinate index
     */
    distanceAtIndex(index) {
        const distances = this.cumulativeDistances;
        if (index < 0) return 0;
        if (index >= distances.length) return this.totalDistance;
        return distances[index];
    }

    /**
     * Get progress (0-1) at a specific coordinate index
     */
    progressAtIndex(index) {
        if (this.totalDistance === 0) return 0;
        return this.distanceAtIndex(index) / this.totalDistance;
    }

    /**
     * Find coordinate index at a given distance
     */
    indexAtDistance(targetDistance) {
        const distances = this.cumulativeDistances;
        if (targetDistance <= 0) return 0;
        if (targetDistance >= this.totalDistance) return distances.length - 1;

        // Binary search for efficiency
        let low = 0;
        let high = distances.length - 1;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (distances[mid] < targetDistance) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        return low;
    }

    /**
     * Find coordinate index at a given progress (0-1)
     */
    indexAtProgress(progress) {
        const targetDist = progress * this.totalDistance;
        return this.indexAtDistance(targetDist);
    }

    /**
     * Get interpolated point at a specific distance along path
     */
    pointAtDistance(targetDistance) {
        if (this.coordinates.length === 0) return null;
        if (targetDistance <= 0) return this.coordinates[0];
        if (targetDistance >= this.totalDistance) {
            return this.coordinates[this.coordinates.length - 1];
        }

        const index = this.indexAtDistance(targetDistance);
        if (index === 0) return this.coordinates[0];

        const prevDist = this.cumulativeDistances[index - 1];
        const currDist = this.cumulativeDistances[index];
        const segmentLength = currDist - prevDist;

        if (segmentLength === 0) return this.coordinates[index];

        const t = (targetDistance - prevDist) / segmentLength;
        return lerp(t, this.coordinates[index - 1], this.coordinates[index]);
    }

    /**
     * Get interpolated point at a specific progress (0-1)
     */
    pointAtProgress(progress) {
        return this.pointAtDistance(progress * this.totalDistance);
    }

    /**
     * Calculate distance from a point to the path
     * Returns { distance, nearestIndex, nearestPoint, progress }
     */
    distanceFromPath(point, searchRadius = Infinity) {
        if (this.coordinates.length === 0) {
            return { distance: Infinity, nearestIndex: -1, nearestPoint: null, progress: 0 };
        }

        const distFn = this._isRealGps ? haversineDistance : vecDist2d;
        // For GPS, "close enough" is ~10 meters; for Zwift, use 1 unit
        const closeEnough = this._isRealGps ? 10 : 1;

        let minDist = Infinity;
        let nearestIndex = 0;
        let nearestPoint = this.coordinates[0];

        for (let i = 0; i < this.coordinates.length; i++) {
            const coord = this.coordinates[i];
            const dist = distFn(point, coord);

            if (dist < minDist) {
                minDist = dist;
                nearestIndex = i;
                nearestPoint = coord;

                if (dist < searchRadius && dist < closeEnough) {
                    // Close enough, stop searching
                    break;
                }
            }
        }

        return {
            distance: minDist,
            nearestIndex,
            nearestPoint,
            progress: this.progressAtIndex(nearestIndex)
        };
    }
}

/**
 * Segment - A named section of the route with timing
 */
export class Segment {
    constructor(options = {}) {
        this.id = options.id || Date.now();
        this.name = options.name || 'Unnamed Segment';
        this.startProgress = options.startProgress || 0; // 0-1
        this.endProgress = options.endProgress || 1;     // 0-1
        this.startIndex = options.startIndex || 0;
        this.endIndex = options.endIndex || 0;
        this.distance = options.distance || 0;           // in meters
        this.type = options.type || 'segment';           // segment, climb, sprint, etc.
        this.color = options.color || '#ff00ff';

        // Timing
        this.bestTime = null;
        this.currentTime = null;
        this.enterTime = null;
        this.exitTime = null;
        this.isActive = false;
        this.isCompleted = false;

        // Map entity reference
        this.mapEntities = [];
    }

    reset() {
        this.bestTime = null;
        this.currentTime = null;
        this.enterTime = null;
        this.exitTime = null;
        this.isActive = false;
        this.isCompleted = false;
    }
}

/**
 * Checkpoint - A point on the route to track
 */
export class Checkpoint {
    constructor(options = {}) {
        this.id = options.id || Date.now();
        this.name = options.name || 'Checkpoint';
        this.coordinates = options.coordinates || [0, 0];
        this.index = options.index || 0;                 // Index in coordinates array
        this.progress = options.progress || 0;           // 0-1 progress along route
        this.distance = options.distance || 0;           // Distance from start in meters
        this.altitude = options.altitude || 0;
        this.type = options.type || 'checkpoint';        // start, finish, split, lap, checkpoint
        this.radius = options.radius || 50;              // Detection radius

        // Timing
        this.targetTime = options.targetTime || null;    // Target time to beat
        this.bestTime = options.bestTime || null;        // Personal best
        this.currentTime = null;                         // Current attempt time
        this.splitTime = null;                           // Time since last checkpoint
        this.completed = false;
        this.completedAt = null;                         // Timestamp when completed
        this.active = false;

        // Map entity reference
        this.mapEntity = null;
    }

    reset() {
        this.currentTime = null;
        this.splitTime = null;
        this.completed = false;
        this.completedAt = null;
        this.active = false;
    }
}

/**
 * SplitTime - Record of a checkpoint split
 */
export class SplitTime {
    constructor(checkpoint, timestamp, totalTime, splitTime) {
        this.checkpointId = checkpoint.id;
        this.checkpointName = checkpoint.name;
        this.timestamp = timestamp;
        this.totalTime = totalTime;          // Total time from start
        this.splitTime = splitTime;          // Time since last checkpoint
        this.distance = checkpoint.distance;
        this.delta = null;                   // Difference from target/best
    }
}

/**
 * Enhanced CheckpointManager with full segment/timing support
 */
export class CheckpointManager {
    constructor(settings = {}) {
        this.checkpoints = [];
        this.segments = [];
        this.curvePath = null;
        this.settings = {
            checkpointRadius: 50,
            showCheckpoints: true,
            showSegments: true,
            autoGenerateCheckpoints: true,
            checkpointInterval: 1000,        // meters
            ...settings
        };

        // Timing state
        this.startTime = null;
        this.lastCheckpointTime = null;
        this.splitTimes = [];
        this.isRunning = false;

        // Progress tracking
        this.currentProgress = 0;            // 0-1
        this.currentDistance = 0;            // meters
        this.currentIndex = 0;               // coordinate index

        // Map reference
        this.zwiftMap = null;

        // Route data
        this.routeData = null;
    }

    setMap(zwiftMap) {
        this.zwiftMap = zwiftMap;
    }

    /**
     * Initialize with route data
     */
    initializeWithRoute(routeData) {
        this.routeData = routeData;

        if (!routeData || !routeData.coordinates || routeData.coordinates.length === 0) {
            console.warn('No valid route data for checkpoint manager');
            return;
        }

        // Create CurvePath for distance calculations
        this.curvePath = new CurvePath(routeData.coordinates, routeData.telemetry);

        console.log(`CheckpointManager initialized with ${routeData.coordinates.length} coordinates`);
        console.log(`Total route distance: ${(this.curvePath.totalDistance / 1000).toFixed(2)} km`);
    }

    /**
     * Load checkpoints from parsed data
     */
    async loadCheckpointsFromData(checkpointData, routeData = null) {
        // Initialize route if provided
        if (routeData) {
            this.initializeWithRoute(routeData);
        }

        this.checkpoints = [];

        if (!checkpointData || !Array.isArray(checkpointData)) {
            console.warn('No valid checkpoint data provided');
            return this.checkpoints;
        }

        for (const [index, cp] of checkpointData.entries()) {
            try {
                if (!cp || typeof cp !== 'object') continue;

                const checkpoint = new Checkpoint({
                    id: Date.now() + index,
                    name: cp.name || `Checkpoint ${index + 1}`,
                    coordinates: this._validateCoordinates(cp.coordinates),
                    index: cp.index ?? index,
                    distance: cp.distance || 0,
                    altitude: cp.altitude || 0,
                    type: cp.type || 'checkpoint',
                    targetTime: cp.time || null,
                    radius: this.settings.checkpointRadius
                });

                // Calculate progress if we have a curve path
                if (this.curvePath && this.curvePath.totalDistance > 0) {
                    checkpoint.progress = checkpoint.distance / this.curvePath.totalDistance;
                }

                this.checkpoints.push(checkpoint);

                // Add visual marker to map
                if (this.zwiftMap && this.settings.showCheckpoints) {
                    this._addCheckpointMarker(checkpoint);
                }
            } catch (error) {
                console.warn(`Error loading checkpoint ${index}:`, error);
            }
        }

        // Sort checkpoints by distance
        this.checkpoints.sort((a, b) => a.distance - b.distance);

        console.log(`Loaded ${this.checkpoints.length} checkpoints`);
        return this.checkpoints;
    }

    /**
     * Add a segment
     */
    addSegment(options) {
        const segment = new Segment(options);

        // Calculate indices from progress if curve path available
        if (this.curvePath) {
            segment.startIndex = this.curvePath.indexAtProgress(segment.startProgress);
            segment.endIndex = this.curvePath.indexAtProgress(segment.endProgress);
            segment.distance = (segment.endProgress - segment.startProgress) * this.curvePath.totalDistance;
        }

        this.segments.push(segment);

        // Add visual markers
        if (this.zwiftMap && this.settings.showSegments) {
            this._addSegmentMarkers(segment);
        }

        return segment;
    }

    /**
     * Create segment from two checkpoints
     */
    createSegmentFromCheckpoints(startCheckpoint, endCheckpoint, name = null) {
        return this.addSegment({
            name: name || `${startCheckpoint.name} to ${endCheckpoint.name}`,
            startProgress: startCheckpoint.progress,
            endProgress: endCheckpoint.progress,
            startIndex: startCheckpoint.index,
            endIndex: endCheckpoint.index,
            distance: endCheckpoint.distance - startCheckpoint.distance,
            type: 'segment'
        });
    }

    /**
     * Add checkpoint at specific coordinates
     */
    async addCheckpoint(coordinates, name = null, type = 'manual') {
        const validCoords = this._validateCoordinates(coordinates);

        let distance = 0;
        let progress = 0;
        let index = 0;

        // Calculate distance and progress using curve path
        if (this.curvePath) {
            const result = this.curvePath.distanceFromPath(validCoords);
            distance = this.curvePath.distanceAtIndex(result.nearestIndex);
            progress = result.progress;
            index = result.nearestIndex;
        }

        const checkpoint = new Checkpoint({
            id: Date.now(),
            name: name || `Checkpoint ${this.checkpoints.length + 1}`,
            coordinates: validCoords,
            index,
            progress,
            distance,
            type,
            radius: this.settings.checkpointRadius
        });

        this.checkpoints.push(checkpoint);

        // Re-sort by distance
        this.checkpoints.sort((a, b) => a.distance - b.distance);

        if (this.zwiftMap && this.settings.showCheckpoints) {
            this._addCheckpointMarker(checkpoint);
        }

        return checkpoint;
    }

    /**
     * Add checkpoint at current athlete position
     */
    async addCheckpointAtCurrentPosition(watchingId, athleteId) {
        try {
            const athleteData = await common.rpc.getAthleteData(watchingId || athleteId || 'self');
            if (!athleteData || !athleteData.state) {
                throw new Error('No athlete position available');
            }

            const state = athleteData.state;
            const checkpoint = await this.addCheckpoint(
                [state.x, state.y],
                `Checkpoint ${this.checkpoints.length + 1}`,
                'manual'
            );

            // Override distance from athlete state if available
            if (state.distance) {
                checkpoint.distance = state.distance;
                if (this.curvePath && this.curvePath.totalDistance > 0) {
                    checkpoint.progress = state.distance / this.curvePath.totalDistance;
                }
            }

            return checkpoint;
        } catch (error) {
            console.error('Error adding checkpoint:', error);
            throw error;
        }
    }

    /**
     * Check athlete progress and update checkpoints/segments
     */
    updateProgress(athleteState) {
        if (!athleteState) return { reached: [], activeCheckpoint: null, activeSegments: [] };

        const athletePos = [athleteState.x, athleteState.y];
        const currentTime = Date.now();

        // Initialize timing on first movement
        if (!this.isRunning && (athleteState.speed || 0) > 0) {
            this.startTiming();
        }

        // Update current position tracking
        if (this.curvePath) {
            const pathResult = this.curvePath.distanceFromPath(athletePos);
            this.currentProgress = pathResult.progress;
            this.currentDistance = this.curvePath.distanceAtIndex(pathResult.nearestIndex);
            this.currentIndex = pathResult.nearestIndex;
        }

        const results = {
            reached: [],
            activeCheckpoint: null,
            activeSegments: [],
            currentProgress: this.currentProgress,
            currentDistance: this.currentDistance
        };

        // Check checkpoints
        let closestIncomplete = null;
        let closestDistance = Infinity;

        for (const checkpoint of this.checkpoints) {
            if (!checkpoint.coordinates) continue;

            const dist = vecDist2d(athletePos, checkpoint.coordinates);
            checkpoint.active = false;

            if (checkpoint.completed) continue;

            if (dist <= checkpoint.radius) {
                // Checkpoint reached!
                this._completeCheckpoint(checkpoint, currentTime);
                results.reached.push(checkpoint);
            } else if (dist < closestDistance) {
                closestDistance = dist;
                closestIncomplete = checkpoint;
            }
        }

        // Mark closest incomplete checkpoint as active
        if (closestIncomplete) {
            closestIncomplete.active = true;
            results.activeCheckpoint = closestIncomplete;

            if (closestIncomplete.mapEntity?.el) {
                this._updateCheckpointVisuals(closestIncomplete);
            }
        }

        // Check segments
        for (const segment of this.segments) {
            const wasActive = segment.isActive;

            // Check if athlete is within segment bounds
            const inSegment = this.currentProgress >= segment.startProgress &&
                             this.currentProgress <= segment.endProgress;

            if (inSegment && !segment.isActive && !segment.isCompleted) {
                // Entering segment
                segment.isActive = true;
                segment.enterTime = currentTime;
                console.log(`Entered segment: ${segment.name}`);
            } else if (!inSegment && segment.isActive) {
                // Exiting segment
                segment.isActive = false;
                segment.exitTime = currentTime;
                segment.currentTime = segment.exitTime - segment.enterTime;
                segment.isCompleted = true;

                console.log(`Completed segment: ${segment.name} in ${H.timer(segment.currentTime / 1000)}`);
            }

            if (segment.isActive) {
                results.activeSegments.push(segment);
                segment.currentTime = currentTime - segment.enterTime;
            }
        }

        return results;
    }

    /**
     * Complete a checkpoint and record split time
     */
    _completeCheckpoint(checkpoint, timestamp) {
        checkpoint.completed = true;
        checkpoint.completedAt = timestamp;

        if (this.startTime) {
            checkpoint.currentTime = timestamp - this.startTime;
            checkpoint.splitTime = this.lastCheckpointTime ?
                timestamp - this.lastCheckpointTime : checkpoint.currentTime;

            // Calculate delta from target/best
            const targetTime = checkpoint.targetTime || checkpoint.bestTime;
            if (targetTime) {
                checkpoint.delta = checkpoint.currentTime - targetTime;
            }

            // Record split
            const split = new SplitTime(
                checkpoint,
                timestamp,
                checkpoint.currentTime,
                checkpoint.splitTime
            );
            split.delta = checkpoint.delta;
            this.splitTimes.push(split);

            this.lastCheckpointTime = timestamp;
        }

        // Update visuals
        if (checkpoint.mapEntity?.el) {
            checkpoint.mapEntity.el.classList.add('completed');
            checkpoint.mapEntity.el.classList.remove('active');
        }

        console.log(`Checkpoint reached: ${checkpoint.name} - Total: ${H.timer(checkpoint.currentTime / 1000)}, Split: ${H.timer(checkpoint.splitTime / 1000)}`);
    }

    /**
     * Start timing
     */
    startTiming() {
        this.startTime = Date.now();
        this.lastCheckpointTime = this.startTime;
        this.isRunning = true;
        this.splitTimes = [];
        console.log('Checkpoint timing started');
    }

    /**
     * Stop timing
     */
    stopTiming() {
        this.isRunning = false;
        console.log('Checkpoint timing stopped');
    }

    /**
     * Reset all timing and progress
     */
    resetTiming() {
        this.startTime = null;
        this.lastCheckpointTime = null;
        this.isRunning = false;
        this.splitTimes = [];
        this.currentProgress = 0;
        this.currentDistance = 0;
        this.currentIndex = 0;

        for (const checkpoint of this.checkpoints) {
            checkpoint.reset();
            if (checkpoint.mapEntity?.el) {
                checkpoint.mapEntity.el.classList.remove('completed', 'active');
            }
        }

        for (const segment of this.segments) {
            segment.reset();
        }

        console.log('Checkpoint timing reset');
    }

    /**
     * Get current timing info
     */
    getTimingInfo() {
        if (!this.startTime || !this.isRunning) {
            return {
                totalTime: 0,
                segmentTime: 0,
                hasStarted: false,
                completedCheckpoints: 0,
                progress: 0
            };
        }

        const currentTime = Date.now();
        const totalTime = currentTime - this.startTime;
        const segmentTime = this.lastCheckpointTime ?
            currentTime - this.lastCheckpointTime : totalTime;
        const completedCount = this.checkpoints.filter(cp => cp.completed).length;

        return {
            totalTime,
            segmentTime,
            hasStarted: true,
            completedCheckpoints: completedCount,
            totalCheckpoints: this.checkpoints.length,
            progress: this.currentProgress,
            distance: this.currentDistance
        };
    }

    /**
     * Get split times summary
     */
    getSplitTimes() {
        return this.splitTimes.map(split => ({
            name: split.checkpointName,
            totalTime: split.totalTime,
            splitTime: split.splitTime,
            delta: split.delta,
            distance: split.distance,
            formattedTotal: H.timer(split.totalTime / 1000),
            formattedSplit: H.timer(split.splitTime / 1000),
            formattedDelta: split.delta ?
                (split.delta > 0 ? '+' : '') + H.timer(split.delta / 1000) : null
        }));
    }

    /**
     * Get checkpoint statistics
     */
    getStats() {
        const total = this.checkpoints.length;
        const completed = this.checkpoints.filter(cp => cp.completed).length;

        return {
            total,
            completed,
            remaining: total - completed,
            completionRate: total > 0 ? completed / total : 0,
            segments: this.segments.length,
            activeSegments: this.segments.filter(s => s.isActive).length,
            progress: this.currentProgress,
            distance: this.currentDistance
        };
    }

    /**
     * Add visual checkpoint marker to map
     */
    _addCheckpointMarker(checkpoint) {
        if (!this.zwiftMap) return;

        try {
            const entity = this.zwiftMap.addPoint(checkpoint.coordinates, 'checkpoint');
            if (!entity?.el) return;

            entity.el.dataset.checkpointId = checkpoint.id;
            entity.el.classList.add('checkpoint-marker', checkpoint.type);

            // Set color based on type
            const color = CHECKPOINT_COLORS[checkpoint.type] || CHECKPOINT_COLORS.checkpoint;
            entity.el.style.setProperty('--checkpoint-color', color);

            // Add time label if we have a target time from FIT file
            if (checkpoint.targetTime !== null && checkpoint.targetTime !== undefined) {
                const timeLabel = document.createElement('div');
                timeLabel.className = 'checkpoint-time-label';
                timeLabel.textContent = H.timer(checkpoint.targetTime);
                entity.el.appendChild(timeLabel);
            }

            checkpoint.mapEntity = entity;

            if (!this.settings.showCheckpoints) {
                entity.toggleHidden(true);
            }
        } catch (error) {
            console.warn('Error adding checkpoint marker:', error);
        }
    }

    /**
     * Add segment markers to map
     */
    _addSegmentMarkers(segment) {
        if (!this.zwiftMap || !this.curvePath) return;

        try {
            // Add start marker
            const startCoord = this.curvePath.coordinates[segment.startIndex];
            if (startCoord) {
                const startEntity = this.zwiftMap.addPoint(startCoord, 'segment-start');
                if (startEntity?.el) {
                    startEntity.el.classList.add('segment-marker', 'segment-start');
                    startEntity.el.style.setProperty('--segment-color', segment.color);
                    segment.mapEntities.push(startEntity);
                }
            }

            // Add end marker
            const endCoord = this.curvePath.coordinates[segment.endIndex];
            if (endCoord) {
                const endEntity = this.zwiftMap.addPoint(endCoord, 'segment-end');
                if (endEntity?.el) {
                    endEntity.el.classList.add('segment-marker', 'segment-end');
                    endEntity.el.style.setProperty('--segment-color', segment.color);
                    segment.mapEntities.push(endEntity);
                }
            }
        } catch (error) {
            console.warn('Error adding segment markers:', error);
        }
    }

    /**
     * Update checkpoint visual state
     */
    _updateCheckpointVisuals(checkpoint) {
        if (!checkpoint.mapEntity?.el) return;

        const el = checkpoint.mapEntity.el;
        el.classList.toggle('active', checkpoint.active);
        el.classList.toggle('completed', checkpoint.completed);
    }

    /**
     * Toggle checkpoint visibility
     */
    toggleCheckpointVisibility(show) {
        this.settings.showCheckpoints = show;
        for (const cp of this.checkpoints) {
            if (cp.mapEntity) {
                cp.mapEntity.toggleHidden(!show);
            }
        }
    }

    /**
     * Toggle segment visibility
     */
    toggleSegmentVisibility(show) {
        this.settings.showSegments = show;
        for (const segment of this.segments) {
            for (const entity of segment.mapEntities) {
                entity.toggleHidden(!show);
            }
        }
    }

    /**
     * Delete a checkpoint
     */
    deleteCheckpoint(checkpointId) {
        const index = this.checkpoints.findIndex(cp => cp.id === checkpointId);
        if (index === -1) return null;

        const checkpoint = this.checkpoints[index];
        if (checkpoint.mapEntity && this.zwiftMap) {
            try {
                this.zwiftMap.removeEntity(checkpoint.mapEntity);
            } catch (error) {
                console.warn('Error removing checkpoint from map:', error);
            }
        }

        this.checkpoints.splice(index, 1);
        return checkpoint;
    }

    /**
     * Delete a segment
     */
    deleteSegment(segmentId) {
        const index = this.segments.findIndex(s => s.id === segmentId);
        if (index === -1) return null;

        const segment = this.segments[index];
        for (const entity of segment.mapEntities) {
            try {
                this.zwiftMap?.removeEntity(entity);
            } catch (error) {
                console.warn('Error removing segment marker:', error);
            }
        }

        this.segments.splice(index, 1);
        return segment;
    }

    /**
     * Clear all checkpoints
     */
    clearCheckpoints() {
        for (const cp of this.checkpoints) {
            if (cp.mapEntity && this.zwiftMap) {
                try {
                    this.zwiftMap.removeEntity(cp.mapEntity);
                } catch (e) {}
            }
        }
        this.checkpoints = [];
        this.resetTiming();
    }

    /**
     * Clear all segments
     */
    clearSegments() {
        for (const segment of this.segments) {
            for (const entity of segment.mapEntities) {
                try {
                    this.zwiftMap?.removeEntity(entity);
                } catch (e) {}
            }
        }
        this.segments = [];
    }

    /**
     * Validate coordinates
     */
    _validateCoordinates(coords) {
        if (!Array.isArray(coords) || coords.length < 2) {
            return [0, 0];
        }
        const [x, y] = coords;
        if (x == null || y == null || isNaN(x) || isNaN(y)) {
            return [0, 0];
        }
        return [x, y];
    }

    /**
     * Export all data
     */
    exportData() {
        return {
            checkpoints: this.checkpoints.map(cp => ({
                name: cp.name,
                coordinates: cp.coordinates,
                distance: cp.distance,
                progress: cp.progress,
                altitude: cp.altitude,
                type: cp.type,
                completed: cp.completed,
                currentTime: cp.currentTime,
                splitTime: cp.splitTime,
                bestTime: cp.bestTime
            })),
            segments: this.segments.map(s => ({
                name: s.name,
                startProgress: s.startProgress,
                endProgress: s.endProgress,
                distance: s.distance,
                type: s.type,
                bestTime: s.bestTime,
                currentTime: s.currentTime
            })),
            splitTimes: this.getSplitTimes(),
            timing: this.getTimingInfo(),
            stats: this.getStats()
        };
    }
}
