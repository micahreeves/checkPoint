// coordinate-converter.mjs - Enhanced Coordinate Conversion using Sauce worldMeta

/**
 * Convert GPS coordinates to Zwift world coordinates using worldMeta
 * @param {Array} coordinates - Array of [lat, lng] coordinates
 * @param {Object} worldMeta - World metadata from common.getWorldList()
 * @param {Object} settings - Optional settings
 */
export function convertCoordinates(coordinates, worldMeta, settings = {}) {
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        console.warn('No coordinates provided for conversion');
        return [];
    }

    const firstCoord = coordinates[0];
    if (!Array.isArray(firstCoord) || firstCoord.length < 2) {
        console.log('Coordinates appear to be in correct format already');
        return coordinates;
    }

    const [first, second] = firstCoord;

    // Null safety checks
    if (first === null || first === undefined || second === null || second === undefined) {
        console.warn('Invalid coordinate values found');
        return coordinates.filter(coord => Array.isArray(coord) && coord.length >= 2 &&
            coord[0] !== null && coord[0] !== undefined &&
            coord[1] !== null && coord[1] !== undefined);
    }

    // Check if these are GPS coordinates (lat/lng in degrees)
    const isGPS = Math.abs(first) <= 90 && Math.abs(second) <= 180;

    if (!isGPS && settings.coordinateConversionMode !== 'gps') {
        console.log('Coordinates appear to be in Zwift format already');
        return coordinates.map(coord => {
            if (Array.isArray(coord) && coord.length >= 2) {
                return [coord[0] || 0, coord[1] || 0];
            }
            return coord;
        }).filter(coord => coord);
    }

    if (settings.coordinateConversionMode === 'zwift') {
        console.log('Forced Zwift coordinate mode - no conversion');
        return coordinates.map(coord => {
            if (Array.isArray(coord) && coord.length >= 2) {
                return [coord[0] || 0, coord[1] || 0];
            }
            return coord;
        }).filter(coord => coord);
    }

    console.log('Converting GPS coordinates to Zwift coordinates');

    if (worldMeta) {
        console.log(`Using worldMeta: ${worldMeta.name} (worldId: ${worldMeta.worldId}, courseId: ${worldMeta.courseId})`);
        console.log(`Conversion params: latOffset=${worldMeta.latOffset}, lonOffset=${worldMeta.lonOffset}, latDegDist=${worldMeta.latDegDist}, lonDegDist=${worldMeta.lonDegDist}, flippedHack=${worldMeta.flippedHack}`);
    } else {
        console.warn('No worldMeta provided - using fallback conversion');
    }

    return coordinates.map(coord => convertLatLngToZwift(coord, worldMeta))
        .filter(coord => coord && Array.isArray(coord) && coord.length >= 2);
}

/**
 * Convert a single lat/lng coordinate to Zwift world position
 * Uses the same formula as Sauce4Zwift's map.mjs latlngToPosition()
 * @param {Array} coord - [lat, lng] coordinate
 * @param {Object} worldMeta - World metadata from common.getWorldList()
 */
export function convertLatLngToZwift(coord, worldMeta) {
    if (!coord || !Array.isArray(coord) || coord.length < 2) {
        console.warn('Invalid coordinate for conversion:', coord);
        return [0, 0];
    }

    const lat = coord[0];
    const lng = coord[1];

    if (lat === null || lat === undefined || lng === null || lng === undefined ||
        isNaN(lat) || isNaN(lng)) {
        console.warn('Invalid lat/lng values:', lat, lng);
        return [0, 0];
    }

    // If we have worldMeta from Sauce, use its conversion parameters
    if (worldMeta && worldMeta.latDegDist && worldMeta.lonDegDist) {
        // Sauce formula from map.mjs latlngToPosition():
        // flippedHack worlds: [x = (lat - latOffset) * latDegDist * 100, y = (lon - lonOffset) * lonDegDist * 100]
        // normal worlds:      [x = (lon - lonOffset) * lonDegDist * 100, y = -(lat - latOffset) * latDegDist * 100]
        if (worldMeta.flippedHack) {
            return [
                (lat - worldMeta.latOffset) * worldMeta.latDegDist * 100,
                (lng - worldMeta.lonOffset) * worldMeta.lonDegDist * 100
            ];
        } else {
            return [
                (lng - worldMeta.lonOffset) * worldMeta.lonDegDist * 100,
                -(lat - worldMeta.latOffset) * worldMeta.latDegDist * 100
            ];
        }
    }

    // Fallback: use hardcoded conversion parameters if worldMeta not available
    console.warn('Using fallback conversion - worldMeta not available or incomplete');
    return fallbackConversion(lat, lng);
}

/**
 * Fallback conversion when worldMeta is not available
 * Uses Crit City parameters as default
 */
function fallbackConversion(lat, lng) {
    // Default Crit City-style conversion
    const latScale = 500000;
    const lngScale = 500000;
    const latOffset = 10.384;
    const lngOffset = -165.802;

    const x = (lng - lngOffset) * lngScale;
    const y = (lat - latOffset) * latScale;

    return [x, y];
}

/**
 * Find worldMeta from worldList by courseId or worldId
 * @param {Array} worldList - Array of world metadata from common.getWorldList()
 * @param {number} courseId - Course ID
 * @param {number} worldId - World ID
 */
export function findWorldMeta(worldList, courseId, worldId) {
    if (!worldList || !Array.isArray(worldList) || worldList.length === 0) {
        console.warn('No worldList available');
        return null;
    }

    // Try courseId first (more specific)
    if (courseId !== undefined && courseId !== null && !isNaN(courseId)) {
        const meta = worldList.find(w => w && w.courseId === courseId);
        if (meta) {
            console.log(`Found worldMeta by courseId ${courseId}: ${meta.name}`);
            return meta;
        }
    }

    // Try worldId
    if (worldId !== undefined && worldId !== null && !isNaN(worldId)) {
        const meta = worldList.find(w => w && w.worldId === worldId);
        if (meta) {
            console.log(`Found worldMeta by worldId ${worldId}: ${meta.name}`);
            return meta;
        }
    }

    console.warn(`Could not find worldMeta for courseId=${courseId}, worldId=${worldId}`);
    return null;
}

// CourseId to WorldId mapping (from Sauce4Zwift) - for reference
export const COURSE_TO_WORLD = {
    6: 1,   // Watopia
    2: 2,   // Richmond
    7: 3,   // London
    8: 4,   // New York
    9: 5,   // Innsbruck
    10: 6,  // Bologna
    11: 7,  // Yorkshire
    12: 8,  // Crit City
    13: 9,  // Makuri Islands
    14: 10, // France
    15: 11, // Paris
    16: 12, // Gravel Mountain
    17: 13  // Scotland
};

// World names mapping - for reference
export const WORLD_NAMES = {
    1: 'Watopia',
    2: 'Richmond',
    3: 'London',
    4: 'New York',
    5: 'Innsbruck',
    6: 'Bologna',
    7: 'Yorkshire',
    8: 'Crit City',
    9: 'Makuri Islands',
    10: 'France',
    11: 'Paris',
    12: 'Gravel Mountain',
    13: 'Scotland'
};
