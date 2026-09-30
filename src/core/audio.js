// Procedural sound engine: every sound is synthesised at start-up (no audio files).
// Gunshots are layered (supersonic crack + muzzle blast + low boom + mechanism), played through
// HRTF panners and a convolution reverb generated to mimic a long marble-clad metro hall.

const TAU = Math.PI * 2;

function rand( seed ) {

	let s = seed | 0 || 1;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ( ( s >>> 0 ) / 4294967296 ) * 2 - 1; };

}

class Synth {

	constructor( sr ) { this.sr = sr; }
	buf( sec ) { return new Float32Array( Math.max( 1, Math.floor( sec * this.sr ) ) ); }

	/** Resonant one-pole cascade lowpass with per-sample cutoff function */
	lowpass( x, fc, poles = 2 ) {

		const sr = this.sr;
		const st = new Float32Array( poles );
		for ( let i = 0; i < x.length; i ++ ) {

			const f = typeof fc === 'function' ? fc( i / sr ) : fc;
			const a = 1 - Math.exp( - TAU * Math.min( f, sr * 0.45 ) / sr );
			let v = x[ i ];
			for ( let p = 0; p < poles; p ++ ) { st[ p ] += a * ( v - st[ p ] ); v = st[ p ]; }
			x[ i ] = v;

		}

		return x;

	}

	highpass( x, fc ) {

		const a = 1 - Math.exp( - TAU * fc / this.sr );
		let s = 0;
		for ( let i = 0; i < x.length; i ++ ) { s += a * ( x[ i ] - s ); x[ i ] -= s; }
		return x;

	}

	bandpass( x, f, Q ) {

		const sr = this.sr;
		const w = TAU * f / sr, al = Math.sin( w ) / ( 2 * Q );
		const b0 = al, b2 = - al, a0 = 1 + al, a1 = - 2 * Math.cos( w ), a2 = 1 - al;
		let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
		for ( let i = 0; i < x.length; i ++ ) {

			const x0 = x[ i ];
			const y0 = ( b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2 ) / a0;
			x2 = x1; x1 = x0; y2 = y1; y1 = y0;
			x[ i ] = y0;

		}

		return x;

	}

	normalize( x, peak = 0.95 ) {

		let m = 0;
		for ( let i = 0; i < x.length; i ++ ) m = Math.max( m, Math.abs( x[ i ] ) );
		if ( m > 0 ) for ( let i = 0; i < x.length; i ++ ) x[ i ] *= peak / m;
		return x;

	}

	saturate( x, drive ) {

		const k = Math.tanh( drive );
		for ( let i = 0; i < x.length; i ++ ) x[ i ] = Math.tanh( x[ i ] * drive ) / k;
		return x;

	}

	fade( x, sec = 0.01 ) {

		const n = Math.min( x.length, Math.floor( sec * this.sr ) );
		for ( let i = 0; i < n; i ++ ) x[ x.length - 1 - i ] *= i / n;
		return x;

	}

	// ------------------------------------------------------------------ sounds

	gunshot( o, seed = 1 ) {

		const R = rand( seed );
		const {
			dur = 1.2, boomF = 55, boomDecay = 0.16, boom = 1, body = 1, bodyDecay = 0.08, cut0 = 6000, cut1 = 350,
			crack = 0.8, crackDecay = 0.0035, mech = 0.15, mechF = 2400, mechDelay = 0.035, drive = 2.2, tail = 0.25
		} = o;
		const sr = this.sr;
		const n = this.buf( dur ).length;
		const crackB = this.buf( dur ), bodyB = this.buf( dur ), out = this.buf( dur );
		for ( let i = 0; i < n; i ++ ) {

			const t = i / sr;
			crackB[ i ] = R() * Math.exp( - t / crackDecay );
			bodyB[ i ] = R() * ( Math.exp( - t / bodyDecay ) + tail * Math.exp( - t / ( bodyDecay * 6 ) ) );

		}

		this.highpass( crackB, 1800 );
		this.lowpass( bodyB, ( t ) => cut1 + ( cut0 - cut1 ) * Math.exp( - t / ( bodyDecay * 1.2 ) ), 2 );
		let ph = 0;
		for ( let i = 0; i < n; i ++ ) {

			const t = i / sr;
			const f = boomF * ( 1 + 2.5 * Math.exp( - t / 0.012 ) );
			ph += TAU * f / sr;
			const bm = Math.sin( ph ) * Math.exp( - t / boomDecay ) * ( 1 - Math.exp( - t / 0.0015 ) );
			let m = 0;
			const tm = t - mechDelay;
			if ( tm > 0 ) m += Math.sin( TAU * mechF * tm ) * Math.exp( - tm / 0.012 ) + 0.6 * Math.sin( TAU * mechF * 1.73 * tm ) * Math.exp( - tm / 0.008 );
			const tm2 = t - mechDelay - 0.045;
			if ( tm2 > 0 ) m += 0.7 * Math.sin( TAU * mechF * 0.8 * tm2 ) * Math.exp( - tm2 / 0.01 );
			out[ i ] = crackB[ i ] * crack * 2.5 + bodyB[ i ] * body * 1.6 + bm * boom * 1.4 + m * mech;

		}

		this.saturate( out, drive );
		return this.fade( this.normalize( out ), 0.05 );

	}

	click( { f = 3000, dur = 0.05, decay = 0.006, noise = 0.6, seed = 3, f2 = 0, thump = 0 } ) {

		const R = rand( seed );
		const x = this.buf( dur );
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr;
			const e = Math.exp( - t / decay );
			x[ i ] = ( Math.sin( TAU * f * t ) * ( 1 - noise ) + R() * noise ) * e;
			if ( f2 ) x[ i ] += 0.5 * Math.sin( TAU * f2 * t ) * Math.exp( - t / ( decay * 1.6 ) );
			if ( thump ) x[ i ] += thump * Math.sin( TAU * 90 * t ) * Math.exp( - t / 0.02 );

		}

		return this.fade( this.normalize( x, 0.9 ) );

	}

	/** Mechanical sequence: list of [time, freq, decay, noise, gain] */
	mech( events, dur, seed = 5 ) {

		const x = this.buf( dur );
		const R = rand( seed );
		for ( const [ t0, f, decay, noise, gain ] of events ) {

			const s0 = Math.floor( t0 * this.sr );
			const len = Math.min( x.length - s0, Math.floor( decay * 8 * this.sr ) );
			for ( let i = 0; i < len; i ++ ) {

				const t = i / this.sr;
				const e = Math.exp( - t / decay );
				x[ s0 + i ] += gain * e * ( Math.sin( TAU * f * t ) * ( 1 - noise ) + R() * noise + 0.4 * Math.sin( TAU * f * 2.31 * t ) * ( 1 - noise ) );

			}

		}

		return this.fade( this.normalize( x, 0.9 ) );

	}

	/** Slide / friction noise */
	slide( dur, f0, f1, seed = 9 ) {

		const R = rand( seed );
		const x = this.buf( dur );
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr, u = t / dur;
			x[ i ] = R() * Math.sin( Math.PI * u ) * ( 0.6 + 0.4 * Math.sin( t * 400 ) );

		}

		this.lowpass( x, ( t ) => f0 + ( f1 - f0 ) * t / dur, 2 );
		this.highpass( x, 500 );
		return this.normalize( x, 0.6 );

	}

	tink( seed = 1, base = 3200, dur = 0.35 ) {

		const R = rand( seed );
		const x = this.buf( dur );
		const fs = [ base, base * 1.51 + R() * 200, base * 2.33 + R() * 300, base * 3.1 ];
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr;
			let v = 0;
			fs.forEach( ( f, k ) => { v += Math.sin( TAU * f * t + k ) * Math.exp( - t / ( 0.06 / ( k + 1 ) ) ) / ( k + 1 ); } );
			// bounces
			for ( const b of [ 0.09, 0.16, 0.21 ] ) if ( t > b ) v += 0.35 * Math.sin( TAU * fs[ 0 ] * ( t - b ) ) * Math.exp( - ( t - b ) / 0.02 );
			x[ i ] = v;

		}

		return this.fade( this.normalize( x, 0.6 ) );

	}

	glass( seed = 1, dur = 1.1, density = 160, big = true ) {

		const R = rand( seed );
		const x = this.buf( dur );
		const sr = this.sr;
		// initial crack
		const crackLen = Math.floor( 0.05 * sr );
		for ( let i = 0; i < crackLen; i ++ ) x[ i ] += R() * Math.exp( - i / sr / 0.012 ) * ( big ? 1 : 0.6 );
		for ( let k = 0; k < density; k ++ ) {

			const t0 = Math.pow( Math.abs( R() ), 2.2 ) * dur * 0.85;
			const f = 2500 + Math.abs( R() ) * 7000;
			const d = 0.004 + Math.abs( R() ) * 0.03;
			const g = ( 0.3 + Math.abs( R() ) * 0.7 ) * ( 1 - t0 / dur );
			const s0 = Math.floor( t0 * sr );
			const len = Math.min( x.length - s0, Math.floor( d * 6 * sr ) );
			for ( let i = 0; i < len; i ++ ) {

				const t = i / sr;
				x[ s0 + i ] += g * Math.sin( TAU * f * t ) * Math.exp( - t / d );

			}

		}

		this.highpass( x, 900 );
		return this.fade( this.normalize( x, 0.9 ), 0.1 );

	}

	thud( { f = 80, dur = 0.25, decay = 0.07, noise = 0.5, cut = 900, seed = 2, wet = 0 } ) {

		const R = rand( seed );
		const x = this.buf( dur );
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr;
			const e = Math.exp( - t / decay );
			x[ i ] = ( Math.sin( TAU * f * ( 1 + Math.exp( - t / 0.01 ) ) * t ) * ( 1 - noise ) + R() * noise ) * e;
			if ( wet ) x[ i ] += wet * R() * Math.exp( - Math.abs( t - 0.02 ) / 0.015 ) * ( 0.5 + 0.5 * Math.sin( t * 900 ) );

		}

		this.lowpass( x, cut, 2 );
		return this.fade( this.normalize( x, 0.9 ) );

	}

	ricochet( seed = 1, f0 = 3400, f1 = 1300, dur = 0.45 ) {

		const R = rand( seed );
		const x = this.buf( dur );
		let ph = 0;
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr, u = t / dur;
			const f = f0 + ( f1 - f0 ) * u + Math.sin( t * 60 ) * 90;
			ph += TAU * f / this.sr;
			x[ i ] = Math.sin( ph ) * Math.exp( - t / 0.16 ) * Math.min( 1, t / 0.004 ) * 0.7 + R() * Math.exp( - t / 0.01 );

		}

		return this.fade( this.normalize( x, 0.8 ) );

	}

	whiz( seed = 1 ) {

		const R = rand( seed );
		const dur = 0.28;
		const x = this.buf( dur );
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr, u = t / dur;
			x[ i ] = R() * Math.exp( - Math.pow( ( u - 0.4 ) / 0.18, 2 ) );

		}

		this.bandpass( x, 2200, 1.2 );
		return this.normalize( x, 0.8 );

	}

	zap( seed = 4, dur = 0.7 ) {

		const R = rand( seed );
		const x = this.buf( dur );
		let gate = 1;
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr;
			if ( i % 400 === 0 ) gate = R() > - 0.2 ? 1 : 0.1;
			const saw = ( ( t * 100 ) % 1 ) * 2 - 1;
			x[ i ] = ( saw * 0.6 + R() * 0.8 ) * gate * Math.exp( - t / 0.25 );

		}

		this.highpass( x, 300 );
		return this.normalize( x, 0.7 );

	}

	step( seed = 1, heel = false ) {

		const R = rand( seed );
		const dur = heel ? 0.12 : 0.16;
		const x = this.buf( dur );
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr;
			if ( heel ) x[ i ] = R() * Math.exp( - t / 0.004 ) * 1.2 + Math.sin( TAU * ( 1900 + R() * 50 ) * t ) * Math.exp( - t / 0.02 ) * 0.5 + Math.sin( TAU * 120 * t ) * Math.exp( - t / 0.015 ) * 0.4;
			else x[ i ] = R() * Math.exp( - t / 0.012 ) * 0.8 + Math.sin( TAU * 95 * t ) * Math.exp( - t / 0.03 ) * 0.7 + R() * Math.exp( - Math.abs( t - 0.035 ) / 0.008 ) * 0.3;

		}

		if ( ! heel ) this.lowpass( x, 2800, 1 );
		return this.fade( this.normalize( x, 0.8 ) );

	}

	tone( notes, { dur = 1, wave = 'sine', decay = 0.5, vib = 0 } ) {

		const x = this.buf( dur );
		for ( const [ t0, f, len, g = 1 ] of notes ) {

			const s0 = Math.floor( t0 * this.sr );
			const n = Math.min( x.length - s0, Math.floor( ( len + decay ) * this.sr ) );
			let ph = 0;
			for ( let i = 0; i < n; i ++ ) {

				const t = i / this.sr;
				ph += TAU * f * ( 1 + vib * Math.sin( t * 30 ) ) / this.sr;
				let w = Math.sin( ph );
				if ( wave === 'bell' ) w = Math.sin( ph ) + 0.4 * Math.sin( ph * 2.76 ) * Math.exp( - t / 0.2 ) + 0.25 * Math.sin( ph * 5.4 ) * Math.exp( - t / 0.08 );
				if ( wave === 'reed' ) w = Math.tanh( 3 * Math.sin( ph ) ) * 0.7 + 0.3 * Math.sin( ph * 3 );
				const env = Math.min( 1, t / 0.01 ) * ( t < len ? 1 : Math.exp( - ( t - len ) / decay ) );
				x[ s0 + i ] += w * env * g;

			}

		}

		return this.fade( this.normalize( x, 0.8 ) );

	}

	noiseLoop( sec, color = 'pink', seed = 7 ) {

		const R = rand( seed );
		const x = this.buf( sec );
		let b0 = 0, b1 = 0, b2 = 0, br = 0;
		for ( let i = 0; i < x.length; i ++ ) {

			const w = R();
			if ( color === 'brown' ) { br = ( br + 0.02 * w ) / 1.02; x[ i ] = br * 3.5; } else {

				b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
				x[ i ] = ( b0 + b1 + b2 + w * 0.1848 ) * 0.2;

			}

		}

		// crossfade ends for seamless loop
		const f = Math.floor( 0.05 * this.sr );
		for ( let i = 0; i < f; i ++ ) { const u = i / f; x[ i ] = x[ i ] * u + x[ x.length - f + i ] * ( 1 - u ); }
		return this.normalize( x.subarray( 0, x.length - f ), 0.8 );

	}

	hum( sec = 4 ) {

		const x = this.buf( sec );
		const R = rand( 11 );
		for ( let i = 0; i < x.length; i ++ ) {

			const t = i / this.sr;
			x[ i ] = 0.5 * Math.sin( TAU * 50 * t ) + 0.25 * Math.sin( TAU * 100 * t ) + 0.12 * Math.sin( TAU * 150 * t ) + 0.05 * R();

		}

		return this.normalize( x, 0.5 );

	}

	impulse( sec = 3.2, decay = 1.25 ) {

		const sr = this.sr;
		const n = Math.floor( sec * sr );
		const chans = [];
		for ( let c = 0; c < 2; c ++ ) {

			const R = rand( 100 + c );
			const x = new Float32Array( n );
			let lp = 0;
			for ( let i = 0; i < n; i ++ ) {

				const t = i / sr;
				const fc = 9000 * Math.exp( - t / 0.9 ) + 400;
				const a = 1 - Math.exp( - TAU * fc / sr );
				lp += a * ( R() - lp );
				x[ i ] = lp * Math.exp( - t / ( decay / 6.9 * 3 ) ) * ( t < 0.004 ? t / 0.004 : 1 );

			}

			// early reflections from columns and vault
			for ( let k = 0; k < 24; k ++ ) {

				const t = 0.008 + Math.abs( R() ) * 0.09;
				const i = Math.floor( t * sr );
				if ( i < n ) x[ i ] += R() * 0.9 * ( 1 - t * 6 );

			}

			chans.push( x );

		}

		return chans;

	}

}

export class AudioEngine {

	constructor() {

		this.ctx = null;
		this.buffers = {};
		this.volume = 0.8;
		this.ready = false;

	}

	async init() {

		if ( this.ctx ) { if ( this.ctx.state === 'suspended' ) await this.ctx.resume(); return; }
		const AC = window.AudioContext || window.webkitAudioContext;
		const ctx = new AC( { latencyHint: 'interactive' } );
		this.ctx = ctx;
		this.master = ctx.createGain();
		this.master.gain.value = this.volume;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = - 10; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
		this.master.connect( comp ).connect( ctx.destination );
		this.sfx = ctx.createGain();
		this.sfx.connect( this.master );
		// muffling filter (player hurt / low hp)
		this.muffle = ctx.createBiquadFilter();
		this.muffle.type = 'lowpass';
		this.muffle.frequency.value = 20000;
		this.sfx.disconnect();
		this.sfx.connect( this.muffle ).connect( this.master );
		// reverb
		const S = new Synth( ctx.sampleRate );
		this.S = S;
		this.reverb = ctx.createConvolver();
		const [ l, r ] = S.impulse( 3.4, 2.6 );
		const ir = ctx.createBuffer( 2, l.length, ctx.sampleRate );
		ir.copyToChannel( l, 0 ); ir.copyToChannel( r, 1 );
		this.reverb.buffer = ir;
		this.reverbIn = ctx.createGain();
		this.reverbIn.gain.value = 0.55;
		this.reverbIn.connect( this.reverb ).connect( this.muffle );
		this.generate( S );
		this.startAmbience();
		this.ready = true;

	}

	setVolume( v ) {

		this.volume = v;
		if ( this.master ) this.master.gain.value = v;

	}

	toBuffer( x ) {

		const b = this.ctx.createBuffer( 1, x.length, this.ctx.sampleRate );
		b.copyToChannel( x, 0 );
		return b;

	}

	generate( S ) {

		const B = ( name, x ) => { ( this.buffers[ name ] ||= [] ).push( this.toBuffer( x ) ); };
		// player weapons
		for ( let i = 0; i < 3; i ++ ) {

			B( 'deagle', S.gunshot( { dur: 1.4, boomF: 48, boomDecay: 0.2, boom: 1.3, body: 1.1, bodyDecay: 0.09, cut0: 5200, crack: 0.7, mech: 0.25, mechF: 2100, drive: 2.8 }, 10 + i ) );
			B( 'ak', S.gunshot( { dur: 1.1, boomF: 62, boomDecay: 0.12, boom: 0.9, body: 1.0, bodyDecay: 0.06, cut0: 7000, crack: 1.1, mech: 0.3, mechF: 2600, mechDelay: 0.03, drive: 2.6 }, 20 + i ) );
			B( 'shotgun', S.gunshot( { dur: 1.6, boomF: 42, boomDecay: 0.26, boom: 1.5, body: 1.4, bodyDecay: 0.12, cut0: 4200, cut1: 250, crack: 0.5, mech: 0.05, drive: 3.0, tail: 0.4 }, 30 + i ) );
			B( 'svd', S.gunshot( { dur: 1.8, boomF: 50, boomDecay: 0.22, boom: 1.2, body: 1.2, bodyDecay: 0.08, cut0: 8000, crack: 1.6, crackDecay: 0.005, mech: 0.2, mechF: 2300, drive: 3.0, tail: 0.35 }, 40 + i ) );
			B( 'pistol', S.gunshot( { dur: 0.9, boomF: 75, boomDecay: 0.09, boom: 0.7, body: 0.9, bodyDecay: 0.05, cut0: 7500, crack: 0.9, mech: 0.15, mechF: 2900, drive: 2.2 }, 50 + i ) );
			B( 'smg', S.gunshot( { dur: 0.8, boomF: 80, boomDecay: 0.07, boom: 0.6, body: 0.9, bodyDecay: 0.045, cut0: 8000, crack: 1.0, mech: 0.2, mechF: 3100, drive: 2.0 }, 60 + i ) );

		}

		B( 'dry', S.click( { f: 2400, decay: 0.004, noise: 0.5, dur: 0.06, f2: 5200 } ) );
		B( 'mag_out', S.mech( [ [ 0, 1800, 0.01, 0.5, 1 ], [ 0.05, 900, 0.03, 0.8, 0.5 ] ], 0.3 ) );
		B( 'mag_in', S.mech( [ [ 0, 1400, 0.012, 0.5, 0.6 ], [ 0.06, 2200, 0.008, 0.3, 1 ], [ 0.07, 700, 0.02, 0.7, 0.8 ] ], 0.3 ) );
		B( 'bolt', S.mech( [ [ 0, 1600, 0.01, 0.6, 0.8 ], [ 0.12, 2400, 0.01, 0.4, 1 ], [ 0.13, 900, 0.03, 0.6, 0.7 ] ], 0.35 ) );
		B( 'slide', S.mech( [ [ 0, 2600, 0.008, 0.4, 1 ], [ 0.015, 1300, 0.02, 0.6, 0.6 ] ], 0.2 ) );
		B( 'pump', S.mech( [ [ 0, 700, 0.03, 0.7, 0.8 ], [ 0.02, 1500, 0.01, 0.5, 0.5 ], [ 0.2, 800, 0.03, 0.7, 1 ], [ 0.22, 1900, 0.01, 0.4, 0.7 ] ], 0.45 ) );
		B( 'shell_in', S.mech( [ [ 0, 1100, 0.015, 0.6, 0.8 ], [ 0.04, 1700, 0.01, 0.4, 0.8 ] ], 0.2 ) );
		B( 'switch', S.mech( [ [ 0, 1200, 0.02, 0.8, 0.5 ], [ 0.12, 1900, 0.01, 0.5, 0.8 ] ], 0.3 ) );
		for ( let i = 0; i < 4; i ++ ) B( 'casing', S.tink( 70 + i, 2900 + i * 450 ) );
		for ( let i = 0; i < 2; i ++ ) B( 'shell_drop', S.thud( { f: 300 + i * 60, dur: 0.2, decay: 0.03, noise: 0.4, cut: 2500, seed: 80 + i } ) );
		// impacts
		for ( let i = 0; i < 4; i ++ ) B( 'impact_stone', S.click( { f: 1800 + i * 300, dur: 0.12, decay: 0.012, noise: 0.85, seed: 90 + i, thump: 0.3 } ) );
		for ( let i = 0; i < 3; i ++ ) B( 'ricochet', S.ricochet( 100 + i, 3000 + i * 500, 1000 + i * 200 ) );
		for ( let i = 0; i < 3; i ++ ) B( 'impact_metal', S.mech( [ [ 0, 3100 + i * 400, 0.05, 0.3, 1 ], [ 0, 5200, 0.02, 0.2, 0.5 ] ], 0.4, 110 + i ) );
		for ( let i = 0; i < 3; i ++ ) B( 'impact_flesh', S.thud( { f: 70, dur: 0.22, decay: 0.05, noise: 0.7, cut: 1400, seed: 120 + i, wet: 0.8 } ) );
		B( 'headshot', S.thud( { f: 110, dur: 0.3, decay: 0.06, noise: 0.8, cut: 3000, seed: 130, wet: 1.2 } ) );
		for ( let i = 0; i < 2; i ++ ) B( 'wood_hit', S.thud( { f: 180, dur: 0.18, decay: 0.03, noise: 0.6, cut: 2500, seed: 140 + i } ) );
		B( 'wood_break', S.glass( 150, 0.9, 60, true ).map( ( v, i ) => v * 0.4 ) );
		for ( let i = 0; i < 3; i ++ ) B( 'glass', S.glass( 160 + i, 1.2, 220 ) );
		for ( let i = 0; i < 3; i ++ ) B( 'glass_small', S.glass( 170 + i, 0.5, 45, false ) );
		B( 'zap', S.zap() );
		for ( let i = 0; i < 2; i ++ ) B( 'whiz', S.whiz( 180 + i ) );
		for ( let i = 0; i < 4; i ++ ) B( 'step', S.step( 190 + i ) );
		for ( let i = 0; i < 4; i ++ ) B( 'heel', S.step( 200 + i, true ) );
		B( 'land', S.thud( { f: 70, dur: 0.25, decay: 0.06, noise: 0.5, cut: 1200 } ) );
		B( 'body_fall', S.thud( { f: 60, dur: 0.5, decay: 0.12, noise: 0.6, cut: 900, seed: 210 } ) );
		B( 'hurt', S.thud( { f: 55, dur: 0.35, decay: 0.08, noise: 0.3, cut: 500, seed: 215 } ) );
		B( 'heartbeat', S.tone( [ [ 0, 55, 0.05, 1 ], [ 0.18, 50, 0.05, 0.8 ] ], { dur: 0.7, decay: 0.08 } ) );
		// UI & train
		B( 'hit', S.click( { f: 4200, decay: 0.01, noise: 0.1, dur: 0.06 } ) );
		B( 'kill', S.tone( [ [ 0, 1320, 0.05 ], [ 0.06, 1760, 0.12 ] ], { dur: 0.4, wave: 'bell', decay: 0.12 } ) );
		B( 'chime', S.tone( [ [ 0, 784, 0.25, 1 ], [ 0.32, 622, 0.45, 1 ] ], { dur: 1.4, wave: 'bell', decay: 0.5 } ) );
		B( 'beeps', S.tone( [ [ 0, 2000, 0.09 ], [ 0.25, 2000, 0.09 ], [ 0.5, 2000, 0.09 ], [ 0.75, 2000, 0.09 ] ], { dur: 1.1, decay: 0.02 } ) );
		B( 'horn', S.tone( [ [ 0, 415, 0.9, 1 ], [ 0, 523, 0.9, 0.6 ] ], { dur: 1.4, wave: 'reed', decay: 0.2, vib: 0.002 } ) );
		B( 'hiss', ( () => { const x = S.noiseLoop( 1.2, 'pink', 230 ); S.highpass( x, 2500 ); for ( let i = 0; i < x.length; i ++ ) x[ i ] *= Math.exp( - i / x.length * 2.5 ); return x; } )() );
		B( 'door_thud', S.thud( { f: 90, dur: 0.35, decay: 0.07, noise: 0.5, cut: 1500, seed: 240 } ) );
		B( 'clack', S.mech( [ [ 0, 420, 0.03, 0.7, 1 ], [ 0.11, 380, 0.03, 0.7, 0.9 ] ], 0.3, 250 ) );
		B( 'stinger', S.tone( [ [ 0, 110, 1.2, 1 ], [ 0, 164.8, 1.2, 0.7 ], [ 0, 220, 1.2, 0.5 ], [ 0.02, 261.6, 1.1, 0.35 ] ], { dur: 2.4, wave: 'reed', decay: 0.9 } ) );
		B( 'pickup', S.tone( [ [ 0, 880, 0.05 ], [ 0.05, 1175, 0.08 ] ], { dur: 0.3, wave: 'bell', decay: 0.1 } ) );
		this.noiseBuf = this.toBuffer( S.noiseLoop( 3, 'pink', 260 ) );
		this.brownBuf = this.toBuffer( S.noiseLoop( 3, 'brown', 261 ) );
		this.humBuf = this.toBuffer( S.hum() );

	}

	listen( camera ) {

		if ( ! this.ctx ) return;
		const L = this.ctx.listener;
		const p = camera.getWorldPosition( this._p ||= new camera.position.constructor() );
		const f = camera.getWorldDirection( this._f ||= new camera.position.constructor() );
		const t = this.ctx.currentTime;
		if ( L.positionX ) {

			L.positionX.setValueAtTime( p.x, t ); L.positionY.setValueAtTime( p.y, t ); L.positionZ.setValueAtTime( p.z, t );
			L.forwardX.setValueAtTime( f.x, t ); L.forwardY.setValueAtTime( f.y, t ); L.forwardZ.setValueAtTime( f.z, t );
			L.upX.setValueAtTime( 0, t ); L.upY.setValueAtTime( 1, t ); L.upZ.setValueAtTime( 0, t );

		} else {

			L.setPosition( p.x, p.y, p.z );
			L.setOrientation( f.x, f.y, f.z, 0, 1, 0 );

		}

		this.listenerPos = p;

	}

	/**
	 * Play a one-shot. opts: { pos: Vector3, vol, rate, reverb, variant, detune }
	 */
	play( name, opts = {} ) {

		if ( ! this.ready ) return null;
		const list = this.buffers[ name ];
		if ( ! list ) return null;
		const ctx = this.ctx;
		const src = ctx.createBufferSource();
		src.buffer = list[ opts.variant ?? Math.floor( Math.random() * list.length ) ];
		src.playbackRate.value = ( opts.rate || 1 ) * ( 1 + ( Math.random() - 0.5 ) * ( opts.detune ?? 0.06 ) );
		const g = ctx.createGain();
		g.gain.value = opts.vol ?? 1;
		src.connect( g );
		let out = g;
		if ( opts.pos ) {

			const dist = this.listenerPos ? opts.pos.distanceTo( this.listenerPos ) : 5;
			// air absorption: distant sounds lose their highs
			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = Math.max( 900, 20000 / ( 1 + dist * 0.12 ) );
			const p = ctx.createPanner();
			p.panningModel = 'HRTF';
			p.distanceModel = 'inverse';
			p.refDistance = opts.ref ?? 2.5;
			p.rolloffFactor = opts.rolloff ?? 1.0;
			p.maxDistance = 400;
			p.positionX ? ( p.positionX.value = opts.pos.x, p.positionY.value = opts.pos.y, p.positionZ.value = opts.pos.z ) : p.setPosition( opts.pos.x, opts.pos.y, opts.pos.z );
			out.connect( lp ).connect( p );
			out = p;

		}

		out.connect( this.sfx );
		const rv = opts.reverb ?? 0.35;
		if ( rv > 0 ) {

			const s = ctx.createGain();
			s.gain.value = rv;
			out.connect( s ).connect( this.reverbIn );

		}

		src.start( ctx.currentTime + ( opts.delay || 0 ) );
		return src;

	}

	// ------------------------------------------------------------------ loops

	loop( buffer, { vol = 0.2, rate = 1, filter = null, freq = 800, q = 0.7, pos = null } = {} ) {

		const ctx = this.ctx;
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.loop = true;
		src.playbackRate.value = rate;
		const g = ctx.createGain();
		g.gain.value = vol;
		let node = src;
		let f = null;
		if ( filter ) {

			f = ctx.createBiquadFilter();
			f.type = filter; f.frequency.value = freq; f.Q.value = q;
			node.connect( f ); node = f;

		}

		node.connect( g );
		let out = g;
		let panner = null;
		if ( pos ) {

			panner = ctx.createPanner();
			panner.panningModel = 'HRTF';
			panner.refDistance = 6;
			panner.rolloffFactor = 0.8;
			g.connect( panner ); out = panner;

		}

		out.connect( this.sfx );
		src.start();
		return { src, gain: g, filter: f, panner };

	}

	startAmbience() {

		this.amb = this.loop( this.brownBuf, { vol: 0.12, filter: 'lowpass', freq: 220 } );
		this.hum = this.loop( this.humBuf, { vol: 0.012 } );
		// train sound rig (positional; driven by Train)
		const ctx = this.ctx;
		const rig = {};
		rig.panner = ctx.createPanner();
		rig.panner.panningModel = 'HRTF';
		rig.panner.refDistance = 10;
		rig.panner.rolloffFactor = 0.7;
		rig.bus = ctx.createGain();
		rig.bus.gain.value = 0;
		rig.bus.connect( rig.panner ).connect( this.sfx );
		const rs = ctx.createGain(); rs.gain.value = 0.4; rig.panner.connect( rs ).connect( this.reverbIn );
		const mk = ( type, f ) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
		rig.m1 = mk( 'sawtooth', 40 ); rig.m2 = mk( 'square', 100 ); rig.m3 = mk( 'triangle', 200 );
		rig.mf = ctx.createBiquadFilter(); rig.mf.type = 'bandpass'; rig.mf.frequency.value = 600; rig.mf.Q.value = 2;
		rig.mg = ctx.createGain(); rig.mg.gain.value = 0;
		rig.m1.connect( rig.mf ); rig.m2.connect( rig.mf ); rig.m3.connect( rig.mf );
		rig.mf.connect( rig.mg ).connect( rig.bus );
		const roll = ctx.createBufferSource(); roll.buffer = this.noiseBuf; roll.loop = true; roll.start();
		rig.rf = ctx.createBiquadFilter(); rig.rf.type = 'lowpass'; rig.rf.frequency.value = 400;
		rig.rg = ctx.createGain(); rig.rg.gain.value = 0;
		roll.connect( rig.rf ).connect( rig.rg ).connect( rig.bus );
		const sq = mk( 'sine', 2900 );
		rig.sg = ctx.createGain(); rig.sg.gain.value = 0;
		sq.connect( rig.sg ).connect( rig.bus );
		this.trainRig = rig;

	}

	/** Update the train sound rig. */
	trainSound( { speed = 0, accel = 0, pos = null, inside = false, tunnel = false } ) {

		const rig = this.trainRig;
		if ( ! rig ) return;
		const t = this.ctx.currentTime;
		const v = Math.abs( speed );
		const on = v > 0.05 || Math.abs( accel ) > 0.05 ? 1 : 0;
		rig.bus.gain.setTargetAtTime( on * ( inside ? 0.9 : 1.2 ), t, 0.3 );
		rig.m1.frequency.setTargetAtTime( 30 + v * 7, t, 0.1 );
		rig.m2.frequency.setTargetAtTime( 60 + v * 18, t, 0.1 );
		rig.m3.frequency.setTargetAtTime( 180 + v * 42, t, 0.1 );
		rig.mf.frequency.setTargetAtTime( 300 + v * 60, t, 0.1 );
		rig.mg.gain.setTargetAtTime( Math.min( 0.5, Math.abs( accel ) * 0.25 + v * 0.008 ), t, 0.2 );
		rig.rg.gain.setTargetAtTime( Math.min( 1.2, v * 0.06 ) * ( tunnel ? 1.6 : 1 ), t, 0.2 );
		rig.rf.frequency.setTargetAtTime( 250 + v * 45 + ( tunnel ? 300 : 0 ), t, 0.2 );
		rig.sg.gain.setTargetAtTime( accel < - 0.3 && v < 6 && v > 0.3 ? 0.035 : 0, t, 0.08 );
		if ( pos ) {

			const p = rig.panner;
			if ( p.positionX ) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition( pos.x, pos.y, pos.z );

		}

	}

	setMuffle( amount ) {

		if ( ! this.muffle ) return;
		this.muffle.frequency.setTargetAtTime( 20000 - amount * 19000, this.ctx.currentTime, 0.1 );

	}

}
