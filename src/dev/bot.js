// Development autopilot (?bot): plays the game headlessly to exercise waves, the train and travel.
import * as THREE from 'three/webgpu';
import { ctx } from '../core/ctx.js';

export class Bot {

	constructor( game ) {

		this.g = game;
		this.t = 0;
		game.input.locked = true;
		game.started || game.start();

	}

	drive( dt, input ) {

		const g = this.g, p = g.player;
		this.t += dt;
		input.locked = true;
		input.down.clear();
		input.mouse[ 0 ] = false;
		// target: nearest visible enemy
		let best = null, bd = Infinity;
		for ( const e of g.enemies.list ) {

			if ( ! e.alive ) continue;
			const d = e.pos.distanceTo( p.position );
			if ( d < bd && ctx.world.visible( p.camera.position, new THREE.Vector3( e.pos.x, 1.3, e.pos.z ) ) ) { bd = d; best = e; }

		}

		let goal = null;
		if ( best ) {

			const chest = best.model.bones.chest.getWorldPosition( new THREE.Vector3() );
			const d = chest.sub( p.camera.position );
			const yaw = Math.atan2( - d.x, - d.z );
			const pitch = Math.atan2( d.y, Math.hypot( d.x, d.z ) );
			const dy = Math.atan2( Math.sin( yaw - p.yaw ), Math.cos( yaw - p.yaw ) );
			p.yaw += Math.max( - 0.2, Math.min( 0.2, dy ) );
			p.pitch += ( pitch - p.pitch ) * 0.3;
			if ( Math.abs( dy ) < 0.06 ) {

				input.mouse[ 0 ] = true;
				input.mousePressed[ 0 ] = ( Math.floor( this.t * 4 ) % 2 ) === 0;

			}

			const w = g.weapons;
			const pref = [ 'ak', 'shotgun', 'svd', 'deagle' ].find( ( k ) => w.state[ k ].ammo + w.state[ k ].reserve > 0 || k === 'deagle' );
			if ( w.current !== pref && ! w.switchTo ) w.select( pref );
			if ( w.def.auto === false ) input.mousePressed[ 0 ] = input.mouse[ 0 ] && ( Math.floor( this.t * 6 ) % 2 === 0 );

		} else if ( g.state === 'boarding' || g.state === 'trainArriving' ) {

			const doors = g.train.doorPositions();
			doors.sort( ( a, b ) => a.distanceTo( p.position ) - b.distanceTo( p.position ) );
			goal = doors[ 0 ].clone().setZ( g.train.z );

		} else if ( g.train.carAt( p.position.x, p.position.z ) !== null && g.train.doorOpen > 0.9 ) {

			// step out through the nearest door
			const doors = g.train.doorPositions();
			doors.sort( ( a, b ) => Math.abs( a.x - p.position.x ) - Math.abs( b.x - p.position.x ) );
			const d = doors[ 0 ];
			goal = Math.abs( d.x - p.position.x ) > 0.25 ? new THREE.Vector3( d.x, 0, g.train.z ) : new THREE.Vector3( d.x, 0, 7 );

		} else if ( ! best && g.state === 'combat' && Math.abs( p.position.z ) > 6 ) {

			goal = new THREE.Vector3( p.position.x, 0, 0 );

		}

		if ( goal ) {

			const d = new THREE.Vector3( goal.x - p.position.x, 0, goal.z - p.position.z );
			if ( d.length() > 0.3 ) {

				const yaw = Math.atan2( - d.x, - d.z );
				p.yaw = yaw;
				p.pitch = 0;
				input.down.add( 'KeyW' );
				if ( d.length() > 6 ) input.down.add( 'ShiftLeft' );

			}

		}

	}

}
