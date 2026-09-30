// A station "world": visual meshes, merged BVH for precise bullet ray casts, 2D colliders,
// navigation grid, pooled lights, breakables and spawn points.
import * as THREE from 'three/webgpu';
import { MeshBVH } from 'three-mesh-bvh';
import { Colliders2D, NavGrid } from './collision.js';
import { HALF_L, PLAT_EDGE, CORRIDOR_LEN, CORRIDOR_HALF } from './layout.js';

export const SURF = { stone: 0, metal: 1, wood: 2, glass: 3, plaster: 4, concrete: 5, flesh: 6, fabric: 7 };

const _ray = new THREE.Ray();
const _v = new THREE.Vector3();

/** Fixed set of point lights: the light count never changes, so shaders never recompile. */
export class LightPool {

	constructor( scene, n = 26 ) {

		this.lights = [];
		for ( let i = 0; i < n; i ++ ) {

			const l = new THREE.PointLight( 0xffffff, 0, 20, 2 );
			l.userData.base = 0;
			scene.add( l );
			this.lights.push( l );

		}

		this.used = 0;

	}

	take( x, y, z, color, intensity, distance ) {

		if ( this.used >= this.lights.length ) return null;
		const l = this.lights[ this.used ++ ];
		l.position.set( x, y, z );
		l.color.set( color );
		l.intensity = intensity;
		l.distance = distance;
		l.userData.base = intensity;
		l.userData.flicker = 0;
		return l;

	}

	reset() {

		for ( const l of this.lights ) { l.intensity = 0; l.userData.base = 0; }
		this.used = 0;

	}

}

export class StationWorld {

	constructor( lightPool, info ) {

		this.info = info;
		this.group = new THREE.Group();
		this.group.name = 'station-' + info.id;
		this.lightPool = lightPool;
		this.colliders = new Colliders2D();
		this.colPos = [];      // Float32Array chunks of world-space triangle soup
		this.colSurf = [];     // matching per-vertex surface ids
		this.breakables = [];
		this.animated = [];    // objects with update(dt)
		this.spawns = [];      // {x,z,dir}
		this.lamps = [];
		this.bvh = null;

	}

	// ---------------------------------------------------------------- building

	addMesh( geo, mat, { collide = true, surface = SURF.stone, parent = this.group, name } = {} ) {

		const mesh = new THREE.Mesh( geo, mat );
		if ( name ) mesh.name = name;
		mesh.matrixAutoUpdate = false;
		mesh.updateMatrix();
		parent.add( mesh );
		if ( collide ) {

			const m = mesh.matrix.clone();
			if ( parent !== this.group ) {

				parent.updateMatrixWorld( true );
				m.premultiply( parent.matrixWorld );

			}

			this.addCollisionGeometry( geo, m, surface );

		}

		return mesh;

	}

	addInstanced( geo, mat, matrices, { collide = true, surface = SURF.stone } = {} ) {

		const im = new THREE.InstancedMesh( geo, mat, matrices.length );
		matrices.forEach( ( m, i ) => im.setMatrixAt( i, m ) );
		im.instanceMatrix.needsUpdate = true;
		im.computeBoundingSphere();
		im.frustumCulled = false;
		this.group.add( im );
		if ( collide ) for ( const m of matrices ) this.addCollisionGeometry( geo, m, surface );
		return im;

	}

	addCollisionGeometry( geo, matrix, surface ) {

		const g = geo.index ? geo.toNonIndexed() : geo;
		const src = g.attributes.position;
		const arr = new Float32Array( src.count * 3 );
		for ( let i = 0; i < src.count; i ++ ) {

			_v.fromBufferAttribute( src, i );
			if ( matrix ) _v.applyMatrix4( matrix );
			arr[ i * 3 ] = _v.x; arr[ i * 3 + 1 ] = _v.y; arr[ i * 3 + 2 ] = _v.z;

		}

		this.colPos.push( arr );
		const s = new Uint8Array( src.count );
		s.fill( surface );
		this.colSurf.push( s );

	}

	/**
	 * Request a light. Neighbouring fixtures along the station share one light so the total
	 * light count stays small (every light costs shader time on every pixel and compile time).
	 */
	light( x, y, z, color, intensity, distance = 18 ) {

		this.taken ||= [];
		for ( const l of this.taken ) {

			const a = l.userData.anchor;
			if ( Math.abs( a.z - z ) < 2 && Math.abs( a.y - y ) < 2.5 && Math.abs( a.x - x ) < 23 ) {

				const n = ++ l.userData.count;
				l.userData.sum.add( new THREE.Vector3( x, y, z ) );
				l.position.copy( l.userData.sum ).divideScalar( n );
				l.userData.base = l.userData.single * Math.sqrt( n ) * 1.15;
				l.intensity = l.userData.base;
				l.distance = distance * ( 1 + 0.35 * ( n - 1 ) );
				return l;

			}

		}

		const l = this.lightPool.take( x, y, z, color, intensity, distance );
		if ( ! l ) return null;
		l.userData.anchor = new THREE.Vector3( x, y, z );
		l.userData.sum = new THREE.Vector3( x, y, z );
		l.userData.count = 1;
		l.userData.single = intensity;
		l.userData.members = [];
		this.taken.push( l );
		return l;

	}

	addBreakable( b ) {

		b.hp = b.hp ?? 1;
		b.broken = false;
		this.breakables.push( b );
		return b;

	}

	// ---------------------------------------------------------------- finalise

	finalize() {

		// procedural architecture is built from open surfaces: render both faces
		this.group.traverse( ( o ) => {

			if ( o.isMesh && ! o.isInstancedMesh && o.material && ! o.material.transparent && o.material.side === THREE.FrontSide ) o.material.side = THREE.DoubleSide;

		} );

		// merge collision triangle soup and build a BVH for fast, exact ray casts
		let total = 0;
		for ( const a of this.colPos ) total += a.length;
		const pos = new Float32Array( total );
		const surf = new Uint8Array( total / 3 );
		let o = 0, so = 0;
		for ( let i = 0; i < this.colPos.length; i ++ ) {

			pos.set( this.colPos[ i ], o ); o += this.colPos[ i ].length;
			surf.set( this.colSurf[ i ], so ); so += this.colSurf[ i ].length;

		}

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
		const idx = new Uint32Array( pos.length / 3 );
		for ( let i = 0; i < idx.length; i ++ ) idx[ i ] = i;
		g.setIndex( new THREE.BufferAttribute( idx, 1 ) );
		this.colGeometry = g;
		this.surfaceByVertex = surf;
		this.bvh = new MeshBVH( g, { maxDepth: 40, targetLeafSize: 8 } );
		this.colPos = this.colSurf = null;
		this.triangleCount = idx.length / 3;

		// navigation
		this.nav = new NavGrid( - HALF_L - CORRIDOR_LEN, HALF_L + CORRIDOR_LEN, - PLAT_EDGE, PLAT_EDGE, 0.5 );
		this.nav.build( ( x, z ) => this.walkable( x, z ), this.colliders, 0.42 );

	}

	walkable( x, z ) {

		if ( Math.abs( z ) > PLAT_EDGE - 0.35 ) return false;
		if ( Math.abs( x ) < HALF_L - 0.4 ) return true;
		// exit corridors behind the hall end walls
		return Math.abs( x ) < HALF_L + CORRIDOR_LEN - 1 && Math.abs( z ) < CORRIDOR_HALF - 0.4;

	}

	rebuildNavAround( x, z, r = 2 ) {

		const nav = this.nav;
		const p = { x: 0, z: 0 };
		for ( let dz = - r; dz <= r; dz += nav.cell ) for ( let dx = - r; dx <= r; dx += nav.cell ) {

			const k = nav.idx( x + dx, z + dz );
			if ( k < 0 ) continue;
			nav.centre( k, p );
			let b = this.walkable( p.x, p.z ) ? 0 : 1;
			if ( ! b && this.colliders.resolve( p.x, p.z, 0.42, false ).hit ) b = 1;
			nav.blocked[ k ] = b;

		}

	}

	// ---------------------------------------------------------------- queries

	/** Exact ray cast against static architecture + breakables. */
	raycast( origin, dir, far = 400, out = {} ) {

		out.distance = Infinity;
		out.breakable = null;
		_ray.origin.copy( origin );
		_ray.direction.copy( dir );
		const hit = this.bvh.raycastFirst( _ray, THREE.DoubleSide, 0, far );
		if ( hit ) {

			out.distance = hit.distance;
			out.point = ( out.point || new THREE.Vector3() ).copy( hit.point );
			out.normal = ( out.normal || new THREE.Vector3() ).copy( hit.face.normal );
			if ( out.normal.dot( dir ) > 0 ) out.normal.negate();
			out.surface = this.surfaceByVertex[ hit.face.a ];

		}

		for ( const b of this.breakables ) {

			if ( b.broken && ! b.hitWhenBroken ) continue;
			const t = b.intersect( _ray );
			if ( t !== null && t < out.distance && t < far ) {

				out.distance = t;
				out.point = ( out.point || new THREE.Vector3() ).copy( dir ).multiplyScalar( t ).add( origin );
				out.normal = ( out.normal || new THREE.Vector3() ).copy( dir ).negate();
				if ( b.normalAt ) b.normalAt( out.point, out.normal );
				out.surface = b.surface ?? SURF.glass;
				out.breakable = b;

			}

		}

		return out.distance < Infinity ? out : null;

	}

	/** Line of sight between two points (static geometry only). */
	visible( a, b ) {

		_v.subVectors( b, a );
		const d = _v.length();
		_ray.origin.copy( a );
		_ray.direction.copy( _v ).divideScalar( d );
		const hit = this.bvh.raycastFirst( _ray, THREE.DoubleSide, 0, d - 0.05 );
		return ! hit;

	}

	update( dt, t ) {

		for ( const a of this.animated ) a.update( dt, t );
		for ( const b of this.breakables ) b.update?.( dt, t );

	}

	dispose() {

		this.group.traverse( ( o ) => {

			if ( o.geometry ) o.geometry.dispose();
			if ( o.material ) ( Array.isArray( o.material ) ? o.material : [ o.material ] ).forEach( ( m ) => m.dispose() );

		} );
		this.group.removeFromParent();
		this.lightPool.reset();
		this.colGeometry?.dispose();

	}

}

