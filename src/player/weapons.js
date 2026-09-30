// First-person weapon system: viewmodels, hitscan ballistics with visible tracers, recoil,
// procedural animation (sway, bob, kick, slide/bolt/pump, reloads, switching), ADS and scope.
import * as THREE from 'three/webgpu';
import { ctx } from '../core/ctx.js';
import { buildDeagle, buildAK, buildShotgun, buildSVD } from './weaponModels.js';

const VM_SCALE = 0.5;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const DEFS = {
	deagle: {
		name: 'DESERT EAGLE .50', short: 'DEAGLE', slot: 1, build: buildDeagle, auto: false, interval: 0.24, damage: 64, headMul: 3.0, limbMul: 0.75,
		mag: 7, reserve: 49, spread: 0.014, adsSpread: 0.0025, moveSpread: 0.035, sound: 'deagle', pellets: 1,
		recoil: { pitch: 0.075, yaw: 0.025, kick: 0.07, rot: 0.42, shake: 0.35 }, reload: 1.75,
		hip: [ 0.13, - 0.13, - 0.34 ], adsZ: - 0.3, adsFov: 0.78, tracer: 0xffd28a, flash: 1.15, casing: 'brass', penetrate: 1, infinite: true
	},
	ak: {
		name: 'АК-47', short: 'AK-47', slot: 2, build: buildAK, auto: true, interval: 0.1, damage: 34, headMul: 2.6, limbMul: 0.8,
		mag: 30, reserve: 210, spread: 0.022, adsSpread: 0.004, moveSpread: 0.03, sound: 'ak', pellets: 1,
		recoil: { pitch: 0.021, yaw: 0.012, kick: 0.032, rot: 0.06, shake: 0.12 }, reload: 2.3,
		hip: [ 0.13, - 0.155, - 0.36 ], adsZ: - 0.3, adsFov: 0.72, tracer: 0xffb85a, flash: 1.0, casing: 'brass', penetrate: 1
	},
	shotgun: {
		name: 'ДРОБОВИК 12 КАЛИБР', short: 'ДРОБОВИК', slot: 3, build: buildShotgun, auto: false, interval: 0.88, damage: 15, headMul: 1.8, limbMul: 0.8,
		mag: 8, reserve: 48, spread: 0.065, adsSpread: 0.048, moveSpread: 0.02, sound: 'shotgun', pellets: 10,
		recoil: { pitch: 0.11, yaw: 0.03, kick: 0.09, rot: 0.2, shake: 0.6 }, reload: 0.5,
		hip: [ 0.13, - 0.16, - 0.34 ], adsZ: - 0.3, adsFov: 0.8, tracer: 0xffcf8a, flash: 1.5, casing: 'shell', perShell: true, penetrate: 1
	},
	svd: {
		name: 'СВД (ПСО-1)', short: 'СВД', slot: 4, build: buildSVD, auto: false, interval: 0.4, damage: 160, headMul: 2.5, limbMul: 0.85,
		mag: 10, reserve: 50, spread: 0.035, adsSpread: 0.0002, moveSpread: 0.05, sound: 'svd', pellets: 1,
		recoil: { pitch: 0.085, yaw: 0.02, kick: 0.08, rot: 0.15, shake: 0.5 }, reload: 2.7,
		hip: [ 0.15, - 0.18, - 0.44 ], adsZ: - 0.2, adsFov: 0.2, scope: true, tracer: 0xffe0a0, flash: 1.3, casing: 'brass', penetrate: 3
	}
};
export const ORDER = [ 'deagle', 'ak', 'shotgun', 'svd' ];

const ease = ( t ) => t < 0 ? 0 : t > 1 ? 1 : t * t * ( 3 - 2 * t );

export class Weapons {

	constructor( camera ) {

		this.camera = camera;
		this.root = new THREE.Group();
		this.root.scale.setScalar( VM_SCALE );
		camera.add( this.root );
		this.sway = new THREE.Group();
		this.root.add( this.sway );
		this.guns = {};
		this.state = {};
		for ( const k of ORDER ) {

			const d = DEFS[ k ];
			const model = d.build();
			const holder = new THREE.Group();
			model.rotation.y = Math.PI / 2; // +X (muzzle) → camera forward (−Z)
			holder.add( model );
			holder.visible = false;
			this.sway.add( holder );
			model.traverse( ( o ) => { if ( o.isMesh ) { o.frustumCulled = false; } } );
			this.guns[ k ] = {
				def: d, model, holder,
				slide: model.getObjectByName( 'slide' ), bolt: model.getObjectByName( 'bolt' ), pump: model.getObjectByName( 'pump' ),
				mag: model.getObjectByName( 'mag' ), muzzle: model.getObjectByName( 'muzzle' ), eject: model.getObjectByName( 'eject' ),
				magRest: null
			};
			const g = this.guns[ k ];
			if ( g.mag ) g.magRest = g.mag.position.clone();
			this.state[ k ] = { ammo: d.mag, reserve: d.reserve };

		}

		this.current = 'deagle';
		this.guns.deagle.holder.visible = true;
		this.cool = 0;
		this.reloading = 0; this.reloadDur = 0; this.reloadAdded = false;
		this.switching = 0; this.switchTo = null;
		this.pumpT = 0; this.pumping = false;
		this.kick = 0; this.kickRot = 0; this.shake = 0;
		this.ads = 0;
		this.bob = 0;
		this.swayX = 0; this.swayY = 0;
		this.lastFireTime = 0;
		this.spreadBloom = 0;
		this.stats = { shots: 0, hits: 0, headshots: 0 };
		this.slideT = 1; this.boltT = 1;
		this.muzzleFlashes = [];
		this.flashSprite = null;
		this.scoped = false;
		this.enabled = true;

	}

	get gun() { return this.guns[ this.current ]; }
	get def() { return DEFS[ this.current ]; }
	get ammo() { return this.state[ this.current ]; }

	select( k ) {

		if ( k === this.current || this.switching > 0 || ! DEFS[ k ] ) return;
		this.switchTo = k;
		this.switching = 0.55;
		this.reloading = 0;
		this.pumping = false;
		ctx.audio?.play( 'switch', { vol: 0.5, reverb: 0.05 } );

	}

	cycle( dir ) {

		const i = ORDER.indexOf( this.switchTo || this.current );
		this.select( ORDER[ ( i + dir + ORDER.length ) % ORDER.length ] );

	}

	reload() {

		const d = this.def, s = this.ammo;
		if ( this.reloading > 0 || this.switching > 0 || s.ammo >= d.mag || ( s.reserve <= 0 && ! d.infinite ) ) return;
		if ( d.perShell ) {

			this.reloading = d.reload;
			this.reloadDur = d.reload;
			this.shellLoop = true;

		} else {

			this.reloadDur = d.reload * ( s.ammo === 0 ? 1.15 : 1 );
			this.reloading = this.reloadDur;
			this.reloadEmpty = s.ammo === 0;
			this.reloadAdded = false;
			this.reloadSounds = { out: false, in: false, bolt: false };

		}

	}

	addAmmo( k, n ) { this.state[ k ].reserve += n; }

	refill( frac = 1 ) {

		for ( const k of ORDER ) {

			const d = DEFS[ k ];
			this.state[ k ].reserve = Math.max( this.state[ k ].reserve, Math.round( d.reserve * frac ) );

		}

	}

	// ------------------------------------------------------------------ firing

	tryFire( input, player ) {

		const d = this.def, s = this.ammo;
		const want = d.auto ? input.mouse[ 0 ] : input.mousePressed[ 0 ];
		if ( ! want || this.cool > 0 || this.switching > 0 || player.sprinting ) return;
		if ( this.reloading > 0 ) {

			if ( d.perShell && s.ammo > 0 ) { this.reloading = 0; this.shellLoop = false; } else return;

		}

		if ( this.pumping ) return;
		if ( s.ammo <= 0 ) {

			if ( input.mousePressed[ 0 ] ) ctx.audio?.play( 'dry', { vol: 0.6, reverb: 0.05 } );
			this.cool = 0.25;
			if ( s.reserve > 0 || d.infinite ) this.reload();
			return;

		}

		s.ammo --;
		this.cool = d.interval;
		this.fire( player );

	}

	fire( player ) {

		const d = this.def, g = this.gun;
		const cam = this.camera;
		cam.updateMatrixWorld();
		cam.getWorldPosition( _o );
		cam.getWorldDirection( _d );
		_r.set( 1, 0, 0 ).applyQuaternion( cam.quaternion );
		_u.set( 0, 1, 0 ).applyQuaternion( cam.quaternion );
		const moving = Math.min( 1, player.horizontalSpeed / 4.5 );
		const base = d.spread + ( d.adsSpread - d.spread ) * this.ads;
		const spread = base + d.moveSpread * moving * ( 1 - this.ads * 0.6 ) + this.spreadBloom * ( d.auto ? 1 : 0.3 ) + ( player.airborne ? 0.04 : 0 ) - ( player.crouching ? base * 0.3 : 0 );
		g.muzzle.getWorldPosition( _v );
		const muzzle = _v.clone();
		let anyHit = false, killed = false, head = false;
		for ( let p = 0; p < d.pellets; p ++ ) {

			const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt( Math.random() );
			const dir = _d.clone().addScaledVector( _r, Math.cos( a ) * r ).addScaledVector( _u, Math.sin( a ) * r ).normalize();
			const res = this.trace( _o, dir, d );
			if ( res.hitEnemy ) anyHit = true;
			if ( res.killed ) killed = true;
			if ( res.head ) head = true;
			if ( p < 3 || Math.random() < 0.4 ) ctx.fx?.tracer( muzzle, res.end.clone().sub( muzzle ).normalize(), res.end.distanceTo( muzzle ), { tint: d.tracer, intensity: d.pellets > 1 ? 10 : 20, width: d.pellets > 1 ? 0.012 : 0.018 } );

		}

		this.stats.shots ++;
		if ( anyHit ) { this.stats.hits ++; ctx.hud?.hitmarker( killed, head ); }
		// feedback
		const rc = d.recoil;
		const adsK = 1 - this.ads * 0.35;
		player.addRecoil( rc.pitch * adsK * ( 0.85 + Math.random() * 0.3 ), ( Math.random() - 0.5 ) * 2 * rc.yaw * adsK );
		this.kick = Math.min( 0.12, this.kick + rc.kick );
		this.kickRot = Math.min( 0.6, this.kickRot + rc.rot );
		this.shake = Math.min( 1, this.shake + rc.shake );
		this.spreadBloom = Math.min( 0.05, this.spreadBloom + ( d.auto ? 0.006 : 0.012 ) );
		ctx.audio?.play( d.sound, { vol: 1.0, reverb: 0.55, detune: 0.05 } );
		// muzzle flash (scaled viewmodel space)
		ctx.fx?.muzzleFlash( muzzle, _d, d.flash * VM_SCALE * ( this.scoped ? 0 : 1 ) + ( this.scoped ? 0.001 : 0 ) );
		ctx.fx?.lightFlash( _o.clone().addScaledVector( _d, 0.6 ), 60 * d.flash, 0xffb45c, 0.06 );
		// moving parts
		this.slideT = 0; this.boltT = 0;
		if ( d.casing === 'shell' ) {

			this.pumping = true;
			this.pumpT = 0;
			this.pumpEjected = false;

		} else this.eject( player, false );
		this.lastFireTime = ctx.time;
		ctx.enemies?.alert( _o, 45 );

	}

	eject( player, shell ) {

		const g = this.gun;
		g.eject.getWorldPosition( _v );
		const vel = _r.clone().multiplyScalar( 2.2 + Math.random() ).addScaledVector( _u, 1.6 + Math.random() ).addScaledVector( _d, - 0.4 );
		if ( player.velocity ) vel.add( player.velocity );
		ctx.fx?.ejectCasing( _v, vel, shell );

	}

	/** Hitscan with penetration through enemies. Returns end point and hit info. */
	trace( origin, dir, d ) {

		const world = ctx.world;
		let range = 300;
		const out = { end: origin.clone().addScaledVector( dir, range ), hitEnemy: false, killed: false, head: false };
		const wh = world ? world.raycast( origin, dir, range ) : null;
		const trainHit = ctx.train?.raycast?.( origin, dir, wh ? wh.distance : range );
		let wallDist = wh ? wh.distance : range;
		let wallHit = wh;
		if ( trainHit && trainHit.distance < wallDist ) { wallDist = trainHit.distance; wallHit = trainHit; }
		let pen = d.penetrate || 1;
		let damage = d.damage;
		const hits = ctx.enemies ? ctx.enemies.raycastAll( origin, dir, wallDist ) : [];
		for ( const h of hits ) {

			if ( pen <= 0 ) { out.end.copy( h.point ); return out; }
			const mul = h.zone === 'head' ? d.headMul : h.zone === 'limb' ? d.limbMul : 1;
			const falloff = d.pellets > 1 ? Math.max( 0.35, 1 - Math.max( 0, h.distance - 8 ) / 22 ) : 1;
			const dmg = damage * mul * falloff;
			const res = h.enemy.takeHit( { zone: h.zone, damage: dmg, point: h.point, dir, weapon: this.current, bone: h.bone } );
			out.hitEnemy = true;
			if ( res?.killed ) out.killed = true;
			if ( h.zone === 'head' ) out.head = true;
			pen --;
			damage *= 0.6;
			out.end.copy( h.point );
			if ( pen <= 0 ) return out;

		}

		if ( wallHit ) {

			out.end.copy( wallHit.point );
			if ( wallHit.breakable ) wallHit.breakable.hit( wallHit.point, dir, damage );
			else if ( wallHit.isTrain ) ctx.train.onHit( wallHit, dir );
			else ctx.fx?.impact( wallHit, dir, { big: d.damage > 60 } );

		}

		return out;

	}

	// ------------------------------------------------------------------ update & animation

	update( dt, input, player ) {

		if ( ! this.enabled ) return;
		const d = this.def, g = this.gun, s = this.ammo;
		this.cool = Math.max( 0, this.cool - dt );
		this.spreadBloom = Math.max( 0, this.spreadBloom - dt * 0.12 );

		// input
		if ( input.hit( 'Digit1' ) ) this.select( 'deagle' );
		if ( input.hit( 'Digit2' ) ) this.select( 'ak' );
		if ( input.hit( 'Digit3' ) ) this.select( 'shotgun' );
		if ( input.hit( 'Digit4' ) ) this.select( 'svd' );
		if ( input.wheel ) this.cycle( input.wheel > 0 ? 1 : - 1 );
		if ( input.hit( 'KeyR' ) ) this.reload();
		const wantAds = input.mouse[ 2 ] && this.switching <= 0 && ! player.sprinting && ( this.reloading <= 0 || d.perShell );
		this.ads += ( ( wantAds ? 1 : 0 ) - this.ads ) * Math.min( 1, dt * ( d.scope ? 9 : 12 ) );
		this.tryFire( input, player );

		// switching
		if ( this.switching > 0 ) {

			this.switching -= dt;
			if ( this.switching <= 0.28 && this.switchTo ) {

				g.holder.visible = false;
				this.current = this.switchTo;
				this.switchTo = null;
				this.gun.holder.visible = true;
				this.cool = 0.1;

			}

		}

		// pump action after a shotgun shot
		if ( this.pumping ) {

			this.pumpT += dt;
			if ( this.pumpT > 0.22 && ! this.pumpSnd ) { ctx.audio?.play( 'pump', { vol: 0.7, reverb: 0.1 } ); this.pumpSnd = true; }
			if ( this.pumpT > 0.38 && ! this.pumpEjected ) { this.eject( player, true ); this.pumpEjected = true; }
			if ( this.pumpT > 0.7 ) { this.pumping = false; this.pumpSnd = false; }

		}

		// reload progress
		if ( this.reloading > 0 ) {

			this.reloading -= dt;
			if ( d.perShell ) {

				if ( this.reloading <= 0 ) {

					if ( s.ammo < d.mag && s.reserve > 0 ) { s.ammo ++; s.reserve --; ctx.audio?.play( 'shell_in', { vol: 0.7, reverb: 0.1 } ); }
					if ( s.ammo < d.mag && s.reserve > 0 && this.shellLoop ) this.reloading = d.reload; else this.shellLoop = false;

				}

			} else {

				const u = 1 - this.reloading / this.reloadDur;
				if ( u > 0.18 && ! this.reloadSounds.out ) { this.reloadSounds.out = true; ctx.audio?.play( 'mag_out', { vol: 0.7, reverb: 0.1 } ); }
				if ( u > 0.62 && ! this.reloadSounds.in ) {

					this.reloadSounds.in = true;
					ctx.audio?.play( 'mag_in', { vol: 0.8, reverb: 0.1 } );
					const need = d.mag - s.ammo;
					const take = d.infinite ? need : Math.min( need, s.reserve );
					s.ammo += take;
					if ( ! d.infinite ) s.reserve -= take;

				}

				if ( this.reloadEmpty && u > 0.82 && ! this.reloadSounds.bolt ) { this.reloadSounds.bolt = true; this.boltT = 0; this.slideT = 0; ctx.audio?.play( this.current === 'deagle' ? 'slide' : 'bolt', { vol: 0.7, reverb: 0.1 } ); }

			}

		}

		if ( s.ammo === 0 && ( s.reserve > 0 || d.infinite ) && this.reloading <= 0 && this.cool <= 0 && ! input.mouse[ 0 ] ) this.reload();
		this.animate( dt, input, player );
		this.scoped = !! d.scope && this.ads > 0.92 && this.switching <= 0;
		g.holder.visible = ! this.scoped;

	}

	animate( dt, input, player ) {

		const d = this.def, g = this.gun;
		const t = ctx.time;
		// springs
		this.kick += ( 0 - this.kick ) * Math.min( 1, dt * 14 );
		this.kickRot += ( 0 - this.kickRot ) * Math.min( 1, dt * 10 );
		this.shake = Math.max( 0, this.shake - dt * 3 );
		// mouse sway (weapon lags behind view)
		this.swayX += ( - input.dx * 0.00025 - this.swayX ) * Math.min( 1, dt * 8 );
		this.swayY += ( input.dy * 0.00025 - this.swayY ) * Math.min( 1, dt * 8 );
		const sx = THREE.MathUtils.clamp( this.swayX, - 0.05, 0.05 ), sy = THREE.MathUtils.clamp( this.swayY, - 0.05, 0.05 );
		// walk bob
		const sp = player.horizontalSpeed;
		if ( player.onGround ) this.bob += dt * sp * 1.9;
		const bobAmt = Math.min( 1, sp / 5 ) * ( 1 - this.ads * 0.85 ) * ( player.onGround ? 1 : 0.2 );
		const bx = Math.sin( this.bob ) * 0.012 * bobAmt, by = - Math.abs( Math.cos( this.bob ) ) * 0.01 * bobAmt;
		const breathe = Math.sin( t * 1.6 ) * 0.0025 * ( 1 - this.ads * 0.7 );
		// base pose: hip ↔ ADS
		const hip = d.hip;
		const sightY = g.model.userData.sightY;
		const a = ease( this.ads );
		let px = hip[ 0 ] * ( 1 - a );
		let py = hip[ 1 ] * ( 1 - a ) + ( - sightY + 0.004 ) * a;
		let pz = hip[ 2 ] * ( 1 - a ) + d.adsZ * a;
		let rx = 0, ry = - 0.035 * ( 1 - a ), rz = 0.0;
		// sprint pose
		const spr = player.sprintBlend;
		px += spr * - 0.05; py += spr * - 0.04; rx += spr * - 0.3; ry += spr * 0.6; rz += spr * 0.25;
		// switching (lower/raise)
		if ( this.switching > 0 ) {

			const u = this.switching > 0.28 ? 1 - ( this.switching - 0.28 ) / 0.27 : this.switching / 0.28;
			py -= ease( u ) * 0.25; rx -= ease( u ) * 0.6;

		}

		// reload choreography
		if ( this.reloading > 0 && ! d.perShell ) {

			const u = 1 - this.reloading / this.reloadDur;
			const tilt = Math.sin( Math.min( 1, u * 1.15 ) * Math.PI );
			rz += tilt * ( this.current === 'deagle' ? 0.5 : 0.7 );
			rx += tilt * 0.18;
			py -= tilt * 0.03;
			if ( g.mag && g.magRest ) {

				let off = 0;
				if ( u > 0.18 && u < 0.62 ) off = ease( ( u - 0.18 ) / 0.14 ) * 0.35 * ( u < 0.38 ? 1 : 1 - ease( ( u - 0.38 ) / 0.24 ) );
				g.mag.position.set( g.magRest.x, g.magRest.y - off, g.magRest.z );
				g.mag.visible = ! ( u > 0.32 && u < 0.4 );

			}

		} else if ( g.mag && g.magRest ) { g.mag.position.copy( g.magRest ); g.mag.visible = true; }

		if ( this.reloading > 0 && d.perShell ) {

			const u = 1 - this.reloading / d.reload;
			rz += 0.35; rx += 0.1 + Math.sin( u * Math.PI ) * 0.08; py -= 0.02;

		}

		// fire kick
		pz += this.kick;
		rx += this.kickRot * ( d.scope ? 0.4 : 1 );
		const sh = this.shake * 0.004;
		px += ( Math.random() - 0.5 ) * sh; py += ( Math.random() - 0.5 ) * sh;
		// moving parts
		this.slideT = Math.min( 1, this.slideT + dt / 0.09 );
		this.boltT = Math.min( 1, this.boltT + dt / 0.08 );
		if ( g.slide ) g.slide.position.x = - Math.sin( this.slideT * Math.PI ) * 0.034;
		if ( g.bolt ) g.bolt.position.x = - Math.sin( this.boltT * Math.PI ) * 0.07;
		if ( g.pump ) {

			let pumpOff = 0;
			if ( this.pumping ) { const u = this.pumpT; pumpOff = u < 0.2 ? 0 : u < 0.38 ? ease( ( u - 0.2 ) / 0.18 ) : 1 - ease( ( u - 0.38 ) / 0.25 ); }
			g.pump.position.x = 0.27 - pumpOff * 0.09;
			rz += pumpOff * 0.08; pz += pumpOff * 0.015;

		}

		const H = g.holder;
		H.position.set( px + sx + bx, py + sy + by + breathe, pz );
		H.rotation.set( rx - sy * 3, ry + sx * 3 + bx * 2, rz + sx * 4 );

	}

	resetAll() {

		for ( const k of ORDER ) { this.state[ k ].ammo = DEFS[ k ].mag; this.state[ k ].reserve = DEFS[ k ].reserve; }
		this.stats = { shots: 0, hits: 0, headshots: 0 };
		this.reloading = 0; this.switching = 0; this.pumping = false; this.cool = 0;
		for ( const k of ORDER ) this.guns[ k ].holder.visible = false;
		this.current = 'deagle';
		this.gun.holder.visible = true;

	}

}

export { VM_SCALE, _q };
