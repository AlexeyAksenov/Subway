// Light fixtures and destructible props: chandeliers (bulbs shatter one by one, the whole
// fixture swings on hits), wall lamps, stained glass panels and wooden benches.
import * as THREE from 'three/webgpu';
import * as G from './geom.js';
import * as M from './materials.js';
import { SURF } from './world.js';
import { ctx } from '../core/ctx.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _zero = new THREE.Matrix4().makeScale( 0, 0, 0 );

// ------------------------------------------------------------------ chandelier geometry

const cache = new Map();

export function chandelierParts( style = 'baroque' ) {

	if ( cache.has( style ) ) return cache.get( style );
	const metal = [], white = [], crystal = [];
	const bulbs = [];
	const flame = G.lathe( [ [ 0, 0 ], [ 0.02, 0.014 ], [ 0.027, 0.04 ], [ 0.018, 0.068 ], [ 0.0, 0.098 ] ], 10 );
	const oct = new THREE.OctahedronGeometry( 0.028, 0 );
	oct.scale( 1, 1.9, 1 );
	const prism = new THREE.OctahedronGeometry( 0.045, 0 );
	prism.scale( 1, 2.4, 1 );

	if ( style === 'baroque' ) {

		metal.push( G.cyl( 0.022, 0.022, 0.95, 8, { y: - 0.475 } ) );
		metal.push( G.lathe( [ [ 0.0, 0 ], [ 0.2, - 0.02 ], [ 0.18, - 0.08 ], [ 0.05, - 0.14 ], [ 0.03, - 0.2 ] ], 20 ) );
		metal.push( G.lathe( [ [ 0.03, - 0.9 ], [ 0.07, - 0.95 ], [ 0.05, - 1.05 ], [ 0.12, - 1.18 ], [ 0.15, - 1.3 ], [ 0.1, - 1.42 ], [ 0.17, - 1.6 ], [ 0.21, - 1.76 ], [ 0.16, - 1.92 ], [ 0.07, - 2.02 ], [ 0.11, - 2.12 ], [ 0.045, - 2.26 ], [ 0.0, - 2.4 ] ], 20 ) );
		metal.push( G.place( new THREE.TorusGeometry( 0.3, 0.018, 8, 40 ), { y: - 1.05, rx: Math.PI / 2 } ) );
		metal.push( G.place( new THREE.TorusGeometry( 0.62, 0.014, 8, 56 ), { y: - 1.83, rx: Math.PI / 2 } ) );
		// crown leaves
		for ( let i = 0; i < 12; i ++ ) {

			const a = i / 12 * Math.PI * 2;
			metal.push( G.place( new THREE.ConeGeometry( 0.03, 0.16, 6 ), { x: Math.cos( a ) * 0.3, y: - 0.98, z: Math.sin( a ) * 0.3 } ) );

		}

		const tiers = [ { n: 12, r: 0.86, y: - 1.78, sag: 0.3 }, { n: 8, r: 0.52, y: - 1.3, sag: 0.22 }, { n: 6, r: 0.28, y: - 0.98, sag: 0.12 } ];
		for ( const t of tiers ) {

			const tips = [];
			for ( let i = 0; i < t.n; i ++ ) {

				const a = ( i + ( t.n === 8 ? 0.5 : 0 ) ) / t.n * Math.PI * 2;
				const c = Math.cos( a ), s = Math.sin( a );
				const P = ( r, y ) => new THREE.Vector3( c * r, y, s * r );
				const curve = new THREE.CatmullRomCurve3( [ P( 0.12, t.y + 0.02 ), P( t.r * 0.35, t.y - t.sag ), P( t.r * 0.78, t.y - t.sag * 0.7 ), P( t.r, t.y + 0.02 ) ] );
				metal.push( new THREE.TubeGeometry( curve, 14, 0.016, 6 ) );
				// decorative scroll under the arm
				const scroll = new THREE.TorusGeometry( 0.06, 0.008, 6, 16, Math.PI * 1.5 );
				metal.push( G.place( scroll, { x: c * t.r * 0.55, y: t.y - t.sag * 0.95 - 0.04, z: s * t.r * 0.55, ry: - a } ) );
				const tip = P( t.r, t.y + 0.02 );
				tips.push( tip );
				metal.push( G.lathe( [ [ 0.0, 0 ], [ 0.058, 0.0 ], [ 0.064, 0.016 ], [ 0.022, 0.03 ], [ 0.02, 0.04 ] ], 12, { x: tip.x, y: tip.y, z: tip.z } ) );
				white.push( G.cyl( 0.017, 0.018, 0.11, 10, { x: tip.x, y: tip.y + 0.095, z: tip.z } ) );
				bulbs.push( new THREE.Vector3( tip.x, tip.y + 0.15, tip.z ) );
				// crystal drops under each cup
				crystal.push( G.place( oct, { x: tip.x, y: tip.y - 0.07, z: tip.z } ) );
				crystal.push( G.place( oct, { x: tip.x, y: tip.y - 0.17, z: tip.z } ) );
				crystal.push( G.place( prism, { x: tip.x, y: tip.y - 0.31, z: tip.z } ) );

			}

			// garlands of crystals between tips (lowest tier only)
			if ( t.n === 12 ) for ( let i = 0; i < t.n; i ++ ) {

				const a = tips[ i ], b = tips[ ( i + 1 ) % t.n ];
				for ( let k = 1; k < 7; k ++ ) {

					const u = k / 7;
					const p = a.clone().lerp( b, u );
					p.y -= Math.sin( u * Math.PI ) * 0.2 + 0.02;
					crystal.push( G.place( oct, { x: p.x, y: p.y, z: p.z, sx: 0.8, sy: 0.8, sz: 0.8 } ) );

				}

			}

		}

		// big bottom drops
		for ( let i = 0; i < 8; i ++ ) {

			const a = i / 8 * Math.PI * 2;
			crystal.push( G.place( prism, { x: Math.cos( a ) * 0.1, y: - 2.3, z: Math.sin( a ) * 0.1, sx: 1.2, sy: 1.2, sz: 1.2 } ) );

		}

	} else if ( style === 'lantern' ) {

		// smaller platform chandelier: 6 arms and a glass bowl
		metal.push( G.cyl( 0.018, 0.018, 0.7, 8, { y: - 0.35 } ) );
		metal.push( G.lathe( [ [ 0.03, - 0.7 ], [ 0.08, - 0.76 ], [ 0.1, - 0.9 ], [ 0.06, - 1.0 ], [ 0.12, - 1.12 ], [ 0.02, - 1.25 ], [ 0, - 1.3 ] ], 16 ) );
		for ( let i = 0; i < 6; i ++ ) {

			const a = i / 6 * Math.PI * 2;
			const c = Math.cos( a ), s = Math.sin( a );
			const P = ( r, y ) => new THREE.Vector3( c * r, y, s * r );
			const curve = new THREE.CatmullRomCurve3( [ P( 0.08, - 0.95 ), P( 0.25, - 1.12 ), P( 0.45, - 1.05 ), P( 0.5, - 0.9 ) ] );
			metal.push( new THREE.TubeGeometry( curve, 10, 0.014, 6 ) );
			const tip = P( 0.5, - 0.9 );
			metal.push( G.lathe( [ [ 0, 0 ], [ 0.05, 0 ], [ 0.05, 0.015 ], [ 0.02, 0.03 ] ], 10, { x: tip.x, y: tip.y, z: tip.z } ) );
			white.push( G.cyl( 0.016, 0.016, 0.1, 8, { x: tip.x, y: tip.y + 0.08, z: tip.z } ) );
			bulbs.push( new THREE.Vector3( tip.x, tip.y + 0.13, tip.z ) );
			crystal.push( G.place( oct, { x: tip.x, y: tip.y - 0.08, z: tip.z } ) );

		}

	} else if ( style === 'ring' ) {

		// Mayakovskaya-type ring of lamps around a dome: handled by caller (bulbs only)

	}

	const parts = {
		metal: metal.length ? G.merge( metal ) : null,
		white: white.length ? G.merge( white ) : null,
		crystal: crystal.length ? G.merge( crystal ) : null,
		bulb: flame,
		bulbs
	};
	cache.set( style, parts );
	return parts;

}

// ------------------------------------------------------------------ breakable lamp cluster

export class LampCluster {

	/**
	 * @param {StationWorld} W
	 * @param {object} o  { position, parts?, bulbGeo, bulbPositions, mats:{metal,white,crystal}, bulbMat, light, lightOffset, swing, bulbRadius, hp }
	 */
	constructor( W, o ) {

		this.W = W;
		this.root = new THREE.Group();
		this.root.position.copy( o.position );
		if ( o.rotationY ) this.root.rotation.y = o.rotationY;
		W.group.add( this.root );
		this.pivot = new THREE.Group();
		this.root.add( this.pivot );
		const add = ( g, m ) => { if ( g && m ) { const mesh = new THREE.Mesh( g, m ); this.pivot.add( mesh ); return mesh; } };
		if ( o.parts ) {

			add( o.parts.metal, o.mats.metal );
			add( o.parts.white, o.mats.white );
			add( o.parts.crystal, o.mats.crystal );

		}

		if ( o.extraMeshes ) for ( const [ g, m ] of o.extraMeshes ) add( g, m );
		this.bulbLocal = ( o.bulbPositions || o.parts.bulbs ).map( ( p ) => p.clone() );
		this.bulbMat = o.bulbMat;
		this.bulbs = new THREE.InstancedMesh( o.bulbGeo || o.parts.bulb, o.bulbMat, this.bulbLocal.length );
		this.bulbScale = o.bulbScale || 1;
		this.bulbLocal.forEach( ( p, i ) => this.bulbs.setMatrixAt( i, _m.makeScale( this.bulbScale, this.bulbScale, this.bulbScale ).setPosition( p ) ) );
		this.bulbs.frustumCulled = false;
		this.pivot.add( this.bulbs );
		this.alive = this.bulbLocal.map( () => true );
		this.aliveCount = this.bulbLocal.length;
		this.light = o.light;
		this.lightBase = o.light ? o.light.intensity : 0;
		this.lightOffset = o.lightOffset ? o.lightOffset.clone() : new THREE.Vector3( 0, - 1.5, 0 );
		this.swing = o.swing !== false;
		this.len = o.pendulumLength || 1.6;
		this.ax = 0; this.az = 0; this.vx = 0; this.vz = 0;
		this.bulbRadius = o.bulbRadius || 0.09;
		this.bodyRadius = o.bodyRadius || 0.2;
		this.bodyOffset = o.bodyOffset ? o.bodyOffset.clone() : new THREE.Vector3( 0, - 1.5, 0 );
		this.flicker = 0;
		this.surface = SURF.glass;
		this.glassTint = o.glassTint || 0xfff3d6;
		this.hitWhenBroken = true;
		this.dead = false;
		this.root.updateMatrixWorld( true );
		this.boundCenter = new THREE.Vector3();
		this.boundRadius = 0;
		this.computeBounds();
		W.addBreakable( this );

	}

	computeBounds() {

		const box = new THREE.Box3();
		for ( const p of this.bulbLocal ) box.expandByPoint( p );
		box.expandByPoint( this.bodyOffset );
		box.getCenter( this.boundCenter );
		this.boundRadius = box.getSize( _v ).length() / 2 + 0.3;

	}

	intersect( ray ) {

		this.pivot.updateWorldMatrix( true, false );
		const mw = this.pivot.matrixWorld;
		_w.copy( this.boundCenter ).applyMatrix4( mw );
		if ( ray.distanceSqToPoint( _w ) > this.boundRadius * this.boundRadius ) return null;
		let best = null;
		this.hitIndex = - 1;
		for ( let i = 0; i < this.bulbLocal.length; i ++ ) {

			_v.copy( this.bulbLocal[ i ] ).applyMatrix4( mw );
			const t = _v.clone().sub( ray.origin ).dot( ray.direction );
			if ( t < 0 ) continue;
			const r = this.alive[ i ] ? this.bulbRadius : this.bulbRadius * 0.4;
			if ( ray.distanceSqToPoint( _v ) < r * r && ( best === null || t < best ) ) { best = t; this.hitIndex = i; }

		}

		_v.copy( this.bodyOffset ).applyMatrix4( mw );
		const tb = _v.clone().sub( ray.origin ).dot( ray.direction );
		if ( tb > 0 && ray.distanceSqToPoint( _v ) < this.bodyRadius * this.bodyRadius && ( best === null || tb < best ) ) { best = tb; this.hitIndex = - 2; }
		return best;

	}

	/** Called by the weapon system when a bullet hits this cluster. */
	hit( point, dir, damage ) {

		// swing
		if ( this.swing ) {

			const k = Math.min( 1.2, damage / 60 );
			this.vx += dir.z * k * 1.4;
			this.vz -= dir.x * k * 1.4;

		}

		// shatter bulbs near the impact
		this.pivot.updateWorldMatrix( true, false );
		const mw = this.pivot.matrixWorld;
		let broke = 0;
		for ( let i = 0; i < this.bulbLocal.length; i ++ ) {

			if ( ! this.alive[ i ] ) continue;
			_v.copy( this.bulbLocal[ i ] ).applyMatrix4( mw );
			const d = _v.distanceTo( point );
			if ( i === this.hitIndex || d < 0.22 + damage * 0.002 ) {

				this.breakBulb( i, _v.clone(), dir );
				broke ++;

			}

		}

		if ( this.hitIndex === - 2 || broke === 0 ) {

			ctx.fx?.sparks( point, dir.clone().negate(), 8 );
			ctx.audio?.play( 'ricochet', { pos: point, vol: 0.6 } );

		}

		return broke;

	}

	breakBulb( i, worldPos, dir ) {

		this.alive[ i ] = false;
		this.aliveCount --;
		this.bulbs.setMatrixAt( i, _zero );
		this.bulbs.instanceMatrix.needsUpdate = true;
		ctx.fx?.glassBurst( worldPos, dir, 14, this.glassTint );
		ctx.fx?.sparks( worldPos, dir.clone().negate(), 6 );
		ctx.audio?.play( 'glass_small', { pos: worldPos, vol: 0.9 } );
		this.flicker = 0.6;
		if ( this.aliveCount <= 0 && ! this.dead ) {

			this.dead = true;
			ctx.audio?.play( 'glass', { pos: worldPos, vol: 1 } );
			ctx.audio?.play( 'zap', { pos: worldPos, vol: 0.8 } );
			ctx.fx?.sparks( worldPos, new THREE.Vector3( 0, - 1, 0 ), 30 );
			this.bulbMat.userData.intensity && ( this.bulbMat.userData.intensity.value = 0 );
			ctx.game?.onLampDestroyed?.( this );

		}

	}

	update( dt ) {

		if ( this.swing && ( Math.abs( this.vx ) + Math.abs( this.vz ) + Math.abs( this.ax ) + Math.abs( this.az ) > 1e-4 ) ) {

			const w2 = 9.81 / this.len;
			this.vx += ( - w2 * this.ax - 0.35 * this.vx ) * dt;
			this.vz += ( - w2 * this.az - 0.35 * this.vz ) * dt;
			this.ax += this.vx * dt;
			this.az += this.vz * dt;
			this.pivot.rotation.set( this.ax, 0, this.az );

		}

		if ( this.light ) {

			const frac = this.aliveCount / this.bulbLocal.length;
			let k = frac;
			if ( this.flicker > 0 ) {

				this.flicker -= dt;
				k *= Math.random() < 0.5 ? 0.15 : 1.1;

			}

			this.light.intensity = this.lightBase * k;
			if ( this.bulbMat.userData.intensity && ! this.dead ) this.bulbMat.userData.intensity.value = this.flicker > 0 ? k / Math.max( frac, 0.01 ) : 1;
			if ( this.swing ) {

				_v.copy( this.lightOffset ).applyMatrix4( this.pivot.matrixWorld );
				this.light.position.copy( _v );

			}

		}

	}

}

// ------------------------------------------------------------------ stained glass panel

export class GlassPanel {

	constructor( W, { geo, mat, position, normal, width, height, light = null, lightShare = 1, backMat } ) {

		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.position.copy( position );
		this.mesh.lookAt( position.clone().add( normal ) );
		W.group.add( this.mesh );
		this.mat = mat;
		this.normal = normal.clone();
		this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint( normal, position );
		this.center = position.clone();
		this.w = width; this.h = height;
		this.light = light;
		this.lightShare = lightShare;
		this.surface = SURF.glass;
		this.backMat = backMat;
		W.addBreakable( this );

	}

	intersect( ray ) {

		const t = ray.intersectPlane( this.plane, _v ) ? _v.distanceTo( ray.origin ) : null;
		if ( t === null ) return null;
		const local = this.mesh.worldToLocal( _w.copy( _v ) );
		if ( Math.abs( local.x ) > this.w / 2 || Math.abs( local.y ) > this.h / 2 ) return null;
		return t;

	}

	normalAt( p, out ) { out.copy( this.normal ); }

	hit( point, dir ) {

		if ( this.broken ) {

			ctx.fx?.dust( point, this.normal, 0x444444 );
			return 0;

		}

		this.broken = true;
		this.hitWhenBroken = true;
		this.mesh.material = this.backMat;
		ctx.fx?.glassBurst( point, dir, 40, 0xffcc88, true );
		for ( let i = 0; i < 6; i ++ ) {

			const p = this.center.clone().add( new THREE.Vector3( ( Math.random() - 0.5 ) * this.w, ( Math.random() - 0.5 ) * this.h, 0 ).applyQuaternion( this.mesh.quaternion ) );
			ctx.fx?.glassBurst( p, this.normal, 10, [ 0xd11f2e, 0xf2a51a, 0x2b8f4c, 0x1c56b8 ][ i % 4 ], true );

		}

		ctx.audio?.play( 'glass', { pos: point, vol: 1.0 } );
		if ( this.light ) this.light.intensity = Math.max( 0, this.light.intensity - this.light.userData.base * this.lightShare );
		ctx.game?.onLampDestroyed?.( this );
		return 1;

	}

}

// ------------------------------------------------------------------ wooden bench

let benchGeo = null;

export class Bench {

	constructor( W, { x, z, rotY = 0, woodMat, frameMat } ) {

		if ( ! benchGeo ) {

			const wood = [], frame = [];
			for ( let i = 0; i < 5; i ++ ) wood.push( G.box( 2.4, 0.04, 0.085, { y: 0.46, z: - 0.2 + i * 0.1 } ) );
			for ( let i = 0; i < 3; i ++ ) wood.push( G.box( 2.4, 0.085, 0.035, { y: 0.62 + i * 0.12, z: 0.3, rx: - 0.18 } ) );
			for ( const sx of [ - 1.05, 1.05 ] ) {

				frame.push( G.box( 0.1, 0.44, 0.52, { x: sx, y: 0.22 } ) );
				frame.push( G.box( 0.08, 0.5, 0.08, { x: sx, y: 0.7, z: 0.32, rx: - 0.18 } ) );
				frame.push( G.box( 0.12, 0.06, 0.62, { x: sx, y: 0.47 } ) );

			}

			benchGeo = { wood: G.merge( wood ), frame: G.merge( frame ) };

		}

		this.W = W;
		this.group = new THREE.Group();
		this.group.position.set( x, 0, z );
		this.group.rotation.y = rotY;
		this.group.add( new THREE.Mesh( benchGeo.wood, woodMat ) );
		this.group.add( new THREE.Mesh( benchGeo.frame, frameMat ) );
		W.group.add( this.group );
		const c = Math.abs( Math.cos( rotY ) ), s = Math.abs( Math.sin( rotY ) );
		const hx = 1.25 * c + 0.4 * s, hz = 1.25 * s + 0.4 * c;
		this.box = new THREE.Box3( new THREE.Vector3( x - hx, 0, z - hz ), new THREE.Vector3( x + hx, 0.95, z + hz ) );
		this.collider = W.colliders.addBox( x - hx, x + hx, z - hz, z + hz, 'bench' );
		this.collider.low = true;
		this.hp = 110;
		this.surface = SURF.wood;
		this.woodMat = woodMat;

	}

	intersect( ray ) {

		const p = ray.intersectBox( this.box, _v );
		return p ? p.distanceTo( ray.origin ) : null;

	}

	hit( point, dir, damage ) {

		ctx.fx?.debris( point, dir.clone().negate(), 'wood', 4 );
		ctx.audio?.play( 'wood_hit', { pos: point, vol: 0.8 } );
		this.hp -= damage;
		if ( this.hp <= 0 && ! this.broken ) {

			this.broken = true;
			this.group.visible = false;
			this.collider.enabled = false;
			const c = this.box.getCenter( new THREE.Vector3() );
			ctx.fx?.planks( c, dir, this.woodMat, 7 );
			ctx.fx?.debris( c, new THREE.Vector3( 0, 1, 0 ), 'wood', 20 );
			ctx.audio?.play( 'wood_break', { pos: c, vol: 1 } );
			this.W.rebuildNavAround( c.x, c.z, 2.5 );

		}

		return 1;

	}

}

export function registerBench( W, opts ) {

	const b = new Bench( W, opts );
	W.addBreakable( b );
	b.hitWhenBroken = false;
	return b;

}

export { M };
