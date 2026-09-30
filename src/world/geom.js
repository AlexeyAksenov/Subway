// Geometry helpers for procedural architecture.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();

/** Normalise attributes (position/normal/uv, non-indexed) so that geometries can be merged. */
export function prep( g ) {

	let geo = g.index ? g.toNonIndexed() : g;
	if ( ! geo.attributes.normal ) geo.computeVertexNormals();
	if ( ! geo.attributes.uv ) {

		const n = geo.attributes.position.count;
		geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( n * 2 ), 2 ) );

	}

	for ( const k of Object.keys( geo.attributes ) ) if ( k !== 'position' && k !== 'normal' && k !== 'uv' ) geo.deleteAttribute( k );
	geo.morphAttributes = {};
	geo.clearGroups();
	return geo;

}

export function merge( list ) {

	if ( list.length === 0 ) return new THREE.BufferGeometry();
	const g = mergeGeometries( list.map( prep ), false );
	g.computeBoundingSphere();
	g.computeBoundingBox();
	return g;

}

/** Clone a geometry and bake a transform. */
export function place( geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {} ) {

	const g = geo.clone();
	_m.compose( new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz ) ), new THREE.Vector3( sx, sy, sz ) );
	g.applyMatrix4( _m );
	return g;

}

export function box( w, h, d, opts ) { return place( new THREE.BoxGeometry( w, h, d ), opts ); }
export function cyl( rt, rb, h, seg = 16, opts, open = false ) { return place( new THREE.CylinderGeometry( rt, rb, h, seg, 1, open ), opts ); }

/** Lathe from [[r,y],...]. `seg=8` gives an octagonal section aligned with the axes. */
export function lathe( profile, seg = 24, opts ) {

	const pts = profile.map( ( [ r, y ] ) => new THREE.Vector2( Math.max( 0.0001, r ), y ) );
	const g = new THREE.LatheGeometry( pts, seg, seg === 8 ? Math.PI / 8 : 0 );
	return place( g, opts );

}

/**
 * Sweep a 2D profile [[z,y],...] along the X axis from x0 to x1 (ruled surface).
 * Produces an open strip; use DoubleSide materials.
 */
export function sweepX( profile, x0, x1, segX = 1, { uvScale = 1 } = {} ) {

	const n = profile.length;
	const pos = [];
	const uvs = [];
	const idx = [];
	let acc = [ 0 ];
	for ( let i = 1; i < n; i ++ ) acc.push( acc[ i - 1 ] + Math.hypot( profile[ i ][ 0 ] - profile[ i - 1 ][ 0 ], profile[ i ][ 1 ] - profile[ i - 1 ][ 1 ] ) );
	for ( let s = 0; s <= segX; s ++ ) {

		const x = x0 + ( x1 - x0 ) * s / segX;
		for ( let i = 0; i < n; i ++ ) {

			pos.push( x, profile[ i ][ 1 ], profile[ i ][ 0 ] );
			uvs.push( x * uvScale, acc[ i ] * uvScale );

		}

	}

	for ( let s = 0; s < segX; s ++ ) for ( let i = 0; i < n - 1; i ++ ) {

		const a = s * n + i, b = a + 1, c = a + n, d = c + 1;
		idx.push( a, c, b, b, c, d );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	return g;

}

/** Extrude a closed 2D shape defined in (z,y) along X (solid moulding). */
export function extrudeX( shape, x0, x1, bevel = 0 ) {

	const g = new THREE.ExtrudeGeometry( shape, { depth: x1 - x0, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 } );
	// shape.x -> -z after rotation, so callers define shapes with x = -z
	g.rotateY( Math.PI / 2 );
	g.translate( x0, 0, 0 );
	return g;

}

/** Extrude a shape defined in (x,y) along Z by depth, centred on z. */
export function extrudeZ( shape, depth, { bevel = 0, bevelSeg = 2, curveSegments = 12, z = 0 } = {} ) {

	const g = new THREE.ExtrudeGeometry( shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: bevelSeg, steps: 1, curveSegments } );
	g.translate( 0, 0, z - depth / 2 );
	return g;

}

/** Sweep a small closed 2D profile along a 3D curve (mouldings around arches, frames). */
export function sweepAlong( profileShape, curve, steps = 48 ) {

	return new THREE.ExtrudeGeometry( profileShape, { steps, bevelEnabled: false, extrudePath: curve } );

}

export function rectShape( w, h, cx = 0, cy = 0 ) {

	const s = new THREE.Shape();
	s.moveTo( cx - w / 2, cy - h / 2 );
	s.lineTo( cx + w / 2, cy - h / 2 );
	s.lineTo( cx + w / 2, cy + h / 2 );
	s.lineTo( cx - w / 2, cy + h / 2 );
	s.closePath();
	return s;

}

export function roundRectShape( w, h, r, cx = 0, cy = 0 ) {

	const s = new THREE.Shape();
	const x = cx - w / 2, y = cy - h / 2;
	s.moveTo( x + r, y );
	s.lineTo( x + w - r, y );
	s.quadraticCurveTo( x + w, y, x + w, y + r );
	s.lineTo( x + w, y + h - r );
	s.quadraticCurveTo( x + w, y + h, x + w - r, y + h );
	s.lineTo( x + r, y + h );
	s.quadraticCurveTo( x, y + h, x, y + h - r );
	s.lineTo( x, y + r );
	s.quadraticCurveTo( x, y, x + r, y );
	return s;

}

export function roundRectPath( w, h, r, cx = 0, cy = 0 ) {

	const p = new THREE.Path();
	const x = cx - w / 2, y = cy - h / 2;
	p.moveTo( x + r, y );
	p.lineTo( x + w - r, y );
	p.quadraticCurveTo( x + w, y, x + w, y + r );
	p.lineTo( x + w, y + h - r );
	p.quadraticCurveTo( x + w, y + h, x + w - r, y + h );
	p.lineTo( x + r, y + h );
	p.quadraticCurveTo( x, y + h, x, y + h - r );
	p.lineTo( x, y + r );
	p.quadraticCurveTo( x, y, x + r, y );
	return p;

}

/** Arch opening path (rectangle with semicircular or elliptical top), bottom at y0. */
export function archPath( cx, y0, w, springH, riseH = w / 2, seg = 24, shape = false ) {

	const p = shape ? new THREE.Shape() : new THREE.Path();
	const hw = w / 2;
	p.moveTo( cx - hw, y0 );
	p.lineTo( cx + hw, y0 );
	p.lineTo( cx + hw, y0 + springH );
	for ( let i = 1; i <= seg; i ++ ) {

		const a = Math.PI * i / seg;
		p.lineTo( cx + Math.cos( a ) * hw, y0 + springH + Math.sin( a ) * riseH );

	}

	p.lineTo( cx - hw, y0 );
	return p;

}

/** Points along an ellipse arc in the (z,y) plane: centre (cz,cy), radii (rz,ry), angles a0→a1. */
export function ellipseArc( cz, cy, rz, ry, a0, a1, n ) {

	const pts = [];
	for ( let i = 0; i <= n; i ++ ) {

		const a = a0 + ( a1 - a0 ) * i / n;
		pts.push( [ cz + Math.cos( a ) * rz, cy + Math.sin( a ) * ry ] );

	}

	return pts;

}

/** Moulding profile shape helper: list of [u,v] points closed. */
export function polyShape( pts ) {

	const s = new THREE.Shape();
	s.moveTo( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
	for ( let i = 1; i < pts.length; i ++ ) s.lineTo( pts[ i ][ 0 ], pts[ i ][ 1 ] );
	s.closePath();
	return s;

}

/** Instanced mesh from a geometry + list of matrices. */
export function instanced( geo, mat, matrices ) {

	const im = new THREE.InstancedMesh( geo, mat, matrices.length );
	matrices.forEach( ( m, i ) => im.setMatrixAt( i, m ) );
	im.instanceMatrix.needsUpdate = true;
	im.computeBoundingSphere();
	return im;

}

export function mat4( x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 ) {

	const sv = typeof s === 'number' ? new THREE.Vector3( s, s, s ) : s;
	return new THREE.Matrix4().compose( new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz ) ), sv );

}

/**
 * Loft a closed 2D profile [[a,b],...] along a path in the YZ plane given as [[z,y],...].
 * `a` runs along X (centred on x0), `b` is the offset along the path's inward normal
 * (towards `inside` point [z,y]). Used for vault ribs and arch mouldings.
 */
export function ribAlong( path, profile, x0, inside = [ 0, 0 ] ) {

	const n = path.length, m = profile.length;
	const pos = [];
	const idx = [];
	for ( let i = 0; i < n; i ++ ) {

		const p = path[ i ];
		const a = path[ Math.max( 0, i - 1 ) ], b = path[ Math.min( n - 1, i + 1 ) ];
		let tz = b[ 0 ] - a[ 0 ], ty = b[ 1 ] - a[ 1 ];
		const tl = Math.hypot( tz, ty ) || 1;
		tz /= tl; ty /= tl;
		let nz = - ty, ny = tz;
		if ( ( inside[ 0 ] - p[ 0 ] ) * nz + ( inside[ 1 ] - p[ 1 ] ) * ny < 0 ) { nz = - nz; ny = - ny; }
		for ( let j = 0; j < m; j ++ ) {

			const [ pa, pb ] = profile[ j ];
			pos.push( x0 + pa, p[ 1 ] + ny * pb, p[ 0 ] + nz * pb );

		}

	}

	for ( let i = 0; i < n - 1; i ++ ) for ( let j = 0; j < m; j ++ ) {

		const j2 = ( j + 1 ) % m;
		const A = i * m + j, B = i * m + j2, Cc = ( i + 1 ) * m + j, D = ( i + 1 ) * m + j2;
		idx.push( A, Cc, B, B, Cc, D );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	return g;

}

/** Curved surface patch on an ellipse vault: x in [x0,x1], angle in [a0,a1]. UV 0..1. */
export function vaultPatch( cz, cy, rz, ry, a0, a1, x0, x1, inset = 0.02, nx = 6, na = 12 ) {

	const pos = [], uvs = [], idx = [];
	for ( let j = 0; j <= na; j ++ ) {

		const a = a0 + ( a1 - a0 ) * j / na;
		const z = cz + Math.cos( a ) * ( rz - inset ), y = cy + Math.sin( a ) * ( ry - inset );
		for ( let i = 0; i <= nx; i ++ ) {

			const x = x0 + ( x1 - x0 ) * i / nx;
			pos.push( x, y, z );
			uvs.push( i / nx, j / na );

		}

	}

	for ( let j = 0; j < na; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		const a = j * ( nx + 1 ) + i, b = a + 1, c = a + nx + 1, d = c + 1;
		idx.push( a, b, c, b, d, c );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	return g;

}
