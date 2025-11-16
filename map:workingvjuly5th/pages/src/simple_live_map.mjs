// simple_live_map.mjs - Using checkpoint tracker pattern EXACTLY

import * as common from '/pages/src/common.mjs';
import * as map from '/pages/src/map.mjs';
import * as data from '/shared/sauce/data.mjs';
import * as locale from '/shared/sauce/locale.mjs';

// Global references (same as geo.mjs)
let worldList;
let zwiftMap;
let watchdog;
let inGame = false;
let fitCheckpoints = null;

const H = locale.human;

// Settings - EXACT same as checkpoint tracker
common.settingsStore.setDefault({
    autoCenter: true,
    autoHeading: false,
    liveTracking: true
});

const settings = common.settingsStore.get();

/**
 * Quality scale - same as geo.mjs
 */
function qualityScale(raw) {
    raw = raw || 1;
    const min = 0.2;
    return Math.min(2, (raw / 100) * (1 - min) + min);
}

/**
 * Get setting with fallback - same as geo.mjs
 */
function getSetting(key, def) {
    const v = settings[key];
    return v === undefined ? def : v;
}

/**
 * Show notifications
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
 * Create Zwift map - EXACT same as checkpoint tracker
 */
function createZwiftMap() {
    const mapEl = document.querySelector('.map');
    if (!mapEl) {
        console.warn('Map element not found');
        return null;
    }

    try {
        if (!worldList || !Array.isArray(worldList) || worldList.length === 0) {
            console.warn('No world list available, map creation deferred');
            return null;
        }

        const zm = new map.SauceZwiftMap({
            el: mapEl,
            worldList,
            zoom: 0.5,
            autoHeading: settings.autoHeading || false,
            autoCenter: settings.autoCenter || true,
            style: 'default',
            opacity: 1,
            tiltShift: false,
            sparkle: false,
            quality: 0.8,
            verticalOffset: 0,
            fpsLimit: 30,
            zoomPriorityTilt: true,
            preferRoute: true
        });

        console.log('Zwift map created successfully (checkpoint tracker pattern)');
        return zm;

    } catch (error) {
        console.error('Error creating Zwift map:', error);

        mapEl.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%;
                        background: #333; color: white; flex-direction: column;">
                <div style="font-size: 18px; margin-bottom: 10px;">Map Unavailable</div>
                <div style="font-size: 14px; opacity: 0.8;">Routes can still be loaded and parsed</div>
                <div style="font-size: 12px; margin-top: 10px;">Error: ${error.message}</div>
            </div>
        `;

        return null;
    }
}

/**
 * Initialize athlete tracking - EXACT same as checkpoint tracker
 */
async function initializeAthleteTracking() {
    try {
        let selfData;
        try {
            selfData = await common.rpc.getAthleteData('self');
            inGame = !!(selfData && selfData.age < 15000);
        } catch (error) {
            console.warn('Could not get self athlete data:', error);
            inGame = false;
            selfData = null;
        }

        if (selfData && selfData.athleteId) {
            if (zwiftMap) {
                try {
                    zwiftMap.setAthlete(selfData.athleteId);
                } catch (error) {
                    console.warn('Error setting athlete on map:', error);
                }
            }
            console.log('Self athlete ID:', selfData.athleteId);
        }

        let watchingData;
        try {
            watchingData = await common.rpc.getAthleteData('watching');
        } catch (error) {
            console.warn('Could not get watching athlete data:', error);
            watchingData = null;
        }

        if (watchingData && watchingData.athleteId) {
            if (zwiftMap) {
                try {
                    zwiftMap.setWatching(watchingData.athleteId);
                } catch (error) {
                    console.warn('Error setting watching on map:', error);
                }
            }
            console.log('Watching athlete ID:', watchingData.athleteId);
        } else if (selfData && selfData.athleteId) {
            if (zwiftMap) {
                try {
                    zwiftMap.setWatching(selfData.athleteId);
                } catch (error) {
                    console.warn('Error setting watching on map:', error);
                }
            }
        }

        console.log('Athlete tracking initialized (checkpoint tracker pattern)');

    } catch (error) {
        console.error('Error initializing athlete tracking:', error);
    }
}

/**
 * FIT checkpoint system
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

    createCheckpointEntities() {
        if (!zwiftMap?.addPoint) {
            throw new Error('Map addPoint method not available');
        }

        console.log(`📍 Creating ${this.checkpoints.length} checkpoints...`);
        console.log(`🔄 Map rotateCoordinates: ${zwiftMap.rotateCoordinates}`);

        for (const checkpoint of this.checkpoints) {
            try {
                const [lat, lng] = checkpoint.coordinates;

                // Convert GPS to Zwift world coordinates
                let mapCoords = zwiftMap.latlngToPosition([lat, lng]);

                // CRITICAL: latlngToPosition returns coordinates in "path space"
                // But entities are in a separate non-rotated layer!
                // When rotateCoordinates is true, paths get rotated -90deg via CSS
                // but entities don't, so we need to un-rotate the coordinates
                if (zwiftMap.rotateCoordinates) {
                    // Un-rotate: reverse the -90deg rotation that paths get
                    // If paths use rotate(-90deg), entities need the opposite rotation
                    // Original: [x, y] -> After path rotation: [y, -x]
                    // So for entities to match: we need to apply inverse: [-y, x]
                    mapCoords = [-mapCoords[1], mapCoords[0]];
                    console.log(`🔄 Applied un-rotation for checkpoint at ${checkpoint.distanceKm}km`);
                }

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

        console.log(`✅ Created ${this.checkpointEntities.length} checkpoints`);
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

        try {
            localStorage.removeItem('ghostRiderData');
        } catch (error) {
            console.warn('Could not clear localStorage:', error);
        }

        console.log('✅ Checkpoints cleared');
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
 * Setup FIT file loading
 */
function setupFitFileLoading() {
    const loadFitBtn = document.querySelector('.load-fit-file');
    const fitFileInput = document.querySelector('#fit-file-input');

    if (!loadFitBtn || !fitFileInput) {
        console.warn('FIT file elements not found');
        return;
    }

    loadFitBtn.addEventListener('click', () => fitFileInput.click());

    fitFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.fit')) {
            showNotification('Please select a .FIT file', 'error');
            return;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            await fitCheckpoints.loadFromFile(arrayBuffer);
        } catch (error) {
            console.error('❌ Error loading FIT file:', error);
            showNotification('Error loading FIT file: ' + error.message, 'error');
        } finally {
            e.target.value = '';
        }
    });

    // Drag and drop support
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

            try {
                const arrayBuffer = await file.arrayBuffer();
                await fitCheckpoints.loadFromFile(arrayBuffer);
            } catch (error) {
                console.error('❌ Error loading FIT file:', error);
                showNotification('Error loading FIT file: ' + error.message, 'error');
            }
        });
    }
}

/**
 * Setup map controls
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
 * Setup live tracking - EXACT same as checkpoint tracker
 */
function setupLiveTracking() {
    setInterval(() => {
        if (inGame && performance.now() - (watchdog || 0) > 10000) {
            console.warn("Watchdog triggered by inactivity");
            inGame = false;
            initializeAthleteTracking();
        }
    }, 5000);

    try {
        common.subscribe('states', async (states) => {
            if (!states || !Array.isArray(states) || states.length === 0) return;

            watchdog = performance.now();

            if (!inGame) {
                inGame = true;
                await initializeAthleteTracking();
            }

            if (zwiftMap) {
                try {
                    await zwiftMap.renderAthleteStates(states);
                } catch (error) {
                    console.warn('Error rendering athlete states:', error);
                }
            }
        });

        common.subscribe('watching-athlete-change', async (newWatchingId) => {
            if (newWatchingId && !isNaN(newWatchingId)) {
                if (zwiftMap) {
                    try {
                        zwiftMap.setWatching(newWatchingId);
                    } catch (error) {
                        console.warn('Error setting watching athlete:', error);
                    }
                }
                console.log('Now watching athlete:', newWatchingId);
            }
        });

        console.log('Live tracking subscriptions set up (checkpoint tracker pattern)');

    } catch (error) {
        console.error('Error setting up live tracking:', error);
    }
}

/**
 * Main entry point - EXACT same as checkpoint tracker
 */
export async function main() {
    common.initInteractionListeners();

    console.log('🚀 Starting Simple Live Map (checkpoint tracker pattern)');

    try {
        // Get world list
        try {
            worldList = await common.getWorldList();
            console.log(`Loaded ${worldList?.length || 0} worlds`);
        } catch (error) {
            console.warn('Could not load world list:', error);
            worldList = [];
        }

        // Create map
        zwiftMap = createZwiftMap();
        window.zwiftMap = zwiftMap; // DEBUG

        // Initialize FIT checkpoints
        fitCheckpoints = new SimpleFitCheckpoints();

        // Initialize athlete tracking
        await initializeAthleteTracking();

        // Setup UI controls
        setupMapControls();
        setupFitFileLoading();

        // Setup live tracking
        setupLiveTracking();

        console.log('✅ Simple Live Map initialized (checkpoint tracker pattern)');
        showNotification('🎯 Map ready - checkpoint tracker pattern!', 'success');

    } catch (error) {
        console.error('❌ Error initializing:', error);
        showNotification('Initialization failed: ' + error.message, 'error');
    }
}

/**
 * Debug function
 */
window.debugMap = function() {
    console.log('🔍 Simple Map Debug (geo.mjs pattern):', {
        zwiftMap: !!zwiftMap,
        worldList: worldList?.length || 0,
        inGame,
        settings,
        fitCheckpoints: fitCheckpoints?.checkpoints?.length || 0,
        mapConfig: zwiftMap ? {
            autoCenter: zwiftMap.autoCenter,
            autoHeading: zwiftMap.autoHeading,
            courseId: zwiftMap.courseId,
            style: zwiftMap.style
        } : null
    });

    return { zwiftMap, worldList, inGame, fitCheckpoints, settings };
};
