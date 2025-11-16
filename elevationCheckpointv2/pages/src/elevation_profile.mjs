// ============================================================================
// Elevation Profile with FIT Checkpoints - FIXED VERSION
// Gets route from athlete state, shows times on all checkpoints, clears on exit
// ============================================================================

import * as common from '/pages/src/common.mjs';
import * as elevation from '/pages/src/elevation.mjs';
import * as locale from '/shared/sauce/locale.mjs';

const CHECKPOINT_INTERVAL_METERS = 1000;
const STORAGE_KEY = 'ghostRiderData';
const PROCESSING_OPTIONS_KEY = 'fit-processing-options';
const WATCHDOG_TIMEOUT = 10000;
const WATCHDOG_CHECK_INTERVAL = 5000;
const CHECKPOINT_LOAD_DELAY = 1000;

const DEFAULT_SETTINGS = {
    profileHeight: 100,
    routeProfile: true,
    showElevationMaxLine: true,
    showCheckpointsOnProfile: true,
    autoRefresh: false,
    refreshRate: 1000,
};

let worldList = null;
let elProfile = null;
let athleteId = null;
let watchingId = null;
let inGame = false;
let fitCheckpoints = [];
let rawFitData = null;
let watchdog = null;
let processingOptions = { mode: 'auto' };
let currentRoute = null;

common.settingsStore.setDefault(DEFAULT_SETTINGS);
const settings = common.settingsStore.get();
const H = locale.human;

// ============================================================================
// ROUTE DETECTION FROM ATHLETE STATE
// ============================================================================

/**
 * Gets route information from the current athlete's state
 * This is the CORRECT way to get route info in Sauce4Zwift
 */
async function getRouteFromAthleteState() {
    try {
        console.log('🔍 Getting route from athlete state...');
        
        // Get watching athlete data (or self if not watching anyone)
        const athleteData = await common.rpc.getAthleteData('watching');
        if (!athleteData || !athleteData.state) {
            console.warn('   ⚠️  No athlete state available');
            return null;
        }
        
        const state = athleteData.state;
        console.log(`   • Route ID: ${state.routeId}`);
        console.log(`   • Event Subgroup ID: ${state.eventSubgroupId}`);
        
        // If in an event, get event subgroup info
        if (state.eventSubgroupId) {
            try {
                const sg = await common.rpc.getEventSubgroup(state.eventSubgroupId);
                if (sg && sg.routeId) {
                    const route = await common.rpc.getRoute(sg.routeId);
                    if (route) {
                        console.log(`   ✅ Event Route: ${route.name}`);
                        console.log(`      • Distance: ${(route.distanceInMeters / 1000).toFixed(2)} km`);
                        console.log(`      • Lead-in: ${((route.leadinDistanceInMeters || 0) / 1000).toFixed(2)} km`);
                        console.log(`      • Laps: ${sg.laps || 1}`);
                        
                        return {
                            name: route.name,
                            distance: route.distanceInMeters,
                            leadIn: route.leadinDistanceInMeters || 0,
                            laps: sg.laps || 1,
                            totalDistance: sg.distanceInMeters || (route.distanceInMeters * (sg.laps || 1))
                        };
                    }
                }
            } catch (err) {
                console.warn('   ⚠️  Could not get event subgroup:', err.message);
            }
        }
        
        // Free ride or no event - just get the route
        if (state.routeId) {
            try {
                const route = await common.rpc.getRoute(state.routeId);
                if (route) {
                    console.log(`   ✅ Route: ${route.name}`);
                    console.log(`      • Distance: ${(route.distanceInMeters / 1000).toFixed(2)} km`);
                    console.log(`      • Lead-in: ${((route.leadinDistanceInMeters || 0) / 1000).toFixed(2)} km`);
                    
                    return {
                        name: route.name,
                        distance: route.distanceInMeters,
                        leadIn: route.leadinDistanceInMeters || 0,
                        laps: 1,
                        totalDistance: route.distanceInMeters
                    };
                }
            } catch (err) {
                console.warn('   ⚠️  Could not get route:', err.message);
            }
        }
        
        console.warn('   ⚠️  No route information available');
        return null;
        
    } catch (error) {
        console.error('   ❌ Error getting route from athlete state:', error);
        return null;
    }
}

/**
 * Attempts to detect the route from FIT file data
 */
async function detectRouteDistance(fitData) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔍 STARTING ROUTE AUTO-DETECTION');
    console.log('═══════════════════════════════════════════════════════');
    
    const totalRecords = fitData.records.length;
    const totalDistance = fitData.records[totalRecords - 1]?.distance || 0;
    
    console.log(`📊 FIT File Stats:`);
    console.log(`   • Total records: ${totalRecords}`);
    console.log(`   • Total distance in file: ${(totalDistance / 1000).toFixed(2)} km`);
    console.log(`   • Total time: ${H.duration(fitData.records[totalRecords - 1]?.elapsed_time || 0)}`);
    
    // Strategy 1: Get route from current athlete state (BEST METHOD)
    const athleteRoute = await getRouteFromAthleteState();
    if (athleteRoute) {
        console.log('');
        console.log('✅ ROUTE FROM ATHLETE STATE:');
        console.log(`   • Route: ${athleteRoute.name}`);
        console.log(`   • Distance: ${(athleteRoute.distance / 1000).toFixed(2)} km`);
        if (athleteRoute.leadIn > 0) {
            console.log(`   • Lead-in: ${(athleteRoute.leadIn / 1000).toFixed(2)} km`);
            console.log(`   • Total: ${(athleteRoute.totalDistance / 1000).toFixed(2)} km`);
        }
        
        return {
            distance: athleteRoute.totalDistance,
            leadIn: athleteRoute.leadIn,
            routeName: athleteRoute.name
        };
    }
    
    // Strategy 2: Try lap data from FIT file
    if (fitData.laps && fitData.laps.length > 0) {
        console.log('');
        console.log('📋 Using Lap Data:');
        const firstLapDistance = fitData.laps[0]?.total_distance;
        if (firstLapDistance) {
            console.log(`   • First lap: ${(firstLapDistance / 1000).toFixed(2)} km`);
            return {
                distance: firstLapDistance,
                leadIn: 0,
                routeName: null
            };
        }
    }
    
    // Strategy 3: Try session distance
    if (fitData.sessions && fitData.sessions.length > 0) {
        const session = fitData.sessions[0];
        console.log('');
        console.log('📝 Using Session Data:');
        console.log(`   • Session distance: ${(session.total_distance / 1000).toFixed(2)} km`);
        
        if (session.total_distance) {
            return {
                distance: session.total_distance,
                leadIn: 0,
                routeName: null
            };
        }
    }
    
    // Strategy 4: Detect finish point by analyzing power/speed
    console.log('');
    console.log('🔬 Analyzing records for finish point...');
    
    const detectedEnd = await detectFinishPoint(fitData.records);
    if (detectedEnd) {
        console.log('');
        console.log('✅ FINISH POINT DETECTED:');
        console.log(`   • Detected distance: ${(detectedEnd.distance / 1000).toFixed(2)} km`);
        console.log(`   • Detected at: ${H.duration(detectedEnd.time)}`);
        console.log(`   • Method: ${detectedEnd.method}`);
        
        return {
            distance: detectedEnd.distance,
            leadIn: 0,
            routeName: null
        };
    }
    
    console.log('');
    console.warn('⚠️  AUTO-DETECTION FAILED - Using full file');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    
    return null;
}

/**
 * Detects finish point by looking for significant power drops or stops
 */
async function detectFinishPoint(records) {
    const validRecords = records.filter(r => r.distance && r.distance > 0);
    if (validRecords.length < 100) {
        console.log('   • Not enough records for analysis');
        return null;
    }
    
    const lastRecord = validRecords[validRecords.length - 1];
    const startRecord = validRecords[0];
    
    console.log(`   • Analyzing last ${Math.min(120, validRecords.length)} records...`);
    
    // Look backwards for significant power/speed drop
    for (let i = validRecords.length - 1; i >= Math.max(0, validRecords.length - 120); i--) {
        const record = validRecords[i];
        const avgPowerBefore = calculateAvgPower(validRecords, Math.max(0, i - 30), i);
        const avgPowerAfter = calculateAvgPower(validRecords, i, Math.min(validRecords.length, i + 30));
        
        if (avgPowerBefore > 50 && avgPowerAfter < avgPowerBefore * 0.2) {
            const time = (record.elapsed_time || record.timer_time) - (startRecord.elapsed_time || startRecord.timer_time);
            console.log(`   • Power drop detected:`);
            console.log(`     Before: ${avgPowerBefore.toFixed(0)}W → After: ${avgPowerAfter.toFixed(0)}W`);
            
            return {
                distance: record.distance - startRecord.distance,
                time: time,
                method: 'Power drop analysis'
            };
        }
    }
    
    // Check for cooldown period
    const last5MinIndex = Math.max(0, validRecords.length - 300);
    const last5MinDistance = lastRecord.distance - validRecords[last5MinIndex].distance;
    
    if (last5MinDistance < 500) {
        console.log(`   • Cooldown period detected:`);
        console.log(`     Last 5 min: only ${last5MinDistance.toFixed(0)}m`);
        
        const cutoffRecord = validRecords[last5MinIndex];
        const time = (cutoffRecord.elapsed_time || cutoffRecord.timer_time) - (startRecord.elapsed_time || startRecord.timer_time);
        
        return {
            distance: cutoffRecord.distance - startRecord.distance,
            time: time,
            method: 'Cooldown period detection'
        };
    }
    
    console.log('   • No clear finish point detected');
    return null;
}

function calculateAvgPower(records, startIdx, endIdx) {
    let sum = 0;
    let count = 0;
    for (let i = startIdx; i < endIdx && i < records.length; i++) {
        if (records[i].power && records[i].power > 0) {
            sum += records[i].power;
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
}

// ============================================================================
// FIT LOADER
// ============================================================================

class FitCheckpointLoader {
    constructor() {
        this.checkpoints = [];
        this.allRecords = [];
        this.fitData = null;
        this.detectedRoute = null;
    }
    
    async parseFitFile(arrayBuffer, options = { mode: 'auto' }) {
        if (typeof window.FitParser === 'undefined') {
            throw new Error('FitParser not loaded');
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('📂 PARSING FIT FILE');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Processing mode: ${options.mode}`);
        
        return new Promise((resolve, reject) => {
            const fitParser = new window.FitParser({
                force: true,
                mode: 'both',
                elapsedRecordField: true,
                pausedRecordField: true
            });
            
            fitParser.parse(arrayBuffer, async (error, data) => {
                if (error) {
                    console.error('❌ FIT parsing failed:', error);
                    reject(new Error(`FIT parsing failed: ${error.message || error}`));
                    return;
                }
                
                if (!data?.records?.length) {
                    console.error('❌ No records found in FIT file');
                    reject(new Error('No FIT records found'));
                    return;
                }
                
                console.log('✅ FIT file parsed successfully');
                console.log(`   • ${data.records.length} records`);
                console.log(`   • ${data.laps?.length || 0} laps`);
                console.log(`   • ${data.sessions?.length || 0} sessions`);
                
                try {
                    this.allRecords = data.records;
                    this.fitData = data;
                    
                    // AUTO-DETECT route distance if mode is 'auto'
                    if (options.mode === 'auto') {
                        this.detectedRoute = await detectRouteDistance(data);
                        
                        if (this.detectedRoute) {
                            console.log('');
                            console.log('🎯 USING AUTO-DETECTED DISTANCE:');
                            console.log(`   • Distance: ${(this.detectedRoute.distance / 1000).toFixed(2)} km`);
                            if (this.detectedRoute.routeName) {
                                console.log(`   • Route: ${this.detectedRoute.routeName}`);
                            }
                            
                            options = { 
                                mode: 'distance', 
                                distance: this.detectedRoute.distance / 1000
                            };
                        } else {
                            console.log('');
                            console.log('⚠️  Using full file');
                            options = { mode: 'full' };
                        }
                    }
                    
                    const checkpoints = this.extractCheckpoints(data.records, data, options);
                    
                    console.log('');
                    console.log('═══════════════════════════════════════════════════════');
                    console.log('');
                    
                    resolve(checkpoints);
                } catch (extractError) {
                    console.error('❌ Checkpoint extraction failed:', extractError);
                    reject(extractError);
                }
            });
        });
    }
    
    extractCheckpoints(records, fitData, options = { mode: 'full' }) {
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('📍 EXTRACTING CHECKPOINTS');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Mode: ${options.mode}`);
        
        const validRecords = records.filter(r => {
            const lat = r.position_lat;
            const lng = r.position_long;
            return lat && lng && lat !== 0 && lng !== 0;
        });
        
        if (!validRecords.length) {
            console.error('❌ No valid GPS coordinates found');
            throw new Error('No valid GPS coordinates');
        }
        
        console.log(`✅ ${validRecords.length} valid GPS records`);
        
        const firstRecord = validRecords[0];
        let lastRecord = validRecords[validRecords.length - 1];
        
        // Apply processing mode
        if (options.mode === 'one-lap' && fitData.laps?.length) {
            const lap = fitData.laps[0];
            const duration = lap.total_timer_time || lap.total_elapsed_time;
            const target = (firstRecord.timer_time || 0) + duration;
            
            for (const r of validRecords) {
                if ((r.timer_time || 0) >= target) {
                    lastRecord = r;
                    break;
                }
            }
            console.log(`Using first lap: ${H.duration(duration)}`);
            
        } else if (options.mode === 'multi-lap' && fitData.laps?.length) {
            const numLaps = Math.min(options.laps, fitData.laps.length);
            let totalDuration = 0;
            for (let i = 0; i < numLaps; i++) {
                totalDuration += fitData.laps[i].total_elapsed_time;
            }
            const target = (firstRecord.elapsed_time || 0) + totalDuration;
            for (const r of validRecords) {
                if ((r.elapsed_time || 0) >= target) {
                    lastRecord = r;
                    break;
                }
            }
            console.log(`Using ${numLaps} laps: ${H.duration(totalDuration)}`);
            
        } else if (options.mode === 'distance') {
            const targetDist = options.distance * 1000;
            for (const r of validRecords) {
                if ((r.distance - firstRecord.distance) >= targetDist) {
                    lastRecord = r;
                    break;
                }
            }
            console.log(`Using distance cutoff: ${options.distance.toFixed(2)} km`);
        } else {
            console.log('Using full file');
        }
        
        const lastIdx = validRecords.indexOf(lastRecord);
        const processRecords = validRecords.slice(0, lastIdx + 1);
        
        const finalDistance = (lastRecord.distance - firstRecord.distance) / 1000;
        const finalTime = (lastRecord.timer_time || lastRecord.elapsed_time) - 
                         (firstRecord.timer_time || firstRecord.elapsed_time);
        
        console.log('');
        console.log(`✅ Processing ${processRecords.length} of ${validRecords.length} records`);
        console.log(`   • Final distance: ${finalDistance.toFixed(2)} km`);
        console.log(`   • Final time: ${H.duration(finalTime)}`);
        console.log(`   • Checkpoint interval: ${CHECKPOINT_INTERVAL_METERS}m`);
        
        // Create checkpoints
        const checkpoints = [];
        let id = 0;
        
        checkpoints.push(this.createCheckpoint(firstRecord, firstRecord, id++, true, false));
        
        let nextKm = CHECKPOINT_INTERVAL_METERS;
        let checkpointCount = 0;
        for (const r of processRecords) {
            const dist = r.distance - firstRecord.distance;
            if (dist >= nextKm) {
                checkpoints.push(this.createCheckpoint(r, firstRecord, id++, false, false));
                checkpointCount++;
                nextKm += CHECKPOINT_INTERVAL_METERS;
            }
        }
        
        const lastDist = lastRecord.distance - firstRecord.distance;
        if (Math.abs(checkpoints[checkpoints.length - 1].distance - lastDist) > 50) {
            checkpoints.push(this.createCheckpoint(lastRecord, firstRecord, id++, false, true));
        } else {
            checkpoints[checkpoints.length - 1].isFinish = true;
        }
        
        console.log(`✅ Created ${checkpoints.length} checkpoints`);
        console.log(`   • Start marker: 1`);
        console.log(`   • Intermediate: ${checkpointCount}`);
        console.log(`   • Finish marker: 1`);
        console.log('═══════════════════════════════════════════════════════');
        console.log('');
        
        return checkpoints;
    }
    
    createCheckpoint(record, startRecord, id, isStart, isFinish) {
        let lat = record.position_lat;
        let lng = record.position_long;
        
        if (Math.abs(lat) > 1000000) {
            lat = lat * (180 / Math.pow(2, 31));
            lng = lng * (180 / Math.pow(2, 31));
        }
        
        return {
            id: `checkpoint-${id}`,
            distance: (record.distance || 0) - (startRecord.distance || 0),
            distanceKm: Math.round(((record.distance || 0) - (startRecord.distance || 0)) / 100) / 10,
            coordinates: [lat, lng],
            power: record.power || 0,
            heartRate: record.heart_rate || 0,
            altitude: record.altitude || record.enhanced_altitude || 0,
            cadence: record.cadence || 0,
            speed: record.speed || 0,
            elapsedTime: (record.timer_time || 0) - (startRecord.timer_time || 0),
            elapsedTimeRaw: (record.elapsed_time || 0) - (startRecord.elapsed_time || 0),
            isStart: isStart,
            isFinish: isFinish
        };
    }
    
    async reprocessWithOptions(options) {
        if (!this.fitData) throw new Error('No FIT data loaded');
        console.log('🔄 Reprocessing with new options:', options);
        const checkpoints = this.extractCheckpoints(this.allRecords, this.fitData, options);
        this.checkpoints = checkpoints;
        this.saveToStorage(checkpoints);
        return checkpoints;
    }
    
    async loadFromFile(file, options = { mode: 'auto' }) {
        const arrayBuffer = await file.arrayBuffer();
        const checkpoints = await this.parseFitFile(arrayBuffer, options);
        this.checkpoints = checkpoints;
        this.saveToStorage(checkpoints);
        return checkpoints;
    }
    
    saveToStorage(checkpoints) {
        try {
            const data = {
                checkpoints: checkpoints.map(cp => ({
                    distance: cp.distance,
                    elapsedTime: cp.elapsedTime,
                    power: cp.power || 0,
                    altitude: cp.altitude || 0
                })),
                totalDistance: Math.max(...checkpoints.map(cp => cp.distance)),
                totalTime: Math.max(...checkpoints.map(cp => cp.elapsedTime))
            };
            common.storage.set(STORAGE_KEY, data);
            console.log('💾 Checkpoints saved to storage');
            return true;
        } catch (error) {
            console.error('❌ Storage error:', error);
            return false;
        }
    }
}

// ============================================================================
// ELEVATION PROFILE - WITH TIMES ON ALL CHECKPOINTS
// ============================================================================

class CheckpointElevationProfile extends elevation.SauceElevationProfile {
    constructor(options) {
        super(options);
        this.fitCheckpoints = [];
        this.checkpointsVisible = true;
    }
    
    async addFitCheckpoints(checkpoints) {
        if (!checkpoints || !Array.isArray(checkpoints) || !checkpoints.length) {
            console.warn('No valid checkpoints to add');
            return;
        }
        
        this.fitCheckpoints = checkpoints.map(cp => ({
            ...cp,
            distance: cp.distance || 0,
            altitude: cp.altitude || 0,
            power: cp.power || 0,
            elapsedTime: cp.elapsedTime || 0
        }));
        
        console.log(`✅ Added ${this.fitCheckpoints.length} FIT checkpoints to elevation profile`);
        
        if (this.checkpointsVisible) {
            this.renderCheckpoints();
        }
    }
    
    clearCheckpoints() {
        this.fitCheckpoints = [];
        this.renderCheckpoints();
        console.log('🗑️  Cleared all checkpoints');
    }
    
    toggleCheckpoints() {
        this.checkpointsVisible = !this.checkpointsVisible;
        this.renderCheckpoints();
        console.log(`👁️  Checkpoints ${this.checkpointsVisible ? 'shown' : 'hidden'}`);
        return this.checkpointsVisible;
    }
    
    renderCheckpoints() {
        if (!this.chart) {
            console.warn('Chart not initialized');
            return;
        }
        
        if (!this.checkpointsVisible || !this.fitCheckpoints || this.fitCheckpoints.length === 0) {
            try {
                this.chart.setOption({
                    series: [{
                        id: 'fit-checkpoints',
                        type: 'scatter',
                        data: []
                    }]
                });
            } catch (error) {
                console.error('Error clearing checkpoint series:', error);
            }
            return;
        }
        
        const checkpointData = this.fitCheckpoints.map((cp, index) => {
            const isStart = cp.isStart || index === 0;
            const isFinish = cp.isFinish || index === this.fitCheckpoints.length - 1;
            
            // Format time label for ALL checkpoints
            const timeStr = cp.elapsedTime ? new Date(cp.elapsedTime * 1000).toISOString().substr(14, 5) : '';
            const distKm = (cp.distance / 1000).toFixed(1);
            
            return {
                value: [cp.distance, cp.altitude],
                symbol: isStart ? 'triangle' : (isFinish ? 'diamond' : 'circle'),
                symbolSize: isStart || isFinish ? 14 : 10,
                itemStyle: {
                    color: isStart ? '#4CAF50' : (isFinish ? '#F44336' : '#2196F3'),
                    borderColor: '#fff',
                    borderWidth: 2,
                    shadowBlur: 4,
                    shadowColor: 'rgba(0, 0, 0, 0.3)'
                },
                label: {
                    show: true,  // Show labels on ALL checkpoints now
                    position: 'top',
                    distance: 8,
                    formatter: () => {
                        if (isStart) return 'START';
                        if (isFinish) return 'FINISH';
                        // Show distance and time for intermediate checkpoints
                        return `${distKm}km\n${timeStr}`;
                    },
                    fontSize: isStart || isFinish ? 11 : 9,
                    fontWeight: isStart || isFinish ? 'bold' : 'normal',
                    color: '#fff',
                    backgroundColor: isStart ? '#4CAF50' : (isFinish ? '#F44336' : '#2196F3'),
                    padding: isStart || isFinish ? [3, 7] : [2, 5],
                    borderRadius: 3,
                    lineHeight: 12
                },
                emphasis: {
                    scale: 1.5,
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }
                },
                checkpoint: cp
            };
        });
        
        try {
            this.chart.setOption({
                series: [{
                    id: 'fit-checkpoints',
                    name: 'FIT Checkpoints',
                    type: 'scatter',
                    coordinateSystem: 'cartesian2d',
                    zlevel: 10,
                    data: checkpointData,
                    tooltip: {
                        formatter: (params) => {
                            const cp = params.data.checkpoint;
                            if (!cp) return '';
                            
                            const distKm = (cp.distance / 1000).toFixed(2);
                            const timeStr = cp.elapsedTime ? 
                                new Date(cp.elapsedTime * 1000).toISOString().substr(11, 8) : 'N/A';
                            
                            return `
                                <div style="padding: 5px;">
                                    <strong>Checkpoint ${cp.distanceKm}km</strong><br/>
                                    Distance: ${distKm} km<br/>
                                    Altitude: ${cp.altitude.toFixed(1)} m<br/>
                                    Time: ${timeStr}<br/>
                                    ${cp.power ? `Power: ${cp.power} W<br/>` : ''}
                                    ${cp.heartRate ? `HR: ${cp.heartRate} bpm<br/>` : ''}
                                    ${cp.cadence ? `Cadence: ${cp.cadence} rpm` : ''}
                                </div>
                            `;
                        }
                    }
                }]
            });
            
            console.log(`📊 Rendered ${checkpointData.length} checkpoint markers with times`);
        } catch (error) {
            console.error('Error rendering checkpoints:', error);
        }
    }
    
    setData(distances, elevations, grades, options) {
        super.setData(distances, elevations, grades, options);
        
        if (this.fitCheckpoints && this.fitCheckpoints.length > 0 && this.checkpointsVisible) {
            setTimeout(() => this.renderCheckpoints(), 100);
        }
    }
}

// ============================================================================
// CLEANUP ON WINDOW CLOSE
// ============================================================================

function setupCleanupOnClose() {
    // Clear storage when window closes
    window.addEventListener('beforeunload', () => {
        console.log('🧹 Cleaning up before window close');
        try {
            common.storage.set(STORAGE_KEY, null);
            console.log('✅ Cleared checkpoint storage');
        } catch (e) {
            console.error('Failed to clear storage:', e);
        }
    });
    
    console.log('✅ Cleanup handler registered');
}

// ============================================================================
// UI AND CONTROLS
// ============================================================================

function openProcessingOptionsWindow() {
    if (!rawFitData) {
        showNotification('Load FIT file first', 'warning');
        return;
    }
    
    console.log('⚙️  Opening processing options dialog');
    
    try {
        sauce.rpc.openWindow({
            id: 'processing-options',
            url: '/pages/elevation_profile/processing_options.html',
            bounds: { width: 520, height: 600 }
        });
    } catch (error) {
        console.error('Failed to open processing options:', error);
        showNotification('Failed to open options', 'error');
    }
}

function setupProcessingOptionsListener() {
    console.log('👂 Setting up processing options listener');
    
    const checkInterval = setInterval(async () => {
        try {
            const data = common.storage.get(PROCESSING_OPTIONS_KEY);
            
            if (data?.timestamp && data.timestamp > (window._lastProcessingOptionsTimestamp || 0)) {
                window._lastProcessingOptionsTimestamp = data.timestamp;
                
                console.log('');
                console.log('═══════════════════════════════════════════════════════');
                console.log('⚙️  NEW PROCESSING OPTIONS DETECTED');
                console.log('═══════════════════════════════════════════════════════');
                console.log('Options:', data.options);
                
                if (data.options && window.fitLoader && rawFitData) {
                    processingOptions = data.options;
                    showNotification('Reprocessing...', 'info');
                    
                    try {
                        const checkpoints = await window.fitLoader.reprocessWithOptions(processingOptions);
                        
                        if (elProfile) {
                            elProfile.clearCheckpoints();
                            fitCheckpoints = [...checkpoints];
                            await elProfile.addFitCheckpoints(fitCheckpoints);
                            elProfile.checkpointsVisible = true;
                            elProfile.renderCheckpoints();
                            updateButtonStates();
                            
                            const modeLabel = {
                                'full': 'Full file',
                                'distance': `${processingOptions.distance}km`,
                                'one-lap': 'One lap',
                                'multi-lap': `${processingOptions.laps} laps`
                            }[processingOptions.mode] || processingOptions.mode;
                            
                            showNotification(`✅ ${checkpoints.length} checkpoints (${modeLabel})`, 'success');
                        }
                    } catch (error) {
                        console.error('Reprocessing error:', error);
                        showNotification(`Error: ${error.message}`, 'error');
                    }
                }
            }
        } catch (error) {
            // Ignore storage errors during polling
        }
    }, 500);
    
    window._processingOptionsInterval = checkInterval;
}

function showNotification(msg, type = 'info') {
    const n = document.getElementById('notification');
    if (!n) return;
    n.textContent = msg;
    n.className = `notification ${type} show`;
    n.style.display = 'block';
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            n.classList.remove('show');
            setTimeout(() => n.style.display = 'none', 300);
        }, 3000);
    }
}

function createElevationProfile() {
    const el = document.querySelector('.elevation-container');
    if (!el) return null;
    try {
        const profile = new CheckpointElevationProfile({
            el, worldList,
            preferRoute: settings.routeProfile,
            showMaxLine: settings.showElevationMaxLine,
            refresh: settings.refreshRate
        });
        console.log('✅ Elevation profile created');
        showNotification('Ready - Auto-detection enabled', 'success');
        return profile;
    } catch (error) {
        console.error('Failed to create elevation profile:', error);
        showNotification('Failed to create profile', 'error');
        return null;
    }
}

async function loadCheckpointsFromStorage() {
    try {
        const data = common.storage.get(STORAGE_KEY);
        if (!data?.checkpoints?.length) return false;
        
        if (!elProfile) {
            setTimeout(loadCheckpointsFromStorage, 500);
            return false;
        }
        
        console.log('💾 Loading checkpoints from storage');
        
        elProfile.clearCheckpoints();
        fitCheckpoints = [...data.checkpoints];
        await elProfile.addFitCheckpoints(fitCheckpoints);
        if (settings.showCheckpointsOnProfile !== false) {
            elProfile.checkpointsVisible = true;
            elProfile.renderCheckpoints();
        }
        updateButtonStates();
        showNotification(`Loaded ${fitCheckpoints.length} checkpoints`, 'success');
        return true;
    } catch (error) {
        return false;
    }
}

async function handleFitFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.fit')) {
        showNotification('Select a .FIT file', 'error');
        return;
    }
    
    try {
        showNotification('🔍 Loading & detecting route...', 'info');
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`📂 Loading FIT file: ${file.name}`);
        console.log(`   Size: ${(file.size / 1024).toFixed(2)} KB`);
        console.log('═══════════════════════════════════════════════════════');
        
        const loader = new FitCheckpointLoader();
        const checkpoints = await loader.loadFromFile(file, { mode: 'auto' });
        
        if (!elProfile) {
            showNotification('Profile not ready', 'warning');
            return;
        }
        
        window.fitLoader = loader;
        rawFitData = loader.fitData;
        
        elProfile.clearCheckpoints();
        fitCheckpoints = [...checkpoints];
        await elProfile.addFitCheckpoints(fitCheckpoints);
        elProfile.checkpointsVisible = true;
        elProfile.renderCheckpoints();
        updateButtonStates();
        
        const finalDist = (checkpoints[checkpoints.length - 1].distance / 1000).toFixed(2);
        const routeName = loader.detectedRoute?.routeName;
        
        const msg = routeName
            ? `✅ ${routeName} - ${finalDist}km - ${checkpoints.length} checkpoints`
            : `✅ ${finalDist}km - ${checkpoints.length} checkpoints`;
            
        showNotification(msg, 'success');
        
    } catch (error) {
        console.error('Error loading FIT file:', error);
        showNotification(`Error: ${error.message}`, 'error');
    } finally {
        event.target.value = '';
    }
}

function updateButtonStates() {
    const processingBtn = document.getElementById('processing-options-btn');
    const toggleBtn = document.getElementById('toggle-checkpoints-btn');
    const clearBtn = document.getElementById('clear-btn');
    
    const hasCps = elProfile?.fitCheckpoints?.length > 0;
    const isVis = elProfile?.checkpointsVisible || false;
    const hasRaw = !!rawFitData;
    
    if (processingBtn) {
        processingBtn.disabled = !hasRaw;
        processingBtn.title = hasRaw ? 'FIT processing options' : 'Load FIT file first';
    }
    
    if (toggleBtn) {
        toggleBtn.disabled = !hasCps;
        toggleBtn.classList.toggle('active', hasCps && isVis);
        toggleBtn.title = hasCps ? (isVis ? 'Hide' : 'Show') + ' checkpoints' : 'No checkpoints';
    }
    
    if (clearBtn) {
        clearBtn.disabled = !hasCps;
        clearBtn.title = hasCps ? 'Clear' : 'No checkpoints';
    }
}

function setupControls() {
    const loadBtn = document.getElementById('load-fit-btn');
    const fitInput = document.getElementById('fit-file-input');
    
    if (loadBtn && fitInput) {
        loadBtn.addEventListener('click', () => fitInput.click());
        fitInput.addEventListener('change', handleFitFileSelect);
    }
    
    const processingBtn = document.getElementById('processing-options-btn');
    processingBtn?.addEventListener('click', openProcessingOptionsWindow);
    
    const toggleBtn = document.getElementById('toggle-checkpoints-btn');
    toggleBtn?.addEventListener('click', () => {
        if (!elProfile?.fitCheckpoints?.length) {
            showNotification('No checkpoints', 'warning');
            return;
        }
        const vis = elProfile.toggleCheckpoints();
        updateButtonStates();
        showNotification(`Checkpoints ${vis ? 'shown' : 'hidden'}`, 'info');
    });
    
    const clearBtn = document.getElementById('clear-btn');
    clearBtn?.addEventListener('click', () => {
        if (!elProfile?.fitCheckpoints?.length) {
            showNotification('No checkpoints', 'info');
            return;
        }
        
        console.log('🗑️  Clearing all checkpoints');
        elProfile.clearCheckpoints();
        fitCheckpoints = [];
        rawFitData = null;
        window.fitLoader = null;
        try { common.storage.set(STORAGE_KEY, null); } catch (e) {}
        updateButtonStates();
        showNotification('Cleared', 'info');
    });
    
    updateButtonStates();
}

async function initializeAthleteTracking() {
    try {
        let selfData = await common.rpc.getAthleteData('self');
        inGame = !!(selfData && selfData.age < 15000);
        if (selfData?.athleteId) {
            athleteId = selfData.athleteId;
            elProfile?.setAthlete?.(athleteId);
            console.log(`👤 Athlete ID: ${athleteId}`);
        }
        let watching = await common.rpc.getAthleteData('watching');
        watchingId = watching?.athleteId || athleteId;
        elProfile?.setWatching?.(watchingId);
    } catch (error) {
        console.error('Athlete tracking error:', error);
    }
}

function setupLiveTracking() {
    setInterval(() => {
        if (inGame && performance.now() - (watchdog || 0) > WATCHDOG_TIMEOUT) {
            inGame = false;
            initializeAthleteTracking();
        }
    }, WATCHDOG_CHECK_INTERVAL);
    
    common.subscribe('states', async (states) => {
        if (!states?.length) return;
        watchdog = performance.now();
        if (!inGame) {
            inGame = true;
            await initializeAthleteTracking();
        }
        if (elProfile?.renderAthleteStates) {
            try {
                await elProfile.renderAthleteStates(states);
            } catch (error) {}
        }
    });
    
    common.subscribe('watching-athlete-change', async (id) => {
        if (id && !isNaN(id)) {
            watchingId = id;
            if (elProfile?.setWatching) {
                try {
                    elProfile.setWatching(id);
                } catch (error) {}
            }
        }
    });
}

async function initialize() {
    try {
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('🚀 INITIALIZING ELEVATION PROFILE EXTENSION');
        console.log('═══════════════════════════════════════════════════════');
        
        worldList = await common.getWorldList();
        console.log(`✅ Loaded ${worldList?.length || 0} worlds`);
        
        elProfile = createElevationProfile();
        
        if (elProfile) {
            await initializeAthleteTracking();
            setupLiveTracking();
            setupControls();
            setupProcessingOptionsListener();
            setupCleanupOnClose();  // Register cleanup handler
            setTimeout(loadCheckpointsFromStorage, CHECKPOINT_LOAD_DELAY);
            
            console.log('✅ Initialization complete');
            console.log('═══════════════════════════════════════════════════════');
            console.log('');
        }
    } catch (error) {
        console.error('Init error:', error);
        showNotification('Init failed', 'error');
    }
}

async function main() {
    common.initInteractionListeners();
    console.log('📊 Elevation Profile v4.0 - Fixed Route Detection & Checkpoint Display');
    await initialize();
}

export { main };
