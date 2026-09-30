// Procedural PBR materials written in TSL (three.js shading language).
// Everything is evaluated on the GPU: no texture memory, no visible tiling, infinite detail.
import * as THREE from 'three/webgpu';
import {
	float, vec2, vec3, color, uniform, positionWorld, positionLocal, uv,
	mix, smoothstep, step, sin, abs, floor, fract, mod, clamp, min, pow, length,
	mx_fractal_noise_float, mx_worley_noise_float, mx_cell_noise_float, mx_noise_float,
	bumpMap, texture, oneMinus
} from 'three/tsl';

const C = ( hex ) => color( new THREE.Color( hex ) );

// ---------------------------------------------------------------- stone

/** Veined polished marble. */
export function marble( {
	base = 0xe9e0cf, base2 = 0xd8ccb4, vein = 0x8d7f6a, scale = 1.2, veinWidth = 7,
	rough = 0.14, local = false, bump = 0.0015, clearcoat = 0.0
} = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const P = ( local ? positionLocal : positionWorld ).mul( scale );
	const warp = mx_fractal_noise_float( P.mul( 0.55 ), 4, 2.0, 0.5 );
	const band = sin( P.x.mul( 1.7 ).add( P.y.mul( 0.9 ) ).add( P.z.mul( 1.3 ) ).add( warp.mul( 5.0 ) ) );
	const vein1 = pow( oneMinus( abs( band ) ), float( veinWidth ) );
	const fine = pow( oneMinus( abs( mx_noise_float( P.mul( 3.1 ) ) ) ), float( 18 ) ).mul( 0.6 );
	const cloud = mx_fractal_noise_float( P.mul( 1.7 ), 3, 2.0, 0.55 ).mul( 0.5 ).add( 0.5 );
	const veinMask = clamp( vein1.add( fine ), 0, 1 );
	m.colorNode = mix( mix( C( base2 ), C( base ), cloud ), C( vein ), veinMask.mul( 0.85 ) );
	m.roughnessNode = float( rough ).add( cloud.mul( 0.05 ) ).add( veinMask.mul( 0.08 ) );
	m.metalnessNode = float( 0 );
	if ( bump > 0 ) m.normalNode = bumpMap( veinMask.mul( - 1 ), float( bump * 60 ) );
	if ( clearcoat ) {

		m.clearcoat = clearcoat;
		m.clearcoatRoughness = 0.05;

	}

	return m;

}

/**
 * Polished granite floor with a tile pattern. `pattern(cellXZ, absZ)` → tile colour index (0..n-1).
 */
export function graniteFloor( { tile = 1.25, gridFn = null, colors = [ 0x6e6663, 0x8b3d34, 0xb8b2aa ], patternFn = null, rough = 0.07 } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const xz = positionWorld.xz;
	const t = gridFn ? gridFn( xz ) : xz.div( tile );
	const cell = floor( t );
	const f = fract( t );
	const idx = patternFn ? patternFn( cell, xz, t ) : mod( cell.x.add( cell.y ), 2 );

	let col = C( colors[ 0 ] );
	for ( let i = 1; i < colors.length; i ++ ) col = mix( col, C( colors[ i ] ), step( i - 0.5, idx ).mul( step( idx, i + 0.5 ) ) );

	// granite crystals: two scales of cellular noise + fine grain
	const crystals = mx_worley_noise_float( xz.mul( 38 ) );
	const grain = mx_cell_noise_float( xz.mul( 140 ) );
	const tint = mx_cell_noise_float( cell.add( 17.3 ) ).sub( 0.5 ).mul( 0.12 );
	const speck = smoothstep( 0.55, 0.95, grain ).mul( 0.35 ).sub( smoothstep( 0.0, 0.25, crystals ).oneMinus().mul( 0.25 ) );
	col = col.mul( float( 1 ).add( speck ).add( tint ) );

	// grout lines
	const e = min( min( f.x, oneMinus( f.x ) ), min( f.y, oneMinus( f.y ) ) );
	const grout = smoothstep( 0.0, 0.005, e );
	col = mix( col.mul( 0.35 ), col, grout );

	// wear: foot traffic dulls the polish in large soft patches
	const wear = mx_fractal_noise_float( xz.mul( 0.18 ), 3, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = col;
	m.roughnessNode = float( rough ).add( smoothstep( 0.45, 0.9, wear ).mul( 0.12 ) ).add( oneMinus( grout ).mul( 0.5 ) ).add( grain.mul( 0.03 ) );
	m.metalnessNode = float( 0 );
	m.normalNode = bumpMap( grout.mul( 0.5 ).add( grain.mul( 0.02 ) ), float( 0.25 ) );
	m.envMapIntensity = 0.6;
	return m;

}

/** Painted plaster (vault ceilings). */
export function plaster( { tint = 0xe8c65a, rough = 0.75, scale = 3, dirt = 0.12 } = {} ) {

	const m = new THREE.MeshStandardNodeMaterial();
	const P = positionWorld.mul( scale );
	const n = mx_fractal_noise_float( P, 3, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	const blotch = mx_fractal_noise_float( positionWorld.mul( 0.25 ), 2, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = C( tint ).mul( float( 1 ).sub( n.mul( 0.06 ) ).sub( blotch.mul( dirt ) ) );
	m.roughnessNode = float( rough );
	m.metalnessNode = float( 0 );
	m.normalNode = bumpMap( n, float( 0.02 ) );
	return m;

}

/** White stucco relief (slightly glossy lime paint). */
export function stucco( { tint = 0xf2eee4, rough = 0.5 } = {} ) {

	const m = new THREE.MeshStandardNodeMaterial();
	const n = mx_fractal_noise_float( positionWorld.mul( 9 ), 2, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = C( tint ).mul( float( 0.94 ).add( n.mul( 0.06 ) ) );
	m.roughnessNode = float( rough );
	m.metalnessNode = float( 0 );
	return m;

}

// ---------------------------------------------------------------- metals

export function metal( { tint = 0xc9a14a, rough = 0.28, brushed = 0, scale = 30, local = true } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const P = local ? positionLocal : positionWorld;
	let r = float( rough );
	if ( brushed > 0 ) {

		const streak = mx_noise_float( vec3( P.x.mul( scale * 0.02 ), P.y.mul( scale * 4 ), P.z.mul( scale * 0.02 ) ) ).mul( 0.5 ).add( 0.5 );
		r = r.add( streak.mul( brushed ) );

	}

	const n = mx_fractal_noise_float( P.mul( scale * 0.2 ), 2, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = C( tint ).mul( float( 0.92 ).add( n.mul( 0.08 ) ) );
	m.roughnessNode = r.add( n.mul( 0.06 ) );
	m.metalnessNode = float( 1 );
	return m;

}

export const brass = ( o = {} ) => metal( { tint: 0xd4a84a, rough: 0.26, ...o } );
export const bronze = ( o = {} ) => metal( { tint: 0x8a5a2b, rough: 0.35, ...o } );
export const steel = ( o = {} ) => metal( { tint: 0xd8dde2, rough: 0.16, brushed: 0.12, ...o } );

// ---------------------------------------------------------------- emissive & glass

/** Emissive lamp glass. Exposes `.userData.intensity` uniform (0 = broken / off). */
export function lampGlass( { tint = 0xffd9a0, power = 7 } = {} ) {

	const m = new THREE.MeshStandardNodeMaterial();
	const intensity = uniform( 1 );
	const c = new THREE.Color( tint );
	m.colorNode = mix( C( 0x2a2520 ), C( tint ), intensity.clamp( 0, 1 ) );
	m.emissiveNode = color( c ).mul( intensity.mul( power ) );
	m.roughnessNode = float( 0.2 );
	m.userData.intensity = intensity;
	return m;

}

export function crystal() {

	const m = new THREE.MeshPhysicalNodeMaterial( { color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 0, ior: 1.6 } );
	m.emissiveNode = color( 0.35, 0.3, 0.22 );
	m.envMapIntensity = 2.5;
	return m;

}

// ---------------------------------------------------------------- misc

export function wood( { tint = 0x6b3a1e, tint2 = 0x3d1f0e, scale = 14, rough = 0.35, axis = 'x' } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const P = positionLocal.mul( scale );
	const a = axis === 'x' ? vec2( P.y, P.z ) : axis === 'y' ? vec2( P.x, P.z ) : vec2( P.x, P.y );
	const along = axis === 'x' ? P.x : axis === 'y' ? P.y : P.z;
	const warp = mx_fractal_noise_float( vec3( a.x, a.y, along.mul( 0.08 ) ), 3, 2.0, 0.5 );
	const rings = fract( length( a.add( 7.0 ) ).mul( 1.4 ).add( warp.mul( 2.0 ) ) );
	const fib = mx_noise_float( vec3( a.x.mul( 20 ), a.y.mul( 20 ), along.mul( 0.4 ) ) ).mul( 0.5 ).add( 0.5 );
	m.colorNode = mix( C( tint ), C( tint2 ), smoothstep( 0.2, 0.9, rings ).mul( 0.7 ).add( fib.mul( 0.3 ) ) );
	m.roughnessNode = float( rough ).add( fib.mul( 0.1 ) );
	m.metalnessNode = float( 0 );
	m.clearcoat = 0.6;
	m.clearcoatRoughness = 0.2;
	return m;

}

export function concrete( { tint = 0x55524d, rough = 0.9, scale = 2.5 } = {} ) {

	const m = new THREE.MeshStandardNodeMaterial();
	const P = positionWorld.mul( scale );
	const n = mx_fractal_noise_float( P, 4, 2.0, 0.55 ).mul( 0.5 ).add( 0.5 );
	const pits = smoothstep( 0.0, 0.08, mx_worley_noise_float( P.mul( 6 ) ) );
	const stain = mx_fractal_noise_float( positionWorld.mul( 0.3 ), 2 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = C( tint ).mul( float( 0.7 ).add( n.mul( 0.4 ) ) ).mul( float( 1 ).sub( stain.mul( 0.35 ) ) ).mul( mix( 0.6, 1.0, pits ) );
	m.roughnessNode = float( rough );
	m.metalnessNode = float( 0 );
	m.normalNode = bumpMap( n.add( pits.mul( 0.5 ) ), float( 0.4 ) );
	return m;

}

/** Track ballast / bed: dark oily concrete with gravel. */
export function trackBed() {

	const m = new THREE.MeshStandardNodeMaterial();
	const xz = positionWorld.xz;
	const g = mx_worley_noise_float( xz.mul( 22 ) );
	const n = mx_fractal_noise_float( xz.mul( 0.8 ), 3 ).mul( 0.5 ).add( 0.5 );
	const cellTint = mx_cell_noise_float( floor( xz.mul( 22 ) ) );
	m.colorNode = C( 0x2a2724 ).mul( float( 0.55 ).add( smoothstep( 0.05, 0.4, g ).mul( 0.45 ) ).add( cellTint.mul( 0.3 ) ) ).mul( n.mul( 0.5 ).add( 0.6 ) );
	m.roughnessNode = float( 0.85 ).sub( n.mul( 0.4 ) ); // oily puddles
	m.metalnessNode = float( 0 );
	m.normalNode = bumpMap( smoothstep( 0.0, 0.5, g ), float( 1.2 ) );
	return m;

}

/** Glazed ceramic wall tiles. */
export function tiles( { tint = 0xece6d8, grout = 0x9a9486, w = 0.3, h = 0.15, rough = 0.12, axis = 'x' } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const p = axis === 'x' ? vec2( positionWorld.x, positionWorld.y ) : vec2( positionWorld.z, positionWorld.y );
	const row = floor( p.y.div( h ) );
	const pp = vec2( p.x.div( w ).add( mod( row, 2 ).mul( 0.5 ) ), p.y.div( h ) );
	const f = fract( pp );
	const cell = floor( pp );
	const e = min( min( f.x.mul( w ), oneMinus( f.x ).mul( w ) ), min( f.y.mul( h ), oneMinus( f.y ).mul( h ) ) );
	const g = smoothstep( 0.0, 0.004, e );
	const v = mx_cell_noise_float( cell ).sub( 0.5 ).mul( 0.08 );
	m.colorNode = mix( C( grout ), C( tint ).mul( float( 1 ).add( v ) ), g );
	m.roughnessNode = mix( 0.8, rough, g );
	m.metalnessNode = float( 0 );
	m.normalNode = bumpMap( smoothstep( 0.0, 0.01, e ), float( 0.3 ) );
	m.clearcoat = 0.5;
	return m;

}

/** Glass smalt mosaic generated from a canvas picture (sampled at tessera centres). */
export function mosaic( tex, { cols = 90, rows = 60, gold = 0xd9a93a, grout = 0x6a6056 } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const grid = uv().mul( vec2( cols, rows ) );
	// jitter tesserae rows slightly like hand-laid smalt
	const rowJ = mx_cell_noise_float( vec2( floor( grid.y ), 3.1 ) ).mul( 0.5 );
	const g2 = vec2( grid.x.add( rowJ ), grid.y );
	const cell = floor( g2 );
	const f = fract( g2 );
	const centre = cell.add( 0.5 ).sub( vec2( rowJ, 0 ) ).div( vec2( cols, rows ) );
	const src = texture( tex, centre );
	const rnd = mx_cell_noise_float( cell );
	const isGold = src.a.lessThan( 0.5 ); // alpha 0 marks gold background
	const e = min( min( f.x, oneMinus( f.x ) ), min( f.y, oneMinus( f.y ) ) );
	const gap = smoothstep( 0.02, 0.1, e );
	const goldCol = C( gold ).mul( float( 0.8 ).add( rnd.mul( 0.4 ) ) );
	const glassCol = src.rgb.mul( float( 0.88 ).add( rnd.mul( 0.24 ) ) );
	const tess = isGold.select( goldCol, glassCol );
	m.colorNode = mix( C( grout ), tess, gap );
	m.metalnessNode = isGold.select( float( 1 ), float( 0 ) ).mul( gap );
	m.roughnessNode = mix( float( 0.9 ), isGold.select( float( 0.22 ), float( 0.12 ) ), gap );
	// every tessera is set at a slightly different angle -> living sparkle
	const tilt = rnd.mul( 2.0 ).sub( 1.0 ).mul( f.x.sub( 0.5 ) ).add( mx_cell_noise_float( cell.add( 9.1 ) ).sub( 0.5 ).mul( f.y.sub( 0.5 ) ) );
	m.normalNode = bumpMap( gap.mul( 0.6 ).add( tilt.mul( 0.5 ) ), float( 0.004 * cols ) );
	return m;

}

/** Backlit stained glass panel with breakable intensity. */
export function stainedGlass( tex, { power = 3.2 } = {} ) {

	const m = new THREE.MeshStandardNodeMaterial();
	const intensity = uniform( 1 );
	const s = texture( tex, uv() );
	const lead = smoothstep( 0.08, 0.2, s.a );
	const n = mx_fractal_noise_float( uv().mul( 40 ), 2 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = s.rgb.mul( 0.25 ).mul( lead );
	m.emissiveNode = s.rgb.mul( lead ).mul( n.mul( 0.4 ).add( 0.8 ) ).mul( intensity.mul( power ) );
	m.roughnessNode = float( 0.1 );
	m.metalnessNode = float( 0 );
	m.userData.intensity = intensity;
	return m;

}

/** Simple lambert-ish paint with subtle noise (walls, doors, trains). */
export function paint( { tint = 0xffffff, rough = 0.35, metal = 0, clearcoat = 0, noise = 0.03, local = true } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const P = local ? positionLocal : positionWorld;
	const n = mx_fractal_noise_float( P.mul( 4 ), 2 ).mul( 0.5 ).add( 0.5 );
	m.colorNode = C( tint ).mul( float( 1 - noise ).add( n.mul( noise ) ) );
	m.roughnessNode = float( rough );
	m.metalnessNode = float( metal );
	if ( clearcoat ) {

		m.clearcoat = clearcoat;
		m.clearcoatRoughness = 0.08;

	}

	return m;

}

export function basicEmissive( hex, power = 4 ) {

	const m = new THREE.MeshBasicNodeMaterial();
	m.colorNode = C( hex ).mul( power );
	return m;

}

export { C };
