// Enemy AI: perception, path-finding on the station nav-grid, cover-less skirmish tactics,
// aimed burst fire with visible tracers, hit zones, blood, wounds, ragdoll deaths, voice lines.
import * as THREE from 'three/webgpu';
import { ctx } from '../core/ctx.js';
import { Femme } from './femmeModel.js';
import { buildEnemyGun } from '../player/weaponModels.js';
import { LINES, NAMES, pick } from './lines.js';
import { PLAT_EDGE, BED_Y } from '../world/layout.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3( 1, 0, 0 );
const rnd = ( a, b ) => a + Math.random() * ( b - a );

export const TYPES = {
	glam: { weapon: 'pistol', hp: 80, walk: 1.45, run: 3.1, acc: 0.24, interval: [ 0.8, 1.4 ], burst: [ 1, 2 ], gap: 0.3, dmg: 7, pellets: 1, range: [ 7, 22 ], mag: 12, reload: 1.8, sound: 'pistol', outfits: [ 'red_dress', 'emerald', 'red_coat', 'gold_gown' ], score: 100 },
	agent: { weapon: 'smg', hp: 100, walk: 1.5, run: 3.3, acc: 0.2, interval: [ 1.0, 1.7 ], burst: [ 3, 6 ], gap: 0.09, dmg: 5, pellets: 1, range: [ 6, 18 ], mag: 30, reload: 2.2, sound: 'smg', outfits: [ 'black_leather' ], score: 150 },
	boss: { weapon: 'shotgun', hp: 260, walk: 1.35, run: 2.9, acc: 0.55, interval: [ 1.2, 1.7 ], burst: [ 1, 1 ], gap: 0.3, dmg: 5, pellets: 7, range: [ 2.5, 10 ], mag: 6, reload: 2.6, sound: 'shotgun', outfits: [ 'white_suit' ], score: 400, boss: true }
};

// ------------------------------------------------------------------ ray vs capsule

const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _cp = new THREE.Vector3(), _cq = new THREE.Vector3();

function rayCapsule( ray, a, b, r ) {

	if ( ! b ) {

		_ca.subVectors( a, ray.origin );
		const t = _ca.dot( ray.direction );
		if ( t < 0 ) return null;
		const d2 = _ca.lengthSq() - t * t;
		if ( d2 > r * r ) return null;
		return t - Math.sqrt( r * r - d2 );

	}

	// closest points between the ray and segment ab
	const u = ray.direction;
	const v = _ca.subVectors( b, a );
	const w = _cb.subVectors( ray.origin, a );
	const bb = u.dot( v ), cc = v.dot( v ), dd = u.dot( w ), ee = v.dot( w );
	const den = cc - bb * bb;
	let tc = den < 1e-8 ? ( cc > 0 ? ee / cc : 0 ) : ( ee - bb * dd ) / den;
	tc = Math.max( 0, Math.min( 1, tc ) );
	const ps = _cp.copy( a ).addScaledVector( v, tc );
	const sc = Math.max( 0, _cq.subVectors( ps, ray.origin ).dot( u ) );
	const pr = _cq.copy( ray.origin ).addScaledVector( u, sc );
	const dist2 = pr.distanceToSquared( ps );
	if ( dist2 > r * r ) return null;
	return Math.max( 0, sc - Math.sqrt( r * r - dist2 ) );

}

function floorY( x, z ) {

	const t = ctx.train?.floorAt?.( x, z );
	if ( t !== undefined && t !== null ) return t;
	return Math.abs( z ) < PLAT_EDGE ? 0 : BED_Y;

}

// ------------------------------------------------------------------ enemy

let woundGeo = null, woundMat = null;

class Enemy {

	constructor( mgr, typeKey, stats, spawn ) {

		this.mgr = mgr;
		this.type = TYPES[ typeKey ];
		this.typeKey = typeKey;
		this.stats = stats;
		this.name = pick( NAMES );
		this.outfit = pick( this.type.outfits );
		this.model = new Femme( this.outfit );
		mgr.scene.add( this.model.root );
		this.gun = buildEnemyGun( this.type.weapon );
		this.gun.traverse( ( o ) => { if ( o.isMesh ) o.frustumCulled = false; } );
		mgr.scene.add( this.gun );
		this.muzzle = this.gun.getObjectByName( 'muzzle' );
		this.pos = new THREE.Vector3( spawn.x, 0, spawn.z );
		this.yaw = spawn.x > 0 ? - Math.PI / 2 : Math.PI / 2;
		this.vel = new THREE.Vector3();
		this.hp = stats.hp;
		this.maxHp = stats.hp;
		this.alive = true;
		this.state = 'enter';
		this.path = null; this.pathIdx = 0; this.repathT = 0;
		this.goal = null;
		this.canSee = false; this.seeCheckT = Math.random() * 0.3; this.lastSeenT = - 99; this.lastSeen = new THREE.Vector3();
		this.aim = 0; this.aimDir = new THREE.Vector3( 0, 0, 1 ); this.aimSettle = 0;
		this.fireT = rnd( 1.2, 2.4 ) * stats.reaction; this.burstLeft = 0; this.burstT = 0;
		this.ammo = this.type.mag; this.reloadT = 0;
		this.repositionT = rnd( 2, 5 );
		this.voicePitch = rnd( 1.05, 1.5 );
		this.voiceRate = rnd( 0.95, 1.15 );
		this.voiceT = 0;
		this.spoke = false;
		this.stepT = 0;
		this.hurtFlash = 0;
		this.deadT = 0;
		this.poolDone = false;
		this.gunVel = null;
		this.wounds = 0;
		this.heading = new THREE.Vector3();
		this.model.root.position.copy( this.pos );
		this.model.root.rotation.y = this.yaw;
		this.boundCenter = new THREE.Vector3();

	}

	get eye() { return _v.set( this.pos.x, this.pos.y + 1.62, this.pos.z ); }

	speak( kind, priority = false, chance = 1 ) {

		if ( Math.random() > chance ) return;
		if ( ctx.time < this.voiceT && ! priority ) return;
		const text = pick( LINES[ kind ] );
		if ( ctx.voice?.say( this.name, text, { pitch: this.voicePitch, rate: this.voiceRate, priority } ) ) this.voiceT = ctx.time + 7;

	}

	// ------------------------------------------------------------------ AI

	update( dt ) {

		if ( ! this.alive ) return this.updateDead( dt );
		const player = ctx.player, world = ctx.world;
		const pp = player.position;
		const toP = new THREE.Vector3( pp.x - this.pos.x, 0, pp.z - this.pos.z );
		const dist = toP.length();

		// perception (staggered)
		this.seeCheckT -= dt;
		if ( this.seeCheckT <= 0 ) {

			this.seeCheckT = 0.25;
			const eye = new THREE.Vector3( this.pos.x, 1.6, this.pos.z );
			const pe = player.camera.position;
			const saw = this.canSee;
			this.canSee = player.alive && dist < 75 && world.visible( eye, pe ) && ! ctx.train?.blocksLine?.( eye, pe );
			if ( this.canSee ) {

				this.lastSeen.copy( pp ); this.lastSeenT = ctx.time;
				this.mgr.alerted = true;
				if ( ! saw && ! this.spoke ) { this.spoke = true; this.speak( this.type.boss ? 'boss' : Math.random() < 0.5 ? 'spawn' : 'engage', false, 0.8 ); }

			}

		}

		const knows = this.mgr.alerted || this.canSee;
		if ( this.state === 'enter' && ( this.canSee || dist < 30 ) ) this.state = 'fight';
		const R = this.type.range;
		// choose where to go
		this.repathT -= dt;
		this.repositionT -= dt;
		let wantGoal = null;
		if ( this.state === 'enter' ) {

			if ( ! this.goal || this.repathT <= 0 ) wantGoal = this.pickSpotNear( pp, R[ 1 ] * 0.8, 6 );

		} else if ( this.canSee ) {

			if ( dist > R[ 1 ] ) { if ( this.repathT <= 0 ) wantGoal = this.pickSpotNear( pp, R[ 1 ] * 0.75, 4 ); } else if ( dist < R[ 0 ] && ! this.type.boss ) { if ( this.repathT <= 0 ) wantGoal = this.pickRetreat( pp, R[ 0 ] + 3 ); } else if ( this.repositionT <= 0 ) {

				this.repositionT = rnd( 2.5, 5.5 );
				wantGoal = this.type.boss ? this.pickSpotNear( pp, 3, 2 ) : this.pickStrafe( pp );

			} else if ( this.type.boss && dist > 4 && this.repathT <= 0 ) wantGoal = this.pickSpotNear( pp, 3, 2 );

		} else if ( knows && this.repathT <= 0 ) {

			wantGoal = this.pickSpotNear( ctx.time - this.lastSeenT < 6 ? this.lastSeen : pp, 3, 4 );

		}

		if ( wantGoal ) {

			this.goal = wantGoal;
			this.path = world.nav.findPath( this.pos.x, this.pos.z, wantGoal.x, wantGoal.z );
			this.pathIdx = 1;
			this.repathT = rnd( 0.8, 1.6 );

		}

		// steering along the path
		let speed = 0;
		const desired = _v2.set( 0, 0, 0 );
		if ( this.path && this.pathIdx < this.path.length ) {

			const t = this.path[ this.pathIdx ];
			desired.set( t.x - this.pos.x, 0, t.z - this.pos.z );
			const dl = desired.length();
			if ( dl < 0.35 ) this.pathIdx ++;
			else {

				const running = ( this.state === 'enter' && dist > 20 ) || ( ! this.canSee && knows ) || dist > R[ 1 ] * 1.4;
				speed = running ? this.type.run * this.stats.speedMul : this.type.walk * this.stats.speedMul;
				if ( this.canSee && this.aim > 0.5 ) speed = Math.min( speed, this.type.walk * 0.9 );
				desired.multiplyScalar( speed / dl );

			}

		}

		// separation from other enemies and from the player
		for ( const o of this.mgr.list ) {

			if ( o === this || ! o.alive ) continue;
			const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
			const d2 = dx * dx + dz * dz;
			if ( d2 < 1.0 && d2 > 1e-6 ) { const d = Math.sqrt( d2 ); desired.x += dx / d * ( 1 - d ) * 3; desired.z += dz / d * ( 1 - d ) * 3; }

		}

		this.vel.x += ( desired.x - this.vel.x ) * Math.min( 1, dt * 6 );
		this.vel.z += ( desired.z - this.vel.z ) * Math.min( 1, dt * 6 );
		let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
		const res = world.colliders.resolve( nx, nz, 0.3, true );
		nx = res.x; nz = res.z;
		// never step off the platform (the train side edge can be open while doors are open)
		if ( Math.abs( nz ) > PLAT_EDGE - 0.32 ) nz = Math.sign( nz ) * ( PLAT_EDGE - 0.32 );
		this.stuckT = Math.hypot( nx - this.pos.x, nz - this.pos.z ) < speed * dt * 0.2 && speed > 0.5 ? ( this.stuckT || 0 ) + dt : 0;
		if ( this.stuckT > 1.0 ) { this.stuckT = 0; this.repathT = 0; this.goal = null; this.vel.set( ( Math.random() - 0.5 ) * 2, 0, ( Math.random() - 0.5 ) * 2 ); }
		// keep off the player
		const pdx = nx - pp.x, pdz = nz - pp.z, pd = Math.hypot( pdx, pdz );
		if ( pd < 0.75 && pd > 1e-4 ) { nx = pp.x + pdx / pd * 0.75; nz = pp.z + pdz / pd * 0.75; }
		const actualSpeed = Math.hypot( nx - this.pos.x, nz - this.pos.z ) / Math.max( dt, 1e-4 );
		this.pos.x = nx; this.pos.z = nz;

		// facing: towards movement, or the player when engaging
		const hs = Math.hypot( this.vel.x, this.vel.z );
		let targetYaw = this.yaw;
		if ( this.canSee && this.state === 'fight' ) targetYaw = Math.atan2( toP.x, toP.z );
		else if ( hs > 0.2 ) targetYaw = Math.atan2( this.vel.x, this.vel.z );
		let dy = targetYaw - this.yaw;
		dy = Math.atan2( Math.sin( dy ), Math.cos( dy ) );
		this.yaw += dy * Math.min( 1, dt * 5 );
		// walking backwards/sideways: animate at reduced speed
		const moveYaw = Math.atan2( this.vel.x, this.vel.z );
		const rel = Math.cos( moveYaw - this.yaw );
		const animSpeed = actualSpeed * ( rel > - 0.2 ? 1 : 0.7 );

		// aiming
		const wantAim = this.canSee && this.state === 'fight' && this.reloadT <= 0 ? 1 : 0;
		this.aim += ( wantAim - this.aim ) * Math.min( 1, dt * 4 );
		const target = new THREE.Vector3( pp.x, player.position.y + ( player.crouching ? 0.9 : 1.3 ), pp.z );
		this.updateAim( dt, target );

		// shooting
		this.updateFire( dt, target, dist );

		// footsteps (heels!)
		if ( animSpeed > 0.3 ) {

			this.stepT -= dt * animSpeed;
			if ( this.stepT <= 0 ) {

				this.stepT = 0.62;
				ctx.audio?.play( 'heel', { pos: this.pos, vol: 0.55, reverb: 0.4, ref: 3 } );

			}

		}

		this.model.root.position.copy( this.pos );
		this.model.root.rotation.y = this.yaw;
		this.model.lastVel = new THREE.Vector3( this.vel.x, 0, this.vel.z );
		this.animateModel( dt, animSpeed, target );

	}

	pickSpotNear( center, radius, tries = 6 ) {

		const nav = ctx.world.nav;
		let best = null;
		for ( let i = 0; i < tries; i ++ ) {

			const a = Math.random() * Math.PI * 2, r = radius * ( 0.6 + Math.random() * 0.5 );
			const p = nav.nearestFree( center.x + Math.cos( a ) * r, center.z + Math.sin( a ) * r, 3 );
			if ( ! p ) continue;
			if ( ! best || Math.random() < 0.5 ) best = p;
			if ( ctx.world.visible( _v3.set( p.x, 1.6, p.z ), ctx.player.camera.position ) ) return p;

		}

		return best || { x: center.x, z: center.z };

	}

	pickStrafe( pp ) {

		const nav = ctx.world.nav;
		const side = _v3.set( pp.z - this.pos.z, 0, - ( pp.x - this.pos.x ) ).normalize();
		for ( let i = 0; i < 5; i ++ ) {

			const s = ( Math.random() < 0.5 ? - 1 : 1 ) * rnd( 1.5, 4.5 );
			const p = nav.nearestFree( this.pos.x + side.x * s, this.pos.z + side.z * s, 1.5 );
			if ( p && ctx.world.visible( new THREE.Vector3( p.x, 1.6, p.z ), ctx.player.camera.position ) ) return p;

		}

		return null;

	}

	pickRetreat( pp, d ) {

		const dir = _v3.set( this.pos.x - pp.x, 0, this.pos.z - pp.z ).normalize();
		return ctx.world.nav.nearestFree( pp.x + dir.x * d, pp.z + dir.z * d, 4 );

	}

	updateAim( dt, target ) {

		// the gun sits in front of the chest/shoulder and tracks the target with some lag
		const chest = this.model.bones.chest.getWorldPosition( new THREE.Vector3() );
		const want = target.clone().sub( chest ).normalize();
		// sway & imprecision
		const wob = ( 1 - this.stats.acc ) * 0.05;
		want.x += Math.sin( ctx.time * 1.7 + this.voicePitch * 10 ) * wob;
		want.y += Math.sin( ctx.time * 2.3 + this.voicePitch * 7 ) * wob * 0.6;
		want.normalize();
		const prev = this.aimDir.clone();
		this.aimDir.lerp( want, Math.min( 1, dt * 5 * this.stats.aimSpeed ) ).normalize();
		const change = prev.angleTo( this.aimDir );
		this.aimSettle = change < 0.02 ? this.aimSettle + dt : Math.max( 0, this.aimSettle - dt * 2 );

	}

	updateFire( dt, target, dist ) {

		if ( this.reloadT > 0 ) {

			this.reloadT -= dt;
			if ( this.reloadT <= 0 ) this.ammo = this.type.mag;
			return;

		}

		this.fireT -= dt;
		if ( this.burstLeft > 0 ) {

			this.burstT -= dt;
			if ( this.burstT <= 0 ) { this.shoot( target, dist ); this.burstLeft --; this.burstT = this.type.gap; }
			return;

		}

		if ( this.aim > 0.85 && this.canSee && this.fireT <= 0 && this.aimSettle > 0.15 * this.stats.reaction && ctx.player.alive ) {

			const b = this.type.burst;
			this.burstLeft = Math.round( rnd( b[ 0 ], b[ 1 ] ) );
			this.burstT = 0;
			this.fireT = rnd( this.type.interval[ 0 ], this.type.interval[ 1 ] ) * this.stats.reaction;

		}

	}

	shoot( target, dist ) {

		if ( this.ammo <= 0 ) {

			this.reloadT = this.type.reload;
			this.burstLeft = 0;
			ctx.audio?.play( 'mag_out', { pos: this.pos, vol: 0.5 } );
			this.speak( 'reload', false, 0.35 );
			return;

		}

		this.ammo --;
		const player = ctx.player;
		const muzzle = this.muzzle.getWorldPosition( new THREE.Vector3() );
		const pellets = this.type.pellets;
		const pSpeed = player.horizontalSpeed;
		let hitTotal = 0;
		for ( let i = 0; i < pellets; i ++ ) {

			let p = this.stats.acc * Math.max( 0.15, 1.25 - dist / 28 );
			if ( pSpeed > 5 ) p *= 0.55; else if ( pSpeed > 2 ) p *= 0.75;
			if ( player.crouching ) p *= 0.8;
			if ( pellets > 1 ) p = Math.max( 0.05, 1.05 - dist / 11 ) * this.stats.acc * 1.6;
			if ( player.inTrain ) p *= 0.85;
			p = Math.min( 0.92, p );
			const hit = Math.random() < p;
			const aimP = target.clone();
			if ( ! hit ) {

				// miss: offset around the player, the bullet continues and strikes the station behind
				const off = new THREE.Vector3( rnd( - 1, 1 ), rnd( - 0.6, 0.9 ), rnd( - 1, 1 ) ).normalize().multiplyScalar( rnd( 0.45, 1.4 ) );
				aimP.add( off );

			}

			const dir = aimP.clone().sub( muzzle ).normalize();
			let end;
			if ( hit ) {

				end = aimP;
				hitTotal ++;

			} else {

				const h = ctx.world.raycast( muzzle, dir, 200 );
				end = h ? h.point.clone() : muzzle.clone().addScaledVector( dir, 200 );
				if ( h ) { if ( h.breakable ) h.breakable.hit( h.point, dir, this.type.dmg * 3 ); else ctx.fx?.impact( h, dir ); }
				// near miss → supersonic crack past the ear
				const cp = player.camera.position;
				const t = cp.clone().sub( muzzle ).dot( dir );
				if ( t > 0 && t < muzzle.distanceTo( end ) ) {

					const closest = muzzle.clone().addScaledVector( dir, t );
					if ( closest.distanceTo( cp ) < 1.8 ) ctx.audio?.play( 'whiz', { pos: closest, vol: 0.9, reverb: 0.1 } );

				}

			}

			if ( i < 3 ) ctx.fx?.tracer( muzzle, end.clone().sub( muzzle ).normalize(), muzzle.distanceTo( end ), { tint: 0xff4a6a, intensity: 18, speed: 260, width: 0.02 } );

		}

		if ( hitTotal > 0 ) {

			player.damage( this.stats.dmg * hitTotal, this.pos );
			if ( Math.random() < 0.25 ) this.speak( 'hitPlayer', false, 1 );

		}

		ctx.fx?.muzzleFlash( muzzle, this.aimDir, pellets > 1 ? 0.9 : 0.6 );
		ctx.audio?.play( this.type.sound, { pos: muzzle, vol: 0.9, reverb: 0.6, ref: 4 } );
		this.gunKick = 1;

	}

	animateModel( dt, speed, target ) {

		const m = this.model;
		const right = new THREE.Vector3( - 1, 0, 0 ).applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), this.yaw );
		// relative aim angles for the spine twist
		const fwd = new THREE.Vector3( Math.sin( this.yaw ), 0, Math.cos( this.yaw ) );
		const aimFlat = new THREE.Vector3( this.aimDir.x, 0, this.aimDir.z ).normalize();
		const aimYaw = Math.atan2( fwd.clone().cross( aimFlat ).y, fwd.dot( aimFlat ) );
		const aimPitch = - Math.asin( THREE.MathUtils.clamp( this.aimDir.y, - 1, 1 ) );
		const opts = { dt, speed, aim: this.aim, aimYaw, aimPitch, look: target };
		this.gunKick = Math.max( 0, ( this.gunKick || 0 ) - dt * 8 );
		if ( this.aim > 0.3 ) {

			// place the gun in world space, then IK both hands onto it
			m.root.updateMatrixWorld( true );
			const sh = m.bones.upperArmR.getWorldPosition( new THREE.Vector3() );
			const chest = m.bones.chest.getWorldPosition( new THREE.Vector3() );
			const pistol = this.type.weapon === 'pistol';
			const base = pistol ? sh.clone().lerp( chest, 0.45 ).addScaledVector( this.aimDir, 0.46 ) : chest.clone().addScaledVector( right, 0.11 ).add( new THREE.Vector3( 0, - 0.12, 0 ) ).addScaledVector( this.aimDir, 0.22 );
			base.addScaledVector( this.aimDir, - this.gunKick * 0.05 );
			const lowered = 1 - Math.min( 1, ( this.aim - 0.3 ) / 0.5 );
			base.y -= lowered * 0.25;
			this.gun.position.copy( base );
			_q.setFromUnitVectors( X, this.aimDir );
			this.gun.quaternion.copy( _q );
			if ( this.gunKick > 0 ) this.gun.rotateZ( this.gunKick * 0.25 );
			this.gun.updateMatrixWorld( true );
			opts.gripR = this.gun.localToWorld( new THREE.Vector3( - 0.04, - 0.035, 0 ) );
			opts.gripL = pistol ? this.gun.localToWorld( new THREE.Vector3( - 0.03, - 0.05, - 0.03 ) ) : this.gun.localToWorld( new THREE.Vector3( 0.22, - 0.03, 0 ) );
			if ( this.gun.parent !== ctx.scene ) ctx.scene.attach( this.gun );
			m.animate( opts );

		} else {

			m.animate( opts );
			// carry the gun in the right hand
			const hand = m.bones.handR;
			if ( this.gun.parent !== hand ) {

				hand.add( this.gun );
				this.gun.position.set( 0.0, - 0.1, 0.03 );
				this.gun.rotation.set( 0, - Math.PI / 2, - Math.PI / 2 );

			}

		}

	}

	// ------------------------------------------------------------------ damage

	takeHit( { zone, damage, point, dir, weapon, bone } ) {

		if ( ! this.alive ) {

			ctx.fx?.blood( point, dir, 0.6 );
			// ragdolls react to hits
			if ( this.model.ragdoll ) {

				const R = this.model.ragdoll;
				R.frozen = false; R.rest = 0;
				for ( const n of R.names ) if ( R.pos[ n ].distanceTo( point ) < 0.5 ) R.prev[ n ].addScaledVector( dir, - 0.03 );

			}

			return { killed: false };

		}

		const head = zone === 'head';
		this.hp -= damage;
		ctx.fx?.blood( point, dir, Math.min( 2, 0.6 + damage / 50 ), head );
		ctx.audio?.play( head ? 'headshot' : 'impact_flesh', { pos: point, vol: head ? 1 : 0.8 } );
		this.addWound( point, dir, bone );
		this.mgr.alerted = true;
		this.lastSeen.copy( ctx.player.position ); this.lastSeenT = ctx.time;
		this.state = 'fight';
		const local = dir.clone().applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), - this.yaw );
		this.model.hitReact( local, Math.min( 1.2, damage / 40 ) );
		this.aimSettle = 0;
		if ( this.hp <= 0 ) {

			this.die( { point, dir, weapon, head, damage } );
			return { killed: true };

		}

		if ( Math.random() < 0.55 ) this.speak( 'pain', true );
		return { killed: false };

	}

	addWound( point, dir, boneName ) {

		if ( this.wounds > 10 ) return;
		this.wounds ++;
		if ( ! woundGeo ) {

			woundGeo = new THREE.CircleGeometry( 1, 10 );
			woundMat = new THREE.MeshPhysicalNodeMaterial( { color: 0x3a0203, roughness: 0.15, clearcoat: 1, polygonOffset: true, polygonOffsetFactor: - 2 } );

		}

		const bone = this.model.bones[ boneName ] || this.model.bones.chest;
		const w = new THREE.Mesh( woundGeo, woundMat );
		w.scale.setScalar( rnd( 0.018, 0.035 ) );
		bone.attach( w );
		w.position.copy( bone.worldToLocal( point.clone().addScaledVector( dir, - 0.005 ) ) );
		w.lookAt( point.clone().addScaledVector( dir, - 1 ) );
		bone.attach( w );

	}

	die( { point, dir, weapon, head, damage } ) {

		this.alive = false;
		this.state = 'dead';
		const imp = { deagle: 4.5, ak: 2.8, shotgun: 7, svd: 8 }[ weapon ] || 3;
		const impulse = dir.clone().setY( Math.max( dir.y, 0 ) + 0.15 ).normalize().multiplyScalar( imp * ( head ? 1.2 : 1 ) );
		this.model.startRagdoll( impulse, point );
		// drop the gun
		ctx.scene.attach( this.gun );
		this.gunVel = new THREE.Vector3( rnd( - 1, 1 ), 2, rnd( - 1, 1 ) ).addScaledVector( dir, 2 );
		this.gunSpin = new THREE.Vector3( rnd( - 8, 8 ), rnd( - 8, 8 ), rnd( - 8, 8 ) );
		ctx.audio?.play( 'body_fall', { pos: this.pos, vol: 0.9, delay: 0.5 } );
		this.mgr.onDeath( this, { head, weapon, damage } );

	}

	updateDead( dt ) {

		this.deadT += dt;
		const m = this.model;
		m.stepRagdoll( Math.min( dt, 1 / 30 ), floorY, ( x, z, r ) => ctx.world.colliders.resolve( x, z, r, true ) );
		if ( ! this.poolDone && this.deadT > 1.0 && m.ragdoll ) {

			this.poolDone = true;
			const p = m.ragdoll.pos.chest.clone().lerp( m.ragdoll.pos.pelvis, 0.5 );
			ctx.fx?.bloodPool( p, rnd( 1.0, 1.6 ) );

		}

		if ( this.gunVel ) {

			this.gunVel.y -= 9.81 * dt;
			this.gun.position.addScaledVector( this.gunVel, dt );
			this.gun.rotation.x += this.gunSpin.x * dt; this.gun.rotation.y += this.gunSpin.y * dt; this.gun.rotation.z += this.gunSpin.z * dt;
			const fy = floorY( this.gun.position.x, this.gun.position.z ) + 0.03;
			if ( this.gun.position.y < fy ) {

				this.gun.position.y = fy;
				if ( this.gunVel.y < - 1 ) ctx.audio?.play( 'impact_metal', { pos: this.gun.position, vol: 0.4 } );
				this.gunVel.y *= - 0.3; this.gunVel.x *= 0.5; this.gunVel.z *= 0.5; this.gunSpin.multiplyScalar( 0.5 );
				if ( Math.abs( this.gunVel.y ) < 0.3 ) { this.gunVel = null; this.gun.rotation.x = 0; this.gun.rotation.z = Math.PI / 2; }

			}

		}

	}

	/** Hit test for bullets. */
	intersect( ray, maxDist ) {

		const chest = this.model.bones.chest.getWorldPosition( this.boundCenter );
		if ( ray.distanceSqToPoint( chest ) > 1.44 ) return null;
		let best = null;
		for ( const [ zone, a, b, r, bone ] of this.model.capsules() ) {

			const t = rayCapsule( ray, a, b, r );
			if ( t !== null && t < maxDist && ( ! best || t < best.distance ) ) best = { distance: t, zone, bone };

		}

		if ( best ) best.point = ray.origin.clone().addScaledVector( ray.direction, best.distance );
		return best;

	}

	dispose() {

		this.model.dispose();
		this.gun.removeFromParent();

	}

}

// ------------------------------------------------------------------ pickups

class Pickups {

	constructor( scene ) {

		this.scene = scene;
		this.items = [];
		const white = new THREE.MeshPhysicalNodeMaterial( { color: 0xf4f4f0, roughness: 0.35, clearcoat: 0.6 } );
		const red = new THREE.MeshStandardNodeMaterial( { color: 0xd01010, emissive: 0x600000, roughness: 0.4 } );
		const olive = new THREE.MeshStandardNodeMaterial( { color: 0x4a5230, roughness: 0.6, metalness: 0.3 } );
		const yellow = new THREE.MeshStandardNodeMaterial( { color: 0xe0b020, emissive: 0x302000 } );
		this.mk = { white, red, olive, yellow };

	}

	spawn( kind, pos ) {

		const g = new THREE.Group();
		if ( kind === 'med' ) {

			g.add( new THREE.Mesh( new THREE.BoxGeometry( 0.32, 0.18, 0.22 ), this.mk.white ) );
			const c1 = new THREE.Mesh( new THREE.BoxGeometry( 0.14, 0.04, 0.005 ), this.mk.red ); c1.position.set( 0, 0, 0.113 ); g.add( c1 );
			const c2 = new THREE.Mesh( new THREE.BoxGeometry( 0.04, 0.14, 0.005 ), this.mk.red ); c2.position.set( 0, 0, 0.113 ); g.add( c2 );

		} else {

			g.add( new THREE.Mesh( new THREE.BoxGeometry( 0.34, 0.16, 0.2 ), this.mk.olive ) );
			const s = new THREE.Mesh( new THREE.BoxGeometry( 0.345, 0.03, 0.205 ), this.mk.yellow ); s.position.y = 0.03; g.add( s );

		}

		g.position.set( pos.x, 0.25, pos.z );
		this.scene.add( g );
		this.items.push( { g, kind, t: 0 } );

	}

	update( dt, player, weapons ) {

		for ( const it of this.items ) {

			it.t += dt;
			it.g.rotation.y += dt * 1.5;
			it.g.position.y = 0.3 + Math.sin( it.t * 3 ) * 0.05;
			const d = Math.hypot( it.g.position.x - player.position.x, it.g.position.z - player.position.z );
			if ( d < 1.3 && player.alive ) {

				if ( it.kind === 'med' ) {

					if ( player.health >= 100 ) continue;
					player.heal( 35 );
					ctx.hud?.killfeed( '+35 здоровья', false );

				} else {

					weapons.addAmmo( 'deagle', 14 ); weapons.addAmmo( 'ak', 45 ); weapons.addAmmo( 'shotgun', 8 ); weapons.addAmmo( 'svd', 5 );
					ctx.hud?.killfeed( 'Боеприпасы подобраны', false );

				}

				ctx.audio?.play( 'pickup', { vol: 0.6, reverb: 0.05 } );
				it.dead = true;
				it.g.removeFromParent();

			}

		}

		this.items = this.items.filter( ( i ) => ! i.dead );

	}

	clear() { for ( const it of this.items ) it.g.removeFromParent(); this.items = []; }

}

// ------------------------------------------------------------------ manager

export class Enemies {

	constructor( scene ) {

		this.scene = scene;
		this.list = [];
		this.alerted = false;
		this.pickups = new Pickups( scene );
		this.kills = 0;
		this.headshots = 0;
		this._ray = new THREE.Ray();

	}

	get aliveCount() { return this.list.filter( ( e ) => e.alive ).length; }

	spawn( typeKey, stats, spawnPoint ) {

		const e = new Enemy( this, typeKey, stats, spawnPoint );
		this.list.push( e );
		return e;

	}

	alert( pos, radius ) {

		for ( const e of this.list ) if ( e.alive && e.pos.distanceTo( pos ) < radius ) { e.lastSeen.copy( ctx.player.position ); e.lastSeenT = ctx.time; this.alerted = true; if ( e.state === 'enter' ) e.state = 'fight'; }

	}

	raycastAll( origin, dir, maxDist ) {

		this._ray.origin.copy( origin ); this._ray.direction.copy( dir );
		const out = [];
		for ( const e of this.list ) {

			if ( ! e.alive && ! e.model.ragdoll ) continue;
			const h = e.intersect( this._ray, maxDist );
			if ( h ) { h.enemy = e; out.push( h ); }

		}

		out.sort( ( a, b ) => a.distance - b.distance );
		// only living targets stop bullets; corpses just bleed
		return out.filter( ( h, i ) => h.enemy.alive || i === 0 );

	}

	onDeath( e, { head } ) {

		this.kills ++;
		if ( head ) this.headshots ++;
		const score = e.type.score * ( head ? 2 : 1 );
		ctx.game?.addScore( score );
		ctx.hud?.killfeed( `${ e.name } — ${ head ? 'в голову! ' : '' }+${ score }`, head );
		// allies react
		const near = this.list.filter( ( o ) => o.alive && o !== e && o.pos.distanceTo( e.pos ) < 30 );
		if ( near.length ) pick( near ).speak( 'ally', false, 0.7 );
		// drops
		const r = Math.random();
		if ( r < 0.35 ) this.pickups.spawn( 'med', e.pos ); else if ( r < 0.8 ) this.pickups.spawn( 'ammo', e.pos );
		ctx.game?.onEnemyKilled( e );

	}

	update( dt ) {

		for ( const e of this.list ) e.update( dt );
		// cap corpses
		const dead = this.list.filter( ( e ) => ! e.alive );
		if ( dead.length > 14 ) {

			const old = dead[ 0 ];
			old.dispose();
			this.list.splice( this.list.indexOf( old ), 1 );

		}

		this.pickups.update( dt, ctx.player, ctx.weapons );

	}

	clear() {

		for ( const e of this.list ) e.dispose();
		this.list = [];
		this.alerted = false;
		this.pickups.clear();

	}

}
