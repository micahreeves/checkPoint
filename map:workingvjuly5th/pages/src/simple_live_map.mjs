// simple_live_map.mjs - Using Sauce Built-in Systems (No Custom Positioning)
// PRINCIPLE: Use what Sauce already provides rather than reimplementing

import * as common from '/pages/src/common.mjs';
import * as map from '/pages/src/map.mjs';
import * as locale from '/shared/sauce/locale.mjs';

// Global references
let worldList;
let zwiftMap;
let athleteId;
let watchingId;
let watchdog;
let inGame = false;
let fitCheckpoints = null;

const H = locale.human;

// Use the SAME settings structure as main geo.mjs
common.settingsStore.setDefault({
    // Core map settings (same as geo.mjs)
    mapStyle: 'default',
    tiltShift: false,
    tiltShiftAmount: 80,
    sparkle: false,
    transparency: 0,
    quality: 50,
    verticalOffset: 0,
    fpsLimit: 30,
    zoomPriorityTilt: true,
    autoCenter: true,
    autoHeading: true,
    
    // Additional simple map settings
    showAthleteNames: true,
    liveTracking: true,
    showFitCheckpoints: true
});

const settings = common.settingsStore.get();

/**
 * Quality scale function (same as geo.mjs)
 */
function qualityScale(raw) {
    raw = raw || 1;
    const min = 0.2;
    return Math.min(2, (raw / 100) * (1 - min) + min);
}

/**
 * Get setting with fallback (same as geo.mjs)
 */
function getSetting(key, def) {
    const v = settings[key];
    return v === undefined ? def : v;
}

/**
 * Show simple notifications
 */
function showNotification(message, type = 'info') {
    let notification = document.querySelector('.map-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'map-notification';
        document.querySelector('#content').appendChild(notification);
    }
    
    notification.textContent = message;
    notification.className = `map-notification ${type}`;
    notification.style.display = 'block';
    
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            notification.style.display = 'none';
        }, 4000);
    }
}

/**
 * Create Zwift map using EXACT same config as geo.mjs main map
 * This ensures identical positioning behavior
 */
function createZwiftMap() {
    const mapEl = document.querySelector('.map');
    if (!mapEl) {
        console.error('Map element not found');
        return null;
    }
    
    try {
        // Use EXACT same configuration as geo.mjs main map
        const opacity = 1 - 1 / (100 / (settings.transparency || 0));
        const autoCenter = getSetting('autoCenter', true);
        
        const zm = new map.SauceZwiftMap({
            el: mapEl,
            worldList,
            zoom: settings.zoom,
            autoHeading: autoCenter && getSetting('autoHeading', true),
            autoCenter,
            style: settings.mapStyle,
            opacity,
            tiltShift: settings.tiltShift && ((settings.tiltShiftAmount || 0) / 100),
            sparkle: settings.sparkle,
            quality: qualityScale(settings.quality || 80),
            verticalOffset: settings.verticalOffset / 100,
            fpsLimit: settings.fpsLimit || 30,
            zoomPriorityTilt: getSetting('zoomPriorityTilt', true),
            preferRoute: settings.routeProfile !== false,
        });
        
        console.log('🎯 Zwift map created using EXACT same config as main map');
        showNotification('🎯 Map initialized with built-in Sauce accuracy', 'success');
        
        return zm;
        
    } catch (error) {
        console.error('❌ Error creating map:', error);
        showNotification('Failed to initialize map: ' + error.message, 'error');
        return null;
    }
}

/**
 * Simple FIT checkpoint system using Sauce built-in APIs
 */
class SimpleFitCheckpoints {
    constructor() {
        this.checkpoints = [];
        this.checkpointEntities = [];
        this.isVisible = true;
    }
    
    async parseFitFile(arrayBuffer) {
        if (typeof window.FitParser === 'undefined') {
            throw new Error('FitParser not found');
        }
        
        return new Promise((resolve, reject) => {
            const fitParser = new window.FitParser({ 
                force: true, 
                mode: 'list',
                elapsedRecordField: true,
                pausedRecordField: true
            });
            
            fitParser.parse(arrayBuffer, (error, data) => {
                if (error) {
                    reject(new Error(`FIT parsing failed: ${error.message || error}`));
                    return;
                }
                
                if (!data?.records?.length) {
                    reject(new Error('No FIT records found in file'));
                    return;
                }
                
                try {
                    const checkpoints = this.extractCheckpoints(data.records);
                    resolve(checkpoints);
                } catch (extractError) {
                    reject(extractError);
                }
            });
        });
    }
    
    extractCheckpoints(records) {
        const checkpoints = [];
        let nextCheckpoint = 0;
        let checkpointId = 0;
        
        for (const record of records) {
            const distance = record.distance || 0;
            
            if (distance >= nextCheckpoint || checkpointId === 0) {
                let lat = record.position_lat;
                let lng = record.position_long;
                
                if (!lat || !lng || lat === 0 || lng === 0 || isNaN(lat) || isNaN(lng)) {
                    continue;
                }
                
                // Handle semicircle conversion
                if (Math.abs(lat) > 1000000) {
                    lat = lat * (180 / Math.pow(2, 31));
                    lng = lng * (180 / Math.pow(2, 31));
                }
                
                // Calculate elapsed time
                let elapsedTime = 0;
                if (record.timer_time !== undefined && record.timer_time >= 0) {
                    elapsedTime = record.timer_time;
                } else if (record.elapsed_time !== undefined) {
                    elapsedTime = record.elapsed_time;
                } else if (record.speed && record.speed > 0) {
                    elapsedTime = distance / record.speed;
                } else {
                    const avgSpeed = 39 * 1000 / 3600;
                    elapsedTime = distance / avgSpeed;
                }
                
                const checkpoint = {
                    id: `checkpoint-${checkpointId}`,
                    distance: distance,
                    distanceKm: Math.round(distance / 100) / 10,
                    coordinates: [lat, lng],
                    power: record.power || 0,
                    heartRate: record.heart_rate || 0,
                    altitude: record.altitude || record.enhanced_altitude || 0,
                    elapsedTime: elapsedTime,
                    isStart: checkpointId === 0
                };
                
                checkpoints.push(checkpoint);
                checkpointId++;
                nextCheckpoint = checkpointId * 1000;
            }
        }
        
        if (checkpoints.length > 0) {
            checkpoints[checkpoints.length - 1].isFinish = true;
        }
        
        return checkpoints;
    }
    
    /**
     * Create checkpoints using Sauce built-in map.addPoint() API
     * No custom coordinate conversion - let Sauce handle it
     */
    createCheckpointEntities() {
        if (!zwiftMap?.addPoint) {
            throw new Error('Map addPoint method not available');
        }
        
        console.log(`📍 Creating ${this.checkpoints.length} checkpoints using Sauce built-in APIs...`);
        
        for (const checkpoint of this.checkpoints) {
            try {
                const [lat, lng] = checkpoint.coordinates;
                
                // Use Sauce built-in coordinate conversion
                const mapCoords = zwiftMap.latlngToPosition([lat, lng]);
                
                // Use Sauce built-in addPoint API
                const entity = zwiftMap.addPoint(mapCoords, 'checkpoint');
                
                if (entity?.el) {
                    entity.el.classList.add('fit-checkpoint');
                    if (checkpoint.isStart) entity.el.classList.add('start');
                    if (checkpoint.isFinish) entity.el.classList.add('finish');
                    
                    entity.el.dataset.distance = checkpoint.distance;
                    entity.el.dataset.distanceKm = checkpoint.distanceKm;
                    
                    const timeLabel = this.formatTime(checkpoint.elapsedTime);
                    entity.el.title = timeLabel ? 
                        `${checkpoint.distanceKm}km - ${timeLabel}` : 
                        `${checkpoint.distanceKm}km`;
                    
                    this.checkpointEntities.push({ entity, checkpoint });
                }
            } catch (error) {
                console.warn(`Error creating checkpoint ${checkpoint.id}:`, error);
            }
        }
        
        console.log(`✅ Created ${this.checkpointEntities.length} checkpoints using Sauce APIs`);
    }
    
    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '--';
        
        if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }
    
    toggleVisibility() {
        this.isVisible = !this.isVisible;
        
        for (const { entity } of this.checkpointEntities) {
            if (entity?.el) {
                entity.el.style.display = this.isVisible ? 'block' : 'none';
            }
        }
        
        return this.isVisible;
    }
    
    clearCheckpoints() {
        // Use Sauce built-in removeEntity API
        for (const { entity } of this.checkpointEntities) {
            if (entity && zwiftMap?.removeEntity) {
                try {
                    zwiftMap.removeEntity(entity);
                } catch (error) {
                    console.warn('Error removing checkpoint:', error);
                }
            }
        }
        
        this.checkpointEntities = [];
        this.checkpoints = [];
        
        // Clear ghost data
        try {
            localStorage.removeItem('ghostRiderData');
        } catch (error) {
            console.warn('Could not clear localStorage:', error);
        }
        
        console.log('✅ Checkpoints cleared using Sauce APIs');
    }
    
    getGhostData() {
        if (this.checkpoints.length === 0) return null;
        
        const ghostCheckpoints = this.checkpoints.map(cp => ({
            distance: cp.distance,
            elapsedTime: cp.elapsedTime,
            power: cp.power || 0,
            altitude: cp.altitude || 0
        }));
        
        return {
            checkpoints: ghostCheckpoints,
            totalDistance: Math.max(...ghostCheckpoints.map(cp => cp.distance)),
            totalTime: Math.max(...ghostCheckpoints.map(cp => cp.elapsedTime))
        };
    }
    
    async loadFromFile(arrayBuffer) {
        try {
            showNotification('Parsing FIT file...', 'info');
            
            this.clearCheckpoints();
            this.checkpoints = await this.parseFitFile(arrayBuffer);
            
            if (this.checkpoints.length === 0) {
                throw new Error('No checkpoints extracted from FIT file');
            }
            
            this.createCheckpointEntities();
            
            // Save ghost data
            const ghostData = this.getGhostData();
            if (ghostData) {
                localStorage.setItem('ghostRiderData', JSON.stringify(ghostData));
                window.ghostData = ghostData;
            }
            
            showNotification(`✅ Loaded ${this.checkpoints.length} FIT checkpoints`, 'success');
            return this.checkpoints.length;
            
        } catch (error) {
            console.error('❌ Error loading checkpoints:', error);
            showNotification(`Error loading FIT file: ${error.message}`, 'error');
            throw error;
        }
    }
}

/**
 * Initialize athlete tracking (same pattern as geo.mjs)
 */
async function initializeAthleteTracking() {
    try {
        // Same pattern as geo.mjs - check self first, then watching
        let ad = await common.rpc.getAthleteData('self');
        if (!ad) {
            ad = await common.rpc.getAthleteData('watching');
        }

        inGame = !!(ad && ad.age < 15000);

        // IMPORTANT: Set course BEFORE setting athletes to ensure rotateCoordinates is initialized
        // This matches geo.mjs behavior and prevents coordinate mismatch
        if (ad?.state?.courseId && zwiftMap) {
            console.log(`🗺️ Setting initial course: ${ad.state.courseId}`);
            await zwiftMap.setCourse(ad.state.courseId);
        }

        if (ad?.athleteId) {
            athleteId = ad.athleteId;
            if (zwiftMap) {
                zwiftMap.setAthlete(athleteId);
            }
        }

        // Get watching athlete
        try {
            const watchingData = await common.rpc.getAthleteData('watching');
            if (watchingData?.athleteId) {
                watchingId = watchingData.athleteId;
                if (zwiftMap) {
                    zwiftMap.setWatching(watchingId);
                }
            } else if (athleteId) {
                watchingId = athleteId;
                if (zwiftMap) {
                    zwiftMap.setWatching(watchingId);
                }
            }
        } catch (error) {
            console.warn('Could not get watching athlete data:', error);
        }

        console.log('✅ Athlete tracking initialized', {
            courseId: zwiftMap?.courseId,
            rotateCoordinates: zwiftMap?.rotateCoordinates
        });

    } catch (error) {
        console.error('❌ Error initializing athlete tracking:', error);
    }
}

/**
 * Setup live tracking using standard Sauce subscription pattern
 */
function setupLiveTracking() {
    console.log('📡 Setting up live tracking using Sauce built-in systems...');
    
    // Watchdog pattern (same as other Sauce modules)
    const watchdogInterval = setInterval(() => {
        if (inGame && performance.now() - (watchdog || 0) > 10000) {
            console.warn("🐕 Watchdog triggered - game connection lost");
            inGame = false;
            initializeAthleteTracking();
        }
    }, 5000);
    
    try {
        // Standard Sauce subscription pattern
        common.subscribe('states', async (states) => {
            if (!states?.length) return;
            
            watchdog = performance.now();
            
            if (!inGame) {
                inGame = true;
                console.log('🎮 Game connection established');
                await initializeAthleteTracking();
            }
            
            // Let Sauce handle all the positioning - no custom logic needed
            if (zwiftMap) {
                try {
                    await zwiftMap.renderAthleteStates(states);
                } catch (error) {
                    console.warn('❌ Error rendering athlete states:', error);
                }
            }
        });
        
        // Standard watching athlete change subscription
        common.subscribe('watching-athlete-change', async (newWatchingId) => {
            if (newWatchingId && !isNaN(newWatchingId)) {
                watchingId = newWatchingId;
                
                if (zwiftMap) {
                    zwiftMap.setWatching(watchingId);
                }
                
                console.log('👀 Now watching athlete:', watchingId);
                showNotification(`Now watching athlete: ${watchingId}`, 'info');
            }
        });
        
        console.log('✅ Live tracking setup complete using Sauce built-in systems');
        
        window.addEventListener('beforeunload', () => {
            clearInterval(watchdogInterval);
        });
        
    } catch (error) {
        console.error('❌ Error setting up live tracking:', error);
        showNotification('Error setting up live tracking: ' + error.message, 'error');
    }
}

/**
 * Handle FIT file selection
 */
async function handleFitFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.fit')) {
        showNotification('Please select a .FIT file', 'error');
        return;
    }
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const checkpointCount = await fitCheckpoints.loadFromFile(arrayBuffer);
        console.log(`✅ Loaded ${checkpointCount} FIT checkpoints using Sauce APIs!`);
        
    } catch (error) {
        console.error('❌ Error loading FIT file:', error);
        showNotification('Error loading FIT file: ' + error.message, 'error');
    } finally {
        event.target.value = '';
    }
}

/**
 * Setup FIT file loading
 */
function setupFitFileLoading() {
    const loadFitBtn = document.querySelector('.load-fit-file');
    const fitFileInput = document.querySelector('#fit-file-input');
    
    if (loadFitBtn && fitFileInput) {
        loadFitBtn.addEventListener('click', () => fitFileInput.click());
        fitFileInput.addEventListener('change', handleFitFileSelect);
    }
    
    // Drag and drop
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
        let dragCounter = 0;
        
        mapContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            mapContainer.classList.add('fit-file-dragover');
        });
        
        mapContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter === 0) {
                mapContainer.classList.remove('fit-file-dragover');
            }
        });
        
        mapContainer.addEventListener('dragover', (e) => e.preventDefault());
        
        mapContainer.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            mapContainer.classList.remove('fit-file-dragover');
            
            const files = e.dataTransfer.files;
            if (files.length === 0) return;
            
            const file = files[0];
            if (!file.name.toLowerCase().endsWith('.fit')) {
                showNotification('Please drop a .FIT file', 'error');
                return;
            }
            
            const fakeEvent = { target: { files: [file], value: '' } };
            await handleFitFileSelect(fakeEvent);
        });
    }
}

/**
 * Setup map controls using same pattern as geo.mjs
 */
function setupMapControls() {
    const controls = {
        '.toggle-auto-heading': () => {
            const enabled = !settings.autoHeading;
            settings.autoHeading = enabled;
            common.settingsStore.set('autoHeading', enabled);
            
            if (zwiftMap) {
                zwiftMap.setAutoHeading(enabled);
                if (enabled) {
                    zwiftMap.setHeadingOffset(0);
                }
            }
            
            const btn = document.querySelector('.toggle-auto-heading');
            if (btn) btn.classList.toggle('active', enabled);
            showNotification(`Auto heading: ${enabled ? 'ON' : 'OFF'}`, 'info');
        },
        
        '.toggle-auto-center': () => {
            const enabled = !settings.autoCenter;
            settings.autoCenter = enabled;
            common.settingsStore.set('autoCenter', enabled);
            
            if (zwiftMap) {
                if (enabled) {
                    zwiftMap.setDragOffset([0, 0]);
                }
                zwiftMap.setAutoCenter(enabled);
                zwiftMap.setAutoHeading(!enabled ? false : !!settings.autoHeading);
            }
            
            const btn = document.querySelector('.toggle-auto-center');
            if (btn) btn.classList.toggle('active', enabled);
            showNotification(`Auto center: ${enabled ? 'ON' : 'OFF'}`, 'info');
        },
        
        '.toggle-map-style': () => {
            settings.mapStyle = settings.mapStyle === 'default' ? 'neon' : 'default';
            common.settingsStore.set('mapStyle', settings.mapStyle);
            
            if (zwiftMap) {
                zwiftMap.setStyle(settings.mapStyle);
            }
            
            const btn = document.querySelector('.toggle-map-style');
            if (btn) btn.textContent = settings.mapStyle === 'neon' ? '🌟' : '🗺️';
            showNotification(`Map style: ${settings.mapStyle}`, 'info');
        },
        
        '.clear-fit-route': () => {
            if (fitCheckpoints) {
                fitCheckpoints.clearCheckpoints();
                showNotification('FIT checkpoints cleared', 'info');
            }
        },
        
        '.toggle-fit-checkpoints': () => {
            if (fitCheckpoints) {
                const visible = fitCheckpoints.toggleVisibility();
                const btn = document.querySelector('.toggle-fit-checkpoints');
                if (btn) btn.classList.toggle('active', visible);
                showNotification(`Checkpoints ${visible ? 'shown' : 'hidden'}`, 'info');
            }
        }
    };
    
    // Attach event listeners
    for (const [selector, handler] of Object.entries(controls)) {
        const btn = document.querySelector(selector);
        if (btn) {
            btn.addEventListener('click', handler);
        }
    }
    
    // Set initial states
    const autoHeadingBtn = document.querySelector('.toggle-auto-heading');
    const autoCenterBtn = document.querySelector('.toggle-auto-center');
    const mapStyleBtn = document.querySelector('.toggle-map-style');
    
    if (autoHeadingBtn) autoHeadingBtn.classList.toggle('active', settings.autoHeading);
    if (autoCenterBtn) autoCenterBtn.classList.toggle('active', settings.autoCenter);
    if (mapStyleBtn) mapStyleBtn.textContent = settings.mapStyle === 'neon' ? '🌟' : '🗺️';
}

/**
 * Initialize the application using Sauce built-in systems
 */
async function initialize() {
    console.log('🚀 Initializing Simple Live Map using Sauce built-in systems...');
    
    try {
        // Get world list (same as geo.mjs)
        try {
            worldList = await common.getWorldList();
            console.log(`📍 Loaded ${worldList?.length || 0} worlds`);
        } catch (error) {
            console.warn('Could not load world list:', error);
            worldList = [];
        }
        
        // Create map using EXACT same config as main map
        zwiftMap = createZwiftMap();
        
        if (zwiftMap) {
            // Initialize components
            await initializeAthleteTracking();
            setupLiveTracking();
            setupMapControls();
            setupFitFileLoading();
            
            // Initialize FIT checkpoints
            fitCheckpoints = new SimpleFitCheckpoints();
            
            console.log('✅ Simple Live Map initialized using Sauce built-in systems');
            showNotification('🎯 Map ready - using Sauce built-in accuracy!', 'success');
        } else {
            showNotification('Failed to create map', 'error');
        }
        
    } catch (error) {
        console.error('❌ Error initializing Simple Live Map:', error);
        showNotification('Initialization failed: ' + error.message, 'error');
    }
}

/**
 * Debug functions
 */
window.debugMap = function() {
    console.log('🔍 Simple Map Debug (Using Sauce Built-ins):', {
        zwiftMap: !!zwiftMap,
        worldList: worldList?.length || 0,
        athleteId,
        watchingId,
        inGame,
        settings,
        mapConfig: zwiftMap ? {
            autoCenter: zwiftMap.autoCenter,
            autoHeading: zwiftMap.autoHeading,
            style: zwiftMap.style,
            rotateCoordinates: zwiftMap.rotateCoordinates,
            courseId: zwiftMap.courseId
        } : null
    });
    
    return { zwiftMap, worldList, athleteId, watchingId, inGame, fitCheckpoints, settings };
};

/**
 * Main entry point
 */
export async function main() {
    common.initInteractionListeners();
    
    console.log('🎯 Starting Simple Live Map - Using Sauce Built-in Systems');
    console.log('🔧 PRINCIPLE: Use what Sauce already provides');
    console.log('✅ Same config as geo.mjs main map');
    console.log('✅ Built-in accurate positioning');
    console.log('✅ Standard Sauce APIs');
    console.log('✅ Easy maintenance and updates');
    console.log('');
    console.log('Debug: debugMap()');
    
    try {
        await initialize();
    } catch (error) {
        console.error('Failed to initialize:', error);
        showNotification('Failed to initialize: ' + error.message, 'error');
    }
}