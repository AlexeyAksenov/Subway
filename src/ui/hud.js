// DOM heads-up display.
import { ctx } from '../core/ctx.js';
import { DEFS, ORDER } from '../player/weapons.js';

const $ = ( id ) => document.getElementById( id );

export class HUD {

	constructor() {

		this.el = $( 'hud' );
		this.hp = $( 'health' );
		this.hpFill = this.hp.querySelector( '.fill' );
		this.hpGhost = this.hp.querySelector( '.ghost' );
		this.hpNum = this.hp.querySelector( '.num' );
		this.mag = $( 'mag' ); this.reserve = $( 'reserve' ); this.wname = $( 'weapon-name' );
		this.slots = $( 'weapon-slots' );
		this.slots.innerHTML = ORDER.map( ( k, i ) => `<div data-k="${ k }">${ i + 1 } ${ DEFS[ k ].short }</div>` ).join( '' );
		this.cross = $( 'crosshair' );
		this.hit = $( 'hitmarker' );
		this.scope = $( 'scope' );
		this.dmg = $( 'damage' );
		this.low = $( 'lowhp' );
		this.flashEl = $( 'flash' );
		this.dirs = $( 'dmgdirs' );
		this.wave = $( 'wave' ); this.left = $( 'enemies-left' ); this.station = $( 'station-name' );
		this.score = $( 'score' );
		this.obj = $( 'objective' );
		this.subs = $( 'subtitles' );
		this.banner = $( 'banner' );
		this.feed = $( 'killfeed' );
		this.fps = $( 'fps' );
		this.hitT = 0;
		this.dmgA = 0;
		this.flashA = 0;
		this.last = {};
		this.bannerT = 0;

	}

	show( v ) { this.el.classList.toggle( 'hidden', ! v ); }

	set( key, el, val, prop = 'textContent' ) {

		if ( this.last[ key ] === val ) return;
		this.last[ key ] = val;
		el[ prop ] = val;

	}

	hitmarker( kill, head ) {

		this.hitT = kill ? 0.35 : 0.18;
		this.hit.classList.toggle( 'kill', !! kill );
		ctx.audio?.play( kill ? 'kill' : 'hit', { vol: kill ? 0.45 : 0.3, reverb: 0 } );
		void head;

	}

	damage( amount, from, player ) {

		this.dmgA = Math.min( 1, this.dmgA + 0.25 + amount / 40 );
		if ( ! from ) return;
		const dx = from.x - player.position.x, dz = from.z - player.position.z;
		const y = player.yaw;
		const fd = - Math.sin( y ) * dx - Math.cos( y ) * dz;
		const rd = Math.cos( y ) * dx - Math.sin( y ) * dz;
		const rel = Math.atan2( rd, fd );
		const d = document.createElement( 'div' );
		d.className = 'dmgdir';
		d.style.transform = `rotate(${ rel }rad)`;
		this.dirs.appendChild( d );
		requestAnimationFrame( () => { d.style.opacity = 0; } );
		setTimeout( () => d.remove(), 900 );

	}

	flash( a = 1 ) { this.flashA = Math.max( this.flashA, a ); }

	setWave( n, stationName ) {

		this.set( 'wave', this.wave, `ВОЛНА ${ n }` );
		this.set( 'station', this.station, stationName.toUpperCase() );

	}

	setEnemies( n ) { this.set( 'left', this.left, n > 0 ? `ПРОТИВНИЦЫ: ${ n }` : 'СТАНЦИЯ ЗАЧИЩЕНА' ); }

	setScore( n ) { this.set( 'score', this.score, n.toLocaleString( 'ru-RU' ) ); }

	objective( text ) {

		if ( text ) { this.obj.textContent = text; this.obj.classList.add( 'on' ); } else this.obj.classList.remove( 'on' );

	}

	showBanner( big, small = '', dur = 3.5 ) {

		this.banner.querySelector( '.big' ).textContent = big;
		this.banner.querySelector( '.small' ).textContent = small;
		this.banner.classList.add( 'on' );
		this.bannerT = dur;

	}

	subtitle( speaker, text, { announce = false, dur = 3.5 } = {} ) {

		const wrap = document.createElement( 'div' );
		wrap.className = 'sub-wrap';
		const d = document.createElement( 'div' );
		d.className = 'sub' + ( announce ? ' announce' : '' );
		d.innerHTML = `<b></b><span></span>`;
		d.querySelector( 'b' ).textContent = speaker + ':';
		d.querySelector( 'span' ).textContent = text;
		wrap.appendChild( d );
		this.subs.appendChild( wrap );
		while ( this.subs.children.length > 3 ) this.subs.firstChild.remove();
		setTimeout( () => { d.style.opacity = 0; }, dur * 1000 );
		setTimeout( () => wrap.remove(), dur * 1000 + 600 );

	}

	killfeed( text, head ) {

		const d = document.createElement( 'div' );
		if ( head ) d.className = 'hs';
		d.textContent = text;
		this.feed.prepend( d );
		while ( this.feed.children.length > 5 ) this.feed.lastChild.remove();
		setTimeout( () => { d.style.opacity = 0; }, 4000 );
		setTimeout( () => d.remove(), 4700 );

	}

	update( dt, player, weapons, fps ) {

		const hp = Math.ceil( player.health );
		this.set( 'hp', this.hpNum, String( hp ) );
		if ( this.last.hpw !== hp ) {

			this.last.hpw = hp;
			this.hpFill.style.width = hp + '%';
			this.hpGhost.style.width = hp + '%';

		}

		const s = weapons.ammo, d = weapons.def;
		this.set( 'mag', this.mag, String( s.ammo ) );
		this.set( 'res', this.reserve, d.infinite ? '∞' : String( s.reserve ) );
		this.set( 'wn', this.wname, d.name );
		const lowAmmo = s.ammo <= Math.ceil( d.mag * 0.25 );
		if ( this.last.lowAmmo !== lowAmmo ) { this.last.lowAmmo = lowAmmo; this.mag.classList.toggle( 'low', lowAmmo ); }
		const cur = weapons.switchTo || weapons.current;
		if ( this.last.slot !== cur ) {

			this.last.slot = cur;
			for ( const el of this.slots.children ) el.classList.toggle( 'on', el.dataset.k === cur );

		}

		// crosshair
		const spread = ( d.spread + ( d.adsSpread - d.spread ) * weapons.ads ) + d.moveSpread * Math.min( 1, player.horizontalSpeed / 4.5 ) + weapons.spreadBloom;
		const gap = 6 + spread * 900;
		this.cross.style.setProperty( '--gap', gap.toFixed( 1 ) + 'px' );
		const crossVis = weapons.ads > 0.6 || weapons.scoped || player.sprintBlend > 0.5 ? 0 : 1;
		if ( this.last.cv !== crossVis ) { this.last.cv = crossVis; this.cross.style.opacity = crossVis; }
		if ( this.last.scoped !== weapons.scoped ) { this.last.scoped = weapons.scoped; this.scope.classList.toggle( 'hidden', ! weapons.scoped ); }
		// hitmarker
		this.hitT = Math.max( 0, this.hitT - dt );
		this.hit.style.opacity = this.hitT > 0 ? Math.min( 1, this.hitT * 8 ) : 0;
		// damage overlays
		this.dmgA = Math.max( 0, this.dmgA - dt * 1.6 );
		this.dmg.style.opacity = this.dmgA.toFixed( 3 );
		const lowHp = player.health < 35 && player.alive ? ( 35 - player.health ) / 35 : 0;
		this.low.style.opacity = lowHp.toFixed( 2 );
		this.flashA = Math.max( 0, this.flashA - dt * 2.5 );
		this.flashEl.style.opacity = this.flashA.toFixed( 3 );
		if ( this.bannerT > 0 ) { this.bannerT -= dt; if ( this.bannerT <= 0 ) this.banner.classList.remove( 'on' ); }
		if ( fps !== undefined ) this.set( 'fps', this.fps, fps );

	}

}
