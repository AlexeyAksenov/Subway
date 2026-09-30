// «Маяковская» (Zamoskvoretskaya line): slender fluted stainless-steel columns and arches,
// pink rhodonite bases, oval cupolas with "Soviet sky" mosaics ringed by breakable lamps.
import * as THREE from 'three/webgpu';
import { abs, float, mod, floor, vec2, positionLocal, sin, smoothstep, mix, color, fract } from 'three/tsl';
import * as M from '../materials.js';
import * as G from '../geom.js';
import { SURF } from '../world.js';
import { LampCluster, registerBench } from '../fixtures.js';
import { mosaicSky } from '../canvasArt.js';
import { buildFloor, buildPlatformEdges, buildNameLetters, buildEndWalls, floorGrid } from './common.js';
import { HALF_L, COL_Z, WALL_Z, columnXs, BAY } from '../layout.js';

const SPRING = 4.25;
const RISE = 1.55;
const TOP = 6.3;
const PV = { cz: COL_Z + 0.4, cy: 4.0, rz: WALL_Z - COL_Z - 0.4, ry: TOP - 4.0 };

function flutedShape( r, lobes = 18, depth = 0.028 ) {

	const s = new THREE.Shape();
	const n = lobes * 8;
	for ( let i = 0; i <= n; i ++ ) {

		const a = i / n * Math.PI * 2;
		const rr = r + depth * Math.pow( Math.abs( Math.cos( a * lobes / 2 ) ), 0.6 );
		const x = Math.cos( a ) * rr, y = Math.sin( a ) * rr;
		if ( i === 0 ) s.moveTo( x, y ); else s.lineTo( x, y );

	}

	return s;

}

export function buildMayakovskaya( W ) {

	const steel = M.metal( { tint: 0xdfe3e8, rough: 0.12, brushed: 0.08, scale: 40, local: true } );
	// fluting catches highlights: stripes of roughness along the column height
	steel.roughnessNode = float( 0.1 ).add( smoothstep( 0.3, 0.7, abs( sin( positionLocal.x.mul( 160 ).add( positionLocal.z.mul( 160 ) ) ) ) ).mul( 0.1 ) );
	const mats = {
		floor: M.graniteFloor( {
			gridFn: floorGrid( { hallTile: 0.9, platTile: 1.2 } ),
			colors: [ 0x8a8784, 0xd6d1c9, 0x9e7174 ],
			patternFn: ( cell, xz ) => {

				const az = abs( xz.y );
				const k = mod( floor( cell.x ).add( floor( cell.y ) ), 3 );
				const plat = az.greaterThan( 9.25 ).select( float( 1 ), float( 0 ) );
				return az.lessThan( COL_Z - 0.2 ).select( k, plat );

			}
		} ),
		steel,
		rhodonite: M.marble( { base: 0xc97a86, base2: 0xa9566a, vein: 0x3a2a2e, scale: 2.4, veinWidth: 5, rough: 0.1 } ),
		plaster: M.plaster( { tint: 0xf1ede4, rough: 0.8, dirt: 0.06 } ),
		wall: M.marble( { base: 0xd8d6d2, base2: 0xc5c2bd, vein: 0x77726c, scale: 1.4, veinWidth: 10 } ),
		dado: M.marble( { base: 0x3c3a3a, base2: 0x2b2a29, vein: 0x8a8580, scale: 1.4, rough: 0.2 } ),
		edge: M.marble( { base: 0xe0dcd6, base2: 0xcdc8c0, vein: 0x8a8580, scale: 2.2 } ),
		stucco: M.stucco( { tint: 0xf4f1ea } ),
		cup: M.metal( { tint: 0xd8dde2, rough: 0.2 } ),
		oak: M.wood( { tint: 0x6a3d1f, tint2: 0x3e2210 } ),
		iron: M.metal( { tint: 0x2a2a2a, rough: 0.45 } )
	};
	buildFloor( W, mats.floor );
	buildPlatformEdges( W, { edgeMat: mats.edge, wallMat: mats.wall, dadoMat: mats.dado, cornice: mats.steel, wallTop: PV.cy } );
	buildNameLetters( W, 'Маяковская', { metal: M.metal( { tint: 0xe6e9ec, rough: 0.15 } ), y: 2.3 } );

	// ------------------------------------------------ columns: rhodonite base, fluted steel shaft, flared capital
	const base = G.extrudeZ( G.roundRectShape( 0.95, 0.95, 0.08 ), 0.6, { bevel: 0.03 } );
	base.rotateX( - Math.PI / 2 );
	const shaft = new THREE.ExtrudeGeometry( flutedShape( 0.3 ), { depth: SPRING - 0.95, bevelEnabled: false, curveSegments: 4 } );
	shaft.rotateX( - Math.PI / 2 );
	shaft.translate( 0, 0.62, 0 );
	const cap = G.lathe( [ [ 0.33, SPRING - 0.35 ], [ 0.36, SPRING - 0.25 ], [ 0.46, SPRING - 0.1 ], [ 0.62, SPRING ], [ 0.001, SPRING ] ], 24 );
	const ring = G.lathe( [ [ 0.3, 0.6 ], [ 0.36, 0.62 ], [ 0.36, 0.68 ], [ 0.31, 0.72 ] ], 24 );
	const colM = [];
	for ( const s of [ - 1, 1 ] ) for ( const x of columnXs ) {

		colM.push( G.mat4( x, 0, s * COL_Z ) );
		W.colliders.addCircle( x, s * COL_Z, 0.55, 'column' );

	}

	W.addInstanced( base, mats.rhodonite, colM, { surface: SURF.stone } );
	W.addInstanced( G.merge( [ shaft, cap, ring ] ), mats.steel, colM, { surface: SURF.metal } );

	// ------------------------------------------------ arcade with elliptical arches clad in steel
	const supports = [ - HALF_L, ...columnXs, HALF_L ];
	const arches = [];
	for ( let i = 0; i < supports.length - 1; i ++ ) {

		const a = supports[ i ] + ( i === 0 ? 0 : 0.55 );
		const b = supports[ i + 1 ] - ( i === supports.length - 2 ? 0 : 0.55 );
		arches.push( { cx: ( a + b ) / 2, r: ( b - a ) / 2 } );

	}

	const arcShape = new THREE.Shape();
	arcShape.moveTo( - HALF_L, TOP );
	arcShape.lineTo( - HALF_L, SPRING );
	for ( const ar of arches ) {

		arcShape.lineTo( ar.cx - ar.r, SPRING );
		for ( let k = 1; k <= 28; k ++ ) { const t = Math.PI - Math.PI * k / 28; arcShape.lineTo( ar.cx + Math.cos( t ) * ar.r, SPRING + Math.sin( t ) * RISE ); }

	}

	arcShape.lineTo( HALF_L, SPRING ); arcShape.lineTo( HALF_L, TOP ); arcShape.closePath();
	const soffits = [];
	for ( const s of [ - 1, 1 ] ) {

		W.addMesh( G.extrudeZ( arcShape, 0.8, { z: s * COL_Z } ), mats.plaster, { surface: SURF.plaster } );
		for ( const ar of arches ) {

			// ribbed steel soffit following the arch
			const path = [];
			for ( let k = 0; k <= 28; k ++ ) { const t = Math.PI - Math.PI * k / 28; path.push( [ ar.cx + Math.cos( t ) * ar.r, SPRING + Math.sin( t ) * RISE ] ); }
			const prof = [];
			for ( let i = 0; i <= 10; i ++ ) { const a = - 0.42 + i * 0.084; prof.push( [ a, i % 2 ? 0.035 : 0.005 ] ); }
			prof.push( [ 0.42, - 0.03 ], [ - 0.42, - 0.03 ] );
			const g = G.ribAlong( path.map( ( [ x, y ] ) => [ x, y ] ), prof, 0, [ ar.cx, SPRING ] );
			g.rotateY( Math.PI / 2 );
			g.translate( 0, 0, s * COL_Z );
			soffits.push( g );

		}

		const cp = G.polyShape( [ [ 0, 0 ], [ - 0.06, 0 ], [ - 0.1, 0.06 ], [ - 0.22, 0.1 ], [ - 0.24, 0.18 ], [ 0, 0.18 ] ] );
		const c1 = G.extrudeX( cp, - HALF_L, HALF_L );
		if ( s < 0 ) c1.scale( 1, 1, - 1 );
		c1.translate( 0, TOP - 0.18, s * ( COL_Z - 0.4 ) );
		W.addMesh( c1, mats.steel, { surface: SURF.metal } );

	}

	W.addMesh( G.merge( soffits ), mats.steel, { surface: SURF.metal } );

	// ------------------------------------------------ hall ceiling with oval cupolas
	const ceil = new THREE.Shape();
	ceil.moveTo( - HALF_L, - ( COL_Z - 0.4 ) ); ceil.lineTo( HALF_L, - ( COL_Z - 0.4 ) ); ceil.lineTo( HALF_L, COL_Z - 0.4 ); ceil.lineTo( - HALF_L, COL_Z - 0.4 ); ceil.closePath();
	const domes = [], rims = [], mosaics = [ [], [], [], [] ];
	const bays = [];
	for ( let x = - HALF_L + BAY / 2; x < HALF_L; x += BAY ) bays.push( x );
	const DX = 2.5, DZ = 1.75;
	for ( const x of bays ) {

		const h = new THREE.Path();
		h.absellipse( x, 0, DX, DZ, 0, Math.PI * 2, true );
		ceil.holes.push( h );

	}

	const cg = new THREE.ShapeGeometry( ceil, 24 );
	cg.rotateX( Math.PI / 2 );
	cg.translate( 0, TOP, 0 );
	W.addMesh( cg, mats.plaster, { surface: SURF.plaster } );
	const skyMats = [ 1, 2, 3, 4 ].map( ( s ) => M.mosaic( mosaicSky( s ), { cols: 64, rows: 64 } ) );
	const ringBulbs = [];
	const nb = 16;
	for ( let i = 0; i < nb; i ++ ) { const a = i / nb * Math.PI * 2; ringBulbs.push( new THREE.Vector3( Math.cos( a ) * ( DX + 0.18 ), - 0.12, Math.sin( a ) * ( DZ + 0.18 ) ) ); }
	const bulbGeo = new THREE.SphereGeometry( 0.07, 12, 8 );
	const cupGeo = G.merge( ringBulbs.map( ( p ) => G.lathe( [ [ 0.001, 0.02 ], [ 0.09, 0.0 ], [ 0.1, - 0.04 ], [ 0.07, - 0.06 ] ], 12, { x: p.x, y: p.y + 0.06, z: p.z } ) ) );
	bays.forEach( ( x, i ) => {

		const d = new THREE.SphereGeometry( 1, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2 );
		d.scale( DX, 1.25, DZ );
		d.translate( x, TOP - 0.02, 0 );
		domes.push( d );
		const r = new THREE.TorusGeometry( 1, 0.05, 8, 48 );
		r.rotateX( Math.PI / 2 ); r.scale( DX + 0.02, 1, DZ + 0.02 ); r.translate( x, TOP - 0.03, 0 );
		rims.push( r );
		const m = new THREE.CircleGeometry( 1, 40 );
		m.rotateX( Math.PI / 2 ); m.scale( DX * 0.62, 1, DZ * 0.62 ); m.translate( x, TOP + 1.12, 0 );
		mosaics[ i % 4 ].push( m );
		// ring of lamps (each bulb can be shot out)
		const light = W.light( x, TOP - 0.8, 0, 0xfff1dc, 55, 22 );
		new LampCluster( W, {
			position: new THREE.Vector3( x, TOP, 0 ), bulbGeo, bulbPositions: ringBulbs, bulbMat: M.lampGlass( { tint: 0xfff0d8, power: 6 } ),
			extraMeshes: [ [ cupGeo, mats.cup ] ], light, lightOffset: new THREE.Vector3( 0, - 0.8, 0 ), swing: false,
			bodyOffset: new THREE.Vector3( 0, 3, 0 ), bodyRadius: 0.01, bulbRadius: 0.1
		} );

	} );
	W.addMesh( G.merge( domes ), mats.plaster, { surface: SURF.plaster } );
	W.addMesh( G.merge( rims ), mats.steel, { surface: SURF.metal } );
	mosaics.forEach( ( list, i ) => { if ( list.length ) W.addMesh( G.merge( list ), skyMats[ i ], { surface: SURF.glass } ); } );

	// ------------------------------------------------ platform vaults
	const platArc = G.ellipseArc( PV.cz, PV.cy, PV.rz, PV.ry, Math.PI / 2, 0, 24 );
	const ribs = [];
	const ribProf = [ [ - 0.12, - 0.01 ], [ 0.12, - 0.01 ], [ 0.12, 0.05 ], [ - 0.12, 0.05 ] ];
	for ( const s of [ - 1, 1 ] ) {

		const arc = platArc.map( ( [ z, y ] ) => [ s * z, y ] );
		W.addMesh( G.sweepX( s > 0 ? arc : arc.slice().reverse(), - HALF_L, HALF_L, 1 ), mats.plaster, { surface: SURF.plaster } );
		for ( const x of columnXs ) ribs.push( G.ribAlong( arc, ribProf, x, [ s * PV.cz, PV.cy ] ) );

	}

	W.addMesh( G.merge( ribs ), mats.steel, { surface: SURF.metal } );
	// wall sconces on the track walls (emissive) + a few platform lights
	const sconces = [];
	for ( const s of [ - 1, 1 ] ) for ( const x of columnXs ) sconces.push( G.lathe( [ [ 0.001, 0 ], [ 0.12, 0.02 ], [ 0.16, 0.12 ], [ 0.001, 0.14 ] ], 16, { x, y: 3.35, z: s * ( WALL_Z - 0.12 ) } ) );
	W.addMesh( G.merge( sconces ), M.lampGlass( { tint: 0xfff0d8, power: 5 } ), { collide: false } );
	for ( const s of [ - 1, 1 ] ) for ( const x of [ - 35, 35 ] ) W.light( x, 3.4, s * ( WALL_Z - 1.5 ), 0xfff0d8, 30, 34 );

	// ------------------------------------------------ end walls
	const ceiling = [];
	const pv = ( s ) => platArc.map( ( [ z, y ] ) => [ s * z, y ] );
	ceiling.push( ...pv( - 1 ).slice().reverse() );
	ceiling.push( [ - COL_Z + 0.4, TOP ], [ COL_Z - 0.4, TOP ] );
	ceiling.push( ...pv( 1 ) );
	buildEndWalls( W, ceiling, {
		wallMat: mats.wall, portalMat: mats.rhodonite, trimMat: mats.steel, corridorMat: mats.wall,
		lampMat: M.lampGlass( { power: 5 } ), doorMat: mats.oak
	} );
	for ( const sx of [ - 1, 1 ] ) {

		const g = new THREE.CircleGeometry( 1.4, 40 );
		g.rotateY( sx > 0 ? - Math.PI / 2 : Math.PI / 2 );
		g.translate( sx * ( HALF_L - 0.03 ), 5.8, 0 );
		W.addMesh( g, skyMats[ sx > 0 ? 1 : 3 ], { surface: SURF.glass } );

	}

	for ( const s of [ - 1, 1 ] ) for ( const x of [ - 48.75, - 26.25, - 3.75, 18.75, 41.25 ] ) registerBench( W, { x, z: s * COL_Z, rotY: s > 0 ? 0 : Math.PI, woodMat: mats.oak, frameMat: mats.iron } );

	void vec2; void mix; void color; void fract;
	return {
		hemi: { sky: 0xf2f0ff, ground: 0x3a3634, intensity: 0.1 },
		fog: { color: 0x14141a, density: 0.005 },
		exposure: 1.0,
		envIntensity: 0.6
	};

}
