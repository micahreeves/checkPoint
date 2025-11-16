// fit-to-map-adapter.mjs
// Converts FIT file data to map-compatible checkpoint format with time comparison

import * as locale from '/shared/sauce/locale.mjs';
import { convertCoordinates } from './coordinate-converter.mjs';

const H = locale.human;
const CHECKPOINT_INTERVAL_METERS = 1000;

/**
 * Converts FIT file to route data compatible with checkpoint tracker
 */
export class FitToMapAdapter {
    constructor() {
        this.attempts = new Map(); // Store multiple FIT uploads for comparison
        this.attemptCounter = 0;
    }

    /**
     * Parse FIT file and convert to map format
     */
    async parseFitFile(file, worldId = null) {
        if (typeof window.FitParser === 'undefined') {
            throw new Error('FitParser not loaded. Make sure fit.parser.entry.js is included.');
        }

        console.log(`📂 Parsing FIT file: ${file.name}`);

        const arrayBuffer = await file.arrayBuffer();

        return new Promise((resolve, reject) => {
            const fitParser = new window.FitParser({
                force: true,
                mode: 'both',
                elapsedRecordField: true
            });

            fitParser.parse(arrayBuffer, (error, data) => {
                if (error) {
                    reject(new Error(`FIT parsing failed: ${error.message || error}`));
                    return;
                }

                if (!data?.records?.length) {
                    reject(new Error('No records found in FIT file'));
                    return;
                }

                console.log(`✅ Parsed ${data.records.length} records from FIT file`);

                try {
                    const routeData = this.convertToRouteData(data, file.name, worldId);
                    resolve(routeData);
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    /**
     * Convert parsed FIT data to route format
     */
    convertToRouteData(fitData, fileName, worldId = null) {
        const records = fitData.records.filter(r => {
            const lat = r.position_lat;
            const lng = r.position_long;
            return lat && lng && lat !== 0 && lng !== 0;
        });

        if (records.length === 0) {
            throw new Error('No valid GPS coordinates in FIT file');
        }

        console.log(`📍 Found ${records.length} GPS points`);

        const firstRecord = records[0];
        const lastRecord = records[records.length - 1];

        // Auto-detect Zwift world from coordinates if not provided
        if (!worldId) {
            worldId = this.detectZwiftWorld(firstRecord);
        }

        // Convert GPS to Zwift coordinates
        const coordinates = [];
        const checkpoints = [];
        let checkpointId = 0;

        // Start checkpoint
        checkpoints.push(this.createCheckpoint(firstRecord, firstRecord, checkpointId++, worldId, true, false));

        // Intermediate checkpoints every 1km
        let nextKmDistance = CHECKPOINT_INTERVAL_METERS;

        for (const record of records) {
            // Convert GPS to Zwift coordinates
            const zwiftCoords = this.gpsToZwift(record, worldId);
            if (zwiftCoords) {
                coordinates.push(zwiftCoords);
            }

            // Add checkpoint every 1km
            const distance = (record.distance || 0) - (firstRecord.distance || 0);
            if (distance >= nextKmDistance) {
                checkpoints.push(this.createCheckpoint(record, firstRecord, checkpointId++, worldId, false, false));
                nextKmDistance += CHECKPOINT_INTERVAL_METERS;
            }
        }

        // Finish checkpoint
        checkpoints.push(this.createCheckpoint(lastRecord, firstRecord, checkpointId++, worldId, false, true));

        const totalDistance = (lastRecord.distance || 0) - (firstRecord.distance || 0);
        const totalTime = (lastRecord.timer_time || lastRecord.elapsed_time || 0) -
                         (firstRecord.timer_time || firstRecord.elapsed_time || 0);

        console.log(`✅ Created ${checkpoints.length} checkpoints`);
        console.log(`   Distance: ${(totalDistance / 1000).toFixed(2)} km`);
        console.log(`   Time: ${H.duration(totalTime)}`);

        return {
            name: fileName.replace('.fit', ''),
            worldId: worldId,
            coordinates: coordinates,
            checkpoints: checkpoints,
            metadata: {
                source: 'fit',
                fileName: fileName,
                totalDistance: totalDistance,
                totalTime: totalTime,
                recordCount: records.length,
                uploadTime: Date.now()
            }
        };
    }

    /**
     * Create checkpoint from FIT record
     */
    createCheckpoint(record, startRecord, id, worldId, isStart, isFinish) {
        let lat = record.position_lat;
        let lng = record.position_long;

        // Convert semicircles to degrees if needed
        if (Math.abs(lat) > 1000000) {
            lat = lat * (180 / Math.pow(2, 31));
            lng = lng * (180 / Math.pow(2, 31));
        }

        // Convert to Zwift coordinates
        const zwiftCoords = this.gpsToZwift(record, worldId);

        const distance = (record.distance || 0) - (startRecord.distance || 0);
        const elapsedTime = (record.timer_time || record.elapsed_time || 0) -
                           (startRecord.timer_time || startRecord.elapsed_time || 0);

        let name = '';
        if (isStart) {
            name = 'Start';
        } else if (isFinish) {
            name = 'Finish';
        } else {
            name = `${(distance / 1000).toFixed(1)}km`;
        }

        return {
            id: id,
            name: name,
            coordinates: zwiftCoords || [0, 0],
            gpsCoordinates: [lat, lng],
            distance: distance,
            altitude: record.altitude || record.enhanced_altitude || 0,
            time: elapsedTime, // Time in seconds
            type: isStart ? 'start' : (isFinish ? 'finish' : 'checkpoint'),

            // Additional telemetry
            power: record.power || 0,
            heartRate: record.heart_rate || 0,
            cadence: record.cadence || 0,
            speed: record.speed || 0,

            completed: false,
            active: false
        };
    }

    /**
     * Convert GPS coordinates to Zwift coordinates
     */
    gpsToZwift(record, worldId) {
        let lat = record.position_lat;
        let lng = record.position_long;

        if (Math.abs(lat) > 1000000) {
            lat = lat * (180 / Math.pow(2, 31));
            lng = lng * (180 / Math.pow(2, 31));
        }

        try {
            return convertCoordinates({ lat, lng }, worldId, 'auto');
        } catch (err) {
            console.warn('Coordinate conversion failed:', err.message);
            return null;
        }
    }

    /**
     * Attempt to detect Zwift world from GPS coordinates
     */
    detectZwiftWorld(record) {
        let lat = record.position_lat;
        let lng = record.position_long;

        if (Math.abs(lat) > 1000000) {
            lat = lat * (180 / Math.pow(2, 31));
            lng = lng * (180 / Math.pow(2, 31));
        }

        // Rough world detection based on GPS bounds
        // Watopia (around -11.6 lat, 166.9 lng)
        if (lat > -12 && lat < -11 && lng > 166 && lng < 167) {
            return 1; // Watopia
        }
        // France (around 46.0 lat, 6.2 lng)
        if (lat > 45 && lat < 47 && lng > 5 && lng < 7) {
            return 10; // France
        }
        // Yorkshire (around 53.9 lat, -1.08 lng)
        if (lat > 53 && lat < 54 && lng > -2 && lng < 0) {
            return 7; // Yorkshire
        }
        // London (around 51.5 lat, -0.12 lng)
        if (lat > 51 && lat < 52 && lng > -1 && lng < 1) {
            return 3; // London
        }
        // New York (around 40.7 lat, -74.0 lng)
        if (lat > 40 && lat < 41 && lng > -75 && lng < -73) {
            return 4; // New York
        }

        console.warn(`Could not auto-detect world from GPS (${lat.toFixed(2)}, ${lng.toFixed(2)})`);
        return 1; // Default to Watopia
    }

    /**
     * Store an attempt for comparison
     */
    storeAttempt(routeData) {
        const attemptId = `attempt_${this.attemptCounter++}_${Date.now()}`;
        this.attempts.set(attemptId, {
            id: attemptId,
            name: routeData.name,
            checkpoints: routeData.checkpoints,
            metadata: routeData.metadata
        });

        console.log(`💾 Stored attempt: ${attemptId}`);
        return attemptId;
    }

    /**
     * Get stored attempt
     */
    getAttempt(attemptId) {
        return this.attempts.get(attemptId);
    }

    /**
     * Get all attempts
     */
    getAllAttempts() {
        return Array.from(this.attempts.values());
    }

    /**
     * Compare checkpoint times between two attempts
     */
    compareAttempts(attemptId1, attemptId2) {
        const attempt1 = this.attempts.get(attemptId1);
        const attempt2 = this.attempts.get(attemptId2);

        if (!attempt1 || !attempt2) {
            throw new Error('One or both attempts not found');
        }

        const comparison = [];
        const minCheckpoints = Math.min(attempt1.checkpoints.length, attempt2.checkpoints.length);

        for (let i = 0; i < minCheckpoints; i++) {
            const cp1 = attempt1.checkpoints[i];
            const cp2 = attempt2.checkpoints[i];

            const delta = cp1.time - cp2.time;

            comparison.push({
                checkpoint: i,
                name: cp1.name,
                distance: cp1.distance,
                time1: cp1.time,
                time2: cp2.time,
                delta: delta,
                deltaFormatted: this.formatDelta(delta),
                isAhead: delta < 0 // Attempt 1 is ahead if delta is negative
            });
        }

        return comparison;
    }

    /**
     * Format time delta with +/- sign
     */
    formatDelta(deltaSeconds) {
        const abs = Math.abs(deltaSeconds);
        const sign = deltaSeconds >= 0 ? '+' : '-';
        return `${sign}${H.duration(abs)}`;
    }

    /**
     * Clear all stored attempts
     */
    clearAttempts() {
        this.attempts.clear();
        this.attemptCounter = 0;
        console.log('🗑️  Cleared all attempts');
    }
}

/**
 * Create comparison table HTML
 */
export function createComparisonTable(comparison, attempt1Name, attempt2Name) {
    const rows = comparison.map(cp => `
        <tr class="${cp.isAhead ? 'ahead' : 'behind'}">
            <td>${cp.name}</td>
            <td>${(cp.distance / 1000).toFixed(2)} km</td>
            <td>${H.duration(cp.time1)}</td>
            <td>${H.duration(cp.time2)}</td>
            <td class="delta ${cp.isAhead ? 'positive' : 'negative'}">${cp.deltaFormatted}</td>
        </tr>
    `).join('');

    return `
        <div class="comparison-panel">
            <h3>Time Comparison</h3>
            <div class="comparison-header">
                <span class="attempt1">${attempt1Name}</span>
                <span class="vs">vs</span>
                <span class="attempt2">${attempt2Name}</span>
            </div>
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Checkpoint</th>
                        <th>Distance</th>
                        <th>${attempt1Name}</th>
                        <th>${attempt2Name}</th>
                        <th>Δ</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}
