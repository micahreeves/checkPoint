// Enhanced checkpoint_tracker.mjs with Ghost Rider Integration

import * as common from '/pages/src/common.mjs';
import * as map from '/pages/src/map.mjs';
import * as data from '/shared/sauce/data.mjs';
import * as locale from '/shared/sauce/locale.mjs';

// Import our enhanced modules
import { parseRouteData, parseFitFile, getWorldName, generateSampleRoute, WORLD_MAPPING } from './route-parser.mjs';
import { convertCoordinates, findWorldMeta } from './coordinate-converter.mjs';
import { CheckpointManager } from './checkpoint-manager.mjs';
import { initializeReplay, loadReplayData, updateReplayProgress, handleLiveAthleteUpdate, integrateWithMainApp } from './replay-ui-integration.mjs';

// Global references
let worldList;
let zwiftMap;
let athleteId;
let watchingId;
let routeData = null;
let currentRoute = null;
let checkpointManager;
let replayManager; // New: Ghost rider manager
let watchdog;
let inGame = false;

const H = locale.human;

// Enhanced settings with replay options
common.settingsStore.setDefault({
    autoCenter: true,
    autoHeading: false,
    showCheckpoints: true,
    checkpointRadius: 50,
    autoCheckpointDistance: 1000,
    coordinateConversionMode: 'auto',
    debugMode: false,
    liveTracking: true,
    checkpointAlerts: true,
    // New replay settings
    showGhostRider: true,
    showProgressLine: true,
    ghostOpacity: 0.8,
    replaySpeed: 1.0
});

const settings = common.settingsStore.get();

/**
 * Enhanced notification system
 */
function showNotification(message, type = 'info') {
    let notification = document.querySelector('.route-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'route-notification';
        const statusOverlay = document.querySelector('.status-overlay');
        if (statusOverlay) {
            statusOverlay.appendChild(notification);
        } else {
            document.querySelector('#content').appendChild(notification);
        }
    }
    
    notification.textContent = message;
    notification.className = `route-notification ${type}`;
    notification.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            notification.style.display = 'none';
        }, 5000);
    }
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Enhanced loadRoute function with Ghost Rider support
 */
async function loadRoute(jsonData) {
    try {
        console.log('Loading route from JSON data with Ghost Rider support...');
        
        if (!jsonData) {
            throw new Error('No route data provided');
        }
        
        // Parse the route data
        const parsedRouteData = parseRouteData(jsonData);
        console.log('Parsed route data:', {
            name: parsedRouteData.name,
            coordinateCount: parsedRouteData.coordinates?.length || 0,
            checkpointCount: parsedRouteData.checkpoints?.length || 0,
            worldId: parsedRouteData.worldId,
            courseId: parsedRouteData.courseId,
            hasTelemetry: !!parsedRouteData.telemetry
        });
        
        if (!parsedRouteData.coordinates || !Array.isArray(parsedRouteData.coordinates) || parsedRouteData.coordinates.length === 0) {
            throw new Error('No valid coordinates found in route data');
        }

        // If route has no world info, try to get it from the current Zwift session BEFORE converting coordinates
        if (!parsedRouteData.worldId && !parsedRouteData.courseId) {
            try {
                const watchingData = await common.rpc.getAthleteData('watching');
                if (watchingData && watchingData.courseId) {
                    console.log(`Route has no world - using watching athlete's world: courseId=${watchingData.courseId}`);
                    parsedRouteData.courseId = watchingData.courseId;
                    // Also try to get worldId from state if available
                    if (watchingData.state && watchingData.state.worldId) {
                        parsedRouteData.worldId = watchingData.state.worldId;
                    }
                } else {
                    // Try self athlete
                    const selfData = await common.rpc.getAthleteData('self');
                    if (selfData && selfData.courseId) {
                        console.log(`Route has no world - using self athlete's world: courseId=${selfData.courseId}`);
                        parsedRouteData.courseId = selfData.courseId;
                        if (selfData.state && selfData.state.worldId) {
                            parsedRouteData.worldId = selfData.state.worldId;
                        }
                    }
                }
            } catch (error) {
                console.warn('Could not get world from Zwift session:', error);
            }
        }

        // Find worldMeta from worldList for coordinate conversion
        const worldMeta = findWorldMeta(worldList, parsedRouteData.courseId, parsedRouteData.worldId);

        // Convert coordinates using worldMeta (has latOffset, lonOffset, latDegDist, lonDegDist from Sauce)
        let coordinates;
        try {
            coordinates = convertCoordinates(parsedRouteData.coordinates, worldMeta, settings);
            console.log(`Converted ${coordinates.length} coordinates`);

            if (coordinates.length === 0) {
                throw new Error('Coordinate conversion resulted in empty array');
            }

            if (settings.debugMode) {
                console.log('First few converted coordinates:', coordinates.slice(0, 3));
                console.log('Last few converted coordinates:', coordinates.slice(-3));
            }
        } catch (error) {
            console.error('Coordinate conversion failed:', error);
            coordinates = parsedRouteData.coordinates;
            console.log('Using original coordinates as fallback');
        }

        // Clear existing route BEFORE setting up new one
        clearRoute();

        // NOW set the global routeData after we know everything worked
        routeData = parsedRouteData;

        // Set up the map world if possible
        try {
            await setupMapWorld(routeData.worldId, routeData.courseId);
        } catch (error) {
            console.warn('Failed to set up map world:', error);
        }
        
        // Add route to map
        if (zwiftMap && coordinates.length > 1) {
            try {
                currentRoute = zwiftMap.addHighlightLine(coordinates, 'imported-route', {
                    color: '#007bff',
                    width: 4,
                    extraClass: 'route-polyline'
                });
                
                // Fit map to route
                try {
                    fitRouteToView(coordinates);
                } catch (error) {
                    console.warn('Failed to fit route to view:', error);
                }
                
                console.log('Route successfully added to map');
            } catch (error) {
                console.warn('Failed to add route to map:', error);
                showNotification('Route loaded but could not display on map: ' + error.message, 'info');
            }
        }
        
        // Load checkpoints (convert coordinates to Zwift format first)
        if (routeData.checkpoints && Array.isArray(routeData.checkpoints) && routeData.checkpoints.length > 0) {
            try {
                // Convert checkpoint coordinates from GPS to Zwift format
                const convertedCheckpoints = routeData.checkpoints.map((cp, index) => {
                    if (cp.coordinates && Array.isArray(cp.coordinates)) {
                        // Use the checkpoint's index to get the already-converted coordinate
                        // This ensures checkpoints align with the converted route
                        const convertedCoord = cp.index !== undefined && coordinates[cp.index]
                            ? coordinates[cp.index]
                            : convertCoordinates([cp.coordinates], worldMeta, settings)[0];

                        return {
                            ...cp,
                            coordinates: convertedCoord || cp.coordinates
                        };
                    }
                    return cp;
                });

                await checkpointManager.loadCheckpointsFromData(convertedCheckpoints, routeData);
                updateCheckpointList();
                initializeProgressBar(); // Initialize progress bar with checkpoint markers
            } catch (error) {
                console.warn('Failed to load checkpoints:', error);
                showNotification('Route loaded but checkpoints failed: ' + error.message, 'info');
            }
        } else {
            // Still initialize route for progress tracking even without checkpoints
            checkpointManager.initializeWithRoute(routeData);
            initializeProgressBar();
        }
        
        // 🆕 NEW: Load replay data for Ghost Rider
        if (routeData.telemetry && replayManager) {
            try {
                console.log('🔍 Attempting to load Ghost Rider data...');
                console.log('Available telemetry keys:', Object.keys(routeData.telemetry));
                
                const replayLoaded = loadReplayData(routeData);
                if (replayLoaded) {
                    console.log('✨ Ghost Rider data loaded successfully!');
                    showNotification('👻 Ghost Rider ready! Race against your personal best!', 'success');
                } else {
                    console.log('❌ Ghost Rider failed to load - checking telemetry data...');
                    
                    // Show helpful error message about what's missing
                    const hasTime = !!(routeData.telemetry.time || routeData.telemetry.timeInS);
                    const hasDistance = !!(routeData.telemetry.distance || routeData.telemetry.distanceInCm);
                    const hasCoords = !!(routeData.coordinates && routeData.coordinates.length > 0);
                    
                    let errorMsg = '👻 Ghost Rider not available: ';
                    if (!hasCoords) errorMsg += 'No coordinates found. ';
                    if (!hasTime) errorMsg += 'No timing data found. ';
                    if (!hasDistance) errorMsg += 'No distance data found. ';
                    
                    if (hasCoords && (!hasTime || !hasDistance)) {
                        errorMsg += '\nRoute will display but Ghost Rider needs telemetry with timing data.';
                        showNotification(errorMsg, 'info');
                    } else {
                        showNotification(errorMsg, 'warning');
                    }
                }
            } catch (error) {
                console.warn('Failed to load replay data:', error);
                showNotification('👻 Ghost Rider encountered an error: ' + error.message, 'warning');
            }
        } else if (!routeData.telemetry) {
            console.log('ℹ️ No telemetry data in route - Ghost Rider not available');
            showNotification('Route loaded! 👻 Ghost Rider needs telemetry data to work.', 'info');
        }
        
        // Update UI
        updateRouteInfoDisplay();
        
        console.log('Route loaded successfully with enhanced features');
        
        // Show success notification
        const message = `Route "${routeData.name}" loaded successfully!\n\n` +
                       `Coordinates: ${coordinates.length}\n` +
                       `Checkpoints: ${routeData.checkpoints?.length || 0}\n` +
                       `World: ${getWorldName(routeData.worldId, routeData.courseId)}` +
                       (routeData.telemetry ? '\n👻 Ghost Rider available!' : '');
        
        showNotification(message, 'success');
        
    } catch (error) {
        console.error('Error loading route:', error);
        showNotification('Error loading route: ' + error.message, 'error');
        throw error;
    }
}

/**
 * Setup map world with enhanced error handling
 */
async function setupMapWorld(worldId, courseId) {
    if (!zwiftMap) {
        console.warn('Map not available for world setup');
        return;
    }
    
    if (!worldList || !Array.isArray(worldList) || worldList.length === 0) {
        console.warn('World list not available');
        return;
    }
    
    try {
        const worldMeta = worldList.find(w => {
            if (!w) return false;
            return w.worldId === worldId || 
                   w.courseId === worldId ||
                   w.courseId === courseId;
        });
        
        if (worldMeta && worldMeta.courseId) {
            console.log(`Setting map to world: ${worldMeta.name} (courseId: ${worldMeta.courseId})`);
            await zwiftMap.setCourse(worldMeta.courseId);
        } else {
            console.warn(`World not found in world list: worldId=${worldId}, courseId=${courseId}`);
            if (worldId && WORLD_MAPPING[worldId]) {
                const worldName = WORLD_MAPPING[worldId].name;
                const worldByName = worldList.find(w => w && w.name === worldName);
                if (worldByName && worldByName.courseId) {
                    console.log(`Found world by name: ${worldName} -> courseId: ${worldByName.courseId}`);
                    await zwiftMap.setCourse(worldByName.courseId);
                    return;
                }
            }
            
            if (worldList.length > 0 && worldList[0] && worldList[0].courseId) {
                console.log(`Using fallback world: ${worldList[0].name}`);
                await zwiftMap.setCourse(worldList[0].courseId);
            }
        }
    } catch (error) {
        console.error('Error setting up map world:', error);
    }
}

/**
 * Clear route from map
 */
function clearRoute() {
    if (currentRoute && zwiftMap) {
        try {
            currentRoute.elements.forEach(el => el && el.remove && el.remove());
            currentRoute = null;
        } catch (error) {
            console.warn('Error clearing route:', error);
        }
    }
    routeData = null;
}

/**
 * Fit route to view with enhanced error handling
 */
function fitRouteToView(coordinates) {
    if (!zwiftMap || !coordinates || !Array.isArray(coordinates) || coordinates.length === 0) return;
    
    try {
        const validCoords = coordinates.filter(c => Array.isArray(c) && c.length >= 2 && 
                                                    c[0] !== null && c[0] !== undefined &&
                                                    c[1] !== null && c[1] !== undefined &&
                                                    !isNaN(c[0]) && !isNaN(c[1]));
        
        if (validCoords.length === 0) {
            console.warn('No valid coordinates for fitting view');
            return;
        }
        
        const xValues = validCoords.map(c => c[0]);
        const yValues = validCoords.map(c => c[1]);
        
        const xMin = data.min(xValues);
        const xMax = data.max(xValues);
        const yMin = data.min(yValues);
        const yMax = data.max(yValues);
        
        if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax)) {
            console.warn('Invalid bounds calculated for route view');
            return;
        }
        
        if (zwiftMap.setBounds && typeof zwiftMap.setBounds === 'function') {
            const padding = 0.1;
            zwiftMap.setBounds([xMin, yMax], [xMax, yMin], { padding });
        } else {
            console.warn('Map setBounds method not available, trying alternative...');
            if (zwiftMap.setCenter && zwiftMap.setZoom) {
                const centerX = (xMin + xMax) / 2;
                const centerY = (yMin + yMax) / 2;
                zwiftMap.setCenter([centerX, centerY]);
                zwiftMap.setZoom(0.5);
            }
        }
    } catch (error) {
        console.warn('Error fitting route to view:', error);
    }
}

/**
 * Enhanced route info display
 */
function updateRouteInfoDisplay() {
    if (!routeData) return;
    
    let statsText = `${routeData.coordinates?.length || 0} points`;
    
    if (routeData.telemetry?.distance?.length > 0) {
        const totalDistanceM = routeData.telemetry.distance[routeData.telemetry.distance.length - 1] / 100;
        statsText += `, ${H.distance(totalDistanceM, {suffix: true})}`;
    }
    
    if (routeData.telemetry?.altitude?.length > 0) {
        const altitudes = routeData.telemetry.altitude.map(a => a / 100);
        const minAlt = Math.min(...altitudes);
        const maxAlt = Math.max(...altitudes);
        const elevGain = maxAlt - minAlt;
        statsText += `, ${H.elevation(elevGain, {suffix: true})} gain`;
    }
    
    statsText += `, ${routeData.checkpoints?.length || 0} checkpoints`;
    
    if (routeData.metadata?.durationInSeconds) {
        statsText += `, ${H.timer(routeData.metadata.durationInSeconds)}`;
    }
    
    // Add Ghost Rider status
    if (routeData.telemetry) {
        statsText += ` 👻 Ghost Ready`;
    }
    
    updateRouteInfo(routeData.name, statsText);
}

/**
 * Update route info display
 */
function updateRouteInfo(name, stats) {
    const routeInfoEl = document.querySelector('.route-info');
    if (!routeInfoEl) return;
    
    const routeNameEl = routeInfoEl.querySelector('.route-name');
    const routeStatsEl = routeInfoEl.querySelector('.route-stats');
    
    if (routeNameEl) routeNameEl.textContent = name || 'No route loaded';
    if (routeStatsEl) {
        if (typeof stats === 'string') {
            routeStatsEl.textContent = stats;
        } else {
            routeStatsEl.textContent = `${stats || 0} points, ${checkpointManager?.checkpoints?.length || 0} checkpoints`;
        }
    }
}

/**
 * Update checkpoint list UI with split times
 */
function updateCheckpointList() {
    const listEl = document.querySelector('.checkpoint-list');
    if (!listEl) return;

    const checkpoints = checkpointManager?.checkpoints || [];

    if (checkpoints.length === 0) {
        listEl.innerHTML = '<div class="checkpoint-placeholder">No checkpoints loaded</div>';
        return;
    }

    listEl.innerHTML = checkpoints.map((cp, index) => {
        if (!cp) return '';

        const typeClass = cp.type || 'checkpoint';
        const completedClass = cp.completed ? 'completed' : '';
        const activeClass = cp.active ? 'active' : '';

        // Format times
        const totalTime = cp.currentTime ? H.timer(cp.currentTime / 1000) : '--:--';
        const splitTime = cp.splitTime ? H.timer(cp.splitTime / 1000) : '';

        // Format delta (ahead/behind)
        let deltaHtml = '';
        if (cp.delta !== undefined && cp.delta !== null) {
            const deltaClass = cp.delta < 0 ? 'ahead' : 'behind';
            const deltaSign = cp.delta < 0 ? '' : '+';
            deltaHtml = `<span class="checkpoint-delta ${deltaClass}">${deltaSign}${H.timer(Math.abs(cp.delta) / 1000)}</span>`;
        }

        // Format FIT file reference time (stored in seconds)
        const refTime = cp.time !== null && cp.time !== undefined ? H.timer(cp.time) : '--:--';

        return `
            <div class="checkpoint-item ${typeClass} ${completedClass} ${activeClass}" data-checkpoint-id="${cp.id}">
                <div class="checkpoint-info">
                    <div class="checkpoint-name">${cp.name || 'Unnamed'}</div>
                    <div class="checkpoint-distance">${H.distance(cp.distance || 0, {suffix: true})}</div>
                    <div class="checkpoint-times">
                        <span class="ref-time" title="FIT file reference time">Ref: ${refTime}</span>
                        ${cp.completed ? `<span class="rider-time" title="Your time">You: ${totalTime}</span>` : ''}
                    </div>
                    ${cp.completed && splitTime ? `<div class="checkpoint-split">Split: ${splitTime}${deltaHtml}</div>` : ''}
                </div>
                <div class="checkpoint-time">${cp.completed ? '' : totalTime}</div>
                <div class="checkpoint-actions">
                    <button class="btn delete-checkpoint" data-checkpoint-id="${cp.id}" title="Delete checkpoint">×</button>
                </div>
            </div>
        `;
    }).filter(html => html).join('');

    // Add event listeners
    listEl.querySelectorAll('.delete-checkpoint').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const checkpointId = parseInt(e.target.dataset.checkpointId);
            if (!isNaN(checkpointId)) {
                const deleted = checkpointManager.deleteCheckpoint(checkpointId);
                if (deleted) {
                    updateCheckpointList();
                    initializeProgressBar(); // Refresh progress bar
                    showNotification(`Deleted checkpoint: ${deleted.name}`, 'info');
                }
            }
        });
    });
}

/**
 * Update timing information display
 */
function updateTimingInfo() {
    const currentSegmentEl = document.querySelector('.segment-time');
    const totalTimeEl = document.querySelector('.time-value');

    const timing = checkpointManager?.getTimingInfo() || {
        totalTime: 0,
        segmentTime: 0,
        hasStarted: false
    };

    if (currentSegmentEl) {
        currentSegmentEl.textContent = timing.hasStarted ? H.timer(timing.segmentTime / 1000) : '--:--';
    }

    if (totalTimeEl) {
        totalTimeEl.textContent = timing.hasStarted ? H.timer(timing.totalTime / 1000) : '--:--';
    }
}

/**
 * Update progress bar display
 */
function updateProgressBar(progress = 0, distance = 0) {
    const container = document.querySelector('.progress-bar-container');
    if (!container) return;

    // Show progress bar if we have route data
    if (routeData && routeData.coordinates && routeData.coordinates.length > 0) {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
        return;
    }

    const totalDistance = checkpointManager?.curvePath?.totalDistance || 0;
    const progressPercent = Math.min(progress * 100, 100);

    // Update fill bar
    const fillEl = container.querySelector('.progress-bar-fill');
    if (fillEl) {
        fillEl.style.width = `${progressPercent}%`;
    }

    // Update athlete marker
    const markerEl = container.querySelector('.progress-athlete-marker');
    if (markerEl) {
        markerEl.style.left = `${progressPercent}%`;
    }

    // Update header info
    const distanceEl = container.querySelector('.progress-distance');
    const percentEl = container.querySelector('.progress-percent');
    const remainingEl = container.querySelector('.progress-remaining');

    if (distanceEl) {
        distanceEl.textContent = H.distance(distance, { suffix: true });
    }
    if (percentEl) {
        percentEl.textContent = `${progressPercent.toFixed(1)}%`;
    }
    if (remainingEl && totalDistance > 0) {
        const remaining = Math.max(0, totalDistance - distance);
        remainingEl.textContent = `${H.distance(remaining, { suffix: true })} remaining`;
    }
}

/**
 * Initialize progress bar with checkpoint markers
 */
function initializeProgressBar() {
    const container = document.querySelector('.progress-bar-container');
    const checkpointsEl = container?.querySelector('.progress-bar-checkpoints');

    if (!container || !checkpointsEl || !checkpointManager) return;

    // Clear existing markers
    checkpointsEl.innerHTML = '';

    // Add markers for each checkpoint
    const checkpoints = checkpointManager.checkpoints || [];
    for (const cp of checkpoints) {
        const progress = cp.progress || 0;
        const marker = document.createElement('div');
        marker.className = `progress-checkpoint-marker ${cp.type || ''} ${cp.completed ? 'completed' : ''}`;
        marker.style.left = `${progress * 100}%`;
        marker.title = `${cp.name} - ${H.distance(cp.distance, { suffix: true })}`;
        checkpointsEl.appendChild(marker);
    }

    // Show the progress bar
    container.style.display = 'flex';
}

/**
 * Check if a file is a supported route file
 */
function isSupportedRouteFile(file) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    return name.endsWith('.json') ||
           name.endsWith('.fit') ||
           type === 'application/json';
}

/**
 * Get file type from file object
 */
function getFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.fit')) return 'fit';
    if (name.endsWith('.json') || file.type === 'application/json') return 'json';
    return 'unknown';
}

/**
 * Process a route file (JSON or FIT)
 */
async function processRouteFile(file) {
    const fileType = getFileType(file);

    showNotification(`Loading ${fileType.toUpperCase()} file: ${file.name}...`, 'info');

    if (fileType === 'fit') {
        // Handle FIT file
        const reader = new FileReader();

        return new Promise((resolve, reject) => {
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                        throw new Error('FIT file is empty');
                    }

                    console.log(`Processing FIT file: ${file.name} (${arrayBuffer.byteLength} bytes)`);

                    // Parse the FIT file
                    const routeData = await parseFitFile(arrayBuffer);

                    // Update the route name with filename if generic
                    if (routeData.name === 'FIT Activity' || !routeData.name) {
                        routeData.name = file.name.replace(/\.fit$/i, '');
                    }

                    await loadRoute(routeData);
                    resolve(routeData);
                } catch (error) {
                    console.error('Error processing FIT file:', error);
                    showNotification('Error processing FIT file: ' + error.message, 'error');
                    reject(error);
                }
            };

            reader.onerror = () => {
                const error = new Error('Error reading FIT file');
                showNotification(error.message, 'error');
                reject(error);
            };

            reader.readAsArrayBuffer(file);
        });

    } else if (fileType === 'json') {
        // Handle JSON file
        const reader = new FileReader();

        return new Promise((resolve, reject) => {
            reader.onload = async (e) => {
                try {
                    const jsonText = e.target.result;
                    if (!jsonText || jsonText.length === 0) {
                        throw new Error('JSON file is empty');
                    }

                    const jsonData = JSON.parse(jsonText);
                    if (!jsonData) {
                        throw new Error('Failed to parse JSON - result is empty');
                    }

                    await loadRoute(jsonData);
                    resolve(jsonData);
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    showNotification('Error parsing JSON file: ' + error.message, 'error');
                    reject(error);
                }
            };

            reader.onerror = () => {
                const error = new Error('Error reading JSON file');
                showNotification(error.message, 'error');
                reject(error);
            };

            reader.readAsText(file);
        });

    } else {
        const error = new Error(`Unsupported file type. Please use .json or .fit files.`);
        showNotification(error.message, 'error');
        throw error;
    }
}

/**
 * Enhanced file loading with support for JSON and FIT files
 */
function setupFileLoading() {
    const fileInput = document.getElementById('route-file-input');
    const loadButton = document.querySelector('.load-route');

    if (!fileInput || !loadButton) {
        console.warn('File loading elements not found');
        return;
    }

    // Update file input to accept both JSON and FIT
    fileInput.setAttribute('accept', '.json,.fit,application/json');

    loadButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!isSupportedRouteFile(file)) {
            showNotification('Please select a JSON or FIT file', 'error');
            fileInput.value = '';
            return;
        }

        try {
            await processRouteFile(file);
        } catch (error) {
            console.error('File processing error:', error);
        }

        fileInput.value = '';
    });
    
    // Enhanced drag and drop support for JSON and FIT files
    const mapContainer = document.querySelector('.map-container');
    if (!mapContainer) return;

    mapContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        mapContainer.classList.add('drag-over');
    });

    mapContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        mapContainer.classList.remove('drag-over');
    });

    mapContainer.addEventListener('drop', async (e) => {
        e.preventDefault();
        mapContainer.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length === 0) {
            showNotification('No files dropped', 'error');
            return;
        }

        const file = files[0];
        if (!isSupportedRouteFile(file)) {
            showNotification('Please drop a JSON or FIT file', 'error');
            return;
        }

        try {
            await processRouteFile(file);
        } catch (error) {
            console.error('Drag-drop file processing error:', error);
        }
    });
}

/**
 * Setup map controls
 */
function setupMapControls() {
    const zoomInBtn = document.querySelector('.zoom-in');
    const zoomOutBtn = document.querySelector('.zoom-out');
    const autoHeadingBtn = document.querySelector('.toggle-auto-heading');
    const autoCenterBtn = document.querySelector('.toggle-auto-center');
    const fitRouteBtn = document.querySelector('.fit-route');

    // Zoom controls
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            if (zwiftMap) {
                try {
                    const currentZoom = zwiftMap.zoom || 1;
                    zwiftMap.setZoom(currentZoom * 1.25); // Zoom in by 25%
                } catch (error) {
                    console.warn('Error zooming in:', error);
                }
            }
        });
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            if (zwiftMap) {
                try {
                    const currentZoom = zwiftMap.zoom || 1;
                    zwiftMap.setZoom(currentZoom * 0.8); // Zoom out by 20%
                } catch (error) {
                    console.warn('Error zooming out:', error);
                }
            }
        });
    }

    if (autoHeadingBtn) {
        autoHeadingBtn.addEventListener('click', () => {
            settings.autoHeading = !settings.autoHeading;
            common.settingsStore.set('autoHeading', settings.autoHeading);
            if (zwiftMap) {
                try {
                    zwiftMap.setAutoHeading(settings.autoHeading);
                } catch (error) {
                    console.warn('Error setting auto heading:', error);
                }
            }
            autoHeadingBtn.classList.toggle('active', settings.autoHeading);
        });
        autoHeadingBtn.classList.toggle('active', settings.autoHeading);
    }
    
    if (autoCenterBtn) {
        autoCenterBtn.addEventListener('click', () => {
            settings.autoCenter = !settings.autoCenter;
            common.settingsStore.set('autoCenter', settings.autoCenter);
            if (zwiftMap) {
                try {
                    zwiftMap.setAutoCenter(settings.autoCenter);
                } catch (error) {
                    console.warn('Error setting auto center:', error);
                }
            }
            autoCenterBtn.classList.toggle('active', settings.autoCenter);
        });
        autoCenterBtn.classList.toggle('active', settings.autoCenter);
    }
    
    if (fitRouteBtn) {
        fitRouteBtn.addEventListener('click', () => {
            if (routeData && routeData.coordinates) {
                try {
                    const coordinates = convertCoordinates(routeData.coordinates, routeData.worldId, routeData.courseId, settings);
                    fitRouteToView(coordinates);
                } catch (error) {
                    console.warn('Error fitting route to view:', error);
                    showNotification('Error fitting route to view', 'error');
                }
            }
        });
    }
}

/**
 * Setup checkpoint controls
 */
function setupCheckpointControls() {
    const addCheckpointBtn = document.querySelector('.add-checkpoint');
    const clearCheckpointsBtn = document.querySelector('.clear-checkpoints');
    const toggleCheckpointsBtn = document.querySelector('.toggle-checkpoints');
    
    if (addCheckpointBtn) {
        addCheckpointBtn.addEventListener('click', async () => {
            try {
                await checkpointManager.addCheckpointAtCurrentPosition(watchingId, athleteId);
                updateCheckpointList();
                showNotification('Added checkpoint at current position', 'success');
            } catch (error) {
                showNotification('Error adding checkpoint: ' + error.message, 'error');
            }
        });
    }
    
    if (clearCheckpointsBtn) {
        clearCheckpointsBtn.addEventListener('click', () => {
            if (confirm('Clear all checkpoints and reset timing?')) {
                checkpointManager.clearCheckpoints();
                updateCheckpointList();
                updateTimingInfo();
                showNotification('All checkpoints cleared', 'info');
            }
        });
    }
    
    if (toggleCheckpointsBtn) {
        toggleCheckpointsBtn.addEventListener('click', () => {
            settings.showCheckpoints = !settings.showCheckpoints;
            common.settingsStore.set('showCheckpoints', settings.showCheckpoints);
            
            checkpointManager.toggleCheckpointVisibility(settings.showCheckpoints);
            toggleCheckpointsBtn.classList.toggle('active', settings.showCheckpoints);
        });
        toggleCheckpointsBtn.classList.toggle('active', settings.showCheckpoints);
    }
}

/**
 * Create and configure the Zwift map with better error handling
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
                <div style="font-size: 14px; opacity: 0.8;">Routes can still be loaded and parsed</div>
                <div style="font-size: 12px; margin-top: 10px;">Error: ${error.message}</div>
            </div>
        `;
        
        return null;
    }
}

/**
 * Initialize athlete tracking with better error handling
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
 * Setup live data subscriptions with Ghost Rider integration
 */
function setupLiveTracking() {
    if (!settings.liveTracking) {
        console.log('Live tracking disabled');
        return;
    }
    
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
            
            // Check checkpoint progress using new updateProgress method
            const watchingState = states.find(s => s && s.athleteId === (watchingId || athleteId));
            if (watchingState && checkpointManager) {
                try {
                    const result = checkpointManager.updateProgress(watchingState);

                    // Handle reached checkpoints
                    if (result.reached && result.reached.length > 0 && settings.checkpointAlerts) {
                        for (const checkpoint of result.reached) {
                            const splitInfo = checkpoint.splitTime ?
                                ` (Split: ${H.timer(checkpoint.splitTime / 1000)})` : '';
                            showNotification(`Checkpoint reached: ${checkpoint.name}!${splitInfo}`, 'success');
                        }
                        updateCheckpointList();
                    }

                    // Update progress bar
                    updateProgressBar(result.currentProgress, result.currentDistance);

                } catch (error) {
                    console.warn('Error checking checkpoint progress:', error);
                }
            }
            
            // 🆕 NEW: Handle Ghost Rider updates
            if (watchingState && replayManager) {
                try {
                    handleLiveAthleteUpdate(watchingState);
                } catch (error) {
                    console.warn('Error updating Ghost Rider:', error);
                }
            }
            
            updateTimingInfo();
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
                
                if (checkpointManager) {
                    checkpointManager.resetTiming();
                    updateCheckpointList();
                    updateTimingInfo();
                }
                
                console.log('Now watching athlete:', watchingId);
            }
        });
        
        console.log('Live tracking subscriptions set up with Ghost Rider support');
        
    } catch (error) {
        console.error('Error setting up live tracking:', error);
    }
}

/**
 * Initialize the application with Ghost Rider support
 */
async function initialize() {
    try {
        console.log('🚀 Initializing Enhanced Checkpoint Tracker with Ghost Rider...');
        
        // Initialize checkpoint manager
        checkpointManager = new CheckpointManager(settings);
        
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
        
        // Connect checkpoint manager to map
        if (zwiftMap && checkpointManager) {
            checkpointManager.setMap(zwiftMap);
        }
        
        // 🆕 NEW: Initialize Ghost Rider replay manager
        if (zwiftMap) {
            try {
                replayManager = initializeReplay(zwiftMap, checkpointManager);
                console.log('👻 Ghost Rider initialized successfully!');
            } catch (error) {
                console.warn('Failed to initialize Ghost Rider:', error);
            }
        }
        
        // Initialize athlete tracking
        await initializeAthleteTracking();
        
        // Setup all the UI controls
        setupFileLoading();
        setupMapControls();
        setupCheckpointControls();
        
        // Setup live tracking
        setupLiveTracking();
        
        // Initial UI update
        updateRouteInfo('No route loaded', 'Click 📁 to load route (JSON/FIT) or drag & drop');
        updateCheckpointList();
        updateTimingInfo();
        
        console.log('✨ Enhanced Checkpoint Tracker with Ghost Rider initialized successfully!');
        
    } catch (error) {
        console.error('Error initializing Enhanced Checkpoint Tracker:', error);
        showNotification('Initialization error: ' + error.message, 'error');
    }
}

/**
 * Enhanced debug functions for console use
 */
window.debugRouteData = function() {
    console.log('Current route data:', {
        routeData,
        checkpoints: checkpointManager?.checkpoints?.length || 0,
        zwiftMap: !!zwiftMap,
        currentRoute: !!currentRoute,
        worldList: worldList?.length || 0,
        replayManager: !!replayManager,
        ghostRiderReady: replayManager?.personalBestData ? true : false,
        settings,
        inGame,
        athleteId,
        watchingId
    });
    
    if (routeData) {
        console.log('Route details:', {
            name: routeData.name,
            coordinates: routeData.coordinates?.length || 0,
            telemetry: !!routeData.telemetry,
            metadata: routeData.metadata,
            worldId: routeData.worldId,
            courseId: routeData.courseId
        });
    }
    
    if (checkpointManager) {
        console.log('Checkpoint stats:', checkpointManager.getStats());
        console.log('Timing info:', checkpointManager.getTimingInfo());
    }
    
    if (replayManager) {
        console.log('👻 Ghost Rider stats:', replayManager.getReplayStats());
    }
    
    return { routeData, checkpointManager, zwiftMap, currentRoute, replayManager };
};

window.loadTestRoute = function() {
    const testRoute = generateSampleRoute();
    console.log('Loading test route:', testRoute);
    loadRoute(testRoute);
    return testRoute;
};

window.startGhostRider = function() {
    if (replayManager) {
        const started = replayManager.toggleReplay();
        console.log(`👻 Ghost Rider ${started ? 'started' : 'stopped'}!`);
        return started;
    } else {
        console.error('Ghost Rider not available - load a route with telemetry data first!');
        return false;
    }
};

window.setGhostSpeed = function(speed = 1) {
    if (replayManager) {
        replayManager.setReplaySpeed(speed);
        console.log(`👻 Ghost Rider speed set to ${speed}x`);
        return speed;
    } else {
        console.error('Ghost Rider not available');
        return false;
    }
};

window.ghostStats = function() {
    if (replayManager) {
        const stats = replayManager.getReplayStats();
        console.log('👻 Ghost Rider Statistics:', stats);
        return stats;
    } else {
        console.error('Ghost Rider not available');
        return null;
    }
};

window.clearCurrentRoute = function() {
    clearRoute();
    if (checkpointManager) {
        checkpointManager.clearCheckpoints();
    }
    if (replayManager && replayManager.replayMode) {
        replayManager.stopReplay();
    }
    updateRouteInfo('No route loaded', 'Route cleared');
    updateCheckpointList();
    updateTimingInfo();
    showNotification('Route, checkpoints, and Ghost Rider cleared', 'info');
};

/**
 * Main entry point
 */
export async function main() {
    common.initInteractionListeners();
    
    console.log('🚀 Starting Enhanced Checkpoint Tracker with Ghost Rider...');
    console.log('Available debug functions:');
    console.log('- loadTestRoute() - Load a test route');
    console.log('- debugRouteData() - Show current route state');
    console.log('- startGhostRider() - Start/stop the Ghost Rider');
    console.log('- setGhostSpeed(speed) - Set Ghost Rider speed (0.1x - 10x)');
    console.log('- ghostStats() - Get Ghost Rider statistics');
    console.log('- clearCurrentRoute() - Clear current route and all data');
    
    try {
        await initialize();
        console.log('✨ Enhanced Checkpoint Tracker with Ghost Rider ready!');
        showNotification('👻 Enhanced Checkpoint Tracker ready! Load a route to race against your Ghost Rider!', 'info');
    } catch (error) {
        console.error('Failed to initialize Enhanced Checkpoint Tracker:', error);
        
        updateRouteInfo('Initialization failed', 'Check browser console for errors');
        updateCheckpointList();
        updateTimingInfo();
        
        showNotification(
            'Enhanced Checkpoint Tracker failed to initialize. ' +
            'Some features may not work. Check browser console for details.',
            'error'
        );
    }
}