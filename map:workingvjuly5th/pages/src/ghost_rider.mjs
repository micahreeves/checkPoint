// ghost_rider.mjs - FIXED: Clean live data tracking (same as main map)
// Removed all conflicting systems, uses single clean approach like simple_live_map.mjs

import * as common from '/pages/src/common.mjs';
import * as locale from '/shared/sauce/locale.mjs';

// Global state
let ghostData = null;
let liveData = {
    distance: 0,
    time: 0,
    power: 0,
    isConnected: false,
    startTime: null
};

// Current athlete tracking (same as main map)
let athleteId = null;
let watchingId = null;
let watchdog = null;
let inGame = false;

const H = locale.human;

/**
 * Simple ghost data structure with PROPER TIMER TIME HANDLING (moving time)
 */
class SimpleGhost {
    constructor(checkpoints) {
        this.checkpoints = checkpoints || [];
        this.totalDistance = 0;
        this.totalTime = 0;
        this.isLoaded = false;
        
        // Only process if we have raw checkpoint data that needs processing
        if (checkpoints && checkpoints.length > 0 && !checkpoints[0].elapsedTime) {
            console.log('👻 Processing raw checkpoint data...');
            this.processCheckpoints();
        } else if (checkpoints && checkpoints.length > 0) {
            // Data is already processed (from main window with actual timer times)
            this.totalDistance = Math.max(...checkpoints.map(cp => cp.distance));
            this.totalTime = Math.max(...checkpoints.map(cp => cp.elapsedTime));
            this.isLoaded = true;
            console.log(`👻 Using pre-processed ghost data: ${(this.totalDistance / 1000).toFixed(1)}km in ${this.formatTime(this.totalTime)} (moving time)`);
        }
    }
    
    /**
     * Process raw checkpoints - ONLY used if we don't have pre-calculated elapsed times
     */
    processCheckpoints() {
        // Sort by distance
        this.checkpoints.sort((a, b) => a.distance - a.distance);
        
        // Calculate total distance
        this.totalDistance = Math.max(...this.checkpoints.map(cp => cp.distance));
        
        // IMPROVED time calculation based on realistic cycling speeds
        let cumulativeTime = 0;
        let prevDistance = 0;
        
        for (let i = 0; i < this.checkpoints.length; i++) {
            const checkpoint = this.checkpoints[i];
            const segmentDistance = checkpoint.distance - prevDistance;
            
            // Use realistic cycling speed for estimation
            const realisticSpeed = 39 * 1000 / 3600; // 39 km/h in m/s
            const segmentTime = segmentDistance / realisticSpeed;
            
            cumulativeTime += segmentTime;
            checkpoint.elapsedTime = cumulativeTime;
            prevDistance = checkpoint.distance;
        }
        
        this.totalTime = cumulativeTime;
        this.isLoaded = true;
        
        console.log(`👻 Simple Ghost: ${(this.totalDistance / 1000).toFixed(1)}km in ${this.formatTime(this.totalTime)}`);
    }
    
    /**
     * Get ghost time at specific distance with interpolation
     */
    getTimeAtDistance(distance) {
        if (!this.isLoaded || this.checkpoints.length === 0) return null;
        
        // Handle edge cases
        if (distance <= 0) return 0;
        if (distance >= this.totalDistance) return this.totalTime;
        
        // Find the checkpoint range for interpolation
        let beforeCheckpoint = null;
        let afterCheckpoint = null;
        
        for (let i = 0; i < this.checkpoints.length; i++) {
            const checkpoint = this.checkpoints[i];
            
            if (checkpoint.distance <= distance) {
                beforeCheckpoint = checkpoint;
            } else {
                afterCheckpoint = checkpoint;
                break;
            }
        }
        
        // If we have an exact match
        if (beforeCheckpoint && beforeCheckpoint.distance === distance) {
            return beforeCheckpoint.elapsedTime;
        }
        
        // If we only have a before checkpoint (at the end)
        if (beforeCheckpoint && !afterCheckpoint) {
            return beforeCheckpoint.elapsedTime;
        }
        
        // If we only have an after checkpoint (at the beginning)
        if (!beforeCheckpoint && afterCheckpoint) {
            // Linear interpolation from 0
            const ratio = distance / afterCheckpoint.distance;
            return afterCheckpoint.elapsedTime * ratio;
        }
        
        // Linear interpolation between two checkpoints
        if (beforeCheckpoint && afterCheckpoint) {
            const distanceRange = afterCheckpoint.distance - beforeCheckpoint.distance;
            const timeRange = afterCheckpoint.elapsedTime - beforeCheckpoint.elapsedTime;
            const ratio = (distance - beforeCheckpoint.distance) / distanceRange;
            
            return beforeCheckpoint.elapsedTime + (timeRange * ratio);
        }
        
        // Fallback (shouldn't reach here)
        return null;
    }
    
    /**
     * Format time as MM:SS or HH:MM:SS
     */
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
}

/**
 * Show notifications
 */
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }
}

/**
 * Load ghost data from localStorage (same approach as main map sharing data)
 */
function loadGhostFromStorage() {
    try {
        console.log('👻 Loading ghost data from localStorage...');
        
        const storedData = localStorage.getItem('ghostRiderData');
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            console.log(`👻 Found stored ghost data with ${parsedData.checkpoints?.length || 0} checkpoints`);
            
            if (parsedData.checkpoints && parsedData.checkpoints.length > 0) {
                // Create SimpleGhost with the stored data (already has actual elapsed times)
                ghostData = new SimpleGhost();
                ghostData.checkpoints = parsedData.checkpoints;
                ghostData.totalDistance = parsedData.totalDistance;
                ghostData.totalTime = parsedData.totalTime;
                ghostData.isLoaded = true;
                
                showGhostLoaded();
                showNotification(`👻 Ghost loaded: ${(ghostData.totalDistance / 1000).toFixed(1)}km in ${ghostData.formatTime(ghostData.totalTime)}`, 'success');
                return true;
            }
        } else {
            console.log('👻 No ghost data found in localStorage');
        }
        
        return false;
        
    } catch (error) {
        console.warn('Could not load ghost data from localStorage:', error);
        return false;
    }
}

/**
 * Initialize athlete tracking - EXACT SAME AS MAIN MAP
 */
async function initializeAthleteTracking() {
    try {
        console.log('🏃 Initializing athlete tracking (same as main map)...');
        
        // Get self athlete data (same as main map)
        let selfData;
        try {
            selfData = await common.rpc.getAthleteData('self');
            inGame = !!(selfData && selfData.age < 15000);
        } catch (error) {
            console.warn('Could not get self athlete data:', error);
            inGame = false;
            selfData = null;
        }
        
        if (selfData?.athleteId) {
            athleteId = selfData.athleteId;
            console.log('✅ Self athlete ID:', athleteId);
        }
        
        // Get watching athlete data (same as main map)
        let watchingData;
        try {
            watchingData = await common.rpc.getAthleteData('watching');
        } catch (error) {
            console.warn('Could not get watching athlete data:', error);
            watchingData = null;
        }
        
        if (watchingData?.athleteId) {
            watchingId = watchingData.athleteId;
            console.log('👀 Watching athlete ID:', watchingId);
        } else if (athleteId) {
            watchingId = athleteId;
            console.log('👀 Watching self:', watchingId);
        }
        
        console.log('✅ Athlete tracking initialized');
        
    } catch (error) {
        console.error('❌ Error initializing athlete tracking:', error);
    }
}

/**
 * Setup live tracking - FIXED: Stable connection tracking (no spam)
 */
function setupLiveTracking() {
    console.log('📡 Setting up live tracking (stable connection tracking)...');
    
    // Track connection state more precisely
    let lastConnectedAthlete = null;
    let connectionStartTime = null;
    
    // Watchdog to detect game connection (same as main map)
    const watchdogInterval = setInterval(() => {
        if (inGame && performance.now() - (watchdog || 0) > 10000) {
            console.warn("🐕 Watchdog triggered - game connection lost");
            inGame = false;
            liveData.isConnected = false;
            lastConnectedAthlete = null;
            initializeAthleteTracking();
        }
    }, 5000);
    
    try {
        // Subscribe to athlete states (FIXED: no spam reconnections)
        common.subscribe('states', async (states) => {
            if (!states?.length) {
                // No states data - mark as disconnected if we were connected
                if (liveData.isConnected) {
                    console.log('📡 No states data - marking as disconnected');
                    liveData.isConnected = false;
                    lastConnectedAthlete = null;
                }
                return;
            }
            
            watchdog = performance.now();
            
            // Update game connection status (same as main map)
            if (!inGame) {
                inGame = true;
                console.log('🎮 Game connection established');
                await initializeAthleteTracking();
            }
            
            // Find the athlete we're tracking (SAME LOGIC as main map)
            let targetAthlete = null;
            
            if (watchingId) {
                // Use the specific watching athlete ID
                targetAthlete = states.find(state => state.athleteId === watchingId);
            }
            
            // Fallback: try to find self athlete (same as main map)
            if (!targetAthlete && athleteId) {
                targetAthlete = states.find(state => state.athleteId === athleteId);
            }
            
            // Final fallback: self flag
            if (!targetAthlete) {
                targetAthlete = states.find(state => state.isSelf);
            }
            
            if (!targetAthlete) {
                // No target athlete found - only disconnect if we were connected
                if (liveData.isConnected) {
                    console.log('👻 Target athlete lost - marking as disconnected');
                    liveData.isConnected = false;
                    lastConnectedAthlete = null;
                }
                return;
            }
            
            // STABLE CONNECTION LOGIC - only show messages on actual state changes
            const currentAthleteId = targetAthlete.athleteId;
            const wasConnected = liveData.isConnected;
            const isNewAthlete = lastConnectedAthlete !== currentAthleteId;
            
            // Update connection status
            liveData.isConnected = true;
            
            // Handle connection messages - ONLY on actual state changes
            if (!wasConnected && targetAthlete.distance > 0) {
                // True reconnection after being disconnected
                if (isNewAthlete) {
                    console.log(`👻 Connected to athlete ${currentAthleteId} (${targetAthlete.name || 'Unknown'})`);
                    showNotification(`Connected to ${targetAthlete.name || 'Athlete ' + currentAthleteId}`, 'success');
                } else {
                    console.log(`👻 Reconnected to athlete ${currentAthleteId} (${targetAthlete.name || 'Unknown'})`);
                    showNotification(`Reconnected to ${targetAthlete.name || 'Athlete ' + currentAthleteId}`, 'info');
                }
                lastConnectedAthlete = currentAthleteId;
            } else if (wasConnected && isNewAthlete && targetAthlete.distance > 0) {
                // Switched to a different athlete
                console.log(`👻 Switched to athlete ${currentAthleteId} (${targetAthlete.name || 'Unknown'})`);
                showNotification(`Now tracking ${targetAthlete.name || 'Athlete ' + currentAthleteId}`, 'info');
                lastConnectedAthlete = currentAthleteId;
                
                // Reset tracking for new athlete
                liveData.startTime = null;
                liveData.distance = 0;
                liveData.time = 0;
                liveData.power = 0;
            }
            
            // Set start time on first data (only when rider starts moving and we haven't started yet)
            if (liveData.startTime === null && targetAthlete.distance > 0) {
                liveData.startTime = Date.now();
                connectionStartTime = Date.now();
                console.log(`👻 Live tracking started for athlete ${currentAthleteId} at distance ${targetAthlete.distance}m`);
            }
            
            // Update live data (same calculation as main map)
            if (liveData.startTime !== null) {
                liveData.distance = targetAthlete.distance || 0;
                liveData.time = (Date.now() - liveData.startTime) / 1000;
                liveData.power = targetAthlete.power || 0;
                
                updateDisplay();
            }
        });
        
        // Subscribe to watching athlete changes (FIXED: cleaner athlete switching)
        common.subscribe('watching-athlete-change', async (newWatchingId) => {
            if (newWatchingId && !isNaN(newWatchingId)) {
                const oldWatchingId = watchingId;
                watchingId = newWatchingId;
                
                console.log(`👀 Watching athlete changed from ${oldWatchingId} to ${newWatchingId}`);
                
                // Force athlete change on next states update
                lastConnectedAthlete = null;
                
                // Reset tracking for new athlete
                liveData.startTime = null;
                liveData.distance = 0;
                liveData.time = 0;
                liveData.power = 0;
                
                showNotification(`Switching to athlete: ${newWatchingId}`, 'info');
            }
        });
        
        console.log('👻 Live tracking setup complete (stable connection, no spam)');
        
        // Store cleanup function
        window.addEventListener('beforeunload', () => {
            clearInterval(watchdogInterval);
        });
        
    } catch (error) {
        console.error('❌ Error setting up live tracking:', error);
        showNotification('Error connecting to Zwift: ' + error.message, 'error');
    }
}

/**
 * Show ghost loaded state with checkpoint list
 */
function showGhostLoaded() {
    if (!ghostData || !ghostData.isLoaded) return;
    
    // Hide no-ghost state, show comparison safely
    const noGhostState = document.getElementById('no-ghost-state');
    const comparisonDisplay = document.getElementById('comparison-display');
    
    if (noGhostState) noGhostState.style.display = 'none';
    if (comparisonDisplay) comparisonDisplay.style.display = 'flex';
    
    // Update ghost stats safely
    const ghostDistance = document.getElementById('ghost-distance');
    const ghostTime = document.getElementById('ghost-time');
    
    if (ghostDistance) ghostDistance.textContent = (ghostData.totalDistance / 1000).toFixed(1) + 'km';
    if (ghostTime) ghostTime.textContent = ghostData.formatTime(ghostData.totalTime);
    
    // Create checkpoint list
    createCheckpointList();
    
    console.log('✅ Ghost UI updated with checkpoint list');
}

/**
 * Create checkpoint list showing all km markers and times
 */
function createCheckpointList() {
    if (!ghostData || !ghostData.checkpoints) return;
    
    const checkpointListEl = document.getElementById('checkpoint-list');
    if (!checkpointListEl) {
        console.warn('Checkpoint list element not found');
        return;
    }
    
    // Clear existing list
    checkpointListEl.innerHTML = '';
    
    // Add header
    const header = document.createElement('div');
    header.className = 'checkpoint-header';
    header.innerHTML = `
        <span>Distance</span>
        <span>Ghost Time</span>
        <span>Status</span>
    `;
    checkpointListEl.appendChild(header);
    
    // Add each checkpoint
    ghostData.checkpoints.forEach((checkpoint, index) => {
        const item = document.createElement('div');
        item.className = 'checkpoint-item';
        item.dataset.distance = checkpoint.distance;
        
        const distanceKm = (checkpoint.distance / 1000).toFixed(1);
        const ghostTime = ghostData.formatTime(checkpoint.elapsedTime);
        
        item.innerHTML = `
            <span class="checkpoint-distance">${distanceKm}km</span>
            <span class="checkpoint-time">${ghostTime}</span>
            <span class="checkpoint-status" id="status-${checkpoint.distance}">--</span>
        `;
        
        // Add start/finish indicators
        if (index === 0) {
            item.classList.add('start');
            item.querySelector('.checkpoint-distance').textContent = 'START';
        } else if (index === ghostData.checkpoints.length - 1) {
            item.classList.add('finish');
            item.querySelector('.checkpoint-distance').textContent = `FINISH (${distanceKm}km)`;
        }
        
        checkpointListEl.appendChild(item);
    });
    
    console.log(`✅ Created checkpoint list with ${ghostData.checkpoints.length} items`);
}

/**
 * Update checkpoint list with live progress
 */
function updateCheckpointList() {
    if (!ghostData || !liveData.isConnected || liveData.distance <= 0) return;
    
    const checkpointItems = document.querySelectorAll('.checkpoint-item');
    
    checkpointItems.forEach(item => {
        const checkpointDistance = parseInt(item.dataset.distance);
        const statusEl = item.querySelector('.checkpoint-status');
        
        if (!statusEl) return;
        
        if (liveData.distance < checkpointDistance) {
            // Haven't reached this checkpoint yet
            statusEl.textContent = '--';
            statusEl.className = 'checkpoint-status upcoming';
            item.classList.remove('passed', 'current');
        } else {
            // Calculate delta for this checkpoint
            const ghostTimeAtCheckpoint = ghostData.getTimeAtDistance(checkpointDistance);
            
            // Calculate what our time would be at this checkpoint
            const timeRatio = checkpointDistance / liveData.distance;
            const ourTimeAtCheckpoint = liveData.time * timeRatio;
            
            if (ghostTimeAtCheckpoint !== null) {
                const delta = ourTimeAtCheckpoint - ghostTimeAtCheckpoint;
                
                if (Math.abs(delta) < 1) {
                    statusEl.textContent = 'Even';
                    statusEl.className = 'checkpoint-status even';
                } else if (delta < 0) {
                    statusEl.textContent = `-${ghostData.formatTime(Math.abs(delta))}`;
                    statusEl.className = 'checkpoint-status ahead';
                } else {
                    statusEl.textContent = `+${ghostData.formatTime(delta)}`;
                    statusEl.className = 'checkpoint-status behind';
                }
            } else {
                statusEl.textContent = 'N/A';
                statusEl.className = 'checkpoint-status upcoming';
            }
            
            item.classList.add('passed');
            item.classList.remove('current');
        }
    });
    
    // Highlight current section
    const currentCheckpoint = ghostData.checkpoints.find((cp, index) => {
        const nextCp = ghostData.checkpoints[index + 1];
        return liveData.distance >= cp.distance && 
               (!nextCp || liveData.distance < nextCp.distance);
    });
    
    if (currentCheckpoint) {
        const currentItem = document.querySelector(`[data-distance="${currentCheckpoint.distance}"]`);
        if (currentItem) {
            // Remove current class from all items first
            checkpointItems.forEach(item => item.classList.remove('current'));
            currentItem.classList.add('current');
        }
    }
}

/**
 * Update live display
 */
function updateDisplay() {
    if (!ghostData || !ghostData.isLoaded) return;
    
    // Update connection status safely
    const statusDot = document.getElementById('status-dot');
    const connectionText = document.getElementById('connection-text');
    
    if (statusDot && connectionText) {
        if (liveData.isConnected) {
            statusDot.className = 'status-dot online';
            connectionText.textContent = 'Connected - Tracking Rider';
        } else {
            statusDot.className = 'status-dot offline';
            connectionText.textContent = 'Waiting for rider data...';
        }
    }
    
    // Update live stats safely
    const liveDistance = document.getElementById('live-distance');
    const liveTime = document.getElementById('live-time');
    
    if (liveDistance) liveDistance.textContent = (liveData.distance / 1000).toFixed(1) + 'km';
    if (liveTime) liveTime.textContent = ghostData.formatTime(liveData.time);
    
    // Calculate and show delta
    if (liveData.isConnected && liveData.distance > 0) {
        const ghostTime = ghostData.getTimeAtDistance(liveData.distance);
        const deltaEl = document.getElementById('delta-value');
        
        if (ghostTime !== null && deltaEl) {
            const delta = liveData.time - ghostTime;
            
            if (Math.abs(delta) < 1) {
                deltaEl.textContent = 'Even';
                deltaEl.className = 'delta-value neutral';
            } else if (delta < 0) {
                deltaEl.textContent = `-${ghostData.formatTime(Math.abs(delta))}`;
                deltaEl.className = 'delta-value ahead';
            } else {
                deltaEl.textContent = `+${ghostData.formatTime(delta)}`;
                deltaEl.className = 'delta-value behind';
            }
        }
        
        // Update checkpoint list with live progress
        updateCheckpointList();
    }
}

/**
 * Setup controls
 */
function setupControls() {
    const resetBtn = document.getElementById('reset-btn');
    
    if (!resetBtn) {
        console.warn('Reset button not found - controls may not be available yet');
        return;
    }
    
    resetBtn.addEventListener('click', () => {
        liveData.distance = 0;
        liveData.time = 0;
        liveData.power = 0;
        liveData.startTime = null;
        
        // Reset display elements safely
        const elements = {
            'delta-value': { content: '--', className: 'delta-value' },
            'live-distance': { content: '--' },
            'live-time': { content: '--' }
        };
        
        for (const [id, config] of Object.entries(elements)) {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = config.content;
                if (config.className) el.className = config.className;
            }
        }
        
        // Reset checkpoint list
        const checkpointItems = document.querySelectorAll('.checkpoint-item');
        checkpointItems.forEach(item => {
            const statusEl = item.querySelector('.checkpoint-status');
            if (statusEl) {
                statusEl.textContent = '--';
                statusEl.className = 'checkpoint-status upcoming';
            }
            item.classList.remove('passed', 'current');
        });
        
        showNotification('Comparison reset', 'info');
    });
    
    console.log('✅ Controls setup complete');
}

/**
 * Initialize the ghost rider - CLEAN, NO CONFLICTS
 */
async function initialize() {
    console.log('👻 Initializing Simple Ghost Rider...');
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        await new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve);
        });
    }
    
    try {
        // STEP 1: Try to load ghost data
        const loaded = loadGhostFromStorage();
        
        if (!loaded) {
            console.log('👻 No ghost data found - show loading message');
            showNotification('Load a FIT file in the main map window first, then reload this window', 'warning');
        }
        
        // STEP 2: Setup components
        setupControls();
        
        // STEP 3: Initialize athlete tracking (same as main map)
        await initializeAthleteTracking();
        
        // STEP 4: Setup live tracking (same as main map, no conflicts)
        setupLiveTracking();
        
        // STEP 5: Start update loop
        setInterval(updateDisplay, 1000);
        
        console.log('✅ Simple Ghost Rider initialized (clean, no conflicts)');
        
    } catch (error) {
        console.error('❌ Error initializing Ghost Rider:', error);
        showNotification('Initialization failed: ' + error.message, 'error');
    }
}

/**
 * Debug functions
 */
window.debugGhostRider = function() {
    console.log('👻 Ghost Rider Debug:', {
        ghostLoaded: ghostData?.isLoaded || false,
        ghostDistance: ghostData?.totalDistance || 0,
        ghostTime: ghostData?.totalTime || 0,
        liveConnected: liveData.isConnected,
        liveDistance: liveData.distance,
        liveTime: liveData.time,
        athleteId,
        watchingId,
        inGame
    });
    
    return { ghostData, liveData, athleteId, watchingId, inGame };
};

/**
 * Force reset connection (for troubleshooting)
 */
window.resetConnection = function() {
    console.log('🔧 Force resetting connection...');
    liveData.isConnected = false;
    liveData.startTime = null;
    liveData.distance = 0;
    liveData.time = 0;
    liveData.power = 0;
    showNotification('Connection reset', 'info');
};

/**
 * Main entry point
 */
export async function main() {
    common.initInteractionListeners();
    
    console.log('👻 Starting Clean Ghost Rider (FIXED: no connection spam)...');
    console.log('Debug functions:');
    console.log('- debugGhostRider() - Show current state');
    console.log('- resetConnection() - Force reset if needed');
    console.log('');
    console.log('🎯 FIXED: Stable connection tracking, no spam messages');
    
    try {
        await initialize();
    } catch (error) {
        console.error('Failed to initialize Ghost Rider:', error);
        showNotification('Failed to initialize: ' + error.message, 'error');
    }
}