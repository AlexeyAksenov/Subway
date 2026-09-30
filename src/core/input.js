// Keyboard / mouse input with pointer lock and per-frame edge detection.
export class Input {

	constructor( el ) {

		this.el = el;
		this.down = new Set();
		this.pressed = new Set();
		this.released = new Set();
		this.dx = 0; this.dy = 0;
		this.wheel = 0;
		this.mouse = [ false, false, false ];
		this.mousePressed = [ false, false, false ];
		this.locked = false;
		this.onLockChange = null;

		addEventListener( 'keydown', ( e ) => {

			if ( e.repeat ) return;
			this.down.add( e.code );
			this.pressed.add( e.code );
			if ( this.locked && [ 'Space', 'Tab', 'ControlLeft', 'KeyS', 'KeyW' ].includes( e.code ) ) e.preventDefault();

		} );
		addEventListener( 'keyup', ( e ) => { this.down.delete( e.code ); this.released.add( e.code ); } );
		addEventListener( 'mousemove', ( e ) => {

			if ( ! this.locked ) return;
			// guard against rare pointer-lock jump spikes
			if ( Math.abs( e.movementX ) > 400 || Math.abs( e.movementY ) > 400 ) return;
			this.dx += e.movementX; this.dy += e.movementY;

		} );
		addEventListener( 'mousedown', ( e ) => {

			if ( ! this.locked ) return;
			this.mouse[ e.button ] = true;
			this.mousePressed[ e.button ] = true;

		} );
		addEventListener( 'mouseup', ( e ) => { this.mouse[ e.button ] = false; } );
		addEventListener( 'wheel', ( e ) => { if ( this.locked ) this.wheel += Math.sign( e.deltaY ); }, { passive: true } );
		addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		addEventListener( 'blur', () => { this.down.clear(); this.mouse.fill( false ); } );
		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === this.el;
			if ( ! this.locked ) { this.down.clear(); this.mouse.fill( false ); }
			this.onLockChange?.( this.locked );

		} );

	}

	lock() {

		const p = this.el.requestPointerLock?.( { unadjustedMovement: true } );
		if ( p && p.catch ) p.catch( () => this.el.requestPointerLock?.() );

	}

	unlock() { document.exitPointerLock?.(); }

	key( code ) { return this.down.has( code ); }
	hit( code ) { return this.pressed.has( code ); }

	endFrame() {

		this.pressed.clear();
		this.released.clear();
		this.mousePressed.fill( false );
		this.dx = 0; this.dy = 0;
		this.wheel = 0;

	}

}
