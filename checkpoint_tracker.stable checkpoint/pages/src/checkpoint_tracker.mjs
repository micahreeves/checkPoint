// Simple Map Viewer - Live athlete tracking on Zwift map

import * as common from '/pages/src/common.mjs';
import * as map from '/pages/src/map.mjs';

// Global references
let worldList;
let zwiftMap;
let athleteId;
let watchingId;
let watchdog;
let inGame = false;

// Simple settings
common.settingsStore.setDefault({
    autoCenter: true,
    autoHeading: false
});

const settings = common.settingsStore.get();

/**
 * Create and configure the Zwift map
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

        console.log('Zwift map created successfully');
        return zm;

    } catch (error) {
        console.error('Error creating Zwift map:', error);

        mapEl.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%;
                        background: #333; color: white; flex-direction: column;">
                <div style="font-size: 18px; margin-bottom: 10px;">Map Unavailable</div>
                <div style="font-size: 14px; opacity: 0.8;">Check console for details</div>
                <div style="font-size: 12px; margin-top: 10px;">Error: ${error.message}</div>
            </div>
        `;

        return null;
    }
}

/**
 * Initialize athlete tracking
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
            athleteId = selfData.athleteId;
            if (zwiftMap) {
                try {
                    zwiftMap.setAthlete(athleteId);
                } catch (error) {
                    console.warn('Error setting athlete on map:', error);
                }
            }
            console.log('Self athlete ID:', athleteId);
        }

        let watchingData;
        try {
            watchingData = await common.rpc.getAthleteData('watching');
        } catch (error) {
            console.warn('Could not get watching athlete data:', error);
            watchingData = null;
        }

        if (watchingData && watchingData.athleteId) {
            watchingId = watchingData.athleteId;
            if (zwiftMap) {
                try {
                    zwiftMap.setWatching(watchingId);
                } catch (error) {
                    console.warn('Error setting watching on map:', error);
                }
            }
            console.log('Watching athlete ID:', watchingId);
        } else if (athleteId) {
            watchingId = athleteId;
            if (zwiftMap) {
                try {
                    zwiftMap.setWatching(watchingId);
                } catch (error) {
                    console.warn('Error setting watching on map:', error);
                }
            }
        }

        console.log('Athlete tracking initialized:', { athleteId, watchingId, inGame });

    } catch (error) {
        console.error('Error initializing athlete tracking:', error);
    }
}

/**
 * Setup live data subscriptions
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
            if (!inGame) {
                await initializeAthleteTracking();
            }
            watchdog = performance.now();
            if (zwiftMap) {
                zwiftMap.renderAthleteStates(states);
            }
        });

        common.subscribe('watching-athlete-change', async (newWatchingId) => {
            if (newWatchingId && !isNaN(newWatchingId)) {
                watchingId = newWatchingId;
                if (zwiftMap) {
                    try {
                        zwiftMap.setWatching(watchingId);
                    } catch (error) {
                        console.warn('Error setting watching athlete:', error);
                    }
                }

                console.log('Now watching athlete:', watchingId);
            }
        });

        console.log('Live tracking subscriptions set up');

    } catch (error) {
        console.error('Error setting up live tracking:', error);
    }
}

/**
 * Initialize the application
 */
async function initialize() {
    try {
        console.log('🗺️  Initializing Simple Map Viewer...');

        // Get world list for map
        try {
            worldList = await common.getWorldList();
            console.log(`Loaded ${worldList?.length || 0} worlds`);
        } catch (error) {
            console.warn('Could not load world list:', error);
            worldList = [];
        }

        // Create map
        zwiftMap = createZwiftMap();

        // Initialize athlete tracking
        await initializeAthleteTracking();

        // Setup live tracking
        setupLiveTracking();

        console.log('✨ Simple Map Viewer initialized successfully!');

    } catch (error) {
        console.error('Error initializing Map Viewer:', error);
    }
}

/**
 * Main entry point
 */
export async function main() {
    common.initInteractionListeners();

    console.log('🗺️  Starting Simple Map Viewer...');

    try {
        await initialize();
        console.log('✨ Simple Map Viewer ready!');
    } catch (error) {
        console.error('Failed to initialize Map Viewer:', error);
    }
}
