// route-parser.mjs - Enhanced Route Data Parser Module (COMPLETE FIXED VERSION)

import * as locale from '/shared/sauce/locale.mjs';

const H = locale.human;

// Use these IDs for current Zwift maps:
export const WORLD_MAPPING = {
    1: { worldId: 1, name: "Watopia" },
    2: { worldId: 2, name: "Richmond" },
    3: { worldId: 3, name: "London" },
    4: { worldId: 4, name: "New York" },
    5: { worldId: 5, name: "Innsbruck" },
    6: { worldId: 6, name: "Bologna" },
    7: { worldId: 7, name: "Yorkshire" },
    8: { worldId: 8, name: "Crit City" },
    9: { worldId: 9, name: "Makuri Islands" },
    10: { worldId: 10, name: "France" },
    11: { worldId: 11, name: "Paris" },
    13: { worldId: 13, name: "Scotland" }
};

/**
 * Enhanced route data parser with better error handling and format detection
 */
export function parseRouteData(jsonData) {
    console.log('Parsing route data:', jsonData);
    
    let parseResult = {
        coordinates: [],
        name: 'Imported Route',
        checkpoints: [],
        telemetry: null,
        worldId: null,
        courseId: null,
        routeId: null,
        metadata: {}
    };
    
    try {
        // Null safety check
        if (!jsonData) {
            throw new Error('No data provided');
        }

        // Format 1: Zwift Event Results (your primary format)
        if (jsonData.success && jsonData.data && Array.isArray(jsonData.data) && jsonData.data.length > 0) {
            console.log('Detected Zwift Event Results format');
            return parseZwiftEventResults(jsonData);
        }
        
        // Format 2: Direct route data
        if (jsonData.coordinates && Array.isArray(jsonData.coordinates)) {
            console.log('Detected simple coordinates format');
            parseResult.coordinates = jsonData.coordinates;
            parseResult.name = jsonData.name || parseResult.name;
            parseResult.checkpoints = jsonData.checkpoints || [];
            parseResult.worldId = jsonData.worldId || null;
            parseResult.courseId = jsonData.courseId || null;
            return parseResult;
        }
        
        // Format 3: GeoJSON
        if (jsonData.type === 'FeatureCollection' || jsonData.features) {
            console.log('Detected GeoJSON format');
            return parseGeoJSON(jsonData);
        }
        
        // Format 4: Sauce route format
        if (jsonData.route) {
            console.log('Detected Sauce route format');
            parseResult.coordinates = jsonData.route.path || jsonData.route.coordinates || [];
            parseResult.name = jsonData.route.name || parseResult.name;
            parseResult.checkpoints = jsonData.checkpoints || [];
            parseResult.worldId = jsonData.worldId || null;
            parseResult.courseId = jsonData.courseId || null;
            return parseResult;
        }
        
        // Format 5: Simple array
        if (Array.isArray(jsonData)) {
            console.log('Detected simple array format');
            parseResult.coordinates = jsonData;
            return parseResult;
        }
        
        throw new Error('Unrecognized JSON format');
        
    } catch (error) {
        console.error('Error parsing route data:', error);
        throw new Error(`Failed to parse route data: ${error.message}`);
    }
}

/**
 * Parse Zwift Event Results format (your main format) - FIXED
 */
function parseZwiftEventResults(jsonData) {
    // Null safety checks
    if (!jsonData || !jsonData.data || !Array.isArray(jsonData.data) || jsonData.data.length === 0) {
        throw new Error('Invalid Zwift event results format');
    }

    const eventData = jsonData.data[0];
    if (!eventData) {
        throw new Error('No event data found');
    }

    const parseResult = {
        coordinates: [],
        name: 'Zwift Event',
        checkpoints: [],
        telemetry: null,
        worldId: null,
        courseId: null,
        routeId: null,
        metadata: {}
    };
    
    // Extract event metadata with null safety
    if (eventData.zwiftEvent) {
        const event = eventData.zwiftEvent;
        parseResult.name = event.name || parseResult.name;
        parseResult.routeId = event.routeId || null;
        
        // Use mapId as the primary identifier - it matches our WORLD_MAPPING keys
        let finalWorldId = null;
        let worldName = null;
        
        if (event.mapId !== undefined && event.mapId !== null) {
            // mapId is the reliable identifier that matches our WORLD_MAPPING
            finalWorldId = event.mapId;
            console.log(`Using mapId as worldId: ${finalWorldId}`);
        } else if (event.courseId !== undefined && event.courseId !== null) {
            // Fallback to courseId if no mapId
            finalWorldId = event.courseId;
            console.log(`Fallback to courseId as worldId: ${finalWorldId}`);
        } else if (event.worldId !== undefined && event.worldId !== null) {
            // Last resort: use worldId
            finalWorldId = event.worldId;
            console.log(`Last resort using worldId: ${finalWorldId}`);
        }
        
        if (finalWorldId !== null && WORLD_MAPPING[finalWorldId]) {
            worldName = WORLD_MAPPING[finalWorldId].name;
            console.log(`✓ Found world: ${worldName} (using ID: ${finalWorldId})`);
        } else {
            console.warn(`✗ Unknown world ID: ${finalWorldId}`);
            console.log(`Available IDs in data: mapId=${event.mapId}, courseId=${event.courseId}, worldId=${event.worldId}`);
            worldName = `Unknown World ${finalWorldId}`;
        }
        
        parseResult.worldId = finalWorldId; // This is actually the mapId
        parseResult.courseId = event.courseId || null; // Keep original courseId separate
        
        parseResult.metadata = {
            eventId: event.id || null,
            eventStart: event.eventStart || null,
            eventEnd: event.eventEnd || null,
            distanceInMeters: event.distanceInMeters || null,
            durationInSeconds: event.durationInSeconds || null,
            laps: event.laps || null,
            originalMapId: event.mapId || null,
            originalCourseId: event.courseId || null,
            originalWorldId: event.worldId || null,
            worldName: worldName,
            usedIdType: event.mapId ? 'mapId' : (event.courseId ? 'courseId' : 'worldId'),
            usedIdValue: finalWorldId
        };
    }
    
    // Extract GPS and telemetry data from results with null safety
    if (eventData.zwiftResults && eventData.zwiftResults.eventResults) {
        const results = eventData.zwiftResults.eventResults;
        
        // Look through all categories for the best data
        const categories = Object.keys(results).sort(); // Sort to get consistent ordering
        
        for (const category of categories) {
            const riders = results[category];
            if (!riders || !Array.isArray(riders) || riders.length === 0) continue;
            
            // Try each rider until we find good fitFile data
            for (const rider of riders) {
                // Null safety chain
                const fitData = rider && rider.activityData && rider.activityData.fullData && rider.activityData.fullData.fitFile;
                if (!fitData) continue;
                
                // Validate we have GPS coordinates
                if (!fitData.latlng || !Array.isArray(fitData.latlng) || fitData.latlng.length === 0) {
                    continue;
                }
                
                console.log(`Found GPS data from ${category} category, rider: ${rider.displayName || 'Unknown'}`);
                console.log(`GPS points: ${fitData.latlng.length}`);
                
                // Extract coordinates with null safety
                parseResult.coordinates = fitData.latlng.map(coord => {
                    if (Array.isArray(coord) && coord.length >= 2) {
                        return [coord[0], coord[1]]; // [lat, lng]
                    }
                    return coord;
                }).filter(coord => coord && Array.isArray(coord) && coord.length >= 2);
                
                // Extract telemetry data with null safety
                parseResult.telemetry = {
                    distance: fitData.distanceInCm || [],
                    altitude: fitData.altitudeInCm || [],
                    speed: fitData.speedInCmPerSec || [],
                    power: fitData.watts || [],
                    heartRate: fitData.heartrate || [],
                    cadence: fitData.cadence || [],
                    time: fitData.timeInS || []
                };
                
                // Generate automatic checkpoints
                parseResult.checkpoints = generateAutoCheckpoints(parseResult.coordinates, parseResult.telemetry);
                
                // We found good data, stop looking
                return parseResult;
            }
        }
    }
    
    if (parseResult.coordinates.length === 0) {
        throw new Error('No GPS coordinates found in Zwift event results');
    }
    
    return parseResult;
}

/**
 * Parse GeoJSON format - FIXED
 */
function parseGeoJSON(jsonData) {
    if (!jsonData) {
        throw new Error('No GeoJSON data provided');
    }

    const parseResult = {
        coordinates: [],
        name: jsonData.name || 'GeoJSON Route',
        checkpoints: [],
        telemetry: null,
        worldId: jsonData.worldId || null,
        courseId: jsonData.courseId || null,
        routeId: null,
        metadata: (jsonData.properties && typeof jsonData.properties === 'object') ? jsonData.properties : {}
    };
    
    const features = jsonData.features || [jsonData];
    
    for (const feature of features) {
        if (!feature || !feature.geometry) continue;
        
        if (feature.geometry.type === 'LineString') {
            parseResult.coordinates = parseResult.coordinates.concat(feature.geometry.coordinates || []);
        } else if (feature.geometry.type === 'MultiLineString') {
            for (const lineString of (feature.geometry.coordinates || [])) {
                parseResult.coordinates = parseResult.coordinates.concat(lineString || []);
            }
        } else if (feature.geometry.type === 'Point' && feature.properties && feature.properties.checkpoint) {
            parseResult.checkpoints.push({
                name: (feature.properties && feature.properties.name) || 'Checkpoint',
                coordinates: feature.geometry.coordinates || [0, 0],
                ...(feature.properties || {})
            });
        }
    }
    
    return parseResult;
}

/**
 * Generate automatic checkpoints based on distance intervals - FIXED
 */
export function generateAutoCheckpoints(coordinates, telemetry, intervalMeters = 1000) {
    const checkpoints = [];
    
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        console.warn('No coordinates provided for checkpoint generation');
        return checkpoints;
    }
    
    console.log(`Generating auto checkpoints with ${intervalMeters}m intervals...`);
    console.log(`Coordinates: ${coordinates.length}, Telemetry available:`, !!telemetry);
    
    // Add start checkpoint
    checkpoints.push({
        name: 'Start',
        coordinates: coordinates[0],
        distance: 0,
        altitude: (telemetry && telemetry.altitude && telemetry.altitude[0]) ? telemetry.altitude[0] / 100 : 0,
        index: 0,
        type: 'start'
    });
    
    // Add intermediate checkpoints based on distance
    if (telemetry && telemetry.distance && Array.isArray(telemetry.distance) && telemetry.distance.length > 0) {
        console.log(`Using telemetry distance data (${telemetry.distance.length} points)`);
        const intervalCm = intervalMeters * 100; // Convert to cm
        
        let nextCheckpointDistance = intervalCm;
        let checkpointCount = 1;
        
        for (let i = 1; i < Math.min(telemetry.distance.length, coordinates.length); i++) {
            const currentDistance = telemetry.distance[i] || 0;
            
            if (currentDistance >= nextCheckpointDistance) {
                const distanceKm = Math.round(currentDistance / 100000 * 10) / 10; // Convert cm to km, round to 1 decimal
                
                checkpoints.push({
                    name: `${distanceKm}km Split`,
                    coordinates: coordinates[i] || coordinates[0],
                    distance: currentDistance / 100, // Convert cm to meters
                    altitude: (telemetry.altitude && telemetry.altitude[i]) ? telemetry.altitude[i] / 100 : 0,
                    index: i,
                    type: 'split',
                    time: (telemetry.time && telemetry.time[i]) ? telemetry.time[i] : null
                });
                
                nextCheckpointDistance = (checkpointCount + 1) * intervalCm;
                checkpointCount++;
                
                console.log(`Generated checkpoint: ${distanceKm}km at index ${i}`);
            }
        }
    } else {
        console.log('No distance telemetry - generating checkpoints by coordinate intervals');
        // Fallback: generate checkpoints based on coordinate index
        const interval = Math.max(1, Math.floor(coordinates.length / 10));
        for (let i = interval; i < coordinates.length - interval; i += interval) {
            const estimatedDistance = (i / coordinates.length) * (coordinates.length * 20); // Rough estimate
            const distanceKm = Math.round(estimatedDistance / 1000 * 10) / 10;
            
            checkpoints.push({
                name: `~${distanceKm}km Split`,
                coordinates: coordinates[i] || coordinates[0],
                distance: estimatedDistance, // Rough estimate
                altitude: 0,
                index: i,
                type: 'split'
            });
        }
    }
    
    // Add finish checkpoint
    if (coordinates.length > 1) {
        const lastIdx = coordinates.length - 1;
        const finalDistance = (telemetry && telemetry.distance && telemetry.distance[lastIdx]) ? 
            telemetry.distance[lastIdx] / 100 : lastIdx * 10;
        const finalDistanceKm = Math.round(finalDistance / 1000 * 10) / 10;
        
        checkpoints.push({
            name: `Finish (${finalDistanceKm}km)`,
            coordinates: coordinates[lastIdx] || coordinates[0],
            distance: finalDistance,
            altitude: (telemetry && telemetry.altitude && telemetry.altitude[lastIdx]) ? telemetry.altitude[lastIdx] / 100 : 0,
            index: lastIdx,
            type: 'finish',
            time: (telemetry && telemetry.time && telemetry.time[lastIdx]) ? telemetry.time[lastIdx] : null
        });
    }
    
    console.log(`Generated ${checkpoints.length} automatic checkpoints:`, checkpoints.map(cp => cp.name));
    return checkpoints;
}

/**
 * Get world name from IDs with better error handling - FIXED
 */
export function getWorldName(worldId, courseId) {
    // Null safety checks
    if (worldId !== undefined && worldId !== null && WORLD_MAPPING[worldId]) {
        return WORLD_MAPPING[worldId].name;
    }
    
    if (courseId !== undefined && courseId !== null && WORLD_MAPPING[courseId]) {
        return WORLD_MAPPING[courseId].name;
    }
    
    // Last resort
    return `Unknown World (ID: ${worldId || courseId || 'N/A'})`;
}

/**
 * Sample route data generator for testing - FIXED
 */
export function generateSampleRoute() {
    // Generate a simple test route with checkpoints for Crit City
    const coordinates = [];
    const checkpoints = [];
    
    // Create a simple rectangular route in Crit City coordinate space
    const baseCoords = [
        [-10.383876, 165.802295], // Start
        [-10.383500, 165.802000], // Point 1
        [-10.383000, 165.801500], // Point 2
        [-10.382500, 165.801000], // Point 3
        [-10.382000, 165.800500], // Point 4
        [-10.382500, 165.800000], // Point 5
        [-10.383000, 165.800500], // Point 6
        [-10.383500, 165.801000], // Point 7
        [-10.383876, 165.802295]  // Back to start
    ];
    
    coordinates.push(...baseCoords);
    
    // Add checkpoints
    checkpoints.push({
        name: 'Start/Finish',
        coordinates: baseCoords[0],
        distance: 0,
        type: 'start'
    });
    
    checkpoints.push({
        name: 'Turn 1',
        coordinates: baseCoords[2],
        distance: 500,
        type: 'checkpoint'
    });
    
    checkpoints.push({
        name: 'Turn 2',
        coordinates: baseCoords[4],
        distance: 1000,
        type: 'checkpoint'
    });
    
    checkpoints.push({
        name: 'Turn 3',
        coordinates: baseCoords[6],
        distance: 1500,
        type: 'checkpoint'
    });
    
    return {
        success: true,
        data: [{
            zwiftEvent: {
                name: 'Sample Crit City Route',
                mapId: 12,
                worldId: 8,
                courseId: 12
            },
            zwiftResults: {
                eventResults: {
                    "A": [{
                        displayName: "Test Rider",
                        activityData: {
                            fullData: {
                                fitFile: {
                                    latlng: coordinates,
                                    distanceInCm: [0, 50000, 100000, 150000, 200000, 250000, 300000, 350000, 400000],
                                    altitudeInCm: [10000, 10200, 10500, 10300, 10100, 10000, 10200, 10400, 10000]
                                }
                            }
                        }
                    }]
                }
            }
        }]
    };
}