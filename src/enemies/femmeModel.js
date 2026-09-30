// Procedural, fully rigged female character with interchangeable glamorous outfits.
// Skinned lofted body + clothing layers, procedural walk/aim animation with two-bone IK,
// and a verlet ragdoll that drives the skeleton after death.
import * as THREE from 'three/webgpu';
import {
	float, color, mix, positionGeometry as positionLocal, normalView, texture, vec2, mx_noise_float, mx_fractal_noise_float, mx_cell_noise_float,
	smoothstep, abs, pow, vec3, bumpMap, floor, fract, clamp, oneMinus
} from 'three/tsl';

// ------------------------------------------------------------------ skeleton definition

const B = ( name, parent, x, y, z ) => ( { name, parent, pos: new THREE.Vector3( x, y, z ) } );
const SK = [
	B( 'hips', null, 0, 1.0, 0 ),
	B( 'spine', 'hips', 0, 1.13, - 0.005 ),
	B( 'chest', 'spine', 0, 1.29, - 0.012 ),
	B( 'neck', 'chest', 0, 1.47, - 0.018 ),
	B( 'head', 'neck', 0, 1.56, - 0.008 )
];
for ( const s of [ 1, - 1 ] ) {

	const L = s > 0 ? 'L' : 'R';
	SK.push(
		B( 'shoulder' + L, 'chest', s * 0.035, 1.42, - 0.02 ),
		B( 'upperArm' + L, 'shoulder' + L, s * 0.175, 1.415, - 0.025 ),
		B( 'foreArm' + L, 'upperArm' + L, s * 0.245, 1.152, - 0.04 ),
		B( 'hand' + L, 'foreArm' + L, s * 0.29, 0.922, - 0.012 ),
		B( 'thigh' + L, 'hips', s * 0.092, 0.955, 0 ),
		B( 'shin' + L, 'thigh' + L, s * 0.1, 0.545, 0.012 ),
		B( 'foot' + L, 'shin' + L, s * 0.105, 0.13, - 0.035 )
	);

}

const TIPS = { handL: [ 0.315, 0.76, 0.005 ], handR: [ - 0.315, 0.76, 0.005 ], footL: [ 0.108, 0.012, 0.16 ], footR: [ - 0.108, 0.012, 0.16 ], head: [ 0, 1.78, 0.0 ] };
const BONE_INDEX = {};
SK.forEach( ( b, i ) => { BONE_INDEX[ b.name ] = i; } );
const BIND = {};
SK.forEach( ( b ) => { BIND[ b.name ] = b.pos; } );

function childOf( name ) {

	const c = SK.find( ( b ) => b.parent === name && ! b.name.startsWith( 'shoulder' ) && ! b.name.startsWith( 'thigh' ) );
	if ( c ) return c.pos;
	return new THREE.Vector3( ...TIPS[ name ] );

}

export const REST_DIR = {};
for ( const b of SK ) REST_DIR[ b.name ] = childOf( b.name ).clone().sub( b.pos ).normalize();

// ------------------------------------------------------------------ skinned loft

/**
 * rings: [{ c:[x,y,z], rx, rz, w:{bone:weight}|fn(θ,pos)→{bone:w}, off?:fn(θ)→[side,front], zOff }]
 */
function loft( rings, { radial = 22, side = [ 1, 0, 0 ], capStart = false, capEnd = false, arc = null } = {} ) {

	const pos = [], skinI = [], skinW = [], uvs = [];
	const n = rings.length;
	const seg = arc ? radial : radial;
	const cols = arc ? seg + 1 : seg;
	const sideHint = new THREE.Vector3( ...side );
	const C = rings.map( ( r ) => new THREE.Vector3( ...r.c ) );
	const tmp = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		const r = rings[ i ];
		const a = C[ Math.min( n - 1, i + 1 ) ].clone().sub( C[ Math.max( 0, i - 1 ) ] ).normalize();
		const sd = r.side ? new THREE.Vector3( ...r.side ) : sideHint.clone();
		sd.addScaledVector( a, - sd.dot( a ) ).normalize();
		const fr = new THREE.Vector3().crossVectors( sd, a ).normalize();
		for ( let j = 0; j < cols; j ++ ) {

			const th = arc ? arc[ 0 ] + ( arc[ 1 ] - arc[ 0 ] ) * j / seg : j / seg * Math.PI * 2;
			let sx = Math.cos( th ) * r.rx, fz = Math.sin( th ) * r.rz;
			if ( r.back && Math.sin( th ) < 0 ) fz *= r.back;
			if ( r.off ) { const o = r.off( th ); sx += o[ 0 ]; fz += o[ 1 ]; }
			tmp.copy( C[ i ] ).addScaledVector( sd, sx ).addScaledVector( fr, fz );
			if ( r.zOff ) tmp.z += r.zOff;
			pos.push( tmp.x, tmp.y, tmp.z );
			uvs.push( j / seg, i / ( n - 1 ) );
			const w = typeof r.w === 'function' ? r.w( th, tmp ) : r.w;
			pushWeights( skinI, skinW, w );

		}

	}

	const idx = [];
	for ( let i = 0; i < n - 1; i ++ ) for ( let j = 0; j < ( arc ? seg : seg ); j ++ ) {

		const j2 = arc ? j + 1 : ( j + 1 ) % seg;
		const a = i * cols + j, b = i * cols + j2, c = ( i + 1 ) * cols + j, d = ( i + 1 ) * cols + j2;
		idx.push( a, c, b, b, c, d );

	}

	const cap = ( ri, flip ) => {

		const base = pos.length / 3;
		const c = C[ ri ];
		pos.push( c.x, c.y, c.z ); uvs.push( 0.5, ri / ( n - 1 ) );
		pushWeights( skinI, skinW, typeof rings[ ri ].w === 'function' ? rings[ ri ].w( 0, c ) : rings[ ri ].w );
		for ( let j = 0; j < seg; j ++ ) {

			const a = ri * cols + j, b = ri * cols + ( j + 1 ) % seg;
			if ( flip ) idx.push( base, a, b ); else idx.push( base, b, a );

		}

	};

	if ( capStart && ! arc ) cap( 0, true );
	if ( capEnd && ! arc ) cap( n - 1, false );
	return makeSkinnedGeo( pos, uvs, skinI, skinW, idx );

}

function pushWeights( I, W, w ) {

	const e = Object.entries( w ).filter( ( [ , v ] ) => v > 0.001 ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 4 );
	let sum = 0;
	for ( const [ , v ] of e ) sum += v;
	for ( let k = 0; k < 4; k ++ ) {

		if ( k < e.length ) { I.push( BONE_INDEX[ e[ k ][ 0 ] ] ); W.push( e[ k ][ 1 ] / sum ); } else { I.push( 0 ); W.push( 0 ); }

	}

}

function makeSkinnedGeo( pos, uvs, I, W, idx ) {

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	g.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( I, 4 ) );
	g.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( W, 4 ) );
	if ( idx ) g.setIndex( idx );
	g.computeVertexNormals();
	return g;

}

/** Rigid geometry bound entirely to one bone (with optional second bone blend). */
function rigid( geo, bone, bone2 = null, w2 = 0 ) {

	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	const n = g.attributes.position.count;
	const I = [], W = [];
	for ( let i = 0; i < n; i ++ ) pushWeights( I, W, bone2 ? { [ bone ]: 1 - w2, [ bone2 ]: w2 } : { [ bone ]: 1 } );
	g.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( I, 4 ) );
	g.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( W, 4 ) );
	if ( ! g.attributes.uv ) g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( n * 2 ), 2 ) );
	if ( ! g.attributes.normal ) g.computeVertexNormals();
	return g;

}

function mergeSkinned( list ) {

	const geos = list.map( ( g ) => g.index ? g.toNonIndexed() : g );
	let n = 0;
	for ( const g of geos ) n += g.attributes.position.count;
	const P = new Float32Array( n * 3 ), N = new Float32Array( n * 3 ), U = new Float32Array( n * 2 ), I = new Uint16Array( n * 4 ), W = new Float32Array( n * 4 );
	let o = 0;
	for ( const g of geos ) {

		const c = g.attributes.position.count;
		P.set( g.attributes.position.array, o * 3 );
		N.set( g.attributes.normal.array, o * 3 );
		U.set( g.attributes.uv.array, o * 2 );
		I.set( g.attributes.skinIndex.array, o * 4 );
		W.set( g.attributes.skinWeight.array, o * 4 );
		o += c;

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.BufferAttribute( P, 3 ) );
	g.setAttribute( 'normal', new THREE.BufferAttribute( N, 3 ) );
	g.setAttribute( 'uv', new THREE.BufferAttribute( U, 2 ) );
	g.setAttribute( 'skinIndex', new THREE.BufferAttribute( I, 4 ) );
	g.setAttribute( 'skinWeight', new THREE.BufferAttribute( W, 4 ) );
	g.computeBoundingSphere();
	return g;

}

const sm = ( a, b, x ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };
const lerpW = ( a, b, t ) => ( { [ a ]: 1 - t, [ b ]: t } );

// ------------------------------------------------------------------ body parts

function torsoRings( scale = 1, from = 0.84, to = 1.478, { bust = 1, skirtFlare = 0 } = {} ) {

	const T = [
		[ 0.84, 0.125, 0.09 ], [ 0.9, 0.158, 0.105 ], [ 0.96, 0.172, 0.11 ], [ 1.02, 0.162, 0.1 ], [ 1.08, 0.136, 0.086 ],
		[ 1.13, 0.122, 0.08 ], [ 1.19, 0.13, 0.086 ], [ 1.24, 0.142, 0.097, 0.03 ], [ 1.29, 0.15, 0.104, 0.048 ], [ 1.335, 0.153, 0.094, 0.03 ],
		[ 1.385, 0.16, 0.083 ], [ 1.415, 0.155, 0.076 ], [ 1.435, 0.138, 0.07 ], [ 1.452, 0.108, 0.062 ], [ 1.466, 0.075, 0.055 ], [ 1.478, 0.052, 0.048 ]
	];
	return T.filter( ( r ) => r[ 0 ] >= from - 1e-6 && r[ 0 ] <= to + 1e-6 ).map( ( [ y, rx, rz, b = 0 ] ) => ( {
		c: [ 0, y, - 0.01 ], rx: rx * scale, rz: rz * scale, back: 0.92,
		off: b > 0 ? ( th ) => {

			const lobe = ( c ) => Math.exp( - Math.pow( ( th - c ) / 0.42, 2 ) );
			const f = ( lobe( Math.PI / 2 - 0.55 ) + lobe( Math.PI / 2 + 0.55 ) ) * b * bust * scale;
			return [ 0, f ];

		} : null,
		w: ( th, p ) => {

			let w;
			if ( p.y < 1.04 ) w = { hips: 1 };
			else if ( p.y < 1.2 ) w = lerpW( 'hips', 'spine', sm( 1.04, 1.2, p.y ) );
			else w = lerpW( 'spine', 'chest', sm( 1.2, 1.33, p.y ) );
			// shoulders follow the clavicles
			const sh = sm( 0.1, 0.16, Math.abs( p.x ) ) * sm( 1.33, 1.42, p.y );
			if ( sh > 0 ) {

				for ( const k in w ) w[ k ] *= 1 - sh;
				w[ p.x > 0 ? 'shoulderL' : 'shoulderR' ] = sh * 0.6;
				w[ p.x > 0 ? 'upperArmL' : 'upperArmR' ] = sh * 0.4;

			}

			// thighs pull on the lower pelvis
			const th2 = sm( 0.95, 0.86, p.y ) * sm( 0.02, 0.1, Math.abs( p.x ) );
			if ( th2 > 0 ) {

				for ( const k in w ) w[ k ] *= 1 - th2 * 0.5;
				w[ p.x > 0 ? 'thighL' : 'thighR' ] = th2 * 0.5;

			}

			return w;

		}
	} ) );

}

function legRings( s, scale = 1, from = 0.0, to = 1.0, flare = 0 ) {

	const L = s > 0 ? 'L' : 'R';
	const R = [
		[ 0.99, 0.082, 0.084, 0.0 ], [ 0.9, 0.088, 0.09, 0.002 ], [ 0.78, 0.077, 0.08, 0.004 ], [ 0.66, 0.064, 0.066, 0.006 ], [ 0.56, 0.051, 0.054, 0.01 ],
		[ 0.48, 0.05, 0.055, 0.004 ], [ 0.38, 0.052, 0.058, - 0.01 ], [ 0.27, 0.039, 0.043, - 0.012 ], [ 0.17, 0.029, 0.031, - 0.02 ], [ 0.13, 0.028, 0.03, - 0.03 ]
	];
	return R.filter( ( r ) => r[ 0 ] >= from - 1e-6 && r[ 0 ] <= to + 1e-6 ).map( ( [ y, rx, rz, z ] ) => {

		const x = s * ( 0.092 + ( 0.955 - Math.min( 0.955, y ) ) / 0.825 * 0.013 );
		const fl = flare ? Math.max( 0, ( 0.5 - y ) ) * flare : 0;
		return {
			c: [ x, y, z ], rx: rx * scale + fl, rz: rz * scale + fl,
			w: y > 0.93 ? lerpW( 'hips', 'thigh' + L, sm( 1.0, 0.93, y ) ) : y > 0.6 ? { [ 'thigh' + L ]: 1 } : y > 0.49 ? lerpW( 'thigh' + L, 'shin' + L, sm( 0.6, 0.49, y ) ) : y > 0.16 ? { [ 'shin' + L ]: 1 } : lerpW( 'shin' + L, 'foot' + L, sm( 0.16, 0.12, y ) )
		};

	} );

}

function armRings( s, scale = 1, cuff = 0.0 ) {

	const L = s > 0 ? 'L' : 'R';
	const S = BIND[ 'upperArm' + L ], E = BIND[ 'foreArm' + L ], H = BIND[ 'hand' + L ];
	const pt = ( a, b, t ) => a.clone().lerp( b, t ).toArray();
	const rings = [
		{ c: [ S.x - s * 0.02, S.y + 0.02, S.z ], rx: 0.05, rz: 0.052, w: lerpW( 'shoulder' + L, 'upperArm' + L, 0.6 ) },
		{ c: pt( S, E, 0.15 ), rx: 0.046, rz: 0.048, w: { [ 'upperArm' + L ]: 1 } },
		{ c: pt( S, E, 0.55 ), rx: 0.04, rz: 0.042, w: { [ 'upperArm' + L ]: 1 } },
		{ c: pt( S, E, 0.95 ), rx: 0.034, rz: 0.036, w: lerpW( 'upperArm' + L, 'foreArm' + L, 0.5 ) },
		{ c: pt( E, H, 0.25 ), rx: 0.036, rz: 0.035, w: { [ 'foreArm' + L ]: 1 } },
		{ c: pt( E, H, 0.9 ), rx: 0.025 + cuff, rz: 0.022 + cuff, w: lerpW( 'foreArm' + L, 'hand' + L, 0.3 ) }
	];
	return rings.map( ( r ) => ( { ...r, rx: r.rx * scale, rz: r.rz * scale } ) );

}

function handGeo( s ) {

	const L = s > 0 ? 'L' : 'R';
	const H = BIND[ 'hand' + L ], T = new THREE.Vector3( ...TIPS[ 'hand' + L ] );
	const pt = ( t ) => H.clone().lerp( T, t ).toArray();
	return loft( [
		{ c: pt( 0.0 ), rx: 0.024, rz: 0.018, w: { [ 'hand' + L ]: 1 } },
		{ c: pt( 0.3 ), rx: 0.038, rz: 0.016, w: { [ 'hand' + L ]: 1 } },
		{ c: pt( 0.6 ), rx: 0.036, rz: 0.013, w: { [ 'hand' + L ]: 1 } },
		{ c: pt( 0.92 ), rx: 0.024, rz: 0.009, w: { [ 'hand' + L ]: 1 } },
		{ c: pt( 1.0 ), rx: 0.01, rz: 0.006, w: { [ 'hand' + L ]: 1 } }
	], { radial: 12, side: [ 0, 0, 1 ], capStart: true, capEnd: true } );

}

function footGeo( s, heel = 0.1 ) {

	const L = s > 0 ? 'L' : 'R';
	const x = s * 0.106;
	const w = { [ 'foot' + L ]: 1 };
	const shoe = loft( [
		{ c: [ x, 0.15, - 0.04 ], rx: 0.03, rz: 0.034, w },
		{ c: [ x, 0.1, - 0.035 ], rx: 0.033, rz: 0.042, w },
		{ c: [ x, 0.06, 0.02 ], rx: 0.036, rz: 0.03, w },
		{ c: [ x, 0.03, 0.08 ], rx: 0.036, rz: 0.022, w },
		{ c: [ x, 0.016, 0.13 ], rx: 0.03, rz: 0.017, w },
		{ c: [ x, 0.012, 0.165 ], rx: 0.012, rz: 0.01, w }
	], { radial: 14, side: [ 1, 0, 0 ], capEnd: true } );
	const spike = rigid( new THREE.CylinderGeometry( 0.009, 0.004, heel, 8 ).translate( x, heel / 2, - 0.058 ), 'foot' + L );
	const sole = rigid( new THREE.BoxGeometry( 0.05, 0.006, 0.07 ).rotateX( - 0.35 ).translate( x, 0.035, 0.07 ), 'foot' + L );
	return mergeSkinned( [ shoe, spike, sole ] );

}

function headGeo() {

	const g = new THREE.SphereGeometry( 1, 56, 42 );
	const p = g.attributes.position;
	const v = new THREE.Vector3();
	const G2 = ( x, y, sx, sy ) => Math.exp( - ( x * x ) / ( sx * sx ) - ( y * y ) / ( sy * sy ) );
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		let { x, y, z } = v;
		if ( y < 0 ) {

			x *= 1 - 0.3 * Math.pow( - y, 1.4 );
			if ( z > 0 ) z *= 1 + 0.04 * - y; else z *= 1 - 0.18 * - y;

		}

		if ( z > 0.2 && y > - 0.4 && y < 0.2 ) x *= 1 + 0.05 * Math.exp( - Math.pow( ( y + 0.1 ) / 0.15, 2 ) ); // cheekbones
		if ( z > 0 && y > 0.25 ) z *= 0.96;
		if ( z < 0 ) z *= 1.05;
		if ( z > 0.3 ) {

			const front = Math.min( 1, ( z - 0.3 ) / 0.4 );
			// nose: bridge → tip
			const ny = y < - 0.27 ? Math.exp( - Math.pow( ( y + 0.27 ) / 0.06, 2 ) ) : Math.max( 0, Math.min( 1, ( 0.18 - y ) / 0.45 ) );
			z += front * 0.13 * Math.exp( - ( x * x ) / ( 0.1 * 0.1 ) ) * Math.pow( ny, 1.4 );
			z += front * 0.03 * G2( Math.abs( x ) - 0.1, y + 0.25, 0.06, 0.06 ); // nostril wings
			// eye sockets & brow ridge
			z -= front * 0.045 * G2( Math.abs( x ) - 0.42, y - 0.1, 0.17, 0.12 );
			z += front * 0.03 * G2( Math.abs( x ) - 0.38, y - 0.33, 0.28, 0.07 );
			// lips & chin
			z += front * 0.06 * G2( x, y + 0.52, 0.24, 0.06 );
			z += front * 0.045 * G2( x, y + 0.62, 0.2, 0.06 );
			z -= front * 0.02 * G2( x, y + 0.57, 0.24, 0.015 );
			z += front * 0.035 * G2( x, y + 0.84, 0.22, 0.1 );

		}

		p.setXYZ( i, x * 0.073, y * 0.102 + 1.66, z * 0.089 + 0.01 );

	}

	g.computeVertexNormals();
	return rigid( g, 'head' );

}

/** Painted make-up: eyes, lashes, brows, lips, blush. Mapped by planar projection on the face. */
const faceTexCache = new Map();
function faceTexture( o ) {

	const key = [ o.lips, o.eyes, o.shadow ].join( '_' );
	if ( faceTexCache.has( key ) ) return faceTexCache.get( key );
	const S = 512;
	const c = document.createElement( 'canvas' ); c.width = c.height = S;
	const g = c.getContext( '2d' );
	const X = ( x ) => ( x + 0.08 ) / 0.16 * S, Y = ( y ) => ( 1 - ( y - 1.56 ) / 0.22 ) * S;
	const hex = ( n ) => '#' + n.toString( 16 ).padStart( 6, '0' );
	// blush
	for ( const s of [ - 1, 1 ] ) {

		const gr = g.createRadialGradient( X( s * 0.05 ), Y( 1.642 ), 0, X( s * 0.05 ), Y( 1.642 ), 60 );
		gr.addColorStop( 0, 'rgba(220,90,100,0.35)' ); gr.addColorStop( 1, 'rgba(220,90,100,0)' );
		g.fillStyle = gr; g.fillRect( 0, 0, S, S );

	}

	for ( const s of [ - 1, 1 ] ) {

		const ex = X( s * 0.031 ), ey = Y( 1.671 );
		// smoky eye shadow
		const sh = g.createRadialGradient( ex + s * 6, ey - 14, 2, ex + s * 6, ey - 10, 46 );
		sh.addColorStop( 0, o.shadow + 'cc' ); sh.addColorStop( 1, o.shadow + '00' );
		g.fillStyle = sh; g.beginPath(); g.ellipse( ex + s * 6, ey - 10, 48, 26, 0, 0, Math.PI * 2 ); g.fill();
		// sclera (almond)
		g.fillStyle = '#f4efe9';
		g.beginPath(); g.moveTo( ex - 26, ey + 2 ); g.quadraticCurveTo( ex, ey - 17, ex + 26, ey - 2 ); g.quadraticCurveTo( ex, ey + 13, ex - 26, ey + 2 ); g.fill();
		// iris + pupil + catch light
		const ir = g.createRadialGradient( ex, ey - 1, 2, ex, ey - 1, 10 );
		ir.addColorStop( 0, hex( o.eyes ) ); ir.addColorStop( 1, '#1c120c' );
		g.fillStyle = ir; g.beginPath(); g.arc( ex, ey - 1, 10, 0, Math.PI * 2 ); g.fill();
		g.fillStyle = '#050505'; g.beginPath(); g.arc( ex, ey - 1, 4.2, 0, Math.PI * 2 ); g.fill();
		g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc( ex - 3, ey - 4, 2, 0, Math.PI * 2 ); g.fill();
		// eyeliner with a wing + lashes
		g.strokeStyle = '#080404'; g.lineCap = 'round';
		g.lineWidth = 5; g.beginPath(); g.moveTo( ex - s * 26, ey + 2 ); g.quadraticCurveTo( ex, ey - 19, ex + s * 26, ey - 3 ); g.lineTo( ex + s * 38, ey - 12 ); g.stroke();
		g.lineWidth = 2;
		for ( let k = 0; k < 9; k ++ ) { const t = k / 8; const lx = ex - s * 22 + s * 44 * t; const ly = ey - 12 * Math.sin( t * Math.PI ) - 2; g.beginPath(); g.moveTo( lx, ly ); g.lineTo( lx + s * 5, ly - 7 ); g.stroke(); }
		g.lineWidth = 1.5; g.beginPath(); g.moveTo( ex - 22, ey + 5 ); g.quadraticCurveTo( ex, ey + 12, ex + 22, ey + 3 ); g.stroke();
		// brow
		g.strokeStyle = '#2a1a12'; g.lineWidth = 6;
		g.beginPath(); g.moveTo( X( s * 0.012 ), Y( 1.688 ) ); g.quadraticCurveTo( X( s * 0.036 ), Y( 1.699 ), X( s * 0.054 ), Y( 1.689 ) ); g.stroke();

	}

	// lips (cupid's bow)
	const lx = X( 0 ), ly = Y( 1.604 );
	const lg = g.createLinearGradient( 0, ly - 16, 0, ly + 16 );
	lg.addColorStop( 0, hex( o.lips ) ); lg.addColorStop( 0.5, '#3a0508' ); lg.addColorStop( 0.55, hex( o.lips ) ); lg.addColorStop( 1, hex( o.lips ) );
	g.fillStyle = lg;
	g.beginPath();
	g.moveTo( lx - 44, ly );
	g.quadraticCurveTo( lx - 24, ly - 19, lx - 7, ly - 15 ); g.quadraticCurveTo( lx, ly - 9, lx + 7, ly - 15 ); g.quadraticCurveTo( lx + 24, ly - 19, lx + 44, ly );
	g.quadraticCurveTo( lx + 22, ly + 24, lx, ly + 23 ); g.quadraticCurveTo( lx - 22, ly + 24, lx - 44, ly );
	g.fill();
	g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse( lx + 6, ly + 8, 10, 3, 0, 0, Math.PI * 2 ); g.fill();
	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 4;
	faceTexCache.set( key, t );
	return t;

}

function faceDetails( { glasses = false } ) {

	const dark = [], gold = [];
	for ( const s of [ - 1, 1 ] ) gold.push( rigid( new THREE.TorusGeometry( 0.011, 0.0022, 6, 16 ).rotateY( Math.PI / 2 ).translate( s * 0.074, 1.618, 0.0 ), 'head' ) );
	if ( glasses ) {

		for ( const s of [ - 1, 1 ] ) {

			const lens = new THREE.Shape();
			lens.moveTo( - 0.024, - 0.006 );
			lens.quadraticCurveTo( - 0.026, 0.014, - 0.004, 0.015 );
			lens.lineTo( 0.02, 0.016 );
			lens.quadraticCurveTo( 0.03, 0.012, 0.026, 0.0 );
			lens.quadraticCurveTo( 0.02, - 0.016, 0.0, - 0.016 );
			lens.quadraticCurveTo( - 0.02, - 0.016, - 0.024, - 0.006 );
			const g = new THREE.ExtrudeGeometry( lens, { depth: 0.003, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.001, bevelSegments: 1, curveSegments: 8 } );
			if ( s < 0 ) g.scale( - 1, 1, 1 );
			g.rotateY( s * 0.28 );
			g.translate( s * 0.031, 1.671, 0.083 );
			dark.push( rigid( g, 'head' ) );

		}

		dark.push( rigid( new THREE.BoxGeometry( 0.014, 0.003, 0.004 ).translate( 0, 1.679, 0.089 ), 'head' ) );
		for ( const s of [ - 1, 1 ] ) dark.push( rigid( new THREE.BoxGeometry( 0.003, 0.004, 0.095 ).translate( s * 0.071, 1.678, 0.03 ), 'head' ) );

	}

	return { dark: dark.length ? mergeSkinned( dark ) : null, gold: mergeSkinned( gold ) };

}

function hairGeo( style ) {

	const parts = [];
	// cap around the skull (open over the face)
	const cap = new THREE.SphereGeometry( 1, 28, 16, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * ( style === 'bob' ? 0.7 : 0.6 ) );
	cap.scale( 0.082, 0.112, 0.1 );
	cap.translate( 0, 1.672, 0.0 );
	parts.push( rigid( cap, 'head' ) );
	// fringe / side-swept bang
	const fr = new THREE.SphereGeometry( 1, 16, 8, Math.PI / 2 - 0.8, 1.2, 0, Math.PI * 0.32 );
	fr.scale( 0.083, 0.112, 0.103 );
	fr.translate( 0.004, 1.672, 0.0 );
	parts.push( rigid( fr, 'head' ) );
	if ( style === 'long' || style === 'waves' ) {

		const rings = [];
		const ys = [ 1.7, 1.62, 1.54, 1.46, 1.38, 1.3, 1.22 ];
		ys.forEach( ( y, i ) => {

			const t = i / ( ys.length - 1 );
			rings.push( {
				c: [ 0, y, - 0.03 - t * 0.09 ], rx: 0.086 + t * 0.05 + ( style === 'waves' ? Math.sin( t * 9 ) * 0.01 : 0 ), rz: 0.075 - t * 0.02,
				w: y > 1.52 ? { head: 1 } : y > 1.4 ? lerpW( 'head', 'chest', sm( 1.52, 1.4, y ) ) : { chest: 1 }
			} );

		} );
		parts.push( loft( rings, { radial: 18, arc: [ 0.25, Math.PI - 0.25 ] } ) );
		// strands falling over the front shoulders
		for ( const s of [ - 1, 1 ] ) {

			const r2 = [ 1.66, 1.56, 1.46, 1.36, 1.28 ].map( ( y, i ) => ( {
				c: [ s * ( 0.075 + i * 0.012 ), y, 0.0 + i * 0.012 ], rx: 0.02, rz: 0.028 - i * 0.003,
				w: y > 1.52 ? { head: 1 } : lerpW( 'head', 'chest', sm( 1.52, 1.4, y ) )
			} ) );
			parts.push( loft( r2, { radial: 10, capEnd: true } ) );

		}

	} else if ( style === 'ponytail' ) {

		const pts = [ [ 0, 1.72, - 0.09 ], [ 0, 1.66, - 0.14 ], [ 0, 1.56, - 0.15 ], [ 0, 1.45, - 0.14 ], [ 0, 1.34, - 0.13 ] ];
		parts.push( loft( pts.map( ( c, i ) => ( { c, rx: [ 0.028, 0.035, 0.032, 0.024, 0.01 ][ i ], rz: [ 0.028, 0.035, 0.03, 0.02, 0.008 ][ i ], w: i < 2 ? { head: 1 } : lerpW( 'head', 'chest', i / 4 ) } ) ), { radial: 12, side: [ 1, 0, 0 ], capEnd: true } ) );
		parts.push( rigid( new THREE.TorusGeometry( 0.024, 0.007, 8, 16 ).rotateX( 0.9 ).translate( 0, 1.715, - 0.1 ), 'head' ) );

	} else if ( style === 'bun' ) {

		parts.push( rigid( new THREE.SphereGeometry( 0.055, 16, 12 ).scale( 1, 0.85, 0.9 ).translate( 0, 1.75, - 0.09 ), 'head' ) );

	} else if ( style === 'bob' ) {

		const rings = [ 1.7, 1.63, 1.57 ].map( ( y, i ) => ( { c: [ 0, y, - 0.005 ], rx: 0.088 + i * 0.008, rz: 0.1 + i * 0.006, w: { head: 1 } } ) );
		parts.push( loft( rings, { radial: 22, arc: [ Math.PI * 1.5 + 0.8, Math.PI * 3.5 - 0.8 ] } ) );

	}

	return mergeSkinned( parts );

}

// ------------------------------------------------------------------ materials

const matCache = new Map();

function skinMat( tone = 0xf1c9ae, face = null ) {

	const key = 'skin' + tone + ( face ? face.uuid : '' );
	if ( matCache.has( key ) ) return matCache.get( key );
	const m = new THREE.MeshPhysicalNodeMaterial();
	const n = mx_fractal_noise_float( positionLocal.mul( 60 ), 3 ).mul( 0.5 ).add( 0.5 );
	let base = color( tone ).mul( n.mul( 0.08 ).add( 0.94 ) );
	if ( face ) {

		const fuv = vec2( positionLocal.x.add( 0.08 ).div( 0.16 ), positionLocal.y.sub( 1.56 ).div( 0.22 ) );
		const ft = texture( face, fuv );
		const mask = smoothstep( 1.575, 1.59, positionLocal.y ).mul( smoothstep( 0.03, 0.06, positionLocal.z ) ).mul( smoothstep( 0.085, 0.07, abs( positionLocal.x ) ) );
		base = mix( base, ft.rgb, ft.a.mul( mask ) );
		const lipMask = ft.a.mul( mask ).mul( smoothstep( 1.62, 1.61, positionLocal.y ) ).mul( smoothstep( 1.585, 1.595, positionLocal.y ) );
		m.roughnessNode = float( 0.48 ).add( n.mul( 0.1 ) ).sub( lipMask.mul( 0.35 ) );

	}

	m.colorNode = base;
	if ( ! face ) m.roughnessNode = float( 0.48 ).add( n.mul( 0.1 ) );
	m.metalnessNode = float( 0 );
	m.sheen = 0.35;
	m.sheenRoughness = 0.5;
	m.sheenColor = new THREE.Color( 0xffd6c8 );
	m.specularIntensity = 0.5;
	matCache.set( key, m );
	return m;

}

function fabric( hex, { rough = 0.55, sheen = 0.6, clearcoat = 0, metal = 0, sequins = false, stockings = false, weave = 0 } = {} ) {

	const key = [ 'fab', hex, rough, sheen, clearcoat, metal, sequins, stockings, weave ].join( '_' );
	if ( matCache.has( key ) ) return matCache.get( key );
	const m = new THREE.MeshPhysicalNodeMaterial();
	if ( sequins ) {

		const P = positionLocal.mul( 260 );
		const cell = floor( P );
		const r = mx_cell_noise_float( cell );
		const r2 = mx_cell_noise_float( cell.add( 3.3 ) );
		m.colorNode = color( hex ).mul( r.mul( 0.6 ).add( 0.6 ) );
		m.metalnessNode = float( 0.9 );
		m.roughnessNode = float( 0.18 ).add( r2.mul( 0.2 ) );
		const f = fract( P );
		m.normalNode = bumpMap( f.x.sub( 0.5 ).mul( r.sub( 0.5 ) ).add( f.y.sub( 0.5 ).mul( r2.sub( 0.5 ) ) ), float( 0.5 ) );

	} else if ( stockings ) {

		// sheer black nylon over skin: darker where the fabric is seen edge-on
		const facing = abs( normalView.z );
		const denier = pow( oneMinus( facing ), float( 1.4 ) );
		m.colorNode = mix( color( 0xc79a86 ).mul( 0.55 ), color( hex ), clamp( denier.mul( 1.2 ).add( 0.35 ), 0, 1 ) );
		m.roughnessNode = float( 0.42 );
		m.metalnessNode = float( 0 );
		m.sheen = 0.8; m.sheenRoughness = 0.3; m.sheenColor = new THREE.Color( 0x777777 );

	} else {

		const n = mx_noise_float( positionLocal.mul( 90 ) ).mul( 0.5 ).add( 0.5 );
		const folds = mx_fractal_noise_float( positionLocal.mul( vec3( 12, 4, 12 ) ), 2 ).mul( 0.5 ).add( 0.5 );
		m.colorNode = color( hex ).mul( folds.mul( 0.25 ).add( 0.85 ) ).mul( n.mul( 0.06 ).add( 0.97 ) );
		m.roughnessNode = float( rough ).add( n.mul( 0.05 ) );
		m.metalnessNode = float( metal );
		if ( weave ) m.normalNode = bumpMap( mx_noise_float( positionLocal.mul( 900 ) ), float( weave ) );
		if ( sheen ) { m.sheen = sheen; m.sheenRoughness = 0.35; m.sheenColor = new THREE.Color( hex ).lerp( new THREE.Color( 0xffffff ), 0.4 ); }
		if ( clearcoat ) { m.clearcoat = clearcoat; m.clearcoatRoughness = 0.15; }

	}

	matCache.set( key, m );
	return m;

}

function hairMat( hex ) {

	const key = 'hair' + hex;
	if ( matCache.has( key ) ) return matCache.get( key );
	const m = new THREE.MeshPhysicalNodeMaterial();
	const strands = mx_noise_float( vec3( positionLocal.x.mul( 420 ), positionLocal.y.mul( 14 ), positionLocal.z.mul( 420 ) ) ).mul( 0.5 ).add( 0.5 );
	const tint = mx_fractal_noise_float( positionLocal.mul( 18 ), 2 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = color( hex ).mul( strands.mul( 0.45 ).add( 0.7 ) ).mul( tint.mul( 0.25 ).add( 0.85 ) );
	m.roughnessNode = float( 0.4 ).add( strands.mul( 0.15 ) );
	m.metalnessNode = float( 0 );
	m.sheen = 1; m.sheenRoughness = 0.25; m.sheenColor = new THREE.Color( hex ).lerp( new THREE.Color( 0xffffff ), 0.5 );
	m.normalNode = bumpMap( strands, float( 0.8 ) );
	m.side = THREE.DoubleSide;
	matCache.set( key, m );
	return m;

}

const simple = ( key, params ) => {

	if ( matCache.has( key ) ) return matCache.get( key );
	const m = new THREE.MeshPhysicalNodeMaterial( params );
	matCache.set( key, m );
	return m;

};

// ------------------------------------------------------------------ outfits

export const OUTFITS = {
	red_dress: { eyes: 0x3a78b8, shadow: '#7a3a3a', skin: 0xf3cdb4, hair: [ 'long', 0xe6c27a ], lips: 0xb0101c, glasses: false, dress: { top: 1.3, hem: 0.66, color: 0xb0101a, rough: 0.35, sheen: 0.8 }, legs: 'stockings', shoes: 0x8a0a12 },
	black_leather: { eyes: 0x4a8a5a, shadow: '#3a3a44', skin: 0xecc3a6, hair: [ 'ponytail', 0x120d0a ], lips: 0x7a0c16, glasses: true, catsuit: { color: 0x0c0c0e, rough: 0.28, clearcoat: 1 }, shoes: 0x0a0a0a },
	gold_gown: { eyes: 0x5a3a1a, shadow: '#a8742a', skin: 0xd9a488, hair: [ 'waves', 0x6a2c14 ], lips: 0xa01830, glasses: false, dress: { top: 1.3, hem: 0.1, color: 0xd6a640, sequins: true, slit: true }, legs: 'bare', shoes: 0xd6a640 },
	black_blazer: { eyes: 0x5a3a1a, shadow: '#5a4a40', skin: 0xe9c2a6, hair: [ 'long', 0x4a2d1b ], lips: 0xa85a5e, glasses: false, suit: { color: 0x0d0d10, rough: 0.55 }, shoes: 0x0a0a0a, doubleBreasted: true },
	white_suit: { eyes: 0x6a8ab8, shadow: '#6a5a6a', skin: 0xf6d6c3, hair: [ 'bob', 0xf2e8cf ], lips: 0xc0182a, glasses: true, suit: { color: 0xf1ede6, rough: 0.6 }, shoes: 0x111111 },
	red_coat: { eyes: 0x4a6a3a, shadow: '#5a3a2a', skin: 0xeec9b0, hair: [ 'long', 0x3a2215 ], lips: 0x9a1020, glasses: false, coat: { color: 0xc8231e, hem: 0.62 }, dressUnder: 0x15151a, legs: 'stockings', shoes: 0x111111 },
	emerald: { eyes: 0x3a2412, shadow: '#1f5a3a', skin: 0xc58d6e, hair: [ 'bun', 0x0b0806 ], lips: 0x8e0f25, glasses: false, dress: { top: 1.3, hem: 0.58, color: 0x0d6b4a, rough: 0.3, sheen: 0.9 }, legs: 'bare', shoes: 0x0d6b4a }
};

const geoCache = new Map();

function buildOutfitGeometry( key ) {

	if ( geoCache.has( key ) ) return geoCache.get( key );
	const o = OUTFITS[ key ];
	const L = {}; // material slot → geometry list
	const add = ( slot, g ) => ( L[ slot ] ||= [] ).push( g );
	// body (skin)
	const torsoSlot = o.catsuit ? 'outfit' : 'skin';
	add( torsoSlot, loft( torsoRings( 1 ), { radial: 26, capStart: true } ) );
	add( 'skin', loft( [ { c: [ 0, 1.44, - 0.02 ], rx: 0.05, rz: 0.048, w: lerpW( 'chest', 'neck', 0.4 ) }, { c: [ 0, 1.5, - 0.015 ], rx: 0.044, rz: 0.044, w: { neck: 1 } }, { c: [ 0, 1.585, 0.0 ], rx: 0.042, rz: 0.042, w: lerpW( 'neck', 'head', 0.7 ) } ], { radial: 16 } ) );
	add( 'skin', headGeo() );
	const legSlot = o.catsuit ? 'outfit' : o.legs === 'stockings' ? 'stockings' : 'skin';
	for ( const s of [ 1, - 1 ] ) {

		const legTop = o.dress ? ( o.dress.hem < 0.3 ? 0.62 : o.dress.hem + 0.1 ) : o.coat ? o.coat.hem + 0.1 : 1.0;
		add( legSlot, loft( legRings( s, 1, 0, legTop ), { radial: 18 } ) );
		add( o.catsuit ? 'outfit' : 'skin', loft( armRings( s ), { radial: 16, side: [ 0, 0, 1 ] } ) );
		add( o.catsuit ? 'outfit' : 'skin', handGeo( s ) );
		add( 'shoes', footGeo( s ) );

	}

	const face = faceDetails( { glasses: o.glasses } );
	if ( face.dark ) add( 'dark', face.dark );
	add( 'gold', face.gold );
	add( 'hair', hairGeo( o.hair[ 0 ] ) );
	// necklace
	add( 'gold', loft( Array.from( { length: 3 }, ( _, i ) => ( { c: [ 0, 1.43 - i * 0.0, 0.0 ], rx: 0.062, rz: 0.06, w: { chest: 1 } } ) ).map( ( r, i ) => ( { ...r, c: [ 0, 1.435 - i * 0.003, - 0.005 ], rx: r.rx + i * 0.0005 } ) ), { radial: 24 } ) );

	// ---- clothing layers
	if ( o.dress ) {

		const d = o.dress;
		add( 'outfit', loft( torsoRings( 1.06, 0.84, d.top ), { radial: 26 } ) );
		// skirt enclosing both legs
		const hemY = d.hem;
		const ys = [];
		for ( let y = 1.04; y > hemY; y -= 0.06 ) ys.push( y );
		ys.push( hemY );
		const skirt = ys.map( ( y ) => {

			const t = Math.max( 0, ( 0.9 - y ) / 0.8 );
			const top = sm( 0.9, 1.04, y );
			return {
				c: [ 0, y, - 0.008 ], rx: 0.195 + t * ( hemY < 0.3 ? 0.07 : 0.015 ) - top * 0.02, rz: 0.125 + t * ( hemY < 0.3 ? 0.06 : 0.008 ) - top * 0.01,
				w: ( th, p ) => {

					const side = sm( - 0.03, 0.06, Math.abs( p.x ) );
					const lower = sm( 0.86, 0.6, y );
					const L = p.x > 0 ? 'L' : 'R';
					const legW = side * lower;
					const knee = sm( 0.6, 0.45, y );
					const w = { hips: 1 - legW };
					w[ 'thigh' + L ] = legW * ( 1 - knee * 0.6 );
					if ( knee > 0 ) w[ 'shin' + L ] = legW * knee * 0.6;
					return w;

				},
				off: d.slit ? ( th ) => [ 0, Math.abs( th - 0.9 ) < 0.18 && y < 0.6 ? - 0.05 : 0 ] : null
			};

		} );
		add( 'outfit', loft( skirt, { radial: 30 } ) );
		// thin straps
		for ( const s of [ - 1, 1 ] ) add( 'outfit', rigid( new THREE.TorusGeometry( 0.075, 0.004, 4, 20, Math.PI ).rotateY( Math.PI / 2 ).translate( s * 0.1, 1.33, - 0.01 ), 'chest' ) );

	}

	if ( o.coat ) {

		add( 'underdress', loft( torsoRings( 1.04, 0.84, 1.3 ), { radial: 26 } ) );
		const coat = torsoRings( 1.14, 0.84, 1.466 );
		add( 'outfit', loft( coat, { radial: 26 } ) );
		const ys = [];
		for ( let y = 0.9; y > o.coat.hem; y -= 0.07 ) ys.push( y );
		ys.push( o.coat.hem );
		add( 'outfit', loft( ys.map( ( y ) => ( {
			c: [ 0, y, 0.0 ], rx: 0.2 + ( 0.9 - y ) * 0.12, rz: 0.13 + ( 0.9 - y ) * 0.09,
			w: ( th, p ) => { const side = sm( 0.0, 0.08, Math.abs( p.x ) ) * sm( 0.86, 0.6, y ) * 0.7; return { hips: 1 - side, [ p.x > 0 ? 'thighL' : 'thighR' ]: side }; }
		} ) ), { radial: 30 } ) );
		for ( const s of [ 1, - 1 ] ) add( 'outfit', loft( armRings( s, 1.28, 0.012 ), { radial: 16, side: [ 0, 0, 1 ] } ) );
		// belt + collar
		add( 'outfit', loft( [ 1.1, 1.14 ].map( ( y ) => ( { c: [ 0, y, - 0.01 ], rx: 0.148, rz: 0.1, w: lerpW( 'hips', 'spine', 0.5 ) } ) ), { radial: 26 } ) );
		add( 'outfit', loft( [ { c: [ 0, 1.44, - 0.02 ], rx: 0.08, rz: 0.075, w: { chest: 1 } }, { c: [ 0, 1.52, - 0.02 ], rx: 0.1, rz: 0.1, w: lerpW( 'chest', 'neck', 0.5 ) } ], { radial: 22, arc: [ Math.PI - 0.35, Math.PI * 2 + 0.35 ] } ) );

	}

	if ( o.suit ) {

		add( 'outfit', loft( torsoRings( 1.1, 0.84, 1.466 ), { radial: 26 } ) );
		for ( const s of [ 1, - 1 ] ) {

			add( 'outfit', loft( armRings( s, 1.22, 0.008 ), { radial: 16, side: [ 0, 0, 1 ] } ) );
			add( 'outfit', loft( legRings( s, 1.18, 0.13, 1.0, 0.06 ), { radial: 18 } ) );

		}

		// lapels (V-neck) & gold buttons
		for ( const s of [ - 1, 1 ] ) add( 'outfit', rigid( new THREE.BoxGeometry( 0.05, 0.2, 0.012 ).rotateZ( s * 0.35 ).translate( s * 0.05, 1.33, 0.108 ), 'chest' ) );
		if ( o.doubleBreasted ) {

			for ( let i = 0; i < 3; i ++ ) for ( const s of [ - 1, 1 ] ) add( 'gold', rigid( new THREE.CylinderGeometry( 0.009, 0.009, 0.004, 14 ).rotateX( Math.PI / 2 ).translate( s * 0.045, 1.1 + i * 0.07, 0.1 + i * 0.004 ), 'spine' ) );

		} else for ( let i = 0; i < 2; i ++ ) add( 'gold', rigid( new THREE.SphereGeometry( 0.008, 8, 6 ).translate( 0, 1.16 + i * 0.06, 0.1 ), 'spine' ) );

	}

	if ( o.catsuit ) {

		add( 'outfit', loft( [ 1.1, 1.13 ].map( ( y ) => ( { c: [ 0, y, - 0.01 ], rx: 0.128, rz: 0.086, w: lerpW( 'hips', 'spine', 0.5 ) } ) ), { radial: 26 } ) );
		add( 'gold', rigid( new THREE.BoxGeometry( 0.004, 0.36, 0.004 ).translate( 0, 1.2, 0.106 ), 'spine', 'chest', 0.5 ) );

	}

	const out = {};
	for ( const k in L ) out[ k ] = mergeSkinned( L[ k ] );
	geoCache.set( key, out );
	return out;

}

function outfitMaterials( key ) {

	const o = OUTFITS[ key ];
	const m = {
		skin: skinMat( o.skin, faceTexture( { lips: o.lips, eyes: o.eyes || 0x3d6b4a, shadow: o.shadow || '#6b4a3a' } ) ),
		hair: hairMat( o.hair[ 1 ] ),
		lips: simple( 'lips' + o.lips, { color: o.lips, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 } ),
		dark: simple( 'dark', { color: 0x050505, roughness: 0.15, metalness: 0.3, clearcoat: 1 } ),
		white: simple( 'eyewhite', { color: 0xf2f2f0, roughness: 0.2 } ),
		gold: simple( 'gold', { color: 0xe7b85a, roughness: 0.18, metalness: 1 } ),
		shoes: simple( 'shoe' + o.shoes, { color: o.shoes, roughness: 0.12, metalness: o.shoes === 0xd6a640 ? 1 : 0, clearcoat: 1, clearcoatRoughness: 0.05 } ),
		stockings: fabric( 0x0b0b0d, { stockings: true } ),
		underdress: fabric( o.dressUnder || 0x111111, { rough: 0.5, sheen: 0.4 } )
	};
	if ( o.dress ) m.outfit = fabric( o.dress.color, { rough: o.dress.rough ?? 0.35, sheen: o.dress.sheen ?? 0.6, sequins: o.dress.sequins } );
	if ( o.catsuit ) m.outfit = fabric( o.catsuit.color, { rough: o.catsuit.rough, sheen: 0.2, clearcoat: o.catsuit.clearcoat } );
	if ( o.suit ) m.outfit = fabric( o.suit.color, { rough: o.suit.rough, sheen: 0.3, weave: 0.4 } );
	if ( o.coat ) m.outfit = fabric( o.coat.color, { rough: 0.8, sheen: 0.7, weave: 0.6 } );
	return m;

}

// ------------------------------------------------------------------ character instance

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Femme {

	constructor( outfitKey ) {

		this.outfit = outfitKey;
		this.root = new THREE.Group();
		this.bones = {};
		const list = [];
		for ( const b of SK ) {

			const bone = new THREE.Bone();
			bone.name = b.name;
			const parent = b.parent ? this.bones[ b.parent ] : null;
			bone.position.copy( b.pos );
			if ( parent ) { bone.position.sub( BIND[ b.parent ] ); parent.add( bone ); } else this.root.add( bone );
			this.bones[ b.name ] = bone;
			list.push( bone );

		}

		this.root.updateMatrixWorld( true );
		this.skeleton = new THREE.Skeleton( list );
		const geos = buildOutfitGeometry( outfitKey );
		const mats = outfitMaterials( outfitKey );
		this.meshes = [];
		for ( const slot in geos ) {

			const mesh = new THREE.SkinnedMesh( geos[ slot ], mats[ slot ] || mats.skin );
			mesh.bind( this.skeleton );
			mesh.frustumCulled = false;
			this.root.add( mesh );
			this.meshes.push( mesh );

		}

		this.len = {
			upperArm: BIND.foreArmL.distanceTo( BIND.upperArmL ),
			foreArm: BIND.handL.distanceTo( BIND.foreArmL ),
			hand: new THREE.Vector3( ...TIPS.handL ).distanceTo( BIND.handL )
		};
		this.phase = Math.random() * 10;
		this.hipsBase = BIND.hips.y;
		this.react = new THREE.Vector3();
		this.reactV = new THREE.Vector3();
		this.ragdoll = null;
		this.wounds = [];

	}

	/** world position of a bone */
	bonePos( name, out = new THREE.Vector3() ) { return this.bones[ name ].getWorldPosition( out ); }

	// ------------------------------------------------------------------ procedural animation

	/**
	 * p: { dt, speed, strafe(-1..1), aim(0..1), target(Vector3 world), gripR(Vector3), gripL(Vector3|null), twoHanded, recoil, look(Vector3) }
	 */
	animate( p ) {

		const b = this.bones;
		const dt = p.dt;
		const sp = p.speed;
		const k = Math.min( 1, sp / 1.3 );
		const run = Math.min( 1, Math.max( 0, ( sp - 2 ) / 1.5 ) );
		this.phase += dt * sp / ( 1.25 + run * 0.4 ) * Math.PI * 2;
		const ph = this.phase;
		for ( const n in b ) b[ n ].quaternion.identity();
		// idle breathing / weight shift
		const t = performance.now() / 1000 + this.phase * 0.1;
		const idle = 1 - k;
		const Ath = 0.42 + run * 0.35;
		// legs (catwalk: thighs cross slightly towards the midline)
		const legPose = ( L, sgn, phase ) => {

			const sw = Math.sin( phase );
			const thighX = - Ath * sw * k + idle * ( L === 'L' ? - 0.05 : 0.08 );
			const knee = ( Math.max( 0, Math.sin( phase + 1.2 ) ) * ( 0.75 + run * 0.6 ) + 0.05 ) * k + idle * ( L === 'L' ? 0.18 : 0.02 );
			b[ 'thigh' + L ].quaternion.setFromEuler( _e.set( thighX, 0, sgn * ( - 0.05 * k * Math.max( 0, - sw ) - 0.02 * idle ) ) );
			b[ 'shin' + L ].quaternion.setFromEuler( _e.set( knee, 0, 0 ) );
			b[ 'foot' + L ].quaternion.setFromEuler( _e.set( - knee * 0.3 + Math.max( 0, sw ) * 0.15 * k, 0, 0 ) );

		};

		legPose( 'L', 1, ph );
		legPose( 'R', - 1, ph + Math.PI );
		// hips: bob, roll & sway (the famous catwalk hip swing)
		b.hips.position.y = this.hipsBase - 0.015 * k + Math.cos( ph * 2 ) * 0.018 * k - idle * 0.01;
		b.hips.position.x = Math.sin( ph ) * 0.025 * k + idle * Math.sin( t * 0.7 ) * 0.02;
		const hipRoll = Math.sin( ph ) * 0.1 * k + idle * 0.05;
		const hipYaw = Math.sin( ph ) * 0.12 * k;
		b.hips.quaternion.setFromEuler( _e.set( 0.04 * run, hipYaw, hipRoll ) );
		// torso counter-rotation + aim twist
		const aimW = p.aim || 0;
		const aimYaw = ( p.aimYaw || 0 ) * aimW;
		b.spine.quaternion.setFromEuler( _e.set( 0.02 + 0.06 * run, - hipYaw * 0.6 + aimYaw * 0.4, - hipRoll * 0.7 ) );
		const breath = Math.sin( t * 1.9 ) * 0.012;
		b.chest.quaternion.setFromEuler( _e.set( breath - 0.03 + ( p.aimPitch || 0 ) * aimW * 0.4, - hipYaw * 0.4 + aimYaw * 0.5, - hipRoll * 0.4 ) );
		// hit reaction (additive spring)
		this.reactV.addScaledVector( this.react, - 90 * dt ).multiplyScalar( Math.max( 0, 1 - 9 * dt ) );
		this.react.addScaledVector( this.reactV, dt );
		if ( this.react.lengthSq() > 1e-6 ) {

			_q.setFromEuler( _e.set( this.react.x, this.react.y, this.react.z ) );
			b.spine.quaternion.multiply( _q );
			b.chest.quaternion.multiply( _q );

		}

		// arms: default relaxed swing
		for ( const [ L, sgn, phase ] of [ [ 'L', 1, ph ], [ 'R', - 1, ph + Math.PI ] ] ) {

			b[ 'upperArm' + L ].quaternion.setFromEuler( _e.set( 0.3 * Math.sin( phase ) * k + idle * 0.05, 0, - sgn * ( 0.18 + 0.05 * idle ) ) );
			b[ 'foreArm' + L ].quaternion.setFromEuler( _e.set( - 0.25 - 0.25 * Math.max( 0, - Math.sin( phase ) ) * k, 0, 0 ) );

		}

		this.root.updateMatrixWorld( true );
		// aiming arms via two-bone IK
		if ( p.gripR ) {

			this.ik( 'R', p.gripR, p.poleR );
			if ( p.gripL ) this.ik( 'L', p.gripL, p.poleL );

		}

		// head looks at the target
		if ( p.look ) {

			const head = b.head;
			head.parent.getWorldQuaternion( _q2 );
			head.getWorldPosition( _v );
			_v2.copy( p.look ).sub( _v ).normalize().applyQuaternion( _q2.invert() );
			const yaw = THREE.MathUtils.clamp( Math.atan2( _v2.x, _v2.z ), - 1.0, 1.0 );
			const pitch = THREE.MathUtils.clamp( - Math.asin( THREE.MathUtils.clamp( _v2.y, - 1, 1 ) ), - 0.6, 0.5 );
			b.neck.quaternion.setFromEuler( _e.set( pitch * 0.4, yaw * 0.4, 0 ) );
			head.quaternion.setFromEuler( _e.set( pitch * 0.6, yaw * 0.6, Math.sin( t * 0.9 ) * 0.03 ) );
			this.root.updateMatrixWorld( true );

		}

	}

	/** Point a bone (in world space) along `dirWorld`. */
	aimBone( name, dirWorld ) {

		const bone = this.bones[ name ];
		bone.parent.getWorldQuaternion( _q2 );
		_v3.copy( dirWorld ).applyQuaternion( _q2.invert() ).normalize();
		bone.quaternion.setFromUnitVectors( REST_DIR[ name ], _v3 );
		bone.updateMatrixWorld( true );

	}

	ik( L, target, pole ) {

		const up = this.bones[ 'upperArm' + L ];
		const S = up.getWorldPosition( new THREE.Vector3() );
		const l1 = this.len.upperArm, l2 = this.len.foreArm + 0.04;
		const d = Math.min( S.distanceTo( target ), ( l1 + l2 ) * 0.999 );
		const dir = target.clone().sub( S ).normalize();
		const cosA = THREE.MathUtils.clamp( ( l1 * l1 + d * d - l2 * l2 ) / ( 2 * l1 * d ), - 1, 1 );
		const a = Math.acos( cosA );
		const P = pole || S.clone().add( new THREE.Vector3( L === 'L' ? 0.4 : - 0.4, - 0.6, - 0.2 ).applyQuaternion( this.root.quaternion ) );
		const n = new THREE.Vector3().crossVectors( dir, P.clone().sub( S ) ).normalize();
		const bend = new THREE.Vector3().crossVectors( n, dir ).normalize();
		const E = S.clone().addScaledVector( dir, Math.cos( a ) * l1 ).addScaledVector( bend, Math.sin( a ) * l1 );
		this.aimBone( 'upperArm' + L, E.clone().sub( S ) );
		this.aimBone( 'foreArm' + L, target.clone().sub( E ) );
		this.aimBone( 'hand' + L, target.clone().sub( E ) );

	}

	hitReact( dirLocal, strength ) {

		this.reactV.x += ( dirLocal.z ) * strength * 6;
		this.reactV.y += ( Math.random() - 0.5 ) * strength * 5;
		this.reactV.z += - dirLocal.x * strength * 6;

	}

	// ------------------------------------------------------------------ ragdoll

	startRagdoll( impulse, hitPoint ) {

		this.root.updateMatrixWorld( true );
		const b = this.bones;
		const P = ( n ) => b[ n ].getWorldPosition( new THREE.Vector3() );
		const tipW = ( n, local ) => b[ n ].localToWorld( new THREE.Vector3( ...local ).sub( BIND[ n ] ) );
		const pts = {
			pelvis: P( 'hips' ), chest: P( 'chest' ), neck: P( 'neck' ), head: tipW( 'head', TIPS.head ),
			shL: P( 'upperArmL' ), elL: P( 'foreArmL' ), haL: P( 'handL' ), shR: P( 'upperArmR' ), elR: P( 'foreArmR' ), haR: P( 'handR' ),
			hiL: P( 'thighL' ), knL: P( 'shinL' ), anL: P( 'footL' ), toL: tipW( 'footL', TIPS.footL ),
			hiR: P( 'thighR' ), knR: P( 'shinR' ), anR: P( 'footR' ), toR: tipW( 'footR', TIPS.footR )
		};
		const R = { pos: {}, prev: {}, names: Object.keys( pts ), sticks: [], mins: [], rest: 0, frozen: false };
		for ( const n of R.names ) { R.pos[ n ] = pts[ n ].clone(); R.prev[ n ] = pts[ n ].clone(); }
		const stick = ( a, b2, stiff = 1 ) => R.sticks.push( [ a, b2, R.pos[ a ].distanceTo( R.pos[ b2 ] ), stiff ] );
		stick( 'pelvis', 'chest' ); stick( 'chest', 'neck' ); stick( 'neck', 'head' ); stick( 'chest', 'head', 0.5 );
		stick( 'chest', 'shL' ); stick( 'chest', 'shR' ); stick( 'shL', 'shR' ); stick( 'neck', 'shL', 0.7 ); stick( 'neck', 'shR', 0.7 );
		stick( 'pelvis', 'hiL' ); stick( 'pelvis', 'hiR' ); stick( 'hiL', 'hiR' );
		stick( 'shL', 'hiL' ); stick( 'shR', 'hiR' ); stick( 'shL', 'hiR', 0.8 ); stick( 'shR', 'hiL', 0.8 ); stick( 'chest', 'hiL', 0.8 ); stick( 'chest', 'hiR', 0.8 );
		stick( 'shL', 'elL' ); stick( 'elL', 'haL' ); stick( 'shR', 'elR' ); stick( 'elR', 'haR' );
		stick( 'hiL', 'knL' ); stick( 'knL', 'anL' ); stick( 'anL', 'toL' ); stick( 'hiR', 'knR' ); stick( 'knR', 'anR' ); stick( 'anR', 'toR' );
		stick( 'knL', 'toL', 0.3 ); stick( 'knR', 'toR', 0.3 );
		// joint-limit helpers: keep knees/elbows from folding completely
		R.mins.push( [ 'hiL', 'anL', R.pos.hiL.distanceTo( R.pos.anL ) * 0.55 ], [ 'hiR', 'anR', R.pos.hiR.distanceTo( R.pos.anR ) * 0.55 ] );
		R.mins.push( [ 'shL', 'haL', R.pos.shL.distanceTo( R.pos.haL ) * 0.45 ], [ 'shR', 'haR', R.pos.shR.distanceTo( R.pos.haR ) * 0.45 ] );
		R.mins.push( [ 'head', 'pelvis', R.pos.head.distanceTo( R.pos.pelvis ) * 0.8 ] );
		// initial velocity: bullet impulse applied mostly to the struck region
		const dtAssumed = 1 / 60;
		for ( const n of R.names ) {

			const d = hitPoint ? Math.max( 0.3, 1 - R.pos[ n ].distanceTo( hitPoint ) * 1.4 ) : 0.6;
			R.prev[ n ].addScaledVector( impulse, - d * dtAssumed );
			if ( this.lastVel ) R.prev[ n ].addScaledVector( this.lastVel, - dtAssumed );

		}

		// knees buckle first
		R.prev.knL.z -= 0.004; R.prev.knR.z -= 0.004;
		this.ragdoll = R;
		// bind-space rest directions for torso frame reconstruction
		this.rdRight = BIND.upperArmL.clone().sub( BIND.upperArmR ).normalize();

	}

	stepRagdoll( dt, floorY, collide ) {

		const R = this.ragdoll;
		if ( ! R || R.frozen ) return;
		const sub = 2;
		const h = dt / sub;
		for ( let s = 0; s < sub; s ++ ) {

			for ( const n of R.names ) {

				const p = R.pos[ n ], q = R.prev[ n ];
				const vx = ( p.x - q.x ) * 0.995, vy = ( p.y - q.y ) * 0.995, vz = ( p.z - q.z ) * 0.995;
				q.copy( p );
				p.x += vx; p.y += vy - 9.81 * h * h; p.z += vz;

			}

			for ( let it = 0; it < 8; it ++ ) {

				for ( const [ a, b2, len, st ] of R.sticks ) {

					const pa = R.pos[ a ], pb = R.pos[ b2 ];
					_v.subVectors( pb, pa );
					const d = _v.length() || 1e-5;
					const diff = ( d - len ) / d * 0.5 * st;
					pa.addScaledVector( _v, diff ); pb.addScaledVector( _v, - diff );

				}

				for ( const [ a, b2, min ] of R.mins ) {

					const pa = R.pos[ a ], pb = R.pos[ b2 ];
					_v.subVectors( pb, pa );
					const d = _v.length() || 1e-5;
					if ( d < min ) { const diff = ( d - min ) / d * 0.5; pa.addScaledVector( _v, diff ); pb.addScaledVector( _v, - diff ); }

				}

				for ( const n of R.names ) {

					const p = R.pos[ n ];
					const r = n === 'head' ? 0.09 : n === 'pelvis' || n === 'chest' ? 0.11 : 0.05;
					const fy = floorY( p.x, p.z ) + r;
					if ( p.y < fy ) {

						p.y = fy;
						// friction
						const q = R.prev[ n ];
						q.x = p.x - ( p.x - q.x ) * 0.6; q.z = p.z - ( p.z - q.z ) * 0.6;

					}

					if ( collide ) { const c = collide( p.x, p.z, r ); p.x = c.x; p.z = c.z; }

				}

			}

		}

		// settle detection
		let e = 0;
		for ( const n of R.names ) e += R.pos[ n ].distanceToSquared( R.prev[ n ] );
		R.rest = e < 1e-7 ? R.rest + dt : 0;
		if ( R.rest > 1.2 ) R.frozen = true;
		this.applyRagdoll();

	}

	applyRagdoll() {

		const R = this.ragdoll, P = R.pos, b = this.bones;
		// root stays where it is; compute torso frames in world space
		const frame = ( up, right ) => {

			const u = up.clone().normalize();
			const r = right.clone().addScaledVector( u, - right.dot( u ) ).normalize();
			const f = new THREE.Vector3().crossVectors( r, u ).normalize();
			return new THREE.Quaternion().setFromRotationMatrix( _m.makeBasis( r, u, f ) );

		};

		const qHips = frame( P.chest.clone().sub( P.pelvis ), P.hiL.clone().sub( P.hiR ) );
		const qChest = frame( P.neck.clone().sub( P.chest ), P.shL.clone().sub( P.shR ) );
		const qHead = frame( P.head.clone().sub( P.neck ), P.shL.clone().sub( P.shR ) );
		this.root.updateMatrixWorld( true );
		this.root.getWorldQuaternion( _q2 );
		const invRoot = _q2.clone().invert();
		// hips world position
		b.hips.position.copy( this.root.worldToLocal( P.pelvis.clone() ) );
		b.hips.quaternion.copy( invRoot ).multiply( qHips );
		b.hips.updateMatrixWorld( true );
		const setWorldQ = ( name, qW ) => {

			const bone = b[ name ];
			bone.parent.getWorldQuaternion( _q );
			bone.quaternion.copy( _q.invert() ).multiply( qW );
			bone.updateMatrixWorld( true );

		};

		const qSpine = qHips.clone().slerp( qChest, 0.5 );
		setWorldQ( 'spine', qSpine );
		setWorldQ( 'chest', qChest );
		setWorldQ( 'neck', qChest.clone().slerp( qHead, 0.5 ) );
		setWorldQ( 'head', qHead );
		const limb = ( name, a, c ) => {

			// world rest direction is REST_DIR rotated by the bind (identity) → align it with a→c, keeping the torso twist
			const parentQ = b[ name ].parent.getWorldQuaternion( new THREE.Quaternion() );
			const restW = REST_DIR[ name ].clone().applyQuaternion( parentQ );
			const qd = new THREE.Quaternion().setFromUnitVectors( restW, P[ c ].clone().sub( P[ a ] ).normalize() );
			setWorldQ( name, qd.multiply( parentQ ) );

		};

		limb( 'upperArmL', 'shL', 'elL' ); limb( 'foreArmL', 'elL', 'haL' );
		limb( 'upperArmR', 'shR', 'elR' ); limb( 'foreArmR', 'elR', 'haR' );
		limb( 'thighL', 'hiL', 'knL' ); limb( 'shinL', 'knL', 'anL' ); limb( 'footL', 'anL', 'toL' );
		limb( 'thighR', 'hiR', 'knR' ); limb( 'shinR', 'knR', 'anR' ); limb( 'footR', 'anR', 'toR' );

	}

	// ------------------------------------------------------------------ hit capsules

	/** Capsules in world space: [zone, boneA, boneB|null, radius, boneForWound] */
	capsules() {

		const b = this.bones;
		const W = ( n ) => b[ n ].getWorldPosition( new THREE.Vector3() );
		const headC = b.head.localToWorld( new THREE.Vector3( 0, 0.1, 0.012 ) );
		const list = [
			[ 'head', headC, null, 0.105, 'head' ],
			[ 'head', W( 'neck' ), W( 'head' ), 0.055, 'neck' ],
			[ 'body', W( 'spine' ), W( 'neck' ), 0.15, 'chest' ],
			[ 'body', W( 'hips' ), W( 'spine' ), 0.155, 'hips' ]
		];
		for ( const L of [ 'L', 'R' ] ) {

			list.push( [ 'limb', W( 'upperArm' + L ), W( 'foreArm' + L ), 0.052, 'upperArm' + L ] );
			list.push( [ 'limb', W( 'foreArm' + L ), W( 'hand' + L ), 0.045, 'foreArm' + L ] );
			list.push( [ 'limb', W( 'thigh' + L ), W( 'shin' + L ), 0.085, 'thigh' + L ] );
			list.push( [ 'limb', W( 'shin' + L ), W( 'foot' + L ), 0.06, 'shin' + L ] );

		}

		return list;

	}

	dispose() {

		this.root.removeFromParent();
		// geometries & materials are cached and shared between characters

	}

}

const _e = new THREE.Euler();

export { BONE_INDEX, BIND, TIPS };
