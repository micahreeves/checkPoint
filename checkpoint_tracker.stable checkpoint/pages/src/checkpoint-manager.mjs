// checkpoint-manager.mjs - Checkpoint Management Module (FIXED)

import * as locale from '/shared/sauce/locale.mjs';
import * as common from '/pages/src/common.mjs';

const H = locale.human;

export class CheckpointManager {
    constructor(settings = {}) {
        this.checkpoints = [];
        this.startTime = null;
        this.segmentTimes = [];
        this.settings = settings || {};
        this.zwiftMap = null;
    }

    setMap(zwiftMap) {
        this.zwiftMap = zwiftMap;
    }

    /**
     * Load checkpoints from parsed data - FIXED
     */
    async loadCheckpointsFromData(checkpointData, routeData = null) {
        this.checkpoints = [];
        
        if (!checkpointData || !Array.isArray(checkpointData)) {
            console.warn('No valid checkpoint data provided');
            return this.checkpoints;
        }
        
        for (const [index, cp] of checkpointData.entries()) {
            try {
                // Null safety checks
                if (!cp || typeof cp !== 'object') {
                    console.warn(`Invalid checkpoint at index ${index}:`, cp);
                    continue;
                }

                let checkpointCoords = cp.coordinates;
                
                // Ensure coordinates are valid
                if (!Array.isArray(checkpointCoords) || checkpointCoords.length < 2) {
                    console.warn(`Invalid coordinates for checkpoint ${index}:`, checkpointCoords);
                    checkpointCoords = [0, 0]; // Default fallback
                } else {
                    // Validate coordinate values
                    const [x, y] = checkpointCoords;
                    if (x === null || x === undefined || y === null || y === undefined || 
                        isNaN(x) || isNaN(y)) {
                        console.warn(`Invalid coordinate values for checkpoint ${index}:`, checkpointCoords);
                        checkpointCoords = [0, 0]; // Default fallback
                    }
                }
                
                const checkpoint = {
                    id: Date.now() + index,
                    name: cp.name || `Checkpoint ${index + 1}`,
                    coordinates: checkpointCoords,
                    distance: (typeof cp.distance === 'number' && !isNaN(cp.distance)) ? cp.distance : 0,
                    altitude: (typeof cp.altitude === 'number' && !isNaN(cp.altitude)) ? cp.altitude : 0,
                    completed: false,
                    time: null,
                    type: cp.type || 'checkpoint',
                    index: (typeof cp.index === 'number' && !isNaN(cp.index)) ? cp.index : index,
                    active: false
                };
                
                this.checkpoints.push(checkpoint);
                
                // Add to map if available
                if (this.zwiftMap) {
                    try {
                        this.addCheckpointToMap(checkpoint);
                    } catch (error) {
                        console.warn(`Error adding checkpoint ${index} to map:`, error);
                    }
                }
            } catch (error) {
                console.warn(`Error loading checkpoint ${index}:`, error);
            }
        }
        
        console.log(`Loaded ${this.checkpoints.length} checkpoints`);
        return this.checkpoints;
    }

    /**
     * Add checkpoint at specific coordinates - FIXED
     */
    async addCheckpoint(coordinates, name = null) {
        // Validate coordinates
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            throw new Error('Invalid coordinates provided');
        }

        const [x, y] = coordinates;
        if (x === null || x === undefined || y === null || y === undefined || 
            isNaN(x) || isNaN(y)) {
            throw new Error('Invalid coordinate values');
        }

        const checkpoint = {
            id: Date.now(),
            name: name || `Checkpoint ${this.checkpoints.length + 1}`,
            coordinates: [x, y],
            distance: 0, // Could calculate from route data if available
            completed: false,
            time: null,
            active: false,
            type: 'manual'
        };
        
        this.checkpoints.push(checkpoint);
        
        if (this.zwiftMap) {
            try {
                this.addCheckpointToMap(checkpoint);
            } catch (error) {
                console.warn('Error adding checkpoint to map:', error);
                // Don't throw here, checkpoint is still valid
            }
        }
        
        return checkpoint;
    }

    /**
     * Add checkpoint at current athlete position - FIXED
     */
    async addCheckpointAtCurrentPosition(watchingId, athleteId) {
        try {
            const athleteData = await common.rpc.getAthleteData(watchingId || athleteId || 'self');
            if (!athleteData || !athleteData.state) {
                throw new Error('No athlete position available');
            }

            const state = athleteData.state;
            if (state.x === null || state.x === undefined || state.y === null || state.y === undefined ||
                isNaN(state.x) || isNaN(state.y)) {
                throw new Error('Invalid athlete position coordinates');
            }
            
            const checkpoint = await this.addCheckpoint(
                [state.x, state.y],
                `Checkpoint ${this.checkpoints.length + 1}`
            );
            
            checkpoint.distance = (typeof state.distance === 'number' && !isNaN(state.distance)) ? state.distance : 0;
            
            return checkpoint;
            
        } catch (error) {
            console.error('Error adding checkpoint:', error);
            throw error;
        }
    }

    /**
     * Add checkpoint visual to map - FIXED
     */
    addCheckpointToMap(checkpoint) {
        if (!this.zwiftMap) {
            console.warn('No map available for checkpoint');
            return;
        }

        if (!checkpoint || !checkpoint.coordinates || !Array.isArray(checkpoint.coordinates) || 
            checkpoint.coordinates.length < 2) {
            console.warn('Invalid checkpoint for map:', checkpoint);
            return;
        }
        
        try {
            const entity = this.zwiftMap.addPoint(checkpoint.coordinates, 'checkpoint');
            if (!entity || !entity.el) {
                console.warn('Failed to create map entity for checkpoint');
                return;
            }

            entity.el.dataset.checkpointId = checkpoint.id;
            entity.el.classList.add('checkpoint');
            
            // Add type-specific classes
            if (checkpoint.type) {
                entity.el.classList.add(checkpoint.type);
            }
            
            // Store reference
            checkpoint.mapEntity = entity;
            
            // Hide if checkpoints are disabled
            if (!this.settings.showCheckpoints) {
                entity.toggleHidden(true);
            }
        } catch (error) {
            console.warn('Error adding checkpoint to map:', error);
        }
    }

    /**
     * Check if athlete has reached any checkpoint - FIXED
     */
    checkCheckpointProgress(athleteState) {
        if (!athleteState || this.checkpoints.length === 0) {
            return { reached: false };
        }

        // Validate athlete state
        if (athleteState.x === null || athleteState.x === undefined || 
            athleteState.y === null || athleteState.y === undefined ||
            isNaN(athleteState.x) || isNaN(athleteState.y)) {
            console.warn('Invalid athlete state coordinates:', athleteState);
            return { reached: false };
        }
        
        const athletePos = [athleteState.x, athleteState.y];
        const currentTime = Date.now();
        const checkpointRadius = this.settings.checkpointRadius || 50;
        
        // Initialize start time on first movement
        if (!this.startTime && (athleteState.speed || 0) > 0) {
            this.startTime = currentTime;
            console.log('Checkpoint timing started');
        }
        
        let activeCheckpoint = null;
        let checkpointReached = false;
        let reachedCheckpoint = null;
        
        // Check each incomplete checkpoint
        this.checkpoints.forEach(checkpoint => {
            if (!checkpoint || !checkpoint.coordinates || !Array.isArray(checkpoint.coordinates) ||
                checkpoint.coordinates.length < 2) {
                return; // Skip invalid checkpoints
            }

            const wasActive = checkpoint.active;
            checkpoint.active = false;
            
            if (checkpoint.completed) return;
            
            // Calculate distance to checkpoint
            let distance;
            try {
                const [cpX, cpY] = checkpoint.coordinates;
                if (cpX === null || cpX === undefined || cpY === null || cpY === undefined ||
                    isNaN(cpX) || isNaN(cpY)) {
                    console.warn('Invalid checkpoint coordinates:', checkpoint.coordinates);
                    return;
                }

                distance = Math.sqrt(
                    Math.pow(athletePos[0] - cpX, 2) +
                    Math.pow(athletePos[1] - cpY, 2)
                );
            } catch (error) {
                console.warn('Error calculating distance to checkpoint:', error);
                return;
            }
            
            // Check if within radius
            if (distance <= checkpointRadius) {
                if (!checkpoint.completed) {
                    // Checkpoint reached!
                    checkpoint.completed = true;
                    checkpoint.time = this.startTime ? currentTime - this.startTime : 0;
                    checkpointReached = true;
                    reachedCheckpoint = checkpoint;
                    
                    // Update visual state
                    if (checkpoint.mapEntity && checkpoint.mapEntity.el) {
                        checkpoint.mapEntity.el.classList.add('completed');
                        checkpoint.mapEntity.el.classList.remove('active');
                    }
                    
                    // Add to segment times
                    this.segmentTimes.push({
                        checkpoint: checkpoint.name,
                        time: checkpoint.time,
                        totalTime: currentTime - (this.startTime || currentTime)
                    });
                    
                    console.log(`Checkpoint reached: ${checkpoint.name} in ${H.timer(checkpoint.time / 1000)}`);
                }
            } else {
                // Find the next closest checkpoint to mark as active
                if (!activeCheckpoint || distance < activeCheckpoint.distance) {
                    activeCheckpoint = { checkpoint, distance };
                }
            }
            
            // Update map entity active state
            if (checkpoint.mapEntity && checkpoint.mapEntity.el && wasActive !== checkpoint.active) {
                checkpoint.mapEntity.el.classList.toggle('active', checkpoint.active);
            }
        });
        
        // Mark the closest incomplete checkpoint as active
        if (activeCheckpoint && !activeCheckpoint.checkpoint.completed) {
            activeCheckpoint.checkpoint.active = true;
            if (activeCheckpoint.checkpoint.mapEntity && activeCheckpoint.checkpoint.mapEntity.el) {
                activeCheckpoint.checkpoint.mapEntity.el.classList.add('active');
            }
        }
        
        return {
            reached: checkpointReached,
            checkpoint: reachedCheckpoint,
            activeCheckpoint: activeCheckpoint?.checkpoint
        };
    }

    /**
     * Delete a checkpoint - FIXED
     */
    deleteCheckpoint(checkpointId) {
        const index = this.checkpoints.findIndex(cp => cp && cp.id === checkpointId);
        if (index === -1) return false;
        
        const checkpoint = this.checkpoints[index];
        if (checkpoint && checkpoint.mapEntity && this.zwiftMap) {
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
     * Clear all checkpoints - FIXED
     */
    clearCheckpoints() {
        this.checkpoints.forEach(cp => {
            if (cp && cp.mapEntity && this.zwiftMap) {
                try {
                    this.zwiftMap.removeEntity(cp.mapEntity);
                } catch (error) {
                    console.warn('Error removing checkpoint from map:', error);
                }
            }
        });
        
        this.checkpoints = [];
        this.resetTiming();
        return true;
    }

    /**
     * Toggle checkpoint visibility - FIXED
     */
    toggleCheckpointVisibility(show) {
        this.checkpoints.forEach(cp => {
            if (cp && cp.mapEntity) {
                try {
                    cp.mapEntity.toggleHidden(!show);
                } catch (error) {
                    console.warn('Error toggling checkpoint visibility:', error);
                }
            }
        });
    }

    /**
     * Reset timing information - FIXED
     */
    resetTiming() {
        this.startTime = null;
        this.segmentTimes = [];
        
        this.checkpoints.forEach(cp => {
            if (cp) {
                cp.completed = false;
                cp.active = false;
                cp.time = null;
                if (cp.mapEntity && cp.mapEntity.el) {
                    try {
                        cp.mapEntity.el.classList.remove('completed', 'active');
                    } catch (error) {
                        console.warn('Error resetting checkpoint visuals:', error);
                    }
                }
            }
        });
        
        console.log('Checkpoint timing reset');
    }

    /**
     * Get timing information - FIXED
     */
    getTimingInfo() {
        if (!this.startTime) {
            return {
                totalTime: 0,
                segmentTime: 0,
                hasStarted: false,
                completedCheckpoints: 0
            };
        }
        
        const currentTime = Date.now();
        const totalElapsed = currentTime - this.startTime;
        
        // Find current segment (time since last completed checkpoint)
        const completedCheckpoints = this.checkpoints.filter(cp => cp && cp.completed);
        const lastCompleted = completedCheckpoints
            .sort((a, b) => (b.time || 0) - (a.time || 0))[0];
        
        let segmentTime = totalElapsed;
        if (lastCompleted && typeof lastCompleted.time === 'number') {
            segmentTime = totalElapsed - lastCompleted.time;
        }
        
        return {
            totalTime: totalElapsed,
            segmentTime: segmentTime,
            hasStarted: true,
            completedCheckpoints: completedCheckpoints.length
        };
    }

    /**
     * Get checkpoint statistics - FIXED
     */
    getStats() {
        const total = this.checkpoints.length;
        const completed = this.checkpoints.filter(cp => cp && cp.completed).length;
        const remaining = total - completed;
        
        return {
            total,
            completed,
            remaining,
            completionRate: total > 0 ? completed / total : 0
        };
    }

    /**
     * Export checkpoint data - FIXED
     */
    exportCheckpoints() {
        return {
            checkpoints: this.checkpoints.map(cp => {
                if (!cp) return null;
                return {
                    name: cp.name || 'Unnamed',
                    coordinates: cp.coordinates || [0, 0],
                    distance: cp.distance || 0,
                    altitude: cp.altitude || 0,
                    type: cp.type || 'checkpoint',
                    completed: !!cp.completed,
                    time: cp.time || null
                };
            }).filter(cp => cp !== null),
            timing: {
                startTime: this.startTime,
                segmentTimes: this.segmentTimes || []
            },
            stats: this.getStats()
        };
    }
}