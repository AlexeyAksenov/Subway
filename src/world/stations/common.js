// Parts shared by every station: floor, platform edges, track walls, end walls with tunnel
// portals, exit corridors, colliders and spawn points. Plus persistent infrastructure
// (track bed, rails, sleepers, contact rail, running tunnels) built once for the whole game.
import * as THREE from 'three/webgpu';
import { float, vec2, abs, atan, floor, mod, fract, positionWorld, positionLocal, sin, smoothstep, mx_fractal_noise_float, mx_worley_noise_float, color, bumpMap, mix, step, texture, uv, vec3, min } from 'three/tsl';
import * as M from '../materials.js';
import * as G from '../geom.js';
import { SURF } from '../world.js';
import { textTexture, signTexture } from '../canvasArt.js';
import {
	HALF_L, PLAT_EDGE, TRACK_Z, WALL_Z, RAIL_Y, BED_Y, GAUGE, TUNNEL_R, TUNNEL_Y, TUNNEL_LEN,
	CORRIDOR_LEN, CORRIDOR_HALF, COL_Z
} from '../layout.js';

// ------------------------------------------------------------------ floor

export function buildFloor( W, mat ) {

	const g = new THREE.PlaneGeometry( HALF_L * 2 + 0.2, PLAT_EDGE * 2, 1, 1 );
	g.rotateX( - Math.PI / 2 );
	W.addMesh( g, mat, { surface: SURF.stone, name: 'floor' } );
	// corridor floors
	for ( const s of [ - 1, 1 ] ) {

		const c = new THREE.PlaneGeometry( CORRIDOR_LEN + 0.6, CORRIDOR_HALF * 2 );
		c.rotateX( - Math.PI / 2 );
		c.translate( s * ( HALF_L + CORRIDOR_LEN / 2 ), 0, 0 );
		W.addMesh( c, mat, { surface: SURF.stone } );

	}

}

// ------------------------------------------------------------------ platform edges + track walls

export function buildPlatformEdges( W, { edgeMat, wallMat, dadoMat, cornice = null, wallTop = 4.2 } ) {

	for ( const s of [ - 1, 1 ] ) {

		// vertical platform face and overhanging lip
		const faceG = new THREE.PlaneGeometry( HALF_L * 2, - BED_Y + 0.02 );
		faceG.rotateY( s > 0 ? Math.PI : 0 );
		faceG.translate( 0, BED_Y / 2, s * ( PLAT_EDGE - 0.12 ) );
		W.addMesh( faceG, dadoMat, { surface: SURF.concrete } );
		const lip = G.box( HALF_L * 2, 0.08, 0.2, { x: 0, y: - 0.04, z: s * ( PLAT_EDGE - 0.02 ) } );
		W.addMesh( lip, edgeMat, { surface: SURF.stone } );

		// track wall: dark dado below platform level, cladding above
		const dado = new THREE.PlaneGeometry( HALF_L * 2, 1.9 );
		dado.rotateY( s > 0 ? Math.PI : 0 );
		dado.translate( 0, BED_Y + 0.95, s * WALL_Z );
		W.addMesh( dado, dadoMat, { surface: SURF.stone } );
		const wall = new THREE.PlaneGeometry( HALF_L * 2, wallTop - ( BED_Y + 1.9 ) );
		wall.rotateY( s > 0 ? Math.PI : 0 );
		wall.translate( 0, ( wallTop + BED_Y + 1.9 ) / 2, s * WALL_Z );
		W.addMesh( wall, wallMat, { surface: SURF.stone } );
		// skirting & cornice mouldings on the track wall
		const prof = G.polyShape( [ [ 0, 0 ], [ - 0.12, 0 ], [ - 0.12, 0.05 ], [ - 0.07, 0.09 ], [ - 0.07, 0.16 ], [ 0, 0.18 ] ] );
		const sk = G.extrudeX( prof, - HALF_L, HALF_L );
		if ( s > 0 ) sk.scale( 1, 1, - 1 );
		sk.translate( 0, BED_Y + 1.9, s * WALL_Z );
		W.addMesh( sk, cornice || edgeMat, { surface: SURF.stone } );
		const cp = G.polyShape( [ [ 0, 0 ], [ - 0.1, 0.02 ], [ - 0.14, 0.1 ], [ - 0.28, 0.16 ], [ - 0.32, 0.26 ], [ 0, 0.26 ] ] );
		const cr = G.extrudeX( cp, - HALF_L, HALF_L );
		if ( s > 0 ) cr.scale( 1, 1, - 1 );
		cr.translate( 0, wallTop - 0.26, s * WALL_Z );
		W.addMesh( cr, cornice || edgeMat, { surface: SURF.stone } );

		// colliders at the platform edge (disabled by the train while the doors are open)
		const b = W.colliders.addBox( - HALF_L - 1, HALF_L + 1, s * PLAT_EDGE, s * ( WALL_Z + 1 ), s > 0 ? 'edge+' : 'edge-' );
		b.low = true; // doesn't block line of sight

	}

}

/** Metal letters with the station name on both track walls. */
export function buildNameLetters( W, name, { metal = M.brass(), y = 2.35, h = 0.62, xs = [ - 45, 0, 45 ] } = {} ) {

	const t = textTexture( name.toUpperCase(), { w: 2048, h: 256, font: 'bold 190px "Arial Narrow", "Roboto Condensed", Arial, sans-serif', spacing: 22 } );
	const m = metal;
	m.opacityNode = texture( t, uv() ).a;
	m.alphaTest = 0.5;
	m.transparent = false;
	const w = h * 8;
	for ( const s of [ - 1, 1 ] ) for ( const x of xs ) {

		const g = new THREE.PlaneGeometry( w, h );
		g.rotateY( s > 0 ? Math.PI : 0 );
		g.translate( x, y, s * ( WALL_Z - 0.03 ) );
		W.addMesh( g, m, { collide: false } );

	}

	return m;

}

// ------------------------------------------------------------------ end walls, exits, spawns

/**
 * End walls follow the station cross-section given as ceiling profile [[z,y],...] from -WALL_Z..WALL_Z.
 */
export function buildEndWalls( W, ceiling, { wallMat, portalMat, trimMat, corridorMat, corridorCeil, lampMat, doorMat, signName } ) {

	for ( const sx of [ - 1, 1 ] ) {

		const shape = new THREE.Shape();
		// outline in (u = -z*sx... ) we build in (z,y) then extrude along X
		const pts = [ [ - WALL_Z - 0.2, BED_Y ], [ WALL_Z + 0.2, BED_Y ] ];
		for ( let i = ceiling.length - 1; i >= 0; i -- ) pts.push( [ ceiling[ i ][ 0 ], ceiling[ i ][ 1 ] + 0.05 ] );
		shape.moveTo( - pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
		for ( let i = 1; i < pts.length; i ++ ) shape.lineTo( - pts[ i ][ 0 ], pts[ i ][ 1 ] );
		shape.closePath();
		// corridor portal
		shape.holes.push( G.archPath( 0, - 0.01, CORRIDOR_HALF * 2, 2.6, CORRIDOR_HALF, 24 ) );
		// running tunnel portals
		for ( const sz of [ - 1, 1 ] ) {

			const h = new THREE.Path();
			h.absarc( - sz * TRACK_Z, TUNNEL_Y, TUNNEL_R, 0, Math.PI * 2, true );
			shape.holes.push( h );

		}

		const g = G.extrudeX( shape, 0, 0.7 );
		g.translate( sx > 0 ? HALF_L : - HALF_L - 0.7, 0, 0 );
		W.addMesh( g, wallMat, { surface: SURF.stone } );

		// portal frame (archivolt) around the corridor opening
		const arc = new THREE.Path();
		const frame = new THREE.Shape();
		const R0 = CORRIDOR_HALF + 0.45;
		frame.moveTo( - R0, - 0.01 );
		frame.lineTo( - R0, 2.6 );
		frame.absarc( 0, 2.6, R0, Math.PI, 0, true );
		frame.lineTo( R0, - 0.01 );
		frame.lineTo( CORRIDOR_HALF, - 0.01 );
		frame.lineTo( CORRIDOR_HALF, 2.6 );
		frame.absarc( 0, 2.6, CORRIDOR_HALF, 0, Math.PI, false );
		frame.lineTo( - CORRIDOR_HALF, - 0.01 );
		frame.closePath();
		void arc;
		const fg = G.extrudeZ( frame, 0.2, { bevel: 0.03, curveSegments: 32 } );
		fg.rotateY( Math.PI / 2 );
		fg.translate( sx > 0 ? HALF_L - 0.1 : - HALF_L + 0.1, 0, 0 );
		W.addMesh( fg, portalMat, { surface: SURF.stone } );

		// sign above the portal
		const sign = signTexture( sx > 0 ? 'Выход в город' : 'Переход', { sub: sx > 0 ? 'к улицам и вокзалам' : 'на другие линии' } );
		const sm = new THREE.MeshStandardNodeMaterial();
		sm.colorNode = texture( sign, uv() ).rgb.mul( 0.3 );
		sm.emissiveNode = texture( sign, uv() ).rgb.mul( 1.6 );
		const sgeo = new THREE.BoxGeometry( 0.12, 0.5, 3.2 );
		// only the inward face shows the texture properly; mapping on box sides is fine for a light box
		const sp = new THREE.PlaneGeometry( 3.2, 0.5 );
		sp.rotateY( sx > 0 ? - Math.PI / 2 : Math.PI / 2 );
		sp.translate( sx > 0 ? HALF_L - 0.26 : - HALF_L + 0.26, 5.9, 0 );
		W.addMesh( sp, sm, { collide: false } );
		sgeo.translate( sx > 0 ? HALF_L - 0.17 : - HALF_L + 0.17, 5.9, 0 );
		W.addMesh( sgeo, M.paint( { tint: 0x1a1d24, rough: 0.4 } ), { surface: SURF.metal } );

		// exit corridor (short barrel-vaulted passage ending in doors)
		const x0 = sx > 0 ? HALF_L + 0.7 : - HALF_L - CORRIDOR_LEN;
		const x1 = sx > 0 ? HALF_L + CORRIDOR_LEN : - HALF_L - 0.7;
		const prof = [ [ - CORRIDOR_HALF, - 0.01 ], [ - CORRIDOR_HALF, 2.6 ], ...G.ellipseArc( 0, 2.6, CORRIDOR_HALF, CORRIDOR_HALF * 0.8, Math.PI, 0, 16 ).slice( 1, - 1 ), [ CORRIDOR_HALF, 2.6 ], [ CORRIDOR_HALF, - 0.01 ] ];
		const cg = G.sweepX( prof, x0, x1, 1 );
		W.addMesh( cg, corridorMat, { surface: SURF.stone } );
		const endX = sx > 0 ? HALF_L + CORRIDOR_LEN : - HALF_L - CORRIDOR_LEN;
		const endShape = new THREE.Shape();
		endShape.moveTo( - CORRIDOR_HALF - 0.1, - 0.01 );
		endShape.lineTo( CORRIDOR_HALF + 0.1, - 0.01 );
		endShape.lineTo( CORRIDOR_HALF + 0.1, 2.6 );
		endShape.absarc( 0, 2.6, CORRIDOR_HALF + 0.1, 0, Math.PI, false );
		endShape.closePath();
		const eg = G.extrudeX( endShape, 0, 0.3 );
		eg.translate( endX - ( sx > 0 ? 0 : 0.3 ), 0, 0 );
		W.addMesh( eg, corridorMat, { surface: SURF.stone } );
		// double doors (oak with brass push bars)
		for ( const dz of [ - 0.9, 0.9 ] ) {

			const d = G.box( 0.08, 2.3, 1.1, { x: endX - sx * 0.06, y: 1.15, z: dz * 0.62 } );
			W.addMesh( d, doorMat, { surface: SURF.wood } );
			const bar = G.box( 0.05, 0.05, 0.8, { x: endX - sx * 0.12, y: 1.05, z: dz * 0.62 } );
			W.addMesh( bar, trimMat, { surface: SURF.metal } );

		}

		// corridor lamps
		for ( let k = 0; k < 3; k ++ ) {

			const lx = sx > 0 ? HALF_L + 2.5 + k * 4 : - HALF_L - 2.5 - k * 4;
			const lamp = G.cyl( 0.22, 0.3, 0.14, 16, { x: lx, y: 2.6 + CORRIDOR_HALF * 0.8 - 0.1, z: 0 } );
			W.addMesh( lamp, lampMat, { collide: false } );

		}

		W.light( sx * ( HALF_L + 6 ), 3.4, 0, 0xffe0b0, 12, 12 );

		// colliders: end walls (with portal gap), corridor walls
		W.colliders.addBox( sx * HALF_L, sx * ( HALF_L + 0.7 ), CORRIDOR_HALF, WALL_Z + 1 );
		W.colliders.addBox( sx * HALF_L, sx * ( HALF_L + 0.7 ), - WALL_Z - 1, - CORRIDOR_HALF );
		W.colliders.addBox( sx * HALF_L, sx * ( HALF_L + CORRIDOR_LEN + 1 ), CORRIDOR_HALF, CORRIDOR_HALF + 0.6 );
		W.colliders.addBox( sx * HALF_L, sx * ( HALF_L + CORRIDOR_LEN + 1 ), - CORRIDOR_HALF - 0.6, - CORRIDOR_HALF );
		W.colliders.addBox( sx * ( HALF_L + CORRIDOR_LEN - 0.05 ), sx * ( HALF_L + CORRIDOR_LEN + 1 ), - CORRIDOR_HALF - 1, CORRIDOR_HALF + 1 );

		// spawn points
		W.spawns.push( { x: sx * ( HALF_L + CORRIDOR_LEN - 2 ), z: 0, kind: 'corridor' } );
		W.spawns.push( { x: sx * ( HALF_L + CORRIDOR_LEN - 4 ), z: 0.8, kind: 'corridor' } );
		for ( const sz of [ - 1, 1 ] ) {

			// service doors at the far ends of both platforms
			W.spawns.push( { x: sx * ( HALF_L - 1.2 ), z: sz * ( COL_Z + 2.1 ), kind: 'service' } );
			const door = G.box( 0.1, 2.2, 1.0, { x: sx * ( HALF_L - 0.02 ), y: 1.1, z: sz * ( COL_Z + 2.1 ) } );
			W.addMesh( door, M.paint( { tint: 0x2e3a33, rough: 0.5, metal: 0.2 } ), { surface: SURF.metal } );
			const lit = G.box( 0.06, 0.18, 0.6, { x: sx * ( HALF_L - 0.08 ), y: 2.45, z: sz * ( COL_Z + 2.1 ) } );
			W.addMesh( lit, M.basicEmissive( 0x4dff7a, 3 ), { collide: false } );

		}

	}

	if ( signName ) void signName;

}

// ------------------------------------------------------------------ persistent infrastructure

export function buildInfrastructure() {

	const group = new THREE.Group();
	group.name = 'infrastructure';
	const X0 = - HALF_L - TUNNEL_LEN, X1 = HALF_L + TUNNEL_LEN;
	const add = ( g, m ) => { const mesh = new THREE.Mesh( g, m ); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add( mesh ); return mesh; };

	// track bed
	const bedMat = M.trackBed();
	for ( const s of [ - 1, 1 ] ) {

		const g = new THREE.PlaneGeometry( X1 - X0, WALL_Z - PLAT_EDGE + 1.2 );
		g.rotateX( - Math.PI / 2 );
		g.translate( 0, BED_Y, s * ( ( WALL_Z + PLAT_EDGE ) / 2 + 0.3 ) );
		add( g, bedMat );

	}

	// rails (UIC-ish profile), extruded along the whole line
	const railShape = G.polyShape( [
		[ - 0.075, 0 ], [ 0.075, 0 ], [ 0.075, 0.012 ], [ 0.012, 0.03 ], [ 0.009, 0.125 ], [ 0.036, 0.135 ], [ 0.036, 0.18 ], [ - 0.036, 0.18 ], [ - 0.036, 0.135 ], [ - 0.009, 0.125 ], [ - 0.012, 0.03 ], [ - 0.075, 0.012 ]
	] );
	const railGeo = G.extrudeX( railShape, X0, X1 );
	const railMat = M.metal( { tint: 0x8a7f74, rough: 0.55, local: false } );
	// polished running surface
	railMat.colorNode = mix( color( 0x5a4a3e ), color( 0xd9dde2 ), smoothstep( 0.165, 0.178, positionLocal.y ) );
	railMat.roughnessNode = mix( float( 0.7 ), float( 0.12 ), smoothstep( 0.165, 0.178, positionLocal.y ) );
	const rails = [];
	for ( const s of [ - 1, 1 ] ) for ( const r of [ - 1, 1 ] ) {

		const g = railGeo.clone();
		g.translate( 0, RAIL_Y - 0.18, s * TRACK_Z + r * GAUGE / 2 );
		rails.push( g );

	}

	add( G.merge( rails ), railMat );

	// contact (third) rail with protective cover
	const cr = [];
	for ( const s of [ - 1, 1 ] ) {

		cr.push( G.box( X1 - X0, 0.08, 0.08, { y: RAIL_Y + 0.02, z: s * ( TRACK_Z + 1.55 ) } ) );
		cr.push( G.box( X1 - X0, 0.025, 0.32, { y: RAIL_Y + 0.14, z: s * ( TRACK_Z + 1.6 ) } ) );

	}

	add( G.merge( cr ), M.paint( { tint: 0x5c554c, rough: 0.7, local: false } ) );

	// sleepers embedded in concrete (instanced)
	const sleeperGeo = new THREE.BoxGeometry( 0.24, 0.16, 2.5 );
	const sm = [];
	for ( const s of [ - 1, 1 ] ) for ( let x = X0; x < X1; x += 0.78 ) sm.push( G.mat4( x, BED_Y + 0.06, s * TRACK_Z ) );
	const sleepers = G.instanced( sleeperGeo, M.wood( { tint: 0x3b2a1e, tint2: 0x241810, rough: 0.8, scale: 10, axis: 'z' } ), sm );
	sleepers.frustumCulled = false;
	group.add( sleepers );

	// running tunnels (cast-iron tubbing rings)
	const tunMat = new THREE.MeshStandardNodeMaterial();
	{

		const px = positionWorld.x;
		const ring = abs( fract( px.div( 0.75 ) ).sub( 0.5 ) ).mul( 2 ); // 0 at centre of segment, 1 at flange
		const flange = smoothstep( 0.8, 0.95, ring );
		const ang = atan( positionLocal.y.sub( TUNNEL_Y ), abs( positionLocal.z ).sub( TRACK_Z ) );
		const seg = abs( fract( ang.mul( 16 / ( Math.PI * 2 ) ) ).sub( 0.5 ) ).mul( 2 );
		const rib = smoothstep( 0.9, 0.98, seg );
		const n = mx_fractal_noise_float( positionWorld.mul( 1.5 ), 3 ).mul( 0.5 ).add( 0.5 );
		const rust = smoothstep( 0.55, 0.8, mx_fractal_noise_float( positionWorld.mul( 0.4 ), 2 ).mul( 0.5 ).add( 0.5 ) );
		tunMat.colorNode = mix( color( 0x2b2a28 ), color( 0x4a2e1c ), rust.mul( 0.7 ) ).mul( n.mul( 0.5 ).add( 0.6 ) ).mul( float( 1 ).add( flange.mul( 0.4 ) ) );
		tunMat.roughnessNode = float( 0.75 ).sub( flange.mul( 0.2 ) );
		tunMat.metalnessNode = float( 0.35 );
		tunMat.normalNode = bumpMap( flange.add( rib.mul( 0.6 ) ), float( 1.5 ) );
		tunMat.side = THREE.BackSide;

	}

	const tg = [];
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const g = new THREE.CylinderGeometry( TUNNEL_R, TUNNEL_R, TUNNEL_LEN, 40, 1, true );
		g.rotateZ( Math.PI / 2 );
		g.translate( sx * ( HALF_L + TUNNEL_LEN / 2 ), TUNNEL_Y, sz * TRACK_Z );
		tg.push( g );

	}

	const tunnels = add( G.merge( tg ), tunMat );
	tunnels.userData.collide = true;

	// cables & lamps along the tunnel walls
	const cab = [];
	const lampG = [];
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const wallZ = sz * ( TRACK_Z + TUNNEL_R - 0.3 );
		for ( let k = 0; k < 5; k ++ ) cab.push( G.cyl( 0.03, 0.03, TUNNEL_LEN, 6, { x: sx * ( HALF_L + TUNNEL_LEN / 2 ), y: 0.4 + k * 0.11, z: wallZ, rz: Math.PI / 2 } ) );
		for ( let x = HALF_L + 8; x < HALF_L + TUNNEL_LEN; x += 15 ) {

			lampG.push( G.box( 0.35, 0.12, 0.14, { x: sx * x, y: 2.15, z: sz * ( TRACK_Z + ( TUNNEL_R - 0.45 ) ) } ) );

		}

	}

	add( G.merge( cab ), M.paint( { tint: 0x151515, rough: 0.6 } ) );
	add( G.merge( lampG ), M.basicEmissive( 0xffcf8a, 6 ) );

	// signals at the tunnel mouths (red/green)
	const sig = [];
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) sig.push( G.cyl( 0.07, 0.07, 0.05, 12, { x: sx * ( HALF_L + 6 ), y: 1.2, z: sz * ( TRACK_Z + 2.0 ), rz: Math.PI / 2 } ) );
	const sigMat = M.basicEmissive( 0x33ff66, 5 );
	add( G.merge( sig ), sigMat );

	return { group, tunnelGeometry: tunnels.geometry, bedY: BED_Y };

}

/** Add persistent infrastructure to a station's collision BVH. */
export function addInfrastructureCollision( W, infra ) {

	W.addCollisionGeometry( infra.tunnelGeometry, null, SURF.metal );
	for ( const s of [ - 1, 1 ] ) {

		const g = new THREE.PlaneGeometry( HALF_L * 2 + TUNNEL_LEN * 2, WALL_Z - PLAT_EDGE + 1.2 );
		g.rotateX( - Math.PI / 2 );
		g.translate( 0, BED_Y, s * ( ( WALL_Z + PLAT_EDGE ) / 2 + 0.3 ) );
		W.addCollisionGeometry( g, null, SURF.concrete );

	}

}

// ------------------------------------------------------------------ utilities for station builders

/** Rotated-checker / strip floor patterns. */
export function floorGrid( { hallTile = 1.1, platTile = 1.2, diagHall = true } = {} ) {

	return ( xz ) => {

		const az = abs( xz.y );
		const rot = vec2( xz.x.add( xz.y ), xz.x.sub( xz.y ) ).mul( 0.70710678 );
		const hall = diagHall ? rot.div( hallTile ) : xz.div( hallTile );
		const plat = xz.div( platTile );
		return az.lessThan( COL_Z - 0.2 ).select( hall, plat );

	};

}

export { vec3, min, step, sin, mx_worley_noise_float, floor, mod };
