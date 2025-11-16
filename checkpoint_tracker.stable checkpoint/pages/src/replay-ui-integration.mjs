// replay-ui-integration.mjs - UI Integration for Route Replay

import { RouteReplayManager } from './route-replay-manager.mjs';
import * as locale from '/shared/sauce/locale.mjs';

const H = locale.human;

// Global replay manager instance
let replayManager = null;

/**
 * Initialize replay manager and UI
 */
export function initializeReplay(zwiftMap, checkpointManager) {
    if (!replayManager) {
        replayManager = new RouteReplayManager(zwiftMap, checkpointManager);
        setupReplayUI();
        addReplayStyles();
    }
    return replayManager;
}

/**
 * Load route data into replay manager
 */
export function loadReplayData(routeData) {
    if (!replayManager) {
        console.warn('Replay manager not initialized');
        return false;
    }
    
    const loaded = replayManager.loadHistoricalData(routeData);
    if (loaded) {
        showReplayControls();
        updateReplayInfo();
        showNotification('👻 Ghost rider ready! Click "Start Ghost Rider" to race against your personal best!', 'success');
    }
    return loaded;
}

/**
 * Setup the replay UI controls
 */
function setupReplayUI() {
    // Add replay controls to the checkpoint panel
    const checkpointPanel = document.querySelector('.checkpoint-panel');
    if (!checkpointPanel) {
        console.warn('Checkpoint panel not found for replay UI');
        return;
    }

    // Create replay section
    const replaySection = document.createElement('div');
    replaySection.className = 'replay-section';
    replaySection.innerHTML = `
        <div class="panel-header replay-header">
            <h3>👻 Ghost Rider</h3>
            <div class="replay-main-controls">
                <button class="btn toggle-replay">👻 Start Ghost Rider</button>
            </div>
        </div>
        
        <div class="replay-controls" style="display: none;">
            <div class="replay-progress">
                <div class="progress-bar-container">
                    <div class="progress-bar-bg">
                        <div class="replay-progress-bar" style="width: 0%;"></div>
                    </div>
                    <div class="progress-time">
                        <span class="current-progress-time">0:00</span> / 
                        <span class="total-progress-time">0:00</span>
                    </div>
                </div>
            </div>
            
            <div class="speed-controls">
                <button class="btn speed-btn speed-down" title="Slower">0.5x</button>
                <span class="replay-speed-value">1x</span>
                <button class="btn speed-btn speed-up" title="Faster">2x</button>
            </div>
            
            <div class="replay-stats">
                <div class="stat-row">
                    <div class="stat-item">
                        <div class="stat-label">👻 Time</div>
                        <div class="stat-value historical-time">--:--</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Distance</div>
                        <div class="stat-value historical-distance">0km</div>
                    </div>
                </div>
                <div class="stat-row">
                    <div class="stat-item">
                        <div class="stat-label">👻 Speed</div>
                        <div class="stat-value historical-speed">0kph</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">👻 Power</div>
                        <div class="stat-value historical-power">0w</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="replay-info" style="display: none;">
            <div class="pb-info">
                <div class="pb-title">📊 Personal Best</div>
                <div class="pb-stats">
                    <div class="pb-time">Time: <span class="pb-time-value">--:--</span></div>
                    <div class="pb-distance">Distance: <span class="pb-distance-value">0km</span></div>
                    <div class="pb-avg-speed">Avg Speed: <span class="pb-avg-speed-value">0kph</span></div>
                    <div class="pb-avg-power">Avg Power: <span class="pb-avg-power-value">0w</span></div>
                </div>
            </div>
        </div>
    `;
    
    // Insert before timing info
    const timingInfo = checkpointPanel.querySelector('.timing-info');
    if (timingInfo) {
        checkpointPanel.insertBefore(replaySection, timingInfo);
    } else {
        checkpointPanel.appendChild(replaySection);
    }
    
    // Add event listeners
    setupReplayEventListeners();
}

/**
 * Setup event listeners for replay controls
 */
function setupReplayEventListeners() {
    // Main toggle button
    const toggleBtn = document.querySelector('.toggle-replay');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            if (replayManager) {
                replayManager.toggleReplay();
            }
        });
    }
    
    // Speed controls
    const speedDownBtn = document.querySelector('.speed-down');
    const speedUpBtn = document.querySelector('.speed-up');
    
    if (speedDownBtn) {
        speedDownBtn.addEventListener('click', () => {
            if (replayManager) {
                const currentSpeed = replayManager.replaySpeed;
                replayManager.setReplaySpeed(currentSpeed * 0.5);
            }
        });
    }
    
    if (speedUpBtn) {
        speedUpBtn.addEventListener('click', () => {
            if (replayManager) {
                const currentSpeed = replayManager.replaySpeed;
                replayManager.setReplaySpeed(currentSpeed * 2);
            }
        });
    }
    
    // Progress bar clicking
    const progressBarBg = document.querySelector('.progress-bar-bg');
    if (progressBarBg) {
        progressBarBg.addEventListener('click', (e) => {
            if (!replayManager || !replayManager.historicalData) return;
            
            const rect = progressBarBg.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;
            const targetPosition = Math.floor(percentage * replayManager.historicalData.timePoints.length);
            
            replayManager.seekTo(targetPosition);
        });
    }
}

/**
 * Show replay controls when data is available
 */
function showReplayControls() {
    const replayControls = document.querySelector('.replay-controls');
    const replayInfo = document.querySelector('.replay-info');
    
    if (replayControls) {
        replayControls.style.display = 'block';
    }
    
    if (replayInfo) {
        replayInfo.style.display = 'block';
    }
}

/**
 * Update replay information display
 */
function updateReplayInfo() {
    if (!replayManager || !replayManager.personalBestData) return;
    
    const stats = replayManager.getReplayStats();
    if (!stats) return;
    
    // Update personal best info
    const pbTimeEl = document.querySelector('.pb-time-value');
    const pbDistanceEl = document.querySelector('.pb-distance-value');
    const pbAvgSpeedEl = document.querySelector('.pb-avg-speed-value');
    const pbAvgPowerEl = document.querySelector('.pb-avg-power-value');
    const totalTimeEl = document.querySelector('.total-progress-time');
    
    if (pbTimeEl) pbTimeEl.textContent = H.timer(stats.totalDuration);
    if (pbDistanceEl) pbDistanceEl.textContent = H.distance(stats.totalDistance, {suffix: true});
    if (pbAvgSpeedEl) pbAvgSpeedEl.textContent = H.pace(stats.averageSpeed, {suffix: true});
    if (pbAvgPowerEl) pbAvgPowerEl.textContent = H.power(stats.averagePower, {suffix: true});
    if (totalTimeEl) totalTimeEl.textContent = H.timer(stats.totalDuration);
}

/**
 * Update progress during replay
 */
export function updateReplayProgress() {
    if (!replayManager || !replayManager.replayMode || !replayManager.historicalData) return;
    
    const currentPoint = replayManager.historicalData.timePoints[Math.floor(replayManager.replayPosition)];
    if (!currentPoint) return;
    
    // Update progress bar
    const progressBar = document.querySelector('.replay-progress-bar');
    const currentTimeEl = document.querySelector('.current-progress-time');
    
    if (progressBar) {
        const progress = (replayManager.replayPosition / replayManager.historicalData.timePoints.length) * 100;
        progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    }
    
    if (currentTimeEl) {
        currentTimeEl.textContent = H.timer(currentPoint.time);
    }
}

/**
 * Compare current athlete with ghost rider
 */
export function updateGhostComparison(athleteState) {
    if (!replayManager || !replayManager.replayMode || !athleteState) return;
    
    const comparison = replayManager.compareWithGhost(athleteState);
    if (!comparison) return;
    
    // Update comparison display (you can add UI elements for this)
    const comparisonEl = document.querySelector('.ghost-comparison');
    if (comparisonEl) {
        const statusText = comparison.isAhead ? 
            `🟢 ${H.timer(comparison.timeDifference)} ahead of ghost` :
            `🔴 ${H.timer(comparison.timeDifference)} behind ghost`;
        
        comparisonEl.innerHTML = `
            <div class="comparison-status">${statusText}</div>
            <div class="comparison-stats">
                You: ${H.pace(comparison.athleteSpeed, {suffix: true})} | ${H.power(comparison.athletePower, {suffix: true})}
            </div>
            <div class="comparison-stats">
                👻: ${H.pace(comparison.ghostSpeed, {suffix: true})} | ${H.power(comparison.ghostPower, {suffix: true})}
            </div>
        `;
    }
}

/**
 * Add CSS styles for replay UI
 */
function addReplayStyles() {
    const styles = `
        <style id="replay-styles">
        .replay-section {
            border-top: 1px solid var(--theme-border);
            margin-top: 10px;
        }
        
        .replay-header {
            padding: 12px 15px;
            background: rgba(255, 107, 53, 0.1);
            border-radius: 8px 8px 0 0;
        }
        
        .replay-header h3 {
            margin: 0 0 8px 0;
            color: #ff6b35;
            font-size: 15px;
        }
        
        .replay-main-controls .btn {
            background: #ff6b35;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .replay-main-controls .btn:hover {
            background: #e55a2b;
            transform: translateY(-1px);
        }
        
        .replay-main-controls .btn.active {
            background: #d44a1f;
            animation: ghostPulse 2s infinite;
        }
        
        @keyframes ghostPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        .replay-controls {
            padding: 15px;
            background: rgba(0, 0, 0, 0.1);
            border-radius: 0 0 8px 8px;
        }
        
        .replay-progress {
            margin-bottom: 15px;
        }
        
        .progress-bar-container {
            margin-bottom: 8px;
        }
        
        .progress-bar-bg {
            width: 100%;
            height: 8px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }
        
        .replay-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #ff6b35, #ff8c5a);
            border-radius: 4px;
            transition: width 0.1s ease;
            position: relative;
        }
        
        .replay-progress-bar::after {
            content: '';
            position: absolute;
            top: 0;
            right: 0;
            width: 3px;
            height: 100%;
            background: white;
            border-radius: 2px;
            box-shadow: 0 0 4px rgba(255, 107, 53, 0.8);
        }
        
        .progress-time {
            font-size: 11px;
            color: var(--theme-fg-secondary);
            text-align: center;
            font-family: monospace;
        }
        
        .speed-controls {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 15px;
            padding: 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
        }
        
        .speed-btn {
            background: rgba(255, 107, 53, 0.8);
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .speed-btn:hover {
            background: rgba(255, 107, 53, 1);
            transform: scale(1.05);
        }
        
        .replay-speed-value {
            font-weight: 600;
            color: #ff6b35;
            font-family: monospace;
            min-width: 30px;
            text-align: center;
        }
        
        .replay-stats {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 6px;
            padding: 12px;
        }
        
        .stat-row {
            display: flex;
            gap: 15px;
            margin-bottom: 8px;
        }
        
        .stat-row:last-child {
            margin-bottom: 0;
        }
        
        .stat-item {
            flex: 1;
            text-align: center;
        }
        
        .stat-label {
            font-size: 10px;
            color: var(--theme-fg-secondary);
            margin-bottom: 2px;
            font-weight: 500;
        }
        
        .stat-value {
            font-size: 12px;
            font-weight: 600;
            color: #ff6b35;
            font-family: monospace;
        }
        
        .replay-info {
            padding: 15px;
            background: rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            margin-top: 10px;
        }
        
        .pb-info {
            text-align: center;
        }
        
        .pb-title {
            font-weight: 600;
            color: var(--theme-fg);
            margin-bottom: 10px;
            font-size: 14px;
        }
        
        .pb-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            font-size: 11px;
        }
        
        .pb-stats > div {
            color: var(--theme-fg-secondary);
        }
        
        .pb-stats span {
            color: #ff6b35;
            font-weight: 600;
            font-family: monospace;
        }
        
        /* Ghost rider entity styles */
        .entities .entity.ghost-rider {
            position: absolute;
            width: 14px;
            height: 14px;
            margin-left: -7px;
            margin-top: -7px;
            border-radius: 50%;
            background: rgba(255, 107, 53, 0.8);
            border: 2px solid #ff6b35;
            box-shadow: 0 0 15px rgba(255, 107, 53, 0.6);
            z-index: 150;
            transition: all 0.1s ease;
        }
        
        @keyframes ghostPulse {
            0%, 100% { 
                transform: scale(1);
                opacity: 0.8;
            }
            50% { 
                transform: scale(1.1);
                opacity: 1;
            }
        }
        
        .entities .entity.ghost-rider {
            animation: ghostPulse 2s infinite;
        }
        
        /* Progress line styles */
        .paths .replay-progress-line {
            stroke-width: 3px;
            stroke: #ff6b35;
            fill: none;
            stroke-opacity: 0.8;
            stroke-linecap: round;
            stroke-linejoin: round;
            filter: drop-shadow(0 0 3px rgba(255, 107, 53, 0.4));
            stroke-dasharray: 5, 3;
            animation: progressFlow 2s linear infinite;
        }
        
        @keyframes progressFlow {
            0% { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: 16; }
        }
        
        /* Ghost comparison styles */
        .ghost-comparison {
            background: rgba(255, 107, 53, 0.1);
            border: 1px solid rgba(255, 107, 53, 0.3);
            border-radius: 6px;
            padding: 10px;
            margin: 10px 0;
            font-size: 11px;
        }
        
        .comparison-status {
            font-weight: 600;
            margin-bottom: 5px;
            text-align: center;
        }
        
        .comparison-stats {
            font-size: 10px;
            color: var(--theme-fg-secondary);
            text-align: center;
        }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
            .replay-controls {
                padding: 10px;
            }
            
            .speed-controls {
                gap: 8px;
            }
            
            .stat-row {
                gap: 10px;
            }
            
            .pb-stats {
                grid-template-columns: 1fr;
                gap: 4px;
            }
        }
        </style>
    `;
    
    // Add styles to document head
    if (!document.getElementById('replay-styles')) {
        document.head.insertAdjacentHTML('beforeend', styles);
    }
}

/**
 * Show notification helper
 */
function showNotification(message, type = 'info') {
    // Try to use existing notification system
    if (window.showNotification) {
        window.showNotification(message, type);
        return;
    }
    
    // Fallback notification
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Create simple notification
    const notification = document.createElement('div');
    notification.className = `replay-notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
        color: white;
        padding: 10px 20px;
        border-radius: 6px;
        z-index: 2000;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

/**
 * Integration with main checkpoint tracker
 */
export function integrateWithMainApp(loadRouteFunction) {
    // Wrap the original loadRoute function to add replay functionality
    const originalLoadRoute = loadRouteFunction;
    
    return async function enhancedLoadRoute(jsonData) {
        // Call original load route function
        const result = await originalLoadRoute(jsonData);
        
        // Add replay functionality if telemetry data is available
        if (jsonData && replayManager) {
            const replayLoaded = loadReplayData(jsonData);
            if (replayLoaded) {
                console.log('Replay functionality added to route');
            }
        }
        
        return result;
    };
}

/**
 * Update replay during live athlete tracking
 */
export function handleLiveAthleteUpdate(athleteState) {
    if (!replayManager) return;
    
    // Update replay progress if in replay mode
    updateReplayProgress();
    
    // Update ghost comparison
    updateGhostComparison(athleteState);
}

/**
 * Get current replay manager instance (for debugging)
 */
export function getReplayManager() {
    return replayManager;
}

/**
 * Debug functions for console
 */
if (typeof window !== 'undefined') {
    window.debugReplay = function() {
        if (!replayManager) {
            console.log('Replay manager not initialized');
            return null;
        }
        
        const stats = replayManager.getReplayStats();
        console.log('Replay Manager Status:', {
            hasHistoricalData: !!replayManager.historicalData,
            hasPersonalBest: !!replayManager.personalBestData,
            replayMode: replayManager.replayMode,
            replayPosition: replayManager.replayPosition,
            replaySpeed: replayManager.replaySpeed,
            stats: stats
        });
        
        return replayManager;
    };
    
    window.startGhostRider = function() {
        if (replayManager) {
            return replayManager.toggleReplay();
        }
        console.log('Replay manager not available');
        return false;
    };
    
    window.setGhostSpeed = function(speed) {
        if (replayManager) {
            replayManager.setReplaySpeed(speed);
            console.log(`Ghost speed set to ${speed}x`);
        } else {
            console.log('Replay manager not available');
        }
    };
}