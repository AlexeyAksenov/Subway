// «Комсомольская» (Koltsevaya line): octagonal marble columns with baroque capitals,
// a tall yellow vault with white stucco ribs, golden smalt mosaics and huge chandeliers.
import * as THREE from 'three/webgpu';
import { abs, float, mod } from 'three/tsl';
import * as M from '../materials.js';
import * as G from '../geom.js';
import { SURF } from '../world.js';
import { LampCluster, chandelierParts, registerBench } from '../fixtures.js';
import { mosaicStarWreath } from '../canvasArt.js';
import { buildFloor, buildPlatformEdges, buildNameLetters, buildEndWalls, floorGrid } from './common.js';
import { HALF_L, COL_Z, WALL_Z, columnXs, BAY } from '../layout.js';

const SPRING = 4.84;     // arch springing height (top of abacus)
const WALL_TOP = 8.6;    // arcade wall top / vault springing
const HALL_R = COL_Z - 0.5;
const HALL_RISE = 2.75;
const PV = { cz: COL_Z + 0.5, cy: 4.2, rz: WALL_Z - COL_Z - 0.5, ry: WALL_TOP - 4.2 };

export function hallVaultPoint( a ) { return [ Math.cos( a ) * HALL_R, WALL_TOP + Math.sin( a ) * HALL_RISE ]; }

export function buildKomsomolskaya( W ) {

	const mats = {
		floor: M.graniteFloor( {
			gridFn: floorGrid( { hallTile: 1.05, platTile: 1.2 } ),
			colors: [ 0x8b857d, 0x6a2a22, 0xd2ccc2 ],
			patternFn: ( cell, xz ) => {

				const az = abs( xz.y );
				const hall = mod( cell.x.add( cell.y ), 2 );
				const plat = az.greaterThan( 9.25 ).select( float( 2 ), az.lessThan( 6.5 ).select( float( 1 ), float( 0 ) ) );
				return az.lessThan( COL_Z - 0.2 ).select( hall, plat );

			}
		} ),
		shaft: M.marble( { base: 0xf3ecdc, base2: 0xe3d7bf, vein: 0xa0907a, scale: 1.3, veinWidth: 9 } ),
		pedestal: M.marble( { base: 0x7a2c24, base2: 0x55201a, vein: 0xd9b69a, scale: 1.8, veinWidth: 6 } ),
		stucco: M.stucco(),
		gilt: M.metal( { tint: 0xe0b45a, rough: 0.3 } ),
		vault: M.plaster( { tint: 0xecd077 } ),
		platVault: M.plaster( { tint: 0xf2e2a8 } ),
		wall: M.marble( { base: 0xf1e9d9, base2: 0xe6dac4, vein: 0xb5a58c, scale: 1.6, veinWidth: 12 } ),
		dado: M.marble( { base: 0x3a3632, base2: 0x2a2724, vein: 0x8a8076, scale: 1.4, rough: 0.2 } ),
		edge: M.marble( { base: 0xd9d3c8, base2: 0xc7bfb2, vein: 0x8f877a, scale: 2.2 } ),
		brass: M.brass(),
		crystal: M.crystal(),
		candle: M.stucco( { tint: 0xfffaf0, rough: 0.35 } ),
		oak: M.wood( { tint: 0x7a4a26, tint2: 0x4a2a14 } ),
		iron: M.metal( { tint: 0x2a2a2a, rough: 0.45 } )
	};

	buildFloor( W, mats.floor );
	buildPlatformEdges( W, { edgeMat: mats.edge, wallMat: mats.wall, dadoMat: mats.dado, cornice: mats.stucco, wallTop: PV.cy } );
	buildNameLetters( W, 'Комсомольская', { metal: M.brass(), y: 2.45 } );

	// ------------------------------------------------ columns
	const pedestal = G.lathe( [ [ 0.001, 0 ], [ 0.76, 0 ], [ 0.76, 0.22 ], [ 0.72, 0.26 ], [ 0.68, 0.3 ], [ 0.62, 0.42 ], [ 0.57, 0.48 ], [ 0.55, 0.5 ] ], 8 );
	const shaft = G.lathe( [ [ 0.53, 0.5 ], [ 0.51, 1.7 ], [ 0.47, 3.9 ] ], 8 );
	const capParts = [];
	capParts.push( G.lathe( [ [ 0.47, 3.9 ], [ 0.51, 3.93 ], [ 0.51, 3.98 ], [ 0.47, 4.0 ], [ 0.49, 4.1 ], [ 0.55, 4.3 ], [ 0.66, 4.5 ], [ 0.8, 4.64 ], [ 0.001, 4.64 ] ], 16 ) );
	capParts.push( G.box( 1.75, 0.2, 1.75, { y: 4.74 } ) );
	capParts.push( G.box( 1.85, 0.05, 1.85, { y: 4.82 } ) );
	// acanthus leaves: two rows of bent leaves
	const leafShape = new THREE.Shape();
	leafShape.moveTo( 0, 0 );
	leafShape.bezierCurveTo( 0.12, 0.08, 0.1, 0.28, 0.0, 0.42 );
	leafShape.bezierCurveTo( - 0.1, 0.28, - 0.12, 0.08, 0, 0 );
	const leaf = new THREE.ExtrudeGeometry( leafShape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 6 } );
	for ( let row = 0; row < 2; row ++ ) for ( let i = 0; i < 8; i ++ ) {

		const a = ( i + row * 0.5 ) / 8 * Math.PI * 2;
		const r = 0.48 + row * 0.04;
		const g = G.place( leaf, { rx: - 0.35 - row * 0.1 } );
		g.rotateY( - a + Math.PI / 2 );
		g.translate( Math.cos( a ) * r, 3.98 + row * 0.2, Math.sin( a ) * r );
		capParts.push( g );

	}

	// volutes at the four corners
	for ( let i = 0; i < 4; i ++ ) {

		const a = Math.PI / 4 + i * Math.PI / 2;
		const vol = G.place( new THREE.TorusGeometry( 0.09, 0.035, 8, 16 ), { x: Math.cos( a ) * 0.8, y: 4.55, z: Math.sin( a ) * 0.8, ry: - a + Math.PI / 2 } );
		capParts.push( vol );

	}

	const capital = G.merge( capParts );
	const colMatrices = [];
	for ( const s of [ - 1, 1 ] ) for ( const x of columnXs ) {

		colMatrices.push( G.mat4( x, 0, s * COL_Z ) );
		W.colliders.addCircle( x, s * COL_Z, 0.72, 'column' );

	}

	W.addInstanced( pedestal, mats.pedestal, colMatrices, { surface: SURF.stone } );
	W.addInstanced( shaft, mats.shaft, colMatrices, { surface: SURF.stone } );
	W.addInstanced( capital, mats.stucco, colMatrices, { collide: true, surface: SURF.plaster } );

	// ------------------------------------------------ arcade walls with arches
	const supports = [ - HALF_L, ...columnXs, HALF_L ];
	const arches = [];
	for ( let i = 0; i < supports.length - 1; i ++ ) {

		const a = supports[ i ] + ( i === 0 ? 0 : 0.875 );
		const b = supports[ i + 1 ] - ( i === supports.length - 2 ? 0 : 0.875 );
		arches.push( { cx: ( a + b ) / 2, r: ( b - a ) / 2 } );

	}

	const arcShape = new THREE.Shape();
	arcShape.moveTo( - HALF_L, WALL_TOP );
	arcShape.lineTo( - HALF_L, SPRING );
	for ( const ar of arches ) {

		arcShape.lineTo( ar.cx - ar.r, SPRING );
		for ( let k = 1; k <= 28; k ++ ) {

			const t = Math.PI - Math.PI * k / 28;
			arcShape.lineTo( ar.cx + Math.cos( t ) * ar.r, SPRING + Math.sin( t ) * ar.r );

		}

	}

	arcShape.lineTo( HALF_L, SPRING );
	arcShape.lineTo( HALF_L, WALL_TOP );
	arcShape.closePath();
	const mould = [], keys = [], roses = [];
	for ( const s of [ - 1, 1 ] ) {

		const g = G.extrudeZ( arcShape, 1.0, { z: s * COL_Z } );
		W.addMesh( g, mats.platVault, { surface: SURF.plaster } );
		for ( const ar of arches ) {

			for ( const face of [ - 0.5, 0.5 ] ) {

				mould.push( G.place( new THREE.TorusGeometry( ar.r + 0.1, 0.075, 8, 40, Math.PI ), { x: ar.cx, y: SPRING, z: s * COL_Z + face } ) );
				mould.push( G.place( new THREE.TorusGeometry( ar.r + 0.3, 0.04, 6, 40, Math.PI ), { x: ar.cx, y: SPRING, z: s * COL_Z + face } ) );
				keys.push( G.box( 0.34, 0.5, 0.18, { x: ar.cx, y: SPRING + ar.r + 0.2, z: s * COL_Z + face * 1.12 } ) );

			}

			roses.push( G.lathe( [ [ 0.001, 0.07 ], [ 0.12, 0.06 ], [ 0.22, 0.02 ], [ 0.25, 0 ] ], 16, { x: ar.cx + ar.r + 0.44, y: SPRING + ar.r * 0.62, z: s * ( COL_Z - 0.52 ), rx: s * Math.PI / 2 } ) );

		}

		// cornices (hall side: large; platform side: small)
		const cp = G.polyShape( [ [ 0, 0 ], [ - 0.08, 0 ], [ - 0.12, 0.08 ], [ - 0.32, 0.14 ], [ - 0.36, 0.26 ], [ - 0.5, 0.32 ], [ - 0.52, 0.4 ], [ 0, 0.4 ] ] );
		const c1 = G.extrudeX( cp, - HALF_L, HALF_L );
		if ( s < 0 ) c1.scale( 1, 1, - 1 );
		c1.translate( 0, WALL_TOP - 0.4, s * ( COL_Z - 0.5 ) );
		W.addMesh( c1, mats.stucco, { surface: SURF.plaster } );
		const c2 = G.extrudeX( G.polyShape( [ [ 0, 0 ], [ - 0.1, 0.02 ], [ - 0.2, 0.12 ], [ - 0.22, 0.2 ], [ 0, 0.2 ] ] ), - HALF_L, HALF_L );
		if ( s > 0 ) c2.scale( 1, 1, - 1 );
		c2.translate( 0, SPRING + 3.1, s * ( COL_Z + 0.5 ) );
		W.addMesh( c2, mats.stucco, { surface: SURF.plaster } );

	}

	W.addMesh( G.merge( mould ), mats.stucco, { surface: SURF.plaster } );
	W.addMesh( G.merge( keys ), mats.stucco, { surface: SURF.plaster } );
	W.addMesh( G.merge( roses ), mats.gilt, { collide: false } );

	// ------------------------------------------------ hall vault, ribs, mosaics
	const hallArc = [];
	for ( let i = 0; i <= 40; i ++ ) hallArc.push( hallVaultPoint( Math.PI * i / 40 ) );
	W.addMesh( G.sweepX( hallArc.slice().reverse(), - HALF_L, HALF_L, 1 ), mats.vault, { surface: SURF.plaster } );
	const ribProfile = [ [ - 0.32, - 0.02 ], [ 0.32, - 0.02 ], [ 0.32, 0.05 ], [ 0.26, 0.09 ], [ 0.22, 0.16 ], [ - 0.22, 0.16 ], [ - 0.26, 0.09 ], [ - 0.32, 0.05 ] ];
	const ribs = [];
	for ( const x of [ - HALF_L + 0.3, ...columnXs, HALF_L - 0.3 ] ) ribs.push( G.ribAlong( hallArc, ribProfile, x, [ 0, WALL_TOP ] ) );
	// longitudinal ridge band at the crown with medallions
	const crown = [];
	for ( let i = 0; i <= 8; i ++ ) crown.push( hallVaultPoint( Math.PI / 2 - 0.12 + 0.24 * i / 8 ) );
	W.addMesh( G.merge( ribs ), mats.stucco, { surface: SURF.plaster } );

	// mosaic panels on both slopes of the vault in every bay, framed in stucco + gilt
	const mosaicTex = [ 1, 2, 3, 4 ].map( ( s ) => mosaicStarWreath( s ) );
	const mosaicMats = mosaicTex.map( ( t ) => M.mosaic( t, { cols: 84, rows: 56 } ) );
	const panels = [ [], [], [], [] ];
	const frames = [], giltFrames = [];
	const bayCentres = [];
	for ( let x = - HALF_L + BAY / 2; x < HALF_L; x += BAY ) bayCentres.push( x );
	bayCentres.forEach( ( xc, bi ) => {

		for ( const side of [ 0, 1 ] ) {

			const a0 = side ? Math.PI - 1.2 : 0.42, a1 = side ? Math.PI - 0.42 : 1.2;
			const x0 = xc - 2.3, x1 = xc + 2.3;
			const g = G.vaultPatch( 0, WALL_TOP, HALL_R, HALL_RISE, side ? a1 : a0, side ? a0 : a1, x0, x1, 0.025, 8, 14 );
			panels[ ( bi + side ) % 4 ].push( g );
			// frame: closed rounded path on the vault surface
			const pts = [];
			const P = ( x, a, inset ) => new THREE.Vector3( x, WALL_TOP + Math.sin( a ) * ( HALL_RISE - inset ), Math.cos( a ) * ( HALL_R - inset ) );
			const N = 10;
			for ( let k = 0; k < N; k ++ ) pts.push( P( x0 + ( x1 - x0 ) * k / N, a0, 0.04 ) );
			for ( let k = 0; k < N; k ++ ) pts.push( P( x1, a0 + ( a1 - a0 ) * k / N, 0.04 ) );
			for ( let k = 0; k < N; k ++ ) pts.push( P( x1 - ( x1 - x0 ) * k / N, a1, 0.04 ) );
			for ( let k = 0; k < N; k ++ ) pts.push( P( x0, a1 - ( a1 - a0 ) * k / N, 0.04 ) );
			const curve = new THREE.CatmullRomCurve3( pts, true, 'centripetal', 0.2 );
			frames.push( new THREE.TubeGeometry( curve, 96, 0.085, 8, true ) );
			const pts2 = pts.map( ( p ) => {

				const c = new THREE.Vector3( ( x0 + x1 ) / 2, p.y, p.z );
				return p.clone().lerp( c, 0.0 ).add( new THREE.Vector3( 0, 0, 0 ) );

			} );
			void pts2;
			// cartouche scrolls above & below panel (stucco garlands)
			const am = ( a0 + a1 ) / 2;
			for ( const dx of [ - 1, 1 ] ) {

				const sc = new THREE.TorusGeometry( 0.28, 0.05, 8, 24, Math.PI * 1.4 );
				const pp = P( xc + dx * 2.62, am, 0.06 );
				giltFrames.push( G.place( sc, { x: pp.x, y: pp.y, z: pp.z, ry: Math.PI / 2, rx: side ? - am : am } ) );

			}

		}

		// ceiling medallion at the crown of each bay
		const [ cz, cy ] = hallVaultPoint( Math.PI / 2 );
		frames.push( G.lathe( [ [ 0.001, - 0.12 ], [ 0.25, - 0.1 ], [ 0.45, - 0.05 ], [ 0.62, - 0.02 ], [ 0.68, 0.02 ] ], 24, { x: xc, y: cy, z: cz } ) );

	} );
	panels.forEach( ( list, i ) => { if ( list.length ) W.addMesh( G.merge( list ), mosaicMats[ i ], { surface: SURF.glass } ); } );
	W.addMesh( G.merge( frames ), mats.stucco, { collide: false } );
	W.addMesh( G.merge( giltFrames ), mats.gilt, { collide: false } );

	// ------------------------------------------------ platform vaults + ribs
	const platArc = G.ellipseArc( PV.cz, PV.cy, PV.rz, PV.ry, Math.PI / 2, 0, 28 );
	const platRibs = [];
	for ( const s of [ - 1, 1 ] ) {

		const arc = platArc.map( ( [ z, y ] ) => [ s * z, y ] );
		W.addMesh( G.sweepX( s > 0 ? arc : arc.slice().reverse(), - HALF_L, HALF_L, 1 ), mats.platVault, { surface: SURF.plaster } );
		for ( const x of columnXs ) platRibs.push( G.ribAlong( arc, ribProfile.map( ( [ a, b ] ) => [ a * 0.8, b * 0.8 ] ), x, [ s * PV.cz, PV.cy ] ) );

	}

	W.addMesh( G.merge( platRibs ), mats.stucco, { surface: SURF.plaster } );

	// ------------------------------------------------ end walls
	const ceiling = [];
	const pv = ( s ) => platArc.map( ( [ z, y ] ) => [ s * z, y ] );
	ceiling.push( ...pv( - 1 ).slice().reverse() ); // from z=-13.3 up to -6.1
	ceiling.push( [ - HALL_R, WALL_TOP ] );
	for ( let i = 40; i >= 0; i -- ) ceiling.push( hallVaultPoint( Math.PI * i / 40 ) );
	ceiling.push( [ HALL_R, WALL_TOP ] );
	ceiling.push( ...pv( 1 ) );
	buildEndWalls( W, ceiling, {
		wallMat: mats.wall, portalMat: mats.pedestal, trimMat: mats.brass, corridorMat: mats.wall,
		lampMat: M.lampGlass( { power: 5 } ), doorMat: mats.oak
	} );
	// big mosaic above the portal on each end wall
	for ( const sx of [ - 1, 1 ] ) {

		const g = new THREE.PlaneGeometry( 6.4, 4.0 );
		g.rotateY( sx > 0 ? - Math.PI / 2 : Math.PI / 2 );
		g.translate( sx * ( HALF_L - 0.03 ), 8.4, 0 );
		W.addMesh( g, mosaicMats[ sx > 0 ? 0 : 2 ], { surface: SURF.glass } );

	}

	// ------------------------------------------------ chandeliers (breakable, swinging)
	const big = chandelierParts( 'baroque' );
	const small = chandelierParts( 'lantern' );
	const chMats = { metal: mats.brass, white: mats.candle, crystal: mats.crystal };
	const [ , apexY ] = hallVaultPoint( Math.PI / 2 );
	const hallXs = [ - 63.75, - 48.75, - 33.75, - 18.75, - 3.75, 3.75, 18.75, 33.75, 48.75, 63.75 ];
	for ( const x of hallXs ) {

		const scale = 1.75;
		const light = W.light( x, apexY - 1.6 * scale, 0, 0xffe6c8, 80, 36 );
		const c = new LampCluster( W, {
			position: new THREE.Vector3( x, apexY - 0.05, 0 ),
			parts: big, mats: chMats, bulbMat: M.lampGlass( { tint: 0xffd49a, power: 9 } ),
			light, lightOffset: new THREE.Vector3( 0, - 1.6, 0 ), pendulumLength: 1.8 * scale,
			bodyOffset: new THREE.Vector3( 0, - 1.6, 0 ), bodyRadius: 0.22, bulbRadius: 0.1
		} );
		c.root.scale.setScalar( scale );
		c.root.updateMatrixWorld( true );

	}

	const platXs = [ - 56.25, - 33.75, - 11.25, 11.25, 33.75, 56.25 ];
	for ( const s of [ - 1, 1 ] ) for ( const x of platXs ) {

		const z = s * 9.0;
		const light = W.light( x, 6.4, z, 0xffe8cc, 28, 22 );
		new LampCluster( W, {
			position: new THREE.Vector3( x, 8.15, z ),
			parts: small, mats: chMats, bulbMat: M.lampGlass( { tint: 0xffd49a, power: 8 } ),
			light, lightOffset: new THREE.Vector3( 0, - 1.2, 0 ), pendulumLength: 1.1,
			bodyOffset: new THREE.Vector3( 0, - 1.0, 0 ), bodyRadius: 0.14, bulbRadius: 0.09
		} );

	}

	// ------------------------------------------------ benches in the arches
	for ( const s of [ - 1, 1 ] ) for ( const x of [ - 48.75, - 26.25, - 3.75, 18.75, 41.25 ] ) {

		registerBench( W, { x, z: s * ( COL_Z ), rotY: s > 0 ? 0 : Math.PI, woodMat: mats.oak, frameMat: mats.iron } );

	}

	return {
		ceiling,
		hemi: { sky: 0xffe2b0, ground: 0x4a3a2a, intensity: 0.12 },
		fog: { color: 0x1c1610, density: 0.0045 },
		exposure: 1.0
	};

}
