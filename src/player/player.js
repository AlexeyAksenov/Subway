// First-person controller: mouse look with recoil, acceleration/friction movement, sprint,
// crouch, jump, collision against the station, riding the train, footsteps and damage.
import * as THREE from 'three/webgpu';
import { ctx } from '../core/ctx.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3( 0, 1, 0 );

export class Player {

	constructor( camera ) {

		this.camera = camera;
		camera.rotation.order = 'YXZ';
		this.position = new THREE.Vector3( 0, 0, 0 );
		this.velocity = new THREE.Vector3();
		this.yaw = - Math.PI / 2;
		this.pitch = 0;
		this.recoilP = 0; this.recoilY = 0;
		this.sens = 0.0022;
		this.radius = 0.38;
		this.eye = 1.66;
		this.eyeCur = 1.66;
		this.health = 100;
		this.alive = true;
		this.onGround = true;
		this.vy = 0;
		this.sprinting = false;
		this.sprintBlend = 0;
		this.crouching = false;
		this.stepDist = 0;
		this.landDip = 0;
		this.shakeAmt = 0;
		this.roll = 0;
		this.baseFov = 78;
		this.fovMul = 1;
		this.hurtT = 0;
		this.lastDamageTime = - 10;
		this.inTrain = null;
		this.frozen = false;

	}

	get horizontalSpeed() { return Math.hypot( this.velocity.x, this.velocity.z ); }
	get airborne() { return ! this.onGround; }
	get eyePosition() { return new THREE.Vector3( this.position.x, this.position.y + this.eyeCur, this.position.z ); }

	spawn( x, z, yaw ) {

		this.position.set( x, 0, z );
		this.velocity.set( 0, 0, 0 );
		this.yaw = yaw; this.pitch = 0; this.vy = 0;
		this.recoilP = this.recoilY = 0;

	}

	addRecoil( p, y ) {

		this.recoilP += p;
		this.recoilY += y;
		this.recoilTime = ctx.time;

	}

	shake( a ) { this.shakeAmt = Math.min( 1.5, this.shakeAmt + a ); }

	damage( amount, from ) {

		if ( ! this.alive || ctx.game?.god ) return;
		this.health = Math.max( 0, this.health - amount );
		this.hurtT = 0.4;
		this.lastDamageTime = ctx.time;
		this.shake( 0.25 + amount * 0.015 );
		ctx.audio?.play( 'hurt', { vol: 0.9, reverb: 0.05 } );
		ctx.hud?.damage( amount, from, this );
		if ( this.health <= 0 ) {

			this.alive = false;
			ctx.game?.onPlayerDeath();

		}

	}

	heal( n ) { this.health = Math.min( 100, this.health + n ); }

	update( dt, input ) {

		const cam = this.camera;
		// ----- look
		if ( ! this.frozen ) {

			const k = this.sens * ( ctx.weapons ? 1 - ctx.weapons.ads * ( ctx.weapons.def.scope ? 0.75 : 0.35 ) : 1 );
			this.yaw -= input.dx * k;
			this.pitch -= input.dy * k;
			this.pitch = THREE.MathUtils.clamp( this.pitch, - 1.5, 1.5 );

		}

		// recoil: fold part of the kick into the aim, recover the rest
		const since = ctx.time - ( this.recoilTime || 0 );
		if ( since > 0.08 ) {

			const rec = Math.min( 1, dt * 7 );
			this.recoilP -= this.recoilP * rec;
			this.recoilY -= this.recoilY * rec;

		}

		// ----- movement
		const fw = ( input.key( 'KeyW' ) ? 1 : 0 ) - ( input.key( 'KeyS' ) ? 1 : 0 );
		const st = ( input.key( 'KeyD' ) ? 1 : 0 ) - ( input.key( 'KeyA' ) ? 1 : 0 );
		this.crouching = input.key( 'ControlLeft' ) || input.key( 'KeyC' ) || input.key( 'ControlRight' );
		const ads = ctx.weapons ? ctx.weapons.ads : 0;
		this.sprinting = input.key( 'ShiftLeft' ) && fw > 0 && ! this.crouching && ads < 0.3 && this.onGround && ! this.frozen;
		this.sprintBlend += ( ( this.sprinting && this.horizontalSpeed > 3 ? 1 : 0 ) - this.sprintBlend ) * Math.min( 1, dt * 8 );
		const maxSpeed = this.sprinting ? 7.2 : this.crouching ? 2.3 : ads > 0.5 ? 3.0 : 4.6;
		_f.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
		_r.set( Math.cos( this.yaw ), 0, - Math.sin( this.yaw ) );
		_w.set( 0, 0, 0 ).addScaledVector( _f, fw ).addScaledVector( _r, st );
		if ( _w.lengthSq() > 0 ) _w.normalize();
		if ( this.frozen || ! this.alive ) _w.set( 0, 0, 0 );
		const accel = this.onGround ? 55 : 8;
		const target = _w.multiplyScalar( maxSpeed );
		const dvx = target.x - this.velocity.x, dvz = target.z - this.velocity.z;
		const dl = Math.hypot( dvx, dvz );
		const step = Math.min( dl, accel * dt );
		if ( dl > 0 ) { this.velocity.x += dvx / dl * step; this.velocity.z += dvz / dl * step; }
		// jump & gravity
		if ( input.hit( 'Space' ) && this.onGround && ! this.frozen && this.alive ) {

			this.vy = 4.6;
			this.onGround = false;

		}

		this.vy -= 15 * dt;
		let nx = this.position.x + this.velocity.x * dt;
		let nz = this.position.z + this.velocity.z * dt;
		let ny = this.position.y + this.vy * dt;
		// ride the train (platform carrying)
		const carry = ctx.train?.carryDelta?.( this.position );
		if ( carry ) { nx += carry.x; nz += carry.z; }
		this.inTrain = ctx.train?.carAt?.( nx, nz ) ?? null;
		// collide
		if ( ctx.world ) {

			const res = ctx.world.colliders.resolve( nx, nz, this.radius, true );
			nx = res.x; nz = res.z;

		}

		const floor = 0;
		if ( ny <= floor ) {

			if ( ! this.onGround && this.vy < - 3 ) { this.landDip = Math.min( 0.18, - this.vy * 0.025 ); ctx.audio?.play( 'land', { vol: 0.5, reverb: 0.15 } ); }
			ny = floor; this.vy = 0; this.onGround = true;

		}

		const moved = Math.hypot( nx - this.position.x - ( carry ? carry.x : 0 ), nz - this.position.z - ( carry ? carry.z : 0 ) );
		this.velocity.x = ( nx - this.position.x - ( carry ? carry.x : 0 ) ) / Math.max( dt, 1e-4 );
		this.velocity.z = ( nz - this.position.z - ( carry ? carry.z : 0 ) ) / Math.max( dt, 1e-4 );
		this.position.set( nx, ny, nz );

		// footsteps
		if ( this.onGround ) {

			this.stepDist += moved;
			const stride = this.sprinting ? 2.4 : 1.9;
			if ( this.stepDist > stride ) {

				this.stepDist = 0;
				ctx.audio?.play( 'step', { vol: this.crouching ? 0.12 : this.sprinting ? 0.45 : 0.28, reverb: 0.25 } );

			}

		}

		// ----- camera
		this.eyeCur += ( ( this.crouching ? 1.1 : 1.66 ) - this.eyeCur ) * Math.min( 1, dt * 10 );
		this.landDip += ( 0 - this.landDip ) * Math.min( 1, dt * 6 );
		this.shakeAmt = Math.max( 0, this.shakeAmt - dt * 2.5 );
		const sh = this.shakeAmt * this.shakeAmt * 0.02;
		const bobA = this.onGround ? Math.min( 1, this.horizontalSpeed / 5 ) * ( 1 - ads * 0.9 ) : 0;
		const bobT = ctx.time * ( this.sprinting ? 11 : 8.5 );
		const bobY = Math.abs( Math.sin( bobT ) ) * 0.035 * bobA;
		cam.position.set( this.position.x, this.position.y + this.eyeCur - this.landDip + bobY + ( Math.random() - 0.5 ) * sh, this.position.z );
		this.roll += ( - st * 0.012 * ( 1 - ads ) - this.roll ) * Math.min( 1, dt * 6 );
		cam.rotation.set( this.pitch + this.recoilP + ( Math.random() - 0.5 ) * sh, this.yaw + this.recoilY + ( Math.random() - 0.5 ) * sh, this.roll + Math.sin( bobT * 0.5 ) * 0.004 * bobA );
		// FOV (ADS / sprint)
		const w = ctx.weapons;
		let fovMul = 1;
		if ( w ) fovMul = 1 + ( w.def.adsFov - 1 ) * w.ads;
		fovMul *= 1 + this.sprintBlend * 0.06;
		const fov = this.baseFov * fovMul;
		if ( Math.abs( cam.fov - fov ) > 0.01 ) { cam.fov = fov; cam.updateProjectionMatrix(); }
		this.hurtT = Math.max( 0, this.hurtT - dt );

	}

	forward( out = new THREE.Vector3() ) { return this.camera.getWorldDirection( out ); }

}

export { UP };
