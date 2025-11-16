// fit-route-loader.mjs - FIT File Route Display Module

import * as locale from '/shared/sauce/locale.mjs';

const H = locale.human;

// Zwift world coordinate conversion metadata
const WORLD_METAS = {
    Watopia: { latOffset: -11.624742, lonOffset: 166.951984, latDegDist: 111.2, lonDegDist: 92.7, flippedHack: false },
    Richmond: { latOffset: 37.544214, lonOffset: -77.451665, latDegDist: 111.2, lonDegDist: 85.0, flippedHack: false },
    London: { latOffset: 51.495685, lonOffset: -0.134064, latDegDist: 111.2, lonDegDist: 67.6, flippedHack: false },
    New_York: { latOffset: 40.783186, lonOffset: -73.964273, latDegDist: 111.2, lonDegDist: 84.5, flippedHack: false },
    Innsbruck: { latOffset: 47.269256, lonOffset: 11.399314, latDegDist: 111.2, lonDegDist: 74.3, flippedHack: false },
    Yorkshire: { latOffset: 53.832104, lonOffset: -1.777247, latDegDist: 111.2, lonDegDist: 68.1, flippedHack: false },
    Bologna: { latOffset: 44.494887, lonOffset: 11.342616, latDegDist: 111.2, lonDegDist: 81.0, flippedHack: false },
    Crit_City: { latOffset: 36.847875, lonOffset: -76.291658, latDegDist: 111.2, lonDegDist: 87.0, flippedHack: false },
    France: { latOffset: 43.860636, lonOffset: 4.426995, latDegDist: 111.2, lonDegDist: 80.6, flippedHack: false },
    Paris: { latOffset: 48.869783, lonOffset: 2.307063, latDegDist: 111.2, lonDegDist: 81.8, flippedHack: false },
    Makuri_Islands: { latOffset: 35.462464, lonOffset: 139.430939, latDegDist: 111.2, lonDegDist: 89.1, flippedHack: false },
    Scotland: { latOffset: 57.568982, lonOffset: -4.430073, latDegDist: 111.2, lonDegDist: 77.3, flippedHack: false }
};

export class FitRouteLoader {
    constructor(zwiftMap) {
        this.zwiftMap = zwiftMap;
        this.currentRoute = null;
        this.checkpoints = [];
        this.routeData = null;
        this.detectedWorld = null;
        
        this.settings = {
            routeColor: '#ff6b35',
            routeWidth: 4,
            checkpointInterval: 1000, // meters
            showCheckpoints: true
        };
    }

    /**
     * Load route from parsed FIT data
     * Expects data in format: { records: [...] } where each record has position_lat, position_long, etc.
     */
    loadFromParsedData(parsedFitData) {
        try {
            console.log('🗺️ Loading FIT route from parsed data...');
            
            if (!parsedFitData || !parsedFitData.records || !Array.isArray(parsedFitData.records)) {
                throw new Error('Invalid FIT data - expected { records: [...] }');
            }

            // Clear existing route
            this.clearRoute();

            // Extract coordinates and telemetry
            const routeData = this.extractRouteData(parsedFitData.records);
            
            if (routeData.coordinates.length === 0) {
                throw new Error('No valid coordinates found in FIT data');
            }

            this.routeData = routeData;

            // Detect which world this route is from
            this.detectedWorld = this.detectWorld(routeData.coordinates);
            console.log(`🌍 Detected world: ${this.detectedWorld || 'Unknown'}`);

            // Convert GPS coordinates to Zwift coordinates
            const zwiftCoordinates = this.convertToZwiftCoordinates(routeData.coordinates);

            if (zwiftCoordinates.length === 0) {
                throw new Error('No valid Zwift coordinates after conversion');
            }

            // Create highlighted path on map
            this.createHighlightedPath(zwiftCoordinates);

            // Generate and add checkpoints
            if (this.settings.showCheckpoints) {
                this.generateCheckpoints(zwiftCoordinates, routeData.telemetry);
            }

            // Fit map to route
            this.fitMapToRoute(zwiftCoordinates);

            console.log(`✅ FIT route loaded with ${routeData.coordinates.length} points`);
            
            return {
                success: true,
                pointCount: routeData.coordinates.length,
                distance: routeData.totalDistance,
                duration: routeData.duration,
                checkpointCount: this.checkpoints.length,
                world: this.detectedWorld
            };

        } catch (error) {
            console.error('❌ Error loading FIT route:', error);
            throw error;
        }
    }

    /**
     * Detect which Zwift world this route belongs to based on GPS coordinates
     */
    detectWorld(coordinates) {
        if (!coordinates || coordinates.length === 0) return null;
        
        // Take a sample of coordinates from the middle of the route
        const sampleSize = Math.min(10, coordinates.length);
        const startIdx = Math.floor((coordinates.length - sampleSize) / 2);
        const sampleCoords = coordinates.slice(startIdx, startIdx + sampleSize);
        
        let bestMatch = null;
        let smallestDistance = Infinity;
        
        for (const [worldName, meta] of Object.entries(WORLD_METAS)) {
            let totalDistance = 0;
            
            for (const coord of sampleCoords) {
                const [lat, lng] = coord;
                const distance = Math.sqrt(
                    Math.pow(lat - meta.latOffset, 2) + 
                    Math.pow(lng - meta.lonOffset, 2)
                );
                totalDistance += distance;
            }
            
            const avgDistance = totalDistance / sampleCoords.length;
            
            if (avgDistance < smallestDistance) {
                smallestDistance = avgDistance;
                bestMatch = worldName;
            }
        }
        
        // Only return a match if it's reasonably close (within ~1 degree)
        return smallestDistance < 1.0 ? bestMatch : null;
    }

    /**
     * Extract coordinates and telemetry from FIT records
     * Assumes data is already parsed (semicircles converted to decimal degrees)
     */
    extractRouteData(records) {
        const coordinates = [];
        const telemetry = {
            timestamps: [],
            distances: [],
            speeds: [],
            altitudes: [],
            heartRates: [],
            powers: []
        };

        let lastValidCoord = null;
        let totalPoints = 0;
        let skippedPoints = 0;
        let zeroCoordCount = 0;

        for (const record of records) {
            totalPoints++;

            // Use already converted coordinates from your parser
            const lat = record.position_lat;
            const lng = record.position_long;

            // Skip invalid coordinates
            if (lat === null || lat === undefined || lng === null || lng === undefined || 
                isNaN(lat) || isNaN(lng)) {
                skippedPoints++;
                continue;
            }

            // Count zero coordinates
            if (lat === 0 && lng === 0) {
                zeroCoordCount++;
                if (zeroCoordCount < 10) { // Only skip first few zeros in case they're at start
                    skippedPoints++;
                    continue;
                }
            }

            // Teleport detection - skip huge jumps
            if (lastValidCoord) {
                const distance = this.calculateDistance(
                    lastValidCoord[0], lastValidCoord[1], lat, lng
                );
                
                // Skip if jump is > 10km (likely teleport)
                if (distance > 10000) {
                    console.warn('🚀 Teleport detected, skipping coordinate:', { lat, lng, distance: distance.toFixed(0) + 'm' });
                    skippedPoints++;
                    continue;
                }
            }

            const coord = [lat, lng];
            coordinates.push(coord);
            lastValidCoord = coord;

            // Extract telemetry data
            telemetry.timestamps.push(record.timestamp || 0);
            telemetry.distances.push(record.distance || 0);
            telemetry.speeds.push(record.speed || 0);
            telemetry.altitudes.push(record.altitude || record.enhanced_altitude || 0);
            telemetry.heartRates.push(record.heart_rate || 0);
            telemetry.powers.push(record.power || 0);
        }

        console.log(`📊 Processed ${totalPoints} points, kept ${coordinates.length}, skipped ${skippedPoints}`);
        console.log(`🔍 Zero coordinates found: ${zeroCoordCount}`);
        
        // Check if we have mostly zero coordinates
        if (coordinates.length > 0) {
            const firstFew = coordinates.slice(0, Math.min(5, coordinates.length));
            console.log(`📍 First few GPS coordinates:`, firstFew);
            
            const allZeros = coordinates.every(coord => coord[0] === 0 && coord[1] === 0);
            if (allZeros) {
                console.error(`❌ ERROR: All GPS coordinates are [0,0] - FIT file may not have valid position data`);
                throw new Error('FIT file contains no valid GPS coordinates - all coordinates are [0,0]');
            }
        }

        return {
            coordinates,
            telemetry,
            totalDistance: telemetry.distances[telemetry.distances.length - 1] || 0,
            duration: telemetry.timestamps.length > 0 ? 
                telemetry.timestamps[telemetry.timestamps.length - 1] - telemetry.timestamps[0] : 0
        };
    }

    /**
     * Calculate distance between two lat/lng points in meters
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Convert GPS coordinates to Zwift coordinates using world-specific metadata
     */
    convertToZwiftCoordinates(gpsCoordinates) {
        console.log(`🔍 Converting coordinates - detected world: ${this.detectedWorld}`);
        console.log(`📍 Sample GPS coordinates:`, gpsCoordinates.slice(0, 3));
        
        if (!this.detectedWorld || !WORLD_METAS[this.detectedWorld]) {
            console.warn(`⚠️ No world metadata for ${this.detectedWorld}, using coordinates as-is`);
            return gpsCoordinates.map(coord => [coord[0], coord[1]]);
        }

        const meta = WORLD_METAS[this.detectedWorld];
        console.log(`🔄 Converting ${gpsCoordinates.length} coordinates for ${this.detectedWorld}`);
        console.log(`🌍 World metadata:`, meta);

        const zwiftCoordinates = [];

        for (const coord of gpsCoordinates) {
            if (!coord || coord.length < 2) continue;

            const [lat, lng] = coord;
            
            if (isNaN(lat) || isNaN(lng)) continue;

            // Convert GPS to Zwift coordinates using world metadata
            let zwiftX, zwiftY;
            
            if (meta.flippedHack) {
                // Some worlds have flipped coordinates
                zwiftX = (lng - meta.lonOffset) * meta.lonDegDist * 100;
                zwiftY = -(lat - meta.latOffset) * meta.latDegDist * 100;
            } else {
                // Standard conversion
                zwiftX = (lng - meta.lonOffset) * meta.lonDegDist * 100;
                zwiftY = (lat - meta.latOffset) * meta.latDegDist * 100;
            }

            // Validate converted coordinates
            if (!isNaN(zwiftX) && !isNaN(zwiftY)) {
                zwiftCoordinates.push([zwiftX, zwiftY]);
            }
        }

        console.log(`✅ Converted to ${zwiftCoordinates.length} Zwift coordinates`);
        
        if (zwiftCoordinates.length > 0) {
            const firstCoord = zwiftCoordinates[0];
            const lastCoord = zwiftCoordinates[zwiftCoordinates.length - 1];
            console.log(`📍 First Zwift coordinate: [${firstCoord[0].toFixed(2)}, ${firstCoord[1].toFixed(2)}]`);
            console.log(`📍 Last Zwift coordinate: [${lastCoord[0].toFixed(2)}, ${lastCoord[1].toFixed(2)}]`);
            
            // Check if coordinates are all the same (indicates conversion problem)
            const allSame = zwiftCoordinates.every(coord => 
                Math.abs(coord[0] - firstCoord[0]) < 1 && 
                Math.abs(coord[1] - firstCoord[1]) < 1
            );
            
            if (allSame) {
                console.warn(`⚠️ WARNING: All Zwift coordinates are nearly identical - conversion may be failing!`);
                console.log(`📍 Returning GPS coordinates as-is to debug`);
                return gpsCoordinates.map(coord => [coord[0] * 100000, coord[1] * 100000]); // Scale up GPS for visibility
            }
        }

        return zwiftCoordinates;
    }

    /**
     * Create highlighted path on the map
     */
    createHighlightedPath(coordinates) {
        if (!this.zwiftMap || coordinates.length < 2) {
            console.warn('Cannot create path - no map or insufficient coordinates');
            return;
        }

        try {
            this.currentRoute = this.zwiftMap.addHighlightLine(
                coordinates,
                'fit-route',
                {
                    color: this.settings.routeColor,
                    width: this.settings.routeWidth,
                    extraClass: 'fit-route-line'
                }
            );

            console.log('✅ Highlighted path created on map');
        } catch (error) {
            console.error('❌ Error creating highlighted path:', error);
        }
    }

    /**
     * Generate checkpoints every 1km along the route
     */
    generateCheckpoints(coordinates, telemetry) {
        console.log(`📍 Generating checkpoints from ${coordinates.length} coordinates`);
        
        if (!coordinates.length || !telemetry.distances.length) {
            console.warn('Cannot generate checkpoints - no coordinate or distance data');
            return;
        }

        this.checkpoints = [];
        const interval = this.settings.checkpointInterval; // 1000m = 1km

        // Log coordinate spread to debug stacking
        if (coordinates.length > 1) {
            const first = coordinates[0];
            const last = coordinates[coordinates.length - 1];
            const spread = Math.abs(first[0] - last[0]) + Math.abs(first[1] - last[1]);
            console.log(`📏 Coordinate spread: ${spread.toFixed(2)} (if < 100, coordinates might be stacked)`);
        }

        // Add start checkpoint
        this.addCheckpoint({
            id: 'fit-start',
            name: 'Start',
            coordinates: coordinates[0],
            distance: 0,
            type: 'start'
        });

        // Add interval checkpoints
        let nextCheckpointDistance = interval;
        let checkpointCount = 1;

        for (let i = 1; i < Math.min(coordinates.length, telemetry.distances.length); i++) {
            const distance = telemetry.distances[i];

            if (distance >= nextCheckpointDistance) {
                const kmMark = Math.round(distance / 1000 * 10) / 10; // Round to 1 decimal
                
                this.addCheckpoint({
                    id: `fit-km-${checkpointCount}`,
                    name: `${kmMark}km`,
                    coordinates: coordinates[i],
                    distance: distance,
                    altitude: telemetry.altitudes[i] || 0,
                    type: 'checkpoint'
                });

                nextCheckpointDistance = (checkpointCount + 1) * interval;
                checkpointCount++;
            }
        }

        // Add finish checkpoint
        if (coordinates.length > 1) {
            const finalDistance = telemetry.distances[telemetry.distances.length - 1] || 0;
            const finalKm = Math.round(finalDistance / 1000 * 10) / 10;

            this.addCheckpoint({
                id: 'fit-finish',
                name: `Finish (${finalKm}km)`,
                coordinates: coordinates[coordinates.length - 1],
                distance: finalDistance,
                altitude: telemetry.altitudes[telemetry.altitudes.length - 1] || 0,
                type: 'finish'
            });
        }

        console.log(`✅ Generated ${this.checkpoints.length} checkpoints`);
        
        // Log checkpoint positions to debug stacking
        if (this.checkpoints.length > 1) {
            console.log(`📍 Checkpoint positions:`);
            this.checkpoints.forEach(cp => {
                console.log(`  ${cp.name}: [${cp.coordinates[0].toFixed(2)}, ${cp.coordinates[1].toFixed(2)}]`);
            });
        }
    }

    /**
     * Add a single checkpoint to the map
     */
    addCheckpoint(checkpoint) {
        if (!this.zwiftMap || !checkpoint.coordinates) {
            return;
        }

        try {
            const entity = this.zwiftMap.addPoint(checkpoint.coordinates, 'fit-checkpoint');
            
            if (entity && entity.el) {
                entity.el.dataset.checkpointId = checkpoint.id;
                entity.el.classList.add('fit-checkpoint', checkpoint.type);
                entity.el.title = `${checkpoint.name} - ${H.distance(checkpoint.distance, {suffix: true})}`;
                
                // Store reference
                checkpoint.mapEntity = entity;
                this.checkpoints.push(checkpoint);
                
                console.log(`📍 Added checkpoint: ${checkpoint.name} at ${H.distance(checkpoint.distance, {suffix: true})}`);
            }
        } catch (error) {
            console.warn('Error adding checkpoint to map:', error);
        }
    }

    /**
     * Fit map view to show the entire route
     */
    fitMapToRoute(coordinates) {
        if (!this.zwiftMap || !coordinates.length) {
            return;
        }

        try {
            // Calculate bounds
            const lats = coordinates.map(c => c[0]);
            const lngs = coordinates.map(c => c[1]);
            
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLng = Math.min(...lngs);
            const maxLng = Math.max(...lngs);

            // Set map bounds with padding
            if (this.zwiftMap.setBounds) {
                this.zwiftMap.setBounds(
                    [minLat, maxLng], // top-left
                    [maxLat, minLng], // bottom-right
                    { padding: 0.1 }
                );
            }

            console.log('🗺️ Map fitted to route bounds');
        } catch (error) {
            console.warn('Error fitting map to route:', error);
        }
    }

    /**
     * Clear current route and checkpoints
     */
    clearRoute() {
        // Remove highlighted path
        if (this.currentRoute && this.zwiftMap) {
            try {
                this.currentRoute.elements.forEach(el => el.remove());
                this.currentRoute = null;
            } catch (error) {
                console.warn('Error removing route path:', error);
            }
        }

        // Remove checkpoints
        this.checkpoints.forEach(checkpoint => {
            if (checkpoint.mapEntity && this.zwiftMap) {
                try {
                    this.zwiftMap.removeEntity(checkpoint.mapEntity);
                } catch (error) {
                    console.warn('Error removing checkpoint:', error);
                }
            }
        });

        this.checkpoints = [];
        this.routeData = null;
        
        console.log('🧹 Route cleared');
    }

    /**
     * Toggle checkpoint visibility
     */
    toggleCheckpoints(show = null) {
        const shouldShow = show !== null ? show : !this.settings.showCheckpoints;
        this.settings.showCheckpoints = shouldShow;

        this.checkpoints.forEach(checkpoint => {
            if (checkpoint.mapEntity) {
                try {
                    checkpoint.mapEntity.toggleHidden(!shouldShow);
                } catch (error) {
                    console.warn('Error toggling checkpoint visibility:', error);
                }
            }
        });

        console.log(`📍 Checkpoints ${shouldShow ? 'shown' : 'hidden'}`);
        return shouldShow;
    }

    /**
     * Get route statistics
     */
    getRouteStats() {
        if (!this.routeData) {
            return null;
        }

        const { telemetry, totalDistance, duration } = this.routeData;
        
        return {
            totalDistance,
            duration,
            averageSpeed: totalDistance > 0 && duration > 0 ? (totalDistance / duration) * 3.6 : 0, // km/h
            averagePower: this.calculateAverage(telemetry.powers.filter(p => p > 0)),
            averageHeartRate: this.calculateAverage(telemetry.heartRates.filter(hr => hr > 0)),
            maxAltitude: Math.max(...telemetry.altitudes),
            minAltitude: Math.min(...telemetry.altitudes),
            elevationGain: this.calculateElevationGain(telemetry.altitudes),
            checkpointCount: this.checkpoints.length,
            coordinates: this.routeData.coordinates.length
        };
    }

    /**
     * Helper function to calculate average
     */
    calculateAverage(array) {
        if (!array.length) return 0;
        return array.reduce((sum, val) => sum + val, 0) / array.length;
    }

    /**
     * Calculate total elevation gain
     */
    calculateElevationGain(altitudes) {
        let gain = 0;
        for (let i = 1; i < altitudes.length; i++) {
            const diff = altitudes[i] - altitudes[i - 1];
            if (diff > 0) {
                gain += diff;
            }
        }
        return gain;
    }
}