// Shared station cross-section (metres). X runs along the tracks, Z across, Y up.
// Hall & platform floor is y = 0, train floor is aligned with the platform.
export const HALF_L = 75;          // station half length (end walls at ±HALF_L)
export const BAY = 7.5;            // column spacing
export const COL_Z = 5.6;          // arcade (column) axis
export const HALL_HALF = 5.0;      // clear hall half-width
export const PLAT_EDGE = 9.7;      // platform edge |z|
export const TRACK_Z = 11.45;      // track centre |z|
export const WALL_Z = 13.3;        // track wall |z|
export const RAIL_Y = -1.1;        // top of rail
export const BED_Y = -1.38;        // track bed
export const GAUGE = 1.52;         // Russian gauge
export const TUNNEL_R = 2.75;      // running tunnel radius
export const TUNNEL_Y = 1.2;       // running tunnel axis height
export const TUNNEL_LEN = 320;     // length of each running tunnel beyond the station
export const CORRIDOR_LEN = 14;    // exit corridors behind hall end walls
export const CORRIDOR_HALF = 2.3;

export const columnXs = [];
for ( let x = - HALF_L + BAY; x < HALF_L - 0.1; x += BAY ) columnXs.push( x );

export const STATIONS = [
	{ id: 'komsomolskaya', name: 'Комсомольская', line: 'Кольцевая линия' },
	{ id: 'mayakovskaya', name: 'Маяковская', line: 'Замоскворецкая линия' },
	{ id: 'novoslobodskaya', name: 'Новослободская', line: 'Кольцевая линия' }
];
