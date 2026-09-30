// Procedural first-person weapon models built from real dimensions (metres).
// Gun space: +X = muzzle direction, +Y = up, +Z = right side of the weapon.
import * as THREE from 'three/webgpu';
import { float, color, mix, positionLocal, mx_fractal_noise_float, mx_noise_float, smoothstep, bumpMap, vec3, abs, fract, texture, uv } from 'three/tsl';
import { merge, place, polyShape, roundRectShape } from '../world/geom.js';

// ------------------------------------------------------------------ materials

function gunMetal( { tint = 0x202124, rough = 0.38, metal = 0.85, wear = 0.25, scale = 120 } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const P = positionLocal.mul( scale );
	const n = mx_fractal_noise_float( P, 3, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	const scratches = smoothstep( 0.92, 0.99, abs( mx_noise_float( vec3( P.x.mul( 0.3 ), P.y.mul( 6 ), P.z.mul( 6 ) ) ) ).oneMinus() );
	const w = smoothstep( 0.62, 0.85, n ).mul( wear ).add( scratches.mul( wear * 0.6 ) );
	m.colorNode = mix( color( tint ), color( 0x8d8f94 ), w );
	m.roughnessNode = float( rough ).sub( w.mul( 0.2 ) ).add( n.mul( 0.08 ) );
	m.metalnessNode = float( metal );
	m.clearcoat = 0.15;
	return m;

}

function woodMat( { tint = 0x9a4a22, tint2 = 0x5a2610, scale = 60 } = {} ) {

	const m = new THREE.MeshPhysicalNodeMaterial();
	const P = positionLocal.mul( scale );
	const warp = mx_fractal_noise_float( vec3( P.x.mul( 0.05 ), P.y, P.z ), 3, 2.0, 0.5 );
	const grain = fract( P.y.mul( 1.3 ).add( P.z.mul( 0.4 ) ).add( warp.mul( 2.5 ) ) );
	const fib = mx_noise_float( vec3( P.x.mul( 0.08 ), P.y.mul( 8 ), P.z.mul( 8 ) ) ).mul( 0.5 ).add( 0.5 );
	m.colorNode = mix( color( tint ), color( tint2 ), smoothstep( 0.3, 0.95, grain ).mul( 0.6 ).add( fib.mul( 0.25 ) ) );
	m.roughnessNode = float( 0.35 ).add( fib.mul( 0.15 ) );
	m.metalnessNode = float( 0 );
	m.clearcoat = 0.7;
	m.clearcoatRoughness = 0.25;
	return m;

}

function rubberMat( tint = 0x111111 ) {

	const m = new THREE.MeshStandardNodeMaterial();
	const P = positionLocal.mul( 700 );
	const n = mx_noise_float( P ).mul( 0.5 ).add( 0.5 );
	m.colorNode = color( tint ).mul( n.mul( 0.4 ).add( 0.8 ) );
	m.roughnessNode = float( 0.8 );
	m.metalnessNode = float( 0 );
	m.normalNode = bumpMap( n, float( 1.2 ) );
	return m;

}

let MATS = null;
export function gunMaterials() {

	if ( MATS ) return MATS;
	MATS = {
		blued: gunMetal( { tint: 0x2a2c31, rough: 0.34, metal: 0.85, wear: 0.3 } ),
		parker: gunMetal( { tint: 0x3a3c40, rough: 0.5, metal: 0.7, wear: 0.4 } ),
		steel: gunMetal( { tint: 0x9fa3a8, rough: 0.2, metal: 1, wear: 0.1, scale: 200 } ),
		chrome: gunMetal( { tint: 0xc9ccd1, rough: 0.12, metal: 1, wear: 0.06, scale: 250 } ),
		dark: gunMetal( { tint: 0x0d0d0e, rough: 0.5, metal: 0.6, wear: 0.1 } ),
		wood: woodMat(),
		walnut: woodMat( { tint: 0x7a4422, tint2: 0x3e2010, scale: 45 } ),
		rubber: rubberMat(),
		bore: new THREE.MeshBasicNodeMaterial( { color: 0x000000 } ),
		glass: new THREE.MeshPhysicalNodeMaterial( { color: 0x0a1a24, metalness: 0.2, roughness: 0.02, clearcoat: 1, envMapIntensity: 2 } ),
		brass: gunMetal( { tint: 0xc99a3e, rough: 0.25, metal: 1, wear: 0.05 } ),
		glove: rubberMat( 0x1a1a1a ),
		sleeve: ( () => { const m = rubberMat( 0x23262b ); m.roughnessNode = float( 0.95 ); return m; } )(),
		sight: new THREE.MeshBasicNodeMaterial( { color: new THREE.Color( 2.5, 0.25, 0.12 ) } ),
		redShell: new THREE.MeshPhysicalNodeMaterial( { color: 0xa01218, roughness: 0.4, clearcoat: 0.6 } )
	};
	return MATS;

}

// ------------------------------------------------------------------ helpers

function ext( shape, depth, bevel = 0.0015, curveSegments = 8 ) {

	const s = Array.isArray( shape ) ? polyShape( shape ) : shape;
	const g = new THREE.ExtrudeGeometry( s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments } );
	g.translate( 0, 0, - depth / 2 );
	return g;

}

const bx = ( w, h, d, o ) => place( new THREE.BoxGeometry( w, h, d ), o );
const cx = ( r0, r1, len, seg, o = {} ) => place( new THREE.CylinderGeometry( r0, r1, len, seg ), { rz: - Math.PI / 2, ...o } ); // along X

function part( geoList, mat, name ) {

	const g = Array.isArray( geoList ) ? merge( geoList ) : geoList;
	const m = new THREE.Mesh( g, mat );
	if ( name ) m.name = name;
	return m;

}

function anchor( group, name, x, y, z = 0 ) {

	const o = new THREE.Object3D();
	o.name = name;
	o.position.set( x, y, z );
	group.add( o );
	return o;

}

// ------------------------------------------------------------------ hands

/** A gloved hand wrapped around an axis (local +Y). palmSide: which side the palm sits (-1 = -X). */
export function gripHand( { radius = 0.016, curl = 1, thumbUp = false, mirror = false } = {} ) {

	const M = gunMaterials();
	const g = new THREE.Group();
	const parts = [];
	const R = radius + 0.012;
	// palm block behind the grip
	parts.push( place( ext( roundRectShape( 0.1, 0.035, 0.012 ), 0.085, 0.008 ), { x: - R - 0.012, y: 0.0, rz: Math.PI / 2 } ) );
	// fingers: 4 fingers stacked along the grip, each 3 segments wrapping around
	for ( let f = 0; f < 4; f ++ ) {

		const y = 0.032 - f * 0.022;
		const fr = 0.0085 - f * 0.0006;
		let a = Math.PI; // start behind (palm side)
		const segs = [ 0.045, 0.028, 0.022 ];
		for ( let s = 0; s < 3; s ++ ) {

			const a1 = a - ( segs[ s ] / R ) * curl;
			const p0 = new THREE.Vector3( Math.cos( a ) * R, y, Math.sin( a ) * R );
			const p1 = new THREE.Vector3( Math.cos( a1 ) * R, y, Math.sin( a1 ) * R );
			const mid = p0.clone().add( p1 ).multiplyScalar( 0.5 );
			const len = p0.distanceTo( p1 );
			const cap = new THREE.CapsuleGeometry( fr, len, 3, 8 );
			const q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), p1.clone().sub( p0 ).normalize() );
			cap.applyQuaternion( q );
			cap.translate( mid.x, mid.y, mid.z );
			parts.push( cap );
			a = a1;

		}

	}

	// thumb
	const t0 = new THREE.Vector3( - R, 0.035, - 0.02 );
	const t1 = thumbUp ? new THREE.Vector3( - R * 0.2, 0.07, - R - 0.004 ) : new THREE.Vector3( R * 0.3, 0.045, - R - 0.004 );
	const tl = t0.distanceTo( t1 );
	const tc = new THREE.CapsuleGeometry( 0.0095, tl, 3, 8 );
	tc.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), t1.clone().sub( t0 ).normalize() ) );
	tc.translate( ( t0.x + t1.x ) / 2, ( t0.y + t1.y ) / 2, ( t0.z + t1.z ) / 2 );
	parts.push( tc );
	const hand = part( parts, M.glove );
	if ( mirror ) hand.scale.z = - 1;
	g.add( hand );
	// wrist anchor: forearms are attached per weapon with attachArm()
	const wrist = new THREE.Object3D();
	wrist.name = 'wrist';
	wrist.position.set( - R - 0.035, - 0.06, 0 );
	g.add( wrist );
	return g;

}

/** Forearm + sleeve from a hand's wrist towards a shoulder point (gun space). */
function attachArm( G, hand, offset ) {

	const M = gunMaterials();
	G.updateMatrixWorld( true );
	const inv = new THREE.Matrix4().copy( G.matrixWorld ).invert();
	const w = hand.getObjectByName( 'wrist' ).getWorldPosition( new THREE.Vector3() ).applyMatrix4( inv );
	const dir = offset.clone();
	const len = dir.length();
	dir.normalize();
	const q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir );
	const glove = new THREE.Mesh( new THREE.CylinderGeometry( 0.026, 0.024, 0.08, 12 ), M.glove );
	glove.position.copy( w ).addScaledVector( dir, 0.035 );
	glove.quaternion.copy( q );
	G.add( glove );
	const sleeve = new THREE.Mesh( new THREE.CylinderGeometry( 0.042, 0.033, len, 14 ), M.sleeve );
	sleeve.position.copy( w ).addScaledVector( dir, 0.07 + len / 2 );
	sleeve.quaternion.copy( q );
	G.add( sleeve );
	const cuff = new THREE.Mesh( new THREE.TorusGeometry( 0.037, 0.009, 6, 16 ), M.sleeve );
	cuff.position.copy( w ).addScaledVector( dir, 0.075 );
	cuff.quaternion.copy( q ).multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI / 2 ) );
	G.add( cuff );

}

// forearm directions in gun space (+X forward, +Y up, +Z right): arms come from below/behind the camera
const ARM_R = new THREE.Vector3( - 0.32, - 0.4, 0.16 );
const ARM_L = new THREE.Vector3( - 0.2, - 0.55, - 0.22 );
const ARM_LP = new THREE.Vector3( - 0.3, - 0.36, - 0.2 );

// ------------------------------------------------------------------ Desert Eagle .50 AE

export function buildDeagle() {

	const M = gunMaterials();
	const G = new THREE.Group();
	G.name = 'deagle';
	// frame + grip (steel)
	const frameShape = polyShape( [
		[ - 0.083, 0.022 ], [ 0.118, 0.022 ], [ 0.118, 0.011 ], [ 0.052, 0.008 ], [ 0.05, - 0.012 ], [ 0.043, - 0.028 ], [ 0.03, - 0.034 ],
		[ 0.0, - 0.034 ], [ - 0.01, - 0.025 ], [ - 0.014, - 0.008 ], [ - 0.022, - 0.006 ], [ - 0.047, - 0.118 ], [ - 0.097, - 0.12 ],
		[ - 0.086, - 0.02 ], [ - 0.082, 0.0 ], [ - 0.098, 0.012 ], [ - 0.094, 0.02 ]
	] );
	const hole = new THREE.Path();
	hole.moveTo( - 0.006, - 0.007 ); hole.lineTo( 0.04, - 0.004 ); hole.quadraticCurveTo( 0.04, - 0.027, 0.026, - 0.027 ); hole.lineTo( 0.0, - 0.027 ); hole.quadraticCurveTo( - 0.006, - 0.022, - 0.006, - 0.007 );
	frameShape.holes.push( hole );
	const frame = part( ext( frameShape, 0.027, 0.0015 ), M.chrome, 'frame' );
	G.add( frame );
	// rubber grip panels
	const gripShape = polyShape( [ [ - 0.024, - 0.012 ], [ - 0.046, - 0.112 ], [ - 0.092, - 0.114 ], [ - 0.083, - 0.018 ] ] );
	const grip = part( ext( gripShape, 0.033, 0.003 ), M.rubber );
	G.add( grip );
	// magazine base plate
	G.add( part( bx( 0.05, 0.008, 0.028, { x: - 0.07, y: - 0.121, rz: 0.2 } ), M.dark ) );
	// slide / barrel assembly (moves on recoil)
	const slide = new THREE.Group();
	slide.name = 'slide';
	const slideShape = polyShape( [ [ - 0.09, 0.022 ], [ 0.195, 0.022 ], [ 0.195, 0.062 ], [ 0.03, 0.066 ], [ - 0.02, 0.066 ], [ - 0.09, 0.062 ] ] );
	slide.add( part( ext( slideShape, 0.03, 0.0025 ), M.chrome ) );
	// triangular barrel flank chamfers
	const flank = [];
	for ( const s of [ - 1, 1 ] ) flank.push( place( ext( [ [ 0.07, 0.024 ], [ 0.195, 0.024 ], [ 0.195, 0.034 ], [ 0.07, 0.04 ] ], 0.004, 0.001 ), { z: s * 0.016 } ) );
	slide.add( part( flank, M.steel ) );
	// top rib / rail
	const rail = [ bx( 0.2, 0.006, 0.012, { x: 0.085, y: 0.069 } ) ];
	for ( let i = 0; i < 12; i ++ ) rail.push( bx( 0.006, 0.004, 0.015, { x: - 0.005 + i * 0.016, y: 0.073 } ) );
	slide.add( part( rail, M.dark ) );
	// serrations
	const ser = [];
	for ( let i = 0; i < 9; i ++ ) for ( const s of [ - 1, 1 ] ) ser.push( bx( 0.0025, 0.03, 0.002, { x: - 0.082 + i * 0.0045, y: 0.045, z: s * 0.0155 } ) );
	slide.add( part( ser, M.dark ) );
	// sights
	slide.add( part( [ bx( 0.008, 0.01, 0.004, { x: 0.183, y: 0.08 } ), bx( 0.012, 0.009, 0.02, { x: - 0.074, y: 0.075 } ) ], M.dark ) );
	slide.add( part( bx( 0.0028, 0.0028, 0.0045, { x: 0.183, y: 0.084 } ), M.sight ) );
	// bore
	slide.add( part( cx( 0.0066, 0.0066, 0.004, 16, { x: 0.1955, y: 0.046 } ), M.bore ) );
	slide.add( part( cx( 0.009, 0.009, 0.003, 16, { x: 0.1945, y: 0.046 } ), M.steel ) );
	// engraving plate on the left side
	const tc = document.createElement( 'canvas' ); tc.width = 512; tc.height = 64;
	const g2 = tc.getContext( '2d' ); g2.fillStyle = '#fff'; g2.font = 'bold 40px Arial'; g2.fillText( 'DESERT EAGLE  .50 AE', 6, 46 );
	const tt = new THREE.CanvasTexture( tc );
	const em = new THREE.MeshStandardNodeMaterial( { roughness: 0.6, metalness: 0.4 } );
	em.colorNode = color( 0x222222 );
	em.opacityNode = texture( tt, uv() ).a;
	em.alphaTest = 0.5;
	const ep = new THREE.Mesh( new THREE.PlaneGeometry( 0.11, 0.0138 ), em );
	ep.position.set( 0.1, 0.044, - 0.0172 );
	ep.rotation.y = Math.PI;
	slide.add( ep );
	G.add( slide );
	// hammer, trigger, levers
	const hammer = part( ext( [ [ 0, 0 ], [ 0.012, 0.0 ], [ 0.004, 0.022 ], [ - 0.006, 0.02 ] ], 0.007, 0.001 ), M.dark );
	hammer.position.set( - 0.094, 0.035, 0 );
	hammer.rotation.z = 0.5;
	G.add( hammer );
	const trigger = part( ext( [ [ 0.0, 0.0 ], [ 0.006, 0 ], [ 0.012, - 0.012 ], [ 0.008, - 0.022 ], [ 0.003, - 0.022 ], [ 0.004, - 0.01 ] ], 0.006, 0.001 ), M.dark );
	trigger.position.set( 0.008, - 0.002, 0 );
	G.add( trigger );
	G.add( part( [ bx( 0.03, 0.006, 0.004, { x: 0.02, y: 0.018, z: - 0.016 } ), bx( 0.014, 0.012, 0.006, { x: - 0.072, y: 0.052, z: - 0.017 } ) ], M.dark ) );
	// magazine (for reload animation) with visible cartridges on top
	const mag = new THREE.Group(); mag.name = 'mag';
	mag.add( part( bx( 0.05, 0.11, 0.022, { x: - 0.066, y: - 0.06, rz: 0.2 } ), M.dark ) );
	mag.add( part( cx( 0.0064, 0.006, 0.03, 10, { x: - 0.052, y: 0.0, rz: - Math.PI / 2 + 0.2 } ), M.brass ) );
	mag.visible = true;
	G.add( mag );

	anchor( G, 'muzzle', 0.2, 0.046 );
	anchor( G, 'eject', 0.02, 0.06, 0.015 );
	anchor( G, 'rightHand', - 0.064, - 0.05 );
	anchor( G, 'leftHand', - 0.058, - 0.07, - 0.02 );
	G.userData = { sightY: 0.084, sightX: 0.18, length: 0.29 };
	// hands: right hand around grip (grip axis tilted), left supporting from below-left
	const rh = gripHand( { radius: 0.022, curl: 1.0, thumbUp: false } );
	rh.position.set( - 0.066, - 0.058, 0 );
	rh.rotation.z = 0.2; // grip angle
	G.add( rh );
	const lh = gripHand( { radius: 0.03, curl: 0.8, mirror: true } );
	lh.position.set( - 0.06, - 0.075, - 0.028 );
	lh.rotation.set( 0.9, 0.2, 0.25 );
	G.add( lh );
	attachArm( G, rh, ARM_R );
	attachArm( G, lh, ARM_LP );
	return G;

}

// ------------------------------------------------------------------ AK-47 (type 3, milled receiver)

export function buildAK() {

	const M = gunMaterials();
	const G = new THREE.Group();
	G.name = 'ak47';
	// receiver (milled) with lightening cut
	G.add( part( [ ext( [ [ - 0.14, - 0.036 ], [ 0.135, - 0.036 ], [ 0.14, - 0.02 ], [ 0.14, 0.03 ], [ - 0.14, 0.03 ] ], 0.036, 0.002 ) ], M.parker, 'receiver' ) );
	G.add( part( [ bx( 0.1, 0.022, 0.002, { x: 0.07, y: 0.0, z: - 0.0185 } ), bx( 0.1, 0.022, 0.002, { x: 0.07, y: 0.0, z: 0.0185 } ) ], M.dark ) );
	// dust cover with ribs
	const cover = part( [ ext( [ [ - 0.135, 0.03 ], [ 0.1, 0.03 ], [ 0.1, 0.043 ], [ 0.08, 0.05 ], [ - 0.12, 0.05 ], [ - 0.135, 0.044 ] ], 0.033, 0.004 ), bx( 0.008, 0.02, 0.036, { x: - 0.1, y: 0.042 } ), bx( 0.008, 0.02, 0.036, { x: 0.05, y: 0.042 } ) ], M.blued, 'cover' );
	G.add( cover );
	// rear sight block + leaf
	G.add( part( [ ext( [ [ 0.13, 0.03 ], [ 0.2, 0.03 ], [ 0.2, 0.045 ], [ 0.13, 0.058 ] ], 0.03, 0.002 ), bx( 0.075, 0.004, 0.018, { x: 0.165, y: 0.062, rz: 0.06 } ), bx( 0.006, 0.008, 0.018, { x: 0.132, y: 0.066 } ) ], M.blued ) );
	// barrel, gas block, gas tube, front sight, muzzle nut
	G.add( part( [ cx( 0.0105, 0.0105, 0.45, 16, { x: 0.36, y: 0.004 } ), cx( 0.012, 0.012, 0.03, 16, { x: 0.555, y: 0.004 } ) ], M.blued ) );
	G.add( part( [
		ext( [ [ 0.42, - 0.01 ], [ 0.46, - 0.01 ], [ 0.46, 0.055 ], [ 0.44, 0.06 ], [ 0.42, 0.05 ] ], 0.03, 0.002 ),
		cx( 0.011, 0.011, 0.22, 14, { x: 0.32, y: 0.043 } ),
		ext( [ [ 0.52, - 0.012 ], [ 0.55, - 0.012 ], [ 0.55, 0.03 ], [ 0.535, 0.062 ], [ 0.525, 0.062 ], [ 0.52, 0.03 ] ], 0.028, 0.002 )
	], M.blued ) );
	G.add( part( [ bx( 0.004, 0.028, 0.003, { x: 0.535, y: 0.06, z: - 0.011 } ), bx( 0.004, 0.028, 0.003, { x: 0.535, y: 0.06, z: 0.011 } ), cx( 0.0018, 0.0018, 0.014, 6, { x: 0.535, y: 0.058, rz: 0 } ) ], M.dark ) );
	G.add( part( cx( 0.0055, 0.0055, 0.004, 12, { x: 0.572, y: 0.004 } ), M.bore ) );
	// cleaning rod
	G.add( part( cx( 0.0028, 0.0028, 0.38, 6, { x: 0.36, y: - 0.02 } ), M.steel ) );
	// handguards (wood)
	const lower = ext( roundRectShape( 0.21, 0.052, 0.014, 0.305, - 0.004 ), 0.042, 0.004 );
	const upper = ext( roundRectShape( 0.16, 0.026, 0.011, 0.3, 0.043 ), 0.034, 0.003 );
	G.add( part( [ lower ], M.wood, 'handguard' ) );
	G.add( part( [ upper ], M.wood ) );
	// finger grooves on the lower handguard
	const grooves = [];
	for ( const s of [ - 1, 1 ] ) for ( let i = 0; i < 2; i ++ ) grooves.push( bx( 0.15, 0.004, 0.003, { x: 0.305, y: - 0.012 + i * 0.012, z: s * 0.0235 } ) );
	G.add( part( grooves, M.walnut ) );
	// stock
	G.add( part( ext( [ [ - 0.135, 0.025 ], [ - 0.14, - 0.035 ], [ - 0.2, - 0.05 ], [ - 0.53, - 0.13 ], [ - 0.53, - 0.028 ], [ - 0.3, 0.005 ] ], 0.036, 0.006 ), M.wood, 'stock' ) );
	G.add( part( ext( [ [ - 0.532, - 0.132 ], [ - 0.54, - 0.132 ], [ - 0.54, - 0.026 ], [ - 0.532, - 0.026 ] ], 0.04, 0.002 ), M.blued ) );
	// pistol grip
	G.add( part( ext( [ [ - 0.045, - 0.034 ], [ - 0.005, - 0.034 ], [ - 0.04, - 0.14 ], [ - 0.075, - 0.14 ], [ - 0.07, - 0.06 ] ], 0.03, 0.005 ), M.wood ) );
	// trigger guard + trigger
	const tg = new THREE.Shape();
	tg.moveTo( - 0.005, - 0.036 ); tg.lineTo( 0.03, - 0.036 ); tg.lineTo( 0.03, - 0.042 ); tg.quadraticCurveTo( 0.025, - 0.07, 0.0, - 0.07 ); tg.lineTo( - 0.004, - 0.07 ); tg.lineTo( - 0.004, - 0.065 ); tg.lineTo( 0.0, - 0.065 ); tg.quadraticCurveTo( 0.02, - 0.065, 0.024, - 0.042 ); tg.lineTo( - 0.005, - 0.042 );
	G.add( part( ext( tg, 0.01, 0.001 ), M.blued ) );
	G.add( part( ext( [ [ 0.0, - 0.036 ], [ 0.006, - 0.036 ], [ 0.01, - 0.05 ], [ 0.006, - 0.06 ], [ 0.002, - 0.06 ], [ 0.004, - 0.048 ] ], 0.006, 0.001 ), M.dark ) );
	// selector lever (right side) & charging handle (moves)
	G.add( part( bx( 0.12, 0.006, 0.003, { x: - 0.02, y: 0.018, z: 0.0195, rz: - 0.05 } ), M.blued ) );
	const bolt = new THREE.Group(); bolt.name = 'bolt';
	bolt.add( part( [ bx( 0.1, 0.014, 0.004, { x: 0.02, y: 0.02, z: 0.0182 } ), cx( 0.0055, 0.0055, 0.02, 10, { x: 0.075, y: 0.022, z: 0.03, rz: 0, rx: Math.PI / 2 } ) ], M.steel ) );
	G.add( bolt );
	// curved 30-round steel magazine
	const mag = new THREE.Group(); mag.name = 'mag';
	const ms = new THREE.Shape();
	ms.moveTo( 0.0, - 0.034 ); ms.lineTo( 0.07, - 0.034 );
	ms.quadraticCurveTo( 0.095, - 0.14, 0.15, - 0.24 );
	ms.lineTo( 0.11, - 0.26 );
	ms.quadraticCurveTo( 0.045, - 0.16, 0.012, - 0.05 );
	ms.lineTo( 0.0, - 0.034 );
	mag.add( part( ext( ms, 0.026, 0.003, 16 ), M.parker ) );
	const ribs = [];
	for ( let i = 0; i < 5; i ++ ) { const t = 0.15 + i * 0.17; ribs.push( bx( 0.004, 0.02, 0.029, { x: 0.02 + t * 0.12, y: - 0.06 - t * 0.17, rz: 0.5 + t * 0.4 } ) ); }
	mag.add( part( ribs, M.parker ) );
	mag.add( part( cx( 0.0055, 0.0055, 0.035, 8, { x: 0.035, y: - 0.03 } ), M.brass ) );
	G.add( mag );

	anchor( G, 'muzzle', 0.575, 0.004 );
	anchor( G, 'eject', 0.02, 0.02, 0.02 );
	G.userData = { sightY: 0.066, sightX: 0.535, length: 0.9 };
	const rh = gripHand( { radius: 0.017, curl: 1.0 } );
	rh.position.set( - 0.045, - 0.09, 0 );
	rh.rotation.z = 0.28;
	G.add( rh );
	const lh = gripHand( { radius: 0.024, curl: 0.95, thumbUp: true, mirror: true } );
	lh.position.set( 0.3, - 0.005, 0 );
	lh.rotation.set( 0, 0, - Math.PI / 2 + 0.1 );
	lh.name = 'leftHand';
	G.add( lh );
	attachArm( G, rh, ARM_R );
	attachArm( G, lh, ARM_L );
	return G;

}

// ------------------------------------------------------------------ pump-action shotgun

export function buildShotgun() {

	const M = gunMaterials();
	const G = new THREE.Group();
	G.name = 'shotgun';
	// receiver with ejection port
	G.add( part( ext( [ [ - 0.12, - 0.035 ], [ 0.11, - 0.035 ], [ 0.12, - 0.02 ], [ 0.12, 0.028 ], [ 0.1, 0.04 ], [ - 0.1, 0.04 ], [ - 0.12, 0.028 ] ], 0.034, 0.004 ), M.blued, 'receiver' ) );
	G.add( part( bx( 0.07, 0.022, 0.002, { x: 0.03, y: 0.008, z: 0.0182 } ), M.dark ) );
	// barrel + vent rib + bead
	G.add( part( [ cx( 0.0115, 0.0115, 0.5, 18, { x: 0.37, y: 0.018 } ), bx( 0.48, 0.004, 0.008, { x: 0.37, y: 0.032 } ) ], M.blued ) );
	G.add( part( new THREE.SphereGeometry( 0.0025, 8, 6 ).translate( 0.61, 0.036, 0 ), M.brass ) );
	G.add( part( cx( 0.0095, 0.0095, 0.004, 14, { x: 0.621, y: 0.018 } ), M.bore ) );
	// magazine tube
	G.add( part( [ cx( 0.0115, 0.0115, 0.4, 16, { x: 0.32, y: - 0.013 } ), cx( 0.0125, 0.0125, 0.02, 16, { x: 0.53, y: - 0.013 } ) ], M.blued ) );
	// pump forend (moves)
	const pump = new THREE.Group(); pump.name = 'pump';
	pump.add( part( ext( roundRectShape( 0.2, 0.05, 0.016, 0.0, - 0.008 ), 0.046, 0.004 ), M.walnut ) );
	const gr = [];
	for ( let i = 0; i < 9; i ++ ) for ( const s of [ - 1, 1 ] ) gr.push( bx( 0.006, 0.036, 0.003, { x: - 0.08 + i * 0.02, y: - 0.008, z: s * 0.0255 } ) );
	pump.add( part( gr, M.dark ) );
	pump.position.set( 0.27, 0, 0 );
	G.add( pump );
	// action bars
	G.add( part( [ bx( 0.2, 0.005, 0.003, { x: 0.18, y: - 0.013, z: 0.0135 } ), bx( 0.2, 0.005, 0.003, { x: 0.18, y: - 0.013, z: - 0.0135 } ) ], M.steel ) );
	// stock (walnut) with recoil pad
	G.add( part( ext( [ [ - 0.118, 0.03 ], [ - 0.12, - 0.035 ], [ - 0.16, - 0.05 ], [ - 0.2, - 0.075 ], [ - 0.45, - 0.12 ], [ - 0.45, - 0.01 ], [ - 0.2, 0.02 ] ], 0.038, 0.007 ), M.walnut, 'stock' ) );
	G.add( part( ext( [ [ - 0.45, - 0.122 ], [ - 0.475, - 0.124 ], [ - 0.475, - 0.008 ], [ - 0.45, - 0.008 ] ], 0.042, 0.004 ), M.rubber ) );
	// trigger guard & trigger
	const tg = new THREE.Shape();
	tg.moveTo( - 0.06, - 0.035 ); tg.lineTo( 0.0, - 0.035 ); tg.lineTo( 0.0, - 0.045 ); tg.quadraticCurveTo( - 0.01, - 0.07, - 0.04, - 0.07 ); tg.lineTo( - 0.06, - 0.06 );
	G.add( part( ext( tg, 0.012, 0.002 ), M.dark ) );
	G.add( part( ext( [ [ - 0.03, - 0.035 ], [ - 0.024, - 0.035 ], [ - 0.02, - 0.05 ], [ - 0.026, - 0.06 ], [ - 0.03, - 0.06 ], [ - 0.028, - 0.048 ] ], 0.006, 0.001 ), M.steel ) );
	anchor( G, 'muzzle', 0.625, 0.018 );
	anchor( G, 'eject', 0.03, 0.01, 0.02 );
	G.userData = { sightY: 0.038, sightX: 0.61, length: 1.0 };
	const rh = gripHand( { radius: 0.02, curl: 1.0 } );
	rh.position.set( - 0.14, - 0.06, 0 );
	rh.rotation.z = 0.9;
	G.add( rh );
	const lh = gripHand( { radius: 0.027, curl: 0.95, thumbUp: true, mirror: true } );
	lh.position.set( 0, - 0.018, 0 );
	lh.rotation.set( 0, 0, - Math.PI / 2 );
	pump.add( lh );
	attachArm( G, rh, ARM_R );
	attachArm( pump, lh, ARM_L );
	return G;

}

// ------------------------------------------------------------------ SVD Dragunov with PSO-1

export function buildSVD() {

	const M = gunMaterials();
	const G = new THREE.Group();
	G.name = 'svd';
	G.add( part( ext( [ [ - 0.16, - 0.036 ], [ 0.15, - 0.036 ], [ 0.16, - 0.02 ], [ 0.16, 0.03 ], [ - 0.16, 0.03 ] ], 0.034, 0.002 ), M.parker, 'receiver' ) );
	G.add( part( ext( [ [ - 0.15, 0.03 ], [ 0.12, 0.03 ], [ 0.12, 0.045 ], [ - 0.14, 0.047 ] ], 0.032, 0.004 ), M.blued ) );
	// long barrel + slotted flash hider
	G.add( part( [ cx( 0.0095, 0.009, 0.62, 16, { x: 0.47, y: 0.004 } ), cx( 0.012, 0.012, 0.03, 16, { x: 0.55, y: 0.004 } ) ], M.blued ) );
	const fh = [ cx( 0.0125, 0.0125, 0.07, 16, { x: 0.815, y: 0.004 } ) ];
	G.add( part( fh, M.blued ) );
	const slots = [];
	for ( let i = 0; i < 5; i ++ ) { const a = i / 5 * Math.PI * 2; slots.push( bx( 0.045, 0.003, 0.004, { x: 0.82, y: 0.004 + Math.sin( a ) * 0.012, z: Math.cos( a ) * 0.012, rx: a } ) ); }
	G.add( part( slots, M.dark ) );
	G.add( part( cx( 0.005, 0.005, 0.004, 12, { x: 0.851, y: 0.004 } ), M.bore ) );
	G.add( part( ext( [ [ 0.74, - 0.01 ], [ 0.77, - 0.01 ], [ 0.77, 0.028 ], [ 0.76, 0.05 ], [ 0.75, 0.05 ], [ 0.74, 0.028 ] ], 0.024, 0.002 ), M.blued ) );
	// gas block & handguard with vents
	G.add( part( ext( [ [ 0.47, - 0.012 ], [ 0.51, - 0.012 ], [ 0.51, 0.05 ], [ 0.47, 0.05 ] ], 0.03, 0.002 ), M.blued ) );
	G.add( part( ext( roundRectShape( 0.28, 0.06, 0.02, 0.32, 0.012 ), 0.044, 0.004 ), M.wood, 'handguard' ) );
	const vents = [];
	for ( let i = 0; i < 6; i ++ ) for ( const s of [ - 1, 1 ] ) vents.push( bx( 0.028, 0.008, 0.003, { x: 0.22 + i * 0.04, y: 0.02, z: s * 0.0245 } ) );
	G.add( part( vents, M.dark ) );
	// skeleton thumbhole stock
	const st = new THREE.Shape();
	st.moveTo( - 0.155, 0.025 ); st.lineTo( - 0.62, - 0.03 ); st.lineTo( - 0.64, - 0.035 ); st.lineTo( - 0.64, - 0.16 ); st.lineTo( - 0.6, - 0.165 ); st.lineTo( - 0.42, - 0.12 );
	st.lineTo( - 0.22, - 0.12 ); st.quadraticCurveTo( - 0.16, - 0.11, - 0.16, - 0.04 ); st.lineTo( - 0.155, 0.025 );
	const th = new THREE.Path();
	th.moveTo( - 0.23, - 0.03 ); th.lineTo( - 0.38, - 0.05 ); th.quadraticCurveTo( - 0.4, - 0.1, - 0.37, - 0.1 ); th.lineTo( - 0.24, - 0.1 ); th.quadraticCurveTo( - 0.21, - 0.09, - 0.23, - 0.03 );
	st.holes.push( th );
	const th2 = new THREE.Path();
	th2.moveTo( - 0.44, - 0.06 ); th2.lineTo( - 0.58, - 0.065 ); th2.lineTo( - 0.58, - 0.13 ); th2.lineTo( - 0.45, - 0.105 );
	st.holes.push( th2 );
	G.add( part( ext( st, 0.034, 0.005, 12 ), M.wood, 'stock' ) );
	// cheek rest
	G.add( part( ext( roundRectShape( 0.14, 0.035, 0.01, - 0.36, - 0.018 ), 0.04, 0.004 ), M.rubber ) );
	G.add( part( ext( [ [ - 0.642, - 0.165 ], [ - 0.655, - 0.165 ], [ - 0.655, - 0.032 ], [ - 0.642, - 0.032 ] ], 0.04, 0.002 ), M.rubber ) );
	// 10-round magazine
	const mag = new THREE.Group(); mag.name = 'mag';
	mag.add( part( ext( [ [ 0.0, - 0.034 ], [ 0.07, - 0.034 ], [ 0.08, - 0.12 ], [ 0.03, - 0.13 ], [ 0.005, - 0.05 ] ], 0.026, 0.003 ), M.parker ) );
	G.add( mag );
	// trigger guard + trigger
	const tg = new THREE.Shape();
	tg.moveTo( - 0.07, - 0.036 ); tg.lineTo( - 0.01, - 0.036 ); tg.lineTo( - 0.01, - 0.042 ); tg.quadraticCurveTo( - 0.02, - 0.07, - 0.05, - 0.07 ); tg.lineTo( - 0.07, - 0.06 );
	G.add( part( ext( tg, 0.01, 0.001 ), M.blued ) );
	G.add( part( ext( [ [ - 0.04, - 0.036 ], [ - 0.034, - 0.036 ], [ - 0.03, - 0.05 ], [ - 0.036, - 0.06 ], [ - 0.04, - 0.06 ] ], 0.006, 0.001 ), M.dark ) );
	// charging handle (right)
	const bolt = new THREE.Group(); bolt.name = 'bolt';
	bolt.add( part( cx( 0.005, 0.005, 0.022, 10, { x: 0.09, y: 0.02, z: 0.028, rz: 0, rx: Math.PI / 2 } ), M.steel ) );
	G.add( bolt );
	// PSO-1 scope on a left side mount
	const scope = new THREE.Group(); scope.name = 'scope';
	scope.add( part( [ ext( [ [ - 0.05, 0 ], [ 0.08, 0 ], [ 0.08, 0.05 ], [ - 0.05, 0.05 ] ], 0.012, 0.002 ) ], M.blued ) );
	const tube = [];
	tube.push( cx( 0.0135, 0.0135, 0.21, 20, { x: 0.02, y: 0.07 } ) );
	tube.push( cx( 0.021, 0.0135, 0.05, 20, { x: 0.15, y: 0.07 } ) );
	tube.push( cx( 0.021, 0.021, 0.045, 20, { x: 0.197, y: 0.07 } ) );
	tube.push( cx( 0.0135, 0.018, 0.035, 20, { x: - 0.1, y: 0.07 } ) );
	tube.push( cx( 0.021, 0.018, 0.02, 20, { x: - 0.125, y: 0.07 } ) );
	tube.push( place( new THREE.CylinderGeometry( 0.011, 0.011, 0.028, 16 ), { x: 0.02, y: 0.093 } ) );
	tube.push( place( new THREE.CylinderGeometry( 0.011, 0.011, 0.024, 16 ), { x: 0.02, y: 0.07, z: - 0.022, rx: Math.PI / 2 } ) );
	tube.push( place( new THREE.CylinderGeometry( 0.006, 0.006, 0.02, 10 ), { x: - 0.03, y: 0.07, z: - 0.018, rx: Math.PI / 2 } ) );
	scope.add( part( tube, M.blued ) );
	scope.add( part( cx( 0.023, 0.021, 0.06, 20, { x: - 0.165, y: 0.07 } ), M.rubber ) );
	scope.add( part( cx( 0.019, 0.019, 0.003, 20, { x: 0.2205, y: 0.07 } ), M.glass ) );
	scope.add( part( cx( 0.014, 0.014, 0.003, 20, { x: - 0.195, y: 0.07 } ), M.glass ) );
	scope.position.set( - 0.05, 0.035, - 0.03 );
	G.add( scope );

	anchor( G, 'muzzle', 0.855, 0.004 );
	anchor( G, 'eject', 0.03, 0.02, 0.02 );
	G.userData = { sightY: 0.105, sightX: 0.0, length: 1.22 };
	const rh = gripHand( { radius: 0.018, curl: 1.0 } );
	rh.position.set( - 0.195, - 0.075, 0 );
	rh.rotation.z = 0.25;
	G.add( rh );
	const lh = gripHand( { radius: 0.026, curl: 0.95, thumbUp: true, mirror: true } );
	lh.position.set( 0.3, 0.01, 0 );
	lh.rotation.set( 0, 0, - Math.PI / 2 + 0.1 );
	G.add( lh );
	attachArm( G, rh, ARM_R );
	attachArm( G, lh, ARM_L );
	return G;

}

// ------------------------------------------------------------------ enemy weapons (small, third person)

export function buildEnemyGun( kind = 'pistol' ) {

	const M = gunMaterials();
	const G = new THREE.Group();
	if ( kind === 'pistol' ) {

		G.add( part( [ ext( [ [ - 0.02, 0.0 ], [ 0.17, 0.0 ], [ 0.17, 0.032 ], [ - 0.03, 0.032 ] ], 0.024, 0.002 ) ], M.chrome ) );
		G.add( part( ext( [ [ - 0.01, 0.002 ], [ - 0.025, - 0.1 ], [ - 0.06, - 0.1 ], [ - 0.04, 0.002 ] ], 0.028, 0.003 ), M.rubber ) );
		anchor( G, 'muzzle', 0.175, 0.018 );

	} else if ( kind === 'smg' ) {

		G.add( part( [ ext( [ [ - 0.12, - 0.02 ], [ 0.16, - 0.02 ], [ 0.16, 0.04 ], [ - 0.12, 0.04 ] ], 0.03, 0.003 ), cx( 0.009, 0.009, 0.12, 12, { x: 0.22, y: 0.02 } ) ], M.blued ) );
		G.add( part( [ ext( [ [ - 0.02, - 0.02 ], [ - 0.035, - 0.12 ], [ - 0.07, - 0.12 ], [ - 0.055, - 0.02 ] ], 0.028, 0.003 ), cx( 0.02, 0.02, 0.22, 16, { x: 0.05, y: - 0.03 } ) ], M.parker ) );
		anchor( G, 'muzzle', 0.285, 0.02 );

	} else {

		G.add( part( [ ext( [ [ - 0.1, - 0.03 ], [ 0.1, - 0.03 ], [ 0.1, 0.035 ], [ - 0.1, 0.035 ] ], 0.034, 0.003 ), cx( 0.012, 0.012, 0.42, 14, { x: 0.3, y: 0.015 } ), cx( 0.012, 0.012, 0.3, 14, { x: 0.25, y: - 0.012 } ) ], M.blued ) );
		G.add( part( [ ext( [ [ - 0.1, 0.02 ], [ - 0.1, - 0.03 ], [ - 0.4, - 0.1 ], [ - 0.4, 0.0 ] ], 0.036, 0.005 ), ext( roundRectShape( 0.16, 0.045, 0.012, 0.25, - 0.01 ), 0.044, 0.003 ) ], M.walnut ) );
		anchor( G, 'muzzle', 0.52, 0.015 );

	}

	return G;

}
