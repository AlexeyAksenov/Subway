// 2D (XZ) collision primitives, a navigation grid with A* path-finding and line-of-sight helpers.

export class Colliders2D {

	constructor() {

		this.circles = []; // {x,z,r,enabled,tag}
		this.boxes = []; // {minX,maxX,minZ,maxZ,enabled,tag}
		this.dynamic = []; // providers: () => [{box}] (train etc.)

	}

	addCircle( x, z, r, tag = null ) {

		const c = { x, z, r, enabled: true, tag };
		this.circles.push( c );
		return c;

	}

	addBox( minX, maxX, minZ, maxZ, tag = null ) {

		const b = { minX: Math.min( minX, maxX ), maxX: Math.max( minX, maxX ), minZ: Math.min( minZ, maxZ ), maxZ: Math.max( minZ, maxZ ), enabled: true, tag };
		this.boxes.push( b );
		return b;

	}

	/** Push a circle (px,pz,r) out of all colliders. Returns corrected {x,z}. */
	resolve( px, pz, r, includeDynamic = true, out = { x: 0, z: 0, hit: false } ) {

		let x = px, z = pz, hit = false;
		for ( let iter = 0; iter < 3; iter ++ ) {

			for ( const c of this.circles ) {

				if ( ! c.enabled ) continue;
				const dx = x - c.x, dz = z - c.z;
				const rr = r + c.r;
				const d2 = dx * dx + dz * dz;
				if ( d2 < rr * rr ) {

					const d = Math.sqrt( d2 ) || 0.0001;
					x = c.x + dx / d * rr;
					z = c.z + dz / d * rr;
					hit = true;

				}

			}

			const boxLists = includeDynamic ? [ this.boxes, ...this.dynamic.map( ( f ) => f() ) ] : [ this.boxes ];
			for ( const list of boxLists ) for ( const b of list ) {

				if ( ! b.enabled ) continue;
				const cx = Math.max( b.minX, Math.min( x, b.maxX ) );
				const cz = Math.max( b.minZ, Math.min( z, b.maxZ ) );
				const dx = x - cx, dz = z - cz;
				const d2 = dx * dx + dz * dz;
				if ( d2 < r * r ) {

					hit = true;
					if ( d2 > 1e-8 ) {

						const d = Math.sqrt( d2 );
						x = cx + dx / d * r;
						z = cz + dz / d * r;

					} else {

						// centre inside the box: push out along the shallowest axis
						const l = x - b.minX, rr = b.maxX - x, t = z - b.minZ, bb = b.maxZ - z;
						const m = Math.min( l, rr, t, bb );
						if ( m === l ) x = b.minX - r; else if ( m === rr ) x = b.maxX + r; else if ( m === t ) z = b.minZ - r; else z = b.maxZ + r;

					}

				}

			}

		}

		out.x = x; out.z = z; out.hit = hit;
		return out;

	}

	/** Segment vs colliders in 2D (used for cheap AI visibility pre-checks). */
	segmentBlocked( x0, z0, x1, z1, pad = 0 ) {

		const dx = x1 - x0, dz = z1 - z0;
		const len2 = dx * dx + dz * dz || 1e-6;
		for ( const c of this.circles ) {

			if ( ! c.enabled || c.r < 0.25 ) continue;
			let t = ( ( c.x - x0 ) * dx + ( c.z - z0 ) * dz ) / len2;
			t = Math.max( 0, Math.min( 1, t ) );
			const px = x0 + dx * t - c.x, pz = z0 + dz * t - c.z;
			if ( px * px + pz * pz < ( c.r + pad ) * ( c.r + pad ) ) return true;

		}

		for ( const b of this.boxes ) {

			if ( ! b.enabled || b.low ) continue;
			if ( segBox( x0, z0, x1, z1, b.minX - pad, b.maxX + pad, b.minZ - pad, b.maxZ + pad ) ) return true;

		}

		return false;

	}

}

function segBox( x0, z0, x1, z1, minX, maxX, minZ, maxZ ) {

	let tmin = 0, tmax = 1;
	const dx = x1 - x0, dz = z1 - z0;
	if ( Math.abs( dx ) < 1e-9 ) {

		if ( x0 < minX || x0 > maxX ) return false;

	} else {

		let t1 = ( minX - x0 ) / dx, t2 = ( maxX - x0 ) / dx;
		if ( t1 > t2 ) [ t1, t2 ] = [ t2, t1 ];
		tmin = Math.max( tmin, t1 ); tmax = Math.min( tmax, t2 );
		if ( tmin > tmax ) return false;

	}

	if ( Math.abs( dz ) < 1e-9 ) {

		if ( z0 < minZ || z0 > maxZ ) return false;

	} else {

		let t1 = ( minZ - z0 ) / dz, t2 = ( maxZ - z0 ) / dz;
		if ( t1 > t2 ) [ t1, t2 ] = [ t2, t1 ];
		tmin = Math.max( tmin, t1 ); tmax = Math.min( tmax, t2 );
		if ( tmin > tmax ) return false;

	}

	return true;

}

// ------------------------------------------------------------------ navigation grid

class MinHeap {

	constructor() { this.a = []; this.p = []; }
	push( v, pr ) {

		const a = this.a, p = this.p;
		a.push( v ); p.push( pr );
		let i = a.length - 1;
		while ( i > 0 ) {

			const j = ( i - 1 ) >> 1;
			if ( p[ j ] <= pr ) break;
			a[ i ] = a[ j ]; p[ i ] = p[ j ];
			i = j;

		}

		a[ i ] = v; p[ i ] = pr;

	}

	pop() {

		const a = this.a, p = this.p;
		const top = a[ 0 ];
		const lv = a.pop(), lp = p.pop();
		if ( a.length ) {

			let i = 0;
			const n = a.length;
			for ( ;; ) {

				let l = 2 * i + 1, r = l + 1, m = i;
				let mp = lp;
				if ( l < n && p[ l ] < mp ) { m = l; mp = p[ l ]; }
				if ( r < n && p[ r ] < mp ) { m = r; mp = p[ r ]; }
				if ( m === i ) break;
				a[ i ] = a[ m ]; p[ i ] = p[ m ];
				i = m;

			}

			a[ i ] = lv; p[ i ] = lp;

		}

		return top;

	}

	get size() { return this.a.length; }

}

export class NavGrid {

	constructor( minX, maxX, minZ, maxZ, cell = 0.5 ) {

		this.minX = minX; this.minZ = minZ; this.cell = cell;
		this.w = Math.ceil( ( maxX - minX ) / cell );
		this.h = Math.ceil( ( maxZ - minZ ) / cell );
		this.blocked = new Uint8Array( this.w * this.h );
		this.g = new Float32Array( this.w * this.h );
		this.from = new Int32Array( this.w * this.h );
		this.stamp = new Uint32Array( this.w * this.h );
		this.closed = new Uint32Array( this.w * this.h );
		this.gen = 1;

	}

	idx( x, z ) {

		const i = Math.floor( ( x - this.minX ) / this.cell ), j = Math.floor( ( z - this.minZ ) / this.cell );
		if ( i < 0 || j < 0 || i >= this.w || j >= this.h ) return - 1;
		return j * this.w + i;

	}

	centre( k, out = { x: 0, z: 0 } ) {

		out.x = this.minX + ( ( k % this.w ) + 0.5 ) * this.cell;
		out.z = this.minZ + ( Math.floor( k / this.w ) + 0.5 ) * this.cell;
		return out;

	}

	/** Rasterise walkable regions and colliders. walkable(x,z) → bool */
	build( walkable, colliders, agentR = 0.4 ) {

		const p = { x: 0, z: 0 };
		for ( let k = 0; k < this.blocked.length; k ++ ) {

			this.centre( k, p );
			let b = walkable( p.x, p.z ) ? 0 : 1;
			if ( ! b ) {

				const r = colliders.resolve( p.x, p.z, agentR, false );
				if ( r.hit ) b = 1;

			}

			this.blocked[ k ] = b;

		}

	}

	isFree( x, z ) {

		const k = this.idx( x, z );
		return k >= 0 && ! this.blocked[ k ];

	}

	nearestFree( x, z, maxR = 6 ) {

		const k0 = this.idx( x, z );
		if ( k0 >= 0 && ! this.blocked[ k0 ] ) return { x, z };
		const i0 = Math.floor( ( x - this.minX ) / this.cell ), j0 = Math.floor( ( z - this.minZ ) / this.cell );
		const R = Math.ceil( maxR / this.cell );
		for ( let r = 1; r <= R; r ++ ) {

			for ( let dj = - r; dj <= r; dj ++ ) for ( let di = - r; di <= r; di ++ ) {

				if ( Math.abs( di ) !== r && Math.abs( dj ) !== r ) continue;
				const i = i0 + di, j = j0 + dj;
				if ( i < 0 || j < 0 || i >= this.w || j >= this.h ) continue;
				const k = j * this.w + i;
				if ( ! this.blocked[ k ] ) return this.centre( k );

			}

		}

		return null;

	}

	/** Straight walk check across the grid (Bresenham-ish sampling). */
	walkLine( x0, z0, x1, z1 ) {

		const d = Math.hypot( x1 - x0, z1 - z0 );
		const n = Math.ceil( d / ( this.cell * 0.5 ) );
		for ( let s = 0; s <= n; s ++ ) {

			const t = s / Math.max( 1, n );
			if ( ! this.isFree( x0 + ( x1 - x0 ) * t, z0 + ( z1 - z0 ) * t ) ) return false;

		}

		return true;

	}

	findPath( sx, sz, tx, tz, maxNodes = 6000 ) {

		const s = this.nearestFree( sx, sz, 3 );
		const t = this.nearestFree( tx, tz, 6 );
		if ( ! s || ! t ) return null;
		const start = this.idx( s.x, s.z ), goal = this.idx( t.x, t.z );
		if ( start < 0 || goal < 0 ) return null;
		const gen = ++ this.gen;
		const W = this.w;
		const gx = goal % W, gz = Math.floor( goal / W );
		const heap = new MinHeap();
		this.g[ start ] = 0; this.stamp[ start ] = gen; this.from[ start ] = - 1;
		heap.push( start, 0 );
		let found = false, expanded = 0;
		const D = [ [ 1, 0, 1 ], [ - 1, 0, 1 ], [ 0, 1, 1 ], [ 0, - 1, 1 ], [ 1, 1, 1.4142 ], [ 1, - 1, 1.4142 ], [ - 1, 1, 1.4142 ], [ - 1, - 1, 1.4142 ] ];
		while ( heap.size ) {

			const k = heap.pop();
			if ( this.closed[ k ] === gen ) continue;
			this.closed[ k ] = gen;
			if ( k === goal ) { found = true; break; }
			if ( ++ expanded > maxNodes ) break;
			const ki = k % W, kj = Math.floor( k / W );
			for ( const [ di, dj, c ] of D ) {

				const i = ki + di, j = kj + dj;
				if ( i < 0 || j < 0 || i >= W || j >= this.h ) continue;
				const n = j * W + i;
				if ( this.blocked[ n ] || this.closed[ n ] === gen ) continue;
				if ( di && dj && ( this.blocked[ kj * W + i ] || this.blocked[ j * W + ki ] ) ) continue;
				const ng = this.g[ k ] + c;
				if ( this.stamp[ n ] !== gen || ng < this.g[ n ] ) {

					this.stamp[ n ] = gen;
					this.g[ n ] = ng;
					this.from[ n ] = k;
					const hx = Math.abs( i - gx ), hz = Math.abs( j - gz );
					heap.push( n, ng + ( hx + hz ) + ( 1.4142 - 2 ) * Math.min( hx, hz ) );

				}

			}

		}

		if ( ! found ) return null;
		const cells = [];
		for ( let k = goal; k !== - 1; k = this.from[ k ] ) cells.push( k );
		cells.reverse();
		// string pulling
		const pts = cells.map( ( k ) => this.centre( k ) );
		const out = [ pts[ 0 ] ];
		let anchor = 0;
		for ( let i = 2; i < pts.length; i ++ ) {

			if ( ! this.walkLine( pts[ anchor ].x, pts[ anchor ].z, pts[ i ].x, pts[ i ].z ) ) {

				out.push( pts[ i - 1 ] );
				anchor = i - 1;

			}

		}

		out.push( { x: t.x, z: t.z } );
		return out;

	}

}
