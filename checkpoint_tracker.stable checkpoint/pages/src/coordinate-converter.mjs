// coordinate-converter.mjs - Enhanced Coordinate Conversion Module (FIXED)

/**
 * Enhanced coordinate conversion with better world handling and null safety
 */
export function convertCoordinates(coordinates, worldId, courseId, settings = {}) {
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        console.warn('No coordinates provided for conversion');
        return [];
    }
    
    const firstCoord = coordinates[0];
    if (!Array.isArray(firstCoord) || firstCoord.length < 2) {
        console.log('Coordinates appear to be in correct format already');
        return coordinates; // Already in correct format
    }
    
    const [first, second] = firstCoord;
    
    // Null safety checks
    if (first === null || first === undefined || second === null || second === undefined) {
        console.warn('Invalid coordinate values found');
        return coordinates.filter(coord => Array.isArray(coord) && coord.length >= 2 && 
                                 coord[0] !== null && coord[0] !== undefined && 
                                 coord[1] !== null && coord[1] !== undefined);
    }
    
    // Check if these are GPS coordinates (lat/lng)
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
    console.log(`Using worldId: ${worldId}, courseId: ${courseId}`);
    
    // Manual conversion based on world/course
    return coordinates.map(coord => convertLatLngToZwift(coord, worldId, courseId))
                     .filter(coord => coord && Array.isArray(coord) && coord.length >= 2);
}

/**
 * Enhanced manual coordinate conversion with world-specific parameters and null safety
 */
export function convertLatLngToZwift(coord, worldId, courseId) {
    // Null safety checks
    if (!coord || !Array.isArray(coord) || coord.length < 2) {
        console.warn('Invalid coordinate for conversion:', coord);
        return [0, 0];
    }

    const lat = coord[0];
    const lng = coord[1];
    
    // Additional null checks
    if (lat === null || lat === undefined || lng === null || lng === undefined || 
        isNaN(lat) || isNaN(lng)) {
        console.warn('Invalid lat/lng values:', lat, lng);
        return [0, 0];
    }
    
    // Use courseId first, then worldId, with null checks
    let id = null;
    if (courseId !== undefined && courseId !== null && !isNaN(courseId)) {
        id = courseId;
    } else if (worldId !== undefined && worldId !== null && !isNaN(worldId)) {
        id = worldId;
    }
    
    console.log(`Converting coordinate [${lat}, ${lng}] using id: ${id} (courseId: ${courseId}, worldId: ${worldId})`);
    
    // World-specific conversion parameters (these may need fine-tuning)
    const conversions = {
        1: { // Watopia
            latScale: 100000, lngScale: 100000,
            latOffset: 0, lngOffset: 0
        },
        8: { // Crit City (your data)
            latScale: 500000, lngScale: 500000,
            latOffset: 10.384, lngOffset: -165.802
        },
        12: { // Crit City by courseId
            latScale: 500000, lngScale: 500000,
            latOffset: 10.384, lngOffset: -165.802
        },
        4: { // New York
            latScale: 200000, lngScale: 200000,
            latOffset: -40.7, lngOffset: 74
        },
        3: { // London
            latScale: 150000, lngScale: 150000,
            latOffset: -51.5, lngOffset: 0
        },
        7: { // Yorkshire
            latScale: 180000, lngScale: 180000,
            latOffset: -53.8, lngOffset: 1.5
        }
    };
    
    // Default to Crit City if no valid ID or mapping found
    const conv = (id !== null && conversions[id]) ? conversions[id] : conversions[12];
    
    try {
        const x = (lng - conv.lngOffset) * conv.lngScale;
        const y = (lat - conv.latOffset) * conv.latScale;
        
        // Validate the result
        if (isNaN(x) || isNaN(y)) {
            console.warn('Conversion resulted in NaN values:', { lat, lng, conv, x, y });
            return [0, 0];
        }
        
        if (id === null) {
            console.warn(`No valid world/course ID provided, using default Crit City conversion`);
        }
        
        return [x, y];
    } catch (error) {
        console.error('Error in coordinate conversion:', error);
        return [0, 0];
    }
}