// Visual effects: tracers, muzzle flashes, sparks, smoke/dust, blood (spray, mist, droplets,
// splatter decals, growing pools), glass shards, stone chips, wooden planks, shell casings.
import * as THREE from 'three/webgpu';
import {
	texture, uv, vec2, vec3, vec4, float, color, instancedDynamicBufferAttribute, mrt, mix, smoothstep,
	positionLocal, bumpMap, packNormalToRGB, normalView, output
} from 'three/tsl';
import { ctx } from '../core/ctx.js';
import { PLAT_EDGE, BED_Y } from '../world/layout.js';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const Z = new THREE.Vector3( 0, 0, 1 );

// FX never touch the G-buffer attachments used by SSR / SSGI / TRAA
const noGBuffer = () => mrt( { output, normal: vec4( 0 ), diffuseColor: vec4( 0 ), metalrough: vec4( 0 ), velocity: vec4( 0 ) } );

function floorY( x, z ) {

	const t = ctx.train?.floorAt?.( x, z );
	if ( t !== undefined && t !== null ) return t;
	return Math.abs( z ) < PLAT_EDGE ? 0 : BED_Y;

}

// ------------------------------------------------------------------ canvas textures

function cnv( w, h = w ) { const c = document.createElement( 'canvas' ); c.width = w; c.height = h; return [ c, c.getContext( '2d' ) ]; }
function tx( c ) { const t = new THREE.CanvasTexture( c ); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }

function puffTexture() {

	const [ c, g ] = cnv( 128 );
	for ( let i = 0; i < 26; i ++ ) {

		const x = 64 + ( Math.random() - 0.5 ) * 50, y = 64 + ( Math.random() - 0.5 ) * 50, r = 18 + Math.random() * 26;
		const gr = g.createRadialGradient( x, y, 0, x, y, r );
		gr.addColorStop( 0, 'rgba(255,255,255,0.22)' ); gr.addColorStop( 1, 'rgba(255,255,255,0)' );
		g.fillStyle = gr; g.fillRect( 0, 0, 128, 128 );

	}

	return tx( c );

}

function glowTexture() {

	const [ c, g ] = cnv( 64 );
	const gr = g.createRadialGradient( 32, 32, 0, 32, 32, 32 );
	gr.addColorStop( 0, 'rgba(255,255,255,1)' ); gr.addColorStop( 0.25, 'rgba(255,255,255,0.8)' ); gr.addColorStop( 1, 'rgba(255,255,255,0)' );
	g.fillStyle = gr; g.fillRect( 0, 0, 64, 64 );
	return tx( c );

}

export function flashTexture( petals = 6 ) {

	const [ c, g ] = cnv( 256 );
	g.translate( 128, 128 );
	for ( let k = 0; k < 3; k ++ ) {

		for ( let i = 0; i < petals; i ++ ) {

			g.save();
			g.rotate( i / petals * Math.PI * 2 + k * 0.4 + Math.random() * 0.3 );
			const len = ( 70 + Math.random() * 50 ) * ( 1 - k * 0.25 );
			const gr = g.createLinearGradient( 0, 0, len, 0 );
			gr.addColorStop( 0, 'rgba(255,250,220,1)' ); gr.addColorStop( 0.4, 'rgba(255,190,90,0.9)' ); gr.addColorStop( 1, 'rgba(255,120,30,0)' );
			g.fillStyle = gr;
			g.beginPath(); g.moveTo( 0, - 12 ); g.quadraticCurveTo( len * 0.5, - 9, len, 0 ); g.quadraticCurveTo( len * 0.5, 9, 0, 12 ); g.fill();
			g.restore();

		}

	}

	const gr = g.createRadialGradient( 0, 0, 0, 0, 0, 50 );
	gr.addColorStop( 0, 'rgba(255,255,240,1)' ); gr.addColorStop( 1, 'rgba(255,200,120,0)' );
	g.fillStyle = gr; g.beginPath(); g.arc( 0, 0, 50, 0, Math.PI * 2 ); g.fill();
	return tx( c );

}

/** 2x2 atlas of blood splatters (alpha = coverage). */
function bloodAtlas() {

	const S = 256;
	const [ c, g ] = cnv( S * 2 );
	for ( let v = 0; v < 4; v ++ ) {

		const ox = ( v % 2 ) * S, oy = Math.floor( v / 2 ) * S;
		g.save(); g.translate( ox + S / 2, oy + S / 2 );
		const main = 38 + Math.random() * 20;
		const col = () => `rgba(${ 70 + Math.random() * 40 | 0 },${ Math.random() * 8 | 0 },${ Math.random() * 8 | 0 },1)`;
		g.fillStyle = col();
		// main blob made of overlapping circles
		for ( let i = 0; i < 14; i ++ ) { g.beginPath(); g.arc( ( Math.random() - 0.5 ) * main, ( Math.random() - 0.5 ) * main, main * ( 0.3 + Math.random() * 0.4 ), 0, Math.PI * 2 ); g.fill(); }
		// streaks & droplets flung outwards
		const dirBias = Math.random() * Math.PI * 2;
		for ( let i = 0; i < 40; i ++ ) {

			const a = dirBias + ( Math.random() - 0.5 ) * ( v === 3 ? 6.3 : 2.2 );
			const d = main * 0.6 + Math.random() * ( S * 0.42 - main * 0.6 );
			const r = 1.5 + Math.random() * 6 * ( 1 - d / ( S * 0.5 ) );
			g.fillStyle = col();
			g.beginPath(); g.ellipse( Math.cos( a ) * d, Math.sin( a ) * d, r * 1.8, r, a, 0, Math.PI * 2 ); g.fill();
			if ( Math.random() < 0.3 ) {

				g.strokeStyle = col(); g.lineWidth = r * 0.8;
				g.beginPath(); g.moveTo( Math.cos( a ) * main * 0.4, Math.sin( a ) * main * 0.4 ); g.lineTo( Math.cos( a ) * d, Math.sin( a ) * d ); g.stroke();

			}

		}

		g.restore();

	}

	return tx( c );

}

/** 2x2 atlas: bullet holes (stone, stone, metal, wood). */
function holeAtlas() {

	const S = 128;
	const [ c, g ] = cnv( S * 2 );
	for ( let v = 0; v < 4; v ++ ) {

		const ox = ( v % 2 ) * S + S / 2, oy = Math.floor( v / 2 ) * S + S / 2;
		// chipped halo
		for ( let i = 0; i < 30; i ++ ) {

			const a = Math.random() * Math.PI * 2, d = Math.random() * 30;
			g.fillStyle = v === 2 ? `rgba(200,200,205,${ 0.25 + Math.random() * 0.3 })` : `rgba(${ 150 + Math.random() * 60 | 0 },${ 140 + Math.random() * 50 | 0 },${ 125 + Math.random() * 40 | 0 },${ 0.35 + Math.random() * 0.4 })`;
			g.beginPath(); g.arc( ox + Math.cos( a ) * d, oy + Math.sin( a ) * d, 3 + Math.random() * 9, 0, Math.PI * 2 ); g.fill();

		}

		// cracks
		g.strokeStyle = 'rgba(30,25,20,0.8)';
		for ( let i = 0; i < ( v === 2 ? 0 : 6 ); i ++ ) {

			g.lineWidth = 1 + Math.random() * 1.5;
			let x = ox, y = oy; const a = Math.random() * Math.PI * 2;
			g.beginPath(); g.moveTo( x, y );
			for ( let s = 0; s < 5; s ++ ) { x += Math.cos( a + ( Math.random() - 0.5 ) ) * 8; y += Math.sin( a + ( Math.random() - 0.5 ) ) * 8; g.lineTo( x, y ); }
			g.stroke();

		}

		const gr = g.createRadialGradient( ox, oy, 0, ox, oy, 14 );
		gr.addColorStop( 0, 'rgba(5,4,3,1)' ); gr.addColorStop( 0.6, 'rgba(20,16,12,1)' ); gr.addColorStop( 1, 'rgba(40,34,28,0)' );
		g.fillStyle = gr; g.beginPath(); g.arc( ox, oy, 14, 0, Math.PI * 2 ); g.fill();

	}

	return tx( c );

}

// ------------------------------------------------------------------ sprite particle pool

class SpritePool {

	constructor( scene, { max = 512, map, blending = THREE.NormalBlending, lit = false, depthWrite = false } ) {

		this.max = max;
		this.pos = new THREE.InstancedBufferAttribute( new Float32Array( max * 3 ), 3 );
		this.size = new THREE.InstancedBufferAttribute( new Float32Array( max ), 1 );
		this.rot = new THREE.InstancedBufferAttribute( new Float32Array( max ), 1 );
		this.col = new THREE.InstancedBufferAttribute( new Float32Array( max * 4 ), 4 );
		for ( const a of [ this.pos, this.size, this.rot, this.col ] ) a.setUsage( THREE.DynamicDrawUsage );
		const m = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite, blending } );
		const t = texture( map, uv() );
		const c = instancedDynamicBufferAttribute( this.col );
		m.positionNode = instancedDynamicBufferAttribute( this.pos );
		m.scaleNode = instancedDynamicBufferAttribute( this.size );
		m.rotationNode = instancedDynamicBufferAttribute( this.rot );
		m.colorNode = t.rgb.mul( c.rgb );
		m.opacityNode = t.a.mul( c.a );
		m.mrtNode = noGBuffer();
		if ( lit ) m.lights = true;
		this.sprite = new THREE.Sprite( m );
		this.sprite.count = max;
		this.sprite.frustumCulled = false;
		this.sprite.renderOrder = 10;
		scene.add( this.sprite );
		this.p = [];
		for ( let i = 0; i < max; i ++ ) this.p.push( { life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0, s1: 0, r: 0, vr: 0, cr: 1, cg: 1, cb: 1, a: 1, g: 0, drag: 0, fade: 1, onLand: null } );
		this.next = 0;
		this.active = 0;

	}

	spawn( o ) {

		const p = this.p[ this.next ];
		this.next = ( this.next + 1 ) % this.max;
		p.life = p.max = o.life ?? 1;
		p.x = o.x; p.y = o.y; p.z = o.z;
		p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
		p.s0 = o.s0 ?? 0.1; p.s1 = o.s1 ?? p.s0;
		p.r = o.r ?? Math.random() * 6.28; p.vr = o.vr ?? 0;
		p.cr = o.cr ?? 1; p.cg = o.cg ?? 1; p.cb = o.cb ?? 1; p.a = o.a ?? 1;
		p.g = o.g ?? 0; p.drag = o.drag ?? 0; p.fade = o.fade ?? 1;
		p.onLand = o.onLand || null;
		return p;

	}

	update( dt ) {

		const P = this.pos.array, S = this.size.array, R = this.rot.array, C = this.col.array;
		for ( let i = 0; i < this.max; i ++ ) {

			const p = this.p[ i ];
			if ( p.life <= 0 ) {

				if ( S[ i ] !== 0 ) S[ i ] = 0;
				continue;

			}

			p.life -= dt;
			const k = Math.max( 0, 1 - p.drag * dt );
			p.vx *= k; p.vy = p.vy * k - p.g * dt; p.vz *= k;
			p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
			if ( p.onLand && p.vy < 0 ) {

				const fy = floorY( p.x, p.z );
				if ( p.y <= fy + 0.01 ) { p.onLand( p, fy ); p.life = 0; }

			}

			p.r += p.vr * dt;
			const u = 1 - Math.max( 0, p.life ) / p.max;
			P[ i * 3 ] = p.x; P[ i * 3 + 1 ] = p.y; P[ i * 3 + 2 ] = p.z;
			S[ i ] = p.life > 0 ? p.s0 + ( p.s1 - p.s0 ) * u : 0;
			R[ i ] = p.r;
			C[ i * 4 ] = p.cr; C[ i * 4 + 1 ] = p.cg; C[ i * 4 + 2 ] = p.cb;
			C[ i * 4 + 3 ] = p.a * ( p.fade ? Math.pow( 1 - u, p.fade ) : 1 );

		}

		this.pos.needsUpdate = this.size.needsUpdate = this.rot.needsUpdate = this.col.needsUpdate = true;

	}

	clear() { for ( const p of this.p ) p.life = 0; }

}

// ------------------------------------------------------------------ rigid debris pool (instanced)

class DebrisPool {

	constructor( scene, geo, mat, max = 200, { bounce = 0.3, friction = 0.6, life = 10, sound = null, soundVol = 0.3 } = {} ) {

		this.mesh = new THREE.InstancedMesh( geo, mat, max );
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.mesh.frustumCulled = false;
		for ( let i = 0; i < max; i ++ ) this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) );
		scene.add( this.mesh );
		this.max = max;
		this.items = [];
		for ( let i = 0; i < max; i ++ ) this.items.push( { life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3( 1, 1, 1 ), rest: false, bounced: 0 } );
		this.next = 0;
		this.bounce = bounce; this.friction = friction; this.defaultLife = life;
		this.sound = sound; this.soundVol = soundVol;
		this.hasColor = false;

	}

	spawn( p, v, { scale = 1, sx, sy, sz, life, spin = 12, color } = {} ) {

		const it = this.items[ this.next ];
		const idx = this.next;
		this.next = ( this.next + 1 ) % this.max;
		it.life = life ?? this.defaultLife * ( 0.7 + Math.random() * 0.6 );
		it.p.copy( p ); it.v.copy( v );
		it.q.setFromEuler( _e.set( Math.random() * 6, Math.random() * 6, Math.random() * 6 ) );
		it.w.set( ( Math.random() - 0.5 ) * spin, ( Math.random() - 0.5 ) * spin, ( Math.random() - 0.5 ) * spin );
		it.s.set( sx ?? scale, sy ?? scale, sz ?? scale );
		it.rest = false; it.bounced = 0;
		if ( color !== undefined ) { this.mesh.setColorAt( idx, _c.set( color ) ); this.mesh.instanceColor.needsUpdate = true; }
		return it;

	}

	update( dt ) {

		let any = false;
		for ( let i = 0; i < this.max; i ++ ) {

			const it = this.items[ i ];
			if ( it.life <= 0 ) continue;
			any = true;
			it.life -= dt;
			if ( ! it.rest ) {

				it.v.y -= 9.81 * dt;
				it.p.addScaledVector( it.v, dt );
				const fy = floorY( it.p.x, it.p.z ) + it.s.y * 0.5;
				if ( it.p.y < fy ) {

					it.p.y = fy;
					if ( it.v.y < - 0.6 && it.bounced < 3 && this.sound ) ctx.audio?.play( this.sound, { pos: it.p, vol: this.soundVol * Math.min( 1, - it.v.y / 3 ), reverb: 0.2 } );
					it.bounced ++;
					it.v.y = - it.v.y * this.bounce;
					it.v.x *= this.friction; it.v.z *= this.friction;
					it.w.multiplyScalar( 0.6 );
					if ( Math.abs( it.v.y ) < 0.3 && it.v.lengthSq() < 0.1 ) {

						it.rest = true;
						// lie flat-ish
						_e.setFromQuaternion( it.q ); _e.x = Math.round( _e.x / ( Math.PI / 2 ) ) * Math.PI / 2; _e.z = Math.round( _e.z / ( Math.PI / 2 ) ) * Math.PI / 2;
						it.q.setFromEuler( _e );

					}

				}

				_q.setFromEuler( _e.set( it.w.x * dt, it.w.y * dt, it.w.z * dt ) );
				it.q.multiply( _q );

			}

			const shrink = it.life < 1 ? Math.max( 0, it.life ) : 1;
			_s.copy( it.s ).multiplyScalar( shrink );
			this.mesh.setMatrixAt( i, _m.compose( it.p, it.q, _s ) );

		}

		if ( any || this._wasAny ) this.mesh.instanceMatrix.needsUpdate = true;
		this._wasAny = any;

	}

	clear() {

		for ( let i = 0; i < this.max; i ++ ) { this.items[ i ].life = 0; this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) ); }
		this.mesh.instanceMatrix.needsUpdate = true;

	}

}

const _c = new THREE.Color();

// ------------------------------------------------------------------ decals

class DecalLayer {

	constructor( scene, atlas, max, { rough = 0.8, metal = 0, bump = 0, colorMul = 1, wet = false, renderOrder = 2 } ) {

		const geo = new THREE.PlaneGeometry( 1, 1 );
		this.variant = new THREE.InstancedBufferAttribute( new Float32Array( max * 2 ), 2 );
		this.variant.setUsage( THREE.DynamicDrawUsage );
		const m = new THREE.MeshPhysicalNodeMaterial( { polygonOffset: true, polygonOffsetFactor: - 4, polygonOffsetUnits: - 4 } );
		const off = instancedDynamicBufferAttribute( this.variant );
		const t = texture( atlas, uv().mul( 0.5 ).add( off ) );
		m.colorNode = t.rgb.mul( colorMul );
		m.opacityNode = t.a;
		m.alphaTest = 0.4;
		m.roughnessNode = float( rough );
		m.metalnessNode = float( metal );
		if ( wet ) { m.clearcoat = 1; m.clearcoatRoughness = 0.05; }
		if ( bump ) m.normalNode = bumpMap( t.a.oneMinus(), float( bump ) );
		this.mesh = new THREE.InstancedMesh( geo, m, max );
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = renderOrder;
		for ( let i = 0; i < max; i ++ ) this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) );
		scene.add( this.mesh );
		this.max = max;
		this.next = 0;
		this.growing = [];

	}

	add( pos, normal, size, variant = Math.floor( Math.random() * 4 ), grow = 0 ) {

		const i = this.next;
		this.next = ( this.next + 1 ) % this.max;
		_q.setFromUnitVectors( Z, normal );
		_q.multiply( new THREE.Quaternion().setFromAxisAngle( Z, Math.random() * Math.PI * 2 ) );
		_v.copy( pos ).addScaledVector( normal, 0.006 );
		const s = grow ? size * 0.2 : size;
		this.mesh.setMatrixAt( i, _m.compose( _v, _q, _s.set( s, s, 1 ) ) );
		this.variant.setXY( i, ( variant % 2 ) * 0.5, Math.floor( variant / 2 ) * 0.5 );
		this.variant.needsUpdate = true;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.growing = this.growing.filter( ( g ) => g.i !== i );
		if ( grow ) this.growing.push( { i, pos: _v.clone(), q: _q.clone(), size, t: 0, dur: grow } );
		return i;

	}

	update( dt ) {

		if ( ! this.growing.length ) return;
		for ( const g of this.growing ) {

			g.t += dt;
			const u = Math.min( 1, g.t / g.dur );
			const s = g.size * ( 0.2 + 0.8 * ( 1 - Math.pow( 1 - u, 2 ) ) );
			this.mesh.setMatrixAt( g.i, _m.compose( g.pos, g.q, _s.set( s, s, 1 ) ) );

		}

		this.growing = this.growing.filter( ( g ) => g.t < g.dur );
		this.mesh.instanceMatrix.needsUpdate = true;

	}

	clear() {

		for ( let i = 0; i < this.max; i ++ ) this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) );
		this.mesh.instanceMatrix.needsUpdate = true;
		this.growing = [];

	}

}

// ------------------------------------------------------------------ tracers

class Tracers {

	constructor( scene, max = 96 ) {

		const geo = new THREE.BoxGeometry( 1, 1, 1 );
		geo.translate( 0, 0, - 0.5 ); // origin at the head of the streak
		const m = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
		// tapered glow along the streak (bright head)
		const k = positionLocal.z.negate(); // 0 head → 1 tail
		m.colorNode = color( 1, 1, 1 ).mul( mix( float( 1.6 ), float( 0.05 ), smoothstep( 0.0, 1.0, k ) ) );
		m.mrtNode = noGBuffer();
		this.mesh = new THREE.InstancedMesh( geo, m, max );
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 11;
		for ( let i = 0; i < max; i ++ ) { this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) ); this.mesh.setColorAt( i, _c.set( 0xffffff ) ); }
		scene.add( this.mesh );
		this.items = [];
		for ( let i = 0; i < max; i ++ ) this.items.push( { alive: false, o: new THREE.Vector3(), d: new THREE.Vector3(), dist: 0, travelled: 0, speed: 0, len: 0, w: 0 } );
		this.next = 0;
		this.max = max;

	}

	spawn( origin, dir, dist, { speed = 420, len = 4.5, width = 0.018, tint = 0xffc070, intensity = 22 } = {} ) {

		const it = this.items[ this.next ];
		const i = this.next;
		this.next = ( this.next + 1 ) % this.max;
		it.alive = true;
		it.o.copy( origin ); it.d.copy( dir ).normalize();
		it.dist = dist; it.travelled = 0; it.speed = speed; it.len = len; it.w = width;
		this.mesh.setColorAt( i, _c.set( tint ).multiplyScalar( intensity ) );
		this.mesh.instanceColor.needsUpdate = true;

	}

	update( dt ) {

		for ( let i = 0; i < this.max; i ++ ) {

			const it = this.items[ i ];
			if ( ! it.alive ) continue;
			it.travelled += it.speed * dt;
			const head = Math.min( it.travelled, it.dist );
			const tail = Math.max( 0, head - it.len );
			if ( tail >= it.dist - 0.01 ) {

				it.alive = false;
				this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) );
				continue;

			}

			_v.copy( it.o ).addScaledVector( it.d, head );
			_q.setFromUnitVectors( _v2.set( 0, 0, - 1 ), it.d );
			this.mesh.setMatrixAt( i, _m.compose( _v, _q, _s.set( it.w, it.w, Math.max( 0.01, head - tail ) ) ) );

		}

		this.mesh.instanceMatrix.needsUpdate = true;

	}

	clear() { for ( let i = 0; i < this.max; i ++ ) { this.items[ i ].alive = false; this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) ); } this.mesh.instanceMatrix.needsUpdate = true; }

}

// ------------------------------------------------------------------ FX facade

export class FX {

	constructor( parentScene ) {

		const scene = new THREE.Group();
		scene.name = 'fx';
		parentScene.add( scene );
		this.root = scene;
		this.scene = scene;
		const puff = puffTexture(), glow = glowTexture();
		this.flashTex = flashTexture();
		this.smoke = new SpritePool( scene, { max: 700, map: puff } );
		this.mist = new SpritePool( scene, { max: 300, map: puff } );
		this.sparkPool = new SpritePool( scene, { max: 700, map: glow, blending: THREE.AdditiveBlending } );
		this.flashPool = new SpritePool( scene, { max: 32, map: this.flashTex, blending: THREE.AdditiveBlending } );
		this.drops = new SpritePool( scene, { max: 500, map: glow } );
		this.tracers = new Tracers( scene );
		this.bloodDecals = new DecalLayer( scene, bloodAtlas(), 220, { rough: 0.12, wet: true, colorMul: 1.0 } );
		this.poolDecals = new DecalLayer( scene, bloodAtlas(), 40, { rough: 0.05, wet: true, colorMul: 0.8, renderOrder: 1 } );
		this.holes = new DecalLayer( scene, holeAtlas(), 300, { rough: 0.9, bump: 0.8 } );

		// shards & chips
		const shardGeo = new THREE.TetrahedronGeometry( 0.02, 0 );
		shardGeo.scale( 1, 0.25, 1.6 );
		const shardMat = new THREE.MeshPhysicalNodeMaterial( { color: 0xffffff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75 } );
		shardMat.emissiveNode = color( 0.08, 0.08, 0.08 );
		this.shards = new DebrisPool( scene, shardGeo, shardMat, 500, { bounce: 0.25, friction: 0.5, life: 8, sound: 'glass_small', soundVol: 0.05 } );
		this.shards.mesh.setColorAt( 0, _c.set( 0xffffff ) );
		for ( let i = 1; i < 500; i ++ ) this.shards.mesh.setColorAt( i, _c.set( 0xffffff ) );
		const chipGeo = new THREE.DodecahedronGeometry( 0.02, 0 );
		const chipMat = new THREE.MeshStandardNodeMaterial( { color: 0xd9d0c0, roughness: 0.6 } );
		this.chips = new DebrisPool( scene, chipGeo, chipMat, 300, { bounce: 0.35, friction: 0.5, life: 6 } );
		for ( let i = 0; i < 300; i ++ ) this.chips.mesh.setColorAt( i, _c.set( 0xffffff ) );
		const splGeo = new THREE.BoxGeometry( 0.02, 0.015, 0.12 );
		const splMat = new THREE.MeshStandardNodeMaterial( { color: 0x8a5a33, roughness: 0.7 } );
		this.splinters = new DebrisPool( scene, splGeo, splMat, 200, { bounce: 0.3, friction: 0.6, life: 8 } );
		// casings: brass 7.62 / .50 and red shotgun shells
		const casingGeo = new THREE.CylinderGeometry( 0.0055, 0.0065, 0.039, 8 );
		casingGeo.rotateX( Math.PI / 2 );
		const brass = new THREE.MeshPhysicalNodeMaterial( { color: 0xd9a94a, metalness: 1, roughness: 0.25 } );
		this.casings = new DebrisPool( scene, casingGeo, brass, 160, { bounce: 0.45, friction: 0.7, life: 14, sound: 'casing', soundVol: 0.35 } );
		const shellGeo = new THREE.CylinderGeometry( 0.0105, 0.0105, 0.07, 10 );
		shellGeo.rotateX( Math.PI / 2 );
		const shellMat = new THREE.MeshPhysicalNodeMaterial( { color: 0xb3141b, roughness: 0.4, clearcoat: 0.6 } );
		this.shells = new DebrisPool( scene, shellGeo, shellMat, 60, { bounce: 0.3, friction: 0.6, life: 14, sound: 'shell_drop', soundVol: 0.3 } );
		this.planksList = [];
		this.flashLights = [];
		this.bloodBudget = 0;

	}

	/** Light pool for muzzle flashes: provided by main (fixed lights). */
	setFlashLights( lights ) { this.flashLights = lights.map( ( l ) => ( { l, t: 0 } ) ); }

	lightFlash( pos, intensity = 30, color = 0xffb060, dur = 0.05 ) {

		if ( ! this.flashLights.length ) return;
		let best = this.flashLights[ 0 ];
		for ( const f of this.flashLights ) if ( f.t < best.t ) best = f;
		best.l.position.copy( pos );
		best.l.color.set( color );
		best.l.intensity = intensity;
		best.t = dur;
		best.base = intensity;
		best.dur = dur;

	}

	muzzleFlash( pos, dir, scale = 1 ) {

		this.flashPool.spawn( { x: pos.x, y: pos.y, z: pos.z, life: 0.05, s0: 0.35 * scale, s1: 0.55 * scale, cr: 6, cg: 4.2, cb: 2.2, fade: 1 } );
		for ( let i = 0; i < 3; i ++ ) {

			const d = 0.08 + i * 0.1;
			this.flashPool.spawn( { x: pos.x + dir.x * d, y: pos.y + dir.y * d, z: pos.z + dir.z * d, life: 0.04, s0: 0.2 * scale * ( 1 - i * 0.2 ), s1: 0.3 * scale, cr: 5, cg: 3, cb: 1.4 } );

		}

		// thin muzzle smoke drifting away from the barrel
		for ( let i = 0; i < 2; i ++ ) this.smoke.spawn( { x: pos.x + dir.x * 0.35, y: pos.y + dir.y * 0.35, z: pos.z + dir.z * 0.35, vx: dir.x * 1.6 + ( Math.random() - 0.5 ) * 0.3, vy: 0.25 + Math.random() * 0.2, vz: dir.z * 1.6 + ( Math.random() - 0.5 ) * 0.3, life: 0.9 + Math.random() * 0.6, s0: 0.03 * scale, s1: 0.28 * scale, cr: 0.6, cg: 0.58, cb: 0.55, a: 0.1, drag: 1.8 } );
		this.lightFlash( pos, 35 * scale );

	}

	sparks( pos, normal, n = 10, { speed = 5, tint = [ 6, 4, 1.8 ] } = {} ) {

		for ( let i = 0; i < n; i ++ ) {

			_v.set( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).normalize().multiplyScalar( 0.8 ).add( normal ).normalize().multiplyScalar( speed * ( 0.3 + Math.random() ) );
			this.sparkPool.spawn( { x: pos.x, y: pos.y, z: pos.z, vx: _v.x, vy: _v.y, vz: _v.z, life: 0.2 + Math.random() * 0.5, s0: 0.035, s1: 0.01, cr: tint[ 0 ], cg: tint[ 1 ], cb: tint[ 2 ], g: 9.8, drag: 0.8, fade: 0.5 } );

		}

	}

	dust( pos, normal, tint = 0xcfc5b5, n = 4, size = 0.35 ) {

		_c.set( tint );
		for ( let i = 0; i < n; i ++ ) {

			_v.set( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).multiplyScalar( 0.6 ).add( normal ).multiplyScalar( 0.6 + Math.random() * 1.2 );
			this.smoke.spawn( { x: pos.x, y: pos.y, z: pos.z, vx: _v.x, vy: _v.y + 0.1, vz: _v.z, life: 1.2 + Math.random() * 1.2, s0: size * 0.2, s1: size * ( 1 + Math.random() ), cr: _c.r, cg: _c.g, cb: _c.b, a: 0.35, drag: 2.2, g: - 0.05 } );

		}

	}

	debris( pos, normal, kind = 'stone', n = 6, tint = 0xd9d0c0 ) {

		for ( let i = 0; i < n; i ++ ) {

			_v.set( Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5 ).multiplyScalar( 1.2 ).add( normal ).multiplyScalar( 1.5 + Math.random() * 3 );
			if ( kind === 'wood' ) this.splinters.spawn( pos, _v, { scale: 0.6 + Math.random() * 0.8 } );
			else this.chips.spawn( pos, _v, { scale: 0.5 + Math.random() * 1.2, color: tint } );

		}

	}

	/** Impact on architecture: decal + particles by surface type. */
	impact( hit, dir, { big = false } = {} ) {

		const n = hit.normal, p = hit.point;
		const s = hit.surface;
		if ( s === 1 ) { // metal

			this.holes.add( p, n, big ? 0.09 : 0.06, 2 );
			this.sparks( p, n, big ? 16 : 9, { speed: 6 } );
			ctx.audio?.play( Math.random() < 0.5 ? 'ricochet' : 'impact_metal', { pos: p, vol: 0.7 } );

		} else if ( s === 2 ) { // wood

			this.holes.add( p, n, 0.05, 3 );
			this.debris( p, n, 'wood', 4 );
			this.dust( p, n, 0x8a6a4a, 2, 0.25 );
			ctx.audio?.play( 'wood_hit', { pos: p, vol: 0.7 } );

		} else if ( s === 3 ) { // glass mosaic / panels

			this.holes.add( p, n, 0.07, 0 );
			this.glassBurst( p, dir, 6, 0xffe2a0 );
			ctx.audio?.play( 'glass_small', { pos: p, vol: 0.6 } );

		} else { // stone / plaster / concrete

			this.holes.add( p, n, ( big ? 0.11 : 0.075 ) * ( 0.8 + Math.random() * 0.4 ), Math.random() < 0.5 ? 0 : 1 );
			const tint = s === 4 ? 0xefe6cf : s === 5 ? 0x77736c : 0xd8cfbf;
			this.dust( p, n, tint, big ? 6 : 3, big ? 0.5 : 0.32 );
			this.debris( p, n, 'stone', big ? 8 : 4, tint );
			if ( Math.random() < 0.35 ) this.sparks( p, n, 3, { speed: 4 } );
			ctx.audio?.play( Math.random() < 0.18 ? 'ricochet' : 'impact_stone', { pos: p, vol: 0.75 } );

		}

	}

	glassBurst( pos, dir, n = 12, tint = 0xffffff, big = false ) {

		for ( let i = 0; i < n; i ++ ) {

			_v.set( Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5 ).multiplyScalar( 2.5 ).addScaledVector( dir, 1.5 ).multiplyScalar( 1 + Math.random() * ( big ? 3 : 2 ) );
			const it = this.shards.spawn( pos, _v, { scale: big ? 1 + Math.random() * 2.5 : 0.6 + Math.random() * 1.2 } );
			void it;
			this.shards.mesh.setColorAt( ( this.shards.next + this.shards.max - 1 ) % this.shards.max, _c.set( tint ) );

		}

		this.shards.mesh.instanceColor.needsUpdate = true;
		for ( let i = 0; i < Math.ceil( n / 3 ); i ++ ) this.sparkPool.spawn( { x: pos.x, y: pos.y, z: pos.z, vx: ( Math.random() - 0.5 ) * 3, vy: Math.random() * 2, vz: ( Math.random() - 0.5 ) * 3, life: 0.25, s0: 0.08, s1: 0.02, cr: 3, cg: 3, cb: 3, g: 5 } );

	}

	/** Blood: directional spray, mist puff, droplets that land as decals, splatter on nearby walls. */
	blood( pos, dir, amount = 1, headshot = false ) {

		const n = Math.round( ( headshot ? 34 : 18 ) * amount );
		for ( let i = 0; i < n; i ++ ) {

			_v.set( Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5 ).multiplyScalar( 1.6 ).addScaledVector( dir, 1.8 ).normalize().multiplyScalar( 1.5 + Math.random() * ( headshot ? 6 : 4 ) );
			this.drops.spawn( {
				x: pos.x, y: pos.y, z: pos.z, vx: _v.x, vy: _v.y + 0.8, vz: _v.z, life: 2.5, s0: 0.018 + Math.random() * 0.03, s1: 0.012,
				cr: 0.28, cg: 0.01, cb: 0.01, a: 1, g: 9.8, drag: 0.4, fade: 0,
				onLand: ( p, fy ) => {

					if ( this.bloodBudget > 12 ) return;
					this.bloodBudget ++;
					this.bloodDecals.add( _v2.set( p.x, fy, p.z ), _v.set( 0, 1, 0 ), 0.06 + Math.random() * 0.14 );

				}
			} );

		}

		for ( let i = 0; i < ( headshot ? 6 : 3 ); i ++ ) {

			this.mist.spawn( {
				x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 1.2 + ( Math.random() - 0.5 ), vy: ( Math.random() - 0.3 ) * 0.6, vz: dir.z * 1.2 + ( Math.random() - 0.5 ),
				life: 0.5 + Math.random() * 0.4, s0: 0.12, s1: headshot ? 0.9 : 0.55, cr: 0.35, cg: 0.02, cb: 0.02, a: 0.55, drag: 3
			} );

		}

		// spray lands on the floor behind the victim
		if ( pos.y < 2.2 ) {

			const t = 0.6 + Math.random() * 1.2;
			const fx = pos.x + dir.x * t, fz = pos.z + dir.z * t;
			this.bloodDecals.add( _v2.set( fx, floorY( fx, fz ), fz ), _v.set( 0, 1, 0 ), ( 0.35 + Math.random() * 0.45 ) * ( headshot ? 1.4 : 1 ) * amount );

		}

		// splatter on whatever is behind the victim
		const world = ctx.world;
		if ( world ) {

			for ( let k = 0; k < ( headshot ? 3 : 1 ); k ++ ) {

				_v.copy( dir ).add( _v2.set( ( Math.random() - 0.5 ) * 0.3, ( Math.random() - 0.5 ) * 0.3 - 0.1, ( Math.random() - 0.5 ) * 0.3 ) ).normalize();
				const hit = world.raycast( pos, _v, 4.0 );
				if ( hit && ! hit.breakable ) this.bloodDecals.add( hit.point, hit.normal, ( 0.6 + Math.random() * 0.7 ) * ( headshot ? 1.4 : 1 ) * ( 1 - hit.distance / 5 ) );

			}

		}

	}

	bloodPool( pos, size = 1.4 ) {

		this.poolDecals.add( _v.set( pos.x, floorY( pos.x, pos.z ) + 0.002, pos.z ), _v2.set( 0, 1, 0 ), size * 1.4, 3, 7 );

	}

	tracer( origin, dir, dist, opts ) { this.tracers.spawn( origin, dir, dist, opts ); }

	ejectCasing( pos, vel, shotgun = false ) {

		( shotgun ? this.shells : this.casings ).spawn( pos, vel, { spin: 25 } );

	}

	planks( center, dir, mat, n = 6 ) {

		for ( let i = 0; i < n; i ++ ) {

			const geo = new THREE.BoxGeometry( 0.6 + Math.random() * 0.8, 0.04, 0.085 );
			const mesh = new THREE.Mesh( geo, mat );
			mesh.position.copy( center ).add( _v.set( ( Math.random() - 0.5 ) * 1.6, 0.4, ( Math.random() - 0.5 ) * 0.4 ) );
			mesh.rotation.set( Math.random(), Math.random() * 6, Math.random() );
			this.scene.add( mesh );
			this.planksList.push( { mesh, v: new THREE.Vector3( dir.x * 2 + ( Math.random() - 0.5 ) * 3, 2 + Math.random() * 2, dir.z * 2 + ( Math.random() - 0.5 ) * 3 ), w: new THREE.Vector3( Math.random() * 6, Math.random() * 6, Math.random() * 6 ), rest: false } );

		}

	}

	update( dt ) {

		this.bloodBudget = Math.max( 0, this.bloodBudget - dt * 20 );
		this.smoke.update( dt ); this.mist.update( dt ); this.sparkPool.update( dt ); this.flashPool.update( dt ); this.drops.update( dt );
		this.tracers.update( dt );
		this.shards.update( dt ); this.chips.update( dt ); this.splinters.update( dt ); this.casings.update( dt ); this.shells.update( dt );
		this.bloodDecals.update( dt ); this.poolDecals.update( dt );
		for ( const f of this.flashLights ) {

			if ( f.t > 0 ) {

				f.t -= dt;
				f.l.intensity = f.t > 0 ? f.base * ( f.t / f.dur ) : 0;

			}

		}

		for ( const p of this.planksList ) {

			if ( p.rest ) continue;
			p.v.y -= 9.81 * dt;
			p.mesh.position.addScaledVector( p.v, dt );
			p.mesh.rotation.x += p.w.x * dt; p.mesh.rotation.y += p.w.y * dt; p.mesh.rotation.z += p.w.z * dt;
			const fy = floorY( p.mesh.position.x, p.mesh.position.z ) + 0.03;
			if ( p.mesh.position.y < fy ) {

				p.mesh.position.y = fy;
				p.v.y *= - 0.25; p.v.x *= 0.5; p.v.z *= 0.5; p.w.multiplyScalar( 0.4 );
				if ( Math.abs( p.v.y ) < 0.4 ) { p.rest = true; p.mesh.rotation.x = 0; p.mesh.rotation.z = 0; }

			}

		}

	}

	clear() {

		for ( const p of [ this.smoke, this.mist, this.sparkPool, this.flashPool, this.drops ] ) p.clear();
		this.tracers.clear();
		for ( const d of [ this.shards, this.chips, this.splinters, this.casings, this.shells ] ) d.clear();
		this.bloodDecals.clear(); this.poolDecals.clear(); this.holes.clear();
		for ( const p of this.planksList ) { p.mesh.removeFromParent(); p.mesh.geometry.dispose(); }
		this.planksList = [];

	}

}

export { vec2, vec3, packNormalToRGB, normalView };
