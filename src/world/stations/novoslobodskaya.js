// «Новослободская» (Koltsevaya line): marble pylons with backlit stained-glass panels in gilded
// frames (every panel can be shot out), coffered white vault and lantern chandeliers.
import * as THREE from 'three/webgpu';
import { abs, float, mod, positionWorld, smoothstep, fract, mix, color, texture, uv, min } from 'three/tsl';
import * as M from '../materials.js';
import * as G from '../geom.js';
import { SURF } from '../world.js';
import { LampCluster, GlassPanel, chandelierParts, registerBench } from '../fixtures.js';
import { stainedGlassDesign, crackTexture } from '../canvasArt.js';
import { buildFloor, buildPlatformEdges, buildNameLetters, buildEndWalls, floorGrid } from './common.js';
import { HALF_L, COL_Z, WALL_Z, columnXs } from '../layout.js';

const PYL_L = 3.3, PYL_W = 1.5;
const SPRING = 3.35, TOP = 6.1;
const HALL_R = COL_Z - PYL_W / 2, RISE = 2.1;
const PV = { cz: COL_Z + PYL_W / 2, cy: 4.0, rz: WALL_Z - COL_Z - PYL_W / 2, ry: TOP - 4.0 };

export function buildNovoslobodskaya( W ) {

	// coffered white vault
	const vault = M.plaster( { tint: 0xf3efe6, rough: 0.7, dirt: 0.05 } );
	{

		const cx = fract( positionWorld.x.div( 1.25 ) ), cz = fract( positionWorld.z.div( 1.1 ) );
		const e = min( min( cx, cx.oneMinus() ), min( cz, cz.oneMinus() ) );
		const coffer = smoothstep( 0.04, 0.12, e );
		vault.colorNode = mix( color( 0xd9d2c3 ), color( 0xf5f1e8 ), coffer );

	}

	const mats = {
		floor: M.graniteFloor( {
			gridFn: floorGrid( { hallTile: 1.2, platTile: 1.2, diagHall: false } ),
			colors: [ 0x5b5856, 0x1f1d1c, 0xd8d2c8 ],
			patternFn: ( cell, xz ) => {

				const az = abs( xz.y );
				const border = abs( mod( cell.y, 5 ) ).lessThan( 0.5 ).select( float( 1 ), float( 0 ) );
				const hall = mod( cell.x, 4 ).lessThan( 0.5 ).select( float( 2 ), border );
				const plat = az.greaterThan( 9.25 ).select( float( 2 ), float( 0 ) );
				return az.lessThan( COL_Z - 0.2 ).select( hall, plat );

			}
		} ),
		pylon: M.marble( { base: 0xe9ddd4, base2: 0xd8c2b4, vein: 0x9a6f64, scale: 1.1, veinWidth: 8 } ),
		pink: M.marble( { base: 0xb98276, base2: 0x9a6358, vein: 0xe8d6c8, scale: 1.6, veinWidth: 6 } ),
		gilt: M.metal( { tint: 0xe2b659, rough: 0.28 } ),
		vault,
		wall: M.marble( { base: 0xe6dfd4, base2: 0xd5cabb, vein: 0x8c7d6d, scale: 1.2, veinWidth: 9 } ),
		dado: M.marble( { base: 0x3a2f2c, base2: 0x2a2220, vein: 0x9a8070, scale: 1.4, rough: 0.2 } ),
		edge: M.marble( { base: 0xdcd6cc, base2: 0xc9c1b4, vein: 0x8a8174, scale: 2.2 } ),
		stucco: M.stucco(),
		brass: M.brass(),
		crystal: M.crystal(),
		candle: M.stucco( { tint: 0xfffaf0, rough: 0.35 } ),
		oak: M.wood( { tint: 0x6e3f1d, tint2: 0x40220e } ),
		iron: M.metal( { tint: 0x2a2a2a, rough: 0.45 } )
	};
	buildFloor( W, mats.floor );
	buildPlatformEdges( W, { edgeMat: mats.edge, wallMat: mats.wall, dadoMat: mats.dado, cornice: mats.gilt, wallTop: PV.cy } );
	buildNameLetters( W, 'Новослободская', { metal: M.metal( { tint: 0xe2b659, rough: 0.25 } ), y: 2.3, h: 0.55 } );

	// ------------------------------------------------ pylons with stained glass on both faces
	const pyl = G.extrudeZ( G.roundRectShape( PYL_L, PYL_W, 0.12 ), SPRING, { bevel: 0.02 } );
	pyl.rotateX( - Math.PI / 2 );
	const plinth = G.extrudeZ( G.roundRectShape( PYL_L + 0.12, PYL_W + 0.12, 0.14 ), 0.35, { bevel: 0.02 } );
	plinth.rotateX( - Math.PI / 2 );
	const capital = G.extrudeZ( G.roundRectShape( PYL_L + 0.18, PYL_W + 0.18, 0.1 ), 0.22, { bevel: 0.03 } );
	capital.rotateX( - Math.PI / 2 );
	capital.translate( 0, SPRING - 0.22, 0 );
	const pm = [];
	for ( const s of [ - 1, 1 ] ) for ( const x of columnXs ) {

		pm.push( G.mat4( x, 0, s * COL_Z ) );
		W.colliders.addBox( x - PYL_L / 2 - 0.08, x + PYL_L / 2 + 0.08, s * COL_Z - PYL_W / 2 - 0.08, s * COL_Z + PYL_W / 2 + 0.08, 'pylon' );

	}

	W.addInstanced( pyl, mats.pylon, pm, { surface: SURF.stone } );
	W.addInstanced( G.merge( [ plinth ] ), mats.pink, pm, { surface: SURF.stone } );
	W.addInstanced( capital, mats.gilt, pm, { surface: SURF.metal } );
	// panels
	const designs = [ 1, 2, 3, 4, 5, 6 ].map( ( k ) => stainedGlassDesign( k ) );
	const glassMats = designs.map( ( t ) => M.stainedGlass( t, { power: 3.4 } ) );
	const broken = new THREE.MeshStandardNodeMaterial( { roughness: 0.6, metalness: 0.2 } );
	broken.colorNode = mix( color( 0x0a0908 ), color( 0x6a5a48 ), texture( crackTexture( 7 ), uv() ).a );
	const pw = 1.05, ph = 1.9;
	const panelGeo = new THREE.PlaneGeometry( pw, ph );
	const frames = [];
	let k = 0;
	const lightsByX = new Map();
	for ( const s of [ - 1, 1 ] ) for ( const x of columnXs ) for ( const face of [ - 1, 1 ] ) {

		const z = s * COL_Z + face * ( PYL_W / 2 + 0.012 );
		const n = new THREE.Vector3( 0, 0, face );
		new GlassPanel( W, { geo: panelGeo, mat: glassMats[ k ++ % glassMats.length ], position: new THREE.Vector3( x, 1.85, z ), normal: n, width: pw, height: ph, light: lightsByX.get( x ) || null, lightShare: 0.15, backMat: broken } );
		const f = new THREE.TorusGeometry( 1, 0.035, 6, 4, Math.PI * 2 );
		f.rotateZ( Math.PI / 4 );
		f.scale( pw * 0.72, ph * 0.72, 1 );
		f.translate( x, 1.85, z + face * 0.01 );
		frames.push( f );
		frames.push( G.lathe( [ [ 0.001, 0.03 ], [ 0.12, 0.02 ], [ 0.16, 0 ] ], 16, { x, y: 1.85 + ph / 2 + 0.2, z: z + face * 0.01, rx: face * Math.PI / 2 } ) );

	}

	W.addMesh( G.merge( frames ), mats.gilt, { surface: SURF.metal } );

	// ------------------------------------------------ arcade between pylons
	const supports = [ - HALF_L, ...columnXs, HALF_L ];
	const arcShape = new THREE.Shape();
	arcShape.moveTo( - HALF_L, TOP ); arcShape.lineTo( - HALF_L, SPRING );
	for ( let i = 0; i < supports.length - 1; i ++ ) {

		const a = supports[ i ] + ( i === 0 ? 0 : PYL_L / 2 ), b = supports[ i + 1 ] - ( i === supports.length - 2 ? 0 : PYL_L / 2 );
		const cx = ( a + b ) / 2, r = ( b - a ) / 2;
		arcShape.lineTo( a, SPRING );
		for ( let q = 1; q <= 24; q ++ ) { const t = Math.PI - Math.PI * q / 24; arcShape.lineTo( cx + Math.cos( t ) * r, SPRING + Math.sin( t ) * r * 0.8 ); }

	}

	arcShape.lineTo( HALF_L, SPRING ); arcShape.lineTo( HALF_L, TOP ); arcShape.closePath();
	for ( const s of [ - 1, 1 ] ) {

		W.addMesh( G.extrudeZ( arcShape, PYL_W, { z: s * COL_Z } ), mats.pylon, { surface: SURF.stone } );
		const cp = G.polyShape( [ [ 0, 0 ], [ - 0.08, 0 ], [ - 0.12, 0.08 ], [ - 0.3, 0.14 ], [ - 0.32, 0.24 ], [ 0, 0.24 ] ] );
		const c1 = G.extrudeX( cp, - HALF_L, HALF_L );
		if ( s < 0 ) c1.scale( 1, 1, - 1 );
		c1.translate( 0, TOP - 0.24, s * HALL_R );
		W.addMesh( c1, mats.gilt, { surface: SURF.metal } );

	}

	// ------------------------------------------------ hall vault
	const hallArc = [];
	for ( let i = 0; i <= 36; i ++ ) { const a = Math.PI * i / 36; hallArc.push( [ Math.cos( a ) * HALL_R, TOP + Math.sin( a ) * RISE ] ); }
	W.addMesh( G.sweepX( hallArc.slice().reverse(), - HALF_L, HALF_L, 1 ), mats.vault, { surface: SURF.plaster } );
	const ribs = [];
	for ( const x of columnXs ) ribs.push( G.ribAlong( hallArc, [ [ - 0.25, - 0.01 ], [ 0.25, - 0.01 ], [ 0.25, 0.08 ], [ - 0.25, 0.08 ] ], x, [ 0, TOP ] ) );
	W.addMesh( G.merge( ribs ), mats.stucco, { surface: SURF.plaster } );

	// ------------------------------------------------ platform vaults
	const platArc = G.ellipseArc( PV.cz, PV.cy, PV.rz, PV.ry, Math.PI / 2, 0, 24 );
	for ( const s of [ - 1, 1 ] ) {

		const arc = platArc.map( ( [ z, y ] ) => [ s * z, y ] );
		W.addMesh( G.sweepX( s > 0 ? arc : arc.slice().reverse(), - HALF_L, HALF_L, 1 ), mats.vault, { surface: SURF.plaster } );

	}

	// ------------------------------------------------ chandeliers
	const lantern = chandelierParts( 'lantern' );
	const chMats = { metal: mats.brass, white: mats.candle, crystal: mats.crystal };
	for ( const x of [ - 63.75, - 48.75, - 33.75, - 18.75, - 3.75, 3.75, 18.75, 33.75, 48.75, 63.75 ] ) {

		const light = W.light( x, TOP + RISE - 1.6, 0, 0xfff0dc, 70, 30 );
		const c = new LampCluster( W, {
			position: new THREE.Vector3( x, TOP + RISE - 0.05, 0 ), parts: lantern, mats: chMats, bulbMat: M.lampGlass( { tint: 0xfff0d6, power: 9 } ),
			light, lightOffset: new THREE.Vector3( 0, - 1.1, 0 ), pendulumLength: 1.4, bodyOffset: new THREE.Vector3( 0, - 1.0, 0 ), bodyRadius: 0.14
		} );
		c.root.scale.setScalar( 1.5 );
		c.root.updateMatrixWorld( true );

	}

	for ( const s of [ - 1, 1 ] ) for ( const x of [ - 52.5 + 3.75, - 26.25, 3.75, 26.25 + 3.75, 52.5 ] ) {

		const z = s * 9.3;
		const light = W.light( x, 5.2, z, 0xffe8cc, 24, 20 );
		new LampCluster( W, {
			position: new THREE.Vector3( x, 6.3, z ), parts: lantern, mats: chMats, bulbMat: M.lampGlass( { tint: 0xffe8cc, power: 8 } ),
			light, lightOffset: new THREE.Vector3( 0, - 1.1, 0 ), pendulumLength: 1.1, bodyOffset: new THREE.Vector3( 0, - 1.0, 0 ), bodyRadius: 0.14
		} );

	}

	// ------------------------------------------------ end walls with a large stained glass tableau
	const ceiling = [];
	const pv = ( s ) => platArc.map( ( [ z, y ] ) => [ s * z, y ] );
	ceiling.push( ...pv( - 1 ).slice().reverse() );
	ceiling.push( [ - HALL_R, TOP ] );
	for ( let i = 36; i >= 0; i -- ) ceiling.push( hallArc[ 36 - i ] ? [ - hallArc[ 36 - i ][ 0 ], hallArc[ 36 - i ][ 1 ] ] : hallArc[ 0 ] );
	ceiling.push( [ HALL_R, TOP ] );
	ceiling.push( ...pv( 1 ) );
	buildEndWalls( W, ceiling, {
		wallMat: mats.wall, portalMat: mats.pink, trimMat: mats.gilt, corridorMat: mats.wall,
		lampMat: M.lampGlass( { power: 5 } ), doorMat: mats.oak
	} );
	for ( const sx of [ - 1, 1 ] ) {

		const g = new THREE.PlaneGeometry( 2.4, 3.2 );
		g.rotateY( sx > 0 ? - Math.PI / 2 : Math.PI / 2 );
		g.translate( sx * ( HALF_L - 0.03 ), 6.4, 0 );
		W.addMesh( g, glassMats[ sx > 0 ? 0 : 3 ], { surface: SURF.glass } );

	}

	for ( const s of [ - 1, 1 ] ) for ( const x of [ - 48.75, - 26.25, - 3.75, 18.75, 41.25 ] ) registerBench( W, { x, z: s * ( COL_Z ), rotY: s > 0 ? 0 : Math.PI, woodMat: mats.oak, frameMat: mats.iron } );

	return {
		hemi: { sky: 0xfff0e0, ground: 0x3a3030, intensity: 0.12 },
		fog: { color: 0x18120f, density: 0.0045 },
		exposure: 1.0,
		envIntensity: 0.55
	};

}
