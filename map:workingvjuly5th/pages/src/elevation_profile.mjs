// elevation_profile.mjs - FIXED: Use elevation series markPoint only, never touch mark-points
// PRINCIPLE: Athletes use mark-points series (completely untouched), checkpoints use elevation markPoint

import * as common from '/pages/src/common.mjs';
import * as elevation from '/pages/src/elevation.mjs';
import * as locale from '/shared/sauce/locale.mjs';

// Global state
let worldList;
let elProfile;
let athleteId;
let watchingId;
let inGame = false;
let fitCheckpoints = [];
let watchdog;
let currentRoute = null;

const H = locale.human;

// Settings with proper defaults
common.settingsStore.setDefault({
    profileHeight: 100,
    routeProfile: true,
    showElevationMaxLine: true,
    showCheckpointsOnProfile: true,
    autoRefresh: false,
    refreshRate: 1000,
});

const settings = common.settingsStore.get();

/**
 * FIXED: Enhanced SauceElevationProfile that adds checkpoints to elevation series markPoint ONLY
 * NEVER touches mark-points series - athletes remain completely intact
 */
class SauceChartElevationProfile extends elevation.SauceElevationProfile {
    constructor(options) {
        super(options);
        this.fitCheckpoints = [];
        this.checkpointsVisible = settings.showCheckpointsOnProfile !== false;
        
        console.log('📊 SauceChartElevationProfile created - checkpoints will use elevation markPoint only');
    }
    
    /**
     * Add FIT checkpoints - store them and add to elevation series markPoint
     */
    addFitCheckpoints(checkpoints) {
        console.log(`📊 Adding ${checkpoints.length} FIT checkpoints to elevation markPoint...`);
        
        if (!checkpoints || checkpoints.length === 0) {
            console.warn('No checkpoints to add');
            return;
        }
        
        // Store checkpoints
        this.fitCheckpoints = [...checkpoints];
        
        // Update display using elevation series markPoint
        this.updateCheckpointDisplay();
        
        console.log(`✅ Added ${this.fitCheckpoints.length} checkpoints to elevation markPoint`);
    }
    
    /**
     * FIXED: Add checkpoints to elevation series markPoint (completely isolated from athletes)
     */
    addCheckpointsToElevationSeries() {
        if (!this.chart || this.chart.isDisposed()) {
            console.warn('📊 Chart not ready for checkpoint rendering');
            return;
        }
        
        if (!this._distances || this._distances.length === 0) {
            console.warn('📊 No elevation data available for checkpoint positioning');
            return;
        }
        
        console.log(`📊 Adding ${this.fitCheckpoints.length} checkpoints to elevation series markPoint`);
        
        // Create checkpoint markPoint data for elevation series
        const checkpointMarkPoints = this.fitCheckpoints.map((checkpoint, index) => {
            const distance = checkpoint.distance || 0;
            const isStart = index === 0;
            const isFinish = index === this.fitCheckpoints.length - 1;
            
            // Find the closest position on the elevation profile
            const xIdx = this.findCheckpointPosition(distance);
            if (xIdx === undefined || xIdx < 0 || xIdx >= this._distances.length) {
                console.warn(`📊 Could not find position for checkpoint at ${distance}m`);
                return null;
            }
            
            // Get coordinates using Sauce's elevation data
            const xCoord = this._distances[xIdx];
            const yCoord = this._elevations[xIdx];
            
            // Format time for display
            const timeLabel = this.formatTime(checkpoint.elapsedTime);
            const distanceLabel = (distance / 1000).toFixed(1) + 'km';
            
            let displayName, displayLabel;
            if (isStart) {
                displayName = 'START';
                displayLabel = `START\n${timeLabel}`;
            } else if (isFinish) {
                displayName = 'FINISH'; 
                displayLabel = `FINISH\n${timeLabel}`;
            } else {
                displayName = distanceLabel;
                displayLabel = `${distanceLabel}\n${timeLabel}`;
            }
            
            return {
                name: displayName,
                coord: [xCoord, yCoord],
                value: displayLabel,
                symbol: 'circle',
                symbolSize: isStart || isFinish ? 16 : 12,
                itemStyle: {
                    color: isStart ? '#28a745' : isFinish ? '#dc3545' : '#ff6b35',
                    borderColor: '#ffffff',
                    borderWidth: 3,
                    shadowBlur: 6,
                    shadowColor: 'rgba(0,0,0,0.4)'
                },
                label: {
                    show: true,
                    position: 'top',
                    formatter: displayLabel,
                    fontSize: isStart || isFinish ? 11 : 10,
                    fontWeight: isStart || isFinish ? 'bold' : 'normal',
                    color: '#ffffff',
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    borderRadius: 4,
                    padding: [3, 6],
                    borderColor: 'rgba(255,255,255,0.4)',
                    borderWidth: 1
                },
                // Store checkpoint data for tooltip
                checkpointData: checkpoint
            };
        }).filter(Boolean);
        
        console.log(`📊 Created ${checkpointMarkPoints.length} checkpoint markPoints`);
        
        // Add markPoint to elevation series ONLY
        try {
            this.chart.setOption({
                series: [{
                    id: 'elevation',
                    markPoint: {
                        data: checkpointMarkPoints,
                        tooltip: {
                            trigger: 'item',
                            formatter: params => {
                                const checkpoint = params.data.checkpointData;
                                if (!checkpoint) return params.name;
                                
                                const distance = (checkpoint.distance / 1000).toFixed(1) + 'km';
                                const time = this.formatTime(checkpoint.elapsedTime);
                                const elevation = H.elevation(checkpoint.altitude || 0, {suffix: true});
                                
                                return `${params.name}<br/>Distance: ${distance}<br/>Time: ${time}<br/>Elevation: ${elevation}`;
                            }
                        }
                    }
                }]
            }, {
                // CRITICAL: Use merge mode to avoid affecting other series
                notMerge: false,
                replaceMerge: false,
                lazyUpdate: false
            });
            
            console.log(`✅ Added ${checkpointMarkPoints.length} checkpoints to elevation series markPoint`);
            
        } catch (error) {
            console.error('❌ Error adding checkpoints to elevation series:', error);
        }
    }
    
    /**
     * Helper: Find checkpoint position on elevation profile
     */
    findCheckpointPosition(targetDistance) {
        if (!this._distances || this._distances.length === 0) {
            return undefined;
        }
        
        // Find closest distance index
        let closestIdx = 0;
        let closestDiff = Math.abs(this._distances[0] - targetDistance);
        
        for (let i = 1; i < this._distances.length; i++) {
            const diff = Math.abs(this._distances[i] - targetDistance);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestIdx = i;
            }
        }
        
        return closestIdx;
    }
    
    /**
     * Update checkpoint display using elevation series markPoint
     */
    updateCheckpointDisplay() {
        if (!this.chart || this.chart.isDisposed()) {
            console.warn('📊 Chart not ready for display update');
            return;
        }
        
        if (this.fitCheckpoints.length > 0 && this.checkpointsVisible) {
            console.log('📊 Adding checkpoints to elevation series markPoint');
            this.addCheckpointsToElevationSeries();
        } else {
            console.log('📊 Removing checkpoints from elevation series markPoint');
            this.removeCheckpointsFromElevationSeries();
        }
    }
    
    /**
     * Remove checkpoints from elevation series markPoint
     */
    removeCheckpointsFromElevationSeries() {
        if (!this.chart || this.chart.isDisposed()) {
            return;
        }
        
        try {
            console.log('📊 Removing checkpoints from elevation series markPoint');
            
            // Remove markPoint from elevation series
            this.chart.setOption({
                series: [{
                    id: 'elevation',
                    markPoint: null
                }]
            }, {
                // CRITICAL: Use merge mode to avoid affecting other series
                notMerge: false,
                replaceMerge: false,
                lazyUpdate: false
            });
            
            console.log('✅ Removed checkpoints from elevation series markPoint');
            
        } catch (error) {
            console.error('❌ Error removing checkpoints from elevation series:', error);
        }
    }
    
    /**
     * Format time helper
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
    
    /**
     * Toggle checkpoint visibility with proper settings storage
     */
    toggleCheckpoints(show = null) {
        const shouldShow = show !== null ? show : !this.checkpointsVisible;
        const oldState = this.checkpointsVisible;
        
        this.checkpointsVisible = shouldShow;
        
        // Save settings properly
        const currentSettings = common.settingsStore.get();
        currentSettings.showCheckpointsOnProfile = shouldShow;
        common.settingsStore.set(null, currentSettings);
        
        console.log(`📊 Toggle checkpoints: ${oldState} → ${shouldShow} (${this.fitCheckpoints.length} available)`);
        
        this.updateCheckpointDisplay();
        updateButtonStates();
        
        console.log(`📊 Checkpoints ${shouldShow ? 'shown' : 'hidden'} and settings saved`);
        return shouldShow;
    }
    
    /**
     * Clear all checkpoints from elevation series markPoint
     */
    clearCheckpoints() {
        console.log('🧹 Clearing all checkpoints...');
        
        const previousCount = this.fitCheckpoints.length;
        
        // Clear internal state
        this.fitCheckpoints = [];
        this.checkpointsVisible = false;
        
        // Save settings
        const currentSettings = common.settingsStore.get();
        currentSettings.showCheckpointsOnProfile = false;
        common.settingsStore.set(null, currentSettings);
        
        // Remove checkpoints from elevation series markPoint
        this.removeCheckpointsFromElevationSeries();
        
        console.log(`✅ Cleared ${previousCount} checkpoints from elevation series markPoint`);
    }
}

/**
 * Show notifications
 */
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    if (notification._hideTimeout) {
        clearTimeout(notification._hideTimeout);
    }
    
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    notification.offsetHeight;
    notification.classList.add('show');
    
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    if (type === 'success' || type === 'info') {
        notification._hideTimeout = setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.style.display = 'none';
                notification._hideTimeout = null;
            }, 300);
        }, 3000);
    }
}

/**
 * Create elevation profile using Sauce's existing architecture
 */
function createElevationProfile() {
    const el = document.querySelector('.elevation-container');
    if (!el) {
        console.error('Elevation container not found');
        return null;
    }
    
    try {
        const profile = new SauceChartElevationProfile({
            el, 
            worldList, 
            preferRoute: settings.routeProfile,
            showMaxLine: settings.showElevationMaxLine,
            disableAthletePoints: false, // Athletes work normally - we don't touch them
            refresh: settings.refreshRate
        });
        
        console.log('📊 Elevation profile created - athletes use mark-points (untouched), checkpoints use elevation markPoint');
        showNotification('Elevation profile ready', 'success');
        return profile;
        
    } catch (error) {
        console.error('❌ Error creating elevation profile:', error);
        showNotification('Failed to create elevation profile: ' + error.message, 'error');
        return null;
    }
}

/**
 * Initialize athlete tracking
 */
async function initializeAthleteTracking() {
    try {
        console.log('🏃 Initializing athlete tracking...');
        
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
            if (elProfile && elProfile.setAthlete) {
                elProfile.setAthlete(athleteId);
            }
            console.log('✅ Self athlete ID:', athleteId);
        }
        
        let watchingData;
        try {
            watchingData = await common.rpc.getAthleteData('watching');
        } catch (error) {
            console.warn('Could not get watching athlete data:', error);
            watchingData = null;
        }
        
        if (watchingData?.athleteId) {
            watchingId = watchingData.athleteId;
            if (elProfile && elProfile.setWatching) {
                elProfile.setWatching(watchingId);
            }
            console.log('👀 Watching athlete ID:', watchingId);
        } else if (athleteId) {
            watchingId = athleteId;
            if (elProfile && elProfile.setWatching) {
                elProfile.setWatching(watchingId);
            }
            console.log('👀 Watching self:', watchingId);
        }
        
        console.log('✅ Athlete tracking initialized');
        
    } catch (error) {
        console.error('❌ Error initializing athlete tracking:', error);
        showNotification('Error initializing athlete tracking: ' + error.message, 'error');
    }
}

/**
 * Load checkpoints from localStorage
 */
async function loadCheckpointsFromStorage() {
    try {
        console.log('📍 Loading checkpoints from localStorage...');
        
        const storedData = localStorage.getItem('ghostRiderData');
        
        if (!storedData) {
            console.log('📍 No checkpoint data found in localStorage');
            showNotification('No checkpoint data found - load a FIT file in main map first', 'warning');
            return false;
        }
        
        const parsedData = JSON.parse(storedData);
        const checkpointCount = parsedData.checkpoints?.length || 0;
        
        if (checkpointCount === 0) {
            console.log('📍 No checkpoints in stored data');
            showNotification('No valid checkpoints in stored data', 'warning');
            return false;
        }
        
        console.log(`📍 Found ${checkpointCount} checkpoints in localStorage`);
        
        // Ensure elevation profile is ready
        if (!elProfile) {
            console.warn('📊 Elevation profile not initialized yet, retrying...');
            setTimeout(() => loadCheckpointsFromStorage(), 500);
            return false;
        }
        
        // Clear existing checkpoints first
        if (elProfile.clearCheckpoints) {
            elProfile.clearCheckpoints();
        }
        
        // Load the new checkpoints
        fitCheckpoints = [...parsedData.checkpoints];
        currentRoute = parsedData;
        
        // Add checkpoints to elevation profile
        try {
            if (elProfile.addFitCheckpoints) {
                elProfile.addFitCheckpoints(fitCheckpoints);
                console.log(`✅ Successfully added checkpoints to elevation markPoint`);
            }
            
            // Load visibility state from settings and auto-show if enabled
            const currentSettings = common.settingsStore.get();
            if (currentSettings.showCheckpointsOnProfile !== false) {
                if (elProfile.toggleCheckpoints) {
                    elProfile.toggleCheckpoints(true);
                    console.log('📍 Auto-showing checkpoints (setting enabled or default)');
                } else {
                    // Fallback: set visibility directly
                    elProfile.checkpointsVisible = true;
                    elProfile.updateCheckpointDisplay();
                    console.log('📍 Auto-showing checkpoints (fallback method)');
                }
            }
            
            // Update UI state
            updateButtonStates();
            
            showNotification(`✅ Loaded ${elProfile.fitCheckpoints.length} checkpoints`, 'success');
            
            console.log(`✅ [SUCCESS] Loaded ${elProfile.fitCheckpoints.length} checkpoints successfully`);
            return true;
            
        } catch (addError) {
            console.error('❌ Error adding checkpoints to elevation profile:', addError);
            showNotification('Error displaying checkpoints on elevation profile', 'error');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error loading from localStorage:', error);
        showNotification('Error loading checkpoint data: ' + error.message, 'error');
        return false;
    }
}

/**
 * Update button states with proper settings sync
 */
function updateButtonStates() {
    const toggleBtn = document.getElementById('toggle-checkpoints-btn');
    const clearBtn = document.getElementById('clear-btn');
    
    // Get state from elevation profile AND settings
    const checkpointCount = elProfile?.fitCheckpoints?.length || 0;
    const isVisible = elProfile?.checkpointsVisible || false;
    const currentSettings = common.settingsStore.get();
    const settingsVisible = currentSettings.showCheckpointsOnProfile !== false; // Default to true
    
    console.log(`🎮 Updating button states: ${checkpointCount} checkpoints, visible=${isVisible}, settings=${settingsVisible}`);
    
    if (toggleBtn) {
        const hasCheckpoints = checkpointCount > 0;
        
        toggleBtn.disabled = !hasCheckpoints;
        
        // Update visual state based on actual visibility
        if (hasCheckpoints && isVisible) {
            toggleBtn.classList.add('active');
            toggleBtn.style.backgroundColor = 'rgba(0, 123, 255, 0.9)';
            toggleBtn.style.borderColor = 'rgba(0, 123, 255, 1)';
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.style.backgroundColor = '';
            toggleBtn.style.borderColor = '';
        }
        
        // Update tooltip
        toggleBtn.title = hasCheckpoints ? 
            (isVisible ? 'Hide FIT checkpoints' : 'Show FIT checkpoints') : 
            'No checkpoints loaded';
            
        console.log(`🎮 Toggle button: ${hasCheckpoints ? 'enabled' : 'disabled'}, ${isVisible ? 'active' : 'inactive'}`);
    }
    
    if (clearBtn) {
        const hasCheckpoints = checkpointCount > 0;
        clearBtn.disabled = !hasCheckpoints;
        clearBtn.title = hasCheckpoints ? 'Clear FIT checkpoints' : 'No checkpoints to clear';
        
        console.log(`🎮 Clear button: ${hasCheckpoints ? 'enabled' : 'disabled'}`);
    }
}

/**
 * Setup controls with proper event handling and settings storage
 */
function setupControls() {
    console.log('🎮 Setting up controls...');
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachEventListeners);
    } else {
        attachEventListeners();
    }
    
    function attachEventListeners() {
        console.log('🎮 Attaching event listeners...');
        
        // Refresh button
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async function(e) {
                e.preventDefault();
                console.log('🔄 Refresh button clicked');
                
                refreshBtn.textContent = '⏳';
                refreshBtn.disabled = true;
                
                try {
                    const loaded = await loadCheckpointsFromStorage();
                    if (loaded) {
                        console.log('✅ Checkpoints refreshed successfully');
                    }
                } catch (error) {
                    console.error('❌ Error during refresh:', error);
                    showNotification('Error during refresh: ' + error.message, 'error');
                } finally {
                    refreshBtn.textContent = '🔄';
                    refreshBtn.disabled = false;
                }
            });
            console.log('✅ Refresh button listener attached');
        }
        
        // Toggle button
        const toggleBtn = document.getElementById('toggle-checkpoints-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('📍 Toggle button clicked');
                
                const checkpointCount = elProfile?.fitCheckpoints?.length || 0;
                console.log(`📍 Current state: ${checkpointCount} checkpoints, visible=${elProfile?.checkpointsVisible}`);
                
                if (checkpointCount === 0) {
                    showNotification('No checkpoints to toggle - click refresh first', 'warning');
                    return;
                }
                
                if (elProfile && elProfile.toggleCheckpoints) {
                    try {
                        const visible = elProfile.toggleCheckpoints();
                        updateButtonStates();
                        showNotification(`Checkpoints ${visible ? 'shown' : 'hidden'}`, 'info');
                        console.log(`📍 Toggle result: ${visible} (${checkpointCount} checkpoints) - settings saved`);
                    } catch (error) {
                        console.error('❌ Error toggling checkpoints:', error);
                        showNotification('Error toggling checkpoints', 'error');
                    }
                } else {
                    console.error('❌ Toggle function not available');
                    showNotification('Toggle function not available', 'error');
                }
            });
            console.log('✅ Toggle button listener attached');
        }
        
        // Clear button
        const clearBtn = document.getElementById('clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('🗑️ Clear button clicked');
                
                const checkpointCount = elProfile?.fitCheckpoints?.length || 0;
                
                if (checkpointCount === 0) {
                    showNotification('No checkpoints to clear', 'info');
                    return;
                }
                
                if (elProfile && elProfile.clearCheckpoints) {
                    try {
                        elProfile.clearCheckpoints();
                        fitCheckpoints = [];
                        currentRoute = null;
                        
                        // Clear localStorage
                        try {
                            localStorage.removeItem('ghostRiderData');
                            console.log('🧹 Cleared localStorage');
                        } catch (error) {
                            console.warn('Could not clear localStorage:', error);
                        }
                        
                        updateButtonStates();
                        showNotification('Checkpoints cleared', 'info');
                        console.log(`🗑️ Cleared ${checkpointCount} checkpoints and saved settings`);
                    } catch (error) {
                        console.error('❌ Error clearing checkpoints:', error);
                        showNotification('Error clearing checkpoints', 'error');
                    }
                } else {
                    console.error('❌ Clear function not available');
                    showNotification('Clear function not available', 'error');
                }
            });
            console.log('✅ Clear button listener attached');
        }
        
        // Initial button state update
        updateButtonStates();
        console.log('✅ All event listeners attached successfully');
    }
}

/**
 * Setup localStorage watcher for cross-window synchronization
 */
function setupStorageWatcher() {
    console.log('📡 Setting up localStorage watcher for cross-window sync...');
    
    // Listen for storage events (when other windows modify localStorage)
    window.addEventListener('storage', function(e) {
        if (e.key === 'ghostRiderData') {
            console.log('📡 Detected localStorage change from other window');
            
            if (e.newValue) {
                console.log('📡 New checkpoint data detected, auto-loading...');
                setTimeout(async () => {
                    try {
                        await loadCheckpointsFromStorage();
                    } catch (error) {
                        console.error('❌ Error auto-loading checkpoints:', error);
                    }
                }, 100);
            } else {
                console.log('📡 Checkpoint data was cleared in other window');
                if (elProfile && elProfile.clearCheckpoints) {
                    elProfile.clearCheckpoints();
                    fitCheckpoints = [];
                    currentRoute = null;
                    updateButtonStates();
                }
            }
        }
    });
    
    console.log('✅ localStorage watcher setup complete');
}

/**
 * Setup live tracking
 */
function setupLiveTracking() {
    console.log('📡 Setting up live tracking...');
    
    const watchdogInterval = setInterval(() => {
        if (inGame && performance.now() - (watchdog || 0) > 10000) {
            console.warn("🐕 Watchdog triggered - game connection lost");
            inGame = false;
            initializeAthleteTracking();
        }
    }, 5000);
    
    try {
        common.subscribe('states', async (states) => {
            if (!states?.length) return;
            
            watchdog = performance.now();
            
            if (!inGame) {
                inGame = true;
                console.log('🎮 Game connection established');
                await initializeAthleteTracking();
            }
            
            // Let elevation profile handle athlete rendering normally - we don't interfere at all
            if (elProfile && elProfile.renderAthleteStates) {
                try {
                    await elProfile.renderAthleteStates(states);
                } catch (error) {
                    console.warn('❌ Error rendering athlete states:', error);
                }
            }
        });
        
        common.subscribe('watching-athlete-change', async (newWatchingId) => {
            if (newWatchingId && !isNaN(newWatchingId)) {
                watchingId = newWatchingId;
                
                if (elProfile && elProfile.setWatching) {
                    elProfile.setWatching(watchingId);
                }
                
                console.log('👀 Now watching athlete:', watchingId);
                showNotification(`Now tracking athlete: ${newWatchingId}`, 'info');
            }
        });
        
        console.log('✅ Live tracking setup complete');
        
        window.addEventListener('beforeunload', () => {
            clearInterval(watchdogInterval);
        });
        
    } catch (error) {
        console.error('❌ Error setting up live tracking:', error);
        showNotification('Error connecting to Zwift: ' + error.message, 'error');
    }
}

/**
 * Initialize the application
 */
async function initialize() {
    console.log('📊 Initializing Elevation Profile...');
    
    try {
        // Get world list
        try {
            worldList = await common.getWorldList();
            console.log(`📍 Loaded ${worldList?.length || 0} worlds`);
        } catch (error) {
            console.warn('Could not load world list:', error);
            worldList = [];
        }
        
        // Create elevation profile using Sauce architecture
        elProfile = createElevationProfile();
        
        if (elProfile) {
            // Setup components
            await initializeAthleteTracking();
            setupLiveTracking();
            setupControls();
            setupStorageWatcher();
            
            // Try to load existing checkpoint data
            setTimeout(async () => {
                try {
                    await loadCheckpointsFromStorage();
                } catch (error) {
                    console.warn('❌ Error loading initial checkpoint data:', error);
                }
            }, 500);
            
            console.log('✅ Elevation Profile initialized - athletes and checkpoints completely isolated');
            showNotification('📊 Elevation profile ready!', 'success');
        } else {
            showNotification('Failed to create elevation profile', 'error');
        }
        
    } catch (error) {
        console.error('❌ Error initializing Elevation Profile:', error);
        showNotification('Initialization failed: ' + error.message, 'error');
    }
}

/**
 * Debug functions
 */
window.debugElevationProfile = function() {
    const currentSettings = common.settingsStore.get();
    
    console.log('📊 Elevation Profile Debug (FIXED - NO MARK-POINTS INTERFERENCE):', {
        profileExists: !!elProfile,
        chartReady: elProfile?.chart ? 'ready' : 'not ready',
        athleteId,
        watchingId,
        inGame,
        
        // Internal state
        internalCheckpoints: elProfile?.fitCheckpoints?.length || 0,
        globalCheckpoints: fitCheckpoints.length,
        checkpointsVisible: elProfile?.checkpointsVisible,
        
        // Settings state
        settingsVisible: currentSettings.showCheckpointsOnProfile,
        allSettings: currentSettings,
        
        // Storage state
        hasStorageData: !!localStorage.getItem('ghostRiderData'),
        currentRoute: !!currentRoute,
        
        // FIXED architecture
        checkpointLocation: 'elevation series markPoint (completely isolated)',
        athleteLocation: 'mark-points series (completely untouched)',
        interference: 'NONE - zero conflicts!'
    });
    
    return { elProfile, athleteId, watchingId, inGame, fitCheckpoints, currentRoute, settings: currentSettings };
};

/**
 * Main entry point
 */
export async function main() {
    common.initInteractionListeners();
    
    console.log('📊 Starting FIXED Elevation Profile...');
    console.log('🔧 FIXED: Athletes use mark-points series (completely untouched)');
    console.log('🔧 FIXED: Checkpoints use elevation series markPoint (completely isolated)');
    console.log('🔧 FIXED: Zero interference - athletes stay as proper pins, no yellow dots!');
    console.log('');
    console.log('Debug: debugElevationProfile()');
    
    try {
        await initialize();
    } catch (error) {
        console.error('Failed to initialize:', error);
        showNotification('Failed to initialize: ' + error.message, 'error');
    }
}