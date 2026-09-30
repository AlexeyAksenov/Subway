// «Москва-2020» (81-775/776/777) metro train: livery, black cab mask with LED destination board,
// plug-sliding doors, lit interior with seats and handrails, open gangways. Handles motion,
// docking colliders, carrying the player, announcements and its sound rig.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, float, color, mix, positionLocal, normalLocal, smoothstep, abs, mx_noise_float, mx_cell_noise_float, floor, mrt, vec4, output } from 'three/tsl';
import * as G from './geom.js';
import * as M from './materials.js';
import { ctx } from '../core/ctx.js';
import { TRACK_Z, PLAT_EDGE, HALF_L, RAIL_Y } from './layout.js';

export const CAR_LEN = 19.6;
const GAP = 0.8;
const HALF_W = 1.36;
const ROOF = 2.55;
const DOORS = [ - 7.6, - 2.55, 2.55, 7.6 ];
const DOOR_W = 1.4;
const DOOR_H = 1.95;

const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _ray = new THREE.Ray();

function liveryTexture() {

	const W = 2048, H = 256;
	const c = document.createElement( 'canvas' ); c.width = W; c.height = H;
	const g = c.getContext( '2d' );
	g.fillStyle = '#f4f5f6'; g.fillRect( 0, 0, W, H );
	const Y = ( y ) => H - ( y + 0.25 ) / 2.25 * H; // body y (m) → px
	const X = ( x ) => ( x + CAR_LEN / 2 ) / CAR_LEN * W;
	// blue swirl arcs (Moskva-2020 branding)
	g.lineWidth = 7;
	for ( const dc of [ - 5.1, 5.1 ] ) for ( let r = 30; r < 170; r += 22 ) {

		g.strokeStyle = r % 44 === 8 ? '#1b4fb4' : '#3b7be0';
		g.beginPath(); g.arc( X( dc ), Y( 0.9 ), r, Math.PI * 1.05, Math.PI * 1.95 ); g.stroke();

	}

	// red skirt stripe and dark belt line
	g.fillStyle = '#d6232a'; g.fillRect( 0, Y( 0.25 ), W, Y( - 0.1 ) - Y( 0.25 ) );
	g.fillStyle = '#1d2733'; g.fillRect( 0, Y( 0.9 ), W, 5 );
	g.fillStyle = '#1b3f8f'; g.fillRect( 0, Y( 2.0 ), W, Y( 1.93 ) - Y( 2.0 ) );
	// «МОСКВА» + car number
	g.fillStyle = '#d6232a'; g.font = 'bold 38px Arial'; g.fillText( 'МОСКВА', X( 8.3 ), Y( 1.97 ) + 30 );
	g.fillStyle = '#1b3f8f'; g.font = 'bold 26px Arial'; g.fillText( '77531', X( - 9.2 ), Y( 0.45 ) );
	// metro logo
	g.fillStyle = '#d6232a'; g.beginPath(); g.arc( X( 9.3 ), Y( 1.3 ), 16, 0, Math.PI * 2 ); g.fill();
	g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText( 'М', X( 9.3 ), Y( 1.3 ) + 8 );
	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;

}

function ledTexture() {

	const c = document.createElement( 'canvas' ); c.width = 512; c.height = 64;
	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	t.userData.canvas = c;
	return t;

}

function drawLED( t, text, { color = '#ffb020', bg = '#050505', num = '000' } = {} ) {

	const c = t.userData.canvas, g = c.getContext( '2d' );
	g.fillStyle = bg; g.fillRect( 0, 0, c.width, c.height );
	g.fillStyle = color; g.font = 'bold 40px "Arial Narrow", Arial'; g.textBaseline = 'middle';
	g.fillText( num, 12, 34 );
	g.textAlign = 'center';
	g.fillText( text.toUpperCase(), 300, 34 );
	g.textAlign = 'left';
	// LED dot grid
	g.fillStyle = 'rgba(0,0,0,0.45)';
	for ( let x = 0; x < c.width; x += 4 ) g.fillRect( x, 0, 1, c.height );
	for ( let y = 0; y < c.height; y += 4 ) g.fillRect( 0, y, c.width, 1 );
	t.needsUpdate = true;

}

export class Train {

	constructor( scene, cars = 7 ) {

		this.scene = scene;
		this.nCars = cars;
		this.length = cars * CAR_LEN + ( cars - 1 ) * GAP;
		this.group = new THREE.Group();
		this.group.name = 'train';
		this.group.position.set( - 600, 0, TRACK_Z );
		scene.add( this.group );
		this.x = - 600;
		this.v = 0; this.a = 0;
		this.state = 'away';
		this.doorOpen = 0; this.doorTarget = 0;
		this.stateT = 0;
		this.carX = [];
		for ( let i = 0; i < cars; i ++ ) this.carX.push( - this.length / 2 + CAR_LEN / 2 + i * ( CAR_LEN + GAP ) );
		this.livery = liveryTexture();
		this.led = ledTexture();
		drawLED( this.led, 'Ховрино' );
		this.buildMaterials();
		this.buildCars();
		this.buildLights( scene );
		this.lastX = this.x;
		this.dx = 0;
		this.playerInside = false;
		this.onEvent = null;
		this.clackDist = 0;
		this.visible = true;

	}

	// ------------------------------------------------------------------ materials

	buildMaterials() {

		const liv = this.livery;
		const body = new THREE.MeshPhysicalNodeMaterial();
		// extruded caps carry uv = shape coordinates (metres)
		const luv = vec2( uv().x.add( CAR_LEN / 2 ).div( CAR_LEN ), uv().y.add( 0.25 ).div( 2.25 ) );
		const outer = normalLocal.z.mul( positionLocal.z ).greaterThan( 0 );
		const panelSeams = smoothstep( 0.0, 0.012, abs( uv().x.mul( 0.5 ).fract().sub( 0.5 ) ) );
		body.colorNode = outer.select( texture( liv, luv ).rgb.mul( mix( 0.75, 1.0, panelSeams ) ), color( 0xe9ebee ) );
		body.roughnessNode = outer.select( float( 0.22 ), float( 0.5 ) );
		body.metalnessNode = float( 0.05 );
		body.clearcoat = 0.8; body.clearcoatRoughness = 0.08;
		this.mBody = body;
		this.mRoof = M.paint( { tint: 0x3c4046, rough: 0.55, metal: 0.4 } );
		this.mDark = M.paint( { tint: 0x1a1c20, rough: 0.5, metal: 0.3 } );
		this.mRed = M.paint( { tint: 0xd41f27, rough: 0.25, clearcoat: 1 } );
		this.mMask = new THREE.MeshPhysicalNodeMaterial( { color: 0x050608, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 } );
		const glass = new THREE.MeshPhysicalNodeMaterial( { color: 0x0b1116, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false } );
		glass.mrtNode = mrt( { output, normal: vec4( 0 ), diffuseColor: vec4( 0 ), metalrough: vec4( 0 ), velocity: vec4( 0 ) } );
		this.mGlass = glass;
		const floorM = new THREE.MeshStandardNodeMaterial();
		const fp = positionLocal.mul( 40 );
		floorM.colorNode = color( 0x4a4d52 ).mul( mx_cell_noise_float( floor( fp ) ).mul( 0.25 ).add( 0.8 ) );
		floorM.roughnessNode = float( 0.75 );
		this.mFloor = floorM;
		this.mLining = M.paint( { tint: 0xeceef0, rough: 0.45, noise: 0.02 } );
		this.mSeat = new THREE.MeshPhysicalNodeMaterial();
		this.mSeat.colorNode = color( 0x1f4fa8 ).mul( mx_noise_float( positionLocal.mul( 300 ) ).mul( 0.1 ).add( 0.95 ) );
		this.mSeat.roughnessNode = float( 0.8 );
		this.mSeat.sheen = 0.6; this.mSeat.sheenColor = new THREE.Color( 0x6f9fff );
		this.mSeatShell = M.paint( { tint: 0x9aa2ab, rough: 0.35 } );
		this.mChrome = M.metal( { tint: 0xe8ebee, rough: 0.12 } );
		this.mYellow = M.paint( { tint: 0xf2c20a, rough: 0.3 } );
		this.mLED = new THREE.MeshBasicNodeMaterial();
		this.mLED.colorNode = color( 1, 1, 1 ).mul( 5 );
		this.mInteriorGlow = new THREE.MeshBasicNodeMaterial();
		this.lightUniform = { value: 1 };
		this.mInteriorGlow.colorNode = color( 1.0, 0.98, 0.94 ).mul( 4.5 );
		this.mHead = new THREE.MeshBasicNodeMaterial(); this.mHead.colorNode = color( 1, 1, 1 ).mul( 12 );
		this.mTail = new THREE.MeshBasicNodeMaterial(); this.mTail.colorNode = color( 1, 0.05, 0.05 ).mul( 6 );
		this.mBoard = new THREE.MeshBasicNodeMaterial(); this.mBoard.colorNode = texture( this.led, uv() ).rgb.mul( 3.5 );
		this.mScreen = new THREE.MeshBasicNodeMaterial(); this.mScreen.colorNode = texture( this.led, uv() ).rgb.mul( 1.6 );
		this.mRubber = M.paint( { tint: 0x0d0d0e, rough: 0.9 } );
		for ( const k of Object.keys( this ) ) if ( k.startsWith( 'm' ) && this[ k ]?.isMaterial ) this[ k ].side = THREE.DoubleSide;

	}

	// ------------------------------------------------------------------ geometry

	buildCars() {

		const L = CAR_LEN;
		// side wall with door & window openings (built for +Z side, mirrored for −Z)
		const side = new THREE.Shape();
		side.moveTo( - L / 2, - 0.25 ); side.lineTo( L / 2, - 0.25 ); side.lineTo( L / 2, 2.02 ); side.lineTo( - L / 2, 2.02 ); side.closePath();
		for ( const d of DOORS ) side.holes.push( G.roundRectPath( DOOR_W, DOOR_H + 0.02, 0.06, d, DOOR_H / 2 - 0.005 ) );
		const winX = [ - 9.15, - 5.1, 0, 5.1, 9.15 ];
		const winW = [ 0.7, 3.3, 3.3, 3.3, 0.7 ];
		winX.forEach( ( x, i ) => side.holes.push( G.roundRectPath( winW[ i ], 0.95, 0.08, x, 1.38 ) ) );
		const sideGeo = new THREE.ExtrudeGeometry( side, { depth: 0.06, bevelEnabled: false, curveSegments: 6 } );
		sideGeo.translate( 0, 0, HALF_W - 0.06 );
		const sideGeoNeg = sideGeo.clone();
		sideGeoNeg.scale( 1, 1, - 1 );
		// roof & underframe
		const roofProf = [ [ HALF_W, 2.0 ], [ HALF_W - 0.02, 2.15 ], [ HALF_W - 0.1, 2.33 ], [ HALF_W - 0.3, 2.47 ], [ 0.7, ROOF - 0.02 ], [ 0, ROOF ], [ - 0.7, ROOF - 0.02 ], [ - HALF_W + 0.3, 2.47 ], [ - HALF_W + 0.1, 2.33 ], [ - HALF_W + 0.02, 2.15 ], [ - HALF_W, 2.0 ] ];
		const roof = G.sweepX( roofProf, - L / 2, L / 2, 1 );
		const under = G.box( L - 0.4, 0.35, 2.5, { y: - 0.42 } );
		const skirt = [];
		for ( let i = 0; i < 6; i ++ ) skirt.push( G.box( 1.1, 0.4, 0.9, { x: - 7 + i * 2.8, y: - 0.8, z: 0 } ) );
		// bogies with wheels
		const bog = [];
		for ( const bx of [ - L / 2 + 2.6, L / 2 - 2.6 ] ) {

			bog.push( G.box( 2.6, 0.3, 2.1, { x: bx, y: - 0.75 } ) );
			for ( const wx of [ - 0.9, 0.9 ] ) for ( const wz of [ - 0.76, 0.76 ] ) bog.push( G.cyl( 0.39, 0.39, 0.12, 18, { x: bx + wx, y: RAIL_Y + 0.4, z: wz, rx: Math.PI / 2 } ) );

		}

		// interior: floor, lining, ceiling, LED strips, seats, poles
		const floorG = G.box( L - 0.1, 0.05, 2.58, { y: - 0.025 } );
		const ceiling = G.sweepX( [ [ HALF_W - 0.08, 2.02 ], [ 1.0, 2.18 ], [ 0.5, 2.22 ], [ - 0.5, 2.22 ], [ - 1.0, 2.18 ], [ - HALF_W + 0.08, 2.02 ] ], - L / 2, L / 2, 1 );
		const strips = [ G.box( L - 0.8, 0.03, 0.14, { y: 2.19, z: 0.62 } ), G.box( L - 0.8, 0.03, 0.14, { y: 2.19, z: - 0.62 } ) ];
		const seats = [], shells = [], poles = [], yellow = [];
		const segs = [ [ - L / 2 + 0.3, DOORS[ 0 ] - 0.8 ], [ DOORS[ 0 ] + 0.8, DOORS[ 1 ] - 0.8 ], [ DOORS[ 1 ] + 0.8, DOORS[ 2 ] - 0.8 ], [ DOORS[ 2 ] + 0.8, DOORS[ 3 ] - 0.8 ], [ DOORS[ 3 ] + 0.8, L / 2 - 0.3 ] ];
		for ( const [ a, b ] of segs ) for ( const s of [ - 1, 1 ] ) {

			const len = b - a, cx = ( a + b ) / 2;
			seats.push( G.box( len - 0.1, 0.1, 0.44, { x: cx, y: 0.45, z: s * ( HALF_W - 0.33 ) } ) );
			seats.push( G.box( len - 0.1, 0.46, 0.08, { x: cx, y: 0.78, z: s * ( HALF_W - 0.12 ), rx: s * 0.08 } ) );
			shells.push( G.box( len, 0.4, 0.46, { x: cx, y: 0.2, z: s * ( HALF_W - 0.32 ) } ) );
			poles.push( G.cyl( 0.02, 0.02, 2.2, 10, { x: a - 0.05, y: 1.1, z: s * ( HALF_W - 0.62 ) } ) );
			poles.push( G.cyl( 0.02, 0.02, 2.2, 10, { x: b + 0.05, y: 1.1, z: s * ( HALF_W - 0.62 ) } ) );
			yellow.push( G.box( 0.03, 0.9, 0.03, { x: a - 0.05, y: 1.35, z: s * ( HALF_W - 0.62 ) } ) );

		}

		for ( const s of [ - 1, 1 ] ) poles.push( G.cyl( 0.017, 0.017, L - 1, 8, { y: 1.95, z: s * 0.72, rz: Math.PI / 2 } ) );
		for ( const d of DOORS ) poles.push( G.cyl( 0.022, 0.022, 2.2, 10, { x: d, y: 1.1, z: 0 } ) );
		// door header screens
		const screens = [];
		for ( const d of DOORS ) for ( const s of [ - 1, 1 ] ) screens.push( G.box( 0.9, 0.14, 0.02, { x: d, y: 2.06, z: s * ( HALF_W - 0.12 ) } ) );
		// window glass
		const glass = [];
		for ( const s of [ - 1, 1 ] ) winX.forEach( ( x, i ) => glass.push( G.box( winW[ i ], 0.95, 0.01, { x, y: 1.38, z: s * ( HALF_W - 0.03 ) } ) ) );
		// gangway bellows
		const bellows = [];
		for ( let k = 0; k < 5; k ++ ) bellows.push( G.box( 0.1, 2.3, 2.2, { x: L / 2 + 0.08 + k * 0.16, y: 1.0 } ) );

		const merged = {
			body: G.merge( [ sideGeo, sideGeoNeg ] ),
			roof: G.merge( [ roof ] ),
			dark: G.merge( [ under, ...skirt, ...bog ] ),
			floor: G.merge( [ floorG ] ),
			lining: G.merge( [ ceiling ] ),
			glow: G.merge( strips ),
			seat: G.merge( seats ),
			shell: G.merge( shells ),
			chrome: G.merge( poles ),
			yellow: G.merge( yellow ),
			screen: G.merge( screens ),
			glass: G.merge( glass ),
			rubber: G.merge( bellows )
		};
		const matFor = { body: this.mBody, roof: this.mRoof, dark: this.mDark, floor: this.mFloor, lining: this.mLining, glow: this.mInteriorGlow, seat: this.mSeat, shell: this.mSeatShell, chrome: this.mChrome, yellow: this.mYellow, screen: this.mScreen, glass: this.mGlass, rubber: this.mRubber };
		// door leaves: one instanced mesh for the whole train
		const leaf = new THREE.Shape();
		leaf.moveTo( 0, 0 ); leaf.lineTo( DOOR_W / 2, 0 ); leaf.lineTo( DOOR_W / 2, DOOR_H ); leaf.lineTo( 0, DOOR_H ); leaf.closePath();
		leaf.holes.push( G.roundRectPath( 0.44, 1.0, 0.06, DOOR_W / 4, 1.3 ) );
		const leafGeo = new THREE.ExtrudeGeometry( leaf, { depth: 0.05, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 } );
		const leafMat = M.paint( { tint: 0xf1f2f3, rough: 0.25, clearcoat: 0.8 } );
		leafMat.side = THREE.DoubleSide;
		const leafGlass = G.box( 0.44, 1.0, 0.012, { x: DOOR_W / 4, y: 1.3, z: 0.025 } );
		const leafSeal = G.box( 0.03, DOOR_H, 0.06, { x: 0.015, y: DOOR_H / 2, z: 0.025 } );
		const leafRed = G.box( DOOR_W / 2 - 0.1, 0.05, 0.052, { x: DOOR_W / 4 + 0.02, y: 0.3, z: 0.025 } );
		const nLeaves = this.nCars * DOORS.length * 2 * 2;
		this.leafMesh = new THREE.InstancedMesh( leafGeo, leafMat, nLeaves );
		this.leafGlass = new THREE.InstancedMesh( leafGlass, this.mGlass, nLeaves );
		this.leafSeal = new THREE.InstancedMesh( G.merge( [ leafSeal, leafRed ] ), this.mRubber, nLeaves );
		for ( const im of [ this.leafMesh, this.leafGlass, this.leafSeal ] ) { im.frustumCulled = false; im.instanceMatrix.setUsage( THREE.DynamicDrawUsage ); this.group.add( im ); }
		this.leaves = [];
		for ( let c = 0; c < this.nCars; c ++ ) for ( const d of DOORS ) for ( const s of [ - 1, 1 ] ) for ( const lr of [ - 1, 1 ] ) this.leaves.push( { car: c, d, s, lr } );

		this.cars = [];
		for ( let c = 0; c < this.nCars; c ++ ) {

			const car = new THREE.Group();
			car.position.x = this.carX[ c ];
			for ( const k in merged ) {

				if ( k === 'rubber' && c === this.nCars - 1 ) continue;
				const m = new THREE.Mesh( merged[ k ], matFor[ k ] );
				m.frustumCulled = false;
				if ( k === 'glass' ) m.renderOrder = 5;
				car.add( m );

			}

			this.group.add( car );
			this.cars.push( car );

		}

		this.buildCab( this.cars[ this.nCars - 1 ], 1 );
		this.buildCab( this.cars[ 0 ], - 1 );
		this.updateDoors();

	}

	buildCab( car, dir ) {

		const L = CAR_LEN;
		const g = new THREE.Group();
		g.position.x = dir * L / 2;
		if ( dir < 0 ) g.rotation.y = Math.PI;
		car.add( g );
		// cab shell
		const shell = G.box( 0.9, 2.75, 2.72, { x: 0.45, y: 1.1 } );
		const m1 = new THREE.Mesh( shell, this.mDark ); g.add( m1 );
		// red outline frame and black glass mask (slightly raked)
		const outer = G.roundRectShape( 2.62, 2.5, 0.35, 0, 1.12 );
		const frameG = G.extrudeZ( outer, 0.08, { bevel: 0.03 } );
		frameG.rotateY( Math.PI / 2 ); frameG.rotateZ( - 0.06 ); frameG.translate( 0.93, 0, 0 );
		g.add( new THREE.Mesh( frameG, this.mRed ) );
		const mask = G.extrudeZ( G.roundRectShape( 2.44, 2.32, 0.3, 0, 1.12 ), 0.06, { bevel: 0.02 } );
		mask.rotateY( Math.PI / 2 ); mask.rotateZ( - 0.06 ); mask.translate( 0.99, 0, 0 );
		g.add( new THREE.Mesh( mask, this.mMask ) );
		// destination board
		const board = new THREE.PlaneGeometry( 1.5, 0.19 );
		board.rotateY( Math.PI / 2 ); board.rotateZ( - 0.06 );
		board.translate( 1.1, 2.08, 0 );
		const bm = new THREE.Mesh( board, this.mBoard ); g.add( bm );
		// head & tail lights (vertical LED strips), metro logo, coupler
		const lights = [], tails = [];
		for ( const s of [ - 1, 1 ] ) {

			lights.push( G.box( 0.03, 0.34, 0.07, { x: 1.06, y: 0.72, z: s * 0.98 } ) );
			lights.push( G.box( 0.03, 0.04, 0.22, { x: 1.06, y: 0.52, z: s * 0.9 } ) );
			tails.push( G.box( 0.03, 0.12, 0.07, { x: 1.06, y: 0.32, z: s * 1.02 } ) );

		}

		this.headMeshes = this.headMeshes || [];
		const hm = new THREE.Mesh( G.merge( lights ), dir > 0 ? this.mHead : this.mTail );
		g.add( hm );
		g.add( new THREE.Mesh( G.merge( tails ), dir > 0 ? this.mDark : this.mTail ) );
		const logo = new THREE.Mesh( G.cyl( 0.13, 0.13, 0.02, 24, { x: 1.06, y: 1.0, rz: Math.PI / 2 } ), this.mRed );
		g.add( logo );
		const mTex = new THREE.MeshBasicNodeMaterial(); mTex.colorNode = color( 3, 3, 3 );
		const mg = new THREE.Mesh( G.box( 0.01, 0.1, 0.12, { x: 1.075, y: 1.0 } ), mTex ); g.add( mg );
		g.add( new THREE.Mesh( G.merge( [ G.box( 0.6, 0.25, 0.4, { x: 1.2, y: - 0.35 } ), G.box( 0.35, 0.5, 2.3, { x: 0.9, y: - 0.2 } ) ] ), this.mDark ) );

	}

	buildLights( scene ) {

		this.inLights = [];
		for ( let i = 0; i < 2; i ++ ) {

			const l = new THREE.PointLight( 0xfff4e8, 0, 14, 2 );
			scene.add( l );
			this.inLights.push( l );

		}

		this.head = new THREE.SpotLight( 0xffffff, 0, 90, 0.42, 0.5, 1.6 );
		scene.add( this.head );
		scene.add( this.head.target );
		this.tunnelLight = new THREE.PointLight( 0xffc27a, 0, 9, 2 );
		scene.add( this.tunnelLight );

	}

	updateDoors() {

		const o = this.doorOpen;
		const plug = Math.min( 1, o * 4 ) * 0.07;
		const slide = Math.max( 0, ( o - 0.2 ) / 0.8 ) * ( DOOR_W / 2 - 0.04 );
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const one = new THREE.Vector3( 1, 1, 1 );
		const mir = new THREE.Vector3( - 1, 1, 1 );
		this.leaves.forEach( ( lf, i ) => {

			const open = lf.s === this.openSide ? 1 : 0;
			const x = this.carX[ lf.car ] + lf.d + lf.lr * ( open * slide );
			const z = lf.s * ( HALF_W - 0.02 + open * plug );
			// leaf geometry spans 0..W/2 in x; mirror left leaves
			m.compose( _v.set( x, 0.0, z - ( lf.s > 0 ? 0.03 : 0.02 ) ), q, lf.lr > 0 ? one : mir );
			this.leafMesh.setMatrixAt( i, m );
			this.leafGlass.setMatrixAt( i, m );
			this.leafSeal.setMatrixAt( i, m );

		} );
		this.leafMesh.instanceMatrix.needsUpdate = this.leafGlass.instanceMatrix.needsUpdate = this.leafSeal.instanceMatrix.needsUpdate = true;

	}

	setDestination( name ) { drawLED( this.led, name ); }

	// ------------------------------------------------------------------ queries for the world

	get z() { return this.group.position.z; }

	/** world-space car index if (x,z) lies inside a car interior */
	carAt( x, z ) {

		if ( ! this.visible || Math.abs( z - this.z ) > HALF_W - 0.05 ) return null;
		const lx = x - this.x;
		for ( let i = 0; i < this.nCars; i ++ ) if ( Math.abs( lx - this.carX[ i ] ) < CAR_LEN / 2 + GAP / 2 + 0.01 ) return i;
		return null;

	}

	floorAt( x, z ) { return this.carAt( x, z ) !== null ? 0 : null; }

	carryDelta( pos ) {

		if ( this.carAt( pos.x, pos.z ) === null ) return null;
		return { x: this.dx, z: 0 };

	}

	/** Colliders (world space) while the train is present at a platform. */
	colliderBoxes() {

		const out = this._boxes || ( this._boxes = [] );
		out.length = 0;
		if ( ! this.visible ) return out;
		const z0 = this.z, x0 = this.x;
		const add = ( a, b, c, d ) => out.push( { minX: x0 + Math.min( a, b ), maxX: x0 + Math.max( a, b ), minZ: z0 + Math.min( c, d ), maxZ: z0 + Math.max( c, d ), enabled: true, low: true } );
		const s = this.openSide;
		const inner = HALF_W - 0.1;
		for ( let i = 0; i < this.nCars; i ++ ) {

			const cx = this.carX[ i ];
			const a = cx - CAR_LEN / 2, b = cx + CAR_LEN / 2;
			// far side wall (always closed)
			add( a, b, - s * inner, - s * ( HALF_W + 0.3 ) );
			// platform side wall with door gaps when open
			let x = a;
			for ( const d of DOORS ) {

				const g0 = cx + d - DOOR_W / 2 + 0.12, g1 = cx + d + DOOR_W / 2 - 0.12;
				if ( this.doorOpen > 0.85 ) { add( x, g0, s * inner, s * ( HALF_W + 0.35 ) ); x = g1; }

			}

			add( x, b, s * inner, s * ( HALF_W + 0.35 ) );
			// seats
			for ( const ss of [ - 1, 1 ] ) {

				const segs = [ [ a + 0.3, cx + DOORS[ 0 ] - 0.8 ], [ cx + DOORS[ 0 ] + 0.8, cx + DOORS[ 1 ] - 0.8 ], [ cx + DOORS[ 1 ] + 0.8, cx + DOORS[ 2 ] - 0.8 ], [ cx + DOORS[ 2 ] + 0.8, cx + DOORS[ 3 ] - 0.8 ], [ cx + DOORS[ 3 ] + 0.8, b - 0.3 ] ];
				for ( const [ p, q ] of segs ) add( p, q, ss * ( HALF_W - 0.55 ), ss * inner );

			}

			// gangway: narrow passage to the next car
			if ( i < this.nCars - 1 ) {

				add( b, b + GAP, 0.72, HALF_W + 0.35 );
				add( b, b + GAP, - 0.72, - HALF_W - 0.35 );
				add( b - 0.02, b + GAP + 0.02, s * ( HALF_W - 0.2 ), s * ( HALF_W + 0.36 ) );

			}

		}

		// cab ends
		add( - this.length / 2 - 1.2, - this.length / 2 + 0.05, s * ( HALF_W + 0.34 ), - s * ( HALF_W + 0.6 ) );
		add( this.length / 2 - 0.05, this.length / 2 + 1.2, s * ( HALF_W + 0.34 ), - s * ( HALF_W + 0.6 ) );
		// the platform edge beyond the train ends (no falling onto the tracks)
		add( - 500, - this.length / 2 - 1.1, s * ( HALF_W + 0.34 ), - s * ( HALF_W + 0.6 ) );
		add( this.length / 2 + 1.1, 500, s * ( HALF_W + 0.34 ), - s * ( HALF_W + 0.6 ) );
		return out;

	}

	raycast( origin, dir, far ) {

		if ( ! this.visible ) return null;
		_ray.origin.copy( origin ); _ray.direction.copy( dir );
		let best = null;
		for ( let i = 0; i < this.nCars; i ++ ) {

			const cx = this.x + this.carX[ i ];
			_box.min.set( cx - CAR_LEN / 2, - 0.3, this.z - HALF_W );
			_box.max.set( cx + CAR_LEN / 2, ROOF, this.z + HALF_W );
			if ( _box.containsPoint( origin ) ) continue; // shooting from inside the car
			const p = _ray.intersectBox( _box, _v );
			if ( p ) {

				const d = p.distanceTo( origin );
				if ( d < far && ( ! best || d < best.distance ) ) {

					const n = new THREE.Vector3();
					if ( Math.abs( p.z - _box.min.z ) < 1e-3 ) n.set( 0, 0, - 1 ); else if ( Math.abs( p.z - _box.max.z ) < 1e-3 ) n.set( 0, 0, 1 ); else if ( Math.abs( p.y - ROOF ) < 1e-3 ) n.set( 0, 1, 0 ); else n.set( Math.sign( p.x - cx ), 0, 0 );
					// windows & open doors let bullets through
					const lx = p.x - cx, ly = p.y;
					const inWindow = ly > 0.92 && ly < 1.84 && Math.abs( n.z ) > 0.5;
					const inDoor = this.doorOpen > 0.5 && ly < 1.95 && DOORS.some( ( dd ) => Math.abs( lx - dd ) < DOOR_W / 2 ) && Math.sign( n.z ) === this.openSide;
					if ( inWindow || inDoor ) continue;
					best = { distance: d, point: p.clone(), normal: n, surface: 1, isTrain: true };

				}

			}

		}

		return best;

	}

	onHit( hit, dir ) {

		ctx.fx?.sparks( hit.point, hit.normal, 10, { speed: 6 } );
		ctx.fx?.dust( hit.point, hit.normal, 0x999999, 1, 0.2 );
		ctx.audio?.play( 'impact_metal', { pos: hit.point, vol: 0.8 } );
		void dir;

	}

	// ------------------------------------------------------------------ motion

	/** Place the train far in the western tunnel, ready to arrive. */
	prepareArrival( distance = 260 ) {

		this.x = - distance;
		this.v = 16;
		this.state = 'arriving';
		this.visible = true;
		this.group.visible = true;
		this.openSide = this.openSide || - 1;

	}

	openDoors() { this.doorTarget = 1; this.state = 'open'; ctx.audio?.play( 'hiss', { pos: this.frontPos(), vol: 0.5 } ); }
	closeDoors() { this.doorTarget = 0; this.state = 'closing'; this.stateT = 0; ctx.audio?.play( 'beeps', { pos: this.frontPos(), vol: 0.7, reverb: 0.3 } ); }
	depart() { this.state = 'departing'; }

	frontPos() { return new THREE.Vector3( this.x + this.length / 2, 1.5, this.z ); }

	update( dt, playerPos ) {

		const prevX = this.x;
		const vmax = 19;
		let accel = 0;
		if ( this.state === 'arriving' ) {

			const d = - this.x;
			const target = Math.min( vmax, Math.sqrt( Math.max( 0, 2 * 1.25 * d ) ) + 0.2 );
			const nv = Math.min( target, this.v + 1.5 * dt );
			accel = ( nv - this.v ) / Math.max( dt, 1e-4 );
			this.v = nv;
			this.x += this.v * dt;
			if ( this.x >= - 0.02 ) {

				this.x = 0; this.v = 0; this.state = 'stopped';
				this.onEvent?.( 'stopped' );

			}

			if ( ! this.hornPlayed && this.x > - 120 ) { this.hornPlayed = true; ctx.audio?.play( 'horn', { pos: this.frontPos(), vol: 0.9, reverb: 0.5, ref: 8 } ); }

		} else if ( this.state === 'departing' ) {

			const nv = Math.min( vmax, this.v + 1.4 * dt );
			accel = ( nv - this.v ) / Math.max( dt, 1e-4 );
			this.v = nv;
			this.x += this.v * dt;
			if ( this.x > HALF_L + this.length / 2 + 18 ) this.onEvent?.( 'inTunnel' );

		} else if ( this.state === 'closing' ) {

			this.stateT += dt;

		}

		// doors
		const ds = this.doorTarget > this.doorOpen ? 0.9 : - 0.75;
		if ( this.doorOpen !== this.doorTarget ) {

			this.doorOpen = THREE.MathUtils.clamp( this.doorOpen + ds * dt, 0, 1 );
			this.updateDoors();
			if ( this.doorOpen === 0 && this.state === 'closing' ) {

				ctx.audio?.play( 'door_thud', { pos: this.frontPos(), vol: 0.8 } );
				this.onEvent?.( 'closed' );

			}

			if ( this.doorOpen === 1 ) this.onEvent?.( 'opened' );

		}

		this.dx = this.x - prevX;
		this.group.position.x = this.x;
		this.a = accel;

		// interior lights follow the player's car (or the middle car)
		const ci = playerPos ? this.carAt( playerPos.x, playerPos.z ) : null;
		const near = ci !== null ? ci : this.nearestCar( playerPos );
		const flick = this.flicker > 0 ? ( Math.random() < 0.5 ? 0.05 : 1 ) : 1;
		if ( this.flicker > 0 ) this.flicker -= dt;
		for ( let i = 0; i < 2; i ++ ) {

			const l = this.inLights[ i ];
			l.position.set( this.x + this.carX[ near ] + ( i ? 5 : - 5 ), 1.95, this.z );
			l.intensity = this.visible ? 9 * flick : 0;

		}

		this.mInteriorGlowScale = flick;
		// headlight
		const fx = this.x + this.length / 2 + 1.2;
		this.head.position.set( fx, 0.8, this.z );
		this.head.target.position.set( fx + 20, 0.2, this.z );
		this.head.intensity = this.visible && Math.abs( this.x ) > 1 ? 1600 : 0;
		// tunnel lamps sweeping past the windows
		if ( this.visible && Math.abs( this.v ) > 1 && Math.abs( playerPos?.x ?? 0 ) > HALF_L - 5 ) {

			const px = playerPos.x;
			const sx = Math.sign( px ) || 1;
			const k = Math.round( ( Math.abs( px ) - HALF_L - 8 ) / 15 );
			const lampX = sx * ( HALF_L + 8 + k * 15 );
			this.tunnelLight.position.set( lampX, 2.1, this.z + TRACK_Z * 0 + 2.2 );
			this.tunnelLight.intensity = Math.abs( lampX - px ) < 9 ? 25 : 0;

		} else this.tunnelLight.intensity = 0;

		// sound
		const inside = ci !== null;
		const snd = inside ? new THREE.Vector3( playerPos.x, 1.2, this.z ) : this.frontPos().setX( THREE.MathUtils.clamp( playerPos?.x ?? 0, this.x - this.length / 2, this.x + this.length / 2 ) );
		ctx.audio?.trainSound( { speed: this.v, accel: this.a, pos: snd, inside, tunnel: Math.abs( this.x ) > HALF_L + 20 } );
		// rail joint clacks
		this.clackDist += Math.abs( this.dx );
		if ( this.clackDist > 12.5 && this.v > 2 ) {

			this.clackDist = 0;
			ctx.audio?.play( 'clack', { pos: snd, vol: Math.min( 0.8, this.v / 20 ), reverb: 0.3, rate: 0.9 + this.v / 40 } );

		}

	}

	nearestCar( p ) {

		if ( ! p ) return Math.floor( this.nCars / 2 );
		let best = 0, bd = Infinity;
		for ( let i = 0; i < this.nCars; i ++ ) { const d = Math.abs( this.x + this.carX[ i ] - p.x ); if ( d < bd ) { bd = d; best = i; } }
		return best;

	}

	/** Seamless station swap: shift the train & passengers by dx (teleport trick in the tunnel). */
	shift( dx ) { this.x += dx; this.group.position.x = this.x; }

	hide() { this.visible = false; this.group.visible = false; this.state = 'away'; this.x = - 600; this.group.position.x = this.x; for ( const l of this.inLights ) l.intensity = 0; this.head.intensity = 0; this.tunnelLight.intensity = 0; }

	/** Door world positions on the open side (for the boarding objective). */
	doorPositions() {

		const out = [];
		for ( let i = 0; i < this.nCars; i ++ ) for ( const d of DOORS ) out.push( new THREE.Vector3( this.x + this.carX[ i ] + d, 1.0, this.z + this.openSide * HALF_W ) );
		return out;

	}

}

export { PLAT_EDGE };
