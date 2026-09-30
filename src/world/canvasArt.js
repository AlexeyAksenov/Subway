// Canvas-painted artwork: station name signs, mosaic cartoons, stained glass designs.
import * as THREE from 'three/webgpu';

function rng( seed ) {

	let s = seed >>> 0 || 1;
	return () => {

		s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
		return ( ( s >>> 0 ) % 100000 ) / 100000;

	};

}

function canvas( w, h ) {

	const c = document.createElement( 'canvas' );
	c.width = w; c.height = h;
	return [ c, c.getContext( '2d' ) ];

}

function tex( c, { srgb = true, repeat = false } = {} ) {

	const t = new THREE.CanvasTexture( c );
	if ( srgb ) t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	if ( repeat ) t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.needsUpdate = true;
	return t;

}

/** Text on transparent background (used for metal letters / light boxes). */
export function textTexture( text, { w = 2048, h = 256, font = 'bold 170px "Arial Narrow", Arial, sans-serif', color = '#fff', bg = null, spacing = 18, align = 'center', stroke = null } = {} ) {

	const [ c, g ] = canvas( w, h );
	if ( bg ) { g.fillStyle = bg; g.fillRect( 0, 0, w, h ); }
	g.font = font;
	g.textBaseline = 'middle';
	g.fillStyle = color;
	if ( 'letterSpacing' in g ) g.letterSpacing = spacing + 'px';
	g.textAlign = align;
	const x = align === 'center' ? w / 2 : align === 'left' ? h * 0.3 : w - h * 0.3;
	if ( stroke ) { g.strokeStyle = stroke; g.lineWidth = 6; g.strokeText( text, x, h / 2 + 6 ); }
	g.fillText( text, x, h / 2 + 6 );
	return tex( c );

}

/** Metro sign: white text on dark blue with red М roundel. */
export function signTexture( text, { w = 1024, h = 160, sub = null } = {} ) {

	const [ c, g ] = canvas( w, h );
	const grd = g.createLinearGradient( 0, 0, 0, h );
	grd.addColorStop( 0, '#1d3f8f' ); grd.addColorStop( 1, '#15306d' );
	g.fillStyle = grd; g.fillRect( 0, 0, w, h );
	g.fillStyle = '#d6232a';
	g.beginPath(); g.arc( h * 0.55, h / 2, h * 0.34, 0, Math.PI * 2 ); g.fill();
	g.fillStyle = '#fff'; g.font = `bold ${ h * 0.46 }px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
	g.fillText( 'М', h * 0.55, h / 2 + 3 );
	g.textAlign = 'left';
	g.font = `bold ${ sub ? h * 0.34 : h * 0.42 }px "Arial Narrow", Arial`;
	g.fillText( text, h * 1.1, sub ? h * 0.36 : h / 2 + 3 );
	if ( sub ) { g.font = `${ h * 0.22 }px Arial`; g.fillStyle = '#cfd8ff'; g.fillText( sub, h * 1.1, h * 0.72 ); }
	return tex( c );

}

function star( g, cx, cy, R, r, rot = - Math.PI / 2 ) {

	g.beginPath();
	for ( let i = 0; i < 10; i ++ ) {

		const a = rot + i * Math.PI / 5;
		const rr = i % 2 ? r : R;
		g.lineTo( cx + Math.cos( a ) * rr, cy + Math.sin( a ) * rr );

	}

	g.closePath();

}

/** Komsomolskaya-style mosaic cartouche: star, laurel wreath, banners on gold smalt. */
export function mosaicStarWreath( seed = 1 ) {

	const R = rng( seed * 7919 );
	const [ c, g ] = canvas( 600, 400 );
	g.clearRect( 0, 0, 600, 400 ); // alpha 0 → gold
	const cx = 300, cy = 190;
	// sun rays
	for ( let i = 0; i < 36; i ++ ) {

		const a = i / 36 * Math.PI * 2;
		g.strokeStyle = i % 2 ? 'rgba(255,236,170,1)' : 'rgba(240,200,110,1)';
		g.lineWidth = 7;
		g.beginPath(); g.moveTo( cx + Math.cos( a ) * 60, cy + Math.sin( a ) * 60 ); g.lineTo( cx + Math.cos( a ) * 118, cy + Math.sin( a ) * 118 ); g.stroke();

	}

	// wreath
	for ( const side of [ - 1, 1 ] ) {

		for ( let i = 0; i < 14; i ++ ) {

			const a = Math.PI / 2 + side * ( 0.25 + i * 0.17 );
			const x = cx + Math.cos( a ) * 150, y = cy + 20 + Math.sin( a ) * 140;
			g.save(); g.translate( x, y ); g.rotate( a + side * 0.9 );
			g.fillStyle = i % 2 ? '#2f6b34' : '#3f8a44';
			g.beginPath(); g.ellipse( 0, 0, 26, 10, 0, 0, Math.PI * 2 ); g.fill();
			g.fillStyle = '#23502a'; g.beginPath(); g.ellipse( - 8, 12, 20, 8, 0.6, 0, Math.PI * 2 ); g.fill();
			g.restore();

		}

	}

	// star
	star( g, cx, cy, 78, 32 );
	g.fillStyle = '#b3191e'; g.fill();
	star( g, cx, cy, 60, 24 );
	g.fillStyle = '#e0343a'; g.fill();
	// banners
	const colors = [ '#b3191e', '#e8e0cc', '#1f3f8a' ];
	for ( let i = 0; i < 3; i ++ ) {

		g.fillStyle = colors[ ( i + seed ) % 3 ];
		g.beginPath();
		const y0 = 318 + i * 18;
		g.moveTo( 120, y0 ); g.quadraticCurveTo( 300, y0 - 26, 480, y0 ); g.lineTo( 470, y0 + 16 ); g.quadraticCurveTo( 300, y0 - 10, 130, y0 + 16 ); g.closePath(); g.fill();

	}

	// random floral side ornaments
	for ( let k = 0; k < 10; k ++ ) {

		const x = R() < 0.5 ? 20 + R() * 70 : 510 + R() * 70, y = 40 + R() * 320;
		g.fillStyle = [ '#8e2323', '#e2d6b6', '#355d99', '#6a8f3a' ][ k % 4 ];
		g.beginPath(); g.arc( x, y, 8 + R() * 10, 0, Math.PI * 2 ); g.fill();

	}

	return tex( c );

}

/** Mayakovskaya-style "Soviet sky" dome mosaic. */
export function mosaicSky( seed = 1 ) {

	const R = rng( seed * 104729 );
	const [ c, g ] = canvas( 512, 512 );
	const grd = g.createRadialGradient( 256, 256, 30, 256, 256, 280 );
	grd.addColorStop( 0, '#cfe6ff' ); grd.addColorStop( 0.55, '#5f9fe0' ); grd.addColorStop( 1, '#1e4f9c' );
	g.fillStyle = grd; g.fillRect( 0, 0, 512, 512 );
	// clouds
	for ( let i = 0; i < 16; i ++ ) {

		const x = R() * 512, y = R() * 512, s = 20 + R() * 45;
		g.fillStyle = `rgba(255,255,255,${ 0.55 + R() * 0.4 })`;
		for ( let j = 0; j < 5; j ++ ) { g.beginPath(); g.arc( x + ( R() - 0.5 ) * s * 1.6, y + ( R() - 0.5 ) * s * 0.6, s * ( 0.5 + R() * 0.5 ), 0, Math.PI * 2 ); g.fill(); }

	}

	const type = seed % 4;
	g.save(); g.translate( 256, 256 ); g.rotate( R() * Math.PI * 2 );
	if ( type === 0 || type === 2 ) {

		// planes in formation
		for ( let i = 0; i < 3; i ++ ) {

			g.save(); g.translate( ( i - 1 ) * 70, Math.abs( i - 1 ) * 40 - 20 );
			g.fillStyle = '#39404d';
			g.fillRect( - 6, - 40, 12, 80 ); g.fillRect( - 55, - 12, 110, 14 ); g.fillRect( - 20, 30, 40, 8 );
			g.fillStyle = '#c21f26'; star( g, - 38, - 5, 7, 3 ); g.fill(); star( g, 38, - 5, 7, 3 ); g.fill();
			g.restore();

		}

	} else {

		// parachutes
		for ( let i = 0; i < 4; i ++ ) {

			const x = ( R() - 0.5 ) * 260, y = ( R() - 0.5 ) * 260;
			g.fillStyle = i % 2 ? '#f1ece0' : '#d33a2f';
			g.beginPath(); g.arc( x, y, 34, Math.PI, 0 ); g.fill();
			g.strokeStyle = '#444'; g.lineWidth = 2;
			for ( let k = - 2; k <= 2; k ++ ) { g.beginPath(); g.moveTo( x + k * 16, y ); g.lineTo( x, y + 50 ); g.stroke(); }
			g.fillStyle = '#222'; g.fillRect( x - 4, y + 48, 8, 16 );

		}

	}

	g.restore();
	// apple blossom branches at the rim
	for ( let i = 0; i < 40; i ++ ) {

		const a = R() * Math.PI * 2, r = 220 + R() * 30;
		g.fillStyle = R() < 0.5 ? '#f6d3e2' : '#ffffff';
		g.beginPath(); g.arc( 256 + Math.cos( a ) * r, 256 + Math.sin( a ) * r, 6 + R() * 8, 0, Math.PI * 2 ); g.fill();

	}

	// rim: gold (alpha 0)
	g.globalCompositeOperation = 'destination-out';
	g.lineWidth = 36; g.beginPath(); g.arc( 256, 256, 256, 0, Math.PI * 2 ); g.stroke();
	return tex( c );

}

/** Novoslobodskaya-style stained glass (alpha 0 = lead came). */
export function stainedGlassDesign( seed = 1 ) {

	const R = rng( seed * 15485863 );
	const W = 256, H = 512;
	const [ c, g ] = canvas( W, H );
	const pal = [ '#d11f2e', '#f2a51a', '#2b8f4c', '#1c56b8', '#ffe27a', '#7b2da0', '#e8f2ff', '#e05a1a' ];
	g.fillStyle = '#ffe9b8'; g.fillRect( 0, 0, W, H );
	// background geometric panes
	for ( let y = 0; y < H; y += 32 ) for ( let x = 0; x < W; x += 32 ) {

		g.fillStyle = pal[ Math.floor( R() * 3 ) + 4 ];
		g.globalAlpha = 0.55 + R() * 0.4;
		g.fillRect( x, y, 32, 32 );

	}

	g.globalAlpha = 1;
	// central composition: vase + flowers / star rosettes
	const cx = W / 2;
	g.fillStyle = pal[ 3 ];
	g.beginPath(); g.moveTo( cx - 40, 440 ); g.quadraticCurveTo( cx - 70, 380, cx - 30, 340 ); g.lineTo( cx + 30, 340 ); g.quadraticCurveTo( cx + 70, 380, cx + 40, 440 ); g.closePath(); g.fill();
	for ( let i = 0; i < 7; i ++ ) {

		const x = cx + ( R() - 0.5 ) * 170, y = 80 + R() * 220;
		g.strokeStyle = pal[ 2 ]; g.lineWidth = 8;
		g.beginPath(); g.moveTo( cx + ( R() - 0.5 ) * 30, 340 ); g.quadraticCurveTo( x * 0.5 + cx * 0.5, y + 60, x, y ); g.stroke();
		const petals = 5 + Math.floor( R() * 4 );
		const col = pal[ Math.floor( R() * 4 ) + ( R() < 0.3 ? 4 : 0 ) ];
		for ( let p = 0; p < petals; p ++ ) {

			const a = p / petals * Math.PI * 2;
			g.fillStyle = col;
			g.beginPath(); g.ellipse( x + Math.cos( a ) * 18, y + Math.sin( a ) * 18, 17, 9, a, 0, Math.PI * 2 ); g.fill();

		}

		g.fillStyle = pal[ 4 ]; g.beginPath(); g.arc( x, y, 9, 0, Math.PI * 2 ); g.fill();

	}

	// lead came: frame + grid + outlines
	g.globalCompositeOperation = 'destination-out';
	g.strokeStyle = '#000';
	g.lineWidth = 10; g.strokeRect( 5, 5, W - 10, H - 10 );
	g.lineWidth = 3;
	for ( let y = 32; y < H; y += 32 ) { g.beginPath(); g.moveTo( 0, y + ( R() - 0.5 ) * 4 ); g.lineTo( W, y + ( R() - 0.5 ) * 4 ); g.stroke(); }
	for ( let x = 32; x < W; x += 32 ) { g.beginPath(); g.moveTo( x, 0 ); g.lineTo( x, H ); g.stroke(); }
	g.lineWidth = 12; g.beginPath(); g.arc( cx, 30, 95, 0, Math.PI ); g.stroke();
	g.globalCompositeOperation = 'source-over';
	return tex( c );

}

/** Broken glass crack overlay (for shattered panels). */
export function crackTexture( seed = 3 ) {

	const R = rng( seed );
	const [ c, g ] = canvas( 256, 256 );
	g.clearRect( 0, 0, 256, 256 );
	g.strokeStyle = 'rgba(255,255,255,0.9)';
	for ( let k = 0; k < 18; k ++ ) {

		g.lineWidth = 1 + R() * 2;
		g.beginPath();
		let x = 128, y = 128;
		g.moveTo( x, y );
		const a = R() * Math.PI * 2;
		for ( let s = 0; s < 8; s ++ ) {

			x += Math.cos( a + ( R() - 0.5 ) * 0.8 ) * 18; y += Math.sin( a + ( R() - 0.5 ) * 0.8 ) * 18;
			g.lineTo( x, y );

		}

		g.stroke();

	}

	for ( let r = 20; r < 120; r += 25 + R() * 20 ) { g.beginPath(); g.arc( 128, 128, r, R() * 6, R() * 6 + 2 ); g.stroke(); }
	return tex( c );

}

export { rng };
